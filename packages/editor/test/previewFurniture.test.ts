import { EditorState, type Extension } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { foldField } from "../src/fold"
import { notebookField } from "../src/notebook"
import { renderedField, setRendered } from "../src/rendered"
import { armedField } from "../src/seams"
import { previewField } from "../src/preview/field"
import { holdingField } from "../src/preview/hold"
import { awayField, putAway } from "../src/preview/away"
import { furniture, furnitureAt, reminderAt } from "../src/preview/furniture"

/**
 * The rendered page's open block edits what is written, not the markdown round it (Mac 0fdd031): the caret is kept
 * out of the furniture (`MarkerHiding.outside` / `CellFurniture`, transcribed in core `cellFurniture.test.ts`), as the
 * page's own transaction filter does it; a paste into a reminder is one line; Escape's "put away" closes the block.
 */
const extensions: Extension = [
  notebookField, renderedField, holdingField, foldField, armedField, awayField, furniture, previewField,
]
const page = (doc: string, rendered = true): EditorState =>
  EditorState.create({ doc, extensions }).update({ effects: setRendered.of(rendered) }).state
const caretAt = (state: EditorState, at: number): number =>
  state.update({ selection: { anchor: at } }).state.selection.main.head

describe("the caret on the rendered page stays out of the furniture", () => {
  it("is put after a heading's hashes, from anywhere inside them", () => {
    const state = page("## Section\n\nWords")
    for (const at of [0, 1, 2]) expect(caretAt(state, at)).toBe(3)
    expect(caretAt(state, 5)).toBe(5)
    expect(caretAt(state, 12)).toBe(12) // a paragraph has none
  })

  it("is put past ALL of a reminder's head, indent and all", () => {
    const state = page("    - [ ] nested")
    for (const at of [0, 3, 4, 5, 7, 9]) expect(caretAt(state, at)).toBe(10)
    expect(caretAt(state, 12)).toBe(12)
  })

  it("is put past a bullet and a number, but not out of a bullet's indent", () => {
    expect(caretAt(page("- one\n- two"), 6)).toBe(8)
    expect(caretAt(page("1. one\n2. two"), 1)).toBe(3)
    expect(caretAt(page("    - nested"), 2)).toBe(2) // the indent is not furniture; the dash is
    expect(caretAt(page("    - nested"), 4)).toBe(6)
  })

  it("leaves a real selection exactly as it was made", () => {
    const state = page("## Section").update({ selection: { anchor: 0, head: 6 } }).state
    expect([state.selection.main.anchor, state.selection.main.head]).toEqual([0, 6])
  })

  it("does nothing on the markdown side, where the markers ARE the text", () => {
    expect(caretAt(page("## Section", false), 0)).toBe(0)
    expect(furnitureAt(page("## Section", false), 0)).toEqual([])
  })

  it("does nothing in a code cell: code is code", () => {
    const state = page("```\n- x\n# y\n```")
    expect(caretAt(state, 4)).toBe(4)
    expect(caretAt(state, 8)).toBe(8)
    expect(reminderAt(page("```\n- [ ] x\n```"), 6)).toBeNull()
  })

  it("finds a reminder's words, box and line in the note's own offsets", () => {
    const state = page("Top\n\n- [x] done\n  - [ ] nested")
    const first = reminderAt(state, 7)!
    expect(state.sliceDoc(first.text.location, first.text.location + first.text.length)).toBe("done")
    expect(state.sliceDoc(first.box, first.box + 1)).toBe("x")
    expect(first.ticked).toBe(true)
    const second = reminderAt(state, 20)!
    expect(state.sliceDoc(second.text.location, second.text.location + second.text.length)).toBe("nested")
  })
})

describe("a paste into a reminder's words", () => {
  it("is one line: its newlines become spaces", () => {
    const state = page("- [ ] milk")
    const after = state.update({ selection: { anchor: 10 } }).state
      .update({ changes: { from: 10, insert: " eggs\nbread\r\n\r\nbutter" }, userEvent: "input.paste" }).state
    expect(after.doc.toString()).toBe("- [ ] milk eggs bread butter")
    expect(after.selection.main.head).toBe(after.doc.length)
  })

  it("is left alone anywhere else", () => {
    const state = page("Words").update({ selection: { anchor: 5 } }).state
    const after = state.update({ changes: { from: 5, insert: "\nmore" }, userEvent: "input.paste" }).state
    expect(after.doc.toString()).toBe("Words\nmore")
  })
})

describe("Escape puts the caret away", () => {
  it("draws the block it was in, and the next move brings it back", () => {
    const open = page("First\n\nSecond").update({ selection: { anchor: 3 } }).state
    expect(open.field(previewField).open.size).toBe(1)
    const away = open.update({ effects: putAway.of(true) }).state
    expect(away.field(awayField)).toBe(true)
    expect(away.field(previewField).open.size).toBe(0)
    const back = away.update({ selection: { anchor: 4 } }).state
    expect(back.field(awayField)).toBe(false)
    expect(back.field(previewField).open.size).toBe(1)
  })
})
