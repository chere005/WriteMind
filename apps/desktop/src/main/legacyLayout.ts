/**
 * WHERE 2.15.0 KEPT A NOTE'S OTHER FILES (docs/SPEC-WM.md 5.1) — what the conversion reads, and nothing else uses.
 *
 * A note was a `.md`, `.markdown` or `.txt` file; its drawing was `.drawings/<stem>-<hash of its path RELATIVE to its
 * project folder>.json` in that folder (two older places are still read: the notes root's, hashed by the ABSOLUTE
 * path, and the Mac's `<stem>.json`), and its pictures and ink snapshots were files in `<folder>/.drawings/media`.
 */

import { createHash } from "node:crypto"
import path from "node:path"
import { ownerOf } from "./notes"

export const LEGACY_EXTENSIONS = [".md", ".markdown", ".txt"] as const

/** The order the extensions are taken in when two notes would get one name (`A.md` before `A.markdown`). */
export const legacyRank = (file: string): number => LEGACY_EXTENSIONS.indexOf(path.extname(file).toLowerCase() as typeof LEGACY_EXTENSIONS[number])

export const isLegacyNote = (name: string): boolean => legacyRank(name) >= 0

/** The first `length` hex digits of the SHA-1 of `value` (UTF-8). */
export const sha1Hex = (value: string, length: number): string => createHash("sha1").update(value, "utf8").digest("hex").slice(0, length)

export const stemOf = (note: string): string => path.basename(note, path.extname(note))

/** `.drawings/<stem>-<hash of the path from the project folder>.json`, in the project folder `owner`. */
export function drawingPath(owner: string, note: string): string {
  const relative = path.relative(owner, note).replace(/\\/g, "/")
  return path.join(owner, ".drawings", `${stemOf(note)}-${sha1Hex(relative, 12)}.json`)
}

/** Where the drawing was kept before it travelled with its folder: the notes root, hashed by the absolute path. */
export const olderDrawingPath = (root: string, note: string): string =>
  path.join(root, ".drawings", `${stemOf(note)}-${sha1Hex(note, 12)}.json`)

/** The Mac's: `<stem>.json`, in the project folder. */
export const macDrawingPath = (owner: string, note: string): string => path.join(owner, ".drawings", `${stemOf(note)}.json`)

/** Every file a note's drawing can be read from, in the order they are tried. */
export const sidecarsOf = (root: string, note: string): string[] => {
  const owner = ownerOf(note, root)
  return [...new Set([drawingPath(owner, note), olderDrawingPath(root, note), macDrawingPath(owner, note)])]
}
