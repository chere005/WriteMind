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

export interface Session {
  /** The notes folder this session belongs to. */
  root: string
  /** The open notes, in tab order. */
  open: SessionNote[]
  /** The one in front. */
  active: string | null
}

export const emptySession = (root = ""): Session => ({ root, open: [], active: null })

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
    return { root: typeof raw.root === "string" ? raw.root : root, open, active }
  } catch {
    return emptySession(root)
  }
}

/** The session with the notes that are gone taken out (and the front one moved if it went). */
export function surviving(session: Session, exists: (path: string) => boolean): Session {
  const open = session.open.filter((note) => exists(note.path))
  const active = open.some((note) => note.path === session.active)
    ? session.active : (open.length > 0 ? open[open.length - 1]!.path : null)
  return { ...session, open, active }
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
  return { ...session, open, active }
}
