/**
 * What can be done to a whole cell, the way a Mathematica notebook does it.
 * Ported from `WriteMind/Editor/CellCommands.swift`.
 *
 * Click a cell's bracket and the CELL is selected, not a run of characters
 * that happens to cover it. Delete takes it away, ⌘C copies it whole, ⌘X
 * cuts it, ⌘V puts one back after it. All of that is the same handful of
 * edits to the markdown underneath, so they live here, over a string and a
 * range.
 */

import { positioned } from "../markdown/parser"
import { end, intersection, range, type Edit, type Range } from "../text/range"
import { cellSpacing } from "./apart"

/**
 * The cell and the blank line that separates it from the next one — what
 * "delete this cell" really takes, so the stack closes up behind it instead
 * of leaving a hole.
 */
export function extent(cell: Range, text: string): Range {
  if (text.length === 0) return cell
  let stop = Math.min(end(cell), text.length)
  // The newlines after it, up to and including the blank line.
  let newlines = 0
  while (stop < text.length && text[stop] === "\n" && newlines < 2) { stop++; newlines++ }
  // At the end of the note there is nothing below to close up, so the blank
  // line ABOVE it goes instead.
  let start = cell.location
  if (newlines === 0) {
    while (start > 0 && text[start - 1] === "\n" && cell.location - start < 2) start--
  }
  return range(start, stop - start)
}

/**
 * Taking a cell out; the caret goes where the cell was. What is left either side of it stays two cells: a cell that
 * touched one of them (no blank line, `apart.ts`) must not leave the other glued to it.
 */
export function deleteCell(cell: Range, text: string): Edit {
  const taken = extent(cell, text)
  const before = text.slice(0, taken.location)
  const after = text.slice(end(taken))
  const joiner = before.length > 0 && after.length > 0 && !before.endsWith("\n\n") && !after.startsWith("\n")
    ? (before.endsWith("\n") ? "\n" : "\n\n") : ""
  return { range: taken, replacement: joiner, selection: range(taken.location, 0) }
}

/** A cell on the clipboard is its own markdown, so pasting it puts a cell in. */
export function copyCell(cell: Range, text: string): string {
  const start = Math.max(cell.location, 0)
  const stop = Math.min(end(cell), text.length)
  if (stop <= start) return ""
  return text.slice(start, stop).replace(/^\n+|\n+$/g, "")
}

/**
 * Putting a cell in after this one, a cell of its own: a blank line above it, and one below it when the cell after
 * touched this one (`cellSpacing`) — an answer written under a cell with a ```wl block straight under it was glued
 * to that block.
 */
export function pasteCell(markdown: string, after: Range, text: string): Edit {
  const body = markdown.replace(/^\n+|\n+$/g, "")
  const at = Math.min(end(after), text.length)
  const opening = "\n\n"
  const { trail } = cellSpacing(text.slice(0, at) + opening, text.slice(at))
  return {
    range: range(at, 0),
    replacement: opening + body + trail,
    selection: range(at + opening.length, body.length),
  }
}

/** The same cell again, under it — Mathematica's ⌘D on a cell bracket. */
export function duplicateCell(cell: Range, text: string): Edit {
  return pasteCell(copyCell(cell, text), cell, text)
}

/**
 * Dragging a bracket up or down: the cell changes places with its
 * neighbour. Null at the ends of the note. A range that holds SEVERAL cells
 * moves as one run.
 */
export function moveCell(cell: Range, up: boolean, text: string): Edit | null {
  const cells = positioned(text).map((block) => block.range)
  let index = cells.findIndex((c) => c.location === cell.location && c.length === cell.length)
  if (index < 0) index = cells.findIndex((c) => intersection(c, cell).length > 0)
  if (index < 0) return null
  let last = index
  cells.forEach((c, i) => { if (intersection(c, cell).length > 0) last = Math.max(last, i) })
  const otherIndex = up ? index - 1 : last + 1
  if (otherIndex < 0 || otherIndex >= cells.length) return null

  const mine = range(cells[index]!.location, end(cells[last]!) - cells[index]!.location)
  const theirs = cells[otherIndex]!
  const first = up ? theirs : mine
  const second = up ? mine : theirs
  const span = range(first.location, Math.min(end(second), text.length) - first.location)
  const between = range(end(first), second.location - end(first))
  const separator = between.length > 0 ? text.slice(between.location, end(between)) : "\n\n"
  const secondText = text.slice(second.location, end(second))
  const swapped = secondText + separator + text.slice(first.location, end(first))
  // The cell that moved keeps the selection, at its new place.
  const landing = up
    ? range(span.location, mine.length)
    : range(span.location + secondText.length + separator.length, mine.length)
  return { range: span, replacement: swapped, selection: landing }
}

/** Every held cell moved one place. */
export function movingCells(cells: Range[], up: boolean, text: string): Edit[] {
  return editsOver(cells, text, (span, whole) => moveCell(span, up, whole))
}

/**
 * Several cells at once — what Delete, ⌘X and ⌃⇧D do when more than one
 * bracket is lit.
 *
 * BACK TO FRONT: every edit is worked out against the note AS IT IS, so one
 * made in front of another would leave the second pointing at characters
 * that have moved. And cells that sit next to each other go in as ONE span,
 * so `extent` reads the blank line after the LAST of them.
 */
export function editsOver(
  cells: Range[], text: string, make: (span: Range, text: string) => Edit | null,
): Edit[] {
  const all = positioned(text).map((block) => block.range)
  if (all.length === 0) return []

  const indexes: number[] = []
  for (const cell of cells) {
    let inside = all.map((_, i) => i).filter((i) =>
      all[i]!.length > 0 && intersection(all[i]!, cell).length === all[i]!.length)
    if (inside.length === 0) {
      const touched = all.findIndex((c) => intersection(c, cell).length > 0)
      if (touched >= 0) inside = [touched]
    }
    for (const i of inside) if (!indexes.includes(i)) indexes.push(i)
  }
  indexes.sort((a, b) => a - b)

  const spans: Range[] = []
  let previous: number | null = null
  for (const i of indexes) {
    const span = spans[spans.length - 1]
    if (previous !== null && i === previous + 1 && span) {
      spans[spans.length - 1] = range(span.location, end(all[i]!) - span.location)
    } else {
      spans.push(all[i]!)
    }
    previous = i
  }

  const out: Edit[] = []
  // Nothing may reach past the edit already made: at the end of the note
  // `extent` walks BACKWARDS over the blank line above, and two runs a blank
  // cell apart can both want the same newline.
  let limit = text.length
  for (const span of [...spans].reverse()) {
    const change = make(span, text)
    if (!change) continue
    const start = Math.min(change.range.location, limit)
    const clipped = range(start, Math.max(0, Math.min(end(change.range), limit) - start))
    out.push({ range: clipped, replacement: change.replacement, selection: change.selection })
    limit = start
  }
  return out
}
