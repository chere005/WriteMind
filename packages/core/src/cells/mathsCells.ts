/**
 * THE MATHS CELL (Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell type.. that
 * should be ctrl + 9"). It is the display maths block WriteMind already had — a ```wl fence of Wolfram Language,
 * typeset whenever the caret is not in it — made a cell kind of its own, on its own number key, beside Code Block.
 * Port-only (the Mac's ⌘9 is its evaluation cell; docs/PARITY.md).
 *
 * - Ctrl+9 on an empty line, in an empty cell, or at a bar: an empty maths cell there, a cell of its own, the caret
 *   inside it (`opening` writes it at a bar; `mathsCellEdit` everywhere else).
 * - Ctrl+9 in a TEXT or MARKDOWN cell with words: that cell becomes a maths cell whose source is its words — a text
 *   cell's escapes' backslashes come out, because maths source is raw — and round a selection the selected words are
 *   wrapped instead, as Ctrl+8 wraps them in a code block. A line that would read as a fence (```) keeps a backslash
 *   (it would close the maths cell early); words holding a Link Here anchor are left as they are and a new maths cell
 *   goes after their cell (an anchor in maths source would be lost, and links from other notes with it).
 * - Ctrl+9 in a code block: its fence becomes ```wl, the code kept. In an evaluation cell (or its answer): a new empty
 *   maths cell after the pair — the runnable cell is not turned into maths (`mathsCellPlan`, "after").
 * - Ctrl+9 in a maths cell: nothing.
 * - Ctrl+7 on a maths cell (`mathsAsText`): a text cell of its source, by the escape rule (a text cell never typesets).
 * - Ctrl+8 on a maths cell (`mathsAsCode`): a Wolfram Language code block of the same source (```wolfram: `wl` IS the
 *   maths fence, so a ```wl code block would still be the maths cell).
 */

import { clamped, edit, end, lineRange, range, substring, type Edit, type Range } from "../text/range"
import { positioned, type Block, type PositionedBlock } from "../markdown/parser"
import { codeBlock } from "../markdown/formatting"
import { fenceOf } from "../markdown/code"
import { anchorSpans, escapePlain, plainLine, wholeChange } from "../markdown/plainText"
import { isMathFence, MATH_FENCE } from "../math/typesetter"
import { isEvaluation } from "../eval/evaluator"
import { isOut } from "../eval/output"
import { outAfter, seamAfter } from "../eval/cells"
import { isMarkdownCell, isTextCell, markerLength } from "./textCells"

/** A ```wl fence: the maths cell. */
export const isMathsCell = (block: Block | null | undefined): boolean =>
  block?.kind === "code" && isMathFence(block.language)

/** The opening fence line of a maths cell (with its newline). */
const OPEN = "```" + MATH_FENCE + "\n"

/** The fence a maths cell becomes under Ctrl+8: Wolfram Language CODE, coloured, never typeset. */
export const MATHS_AS_CODE_FENCE = fenceOf("wolfram")

/** The cell a caret (or the start of a selection) is in, its two ends included; blank runs are no cell. */
function cellAt(cells: readonly PositionedBlock[], at: number): PositionedBlock | null {
  return cells.find((cell) => cell.block.kind !== "blank" && cell.range.location <= at && at <= end(cell.range)) ?? null
}

/** A selection that stays inside one cell (a caret included). */
const within = (cell: PositionedBlock, where: Range): boolean =>
  where.location >= cell.range.location && end(where) <= end(cell.range)

/** The opening fence line of the fenced cell starting at `cell` rewritten to "```<tag>", its indentation kept. */
function refence(markdown: string, cell: Range, tag: string, caret: number): Edit | null {
  const open = lineRange(markdown, cell.location)
  const line = substring(markdown, open).replace(/[\r\n]+$/, "")
  if (!line.trimStart().startsWith("```")) return null
  const indent = /^\s*/.exec(line)![0]
  const replacement = indent + "```" + tag
  if (replacement === line) return null
  const lineEnd = open.location + line.length
  const delta = replacement.length - line.length
  // The caret keeps its character: after the fence line it moves with the text; on the fence line it ends that line.
  const at = caret > lineEnd ? caret + delta : caret >= open.location ? open.location + replacement.length : caret
  return edit(range(open.location, line.length), replacement, range(at, 0))
}

/**
 * A line inside a maths fence that would read as a fence (```…, indented or not) keeps a backslash before its first
 * backtick: written bare it would close the maths cell early, and the real closing fence would open one that runs over
 * the rest of the note (a text cell holds such a line escaped; that escape is what keeps it words).
 */
function fenceSafe(line: string): string {
  const lead = /^\s*/.exec(line)![0]
  return line.startsWith("```", lead.length) ? lead + "\\" + line.slice(lead.length) : line
}

/** A text cell's line as maths source: its escapes' backslashes out (maths source is raw), a fence line kept safe. */
const mathsLine = (line: string): string => fenceSafe(plainLine(line))

/**
 * Words holding a Link Here anchor (`<a id>`, `<mark id>`): links from other notes land on it, and as maths source it
 * would be lost (or typeset), so Ctrl+9 leaves such words as they are and opens a new maths cell after their cell.
 */
const holdsAnchor = (text: string): boolean => text.split("\n").some((line) => anchorSpans(line).length > 0)

/** A whole cell's words as maths source, and where the caret (an offset into the cell) goes in that source. */
function sourceOf(markdown: string, cell: PositionedBlock, caretInCell: number): { source: string; caret: number } {
  const text = substring(markdown, cell.range)
  if (isTextCell(cell.block)) {
    // The words as they are SEEN: the escapes' backslashes out (a cell with Link Here's anchors never comes here).
    const source = text.split("\n").map(mathsLine).join("\n")
    const before = text.slice(0, Math.max(0, caretInCell)).split("\n").map(mathsLine).join("\n")
    return { source, caret: Math.min(before.length, source.length) }
  }
  // A markdown cell: its markdown as written, the marker line left out (maths source is raw: `x*y*z` keeps its stars).
  const head = markerLength(cell.block)
  const source = text.slice(Math.min(head, text.length)).split("\n").map(fenceSafe).join("\n")
  return { source, caret: Math.min(Math.max(0, caretInCell - head), source.length) }
}

/**
 * Ctrl+9 round a SELECTION that is not a whole cell of its own kind: the selected markdown wrapped in a maths fence
 * exactly as Ctrl+8 wraps it in a code block (`codeBlock`: on lines of its own, a cell of its own, a paragraph it
 * splits keeps each half its kind), with what came from a text cell unescaped (maths source is raw).
 */
export function wrapAsMaths(markdown: string, selection: Range): Edit {
  const where = clamped(selection, markdown.length)
  const change = codeBlock(markdown, where, MATH_FENCE)
  const inner = substring(markdown, where)
  const fromText = positioned(markdown).some((cell) => isTextCell(cell.block)
    && cell.range.location < end(where) && end(cell.range) > where.location)
  if (inner.length === 0) return change
  const raw = inner.split("\n").map(fromText ? mathsLine : fenceSafe).join("\n")
  if (raw === inner) return change
  const after = markdown.slice(0, change.range.location) + change.replacement + markdown.slice(end(change.range))
  const fenceAt = after.indexOf(OPEN + inner, change.range.location)
  if (fenceAt < 0) return change
  const innerAt = fenceAt + OPEN.length
  const final = after.slice(0, innerAt) + raw + after.slice(innerAt + inner.length)
  const caret = change.selection.location >= innerAt + inner.length
    ? change.selection.location + raw.length - inner.length : change.selection.location
  return wholeChange(markdown, final, range(caret, 0))
}

/** What Ctrl+9 does where the selection is (see the file's head). */
export type MathsCellPlan =
  /** Written or converted here: the edit (its own undo step). */
  | { kind: "edit"; edit: Edit }
  /** A new empty maths cell at this seam (after an evaluation cell's pair): the editor opens it like the + menu. */
  | { kind: "after"; seam: number }
  /** A cell with words of another kind (a heading, a list, a quote, a picture…): a new one after it, Ctrl+8's rule. */
  | { kind: "new" }
  /** A maths cell already: nothing. */
  | { kind: "none" }

/** A new empty maths cell after the last cell `where` touches (its words, holding an anchor, left as they are). */
function afterCells(markdown: string, cells: readonly PositionedBlock[], where: Range): MathsCellPlan {
  const touched = cells.filter((one) => one.block.kind !== "blank"
    && one.range.location <= end(where) && end(one.range) >= where.location)
  const last = touched[touched.length - 1]
  return { kind: "after", seam: last ? seamAfter(last.range, markdown) : end(where) }
}

/** The selection wrapped in a maths fence; round a Link Here anchor, a new maths cell after it instead. */
function wrapped(markdown: string, cells: readonly PositionedBlock[], where: Range): MathsCellPlan {
  if (holdsAnchor(substring(markdown, where))) return afterCells(markdown, cells, where)
  return { kind: "edit", edit: wrapAsMaths(markdown, where) }
}

export function mathsCellPlan(markdown: string, selection: Range): MathsCellPlan {
  const where = clamped(selection, markdown.length)
  const cells = positioned(markdown)
  const cell = cellAt(cells, where.location)
  // On an empty line (no cell there): an empty maths cell, written there (round a selection, the selection wrapped).
  if (!cell) {
    return where.length > 0 ? wrapped(markdown, cells, where) : { kind: "edit", edit: codeBlock(markdown, where, MATH_FENCE) }
  }
  const inside = within(cell, where)
  if (cell.block.kind === "code") {
    if (!inside) return wrapped(markdown, cells, where)
    if (isMathFence(cell.block.language)) return { kind: "none" }
    // An evaluation cell, or the answer under one: its pair is left as it is, and the maths cell goes after the pair
    // (between the two would part the answer from its cell).
    const language = cell.block.language ?? ""
    if (isOut(cell.block) || isEvaluation(language)) {
      const pairEnd = isOut(cell.block) ? cell.range : outAfter(cell.range, markdown)?.range ?? cell.range
      return { kind: "after", seam: seamAfter(pairEnd, markdown) }
    }
    const converted = refence(markdown, cell.range, MATH_FENCE, where.location)
    return converted ? { kind: "edit", edit: converted } : { kind: "none" }
  }
  if (isTextCell(cell.block) || isMarkdownCell(cell.block)) {
    // Some of its words selected (not all of them): those words wrapped, as Ctrl+8 wraps them.
    const words = cell.range.location + markerLength(cell.block)
    const partial = where.length > 0 && inside && (where.location > words || end(where) < end(cell.range))
    if (partial || !inside) return wrapped(markdown, cells, where)
    if (holdsAnchor(substring(markdown, cell.range))) return afterCells(markdown, cells, cell.range)
    const { source, caret } = sourceOf(markdown, cell, where.location - cell.range.location)
    if (source.trim().length === 0) return { kind: "edit", edit: codeBlock(markdown, where, MATH_FENCE) }
    const body = source.replace(/\n+$/, "")
    const replacement = OPEN + body + "\n```"
    return {
      kind: "edit",
      edit: edit(cell.range, replacement, range(cell.range.location + OPEN.length + Math.min(caret, body.length), 0)),
    }
  }
  if (!inside) return wrapped(markdown, cells, where)
  return { kind: "new" }
}

/** The maths cell the selection is in (and stays in), or null. */
function mathsCellAt(markdown: string, selection: Range): PositionedBlock | null {
  const where = clamped(selection, markdown.length)
  const cell = cellAt(positioned(markdown), where.location)
  return cell && isMathsCell(cell.block) && within(cell, where) ? cell : null
}

/**
 * Ctrl+7 on a maths cell: a TEXT cell whose words are its source, written by the escape rule (so nothing in it is
 * markup, and nothing in it is typeset). Blank lines in the source are left out: a text cell holds none. Null when the
 * selection is not in a maths cell, or the cell has no source.
 */
export function mathsAsText(markdown: string, selection: Range): Edit | null {
  const cell = mathsCellAt(markdown, selection)
  if (!cell || cell.block.kind !== "code") return null
  const lines = cell.block.body.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length === 0) return null
  const words = escapePlain(lines.join("\n"))
  // The caret: about the same distance into the words as it was into the source (its fence line left out), or their end.
  const into = selection.location - end(lineRange(markdown, cell.range.location))
  return edit(cell.range, words, range(cell.range.location + Math.min(Math.max(0, into), words.length), 0))
}

/**
 * Ctrl+8 on a maths cell: a CODE block of the same source, Wolfram Language (```wolfram, coloured, never typeset).
 * Null when the selection is not in a maths cell.
 */
export function mathsAsCode(markdown: string, selection: Range): Edit | null {
  const cell = mathsCellAt(markdown, selection)
  return cell ? refence(markdown, cell.range, MATHS_AS_CODE_FENCE, selection.location) : null
}
