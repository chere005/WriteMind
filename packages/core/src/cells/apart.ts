/**
 * CELLS THAT TOUCH BUT STAND APART (Sean, 2026-10-05: "this math cell should be placed as its own cell, not connected
 * to the cell before it" — a ```wl block written straight under an answer's closing fence, no blank line between).
 *
 * Two rules, one for each direction:
 *
 * - WRITING. Every command that makes a cell writes it with a blank line above it and below it, never doubling one
 *   that is already there (`cellSpacing`): the maths palette, the code block, the evaluation cell and its answer, a
 *   pasted or duplicated cell. (`insertBlock` and the dock's `insertCellLine` already did.)
 * - READING. A block that is a cell of its own by its kind (`standsAlone`: a fence — code, an evaluation cell, an
 *   answer, ```wl maths —, a table, a picture or ink line, a heading, a rule) is its own cell even where it TOUCHES
 *   the block above or below it, one line break and no blank line: it never joins a run of touching cells (the
 *   rendered page's "one thing to type in", `touchingRuns`), and both pages draw the gap a blank line would have made
 *   above it (`apartAbove`), so its bracket, its seam and its box are its own. A note written that way reads right
 *   with no edit. The parser already ends a block at such a line; this is about everything drawn from the blocks.
 *
 * The Mac: its cells are the parser's blocks, one row each with the page's gap between every two (`MarkdownPreview`'s
 * stack), so touching blocks were never one cell there; the port's touching RUN (a list carried on by Return) is
 * port-only, and so is this rule about it.
 */

import { end, type Range } from "../text/range"
import type { Block, PositionedBlock } from "../markdown/parser"

/** A kind of block that is a cell of its own with or without a blank line round it. */
export function standsAlone(block: Block | null | undefined): boolean {
  switch (block?.kind) {
    case "code": case "table": case "picture": case "heading": case "rule": return true
    default: return false
  }
}

/** Two cells that touch: the second starts on the line after the first ends, with no blank line between. */
export const touchingCells = (above: Range, below: Range): boolean =>
  above.length > 0 && below.length > 0 && below.location === end(above) + 1

/**
 * Whether the cell at `index` touches the one above it and the two stand apart (either stands alone): the cell is
 * drawn a blank line's gap below the one above, and the seam between them is that gap.
 */
export function apartAbove(cells: readonly PositionedBlock[], index: number): boolean {
  if (index <= 0 || index >= cells.length) return false
  const above = cells[index - 1]!
  const cell = cells[index]!
  return touchingCells(above.range, cell.range) && (standsAlone(above.block) || standsAlone(cell.block))
}

/** Whether the last line of `text` before its final newline is blank (or there is none): `text` ends on a blank line. */
const endsOnBlankLine = (text: string): boolean => /(^|\n)[ \t]*\n$/.test(text)

/**
 * The line breaks a cell written between `before` and `after` needs to be a cell of its own: a blank line above it
 * (none at the top of the note) and one below it (none at the end of the note), counting the breaks already there.
 */
export function cellSpacing(before: string, after: string): { lead: string; trail: string } {
  let lead: string
  if (before.length === 0 || endsOnBlankLine(before)) lead = ""
  else lead = before.endsWith("\n") ? "\n" : "\n\n"
  let trail: string
  if (after.length === 0 || /^\n[ \t]*(\n|$)/.test(after)) trail = ""
  else trail = after.startsWith("\n") ? "\n" : "\n\n"
  return { lead, trail }
}
