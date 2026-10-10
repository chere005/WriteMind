/**
 * THE TABLE BUTTON's cell (the toolbar's Insert group, docs/PLAN-bars-2026-10.md P1): an empty GitHub-style pipe table,
 * two columns and three rows — the header and two body rows — written as a cell of its own with the caret in the first
 * header cell. There is no second table engine: what is written is what `markdown/table.ts` reads and what
 * `packages/editor/src/tables.ts` walks (Tab cell to cell, Return a new row), so the cell is editable the moment it
 * exists.
 *
 * One edit, so one Undo takes the whole table back. Like every command that makes a cell it keeps a blank line above
 * and below (`cellSpacing`), never doubling one that is there.
 */

import { edit, range, type Edit, type Range } from "../text/range"
import { cellSpacing } from "./apart"
import { EMPTY_ROW_CARET, emptyRow } from "../markdown/table"

/** The table's columns and its body rows (the header comes with it). */
export const NEW_TABLE_COLUMNS = 2
export const NEW_TABLE_BODY_ROWS = 2

/** The delimiter line `| --- | --- |`. */
const delimiter = (columns: number): string => "| " + Array.from({ length: columns }, () => "---").join(" | ") + " |"

/** The new table's lines, no line break at either end. */
export function emptyTable(columns = NEW_TABLE_COLUMNS, bodyRows = NEW_TABLE_BODY_ROWS): string {
  return [emptyRow(columns), delimiter(columns), ...Array.from({ length: bodyRows }, () => emptyRow(columns))].join("\n")
}

/**
 * An empty table written where `selection` is (a caret: on an empty line the table takes the line; words round it are
 * left alone — the editor puts a table after a cell that has words, as every cell-making command does). The caret ends
 * in the first header cell.
 */
export function tableBlock(markdown: string, selection: Range): Edit {
  const at = Math.min(Math.max(selection.location, 0), markdown.length)
  const stop = Math.min(Math.max(selection.location + selection.length, at), markdown.length)
  const { lead, trail } = cellSpacing(markdown.slice(0, at), markdown.slice(stop))
  const table = emptyTable()
  return edit(range(at, stop - at), lead + table + trail, range(at + lead.length + EMPTY_ROW_CARET, 0))
}
