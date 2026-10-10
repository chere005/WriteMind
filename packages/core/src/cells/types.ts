/**
 * What the + at the left-hand end of the insertion bar offers, and what
 * picking one does to the cell that seam opens. Ported from
 * `WriteMind/Editor/CellTypes.swift`.
 *
 * It is not a second way to make a cell. The seam opens ONE plain cell
 * through `insertBlock`, and then the very command the Format menu already
 * runs turns it into the kind that was chosen. One path, the tested one.
 *
 * The order matters and is the reason the type is applied while the cell is
 * still EMPTY, before a character goes in: `- `, `> `, `#### ` and a pair of
 * fences all leave the caret where the words belong.
 */

import { edit, end, lineRange, range, replacing, type Edit, type Range } from "../text/range"
import { positioned } from "../markdown/parser"
import {
  codeBlock, headingName, HEADING_LADDER, listTitle, LIST_STYLES, setHeading,
  toggleList, toggleQuote, type Heading, type ListStyle,
} from "../markdown/formatting"
import { insertBlock } from "./editing"
import { MARKDOWN_MARKER, escapePlain } from "../markdown/plainText"
import { evaluatorFence, evaluatorTitle, type Evaluator } from "../eval/evaluator"
import { MATH_FENCE, isMathFence } from "../math/typesetter"
import { DEFAULT_EVALUATOR, evaluatorFrom, isEvaluation } from "../eval/evaluator"
import type { Block } from "../markdown/parser"
import { tableBlock } from "./tableCells"

export type CellKind =
  /** A paragraph — the default, and what an ordinary click on the bar arms. */
  | { kind: "text" }
  /** A paragraph read as markdown: the marker line `<!-- markdown -->` over it (docs/PLAN-text-cells.md). Ctrl+Shift+7. */
  | { kind: "markdown" }
  | { kind: "heading"; level: Heading }
  | { kind: "list"; style: ListStyle }
  | { kind: "quote" }
  | { kind: "code" }
  /**
   * A MATHS cell (Sean, 2026-10-06: "clearly we need a math cell type.. that should be ctrl + 9"): the ```wl fence
   * display maths always was, typeset when the caret is not in it, as a kind of its own (`cells/mathsCells.ts`).
   */
  | { kind: "maths" }
  /**
   * A cell the note RUNS (Mac 29149b9; Sean, 2026-09-22: "if the input cursor is horizontal, hitting cmd+9 puts a
   * new evaluation cell at that position"). A fenced block like any other here — the `eval ` prefix on its info
   * string is the whole difference — so it needs no second block builder, only its own fence. Deliberately NOT in
   * KIND_GROUPS: five environments would swamp the + menu for a cell its own key (Ctrl+Shift+8) already makes.
   */
  | { kind: "evaluation"; evaluator: Evaluator }
  /**
   * An INK cell (docsPLAN-docking-ink-cells.md): a cell you draw in with the pen. The + menu offers it (its last
   * group) and Ctrl+0 makes one, but its line names a cell in the drawing sidecar, so the APP makes it
   * (`insertInkCell`): `opening` has nothing to write for it, and the bar's typing never makes one.
   */
  | { kind: "ink" }
  /**
   * A docked picture (the Mac's `Kind.picture(line:)`): `line` is the `![](.drawings/media/<file>)` that docking
   * writes, so a dock at an armed bar goes through the one block builder every other kind does. Not in the menu.
   */
  | { kind: "picture"; line: string }
  /**
   * A GitHub-style pipe table (`markdown/table.ts`), written by the toolbar's Table button (`tableBlock`). Not in the
   * menu: its own button makes it, and the Style button names it when the caret is in one.
   */
  | { kind: "table" }

/** A rung of the ladder as a kind — Body Text being the plain paragraph. */
export function kindForHeading(level: Heading): CellKind {
  return level === 0 ? { kind: "text" } : { kind: "heading", level }
}

/** What the menu calls it. */
export function kindName(kind: CellKind): string {
  switch (kind.kind) {
    case "text": return headingName(0)
    case "markdown": return "Markdown"
    case "heading": return headingName(kind.level)
    case "list": return `${listTitle(kind.style)} List`
    case "quote": return "Quote"
    case "code": return "Code Block"
    case "maths": return "Maths Cell"
    case "evaluation": return `${evaluatorTitle(kind.evaluator)} Evaluation Cell`
    case "ink": return "Drawing Cell"
    case "picture": return "Picture"
    case "table": return "Table"
  }
}

/**
 * The kind of cell a parsed block is — what the toolbar's Style button names when the caret is in it. Null where the
 * block is no cell the Style menu knows (a rule, the blank lines the note holds on purpose). An answer under a runnable
 * cell (the ```out fence) is code, as it is drawn; a picture line that names an ink cell is a drawing cell.
 */
export function kindOfBlock(block: Block | null | undefined): CellKind | null {
  if (!block) return null
  switch (block.kind) {
    case "paragraph": return block.markdown ? { kind: "markdown" } : { kind: "text" }
    case "heading": return kindForHeading(block.level as Heading)
    case "bullets": return { kind: "list", style: "dots" }
    case "dashes": return { kind: "list", style: "dashes" }
    case "numbered": return { kind: "list", style: "numbered" }
    case "todos": return { kind: "list", style: "todo" }
    case "quote": return { kind: "quote" }
    case "code":
      if (isMathFence(block.language)) return { kind: "maths" }
      if (isEvaluation(block.language)) return { kind: "evaluation", evaluator: evaluatorFrom(block.language) ?? DEFAULT_EVALUATOR }
      return { kind: "code" }
    case "picture": return block.ink !== null ? { kind: "ink" } : { kind: "picture", line: `![${block.alt}](${block.path})` }
    case "table": return { kind: "table" }
    case "rule": case "blank": return null
  }
}

export function sameKind(a: CellKind, b: CellKind): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "heading" && b.kind === "heading") return a.level === b.level
  if (a.kind === "list" && b.kind === "list") return a.style === b.style
  if (a.kind === "evaluation" && b.kind === "evaluation") return a.evaluator === b.evaluator
  if (a.kind === "picture" && b.kind === "picture") return a.line === b.line
  return true
}

/**
 * The list, in the groups a separator goes between: body text on its own at
 * the top because it is the default, then the ladder six deep (Sean's own
 * rungs, not "Heading 1…6"), then the lists and the quote, then the fence.
 */
export const KIND_GROUPS: CellKind[][] = [
  [{ kind: "text" }, { kind: "markdown" }],
  HEADING_LADDER.filter((level) => level !== 0).map((level): CellKind => ({ kind: "heading", level })),
  [...LIST_STYLES.map((style): CellKind => ({ kind: "list", style })), { kind: "quote" }],
  // The code block and, beside it, the maths cell (Ctrl+8, Ctrl+9).
  [{ kind: "code" }, { kind: "maths" }],
  // Last, on its own: the cell you draw in (the app makes it; see `{ kind: "ink" }`).
  [{ kind: "ink" }],
]

export const ALL_KINDS: CellKind[] = KIND_GROUPS.flat()

/**
 * What choosing this does to the cell the caret is in — null for plain text,
 * which is the absence of a command rather than one of its own.
 */
export function opening(kind: CellKind, markdown: string, caret: number): Edit | null {
  const place = Math.min(Math.max(caret, 0), markdown.length)
  const selection = range(place, 0)
  switch (kind.kind) {
    case "text":
      return null
    case "markdown": {
      // The marker goes on a line of its own above the caret's (empty) line; the caret stays where the words go.
      let lineStart = place
      while (lineStart > 0 && markdown.charCodeAt(lineStart - 1) !== 10) lineStart--
      const head = MARKDOWN_MARKER + "\n"
      return edit(range(lineStart, 0), head, range(place + head.length, 0))
    }
    case "heading":
      // `evenIfEmpty`, because the cell is empty when the marker is written
      // and the ladder otherwise leaves a blank line alone.
      return setHeading(markdown, selection, kind.level, true)
    case "list":
      return toggleList(markdown, selection, kind.style)
    case "quote":
      return toggleQuote(markdown, selection)
    case "code":
      return codeBlock(markdown, selection)
    case "maths":
      // An empty ```wl fence, the caret on the line inside it: it is typeset once it has maths and the caret leaves.
      return codeBlock(markdown, selection, MATH_FENCE)
    case "evaluation":
      // The same fenced block the Insert menu writes, with the info string that makes it one the note runs.
      return codeBlock(markdown, selection, evaluatorFence(kind.evaluator))
    case "ink":
      // The app writes an ink cell's line, because it also puts the cell in the drawing.
      return null
    case "picture":
      return pictureOpening(kind.line, markdown, place)
    case "table":
      return tableBlock(markdown, selection)
  }
}

/**
 * A picture's line written at the caret: over the caret's line when that line is empty (the new cell `openCell` just
 * made), else as a cell of its own after the caret's line. The caret ends at the end of the picture line.
 */
function pictureOpening(line: string, markdown: string, caret: number): Edit {
  const here = lineRange(markdown, caret)
  // (lineRange may take the newline at its end; the line's words are what is before it.)
  let to = here.location + here.length
  if (to > here.location && markdown.charCodeAt(to - 1) === 10) to--
  if (markdown.slice(here.location, to).trim() === "") {
    return edit(range(here.location, to - here.location), line, range(here.location + line.length, 0))
  }
  const opened = insertBlock(markdown, to)
  const added = opened.markdown.length - markdown.length
  const lead = opened.markdown.slice(to, opened.caret)
  const trail = opened.markdown.slice(opened.caret, to + added)
  return edit(range(to, 0), lead + line + trail, range(to + lead.length + line.length, 0))
}

/**
 * The cell the caret has landed in. Asked in that order because the ends are
 * ambiguous: the caret after `- ` is at the end of the bullet cell AND at
 * the start of nothing.
 */
function cellAtCaret(caret: number, markdown: string): Range {
  const blocks = positioned(markdown).map((block) => block.range)
  const inside = blocks.find((r) => r.location < caret && caret < end(r))
  if (inside) return inside
  const starting = blocks.find((r) => r.location === caret)
  if (starting) return starting
  const ending = blocks.find((r) => end(r) === caret)
  if (ending) return ending
  return range(caret, 0)
}

/**
 * A new cell of this kind at `offset`, with `written` already typed into it:
 * the note, the cell's OWN range, and where the caret lands inside it.
 * `literal`: `written` was TYPED, so a text cell takes it by the escape rule; false for markdown put there as it is
 * (a paste at the bar: cells copied whole keep their headings, formatting and markers).
 */
export function openCell(kind: CellKind, markdown: string, offset: number, written = "", literal = true):
  { markdown: string; cell: Range; caret: number } {
  const opened = insertBlock(markdown, offset)
  let text = opened.markdown
  let caret = Math.min(Math.max(opened.caret, 0), text.length)
  const change = opening(kind, text, caret)
  if (change) {
    text = replacing(text, change.range, change.replacement)
    caret = Math.min(Math.max(change.selection.location, 0), text.length)
  }
  if (written.length > 0) {
    // A text cell is plain words: what is typed into it is written by the escape rule (a `#` stays a `#`).
    const words = kind.kind === "text" && literal ? escapePlain(written) : written
    text = replacing(text, range(caret, 0), words)
    caret = Math.min(caret + words.length, text.length)
  }
  return { markdown: text, cell: cellAtCaret(caret, text), caret }
}
