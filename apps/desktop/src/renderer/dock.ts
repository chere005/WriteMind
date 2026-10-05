/**
 * Docking floating objects into the note, and new ink cells (docs\PLAN-docking-ink-cells.md (d), (e)). Pure apart
 * from what it is handed: the words (`Words`), the drawing (`drawing` / `apply`) and the note's undo
 * (`DrawingHistory`, whose clock the words' history stamps from too).
 *
 * Sean, 2026-09-22: "add a button for floating elements to dock them to a cell wherever the input cursor is.. or
 * drag that button ... either between cells or in an existing cell .. text can not overlap with an image". A docked
 * picture is written into the markdown as `![](.drawings/media/<file>)` on a line of its own (a picture cell); ink,
 * several pictures, or ink and pictures become ONE ink cell (`![ink](.drawings/media/ink-<id>.svg)`, its strokes in
 * the sidecar as a `cell` item); released over an ink cell they go INTO it.
 *
 * ONE UNDO STEP: the line and the drawing change share one stamp on the note's clock (`oneStep`), so one Ctrl+Z
 * (key, menu or the pen's double tap) puts the floating objects back AND takes the line out, and Redo docks again.
 * Words first, then the drawing (the Mac's order).
 */

import {
  dockable, inkCellFrom, inkCellMarkdown, inkCellOf, mergedInto, newInkCell, pictureMarkdown, takenOut, withInkCell,
  type Column, type Drawing, type Point, type Size,
} from "@writemind/core"
import type { DrawingHistory } from "./drawingHistory"
import type { EditClock } from "./editTimeline"

/** The note's words, as docking needs them. */
export interface Words {
  /** Where a click on the dock handle puts the cell: the armed bar, else the seam after the caret's cell. */
  cursorOffset(): number
  /** Write `line` as a cell of its own at the seam `offset` (one history event); false when it could not. */
  write(line: string, offset: number): boolean
}

export interface DockDeps {
  history: DrawingHistory
  /** The whole drawing as it is now. */
  drawing(): Drawing
  /** Put a new whole drawing in (saved like any other edit; no history of its own). */
  apply(next: Drawing): void
  words: Words
  /** Folders between the note and its project folder: the `../` the written path needs. */
  depth: number
  /**
   * Told the drawing a dock is about to apply, right before its line is written (null again if the words would not
   * take it): the ink widget the line's own transaction draws must already find its cell.
   */
  ahead?(next: Drawing | null): void
}

/** The words, written with the drawing to come announced first (and taken back when they could not be written). */
function writeAhead(deps: DockDeps, next: Drawing, line: string, offset: number): boolean {
  deps.ahead?.(next)
  const done = deps.words.write(line, offset)
  if (!done) deps.ahead?.(null)
  return done
}

/**
 * The words and the drawing changed as ONE edit: the next two edits on the clock share a stamp, and whatever share is
 * left unused is let go, so it never glues the edit after. Nothing changes in the drawing when the words could not be
 * written. Returns whether the words were written.
 */
export function oneStep(clock: EditClock, words: () => boolean, drawing: () => boolean): boolean {
  clock.together(2)
  try {
    if (!words()) return false
    drawing()
    return true
  } finally {
    clock.endTogether()
  }
}

/**
 * The picked page objects docked AS a cell at the seam `offset`: one picture → a picture cell (it loses its floating
 * size, rotation and scale: a picture cell is the column's width capped at its own); anything else → one new ink
 * cell, its left edge where the ink was in the column (`column`, page px). The objects leave the page in the same
 * Undo step. False when the selection cannot be docked (shapes, arrows, text boxes) or the words would not take it.
 */
export function dockAsCell(deps: DockDeps, ids: Set<string>, pane: Size, column: Column, offset: number): boolean {
  return dockedAsCell(deps, ids, pane, column, offset) !== null
}

/** The same, returning the new ink cell's id ("" for a picture cell), or null when nothing was docked. */
export function dockedAsCell(deps: DockDeps, ids: Set<string>, pane: Size, column: Column, offset: number): string | null {
  const whole = deps.drawing()
  const kind = dockable(whole, ids)
  if (!kind) return null
  const { drawing: rest, items } = takenOut(whole, ids)
  if (items.length === 0) return null
  let line: string
  let next: Drawing
  let made = ""
  const only = items[0]!
  if (kind === "picture" && only.kind === "image") {
    line = pictureMarkdown(only.image.file, deps.depth)
    next = rest
  } else {
    const cell = inkCellFrom(items, pane, column)
    line = inkCellMarkdown(cell.id, deps.depth)
    next = withInkCell(rest, cell)
    made = cell.id
  }
  const done = oneStep(deps.history.clock,
    () => writeAhead(deps, next, line, offset),
    () => { deps.history.record(whole); deps.apply(next); return true })
  return done ? made : null
}

/**
 * The picked page objects docked INTO the live ink cell `cellId`, shown `width` px wide: their middle at `at`
 * (cell-local px), the cell growing when they pass its bottom. Drawing-only, so one `history.record`.
 */
export function dockInto(deps: DockDeps, ids: Set<string>, pane: Size, cellId: string, width: number, at: Point): boolean {
  const whole = deps.drawing()
  const cell = inkCellOf(whole, cellId)
  if (!cell || !dockable(whole, ids) || !(width > 0)) return false
  const { drawing: rest, items } = takenOut(whole, ids)
  if (items.length === 0) return false
  const merged = mergedInto(cell, items, pane, width, at)
  deps.history.record(whole)
  deps.apply(withInkCell(rest, merged))
  return true
}

/**
 * A new, EMPTY ink cell at the seam `offset`, for a column `width` px wide (`INK_DEFAULT_HEIGHT` tall): its line and
 * its sidecar item in one Undo step. Returns the new cell's id, or null when the words would not take the line.
 */
export function insertInkCell(deps: DockDeps, offset: number, width: number): string | null {
  const cell = newInkCell(width > 0 ? width : 720)
  const whole = deps.drawing()
  const next = withInkCell(whole, cell)
  const done = oneStep(deps.history.clock,
    () => writeAhead(deps, next, inkCellMarkdown(cell.id, deps.depth), offset),
    () => { deps.history.record(whole); deps.apply(next); return true })
  return done ? cell.id : null
}

/** Folder names of a path, without the file's own name; case and slashes do not matter (Windows). */
const parts = (path: string): string[] => path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter((one) => one !== "")

/**
 * How many folders lie between a note and the project folder that holds it: the `../` its picture lines need so other
 * viewers find `<projectFolder>/.drawings/media`. The deepest folder of `folders` (else `root`) that holds the note;
 * 0 when none does.
 */
export function depthOf(note: string, folders: readonly string[], root: string | null): number {
  const file = parts(note)
  const folder = file.slice(0, -1)
  let best = -1
  for (const owner of [...folders, ...(root ? [root] : [])]) {
    const own = parts(owner)
    if (own.length > folder.length || own.length <= best) continue
    if (own.every((name, index) => name.toLowerCase() === folder[index]!.toLowerCase())) best = own.length
  }
  return best < 0 ? 0 : folder.length - best
}
