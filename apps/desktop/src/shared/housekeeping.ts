/**
 * File ▸ Clean Up Unused Files… (main/housekeeping.ts, renderer/CleanUpDialog.tsx): what the main process found and
 * what the page holds that the disk does not know about yet. Pure: shared by both sides.
 */

/** What the window holds that is not on disk yet: its open notes (a drawing whose note is open is never offered) and
 * every media file name its unsaved words, drawings and undo histories mention. */
export interface Held {
  openNotes: string[]
  held: string[]
}

export const NOTHING_HELD: Held = { openNotes: [], held: [] }

export interface UnusedFile {
  path: string
  /** The project folder it is in. */
  folder: string
  /** Its path from that folder, with forward slashes (`.drawings/media/ab12.png`). */
  relative: string
  /** A drawing (sidecar) no note answers to, or a picture / ink snapshot nothing names. */
  kind: "drawing" | "media"
  size: number
  modified: number
}

export interface UnusedScan {
  files: UnusedFile[]
  bytes: number
  /** Why nothing is offered (a folder that is not there, a file that could not be read); null when the look was whole. */
  problem: string | null
  /** Unused files left alone because they changed in the last minutes (an edit may be in flight). */
  recent: number
}

export interface TrashResult {
  moved: string[]
  failed: string[]
  problem: string | null
}

/** Files changed this recently are never offered: a save, a paste or a capture may be on its way to naming them. */
export const RECENT_MS = 10 * 60 * 1000

const FILE_NAME = /[A-Za-z0-9_][A-Za-z0-9_.%~+-]*\.[A-Za-z0-9]{1,8}/g
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Every name a text could be pointing at a media file with: anything shaped like a file name (a picture's hash name,
 * a Mac UUID name, `ink-<uuid>.svg`; `%20` and friends decoded too), and `ink-<uuid>.svg` for every bare UUID (an ink
 * cell's id in a sidecar). A belt to `mediaInUse`'s braces: it reads markdown and JSON alike, damaged or not, and a
 * name kept too many costs nothing where one deleted too many loses a picture.
 */
export function namesIn(text: string): string[] {
  const out = new Set<string>()
  for (const found of text.matchAll(FILE_NAME)) {
    const name = found[0]
    out.add(name)
    if (name.includes("%")) {
      try { out.add(decodeURIComponent(name)) } catch { /* a stray % is part of the name */ }
    }
  }
  for (const found of text.matchAll(UUID)) out.add(`ink-${found[0].toLowerCase()}.svg`)
  return [...out]
}

/** Whether a name is one `namesIn` can find whole (else a sweep looks for it in the texts as it is). */
export const plainName = (name: string): boolean => /^[A-Za-z0-9_][A-Za-z0-9_.%~+-]*\.[A-Za-z0-9]{1,8}$/.test(name)

/** 812 bytes, 14 KB, 3.2 MB: what Explorer and Finder would say, near enough. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`
}

/** "3 unused files (1.2 MB) will go to the Recycle Bin". */
export const cleanUpTitle = (count: number, bytes: number, bin: string): string =>
  `${count} unused ${count === 1 ? "file" : "files"} (${formatBytes(bytes)}) will go to the ${bin}`
