/**
 * Typing in a code cell: the rules of `WriteMind/Editor/CodeTyping.swift` on CodeMirror.
 *
 * A bracket or a quote brings its partner, typing the partner steps over it, a bracket
 * typed over a selection wraps it, Backspace between the two takes both, and Tab / Shift-Tab
 * is indentation — every line of a selection at once — instead of the markdown indent
 * command. It all stands down outside a fenced block, where the markdown rules are the
 * ones that apply. The decisions are the core's `codeTyping`, `codeBackspace` and
 * `codeTabbing`; this file only asks whether the caret is in a fence and applies the answer.
 */

import type { EditorState, Extension } from "@codemirror/state"
import { EditorView, keymap, type Command } from "@codemirror/view"
import {
  codeBackspace, codeTabbing, codeTyping, firstCellFromBy, INDENT_UNIT, type Edit,
} from "@writemind/core"
import { notebook } from "./notebook"
import { renderedField } from "./rendered"
import { aroundSelection, overLines } from "./windowed"

/** Whether `pos` is in a fenced code block (`blockContaining`, on the cells the editor already has). */
function inCodeCell(state: EditorState, pos: number): boolean {
  const cells = notebook(state).cells
  // (Found by search: this is asked of every character typed, and the note can have thousands of cells.) The cells are
  // in order and do not overlap: the one that holds the position is the last that starts at or before it.
  const last = firstCellFromBy(cells, pos + 1, (cell) => cell.range) - 1
  const inside = last >= 0 ? cells[last]! : null
  if (inside && pos < inside.range.location + inside.range.length) return inside.block.kind === "code"
  // Else a cell that ENDS at the position (the caret after the last character).
  let ending = null as (typeof cells)[number] | null
  for (let i = last; i >= 0 && i > last - 3; i--) {
    if (cells[i]!.range.location + cells[i]!.range.length === pos) { ending = cells[i]!; break }
  }
  return ending !== null && ending.block.kind === "code"
}

/** The one ordinary selection a code rule may act on: a single range inside a fence. */
function codeSelection(state: EditorState): { location: number; length: number } | null {
  if (state.selection.ranges.length !== 1) return null
  const main = state.selection.main
  return inCodeCell(state, main.from) ? { location: main.from, length: main.to - main.from } : null
}

function apply(view: EditorView, edit: Edit, userEvent: string): void {
  view.dispatch({
    changes: { from: edit.range.location, to: edit.range.location + edit.range.length, insert: edit.replacement },
    selection: { anchor: edit.selection.location, head: edit.selection.location + edit.selection.length },
    scrollIntoView: true,
    userEvent,
  })
}

const typedCharacter = EditorView.inputHandler.of((view, from, to, text) => {
  const selection = codeSelection(view.state)
  if (!selection || from !== selection.location || to !== selection.location + selection.length) return false
  // (The character before the selection and the one after it are all the rule reads.)
  const edit = aroundSelection(view.state, selection, 1, 1, (window, where) => codeTyping(text, window, where))
  if (!edit) return false
  apply(view, edit, "input.type")
  return true
})

const backspace: Command = (view) => {
  const selection = codeSelection(view.state)
  if (!selection) return false
  const edit = aroundSelection(view.state, selection, 1, 1, codeBackspace)
  if (!edit) return false
  apply(view, edit, "delete.backward")
  return true
}

/**
 * Tab in a fence. The markdown pane writes four spaces (what the file should hold and
 * every other reader shows); a code cell on the rendered page writes a real tab, so what
 * is copied out of it is a tab (the Mac's `BlockEditor`).
 */
const tab = (outdent: boolean): Command => (view) => {
  const selection = codeSelection(view.state)
  if (!selection) return false
  const unit = view.state.field(renderedField, false) ? "\t" : INDENT_UNIT
  apply(view, overLines(view.state, selection, (window, where) => codeTabbing(window, where, outdent, unit)), "input.indent")
  return true
}

export const codeTypingKeys: Extension = [
  typedCharacter,
  keymap.of([
    { key: "Backspace", run: backspace },
    { key: "Tab", run: tab(false), shift: tab(true), preventDefault: true },
  ]),
]
