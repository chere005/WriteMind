/**
 * THE ``` LINES OF A FENCED CELL ARE NOT STOOD ON, ON THE RENDERED PAGE (Sean, 2026-10-05: "in rendered mode pressing
 * up or down shouldn't select the backticks of a code cell").
 *
 * A fenced cell — code, an evaluation cell and its Out cell, ```wl maths, any ``` fence — opens for typing with its
 * fences shut to a strip of padding (`field.ts`). Up and Down into it land on its first / last CONTENT line, never on a
 * fence; inside it they walk the content and leave it from the first / last content line, to the bar beside it; a
 * click on a fence line lands on the content line beside it. A cell with no content line (```` ``` ```` straight over
 * ```` ``` ````) is given an empty one to stand on. Shift+arrows and drags select across fences as before, and Left /
 * Right still reach the opening fence, where the language is typed (`furniture.ts` opens it there).
 *
 * The rules as answers about the note (`fenceLines`, `offFence`, `contentLineFor`); `keys.ts` applies them to the
 * arrows, `fencePointer` here to a click. The markdown side is untouched: there the fences are text.
 */

import { EditorSelection, EditorState, type Text } from "@codemirror/state"
import { end, firstCellFromBy, type Range } from "@writemind/core"
import { notebook } from "../notebook"
import { renderedField } from "../rendered"

/** A line that opens or closes a fence: ``` after any indentation (the Mac's rule, and the parser's). */
export const isFenceText = (text: string): boolean => text.trimStart().startsWith("```")

/** The lines of a fenced cell, as line numbers of the note. */
export interface FenceLines {
  /** The opening fence. */
  open: number
  /** The closing fence, or null for a fence never closed (it runs to the end of the cell). */
  close: number | null
  /** The first and the last content line (the lines between the fences), or null for a cell with none. */
  first: number | null
  last: number | null
}

/** The fence lines of the cell at `cell` in `doc`; null when the cell does not open with a fence. */
export function fenceLines(doc: Text, cell: Range): FenceLines | null {
  if (cell.location < 0 || cell.location > doc.length) return null
  const open = doc.lineAt(cell.location)
  if (!isFenceText(open.text)) return null
  const bottom = doc.lineAt(Math.min(end(cell), doc.length))
  const close = bottom.number > open.number && isFenceText(bottom.text) ? bottom.number : null
  const lastContent = close === null ? bottom.number : close - 1
  const first = open.number + 1 <= lastContent ? open.number + 1 : null
  return { open: open.number, close, first, last: first === null ? null : lastContent }
}

/** Whether line `n` of the note is one of the cell's fences. */
export const onFence = (lines: FenceLines, n: number): boolean => n === lines.open || n === lines.close

/** The start of the first content line (`top`) or the end of the last; null when the cell has none. */
export function contentEnd(doc: Text, lines: FenceLines, top: boolean): number | null {
  if (lines.first === null || lines.last === null) return null
  return top ? doc.line(lines.first).from : doc.line(lines.last).to
}

/**
 * A caret at `pos` moved off the cell's fences, onto the nearest content line: on the opening fence, the start of the
 * first content line; on the closing fence, the end of the last. `pos` itself on a content line; null when the cell
 * has no content line (`contentLineFor` makes one).
 */
export function offFence(doc: Text, lines: FenceLines, pos: number): number | null {
  const n = doc.lineAt(pos).number
  if (!onFence(lines, n)) return pos
  return contentEnd(doc, lines, n === lines.open)
}

/** The change that gives a fenced cell with no content line an empty one under its opening fence, and the caret on it. */
export function contentLineFor(doc: Text, lines: FenceLines): { from: number; insert: string; caret: number } {
  const open = doc.line(lines.open)
  return { from: open.to, insert: "\n", caret: open.to + 1 }
}

/** The fenced cell `pos` is in (its range and its fence lines), by the note's cells; null when it is in none. */
export function fenceAt(state: EditorState, pos: number): { cell: Range; lines: FenceLines } | null {
  const cells = notebook(state).cells
  const at = firstCellFromBy(cells, pos + 1, (cell) => cell.range) - 1
  if (at < 0) return null
  const cell = cells[at]!
  if (cell.block.kind !== "code" || pos > end(cell.range)) return null
  const lines = fenceLines(state.doc, cell.range)
  return lines ? { cell: cell.range, lines } : null
}

/**
 * Where a caret put at `pos` goes instead, when `pos` is on a fence line of a fenced cell: the content line beside it
 * (`{ at }`), or — the cell has none — the line to make first (`{ make }`). Null when `pos` is on no fence.
 */
export function landingOffFence(state: EditorState, pos: number):
  { at: number } | { make: { from: number; insert: string; caret: number } } | null {
  const fence = fenceAt(state, pos)
  if (!fence || !onFence(fence.lines, state.doc.lineAt(pos).number)) return null
  const at = offFence(state.doc, fence.lines, pos)
  return at !== null ? { at } : { make: contentLineFor(state.doc, fence.lines) }
}

/**
 * A click that puts the caret on a fence line (the strip of an open block's fence, or a drawn fenced cell with nothing
 * in it) puts it on the content line beside it instead. A drag, a Shift+click — any selection — is left as it was made.
 */
export const fencePointer = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || !tr.isUserEvent("select.pointer")) return tr
  const state = tr.startState
  if (state.field(renderedField, false) !== true) return tr
  const { ranges, main } = tr.selection
  if (ranges.length !== 1 || !main.empty) return tr
  const landing = landingOffFence(state, main.head)
  if (!landing) return tr
  if ("at" in landing) return [tr, { selection: EditorSelection.cursor(landing.at), sequential: true }]
  const { from, insert, caret } = landing.make
  return [tr, { changes: { from, insert }, selection: EditorSelection.cursor(caret), sequential: true }]
})
