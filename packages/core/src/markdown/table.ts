/**
 * A GitHub-style pipe table, read from its lines. Tables were taken out of the Mac app whole on 2026-09-20 (Sean:
 * "just completely remove tables as a feature and we'll rebuild that from scratch"); this is the first part of the
 * rebuild (`docs/TODO.md`, "Tables, from scratch"), port-first: the table is ONE cell, written as the pipes and dashes
 * every markdown reader knows, drawn as a grid on the rendered page and on paper, and typed as text.
 *
 * ```
 * | Key    | Does        |
 * |:-------|------------:|
 * | Ctrl+B | **bold**    |
 * ```
 *
 * - The HEADER is a line with a pipe in it that is not escaped (`\|` is a pipe inside a cell). It is not indented by
 *   two columns or more: an indented line of pipes is the words of a list item, and a table inside a list is not one.
 * - The line under it is the DELIMITER row: as many cells as the header, each `---` with an optional `:` either end
 *   (`:--` left, `:-:` centre, `--:` right), and a pipe somewhere in it (`---` alone is a rule).
 * - BODY rows follow while each line has an unescaped pipe and starts no other block (a list item, a quote, a
 *   heading, a fence, a rule, a picture). A row shorter than the header is padded with empty cells and a longer one
 *   loses what is past the header's width, as GitHub does.
 * - Pipes at the two ends of a row are optional, and a table may follow a paragraph line directly (its last line is
 *   then the header), as on GitHub.
 *
 * Everything here is pure and works on a line's own offsets, so the editor can find a cell under the caret and the
 * rendered page can turn a click in a cell back into a place in the markdown.
 */

export type TableAlign = "left" | "center" | "right" | null

/** One cell's stretch of its row line: `from` is just after the pipe before it, `to` is the pipe after it (or the end). */
export interface TableCellSpan {
  from: number
  to: number
}

/** Whether the character at `index` is preceded by an odd number of backslashes (so it is escaped). */
function escaped(line: string, index: number): boolean {
  let slashes = 0
  for (let i = index - 1; i >= 0 && line.charCodeAt(i) === 92; i--) slashes++
  return slashes % 2 === 1
}

/** Whether the line has a pipe that is not escaped. */
export function hasPipe(line: string): boolean {
  for (let i = line.indexOf("|"); i >= 0; i = line.indexOf("|", i + 1)) if (!escaped(line, i)) return true
  return false
}

/**
 * The cells of a row line, as stretches of that line (untrimmed: the spaces round a cell's words are in its span).
 * The pipes at the two ends, when they are there, belong to no cell.
 */
export function rowSpans(line: string): TableCellSpan[] {
  let start = 0
  let stop = line.length
  while (start < stop && (line[start] === " " || line[start] === "\t")) start++
  while (stop > start && (line[stop - 1] === " " || line[stop - 1] === "\t")) stop--
  if (start >= stop) return [{ from: start, to: start }]
  if (line[start] === "|") start++
  if (stop - 1 >= start && line[stop - 1] === "|" && !escaped(line, stop - 1)) stop--
  const spans: TableCellSpan[] = []
  let from = start
  for (let i = start; i < stop; i++) {
    if (line[i] === "|" && !escaped(line, i)) {
      spans.push({ from, to: i })
      from = i + 1
    }
  }
  spans.push({ from, to: stop })
  return spans
}

/** A cell's words: trimmed, and a `\|` is the pipe it stands for. */
export function cellText(line: string, span: TableCellSpan): string {
  return line.slice(span.from, span.to).trim().replace(/\\\|/g, "|")
}

/** The cells of a row line, as words. */
export function rowCells(line: string): string[] {
  return rowSpans(line).map((span) => cellText(line, span))
}

/** How far in a line is, in columns (a tab is four). */
function indentColumns(line: string): number {
  let columns = 0
  for (const ch of line) {
    if (ch === " ") columns++
    else if (ch === "\t") columns += 4
    else break
  }
  return columns
}

/**
 * How many cells the line has as a table HEADER, or -1 when it cannot be one: no unescaped pipe, or indented two
 * columns or more (the words of a list item).
 */
export function headerCells(rawLine: string): number {
  if (indentColumns(rawLine) >= 2 || !hasPipe(rawLine)) return -1
  return rowSpans(rawLine).length
}

const DELIMITER_CELL = /^:?-+:?$/

/** The alignment of each column when the line is a delimiter row (`|---|:--:|`), else null. */
export function delimiterAligns(line: string): TableAlign[] | null {
  if (!hasPipe(line)) return null
  const aligns: TableAlign[] = []
  for (const span of rowSpans(line)) {
    const cell = line.slice(span.from, span.to).trim()
    if (!DELIMITER_CELL.test(cell)) return null
    const left = cell.startsWith(":")
    const right = cell.endsWith(":")
    aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null)
  }
  return aligns
}

/** A table read from its lines: the header's words, each column's alignment, and the body rows (as wide as the header). */
export interface TableParts {
  header: string[]
  align: TableAlign[]
  rows: string[][]
}

/** The table in `lines` (the header, the delimiter row, then the body rows), or null when the first two are not a table's. */
export function tableOf(lines: readonly string[]): TableParts | null {
  if (lines.length < 2) return null
  const width = headerCells(lines[0]!)
  const align = delimiterAligns(lines[1]!.trim())
  if (width < 1 || !align || align.length !== width) return null
  const rows = lines.slice(2).map((line) => {
    const cells = rowCells(line)
    while (cells.length < width) cells.push("")
    return cells.slice(0, width)
  })
  return { header: rowCells(lines[0]!), align, rows }
}

/** An empty row for a table `columns` wide, with pipes at both ends: `|  |  |`. The caret goes `EMPTY_ROW_CARET` in. */
export function emptyRow(columns: number): string {
  return "| " + Array.from({ length: Math.max(1, columns) }, () => "").join(" | ") + " |"
}

/** Where the first cell of `emptyRow` takes the caret: after `| `. */
export const EMPTY_ROW_CARET = 2

// MARK: - A table cell's source, line by line (what the rendered page draws and the keys walk)

/** One line of a table cell's source: where it starts in that source, its text, and its cells' spans. */
export interface TableLine {
  start: number
  text: string
  spans: TableCellSpan[]
}

/** The lines of a table cell's source (header, delimiter row, body rows), each with its cells. */
export function tableLines(source: string): TableLine[] {
  const out: TableLine[] = []
  let start = 0
  for (const text of source.split("\n")) {
    out.push({ start, text, spans: rowSpans(text) })
    start += text.length + 1
  }
  return out
}

/** A cell as the rendered page draws it: its markdown (trimmed, escapes and all) and where that starts in the source. */
export interface DrawnCell {
  /** Offset in the table's source of the first character of `source` (for an empty cell, where the caret goes). */
  at: number
  source: string
}

/**
 * The cells to draw, row by row (the delimiter row is not drawn), every row exactly as wide as the header: a short
 * row is padded with empty cells whose place is the end of that row's text, a long one loses the cells past it.
 */
export function drawnRows(source: string, width: number): DrawnCell[][] {
  const lines = tableLines(source)
  const rows: DrawnCell[][] = []
  lines.forEach((line, index) => {
    if (index === 1) return
    const cells: DrawnCell[] = []
    for (const span of line.spans.slice(0, width)) {
      const raw = line.text.slice(span.from, span.to)
      const lead = raw.length - raw.trimStart().length
      const words = raw.trim()
      // An empty cell's caret goes after the one space that usually pads it (`| ` then the caret).
      const at = words.length > 0 ? span.from + lead : span.from + (raw.length > 0 && raw[0] === " " ? 1 : 0)
      cells.push({ at: line.start + at, source: words })
    }
    const endOfRow = line.start + line.text.trimEnd().length
    while (cells.length < width) cells.push({ at: endOfRow, source: "" })
    rows.push(cells)
  })
  return rows
}

// MARK: - Walking the cells with Tab, and adding a row with Return

/** A change to a table cell's source (offsets in that source) and the selection after it. */
export interface TableStep {
  change: { from: number; to: number; insert: string } | null
  anchor: number
  head: number
}

/** Which line of the table holds `pos`, and which cell of it (the one whose span holds it, else the nearest). */
function placeOf(lines: TableLine[], pos: number): { row: number; cell: number } {
  let row = 0
  while (row + 1 < lines.length && lines[row + 1]!.start <= pos) row++
  const line = lines[row]!
  const col = pos - line.start
  let cell = 0
  while (cell + 1 < line.spans.length && line.spans[cell]!.to < col) cell++
  return { row, cell }
}

/** The selection a cell is entered with: its words selected (so typing replaces them), or the caret in it if empty. */
function enter(lines: TableLine[], row: number, cell: number): TableStep {
  const line = lines[row]!
  const span = line.spans[cell]!
  const raw = line.text.slice(span.from, span.to)
  const words = raw.trim()
  if (words.length === 0) {
    const at = line.start + span.from + (raw.length > 0 && raw[0] === " " ? 1 : 0)
    return { change: null, anchor: at, head: at }
  }
  const from = line.start + span.from + (raw.length - raw.trimStart().length)
  return { change: null, anchor: from, head: from + words.length }
}

/**
 * Tab in a table: the next cell along the row, then the first of the next row (the delimiter row is stepped over);
 * past the last cell of the last row a new empty row is added and the caret goes into its first cell. Shift+Tab (`back`)
 * walks the other way and stops at the first cell of the header. Null when the selection reaches outside one line.
 */
export function tableTab(source: string, from: number, to: number, back: boolean): TableStep | null {
  const lines = tableLines(source)
  if (lines.length < 2) return null
  const here = placeOf(lines, from)
  if (placeOf(lines, to).row !== here.row) return null
  let { row, cell } = here
  if (row === 1) {
    // On the delimiter row: forward is the first body cell, back is the header's last.
    if (back) return enter(lines, 0, lines[0]!.spans.length - 1)
    row = 2
    cell = -1
  }
  if (back) {
    if (cell > 0) return enter(lines, row, cell - 1)
    if (row === 0) return enter(lines, 0, 0)
    const previous = row === 2 ? 0 : row - 1
    return enter(lines, previous, lines[previous]!.spans.length - 1)
  }
  if (row < lines.length && cell + 1 < lines[row]!.spans.length) return enter(lines, row, cell + 1)
  const next = row === 0 ? 2 : row + 1
  if (next < lines.length) return enter(lines, next, 0)
  // Past the last cell: a new row, as wide as the header.
  const added = "\n" + emptyRow(lines[0]!.spans.length)
  const at = source.length + 1 + EMPTY_ROW_CARET
  return { change: { from: source.length, to: source.length, insert: added }, anchor: at, head: at }
}

/**
 * Return in a table, with the caret at `caret`: a new empty row under the caret's row (under the delimiter row when
 * the caret is in the header) and the caret in its first cell. On an empty LAST row it ends the table instead, as an
 * empty item ends a list: the row goes and the caret lands below the table after a blank line. Null at the very start
 * of the header (Return there makes room above the table, as it does before any cell).
 */
export function tableReturn(source: string, caret: number): TableStep | null {
  const lines = tableLines(source)
  if (lines.length < 2) return null
  const { row } = placeOf(lines, caret)
  if (row === 0 && caret <= lines[0]!.start + (lines[0]!.text.length - lines[0]!.text.trimStart().length)) return null
  const line = lines[row]!
  const last = row === lines.length - 1
  if (row >= 2 && last && line.spans.every((span) => line.text.slice(span.from, span.to).trim() === "")) {
    const from = line.start - 1
    return { change: { from, to: source.length, insert: "\n\n" }, anchor: from + 2, head: from + 2 }
  }
  const after = row === 0 ? lines[1]! : line
  const at = after.start + after.text.length
  const insert = "\n" + emptyRow(lines[0]!.spans.length)
  return { change: { from: at, to: at, insert }, anchor: at + 1 + EMPTY_ROW_CARET, head: at + 1 + EMPTY_ROW_CARET }
}
