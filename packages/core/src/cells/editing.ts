/**
 * The document surgery the notebook does: make a cell, split one, take an
 * empty one away, carry a list on to the next line. Pure, so the awkward
 * cases — the first cell, the last one, a note that is empty — are tested
 * rather than discovered.
 *
 * Ported from `WriteMind/Editor/PreviewEditing.swift` and
 * `WriteMind/Editor/NotebookCells.swift`.
 */

import {
  clamped, edit, end, lineRange, range, rangeOfWord, replacing, substring,
  type Edit, type Range,
} from "../text/range"
import { positioned, todoItem, type PositionedBlock } from "../markdown/parser"
import { lineRangeCovering } from "../markdown/formatting"
import { sectionContaining, sections } from "./outline"

/** Whether the cell that starts exactly here is a run of blank lines. */
function opensABlankCell(markdown: string, offset: number): boolean {
  return positioned(markdown).some((block) =>
    block.range.location === offset && block.block.kind === "blank")
}

/**
 * A new, empty cell at `offset`, with the blank lines it needs on both
 * sides. Returns the note and where the cell starts.
 */
export function insertBlock(markdown: string, offset: number): { markdown: string; caret: number } {
  const at = Math.min(Math.max(offset, 0), markdown.length)
  const before = markdown.slice(0, at)
  const after = markdown.slice(at)

  const lead = before.length === 0 ? "" : (before.endsWith("\n\n") ? "" : (before.endsWith("\n") ? "\n" : "\n\n"))
  // The blank lines a new cell needs under it, EXCEPT where the newlines
  // already there are a cell of their own: a run of empty lines is the
  // note's content, not spacing, so reading the first two of them as this
  // cell's separator ate two of them.
  let trail: string
  if (after.length === 0) trail = ""
  else if (opensABlankCell(markdown, at)) trail = "\n\n"
  else trail = after.startsWith("\n\n") ? "" : (after.startsWith("\n") ? "\n" : "\n\n")

  return { markdown: before + lead + trail + after, caret: before.length + lead.length }
}

/**
 * Return in the middle of a cell: what is behind the caret stays, what is in
 * front of it becomes the next cell.
 */
export function splitBlock(markdown: string, at: Range, head: string, tail: string):
  { markdown: string; editing: Range } {
  if (end(at) > markdown.length) return { markdown, editing: at }
  const replacement = head + "\n\n" + tail
  return {
    markdown: replacing(markdown, at, replacement),
    editing: range(at.location + head.length + 2, tail.length),
  }
}

/**
 * Backspace in a cell with nothing in it: the cell goes, and so do the blank
 * lines that were holding it apart from its neighbours.
 */
export function removeBlock(markdown: string, at: Range): { markdown: string; previous: Range | null } {
  if (end(at) > markdown.length) return { markdown, previous: null }
  let start = at.location
  while (start > 0 && markdown[start - 1] === "\n") start--
  let stop = end(at)
  while (stop < markdown.length && markdown[stop] === "\n") stop++

  // Whatever is left on either side still has to be two separate cells.
  const joiner = start > 0 && stop < markdown.length ? "\n\n" : ""
  const updated = replacing(markdown, range(start, stop - start), joiner)
  const before = positioned(updated).filter((block) => end(block.range) <= start)
  return { markdown: updated, previous: before.length ? before[before.length - 1]!.range : null }
}

/**
 * What the next line of a list, or a quote, starts with. Null when the line
 * is not one of those; empty when the item is empty and Return should end
 * the list instead of adding to it.
 */
export function listContinuation(line: string): string | null {
  const indent = /^[ \t]*/.exec(line)![0]
  const rest = line.slice(indent.length)

  // A task list carries on as a task, unticked: the next thing is something
  // still to do.
  const task = todoItem(rest)
  if (task) {
    const marker = rest.slice(0, 2)
    return task.text.length === 0 ? "" : indent + marker + "[ ] "
  }
  for (const marker of ["- ", "* ", "+ ", "> "]) {
    if (!rest.startsWith(marker)) continue
    return rest.slice(marker.length).trim().length === 0 ? "" : indent + marker
  }

  const digits = /^[0-9]{1,4}/.exec(rest)?.[0] ?? ""
  if (digits.length > 0) {
    const afterDigits = rest.slice(digits.length)
    for (const marker of [". ", ") "]) {
      if (!afterDigits.startsWith(marker)) continue
      if (afterDigits.slice(2).trim().length === 0) return ""
      return indent + String(Number(digits) + 1) + marker
    }
  }
  return null
}

/** The block a character index falls in — the one it starts, when it sits exactly on a boundary. */
export function blockContaining(character: number, text: string): PositionedBlock | null {
  const cells = positioned(text)
  const inside = cells.find((cell) =>
    character >= cell.range.location && character < end(cell.range))
  if (inside) return inside
  const ending = cells.filter((cell) => end(cell.range) === character)
  return ending.length ? ending[ending.length - 1]! : null
}

/** A space, a tab, and the newline at a line boundary: what a break absorbs. */
const isBlankChar = (character: string | undefined): boolean =>
  character === " " || character === "\t" || character === "\n"

/**
 * The cell holding the caret, cut in two there. The caret lands BETWEEN the
 * two cells — on the blank line the break puts in, which is the seam the
 * pane arms as the bar.
 *
 * Nothing happens at either end of a cell, and nothing happens inside a
 * fenced block: a blank line in the middle of one does not make two blocks,
 * it makes one block with a hole in it.
 */
export function splitCell(text: string, selection: Range): Edit | null {
  const caret = Math.min(Math.max(selection.location, 0), text.length)
  const cell = blockContaining(caret, text)
  if (!cell || cell.block.kind === "code") return null

  // The whitespace the caret sits in goes with the break: splitting
  // "one | two" must not leave a space hanging off either cell, and a cut
  // at a LINE boundary must not leave the newline that is already there
  // under the two the break writes.
  let start = caret
  let stop = caret
  while (start > cell.range.location && isBlankChar(text[start - 1])) start--
  const cellEnd = end(cell.range)
  while (stop < cellEnd && isBlankChar(text[stop])) stop++

  const head = text.slice(cell.range.location, start)
  const tail = text.slice(stop, cellEnd)
  if (head.trim().length === 0 || tail.trim().length === 0) return null

  return edit(range(start, stop - start), "\n\n", range(start + 1, 0))
}

/**
 * The cell holding the caret and the one after it, joined — or, in the last
 * cell, that one and the one before it. The caret lands on the seam.
 *
 * A heading will not take another cell's words: it is one line by definition.
 */
export function mergeCells(text: string, selection: Range): Edit | null {
  const caret = Math.min(Math.max(selection.location, 0), text.length)
  const cells = positioned(text)
  if (cells.length === 0) return null
  let index = cells.findIndex((cell) =>
    (caret >= cell.range.location && caret < end(cell.range)) || caret === cell.range.location)
  if (index < 0) index = cells.length - 1
  const pair = index + 1 < cells.length ? [index, index + 1] : [index - 1, index]
  const [firstIndex, secondIndex] = pair as [number, number]
  if (firstIndex < 0 || secondIndex >= cells.length) return null
  const first = cells[firstIndex]!
  const second = cells[secondIndex]!
  if (first.block.kind === "heading" || first.block.kind === "code" || second.block.kind === "code") return null

  const seam = end(first.range)
  const gap = range(seam, Math.max(0, second.range.location - seam))
  if (gap.length <= 0) return null
  return edit(gap, "\n", range(seam + 1, 0))
}

/**
 * Mathematica's ⌘. — the selection grown one step: the word the caret is in,
 * then the whole cell, then the section that holds it, then the note. Null
 * when there is nothing bigger to take.
 */
export function expand(selection: Range, text: string): Range | null {
  if (text.length === 0) return null
  const caret = Math.min(Math.max(selection.location, 0), text.length - 1)

  // The word first, unless a word is already what is held.
  const word = rangeOfWord(text, caret)
  if ((selection.length === 0 || (word.length > 0 && !(word.location === selection.location && word.length === selection.length)))
    && word.length > selection.length) {
    return word
  }
  const cell = blockContaining(caret, text)?.range
  if (cell && cell.length > selection.length
    && !(cell.location === selection.location && cell.length === selection.length)) {
    return cell
  }
  const all = sections(text)
  const section = sectionContaining(caret, all)
  if (section) {
    const stop = Math.min(Math.max(section.contentEnd, end(section.headingRange)), text.length)
    const whole = range(section.range.location, Math.max(0, stop - section.range.location))
    if (whole.length > selection.length) return whole
  }
  return text.length > selection.length ? range(0, text.length) : null
}

/**
 * One blank line between two cells, never a stack of them.
 *
 * A note is a stack of cells: they come one after another, and the empty
 * space between them is the editor's, not the file's. Two exceptions, both
 * necessary: blank lines INSIDE a fence are code, and the line the caret is
 * on is the empty cell being typed into, which cannot be taken away while it
 * is being used. Null when there is nothing to tidy, which is almost every
 * keystroke.
 */
export function tidied(text: string, caret: number): { text: string; caret: number } | null {
  if (text.length === 0) return null
  const lines: { range: Range; blank: boolean }[] = []
  let index = 0
  let inFence = false
  while (index < text.length) {
    const line = lineRange(text, index)
    const body = substring(text, line).trim()
    if (body.startsWith("```")) inFence = !inFence
    lines.push({ range: line, blank: body.length === 0 && !inFence })
    index = Math.max(end(line), index + 1)
  }

  const keep = new Array<boolean>(lines.length).fill(true)
  let runStart: number | null = null
  const settle = (stop: number) => {
    if (runStart === null) return
    for (let i = runStart; i < stop; i++) {
      if (i === runStart) continue
      // The caret's own blank line stays: it is the cell being typed into.
      const line = lines[i]!.range
      keep[i] = caret >= line.location && caret <= end(line)
    }
    // A note does not begin with blank lines at all — not even the one a
    // run keeps between two cells, because there is no cell above the
    // first one.
    if (runStart === 0) keep[0] = false
    runStart = null
  }
  lines.forEach((line, i) => {
    if (line.blank) { if (runStart === null) runStart = i }
    else settle(i)
  })
  settle(lines.length)

  if (!keep.includes(false)) return null
  let out = ""
  let moved = caret
  lines.forEach((line, i) => {
    const body = substring(text, line.range)
    if (keep[i]) out += body
    else if (line.range.location < caret) moved -= body.length
  })
  return { text: out, caret: Math.min(Math.max(moved, 0), out.length) }
}

/** The line the caret is in, as a range. */
export function caretLine(text: string, location: number): Range {
  if (text.length === 0) return range(0, 0)
  return lineRangeCovering(text, clamped(range(location, 0), text.length))
}
