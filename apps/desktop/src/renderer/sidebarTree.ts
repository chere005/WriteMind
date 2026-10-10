/**
 * Questions about the sidebar's tree that have an answer without a window: kept here, away from the React file,
 * so they can be tested on their own.
 */

import { isInside, type Note } from "@writemind/core"
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

// MARK: - Move to ▸

/** A place a note can be moved to, as the Move to menu lists it. */
export interface MoveTarget {
  path: string
  name: string
  /** How deep it is in the tree, from the project's folders (0) down: the menu indents by it. */
  depth: number
  /** The note's own section: greyed, it is where the note already is. */
  here: boolean
}

const sameFolderPath = (a: string, b: string, caseBlind: boolean): boolean => {
  const clean = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")
  return caseBlind ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b)
}

/**
 * The places a note can go, in the tree's own order, each at the depth it has there (so the menu reads as the sidebar
 * does): the project's folders, and every section inside them. The note's own folder is `here` (greyed). A folder that
 * is both a project folder and inside another is listed where it stands each time, so a person finds it where they look.
 */
export function moveTargets(root: Section | null, notePath: string, caseBlind = false): MoveTarget[] {
  if (!root) return []
  const own = folderOf(notePath)
  const out: MoveTarget[] = []
  const walk = (section: Section, depth: number) => {
    out.push({ path: section.path, name: section.name, depth, here: sameFolderPath(section.path, own, caseBlind) })
    for (const child of section.sections) walk(child, depth + 1)
  }
  if (root.path === "") for (const one of root.sections) walk(one, 0)
  else walk(root, 0)
  return out
}

// MARK: - Dropping on the add row

/** What a row dragged by the sidebar carries (`Sidebar.tsx`). */
export interface DraggedRow { kind: "note" | "section"; path: string }

/** What a drop on a section's add row does; the caller runs it. */
export type AddRowDrop =
  | { kind: "place"; file: string; folder: string; before: string | null }
  | { kind: "move-section"; folder: string; target: string }

const baseOf = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * A row dropped on a section's "New note" row: the add row is where a new note would land, at the top of the section, so a
 * dropped note lands there too — before the section's first note (null: the end, when the section has none). A note that is
 * already first in that section, and a section dropped where it already is or into itself, change nothing (null).
 */
export function addRowDrop(item: DraggedRow, section: Section, caseBlind = false): AddRowDrop | null {
  if (item.kind === "note") {
    const first = section.notes.find((one) => !sameFolderPath(one.path, item.path, caseBlind))
    const alreadyFirst = sameFolderPath(folderOf(item.path), section.path, caseBlind) && section.notes[0] !== undefined
      && sameFolderPath(section.notes[0].path, item.path, caseBlind)
    if (alreadyFirst) return null
    return { kind: "place", file: item.path, folder: section.path, before: first ? baseOf(first.path) : null }
  }
  if (isInside(section.path, item.path) || sameFolderPath(folderOf(item.path), section.path, caseBlind)) return null
  return { kind: "move-section", folder: item.path, target: section.path }
}

// MARK: - Walking the results with the arrow keys

/** The result a key moves to (the list does not wrap: Down at the last stays, Up at the first goes back to the field, −1). */
export function stepResult(active: number, key: string, count: number): number {
  if (count === 0) return -1
  if (key === "ArrowDown") return Math.min(count - 1, active + 1)
  if (key === "ArrowUp") return active <= 0 ? -1 : Math.min(count - 1, active - 1)
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return active
}
