/**
 * Pure text transforms behind the toolbar buttons and the editor's Tab /
 * Shift-Tab / Backspace keys.
 *
 * Ported from `WriteMind/Editor/MarkdownFormatting.swift`. Every one of them
 * returns an `Edit` rather than touching a document, so the editor applies it
 * in a way its own undo can see — and so the rule can be tested without an
 * editor at all, which is what made the port possible.
 */

import {
  clamped, edit, end, lineRange, range, replacing, substring,
  type Edit, type Range,
} from "../text/range"
import { linesOf, numberedItem, positioned, todoItem, type LineSource, type PositionedBlock } from "./parser"
import { lineBreakSpan } from "./emptyLine"
import { cellSpacing } from "../cells/apart"
import { keepingHalves } from "../cells/textCells"

export const BOLD = "**"
export const ITALIC = "_"
export const UNDERLINE_OPEN = "<u>"
export const UNDERLINE_CLOSE = "</u>"
/** GFM strikethrough. */
export const STRIKE = "~~"
export const BULLET = "- "
export const QUOTE = "> "
/** One step of indentation, and the width a tab is shown at: four spaces. */
export const INDENT_UNIT = "    "
export const TAB_WIDTH = 4

/** NSString.lineRange(for:) over a whole range, not just a location. */
export function lineRangeCovering(text: string, r: Range): Range {
  const first = lineRange(text, r.location)
  if (r.length === 0) return first
  const last = lineRange(text, Math.max(r.location, end(r) - 1))
  return range(first.location, end(last) - first.location)
}

const leadingWhitespace = (line: string): string => /^[ \t]*/.exec(line)![0]
const dropIndent = (line: string): string => line.slice(leadingWhitespace(line).length)
const blank = (line: string): boolean => line.trim().length === 0

/**
 * The heading ladder, in Sean's words: level 0 is body text; level 6 is the
 * author subheader, which the rendered page draws italic and slightly bigger
 * than body rather than as a sixth-rank heading.
 */
export type Heading = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** The ladder as the menu shows it and as ⌘1–⌘7 run. */
export const HEADING_LADDER: Heading[] = [1, 2, 6, 3, 4, 5, 0]

export function headingName(level: Heading): string {
  return ["Text", "Title", "Chapter", "Section", "Subsection", "Subsubsection", "Author"][level]!
}

/** What the line is written as — `#` per level, and nothing for body. */
export function headingMarker(level: Heading): string {
  return level === 0 ? "" : "#".repeat(level) + " "
}

/** The digit after ⌘ that sets this level. */
export function headingKey(level: Heading): string {
  const index = HEADING_LADDER.indexOf(level)
  return String((index < 0 ? 6 : index) + 1)
}

/**
 * The level a line is written at — body when it opens with no hashes, with
 * more than six, or with hashes that are not followed by a space.
 */
export function headingLevel(line: string): Heading {
  const rest = dropIndent(line)
  let hashes = 0
  while (hashes < rest.length && rest[hashes] === "#") hashes++
  if (hashes < 1 || hashes > 6) return 0
  const after = rest.slice(hashes)
  if (after.length > 0 && !after.startsWith(" ")) return 0
  return hashes as Heading
}

function stripHeading(rest: string): string {
  let hashes = 0
  while (hashes < rest.length && rest[hashes] === "#") hashes++
  if (hashes < 1 || hashes > 6) return rest
  let body = rest.slice(hashes)
  if (body.length > 0 && !body.startsWith(" ")) return rest
  while (body.startsWith(" ")) body = body.slice(1)
  return body
}

/**
 * What a list is marked with: `- ` shows as a round bullet, `* ` as a dash, a
 * numbered list counts from 1, and `todo` is GFM's task list. All four are
 * ordinary markdown to anything else that opens the note.
 */
export type ListStyle = "dots" | "dashes" | "numbered" | "todo"
export const LIST_STYLES: ListStyle[] = ["dots", "dashes", "numbered", "todo"]

export function listTitle(style: ListStyle): string {
  return { dots: "Dots", dashes: "Dashes", numbered: "Numbered", todo: "To-do" }[style]
}

/** The marker for the `index`th item (from 1). */
export function listMarker(style: ListStyle, index: number): string {
  switch (style) {
    case "dots": return "- "
    case "dashes": return "* "
    case "numbered": return `${index}. `
    // Unticked: a new item is something still to do.
    case "todo": return "- [ ] "
  }
}

/** Whether `rest` (a line past its indentation) carries this marker. */
export function listMatches(style: ListStyle, rest: string): boolean {
  switch (style) {
    // A task is NOT a dots list that happens to start with a dash: asking
    // dots of a task list read it as already styled and took the markers
    // off instead of swapping them, so "- [x] milk" became "milk".
    case "dots": return (rest.startsWith("- ") || rest.startsWith("+ ")) && todoItem(rest) === null
    case "dashes": return rest.startsWith("* ") && todoItem(rest) === null
    case "numbered": return numberedItem(rest) !== null
    case "todo": return todoItem(rest) !== null
  }
}

/** `rest` without whichever list marker heads it. */
export function stripListMarker(rest: string): string {
  // The box first: a to-do is `- ` and then `[ ] `, and taking only the
  // dash would leave the box standing in the words.
  const task = todoItem(rest)
  if (task) return task.text
  for (const marker of ["- ", "* ", "+ "]) if (rest.startsWith(marker)) return rest.slice(2)
  const number = numberedItem(rest)
  if (number !== null) return number
  return rest
}

export function isBulleted(line: string): boolean {
  const rest = dropIndent(line)
  return rest.startsWith("- ") || rest.startsWith("* ") || rest.startsWith("+ ")
}

export function isQuoted(line: string): boolean {
  return dropIndent(line).startsWith(">")
}

/**
 * The whitespace, quote markers and list marker a line opens with — what Tab
 * and Backspace treat as structure rather than text.
 */
export function prefixLength(line: string): number {
  let rest = line
  let length = 0
  const indent = leadingWhitespace(rest)
  length += indent.length
  rest = rest.slice(indent.length)
  while (rest.startsWith(">")) {
    rest = rest.slice(1)
    length += 1
    if (rest.startsWith(" ")) { rest = rest.slice(1); length += 1 }
    const more = leadingWhitespace(rest)
    rest = rest.slice(more.length)
    length += more.length
  }
  if (isBulleted(rest)) length += 2
  return length
}

/**
 * Rewrite every line the selection touches. A selection keeps the whole block
 * selected; a caret moves by however much its own line shifted.
 */
function rewriteLines(text: string, selection: Range, transform: (line: string) => string, cover?: Range): Edit {
  const where = clamped(selection, text.length)
  // (`cover`: the lines to rewrite when they are more than the selection's — a list item's next lines, `toggleList`.)
  let block = lineRangeCovering(text, cover ? clamped(cover, text.length) : where)
  let body = substring(text, block)
  let trailingNewline = ""
  if (body.endsWith("\n")) {
    trailingNewline = "\n"
    body = body.slice(0, -1)
    block = range(block.location, block.length - 1)
  }

  const lines = body.split("\n")
  let caretDelta = 0
  let offset = 0
  const rewritten: string[] = []
  for (const line of lines) {
    const caretOnThisLine = where.length === 0
      && where.location - block.location >= offset
      && where.location - block.location <= offset + line.length
    const before = where.length === 0 && where.location - block.location > offset + line.length
    const next = transform(line)
    // (The lines above the caret's, rewritten too when `cover` reached above it, move it by what they gained.)
    if (caretOnThisLine || before) caretDelta += next.length - line.length
    rewritten.push(next)
    offset += line.length + 1
  }

  const replacement = rewritten.join("\n") + trailingNewline
  const newSelection = where.length === 0
    ? range(Math.max(block.location, where.location + caretDelta), 0)
    : range(block.location, replacement.length - trailingNewline.length)
  return edit(range(block.location, block.length + trailingNewline.length), replacement, newSelection)
}

/**
 * Wrap the selection in `open`…`close`, or strip them if already there —
 * whether the markers sit inside the selection or just outside it.
 */
export function toggleWrap(text: string, selection: Range, open: string, close = open): Edit {
  const where = clamped(selection, text.length)
  const selected = substring(text, where)

  // "**word**" selected → "word"
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    const inner = selected.slice(open.length, selected.length - close.length)
    return edit(where, inner, range(where.location, inner.length))
  }

  // **|word|** selected → "word"
  const before = range(where.location - open.length, open.length)
  const after = range(end(where), close.length)
  if (before.location >= 0 && end(after) <= text.length
    && substring(text, before) === open && substring(text, after) === close) {
    const whole = range(before.location, open.length + where.length + close.length)
    return edit(whole, selected, range(before.location, where.length))
  }

  // Anything else is wrapped; an empty selection leaves the caret between
  // the markers.
  return edit(where, open + selected + close, range(where.location + open.length, where.length))
}

/**
 * Make every line the selection touches that heading level. Applying the
 * level a line already has takes it back to body text, so the toolbar entry
 * toggles.
 *
 * `evenIfEmpty` is for a cell that has only just been opened: a blank line
 * normally keeps its shape, but the cell a seam opens IS blank and the kind
 * the + chose for it still has to be written somewhere.
 */
export function setHeading(text: string, selection: Range, level: Heading, evenIfEmpty = false): Edit {
  const block = lineRangeCovering(text, clamped(selection, text.length))
  const first = substring(text, block).split("\n")[0] ?? ""
  const target: Heading = headingLevel(first) === level && level !== 0 ? 0 : level

  return rewriteLines(text, selection, (line) => {
    if (blank(line)) return evenIfEmpty ? line + headingMarker(target) : line
    const indent = leadingWhitespace(line)
    return indent + headingMarker(target) + stripHeading(line.slice(indent.length))
  })
}

function toggleLinePrefix(text: string, selection: Range, prefix: string,
  isPrefixed: (line: string) => boolean, strip: (rest: string) => string): Edit {
  let block = lineRangeCovering(text, clamped(selection, text.length))
  let body = substring(text, block)
  if (body.endsWith("\n")) { body = body.slice(0, -1); block = range(block.location, block.length - 1) }

  const nonEmpty = body.split("\n").filter((line) => !blank(line))
  const allPrefixed = nonEmpty.length > 0 && nonEmpty.every(isPrefixed)

  return rewriteLines(text, selection, (line) => {
    const indent = leadingWhitespace(line)
    const rest = line.slice(indent.length)
    if (allPrefixed) {
      if (!isPrefixed(line)) return line
      return indent + strip(rest)
    }
    // An empty line in the middle of a block keeps its shape.
    if (rest.length === 0 && nonEmpty.length > 0) return line
    if (isPrefixed(line)) return line
    return indent + prefix + rest
  })
}

const stripBullet = (rest: string): string => rest.slice(2)

function stripQuote(rest: string): string {
  if (!rest.startsWith(">")) return rest
  let out = rest.slice(1)
  if (out.startsWith(" ")) out = out.slice(1)
  return out
}

/** Add `- ` to every line the selection touches, or remove it when they all have one. */
export function toggleBullets(text: string, selection: Range): Edit {
  return toggleLinePrefix(text, selection, BULLET, isBulleted, stripBullet)
}

/** The same, for `> `. */
export function toggleQuote(text: string, selection: Range): Edit {
  return toggleLinePrefix(text, selection, QUOTE, isQuoted, stripQuote)
}

/**
 * Make every line the selection touches an item in `style`, whatever list it
 * was in before; when they all already are, take the markers away — so the
 * button toggles, like the others.
 *
 * A LIST ITEM'S NEXT LINES (Ctrl+Enter writes them, Sean 2026-10-11: "ctrl + enter adds a newline without leaving the
 * current cell.."; the review of agent/ctrlenter, P2) are not items: they stay under their item's words, re-indented under
 * its new marker (a `1. ` is wider than a `- `), and with the markers taken away they are the paragraph's next lines. The
 * lines rewritten are whole items: an item's next lines go with it, and a selection that starts on one starts at its item.
 */
export function toggleList(text: string, selection: Range, style: ListStyle): Edit {
  const where = clamped(selection, text.length)
  const items = wholeItems(text, where)
  let block = lineRangeCovering(text, items ?? where)
  let body = substring(text, block)
  if (body.endsWith("\n")) { body = body.slice(0, -1); block = range(block.location, block.length - 1) }
  const lines = body.split("\n")
  const carried = items ? nextLinesOfItems(text, block, lines) : lines.map(() => false)
  const nonEmpty = lines.filter((line, i) => !blank(line) && !carried[i])
  const allStyled = nonEmpty.length > 0 && nonEmpty.every((line) => listMatches(style, dropIndent(line)))

  let number = 0
  let index = -1
  // Where an item's next lines stand: under its words, as its marker is now.
  let under = ""
  return rewriteLines(text, where, (line) => {
    index += 1
    const indent = leadingWhitespace(line)
    const rest = line.slice(indent.length)
    if (carried[index]) return under + rest
    if (allStyled) { under = indent; return indent + stripListMarker(rest) }
    if (rest.length === 0 && nonEmpty.length > 0) return line
    number += 1
    const marker = listMarker(style, number)
    under = indent + " ".repeat(marker.length)
    return indent + marker + withoutLineBreak(stripListMarker(rest))
  }, items ?? undefined)
}

/**
 * Words with the `<br>` a markdown cell's or a quote's line starts afresh with (Ctrl+Enter) taken off: an item is a line of
 * its own already. An empty line's `<br>` stays (`- <br>`: an item with nothing on its line).
 */
function withoutLineBreak(words: string): string {
  const span = lineBreakSpan(words)
  return span && span[0] === 0 && words.slice(span[1]).trim().length > 0 ? words.slice(span[1]) : words
}

/** A line that is a list item of its own: a marker and a space (or nothing) after it. */
const ITEM_LINE = /^[ \t]*(?:[-*+]|\d{1,4}[.)])(?:[ \t]|$)/

/** Whether line `number` of `doc` is a list item's next line (no marker of its own, in a list cell: the parser's reading). */
function isNextLine(cells: readonly PositionedBlock[], doc: LineSource, number: number): boolean {
  const line = doc.line(number)
  if (blank(line.text) || ITEM_LINE.test(line.text)) return false
  const cell = cells.find((one) => line.from >= one.range.location && line.from <= end(one.range))
  return cell !== undefined && LIST_KINDS.has(cell.block.kind)
}
const LIST_KINDS = new Set(["bullets", "dashes", "numbered", "todos", "mixed"])

/**
 * The lines from the item `where` starts in to the last next line of the item it ends in — or null when there is no
 * item's next line about (the note as it always was, read without the parser).
 */
function wholeItems(text: string, where: Range): Range | null {
  const stop = end(where)
  // (A cheap first look: no line of the note is indented or holds a `<br>`.)
  if (!/\n[ \t]|<br/i.test(text)) return null
  const cells = positioned(text)
  const doc = linesOf(text)
  let first = doc.lineAt(where.location).number
  let last = doc.lineAt(Math.max(where.location, stop - (where.length > 0 && text[stop - 1] === "\n" ? 1 : 0))).number
  const touches = (n: number) => isNextLine(cells, doc, n)
  let any = false
  for (let n = first; n <= last; n++) if (touches(n)) { any = true; break }
  while (first > 1 && touches(first)) { first--; any = true }
  while (last < doc.lines && touches(last + 1)) { last++; any = true }
  if (!any) return null
  return range(doc.line(first).from, doc.line(last).to - doc.line(first).from)
}

/** Which of `lines` (the lines of `block`, in order) are a list item's next lines. */
function nextLinesOfItems(text: string, block: Range, lines: readonly string[]): boolean[] {
  const cells = positioned(text)
  const doc = linesOf(text)
  const first = doc.lineAt(block.location).number
  return lines.map((_line, i) => isNextLine(cells, doc, first + i))
}

/**
 * The `index`th task line inside `block` ticked, or unticked if it already
 * was. Nil when that line is not a task after all — the note may have been
 * edited since the box was drawn.
 *
 * Only the box is rewritten: the words, the indentation and whichever of `-`,
 * `*` and `+` the line was written with are left exactly as they are, because
 * this is a tick and not a reformat.
 */
export function toggleTodo(text: string, block: Range, index: number): Edit | null {
  if (block.location < 0 || end(block) > text.length) return null
  let line = block.location
  let seen = 0
  while (line < end(block)) {
    const r = lineRange(text, line)
    const body = substring(text, r)
    const bare = body.endsWith("\n") ? body.slice(0, -1) : body
    const indent = leadingWhitespace(bare)
    if (todoItem(bare.slice(indent.length)) !== null) {
      if (seen === index) {
        // The box is the character after "- [", whatever the marker and
        // the indentation were.
        const box = r.location + indent.length + 3
        if (box >= text.length) return null
        const now = text.slice(box, box + 1)
        const next = now.toLowerCase() === "x" ? " " : "x"
        return edit(range(box, 1), next, range(box + 1, 0))
      }
      seen += 1
    }
    if (r.length === 0) break
    line = end(r)
  }
  return null
}

/**
 * A fenced code block round the selection, on lines of its own — or an empty
 * one to type into, with the caret inside it.
 */
export function codeBlock(text: string, selection: Range, language = ""): Edit {
  const where = clamped(selection, text.length)
  const before = where.location > 0 ? text.slice(0, where.location) : ""
  const after = text.slice(end(where))
  // A CELL OF ITS OWN (Sean, 2026-10-05): a blank line above the fences and one below them, counting the ones there
  // already — a block written straight under a line of words, or over one, was glued to it.
  const { lead, trail: tail } = cellSpacing(before, after)
  const inner = substring(text, where)
  // An empty block keeps an empty line between its fences: the caret goes
  // on THAT line. With the caret on the closing fence's line instead,
  // typing produced "FSADF```" — a block that never closed.
  const body = inner.length === 0 ? "\n" : (inner.endsWith("\n") ? inner : inner + "\n")
  const replacement = lead + "```" + language + "\n" + body + "```" + tail
  const caret = inner.length === 0
    ? where.location + lead.length + 3 + language.length + 1
    : where.location + replacement.length - tail.length
  // (Round some of a paragraph's words it splits the paragraph: each half stays the kind it was.)
  return keepingHalves(text, edit(where, replacement, range(caret, 0)))
}

/**
 * A fenced block taken apart, so the rendered page can let the CODE be typed
 * while the fences stay where they are. Nil when this is not a fenced block.
 */
export function fenced(source: string): { open: string; body: string; close: string } | null {
  const lines = source.split("\n")
  if (lines.length === 0 || !lines[0]!.trim().startsWith("```")) return null
  const open = lines.shift()!
  let close = ""
  if (lines.length > 0 && lines[lines.length - 1]!.trim() === "```") close = lines.pop()!
  return { open, body: lines.join("\n"), close }
}

/** And put back together again. */
export function refenced(open: string, body: string, close: string): string {
  let out = open + "\n" + body
  if (close.length > 0) out += "\n" + close
  return out
}

/** The language a fence names, for colouring what is typed into it. */
export function fenceLanguage(open: string): string {
  return open.trim().slice(3).trim()
}

/** A plain paragraph line — the only kind that moves with its neighbours. */
function groupsWithNeighbours(text: string, r: Range): boolean {
  let line = substring(text, r)
  if (line.endsWith("\n")) line = line.slice(0, -1)
  if (blank(line)) return false
  if (isBulleted(line) || isQuoted(line)) return false
  if (headingLevel(line) !== 0) return false
  if (numberedItem(line.trim()) !== null) return false
  if (line.trim().startsWith("```")) return false
  return true
}

/**
 * Indenting with a caret moves the WHOLE BLOCK it sits in, not just the line
 * under the cursor — a paragraph typed across several lines is one piece of
 * text and moves as one.
 *
 * A list item, a quote line and a heading each stand alone: Tab on the second
 * bullet of a list has to nest THAT bullet, not the list. A real selection is
 * always taken as given.
 */
export function blockOrSelection(text: string, selection: Range): Range {
  if (selection.length !== 0) return selection
  const caret = clamped(selection, text.length)
  const line = lineRangeCovering(text, caret)
  if (!groupsWithNeighbours(text, line)) return caret

  let start = line.location
  while (start > 0) {
    const previous = lineRange(text, start - 1)
    if (!groupsWithNeighbours(text, previous)) break
    start = previous.location
  }
  let stop = end(line)
  while (stop < text.length) {
    const next = lineRange(text, stop)
    if (!groupsWithNeighbours(text, next)) break
    stop = end(next)
  }
  // The whole span of lines. rewriteLines takes its own line range from
  // this and strips one trailing newline, so shortening it here dropped the
  // last line of every paragraph that ended the document.
  return range(start, Math.max(0, stop - start))
}

/** One level in: a quoted line gains another `> `, anything else gains two spaces. */
export function indent(text: string, selection: Range): Edit {
  return rewriteLines(text, blockOrSelection(text, selection), (line) => {
    if (blank(line)) return line
    const lead = leadingWhitespace(line)
    const rest = line.slice(lead.length)
    return rest.startsWith(">") ? lead + QUOTE + rest : INDENT_UNIT + line
  })
}

/**
 * One level out: a step of indentation if there is one, otherwise one `> `
 * marker — so Shift-Tab on a top-level quote unquotes the line.
 */
export function outdent(text: string, selection: Range): Edit {
  return rewriteLines(text, blockOrSelection(text, selection), (line) => {
    const lead = leadingWhitespace(line)
    if (lead.startsWith(INDENT_UNIT)) return line.slice(INDENT_UNIT.length)
    if (lead.startsWith("\t")) return line.slice(1)
    const rest = line.slice(lead.length)
    if (!rest.startsWith(">")) return line
    return lead + stripQuote(rest)
  })
}

/**
 * Backspace inside a line's prefix takes a level off instead of deleting a
 * character; anywhere else it is an ordinary backspace, and this is null.
 */
export function outdentForBackspace(text: string, selection: Range): Edit | null {
  if (selection.length !== 0) return null
  const where = clamped(selection, text.length)
  const line = lineRangeCovering(text, where)
  const column = where.location - line.location
  if (column <= 0) return null // at column 0, join with the line above
  const body = substring(text, line)
  const prefix = prefixLength(body)
  if (column > prefix || prefix === 0) return null
  const change = outdent(text, where)
  return change.replacement === body ? null : change
}

/** An edit applied, for callers with no document of their own. */
export function apply(text: string, change: Edit): string {
  return replacing(text, change.range, change.replacement)
}
