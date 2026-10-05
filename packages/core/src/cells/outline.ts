/**
 * The note read as a notebook: a heading opens a group that runs to the next
 * heading of its own level or higher, the way Wolfram and Jupyter notebooks
 * nest their cells. Ported from `WriteMind/Editor/NotebookOutline.swift`.
 *
 * Pure: text and ranges in, sections and edits out. The gutter draws these,
 * the fold hides their bodies, and the move commands swap them with their
 * neighbours.
 */

import { clamped, edit, end, range, substring, union, type Edit, type Range } from "../text/range"
import { heading as headingOf, type LineSource, type PositionedBlock } from "../markdown/parser"

/**
 * The author line (level 6) groups nothing: it sits under a title the way a
 * subtitle does, and what follows it still belongs to the title.
 */
export const LEAF_LEVEL = 6

export interface Section {
  /**
   * What the fold state is remembered by: the heading's words, with an
   * ordinal when the same words head more than one section. Nothing else in
   * the note is stable enough — an offset moves with every keystroke above
   * it.
   */
  key: string
  title: string
  level: number
  /** How many sections enclose this one. */
  depth: number
  /** The heading line, without its newline. */
  headingRange: Range
  /** The heading's first character to the end of the group's last line. */
  range: Range
  /** Where the last WRITTEN line ends, which is where a bracket stops. */
  contentEnd: number
}

/** Whether there is anything under the heading worth folding away. */
export const hasBody = (section: Section): boolean =>
  section.contentEnd > end(section.headingRange)

/**
 * The text hidden while the section is closed: from the heading's own
 * newline through the body's last newline, so every hidden line is a whole
 * paragraph and the next visible line starts fresh.
 */
export function hiddenRange(section: Section, length: number): Range {
  const start = end(section.headingRange)
  const stop = Math.min(length, end(section.range) + 1)
  return range(start, Math.max(0, stop - start))
}

interface OutlineLine {
  range: Range
  level: number
  title: string
  blank: boolean
}

/**
 * Every heading in the text, in order, with its group worked out. A `#`
 * inside a code fence is code, not a heading.
 */
export function sections(text: string): Section[] {
  const lines: OutlineLine[] = []
  let offset = 0
  let inFence = false
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    let level = 0
    let title = ""
    if (trimmed.startsWith("```")) {
      inFence = !inFence
    } else if (!inFence) {
      const found = headingOf(trimmed)
      if (found) { level = found.level; title = found.text.trim() }
    }
    lines.push({ range: range(offset, line.length), level, title, blank: trimmed.length === 0 })
    offset += line.length + 1
  }

  const result: Section[] = []
  const headingLines: number[] = []
  const open: number[] = []
  const titles = new Map<string, number>()

  const close = (index: number, beforeLine: number) => {
    const last = lines[beforeLine - 1]!
    const start = result[index]!.range.location
    result[index]!.range = range(start, end(last.range) - start)
    let written = beforeLine - 1
    while (written > headingLines[index]! && lines[written]!.blank) written--
    result[index]!.contentEnd = end(lines[written]!.range)
  }

  lines.forEach((line, index) => {
    if (line.level <= 0) return
    if (line.level < LEAF_LEVEL) {
      while (open.length > 0 && result[open[open.length - 1]!]!.level >= line.level) {
        close(open[open.length - 1]!, index)
        open.pop()
      }
    }
    const count = (titles.get(line.title) ?? 0) + 1
    titles.set(line.title, count)
    const key = count === 1 ? line.title : `${line.title}#${count}`
    result.push({
      key, title: line.title, level: line.level, depth: open.length,
      headingRange: line.range, range: line.range, contentEnd: end(line.range),
    })
    headingLines.push(index)
    if (line.level < LEAF_LEVEL) open.push(result.length - 1)
  })
  while (open.length > 0) {
    close(open[open.length - 1]!, lines.length)
    open.pop()
  }
  return result
}

/**
 * The same sections as `sections(text)`, worked out from the note's parsed cells and its lines instead of from its
 * text: a heading line is exactly a heading CELL (the parser and the outline read fences the same way), so nothing
 * has to be lexed again, and only the lines at the edges of a section are read. This is what the editor keeps up
 * to date on every keystroke (`sections` stays for callers that only have a string; a differential test holds the
 * two together on thousands of random notes).
 */
export function sectionsFromCells(cells: readonly PositionedBlock[], doc: LineSource): Section[] {
  const result: Section[] = []
  const open: number[] = []
  const titles = new Map<string, number>()
  /** Where the last line with writing in it ends, as far as the cells have got: a cell ends at its last written line. */
  let written = 0

  /** A group ends on the line before the heading that closes it, and its content on the last written line before that. */
  const close = (index: number, closingAt: number, contentEnd: number) => {
    const start = result[index]!.range.location
    result[index]!.range = range(start, closingAt - 1 - start)
    result[index]!.contentEnd = contentEnd
  }

  for (const cell of cells) {
    const block = cell.block
    if (block.kind === "blank") continue
    if (block.kind !== "heading") { written = end(cell.range); continue }
    if (block.level < LEAF_LEVEL) {
      while (open.length > 0 && result[open[open.length - 1]!]!.level >= block.level) {
        close(open[open.length - 1]!, cell.range.location, written)
        open.pop()
      }
    }
    const count = (titles.get(block.text) ?? 0) + 1
    titles.set(block.text, count)
    const key = count === 1 ? block.text : `${block.text}#${count}`
    result.push({
      key, title: block.text, level: block.level, depth: open.length,
      headingRange: cell.range, range: cell.range, contentEnd: end(cell.range),
    })
    written = end(cell.range)
    if (block.level < LEAF_LEVEL) open.push(result.length - 1)
  }
  if (open.length > 0) {
    // What is still open ends with the note. Its last written line is found in the lines themselves: the last
    // cell can be an unclosed fence, whose trailing blank lines are not writing but are in its range.
    let last = doc.lines
    while (last > 1 && doc.line(last).text.trim().length === 0) last--
    const tail = doc.line(last).to
    while (open.length > 0) close(open.pop()!, doc.length + 1, tail)
  }
  return result
}

/** The innermost section the caret is in, or null before the first heading. */
export function sectionContaining(caret: number, all: Section[]): Section | null {
  // The sections are in the order of their headings, and a section that contains the caret and starts after another
  // that does is nested in it — so the LAST section (in that order) that starts at or before the caret and still
  // reaches it is the innermost. Binary search for where "starts at or before the caret" ends, then walk back.
  let low = 0
  let high = all.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (all[middle]!.range.location <= caret) low = middle + 1
    else high = middle
  }
  for (let index = low - 1; index >= 0; index--) {
    const section = all[index]!
    if (caret <= end(section.range)) return section
  }
  return null
}

/**
 * How far in a cell's bracket is drawn: one step inside the section that
 * holds it, and at the margin when no section does.
 */
export function cellDepth(offset: number, all: Section[]): number {
  return (sectionContaining(offset, all)?.depth ?? -1) + 1
}

/** The sections directly inside `parent` (all the top-level ones for null). */
export function children(parent: Section | null, all: Section[]): Section[] {
  if (!parent) return all.filter((section) => section.depth === 0)
  return all.filter((section) =>
    section.depth === parent.depth + 1
    && section.range.location > parent.range.location
    && end(section.range) <= end(parent.range))
}

export function parentOf(section: Section, all: Section[]): Section | null {
  return all.find((other) =>
    other.depth === section.depth - 1
    && other.range.location < section.range.location
    && end(section.range) <= end(other.range)) ?? null
}

/**
 * The bodies of the closed sections, as ranges to hide — merged, since a
 * closed section inside a closed section is hidden once.
 */
export function hiddenRanges(text: string, collapsed: Set<string>): Range[] {
  if (collapsed.size === 0) return []
  const ranges = sections(text)
    .filter((section) => collapsed.has(section.key) && hasBody(section))
    .map((section) => hiddenRange(section, text.length))
    .filter((r) => r.length > 0)
    .sort((a, b) => a.location - b.location)
  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.location <= end(last)) merged[merged.length - 1] = union(last, r)
    else merged.push(r)
  }
  return merged
}

/** Runs of written lines before `limit`, each from its first character to the end of its last line. */
export function paragraphs(text: string, limit: number): Range[] {
  const cells: Range[] = []
  let current: Range | null = null
  let offset = 0
  for (const line of text.split("\n")) {
    const r = range(offset, line.length)
    offset += line.length + 1
    if (r.location >= limit) break
    if (line.trim().length === 0) {
      if (current) { cells.push(current); current = null }
    } else if (current) {
      current = range(current.location, end(r) - current.location)
    } else {
      current = r
    }
  }
  if (current) cells.push(current)
  return cells
}

/**
 * The edit that moves the caret's section above the sibling before it or
 * below the one after it. A section moves with everything nested in it;
 * before the first heading the cells are paragraphs, and it is the paragraph
 * that moves. Null when there is nothing to swap with.
 */
export function moveSection(text: string, selection: Range, up: boolean): Edit | null {
  const caret = clamped(selection, text.length).location
  const all = sections(text)
  let moving: Range
  let other: Range
  const section = sectionContaining(caret, all)
  if (section) {
    const siblings = children(parentOf(section, all), all)
    const index = siblings.findIndex((s) => s.key === section.key)
    if (index < 0) return null
    const neighbour = up ? index - 1 : index + 1
    if (neighbour < 0 || neighbour >= siblings.length) return null
    moving = section.range
    other = siblings[neighbour]!.range
  } else {
    const cells = paragraphs(text, all[0]?.range.location ?? text.length)
    const index = cells.findIndex((cell) => cell.location <= caret && caret <= end(cell))
    if (index < 0) return null
    const neighbour = up ? index - 1 : index + 1
    if (neighbour < 0 || neighbour >= cells.length) return null
    moving = cells[index]!
    other = cells[neighbour]!
  }

  const first = up ? other : moving
  const second = up ? moving : other
  const span = range(first.location, end(second) - first.location)
  const firstText = substring(text, first)
  const secondText = substring(text, second)
  const gap = substring(text, range(end(first), second.location - end(first)))
  const replacement = secondText + gap + firstText

  const delta = caret - moving.location
  const landing = up ? span.location : span.location + secondText.length + gap.length
  const length = end(selection) <= end(moving) ? selection.length : 0
  return edit(span, replacement, range(landing + delta, length))
}
