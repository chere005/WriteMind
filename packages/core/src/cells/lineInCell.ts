/**
 * CTRL+ENTER: THE NEWLINE THAT NEVER LEAVES THE CELL (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the
 * current cell.."; "this should not be two separate cells"). Port-first: the Mac has no such key yet.
 *
 * Return is the cell's own key: at the end of a cell it grows the cell to a new line and the next Return arms the bar
 * under it (`growth.ts`, `newline.ts`); in a list it starts the next item and on an empty last item it takes the marker
 * off; in the middle of a block on the rendered page it splits it. Ctrl+Enter does none of that. Wherever the caret is in
 * a cell it puts a line break there and the caret stays IN THE SAME CELL, on the new line: no bar, no new item, no marker
 * taken off, no second cell — again and again, empty lines too, which Return, Return would have ended the cell with.
 *
 * An empty line inside a cell is written `<br>` (`markdown/emptyLine.ts`, which says why), so the parser, the brackets,
 * the seams, the rendered page, a save and a move of the cell all read it as the cell's. What each kind of cell does:
 *
 * - A TEXT or MARKDOWN cell: the line breaks at the caret. A half with no words is an empty line the cell keeps; the words
 *   after the caret start the new line, written so they stay this cell's words. A text cell's by the escape rule; a
 *   MARKDOWN cell's after a `<br>` (`lineBreakSpan`): there a single newline is a space when the cell is drawn, and the
 *   line the key made would be gone (the review of agent/ctrlenter, P1), so the new line starts with the `<br>` that says it
 *   starts afresh — which also keeps `# x` moved to the start of a line from being a heading.
 * - A LIST ITEM: the new line is the SAME item's next line, indented under its words (a continuation line, no marker), or
 *   an empty line it keeps. Never a new item.
 * - A QUOTE: a new line of the quote, `> <br>` and the words after the caret: a quote's lines join with a space as a
 *   markdown cell's do, and the `<br>` keeps the new one a line of its own.
 * - A CODE, MATHS OR RUNNABLE-CODE FENCE: a plain newline (a fence holds empty lines already). On the opening fence's line
 *   the new line is the first of the code, on the closing fence's the last: a line outside the fence would be no part of it.
 * - A HEADING, A RULE, A TABLE: nothing. Each is one line by nature — a second line under a heading or a rule is a cell of
 *   its own, and a table row is one line of the file, a newline in it the end of the table — so the key that promises
 *   not to leave the cell does nothing there rather than make a second cell. (A picture is never typed in.)
 * - THE LINE A SINGLE RETURN GREW under a paragraph, a list or a quote (`growth.ts`): it is the cell's, so it becomes an
 *   empty line the cell keeps and the caret goes to a new line under it.
 * - Anywhere else — between two cells, at the bar — there is no cell to stay in: nothing.
 *
 * A selection is replaced by the newline when it lies inside the one cell (and does not take a fence line); otherwise
 * nothing.
 */

import { end, range, type Range } from "../text/range"
import type { LineSource, PositionedBlock } from "../markdown/parser"
import { EMPTY_LINE, emptyLineSpan, lineBreakSpan, lineHead } from "../markdown/emptyLine"
import { escapeLine, escapeLineHead, unescapeLine, cellWordsStart } from "../markdown/plainText"
import { isTextCell } from "./textCells"
import { growth } from "./growth"
import { firstCellFromBy } from "./selection"

export type LineInCell =
  /** Write `insert` over [from, to) of the note; the caret goes to `caret` in the note after. */
  | { kind: "write"; from: number; to: number; insert: string; caret: number }
  /** Nothing to write: no cell to stay in, or a cell that is one line by nature. */
  | { kind: "none" }

const NONE: LineInCell = { kind: "none" }
const write = (from: number, to: number, insert: string, caret: number): LineInCell => ({ kind: "write", from, to, insert, caret })

const LISTS = new Set(["bullets", "dashes", "numbered", "todos"])

/** A quote line's head: its indentation and its `>` (and the space after it). */
const QUOTE_HEAD = /^[ \t]*>[ \t]?/
const CLOSING_FENCE = /^\s*```\s*$/

/** The indentation a line under this one stands at to carry its item on: as wide as its head (a tab stays a tab). */
const underHead = (head: string): string => head.replace(/[^\t]/g, " ")

/** A head the words follow: an item's box with nothing after it (`- [ ]`) gets the space its words would have. */
const spaced = (head: string): string => (head.length > 0 && !/[ \t]$/.test(head) ? head + " " : head)

/** What a half of a line with no words in it is: the empty line the cell keeps, after the line's head. */
const orEmpty = (head: string, words: string): string => (words.trim().length === 0 ? spaced(head) + EMPTY_LINE : head + words)

export function lineInCell(cells: readonly PositionedBlock[], doc: LineSource, selection: Range): LineInCell {
  if (cells.length === 0) return NONE
  const at = Math.min(Math.max(selection.location, 0), doc.length)
  const stop = Math.min(Math.max(end(selection), at), doc.length)

  // The line a single Return grew under a cell (growth.ts) is that cell's: it becomes an empty line the cell keeps.
  const grown = at === stop ? growth(cells, doc, range(at, 0)) : null
  if (grown) {
    const cell = cells[grown.index]!
    const line = grown.line
    if (cell.block.kind === "paragraph") {
      const both = EMPTY_LINE + "\n" + EMPTY_LINE
      return write(line.location, end(line), both, line.location + both.length)
    }
    if (LISTS.has(cell.block.kind)) {
      const under = underHead(lineHead(doc.lineAt(end(cell.range)).text))
      const both = under + EMPTY_LINE + "\n" + under + EMPTY_LINE
      return write(line.location, end(line), both, line.location + both.length)
    }
    if (cell.block.kind === "quote") {
      const lead = /^[ \t]*/.exec(doc.lineAt(end(cell.range)).text)![0]
      const both = lead + "> " + EMPTY_LINE + "\n" + lead + "> " + EMPTY_LINE
      return write(line.location, end(line), both, line.location + both.length)
    }
    return NONE
  }

  const index = firstCellFromBy(cells, at + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index] : undefined
  if (!cell || cell.range.length <= 0 || at < cell.range.location || at > end(cell.range) || stop > end(cell.range)) return NONE
  const kind = cell.block.kind

  if (kind === "code") {
    const open = doc.lineAt(cell.range.location)
    const last = doc.lineAt(end(cell.range))
    const closed = last.number > open.number && CLOSING_FENCE.test(last.text)
    const first = doc.lineAt(at).number
    const final = doc.lineAt(stop).number
    if (at !== stop) {
      // (A selection that takes a fence line would take the fence with it.)
      if (first === open.number || (closed && final === last.number)) return NONE
      return write(at, stop, "\n", at + 1)
    }
    // On the opening fence: the first line of the code. On the closing one: the last.
    if (first === open.number) return write(open.to, open.to, "\n", open.to + 1)
    if (closed && first === last.number) return write(last.from, last.from, "\n", last.from)
    return write(at, at, "\n", at + 1)
  }

  if (kind === "paragraph") {
    // (The caret is never on a markdown cell's marker line: from there it is at the start of the words.)
    let from = Math.max(at, cellWordsStart(cell.block, cell.range))
    let to = Math.max(stop, from)
    const one = doc.lineAt(from)
    const two = doc.lineAt(to)
    // The `<br>` a line starts with is no place for the caret: it stands after it (editor emptyLines.ts).
    from = Math.max(from, one.from + (lineBreakSpan(one.text)?.[1] ?? 0))
    to = Math.max(to, from, two.from + (lineBreakSpan(two.text)?.[1] ?? 0))
    // An empty line the cell keeps has no words: the caret on it is at its end.
    const keptOne = emptyLineSpan(one.text)
    const keptTwo = emptyLineSpan(two.text)
    let head = keptOne ? one.text.slice(0, keptOne[0]) : one.text.slice(0, from - one.from)
    let tail = keptTwo ? "" : two.text.slice(to - two.from)
    if (isTextCell(cell.block)) {
      // Each half written by the escape rule again: a `#` that stood mid-line may start one now.
      head = escapeLine(unescapeLine(head))
      tail = escapeLine(unescapeLine(tail))
      const first = orEmpty("", head)
      const second = tail.trim().length === 0 ? EMPTY_LINE : tail
      const caret = one.from + first.length + 1 + (tail.trim().length === 0 ? second.length : 0)
      return write(one.from, two.to, first + "\n" + second, caret)
    }
    // A markdown cell: the new line starts with `<br>` (alone, the empty line), so it is a line of its own when the cell is
    // drawn; a first half that is only a `<br>` now is the empty line it holds.
    const first = orEmpty("", emptyLineSpan(head) ? "" : head)
    const second = EMPTY_LINE + (tail.trim().length === 0 ? "" : tail)
    return write(one.from, two.to, first + "\n" + second, one.from + first.length + 1 + EMPTY_LINE.length)
  }

  if (LISTS.has(kind)) {
    const one = doc.lineAt(at)
    const two = doc.lineAt(stop)
    const headOne = lineHead(one.text)
    // The caret in an item's marker is at the start of its words.
    const from = Math.max(at, one.from + headOne.length)
    const to = Math.max(stop, from)
    const keptOne = emptyLineSpan(one.text)
    const keptTwo = emptyLineSpan(two.text)
    const words = keptOne ? "" : one.text.slice(headOne.length, from - one.from)
    // (A selection that ends in another line's marker takes the marker with it.)
    const headTwo = two.number === one.number ? 0 : lineHead(two.text).length
    const tail = keptTwo ? "" : two.text.slice(Math.max(to - two.from, headTwo))
    const under = underHead(spaced(headOne))
    const first = orEmpty(headOne, words)
    // The words after the caret stay the item's: never a nested item, a quote or a heading of their own.
    const second = tail.trim().length === 0 ? under + EMPTY_LINE : escapeLineHead(under + tail.replace(/^[ \t]+/, ""))
    const caret = one.from + first.length + 1 + (tail.trim().length === 0 ? second.length : under.length)
    return write(one.from, two.to, first + "\n" + second, caret)
  }

  if (kind === "quote") {
    const one = doc.lineAt(at)
    const two = doc.lineAt(stop)
    // The caret is never in the quote's `>` nor in front of the `<br>` a line starts with: it stands after them.
    const from = Math.max(at, one.from + (lineBreakSpan(one.text)?.[1] ?? (QUOTE_HEAD.exec(one.text)?.[0] ?? "").length))
    const to = Math.max(stop, from)
    const lead = /^[ \t]*/.exec(one.text)![0]
    const first = one.text.slice(0, from - one.from)
    const headTwo = two.number === one.number ? 0 : (lineBreakSpan(two.text)?.[1] ?? (QUOTE_HEAD.exec(two.text)?.[0] ?? "").length)
    const tail = two.text.slice(Math.max(to - two.from, headTwo))
    // A quote's lines join with a space when it is drawn: the new one starts with `<br>` (alone: an empty line of the quote).
    const second = lead + "> " + EMPTY_LINE + tail.replace(/^[ \t]+/, "")
    return write(one.from, two.to, first + "\n" + second, one.from + first.length + 1 + lead.length + 2 + EMPTY_LINE.length)
  }

  // A heading, a rule, a table, a picture, a run of blank lines: one line by nature, or nothing to type in.
  return NONE
}
