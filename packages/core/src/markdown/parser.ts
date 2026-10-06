/**
 * The block structure of a markdown document — enough for notes, not a spec.
 *
 * Ported from `WriteMind/Editor/MarkdownBlocks.swift`, line for line and rule
 * for rule. A block carries the RANGE it was parsed from, and that is what
 * makes editing the rendered page possible: a block is written back over its
 * own source and nothing else is touched. The document is never round-tripped
 * from rendered text back to markdown — that conversion is lossy, and losing
 * it would be losing the notes.
 *
 * Offsets are UTF-16 code units, which is what a JavaScript string index is
 * and what `NSRange` was, so a range means the same thing on both sides.
 */

import { range, type Range } from "../text/range"
import { inkCellId, mediaFile, pictureLine } from "./images"
import { delimiterAligns, hasPipe, headerCells, tableOf, type TableAlign } from "./table"
import { isMarkdownMarker, looksMarkdown, plainLine } from "./plainText"

export type { Range }

export interface TodoItem {
  text: string
  done: boolean
}

export type Block =
  | { kind: "heading"; level: number; text: string }
  /**
   * Body text (docs/PLAN-text-cells.md). A TEXT cell (no `markdown`): `text` is its lines as they are shown — every
   * line break kept, escapes gone (`plainText.ts`). A MARKDOWN cell (`markdown`): `text` is its lines joined, as
   * markdown reads them; `head` is the length of the marker line (`<!-- markdown -->` and its newline) that opens the
   * cell's range, absent when the older-notes rule made it one.
   */
  | { kind: "paragraph"; text: string; markdown?: true; head?: number }
  | { kind: "bullets"; items: string[] }
  /** A list written with `* `, shown with a dash. Ordinary markdown either way. */
  | { kind: "dashes"; items: string[] }
  /** A GFM task list: the words, and whether the box is ticked. */
  | { kind: "todos"; items: TodoItem[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; language: string | null; body: string }
  | { kind: "rule" }
  /**
   * Empty lines a note holds on purpose. A run of blank lines between two
   * cells is one line to end the cell above, one to announce the cell below,
   * and whatever is left in the middle is a cell of its own.
   */
  | { kind: "blank"; lines: number }
  /**
   * A line that is nothing but one image (`images.ts`): a picture CELL, which text never overlaps. `file` is the
   * media file it names inside the project's own `.drawings/media` (null for a picture that lives elsewhere), and
   * `ink` the id of the ink cell it is when that file is an `ink-<uuid>.svg` snapshot.
   */
  | { kind: "picture"; alt: string; path: string; file: string | null; ink: string | null }
  /**
   * A GitHub-style pipe table (`table.ts`): the header's words, each column's alignment, and the body rows, every
   * row as wide as the header. ONE cell, from the header line to its last row. Port-first: the Mac took tables out on
   * 2026-09-20 to rebuild them from scratch, and this is the first part of that rebuild.
   */
  | { kind: "table"; header: string[]; align: TableAlign[]; rows: string[][] }

export interface PositionedBlock {
  block: Block
  range: Range
}

const trimmed = (line: string): string => line.trim()
const leadingSpaces = (line: string): string => line.slice(0, line.length - line.trimStart().length)

/** `# words` through `###### words`, and nothing with seven hashes. */
export function heading(line: string): { level: number; text: string } | null {
  let hashes = 0
  while (hashes < line.length && line[hashes] === "#") hashes++
  if (hashes < 1 || hashes > 6) return null
  const rest = line.slice(hashes)
  if (rest.length > 0 && !rest.startsWith(" ")) return null
  return { level: hashes, text: rest.trim() }
}

export function isRule(line: string): boolean {
  // Spaces are ignored; what is left is three or more of ONE of - * _. No allocation: this runs on every line
  // (the old `split(" ").join("")` was a fifth of a keystroke's cost in a 500 KB note).
  let mark = 0
  let count = 0
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i)
    if (c === 32) continue
    if (mark === 0) {
      if (c !== 45 && c !== 42 && c !== 95) return false
      mark = c
    } else if (c !== mark) return false
    count++
  }
  return count >= 3
}

/**
 * A task-list line: `- [ ] words` or `- [x] words`, the box either way round
 * in case and either a dash or a star in front of it, which is what other
 * markdown editors write.
 */
export function todoItem(line: string): TodoItem | null {
  for (const marker of ["- ", "* ", "+ "]) {
    if (!line.startsWith(marker)) continue
    const rest = line.slice(marker.length)
    if (!rest.startsWith("[") || rest.length < 3) return null
    const box = rest.slice(1, 2)
    if (rest.slice(2, 3) !== "]") return null
    const after = rest.slice(3)
    // `- []x` is not a task: the box is followed by a space or it is the
    // whole of the line.
    if (after.length > 0 && !after.startsWith(" ")) return null
    // ONE space off the front, not all of them: `- [ ]   milk` is a task
    // whose words are indented, and that is the note's business.
    const text = after.startsWith(" ") ? after.slice(1) : after
    if (box === " ") return { text, done: false }
    if (box.toLowerCase() === "x") return { text, done: true }
    return null
  }
  return null
}

/** A dot bullet: `- ` or `+ `. */
export function bulletItem(line: string): string | null {
  for (const marker of ["- ", "+ "]) if (line.startsWith(marker)) return line.slice(2)
  return null
}

/** A dash bullet: `* `. */
export function dashItem(line: string): string | null {
  return line.startsWith("* ") ? line.slice(2) : null
}

export function numberedItem(line: string): string | null {
  let digits = 0
  while (digits < line.length && line[digits]! >= "0" && line[digits]! <= "9") digits++
  if (digits === 0 || digits > 4) return null
  const rest = line.slice(digits)
  if (!rest.startsWith(". ") && !rest.startsWith(") ")) return null
  return rest.slice(2)
}

export function blocks(markdown: string): Block[] {
  return positioned(markdown).map((p) => p.block)
}

/**
 * Whether a line (trimmed) carries an open table on as one of its rows: it has an unescaped pipe and it starts no
 * block of its own (`- a | b` is a list item, `> a | b` a quote, and either ends the table).
 */
function continuesTable(line: string): boolean {
  if (!hasPipe(line)) return false
  if (line.startsWith("|")) return true
  return !line.startsWith("```") && !line.startsWith(">") && !isRule(line) && heading(line) === null
    && pictureLine(line) === null && todoItem(line) === null && bulletItem(line) === null
    && dashItem(line) === null && numberedItem(line) === null
}

/**
 * The parser as a MACHINE that is fed one line at a time. The whole-document `positioned` feeds it every line; the
 * incremental `positionedUpdate` starts it at the beginning of the block an edit touched and stops it as soon as it
 * is back in step with the blocks it parsed last time. One machine, so the two cannot disagree (a differential test
 * compares them on thousands of random edits).
 */
class Machine {
  readonly out: PositionedBlock[] = []
  private paragraph: string[] = []
  /** The open paragraph's lines as written (its marker left out): a text cell's words. */
  private paraRaw: string[] = []
  /** The open paragraph began with the markdown marker (its first entry in `paragraph`), and how long that line is. */
  private paraMarked = false
  private paraHead = 0
  private bullets: string[] = []
  private todos: TodoItem[] = []
  private dashes: string[] = []
  private numbered: string[] = []
  private quote: string[] = []
  private code: string[] | null = null
  private codeLanguage: string | null = null
  /** The raw lines of an open table: the header, the delimiter row, the body rows so far. */
  private table: string[] | null = null
  // The open paragraph's LAST line, which a delimiter row under it turns into a table's header: how many cells it
  // has as a header (-1: it cannot be one), where it starts, the line as written, and where the line before it ended.
  private paraHeader = -1
  private paraLastStart = 0
  private paraLastRaw = ""
  private paraPrevEnd = 0

  // Where the open block started, and where its last line ended.
  blockStart: number
  private blockEnd: number
  /** The offset the next line starts at. */
  lineStart: number
  // The run of blank lines being counted: how many, where it began, and the lengths (with newline) that
  // `emitBlankRun` needs to find the middle of it.
  private runLines = 0
  private runFirst = 0
  private runFirstLen = 0
  private runAfterFirst = 0
  private runLastLen = 0

  constructor(at = 0) {
    this.blockStart = at
    this.blockEnd = at
    this.lineStart = at
  }

  private emit(block: Block): void {
    this.out.push({ block, range: range(this.blockStart, this.blockEnd - this.blockStart) })
  }

  /**
   * Ends the open block. `endAt` is where its last line ended: when the line
   * that ends a block is itself text (a list item after a paragraph, a
   * heading after a bullet), `blockEnd` has already moved on to THAT line,
   * and a block that took it as its own end overlapped the next one.
   */
  private flush(endAt: number = this.blockEnd): void {
    const kept = this.blockEnd
    this.blockEnd = endAt
    if (this.paragraph.length) {
      const marked = this.paraMarked
      const words = marked ? this.paragraph.slice(1) : this.paragraph
      if (marked || looksMarkdown(this.paraRaw)) {
        const head = Math.min(this.paraHead, this.blockEnd - this.blockStart + 1)
        this.emit(marked ? { kind: "paragraph", text: words.join(" "), markdown: true, head } : { kind: "paragraph", text: words.join(" "), markdown: true })
      } else {
        this.emit({ kind: "paragraph", text: this.paraRaw.map(plainLine).join("\n") })
      }
      this.paragraph = []
      this.paraRaw = []
      this.paraMarked = false
    }
    if (this.bullets.length) { this.emit({ kind: "bullets", items: this.bullets }); this.bullets = [] }
    if (this.todos.length) { this.emit({ kind: "todos", items: this.todos }); this.todos = [] }
    if (this.dashes.length) { this.emit({ kind: "dashes", items: this.dashes }); this.dashes = [] }
    if (this.numbered.length) { this.emit({ kind: "numbered", items: this.numbered }); this.numbered = [] }
    if (this.quote.length) { this.emit({ kind: "quote", text: this.quote.join(" ") }); this.quote = [] }
    if (this.table !== null) {
      const parts = tableOf(this.table)
      if (parts) this.emit({ kind: "table", header: parts.header, align: parts.align, rows: parts.rows })
      this.table = null
    }
    this.blockEnd = kept
  }

  /** The first line of a block sets its start; every line extends its end. */
  private openIfNeeded(): void {
    if (!this.paragraph.length && !this.bullets.length && !this.todos.length && !this.dashes.length
      && !this.numbered.length && !this.quote.length && this.code === null && this.table === null) {
      this.blockStart = this.lineStart
    }
  }

  /**
   * The middle of a run of blank lines, as a cell. The first line of the run
   * and the last one are the separators either side of it, so a run of one or
   * two leaves nothing behind.
   */
  private emitBlankRun(): void {
    const count = this.runLines
    if (count < 3) return
    // `emit` reads blockStart and blockEnd, so this cell has to put them
    // back: the line that ENDED the run has already moved blockEnd on to
    // itself, and a cell that kept the blank run's end left the next one
    // with a range of negative length.
    const openStart = this.blockStart
    const openEnd = this.blockEnd
    const start = this.runFirst + this.runFirstLen
    const to = start + (this.runAfterFirst - this.runLastLen)
    this.blockStart = start
    this.blockEnd = Math.max(start, to - 1)
    this.emit({ kind: "blank", lines: count - 2 })
    this.blockStart = openStart
    this.blockEnd = openEnd
  }

  /** Whether the line just fed (it began at `at`) opened a block of its own rather than joining the one before. */
  opensBlockAt(at: number): boolean { return this.blockStart === at }

  feed(rawLine: string): void {
    const lineEnd = this.lineStart + rawLine.length
    // A line is split on "\n" alone, not on every Unicode newline: the line LENGTHS are what the ranges are built
    // from, and a two-character separator counted as one would put every range after it out by one.
    const line = rawLine.trim()
    // Where the open block's last line ended, before this line moves it.
    const previousEnd = this.blockEnd
    const blank = line.length === 0
    // A blank line ends a block without being part of it, so only the lines
    // that go INTO a block move its end (a paragraph's range stops at its
    // last character, not at the newline after it).
    if (!blank || this.code !== null) this.blockEnd = lineEnd
    const size = rawLine.length + 1

    // A run of blank lines: the first ends the cell above it and the last
    // announces the one below; whatever is between them is a cell of empty
    // lines. Counted HERE, at the top, because every branch below continues.
    if (this.code === null) {
      if (blank) {
        if (this.runLines === 0) {
          this.runFirst = this.lineStart
          this.runFirstLen = size
          this.runAfterFirst = 0
        } else {
          this.runAfterFirst += size
        }
        this.runLastLen = size
        this.runLines++
      } else if (this.runLines > 0) {
        this.emitBlankRun()
        this.runLines = 0
      }
    }

    if (this.code !== null) {
      if (line.startsWith("```")) {
        this.emit({ kind: "code", language: this.codeLanguage, body: this.code.join("\n") })
        this.code = null
        this.codeLanguage = null
      } else {
        this.code.push(rawLine)
      }
      this.lineStart += size
      return
    }

    // An open table takes every line that is one of its rows; any other line (a blank one too) ends it.
    if (this.table !== null) {
      if (!blank && continuesTable(line)) {
        this.table.push(rawLine)
        this.lineStart += size
        return
      }
      this.flush(previousEnd)
    }

    if (line.startsWith("```")) {
      this.flush(previousEnd)
      this.blockStart = this.lineStart
      const lang = line.slice(3).trim()
      this.codeLanguage = lang.length ? lang : null
      this.code = []
      this.lineStart += size
      return
    }
    if (blank) { this.flush(); this.lineStart += size; return }
    // A delimiter row (`|---|:--:|`) under a paragraph line that can be a header, with as many cells: that line and
    // this one open a table, and the lines of the paragraph before it (if any) are a paragraph of their own. The one
    // place a line changes what the line BEFORE it was; `positionedUpdate` restarts before such a table for it.
    if (this.paragraph.length && this.paraHeader > 0) {
      const aligns = delimiterAligns(line)
      if (aligns && aligns.length === this.paraHeader) {
        const header = this.paraLastRaw
        const headerStart = this.paraLastStart
        this.paragraph.pop()
        this.paraRaw.pop()
        if (this.paragraph.length) this.flush(this.paraPrevEnd)
        this.blockStart = headerStart
        this.table = [header, rawLine]
        this.paraHeader = -1
        this.lineStart += size
        return
      }
    }
    // The markdown marker opens a paragraph of its own (whatever was open ends): the cell it marks, from this line.
    if (isMarkdownMarker(line)) {
      this.flush(previousEnd)
      this.blockStart = this.lineStart
      this.paraMarked = true
      this.paraHead = size
      this.paraPrevEnd = previousEnd
      this.paraLastStart = this.lineStart
      this.paraLastRaw = rawLine
      this.paraHeader = -1
      this.paragraph.push(line)
      this.lineStart += size
      return
    }
    if (isRule(line)) {
      this.flush(previousEnd); this.blockStart = this.lineStart; this.emit({ kind: "rule" })
      this.lineStart += size; return
    }
    const head = heading(line)
    if (head) {
      this.flush(previousEnd); this.blockStart = this.lineStart
      this.emit({ kind: "heading", level: head.level, text: head.text })
      this.lineStart += size; return
    }
    // A line that is one image and nothing else is a cell of its own, like a heading: it ends the block above it
    // (`![](x)` straight under a paragraph line splits from it, the Mac's rule) and is emitted by its own line. An
    // image inside a list item or a quote is not the whole line, and stays where it is.
    const picture = pictureLine(line)
    if (picture) {
      this.flush(previousEnd); this.blockStart = this.lineStart
      const file = mediaFile(picture.path)
      this.emit({ kind: "picture", alt: picture.alt, path: picture.path, file, ink: inkCellId(file) })
      this.lineStart += size; return
    }
    if (line.startsWith(">")) {
      if (this.paragraph.length || this.bullets.length || this.todos.length || this.dashes.length || this.numbered.length) this.flush(previousEnd)
      this.openIfNeeded()
      this.quote.push(line.slice(1).trim())
      this.lineStart += size; return
    }
    // Before the plain bullet, because `- [ ] milk` starts with `- ` and
    // would otherwise be a bullet whose words are a box.
    const todo = todoItem(line)
    if (todo) {
      if (this.paragraph.length || this.bullets.length || this.dashes.length || this.numbered.length || this.quote.length) this.flush(previousEnd)
      this.openIfNeeded()
      this.todos.push(todo)
      this.lineStart += size; return
    }
    const bullet = bulletItem(line)
    if (bullet !== null) {
      if (this.paragraph.length || this.todos.length || this.dashes.length || this.numbered.length || this.quote.length) this.flush(previousEnd)
      this.openIfNeeded()
      this.bullets.push(bullet)
      this.lineStart += size; return
    }
    const dash = dashItem(line)
    if (dash !== null) {
      if (this.paragraph.length || this.bullets.length || this.todos.length || this.numbered.length || this.quote.length) this.flush(previousEnd)
      this.openIfNeeded()
      this.dashes.push(dash)
      this.lineStart += size; return
    }
    const number = numberedItem(line)
    if (number !== null) {
      if (this.paragraph.length || this.bullets.length || this.todos.length || this.dashes.length || this.quote.length) this.flush(previousEnd)
      this.openIfNeeded()
      this.numbered.push(number)
      this.lineStart += size; return
    }
    if (this.bullets.length || this.todos.length || this.dashes.length || this.numbered.length || this.quote.length) this.flush(previousEnd)
    this.openIfNeeded()
    this.paraPrevEnd = previousEnd
    this.paraLastStart = this.lineStart
    this.paraLastRaw = rawLine
    this.paraHeader = headerCells(rawLine)
    // The first line keeps the spaces it was written with, so an indented
    // paragraph is drawn indented. Four spaces is NOT a code block here —
    // code is what is inside ```, ` or `` and nothing else.
    this.paragraph.push(this.paragraph.length === (this.paraMarked ? 1 : 0) ? leadingSpaces(rawLine) + line : line)
    this.paraRaw.push(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine)
    this.lineStart += size
  }

  /** The end of the text: an unclosed fence still renders as code, the open block is closed, a trailing blank run is counted. */
  finish(): PositionedBlock[] {
    if (this.code !== null) {
      // An unclosed fence still renders as code — better than swallowing the
      // rest of the note.
      this.emit({ kind: "code", language: this.codeLanguage, body: this.code.join("\n") })
    }
    this.flush()
    if (this.runLines > 0) this.emitBlankRun()
    return this.out
  }
}

export function positioned(markdown: string): PositionedBlock[] {
  const machine = new Machine()
  let at = 0
  for (;;) {
    const stop = markdown.indexOf("\n", at)
    if (stop < 0) { machine.feed(markdown.slice(at)); break }
    machine.feed(markdown.slice(at, stop))
    at = stop + 1
  }
  return machine.finish()
}

/** A document read line by line — CodeMirror's `Text` is one, and so is anything else with these members. */
export interface LineSource {
  readonly lines: number
  readonly length: number
  /** Line `n`, 1-based. */
  line(n: number): { readonly from: number; readonly to: number; readonly text: string }
  /** The line holding `pos`. */
  lineAt(pos: number): { readonly number: number; readonly from: number; readonly to: number; readonly text: string }
}

/** A string as a `LineSource` (for tests and for callers that only have the text). */
export function linesOf(text: string): LineSource {
  const starts = [0]
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1)
  const lineAt = (number: number) => {
    const from = starts[number - 1]!
    const to = number < starts.length ? starts[number]! - 1 : text.length
    return { from, to, number, text: text.slice(from, to) }
  }
  return {
    lines: starts.length,
    length: text.length,
    line: lineAt,
    lineAt(pos) {
      let lo = 0, hi = starts.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= pos) lo = mid; else hi = mid - 1 }
      return lineAt(lo + 1)
    },
  }
}

/** What changed, as ONE hull: the part of the old text from `from` to `toOld` became the new text from `from` to `toNew`. */
export interface Hull { from: number; toOld: number; toNew: number }

/** Index of the first block whose location is >= `at` (blocks are in order of location). */
function firstAtOrAfter(blocks: PositionedBlock[], at: number): number {
  let lo = 0, hi = blocks.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (blocks[mid]!.range.location < at) lo = mid + 1; else hi = mid }
  return lo
}

/**
 * `positioned(newText)` worked out from `positioned(oldText)` and what changed, by parsing again only from the start
 * of the block the edit touched, to the first block after it that is where it was (shifted by the edit's length).
 * Every line up to the block before the edit's line and every line from that synchronising block on is a line the
 * parser has already read, in the state it would read it in: a block's start is a place where the machine holds
 * nothing over from the line before, so starting there — or stopping there — cannot change an answer. The result is
 * identical to a full parse (the differential tests in `parserIncremental.test.ts`); an edit that changes what
 * comes after it for good — a fence opened or closed — simply never gets back in step and parses to the end.
 *
 * Blocks reused from before the edit are the very same objects; those after it are new objects (their offsets
 * moved) sharing the old `block`.
 */
export function positionedUpdate(old: PositionedBlock[], hull: Hull, doc: LineSource): PositionedBlock[] {
  const delta = hull.toNew - hull.toOld
  const edited = doc.lineAt(Math.min(hull.from, doc.length))
  // Where to start: the last block that begins before the edited line (a blank cell is not a place to start: the
  // run it counts began earlier).
  let keep = firstAtOrAfter(old, edited.from) - 1
  while (keep >= 0 && old[keep]!.block.kind === "blank") keep--
  // Nor is a table straight under a paragraph line: its header was that paragraph's last line until the delimiter row
  // came, and an edit that unmakes the table gives the line back to the paragraph above. Start at the paragraph.
  while (keep > 0 && old[keep]!.block.kind === "table" && old[keep - 1]!.block.kind === "paragraph"
    && old[keep - 1]!.range.location + old[keep - 1]!.range.length + 1 === old[keep]!.range.location) keep--
  const restart = keep >= 0 ? old[keep]!.range.location : 0
  if (keep < 0) keep = 0
  const machine = new Machine(restart)
  // The blocks after the edit that could be where the parse is back in step: those that begin at or after its end.
  let next = firstAtOrAfter(old, hull.toOld)
  while (next < old.length && old[next]!.block.kind === "blank") next++
  let sync = -1
  for (let n = doc.lineAt(restart).number; n <= doc.lines; n++) {
    const line = doc.line(n)
    machine.feed(line.text)
    while (next < old.length && old[next]!.range.location + delta < line.from) {
      next++
      while (next < old.length && old[next]!.block.kind === "blank") next++
    }
    if (next < old.length && old[next]!.range.location + delta === line.from && machine.opensBlockAt(line.from)) {
      sync = next
      break
    }
  }
  // (A heading, a rule or a picture is emitted by the very line that opens it; the old suffix has it already.)
  if (sync >= 0) {
    const last = machine.out[machine.out.length - 1]
    if (last && last.range.location === old[sync]!.range.location + delta) machine.out.pop()
  }
  const result = old.slice(0, keep)
  for (const one of sync < 0 ? machine.finish() : machine.out) result.push(one)
  if (sync >= 0) {
    for (let i = sync; i < old.length; i++) {
      const b = old[i]!
      result.push(delta === 0 ? b : { block: b.block, range: { location: b.range.location + delta, length: b.range.length } })
    }
  }
  return result
}
