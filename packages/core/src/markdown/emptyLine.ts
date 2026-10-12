/**
 * AN EMPTY LINE THAT STAYS IN ITS CELL (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the current cell..";
 * "this should not be two separate cells"). Port-first: the Mac has no such line yet.
 *
 * A blank line ends a cell and separates it from the next (the parser's first rule), so a line a cell keeps EMPTY has to
 * have something written on it. It is `<br>`, alone on the line (after a list item's indentation or its marker, or a
 * quote's `> `), and WriteMind draws nothing for it on either page: the line is shown empty, the caret steps over the tag
 * whole, typing on the line turns it into a line of words and Backspace takes it away as it would an empty line.
 * Ctrl+Enter writes it (`cells/lineInCell.ts`).
 *
 * WHY `<br>` AND NOT A LONE BACKSLASH (CommonMark's own hard line break, the other candidate):
 * - It never comes from ordinary typing. In a TEXT cell a typed `<` that would make a tag is written escaped (`\<br>`,
 *   the escape rule in `plainText.ts`), whereas a lone backslash typed on a line of its own is written as itself (a
 *   backslash is escaped only before a character it would escape) — so notes written before this rule can already hold
 *   one, and it would have vanished from them. In a MARKDOWN cell, `<br>` alone on a line already means a line break.
 * - It degrades better. Another markdown reader takes it as the line break it is: inside a paragraph or a list item it
 *   breaks the line, and at the END of one it is nothing at all, where a trailing backslash is printed as a backslash.
 * - The note already holds HTML that WriteMind hides (Link Here's `<a id>` anchors in a text cell), and `<u>` and
 *   `<span>` are its own; one more tag is the same trade.
 *
 * THE SAME `<br>` STARTS A LINE AFRESH where a newline alone would not (`lineBreakSpan`; the review of agent/ctrlenter,
 * P1): in a markdown cell and a quote a single newline is a space when the cell is drawn, so a line Ctrl+Enter starts there
 * begins with the `<br>` and keeps it in front of the words typed on it. In a text cell and a list item every line is a line
 * already, and the `<br>` is only ever an empty line's.
 *
 * `<br/>`, `<br />` and any case are read as the same line (a note written elsewhere); `<br>` is what is written.
 */

import type { Block } from "./parser"

/** What an empty line a cell keeps holds. */
export const EMPTY_LINE = "<br>"

/**
 * A line's head, what a `<br>` that starts the line stands after: its indentation, and a list item's marker and box (`- `,
 * `12. `, `- [x] `) or a quote's `>` and the space after it.
 */
const BREAK_HEAD = /^[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,4}[.)])[ \t]+(?:\[[ xX]\](?:[ \t]+|$))?)?/
/** A list item's head — its indentation, its marker and its box — or a line's indentation alone. */
const ITEM_HEAD = /^[ \t]*(?:(?:[-*+]|\d{1,4}[.)])[ \t]+(?:\[[ xX]\](?:[ \t]+|$))?)?/
const BR_AT = /^<br\s*\/?>/i

/**
 * A line's head: its indentation, and a list item's marker and box (`- `, `12. `, `- [x] `) — what a line under it stands
 * under to carry its item on, and what stands before an empty line an item keeps.
 */
export const lineHead = (line: string): string => ITEM_HEAD.exec(line)![0]

/**
 * A LINE THAT STARTS AFRESH (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the current cell.."; the
 * reviewer's P1 on agent/ctrlenter): where the `<br>` at the head of `line` stands — after the line's head (indentation, a
 * list item's marker and box, a quote's `>`) — as [from, to) offsets, whatever follows it. Null when the line does not
 * start with one.
 *
 * In a MARKDOWN cell and a QUOTE a single newline is a space (CommonMark's soft break: `a\nb` reads "a b"), so a line
 * Ctrl+Enter starts there has to say that it starts afresh, or the line the key made is gone the moment the cell is
 * drawn. It does it with the same `<br>` an empty line holds, at its head: `first\n<br>second` is two lines, "first" and
 * "second" (another markdown reader draws exactly that: the tag is a line break, the newline before it a space at the end
 * of a line); `<br>` with nothing after it is the empty line (`emptyLineSpan`). Typing on an empty line there keeps the
 * `<br>` in front of the words, which is what keeps them on their own line. In a TEXT cell and a LIST ITEM every newline
 * already breaks the line, so there the `<br>` is only the empty line's, and goes when words are typed on it.
 */
export function lineBreakSpan(line: string): [number, number] | null {
  // (A cheap first look: this is asked of lines as they are drawn.)
  if (!line.includes("<")) return null
  const head = BREAK_HEAD.exec(line)![0].length
  const br = BR_AT.exec(line.slice(head))
  return br ? [head, head + br[0].length] : null
}

/**
 * Where the `<br>` of an empty line a cell keeps stands in `line`, as [from, to) offsets: after the line's head
 * (`lineBreakSpan`) with nothing after it but spaces. Null for any other line.
 */
export function emptyLineSpan(line: string): [number, number] | null {
  const span = lineBreakSpan(line)
  return span && line.slice(span[1]).trim().length === 0 ? span : null
}

/** Whether `line` is an empty line a cell keeps (`emptyLineSpan`). */
export const isEmptyLine = (line: string): boolean => emptyLineSpan(line) !== null

/**
 * A cell's words with each `<br>` at a line's head read as what it is — an empty line, or a line that starts afresh — the
 * tag gone and the line's head kept.
 */
export function emptyLinesRead(text: string): string {
  if (!text.includes("<")) return text
  return text.split("\n").map((line) => {
    const span = lineBreakSpan(line)
    return span ? line.slice(0, span[0]) + line.slice(span[1]) : line
  }).join("\n")
}

/**
 * Lines as a markdown reader joins them — one line of words for each run of lines, joined with a space (a single line
 * break inside a paragraph or a quote is a space) — except that an empty line (an empty line a cell keeps, or `""`: a
 * quote's own empty line) is an empty line, so the line before it ends and the one after it starts afresh; and a line
 * that starts with `<br>` (`lineBreakSpan`, what Ctrl+Enter writes there) starts afresh: the line before it ends.
 */
export function joinedLines(lines: readonly string[]): string {
  if (!lines.some((line) => line === "" || line.includes("<"))) return lines.join(" ")
  const out: string[] = []
  let words: string | null = null
  for (const line of lines) {
    const span = line === "" ? null : lineBreakSpan(line)
    const rest = span ? line.slice(span[1]) : line
    if (rest.trim().length === 0) {
      if (words !== null) out.push(words)
      words = null
      out.push("")
    } else if (span) {
      if (words !== null) out.push(words)
      words = line.slice(0, span[0]) + rest
    } else words = words === null ? line : words + " " + line
  }
  if (words !== null) out.push(words)
  return out.join("\n")
}

/**
 * The cells whose lines a single newline JOINS (a markdown cell, a quote: CommonMark's soft break), so that a line Ctrl+Enter
 * starts in them keeps its `<br>` in front of its words (`lineBreakSpan`). A text cell's and a list item's lines are lines
 * already: there the `<br>` is only an empty line's.
 */
export const joinsLines = (block: Block): boolean =>
  (block.kind === "paragraph" && block.markdown === true) || block.kind === "quote"
