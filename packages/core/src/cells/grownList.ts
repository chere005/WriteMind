/**
 * A LIST CHOSEN ON THE LINE A NEWLINE GREW (Sean, 2026-10-11: "the input cursor should go to where it is typing when inserting
 * a checklist or bullets"). Port-first: the Mac has no grown line.
 *
 * Return at the end of a cell leaves the caret on an empty line that is the cell's (`growth.ts`), and the List button, the
 * Style menu's lists and Ctrl+Shift+L there write a list's marker. What that marker is part of depends on the cell above:
 *
 * - UNDER A LIST it is that list's: its next item (the parser reads a marker alone under a list as its next item), or the next
 *   kind's item touching it. Numbered under a numbered item is the NEXT number — `1. a`, `2. b`, then Numbered writes `3. `, as
 *   Return in the list does; it wrote `1. ` (the drawn list counted it third, the markdown said first).
 * - UNDER ANY OTHER CELL — a paragraph, a heading, a quote, a fence, a table — the list cannot share the cell: under a
 *   paragraph's line a marker alone is the paragraph's words (the parser's `startsEmptyList`, which keeps old notes' text cells
 *   whole), and anywhere else it was a second cell touching the first, drawn as two blocks apart on the rendered page while the
 *   markdown side showed them hugging. So the list opens as its OWN cell under the cell, exactly as the bar under the cell
 *   would open it: the grown line goes (what the next Return would take, `closingReturn`), and the cell the + menu's list makes
 *   at that bar is written, with the caret in its item. One edit, so one Undo gives the grown line back.
 *
 * Null where the caret is not on a grown line, or where the list's own command already writes the right marker.
 */

import { end, range, type Edit, type Range } from "../text/range"
import { bulletItem, dashItem, emptyItem, linesOf, numberedItem, positioned, todoItem } from "../markdown/parser"
import type { ListStyle } from "../markdown/formatting"
import { wholeChange } from "../markdown/plainText"
import { listContinuation } from "./editing"
import { growth } from "./growth"
import { closingReturn } from "./newline"
import { openCell } from "./types"

/** Whether a line (as written) is an item of a list: a to-do, a bullet, a dash, a number, or a marker alone. */
function listLine(text: string): boolean {
  const line = text.trim()
  return todoItem(line) !== null || bulletItem(line) !== null || dashItem(line) !== null || numberedItem(line) !== null
    || emptyItem(line) !== null
}

/** The edit that writes a list of `style` on the grown line the caret is on (see above), or null. */
export function listOnGrownLine(markdown: string, caret: Range, style: ListStyle): Edit | null {
  if (caret.length !== 0) return null
  const cells = positioned(markdown)
  const doc = linesOf(markdown)
  const grown = growth(cells, doc, caret)
  if (!grown) return null
  const above = doc.line(doc.lineAt(grown.line.location).number - 1)
  if (listLine(above.text)) {
    // Under a list: the list's own command writes its marker there, but a number counts on from the one above.
    if (style !== "numbered" || numberedItem(above.text.trim()) === null) return null
    const next = listContinuation(above.text)
    if (!next) return null
    return { range: grown.line, replacement: next, selection: range(grown.line.location + next.length, 0) }
  }
  // Under any other cell: the grown line goes, and the list is the cell the bar under that cell opens.
  const closed = closingReturn(cells, doc, caret)
  if (!closed || !closed.remove) return null
  const without = markdown.slice(0, closed.remove.location) + markdown.slice(end(closed.remove))
  const after = positioned(without)
  const next = closed.index + 1
  const seam = next < after.length ? after[next]!.range.location : without.length
  const opened = openCell({ kind: "list", style }, without, seam)
  return wholeChange(markdown, opened.markdown, range(opened.caret, 0))
}
