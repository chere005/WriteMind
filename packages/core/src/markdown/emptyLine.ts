/**
 * AN EMPTY LINE THAT STAYS IN ITS CELL (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the current cell..";
 * "this should not be two separate cells"). Port-first: the Mac has no such line yet.
 *
 * A blank line ends a cell and separates it from the next (the parser's first rule), so a line a cell keeps EMPTY has to
 * have something written on it. It is `<br>`, alone on the line (after a list item's indentation or its marker), and
 * WriteMind draws nothing for it on either page: the line is shown empty, the caret steps over the tag whole, typing on
 * the line turns it into a line of words and Backspace takes it away as it would an empty line. Ctrl+Enter writes it
 * (`cells/lineInCell.ts`).
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
 * `<br/>`, `<br />` and any case are read as the same line (a note written elsewhere); `<br>` is what is written.
 */

/** What an empty line a cell keeps holds. */
export const EMPTY_LINE = "<br>"

const BR = /^<br\s*\/?>$/i
/** A list item's head — its indentation, its marker and its box — or a line's indentation alone. */
const ITEM_HEAD = /^[ \t]*(?:(?:[-*+]|\d{1,4}[.)])[ \t]+(?:\[[ xX]\](?:[ \t]+|$))?)?/

/**
 * A line's head: its indentation, and a list item's marker and box (`- `, `12. `, `- [x] `) — what a line under it stands
 * under to carry its item on, and what stands before an empty line an item keeps.
 */
export const lineHead = (line: string): string => ITEM_HEAD.exec(line)![0]

/**
 * Where the `<br>` of an empty line a cell keeps stands in `line`, as [from, to) offsets: after the line's indentation
 * (and a list item's marker and box) with nothing after it but spaces. Null for any other line.
 */
export function emptyLineSpan(line: string): [number, number] | null {
  // (A cheap first look: this is asked of lines as they are drawn.)
  if (!line.includes("<")) return null
  const head = ITEM_HEAD.exec(line)![0].length
  const rest = line.slice(head).trimEnd()
  return BR.test(rest) ? [head, head + rest.length] : null
}

/** Whether `line` is an empty line a cell keeps (`emptyLineSpan`). */
export const isEmptyLine = (line: string): boolean => emptyLineSpan(line) !== null

/** A cell's words with each empty line it keeps read as the empty line it is (its `<br>` gone, its head kept). */
export function emptyLinesRead(text: string): string {
  if (!text.includes("<")) return text
  return text.split("\n").map((line) => {
    const span = emptyLineSpan(line)
    return span ? line.slice(0, span[0]) + line.slice(span[1]) : line
  }).join("\n")
}

/**
 * Lines as a markdown reader joins them — one line of words for each run of lines, joined with a space (a single line
 * break inside a paragraph, a list item or a quote is a space) — except that an empty line (an empty line a cell keeps,
 * or `""`: a quote's own empty line) is an empty line, so the line before it ends and the one after it starts afresh.
 */
export function joinedLines(lines: readonly string[]): string {
  if (!lines.some((line) => line === "" || isEmptyLine(line))) return lines.join(" ")
  const out: string[] = []
  let words: string | null = null
  for (const line of lines) {
    if (line === "" || isEmptyLine(line)) {
      if (words !== null) out.push(words)
      words = null
      out.push("")
    } else words = words === null ? line : words + " " + line
  }
  if (words !== null) out.push(words)
  return out.join("\n")
}
