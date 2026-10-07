/**
 * The model of a `.wm` file (docs/SPEC-WM.md section 1): a list of named entries, the first of which is `mimetype`,
 * a manifest, the note's text, its drawing, its pictures and snapshots, and whatever else a newer or another program
 * put there. Pure: no file system, no ZIP. `apps/desktop/src/main/zip.ts` turns bytes into `WmEntry` lists and back.
 *
 * `openWm` is a READER (it refuses a file whose names or manifest are wrong; a newer version opens read-only), and
 * `entriesToWrite` its WRITER's other half: the whole archive's entries in the order the spec gives them, with every
 * entry the file had that this build did not touch, in the order it had them.
 */

import {
  WM_DRAWING, WM_MANIFEST, WM_MEDIA, WM_MIMETYPE, WM_SNAPSHOTS, WM_TEXT, WM_MIME, isDirectoryEntry, readNamesError, writeNamesError,
} from "./names"
import { WM_VERSION, manifestText, newManifest, parseManifest, stamped, type AppStamp, type Manifest } from "./manifest"

/** One entry of the archive: its name and its DECODED bytes. */
export interface WmEntry { name: string; data: Uint8Array }

/** A file that cannot be used: the reason is what the person is told, and the file is left alone. */
export class WmError extends Error {
  constructor(message: string) { super(message); this.name = "WmError" }
}

const decoder = new TextDecoder("utf-8", { fatal: false })
const strictDecoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

export const utf8 = (text: string): Uint8Array => encoder.encode(text)
/** UTF-8 to text, a byte-order mark taken off (a writer writes none; a reader that finds one strips it, 2.1). */
export function textOf(data: Uint8Array): string {
  const text = decoder.decode(data)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export const MIMETYPE_BYTES = utf8(WM_MIME)

/** What `mimetype` holds, byte for byte. */
const isMimetype = (data: Uint8Array): boolean =>
  data.length === MIMETYPE_BYTES.length && data.every((byte, at) => byte === MIMETYPE_BYTES[at])

/**
 * Whether the first bytes of a file say "this is a `.wm`" (1.1): `PK\3\4`, the stored method, the name `mimetype`, and
 * the media type right after it. 72 bytes are enough; fewer is no.
 */
export function sniffWm(head: Uint8Array): boolean {
  if (head.length < 72) return false
  const at = (offset: number, bytes: readonly number[]) => bytes.every((byte, i) => head[offset + i] === byte)
  return at(0, [0x50, 0x4b, 0x03, 0x04]) && at(8, [0, 0]) && at(26, [8, 0, 0, 0])
    && at(30, [...utf8(WM_MIMETYPE)]) && at(38, [...MIMETYPE_BYTES])
}

// MARK: - Compression (1.4)

/** What goes in stored (already compressed formats); everything else is deflated. */
const STORED = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "mp4", "mov", "zip"])

/** How an entry is written: `mimetype` stored, pictures that are compressed already stored, the rest deflated. */
export function methodFor(name: string): "store" | "deflate" {
  if (name === WM_MIMETYPE) return "store"
  if (name.startsWith(WM_MEDIA) || name.startsWith("attachments/")) {
    const dot = name.lastIndexOf(".")
    return dot > 0 && STORED.has(name.slice(dot + 1).toLowerCase()) ? "store" : "deflate"
  }
  return "deflate"
}

// MARK: - The file

export interface WmFile {
  manifest: Manifest
  /** The `manifest.json` bytes as they were read, written again unchanged when nothing else changed. */
  manifestData: Uint8Array
  /** The version the file said; above `WM_VERSION` it is read-only (1.8). */
  version: number
  /** Whether this build may write it: not a newer version's, and not one whose text could not be written back as it is. */
  readOnly: boolean
  /** Why it is read-only, in words the person is told (absent when it is not). */
  readOnlyWhy?: string
  /** Every entry except `mimetype` and `manifest.json` (this build writes those itself), in the order the file had them. */
  entries: WmEntry[]
}

/**
 * The file the entries make, or why not (1.1, 1.5, 1.7). Entries may be in any order, `mimetype` anywhere (a repacked
 * file), but it must be there with exactly the right content, and the manifest must be a WriteMind manifest.
 */
export function openWm(all: readonly WmEntry[]): WmFile {
  const problem = readNamesError(all.map((entry) => entry.name))
  if (problem) throw new WmError(problem)
  const real = all.filter((entry) => !isDirectoryEntry(entry.name))
  const mime = real.find((entry) => entry.name === WM_MIMETYPE)
  if (!mime) throw new WmError("this is not a WriteMind note (it has no mimetype entry)")
  if (!isMimetype(mime.data)) throw new WmError("this is not a WriteMind note (its mimetype is another type)")
  const given = real.find((entry) => entry.name === WM_MANIFEST)
  if (!given) throw new WmError("this note has no manifest.json")
  let text: string
  try { text = strictDecoder.decode(given.data) } catch { throw new WmError("manifest.json is not UTF-8") }
  const read = parseManifest(text)
  if (!read.ok) throw new WmError(read.error)
  const entries = real.filter((entry) => entry.name !== WM_MIMETYPE && entry.name !== WM_MANIFEST)
  return { manifest: read.manifest, manifestData: given.data, version: read.version, ...unwritable(read.version, entries), entries }
}

/**
 * Whether a note that READS cannot be WRITTEN, and why (it opens read-only, with the reason, and nothing ever writes it): a
 * newer version's (1.8); two names that differ only by case, or a `Manifest.json` beside `manifest.json` (every save would
 * be refused by the writer's own check, so none is tried); text or a drawing that is not valid UTF-8 (read lossily to be
 * shown, and WRITTEN BACK lossily by the first edit: the person's bytes are not ours to replace with U+FFFD).
 */
function unwritable(version: number, entries: readonly WmEntry[]): { readOnly: boolean; readOnlyWhy?: string } {
  const why = (text: string) => ({ readOnly: true, readOnlyWhy: text })
  if (version > WM_VERSION) return why("a newer WriteMind wrote this note")
  const collision = writeNamesError([WM_MIMETYPE, WM_MANIFEST, ...entries.map((entry) => entry.name)])
  if (collision) return why(collision)
  for (const name of [WM_TEXT, WM_DRAWING]) {
    const entry = entries.find((one) => one.name === name)
    if (!entry) continue
    try { strictDecoder.decode(entry.data) } catch {
      return why(`${name} is not valid UTF-8, and saving it would change the bytes that are not`)
    }
  }
  return { readOnly: false }
}

/** A new, empty note's file (its text, no drawing). */
export function newWmFile(now: Date | number, app: AppStamp, text = "", id?: string): WmFile {
  const manifest = newManifest(now, app, id)
  return {
    manifest, manifestData: utf8(manifestText(manifest)), version: WM_VERSION, readOnly: false,
    entries: [{ name: WM_TEXT, data: utf8(text) }],
  }
}

export const entryOf = (file: WmFile, name: string): WmEntry | undefined => file.entries.find((entry) => entry.name === name)

/** The note's text (`note.mdwm`), empty when the entry is not there. */
export function textOfFile(file: WmFile): string {
  const entry = entryOf(file, WM_TEXT)
  return entry ? textOf(entry.data) : ""
}

/** The drawing's JSON text, or null when there is no `drawing.json` (an empty drawing). */
export function drawingOfFile(file: WmFile): string | null {
  const entry = entryOf(file, WM_DRAWING)
  return entry ? decoder.decode(entry.data) : null
}

/** Whether two byte arrays hold the same bytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * The file with the entry `name` set to `data` (added when new), or taken away when `data` is null. The entry keeps
 * its place; a new one goes last (the writer puts it where the spec says). Returns the same object when nothing changed.
 */
export function withEntry(file: WmFile, name: string, data: Uint8Array | null): WmFile {
  const at = file.entries.findIndex((entry) => entry.name === name)
  if (data === null) {
    return at < 0 ? file : { ...file, entries: file.entries.filter((_, i) => i !== at) }
  }
  if (at >= 0) {
    if (sameBytes(file.entries[at]!.data, data)) return file
    return { ...file, entries: file.entries.map((entry, i) => (i === at ? { name: entry.name, data } : entry)) }
  }
  return { ...file, entries: [...file.entries, { name, data }] }
}

/** The text replaced (or `file` itself when it is the same text). */
export const withText = (file: WmFile, text: string): WmFile => withEntry(file, WM_TEXT, utf8(text))

/** The drawing's JSON replaced; null takes `drawing.json` away. */
export const withDrawing = (file: WmFile, json: string | null): WmFile => withEntry(file, WM_DRAWING, json === null ? null : utf8(json))

/**
 * Whether the entries of two files are the same: the same names with the same bytes (the manifest is not looked at).
 */
export function sameEntries(a: WmFile, b: WmFile): boolean {
  if (a.entries.length !== b.entries.length) return false
  const by = new Map(b.entries.map((entry) => [entry.name, entry.data] as const))
  return a.entries.every((entry) => { const other = by.get(entry.name); return other !== undefined && sameBytes(entry.data, other) })
}

/** The writer's order (1.2): the fixed ones, then `snapshots/*`, `media/*`, then the rest in the order they were. */
function rank(name: string): number {
  if (name === WM_TEXT) return 0
  if (name === WM_DRAWING) return 1
  if (name.startsWith(WM_SNAPSHOTS)) return 2
  if (name.startsWith(WM_MEDIA)) return 3
  return 4
}

/**
 * Every entry to write, in the spec's order, `mimetype` first. `stamp` (a change was made) sets the manifest's
 * `modified` and `app`; without it the manifest is written exactly as it was read. A writer refuses a name that is
 * invalid or that folds together with another (a `WmError`), and a file that is read-only (a newer version).
 */
export function entriesToWrite(file: WmFile, stamp: { now: Date | number; app: AppStamp; fileTime?: Date | number } | null):
  { entries: WmEntry[]; manifest: Manifest; manifestData: Uint8Array } {
  if (file.readOnly) throw new WmError(`${file.readOnlyWhy ?? "a newer WriteMind wrote this note"}, so it is open read-only`)
  const entries = [...file.entries]
  if (!entries.some((entry) => entry.name === WM_TEXT)) entries.push({ name: WM_TEXT, data: new Uint8Array(0) })
  const problem = writeNamesError([WM_MIMETYPE, WM_MANIFEST, ...entries.map((entry) => entry.name)])
  if (problem) throw new WmError(problem)
  const ordered = entries
    .map((entry, at) => ({ entry, at, rank: rank(entry.name) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((one) => one.entry)
  const manifest = stamp ? stamped(file.manifest, stamp.now, stamp.app, stamp.fileTime) : file.manifest
  const manifestData = stamp ? utf8(manifestText(manifest)) : file.manifestData
  return {
    manifest, manifestData,
    entries: [{ name: WM_MIMETYPE, data: MIMETYPE_BYTES }, { name: WM_MANIFEST, data: manifestData }, ...ordered],
  }
}
