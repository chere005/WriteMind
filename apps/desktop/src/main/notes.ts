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
  arrange, emptyOrder, makeNote, mayWrite, ORDER_FILE, setOrder,
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

/**
 * Read a folder and everything under it. Hidden folders — `.drawings`,
 * `.writemind` — are skipped: they are the app's own bookkeeping.
 */
export async function readTree(directory: string, root: string, order: NoteOrder,
  depth = 0): Promise<Section> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const notes: Note[] = []
  const sections: Section[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      sections.push(await readTree(full, root, order, depth + 1))
    } else if (isNote(entry.name)) {
      const [stat, contents] = await Promise.all([
        fs.stat(full).catch(() => null),
        fs.readFile(full, "utf8").catch(() => ""),
      ])
      notes.push(makeNote(full, stat ? stat.mtimeMs : 0, contents))
    }
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
  await fs.writeFile(file, text, "utf8")
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
  await fs.writeFile(file, json, "utf8")
}

/** Order, kept honest when a row is dragged. */
export async function reorder(root: string, folder: string, names: string[]): Promise<void> {
  await writeOrder(root, setOrder(await readOrder(root), names, folder, root))
}
