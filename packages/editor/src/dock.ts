/**
 * Docking, the editor's half (docs\PLAN-docking-ink-cells.md (c), (d)): where the input cursor is as a seam, what is
 * under a dragged selection, and the ONE edit that writes a cell's line into the note.
 *
 * Sean (2026-09-22): "add a button for floating elements to dock them to a cell wherever the input cursor is.. or drag
 * that button to get an interactive mouse cursor that puts the image wherever i release the mouse button.. either
 * between cells or in an existing cell". The click docks at `cursorSeam`; the drag asks `dropTargetAt` as the pointer
 * moves and shows it with `showDropTarget`; both write with `insertCellLine`. What is docked (a picture line, or an
 * ink cell's line and its sidecar item) is the app's (renderer/dock.ts).
 */

import { isolateHistory } from "@codemirror/commands"
import { EditorSelection, type EditorState, type StateEffect, type TransactionSpec } from "@codemirror/state"
import type { Command, EditorView } from "@codemirror/view"
import { firstCellFromBy, type CellKind } from "@writemind/core"
import { inkCellPlaces } from "./inkCellRegistry"
import { notebook } from "./notebook"
import { armedField, armSeam, dropBarField, openCellAt, seamAfterCellAt, seamAtY, showDropBar } from "./seams"

export { showDropBar } from "./seams"

/** Where a dragged selection would land: between two cells (a seam's offset), or into a live ink cell. */
export type DropTarget = { kind: "seam"; offset: number } | { kind: "ink"; id: string }

/**
 * The input cursor, as the seam a new cell goes in at: the armed bar if one is up, else the seam AFTER the caret's
 * cell (a picture cannot be inside a paragraph if text may not overlap it: the Mac's `dockPicture`), which is the next
 * cell's start or the note's length.
 */
export function cursorSeam(state: EditorState): number {
  const length = state.doc.length
  const armed = state.field(armedField, false) ?? null
  if (armed !== null) return Math.min(Math.max(armed, 0), length)
  const cells = notebook(state).cells
  const head = state.selection.main.head
  // The caret's cell is the last one that starts at or before it (or none, before the first): the seam is after it,
  // past any run of extra blank lines.
  let next = firstCellFromBy(cells, head + 1, (cell) => cell.range)
  while (next < cells.length && cells[next]!.block.kind === "blank") next++
  return next < cells.length ? cells[next]!.range.location : length
}

/**
 * A command that MAKES a cell, run with nothing selected in a cell that has words: the new cell goes at `cursorSeam`,
 * AFTER that cell, empty, the caret in it — Ctrl+9's rule and Ctrl+0's (Sean, 2026-10-05: "pressing an input in the
 * menu bar like code block etc should create a new cell with the cursor ready to start typing"). On an empty line, or
 * round a selection, `otherwise` (the block written there, or round what is selected).
 */
export const makesCellAfter = (kind: CellKind, otherwise: Command): Command => (view) => {
  const state = view.state
  const main = state.selection.main
  if (!main.empty || state.selection.ranges.length !== 1) return otherwise(view)
  if (state.doc.lineAt(main.head).text.trim().length === 0) return otherwise(view)
  const cells = notebook(state).cells
  const own = cells[firstCellFromBy(cells, main.head + 1, (cell) => cell.range) - 1]
  if (!own || own.block.kind === "blank" || main.head > own.range.location + own.range.length) return otherwise(view)
  openCellAt(view, cursorSeam(state), kind)
  view.focus()
  return true
}

const blank = (text: string): boolean => text.trim().length === 0

/**
 * Write `line` into the note as a cell of its own at the seam `offset` (a cell's start or the note's end; any other
 * offset is taken to the end of its line), with a blank line either side of it, and arm the bar UNDER it (after a
 * dock the bar is the cursor). One `dispatch`, its own undo step (`isolateHistory`), user event `input.dock`.
 * `effects` ride along (an ink cell's aspect, so the cell is live from its first frame). Returns where the line is.
 */
export function insertCellLine(target: { state: EditorState; dispatch(spec: TransactionSpec): void },
  line: string, offset: number, effects: readonly StateEffect<unknown>[] = []): { from: number; to: number } {
  const doc = target.state.doc
  const length = doc.length
  let at = Math.min(Math.max(0, Math.round(Number.isFinite(offset) ? offset : length)), length)
  const here = doc.lineAt(at)
  if (at !== here.from) at = here.to
  const atStart = at === here.from
  let lead = ""
  let trail = ""
  // What comes after the new line, as the first line that has words in it (its start), from `scanFrom` on.
  let scanFrom: number
  if (atStart) {
    if (at > 0 && !blank(doc.lineAt(at - 1).text)) lead = "\n"
    if (at < length) trail = blank(here.text) ? "\n" : "\n\n"
    scanFrom = here.number
  } else {
    lead = blank(here.text) ? "" : "\n\n"
    if (here.number < doc.lines) trail = blank(doc.line(here.number + 1).text) ? "" : "\n"
    scanFrom = here.number + 1
  }
  let seamOld = length
  for (let n = scanFrom; n <= doc.lines; n++) {
    const row = doc.line(n)
    if (!blank(row.text)) { seamOld = row.from; break }
  }
  const insert = lead + line + trail
  const from = at + lead.length
  const to = from + line.length
  const added = insert.length
  const seam = seamOld + added
  const newLength = length + added
  // The caret goes on the blank line under the cell (where the bar is), or ends the note.
  const caret = to < newLength ? to + 1 : to
  target.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(Math.min(caret, newLength)),
    effects: [armSeam.of(Math.min(seam, newLength)), ...effects],
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
    userEvent: "input.dock",
  })
  return { from, to }
}

/** The line's own padding inside the content box: the text column starts this far in on each side. */
const LINE_PAD = 2

/** The text column of the page, in client px: the content box less its padding and the lines' own 2px each side. */
export function columnBox(view: EditorView): { left: number; width: number } {
  const content = view.contentDOM
  const rect = content.getBoundingClientRect()
  const style = getComputedStyle(content)
  const left = parseFloat(style.paddingLeft) || 0
  const right = parseFloat(style.paddingRight) || 0
  return { left: rect.left + left + LINE_PAD, width: Math.max(1, rect.width - left - right - 2 * LINE_PAD) }
}

/**
 * What is under the pointer (client px) for a drop: a live ink cell → into it; a seam → there; a cell → the seam
 * after it (the Mac's rule). Null outside the editor's visible page.
 */
export function dropTargetAt(view: EditorView, clientX: number, clientY: number): DropTarget | null {
  const page = view.scrollDOM.getBoundingClientRect()
  if (clientX < page.left || clientX > page.right || clientY < page.top || clientY > page.bottom) return null
  const ink = inkCellPlaces.at(clientX, clientY, view.dom)
  if (ink && ink.live) return { kind: "ink", id: ink.id }
  // The page's own coordinates, as the seam layer reads them.
  const y = clientY - view.contentDOM.getBoundingClientRect().top
  const seam = seamAtY(view, y)
  if (seam) return { kind: "seam", offset: seam.offset }
  return { kind: "seam", offset: seamAfterCellAt(view, y) }
}

/** Show a drop target while a drag is on (the drop bar, or the ink cell lit), or nothing (null). */
export function showDropTarget(view: EditorView, target: DropTarget | null): void {
  const bar = target?.kind === "seam" ? target.offset : null
  if ((view.state.field(dropBarField, false) ?? null) !== bar) view.dispatch({ effects: showDropBar.of(bar) })
  for (const element of Array.from(view.dom.querySelectorAll<HTMLElement>(".wm-inkcell"))) {
    element.classList.toggle("wm-drop", target?.kind === "ink" && element.dataset.inkCell === target.id)
  }
}
