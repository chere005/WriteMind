/**
 * The notes folder, on disk. Ported from `NoteStore` and `NoteTree` — the
 * half of them that is filesystem work, which is all that was left once the
 * rules moved into `@writemind/core`.
 *
 * A SECTION IS A FOLDER. The sidebar tree is the folder tree under the notes
 * directory, so a note moved in WriteMind is moved in Explorer or Finder and
 * the other way round. Nothing is invented and nothing is a database.
 */

import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import {
  appending, arrange, emptyOrder, forget, isInside, makeNote, mayWrite, ORDER_FILE, orderKey, placing,
  sessionFileName, setOrder,
  type Note, type NoteOrder,
} from "@writemind/core"

export const NOTE_EXTENSIONS = [".md", ".markdown", ".txt"]

export interface Section {
  path: string
  name: string
  depth: number
  notes: Note[]
  sections: Section[]
}

const isNote = (name: string): boolean =>
  NOTE_EXTENSIONS.includes(path.extname(name).toLowerCase())

async function readOrder(root: string): Promise<NoteOrder> {
  try {
    const raw = await fs.readFile(path.join(root, ORDER_FILE), "utf8")
    const parsed = JSON.parse(raw) as NoteOrder
    return parsed.folders ? parsed : emptyOrder()
  } catch {
    return emptyOrder()
  }
}

export async function writeOrder(root: string, order: NoteOrder): Promise<void> {
  const file = path.join(root, ORDER_FILE)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(order, null, 2), "utf8")
}

const HEAD = 8192
const noteCache = new Map<string, { mtime: number; size: number; note: Note }>()

/** A note's row: from the cache while the file has not moved, else its first 8 KB. */
async function noteAt(full: string): Promise<Note> {
  const stat = await fs.stat(full).catch(() => null)
  const mtime = stat ? stat.mtimeMs : 0
  const size = stat ? stat.size : 0
  const held = noteCache.get(full)
  if (held && held.mtime === mtime && held.size === size) return held.note
  let head = ""
  try {
    const handle = await fs.open(full, "r")
    try {
      const buffer = Buffer.alloc(Math.min(HEAD, Math.max(size, 1)))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      head = buffer.toString("utf8", 0, bytesRead)
    } finally { await handle.close() }
  } catch { head = "" }
  const note = makeNote(full, mtime, head)
  noteCache.set(full, { mtime, size, note })
  return note
}

/** Files this process wrote a moment ago, so the watcher can ignore its own echo. */
const wrote = new Map<string, number>()
const remember = (file: string) => { wrote.set(path.resolve(file), Date.now()) }
export function wroteRecently(file: string, within = 800): boolean {
  const at = wrote.get(path.resolve(file))
  return at !== undefined && Date.now() - at < within
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
 */
export async function readTree(directory: string, root: string, order: NoteOrder,
  depth = 0): Promise<Section> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const notes: Note[] = []
  const sections: Section[] = []

  // Every entry is looked at at once, and a note is only READ when its
  // size or time has moved since the last look: the tree is rebuilt on every
  // save and every watcher event, and it used to read every note in full each
  // time.
  const found = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".")) return null
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return isKeptOut(full) ? null : await readTree(full, root, order, depth + 1)
    if (isNote(entry.name)) return await noteAt(full)
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
  const wanted = arrange(order, [...notes.map((note) => path.basename(note.path)),
    ...sections.map((section) => section.name)], directory, root)
  const place = (name: string) => {
    const at = wanted.indexOf(name)
    return at < 0 ? wanted.length : at
  }
  notes.sort((a, b) => place(path.basename(a.path)) - place(path.basename(b.path)))
  sections.sort((a, b) => place(a.name) - place(b.name))

  return { path: directory, name: path.basename(directory), depth, notes, sections }
}

export async function tree(root: string): Promise<Section> {
  await fs.mkdir(root, { recursive: true })
  return readTree(root, root, await readOrder(root))
}

/**
 * The sidebar's tree for a project. One folder is just that folder's tree.
 * Several are a root with no path of its own, holding each folder as a
 * section — the Mac's `store.roots`. The order file and the sidecars stay in
 * the app's own notes root even for a foreign folder (`orderKey` gives such a
 * folder its absolute path), so adding a folder to a project writes nothing
 * into it.
 */
export async function projectTree(folders: string[], root: string, name: string): Promise<Section> {
  const order = await readOrder(root)
  const present: string[] = []
  for (const folder of folders) {
    if (path.resolve(folder) === path.resolve(root)) await fs.mkdir(folder, { recursive: true })
    if ((await fs.stat(folder).catch(() => null))?.isDirectory()) present.push(folder)
  }
  if (present.length === 1) return readTree(present[0]!, root, order)
  const sections = await Promise.all(present.map((folder) => readTree(folder, root, order, 0)))
  return { path: "", name, depth: -1, notes: [], sections }
}

/** The note again beside itself, "… copy", with its drawing and its place in the order. */
export async function duplicateNote(root: string, file: string): Promise<string> {
  const folder = path.dirname(file)
  const extension = path.extname(file) || ".md"
  const base = path.basename(file, extension)
  const copy = await uniquePath(folder, `${base} copy`, extension)
  await fs.copyFile(file, copy)
  known.set(copy, await fs.readFile(copy, "utf8"))
  const sidecar = await readDrawing(root, file)
  if (sidecar !== null) await writeDrawing(root, copy, sidecar)
  // It sits right after the one it came from.
  const order = await readOrder(root)
  const { notes, sections } = await shownNames(root, folder, order)
  const names = notes.filter((name) => name !== path.basename(copy))
  const after = names[names.indexOf(path.basename(file)) + 1] ?? null
  await writeOrder(root, setOrder(order, [...placing(notes, path.basename(copy), after), ...sections], folder, root))
  return copy
}

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
 * another writer whose work is not ours to throw away.
 */
export async function writeNote(file: string, text: string):
  Promise<{ written: boolean; onDisk: string | null }> {
  const onDisk = await fs.readFile(file, "utf8").catch(() => null)
  if (!mayWrite(onDisk, known.get(file) ?? null)) return { written: false, onDisk }
  await fs.mkdir(path.dirname(file), { recursive: true })
  remember(file)
  await fs.writeFile(file, text, "utf8")
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
  const file = await uniquePath(folder, base, ".md")
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(file, "", "utf8")
  known.set(file, "")
  return file
}

export async function createSection(parent: string, base = "New Section"): Promise<string> {
  const folder = await uniquePath(parent, base, "")
  await fs.mkdir(folder, { recursive: true })
  return folder
}

export async function renameNote(file: string, title: string): Promise<string> {
  const folder = path.dirname(file)
  const clean = title.replace(/[/:\\]/g, "-").trim() || "Untitled"
  if (clean === path.basename(file, path.extname(file))) return file
  const next = await uniquePath(folder, clean, path.extname(file) || ".md")
  await fs.rename(file, next)
  const text = known.get(file)
  known.delete(file)
  if (text !== undefined) known.set(next, text)
  return next
}

/** The sidecar beside the note: the drawing, which is never part of the file. */
export function drawingPath(root: string, note: string): string {
  const stamp = createHash("sha1").update(note).digest("hex").slice(0, 12)
  return path.join(root, ".drawings", `${path.basename(note, path.extname(note))}-${stamp}.json`)
}

export async function readDrawing(root: string, note: string): Promise<string | null> {
  return fs.readFile(drawingPath(root, note), "utf8").catch(() => null)
}

export async function writeDrawing(root: string, note: string, json: string): Promise<void> {
  const file = drawingPath(root, note)
  await fs.mkdir(path.dirname(file), { recursive: true })
  remember(file)
  await fs.writeFile(file, json, "utf8")
  remember(file)
}

/**
 * A picture put on the drawing layer: bytes in, a file in `.drawings/media`
 * out. The media folder is the app's own bookkeeping — hidden, beside the
 * notes, and swept of anything no sidecar points at any more.
 */
export async function saveMedia(root: string, bytes: Uint8Array, extension: string):
Promise<{ file: string }> {
  const folder = path.join(root, ".drawings", "media")
  await fs.mkdir(folder, { recursive: true })
  const stamp = createHash("sha1").update(bytes).digest("hex").slice(0, 16)
  const file = `${stamp}${extension.startsWith(".") ? extension : `.${extension}`}`
  const where = path.join(folder, file)
  // The same picture pasted twice is one file: the name IS its contents.
  try {
    await fs.access(where)
  } catch {
    await fs.writeFile(where, bytes)
  }
  return { file }
}

export const mediaPath = (root: string, file: string): string =>
  path.join(root, ".drawings", "media", path.basename(file))

// MARK: - Moving rows

/** Every note under a folder, so a section's sidecars can follow it. */
async function notesUnder(folder: string): Promise<string[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) found.push(...await notesUnder(full))
    else if (isNote(entry.name)) found.push(full)
  }
  return found
}

/** The drawing is the note's other half: it goes where the note goes. */
async function moveSidecar(root: string, from: string, to: string): Promise<void> {
  const old = drawingPath(root, from)
  try {
    await fs.access(old)
  } catch { return }
  const next = drawingPath(root, to)
  await fs.mkdir(path.dirname(next), { recursive: true })
  remember(old)
  remember(next)
  await fs.rename(old, next)
}

/** The names a folder shows, notes then sections, in the order it shows them. */
async function shownNames(root: string, folder: string, order: NoteOrder):
  Promise<{ notes: string[]; sections: string[] }> {
  const section = await readTree(folder, root, order)
  return {
    notes: section.notes.map((note) => path.basename(note.path)),
    sections: section.sections.map((one) => one.name),
  }
}

/**
 * Drop a note onto a row: into that row's folder if it is somewhere else,
 * and then into that row's PLACE in the order (`before` is the row's file
 * name; null means the end of the folder's notes). A drag within one folder
 * is only the second. Returns where the note ended up.
 */
export async function placeNote(root: string, file: string, targetFolder: string,
  before: string | null): Promise<string> {
  let order = await readOrder(root)
  let landed = file
  const from = path.dirname(file)
  if (path.resolve(from) !== path.resolve(targetFolder)) {
    const destination = await uniquePath(targetFolder, path.basename(file, path.extname(file)),
      path.extname(file) || ".md")
    await fs.mkdir(targetFolder, { recursive: true })
    await fs.rename(file, destination)
    await moveSidecar(root, file, destination)
    const text = known.get(file)
    known.delete(file)
    if (text !== undefined) known.set(destination, text)
    order = forget(order, path.basename(file), from, root)
    landed = destination
  }
  const { notes, sections } = await shownNames(root, targetFolder, order)
  const name = path.basename(landed)
  await writeOrder(root, setOrder(order, [...placing(notes, name, before), ...sections], targetFolder, root))
  return landed
}

/** Move a section inside another one, refusing to put it inside itself. */
export async function moveSection(root: string, folder: string, targetFolder: string):
  Promise<string | null> {
  if (path.resolve(folder) === path.resolve(root)) return null
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
  let order = forget(await readOrder(root), path.basename(folder), from, root)
  const key = orderKey(targetFolder, root)
  order = setOrder(order, appending(order.folders[key] ?? [], path.basename(destination)), targetFolder, root)
  await writeOrder(root, order)
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
  const partial = `${file}.tmp`
  await fs.writeFile(partial, json, "utf8")
  await fs.rename(partial, file)
}

/** Which of these files are still there — the session drops the ones that are not. */
export async function existing(files: string[]): Promise<string[]> {
  const found: string[] = []
  for (const file of files) {
    try { await fs.access(file); found.push(file) } catch { /* gone */ }
  }
  return found
}

/** Order, kept honest when a row is dragged. */
export async function reorder(root: string, folder: string, names: string[]): Promise<void> {
  await writeOrder(root, setOrder(await readOrder(root), names, folder, root))
}
