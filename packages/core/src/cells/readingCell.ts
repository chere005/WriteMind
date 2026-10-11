/**
 * THE WORDS OF ONE READING ARE ONE CELL (Sean, 2026-10-10: "Text brought in should be grouped together"). What the app's one
 * reader returns for a picture, the pen's handwriting, a box of the camera's page or the Wacom sheet is a list of LINES, and
 * the whole list goes into the note as a single cell: its lines together in one block, never a cell per line, and kept as
 * LINES (docs/PLAN-text-cells.md: a text cell shows every line break; a markdown cell runs its lines together on the rendered
 * page, which is what Sean ruled against on 2026-10-05).
 *
 * The note is its markdown, and a cell is the run of lines between blank lines, so the lines are put in as a TEXT CELL, as
 * typed (`escapePlain`): the words exactly as read, line for line, the escape rule's backslashes (hidden in a text cell)
 * keeping any line that starts `- `, `1. `, `# `, `> `, `---`, `|` or a fence from opening a block of its own, and keeping a
 * word the reader marked (`~~struck~~`, `**ringed**`, a `wl:` maths line) as the characters it is. Empty lines (and lines of
 * spaces) are dropped and a line with a line break of its own is taken apart, so no blank line is ever written into the words.
 *
 * Two readings keep the reader's own markdown, because nothing is run together in them: a reading of ONE line (a struck
 * word, a line of algebra typeset as maths), and a reading that is all ONE LIST (every line a task `- [ ] milk`, or every line
 * a bullet or a number): a single list cell, one line to an item. Port-first (the Mac has no reader of its own for this): the
 * rule is the app's, and `insertReading` is the one door.
 */

import { positioned } from "../markdown/parser"
import { escapePlain } from "../markdown/plainText"
import { insertBlock } from "./editing"

/** What a reading's lines come to as lines of one cell: each split at its own line breaks, trimmed, the empty ones gone. */
export function readingLines(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** How many cells the parser reads in `markdown` (the blank lines between them are not cells). */
const cellsIn = (markdown: string): number => positioned(markdown).filter((cell) => cell.block.kind !== "blank").length

/** Whether the parser reads `markdown` as one list (tasks, bullets, dashes or numbers) and nothing else. */
const oneList = (markdown: string): boolean => {
  const found = positioned(markdown).filter((cell) => cell.block.kind !== "blank")
  return found.length === 1 && ["todos", "bullets", "dashes", "numbered"].includes(found[0]!.block.kind)
}

/**
 * The source of the ONE cell a reading is: its lines (see `readingLines`) as a text cell as typed, or, for a reading of one
 * line or of one list, as the reader wrote them. Null when the reading holds no words at all (nothing to bring in).
 */
export function readingSource(lines: readonly string[]): string | null {
  const kept = readingLines(lines)
  if (kept.length === 0) return null
  const asRead = kept.join("\n")
  // (A line that opens a fence is never left to be code: an unclosed one would take the rest of the note into it.)
  const fenced = kept.some((line) => line.startsWith("```"))
  if (!fenced && cellsIn(asRead) === 1 && (kept.length === 1 || oneList(asRead))) return asRead
  return escapePlain(asRead)
}

/**
 * A reading put into the note as one new cell at `offset` (`insertBlock`'s rules: the blank lines it needs on both sides, and
 * never in the middle of the words). `caret` is where the cell starts, `end` where its words end, `lines` how many lines it
 * holds. Null when the reading holds no words.
 */
export function insertReading(markdown: string, offset: number, lines: readonly string[]):
{ markdown: string; caret: number; end: number; lines: number } | null {
  const words = readingSource(lines)
  if (words === null) return null
  const opened = insertBlock(markdown, offset)
  return {
    markdown: opened.markdown.slice(0, opened.caret) + words + opened.markdown.slice(opened.caret),
    caret: opened.caret, end: opened.caret + words.length, lines: readingLines(lines).length,
  }
}
