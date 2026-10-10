import { EditorSelection, EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { holdGuard, holdingField, setHolding } from "../src/preview/hold"

/**
 * Held cells survive a layout change (docs/PLAN-bars-2026-10.md P7 (c)): on the rendered page CodeMirror reads the browser's
 * selection back when the window is laid out again (the video pane opening, the sidebar toggling) and finds a caret where a
 * held block was; a selection nobody asked for is not taken while cells are held. (The view's half — the real toolbar
 * clicks — is held by e2e cells/12.)
 */
const held = (): EditorState => {
  const state = EditorState.create({
    doc: "One\n\nTwo words\n\nThree", extensions: [holdingField, holdGuard], selection: EditorSelection.single(5, 14),
  })
  return state.update({ effects: setHolding.of(true) }).state
}

describe("the hold guard", () => {
  it("turns away the read-back that collapses held cells to a caret", () => {
    const state = held()
    const next = state.update({ selection: EditorSelection.cursor(14), userEvent: "select" }).state
    expect(next.selection.main.from).toBe(5)
    expect(next.selection.main.to).toBe(14)
    expect(next.field(holdingField)).toBe(true)
  })

  it("takes a pointer selection (a click on the text lets go of them)", () => {
    const next = held().update({ selection: EditorSelection.cursor(2), userEvent: "select.pointer" }).state
    expect(next.selection.main.empty).toBe(true)
    expect(next.field(holdingField)).toBe(false)
  })

  it("takes a selection that is not a collapse (shift-arrows widening the hold)", () => {
    const next = held().update({ selection: EditorSelection.single(5, 20), userEvent: "select" }).state
    expect(next.selection.main.to).toBe(20)
  })

  it("takes an edit, and anything when nothing is held", () => {
    const edited = held().update({ changes: { from: 0, insert: "x" } }).state
    expect(edited.field(holdingField)).toBe(false)
    const plain = EditorState.create({ doc: "One\n\nTwo", extensions: [holdingField, holdGuard], selection: EditorSelection.single(1, 3) })
    expect(plain.update({ selection: EditorSelection.cursor(3), userEvent: "select" }).state.selection.main.empty).toBe(true)
  })
})
