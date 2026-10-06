/**
 * Switching a paragraph between a TEXT cell and a MARKDOWN cell (docs/PLAN-text-cells.md, "Switching"), and the
 * AUTOMATIC switch: a rich-text action in a text cell first makes it a markdown cell, then formats, as ONE edit (one
 * Undo takes both back). Port-first (the Mac has no text cells yet).
 *
 * - Ctrl+Shift+7 (`makeMarkdownCell`), and the automatic switch: the marker goes on top and the words are read as
 *   markdown from now on — the backslashes the escape rule wrote go (Sean, 2026-10-05: "when converting a cell to
 *   markdown, it just processes markdown"), so a literal `**x**` is bold now (`asMarkdownCell`).
 * - Ctrl+7 (`makeTextCell`) on a markdown cell: the marker goes, the formatting is taken off, and the words it showed
 *   and their line breaks stay (written by the escape rule).
 */

import { edit, end, range, substring, type Edit, type Range } from "../text/range"
import { positioned, type Block, type PositionedBlock } from "../markdown/parser"
import { setHeading } from "../markdown/formatting"
import { cellSpacing } from "./apart"
import { inlineSegments } from "../markdown/sourceStyle"
import {
  MARKDOWN_MARKER, escapePlain, isMarkdownMarker, markdownCellEdit, plainLine, unescapeLineMapped, unescapePlain,
  visibleWords, wholeChange,
} from "../markdown/plainText"

/** A paragraph read as plain words. */
export const isTextCell = (block: Block | null | undefined): boolean => block?.kind === "paragraph" && !block.markdown

/** A paragraph read as markdown (by its marker, or by the older-notes rule). */
export const isMarkdownCell = (block: Block | null | undefined): boolean => block?.kind === "paragraph" && block.markdown === true

/** The length of a cell's marker line (with its newline), 0 for a cell with none. */
export const markerLength = (block: Block | null | undefined): number =>
  block?.kind === "paragraph" && block.head ? block.head : 0

/**
 * The cells a selection is in: a caret's, ends included (a caret at the end of a cell's words is in it); a selection's,
 * those it has at least one character of (one that only touches a cell at an end leaves it alone).
 */
function cellsTouching(cells: readonly PositionedBlock[], selection: Range): PositionedBlock[] {
  const empty = selection.length === 0
  return cells.filter((cell) => cell.block.kind !== "blank"
    && (empty ? cell.range.location <= end(selection) && end(cell.range) >= selection.location
      : cell.range.location < end(selection) && end(cell.range) > selection.location))
}

/** The cell a caret is in (its two ends included), preferring one that starts there. */
function cellAt(cells: readonly PositionedBlock[], at: number): PositionedBlock | null {
  return cells.find((cell) => cell.block.kind !== "blank" && cell.range.location <= at && at <= end(cell.range)) ?? null
}

/** Where `pos` goes when markers are put in front of the cells starting at `starts` (a position at a start moves on). */
function shifted(pos: number, starts: readonly number[], head: number): number {
  return pos + starts.filter((at) => at <= pos).length * head
}

/** The offsets in `sorted` (ascending) at or below `pos` (`strict`: below it). */
function countUpTo(sorted: readonly number[], pos: number, strict = false): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (strict ? sorted[mid]! < pos : sorted[mid]! <= pos) low = mid + 1
    else high = mid
  }
  return low
}

/**
 * A TEXT cell's source made a MARKDOWN cell's (Sean, 2026-10-05: "when converting a cell to markdown, it just processes
 * markdown"): the words as they are SEEN, written as markdown — the escape rule's backslashes gone, so a literal `**x**`
 * is bold now, a line that starts `# ` a heading, and single line breaks join as markdown joins them — with the marker on
 * top of each paragraph they make. Block markup at the head of the words makes them that block: the marker goes down to
 * the words still a paragraph, or goes when none is (never left over a heading). Kept escaped: Link Here's anchors
 * (`unescapeLineMapped`), a line that IS the marker (WriteMind's own line, not the person's), and a fence that would
 * not close inside the cell (it would take the rest of the note into its code). `map` takes an offset in `source` to
 * the same visible character in `text`.
 */
export function asMarkdownCell(source: string): { text: string; map: (offset: number) => number } {
  const raw = source.split("\n")
  const lines = raw.map((line) => unescapeLineMapped(line))
  // The fences that close inside the cell: their lines are code, shown raw, so nothing in them stays escaped.
  const inCode = lines.map(() => false)
  let open = -1
  lines.forEach((line, i) => {
    if (!line.text.trimStart().startsWith("```")) return
    if (open < 0) { open = i; return }
    for (let at = open; at <= i; at++) inCode[at] = true
    open = -1
  })
  if (open >= 0) lines[open] = { text: raw[open]!, removed: [] }
  lines.forEach((line, i) => { if (!inCode[i] && isMarkdownMarker(line.text)) lines[i] = { text: raw[i]!, removed: [] } })
  // The backslashes taken out, as offsets in `source`.
  const removed: number[] = []
  let base = 0
  for (const line of lines) {
    for (const at of line.removed) removed.push(base + at)
    base += line.text.length + line.removed.length + 1
  }
  const words = lines.map((line) => line.text).join("\n")
  const head = MARKDOWN_MARKER + "\n"
  const starts = positioned(words).filter((one) => one.block.kind === "paragraph").map((one) => one.range.location)
  let text = words
  for (const at of [...starts].reverse()) text = text.slice(0, at) + head + text.slice(at)
  const map = (offset: number): number => {
    const seen = offset - countUpTo(removed, offset, true)
    return seen + countUpTo(starts, seen) * head.length
  }
  return { text, map }
}

/** The cells of `markdown` in `cells` (in order) made markdown cells: the note after, and where a position goes. */
function convertCells(markdown: string, cells: readonly PositionedBlock[]): { after: string; map: (pos: number) => number } {
  const made = cells.map((cell) => ({ cell, ...asMarkdownCell(substring(markdown, cell.range)) }))
  let after = markdown
  for (const one of [...made].reverse()) {
    after = after.slice(0, one.cell.range.location) + one.text + after.slice(end(one.cell.range))
  }
  const map = (pos: number): number => {
    let shift = 0
    for (const one of made) {
      const { location } = one.cell.range
      if (pos < location) break
      if (pos <= end(one.cell.range)) return location + shift + one.map(pos - location)
      shift += one.text.length - one.cell.range.length
    }
    return pos + shift
  }
  return { after, map }
}

/**
 * Ctrl+Shift+7: the paragraph the caret is in made a markdown cell. A TEXT cell's words are read as markdown from now
 * on (`asMarkdownCell`: the marker on top, the escapes' backslashes gone); a paragraph read as markdown already (an
 * older note's) just gets its marker. A heading becomes a markdown paragraph too (its marks go, as Ctrl+7 takes them).
 * The selection stays on the same characters. Null when there is nothing to do.
 */
export function makeMarkdownCell(markdown: string, selection: Range): Edit | null {
  const cells = positioned(markdown)
  const cell = cellAt(cells, selection.location)
  if (!cell) return null
  if (isTextCell(cell.block)) {
    const { after, map } = convertCells(markdown, [cell])
    const from = map(selection.location)
    return wholeChange(markdown, after, range(from, Math.max(0, map(end(selection)) - from)))
  }
  if (cell.block.kind === "heading") {
    // The ladder's own Ctrl+7, then the marker over the paragraph it left.
    const body = setHeading(markdown, selection, 0)
    const after = markdown.slice(0, body.range.location) + body.replacement + markdown.slice(end(body.range))
    const words = cellAt(positioned(after), Math.min(cell.range.location, after.length))
    if (!words || words.block.kind !== "paragraph") return body
    const marker = markdownCellEdit(after, words.range)
    const final = after.slice(0, marker.range.location) + marker.replacement + after.slice(marker.range.location)
    const caret = shifted(body.selection.location, [words.range.location], marker.replacement.length)
    return wholeChange(markdown, final, range(caret, 0))
  }
  if (cell.block.kind !== "paragraph" || markerLength(cell.block) > 0) return null
  const marker = markdownCellEdit(markdown, cell.range)
  const head = marker.replacement.length
  const from = shifted(selection.location, [cell.range.location], head)
  const to = shifted(end(selection), [cell.range.location], head)
  return edit(marker.range, marker.replacement, range(from, to - from))
}

/**
 * Ctrl+7 on a markdown cell: a text cell of the words it showed, line for line (the marker and the formatting gone).
 * Null when the caret is not in a markdown cell.
 */
export function makeTextCell(markdown: string, selection: Range): Edit | null {
  const cell = cellAt(positioned(markdown), selection.location)
  if (!cell || !isMarkdownCell(cell.block)) return null
  const source = substring(markdown, cell.range)
  const words = escapePlain(visibleWords(source, inlineSegments))
  // The caret keeps its place in the words as near as can be said: the same distance into them, or their end.
  const into = Math.max(0, selection.location - cell.range.location - markerLength(cell.block))
  return edit(cell.range, words, range(cell.range.location + Math.min(into, words.length), 0))
}

/**
 * THE AUTOMATIC SWITCH. `make` is a rich-text action (bold, a span, a link, inline maths); when the selection is in
 * a text cell (or reaches several), each of them is made a markdown cell first — as Ctrl+Shift+7 makes it
 * (`asMarkdownCell`: the marker on top, its words read as markdown from now on) — and the action runs on that note, on
 * the same visible characters. ONE edit comes back, so one Undo takes both. Outside text cells it is `make` as it was.
 */
export function viaMarkdownCells(markdown: string, selection: Range,
  make: (markdown: string, selection: Range) => Edit | null): Edit | null {
  const texts = cellsTouching(positioned(markdown), selection).filter((cell) => isTextCell(cell.block))
  if (texts.length === 0) return make(markdown, selection)
  const { after: marked, map } = convertCells(markdown, texts)
  const from = map(selection.location)
  const to = Math.max(from, map(end(selection)))
  const change = make(marked, range(from, to - from))
  if (!change) return null
  // An action that changes nothing (the T menu's Remove on a text cell: no spans to take off) does not switch the cell.
  if (change.replacement === substring(marked, change.range)) return make(markdown, selection)
  const final = marked.slice(0, change.range.location) + change.replacement + marked.slice(end(change.range))
  return wholeChange(markdown, final, change.selection)
}

/**
 * A block written INTO a paragraph (display maths at a caret in its words, Ctrl+8 round some of them) splits it in
 * two, and each half stays the kind it was — Return's rule (`returnInBlock`): a text cell's halves are written by the
 * escape rule again (a `#` that stood mid-line may start a line now), and a markdown cell's second half gets a marker of
 * its own (a marker left with nothing under it goes down to the words). `change` is the command's edit on `markdown`;
 * the answer is the same edit with the halves seen to.
 */
export function keepingHalves(markdown: string, change: Edit): Edit {
  const from = change.range.location
  const to = end(change.range)
  const cell = positioned(markdown).find((one) => one.block.kind === "paragraph" && one.range.location < to && end(one.range) > from)
  if (!cell) return change
  const start = cell.range.location
  const stop = end(cell.range)
  const marker = markerLength(cell.block)
  const head = from > start ? markdown.slice(start, from) : ""
  const tail = to < stop ? markdown.slice(to, stop) : ""
  let before = head
  let after = tail
  let replacement = change.replacement
  if (marker === 0 && isTextCell(cell.block)) {
    before = escapePlain(unescapePlain(head))
    after = escapePlain(unescapePlain(tail))
  } else if (marker > 0 && tail.trim().length > 0) {
    const gap = /^\n*/.exec(tail)![0]
    after = gap + MARKDOWN_MARKER + "\n" + tail.slice(gap.length)
    if (head.length <= marker) {
      // Nothing of the words above the block: the marker goes down with them, and the block's blank line above it is
      // counted from the cell above.
      before = ""
      const { lead } = cellSpacing(markdown.slice(0, start), replacement)
      replacement = lead + replacement.replace(/^\n+/, "")
    }
  }
  if (before === head && after === tail && replacement === change.replacement) return change
  const whole = range(Math.min(start, from), Math.max(stop, to) - Math.min(start, from))
  const shift = before.length - head.length + replacement.length - change.replacement.length
  const at = change.selection.location >= from ? change.selection.location + shift : change.selection.location
  return edit(whole, before + replacement + after, range(at, change.selection.length))
}

/**
 * Whole cells as another app should get them (the plain-text clipboard): a text cell's words without its escapes'
 * backslashes or Link Here's anchors, a markdown cell without its marker line, everything else as written. (WriteMind's
 * own clipboard keeps the markdown itself.)
 */
export function plainCells(markdown: string): string {
  let out = markdown
  for (const cell of [...positioned(markdown)].reverse()) {
    if (cell.block.kind !== "paragraph") continue
    const source = substring(markdown, cell.range)
    const head = markerLength(cell.block)
    const words = head > 0
      ? source.slice(Math.min(head, source.length))
      : isTextCell(cell.block) ? source.split("\n").map(plainLine).join("\n") : source
    if (words !== source) out = out.slice(0, cell.range.location) + words + out.slice(end(cell.range))
  }
  return out
}

/**
 * Something written INTO the note at `at` by a rich-text action that has no editor (`/link` writes the note on disk):
 * `replacement` over `at`, through the automatic switch: the note after, and where `replacement` landed in it (the
 * switch can take backslashes out and put markers in before AND after it).
 */
export function writeRich(markdown: string, at: Range, replacement: string): { text: string; link: Range } {
  const change = viaMarkdownCells(markdown, at, (text, where) =>
    edit(where, replacement, range(where.location + replacement.length, 0)))
  if (!change) return { text: markdown, link: at }
  const text = markdown.slice(0, change.range.location) + change.replacement + markdown.slice(end(change.range))
  return { text, link: range(change.selection.location - replacement.length, replacement.length) }
}
