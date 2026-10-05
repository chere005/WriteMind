/**
 * Questions about the sidebar's tree that have an answer without a window: kept here, away from the React file,
 * so they can be tested on their own.
 */

import type { Note } from "@writemind/core"
import { folderOf } from "./paths"
import type { Section } from "./wm"

// MARK: - The rows

/** What the list is made of, top to bottom. */
export type Row =
  | { kind: "add"; section: Section; indent: number }
  | { kind: "note"; note: Note; section: Section; indent: number }
  | { kind: "section"; section: Section; indent: number }

/** The tree as the rows that show: a section's rows follow it only while it is open. */
export function flatten(root: Section, open: Set<string>): Row[] {
  const out: Row[] = []
  const walk = (section: Section, indent: number) => {
    // The + comes FIRST, so the way to make a note is where the note
    // will appear rather than up on the bar.
    out.push({ kind: "add", section, indent })
    for (const note of section.notes) out.push({ kind: "note", note, section, indent })
    for (const child of section.sections) {
      out.push({ kind: "section", section: child, indent })
      if (open.has(child.path)) walk(child, indent + 1)
    }
  }
  walk(root, 0)
  return out
}

/**
 * A React key for each row, UNIQUE in the list. A folder that is a project folder and also lies inside another
 * project folder (Outer and Outer/Inner — the docs: "both then show, as on the Mac") is in the tree twice, once under
 * each, and so are the notes in it: two rows with one key made React keep the rows it had and add more with every
 * read of the tree (4 rows, then 8, then 12 after touching a note). The second row of a name takes `#1`, the third
 * `#2`, in the order they stand, so the keys do not move when the list is built again from the same tree.
 */
export function rowKeys(rows: readonly Row[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const base = row.kind === "add" ? `add:${row.section.path}`
      : row.kind === "section" ? `s:${row.section.path}` : `n:${row.note.path}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}#${n}`
  })
}

/**
 * The section with this path (the rows know their folder by path, so a row does not change when the tree is read
 * again). A folder inside another project folder is in the tree twice — as a project folder (depth 0) and as a
 * subsection of the other — so `depth` picks the one the row is; without it the first found.
 */
export function sectionAt(root: Section | null, path: string, depth?: number): Section | null {
  if (!root) return null
  const found = findSection(root, path, depth)
  return found ?? (depth === undefined ? null : findSection(root, path))
}
function findSection(section: Section, path: string, depth?: number): Section | null {
  if (section.path === path && (depth === undefined || section.depth === depth)) return section
  for (const one of section.sections) {
    const found = findSection(one, path, depth)
    if (found) return found
  }
  return null
}

/** Every section that has a row: the ones under the root, and a project's folders when the root is only their holder. */
export function sectionPaths(root: Section): string[] {
  const out: string[] = []
  const walk = (section: Section) => {
    for (const child of section.sections) { out.push(child.path); walk(child) }
  }
  walk(root)
  return out
}

/**
 * Whether a section row offers the Trash in edit mode: a folder INSIDE a project folder does. A project folder
 * itself does not (the Mac: `if editing, !section.isRoot`), because two clicks would put the folder and every
 * note in it in the bin. The right-click menu leaves it out for the same reason, and the main process refuses
 * it as well.
 */
export const canTrashSection = (section: Section): boolean => section.depth > 0

/**
 * The sections to open when the tree changes: every one that was not in the tree before (`seen`, which is
 * brought up to date). A section the person closed stays closed; one that went away and came back is new.
 */
export function newlySeen(root: Section, seen: Set<string>): string[] {
  // (a folder that is a project folder AND lies inside another is in the tree twice: it is one section to open)
  const all = [...new Set(sectionPaths(root))]
  const now = new Set(all)
  for (const one of seen) if (!now.has(one)) seen.delete(one)
  const fresh = all.filter((one) => !seen.has(one))
  for (const one of fresh) seen.add(one)
  return fresh
}

// MARK: - Where a new note goes

/** What New Note and New Section say when the project has no folder that is there to put them in. */
export const NO_FOLDER_TEXT =
  "None of this project’s folders is there, so a new note has nowhere to go. Plug the drive in, or use Folder ▸ Add Folder to Project…"

/**
 * The folder New Note and New Section work in when nothing says otherwise: the one the open note is in; else the
 * project's folder (one folder: the tree's root; several: the first that is there). "" when the project has no
 * folder on disk at all — and then NOTHING is made: the app's own notes folder is not a fallback, because it is
 * not in a project that was written elsewhere, and a note made there would be one the sidebar never lists.
 */
export function targetFolderOf(current: string | null, root: Section | null): string {
  if (current) return folderOf(current)
  if (!root) return ""
  return root.path !== "" ? root.path : root.sections[0]?.path ?? ""
}

// MARK: - Counting

/**
 * How many notes the tree holds. A folder that is a project folder AND lies inside another one is in the tree
 * twice (the docs: "both then show, as on the Mac"), and a note in it is still ONE note — the footer said
 * "3 notes" for a project of two. Compared case-blind where the file system is (Windows).
 */
export function distinctNotes(root: Section, caseBlind: boolean): number {
  const seen = new Set<string>()
  const walk = (section: Section) => {
    for (const note of section.notes) seen.add(caseBlind ? note.path.toLowerCase() : note.path)
    for (const one of section.sections) walk(one)
  }
  walk(root)
  return seen.size
}
