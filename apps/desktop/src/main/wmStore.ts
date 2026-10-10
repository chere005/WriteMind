/**
 * THE NOTE STORE over `.wm` files (docs/SPEC-WM.md section 1): reading a note's container, and ONE serialised writer
 * per note, so the text, the drawing, the ink snapshots and the pictures — which are all entries of one archive now —
 * always land together and never over somebody else's work.
 *
 * - Every write of a note goes through `commit(file, mutate)`. The mutations asked for while a write is in flight are
 *   taken together by the next one (a drawing save and the three snapshots that follow it are ONE archive written),
 *   applied in order to the container as it was last read or written, and the archive is written again whole: to a
 *   `.tmp` beside the note, flushed, guarded, renamed over it, the folder flushed (atomic.ts `writeNow`).
 * - THE GUARD (1.9, core `mayWrite`, over digests): the app owns a file only while the SHA-256 of the bytes on disk is
 *   the SHA-256 of the bytes it last read or wrote. Anything else — another program, a second window, a sync client, a
 *   file trashed or moved — and nothing is written: the buffer in the page is kept and the watcher brings the newer file in.
 * - What was read stays in memory (`loaded`, the last few) so that a save is the change and the entries that were
 *   there, with the compressed bytes of the unchanged ones copied as they are; what the guard needs is only the
 *   digest (`digests`), which is never forgotten while the app runs.
 * - A file of a NEWER format version (`manifest.version`) is open READ-ONLY: this module never writes it.
 *
 * No Electron in here.
 */

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import {
  WM_SNAPSHOTS, WM_MEDIA, WM_MANIFEST, WM_MIMETYPE, WM_TEXT, WmError, decodeDrawing, drawingMediaFiles, drawingOfFile, entriesToWrite,
  entryNameOf, foldedName, inkFileName, isInkId, keepUnknown, mayWrite, mediaFiles, newWmFile, openWm, textOfFile, withDrawing,
  withEntry, withText, writeNamesError, utf8, type AppStamp, type WmFile,
} from "@writemind/core"
import { codeOf, createNow, inTurn, partialOf, writeNow } from "./atomic"
import { keyOf, remember } from "./echo"
import { readZip, zipParts, ZipError } from "./zip"
import { readEntryHead } from "./zipHead"

// MARK: - The app's stamp

let app: AppStamp = { name: "WriteMind", version: "0.0.0" }
/** The version written into `manifest.app` (the shell says it at launch). */
export function setAppVersion(version: string): void { app = { name: "WriteMind", version } }
export const appStamp = (): AppStamp => app

// MARK: - What is known

/** The SHA-256 (hex) of the bytes this process last read or wrote, per note. Never forgotten while the app runs. */
const digests = new Map<string, string>()
/** The containers last read or written, the most recent last. A bounded cache: a miss is a read of the file. */
const loaded = new Map<string, WmFile>()
const KEEP = 16
const fileTimes = new Map<string, number>()

const sha256 = (parts: readonly Uint8Array[]): string => {
  const hash = createHash("sha256")
  for (const part of parts) hash.update(part)
  return hash.digest("hex")
}

function remembered(key: string, wm: WmFile | null): void {
  if (wm === null) { loaded.delete(key); return }
  loaded.delete(key)
  loaded.set(key, wm)
  while (loaded.size > KEEP) loaded.delete(loaded.keys().next().value as string)
}

/**
 * The note whose container is in front: where a picture goes when the page does not say. Only OPENING a note makes it the
 * one in front (`readDrawingText`, which the page asks for when it opens one): a read of another note (a tablet sheet
 * checking its bound note every few seconds, a link's target) is no opening, and a crop or a paste made in note A
 * once landed in the note a sheet was bound to.
 */
let front: string | null = null
export const frontNote = (): string | null => front
export function setFront(file: string | null): void { front = file }

/** Containers by the notes they were read from, the most recently used first: where a picture is looked for by name. */
const recent: string[] = []
function touched(file: string): void {
  const at = recent.indexOf(file)
  if (at >= 0) recent.splice(at, 1)
  recent.unshift(file)
  if (recent.length > 64) recent.length = 64
}

/** Forget what is held for a note (it was trashed, or moved: the new path is `moved`). */
export function forgetNote(file: string): void {
  const key = keyOf(file)
  digests.delete(key)
  loaded.delete(key)
  fileTimes.delete(key)
  const at = recent.findIndex((one) => keyOf(one) === key)
  if (at >= 0) recent.splice(at, 1)
}

/** What the digest of a name a note was moved away from is: no file's, so nothing is ever written there (a tombstone). */
const MOVED_AWAY = "moved-away"

/**
 * A note renamed or moved keeps what the app knows of it: the bytes did not change, so the digest is still true. The
 * name it left is a TOMBSTONE: a save the page still has in flight for the old name is refused as "gone", not written as
 * a new, half-empty note there. (Cleared by `createFile`, or by reading a file that is there.)
 */
export function movedNote(from: string, to: string): void {
  const a = keyOf(from)
  const b = keyOf(to)
  const digest = digests.get(a)
  const wm = loaded.get(a)
  const time = fileTimes.get(a)
  forgetNote(from)
  digests.set(a, MOVED_AWAY)
  if (digest !== undefined && digest !== MOVED_AWAY) digests.set(b, digest)
  if (wm !== undefined) remembered(b, wm)
  if (time !== undefined) fileTimes.set(b, time)
  recent.unshift(to)
}

// MARK: - Reading

/** What is on disk: its bytes and their digest, or null when there is no file. */
async function disk(file: string): Promise<{ bytes: Buffer; digest: string } | null> {
  try {
    const bytes = await fs.readFile(file)
    return { bytes, digest: sha256([bytes]) }
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") return null
    throw error
  }
}

/** The container bytes make. Throws a `WmError` or `ZipError` that says why not. */
export function parseNote(bytes: Uint8Array): WmFile {
  return openWm(readZip(bytes))
}

/** The message a refused file carries to the page. */
export const refusal = (file: string, error: unknown): Error => {
  const why = error instanceof WmError || error instanceof ZipError ? error.message : codeOf(error) || String(error)
  return new Error(`${path.basename(file)} cannot be opened as a WriteMind note: ${why}`)
}

/**
 * Read a note afresh from disk: what is there is what the app now knows (and may write over). One at a time with the
 * writes of the same note. A file that is no note leaves the note unknown to the app, so nothing is written over it.
 */
export function loadNote(file: string): Promise<WmFile> {
  return inTurn(`${file}`, async () => {
    const key = keyOf(file)
    const there = await disk(file)
    if (there === null) {
      // (What is known stays: a note that WAS there and is gone is a tombstone, and a write to it is refused as "gone"
      // instead of making a new note at the old name out of whatever the page still holds. `createFile` clears it.)
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: "ENOENT" })
    }
    let wm: WmFile
    try { wm = parseNote(there.bytes) } catch (error) {
      forgetNote(file)
      throw refusal(file, error)
    }
    digests.set(key, there.digest)
    remembered(key, wm)
    fileTimes.set(key, (await fs.stat(file).catch(() => null))?.mtimeMs ?? Date.now())
    touched(file)
    return wm
  })
}

/** The container the app holds for a note (what it last read or wrote), or null when the app has never read it. */
export function held(file: string): WmFile | null {
  return loaded.get(keyOf(file)) ?? null
}

/** The note's text, read afresh from its file. */
export async function readText(file: string): Promise<string> {
  return textOfFile(await loadNote(file))
}

/**
 * The container the FILE holds now, read and parsed and nothing else: the app's knowledge of the note (its digest, what it
 * holds) is not touched. For the things that only look (a copy, a note's state, the watcher's peek).
 */
export function freshNote(file: string): Promise<WmFile> {
  return inTurn(`${file}`, async () => {
    const there = await disk(file)
    if (there === null) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: "ENOENT" })
    try { return parseNote(there.bytes) } catch (error) { throw refusal(file, error) }
  })
}

/** How much of a note's words the search reads: a note longer than this is searched as far as here (8 MiB of text). */
export const SEARCH_TEXT_LIMIT = 8 * 1024 * 1024

/**
 * The note's WORDS as the file has them now, for the sidebar's search: the text entry alone is read and inflated (a note
 * with pictures and ink is mostly those, and a search looks at every note of the project). A look and nothing else — the
 * app's knowledge of the note (its digest, what it holds) is not touched, like `freshNote` — and in the note's own turn, so
 * it never sees a note between two of the writer's steps (the writer renames a finished file into place, so a look sees the
 * whole old note or the whole new one). A file that is no note (no end record, no text entry, a damaged directory) throws.
 */
export function lookText(file: string): Promise<string> {
  return inTurn(`${file}`, async () => {
    let found: Awaited<ReturnType<typeof readEntryHead>>
    try { found = await readEntryHead(file, WM_TEXT, SEARCH_TEXT_LIMIT) } catch (error) {
      if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") throw error
      throw refusal(file, error)
    }
    if (found === null) throw refusal(file, new Error("it has no text"))
    const text = found.head.toString("utf8")
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  })
}

/** What a look at the file's present state found: the words, the drawing, and the token that names exactly these bytes. */
export interface Peek { text: string; drawing: string | null; token: string }

/**
 * The folder watcher says a note moved: LOOK at it, without taking it as the app's own. Reading it with `loadNote` made
 * the file's new bytes the ones the app "last read", so if the person typed while the page was still deciding whether to
 * put the new words on screen, the next autosave was an edit of the OLD words and overwrote the other program's. The page
 * adopts the state (`adoptNote`) only once it has applied it.
 */
export function peekNote(file: string): Promise<Peek> {
  return inTurn(`${file}`, async () => {
    const there = await disk(file)
    if (there === null) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: "ENOENT" })
    let wm: WmFile
    try { wm = parseNote(there.bytes) } catch (error) { throw refusal(file, error) }
    return { text: textOfFile(wm), drawing: drawingOfFile(wm), token: there.digest }
  })
}

/**
 * The page has put what `peekNote` returned (`token`) on screen: the app now owns that state of the file. Only if the file
 * still has exactly those bytes (else it moved again, the watcher will say so, and nothing is taken); true when it did.
 */
export function adoptNote(file: string, token: string): Promise<boolean> {
  return inTurn(`${file}`, async () => {
    const there = await disk(file)
    if (there === null || there.digest !== token) return false
    let wm: WmFile
    try { wm = parseNote(there.bytes) } catch { return false }
    const key = keyOf(file)
    digests.set(key, there.digest)
    remembered(key, wm)
    fileTimes.set(key, (await fs.stat(file).catch(() => null))?.mtimeMs ?? Date.now())
    touched(file)
    return true
  })
}

/** What the page needs to know about a note it has open: whether it may be written. Read from the file, not from what was cached. */
export interface NoteState { readOnly: boolean; version: number; newer: boolean; why: string | null }
export async function noteState(file: string): Promise<NoteState> {
  const wm = await freshNote(file)
  return { readOnly: wm.readOnly, version: wm.version, newer: wm.version > 1, why: wm.readOnlyWhy ?? null }
}

/** The note's drawing as the app holds it (JSON text), or null: no `drawing.json`, or the note has not been read. */
export async function readDrawingText(file: string): Promise<string | null> {
  front = file
  const wm = held(file) ?? await loadNote(file)
  touched(file)
  return drawingOfFile(wm)
}

// MARK: - Writing

export type Refused = "changed" | "gone" | "unread" | "newer" | "unwritable"

export interface Committed {
  /** The archive was written (or there was nothing to change and it is as the page has it). */
  written: boolean
  /** Why nothing was written, when `written` is false. */
  refused: Refused | null
  /** The container after the change (before it, when refused). */
  wm: WmFile
}

interface Op { mutate(wm: WmFile): WmFile; done(result: Committed): void; fail(error: unknown): void }
const pending = new Map<string, { file: string; ops: Op[]; scheduled: boolean }>()

/**
 * Apply `mutate` to the note's container and write the result. Every change of a note's file comes through here.
 * Resolves when the archive holding the change is on disk (or refused, or there was nothing to change).
 */
export function commit(file: string, mutate: (wm: WmFile) => WmFile): Promise<Committed> {
  const key = keyOf(file)
  return new Promise((resolve, reject) => {
    let queue = pending.get(key)
    if (!queue) { queue = { file, ops: [], scheduled: false }; pending.set(key, queue) }
    queue.ops.push({ mutate, done: resolve, fail: reject })
    if (queue.scheduled) return
    queue.scheduled = true
    void inTurn(file, () => drain(key))
  })
}

async function drain(key: string): Promise<void> {
  const queue = pending.get(key)
  if (!queue) return
  pending.delete(key)
  const { file, ops } = queue
  const known = digests.get(key) ?? null
  try {
    const there = await disk(file)
    if (!mayWrite(there?.digest ?? null, known)) {
      const why: Refused = there === null ? "gone" : known === null ? "unread" : "changed"
      const wm = loaded.get(key) ?? newWmFile(Date.now(), app)
      for (const op of ops) op.done({ written: false, refused: why, wm })
      return
    }
    // The container to change: what the app holds, else the file (whose digest is the one the app knows), else a new note.
    let base = loaded.get(key) ?? null
    if (base === null && there !== null) {
      try { base = parseNote(there.bytes) } catch (error) { throw refusal(file, error) }
    }
    const created = base === null
    base ??= newWmFile(Date.now(), app)
    if (base.readOnly) {
      for (const op of ops) op.done({ written: false, refused: base.version > 1 ? "newer" : "unwritable", wm: base })
      return
    }
    let wm = base
    const taken: Op[] = []
    for (const op of ops) {
      try {
        const next = op.mutate(wm)
        // A write whose result the file format would refuse (two names that differ only by case) fails ALONE: it is
        // not allowed to take the text save and every other queued change down with it.
        const problem = next === wm ? null : writeNamesError([WM_MIMETYPE, WM_MANIFEST, ...next.entries.map((entry) => entry.name)])
        if (problem) throw new WmError(problem)
        wm = next
        taken.push(op)
      } catch (error) { op.fail(error) }
    }
    if (taken.length === 0) return
    if (!created && wm === base) {
      for (const op of taken) op.done({ written: true, refused: null, wm })
      return
    }
    const fileTime = fileTimes.get(key) ?? Date.now()
    const out = entriesToWrite(wm, { now: Date.now(), app, fileTime })
    const parts = zipParts(out.entries, new Date())
    const digest = sha256(parts)
    await fs.mkdir(path.dirname(file), { recursive: true })
    remember(file)
    remember(partialOf(file))
    // A note that is a SYMLINK is written through it: the new bytes go to the file it points at (beside which the temporary
    // file is made), not over the link, which a rename would replace by an ordinary file and leave the target as it was.
    const target = await fs.realpath(file).catch(() => file)
    if (target !== file) { remember(target); remember(partialOf(target)) }
    const wrote = await writeNow(target, parts, {
      durable: true,
      guard: async () => mayWrite((await disk(file))?.digest ?? null, known),
    })
    remember(file)
    if (!wrote) {
      const now = await disk(file)
      const why: Refused = now === null ? "gone" : "changed"
      for (const op of taken) op.done({ written: false, refused: why, wm: base })
      return
    }
    const next: WmFile = { ...wm, manifest: out.manifest, manifestData: out.manifestData }
    digests.set(key, digest)
    remembered(key, next)
    fileTimes.set(key, Date.now())
    touched(file)
    for (const op of taken) op.done({ written: true, refused: null, wm: next })
  } catch (error) {
    for (const op of ops) op.fail(error)
  }
}

const same = (a: string, b: string): boolean => a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n")

/**
 * The save of the note's TEXT. `written` false: the file is not ours any more (changed, gone, never read) or is a newer
 * format; `onDisk` is then the text the file has now, when it has one. The same words as the note already holds (a CRLF
 * file against a page that has `\n`) change nothing.
 */
export async function writeText(file: string, text: string): Promise<{ written: boolean; onDisk: string | null; refused: Refused | null }> {
  const out = await commit(file, (wm) => withNamedMedia(
    same(textOfFile(wm), text) && wm.entries.some((entry) => entry.name === WM_TEXT) ? wm : withText(wm, text), mediaFiles(text), file))
  if (out.written) return { written: true, onDisk: text, refused: null }
  const now = await disk(file)
  let onDisk: string | null = null
  if (now !== null) { try { onDisk = textOfFile(parseNote(now.bytes)) } catch { onDisk = null } }
  return { written: false, onDisk, refused: out.refused }
}

/** Why a refused write throws: the words the page shows. */
export const refusedMessage = (file: string, why: Refused | null): string => {
  const name = path.basename(file)
  switch (why) {
    case "newer": return `${name} was written by a newer WriteMind, so it is open read-only here`
    case "unwritable": return `${name} is open read-only here: ${held(file)?.readOnlyWhy ?? "it cannot be written back as it is"}`
    case "gone": return `${name} is not there any more, so it was not written`
    case "unread": return `${name} has not been opened by WriteMind, so it was not overwritten`
    default: return `the file ${name} changed on disk, so it was not overwritten`
  }
}

const hasItems = (json: string): boolean => {
  try {
    const parsed = JSON.parse(json) as { items?: unknown; strokes?: unknown }
    return (Array.isArray(parsed.items) && parsed.items.length > 0) || (Array.isArray(parsed.strokes) && parsed.strokes.length > 0)
  } catch { return true }
}

/**
 * The drawing's JSON into `drawing.json` — carrying what the file had that the model does not (SPEC-WM 3.6). A note
 * that never had a drawing and is given an empty one still has none (`drawing.json` is optional).
 */
export async function writeDrawingText(file: string, json: string): Promise<void> {
  const out = await commit(file, (wm) => {
    const before = drawingOfFile(wm)
    if (before === null && !hasItems(json)) return wm
    // (Pictures and snapshots the drawing names that this note does not hold yet — a copy pasted from another note — come with it.)
    return withNamedMedia(withDrawing(wm, keepUnknown(before, json)), drawingMediaFiles(decodeDrawing(json).drawing), file)
  })
  if (!out.written) throw new Error(refusedMessage(file, out.refused))
}

/**
 * An ink cell's snapshot, `snapshots/ink-<id>.svg` (written over, or left alone when `onlyIfMissing` and it is there). A new one is named with the
 * id in lower case, but a snapshot the note already holds under another SPELLING of it (a converted note's
 * `ink-<UPPER>.svg`) is that snapshot: it is written over or left alone, never given a twin that differs only by case (which
 * the file format refuses, and which once failed every change queued with it).
 */
export async function writeSnapshot(file: string, id: string, svg: string, onlyIfMissing = false): Promise<{ file: string }> {
  if (!isInkId(id)) throw new Error(`not an ink cell id: ${id}`)
  if (!/^<svg[\s>]/.test(svg)) throw new Error("not an svg")
  let name = inkFileName(id.toLowerCase())
  const out = await commit(file, (wm) => {
    const same = wm.entries.find((one) => foldedName(one.name) === foldedName(`${WM_SNAPSHOTS}${name}`))
    if (same) name = same.name.slice(WM_SNAPSHOTS.length)
    const entry = `${WM_SNAPSHOTS}${name}`
    return onlyIfMissing && same ? wm : withEntry(wm, entry, utf8(svg))
  })
  if (!out.written) throw new Error(refusedMessage(file, out.refused))
  return { file: name }
}

/** A picture's bytes into `media/<hash>.<ext>` of the note (the same picture twice is one entry: the name is its contents). */
export async function writeMedia(file: string, bytes: Uint8Array, extension: string): Promise<{ file: string }> {
  const ext = extension.replace(/^\./, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase() || "bin"
  const name = `${createHash("sha1").update(bytes).digest("hex").slice(0, 16)}.${ext}`
  const entry = `${WM_MEDIA}${name}`
  const out = await commit(file, (wm) => (wm.entries.some((one) => one.name === entry) ? wm : withEntry(wm, entry, new Uint8Array(bytes))))
  if (!out.written) throw new Error(refusedMessage(file, out.refused))
  return { file: name }
}

// MARK: - A new file

/**
 * A container written to a name nothing has (never over a file that is there: EEXIST). The app then knows it.
 * `when` is the entries' timestamp (the note's own time).
 */
export async function createFile(file: string, wm: WmFile, when: Date = new Date()): Promise<void> {
  const out = entriesToWrite(wm, { now: when, app, fileTime: when })
  const parts = zipParts(out.entries, when)
  await fs.mkdir(path.dirname(file), { recursive: true })
  remember(file)
  remember(partialOf(file))
  await inTurn(file, () => createNow(file, parts))
  remember(file)
  const key = keyOf(file)
  digests.set(key, sha256(parts))
  remembered(key, { ...wm, manifest: out.manifest, manifestData: out.manifestData })
  fileTimes.set(key, when.getTime())
  touched(file)
}

/**
 * A note's BYTES put back at a name nothing has (Undo of a trash, Redo of a New Note; main/undoJournal.ts): the exclusive
 * writer, so a name that was taken since is EEXIST and never overwritten. The app then knows them (digest and container),
 * exactly as after `createFile`. Bytes that are no note any more (a damaged `.wm` that was trashed) are put back all the
 * same and the app is told nothing about them: it will not write over a file it has not read.
 */
export async function restoreBytes(file: string, bytes: Uint8Array): Promise<void> {
  let wm: WmFile | null = null
  try { wm = parseNote(bytes) } catch { wm = null }
  await fs.mkdir(path.dirname(file), { recursive: true })
  remember(file)
  remember(partialOf(file))
  await inTurn(file, () => createNow(file, [bytes]))
  remember(file)
  if (wm === null) return
  const key = keyOf(file)
  digests.set(key, sha256([bytes]))
  remembered(key, wm)
  fileTimes.set(key, Date.now())
  touched(file)
}

/**
 * A note taken away on the strength of the app owning it (Undo of a New Note, Duplicate or Import; main/undoJournal.ts): in
 * the note's own write queue, only while the bytes on disk are exactly the bytes the app last read or wrote (the same
 * digest every save is guarded by), `keep` is handed those bytes to put somewhere safe BEFORE the file is removed.
 * "changed": the file is somebody else's now, or the app never read it, and it is left alone. "gone": nothing was there.
 * The app's digest of the name is kept, so a late save of the removed note is refused as "gone", never put back.
 */
export function takeOwned(file: string, keep?: (bytes: Uint8Array) => Promise<void>): Promise<"removed" | "changed" | "gone"> {
  return inTurn(`${file}`, async () => {
    const there = await disk(file)
    if (there === null) return "gone"
    const known = digests.get(keyOf(file)) ?? null
    if (known === null || there.digest !== known) return "changed"
    if (keep) await keep(there.bytes)
    remember(file)
    await fs.rm(file)
    remember(file)
    return "removed"
  })
}

/** A new, empty note. */
export const newNoteFile = (text = ""): WmFile => newWmFile(Date.now(), app, text)

/** `wm` with a new identity (a duplicate is another note: SPEC-WM 1.7). */
export const copyOf = (wm: WmFile): WmFile => {
  const { id: _old, ...rest } = wm.manifest
  void _old
  return { ...wm, manifest: { ...rest, id: crypto.randomUUID().toLowerCase() } as WmFile["manifest"], manifestData: new Uint8Array(0) }
}

// MARK: - Pictures by name

/**
 * A picture or snapshot of the open notes by its NAME (the name is the picture's hash, or an ink cell's id: the same
 * wherever it is): the note's own container first (`note`, else the one in front), then every other the app has read,
 * the most recent first. The name is looked for as written and, failing that, as the same name in another case (a
 * snapshot the text spells `ink-<UPPER>.svg` is the entry a writer made `ink-<lower>.svg`): a container holds no two
 * names that differ only by case, so there is one answer.
 */
export function mediaBytes(name: string, note?: string | null): Uint8Array | null {
  const entry = entryNameOf(name)
  const folded = foldedName(entry)
  const order = [note ?? front, ...recent].filter((one): one is string => !!one)
  const seen = new Set<string>()
  for (const file of order) {
    const key = keyOf(file)
    if (seen.has(key)) continue
    seen.add(key)
    const wm = loaded.get(key)
    const found = wm?.entries.find((one) => one.name === entry) ?? wm?.entries.find((one) => foldedName(one.name) === folded)
    if (found) return found.data
  }
  return null
}

/**
 * `wm` with the `media/` and `snapshots/` entries `names` call for that it does not hold, copied from the other notes the
 * app has read (`mediaBytes`: the note's own first, then the most recently used). A picture copied from note A and pasted
 * into B is an entry of B's own archive from the first save, not a thing B shows only while A is loaded.
 */
function withNamedMedia(wm: WmFile, names: readonly string[], own: string): WmFile {
  let out = wm
  for (const name of names) {
    const entry = entryNameOf(name)
    const folded = foldedName(entry)
    if (out.entries.some((one) => foldedName(one.name) === folded)) continue
    const bytes = mediaBytes(name, own)
    if (bytes) out = withEntry(out, entry, new Uint8Array(bytes))
  }
  return out
}

export const _forTests = { digests, loaded }
