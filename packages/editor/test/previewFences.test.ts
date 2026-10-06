import { EditorSelection, EditorState, Text, type Extension } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { foldField } from "../src/fold"
import { notebook, notebookField } from "../src/notebook"
import { renderedField, setRendered } from "../src/rendered"
import { armedField } from "../src/seams"
import {
  contentEnd, contentLineFor, fenceAt, fenceLines, fencePointer, isFenceText, landingOffFence, offFence, onFence,
} from "../src/preview/fences"

/**
 * The rendered page never stands the caret on a fence's ``` line (Sean, 2026-10-05: "in rendered mode pressing up or
 * down shouldn't select the backticks of a code cell"): which lines of a fenced cell are fences, the content line
 * nearest each, the line an empty cell is given, and a click on a fence. The arrows' half (Up / Down through a note
 * with code, an In/Out pair, ```wl maths and an empty cell, every step off the fences) is the end-to-end script
 * e2e/suites/cells/05-rendered-fence-arrows.mjs.
 */

const text = (s: string): Text => Text.of(s.split("\n"))
const whole = (s: string) => ({ location: 0, length: s.length })

describe("fenceLines: which lines of a fenced cell are fences", () => {
  it("a closed cell: the opening fence, the closing fence, and the lines between", () => {
    const s = "```python\nx = 1\ny = 2\n```"
    expect(fenceLines(text(s), whole(s))).toEqual({ open: 1, close: 4, first: 2, last: 3 })
  })

  it("a cell with one line of content, and the fence lines counted in the note's numbering", () => {
    const s = "Words\n\n```out\n2\n```"
    expect(fenceLines(text(s), { location: 7, length: s.length - 7 })).toEqual({ open: 3, close: 5, first: 4, last: 4 })
  })

  it("an empty cell has no content line", () => {
    const s = "```\n```"
    expect(fenceLines(text(s), whole(s))).toEqual({ open: 1, close: 2, first: null, last: null })
  })

  it("a cell with an empty content line has it", () => {
    const s = "```\n\n```"
    expect(fenceLines(text(s), whole(s))).toEqual({ open: 1, close: 3, first: 2, last: 2 })
  })

  it("a fence never closed runs to the end of the cell; alone, it has no content", () => {
    expect(fenceLines(text("```js\nlet a"), whole("```js\nlet a"))).toEqual({ open: 1, close: null, first: 2, last: 2 })
    expect(fenceLines(text("```wl"), whole("```wl"))).toEqual({ open: 1, close: null, first: null, last: null })
  })

  it("an indented fence counts (the Mac's rule); a line that is not a fence is no fenced cell", () => {
    expect(isFenceText("  ```wl")).toBe(true)
    expect(isFenceText("a ```")).toBe(false)
    expect(fenceLines(text("Just words"), whole("Just words"))).toBeNull()
  })

  it("onFence says which line numbers are fences", () => {
    const lines = { open: 3, close: 6, first: 4, last: 5 }
    expect([2, 3, 4, 5, 6, 7].map((n) => onFence(lines, n))).toEqual([false, true, false, false, true, false])
  })
})

describe("offFence: the content line nearest a fence", () => {
  const s = "```python\nx = 1\ny = 22\n```"
  const doc = text(s)
  const lines = fenceLines(doc, whole(s))!

  it("from the opening fence, the start of the first content line; from the closing one, the end of the last", () => {
    for (const at of [0, 4, 9]) expect(offFence(doc, lines, at)).toBe(s.indexOf("x = 1"))
    for (const at of [s.lastIndexOf("```"), s.length]) expect(offFence(doc, lines, at)).toBe(s.indexOf("y = 22") + 6)
  })

  it("a caret on a content line stays where it is", () => {
    expect(offFence(doc, lines, s.indexOf("= 1"))).toBe(s.indexOf("= 1"))
  })

  it("the content edges: the start of the first line, the end of the last", () => {
    expect(contentEnd(doc, lines, true)).toBe(s.indexOf("x = 1"))
    expect(contentEnd(doc, lines, false)).toBe(s.indexOf("y = 22") + 6)
  })

  it("an empty cell has nowhere to go, and is given an empty line under its opening fence", () => {
    const e = "```c\n```"
    const empty = fenceLines(text(e), whole(e))!
    expect(offFence(text(e), empty, 0)).toBeNull()
    expect(contentLineFor(text(e), empty)).toEqual({ from: 4, insert: "\n", caret: 5 })
  })
})

const extensions: Extension = [notebookField, renderedField, foldField, armedField, fencePointer]
const page = (doc: string, rendered = true): EditorState =>
  EditorState.create({ doc, extensions }).update({ effects: setRendered.of(rendered) }).state

const NOTE = [
  "Intro words", "",
  "```python", "print(1)", "```", "",
  "```eval wl", "1+1", "```", "",
  "```out", "2", "```", "",
  "```wl", "x^2 + 1", "```", "",
  "```", "```", "",
  "Last words",
].join("\n")
const at = (s: string, from = 0): number => NOTE.indexOf(s, from)

describe("fenceAt: the fenced cell a position is in, by the note's cells", () => {
  const state = page(NOTE)

  it("finds code, an evaluation cell, its Out cell, ```wl maths and an empty fence", () => {
    for (const [fence, first] of [["```python", 4], ["```eval wl", 8], ["```out", 12], ["```wl", 16]] as const) {
      const found = fenceAt(state, at(fence))
      expect(found?.lines.open).toBe(state.doc.lineAt(at(fence)).number)
      expect(found?.lines.first).toBe(first)
    }
    const empty = fenceAt(state, at("```\n```"))
    expect(empty?.lines).toEqual({ open: 19, close: 20, first: null, last: null })
  })

  it("is null in words and on the blank lines between cells", () => {
    expect(fenceAt(state, 3)).toBeNull()
    expect(fenceAt(state, at("Last words"))).toBeNull()
    expect(fenceAt(state, at("```python") - 1)).toBeNull()
  })

  it("every code cell of the parser is a fenced cell here", () => {
    const code = notebook(state).cells.filter((c) => c.block.kind === "code")
    expect(code.length).toBe(5)
    for (const c of code) expect(fenceAt(state, c.range.location)).not.toBeNull()
  })

  it("landingOffFence: on a fence, the content beside it, or the line to make; elsewhere null", () => {
    expect(landingOffFence(state, at("```out"))).toEqual({ at: at("2\n```") })
    expect(landingOffFence(state, at("```\n\n```wl"))).toEqual({ at: at("2\n```") + 1 })
    expect(landingOffFence(state, at("x^2"))).toBeNull()
    expect(landingOffFence(state, at("```\n```"))).toEqual({ make: { from: at("```\n```") + 3, insert: "\n", caret: at("```\n```") + 4 } })
  })
})

describe("a click on a fence line of the rendered page", () => {
  const click = (state: EditorState, anchor: number, head = anchor, userEvent = "select.pointer") =>
    state.update({ selection: EditorSelection.single(anchor, head), userEvent }).state

  it("lands on the content line beside the fence: the first after the opening, the last before the closing", () => {
    const state = page(NOTE)
    expect(click(state, at("```python") + 2).selection.main.head).toBe(at("print(1)"))
    expect(click(state, at("```\n\n```eval")).selection.main.head).toBe(at("print(1)") + "print(1)".length)
  })

  it("in an empty fenced cell, makes its content line and lands on it", () => {
    const state = click(page(NOTE), at("```\n```") + 5)
    expect(state.doc.toString()).toBe(NOTE.replace("```\n```", "```\n\n```"))
    expect(state.selection.main.head).toBe(at("```\n```") + 4)
    expect(state.doc.lineAt(state.selection.main.head).text).toBe("")
  })

  it("leaves a drag, a caret put there by anything but the pointer, and the markdown side as they were", () => {
    const state = page(NOTE)
    const drag = click(state, at("Intro"), at("```python") + 3)
    expect([drag.selection.main.anchor, drag.selection.main.head]).toEqual([at("Intro"), at("```python") + 3])
    expect(click(state, at("```python"), at("```python"), "select").selection.main.head).toBe(at("```python"))
    expect(click(page(NOTE, false), at("```python")).selection.main.head).toBe(at("```python"))
  })

  it("leaves a click on the content and on words alone", () => {
    const state = page(NOTE)
    expect(click(state, at("1+1") + 1).selection.main.head).toBe(at("1+1") + 1)
    expect(click(state, at("Last words") + 2).selection.main.head).toBe(at("Last words") + 2)
  })
})
