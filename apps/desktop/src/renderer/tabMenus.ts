/**
 * What the tab row's menus say, as plain data (no React): the right-click menu on a tab, the list of open notes,
 * where Move to can send a note, and how far a turn of the wheel walks along the strip. Kept apart from TabBar.tsx
 * so each has a test (apps/desktop/test/tabMenus.test.ts).
 *
 * The right-click menu is the sidebar row's menu, for the same things: Rename…, Duplicate and Move to Trash… call
 * the page's own handlers, the ones the sidebar's rows call (docs/PLAN-bars-2026-10.md, P2).
 */

import type { Note } from "@writemind/core"
import type { CSSProperties } from "react"
import { shown } from "../shared/commands"
import type { MenuItem } from "./FloatingMenu"
import { fileManagerName, trashWord } from "./SidebarProject"
import type { Section } from "./wm"

/** The `title` the open-notes button carries: the way to a tab that has been scrolled off the strip. */
export const openCount = (count: number): string => (count === 1 ? "1 open note" : `${count} open notes`)

/** One place Move to can send a note: a project folder or a section in one, indented to its depth in the tree. */
export interface MoveTarget {
  path: string
  name: string
  /** 0 for a project's own folder, 1 for a section in it, and so on. */
  depth: number
  /** The note is already here: the row is greyed. */
  here: boolean
}

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "")

/**
 * Every folder a note can be moved to, in the order the sidebar shows them (a folder, then what is inside it).
 * A project of several folders has no folder of its own, so its folders are the roots; one folder is its own root.
 * The note's own folder is marked, not removed: the menu shows where it is.
 */
export function moveTargets(root: Section | null, note: Note): MoveTarget[] {
  if (!root) return []
  const home = folderOf(note.path)
  const out: MoveTarget[] = []
  const walk = (section: Section, depth: number) => {
    out.push({ path: section.path, name: section.name, depth, here: sameFolder(section.path, home) })
    for (const child of section.sections) walk(child, depth + 1)
  }
  for (const one of root.path === "" ? root.sections : [root]) walk(one, 0)
  return out
}

/** A path is the same folder with either separator and (on a case-folding file system, which this cannot know) as typed. */
const sameFolder = (a: string, b: string): boolean => a.replace(/[\\/]+$/, "").replace(/\\/g, "/") === b.replace(/[\\/]+$/, "").replace(/\\/g, "/")

const INDENT = 12
const indented = (depth: number): CSSProperties | undefined => (depth > 0 ? { paddingLeft: depth * INDENT } : undefined)

export interface TabMenuActions {
  platform: string
  /** How many notes are open (Close Other Tabs needs a second one). */
  openCount: number
  root: Section | null
  close(path: string): void
  closeOthers(path: string): void
  reveal(path: string): void
  rename(note: Note): void
  duplicate(note: Note): void
  moveTo(note: Note, folder: string): void
  trash(note: Note): void
}

/** The right-click menu on a tab. */
export function tabMenu(note: Note, a: TabMenuActions): MenuItem[] {
  const where: MenuItem[] = moveTargets(a.root, note).map((target): MenuItem => ({
    label: target.name, disabled: target.here, labelStyle: indented(target.depth),
    onClick: () => a.moveTo(note, target.path),
  }))
  return [
    { label: "Close Tab", hint: shown("closeTab", a.platform), onClick: () => a.close(note.path) },
    { label: "Close Other Tabs", disabled: a.openCount < 2, onClick: () => a.closeOthers(note.path) },
    "-",
    { label: "Rename…", onClick: () => a.rename(note) },
    { label: "Duplicate", onClick: () => a.duplicate(note) },
    { label: "Move to", submenu: where, disabled: where.length === 0 },
    { label: `Reveal in ${fileManagerName(a.platform)}`, onClick: () => a.reveal(note.path) },
    "-",
    { label: `Move to ${trashWord(a.platform)}…`, danger: true, onClick: () => a.trash(note) },
  ]
}

/** The open notes' list: a real check column (the note in front is checked, the rest keep the column), then Close Other Tabs. */
export function openListMenu(open: readonly Note[], current: string | null, select: (note: Note) => void,
  closeOthers: (path: string) => void): MenuItem[] {
  if (open.length === 0) return [{ label: "No open notes", disabled: true }]
  return [
    ...open.map((note): MenuItem => ({ label: note.title, checked: note.path === current, onClick: () => select(note) })),
    "-",
    { label: "Close Other Tabs", disabled: current === null || open.length < 2, onClick: () => { if (current) closeOthers(current) } },
  ]
}

// MARK: - The wheel

/**
 * A wheel over the strip walks along it: one tab per notch, never more than three per event, and the strip's own
 * first visible tab is where it starts. `rights` are the tabs' right edges in order, `left` the strip's left edge;
 * the answer is the index to bring to the strip's start (the same index when there is nowhere to go).
 */
export function walkTo(rights: readonly number[], left: number, steps: number): number {
  if (rights.length === 0 || steps === 0) return 0
  const first = Math.max(0, rights.findIndex((right) => right > left + 1))
  const by = (steps > 0 ? 1 : -1) * Math.min(Math.abs(steps), 3)
  return Math.min(Math.max(first + by, 0), rights.length - 1)
}

/** What the wheel's pixels come to: whole notches (`notch` pixels each) and what is left over for the next event. */
export function wheelSteps(carried: number, delta: number, notch = 12): { steps: number; carried: number } {
  const total = carried + delta
  const steps = Math.trunc(total / notch)
  return { steps, carried: total - steps * notch }
}

// MARK: - Tooltips

/** A button's tooltip: its name and the key that does the same, then what it does (`keys` is `shown(...)`, empty when it has none). */
export const barTip = (label: string, keys: string, help: string): string =>
  `${label}${keys ? `  (${keys})` : ""}\n${help}`
