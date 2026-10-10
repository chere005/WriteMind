/**
 * THE CONVERSION OF 2.15.0's NOTES TO `.wm` (docs/SPEC-WM.md section 5): on the first launch that opens a project folder,
 * and again when a folder is added to a project, every `.md` / `.markdown` note under it is made into a `.wm` — the text,
 * the drawing, the pictures and the ink snapshots in one file — and the originals are MOVED to a backup folder. One way,
 * once, and safe to run again.
 *
 * - NOTHING IS DELETED. An original is moved to the backup only after a `.wm` has been written, read back and verified
 *   (the words byte for byte, every picture by its SHA-256, the drawing by its meaning); a move across disks is a copy,
 *   a flush, a SHA-256 comparison and only then the removal. The backup is never removed by the app.
 * - ONE NOTE'S FAILURE IS THAT NOTE'S ONLY: a file that is not UTF-8, a name that is taken, a disk that is full — the
 *   note stays as it was, the rest go on, and the report says which.
 * - IT IS IDEMPOTENT. A note whose `.wm` says (manifest.legacy) it came from this very file with these very bytes is
 *   converted already: it is not made again, and an interrupted run is finished by moving what was left.
 * - `.txt` IS LEFT ALONE (decided 2026-10-07): it was a note in 2.15.0; it is not converted and not listed.
 * - THE FOLDERS: a folder that is the Swift Mac app's own notes (`~/Documents/WriteMind` on a Mac, with nothing to say this
 *   app uses it) is never touched — nor any folder UNDER it, wherever the run came in from (a project folder that is its
 *   parent, a symlink, a spelling in another case): the guard is asked of every folder the walk enters. A test instance
 *   never touches anything but its own scratch folders. A git working tree (a folder holding `.git`) and `node_modules`
 *   are not walked: their `.md` files are not this app's notes and moving them would break a repository.
 * - A FOLDER THAT IS NOT THE APP'S OWN NOTES (not the notes root or under it) is converted only after the person has
 *   said yes to it once (`confirm`, remembered by the caller): a project folder somebody added is not ours to rearrange.
 * - ONLY "NOT THERE" MEANS "NOT THERE". A drawing, a picture or a folder that cannot be READ (busy, no permission, a
 *   failing disk) is not an absent one: the note it belongs to is left alone and tried again at the next launch, and a
 *   folder that cannot be listed keeps its `.drawings` where it is.
 *
 * Two passes over every folder of the run: the names (links cross folders), then the notes; and only then the moves into
 * the backups (a picture one folder's note uses may be kept in another folder's `.drawings`). The sessions follow the
 * notes BEFORE the originals move, so that a run cut short between the two leaves sessions that name notes that exist.
 */

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import {
  CONVERTED_EXTENSIONS, WM_DRAWING, WM_MEDIA, WM_SNAPSHOTS, WM_TEXT, WmError, containerNames, decodeDrawing, drawingMediaFiles,
  encodeRefName, inkCellId, inkCellSvg, inkFileName, isWmName, keepUnknown, legacyOrder, linkedNote, mediaFiles, newNames, newWmFile, openWm,
  orderKey, rewriteLegacyText, rfc3339, textFingerprint, textOf, utf8, withEntry, writeDrawing, type AppStamp, type CanvasItem, type Drawing,
  type NoteOrder, type WmFile,
} from "@writemind/core"
import { codeOf, writeFileAtomic } from "./atomic"
import { isWithin } from "./convertGuard"
import { drawingPath, macDrawingPath, olderDrawingPath } from "./legacyLayout"
import { fromMacDrawing, pictureFiles } from "./macDrawing"
import { createFile } from "./wmStore"
import { readEntryHead } from "./zipHead"
import { readZip } from "./zip"

const NAMESPACE = "d0f4a6a2-6b1e-4f58-9a35-5f0d4c7a1b21"

// MARK: - Small things

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

/** A version 5 UUID (RFC 4122): the same name in the same namespace is the same id on every machine. */
export function uuidV5(name: string, namespace: string = NAMESPACE): string {
  const space = Buffer.from(namespace.replace(/-/g, ""), "hex")
  const hash = createHash("sha1").update(space).update(name, "utf8").digest()
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const fold = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value)
const same = (a: string, b: string): boolean => fold(path.resolve(a)) === fold(path.resolve(b))
const slashes = (value: string): string => value.replace(/\\/g, "/")
const exists = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false)

const two = (n: number): string => String(n).padStart(2, "0")
/** `20261003-141502`, local time. */
export const stampOf = (date: Date): string =>
  `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`

const strict = new TextDecoder("utf-8", { fatal: true })

// MARK: - What the run is given and what it says

export interface ConvertOptions {
  /** The app's notes root: where the oldest drawings were kept (`olderDrawingPath`), and the last place a picture is looked for. */
  root: string
  /** The project's folders, and the ones kept out of it (their notes are converted when they are brought back). */
  excluded?: string[]
  /** The user-data folder: remembered sessions follow the notes that moved. */
  userData?: string
  appVersion: string
  now?: Date
  log?: (line: string) => void
  /**
   * Why a folder may NOT be converted (the Swift app's folder, a test instance's real notes), or null when it may
   * (convertGuard.ts). Asked of every folder given AND of every folder the walk enters.
   */
  refuse?: (folder: string) => Promise<string | null>
  /**
   * Whether the person says yes to converting `count` notes in `folder` (which is not the app's own notes root), their
   * originals going to `backup`. The caller remembers the answer per folder; a no leaves the folder alone and says
   * nothing of it. Absent: no question is asked (library use, tests).
   */
  confirm?: (folder: string, count: number, backup: string) => Promise<boolean>
  /** Called as the notes are converted: how many are done of how many. */
  progress?: (done: number, total: number) => void
  /** Replaceable for a test: the move of one file or folder (`fs.rename`), which a test makes fail with EXDEV. */
  rename?: (from: string, to: string) => Promise<void>
}

export interface ConvertedNote {
  /** The original, and where it is now (in the backup); the `.wm` that replaced it. */
  from: string
  to: string
  backup: string | null
}

export interface ConvertReport {
  converted: ConvertedNote[]
  /** Left as they were, with the reason (a file that is not UTF-8). */
  skipped: { note: string; reason: string }[]
  failed: { note: string; reason: string }[]
  /** Notes that were already converted by an earlier run (only their originals were moved now, if they were still there). */
  already: number
  /** `.txt` files, left alone. */
  txt: number
  /** The backup folders made, one per project folder that had something to move. */
  backups: string[]
  /** Folders not looked at, and why. */
  refused: { folder: string; reason: string }[]
  /** Unsaved text a remembered session held over a note that had changed since: kept in the backup, not in the note. */
  setAside: { note: string; file: string }[]
}

export const emptyReport = (): ConvertReport =>
  ({ converted: [], skipped: [], failed: [], already: 0, txt: 0, backups: [], refused: [], setAside: [] })

// MARK: - Finding the notes

interface Legacy {
  /** Absolute path, and relative to its project folder (`/`-separated). */
  file: string
  relative: string
  folder: string
}

/** What a walk found under a project folder. */
interface Found {
  notes: string[]
  txt: number
  /** Folders that could not be listed (anything but "not there"): what is in them is unknown. */
  unlisted: string[]
  /** Folders not entered, and why (the guard's answer, a git working tree). */
  kept: { folder: string; reason: string }[]
}

const newFound = (): Found => ({ notes: [], txt: 0, unlisted: [], kept: [] })

/** Why a git working tree is not walked. */
const GIT_REASON = "it is a git working tree: its notes are tracked files, and converting them would take them out of the repository"

/** Only these mean "there is nothing there"; a busy file, a refused folder, a failing disk are not that. */
const absent = (error: unknown): boolean => ["ENOENT", "ENOTDIR"].includes(codeOf(error))

/** A file's bytes, or null when it is NOT THERE; any other trouble throws (the caller leaves that note alone). */
async function readOrAbsent(file: string): Promise<Buffer | null> {
  try { return await fs.readFile(file) } catch (error) {
    if (absent(error)) return null
    throw error
  }
}

interface Rules {
  excluded: readonly string[]
  /** The conversion's own rules: no git working trees, no `node_modules`, and the guard asked of every folder entered. */
  refuse?: (folder: string) => Promise<string | null>
  everything?: boolean
  /** Look in git working trees too (to say whether one holds notes), without converting anything. */
  countGit?: boolean
}

async function walk(folder: string, rules: Rules, found: Found): Promise<void> {
  if (!rules.everything && !rules.countGit && await exists(path.join(folder, ".git"))) { found.kept.push({ folder, reason: GIT_REASON }); return }
  let entries: import("node:fs").Dirent[]
  try { entries = await fs.readdir(folder, { withFileTypes: true }) } catch (error) {
    if (!absent(error)) found.unlisted.push(folder)
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) {
      if (!rules.everything) {
        if (rules.excluded.some((one) => same(one, full))) continue
        if (entry.name === "node_modules") continue
        const why = rules.refuse ? await rules.refuse(full) : null
        if (why !== null) { found.kept.push({ folder: full, reason: why }); continue }
      }
      await walk(full, rules, found)
    } else if (entry.isFile()) {
      if (legacyOrder(entry.name) >= 0) found.notes.push(full)
      else if (path.extname(entry.name).toLowerCase() === ".txt") found.txt++
    }
  }
}

/** What an earlier run made of a legacy note, by the `.wm` beside it: `source` and `sha256` from its manifest. */
async function earlier(directory: string): Promise<Map<string, { name: string; sha256: string }[]>> {
  const out = new Map<string, { name: string; sha256: string }[]>()
  const names = await fs.readdir(directory).catch(() => [] as string[])
  for (const name of names) {
    if (!isWmName(name)) continue
    try {
      const head = await readEntryHead(path.join(directory, name), "manifest.json", 1 << 20)
      const manifest = head ? JSON.parse(head.head.toString("utf8")) as { legacy?: { source?: unknown; sha256?: unknown } } : null
      const legacy = manifest?.legacy
      if (legacy && typeof legacy.source === "string" && typeof legacy.sha256 === "string") {
        const list = out.get(legacy.source) ?? []
        list.push({ name, sha256: legacy.sha256 })
        out.set(legacy.source, list)
      }
    } catch { /* not a note of ours: it is not an earlier conversion */ }
  }
  return out
}

// MARK: - One note

interface Done {
  note: Legacy
  newFile: string
  /** The sidecar this note read its drawing from, for the backup. */
  sidecar: string | null
  bytes: Buffer
  /** The SHA-256 of `bytes`: the original is looked at again before it is moved. */
  digest: string
}

/** The first of the three places a note's drawing was kept that has one. */
async function sidecarOf(folder: string, root: string, note: string):
  Promise<{ file: string; text: string; bytes: Buffer; mac: boolean } | null> {
  const places: [string, boolean][] = [
    [drawingPath(folder, note), false], [olderDrawingPath(root, note), false], [macDrawingPath(folder, note), true],
  ]
  // (A place that is NOT THERE is the next place; one that cannot be read throws, and the note is left as it is.)
  for (const [file, mac] of places) {
    const bytes = await readOrAbsent(file)
    if (bytes) return { file, text: bytes.toString("utf8"), bytes, mac }
  }
  return null
}

/**
 * A picture or snapshot of the note by name: this folder's `.drawings/media`, then the other folders', then the root's,
 * then the media of the backups an earlier run made of the project's folders (a folder added to a project later may use
 * a picture that another folder's `.drawings` took away with it).
 */
async function legacyMedia(name: string, folder: string, others: readonly string[], root: string, backups: readonly string[]):
  Promise<Buffer | null> {
  const places = [...[folder, ...others, root].map((one) => path.join(one, ".drawings", "media")), ...backups]
  for (const place of places) {
    const bytes = await readOrAbsent(path.join(place, name))
    if (bytes) return bytes
  }
  return null
}

/** The `.drawings/media` of the backups the project's folders have (newest first): beside the folder, or inside it. */
async function backupMediaOf(folders: readonly string[]): Promise<string[]> {
  const out: string[] = []
  for (const folder of folders) {
    const beside = (await fs.readdir(path.dirname(folder)).catch(() => [] as string[]))
      .filter((name) => name.startsWith(`${path.basename(folder)} legacy backup `)).sort().reverse()
    for (const name of beside) out.push(path.join(path.dirname(folder), name, ".drawings", "media"))
    const inside = path.join(folder, ".writemind", "legacy")
    for (const name of (await fs.readdir(inside).catch(() => [] as string[])).sort().reverse()) out.push(path.join(inside, name, ".drawings", "media"))
  }
  return out
}

const withFiles = (drawing: Drawing, map: ReadonlyMap<string, string>): Drawing => {
  const walkItems = (items: CanvasItem[]): CanvasItem[] => items.map((item) => {
    if (item.kind === "image") return { kind: "image", image: { ...item.image, file: map.get(item.image.file) ?? item.image.file } }
    if (item.kind === "cell") return { kind: "cell", cell: { ...item.cell, items: walkItems(item.cell.items) } }
    return item
  })
  return { items: walkItems(drawing.items) }
}

interface Context {
  options: ConvertOptions
  notes: Legacy[]
  /** The new file name of a note of the run. */
  nameOf(note: Legacy): string
  folders: string[]
  /** `.drawings/media` of the backups earlier runs made (searched last for a picture). */
  backupMedia: string[]
  now: Date
  app: AppStamp
}

/** Convert one note. Returns what was written, or throws with the reason the note stays as it was. */
async function convertNote(note: Legacy, context: Context): Promise<Done> {
  const { options, app, now } = context
  const bytes = await fs.readFile(note.file)
  let decoded: string
  try { decoded = strict.decode(bytes) } catch { throw new SkipNote("it is not UTF-8 text, and a lossy decode would change the words") }
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  const stat = await fs.stat(note.file)
  const digest = sha256(bytes)
  const newName = context.nameOf(note)
  const target = path.join(path.dirname(note.file), newName)

  // The drawing.
  const sidecar = await sidecarOf(note.folder, options.root, note.file)
  let flat: string | null = null
  if (sidecar) flat = sidecar.mac ? fromMacDrawing(sidecar.text) : sidecar.text
  const read = flat === null ? null : decodeDrawing(flat)
  const damaged = sidecar !== null && (sidecar.mac || read === null || read.damaged || flat === null)

  // The pictures: every file the drawing names, every cell's snapshot, every `.drawings/media/<name>` the text names.
  const wanted: string[] = []
  const add = (name: string) => { if (name && !wanted.includes(name)) wanted.push(name) }
  if (flat !== null) for (const name of pictureFiles(flat)) add(name)
  if (read) for (const name of drawingMediaFiles(read.drawing)) add(name)
  for (const name of mediaFiles(text)) add(name)
  const renames = containerNames(wanted)
  const renamed = new Map([...renames].filter(([from, to]) => from !== to))
  const missing: string[] = []
  const found = new Map<string, Buffer>()
  for (const name of wanted) {
    const data = await legacyMedia(name, note.folder, context.folders.filter((one) => !same(one, note.folder)), options.root, context.backupMedia)
    if (data) found.set(name, data)
  }

  // The drawing.json, with the pictures' new names.
  let drawingJson: string | null = null
  let drawing: Drawing | null = null
  if (read && flat !== null) {
    drawing = withFiles(read.drawing, renamed)
    // A sidecar that read in full keeps what this build does not know (as every save does); one that did not is written
    // as what could be read, and its original is kept beside it (legacy/sidecar.json), so the note does not open "damaged".
    drawingJson = renamed.size === 0 && !damaged ? keepUnknown(flat, writeDrawing(drawing)) : writeDrawing(drawing)
  }
  // A cell whose snapshot is nowhere is drawn again from the cell; any other picture that is not found is listed.
  const cells = new Map<string, import("@writemind/core").InkCell>()
  if (drawing) for (const item of drawing.items) if (item.kind === "cell" && !cells.has(item.cell.id)) cells.set(item.cell.id, item.cell)
  for (const name of wanted) {
    if (found.has(name)) continue
    const id = inkCellId(name)
    const cell = id ? cells.get(id) : undefined
    if (cell) {
      const svg = inkCellSvg(cell, 720, { mediaUrl: (file) => `../media/${encodeRefName(renames.get(file) ?? file)}`, metadata: true })
      found.set(name, Buffer.from(svg, "utf8"))
    } else missing.push(name)
  }

  // The text, with the same edits the spec lists and no others.
  const links = context.notes.map((one) => one.file)
  const rewritten = rewriteLegacyText(text, {
    renamed, missing: new Set(missing),
    link: (file) => {
      const hit = linkedNote(links, note.file, file)
      const target = hit === null ? undefined : context.notes.find((one) => one.file === hit)
      return target ? context.nameOf(target) : null
    },
  })

  // The container.
  const birth = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs
  let wm: WmFile = newWmFile(stat.mtime, app, rewritten, uuidV5(`${digest}:${note.relative}`))
  wm = withEntry(wm, WM_TEXT, utf8(rewritten))
  if (drawingJson !== null) wm = withEntry(wm, WM_DRAWING, utf8(drawingJson))
  const snapshots: string[] = []
  const pictures: string[] = []
  for (const name of wanted) {
    const data = found.get(name)
    if (!data) continue
    const into = renames.get(name) ?? name
    if (inkCellId(name) !== null) snapshots.push(name)
    else pictures.push(name)
    wm = withEntry(wm, `${inkCellId(name) !== null ? WM_SNAPSHOTS : WM_MEDIA}${into}`, new Uint8Array(data))
  }
  if (damaged && sidecar) wm = withEntry(wm, "legacy/sidecar.json", new Uint8Array(sidecar.bytes))
  const sidecarName = sidecar ? `.drawings/${path.basename(sidecar.file)}` : null
  const manifest = {
    ...wm.manifest, created: rfc3339(birth), modified: rfc3339(stat.mtime),
    legacy: {
      source: note.relative, sha256: digest, sidecar: sidecarName, converted: rfc3339(now), app: { ...app },
      ...(missing.length > 0 ? { missing } : {}),
    },
  }
  wm = { ...wm, manifest: manifest as WmFile["manifest"] }
  try { await createFile(target, wm, stat.mtime) } catch (error) {
    if (codeOf(error) === "EEXIST") throw new Failure(`a note named ${newName} is already there`)
    throw error
  }

  // Verify: read it back as a stranger would.
  try {
    const back = openWm(readZip(await fs.readFile(target)))
    const entry = (name: string) => back.entries.find((one) => one.name === name)
    if (textOf(entry(WM_TEXT)?.data ?? new Uint8Array(0)) !== rewritten) throw new Error("the words differ")
    for (const name of wanted) {
      const data = found.get(name)
      if (!data) continue
      const into = `${inkCellId(name) !== null ? WM_SNAPSHOTS : WM_MEDIA}${renames.get(name) ?? name}`
      const got = entry(into)
      if (!got || sha256(got.data) !== sha256(data)) throw new Error(`${into} differs`)
    }
    if (drawingJson !== null) {
      const got = entry(WM_DRAWING)
      const was = writeDrawing(decodeDrawing(drawingJson).drawing)
      if (!got || writeDrawing(decodeDrawing(new TextDecoder().decode(got.data)).drawing) !== was) throw new Error("the drawing differs")
    } else if (entry(WM_DRAWING)) throw new Error("a drawing appeared from nowhere")
    if (back.manifest.id !== wm.manifest.id) throw new Error("the id differs")
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined)
    throw new Failure(`the new note did not read back the same (${error instanceof Error ? error.message : String(error)}); it was taken away`)
  }
  // The note keeps its own time: "newest first" and a sync client see no change in what was only converted.
  await fs.utimes(target, stat.atime, stat.mtime).catch(() => undefined)
  return { note, newFile: target, sidecar: sidecar?.file ?? null, bytes, digest }
}

class SkipNote extends Error {}
class Failure extends Error {}

// MARK: - Moving to the backup

/** A file or folder to a new place, `rename` when it is on the same disk and verified copy-then-remove when it is not. */
async function move(from: string, to: string, rename: (a: string, b: string) => Promise<void>): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true })
  try {
    await rename(from, to)
    return
  } catch (error) {
    if (!["EXDEV", "EPERM", "EACCES", "ENOTEMPTY"].includes(codeOf(error)) && !String(error).includes("EXDEV")) throw error
  }
  await copyVerified(from, to)
  await fs.rm(from, { recursive: true, force: true })
}

/** A copy that is read back and compared (SHA-256 of every file) before anyone removes the original. */
async function copyVerified(from: string, to: string): Promise<void> {
  const stat = await fs.stat(from)
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true })
    for (const name of await fs.readdir(from)) await copyVerified(path.join(from, name), path.join(to, name))
    return
  }
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.copyFile(from, to)
  const handle = await fs.open(to, "r+")
  try { await handle.sync() } finally { await handle.close() }
  const [a, b] = [sha256(await fs.readFile(from)), sha256(await fs.readFile(to))]
  if (a !== b) throw new Error(`the copy of ${from} is not the same bytes`)
}

/** Where a folder's backup goes first: beside it. (Inside it, when the parent cannot be written: `backupFolder`.) */
export const plannedBackup = (folder: string, now: Date): string =>
  path.join(path.dirname(folder), `${path.basename(folder)} legacy backup ${stampOf(now)}`)

/** A backup folder beside the project folder, else inside it. Made when first asked for. */
async function backupFolder(folder: string, now: Date): Promise<string> {
  const stamp = stampOf(now)
  const beside = plannedBackup(folder, now)
  try {
    await fs.mkdir(beside, { recursive: false })
    return beside
  } catch (error) {
    // The same second twice (a second run) is the same folder; a FILE of that name in the way is no folder to use.
    if (codeOf(error) === "EEXIST" && (await fs.stat(beside).catch(() => null))?.isDirectory()) return beside
    const inside = path.join(folder, ".writemind", "legacy", stamp)
    await fs.mkdir(inside, { recursive: true })
    return inside
  }
}

// MARK: - The sessions

/** Every JSON string equal to an old path made the new one (a key too); the text of a file that is not JSON is left alone. */
export function rewriteExactPaths(text: string, mapping: ReadonlyMap<string, string>): string | null {
  try { JSON.parse(text) } catch { return null }
  let changed = false
  const next = text.replace(/"(?:[^"\\]|\\.)*"/g, (literal) => {
    let value: unknown
    try { value = JSON.parse(literal) } catch { return literal }
    if (typeof value !== "string") return literal
    const to = mapping.get(fold(value))
    if (to === undefined || to === value) return literal
    changed = true
    return JSON.stringify(to)
  })
  return changed ? next : null
}

/**
 * The remembered sessions (and every other JSON in the user-data folder that names a note: the tablet sheets' bindings)
 * follow the notes that were converted. Text a session held that had not reached a legacy note's file is kept with the
 * note: re-keyed to the `.wm` when the legacy file is still what the text was an edit of, else kept in the backup's
 * `unsaved/` and taken out of the session (never discarded).
 */
async function followSessions(userData: string, converted: readonly { from: string; to: string; text: string; relative: string }[],
  backup: (note: string) => Promise<string>, rewrite: (text: string, note: string) => string):
  Promise<{ note: string; file: string }[]> {
  const mapping = new Map(converted.map((one) => [fold(one.from), one.to] as const))
  const facts = new Map(converted.map((one) => [fold(one.from), one] as const))
  const aside: { note: string; file: string }[] = []
  const folders = [userData, ...(await fs.readdir(userData, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() === "sessions").map((entry) => path.join(userData, entry.name))]
  for (const folder of folders) {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue
      const file = path.join(folder, entry.name)
      const text = await fs.readFile(file, "utf8").catch(() => null)
      if (text === null) continue
      let value = text
      // Unsaved text first (its keys are the old paths).
      try {
        const session = JSON.parse(value) as { unsavedBuffers?: Record<string, { text?: unknown; base?: unknown }> }
        const buffers = session.unsavedBuffers
        if (buffers && typeof buffers === "object") {
          let touched = false
          for (const [key, buffer] of Object.entries(buffers)) {
            const fact = facts.get(fold(key))
            if (!fact || typeof buffer?.text !== "string") continue
            touched = true
            // The page's own copy of a CRLF note has "\n" lines: the base it recorded is of either spelling of the file's text.
            const still = buffer.base === null || buffer.base === undefined
              || buffer.base === textFingerprint(fact.text) || buffer.base === textFingerprint(fact.text.replace(/\r\n?/g, "\n"))
            if (!still) {
              const folderOf = path.join(await backup(fact.from), "unsaved")
              await fs.mkdir(folderOf, { recursive: true })
              // (Never over an earlier one: two notes of one name, or two sessions holding the same note.)
              let where = path.join(folderOf, `${path.basename(fact.from)}.unsaved.txt`)
              for (let n = 2; ; n++) {
                try { await fs.writeFile(where, buffer.text, { flag: "wx" }); break } catch (error) {
                  if (codeOf(error) !== "EEXIST") throw error
                  where = path.join(folderOf, `${path.basename(fact.from)}.unsaved ${n}.txt`)
                }
              }
              aside.push({ note: fact.from, file: where })
              delete buffers[key]
            } else {
              const rewritten = rewrite(buffer.text, fact.from)
              buffer.text = rewritten
              buffer.base = textFingerprint(rewrite(fact.text, fact.from))
            }
          }
          if (touched) value = JSON.stringify(session)
        }
      } catch { /* not a session */ }
      const next = rewriteExactPaths(value, mapping)
      if (next !== null || value !== text) {
        try { await writeFileAtomic(file, next ?? value) } catch { /* the session is a cache: the next write makes it again */ }
      }
    }
  }
  return aside
}

// MARK: - The whole run

/**
 * Convert the notes under `folders`. Never throws for one note's trouble; returns what was done. `folders` that are not
 * there, or are refused by `options.refuse`, are listed in `refused` and left alone.
 */
export async function convertFolders(folders: readonly string[], options: ConvertOptions): Promise<ConvertReport> {
  const report = emptyReport()
  const log = options.log ?? (() => undefined)
  const now = options.now ?? new Date()
  const app: AppStamp = { name: "WriteMind", version: options.appVersion }
  const rename = options.rename ?? ((a: string, b: string) => fs.rename(a, b))
  const excluded = options.excluded ?? []

  // The folders, each once, and what is under each (the guard is asked of every folder the walk enters).
  const mine: string[] = []
  const walked = new Map<string, Found>()
  for (const folder of folders) {
    const full = path.resolve(folder)
    if (mine.some((one) => same(one, full))) continue
    const stat = await fs.stat(full).catch(() => null)
    if (!stat?.isDirectory()) continue
    const why = options.refuse ? await options.refuse(full) : null
    if (why !== null) { report.refused.push({ folder: full, reason: why }); log(`${full} is not converted: ${why}`); continue }
    const found = newFound()
    await walk(full, { excluded, ...(options.refuse ? { refuse: options.refuse } : {}) }, found)
    for (const one of found.kept) {
      // A git working tree is only worth a word when it holds notes that would have been converted.
      if (one.reason === GIT_REASON) {
        const probe = newFound()
        await walk(one.folder, { excluded, countGit: true, ...(options.refuse ? { refuse: options.refuse } : {}) }, probe)
        if (probe.notes.length === 0) continue
      }
      report.refused.push(one)
      log(`${one.folder} is not converted: ${one.reason}`)
    }
    // A folder that is not the app's own notes is converted only when the person has said yes to it (once, remembered by the caller).
    if (found.notes.length > 0 && options.confirm && !(await isWithin(full, options.root, process.platform))) {
      if (!(await options.confirm(full, found.notes.length, plannedBackup(full, now)))) { log(`${full} is left alone: not confirmed`); continue }
    }
    mine.push(full)
    walked.set(fold(full), found)
  }

  // Pass 0 and 1: every legacy note, what an earlier run made of it, and every note's new name.
  const notes: Legacy[] = []
  const owned = new Map<string, { name: string; sha256: string }[]>()
  for (const folder of mine) {
    const found = walked.get(fold(folder))!
    report.txt += found.txt
    for (const directory of found.unlisted) {
      report.failed.push({ note: directory, reason: "this folder could not be read, so the notes in it were not looked at; it is looked at again at the next launch" })
      log(`${directory} could not be listed`)
    }
    for (const file of found.notes) {
      if (notes.some((one) => same(one.file, file))) continue
      notes.push({ file, folder, relative: slashes(path.relative(folder, file)) })
    }
  }
  const taken = new Map<string, Set<string>>()
  for (const directory of new Set(notes.map((one) => path.dirname(one.file)))) {
    taken.set(fold(directory), new Set(await fs.readdir(directory).catch(() => [] as string[])))
    const made = await earlier(directory)
    for (const [source, list] of made) owned.set(`${fold(directory)}\u0000${source}`, list)
  }
  // (Names are kept per note path relative to its own folder, and a folder is its ABSOLUTE place: two project folders may
  // hold the same relative path.)
  const key = (note: Legacy): string => `${fold(note.folder)}\u0000${note.relative}`
  const ownNames = new Map<string, string>()
  const bytesOf = new Map<string, Buffer>()
  const alreadyDone = new Set<string>()
  for (const note of notes) {
    const bytes = await fs.readFile(note.file).catch(() => null)
    if (!bytes) continue
    bytesOf.set(note.file, bytes)
    const list = owned.get(`${fold(path.dirname(note.file))}\u0000${note.relative}`)
    const digest = sha256(bytes)
    const hit = list?.find((one) => one.sha256 === digest)
    if (hit) { ownNames.set(key(note), hit.name); alreadyDone.add(note.file) }
  }
  const names = new Map<string, string>()
  for (const folder of mine) {
    const here = notes.filter((one) => same(one.folder, folder))
    const own = new Map(here.filter((one) => alreadyDone.has(one.file)).map((one) => [one.relative, ownNames.get(key(one))!] as const))
    const given = newNames(here.map((one) => ({ relative: one.relative })),
      (directory) => taken.get(fold(directory === "" ? folder : path.join(folder, directory))) ?? new Set(), own)
    for (const [relative, name] of given) names.set(`${fold(folder)}\u0000${relative}`, name)
  }
  const nameOf = (note: Legacy): string => names.get(key(note))!
  const context: Context = { options, notes, nameOf, folders: mine, backupMedia: await backupMediaOf(mine), now, app }

  // Pass 2: the notes. A link may name a note of another folder of the run, so notes are found by absolute path.
  const done: Done[] = []
  let finished = 0
  options.progress?.(0, notes.length)
  for (const note of notes) {
    if (alreadyDone.has(note.file)) {
      report.already++
      const bytes = bytesOf.get(note.file)!
      done.push({ note, newFile: path.join(path.dirname(note.file), nameOf(note)), bytes, digest: sha256(bytes),
        sidecar: (await sidecarOf(note.folder, options.root, note.file).catch(() => null))?.file ?? null })
    } else {
      try {
        done.push(await convertNote(note, context))
        log(`converted ${note.file}`)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (error instanceof SkipNote) report.skipped.push({ note: note.file, reason })
        else report.failed.push({ note: note.file, reason })
        log(`${note.file} was left as it is: ${reason}`)
      }
    }
    options.progress?.(++finished, notes.length)
  }

  const backups = new Map<string, string>()
  const backupOf = async (folder: string): Promise<string> => {
    const k = fold(folder)
    let got = backups.get(k)
    if (!got) { got = await backupFolder(folder, now); backups.set(k, got); report.backups.push(got) }
    return got
  }
  const folderOfNote = (file: string): string => notes.find((one) => one.file === file)!.folder

  // The sessions follow BEFORE anything is moved: a run cut short after this leaves sessions that name notes that exist
  // (the `.wm` is made and verified), where the other order left them naming files that were gone.
  if (options.userData && done.length > 0) {
    const facts = done.map((one) => ({
      from: one.note.file, to: one.newFile, relative: one.note.relative, text: textOf(new Uint8Array(one.bytes)),
    }))
    try {
      report.setAside.push(...await followSessions(options.userData, facts, (note) => backupOf(folderOfNote(note)),
        (text, note) => rewriteLegacyText(text, {
          link: (file) => {
            const hit = linkedNote(notes.map((one) => one.file), note, file)
            const target = hit === null ? undefined : notes.find((one) => one.file === hit)
            return target ? nameOf(target) : null
          },
        })))
    } catch (error) { log(`the sessions could not follow the notes: ${String(error)}`) }
  }

  // Pass 3: the originals, and what they used, into the backups (only now: every note has had its look at the pictures).
  for (const folder of mine) {
    const mineDone = done.filter((one) => same(one.note.folder, folder))
    if (mineDone.length === 0) continue
    const backup = await backupOf(folder)
    // Every legacy note under the folder, the ones left out of the project and the ones not walked included: `.drawings` is
    // the folder's, and any note that was not converted may still be using it.
    const everything = newFound()
    await walk(folder, { excluded: [], everything: true }, everything)
    const allConverted = everything.notes.length === mineDone.length && everything.txt === 0 && everything.unlisted.length === 0
      && walked.get(fold(folder))!.unlisted.length === 0
    const order = await fs.readFile(path.join(folder, ".writemind", "order.json"), "utf8").catch(() => null)
    if (order !== null) {
      await fs.mkdir(path.join(backup, ".writemind"), { recursive: true })
      await fs.copyFile(path.join(folder, ".writemind", "order.json"), path.join(backup, ".writemind", "order.json"))
    }
    // The notes, each to its place in the mirror; the sidecars they used.
    const moved: Done[] = []
    for (const one of mineDone) {
      const to = path.join(backup, ...one.note.relative.split("/"))
      try {
        // The original is looked at again: one changed since it was read has words the new note does not have, and it is not
        // ours to archive as "exactly as it was". It stays; the next launch converts it as a note of its own.
        const current = await readOrAbsent(one.note.file)
        if (current === null) {
          report.failed.push({ note: one.note.file, reason: "it was moved or removed while it was being converted, so there is no original to put in the backup" })
          continue
        }
        if (sha256(current) !== one.digest) {
          report.failed.push({ note: one.note.file, reason: "it was changed while it was being converted, so it was left where it is; the next launch converts it again, as a note of its own" })
          continue
        }
        await move(one.note.file, to, rename)
        moved.push(one)
        if (!alreadyDone.has(one.note.file)) report.converted.push({ from: one.note.file, to: one.newFile, backup: to })
      } catch (error) {
        report.failed.push({ note: one.note.file, reason: `the new note is made, but the original could not be moved to the backup (${codeOf(error) || String(error)}); it will be moved on the next launch` })
      }
    }
    const drawings = path.join(folder, ".drawings")
    if (await exists(drawings)) {
      if (allConverted && moved.length === mineDone.length) {
        try { await move(drawings, path.join(backup, ".drawings"), rename) } catch (error) {
          report.failed.push({ note: drawings, reason: `the .drawings folder could not be moved to the backup (${codeOf(error) || String(error)})` })
        }
      } else {
        // A copy for the backup; the sidecars the converted notes used are then moved (they are in the copy), the rest stay.
        try {
          await copyVerified(drawings, path.join(backup, ".drawings"))
          for (const one of moved) {
            if (one.sidecar && same(path.dirname(one.sidecar), drawings)) await fs.rm(one.sidecar, { force: true })
          }
        } catch (error) {
          report.failed.push({ note: drawings, reason: `the .drawings folder could not be copied to the backup (${codeOf(error) || String(error)})` })
        }
      }
    }
    // The oldest place (the notes root's .drawings) is copied for the sidecars these notes used, and not moved: other projects share it.
    for (const one of moved) {
      if (one.sidecar && !same(path.dirname(one.sidecar), drawings) && await exists(one.sidecar)) {
        try { await copyVerified(one.sidecar, path.join(backup, ".drawings-root", path.basename(one.sidecar))) } catch { /* it stays where it is */ }
      }
    }
    // The order file follows the new names.
    if (order !== null) {
      try {
        const parsed = JSON.parse(order) as NoteOrder & Record<string, unknown>
        if (parsed && typeof parsed === "object" && parsed.folders && typeof parsed.folders === "object") {
          for (const one of moved) {
            const directory = orderKey(path.dirname(one.note.file), folder)
            const list = parsed.folders[directory]
            if (!Array.isArray(list)) continue
            const was = path.basename(one.note.file)
            const now = path.basename(one.newFile)
            parsed.folders[directory] = list.map((name) => (name === was ? now : name))
          }
          await writeFileAtomic(path.join(folder, ".writemind", "order.json"), JSON.stringify(parsed, null, 2))
        }
      } catch { /* the order is a convenience: the old names simply sort last */ }
    }
  }

  // The receipt, in each backup.
  for (const backup of report.backups) {
    const lines = [
      `WriteMind converted these notes to .wm files on ${now.toString()}.`,
      "Everything here is the original, exactly as it was: nothing in this folder is needed any more, and nothing deletes it.",
      "", ...report.converted.filter((one) => one.backup && one.backup.startsWith(backup)).map((one) => `${one.from}  ->  ${one.to}`),
    ]
    if (report.skipped.length > 0) lines.push("", "Left as they were:", ...report.skipped.map((one) => `${one.note}: ${one.reason}`))
    if (report.failed.length > 0) lines.push("", "Not finished:", ...report.failed.map((one) => `${one.note}: ${one.reason}`))
    const aside = report.setAside.filter((one) => one.file.startsWith(backup))
    if (aside.length > 0) lines.push("", "Unsaved text that was kept apart (the note had changed since it was typed):", ...aside.map((one) => `${one.note}: ${one.file}`))
    await fs.writeFile(path.join(backup, "WriteMind conversion.txt"), `${lines.join("\n")}\n`).catch(() => undefined)
  }
  return report
}

// MARK: - One markdown file opened from outside

/**
 * A plain `.md` the person opened or dropped on the window: it becomes a NEW `.wm` beside it, made as the conversion
 * makes one (its `.drawings` pictures and drawing, if it has any beside it, come inside; its text is rewritten the same
 * way), and the original is NOT touched, not moved and not rewritten. Opening the same unchanged file again opens the
 * note made the first time. Returns the `.wm`'s path; throws with the reason when the file is not UTF-8 text.
 */
export async function importMarkdownNote(file: string, options: Pick<ConvertOptions, "appVersion" | "now" | "log" | "refuse">): Promise<string> {
  const folder = path.dirname(file)
  // (A `.md` in the Swift app's folder gets no `.wm` beside it: that folder is not this app's to add files to.)
  const why = options.refuse ? await options.refuse(folder) : null
  if (why !== null) throw new Error(why)
  const note: Legacy = { file, folder, relative: path.basename(file) }
  const bytes = await fs.readFile(file)
  const digest = sha256(bytes)
  const made = (await earlier(folder)).get(note.relative)?.find((one) => one.sha256 === digest)
  if (made) return path.join(folder, made.name)
  const taken = new Set(await fs.readdir(folder))
  const name = newNames([{ relative: note.relative }], () => taken).get(note.relative)!
  const context: Context = {
    options: { root: folder, appVersion: options.appVersion, ...(options.now ? { now: options.now } : {}), ...(options.log ? { log: options.log } : {}) },
    notes: [note], nameOf: () => name, folders: [folder], backupMedia: [], now: options.now ?? new Date(), app: { name: "WriteMind", version: options.appVersion },
  }
  try {
    return (await convertNote(note, context)).newFile
  } catch (error) {
    if (error instanceof SkipNote || error instanceof Failure) throw new Error(error.message)
    throw error
  }
}

/**
 * A MarkdownNote (`.mdwm`: the words of a note as a file of its own) opened from outside: a NEW `.wm` beside it holding those
 * words, the original untouched. Throws with the reason when the file is not UTF-8 text.
 */
export async function importMdwmNote(file: string, options: Pick<ConvertOptions, "appVersion" | "now" | "refuse">): Promise<string> {
  const folder = path.dirname(file)
  const why = options.refuse ? await options.refuse(folder) : null
  if (why !== null) throw new Error(why)
  const bytes = await fs.readFile(file)
  let text: string
  try { text = strict.decode(bytes) } catch { throw new Error("it is not UTF-8 text") }
  const stat = await fs.stat(file)
  const taken = new Set(await fs.readdir(folder))
  const base = path.basename(file, path.extname(file))
  let name = `${base}.wm`
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}.wm`
  const target = path.join(folder, name)
  const app: AppStamp = { name: "WriteMind", version: options.appVersion }
  await createFile(target, newWmFile(stat.mtime, app, text, uuidV5(`${sha256(bytes)}:${path.basename(file)}`)), stat.mtime)
  return target
}

// MARK: - What the person is told

/**
 * The notice: what was converted and where the backup is, what was left and why (folders that were not looked at, notes
 * that could not be converted, text that was kept apart, `.txt` files that are not shown). Null when there is nothing to say.
 * A test instance's refusals and a switched-off conversion are not the person's business and are not said; `.txt` files
 * are counted whenever something else is said (and alone they are not worth a notice at every launch).
 */
export function conversionNotice(report: ConvertReport): string | null {
  const count = report.converted.length
  const parts: string[] = []
  if (count > 0) {
    parts.push(`${count} ${count === 1 ? "note was" : "notes were"} converted to WriteMind's new .wm format. `
      + `The originals are kept, unchanged, in ${report.backups.length === 1 ? report.backups[0] : report.backups.join(" and ")}.`)
  }
  if (report.skipped.length > 0) {
    parts.push(`${report.skipped.length} could not be converted and ${report.skipped.length === 1 ? "was" : "were"} left as ${report.skipped.length === 1 ? "it was" : "they were"} `
      + `(${report.skipped.map((one) => path.basename(one.note)).join(", ")}).`)
  }
  if (report.failed.length > 0) {
    parts.push(`${report.failed.length} ${report.failed.length === 1 ? "was" : "were"} not finished: ${report.failed.map((one) => `${path.basename(one.note)} (${one.reason})`).join("; ")}.`)
  }
  if (report.setAside.length > 0) {
    parts.push(`Text that had been typed and not saved in ${report.setAside.map((one) => path.basename(one.note)).join(", ")} `
      + `had no unchanged note to go back into, so it was kept apart, in ${[...new Set(report.setAside.map((one) => path.dirname(one.file)))].join(" and ")}.`)
  }
  const refused = report.refused.filter((one) => !/^(conversion is turned off|a test instance)/.test(one.reason))
  if (refused.length > 0) {
    parts.push(`${refused.length === 1 ? "A folder was" : `${refused.length} folders were`} not converted: `
      + `${refused.map((one) => `${path.basename(one.folder) || one.folder} (${one.reason})`).join("; ")}.`)
  }
  if (report.txt > 0 && parts.length > 0) {
    parts.push(`${report.txt} plain .txt ${report.txt === 1 ? "file was" : "files were"} left alone and ${report.txt === 1 ? "is" : "are"} not shown.`)
  }
  return parts.length > 0 ? parts.join(" ") : null
}

export { CONVERTED_EXTENSIONS }
