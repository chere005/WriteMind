/**
 * The session: which notes are open, which one is in front, where the caret
 * was, what was folded and (the port's own) where each note was scrolled to.
 * Ported from `ProjectSession` in `WriteMind/Notes/Project.swift`.
 *
 * It is NOT in the notes folder — that stays a folder of markdown — and it is
 * not in the project. On the Mac it is a JSON file in Application Support,
 * one per project; here it is one per notes folder in the app's user-data
 * directory. The file's name is the folder's name plus a hash of its full
 * path, because two folders called the same thing in different places must
 * not share a session.
 */

export interface SessionNote {
  /** The note's path. */
  path: string
  /** Where the caret was, as a character offset. */
  caret: number
  /** The notebook sections that were closed in it. */
  collapsed: string[]
  /** Where it was scrolled to (absent in a session written before 2026-10-16, or for a note never scrolled: the caret's place). */
  scroll?: ScrollPlace
}

/**
 * WHERE A NOTE WAS SCROLLED TO (Sean, 2026-10-16: "remember scroll position when switching tabs or reopening
 * writemind"). Port-only: the Mac's `ProjectSession` keeps the caret and the folds and nothing of the scroll.
 *
 * It is the TEXT at the top of the page, not a pixel `scrollTop`: a scrollTop is only right for the very layout it was
 * read from, and what changes between leaving a note and coming back is the layout — the window resized (a paragraph
 * wraps to more lines), the other pane (the rendered page lays the same note out at another height), the note edited
 * elsewhere (lines above came or went), pictures and typeset maths that take their height only once they have loaded.
 * So the place is the offset of the first character on the top line of the page (`at`), how far that line's top is
 * above the page's top edge (`offset`, in CSS pixels: a line half scrolled off is positive, the padding over the
 * first line negative), and the first words from `at` on (`text`), which find the place again in a note that was
 * changed while it was not open. The editor (packages/editor scrollPlace.ts) reads it off the page and puts it back.
 */
export interface ScrollPlace {
  /** The offset of the first character on the top line of the page (the start of a picture or a drawn block there). */
  at: number
  /** How far above the page's top edge that line starts, in CSS pixels (negative: it starts below the edge). */
  offset: number
  /** The words from `at` to the end of its line (`placeWords`): what the place is, should `at` have moved. */
  text: string
}

/** How many characters of the top line a place keeps (`ScrollPlace.text`): enough to tell one line from another. */
export const PLACE_WORDS = 48

/**
 * The words a place keeps for `at` in `text`: from `at` to the end of its line, at most `PLACE_WORDS` characters. A
 * blank line at the top (the gap between two cells) has no words of its own, so its words run on to the end of the
 * next line that has some — still starting AT `at`, so they say where the blank line is too.
 */
export function placeWords(text: string, at: number): string {
  const from = Math.min(Math.max(0, at), text.length)
  const ahead = text.slice(from, from + PLACE_WORDS)
  const first = ahead.search(/\S/)
  if (first < 0) return ""
  const end = ahead.indexOf("\n", first)
  return end < 0 ? ahead : ahead.slice(0, end)
}

/**
 * Where a remembered place is in `text` now. Its words still at `at`: there. Else the nearest place those words are
 * (the note was changed while it was not open: lines above it came or went). Else `at`, kept inside the note. Blank
 * words (an empty line, the end of the note) are not looked for: they are everywhere.
 */
export function placeIn(text: string, place: ScrollPlace): number {
  const at = Math.min(Math.max(0, Math.floor(place.at)), text.length)
  const words = place.text
  if (words.trim().length === 0 || text.startsWith(words, at)) return at
  let best = -1
  for (let found = text.indexOf(words); found >= 0; found = text.indexOf(words, found + 1)) {
    if (best < 0 || Math.abs(found - at) < Math.abs(best - at)) best = found
    else if (found > at) break
  }
  return best >= 0 ? best : at
}

/** A place read back from a session file: anything that is not one is no place at all (the caret's place, as before it existed). */
export function readPlace(raw: unknown): ScrollPlace | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const { at, offset, text } = raw as Partial<ScrollPlace>
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) return undefined
  if (typeof offset !== "number" || !Number.isFinite(offset)) return undefined
  // (An offset is a line's height or a picture's at most: a wild one is junk, and is clamped rather than trusted.)
  return {
    at: Math.floor(at),
    offset: Math.max(-1e5, Math.min(1e5, offset)),
    text: typeof text === "string" ? text.slice(0, PLACE_WORDS) : "",
  }
}

/**
 * Text that had not reached its file when the session was written — the Mac's
 * `ProjectSession.unsavedBuffers` (Sublime's hot exit). `base` says which file
 * the text was an edit OF (a fingerprint of the disk text it started from), so
 * a launch can tell "the file is as the edit left it" from "somebody else wrote
 * to it meanwhile". The Mac keeps just the text; `base` is null when it came from there.
 */
export interface UnsavedBuffer {
  text: string
  base: string | null
}

export interface Session {
  /** The notes folder this session belongs to. */
  root: string
  /** The open notes, in tab order. */
  open: SessionNote[]
  /** The one in front. */
  active: string | null
  /** Note path -> text that had not been written when the app went away. Empty in the normal case. */
  unsavedBuffers: Record<string, UnsavedBuffer>
}

export const emptySession = (root = ""): Session => ({ root, open: [], active: null, unsavedBuffers: {} })

/** A short fingerprint of a note's text (FNV-1a, 32 bits, plus the length): "is this the text I started from?". */
export function textFingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(36)}-${text.length}`
}

/** What a launch does with one note's unsaved text. */
export type BufferDecision =
  /** The file is what the edit started from: write the text into it. */
  | { path: string; action: "apply"; text: string }
  /** The file was written by somebody else since: keep the text as a copy beside it, never over it. */
  | { path: string; action: "keep-copy"; text: string }
  /** The file already holds this text (the save made it), or the note is gone. */
  | { path: string; action: "skip" }

/**
 * Decide, for every unsaved buffer, what to do given what is on disk now
 * (`null` for a file that is not there). The Mac writes every buffer that
 * differs from the file; the port also asks whether the file moved on.
 */
export function bufferDecisions(
  buffers: Record<string, UnsavedBuffer>, onDisk: (path: string) => string | null,
): BufferDecision[] {
  const out: BufferDecision[] = []
  for (const [path, buffer] of Object.entries(buffers)) {
    const disk = onDisk(path)
    if (disk === null || disk === buffer.text) { out.push({ path, action: "skip" }); continue }
    // The Mac's rule has no base: the cached text wins. With one, a file that has moved on is not ours to overwrite.
    const ours = buffer.base === null || buffer.base === textFingerprint(disk)
    out.push(ours ? { path, action: "apply", text: buffer.text } : { path, action: "keep-copy", text: buffer.text })
  }
  return out
}

/** A file name that cannot collide and cannot contain a slash. */
export function sessionFileName(root: string): string {
  let hash = 5381n
  const mask = (1n << 64n) - 1n
  for (const byte of new TextEncoder().encode(root)) {
    hash = ((hash * 33n) & mask) ^ BigInt(byte)
  }
  const clean = root.replace(/[\\/]+$/, "")
  const stem = (clean.split(/[\\/]/).pop() ?? "").replace(/[/\\:.]/g, "-")
  return `${stem || "default"}-${hash.toString(36)}.json`
}

export const writeSession = (session: Session): string => JSON.stringify(session, null, 2)

/**
 * A session read back. Anything unreadable is the empty session, a note the
 * file no longer has is dropped by the caller (it is the disk that knows),
 * and a session saved before a field existed still loads.
 */
export function readSession(json: string | null, root = ""): Session {
  if (!json) return emptySession(root)
  try {
    const raw = JSON.parse(json) as Partial<Session> & { open?: unknown }
    const open: SessionNote[] = []
    if (Array.isArray(raw.open)) {
      for (const item of raw.open as unknown[]) {
        if (typeof item === "string") { open.push({ path: item, caret: 0, collapsed: [] }); continue }
        if (!item || typeof item !== "object") continue
        const one = item as Partial<SessionNote>
        if (typeof one.path !== "string" || one.path.length === 0) continue
        const note: SessionNote = {
          path: one.path,
          caret: typeof one.caret === "number" && one.caret >= 0 ? Math.floor(one.caret) : 0,
          collapsed: Array.isArray(one.collapsed)
            ? one.collapsed.filter((key): key is string => typeof key === "string") : [],
        }
        const scroll = readPlace(one.scroll)
        if (scroll) note.scroll = scroll
        open.push(note)
      }
    }
    const active = typeof raw.active === "string" && open.some((note) => note.path === raw.active)
      ? raw.active : (open.length > 0 ? open[open.length - 1]!.path : null)
    const unsavedBuffers: Record<string, UnsavedBuffer> = {}
    const held = (raw as { unsavedBuffers?: unknown }).unsavedBuffers
    if (held && typeof held === "object") {
      for (const [path, value] of Object.entries(held as Record<string, unknown>)) {
        if (typeof value === "string") unsavedBuffers[path] = { text: value, base: null }
        else if (value && typeof value === "object" && typeof (value as UnsavedBuffer).text === "string") {
          const base = (value as UnsavedBuffer).base
          unsavedBuffers[path] = { text: (value as UnsavedBuffer).text, base: typeof base === "string" ? base : null }
        }
      }
    }
    return { root: typeof raw.root === "string" ? raw.root : root, open, active, unsavedBuffers }
  } catch {
    return emptySession(root)
  }
}

/** The session with the notes that are gone taken out (and the front one moved if it went). */
export function surviving(session: Session, exists: (path: string) => boolean): Session {
  const open = session.open.filter((note) => exists(note.path))
  const active = open.some((note) => note.path === session.active)
    ? session.active : (open.length > 0 ? open[open.length - 1]!.path : null)
  const unsavedBuffers = Object.fromEntries(Object.entries(session.unsavedBuffers).filter(([path]) => exists(path)))
  return { ...session, open, active, unsavedBuffers }
}

/** Set or replace one open note's state, keeping the tab order. */
export function remembering(session: Session, note: SessionNote): Session {
  const at = session.open.findIndex((one) => one.path === note.path)
  const open = at < 0 ? [...session.open, note]
    : session.open.map((one, index) => (index === at ? note : one))
  return { ...session, open }
}

/** A tab closed: the note leaves, and the front one falls to its neighbour. */
export function closing(session: Session, path: string): Session {
  const at = session.open.findIndex((one) => one.path === path)
  if (at < 0) return session
  const open = session.open.filter((one) => one.path !== path)
  const active = session.active === path
    ? (open[Math.min(at, open.length - 1)]?.path ?? null) : session.active
  const unsavedBuffers = { ...session.unsavedBuffers }
  delete unsavedBuffers[path]
  return { ...session, open, active, unsavedBuffers }
}
