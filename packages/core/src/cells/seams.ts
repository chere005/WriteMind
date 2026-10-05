/**
 * The spaces between the cells: where the horizontal cursor lives and where
 * a new cell is born. Ported from `WriteMind/Editor/CellSeams.swift`.
 *
 * ANY space between two cells — with N cells the page is N + 1 seams: one
 * from the top of the page down to the first cell, one between each pair,
 * and one from the last cell to the bottom. What is not a seam is a cell,
 * and there is nothing else on the page.
 *
 * Pure geometry, so the panes cannot drift apart: whoever draws hands in
 * boxes and gets back the same seams. The AppKit-only half of the original
 * — `bands` and `cut`, which existed because two cursor RECTS over one
 * point is AppKit's choice to make — has no counterpart here: a DOM element
 * carries its own cursor and nothing else claims it.
 */

import { end, lineRange, substring, type Range } from "../text/range"
import { linesOf, positioned, type LineSource, type PositionedBlock } from "../markdown/parser"

export interface Seam {
  /** Document points, the coordinates the cells were handed in. */
  top: number
  bottom: number
  /**
   * The character offset a new cell is opened at: the next cell's start, or
   * the note's length under the last cell.
   */
  offset: number
  /**
   * Where the bar that IS the cursor is drawn — which is NOT the middle of
   * the seam, because two of the seams on every page are as tall as the
   * empty page round the note. The hit area is the whole seam and the bar is
   * against the cell it belongs to.
   */
  line: number
}

/** A cell as the pane measures it. */
export interface CellBox {
  top: number
  bottom: number
  offset: number
}

/** The gap the rendered page leaves between two cells, and the thinnest a seam may be. */
export const GAP_HEIGHT = 8

export const seamContains = (seam: Seam, y: number): boolean => y >= seam.top && y <= seam.bottom

type Edge = "top" | "middle" | "bottom"

function fitted(top: number, bottom: number, offset: number, minimum: number, edge: Edge): Seam {
  // Where the bar goes, before any widening.
  let line: number
  switch (edge) {
    // Between two cells the bar is EQUALLY spaced between them.
    case "middle": line = (top + bottom) / 2; break
    // The two ENDS of the page are not spaces between two cells: they are
    // the whole of the empty page above the first cell and below the last,
    // and a bar in the middle of one of those is adrift. Each hugs the
    // cell it belongs to.
    case "top": line = bottom - minimum / 2; break
    case "bottom": line = top + minimum / 2; break
  }
  if (bottom - top >= minimum) return { top, bottom, offset, line }
  // Too thin to hit: the seam is widened and the bar goes back to the
  // middle of it, because that is where the eye already put it.
  switch (edge) {
    case "top": return { top, bottom: top + minimum, offset, line: top + minimum / 2 }
    case "bottom": return { top: bottom - minimum, bottom, offset, line: bottom - minimum / 2 }
    case "middle": {
      const middle = (top + bottom) / 2
      return { top: middle - minimum / 2, bottom: middle + minimum / 2, offset, line: middle }
    }
  }
}

/**
 * The seams of a page. Boxes are sorted here rather than trusted, and one
 * handed in upside down is turned the right way up, because a seam folded
 * inside out would be a hole in the page.
 *
 * `firstCellTop` is where a cell WOULD land on a page that has none — the
 * pane's own top inset, which this file cannot know.
 */
export function seams(options: {
  cells: CellBox[]
  pageTop: number
  pageBottom: number
  noteLength: number
  firstCellTop?: number
  minimum?: number
}): Seam[] {
  const minimum = options.minimum ?? GAP_HEIGHT
  const boxes = options.cells
    .map((cell) => ({
      top: Math.min(cell.top, cell.bottom),
      bottom: Math.max(cell.top, cell.bottom),
      offset: cell.offset,
    }))
    .sort((a, b) => (a.top === b.top ? a.bottom - b.bottom : a.top - b.top))

  // The page is at least as tall as the note laid out on it.
  const head = Math.min(options.pageTop, boxes[0]?.top ?? options.pageTop)
  const foot = Math.max(options.pageBottom, boxes[boxes.length - 1]?.bottom ?? options.pageBottom, head)

  if (boxes.length === 0) {
    // Nothing written yet: the whole page is one seam, and what is typed
    // in it goes at the end of the note.
    const landing = options.firstCellTop ?? head + minimum
    return [{ top: head, bottom: foot, offset: options.noteLength, line: Math.max(head, landing - minimum / 2) }]
  }

  const out: Seam[] = []
  let reached = head
  for (const box of boxes) {
    out.push(fitted(reached, Math.max(reached, box.top), box.offset, minimum,
      out.length === 0 ? "top" : "middle"))
    reached = Math.max(reached, box.bottom)
  }
  out.push(fitted(reached, Math.max(reached, foot), options.noteLength, minimum, "bottom"))
  return out
}

/**
 * The seam a point is in. Containment, not "the nearest one within reach":
 * every point between two cells is in the seam there, and a point on a cell
 * is in no seam at all.
 */
export function seamAt(y: number, all: Seam[]): Seam | null {
  return all.find((seam) => seamContains(seam, y)) ?? null
}

/** A seam's edges snapped OUT to whole pixels. */
export const pixels = (seam: Seam): { top: number; bottom: number } =>
  ({ top: Math.floor(seam.top), bottom: Math.ceil(seam.bottom) })

/** How far outside a seam the pointer has to get before the cursor changes back. */
export const POINTER_SLACK = 2

/**
 * Which seam the POINTER should be shown as being in — not the same question
 * as which seam a CLICK lands in, which is `seamAt` and is exact.
 *
 * It is sticky: once the pointer is being shown as in a seam it stays there
 * until it is clearly out of it. On the Mac two mechanisms set this cursor
 * and met on the seam's own edge; a pointer moving slowly across it made
 * each answer in turn, which is the flicker.
 */
export function pointerSeam(y: number, all: Seam[], showing: number | null,
  slack = POINTER_SLACK): Seam | null {
  if (showing !== null) {
    const held = all.find((seam) => seam.offset === showing)
    if (held) {
      const edges = pixels(held)
      if (y >= edges.top - slack && y <= edges.bottom + slack) return held
    }
  }
  return all.find((seam) => {
    const edges = pixels(seam)
    return y >= edges.top && y <= edges.bottom
  }) ?? null
}

/**
 * Whether a fresh measurement is really a different set of seams. A seam has
 * moved when the eye could see it move; below that the old seams stand.
 */
export function moved(fresh: Seam[], old: Seam[], tolerance = 0.5): boolean {
  if (fresh.length !== old.length) return true
  return fresh.some((seam, index) => {
    const was = old[index]!
    return seam.offset !== was.offset
      || Math.abs(seam.top - was.top) > tolerance
      || Math.abs(seam.bottom - was.bottom) > tolerance
      || Math.abs(seam.line - was.line) > tolerance
  })
}

/**
 * The blank lines that SEPARATE two cells, as opposed to the ones a note is
 * holding on purpose: the first and last of a run are the separators either
 * side of it, and the rest are a cell of empty lines.
 */
export function structuralLines(source: string): Range[] {
  const runs: Range[][] = []
  let current: Range[] = []
  let index = 0
  while (index < source.length) {
    const line = lineRange(source, index)
    if (substring(source, line).trim().length === 0) current.push(line)
    else if (current.length > 0) { runs.push(current); current = [] }
    index = Math.max(end(line), index + 1)
  }
  if (current.length > 0) runs.push(current)
  return runs.flatMap((run) => (run.length <= 2 ? run : [run[0]!, run[run.length - 1]!]))
}

/**
 * Whether line `n` (1-based) of a document held as lines is a blank one in the sense of `structuralLines`: a line
 * exists for each newline and for a last piece with something in it — the empty piece after a closing newline is
 * no line — and it is blank when it has nothing but white space.
 */
export function isBlankLine(doc: LineSource, n: number): boolean {
  if (n < 1 || n > doc.lines) return false
  const line = doc.line(n)
  if (n === doc.lines && line.to === line.from) return false
  return line.text.trim().length === 0
}

/**
 * Whether line `n` is one of the lines `structuralLines` answers with: a blank line that is the first or the last of
 * its run (a run of one or two is all structure). It reads the line and the two beside it and nothing else.
 */
export function isStructuralLine(doc: LineSource, n: number): boolean {
  return isBlankLine(doc, n) && !(isBlankLine(doc, n - 1) && isBlankLine(doc, n + 1))
}

/**
 * The start of every structural line from `fromPos` to `toPos` (a differential test holds it to
 * `structuralLines` on the whole of thousands of random notes): what the rendered page draws as the gaps between
 * its blocks, asked of one stretch of the note instead of all of it.
 */
export function structuralLineStarts(doc: LineSource, fromPos: number, toPos: number): number[] {
  const out: number[] = []
  if (doc.length === 0) return out
  const first = doc.lineAt(Math.min(Math.max(fromPos, 0), doc.length)).number
  const last = doc.lineAt(Math.min(Math.max(toPos, 0), doc.length)).number
  for (let n = first; n <= last; n++) {
    if (!isStructuralLine(doc, n)) continue
    const from = doc.line(n).from
    if (from >= fromPos && from <= toPos) out.push(from)
  }
  return out
}

/**
 * The seam an empty selection is sitting IN, as the offset a cell would be
 * opened at — null when the caret is in a cell and the ordinary caret
 * belongs there.
 *
 * Arming is what the caret's POSITION means, not a mode a click turns on. So
 * ↓ out of the bottom of a cell lands on the bar, ↓ again enters the next
 * cell, and ⌃D leaves the bar between the two halves it just made.
 *
 * `current` is what is armed already, and it stands while the caret is still
 * where the arming put it — which covers the two offsets that cannot speak
 * for themselves (0 and the note's length) and an ordinary click in a seam,
 * which leaves the caret at the first character of the cell BELOW.
 */
export function arm(caret: Range, markdown: string, current: number | null): number | null {
  // Cheap first: this runs on every caret move. A caret that is not alone, or is already the armed offset, or is
  // at either end of the note, never needs the note read at all.
  if (caret.length !== 0) return null
  const offset = caret.location
  if (current !== null && current === offset) return current
  if (offset <= 0 || offset >= markdown.length) return null
  return armIn(caret, linesOf(markdown), () => positioned(markdown), current)
}

/**
 * `arm` over a document that is already held as lines and cells (the editor's): the same answer, but only the
 * lines at the caret are read and the cells are searched, not rebuilt — it runs on EVERY caret move, and used to
 * turn the whole note into a string and parse it twice each time the caret landed on a blank line.
 */
export function armIn(caret: Range, doc: LineSource, cells: () => readonly PositionedBlock[], current: number | null): number | null {
  // A selection of anything at all is not a caret in a seam.
  if (caret.length !== 0) return null
  const offset = caret.location
  if (current !== null && current === offset) return current
  if (offset <= 0 || offset >= doc.length) return null
  // Only a caret on a blank line can be in a seam.
  const here = doc.lineAt(offset)
  if (here.text.trim().length !== 0) return null
  // And only the first and last blank line of a run separate two cells (`structuralLines`).
  if (isBlankLine(doc, here.number - 1) && isBlankLine(doc, here.number + 1)) return null
  const blocks = cells()
  // And a blank line INSIDE a cell is not a space between two: a fenced
  // block is the one cell that can hold an empty line of its own.
  let low = 0
  let high = blocks.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (blocks[middle]!.range.location < offset) low = middle + 1
    else high = middle
  }
  if (low > 0 && offset < end(blocks[low - 1]!.range)) return null
  return blocks[low]?.range.location ?? doc.length
}

/** How wide the + is drawn: a ten-point dot with a cross cut in it. */
export const PLUS_SIZE = 10
/** And how much slack there is round it — a small control is hard to hit exactly. */
export const PLUS_GRIP = 4

import type { Rect } from "../drawing/shapes"
export type { Rect }

/** The dot itself, on the seam's own line. */
export const plus = (line: number, leading: number): Rect =>
  ({ x: leading, y: line - PLUS_SIZE / 2, width: PLUS_SIZE, height: PLUS_SIZE })

/**
 * The patch of page the + answers for: the dot with its slack round it,
 * CLIPPED TO THE SEAM, because the click is — a pointer that turned into a
 * hand five points up into the cell above would promise a press that never
 * arrives.
 */
export function plusTarget(seam: Seam, leading: number, grip = PLUS_GRIP): Rect {
  const target = plus(seam.line, leading)
  const top = Math.max(target.y - grip, seam.top)
  const bottom = Math.min(target.y + target.height + grip, seam.bottom)
  return {
    x: target.x - grip,
    y: top,
    width: target.width + grip * 2,
    height: Math.max(0, bottom - top),
  }
}

/** Whether a point is on the +. Inclusive on all four edges, the way a seam is. */
export function onPlus(x: number, y: number, seam: Seam, leading: number, grip = PLUS_GRIP): boolean {
  const target = plusTarget(seam, leading, grip)
  if (target.height <= 0) return false
  return x >= target.x && x <= target.x + target.width
    && y >= target.y && y <= target.y + target.height
}
