/**
 * A SINGLE NEWLINE GROWS THE CELL (Sean, 2026-10-10: "a single newline should expand the size of the cell to include the
 * line the input cursor is on"). Port-first: the Mac has no rule for it yet.
 *
 * Return at the end of a paragraph leaves the caret on a new line straight under the words, with nothing typed on it
 * yet. The parser ends a cell at its last WRITTEN line, so that empty line was in no cell: the bracket stopped above the
 * caret, the heavy "this is the cell you are typing in" light went out, the rendered page closed the block and drew a
 * ghost line under it, and the bar read the line as a seam. It is the cell's. While the caret is on it the cell takes
 * the line — its bracket, its light, its box, the cell the commands name — and when the caret goes the cell is what it
 * was: the file is never touched, and nothing is stored that undo would have to know about.
 *
 * What does NOT change is what a blank line is. Two newlines in a row still end the cell and separate it from the next,
 * so the line only grows the cell where it is not the one blank line between two cells (that one is the bar), and not
 * where it follows a blank line already (that is the next cell, the empty one being written).
 *
 * Only a paragraph, text or markdown: a line typed under it joins it, which is what makes the empty line its own. A
 * heading is one line, a list item carries on with its marker (so the new line is not empty), and a fenced block, a
 * table, a quote or a picture ends where its last line does.
 */

import { range, type Range } from "../text/range"
import type { LineSource, PositionedBlock } from "../markdown/parser"
import { firstCellFromBy } from "./selection"

export interface Growth {
  /** The cell that grows: its place in the note's cells. */
  index: number
  /** The line it takes — the one the caret is on, empty or white space — without its newline. */
  line: Range
}

/**
 * The growth the caret is the cause of: the cell above the empty line it is on, or null where it is on no such line.
 * `cells` are the note's (in order, as the parser answers); `doc` is the note as lines.
 */
export function growth(cells: readonly PositionedBlock[], doc: LineSource, caret: Range): Growth | null {
  if (caret.length !== 0 || doc.length === 0 || cells.length === 0) return null
  const line = doc.lineAt(Math.min(Math.max(caret.location, 0), doc.length))
  // Only an empty line can be the one a newline opened, and only one under the first.
  if (line.number < 2 || line.text.trim().length !== 0) return null
  // The line above is the cell's last: a blank one there means this line follows a blank line, and is the next cell's.
  const above = doc.line(line.number - 1)
  if (above.text.trim().length === 0) return null
  // The blank line that separates is the one a cell is not left without: either nothing follows this line, or the next
  // is blank too. A lone blank line between two cells is the bar's.
  if (line.number < doc.lines && doc.line(line.number + 1).text.trim().length !== 0) return null
  const index = firstCellFromBy(cells, above.to + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index] : undefined
  if (!cell || cell.block.kind !== "paragraph" || cell.range.location + cell.range.length !== above.to) return null
  return { index, line: range(line.from, line.to - line.from) }
}
