import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, undo, undoDepth } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import type { Command } from "@codemirror/view"
import { evaluationCell } from "../src/eval"
import { tagFence } from "../src/extras"
import { foldField } from "../src/fold"
import { fence, heading, list, markdownCell, mathsCell, quote, tableCell, textCell } from "../src/keys"
import { itemOpenedField, notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armSeam, armedField, armedTypeField } from "../src/seams"

/**
 * EVERY KIND OF CELL MADE AT A BAR IS MADE THE SAME WAY (the + menu's picks, the Style menu's and the keys: Sean, 2026-10-10,
 * "clicking on a cell type from the + button should insert the cell and put the input cursor where it belongs"): the cell is
 * written whole with the caret inside it, the bar gone, and it is ONE undo step of its own however soon the next word is
 * typed — that word is the next step — so one Undo takes the cell and puts the caret back at the bar. The Runnable code cell and
 * the Code cell with a language had each their own copy of the funnel's edit and lacked the closing of the step: a word typed
 * within half a second of the cell joined it, and one Undo took both. The real mouse on the real page is
 * e2e/suites/cells/16..19.
 */

const NOTE = "One\n\nTwo"
const BAR = 5            // the bar between the cells: the start of "Two"
const CARET_ON_BAR = 4   // where the caret waits on the blank line the bar stands on

const make = (): EditorState => EditorState.create({
  doc: NOTE, selection: EditorSelection.single(CARET_ON_BAR),
  extensions: [notebookField, itemOpenedField, foldField, renderedField, armedField, armedTypeField, history()],
})

/** Enough of an EditorView for the commands: the state, a dispatch that applies, focus, and the root's classes. */
function fakeView(): EditorView {
  const box = {
    state: make(),
    dom: { classList: { contains: () => false } },
    dispatch(spec: TransactionSpec | Transaction) {
      box.state = spec instanceof Transaction ? spec.state : box.state.update(spec).state
    },
    focus() {},
  }
  return box as unknown as EditorView
}

/** The bar up at BAR, then the command, as a pick from the + menu does it. */
function pick(command: Command): EditorView {
  const view = fakeView()
  view.dispatch({ selection: EditorSelection.cursor(CARET_ON_BAR), effects: armSeam.of(BAR) })
  expect(view.state.field(armedField)).toBe(BAR)
  expect(command(view)).toBe(true)
  return view
}

/** A word typed a moment later, as the keyboard does. */
function type(view: EditorView, word: string): void {
  const at = view.state.selection.main.head
  view.dispatch({ changes: { from: at, insert: word }, selection: EditorSelection.cursor(at + word.length), userEvent: "input.type" })
}

const table = "|  |  |\n| --- | --- |\n|  |  |\n|  |  |"
const KINDS: [string, Command, string, number][] = [
  // [name, the command, the cell it writes (empty), where the caret goes inside it]
  ["Text", textCell, "", 0],
  ["Markdown", markdownCell, "<!-- markdown -->\n", 18],
  ["Title", heading(1), "# ", 2],
  ["Dots", list("dots"), "- ", 2],
  ["Numbered", list("numbered"), "1. ", 3],
  ["Quote", quote, "> ", 2],
  ["Code", fence, "```\n\n```", 4],
  ["Code with a language", tagFence("python"), "```python\n\n```", 10],
  ["Runnable code", evaluationCell, "```eval wl\n\n```", 11],
  ["Maths", mathsCell, "```wl\n\n```", 6],
  ["Table", tableCell, table, 2],
]

describe("a cell made at a bar, whatever its kind", () => {
  for (const [name, command, cell, inside] of KINDS) {
    describe(name, () => {
      const written = `One\n\n${cell}\n\nTwo`

      it("is the new empty cell at the bar, the caret inside it at its first editable position, the bar gone", () => {
        const view = pick(command)
        expect(view.state.doc.toString()).toBe(written)
        expect(view.state.selection.main.empty).toBe(true)
        expect(view.state.selection.main.head).toBe("One\n\n".length + inside)
        expect(view.state.field(armedField)).toBeNull()
      })

      it("is ONE undo step of its own: the word typed right after is the next step, and one Undo takes the cell and the caret back to the bar", () => {
        const view = pick(command)
        const depth = undoDepth(view.state)
        type(view, "x")
        expect(undoDepth(view.state)).toBe(depth + 1)
        undo(view)
        expect(view.state.doc.toString()).toBe(written)
        undo(view)
        expect(view.state.doc.toString()).toBe(NOTE)
        expect(view.state.selection.main.head).toBe(CARET_ON_BAR)
      })
    })
  }
})
