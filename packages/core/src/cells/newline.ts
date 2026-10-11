/**
 * THE SECOND NEWLINE ARMS THE BAR (Sean, 2026-10-11: "a single newline grows all those contents.. the second newline
 * should make the cursor horizontal with the + , not start the next cell"). Port-first: the Mac has no rule for it yet.
 *
 * The first Return at the end of a cell leaves the caret on a new line that is the cell's (`growth.ts`: a paragraph, a
 * heading, a fence, a rule, the new item of a list, the new line of a quote, the new row of a table). The second Return,
 * on that line, ends the cell: the line goes (and the newline before it), the document keeps exactly the blank line that
 * separates the cell from what follows (none, at the end of the note), and the bar under the cell is the cursor. What is
 * typed there opens the next cell, and the + on the bar says its kind — the bar's own rules, unchanged. It does NOT start
 * the next cell itself, which used to leave an empty block (a ghost line, an extra blank cell) sitting where the cursor was.
 *
 * Which lines are "the grown line":
 * - the empty line under a cell (`growth`);
 * - the last line of a list, a to-do list, a quote or a table when it is an item with nothing in it yet (`- `, `3. `,
 *   `- [ ] `, `> `, `|  |  |`), and the cell has other lines above it. The empty item used to be taken away and the caret left on
 *   an empty line (the old "Return on an empty item ends the list"); the bar is where the caret goes now. A cell that is
 *   nothing BUT the empty item (a list just opened from the + menu) is not ended by this: there is no cell left to be under.
 *
 * A picture or an ink cell has no line to grow: it is drawn and never typed in, so Return with the caret beside it arms the
 * bar on that side — what an arrow does there — instead of starting a cell.
 */

import { end, range, type Range } from "../text/range"
import type { LineSource, PositionedBlock } from "../markdown/parser"
import { listContinuation } from "./editing"
import { growth } from "./growth"
import { firstCellFromBy } from "./selection"

export interface ClosingReturn {
  /** The cell the bar is armed beside: its place in the note's cells (it is the same one after `remove` is taken out). */
  index: number
  /** Taken out first: the newline before the grown line and the line itself. Null where there is nothing to take (a picture). */
  remove: Range | null
  /** The bar goes under the cell (true), or above it (a picture's start). */
  below: boolean
}

/** A table row with nothing in any of its cells: only pipes and white space. */
const emptyRow = (text: string): boolean => /^\s*\|[\s|]*$/.test(text)

/** A list item or a quote line with nothing after its marker (`- `, `-`, `3. `, `> `, `- [ ] `): the item Return carried on with. */
const emptyItem = (text: string): boolean =>
  listContinuation(text) === "" || /^\s*([-+*>]|\d{1,4}[.)])\s*$/.test(text)

/**
 * What Return does with the caret where it is, when it ends the cell: or null, and the ordinary Return answers.
 * `cells` are the note's (in order, as the parser answers); `doc` is the note as lines.
 */
export function closingReturn(cells: readonly PositionedBlock[], doc: LineSource, caret: Range): ClosingReturn | null {
  if (caret.length !== 0 || doc.length === 0 || cells.length === 0) return null
  const at = Math.min(Math.max(caret.location, 0), doc.length)
  const line = doc.lineAt(at)

  // The empty line a newline opened under a cell.
  const grown = growth(cells, doc, range(at, 0))
  if (grown) {
    const above = doc.line(line.number - 1)
    return { index: grown.index, remove: range(above.to, line.to - above.to), below: true }
  }

  const index = firstCellFromBy(cells, at + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index] : undefined
  if (!cell) return null

  // A picture or an ink cell: the caret before it or after it, and the bar on that side.
  if (cell.block.kind === "picture" && cell.range.length > 0) {
    if (at === end(cell.range)) return { index, remove: null, below: true }
    if (at === cell.range.location) return { index, remove: null, below: false }
    return null
  }

  // The last line of a list, a quote or a table, with nothing in it: the item or the row Return carried the cell on with.
  if (line.number < 2 || end(cell.range) !== line.to || cell.range.location >= line.from) return null
  let empty = false
  switch (cell.block.kind) {
    case "bullets": case "dashes": case "numbered": case "todos": case "quote":
      empty = emptyItem(line.text)
      break
    case "table":
      // (Never the header or the delimiter row: those have words, or dashes.)
      empty = emptyRow(line.text) && doc.lineAt(cell.range.location).number + 1 < line.number
      break
    default:
      return null
  }
  if (!empty) return null
  const above = doc.line(line.number - 1)
  return { index, remove: range(above.to, line.to - above.to), below: true }
}
