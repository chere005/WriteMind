/**
 * THE ARROWS WALK CELL, BAR, CELL (Sean, 2026-10-05: "pressing down arrow at the bottom of a cell should move the
 * cursor beneath the cell horizontally"). The rules, as answers about a state; `seams.ts` applies them to the view.
 *
 * - Down on the LAST line of a cell (the last line on screen: a wrapped paragraph's last row, a fenced block's closing
 *   fence, a table's last row) arms the bar in the seam beneath it — under the last cell, the bar after it. Up on the
 *   FIRST line arms the bar above it.
 * - From an armed bar, Down goes into the cell below (its first line) and Up into the cell above (its last line);
 *   Right and Left go to the start of the cell below and the end of the cell above. With no cell that way, the bar
 *   stays.
 * - A picture or ink cell is never typed in: an arrow onto it from a bar arms the bar on its far side, and an arrow
 *   with the caret beside it arms the bar on the side the arrow points to.
 * - What a closed section hides is not on the page: the cells in it are stepped over as one.
 *
 * The cells and the seams are the page's own (`notebook`, `seams.ts`): the seam beneath a cell is the next cell on
 * show, and the bar's caret waits on the blank line the bar stands on when there is one (so the bar is a reading of
 * the caret, as everywhere), else at the seam's offset with the bar armed by hand. The rendered page has its own walk
 * over drawn blocks (`preview/keys.ts`: `stepFromBar`, `vertical`) and asks `cellBeside` here for the cell beside a bar.
 */

import { armIn, cellWordsStart, end, firstCellFromBy, staysClosed, type PositionedBlock, type Range } from "@writemind/core"
import type { EditorState } from "@codemirror/state"
import { hiddenNow, insideHidden } from "./fold"
import { notebook } from "./notebook"

/** The next cell (`dir` 1) or the one before (`dir` -1) that is on show, or -1 / `cells.length` past the ends. */
export function shownBeyond(state: EditorState, cells: readonly PositionedBlock[], from: number, dir: 1 | -1): number {
  let i = from + dir
  while (i >= 0 && i < cells.length && insideHidden(state, cells[i]!.range)) {
    // A closed section hides a run of cells: jump past all of it.
    const at = cells[i]!.range.location
    const hidden = hiddenNow(state).find((r) => at > r.location && at < end(r))
    if (!hidden) { i += dir; continue }
    // (Forwards to the first cell that starts at the hidden range's end or later: a cell starting right at its end — a
    // heading on the line after the closed section's last — is on show, and `+ 1` here stepped over it.)
    i = dir > 0 ? firstCellFromBy(cells, end(hidden), (c) => c.range) : firstCellFromBy(cells, hidden.location, (c) => c.range) - 1
  }
  return i
}

/**
 * The cell on show beside the seam at `offset`: the last one that starts before it (`up`), or the first that starts
 * at or after it. `blanks: false` passes over cells of empty lines (the rendered page draws none). Null past the ends.
 */
export function cellBeside(state: EditorState, offset: number, up: boolean, blanks = true): PositionedBlock | null {
  const i = indexBeside(state, offset, up, blanks)
  return i === null ? null : notebook(state).cells[i]!
}

function indexBeside(state: EditorState, offset: number, up: boolean, blanks: boolean): number | null {
  const cells = notebook(state).cells
  const dir = up ? -1 : 1
  const first = firstCellFromBy(cells, offset, (c) => c.range)
  // The candidate itself, unless it is hidden: then the first on show beyond it.
  let i = up ? first - 1 : first
  if (i >= 0 && i < cells.length && insideHidden(state, cells[i]!.range)) i = shownBeyond(state, cells, i, dir)
  while (i >= 0 && i < cells.length && !blanks && cells[i]!.block.kind === "blank") i = shownBeyond(state, cells, i, dir)
  return i >= 0 && i < cells.length ? i : null
}

/** The cell on show the caret at `head` is in (its last line's end counts), with its index; null on a line between. */
export function cellAtCaret(state: EditorState, head: number): { cell: PositionedBlock; index: number } | null {
  const cells = notebook(state).cells
  const index = firstCellFromBy(cells, head + 1, (c) => c.range) - 1
  if (index < 0) return null
  const cell = cells[index]!
  if (head > end(cell.range) || insideHidden(state, cell.range)) return null
  return { cell, index }
}

/** The seam beneath the cell at `index`: the next cell on show, or the end of the note under the last. */
export function seamBeneath(state: EditorState, index: number): number {
  const cells = notebook(state).cells
  const next = shownBeyond(state, cells, index, 1)
  return next < cells.length ? cells[next]!.range.location : state.doc.length
}

/**
 * Where the caret waits while the bar at `offset` is armed: on the blank line just above the offset when that line
 * is the seam's own (a separator the caret there reads as this very bar, and on show), else at the offset itself —
 * the two ends of the note and two cells that touch, where the bar is armed by hand.
 */
export function barCaret(state: EditorState, offset: number): number {
  const doc = state.doc
  const at = Math.min(Math.max(offset, 0), doc.length)
  if (at > 0 && at < doc.length) {
    const line = doc.lineAt(at - 1)
    if (line.text.trim().length === 0
      && !insideHidden(state, { location: line.from, length: 0 })
      && armIn({ location: line.from, length: 0 }, doc, () => notebook(state).cells, null) === at) return line.from
  }
  return at
}

/** What an arrow does about the bar. Null: not the bar's business, and the editor's own arrow answers. */
export type BarMove =
  /** Arm the bar at `offset`; the caret waits at `caret` (`barCaret`). */
  | { kind: "arm"; offset: number; caret: number }
  /** Put the bar out and the caret at `at`, in `cell` (the caller may keep the column the caret was walking down). */
  | { kind: "caret"; at: number; cell: Range }
  /** The key is taken and nothing moves: the bar at an end of the note, with no cell that way. */
  | { kind: "stay" }
  | null

/** Arm the seam at `offset`. */
const arming = (state: EditorState, offset: number): BarMove => ({ kind: "arm", offset, caret: barCaret(state, offset) })

/**
 * Up (`up`) or Down. `armed` is the bar that is up, or null. `onEdge(head, edge)` says whether the caret at `head` is
 * on the same line ON SCREEN as `edge` — the cell's last character going down, its first going up — which only the
 * view can measure (a wrapped line is several).
 */
export function verticalMove(state: EditorState, armed: number | null, up: boolean,
  onEdge: (head: number, edge: number) => boolean): BarMove {
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) return null
  if (armed !== null) return fromBar(state, armed, up)
  const head = selection.main.head
  const here = cellAtCaret(state, head)
  // On a line between cells (a bar put out with Escape): the editor's own.
  if (!here) return null
  const { cell, index } = here
  // (A markdown cell's first line on screen is its words', the marker over them hidden: docs/PLAN-text-cells.md.)
  if (!staysClosed(cell.block) && !onEdge(head, up ? cellWordsStart(cell.block, cell.range) : end(cell.range))) return null
  return arming(state, up ? cell.range.location : seamBeneath(state, index))
}

/**
 * Off the bar at `armed` into the cell above it (`up`: its end) or below it (its start); with no cell that way the bar
 * stays. A picture or ink cell is stepped over, to the bar on its far side — Up / Down and Left / Right alike.
 */
function fromBar(state: EditorState, armed: number, up: boolean): BarMove {
  const index = indexBeside(state, armed, up, true)
  if (index === null) return { kind: "stay" }
  const cell = notebook(state).cells[index]!
  if (staysClosed(cell.block)) return arming(state, up ? cell.range.location : seamBeneath(state, index))
  return { kind: "caret", at: up ? end(cell.range) : Math.min(cellWordsStart(cell.block, cell.range), end(cell.range)), cell: cell.range }
}

/** Left (`left`) or Right at an armed bar: the end of the cell above, the start of the cell below (`fromBar`). */
export function sideMove(state: EditorState, armed: number | null, left: boolean): BarMove {
  if (armed === null) return null
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) return null
  return fromBar(state, armed, left)
}

/** Whether two boxes on screen are on one line of it: the middle of either is inside the other's height. */
export function sameLineOnScreen(a: { top: number; bottom: number }, b: { top: number; bottom: number }): boolean {
  const inside = (box: { top: number; bottom: number }, y: number) => y > box.top && y < box.bottom
  return Math.abs(a.top - b.top) < 2 || inside(b, (a.top + a.bottom) / 2) || inside(a, (b.top + b.bottom) / 2)
}
