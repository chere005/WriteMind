import { EditorSelection, EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { cellAtCaret, verticalMove } from "../src/barWalk"
import { cellKindAt } from "../src/cellKind"
import { foldField } from "../src/fold"
import { grownCell, lastLineAt, notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armedField, armedTypeField, armSeam } from "../src/seams"
import { holdingField } from "../src/preview/hold"

/**
 * A SINGLE NEWLINE GROWS THE CELL (Sean, 2026-10-10: "a single newline should expand the size of the cell to include the line
 * the input cursor is on"; the rule is core growth.ts, `singleNewline.test.ts` there). What the editor adds: ONE accessor for
 * the grown cell (`grownCell`) and the readers that ask it. The page's half — the bracket's height and light, the seams, the
 * rendered page with no ghost line — is held by e2e/suites/cells/16-single-newline.mjs.
 */

const make = (doc: string, anchor: number, head = anchor): EditorState =>
  EditorState.create({
    doc, selection: EditorSelection.single(anchor, head),
    extensions: [notebookField, foldField, renderedField, holdingField, armedField, armedTypeField],
  })

const lines = (state: EditorState) => (head: number, edge: number) => state.doc.lineAt(head).number === state.doc.lineAt(edge).number

describe("the grown cell", () => {
  it("is the paragraph above the empty line the caret is on, and that line", () => {
    const state = make("hello\n\n\nworld", 6)
    const grown = grownCell(state)!
    expect(grown.index).toBe(0)
    expect(grown.cell.range).toEqual({ location: 0, length: 5 })
    expect(grown.line).toEqual({ location: 6, length: 0 })
  })

  it("is nothing while the caret is on the words, in a selection, or on the lone blank line between two cells", () => {
    expect(grownCell(make("hello\n\n\nworld", 3))).toBeNull()
    expect(grownCell(make("hello\n\n\nworld", 2, 6))).toBeNull()
    expect(grownCell(make("hello\n\nworld", 6))).toBeNull()
    expect(grownCell(make("hello\n\n", 7))).toBeNull()
  })

  it("follows the caret: the same state asked twice is one answer, a moved caret is another", () => {
    const state = make("hello\n", 6)
    expect(grownCell(state)).not.toBeNull()
    expect(grownCell(state)).toBe(grownCell(state))
    expect(grownCell(state.update({ selection: { anchor: 2 } }).state)).toBeNull()
  })

  it("is where a cell's last line is measured: the line it has taken, else its last character", () => {
    const state = make("hello\n", 6)
    const grown = grownCell(state)
    expect(lastLineAt({ location: 0, length: 5 }, grown, state.doc.length)).toBe(6)
    expect(lastLineAt({ location: 0, length: 5 }, null, state.doc.length)).toBe(4)
    // (Another cell of the note is measured as it always was.)
    expect(lastLineAt({ location: 10, length: 4 }, grown, 99)).toBe(13)
  })
})

describe("the readers that ask for the cell the caret is in", () => {
  it("cellAtCaret: the caret on the new line is on the cell's LAST line, its range run down to it", () => {
    const state = make("hello\n", 6)
    expect(cellAtCaret(state, 6)?.cell.range).toEqual({ location: 0, length: 6 })
    expect(cellAtCaret(make("hello\n\nworld", 6), 6)).toBeNull()
  })

  it("Down from the new line arms the bar beneath the cell; Up is the editor's own, inside the cell", () => {
    const tail = make("hello\n", 6)
    expect(verticalMove(tail, null, false, lines(tail))).toEqual({ kind: "arm", offset: 6, caret: 6 })
    expect(verticalMove(tail, null, true, lines(tail))).toBeNull()
    const middle = make("hello\n\n\nworld", 6)
    // (The bar's caret waits on the blank line that is left: the new line is the cell's.)
    expect(verticalMove(middle, null, false, lines(middle))).toEqual({ kind: "arm", offset: 8, caret: 7 })
  })

  it("the Style button names the cell from its new line, a markdown cell included", () => {
    expect(cellKindAt(make("hello\n", 6))).toEqual({ kind: "text" })
    const marked = "<!-- markdown -->\nsome **words**\n"
    expect(cellKindAt(make(marked, marked.length))).toEqual({ kind: "markdown" })
    // (Under a heading the line is nobody's.)
    expect(cellKindAt(make("# Title\n", 8))).toBeNull()
  })
})

describe("the bar", () => {
  const at = (doc: string, caret: number, bar: number | null = null) => {
    let state = make(doc, 0)
    if (bar !== null) state = state.update({ effects: armSeam.of(bar) }).state
    return state.update({ selection: { anchor: caret } }).state.field(armedField)
  }

  it("is not up on the new line under a cell, in the middle of a note or at its end", () => {
    expect(at("hello\n\n\nworld", 6)).toBeNull()
    expect(at("hello\n\n", 6)).toBeNull()
  })

  it("is still the blank line that is left, and the lone blank line between two cells", () => {
    expect(at("hello\n\n\nworld", 7)).toBe(8)
    expect(at("hello\n\nworld", 6)).toBe(7)
  })

  it("a bar armed by hand at the end of a note whose last line is the empty one stays up, the cell not grown", () => {
    const state = make("hello\n", 6).update({ effects: armSeam.of(6) }).state
    expect(state.field(armedField)).toBe(6)
    // (The seam layer and the gutter ask `grownCell` only when no bar is up; the accessor itself says what the caret is on.)
    expect(grownCell(state)).not.toBeNull()
  })
})
