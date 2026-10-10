import { EditorSelection, EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { itemOpened, itemOpenedField, notebookField } from "../src/notebook"
import { armedField } from "../src/seams"
import { textCells } from "../src/textCells"

/**
 * An item a command opened (docs/PLAN-bars-2026-10.md (a), found 2026-10-10): the + menu's Dots List, the Style menu and
 * Ctrl+Shift+L at a bar write the marker alone (`- `, `* `, `1. `). The parser reads that as a paragraph, a text cell,
 * and what is typed in a text cell is literal, so the first word came out as `\- word`. The command says which line it
 * opened, and the next thing typed at its end is the list's.
 */
const make = (doc: string, at: number): EditorState => EditorState.create({
  doc, selection: EditorSelection.single(at), extensions: [notebookField, itemOpenedField, armedField, textCells],
})
const open = (state: EditorState, line: number): EditorState => state.update({ effects: itemOpened.of(line) }).state
const type = (state: EditorState, from: number, insert: string): EditorState =>
  state.update({ changes: { from, insert }, selection: EditorSelection.cursor(from + insert.length), userEvent: "input.type" }).state

describe("an item a command opened", () => {
  for (const [marker, name] of [["- ", "dots"], ["* ", "dashes"], ["1. ", "numbered"]] as const) {
    it(`takes the first word typed after its ${name} marker as the list's, not as literal text`, () => {
      const start = `One\n\n${marker}\n\nTwo`
      const at = 5 + marker.length
      let state = open(make(start, at), 5)
      expect(state.field(itemOpenedField)).toBe(5)
      state = type(state, at, "word")
      expect(state.doc.toString()).toBe(`One\n\n${marker}word\n\nTwo`)
    })
  }

  it("a marker TYPED by hand is still literal text (nothing opened it)", () => {
    const state = type(make("One\n\n- \n\nTwo", 7), 7, "word")
    expect(state.doc.toString()).toBe("One\n\n\\- word\n\nTwo")
  })

  it("is let go by an edit, so the second keystroke is an ordinary one", () => {
    let state = open(make("One\n\n- \n\nTwo", 7), 5)
    state = type(state, 7, "a")
    expect(state.field(itemOpenedField)).toBeNull()
  })

  it("is let go when the caret leaves the line, and a later `- ` there is literal again", () => {
    let state = open(make("One\n\n- \n\nTwo", 7), 5)
    state = state.update({ selection: EditorSelection.cursor(1) }).state
    expect(state.field(itemOpenedField)).toBeNull()
    state = state.update({ selection: EditorSelection.cursor(7) }).state
    state = type(state, 7, "word")
    expect(state.doc.toString()).toBe("One\n\n\\- word\n\nTwo")
  })
})
