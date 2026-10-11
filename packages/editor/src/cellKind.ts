/**
 * WHAT KIND OF CELL THE CARET IS IN — the toolbar's Style button names it and the Style menu ticks it
 * (docs/PLAN-bars-2026-10.md P1; Sean, 2026-10-10: the bar has "a dropdown to choose style" and "cells are inserted by
 * picking something in the dropdown for style").
 *
 * `cellKindAt(state)` is a lookup in the cells the editor already holds (`notebookField`: nothing is parsed again, one
 * binary search), so it is cheap enough to ask on every selection change and every keystroke. At an ARMED BAR the answer
 * is the kind the bar will open (`armedTypeField`: "the caret hides, the bar is the cursor", docs/KEYS.md, Sean
 * 2026-10-05), because a bar is in no cell and what the next character makes is what the button should say.
 *
 * `watchCellKind(view, listener)` is how the page subscribes: it hears the current kind at once and then ONLY a change
 * of kind (a caret moving inside a cell, or a keystroke that leaves the kind alone, tells nobody anything). It installs
 * its listener in the editor the first time it is asked, so nothing has to be added to the editor's setup, and the
 * returned function takes the subscription away.
 */

import { StateEffect, type EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { firstCellFromBy, end, kindOfBlock, listMatches, LIST_STYLES, sameKind, type CellKind } from "@writemind/core"
import { grownCell, itemOpenedField, notebookField } from "./notebook"
import { armedField, armedTypeField } from "./seams"
import { caretInEmptyCell } from "./textCells"

/**
 * The cell a command has just OPENED EMPTY and the caret is in, which the parser cannot name yet (the + menu's Dots, Dashes
 * and Numbered write their marker and nothing else, which reads as a paragraph; a Markdown cell is its marker line over an
 * empty one): the kind the command made, so the Style button says what the cell is the moment it exists and not "Text".
 */
function openedKind(state: EditorState, head: number): CellKind | null {
  if (caretInEmptyCell(state) !== null) return { kind: "markdown" }
  const line = state.doc.lineAt(head)
  if (state.field(itemOpenedField, false) !== line.from) return null
  const rest = line.text.trimStart()
  const style = LIST_STYLES.find((one) => listMatches(one, rest))
  return style ? { kind: "list", style } : null
}

/** The kind of the cell the caret is in (the head of the main selection), the armed bar's kind at a bar, or null where no cell is. */
export function cellKindAt(state: EditorState): CellKind | null {
  if ((state.field(armedField, false) ?? null) !== null) return state.field(armedTypeField, false) ?? { kind: "text" }
  const cells = state.field(notebookField, false)?.cells
  if (!cells || cells.length === 0) return null
  const head = state.selection.main.head
  const opened = openedKind(state, head)
  if (opened) return opened
  // The last cell that starts at or before the caret; the caret is in it when it has not gone past its end.
  const index = firstCellFromBy(cells, head + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index]! : null
  // (On the empty line a single newline opened the caret is in the paragraph above, which has taken the line: core growth.ts.)
  if (!cell || (head > end(cell.range) && grownCell(state)?.cell !== cell)) return null
  return kindOfBlock(cell.block)
}

/** Whether two answers are the same: both none, or the same kind. */
export const sameCellKind = (a: CellKind | null, b: CellKind | null): boolean =>
  a === null || b === null ? a === b : sameKind(a, b)

type Listener = (kind: CellKind | null) => void
const watching = new WeakMap<EditorView, Set<Listener>>()

/** Told of every CHANGE of kind, after the view has the new state. */
const changes = EditorView.updateListener.of((update) => {
  const set = watching.get(update.view)
  if (!set || set.size === 0) return
  if (!update.selectionSet && !update.docChanged && update.startState.field(armedField, false) === update.state.field(armedField, false)
    && update.startState.field(armedTypeField, false) === update.state.field(armedTypeField, false)
    // (An item the app opened is told in a transaction of its own, right after the cell is written.)
    && update.startState.field(itemOpenedField, false) === update.state.field(itemOpenedField, false)) return
  const before = cellKindAt(update.startState)
  const after = cellKindAt(update.state)
  if (sameCellKind(before, after)) return
  for (const listener of [...set]) listener(after)
})

/** Subscribe to the caret's cell kind: `listener` hears the current one now, then each change. Returns the way to stop. */
export function watchCellKind(view: EditorView, listener: (kind: CellKind | null) => void): () => void {
  let set = watching.get(view)
  if (!set) {
    set = new Set()
    watching.set(view, set)
    view.dispatch({ effects: StateEffect.appendConfig.of(changes) })
  }
  set.add(listener)
  listener(cellKindAt(view.state))
  return () => { set.delete(listener) }
}
