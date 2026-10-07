import { EditorState, type Extension } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { shownMarks } from "../src/decorations"
import { foldField } from "../src/fold"
import { notebookField } from "../src/notebook"
import { renderedField, setRendered } from "../src/rendered"
import { armedField } from "../src/seams"
import { previewField } from "../src/preview/field"
import { holdingField } from "../src/preview/hold"
import { awayField } from "../src/preview/away"
import { furniture } from "../src/preview/furniture"

/**
 * A code span's backticks are never shown on the rendered page, not even on the line being edited, so a selection
 * there never takes them (Sean, 2026-10-06: "backticks should not be highlightable in rendered view"). The other marks
 * (`**`) still show on that line, to be edited; in the markdown all of them do.
 */
const extensions: Extension = [
  notebookField, renderedField, holdingField, foldField, armedField, awayField, furniture, previewField,
]
const page = (doc: string, rendered: boolean, at: number): EditorState =>
  EditorState.create({ doc, extensions }).update({ effects: setRendered.of(rendered), selection: { anchor: at } }).state
const text = (state: EditorState, marks: { location: number; length: number }[]) =>
  marks.map((m) => state.doc.sliceString(m.location, m.location + m.length))

describe("backticks on the rendered page", () => {
  const doc = "Say `code` and **bold** here."
  it("stay put away on the line the caret is in, where ** shows", () => {
    const state = page(doc, true, 20)
    expect(text(state, shownMarks(state, 0, doc.length))).toEqual(["**", "**"])
  })
  it("and a selection across the span shows no backtick either", () => {
    const state = EditorState.create({ doc, extensions })
      .update({ effects: setRendered.of(true), selection: { anchor: 0, head: doc.length } }).state
    expect(text(state, shownMarks(state, 0, doc.length))).not.toContain("`")
  })
  it("show in the markdown, as every mark does", () => {
    const state = page(doc, false, 6)
    expect(text(state, shownMarks(state, 0, doc.length))).toEqual(["`", "`", "**", "**"])
  })
})
