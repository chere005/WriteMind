import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, undo, undoDepth } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { MARKDOWN_MARKER, arm, blocks } from "@writemind/core"
import { notebookField } from "../src/notebook"
import { armedField } from "../src/seams"
import { find, replaceEvery, replaceMatch, setFind } from "../src/find"
import { caretInEmptyCell, dropEmptyCell, emptyCellAt, textCells } from "../src/textCells"
import { mergeTheCell } from "../src/keys"

/**
 * The text-cell leftovers (docs/TODO.md "Text cells, what is left"; port-first): Find / Replace writes into a text cell
 * by the escape rule and into a markdown cell raw; a markdown cell emptied of its words keeps the caret (no bar comes
 * up) and goes, marker and blank lines, when the caret leaves it, joined to the edit that emptied it in the history.
 * The view's half (the leaving itself, real keys and clicks, ONE Ctrl+Z) is e2e/suites/cells/06-text-cell-leftovers.mjs.
 */

const M = MARKDOWN_MARKER
const make = (doc: string, at = 0, head = at): EditorState => EditorState.create({
  doc, selection: EditorSelection.single(at, head), extensions: [notebookField, armedField, history(), textCells, find],
})

/** Enough of an EditorView for the commands: the state, and a dispatch that applies. */
function fakeView(state: EditorState): EditorView {
  const box = {
    state,
    dispatch(spec: TransactionSpec | Transaction) {
      box.state = spec instanceof Transaction ? spec.state : box.state.update(spec).state
    },
  }
  return box as unknown as EditorView
}

describe("Find / Replace into a text cell writes the replacement by the escape rule", () => {
  const replaced = (doc: string, query: string, replacement: string, all = false): string => {
    const view = fakeView(make(doc).update({ effects: setFind.of({ query, caseSensitive: false, wholeWord: false }) }).state)
    if (all) replaceEvery(view, replacement)
    else {
      const at = doc.indexOf(query)
      view.dispatch({ selection: EditorSelection.single(at, at + query.length) })
      replaceMatch(view, replacement)
    }
    return view.state.doc.toString()
  }

  it("a ** replaced into a text cell stays literal: the cell stays a text cell, its words as typed", () => {
    const after = replaced("say bar now", "bar", "**x**")
    expect(blocks(after)).toEqual([{ kind: "paragraph", text: "say **x** now" }])
    expect(after).toContain("\\*")
  })

  it("Replace All too, in every text cell it reaches; a line-start mark is escaped", () => {
    const after = replaced("bar one\n\ntwo bar", "bar", "# b*", true)
    expect(blocks(after)).toEqual([
      { kind: "paragraph", text: "# b* one" }, { kind: "paragraph", text: "two # b*" },
    ])
  })

  it("into a markdown cell the replacement is written raw (it is markdown there)", () => {
    expect(replaced(`${M}\nsay bar now`, "bar", "**x**")).toBe(`${M}\nsay **x** now`)
  })
})

describe("a markdown cell emptied of its words", () => {
  const cell = `before\n\n${M}\nhello\n\nafter`
  const marker = cell.indexOf(M)
  const words = marker + M.length + 1
  const empty = (): EditorState => make(cell, words + 5)
    .update({ changes: { from: words, to: words + 5 }, selection: EditorSelection.cursor(words), userEvent: "delete.backward" }).state

  it("keeps the caret in it: its words line is no seam, so no bar comes up and typing goes back into it", () => {
    const state = empty()
    expect(state.doc.toString()).toBe(`before\n\n${M}\n\n\nafter`)
    expect(state.field(armedField)).toBeNull()
    expect(caretInEmptyCell(state)).toBe(marker)
    expect(emptyCellAt(state, marker)).toBe(marker)
    // The core's own reading of the bar agrees.
    expect(arm({ location: words, length: 0 }, state.doc.toString(), null)).toBeNull()
    // The blank line under its words line is still the bar to the cell below.
    expect(arm({ location: words + 1, length: 0 }, state.doc.toString(), null)).toBe(state.doc.toString().indexOf("after"))
    const typed = state.update({ changes: { from: words, insert: "x" }, selection: EditorSelection.cursor(words + 1), userEvent: "input.type" }).state
    expect(typed.doc.toString()).toBe(`before\n\n${M}\nx\n\nafter`)
  })

  it("goes when the caret leaves it, marker and blank lines, one blank line left between the cells round it", () => {
    const left = empty().update({ selection: EditorSelection.cursor(2), userEvent: "select" }).state
    expect(caretInEmptyCell(left)).toBeNull()
    const gone = left.update(dropEmptyCell(left, marker)!).state
    expect(gone.doc.toString()).toBe("before\n\nafter")
    expect(gone.selection.main.head).toBe(2)
  })

  it("ONE undo brings the words and the marker back: the leaving is kept out of the history and the going joins the emptying", () => {
    const emptied = empty()
    const depth = undoDepth(emptied)
    const left = emptied.update({ selection: EditorSelection.cursor(2), userEvent: "select" }).state
    const gone = left.update(dropEmptyCell(left, marker)!).state
    expect(undoDepth(gone)).toBe(depth)
    const view = fakeView(gone)
    undo(view)
    expect(view.state.doc.toString()).toBe(cell)
    expect(view.state.selection.main.head).toBe(words + 5)
  })

  it("a caret that went to the bar above or below it stands on the bar between the cells round it", () => {
    // Up from the words: the bar above (its caret on the blank line over the marker).
    const up = empty().update({ selection: EditorSelection.cursor(marker - 1), userEvent: "select" }).state
    expect(up.field(armedField)).toBe(marker)
    const gone = up.update(dropEmptyCell(up, marker)!).state
    expect(gone.doc.toString()).toBe("before\n\nafter")
    expect(gone.selection.main.head).toBe("before\n".length)
    expect(gone.field(armedField)).toBe("before\n\n".length)
  })

  it("Merge Cells (Ctrl+M) in it does nothing: never the note's last two cells, far away", () => {
    const doc = `A

${M}


B

C

${M}
**D**`
    const at = doc.indexOf(M) + M.length + 1
    const view = fakeView(make(doc, at))
    ;(view as unknown as { focus(): void }).focus = () => {}
    expect(caretInEmptyCell(view.state)).toBe(doc.indexOf(M))
    expect(mergeTheCell(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it("at an end of the note it takes its blank lines with it; elsewhere than an empty cell it does nothing", () => {
    const end = make(`words\n\n${M}\n`, `words\n\n${M}\n`.length)
    expect(caretInEmptyCell(end)).toBe(7)
    expect(end.update(dropEmptyCell(end, 7)!).state.doc.toString()).toBe("words")
    const top = make(`${M}\n\n\nwords`, M.length + 1)
    expect(top.update(dropEmptyCell(top, 0)!).state.doc.toString()).toBe("words")
    expect(dropEmptyCell(make(cell), marker)).toBeNull()
    expect(caretInEmptyCell(make(cell, words))).toBeNull()
  })
})
