/**
 * Several cells held at once — a drag down the gutter, a shift-click, a
 * cmd-click. Ported from `WriteMind/Editor/CellSelection.swift`.
 *
 * The arithmetic is here, pure, because the two panes hold a selection in
 * quite different things. What lights a bracket, what a drag reaches and
 * what a cmd-click does must not be able to differ between them, so neither
 * of them works it out.
 */

import { intersection, sameRange, type Range } from "../text/range"

/**
 * Whether a cell is picked: ONE of the selected ranges covers the whole of
 * it.
 *
 * One of them, and never their union. Two adjacent cells selected separately
 * are two picked cells, not the section around them — the union would
 * swallow the blank line between them and light every bracket out to the
 * margin.
 */
export function covers(cell: Range, selection: Range[]): boolean {
  if (cell.length <= 0) return false
  return selection.some((r) => intersection(r, cell).length === cell.length)
}

/** The picked cells, in the order the note has them. */
export function picked(cells: Range[], selection: Range[]): Range[] {
  return cells.filter((cell) => covers(cell, selection))
}

/**
 * The cells a bracket holds. A plain cell's bracket holds itself; a SECTION's
 * holds every cell under its heading, which is what an outer bracket is for.
 */
export function cellsOf(bracket: Range, cells: Range[]): Range[] {
  const inside = cells.filter((cell) => intersection(bracket, cell).length === cell.length)
  return inside.length === 0 ? [bracket] : inside
}

/**
 * Whether a bracket is HELD — and for an OUTER one that is a question about
 * the cells under it, not about its own characters. Cells picked up one at a
 * time are several ranges, so no one of them ever covers the section round
 * them; asking it of the CELLS gives both answers at once.
 */
export function holds(bracket: Range, cells: Range[], selection: Range[]): boolean {
  return cellsOf(bracket, cells).every((cell) => covers(cell, selection))
}

/** Which cell a range IS: itself first, and then whatever it overlaps. */
function indexOf(r: Range, cells: Range[]): number {
  const exact = cells.findIndex((cell) => sameRange(cell, r))
  if (exact >= 0) return exact
  return cells.findIndex((cell) => intersection(cell, r).length > 0)
}

/**
 * Every cell from one bracket to the other, both ends included — what a
 * shift-click extends over, and what a drag has passed. Either way round.
 */
export function between(one: Range, other: Range, cells: Range[]): Range[] {
  const second = indexOf(other, cells)
  if (second < 0) return []
  const first = indexOf(one, cells)
  if (first < 0) return [cells[second]!]
  return cells.slice(Math.min(first, second), Math.max(first, second) + 1)
}

/**
 * A shift-click's anchor, if it still means anything — a range stops meaning
 * that cell the moment the note under it changes, and `between` will not
 * fail on a stale one. Better one cell than the wrong six.
 */
export function anchor(held: Range | null, brackets: Range[]): Range | null {
  if (!held) return null
  return brackets.some((r) => sameRange(r, held)) ? held : null
}

/**
 * Cmd-click: the cell goes in if it was out, and out if it was in — which is
 * the only way to leave a hole in the middle of a run.
 */
export function toggling(cell: Range, selection: Range[]): Range[] {
  const at = selection.findIndex((r) => sameRange(r, cell))
  if (at >= 0) return selection.filter((_, index) => index !== at)
  return [...selection, cell].sort((a, b) => a.location - b.location)
}

/** A bracket as either pane draws it: where it runs down the page, and what it holds. */
export interface Span {
  top: number
  bottom: number
  range: Range
}

const reach = (y: number, span: Span): number =>
  y < span.top ? span.top - y : y - span.bottom

/**
 * The cell a drag is over: the bracket whose span holds that y, and otherwise
 * the NEAREST one — the pointer spends half a drag in the seams between the
 * cells, and a drag that selected nothing while it crossed one would flicker
 * the whole way down.
 */
export function cellAt(y: number, spans: Span[]): Range | null {
  const inside = spans.find((span) => y >= span.top && y <= span.bottom)
  if (inside) return inside.range
  let best: Span | null = null
  for (const span of spans) if (!best || reach(y, span) < reach(y, best)) best = span
  return best ? best.range : null
}

/**
 * The cell a drag that STARTED IN A SEAM is anchored on: the one below the
 * bar when the drag goes down, the one above it when it goes up. The bar is
 * between two cells and belongs to neither, so the direction is the only
 * thing that says which end the drag is growing from.
 */
export function cellFromSeam(y: number, goingDown: boolean, spans: Span[]): Range | null {
  if (spans.length === 0) return null
  const ordered = [...spans].sort((a, b) => a.top - b.top)
  if (goingDown) {
    const below = ordered.find((span) => span.top >= y)
    return (below ?? ordered[ordered.length - 1]!).range
  }
  const above = [...ordered].reverse().find((span) => span.bottom <= y)
  return (above ?? ordered[0]!).range
}
