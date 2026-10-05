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

import { end, range, replacing, type Edit, type Range } from "../text/range"
import { positioned } from "../markdown/parser"
import {
  codeBlock, headingName, HEADING_LADDER, listTitle, LIST_STYLES, setHeading,
  toggleList, toggleQuote, type Heading, type ListStyle,
} from "../markdown/formatting"
import { insertBlock } from "./editing"
import { evaluatorFence, evaluatorTitle, type Evaluator } from "../eval/evaluator"

export type CellKind =
  /** A paragraph — the default, and what an ordinary click on the bar arms. */
  | { kind: "text" }
  | { kind: "heading"; level: Heading }
  | { kind: "list"; style: ListStyle }
  | { kind: "quote" }
  | { kind: "code" }
  /**
   * A cell the note RUNS (Mac 29149b9; Sean, 2026-09-22: "if the input cursor is horizontal, hitting cmd+9 puts a
   * new evaluation cell at that position"). A fenced block like any other here — the `eval ` prefix on its info
   * string is the whole difference — so it needs no second block builder, only its own fence. Deliberately NOT in
   * KIND_GROUPS: five environments would swamp the + menu for a cell its own key (Ctrl+9) already makes.
   */
  | { kind: "evaluation"; evaluator: Evaluator }

/** A rung of the ladder as a kind — Body Text being the plain paragraph. */
export function kindForHeading(level: Heading): CellKind {
  return level === 0 ? { kind: "text" } : { kind: "heading", level }
}

/** What the menu calls it. */
export function kindName(kind: CellKind): string {
  switch (kind.kind) {
    case "text": return headingName(0)
    case "heading": return headingName(kind.level)
    case "list": return `${listTitle(kind.style)} List`
    case "quote": return "Quote"
    case "code": return "Code Block"
    case "evaluation": return `${evaluatorTitle(kind.evaluator)} Evaluation Cell`
  }
}

export function sameKind(a: CellKind, b: CellKind): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "heading" && b.kind === "heading") return a.level === b.level
  if (a.kind === "list" && b.kind === "list") return a.style === b.style
  if (a.kind === "evaluation" && b.kind === "evaluation") return a.evaluator === b.evaluator
  return true
}

/**
 * The list, in the groups a separator goes between: body text on its own at
 * the top because it is the default, then the ladder six deep (Sean's own
 * rungs, not "Heading 1…6"), then the lists and the quote, then the fence.
 */
export const KIND_GROUPS: CellKind[][] = [
  [{ kind: "text" }],
  HEADING_LADDER.filter((level) => level !== 0).map((level): CellKind => ({ kind: "heading", level })),
  [...LIST_STYLES.map((style): CellKind => ({ kind: "list", style })), { kind: "quote" }],
  [{ kind: "code" }],
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
    case "evaluation":
      // The same fenced block the Insert menu writes, with the info string that makes it one the note runs.
      return codeBlock(markdown, selection, evaluatorFence(kind.evaluator))
  }
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
 */
export function openCell(kind: CellKind, markdown: string, offset: number, written = ""):
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
    text = replacing(text, range(caret, 0), written)
    caret = Math.min(caret + written.length, text.length)
  }
  return { markdown: text, cell: cellAtCaret(caret, text), caret }
}
