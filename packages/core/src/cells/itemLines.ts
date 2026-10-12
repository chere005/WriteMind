/**
 * A LIST ITEM'S NEXT LINES, AND THE KEYS THAT MEET THEM (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the
 * current cell.."; the review of agent/ctrlenter, P1 and P2). Port-first: the Mac has no such lines yet.
 *
 * Ctrl+Enter in a list item writes the SAME item's next line, under its words and with no marker (`lineInCell.ts`): a
 * continuation line, or the empty line the item keeps (`  <br>`). The parser reads it as the item's (`parser.ts`, rule 14 of
 * docs/SPEC-WM.md). Return and Backspace have to read it so too, on both pages, or the very next ordinary key after
 * Ctrl+Enter breaks the cell:
 *
 * - RETURN AT THE END OF ANY LINE OF AN ITEM that has next lines — its own line or one of its next lines, words or an empty
 *   line kept — carries the list on, as Return at the end of an item does (3.9.0: "Return on a list item adds another
 *   item"): the next item (`- `, the next number, an unticked `- [ ] `), at the item's own indentation, AFTER THE ITEM'S LAST
 *   LINE — the item's lines stay together, and the new item never takes the item's next lines away from it. Return at the
 *   start of a next line's words makes that line the next item (its words the item's, the lines under it with it). It never
 *   writes a line of white space inside a list, which the parser reads as the end of it (the bar would arm on it).
 *   (In the middle of a next line's words Return breaks the line as it always did: the new line is the item's too.)
 * - BACKSPACE IN A NEXT LINE'S INDENTATION, or at the start of its words, joins its words to the line above — the newline
 *   and the indentation go together — as Backspace at the start of a line of a text cell does. The editor's own Backspace
 *   took one indent unit off, and the line, out from under the item's words, was a paragraph of its own between two lists.
 *   Delete at the end of the line above a next line is the same join from the other side.
 *
 * `cells` are the note's (in order, as the parser answers); `doc` is the note as lines.
 */

import { end, type Range } from "../text/range"
import type { LineSource, PositionedBlock } from "../markdown/parser"
import { emptyLineSpan } from "../markdown/emptyLine"
import { firstCellFromBy } from "./selection"
import { nextItemHead } from "./editing"

const LISTS = new Set(["bullets", "dashes", "numbered", "todos"])
/** A line that is an item of its own: a marker (`-`, `*`, `+`, `12.`, `3)`) and a space or nothing after it. */
const ITEM_LINE = /^[ \t]*(?:[-*+]|\d{1,4}[.)])(?:[ \t]|$)/

/** What a key writes: `insert` over [from, to) of the note, the caret at `caret` after. */
export interface ItemEdit { from: number; to: number; insert: string; caret: number }

export interface ItemLines {
  /** The list cell: its place in the note's cells. */
  index: number
  /** The item's own line (the one with its marker) and its last next line, as line numbers (1-based). */
  first: number
  last: number
}

/** The list item line `number` of `doc` belongs to: null when the line is in no list cell. */
export function itemOfLine(cells: readonly PositionedBlock[], doc: LineSource, number: number): ItemLines | null {
  if (number < 1 || number > doc.lines) return null
  const line = doc.line(number)
  const index = firstCellFromBy(cells, line.from + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index] : undefined
  if (!cell || !LISTS.has(cell.block.kind) || line.from < cell.range.location || line.from > end(cell.range)) return null
  const top = doc.lineAt(cell.range.location).number
  const bottom = doc.lineAt(end(cell.range)).number
  let first = number
  while (first > top && !ITEM_LINE.test(doc.line(first).text)) first--
  if (!ITEM_LINE.test(doc.line(first).text)) return null
  let last = number
  while (last < bottom && !ITEM_LINE.test(doc.line(last + 1).text)) last++
  return { index, first, last }
}

/** Return with the caret at `caret`, where it meets an item's next lines (see the top); null where it is not this rule's. */
export function returnInItem(cells: readonly PositionedBlock[], doc: LineSource, caret: Range): ItemEdit | null {
  if (caret.length !== 0 || doc.length === 0) return null
  const at = Math.min(Math.max(caret.location, 0), doc.length)
  const line = doc.lineAt(at)
  const item = itemOfLine(cells, doc, line.number)
  if (!item) return null
  const next = nextItemHead(doc.line(item.first).text)
  if (!next) return null
  const kept = emptyLineSpan(line.text)
  const atEnd = kept ? at >= line.from + kept[0] : line.text.slice(at - line.from).trim().length === 0
  // The item's own line, with no next lines (or the caret in its words): Return there is the list's as it always was.
  if (line.number === item.first && (item.last === item.first || !atEnd)) return null
  if (atEnd) {
    const last = doc.line(item.last)
    return { from: last.to, to: last.to, insert: "\n" + next.head, caret: last.to + 1 + next.head.length }
  }
  // At the start of a next line's words: that line is the next item.
  const lead = /^[ \t]*/.exec(line.text)![0].length
  if (at - line.from <= lead) {
    return { from: line.from, to: line.from + lead, insert: next.head, caret: line.from + next.head.length }
  }
  return null
}

/** Backspace with the caret at `caret` in a next line's indentation or at the start of its words: the join (see the top). */
export function backspaceInItem(cells: readonly PositionedBlock[], doc: LineSource, caret: Range): ItemEdit | null {
  if (caret.length !== 0 || doc.length === 0) return null
  const at = Math.min(Math.max(caret.location, 0), doc.length)
  const line = doc.lineAt(at)
  if (line.number < 2 || ITEM_LINE.test(line.text) || emptyLineSpan(line.text)) return null
  const lead = /^[ \t]*/.exec(line.text)![0].length
  if (at - line.from > lead || line.text.trim().length === 0) return null
  const item = itemOfLine(cells, doc, line.number)
  if (!item || item.first === line.number) return null
  return joinUp(doc, line.number, lead)
}

/** Delete with the caret at the end of an item's line (or one of its next lines) whose next line is the item's: the join. */
export function deleteInItem(cells: readonly PositionedBlock[], doc: LineSource, caret: Range): ItemEdit | null {
  if (caret.length !== 0 || doc.length === 0) return null
  const at = Math.min(Math.max(caret.location, 0), doc.length)
  const line = doc.lineAt(at)
  if (at !== line.to || line.number >= doc.lines) return null
  const number = line.number + 1
  const below = doc.line(number)
  if (ITEM_LINE.test(below.text) || emptyLineSpan(below.text) || below.text.trim().length === 0) return null
  const item = itemOfLine(cells, doc, number)
  if (!item || item.first === number) return null
  return joinUp(doc, number, /^[ \t]*/.exec(below.text)![0].length)
}

/**
 * Line `number`'s words joined onto the line above: the newline and the line's indentation (`lead`) go. Onto an empty line
 * the item keeps, its `<br>` goes too: the words are that line's now.
 */
function joinUp(doc: LineSource, number: number, lead: number): ItemEdit {
  const above = doc.line(number - 1)
  const line = doc.line(number)
  const kept = emptyLineSpan(above.text)
  const from = kept ? above.from + kept[0] : above.to
  return { from, to: line.from + lead, insert: "", caret: from }
}
