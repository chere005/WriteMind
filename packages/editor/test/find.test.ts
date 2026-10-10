import { EditorSelection, EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { findCount, findField, find, setFind } from "../src/find"
import { setRendered, rendered } from "../src/rendered"
import { notebookField } from "../src/notebook"

/**
 * Find over what the page shows (docs/PLAN-bars-2026-10.md P7 (e)): the state's matches skip the marker line, find the
 * star a text cell shows, and on the rendered page leave a link's address out. (The view's half — the marks, the walk, the
 * replace buttons — is held by e2e cells/14-find.)
 */
const make = (doc: string): EditorState => EditorState.create({
  doc, selection: EditorSelection.single(0), extensions: [notebookField, rendered, find],
})
const lookFor = (state: EditorState, query: string, more = {}) =>
  state.update({ effects: setFind.of({ query, caseSensitive: false, wholeWord: false, ...more }) }).state
const matches = (state: EditorState) => state.field(findField).matches.map((m) => state.sliceDoc(m.location, m.location + m.length))

describe("the matches in a state", () => {
  it("do not include a markdown cell's hidden marker line", () => {
    const state = lookFor(make("One\n\n<!-- markdown -->\nmarkdown words"), "markdown")
    expect(matches(state)).toEqual(["markdown"])
  })

  it("include the star a text cell shows, spelled with its backslash in the file", () => {
    const state = lookFor(make("star a\\*b done"), "a*b")
    expect(matches(state)).toEqual(["a\\*b"])
    expect(findCount(state)).toEqual({ total: 1, index: 0 })
  })

  it("keep the same matches through a caret move, and find them again through an edit", () => {
    let state = lookFor(make("alpha beta alpha"), "alpha")
    const before = state.field(findField).matches
    state = state.update({ selection: EditorSelection.single(6) }).state
    expect(state.field(findField).matches).toBe(before)
    state = state.update({ changes: { from: 5, insert: " alpha" } }).state
    expect(matches(state).length).toBe(3)
  })

  it("on the rendered page leave a link's address out, and take it back on the markdown side", () => {
    const text = "[Alpha link](https://example.com/alpha)"
    let state = lookFor(make(text), "alpha")
    expect(matches(state).length).toBe(2)
    state = state.update({ effects: setRendered.of(true) }).state
    expect(matches(state).length).toBe(1)
    state = state.update({ effects: setRendered.of(false) }).state
    expect(matches(state).length).toBe(2)
  })

  it("read the words as typed: no regular expression", () => {
    const state = lookFor(make("abc a.c"), "a.c")
    expect(matches(state)).toEqual(["a.c"])
  })
})
