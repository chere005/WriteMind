/**
 * The notes folder, on disk. Ported from `NoteStore` and `NoteTree` — the
 * half of them that is filesystem work, which is all that was left once the
 * rules moved into `@writemind/core`.
 *
 * A NOTE IS A `.wm` FILE (docs/SPEC-WM.md): one ZIP holding its text, its drawing, its pictures and its ink snapshots.
 * What is in a note is read and written by wmStore.ts (one writer per note); this file is the FOLDER's side: the tree
 * of rows, the order the rows were dragged into, and the moves, renames and copies of the files themselves.
 *
 * A SECTION IS A FOLDER. The sidebar tree is the folder tree under the notes
 * directory, so a note moved in WriteMind is moved in Explorer or Finder and
 * the other way round. Nothing is invented and nothing is a database.
 *
 * WHERE A FOLDER KEEPS ITS ORDER. Each project folder keeps `.writemind/order.json`, the order its rows were dragged
 * into (the Mac's file, key for key), so a folder carries its arrangement with it — copied to another machine, moved,
 * put on a stick, added to another project. The drawings and pictures are INSIDE the notes now; the `.drawings`
 * folders of 2.15.0 were folded into them by the conversion (convert.ts) and moved away.
 */

import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import {
  appending, arrange, emptyOrder, forget, isInside, isWmName, makeNote, ORDER_FILE, orderKey, placing, sessionFileName, setOrder,
  type Note, type NoteOrder,
} from "@writemind/core"
import { codeOf, limiter, partialOf, within, writeFileAtomic } from "./atomic"
import { dirtyFiles, fold, keyOf, remember, wroteRecently } from "./echo"
import { safeName } from "./fileNames"
import { isForeignPath } from "./project"
import {
  adoptNote, copyOf, createFile, freshNote, frontNote, mediaBytes, movedNote, newNoteFile, noteState, peekNote,
  readDrawingText, readText, writeDrawingText, writeMedia, writeSnapshot, writeText, type NoteState, type Peek,
} from "./wmStore"
import { readEntryHead } from "./zipHead"

export { wroteRecently }

/** What a note is: a `.wm` file. (The sidebar lists nothing else: 2.15.0's `.md` notes are converted on first launch.) */
export const NOTE_EXTENSIONS = [".wm"]

export interface Section {
  path: string
  name: string
  depth: number
  notes: Note[]
  sections: Section[]
}

const isNote = isWmName

// MARK: - Which folder a note belongs to

/** The open project's folders: the owners of the notes under them. Set by the shell when the project changes. */
let projectFolders: string[] = []
export function setProjectFolders(folders: string[]): void {
  // A path from the other kind of machine is not a folder here (project.ts keeps it as written, and it is never read).
  projectFolders = folders.filter((one) => !isForeignPath(one)).map((one) => path.resolve(one))
}

export const sameFolder = (a: string, b: string): boolean => fold(path.resolve(a)) === fold(path.resolve(b))
const under = (folder: string, file: string): boolean => {
  const base = fold(path.resolve(folder)).replace(/[\\/]+$/, "")
  return fold(path.resolve(file)).startsWith(base + path.sep)
}

/**
 * The project folder a note (or a folder) lives under — where its place in the order is kept (the Mac's
 * `owningFolder(for:)`). The folder itself owns itself; a path under none of them goes to `root` if it is under that,
 * else to the project's first folder.
 */
export function ownerOf(file: string, root: string): string {
  const mine = projectFolders.find((one) => sameFolder(one, file) || under(one, file))
  if (mine) return mine
  if (sameFolder(root, file) || under(root, file)) return path.resolve(root)
  return projectFolders[0] ?? path.resolve(root)
}

/** A folder the project is made of: it cannot be moved into another one, renamed from the sidebar or put in the bin from it. */
export const isProjectFolder = (folder: string, root: string): boolean =>
  projectFolders.some((one) => sameFolder(one, folder)) || sameFolder(folder, root)

// MARK: - Order

async function readOrderFile(owner: string): Promise<NoteOrder | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(owner, ORDER_FILE), "utf8")) as NoteOrder
    return parsed && typeof parsed === "object" && parsed.folders && typeof parsed.folders === "object" ? parsed : null
  } catch {
    return null
  }
}

/**
 * A project folder's order. Before folders carried their own, the order of a folder that was not the notes
 * root lived in the root's file under the folder's absolute path; a folder with no file of its own is read
 * from there once.
 */
async function readOrder(owner: string, root: string): Promise<NoteOrder> {
  const own = await readOrderFile(owner)
  if (own) return own
  if (sameFolder(owner, root)) return emptyOrder()
  const home = await readOrderFile(root)
  if (!home) return emptyOrder()
  const clean = (value: string) => fold(value.replace(/\\/g, "/").replace(/\/+$/, ""))
  const prefix = clean(owner)
  const folders: Record<string, string[]> = {}
  for (const [key, names] of Object.entries(home.folders)) {
    const here = clean(key)
    if (here === prefix) folders[""] = names
    else if (here.startsWith(`${prefix}/`)) folders[key.replace(/\\/g, "/").slice(prefix.length + 1)] = names
  }
  return { folders }
}

export async function writeOrder(owner: string, order: NoteOrder): Promise<void> {
  const file = path.join(owner, ORDER_FILE)
  await fs.mkdir(path.dirname(file), { recursive: true })
  remember(file)
  remember(partialOf(file))
  await writeFileAtomic(file, JSON.stringify(order, null, 2))
  remember(file)
}

// MARK: - The tree

const HEAD = 8192
const noteCache = new Map<string, { mtime: number; size: number; note: Note }>()

// MARK: - Trusting the watcher
//
// Every look at the tree used to `stat` every note (500 notes: 18 ms of CPU, 3,000: 130 ms) to find out which had
// moved — and the tree is read after every save. While a live recursive watcher covers a note, "nothing has been
// said about this file" is as good an answer as its mtime: the watcher's events (and our own writes) mark a file
// dirty, a dirty file is looked at again, and the rest come from the cache without a system call. A watcher can
// miss things (a buffer overrun, a network share), so the trust is lent for `REVALIDATE` ms at a time: the first
// look after that is a full one, as it always was.
const watchedRoots = new Set<string>()
const REVALIDATE = 15_000
let validatedAt = 0
let revalidating = true

/** The folders a live recursive watcher covers (the shell sets them when it starts watching; none when it stops). */
export function setWatched(folders: string[]): void {
  watchedRoots.clear()
  for (const folder of folders) watchedRoots.add(keyOf(folder))
  dirtyFiles.clear()
  validatedAt = 0
}

/** The watcher said something happened to this path: the next look at it is a real one. */
export function fileChanged(file: string): void { dirtyFiles.add(keyOf(file)) }

/** The watcher failed, or reported something it could not name: the next look is a full one. */
export function forgetTrust(): void { validatedAt = 0 }

/** Whether a folder (its key, with a closing separator) is under a live watcher. */
const watchedFolder = (folderKey: string): boolean => {
  if (watchedRoots.size === 0) return false
  for (const root of watchedRoots) if (folderKey.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return true
  return false
}

/** Start of a look at the whole tree: whether the trust has run out, so that this one is full. */
function beginLook(): void {
  revalidating = Date.now() - validatedAt > REVALIDATE
}
function endLook(): void {
  if (revalidating) validatedAt = Date.now()
}

/** Opens and reads at once: bounded, so a folder of thousands cannot ask for more handles than the system has. */
const io = limiter(48)

/**
 * A note's row: from the cache while the file has not moved, else the first 8 KB of its `note.mdwm` (the end record,
 * the directory and one inflate: never the whole file).
 */
async function noteAt(full: string, key: string, watched: boolean): Promise<Note> {
  const lent = noteCache.get(full)
  if (lent && watched && !revalidating && !dirtyFiles.has(key)) return lent.note
  dirtyFiles.delete(key)
  const stat = await io(() => fs.stat(full)).catch(() => null)
  const mtime = stat ? stat.mtimeMs : 0
  const size = stat ? stat.size : 0
  const held = noteCache.get(full)
  if (stat && held && held.mtime === mtime && held.size === size) return held.note
  let head = ""
  let read = false
  try {
    const found = await io(() => readEntryHead(full, "note.mdwm", HEAD))
    if (found) { head = found.head.toString("utf8"); read = true }
  } catch { head = "" }
  const note = makeNote(full, mtime, head.charCodeAt(0) === 0xfeff ? head.slice(1) : head)
  // A row made from a head that could not be read has the file's name for a title: it must not be remembered
  // as if it were the note (it was, for as long as the file did not change).
  if (read && stat) noteCache.set(full, { mtime, size, note })
  return note
}

/**
 * Folders INSIDE the project that are kept out of the sidebar and left on
 * disk (`Project.excluded`).
 */
let keptOut: string[] = []
export function setExcluded(folders: string[]): void { keptOut = folders.map((one) => path.resolve(one)) }
const isKeptOut = (folder: string): boolean => {
  const here = path.resolve(folder)
  return keptOut.some((one) => process.platform === "win32" ? one.toLowerCase() === here.toLowerCase() : one === here)
}

/**
 * Read a folder and everything under it. Hidden folders — `.writemind` — are skipped: they are the app's own
 * bookkeeping. `root` is the project folder the order's keys are relative to.
 */
export async function readTree(directory: string, root: string, order: NoteOrder,
  depth = 0): Promise<Section> {
  const entries = await io(() => fs.readdir(directory, { withFileTypes: true })).catch(() => [])
  const notes: Note[] = []
  const sections: Section[] = []
  // (A name has no separator in it, so `path.join(directory, name)` is the directory made tidy once, and the name.)
  const base = path.join(directory, path.sep)
  let keyBase = path.resolve(directory)
  if (!keyBase.endsWith(path.sep)) keyBase += path.sep
  keyBase = fold(keyBase)
  const watched = watchedFolder(keyBase)
  const names = new Map<Note, string>()

  // Every entry is looked at at once, and a note is only READ when its
  // size or time has moved since the last look: the tree is rebuilt on every
  // save and every watcher event, and it used to read every note in full each
  // time. (`io` keeps "at once" to a number the system can bear.)
  const found = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".")) return null
    const full = base + entry.name
    if (entry.isDirectory()) return isKeptOut(full) ? null : await readTree(full, root, order, depth + 1)
    if (isNote(entry.name)) {
      const note = await noteAt(full, keyBase + fold(entry.name), watched)
      names.set(note, entry.name)
      return note
    }
    return null
  }))
  for (const item of found) {
    if (!item) continue
    if ("sections" in item) sections.push(item)
    else notes.push(item)
  }

  // Newest first for anything the order file has never heard of, then the
  // remembered order over the top of it.
  notes.sort((a, b) => b.modified - a.modified)
  sections.sort((a, b) => a.name.localeCompare(b.name))
  const wanted = arrange(order, [...notes.map((note) => names.get(note)!),
    ...sections.map((section) => section.name)], directory, root)
  const where = new Map<string, number>()
  wanted.forEach((name, at) => { if (!where.has(name)) where.set(name, at) })
  const place = (name: string) => where.get(name) ?? wanted.length
  notes.sort((a, b) => place(names.get(a)!) - place(names.get(b)!))
  sections.sort((a, b) => place(a.name) - place(b.name))

  return { path: directory, name: path.basename(directory), depth, notes, sections }
}

export async function tree(root: string): Promise<Section> {
  await fs.mkdir(root, { recursive: true })
  beginLook()
  try { return await readTree(root, root, await readOrder(root, root)) } finally { endLook() }
}

/** How long a folder may take to answer whether it is there. A share that is not reachable takes half a minute. */
const FOLDER_WAIT = 4000

/**
 * The sidebar's tree for a project. One folder is just that folder's tree.
 * Several are a root with no path of its own, holding each folder as a
 * section — the Mac's `store.roots`. Each folder is read with ITS OWN order
 * file (`.writemind/order.json` in it), so a folder that comes from somewhere
 * else brings its arrangement with it. Nothing is written into a folder by
 * adding it to a project.
 */
export async function projectTree(folders: string[], root: string, name: string): Promise<Section> {
  const present: string[] = []
  for (const folder of folders) {
    if (path.resolve(folder) === path.resolve(root)) await fs.mkdir(folder, { recursive: true })
    const stat = await within(FOLDER_WAIT, fs.stat(folder))
    if (stat?.isDirectory()) present.push(folder)
  }
  const read = async (folder: string) => readTree(folder, folder, await readOrder(folder, root), 0)
  beginLook()
  try {
    if (present.length === 1) return await read(present[0]!)
    const sections = await Promise.all(present.map(read))
    return { path: "", name, depth: -1, notes: [], sections }
  } finally { endLook() }
}

/** The names a folder shows, notes then sections, in the order it shows them. */
async function shownNames(owner: string, folder: string, order: NoteOrder):
  Promise<{ notes: string[]; sections: string[] }> {
  const section = await readTree(folder, owner, order)
  return {
    notes: section.notes.map((note) => path.basename(note.path)),
    sections: section.sections.map((one) => one.name),
  }
}

/** The note again beside itself, "… copy": another note (a new identity), and it sits right after the original. */
export async function duplicateNote(root: string, file: string): Promise<string> {
  const folder = path.dirname(file)
  const extension = path.extname(file) || ".wm"
  const base = path.basename(file, extension)
  // (From the file as it is now, never from what the app happens to hold: an external replace would be copied stale.)
  const wm = copyOf(await freshNote(file))
  let copy = ""
  for (let attempt = 0; attempt < 50; attempt++) {
    copy = await uniquePath(folder, `${base} copy`, extension)
    try { await createFile(copy, wm); break } catch (error) {
      if (codeOf(error) !== "EEXIST") throw error
      copy = ""
    }
  }
  if (copy === "") throw new Error("Could not find a free name for a copy of the note")
  // It sits right after the one it came from.
  const owner = ownerOf(folder, root)
  const order = await readOrder(owner, root)
  const { notes, sections } = await shownNames(owner, folder, order)
  const names = notes.filter((name) => name !== path.basename(copy))
  const after = names[names.indexOf(path.basename(file)) + 1] ?? null
  await writeOrder(owner, setOrder(order, [...placing(notes, path.basename(copy), after), ...sections], folder, owner))
  return copy
}

// MARK: - Reading and writing a note

/** The note's text, read afresh from its file (and now the one in front). */
export const readNote = (file: string): Promise<string> => readText(file)

/** The note's words and drawing as the file has them NOW, without the app taking that state as its own (the watcher's look). */
export const peekNoteFile = (file: string): Promise<Peek> => peekNote(file)

/** The page applied what `peekNoteFile` returned: the app owns that state of the file now (only if it is still the file's). */
export const adoptNoteFile = (file: string, token: string): Promise<boolean> => adoptNote(file, token)

/** Whether the app may write this note: false for a file of a newer format (it is open read-only). */
export const noteInfo = (file: string): Promise<NoteState> => noteState(file)

/**
 * The save of the note's text. The app owns the file only while the bytes on disk are the bytes it last read or wrote
 * (wmStore.ts: the SHA-256 of the whole file), and anything else means another writer whose work is not ours to throw
 * away; the archive is written beside and renamed over it, so a crash, a power cut or a sync client reading mid-save
 * sees the whole old note or the whole new one. The text and the drawing and the snapshots are one file, one queue.
 */
export async function writeNote(file: string, text: string):
  Promise<{ written: boolean; onDisk: string | null; readOnly?: boolean }> {
  const out = await writeText(file, text)
  return { written: out.written, onDisk: out.onDisk, ...(out.refused === "newer" || out.refused === "unwritable" ? { readOnly: true } : {}) }
}

/** A name nothing else in the folder has. */
export async function uniquePath(folder: string, base: string, extension: string): Promise<string> {
  let name = `${base}${extension}`
  let count = 2
  while (true) {
    try {
      await fs.access(path.join(folder, name))
      name = `${base} ${count}${extension}`
      count += 1
    } catch {
      return path.join(folder, name)
    }
  }
}

export async function createNote(folder: string, base = "Untitled"): Promise<string> {
  await fs.mkdir(folder, { recursive: true })
  // Never over a file that appeared since the name was looked for (`createFile` links, and EEXIST says it is taken).
  for (let attempt = 0; attempt < 50; attempt++) {
    const file = await uniquePath(folder, base, ".wm")
    try {
      await createFile(file, newNoteFile(""))
      return file
    } catch (error) {
      if (codeOf(error) !== "EEXIST") throw error
    }
  }
  throw new Error("Could not find a free name for a new note")
}

export async function createSection(parent: string, base = "New Section"): Promise<string> {
  const folder = await uniquePath(parent, base, "")
  await fs.mkdir(folder, { recursive: true })
  return folder
}

/** One name in a folder's order is another (a note renamed keeps its place). */
async function renameInOrder(root: string, folder: string, from: string, to: string): Promise<void> {
  const owner = ownerOf(folder, root)
  const order = await readOrder(owner, root)
  const key = orderKey(folder, owner)
  const names = order.folders[key]
  if (!names?.includes(from)) return
  await writeOrder(owner, setOrder(order, names.map((one) => (one === from ? to : one)), folder, owner))
}

/**
 * Rename a note: the file keeps its extension (`.wm`), and it keeps its place in the order (the Mac's `rename`). The
 * name is made fit for the disk first (`fileNames.ts`). Its drawing and pictures are inside it and go with it.
 */
export async function renameNote(root: string, file: string, title: string): Promise<string> {
  const folder = path.dirname(file)
  const extension = path.extname(file) || ".wm"
  const clean = safeName(title, { folder, extension }) || "Untitled"
  if (clean === path.basename(file, path.extname(file))) return file
  const next = await uniquePath(folder, clean, extension)
  await fs.rename(file, next)
  movedNote(file, next)
  await renameInOrder(root, folder, path.basename(file), path.basename(next))
  return next
}

// MARK: - The drawing and the pictures, inside the note

/** The page asks for a note's drawing when it opens the note: that note is the one in front. */
export const readDrawing = (_root: string, note: string): Promise<string | null> => readDrawingText(note)

export const writeDrawing = (_root: string, note: string, json: string): Promise<void> => writeDrawingText(note, json)

/**
 * A picture put on the drawing layer: bytes in, an entry `media/<hash>.<ext>` of the note's `.wm` out (the note the
 * page names, else the one in front). The same picture twice is one entry: the name IS its contents.
 */
export async function saveMedia(_root: string, bytes: Uint8Array, extension: string, note?: string | null):
Promise<{ file: string }> {
  const target = note ?? frontNote()
  if (!target) throw new Error("No note is open to put the picture in")
  return writeMedia(target, bytes, extension)
}

/**
 * An ink cell's snapshot, `snapshots/ink-<id>.svg` of the note: the picture its text line points at. Written over in
 * place (it is a derived picture), or left alone when `onlyIfMissing` and it is there (a note being opened). The id
 * must be a UUID: nothing else can name an entry here.
 */
export async function saveInkSnapshot(_root: string, note: string, id: string, svg: string, onlyIfMissing = false):
Promise<{ file: string }> {
  return writeSnapshot(note, id, svg, onlyIfMissing)
}

// MARK: - Pictures by name, as files

/**
 * A picture of a note is an entry of its archive, and the things that read pictures as FILES (the page's `<img>`
 * through `wm://`, the readers of words in a picture, the Wolfram export, the printer) are handed a copy of it in a
 * folder of the system's temporary files, named by what is in it (so one name is never two pictures there).
 */
const cacheRoot = path.join(os.tmpdir(), "WriteMind-media")
const made = new WeakMap<Uint8Array, string>()
/** Where pictures have been put as files, by name. */
const found = new Map<string, string>()

const missing = (name: string): string => path.join(cacheRoot, "missing", path.basename(name))

/**
 * A picture written out ONCE however many ask for it at once (a page asks for the same picture from several places in one
 * breath): the asks share one write, and each write goes through a part file of its own name before it is renamed in.
 */
const writing = new Map<string, Promise<void>>()
let parts = 0
function writeOut(where: string, bytes: Uint8Array): Promise<void> {
  let job = writing.get(where)
  if (!job) {
    job = (async () => {
      await fs.mkdir(path.dirname(where), { recursive: true })
      const partial = `${where}.${process.pid}-${parts++}.part`
      try {
        await fs.writeFile(partial, bytes)
        await fs.rename(partial, where)
      } catch (error) {
        await fs.rm(partial, { force: true }).catch(() => undefined)
        // (somebody else's copy of the same bytes is as good)
        if (!(await fs.access(where).then(() => true, () => false))) throw error
      }
    })().finally(() => { writing.delete(where) })
    writing.set(where, job)
  }
  return job
}

/**
 * The picture's file: the entry `name` of the note's container (`note`, else the one in front, else any note the app has
 * read) written out once; a path that is not there when no note has it.
 */
export async function findMedia(_root: string, file: string, note?: string | null): Promise<string> {
  const name = path.basename(file)
  const bytes = mediaBytes(name, note)
  if (!bytes) return found.get(name) && await fs.access(found.get(name)!).then(() => true, () => false) ? found.get(name)! : missing(name)
  let where = made.get(bytes)
  if (!where || !(await fs.access(where).then(() => true, () => false))) {
    const stamp = createHash("sha1").update(bytes).digest("hex").slice(0, 16)
    where = path.join(cacheRoot, stamp, name)
    if (!(await fs.access(where).then(() => true, () => false))) await writeOut(where, bytes)
    made.set(bytes, where)
  }
  found.set(name, where)
  return where
}

/** The same, for the places that cannot wait: what has been written out, else a path that is not there. Warm it with `findMedia`. */
export const mediaPath = (_root: string, file: string): string => found.get(path.basename(file)) ?? missing(file)

/** The copies a day old are taken away at launch (they are copies). */
export async function sweepMediaCache(now = Date.now()): Promise<void> {
  const entries = await fs.readdir(cacheRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(cacheRoot, entry.name)
    const stat = await fs.stat(full).catch(() => null)
    if (stat && now - stat.mtimeMs > 24 * 3600 * 1000) await fs.rm(full, { recursive: true, force: true }).catch(() => undefined)
  }
}

// MARK: - Moving rows

/** Every note under a folder, so a moved section can tell the store its notes moved. */
async function notesUnder(folder: string): Promise<string[]> {
  const entries = await io(() => fs.readdir(folder, { withFileTypes: true })).catch(() => [])
  const list: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) list.push(...await notesUnder(full))
    else if (isNote(entry.name)) list.push(full)
  }
  return list
}

/**
 * Drop a note onto a row: into that row's folder if it is somewhere else,
 * and then into that row's PLACE in the order (`before` is the row's file
 * name; null means the end of the folder's notes). A drag within one folder
 * is only the second. Returns where the note ended up.
 */
export async function placeNote(root: string, file: string, targetFolder: string,
  before: string | null): Promise<string> {
  const from = path.dirname(file)
  const toOwner = ownerOf(targetFolder, root)
  let order = await readOrder(toOwner, root)
  let landed = file
  if (path.resolve(from) !== path.resolve(targetFolder)) {
    const destination = await uniquePath(targetFolder, path.basename(file, path.extname(file)),
      path.extname(file) || ".wm")
    await fs.mkdir(targetFolder, { recursive: true })
    await fs.rename(file, destination)
    movedNote(file, destination)
    const fromOwner = ownerOf(from, root)
    if (sameFolder(fromOwner, toOwner)) order = forget(order, path.basename(file), from, toOwner)
    else {
      // Another project folder: the place it left is forgotten in THAT folder's file.
      const left = await readOrder(fromOwner, root)
      const forgotten = forget(left, path.basename(file), from, fromOwner)
      if (forgotten !== left) await writeOrder(fromOwner, forgotten)
    }
    landed = destination
  }
  const { notes, sections } = await shownNames(toOwner, targetFolder, order)
  const name = path.basename(landed)
  await writeOrder(toOwner, setOrder(order, [...placing(notes, name, before), ...sections], targetFolder, toOwner))
  return landed
}

/** Move a section inside another one, refusing to put it inside itself. */
export async function moveSection(root: string, folder: string, targetFolder: string):
  Promise<string | null> {
  if (isProjectFolder(folder, root)) return null
  if (isInside(targetFolder, folder)) return null
  const from = path.dirname(folder)
  if (path.resolve(from) === path.resolve(targetFolder)) return null
  const notes = await notesUnder(folder)
  const destination = await uniquePath(targetFolder, path.basename(folder), "")
  await fs.mkdir(targetFolder, { recursive: true })
  await fs.rename(folder, destination)
  for (const note of notes) movedNote(note, path.join(destination, path.relative(folder, note)))
  const fromOwner = ownerOf(from, root)
  const toOwner = ownerOf(targetFolder, root)
  if (sameFolder(fromOwner, toOwner)) {
    let order = forget(await readOrder(toOwner, root), path.basename(folder), from, toOwner)
    order = setOrder(order, appending(order.folders[orderKey(targetFolder, toOwner)] ?? [], path.basename(destination)),
      targetFolder, toOwner)
    await writeOrder(toOwner, order)
  } else {
    const left = await readOrder(fromOwner, root)
    const forgotten = forget(left, path.basename(folder), from, fromOwner)
    if (forgotten !== left) await writeOrder(fromOwner, forgotten)
    const order = await readOrder(toOwner, root)
    await writeOrder(toOwner, setOrder(order,
      appending(order.folders[orderKey(targetFolder, toOwner)] ?? [], path.basename(destination)), targetFolder, toOwner))
  }
  return destination
}

// MARK: - The session

export const sessionFile = (userData: string, root: string): string =>
  path.join(userData, "sessions", sessionFileName(path.resolve(root)))

export async function readSessionText(userData: string, root: string): Promise<string | null> {
  return fs.readFile(sessionFile(userData, root), "utf8").catch(() => null)
}

export async function writeSessionText(userData: string, root: string, json: string): Promise<void> {
  const file = sessionFile(userData, root)
  await fs.mkdir(path.dirname(file), { recursive: true })
  // Written beside and renamed over, so a crash mid-write cannot leave half a session.
  await writeFileAtomic(file, json)
}

/** Which of these files are still there — the session drops the ones that are not. */
export async function existing(files: string[]): Promise<string[]> {
  const present: string[] = []
  for (const file of files) {
    try { await fs.access(file); present.push(file) } catch { /* gone */ }
  }
  return present
}

/** Order, kept honest when a row is dragged. */
export async function reorder(root: string, folder: string, names: string[]): Promise<void> {
  const owner = ownerOf(folder, root)
  await writeOrder(owner, setOrder(await readOrder(owner, root), names, folder, owner))
}

/**
 * Rename a section: the folder is renamed on disk ("This renames the folder on disk"), every note inside goes with
 * it (a note's drawing is inside the note), and the folder keeps its place in its parent's order. A name another
 * folder already has becomes "name 2". Returns the folder's new path, the same path when nothing changes, or null
 * for a name that cannot be used. The name is made fit for the disk first (`fileNames.ts`).
 */
export async function renameSection(root: string, folder: string, name: string): Promise<string | null> {
  const parent = path.dirname(folder)
  const clean = safeName(name, { folder: parent })
  if (!clean) return null
  if (isProjectFolder(folder, root)) return null
  if (clean === path.basename(folder)) return folder
  const notes = await notesUnder(folder)
  const destination = await uniquePath(parent, clean, "")
  await fs.rename(folder, destination)
  for (const note of notes) movedNote(note, path.join(destination, path.relative(folder, note)))
  await renameInOrder(root, parent, path.basename(folder), path.basename(destination))
  return destination
}

