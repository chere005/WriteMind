/**
 * The session: which notes are open, which one is in front, where the caret
 * was and what was folded. Ported from `ProjectSession` in
 * `WriteMind/Notes/Project.swift`.
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
        open.push({
          path: one.path,
          caret: typeof one.caret === "number" && one.caret >= 0 ? Math.floor(one.caret) : 0,
          collapsed: Array.isArray(one.collapsed)
            ? one.collapsed.filter((key): key is string => typeof key === "string") : [],
        })
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
