/**
 * The notes folder, on disk. Ported from `NoteStore` and `NoteTree` — the
 * half of them that is filesystem work, which is all that was left once the
 * rules moved into `@writemind/core`.
 *
 * A SECTION IS A FOLDER. The sidebar tree is the folder tree under the notes
 * directory, so a note moved in WriteMind is moved in Explorer or Finder and
 * the other way round. Nothing is invented and nothing is a database.
 *
 * WHERE A NOTE'S OTHER FILES LIVE. Each project folder keeps its own
 * bookkeeping in two hidden folders, as on the Mac (`owningFolder(for:)`):
 * `.writemind/order.json` is the order its rows were dragged into (the Mac's
 * file, key for key), and `.drawings` holds the drawing of every note under it
 * and, in `.drawings/media`, the pictures those drawings use. So a folder
 * carries its drawings and its arrangement with it — copied to another
 * machine, moved, put on a stick, added to another project — and nothing about
 * a note's place in the file system (the drive, a folder renamed above it, the
 * Documents folder moved to OneDrive) changes where its drawing is looked for.
 *
 * A note's drawing is `.drawings/<stem>-<hash of its path RELATIVE to the
 * project folder>.json`. The hash is what two notes of one name in two
 * sections do not share (the Mac names it `<stem>.json` and they do), and it is
 * of the relative path so that the folder can be anywhere. Three older places
 * are still read, in this order: the app's own notes root with the absolute-path
 * hash (before drawings travelled; the next save moves the drawing and takes
 * the old file away), and the Mac's `<stem>.json`, converted from the Mac's
 * spelling (`macDrawing.ts`) and NEVER written.
 */

import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import {
  appending, arrange, emptyOrder, forget, inkFileName, isInkId, isInside, makeNote, mayWrite, mediaFiles, ORDER_FILE,
  orderKey, placing, sessionFileName, setOrder,
  type Note, type NoteOrder,
} from "@writemind/core"
import { codeOf, limiter, partialOf, within, writeFileAtomic } from "./atomic"
import { safeName } from "./fileNames"
import { fromMacDrawing, pictureFiles } from "./macDrawing"
import { isForeignPath } from "./project"

export const NOTE_EXTENSIONS = [".md", ".markdown", ".txt"]

export interface Section {
  path: string
  name: string
  depth: number
  notes: Note[]
  sections: Section[]
}

const isNote = (name: string): boolean => {
  const dot = name.lastIndexOf(".")
  return dot > 0 && NOTE_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

// MARK: - Which folder a note belongs to

/** The open project's folders: the owners of the notes under them. Set by the shell when the project changes. */
let projectFolders: string[] = []
export function setProjectFolders(folders: string[]): void {
  // A path from the other kind of machine is not a folder here (project.ts keeps it as written, and it is never read).
  projectFolders = folders.filter((one) => !isForeignPath(one)).map((one) => path.resolve(one))
}

const fold = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value)
export const sameFolder = (a: string, b: string): boolean => fold(path.resolve(a)) === fold(path.resolve(b))
const under = (folder: string, file: string): boolean => {
  const base = fold(path.resolve(folder)).replace(/[\\/]+$/, "")
  return fold(path.resolve(file)).startsWith(base + path.sep)
}

/**
 * The project folder a note (or a folder) lives under — where its drawing and its place in the order are kept
 * (the Mac's `owningFolder(for:)`). The folder itself owns itself; a path under none of them goes to `root`
 * if it is under that, else to the project's first folder.
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
const dirtyFiles = new Set<string>()
const REVALIDATE = 15_000
let validatedAt = 0
let revalidating = true
const keyOf = (file: string): string => fold(path.resolve(file))

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

/** A note's row: from the cache while the file has not moved, else its first 8 KB. */
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
    head = await io(async () => {
      const handle = await fs.open(full, "r")
      try {
        const buffer = Buffer.alloc(Math.min(HEAD, Math.max(size, 1)))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return buffer.toString("utf8", 0, bytesRead)
      } finally { await handle.close() }
    })
    read = true
  } catch { head = "" }
  const note = makeNote(full, mtime, head)
  // A row made from a head that could not be read has the file's name for a title: it must not be remembered
  // as if it were the note (it was, for as long as the file did not change).
  if (read && stat) noteCache.set(full, { mtime, size, note })
  return note
}

/** Files this process wrote a moment ago, so the watcher can ignore its own echo. */
const wrote = new Map<string, number>()
const remember = (file: string) => {
  const now = Date.now()
  wrote.set(path.resolve(file), now)
  dirtyFiles.add(keyOf(file))
  // (Only the last few seconds matter; a long session must not keep every file it ever wrote.)
  if (wrote.size > 64) for (const [key, at] of wrote) if (now - at > 5000) wrote.delete(key)
}
export function wroteRecently(file: string, ms = 800): boolean {
  const now = Date.now()
  const target = path.resolve(file)
  const at = wrote.get(target)
  if (at !== undefined && now - at < ms) return true
  // A write inside a folder is also an event for the FOLDER (Windows reports the directory whose entry changed),
  // and that echo used to read the whole tree, the note and its drawing again after every save of a note in a section.
  const inside = target + path.sep
  for (const [key, when] of wrote) if (now - when < ms && key.startsWith(inside)) return true
  return false
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
 * Read a folder and everything under it. Hidden folders — `.drawings`,
 * `.writemind` — are skipped: they are the app's own bookkeeping.
 * `root` is the project folder the order's keys are relative to.
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

/** The note again beside itself, "… copy", with its drawing and its place in the order. */
export async function duplicateNote(root: string, file: string): Promise<string> {
  const folder = path.dirname(file)
  const extension = path.extname(file) || ".md"
  const base = path.basename(file, extension)
  const copy = await uniquePath(folder, `${base} copy`, extension)
  await fs.copyFile(file, copy)
  known.set(copy, await fs.readFile(copy, "utf8"))
  const sidecar = await loadSidecar(root, file)
  if (sidecar !== null) await storeSidecar(root, copy, sidecar)
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

/** What the app last read or wrote, per file — the other half of `mayWrite`. */
const known = new Map<string, string>()

export async function readNote(file: string): Promise<string> {
  const text = await fs.readFile(file, "utf8")
  known.set(file, text)
  return text
}

/**
 * The save. It asks `mayWrite` first: the app owns the file only while the
 * bytes on disk are the bytes it last read or wrote, and anything else means
 * another writer whose work is not ours to throw away. The bytes go to a file
 * beside and are renamed over it (`atomic.ts`), so a crash, a power cut or a
 * sync client reading mid-save sees the whole old note or the whole new one,
 * never a cut-off one.
 */
export async function writeNote(file: string, text: string):
  Promise<{ written: boolean; onDisk: string | null }> {
  const onDisk = await fs.readFile(file, "utf8").catch(() => null)
  if (!mayWrite(onDisk, known.get(file) ?? null)) return { written: false, onDisk }
  await fs.mkdir(path.dirname(file), { recursive: true })
  remember(file)
  remember(partialOf(file))
  await writeFileAtomic(file, text)
  remember(file)
  known.set(file, text)
  return { written: true, onDisk: text }
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
  // `wx`: never over a file that appeared since the name was looked for.
  for (let attempt = 0; attempt < 50; attempt++) {
    const file = await uniquePath(folder, base, ".md")
    try {
      await fs.writeFile(file, "", { encoding: "utf8", flag: "wx" })
      known.set(file, "")
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
 * Rename a note: the file keeps its extension, its drawing goes with it, and it keeps its place in the order
 * (the Mac's `rename`). The name is made fit for the disk first (`fileNames.ts`).
 */
export async function renameNote(root: string, file: string, title: string): Promise<string> {
  const folder = path.dirname(file)
  const extension = path.extname(file) || ".md"
  const clean = safeName(title, { folder, extension }) || "Untitled"
  if (clean === path.basename(file, path.extname(file))) return file
  const next = await uniquePath(folder, clean, extension)
  await fs.rename(file, next)
  const text = known.get(file)
  known.delete(file)
  if (text !== undefined) known.set(next, text)
  await moveSidecar(root, file, next)
  await renameInOrder(root, folder, path.basename(file), path.basename(next))
  return next
}

// MARK: - The drawing, beside the note

const sha = (value: string, length: number): string =>
  createHash("sha1").update(value).digest("hex").slice(0, length)
const stemOf = (note: string): string => path.basename(note, path.extname(note))

/** `.drawings/<stem>-<hash of the path from the project folder>.json`, in the project folder the note is under. */
export function drawingPath(root: string, note: string): string {
  const owner = ownerOf(note, root)
  const relative = path.relative(owner, note).replace(/\\/g, "/")
  return path.join(owner, ".drawings", `${stemOf(note)}-${sha(relative, 12)}.json`)
}

/** Where the drawing was kept before it travelled with its folder: the notes root, hashed by the absolute path. */
const olderDrawingPath = (root: string, note: string): string =>
  path.join(root, ".drawings", `${stemOf(note)}-${sha(note, 12)}.json`)

/** The Mac's: `<stem>.json`, in the project folder. Read, converted, never written. */
const macDrawingPath = (root: string, note: string): string =>
  path.join(ownerOf(note, root), ".drawings", `${stemOf(note)}.json`)

/** The note whose drawing is in front: where a picture goes when the page does not say. */
let front: string | null = null

async function loadSidecar(root: string, note: string): Promise<string | null> {
  for (const file of [drawingPath(root, note), olderDrawingPath(root, note)]) {
    const text = await fs.readFile(file, "utf8").catch(() => null)
    if (text !== null) return text
  }
  const mac = await fs.readFile(macDrawingPath(root, note), "utf8").catch(() => null)
  return mac === null ? null : fromMacDrawing(mac)
}

/** The page asks for a note's drawing when it opens the note: that note is the one in front. */
export async function readDrawing(root: string, note: string): Promise<string | null> {
  front = note
  return loadSidecar(root, note)
}

export async function writeDrawing(root: string, note: string, json: string): Promise<void> {
  front = note
  await storeSidecar(root, note, json)
}

async function storeSidecar(root: string, note: string, json: string): Promise<void> {
  const file = drawingPath(root, note)
  await fs.mkdir(path.dirname(file), { recursive: true })
  remember(file)
  remember(partialOf(file))
  await writeFileAtomic(file, json)
  remember(file)
  // The older place is stale now, and would be read again if this one were ever taken away.
  const older = olderDrawingPath(root, note)
  if (older !== file) {
    remember(older)
    await fs.rm(older, { force: true }).catch(() => undefined)
  }
}

/** The pictures a drawing uses go to `owner`'s media folder, from wherever they are found. */
async function bringPictures(root: string, json: string, owner: string, more: string[] = []): Promise<void> {
  // The sidecar's pictures (floating ones, ink cells' snapshots and the pictures inside cells: `pictureFiles`) and
  // the files the note's markdown names (picture cells, ink cells' snapshots, inline pictures: `mediaFiles`).
  for (const name of new Set([...pictureFiles(json), ...more])) {
    const to = path.join(owner, ".drawings", "media", path.basename(name))
    if (await fs.access(to).then(() => true, () => false)) continue
    const from = await findMedia(root, name)
    if (from === to || !(await fs.access(from).then(() => true, () => false))) continue
    await fs.mkdir(path.dirname(to), { recursive: true })
    remember(to)
    await fs.copyFile(from, to).catch(() => undefined)
  }
}

/**
 * The drawing is the note's other half: it goes where the note goes — under the new name, in the new project
 * folder, with its pictures if the folder is another. The old sidecars are taken away; the Mac's file, which
 * is not ours, stays.
 */
async function moveSidecar(root: string, from: string, to: string): Promise<void> {
  const text = await loadSidecar(root, from)
  const fromOwner = ownerOf(from, root)
  const toOwner = ownerOf(to, root)
  // A note with no drawing can still have docked pictures and ink cells (docs\PLAN-docking-ink-cells.md (f)).
  if (!sameFolder(fromOwner, toOwner)) {
    const markdown = await fs.readFile(to, "utf8").catch(() => "")
    await bringPictures(root, text ?? "", toOwner, mediaFiles(markdown))
  }
  if (text === null) return
  const target = drawingPath(root, to)
  const source = drawingPath(root, from)
  if (source === target) return
  await storeSidecar(root, to, text)
  for (const old of [source, olderDrawingPath(root, from)]) {
    if (old === target) continue
    remember(old)
    await fs.rm(old, { force: true }).catch(() => undefined)
  }
}

// MARK: - Pictures

/**
 * A picture put on the drawing layer: bytes in, a file in `.drawings/media`
 * of the note's project folder out. The media folder is the app's own
 * bookkeeping — hidden, beside the notes.
 */
export async function saveMedia(root: string, bytes: Uint8Array, extension: string, note?: string | null):
Promise<{ file: string }> {
  const owner = ownerOf(note ?? front ?? path.join(projectFolders[0] ?? root, "x"), root)
  const folder = path.join(owner, ".drawings", "media")
  await fs.mkdir(folder, { recursive: true })
  const stamp = createHash("sha1").update(bytes).digest("hex").slice(0, 16)
  const file = `${stamp}${extension.startsWith(".") ? extension : `.${extension}`}`
  const where = path.join(folder, file)
  // The same picture pasted twice is one file: the name IS its contents.
  try {
    await fs.access(where)
  } catch {
    remember(where)
    await writeFileAtomic(where, bytes)
  }
  found.set(file, where)
  return { file }
}

/**
 * An ink cell's snapshot, `ink-<id>.svg` in the media folder of `note`'s project folder (docs\PLAN-docking-ink-cells.md
 * (f)): the svg its markdown line points at, so any markdown viewer (and the Mac) shows the cell. The only media file
 * ever written over in place (`saveMedia` names are content hashes and never start with `ink-`). `onlyIfMissing`
 * leaves a file that is there alone (a note being opened). The id must be a UUID: nothing else can name a file here.
 */
export async function saveInkSnapshot(root: string, note: string, id: string, svg: string, onlyIfMissing = false):
Promise<{ file: string }> {
  if (!isInkId(id)) throw new Error(`not an ink cell id: ${id}`)
  if (!/^<svg[\s>]/.test(svg)) throw new Error("not an svg")
  const owner = ownerOf(note, root)
  const folder = path.join(owner, ".drawings", "media")
  const file = inkFileName(id.toLowerCase())
  const where = path.join(folder, file)
  if (onlyIfMissing && await fs.access(where).then(() => true, () => false)) {
    found.set(file, where)
    return { file }
  }
  await fs.mkdir(folder, { recursive: true })
  remember(where)
  remember(partialOf(where))
  await writeFileAtomic(where, svg)
  remember(where)
  found.set(file, where)
  return { file }
}

/** Where pictures have been found, by name (the name is the picture's hash or a Mac UUID: it is the same file wherever it is). */
const found = new Map<string, string>()

const mediaCandidates = (root: string, file: string): string[] => {
  const name = path.basename(file)
  const seen = new Set<string>()
  const out: string[] = []
  for (const folder of [...projectFolders, path.resolve(root)]) {
    const one = path.join(folder, ".drawings", "media", name)
    if (!seen.has(fold(one))) { seen.add(fold(one)); out.push(one) }
  }
  return out
}

/**
 * The picture's file: in the media folder of whichever project folder has it (a note's picture is where its
 * drawing's folder is, and a Mac notebook's are in the Mac's own `.drawings/media`), else the notes root's —
 * where pictures were kept before folders carried their own.
 */
export async function findMedia(root: string, file: string): Promise<string> {
  const name = path.basename(file)
  const known_ = found.get(name)
  if (known_ && await fs.access(known_).then(() => true, () => false)) return known_
  const candidates = mediaCandidates(root, file)
  for (const one of candidates) {
    // A share that is not reachable must not hold a picture up for half a minute.
    if (await within(FOLDER_WAIT, fs.access(one).then(() => true))) {
      found.set(name, one)
      return one
    }
  }
  return path.join(path.resolve(root), ".drawings", "media", name)
}

/** The same, for the places that cannot wait: what has been found, else the notes root's. Warm it with `findMedia`. */
export const mediaPath = (root: string, file: string): string =>
  found.get(path.basename(file)) ?? path.join(root, ".drawings", "media", path.basename(file))

// MARK: - Moving rows

/** Every note under a folder, so a section's sidecars can follow it. */
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
      path.extname(file) || ".md")
    await fs.mkdir(targetFolder, { recursive: true })
    await fs.rename(file, destination)
    await moveSidecar(root, file, destination)
    const text = known.get(file)
    known.delete(file)
    if (text !== undefined) known.set(destination, text)
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
  for (const note of notes) {
    const moved = path.join(destination, path.relative(folder, note))
    await moveSidecar(root, note, moved)
    const text = known.get(note)
    known.delete(note)
    if (text !== undefined) known.set(moved, text)
  }
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
 * Rename a section: the folder is renamed on disk ("This renames the folder on disk"), every note inside keeps
 * its drawing (the sidecar is named from the note's path, which just changed), and the folder keeps its place in
 * its parent's order. A name another folder already has becomes "name 2". Returns the folder's new path, the
 * same path when nothing changes, or null for a name that cannot be used. The name is made fit for the disk
 * first (`fileNames.ts`).
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
  for (const note of notes) {
    const moved = path.join(destination, path.relative(folder, note))
    await moveSidecar(root, note, moved)
    const text = known.get(note)
    known.delete(note)
    if (text !== undefined) known.set(moved, text)
  }
  await renameInOrder(root, parent, path.basename(folder), path.basename(destination))
  return destination
}
