import { EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state"
import { history, undo, undoDepth } from "@codemirror/commands"
import type { EditorView } from "@codemirror/view"
import { describe, expect, it } from "vitest"
import { pictureLine, pictureMarkdown, positioned } from "@writemind/core"
import { foldField } from "../src/fold"
import { notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armedField, armSeam, dropBarField, showDropBar } from "../src/seams"
import { holdingField } from "../src/preview/hold"
import { pictureCells, picturesWhole, inkAspectsField, setInkAspects } from "../src/pictureCells"
import { cursorSeam, insertCellLine } from "../src/dock"

/**
 * Docking's editor half (docs\PLAN-docking-ink-cells.md (d), (e), (i) EDITOR): `cursorSeam` is the armed bar, else
 * the seam after the caret's cell; `insertCellLine` writes the line as a cell of its own, arms the bar under it and is
 * ONE event of the words' history (so the app can pair it with the drawing's one step).
 */

const extensions: Extension = [notebookField, foldField, renderedField, holdingField, armedField, dropBarField, pictureCells]
const LINE = pictureMarkdown("cafe0123cafe0123.png")

const make = (doc: string, anchor = 0, more: Extension = []): EditorState =>
  EditorState.create({ doc, selection: EditorSelection.cursor(anchor), extensions: [extensions, more] })

function target(state: EditorState): { state: EditorState; dispatch(spec: TransactionSpec): void } {
  const box = {
    state,
    dispatch(spec: TransactionSpec) { box.state = box.state.update(spec).state },
  }
  return box
}

describe("cursorSeam", () => {
  const doc = "First paragraph\n\nSecond paragraph\nstill second\n\n# Third"
  const second = doc.indexOf("Second")
  const third = doc.indexOf("# Third")

  it("is the armed bar when one is up", () => {
    const state = make(doc, second - 1).update({ effects: armSeam.of(second) }).state
    expect(state.field(armedField)).toBe(second)
    expect(cursorSeam(state)).toBe(second)
  })

  it("is the seam after the caret's cell otherwise (its next cell's start)", () => {
    expect(cursorSeam(make(doc, 3))).toBe(second)
    expect(cursorSeam(make(doc, second + 20)), "anywhere in a cell of two lines").toBe(third)
    expect(cursorSeam(make(doc, second)), "at a cell's very start: after that cell").toBe(third)
  })

  it("is the note's end after the last cell, and past a run of blank lines", () => {
    expect(cursorSeam(make(doc, doc.length))).toBe(doc.length)
    const spaced = "One\n\n\n\n\nTwo"
    expect(cursorSeam(make(spaced, 1))).toBe(spaced.indexOf("Two"))
  })
})

describe("insertCellLine", () => {
  const cases: Array<[string, string, (doc: string) => number]> = [
    ["between two cells with a blank line", "Above\n\nBelow", (d) => d.indexOf("Below")],
    ["between two touching cells", "Above\nBelow", (d) => d.indexOf("Below")],
    ["at the very start", "Below", () => 0],
    ["at the end, no newline", "Above", (d) => d.length],
    ["at the end, after a newline", "Above\n", (d) => d.length],
    ["in an empty note", "", () => 0],
    ["inside a line (taken to its end)", "Above words\n\nBelow", () => 3],
  ]
  for (const [name, doc, at] of cases) {
    it(`writes its own cell and arms the bar under it: ${name}`, () => {
      const box = target(make(doc))
      const { from, to } = insertCellLine(box, LINE, at(doc))
      const text = box.state.doc.toString()
      expect(text.slice(from, to)).toBe(LINE)
      // A cell of its own: the parser makes the line a picture block, and the words round it are untouched.
      const block = positioned(text).find((cell) => cell.range.location === from)
      expect(block?.block.kind).toBe("picture")
      expect(block?.range.length).toBe(LINE.length)
      expect(pictureLine(box.state.doc.lineAt(from).text)).not.toBeNull()
      expect(text.replace(LINE, "").replace(/\n+/g, "\n").trim()).toBe(doc.replace(/\n+/g, "\n").trim())
      expect(picturesWhole(box.state)).toBe(true)
      // The bar under it is armed (the next cell's start, or the note's end), and it is the cursor.
      const armed = box.state.field(armedField)
      const next = positioned(text).find((cell) => cell.range.location > to && cell.block.kind !== "blank")
      expect(armed).toBe(next ? next.range.location : text.length)
      if (next) expect(next.range.location - to, "a blank line between it and the next cell").toBe(2)
      const before = text.slice(0, from)
      if (before.length > 0) expect(before.endsWith("\n\n"), "a blank line above it").toBe(true)
    })
  }

  it("is ONE event of the words' history, even straight after typing; one undo takes it out whole", () => {
    let state = make("Above\n\nBelow", 5, history())
    state = state.update({ changes: { from: 5, insert: "!" }, selection: EditorSelection.cursor(6), userEvent: "input.type" }).state
    const depth = undoDepth(state)
    const box = target(state)
    insertCellLine(box, LINE, box.state.doc.toString().indexOf("Below"))
    expect(undoDepth(box.state)).toBe(depth + 1)
    let after = box.state
    undo({ state: after, dispatch: (tr) => { after = tr.state } } as unknown as EditorView)
    expect(after.doc.toString()).toBe("Above!\n\nBelow")
    expect(undoDepth(after)).toBe(depth)
  })

  it("carries effects (an ink cell's aspect, so it is live from its first frame)", () => {
    const box = target(make("Above"))
    insertCellLine(box, "![ink](.drawings/media/ink-0f8b2c1e-3a4d-4e5f-9a6b-7c8d9e0f1a2b.svg)", 5,
      [setInkAspects.of(new Map([["0f8b2c1e-3a4d-4e5f-9a6b-7c8d9e0f1a2b", 0.3]]))])
    expect(box.state.field(inkAspectsField).get("0f8b2c1e-3a4d-4e5f-9a6b-7c8d9e0f1a2b")).toBe(0.3)
  })

  it("the drop bar is shown, follows the text, and is put away", () => {
    let state = make("Above\n\nBelow")
    state = state.update({ effects: showDropBar.of(7) }).state
    expect(state.field(dropBarField)).toBe(7)
    state = state.update({ changes: { from: 0, insert: "xx" } }).state
    expect(state.field(dropBarField)).toBe(9)
    expect(state.update({ effects: showDropBar.of(null) }).state.field(dropBarField)).toBeNull()
  })
})
