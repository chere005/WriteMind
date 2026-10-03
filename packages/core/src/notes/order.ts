/**
 * The hand-kept order of the rows in one folder. Ported from `NoteOrder` in
 * `WriteMind/Notes/NoteTree.swift`.
 *
 * Markdown files have no intrinsic order and a folder listing is
 * alphabetical, so a dragged row's place has to be remembered somewhere: one
 * hidden JSON file holding a list of names per folder. Anything NOT named in
 * it sorts after what is, newest first, so a note made outside WriteMind
 * still shows up — an absent name is what puts a new note at the bottom.
 */

export interface NoteOrder {
  /** Folder path relative to the notes root ("" for the root) → row names. */
  folders: Record<string, string[]>
}

export const ORDER_FILE = ".writemind/order.json"

export const emptyOrder = (): NoteOrder => ({ folders: {} })

/** The key a folder is stored under: its path relative to the root. */
export function orderKey(folder: string, root: string): string {
  // Windows paths arrive with backslashes; the key is always slash-separated
  // so order.json reads the same on every platform.
  const clean = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")
  const folderPath = clean(folder)
  const rootPath = clean(root)
  if (folderPath === rootPath) return ""
  if (!folderPath.startsWith(rootPath + "/")) return folderPath
  return folderPath.slice(rootPath.length + 1)
}

/**
 * Sort `names` by the remembered order; unknown names keep the order they
 * arrived in (the caller sorts those by date) and go last.
 */
export function arrange(order: NoteOrder, names: string[], folder: string, root: string): string[] {
  const wanted = order.folders[orderKey(folder, root)] ?? []
  const remaining = [...names]
  const out: string[] = []
  for (const name of wanted) {
    const at = remaining.indexOf(name)
    if (at >= 0) out.push(remaining.splice(at, 1)[0]!)
  }
  return [...out, ...remaining]
}

export function setOrder(order: NoteOrder, names: string[], folder: string, root: string): NoteOrder {
  return { folders: { ...order.folders, [orderKey(folder, root)]: names } }
}

/** Forget a folder that has gone, and any name inside the ones that stay. */
export function forget(order: NoteOrder, name: string, folder: string, root: string): NoteOrder {
  const key = orderKey(folder, root)
  const held = order.folders[key]
  if (!held) return order
  const left = held.filter((other) => other !== name)
  const folders = { ...order.folders }
  if (left.length === 0) delete folders[key]
  else folders[key] = left
  return { folders }
}

/**
 * A row dropped onto another row: `moving` takes `before`'s place (last when
 * there is no `before`, or it is not in the list), and is taken out of where
 * it was. This is the whole of "drag to rearrange" — the move between folders
 * is a file move, and the place is this list. Ported from `NoteStore.place`.
 */
export function placing(names: string[], moving: string, before: string | null): string[] {
  const rest = names.filter((name) => name !== moving)
  const at = before === null ? -1 : rest.indexOf(before)
  if (at < 0) return [...rest, moving]
  return [...rest.slice(0, at), moving, ...rest.slice(at)]
}

/** A name added at the end of a folder's list if it is not in it (a row moved in). */
export const appending = (names: string[], name: string): string[] =>
  names.includes(name) ? names : [...names, name]

/** Whether `candidate` is `folder` or inside it — a section cannot be dropped into itself. */
export function isInside(candidate: string, folder: string): boolean {
  const clean = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")
  const a = clean(candidate)
  const b = clean(folder)
  return a === b || a.startsWith(b + "/")
}
