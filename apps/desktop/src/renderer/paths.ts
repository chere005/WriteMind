/** Small path helpers for the renderer, which has no `node:path`. */

import type { Note } from "@writemind/core"
import type { Section } from "./wm"

/** Every note in a tree, flattened. */
export const notesIn = (section: Section): Note[] =>
  [...section.notes, ...section.sections.flatMap(notesIn)]

/** `folder` + a relative `file`, with `.` and `..` resolved, in the folder's own separator. */
export function joinPath(folder: string, file: string): string {
  const separator = folder.includes("\\") ? "\\" : "/"
  const parts = folder.split(/[\\/]/)
  for (const part of file.split(/[\\/]/)) {
    if (part === "" || part === ".") continue
    if (part === "..") { if (parts.length > 1) parts.pop() } else parts.push(part)
  }
  return parts.join(separator)
}

export const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "")
