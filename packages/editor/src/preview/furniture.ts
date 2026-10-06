/**
 * The open block on the rendered page edits what is WRITTEN, not the markdown
 * round it (Mac 0fdd031, `CellFurniture` / `MarkerHiding.outside`; Sean,
 * 2026-09-21: "when in wysiwyg mode, don't show the markdown characters for
 * header, only edit the text in a reminders list or bullet list").
 *
 * A heading's hashes, a list's marker and a reminder's box are FURNITURE
 * there: drawn (or not) the way the closed block draws them — that is the
 * notebook's decorations, which on this page keep them put away even on the
 * caret's line — and out of the caret's reach, which is this file. A caret put
 * inside a piece (a click on the left edge, Home, an arrow from the line
 * above) is moved out of its FRONT, past all of it; a real selection is left
 * as it was made. On the markdown side nothing here does anything: there the
 * markers ARE the text.
 *
 * The rules are the core's (`cellFurniture`, `outsideFurniture`), asked of the
 * caret's line alone — furniture is the head of a line, and only a code cell
 * (where there is none: code is code) needs the cell to say so.
 */

import { EditorSelection, EditorState, StateField, type Extension, type SelectionRange, type Transaction } from "@codemirror/state"
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view"
import { cellFurniture, end, firstCellFromBy, outsideFurniture, reminderOnLine, type Range } from "@writemind/core"
import { notebook } from "../notebook"
import { renderedField } from "../rendered"
import { armSeam } from "../seams"

/** The head of a line that can be furniture: a heading's hashes, or a list marker (a reminder's box starts with one). */
const HEAD = /^(?:#{1,6} |[ \t]*(?:[-*+] |\d{1,4}[.)] ))/

const on = (state: EditorState): boolean => state.field(renderedField, false) === true

/** Whether `pos` is in a code cell, by the cells of `state`. */
function inCode(state: EditorState, pos: number): boolean {
  const cells = notebook(state).cells
  const at = firstCellFromBy(cells, pos + 1, (cell) => cell.range) - 1
  if (at < 0) return false
  const cell = cells[at]!
  return cell.block.kind === "code" && pos >= cell.range.location && pos <= end(cell.range)
}

/**
 * The pieces of furniture on the line `text` that starts at `from`, as offsets in the note. Empty off the rendered
 * page, on a line with no marker at its head, and in a code cell (`codeAt` says whether the line is in one).
 */
function piecesOf(text: string, from: number, codeAt: () => boolean): Range[] {
  if (!HEAD.test(text) || codeAt()) return []
  return cellFurniture(text).reserved.map((r) => ({ location: from + r.location, length: r.length }))
}

/** The furniture on the line `pos` is in, in `state` (nothing off the rendered page). */
export function furnitureAt(state: EditorState, pos: number): Range[] {
  if (!on(state)) return []
  const line = state.doc.lineAt(pos)
  return piecesOf(line.text, line.from, () => inCode(state, line.from))
}

/** The reminder whose line `pos` is on (in `state`), or null; never in a code cell, never off the rendered page. */
export function reminderAt(state: EditorState, pos: number): ReturnType<typeof reminderOnLine> {
  if (!on(state)) return null
  const line = state.doc.lineAt(pos)
  if (!HEAD.test(line.text) || inCode(state, line.from)) return null
  const found = reminderOnLine({ location: 0, length: line.length }, line.text)
  if (!found) return null
  const shift = (r: Range): Range => ({ location: r.location + line.from, length: r.length })
  return { line: { location: line.from, length: line.length }, text: shift(found.text), box: found.box + line.from, ticked: found.ticked }
}

/** A caret put among the furniture of the new document, moved out of it. */
function keptOut(tr: Transaction): Transaction | readonly [Transaction, { selection: EditorSelection; sequential: true }] {
  const selection = tr.selection
  if (!selection || !on(tr.startState)) return tr
  // A caret parked at a bar armed by hand (two cells that touch: the start of a list under a fence) is in no line's
  // furniture: moving it would take the bar down.
  if (tr.effects.some((effect) => effect.is(armSeam) && effect.value !== null)) return tr
  const doc = tr.newDoc
  // Whether the line is in a code cell: asked of the cells as they were, at the place the line was (cheap, and a
  // keystroke that turns prose into code is not a caret being put among markers).
  const back = tr.docChanged ? tr.changes.invertedDesc : null
  let moved = false
  const ranges = selection.ranges.map((r): SelectionRange => {
    if (!r.empty) return r
    const line = doc.lineAt(r.head)
    const head = HEAD.exec(line.text)
    // Furniture is the head of a line: a marker, and a reminder's box after it.
    if (!head || r.head - line.from >= head[0].length + 4) return r
    const pieces = piecesOf(line.text, line.from,
      () => inCode(tr.startState, back ? back.mapPos(line.from, 1) : line.from))
    const out = outsideFurniture({ location: r.head, length: 0 }, pieces).location
    if (out === r.head) return r
    moved = true
    return EditorSelection.cursor(Math.min(out, line.to), 1)
  })
  if (!moved) return tr
  return [tr, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }] as const
}

/**
 * A paste into a reminder's words is one line: its newlines become spaces (the Mac's `singleLine` item editor). A
 * reminder that gained a newline would be two lines, and the second not a reminder at all.
 */
function pastedFlat(tr: Transaction): Transaction | { changes: { from: number; to: number; insert: string }[]; selection: EditorSelection; userEvent: string; scrollIntoView: true } {
  if (!tr.docChanged || !tr.isUserEvent("input.paste") || !on(tr.startState)) return tr
  const start = tr.startState
  if (start.selection.ranges.length !== 1) return tr
  const main = start.selection.main
  const item = reminderAt(start, main.from)
  // Inside the words: on the reminder's line, at or after where its words start, and not reaching off the line.
  if (!item || main.from < item.text.location || main.to > end(item.text)) return tr
  const changes: { from: number; to: number; insert: string }[] = []
  let flattened = false
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString()
    const flat = /[\r\n]/.test(text) ? text.split(/[\r\n]+/).filter((part) => part.length > 0).join(" ") : text
    if (flat !== text) flattened = true
    changes.push({ from: fromA, to: toA, insert: flat })
  })
  if (!flattened) return tr
  const last = changes[changes.length - 1]!
  return {
    changes,
    selection: EditorSelection.single(last.from + last.insert.length),
    userEvent: "input.paste",
    scrollIntoView: true,
  }
}

/**
 * The ``` lines of an open code block are shut to the drawn block's padding (Mac 0cde812: "a code cell opened for
 * typing pads like the rendered one") — except the one the caret is on, which opens so its language can be typed.
 * This is that one: a class on the caret's line when it is a fence.
 */
const fenceHere = Decoration.line({ class: "wm-fence-here" })
const fenceHereField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && tr.startState.field(renderedField, false) === tr.state.field(renderedField, false)) return value
    const state = tr.state
    if (!on(state) || state.selection.ranges.length !== 1) return Decoration.none
    const line = state.doc.lineAt(state.selection.main.head)
    return /^\s*```/.test(line.text) ? Decoration.set([fenceHere.range(line.from)]) : Decoration.none
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const furniture: Extension = [
  fenceHereField,
  EditorState.transactionFilter.of((tr) => {
    const flat = pastedFlat(tr)
    return flat === tr ? keptOut(tr) : flat
  }),
]
