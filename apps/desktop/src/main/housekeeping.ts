/**
 * HOUSEKEEPING (docs\TODO.md "Housekeeping"): the files a note leaves behind.
 *
 * A note's drawing is a file of its own, `.drawings/<stem>-<hash>.json` in its project folder (notes.ts), and its
 * pictures and ink-cell snapshots are files in `.drawings/media`. Deleting a note used to leave all of them behind
 * (Sean deleted four notes and their sidecars stayed). Two things here:
 *
 * 1. THE NOTE TAKES ITS DRAWING TO THE BIN. Delete (a note, or a section with its notes) puts the note in the
 *    Recycle Bin / Trash and then its sidecar the same way — never a permanent delete, so putting both back brings
 *    the drawing back. A sidecar another note still answers to (the Mac's `<stem>.json`, shared by two notes of one
 *    name in two sections) stays.
 *
 * 2. FILE ▸ CLEAN UP UNUSED FILES… finds, in the open project's folders, the drawings no note answers to and the
 *    media files no note's markdown and no remaining drawing names (`mediaInUse`, the core's rule for any sweep, plus
 *    every file-like name in the texts as a second net), and offers them for the bin. Nothing is ever deleted on its
 *    own or for good. It offers nothing at all unless it could read EVERY note and drawing under every folder of the
 *    project (a folder that is not there, a file it could not read: it says so and stops); never a file changed in
 *    the last ten minutes (a save, a paste, a capture may be on its way to naming it); never anything the window's
 *    unsaved state names (`Held`, from the page: its open notes, and every media name in its words, drawings and
 *    undo histories); and never a drawing while a note of its name is left anywhere in the project (a note moved or
 *    renamed outside the app has lost its drawing's NAME, not the drawing — it can still be put back by hand).
 *    Media are matched by NAME across the whole project, the rule the app resolves them by (`findMedia`), so a note in
 *    one folder that uses a picture kept in another keeps it.
 *
 * The bin is passed in (`shell.trashItem` in the app, a stand-in in the tests): nothing here imports Electron.
 */

import { promises as fs, type Dirent } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { decodeDrawing, emptyDrawing, mediaInUse, type Drawing } from "@writemind/core"
import { codeOf, limiter } from "./atomic"
import { fromMacDrawing, pictureFiles } from "./macDrawing"
import { NOTE_EXTENSIONS, ownerOf, sidecarsOf } from "./notes"
import { isForeignPath } from "./project"
import {
  NOTHING_HELD, RECENT_MS, namesIn, plainName,
  type Held, type TrashResult, type UnusedFile, type UnusedScan,
} from "../shared/housekeeping"

/** Puts one file or folder in the Recycle Bin / Trash. */
export type Trash = (file: string) => Promise<void>

const fold = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value)
const keyOf = (file: string): string => fold(path.resolve(file))
const isUnder = (folder: string, file: string): boolean => {
  const base = keyOf(folder).replace(/[\\/]+$/, "")
  return keyOf(file).startsWith(base + path.sep)
}
const isNote = (name: string): boolean => {
  const dot = name.lastIndexOf(".")
  return dot > 0 && NOTE_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}
const stemOf = (file: string): string => path.basename(file, path.extname(file))
const sha12 = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 12)
const exists = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false)
const io = limiter(32)
/**
 * Until 0.3 (0.3.0-preview.1, 2026-10-04 20:20 -0500) every picture of every project was saved in the notes root's
 * `.drawings/media`; from 0.3 a picture goes to its note's own folder. A day's margin for a build still in use.
 */
export const SHARED_STORE_UNTIL = Date.parse("2026-10-06T02:00:00Z")

// MARK: - What is under a folder

interface Found { notes: string[]; drawings: string[]; dirs: string[] }

/**
 * Every note under a folder (hidden folders skipped, as the sidebar skips them — but NOT the folders kept out of the
 * sidebar, whose notes are still on disk and still own drawings), every `.drawings` folder at any depth, and every
 * folder read. A note may be a symbolic link to a file, as the sidebar takes it (`readTree`). A folder (or a linked
 * note) that cannot be read throws when `strict` (a sweep must see everything), else it is passed over.
 */
async function walk(folder: string, strict: boolean, out: Found = { notes: [], drawings: [], dirs: [] }, depth = 0):
Promise<Found> {
  let entries: Dirent[]
  try {
    entries = await io(() => fs.readdir(folder, { withFileTypes: true }))
  } catch (error) {
    // A folder that went away between being listed and being read has nothing in it to lose.
    if (!strict || (depth > 0 && codeOf(error) === "ENOENT")) return out
    throw error
  }
  out.dirs.push(folder)
  const inner: Promise<unknown>[] = []
  for (const entry of entries) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === ".drawings") out.drawings.push(full)
      else if (!entry.name.startsWith(".")) inner.push(walk(full, strict, out, depth + 1))
    } else if (entry.isFile() && isNote(entry.name)) {
      out.notes.push(full)
    } else if (entry.isSymbolicLink() && isNote(entry.name)) {
      // A linked note: the sidebar shows and opens it, so it owns its drawing as any note does.
      inner.push(io(() => fs.stat(full)).then((stat) => { if (stat.isFile()) out.notes.push(full) }, (error) => {
        if (strict) throw error
      }))
    }
  }
  await Promise.all(inner)
  return out
}

// MARK: - 1. Delete takes the drawing

/**
 * The sidecar files the notes under these folders answer to, by any of the three names (`sidecarsOf`); null when a
 * folder under them could not be read (a note there might answer to one, so nothing shared may go).
 */
async function sidecarsAnswered(root: string, folders: string[]): Promise<Set<string> | null> {
  const answered = new Set<string>()
  for (const folder of new Set(folders)) {
    let found: Found
    try { found = await walk(folder, true) } catch { return null }
    for (const note of found.notes) for (const one of sidecarsOf(root, note)) answered.add(keyOf(one))
  }
  return answered
}

/** `<stem>-<12 hex>.json`: a drawing named by its note's own path, so no other note shares it (the Mac's `<stem>.json` can be). */
const ownByPath = (file: string): boolean => /-[0-9a-f]{12}\.json$/i.test(path.basename(file))

/**
 * The notes' own sidecars to the bin, once the notes are there — except one another note still answers to. When the
 * owners could not all be read, a sidecar another note might share (the Mac's `<stem>.json`) stays for Clean Up.
 */
async function binSidecars(root: string, own: string[], owners: string[], trash: Trash): Promise<string[]> {
  const answered = await sidecarsAnswered(root, owners)
  const moved: string[] = []
  const seen = new Set<string>()
  for (const one of own) {
    const key = keyOf(one)
    if (seen.has(key) || (answered === null ? !ownByPath(one) : answered.has(key))) continue
    seen.add(key)
    if (!(await exists(one))) continue
    // The note is in the bin already: a drawing that will not go is left for Clean Up to offer, never thrown away.
    try { await trash(one); moved.push(one) } catch { /* kept */ }
  }
  return moved
}

/**
 * Delete a note: the note to the bin (a failure throws and nothing else moves), then its drawing after it. Returns the
 * drawing files that went with it.
 */
export async function trashNoteAndDrawing(root: string, file: string, trash: Trash): Promise<string[]> {
  const own = sidecarsOf(root, file)
  const owner = ownerOf(file, root)
  await trash(file)
  return binSidecars(root, own, [owner], trash)
}

/** Delete a section: the folder to the bin, then the drawings of the notes that were in it (kept in the project folder's `.drawings`). */
export async function trashSectionAndDrawings(root: string, folder: string, trash: Trash): Promise<string[]> {
  const notes = (await walk(folder, false)).notes
  const own = notes.flatMap((note) => sidecarsOf(root, note)).filter((one) => !isUnder(folder, one))
  const owners = notes.map((note) => ownerOf(note, root))
  await trash(folder)
  return binSidecars(root, own, owners, trash)
}

// MARK: - 2. Clean Up Unused Files…

interface Sidecar { path: string; folder: string | null; text: string; size: number; modified: number; drawing: boolean }

export interface ScanOptions {
  now?: number
  recentMs?: number
  /** Only these files may be offered (the ones the person said yes to); the rest of a sweep's rules stand. */
  only?: Set<string>
}

const readText = async (file: string): Promise<string | null> => {
  try { return await io(() => fs.readFile(file, "utf8")) } catch (error) {
    if (codeOf(error) === "ENOENT") return null
    throw error
  }
}

/** The drawing(s) a sidecar's text is, in either spelling (ours, the Mac's); none for text that is no drawing. */
function drawingsOf(text: string): Drawing[] {
  const out: Drawing[] = [decodeDrawing(text).drawing]
  const converted = fromMacDrawing(text)
  if (converted !== null && converted !== text) out.push(decodeDrawing(converted).drawing)
  return out
}

/** `Notes-0123456789ab` → `Notes`; the Mac's `Notes` stays `Notes`. */
const sidecarStem = (name: string): string => {
  const base = name.replace(/\.json$/i, "")
  return /^(.*)-[0-9a-f]{12}$/i.exec(base)?.[1] ?? base
}

/**
 * The unused files of a project: `folders` are its folders, `root` the app's notes root (the owner of last resort and
 * where drawings were kept before they travelled), `held` what the window holds. Reads every note and every drawing.
 */
export async function findUnused(root: string, folders: string[], held: Held = NOTHING_HELD, options: ScanOptions = {}):
Promise<UnusedScan> {
  const now = options.now ?? Date.now()
  const recentMs = options.recentMs ?? RECENT_MS
  const allowed = (file: string) => !options.only || options.only.has(keyOf(file))
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

  // Every note and every `.drawings` folder (a nested project folder is walked once).
  const notes = new Map<string, string>()
  const drawingFolders = new Map<string, string>()
  const dirs = new Map<string, string>()
  for (const folder of projectFolders) {
    let found: Found
    try { found = await walk(folder, true) } catch (error) {
      return none(`A folder in “${path.basename(folder)}” could not be read (${codeOf(error) || String(error)}).`)
    }
    for (const note of found.notes) notes.set(keyOf(note), note)
    for (const one of found.drawings) drawingFolders.set(keyOf(one), one)
    for (const one of found.dirs) dirs.set(keyOf(one), one)
  }
  // The notes root's drawings are read too (the oldest drawings were kept there) even when it is no folder of this project.
  const rootDrawings = path.join(root, ".drawings")
  if (!drawingFolders.has(keyOf(rootDrawings)) && await exists(rootDrawings)) drawingFolders.set(keyOf(rootDrawings), rootDrawings)

  // The words of every note.
  const texts: string[] = []
  try {
    await Promise.all([...notes.values()].map(async (note) => {
      const text = await readText(note)
      if (text !== null) texts.push(text)
    }))
  } catch (error) {
    return none(`A note could not be read (${codeOf(error) || String(error)}).`)
  }

  // Every drawing. Only those directly in a project folder's own `.drawings` can be offered.
  const homes = new Map(projectFolders.map((folder) => [keyOf(path.join(folder, ".drawings")), folder]))
  const sidecars: Sidecar[] = []
  try {
    for (const [key, dir] of drawingFolders) {
      const entries = await io(() => fs.readdir(dir, { withFileTypes: true })).catch((error) => {
        if (codeOf(error) === "ENOENT") return []
        throw error
      })
      await Promise.all(entries.filter((entry) => entry.isFile() && /\.json$/i.test(entry.name)).map(async (entry) => {
        const file = path.join(dir, entry.name)
        const stat = await fs.stat(file).catch(() => null)
        const text = await readText(file)
        if (!stat || text === null) return
        sidecars.push({
          path: file, folder: homes.get(key) ?? null, text, size: stat.size, modified: stat.mtimeMs,
          drawing: fromMacDrawing(text) !== null,
        })
      }))
    }
  } catch (error) {
    return none(`A drawing could not be read (${codeOf(error) || String(error)}).`)
  }

  // THE DRAWINGS NO NOTE ANSWERS TO. A note answers to its three names as the app reads them (`sidecarsOf`), and to
  // the name it would have in EACH project folder above it (a folder that is also a project of its own elsewhere);
  // a note of the window's that is not on disk any more still answers. And no drawing goes while a note of its stem
  // is left anywhere in the project.
  const answering = [...notes.values(), ...held.openNotes]
  const answered = new Set<string>()
  const stems = new Set<string>()
  for (const note of answering) {
    for (const one of sidecarsOf(root, note)) answered.add(keyOf(one))
    stems.add(fold(stemOf(note)))
    for (const folder of projectFolders) {
      if (!isUnder(folder, note)) continue
      const relative = path.relative(folder, note).replace(/\\/g, "/")
      answered.add(keyOf(path.join(folder, ".drawings", `${stemOf(note)}-${sha12(relative)}.json`)))
      answered.add(keyOf(path.join(folder, ".drawings", `${stemOf(note)}.json`)))
    }
  }
  // THE NOTES ROOT'S `.drawings` IS SHARED. Before 0.3 every note of every project kept its drawing there, named by
  // the note's absolute path (`olderDrawingPath`), and the app still reads it from there; a note of another project
  // is not seen here. So a `<stem>-<hash>.json` there is offered only when it is provably this project's: its hash
  // is that of a `<stem>` note's path in a folder of this project (the root-relative name a note under the root has
  // now, or the absolute name of the older one). Anything else there stays.
  const rootStore = keyOf(rootDrawings)
  const provablyOurs = (file: string): boolean => {
    const found = /^(.*)-([0-9a-f]{12})\.json$/i.exec(path.basename(file))
    if (!found) return true
    const stem = found[1]!, hash = found[2]!.toLowerCase()
    for (const dir of dirs.values()) {
      for (const extension of NOTE_EXTENSIONS) {
        const note = path.join(dir, stem + extension)
        if (sha12(note) === hash) return true
        if (isUnder(root, note) && sha12(path.relative(root, note).replace(/\\/g, "/")) === hash) return true
      }
    }
    return false
  }
  let recent = 0
  const offered = new Set<Sidecar>()
  for (const sidecar of sidecars) {
    if (!sidecar.folder || !sidecar.drawing) continue
    const name = path.basename(sidecar.path)
    if (answered.has(keyOf(sidecar.path))) continue
    if (stems.has(fold(sidecarStem(name))) || stems.has(fold(name.replace(/\.json$/i, "")))) continue
    if (keyOf(path.dirname(sidecar.path)) === rootStore && !provablyOurs(sidecar.path)) continue
    if (!allowed(sidecar.path)) continue
    if (now - sidecar.modified < recentMs) { recent++; continue }
    offered.add(sidecar)
  }

  // THE MEDIA NOTHING NAMES: not a note's markdown, not a drawing that stays, not the window.
  const kept = sidecars.filter((one) => !offered.has(one))
  const used = new Set<string>()
  const pairs: { markdown: string; drawing: Drawing }[] = texts.map((markdown) => ({ markdown, drawing: emptyDrawing() }))
  for (const sidecar of kept) for (const drawing of drawingsOf(sidecar.text)) pairs.push({ markdown: "", drawing })
  for (const name of mediaInUse(pairs)) used.add(fold(name))
  for (const sidecar of kept) for (const name of pictureFiles(sidecar.text)) used.add(fold(path.basename(name)))
  for (const text of [...texts, ...kept.map((one) => one.text)]) for (const name of namesIn(text)) used.add(fold(name))
  for (const name of held.held) used.add(fold(name))
  const named = (name: string): boolean => {
    if (used.has(fold(name))) return true
    // A name `namesIn` cannot find whole (a space in it): looked for as it is.
    if (plainName(name)) return false
    const wanted = fold(name)
    return [...texts, ...kept.map((one) => one.text)].some((text) => fold(text).includes(wanted))
  }

  const files: UnusedFile[] = []
  const unused = (file: string, folder: string, kind: UnusedFile["kind"], size: number, modified: number): UnusedFile => ({
    path: file, folder, kind, size, modified, relative: path.relative(folder, file).replace(/\\/g, "/"),
  })
  for (const sidecar of offered) files.push(unused(sidecar.path, sidecar.folder!, "drawing", sidecar.size, sidecar.modified))
  for (const folder of projectFolders) {
    const media = path.join(folder, ".drawings", "media")
    // The root's pictures from before 0.3 were the shared store of every project (and are still looked in last):
    // one of those may be a picture of another project's note, so none of them is offered.
    const shared = keyOf(media) === keyOf(path.join(rootDrawings, "media"))
    let entries: Dirent[] = []
    try { entries = await io(() => fs.readdir(media, { withFileTypes: true })) } catch (error) {
      if (codeOf(error) !== "ENOENT") return none(`The pictures of “${path.basename(folder)}” could not be read (${codeOf(error)}).`)
    }
    for (const entry of entries) {
      // A file being written (`.tmp`, atomic.ts) and the system's own (`.DS_Store`) are not pictures.
      if (!entry.isFile() || entry.name.startsWith(".") || /\.tmp$/i.test(entry.name)) continue
      if (named(entry.name)) continue
      const file = path.join(media, entry.name)
      if (!allowed(file)) continue
      const stat = await fs.stat(file).catch(() => null)
      if (!stat) continue
      if (now - stat.mtimeMs < recentMs) { recent++; continue }
      if (shared && stat.mtimeMs < SHARED_STORE_UNTIL) continue
      files.push(unused(file, folder, "media", stat.size, stat.mtimeMs))
    }
  }
  files.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "drawing" ? -1 : 1)
    || a.folder.localeCompare(b.folder) || a.relative.localeCompare(b.relative))
  return { files, bytes: files.reduce((sum, one) => sum + one.size, 0), problem: null, recent }
}

/**
 * The bin for the files the person said yes to — each looked at AGAIN first, and only one that is still unused goes.
 * The drawings go first; the media are then looked at again with those drawings gone, so a picture of a drawing that
 * would not go stays with it.
 */
export async function trashUnused(root: string, folders: string[], paths: string[], held: Held, trash: Trash,
  options: Omit<ScanOptions, "only"> = {}): Promise<TrashResult> {
  const wanted = new Set(paths.map(keyOf))
  const moved: string[] = []
  const failed: string[] = []
  const first = await findUnused(root, folders, held, { ...options, only: wanted })
  if (first.problem) return { moved, failed, problem: first.problem }
  for (const file of first.files.filter((one) => one.kind === "drawing")) {
    try { await trash(file.path); moved.push(file.path) } catch { failed.push(file.path) }
  }
  const media = new Set(first.files.filter((one) => one.kind === "media").map((one) => keyOf(one.path)))
  if (media.size === 0) return { moved, failed, problem: null }
  const second = await findUnused(root, folders, held, { ...options, only: media })
  if (second.problem) return { moved, failed, problem: second.problem }
  for (const file of second.files) {
    try { await trash(file.path); moved.push(file.path) } catch { failed.push(file.path) }
  }
  return { moved, failed, problem: null }
}
