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
 * - the last line of a TABLE when it is a row with nothing in it yet (`|  |  |`) and the table has other rows above it.
 *
 * A LIST OR A QUOTE IS NOT ENDED HERE (Sean, 2026-10-11: "exiting bullet points shouldn't exit the cell though, just add a newline
 * after it"): Return on a bullet, a numbered item, a to-do or a quote line with nothing in it takes the marker away and leaves the
 * line, which is then the empty line under the cell (`growth`): the cell grows to it, no bar is up, and the NEXT Return is this
 * rule's — the bar. (Return on a list item with words adds another item, as it always did.) The markdown side's `carryTheListOn`
 * and the rendered page's `returnInBlock` do the taking away.
 *
 * A picture or an ink cell has no line to grow: it is drawn and never typed in, so Return with the caret beside it arms the
 * bar on that side — what an arrow does there — instead of starting a cell.
 *
 * A LIST THAT IS ONE EMPTY ITEM, A CELL OF ITS OWN — what the bar opens when a list is chosen there (the + menu's lists, the
 * Style menu's and Ctrl+Shift+L at a bar, a `*` typed there: Sean, 2026-10-11, "typing a * while the input cursor is horizontal
 * will start a markdown text cell with bullet points") and Return is pressed before a word is typed — has no cell left to keep
 * a line in once its marker goes (the rule above would leave an empty line between two blank ones: a blank cell, and on the
 * rendered page more of them at every Return). So Return takes it away, with the blank line that held it apart, and the bar is
 * the cursor where it was: the note is what it was before the list was chosen; Backspace there does the same (`loneItemGoes`).
 * (A quote of one empty line the same, and one with a cell touching it below. An empty item TOUCHING the cell above — a heading's
 * or another list's line, written so in the note; a list chosen on the line a newline grew opens apart since 2026-10-11,
 * `grownList.ts` — loses its marker by the rule above and leaves that cell's grown line.)
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

/** The kinds of cell whose one empty item Return takes away (above). */
const LONE_ITEM_KINDS = new Set(["bullets", "dashes", "numbered", "todos", "quote"])

/** A table row with nothing in any of its cells: only pipes and white space. */
const emptyRow = (text: string): boolean => /^\s*\|[\s|]*$/.test(text)

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

  // A list (or a quote) that is one empty item and a cell of its own: it goes, and the bar is up where it was.
  const lone = loneItemGoes(cells, doc, caret)
  if (lone) return lone

  // The last line of a table, with nothing in it: the row Return carried the cell on with. (A list's or a quote's empty item is not
  // ended here: see the top.)
  if (line.number < 2 || end(cell.range) !== line.to || cell.range.location >= line.from) return null
  if (cell.block.kind !== "table") return null
  // (Never the header or the delimiter row: those have words, or dashes.)
  if (!(emptyRow(line.text) && doc.lineAt(cell.range.location).number + 1 < line.number)) return null
  const above = doc.line(line.number - 1)
  return { index, remove: range(above.to, line.to - above.to), below: true }
}

/**
 * A LIST (OR A QUOTE) THAT IS ONE EMPTY ITEM AND A CELL OF ITS OWN, the caret after its marker: what goes when Return — or
 * Backspace (Sean, 2026-10-11: the `*` typed at the bar, then Backspace, is the bar again, as one Undo and Return make it) — is
 * pressed there before a word is typed, and where the bar is then. Null where the caret is not there. (A cell of its own: no
 * line of words straight above it. One touching the cell BELOW — `a`, a blank line, `- `, then `b` on the next line, reached by
 * typing `b` on the line a list's Return left and taking the item's words back — is one too: it goes with its own newline and
 * the cells either side keep one blank line between them. Until 2026-10-11 the reach for that blank line read two characters
 * back from `b` and took the cell above's newlines and the marker's dash with it, leaving `a \nb`: one cell out of three.)
 */
export function loneItemGoes(cells: readonly PositionedBlock[], doc: LineSource, caret: Range): ClosingReturn | null {
  if (caret.length !== 0 || doc.length === 0 || cells.length === 0) return null
  const at = Math.min(Math.max(caret.location, 0), doc.length)
  const line = doc.lineAt(at)
  const index = firstCellFromBy(cells, at + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index] : undefined
  if (!cell || !LONE_ITEM_KINDS.has(cell.block.kind) || cell.range.location !== line.from || end(cell.range) !== line.to) return null
  if (at !== line.to || listContinuation(line.text) !== "") return null
  if (line.number > 1 && doc.line(line.number - 1).text.trim().length !== 0) return null
  // The item and the blank lines round it, as Backspace takes an empty cell (`removeBlock`): the cells either side keep ONE
  // blank line between them — the first one under the cell above, which stays, and the newline that ends it.
  let up = line.number - 1
  while (up >= 1 && doc.line(up).text.trim().length === 0) up--
  let down = line.number + 1
  while (down <= doc.lines && doc.line(down).text.trim().length === 0) down++
  let from: number
  let to: number
  if (up < 1) {
    // The note's first cell: it goes with everything up to the next one.
    from = 0
    to = down <= doc.lines ? doc.line(down).from : doc.length
  } else if (down > doc.lines) {
    // The note's last cell: it goes with everything after the cell above.
    from = doc.line(up).to
    to = doc.length
  } else {
    // Between two cells (the one below touching it or not): line `up + 1` is a blank line, since the line straight above the
    // item is. It stays; from its end to the newline before the cell below goes.
    from = doc.line(up + 1).to
    to = doc.line(down).from - 1
  }
  // The cells before what goes are where they were; the bar stands over the cell after it, else under the one before.
  let before = 0
  while (before < cells.length && cells[before]!.range.location < from) before++
  const below = down > doc.lines && before > 0
  return { index: below ? before - 1 : before, remove: range(from, to - from), below }
}
