/**
 * Where an Out cell goes, what gets replaced when the same cell is run again, and the In/Out pairs read back off the
 * note. Ported from `WriteMind/Eval/EvalCells.swift` (Mac commits 0bf52b5, 4fad93e, 799b13b, df166db) and the
 * words of `WriteMind/Eval/CellMark.swift`.
 *
 * FOUND BY POSITION, VETOED BY THE TAG: the answer to a cell is the block immediately after it (blank cells in the
 * gap stepped over), and only when that block is an `out` fence. By position, because every other cell identity in
 * this app is a character offset and a note is not a database; vetoed by the tag, because otherwise a re-run would
 * overwrite whatever the person happened to have written under the code.
 */

import { positioned, type PositionedBlock } from "../markdown/parser"
import { fenced } from "../markdown/formatting"
import { pasteCell } from "../cells/commands"
import { cellSpacing } from "../cells/apart"
import { end, lineRange, range, substring, type Edit, type Range } from "../text/range"
import { evaluatorBadge, evaluatorFence, evaluatorFrom, type Evaluator } from "./evaluator"
import { isOut, outCell, type EvalResult } from "./output"

const sameRange = (a: Range, b: Range): boolean => a.location === b.location && a.length === b.length

/** The cell the caret is in, if it is a fenced block — what Shift+Enter runs. */
export function runnableCell(caret: number, text: string): PositionedBlock | null {
  const block = positioned(text).find((b) =>
    (caret >= b.range.location && caret < end(b.range)) || b.range.location === caret)
  if (!block || block.block.kind !== "code") return null
  return block
}

/**
 * Where the answer to `blocks[index]` is, over blocks already parsed. The one reader of "what counts as the block
 * below this one", so the answer, the re-run and the bracket cannot drift apart. A run of three or more empty lines
 * is a `blank` block — the note's own spacing — and pressing Return twice under a cell must not hide its answer.
 */
function answerIndex(index: number, blocks: PositionedBlock[]): number | null {
  let next = index + 1
  while (next < blocks.length && blocks[next]!.block.kind === "blank") next++
  if (next >= blocks.length || !isOut(blocks[next]!.block)) return null
  return next
}

/** The Out cell belonging to this one, if it has one already. */
export function outAfter(cell: Range, text: string): PositionedBlock | null {
  const blocks = positioned(text)
  const index = blocks.findIndex((b) => b.range.location === cell.location)
  if (index < 0) return null
  const answer = answerIndex(index, blocks)
  return answer === null ? null : blocks[answer]!
}

/**
 * The edit that puts a result under a cell: over the Out cell that is already there, or a new one after it.
 * Replacing uses the Out block's OWN range and never `extent`, which deliberately swallows the blank line after a
 * cell and would glue the answer to whatever is below.
 */
export function writeAnswer(result: EvalResult, cell: Range, text: string): Edit {
  const written = outCell(result)
  const existing = outAfter(cell, text)
  if (existing) {
    return { range: existing.range, replacement: written, selection: range(existing.range.location, 0) }
  }
  return pasteCell(written, cell, text)
}

/** A range measured before an edit, where it is afterwards: what is below the answer moves, what is above does not. */
export function shiftedByEdit(r: Range, edit: Edit): Range {
  const change = edit.replacement.length - edit.range.length
  if (change === 0 || r.location < end(edit.range)) return r
  return range(r.location + change, r.length)
}

export function offsetShiftedByEdit(offset: number, edit: Edit): number {
  const change = edit.replacement.length - edit.range.length
  if (change === 0 || offset < end(edit.range)) return offset
  return offset + change
}

/**
 * AN EVALUATION CELL AND ITS ANSWER ARE ONE GROUP — the In/Out pair a notebook draws one bracket round. It is not a
 * section: nothing is folded and nothing is nested by it in the note.
 */
export interface EvalGroup {
  input: Range
  output: Range
  key: string
}

/** The two of them, end to end. */
export const groupRange = (group: EvalGroup): Range =>
  range(group.input.location, end(group.output) - group.input.location)

/**
 * AN OUT CELL IS AN ANSWER, WHATEVER RAN: the pair is a fenced cell with an `out` cell under it, and the fence above
 * is not asked what it says — nothing but a run writes an `out` fence, and every pair written before the `eval `
 * fence existed is written ```python.
 */
export function evalGroups(text: string): EvalGroup[] {
  return groupsOf(positioned(text))
}

/** The same, over blocks already parsed (the editor keeps them in a field). */
export function groupsOf(blocks: PositionedBlock[]): EvalGroup[] {
  const out: EvalGroup[] = []
  blocks.forEach((block, index) => {
    if (block.block.kind !== "code" || isOut(block.block)) return
    const found = answerIndex(index, blocks)
    if (found === null) return
    out.push({ input: block.range, output: blocks[found]!.range, key: `eval:${block.range.location}` })
  })
  return out
}

/**
 * WHICH `In[n]` A CELL IS: the nth answered pair in the note, counted from the top, and null for a cell that has not
 * been run. By position in the note and not by the order the cells were run in: a note is a file opened again
 * tomorrow, and the only thing in it that could carry a number is the fence, which is not ours to scribble in.
 */
export function pairNumber(cell: Range, groups: EvalGroup[]): number | null {
  const index = groups.findIndex((g) => sameRange(g.input, cell) || sameRange(g.output, cell))
  return index < 0 ? null : index + 1
}

/** Whether this cell is the ANSWER half of its pair — `Out[n]` rather than `In[n]`. */
export const isAnswerCell = (cell: Range, groups: EvalGroup[]): boolean =>
  groups.some((g) => sameRange(g.output, cell))

/**
 * Whether a cell is inside a group — which is what pushes its own bracket one step in. Containment, not the two
 * ends: a blank cell between the code and its answer is inside the bracket too.
 */
export function isGroupedCell(cell: Range, groups: EvalGroup[]): boolean {
  return groups.some((g) => {
    const whole = groupRange(g)
    return cell.location >= whole.location && end(cell) <= end(whole)
  })
}

/**
 * WHICH OF SEVERAL IDENTICAL CELLS WAS THE ONE THAT RAN. A cell is found again by its own text when the answer comes
 * back (a run takes time and the note is editable throughout it); Ctrl+Shift+D makes two identical cells in one
 * keystroke, so where the run started from is the tie break.
 */
export function landingOf(opening: string, text: string, startedAt: number): PositionedBlock | null {
  let best: PositionedBlock | null = null
  for (const block of positioned(text)) {
    if (substring(text, block.range) !== opening) continue
    if (!best || Math.abs(block.range.location - startedAt) < Math.abs(best.range.location - startedAt)) best = block
  }
  return best
}

/**
 * WHERE THE BAR GOES WHEN A CELL HAS FINISHED: the start of the next cell, which is the offset both modes already
 * read as "the seam under this one". The end of the note when there is nothing after it.
 */
export function seamAfter(cell: Range, text: string): number {
  const blocks = positioned(text)
  const index = blocks.findIndex((b) => b.range.location === cell.location)
  if (index >= 0 && index + 1 < blocks.length) return blocks[index + 1]!.range.location
  return text.length
}

/**
 * WHERE THE CARET GOES when the bar is armed under an answer: the blank line the bar is drawn in, which is where a
 * click in that seam would have put it — and not the start of the cell below, which armed the same bar and left
 * every other reader of "the caret is in that cell" answering for the wrong one.
 */
export function caretUnder(cell: Range, text: string): number {
  return Math.min(end(cell) + 1, seamAfter(cell, text), text.length)
}

/**
 * Changing a cell's environment rewrites its fence and nothing else — the body is untouched, and so is any Out cell
 * under it. This is also what TURNS A CELL INTO AN EVALUATION CELL: ```python becomes ```eval python.
 */
export function setEnvironment(evaluator: Evaluator, cell: Range, text: string): Edit | null {
  if (end(cell) > text.length) return null
  const open = lineRange(text, cell.location)
  const line = substring(text, open).replace(/[\r\n]+$/, "")
  if (!line.trim().startsWith("```")) return null
  const replacement = "```" + evaluatorFence(evaluator)
  if (replacement === line) return null
  return {
    range: range(open.location, line.length),
    replacement,
    selection: range(open.location + replacement.length, 0),
  }
}

/**
 * Ctrl+Shift+8 (the Mac's ⌘9) — an evaluation cell here. An existing fenced block becomes one, keeping its code; anything else gets a
 * new one after it. (The caret goes on the empty line inside a NEW cell, ready to be typed into — the Mac's edit
 * selected the pasted cell; its tests do not ask.)
 */
export function makeEvaluation(evaluator: Evaluator, cell: Range | null, text: string): Edit {
  if (cell && end(cell) <= text.length && fenced(substring(text, cell)) !== null) {
    const converted = setEnvironment(evaluator, cell, text)
    if (converted) return converted
  }
  const opening = "```" + evaluatorFence(evaluator) + "\n"
  const fresh = opening + "\n```"
  if (!cell) {
    const at = text.length
    // A cell of its own: a blank line above it, never a second one (a note that already ends on one).
    const { lead } = cellSpacing(text, "")
    return { range: range(at, 0), replacement: lead + fresh, selection: range(at + lead.length + opening.length, 0) }
  }
  const paste = pasteCell(fresh, cell, text)
  return { ...paste, selection: range(paste.selection.location + opening.length, 0) }
}

// MARK: - The mark at the cell's left

/**
 * What the mark says: the environment until the cell has run, `In[n]` after, and `Out[n]` over its answer (Sean,
 * 2026-09-22: "the dropdown for evaluator type will become the In[n] after evaluation"). A fence this app does not
 * know still opens the menu, and says so rather than naming a language it cannot run.
 */
export type MarkRole =
  | { kind: "input"; fence: string | null; number: number | null }
  | { kind: "output"; number: number }

export function markTitle(role: MarkRole): string {
  if (role.kind === "output") return `Out[${role.number}]`
  if (role.number !== null) return `In[${role.number}]`
  return markLanguage(role) ?? "—"
}

/**
 * THE LANGUAGE A CODE CELL'S MARK NAMES, ran or not (Sean, 2026-10-05: "show language "WL" or "PY" next to In[]"):
 * `Evaluator.badge`, or "—" for a fence this app cannot run. Before the cell has run it is the whole mark (and the
 * menu); after, it sits under `In[n]`. An answer names none — `Out[n]` is the same whatever ran.
 */
export function markLanguage(role: MarkRole): string | null {
  if (role.kind === "output") return null
  const evaluator = evaluatorFrom(role.fence)
  return evaluator ? evaluatorBadge(evaluator) : "—"
}
