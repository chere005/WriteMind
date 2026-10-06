import { EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state"
import { history, undo, undoDepth } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { inkCellMarkdown, pictureMarkdown } from "@writemind/core"
import { foldField } from "../src/fold"
import { notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armedField, dropBarField } from "../src/seams"
import { holdingField } from "../src/preview/hold"
import { pictureCells, pictureCellsOf } from "../src/pictureCells"
import { insertCellLine, removeCellLine } from "../src/dock"

/**
 * Undocking's editor half (2026-10-06, docs/TODO.md "Drawing polish"): `removeCellLine` takes a picture or ink cell's
 * line out of the note the way Delete takes a held cell (no blank line left doubled, the cells either side apart), as
 * ONE event of the words' history, and it is never turned into "hold the cell" by the picture lines' guard (which a
 * Backspace or Delete beside a picture is). No Swift original: the Mac has no undocking (its PLAN-docking.md: "Undocking
 * is not in this plan").
 */

const extensions: Extension = [notebookField, foldField, renderedField, holdingField, armedField, dropBarField, pictureCells]
const PICTURE = pictureMarkdown("cafe0123cafe0123.png")
const INK = inkCellMarkdown("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f")

function target(doc: string, anchor = 0) {
  const box = {
    state: EditorState.create({ doc, selection: EditorSelection.cursor(anchor), extensions: [extensions, history()] }),
    dispatch(spec: TransactionSpec) { box.state = box.state.update(spec).state },
  }
  return box
}

/** The line of the n-th picture cell. */
const lineOf = (state: EditorState, n = 0): { from: number; to: number } => {
  const cell = pictureCellsOf(state)[n]!
  return { from: cell.range.location, to: cell.range.location + cell.range.length }
}

describe("a cell's line taken out of the note (undocking)", () => {
  it("between two paragraphs: the line and one blank line go, the paragraphs stay a blank line apart", () => {
    const t = target(`First.\n\n${PICTURE}\n\nSecond.`, 3)
    expect(removeCellLine(t, lineOf(t.state).from, lineOf(t.state).to)).toBe(true)
    expect(t.state.doc.toString()).toBe("First.\n\nSecond.")
    expect(pictureCellsOf(t.state)).toEqual([])
  })

  it("at the end of the note: the blank line above it goes instead", () => {
    const t = target(`Words.\n\n${INK}`)
    const at = lineOf(t.state)
    expect(removeCellLine(t, at.from, at.to)).toBe(true)
    expect(t.state.doc.toString()).toBe("Words.")
  })

  it("is ONE undo event, and Undo puts the line back where it was", () => {
    const t = target("Words.\n\nMore.", 0)
    insertCellLine(t, INK, 8)
    const written = t.state.doc.toString()
    const depth = undoDepth(t.state)
    const at = lineOf(t.state)
    expect(removeCellLine(t, at.from, at.to)).toBe(true)
    expect(undoDepth(t.state)).toBe(depth + 1)
    undo({ state: t.state, dispatch: (tr) => { t.state = tr.state } })
    expect(t.state.doc.toString()).toBe(written)
  })

  it("is not turned into holding the cell, with the caret right beside it", () => {
    const text = `Words.\n\n${PICTURE}\n\nMore.`
    const t = target(text, text.indexOf(PICTURE) + PICTURE.length)
    const at = lineOf(t.state)
    expect(removeCellLine(t, at.from, at.to)).toBe(true)
    expect(t.state.doc.toString()).toBe("Words.\n\nMore.")
    expect(t.state.selection.main.empty).toBe(true)
  })

  it("refuses a range that is not whole lines, and leaves the note alone", () => {
    const text = `Words.\n\n${PICTURE}`
    const t = target(text)
    const at = lineOf(t.state)
    expect(removeCellLine(t, at.from + 1, at.to)).toBe(false)
    expect(removeCellLine(t, at.from, at.to + 5)).toBe(false)
    expect(t.state.doc.toString()).toBe(text)
  })
})
