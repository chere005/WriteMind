/**
 * Finding what is SHOWN (docs/PLAN-bars-2026-10.md P7 (e): "Find is exact"). The note's source holds things neither pane
 * draws: the `<!-- markdown -->` line over a markdown cell (hidden on both pages), and the backslashes and id anchors a
 * text cell hides (`hiddenInText`). Finding in the source counted them — "markdown" found a marker nobody could see, and
 * "a*b" did not find the `a*b` on the page, which the file spells `a\*b`.
 *
 * So the search runs over the note as it reads: those spans taken out, the match mapped back to the source range that
 * holds it (a match across a hidden backslash covers it, so selecting and replacing the match take it whole).
 * Pure, so the rule has its tests beside it; the editor hands in the cells it already has.
 *
 * No Swift original (the Mac's find bar is the text view's own, over what it holds).
 */

import { hiddenInText } from "../markdown/plainText"
import { emptyLineSpan, lineBreakSpan } from "../markdown/emptyLine"
import type { PositionedBlock } from "../markdown/parser"
import { isTextCell } from "../cells/textCells"
import { findAll, defaultFindOptions, type FindOptions } from "./find"
import { range, type Range } from "./range"

/** [from, to) spans of the source nothing draws, ascending and never overlapping. */
export type HiddenSpans = Array<[number, number]>

/** A link's address, `(https://…)` after its words' bracket. */
const LINK_ADDRESS = /\]\(([^)\n]*)\)/g

const LISTS = new Set(["bullets", "dashes", "numbered", "todos", "mixed"])

/**
 * The `<br>` of each empty line a cell keeps, in `cell` (a text cell's are `hiddenInText`'s) — and with `starts`, of each line
 * that starts afresh too (a markdown cell's or a quote's: `lineBreakSpan`).
 */
function keptLinesOf(text: string, cell: Range, out: HiddenSpans, starts = false): void {
  const stop = cell.location + cell.length
  if (!text.slice(cell.location, stop).includes("<")) return
  let at = cell.location
  while (at <= stop) {
    let eol = text.indexOf("\n", at)
    if (eol < 0 || eol > stop) eol = stop
    const span = (starts ? lineBreakSpan : emptyLineSpan)(text.slice(at, eol))
    if (span) out.push([at + span[0], at + span[1]])
    at = eol + 1
  }
}

/**
 * What the note's cells hide: each marked cell's marker line, each text cell's escapes' backslashes and id anchors, and
 * the `<br>` of each empty line a paragraph or a list item keeps.
 * `drawn`: the rendered page, which draws a link as its words and shows nobody the address behind them.
 */
export function hiddenInNote(text: string, cells: readonly PositionedBlock[], drawn = false): HiddenSpans {
  const out: HiddenSpans = []
  for (const cell of cells) {
    if (drawn && cell.block.kind !== "code" && cell.block.kind !== "picture" && !text.startsWith("```", cell.range.location)) {
      const source = text.slice(cell.range.location, cell.range.location + cell.range.length)
      LINK_ADDRESS.lastIndex = 0
      for (let found = LINK_ADDRESS.exec(source); found; found = LINK_ADDRESS.exec(source)) {
        out.push([cell.range.location + found.index + 1, cell.range.location + found.index + found[0].length])
      }
    }
    // An empty line a list item keeps (`<br>`, markdown/emptyLine.ts) is drawn as nothing, and is nothing to find.
    if (LISTS.has(cell.block.kind)) {
      keptLinesOf(text, cell.range, out)
      continue
    }
    // A quote's and a markdown cell's lines that start afresh (Ctrl+Enter writes `<br>` at their head) hide it too.
    if (cell.block.kind === "quote") {
      keptLinesOf(text, cell.range, out, true)
      continue
    }
    if (cell.block.kind !== "paragraph") continue
    const start = cell.range.location
    if (!isTextCell(cell.block)) keptLinesOf(text, cell.range, out, true)
    if (cell.block.head) out.push([start, start + cell.block.head])
    if (!isTextCell(cell.block)) continue
    const stop = cell.range.location + cell.range.length
    let at = start
    while (at <= stop) {
      let eol = text.indexOf("\n", at)
      if (eol < 0 || eol > stop) eol = stop
      for (const [from, to] of hiddenInText(text.slice(at, eol))) out.push([at + from, at + to])
      at = eol + 1
    }
  }
  return out.sort((a, b) => a[0] - b[0])
}

/**
 * Every match of `query` in the note as it reads, as source ranges. With nothing hidden it is `findAll` over the source;
 * otherwise the hidden spans are taken out, the matches found, and each is mapped back (from its first shown character
 * to the end of its last).
 */
export function findVisible(text: string, query: string, options: FindOptions = defaultFindOptions, hidden: HiddenSpans = [], limit = 20000): Range[] {
  if (query.length === 0) return []
  if (hidden.length === 0) return findAll(text, query, options, limit)
  // The shown text, and where each of its characters is in the source.
  const where = new Int32Array(text.length)
  let shown = ""
  let count = 0
  let at = 0
  const take = (from: number, to: number) => {
    for (let i = from; i < to; i++) where[count++] = i
    shown += text.slice(from, to)
  }
  for (const [from, to] of hidden) {
    if (from > at) take(at, from)
    at = Math.max(at, to)
  }
  take(at, text.length)
  return findAll(shown, query, options, limit).map((match) => {
    const from = where[match.location]!
    const to = where[match.location + match.length - 1]! + 1
    return range(from, to - from)
  })
}
