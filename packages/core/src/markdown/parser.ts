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

export type { Range }

export interface TodoItem {
  text: string
  done: boolean
}

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
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
  const compact = line.split(" ").join("")
  if (compact.length < 3) return false
  return /^-+$/.test(compact) || /^\*+$/.test(compact) || /^_+$/.test(compact)
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

export function positioned(markdown: string): PositionedBlock[] {
  const out: PositionedBlock[] = []
  let paragraph: string[] = []
  let bullets: string[] = []
  let todos: TodoItem[] = []
  let dashes: string[] = []
  let numbered: string[] = []
  let quote: string[] = []
  let code: string[] | null = null
  let codeLanguage: string | null = null

  // Where the open block started, and where its last line ended.
  let blockStart = 0
  let blockEnd = 0
  let lineStart = 0
  let blankRunStart: number | null = null
  let blankRunFirst = 0

  const emit = (block: Block) => {
    out.push({ block, range: range(blockStart, blockEnd - blockStart) })
  }

  const flush = () => {
    if (paragraph.length) { emit({ kind: "paragraph", text: paragraph.join(" ") }); paragraph = [] }
    if (bullets.length) { emit({ kind: "bullets", items: bullets }); bullets = [] }
    if (todos.length) { emit({ kind: "todos", items: todos }); todos = [] }
    if (dashes.length) { emit({ kind: "dashes", items: dashes }); dashes = [] }
    if (numbered.length) { emit({ kind: "numbered", items: numbered }); numbered = [] }
    if (quote.length) { emit({ kind: "quote", text: quote.join(" ") }); quote = [] }
  }

  /** The first line of a block sets its start; every line extends its end. */
  const openIfNeeded = () => {
    if (!paragraph.length && !bullets.length && !todos.length && !dashes.length
      && !numbered.length && !quote.length && code === null) {
      blockStart = lineStart
    }
  }

  // Split on "\n" alone, not on every Unicode newline: the line LENGTHS are
  // what the ranges are built from, and a two-character separator counted as
  // one would put every range after it out by one.
  const allLines = markdown.split("\n")
  const lineLengths = allLines.map((line) => line.length + 1)

  /**
   * The middle of a run of blank lines, as a cell. The first line of the run
   * and the last one are the separators either side of it, so a run of one or
   * two leaves nothing behind.
   */
  const emitBlankRun = (upTo: number, from: number) => {
    const count = upTo - from
    if (count < 3) return
    // `emit` reads blockStart and blockEnd, so this cell has to put them
    // back: the line that ENDED the run has already moved blockEnd on to
    // itself, and a cell that kept the blank run's end left the next one
    // with a range of negative length.
    const openStart = blockStart
    const openEnd = blockEnd
    const start = blankRunFirst + lineLengths[from]!
    let to = start
    for (let index = from + 1; index < upTo - 1; index++) to += lineLengths[index]!
    blockStart = start
    blockEnd = Math.max(start, to - 1)
    emit({ kind: "blank", lines: count - 2 })
    blockStart = openStart
    blockEnd = openEnd
  }

  for (let lineIndex = 0; lineIndex < allLines.length; lineIndex++) {
    const rawLine = allLines[lineIndex]!
    const lineEnd = lineStart + rawLine.length
    // A blank line ends a block without being part of it, so only the lines
    // that go INTO a block move its end (a paragraph's range stops at its
    // last character, not at the newline after it).
    if (trimmed(rawLine).length > 0 || code !== null) blockEnd = lineEnd

    // A run of blank lines: the first ends the cell above it and the last
    // announces the one below; whatever is between them is a cell of empty
    // lines. Counted HERE, at the top, because every branch below continues.
    if (code === null) {
      if (trimmed(rawLine).length === 0) {
        if (blankRunStart === null) { blankRunStart = lineIndex; blankRunFirst = lineStart }
      } else if (blankRunStart !== null) {
        emitBlankRun(lineIndex, blankRunStart)
        blankRunStart = null
      }
    }

    if (code !== null) {
      if (trimmed(rawLine).startsWith("```")) {
        emit({ kind: "code", language: codeLanguage, body: code.join("\n") })
        code = null
        codeLanguage = null
      } else {
        code.push(rawLine)
      }
      lineStart += rawLine.length + 1
      continue
    }

    const line = trimmed(rawLine)

    if (line.startsWith("```")) {
      flush()
      blockStart = lineStart
      const lang = line.slice(3).trim()
      codeLanguage = lang.length ? lang : null
      code = []
      lineStart += rawLine.length + 1
      continue
    }
    if (line.length === 0) { flush(); lineStart += rawLine.length + 1; continue }
    if (isRule(line)) {
      flush(); blockStart = lineStart; emit({ kind: "rule" })
      lineStart += rawLine.length + 1; continue
    }
    const head = heading(line)
    if (head) {
      flush(); blockStart = lineStart
      emit({ kind: "heading", level: head.level, text: head.text })
      lineStart += rawLine.length + 1; continue
    }
    if (line.startsWith(">")) {
      if (paragraph.length || bullets.length || todos.length || dashes.length || numbered.length) flush()
      openIfNeeded()
      quote.push(line.slice(1).trim())
      lineStart += rawLine.length + 1; continue
    }
    // Before the plain bullet, because `- [ ] milk` starts with `- ` and
    // would otherwise be a bullet whose words are a box.
    const todo = todoItem(line)
    if (todo) {
      if (paragraph.length || bullets.length || dashes.length || numbered.length || quote.length) flush()
      openIfNeeded()
      todos.push(todo)
      lineStart += rawLine.length + 1; continue
    }
    const bullet = bulletItem(line)
    if (bullet !== null) {
      if (paragraph.length || todos.length || dashes.length || numbered.length || quote.length) flush()
      openIfNeeded()
      bullets.push(bullet)
      lineStart += rawLine.length + 1; continue
    }
    const dash = dashItem(line)
    if (dash !== null) {
      if (paragraph.length || bullets.length || todos.length || numbered.length || quote.length) flush()
      openIfNeeded()
      dashes.push(dash)
      lineStart += rawLine.length + 1; continue
    }
    const number = numberedItem(line)
    if (number !== null) {
      if (paragraph.length || bullets.length || todos.length || dashes.length || quote.length) flush()
      openIfNeeded()
      numbered.push(number)
      lineStart += rawLine.length + 1; continue
    }
    if (bullets.length || todos.length || dashes.length || numbered.length || quote.length) flush()
    openIfNeeded()
    // The first line keeps the spaces it was written with, so an indented
    // paragraph is drawn indented. Four spaces is NOT a code block here —
    // code is what is inside ```, ` or `` and nothing else.
    paragraph.push(paragraph.length === 0 ? leadingSpaces(rawLine) + line : line)
    lineStart += rawLine.length + 1
  }

  if (code !== null) {
    // An unclosed fence still renders as code — better than swallowing the
    // rest of the note.
    emit({ kind: "code", language: codeLanguage, body: code.join("\n") })
  }
  flush()
  if (blankRunStart !== null) emitBlankRun(allLines.length, blankRunStart)
  return out
}
