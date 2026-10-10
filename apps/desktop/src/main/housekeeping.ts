/**
 * HOUSEKEEPING (docs\TODO.md "Housekeeping"): what a note leaves behind.
 *
 * A note is one `.wm` file now (docs/SPEC-WM.md): its drawing and its pictures are inside it. Two things here:
 *
 * 1. THE NOTE TAKES EVERYTHING WITH IT TO THE BIN. Delete (a note, or a section with its notes) puts the note in the
 *    Recycle Bin / Trash — never a permanent delete, so putting it back brings the drawing and the pictures back too.
 *    (2.15.0 left a note's drawing and pictures behind, in `.drawings`; the conversion folded those into the notes.)
 *
 * 2. FILE ▸ CLEAN UP UNUSED FILES… finds, inside the notes of the open project's folders, the pictures and ink
 *    snapshots (`media/*`, `snapshots/*`) that neither the note's text nor its drawing names (the spec keeps them: "a
 *    picture no longer named stays until the person runs a clean-up"), and offers them for the bin. Nothing is ever
 *    deleted on its own or for good. It offers nothing at all unless it could read EVERY note under every folder of
 *    the project (a folder that is not there, a note it could not read: it says so and stops); never from a note
 *    changed in the last ten minutes (a save, a paste, a capture may be on its way to naming one); never anything the
 *    window's unsaved state names (`Held`, from the page: every media name in its words, drawings and undo histories);
 *    and never from a note of a newer format (it is read-only here). A picture that goes is written out as a file and
 *    put in the bin (so it can be put back), and then taken out of the note, as one write like any other.
 *
 * The bin is passed in (`shell.trashItem` in the app, a stand-in in the tests): nothing here imports Electron.
 */

import { promises as fs, type Dirent } from "node:fs"
import os from "node:os"
import path from "node:path"
import { WM_DRAWING, WM_MEDIA, WM_SNAPSHOTS, WM_TEXT, decodeDrawing, drawingMediaFiles, isWmName, mediaFiles, textOf, withEntry } from "@writemind/core"
import { codeOf, limiter } from "./atomic"
import { fold, keyOf } from "./echo"
import { isForeignPath } from "./project"
import { commit, loadNote, parseNote } from "./wmStore"
import { pictureFiles } from "./macDrawing"
import {
  NOTHING_HELD, RECENT_MS, namesIn, plainName,
  type Held, type TrashResult, type UnusedFile, type UnusedScan,
} from "../shared/housekeeping"

/** Puts one file or folder in the Recycle Bin / Trash. */
export type Trash = (file: string) => Promise<void>

/** Keeps a picture's bytes (the note, the entry's name) so that Clean Up can be undone; a throw means it was not kept. */
export type Kept = (note: string, entry: string, bytes: Uint8Array) => Promise<void>

const io = limiter(32)

// MARK: - What is under a folder

/**
 * Every note under a folder (hidden folders skipped, as the sidebar skips them — but NOT the folders kept out of the
 * sidebar, whose notes are still on disk and still own pictures). A note may be a symbolic link to a file, as the
 * sidebar takes it. A folder that cannot be read throws when `strict` (a sweep must see everything), else it is passed over.
 */
async function walk(folder: string, strict: boolean, out: string[] = [], depth = 0): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await io(() => fs.readdir(folder, { withFileTypes: true }))
  } catch (error) {
    // A folder that went away between being listed and being read has nothing in it to lose.
    if (!strict || (depth > 0 && codeOf(error) === "ENOENT")) return out
    throw error
  }
  const inner: Promise<unknown>[] = []
  for (const entry of entries) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) inner.push(walk(full, strict, out, depth + 1))
    } else if (entry.isFile() && isWmName(entry.name)) {
      out.push(full)
    } else if (entry.isSymbolicLink() && isWmName(entry.name)) {
      inner.push(io(() => fs.stat(full)).then((stat) => { if (stat.isFile()) out.push(full) }, (error) => {
        if (strict) throw error
      }))
    }
  }
  await Promise.all(inner)
  return out
}

// MARK: - 1. Delete takes the drawing

/** Delete a note: the note — with its drawing and its pictures — to the bin (a failure throws and nothing else moves). */
export async function trashNote(file: string, trash: Trash): Promise<void> {
  await trash(file)
}

/** Delete a section: the folder to the bin, and with it every note and everything inside every note. */
export async function trashSection(folder: string, trash: Trash): Promise<void> {
  // (The app keeps the digest of a trashed note: a save of it is refused as "gone", never put back.)
  await trash(folder)
}

// MARK: - 2. Clean Up Unused Files…

export interface ScanOptions {
  now?: number
  recentMs?: number
  /** Only these files may be offered (the ones the person said yes to); the rest of a sweep's rules stand. */
  only?: Set<string>
}

/** What an offered picture is called: the note, then the entry. `<note>::media/<name>`. */
const SEPARATOR = "::"
export const entryPath = (note: string, entry: string): string => `${note}${SEPARATOR}${entry}`
export function splitEntryPath(value: string): { note: string; entry: string } | null {
  const found = /^(.*)::((?:media|snapshots)\/[^/]+)$/.exec(value)
  return found ? { note: found[1]!, entry: found[2]! } : null
}

/** The names a note's text and drawing use: every picture and snapshot they could be pointing at. */
function namesUsedBy(text: string, drawingJson: string | null): Set<string> {
  const used = new Set<string>()
  const add = (name: string) => used.add(fold(name))
  for (const name of mediaFiles(text)) add(name)
  for (const name of namesIn(text)) add(name)
  if (drawingJson !== null) {
    for (const name of drawingMediaFiles(decodeDrawing(drawingJson).drawing)) add(name)
    for (const name of pictureFiles(drawingJson)) add(path.basename(name))
    for (const name of namesIn(drawingJson)) add(name)
  }
  return used
}

/**
 * The unused files of a project: `folders` are its folders, `held` what the window holds. Reads every note.
 * (`root` is kept for the callers that name it; the notes carry their own pictures now.)
 */
export async function findUnused(_root: string, folders: string[], held: Held = NOTHING_HELD, options: ScanOptions = {}):
Promise<UnusedScan> {
  const now = options.now ?? Date.now()
  const recentMs = options.recentMs ?? RECENT_MS
  const allowed = (file: string) => !options.only || options.only.has(file)
  const none = (problem: string): UnusedScan => ({ files: [], bytes: 0, problem, recent: 0 })

  // The project's folders, each once; a folder written on the other kind of machine is not one here.
  const projectFolders: string[] = []
  const seenFolders = new Set<string>()
  for (const folder of folders) {
    if (isForeignPath(folder)) continue
    const key = keyOf(folder)
    if (seenFolders.has(key)) continue
    seenFolders.add(key)
    const stat = await fs.stat(folder).catch(() => null)
    if (!stat?.isDirectory()) return none(`“${path.basename(folder)}” is not there (${folder}), so its notes cannot be read.`)
    projectFolders.push(folder)
  }
  if (projectFolders.length === 0) return none("The project has no folder to look in.")

  // Every note (a nested project folder is walked once).
  const notes = new Map<string, { file: string; folder: string }>()
  for (const folder of projectFolders) {
    let found: string[]
    try { found = await walk(folder, true) } catch (error) {
      return none(`A folder in “${path.basename(folder)}” could not be read (${codeOf(error) || String(error)}).`)
    }
    for (const file of found) if (!notes.has(keyOf(file))) notes.set(keyOf(file), { file, folder })
  }

  const heldNames = new Set(held.held.map(fold))
  const files: UnusedFile[] = []
  let recent = 0
  try {
    for (const { file, folder } of notes.values()) {
      const stat = await io(() => fs.stat(file))
      let wm
      try { wm = parseNote(await io(() => fs.readFile(file))) } catch (error) {
        return none(`A note could not be read (${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}).`)
      }
      // A note of a newer format is read-only here, and so are its pictures.
      if (wm.readOnly) continue
      const text = textOf(wm.entries.find((entry) => entry.name === WM_TEXT)?.data ?? new Uint8Array(0))
      const drawing = wm.entries.find((entry) => entry.name === WM_DRAWING)
      const used = namesUsedBy(text, drawing ? textOf(drawing.data) : null)
      for (const entry of wm.entries) {
        if (!entry.name.startsWith(WM_MEDIA) && !entry.name.startsWith(WM_SNAPSHOTS)) continue
        const name = entry.name.slice(entry.name.indexOf("/") + 1)
        if (used.has(fold(name)) || heldNames.has(fold(name))) continue
        // A name `namesIn` cannot find whole (a space in it): looked for as it is.
        if (!plainName(name) && (fold(text).includes(fold(name)) || (drawing !== undefined && fold(textOf(drawing.data)).includes(fold(name))))) continue
        const id = entryPath(file, entry.name)
        if (!allowed(id)) continue
        if (now - stat.mtimeMs < recentMs) { recent++; continue }
        files.push({
          path: id, folder, kind: "media", size: entry.data.length, modified: stat.mtimeMs,
          relative: `${path.relative(folder, file).replace(/\\/g, "/")}/${entry.name}`,
        })
      }
    }
  } catch (error) {
    return none(`A note could not be read (${codeOf(error) || String(error)}).`)
  }
  files.sort((a, b) => a.folder.localeCompare(b.folder) || a.relative.localeCompare(b.relative))
  return { files, bytes: files.reduce((sum, one) => sum + one.size, 0), problem: null, recent }
}

/**
 * The bin for the files the person said yes to — each looked at AGAIN first, and only one that is still unused goes.
 * Each picture is written out as a file in a folder of its own and that file is what goes to the bin; the entry is then
 * taken out of the note (one write per note, through the store's own queue and guard).
 */
export async function trashUnused(root: string, folders: string[], paths: string[], held: Held, trash: Trash,
  options: Omit<ScanOptions, "only"> = {}, kept?: Kept): Promise<TrashResult> {
  const moved: string[] = []
  const failed: string[] = []
  const first = await findUnused(root, folders, held, { ...options, only: new Set(paths) })
  if (first.problem) return { moved, failed, problem: first.problem }
  const byNote = new Map<string, { entry: string; id: string }[]>()
  for (const one of first.files) {
    const split = splitEntryPath(one.path)
    if (!split) continue
    byNote.set(split.note, [...(byNote.get(split.note) ?? []), { entry: split.entry, id: one.path }])
  }
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "WriteMind-removed-"))
  try {
    for (const [note, list] of byNote) {
      // Read the note as it is now: the app then knows it, and the removal is written over exactly these bytes.
      let wm
      try { wm = await loadNote(note) } catch { for (const one of list) failed.push(one.id); continue }
      const gone: string[] = []
      for (const one of list) {
        const found = wm.entries.find((entry) => entry.name === one.entry)
        if (!found) continue
        const folder = await fs.mkdtemp(path.join(staging, "p-"))
        const copy = path.join(folder, path.basename(`${path.basename(note, path.extname(note))} — ${path.basename(one.entry)}`))
        try {
          // Kept for Undo BEFORE anything leaves the note (main/undoJournal.ts): a picture that cannot be kept is not taken out.
          await kept?.(note, one.entry, found.data)
          await fs.writeFile(copy, found.data)
          await trash(copy)
          gone.push(one.entry)
          moved.push(one.id)
        } catch { failed.push(one.id) }
      }
      if (gone.length === 0) continue
      // The note is the app's to write only while it is as the app last saw it: a refusal leaves the pictures in the
      // note (and in the bin), which costs nothing.
      const out = await commit(note, (now) => gone.reduce((file, name) => withEntry(file, name, null), now)).catch(() => null)
      if (!out || !out.written) for (const name of gone) { moved.splice(moved.indexOf(entryPath(note, name)), 1); failed.push(entryPath(note, name)) }
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
  return { moved, failed, problem: null }
}
