import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, redo, undo } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { cellKindAt } from "../src/cellKind"
import { foldField } from "../src/fold"
import { list } from "../src/keys"
import { itemOpenedField, notebook, notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import {
  armSeam, armedField, armedTypeField, barComesBack, barFromField, markersOwnSpace, returnClosesTheCell, setArmedType, typeAtTheBar,
} from "../src/seams"

/**
 * A `*` TYPED AT THE BAR OPENS A BULLET LIST (Sean, 2026-10-11: "typing a * while the input cursor is horizontal will start a
 * markdown text cell with bullet points with the input cursor ready to start typing"): the cell is the empty dashes item `* `
 * (markdown's bullet list, drawn with a dash), the caret where its words go, the Style button says Dashes; `* ` is the same
 * single `* `; one Undo takes the cell back to the armed bar — at the two ends of the note too, where no caret can arm it
 * (`barComesBack`). It used to make a markdown paragraph holding a `*`, and the next key gave `*x`. The real keys on both pages:
 * e2e/suites/editor/10..12 (`_listItems.mjs`).
 */

const NOTE = "Alpha\n\nBeta\n\nGamma"

function fakeView(doc: string, caret: number): EditorView {
  const box = {
    state: EditorState.create({
      doc, selection: EditorSelection.single(caret),
      extensions: [notebookField, itemOpenedField, foldField, renderedField, armedField, armedTypeField, barFromField, history(), barComesBack],
    }),
    dom: { classList: { contains: () => false } },
    dispatch(spec: TransactionSpec | Transaction) {
      box.state = spec instanceof Transaction ? spec.state : box.state.update(spec).state
    },
    focus() {},
  }
  return box as unknown as EditorView
}

/** The bar up at `offset` with the caret at `caret`, as an arrow leaves it. */
function barAt(offset: number, caret: number, doc = NOTE): EditorView {
  const view = fakeView(doc, caret)
  view.dispatch({ selection: EditorSelection.cursor(caret), effects: armSeam.of(offset) })
  expect(view.state.field(armedField)).toBe(offset)
  return view
}

/** A key typed where the caret is: the input handlers first (the bar's, then the marker's space), else the character. */
function type(view: EditorView, text: string): void {
  const at = view.state.selection.main.head
  if (typeAtTheBar(view, text) || markersOwnSpace(view, at, at, text)) return
  view.dispatch({ changes: { from: at, insert: text }, selection: EditorSelection.cursor(at + text.length), userEvent: "input.type" })
}

const doc = (view: EditorView): string => view.state.doc.toString()
const head = (view: EditorView): number => view.state.selection.main.head

describe("a * typed at the bar", () => {
  // [the seam, the bar's offset, where the caret waits, the note with the `*` typed, the caret in its item]
  const SEAMS: [string, number, number, string, number][] = [
    ["the first seam", 0, 0, "* \n\n" + NOTE, 2],
    ["a middle seam", 7, 6, "Alpha\n\n* \n\nBeta\n\nGamma", 9],
    ["the tail", NOTE.length, NOTE.length, NOTE + "\n\n* ", NOTE.length + 4],
  ]
  for (const [name, offset, caret, written, inside] of SEAMS) {
    it(`at ${name}: opens the empty dashes item, the caret where its words go, named Dashes; one Undo puts the bar back`, () => {
      const view = barAt(offset, caret)
      type(view, "*")
      expect(doc(view)).toBe(written)
      expect(head(view)).toBe(inside)
      expect(view.state.field(armedField)).toBeNull()
      expect(cellKindAt(view.state)).toEqual({ kind: "list", style: "dashes" })
      const cell = notebook(view.state).cells.find((one) => one.range.location <= inside && inside <= one.range.location + one.range.length)
      expect(cell?.block).toEqual({ kind: "dashes", items: [""] })
      type(view, "x")
      expect(doc(view)).toBe(written.slice(0, inside) + "x" + written.slice(inside))
      undo(view)
      expect(doc(view)).toBe(written)
      undo(view)
      expect(doc(view)).toBe(NOTE)
      expect(head(view)).toBe(caret)
      expect(view.state.field(armedField), "the bar is up where it was").toBe(offset)
      redo(view)
      expect(doc(view), "Redo brings the item back").toBe(written)
    })
  }

  it("star then space is one `* `, and the next words are the item's (a second space is a word's)", () => {
    const view = barAt(7, 6)
    type(view, "*")
    type(view, " ")
    expect(doc(view)).toBe("Alpha\n\n* \n\nBeta\n\nGamma")
    expect(head(view)).toBe(9)
    type(view, " ")
    expect(doc(view)).toBe("Alpha\n\n*  \n\nBeta\n\nGamma")
  })

  it("`* milk` typed in one go (a composed input) opens the item with its words", () => {
    const view = barAt(7, 6)
    type(view, "* milk")
    expect(doc(view)).toBe("Alpha\n\n* milk\n\nBeta\n\nGamma")
    expect(head(view)).toBe(13)
  })

  it("is a character like any other at a bar whose kind was chosen on the +, and `*x` is not the gesture (a text cell's words)", () => {
    const quoted = barAt(7, 6)
    quoted.dispatch({ effects: setArmedType.of({ kind: "quote" }) })
    type(quoted, "*")
    expect(doc(quoted)).toBe("Alpha\n\n> *\n\nBeta\n\nGamma")
    const starred = barAt(7, 6)
    type(starred, "*x")
    expect(doc(starred)).toBe("Alpha\n\n*x\n\nBeta\n\nGamma")
    expect(cellKindAt(starred.state)).toEqual({ kind: "text" })
  })

  it("the marker's own space is swallowed only after a marker the bar opened, and only once", () => {
    // The + menu's Dots at the bar: its `- ` has its space.
    const view = barAt(7, 6)
    list("dots")(view)
    type(view, " ")
    expect(doc(view)).toBe("Alpha\n\n- \n\nBeta\n\nGamma")
    // A marker nothing opened (written in the file): a space is a space.
    const plain = fakeView("- \n\nBeta", 2)
    type(plain, " ")
    expect(doc(plain)).toBe("-  \n\nBeta")
  })

  it("Return on the `*` before a word is typed takes it away and puts the bar back where it was", () => {
    const view = barAt(7, 6)
    type(view, "*")
    expect(returnClosesTheCell(view)).toBe(true)
    expect(doc(view)).toBe(NOTE)
    expect(view.state.field(armedField)).toBe(7)
  })
})
