import { EditorSelection, EditorState, type Extension, type Transaction } from "@codemirror/state"
import { deleteCharBackward, deleteCharForward } from "@codemirror/commands"
import { EditorView, type Decoration } from "@codemirror/view"
import type { RangeSet } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { foldField } from "../src/fold"
import { notebookField } from "../src/notebook"
import { renderedField, setRendered } from "../src/rendered"
import { armedField } from "../src/seams"
import { BlockWidget, previewField } from "../src/preview/field"
import { holdingField, setHolding } from "../src/preview/hold"
import { deleteHeldCells } from "../src/keys"
import {
  inkCellPainter, pictureCells, pictureCellsField, picturesWhole, setInkAspects, type InkCellPainter,
} from "../src/pictureCells"

/**
 * Picture cells and ink cells at the state level (docs\PLAN-docking-ink-cells.md (c), (i) EDITOR): one block widget
 * per picture line in both panes, atomic, typing at an edge lands on its own line, Backspace / Delete beside one
 * holds it, the rendered page draws no BlockWidget of its own for it and never opens it, and an ink line is live
 * only when the drawing has its cell (first line of an id only).
 */

const extensions: Extension = [notebookField, foldField, renderedField, holdingField, armedField, previewField, pictureCells]
const ID = "0f8b2c1e-3a4d-4e5f-9a6b-7c8d9e0f1a2b"
const PIC = "![](.drawings/media/cafe0123cafe0123.png)"
const INK = `![ink](.drawings/media/ink-${ID}.svg)`

function make(doc: string, anchor = 0, more: Extension = []): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.cursor(anchor), extensions: [extensions, more] })
}
const rendered = (state: EditorState, on = true): EditorState => state.update({ effects: setRendered.of(on) }).state

interface Shown { from: number; to: number; block: boolean; path: string; ink: string | null; live: boolean; aspect: number; held: boolean; touching: boolean }
function widgets(state: EditorState): Shown[] {
  const out: Shown[] = []
  const set = state.field(pictureCellsField)
  for (const cursor = set.iter(); cursor.value; cursor.next()) {
    const spec = cursor.value.spec as { block?: boolean; widget?: { spec: Omit<Shown, "from" | "to" | "block"> } }
    out.push({ from: cursor.from, to: cursor.to, block: spec.block === true, ...spec.widget!.spec })
  }
  return out
}

/** A stand-in for the view: commands and atomic ranges only ask for `state` and `dispatch`. */
function fake(state: EditorState): { view: EditorView; now(): EditorState; last(): Transaction | null } {
  let current = state
  let last: Transaction | null = null
  const view = {
    get state() { return current },
    dispatch(spec: Transaction | Parameters<EditorState["update"]>[0]) {
      const tr = "startState" in (spec as object) ? spec as Transaction : current.update(spec as Parameters<EditorState["update"]>[0])
      last = tr
      current = tr.state
    },
    focus() {},
  } as unknown as EditorView
  return { view, now: () => current, last: () => last }
}

describe("picture cells: the widgets", () => {
  it("one block widget per picture line, on the markdown side and on the rendered page", () => {
    const doc = `# Title\n\n${PIC}\n\nwords ![](a.png) more\n\n- ![](b.png)\n\n${INK}\n`
    for (const on of [false, true]) {
      const state = rendered(make(doc), on)
      const shown = widgets(state)
      expect(shown.map((w) => [w.from, w.to]), on ? "rendered" : "markdown").toEqual([
        [doc.indexOf(PIC), doc.indexOf(PIC) + PIC.length],
        [doc.indexOf(INK), doc.indexOf(INK) + INK.length],
      ])
      expect(shown.every((w) => w.block)).toBe(true)
      expect(shown[1]!.ink).toBe(ID)
    }
  })

  it("the lines are atomic ranges (the caret is before or after, never in)", () => {
    const doc = `Words\n\n${PIC}\n\nMore`
    const state = make(doc)
    const from = doc.indexOf(PIC)
    const sets = state.facet(EditorView.atomicRanges).map((f) => f({ state } as EditorView))
    const covered = sets.some((set) => {
      for (const cursor = (set as RangeSet<Decoration>).iter(); cursor.value; cursor.next()) {
        if (cursor.from === from && cursor.to === from + PIC.length) return true
      }
      return false
    })
    expect(covered).toBe(true)
  })

  it("the rendered page draws no BlockWidget of its own over a picture cell, and never opens it", () => {
    const doc = `Words above\n${PIC}\nWords below`
    const from = doc.indexOf(PIC)
    for (const caret of [from, from + PIC.length]) {
      const state = rendered(make(doc, caret))
      const preview = state.field(previewField)
      for (const cursor = preview.decorations.iter(); cursor.value; cursor.next()) {
        const widget = (cursor.value.spec as { widget?: unknown }).widget
        if (widget instanceof BlockWidget) expect(widget.block.kind).not.toBe("picture")
      }
      const index = state.field(notebookField).cells.findIndex((c) => c.range.location === from)
      expect(index).toBeGreaterThan(0)
      expect(preview.open.get(index), "a picture cell never opens").not.toBe("open")
    }
  })

  it("touching the cell above is the page's gap on the rendered page only", () => {
    const doc = `Words\n${PIC}`
    expect(widgets(rendered(make(doc)))[0]!.touching).toBe(true)
    expect(widgets(make(doc))[0]!.touching).toBe(false)
    expect(widgets(rendered(make(`Words\n\n${PIC}`)))[0]!.touching).toBe(false)
  })

  it("an ink line is live only when the drawing has its cell, and only its first line", () => {
    const doc = `${INK}\n\nWords\n\n${INK}`
    const plain = widgets(make(doc))
    expect(plain.map((w) => w.live), "no cell in the drawing: read-only").toEqual([false, false])
    const told = make(doc).update({ effects: setInkAspects.of(new Map([[ID, 0.3]])) }).state
    expect(widgets(told).map((w) => [w.live, w.aspect])).toEqual([[true, 0.3], [false, 0]])
    const painter: InkCellPainter = { aspect: (id) => (id === ID ? 0.25 : null), minAspect: () => 0.1, paint() {}, resized() {} }
    const painted = widgets(make(doc, 0, inkCellPainter.of(painter)))
    expect(painted.map((w) => [w.live, w.aspect]), "the painter's aspect when the field has none").toEqual([[true, 0.25], [false, 0]])
  })

  it("a held picture cell says so (holding, or a selection reaching past it)", () => {
    const doc = `A\n\n${PIC}\n\nB`
    const from = doc.indexOf(PIC)
    const to = from + PIC.length
    const state = make(doc)
    const exact = state.update({ selection: EditorSelection.range(from, to) }).state
    expect(widgets(exact)[0]!.held, "the exact range, not holding: not lit").toBe(false)
    const held = state.update({ selection: EditorSelection.range(from, to), effects: setHolding.of(true) }).state
    expect(widgets(held)[0]!.held).toBe(true)
    const beyond = state.update({ selection: EditorSelection.range(0, doc.length) }).state
    expect(widgets(beyond)[0]!.held).toBe(true)
  })
})

describe("picture cells: typing and deleting beside one", () => {
  const doc = `Words above\n${PIC}\nWords below`
  const from = doc.indexOf(PIC)
  const to = from + PIC.length

  it("text typed at a picture line's start goes on a line of its own above it", () => {
    const state = make(doc, from)
    const next = state.update({ changes: { from, insert: "x" }, selection: EditorSelection.cursor(from + 1), userEvent: "input.type" }).state
    expect(next.doc.toString()).toBe(`Words above\nx\n\n${PIC}\nWords below`)
    expect(next.selection.main.head, "the caret stays after what was typed").toBe(from + 1)
    expect(picturesWhole(next)).toBe(true)
  })

  it("text typed at its end goes on a line of its own below it", () => {
    const state = make(doc, to)
    const next = state.update({ changes: { from: to, insert: "y" }, selection: EditorSelection.cursor(to + 1), userEvent: "input.type" }).state
    expect(next.doc.toString()).toBe(`Words above\n${PIC}\n\ny\nWords below`)
    expect(next.selection.main.head).toBe(to + 3)
    expect(picturesWhole(next)).toBe(true)
  })

  it("a paste of several lines at its start is kept off its line too; Return there is left alone", () => {
    const pasted = make(doc, from).update({ changes: { from, insert: "one\ntwo" }, userEvent: "input.paste" }).state
    expect(pasted.doc.toString()).toBe(`Words above\none\ntwo\n\n${PIC}\nWords below`)
    const returned = make(doc, from).update({ changes: { from, insert: "\n" }, userEvent: "input" }).state
    expect(returned.doc.toString(), "a newline before it keeps it whole").toBe(`Words above\n\n${PIC}\nWords below`)
  })

  it("an edit that is not typing (the app, undo, a dock) is never touched", () => {
    const next = make(doc).update({ changes: { from, insert: "z" } }).state
    expect(next.doc.toString()).toBe(`Words above\nz${PIC}\nWords below`)
  })

  it("Backspace at its start, joining it to the words above, holds it instead", () => {
    const { view, now } = fake(make(doc, from))
    deleteCharBackward(view)
    expect(now().doc.toString()).toBe(doc)
    expect([now().selection.main.from, now().selection.main.to]).toEqual([from, to])
    expect(now().field(holdingField)).toBe(true)
    expect(widgets(now())[0]!.held).toBe(true)
    // …and the next Backspace takes it, through the held-cell delete.
    deleteHeldCells(view)
    expect(now().doc.toString()).not.toContain(PIC)
    expect(now().doc.toString()).toContain("Words above")
    expect(now().doc.toString()).toContain("Words below")
  })

  it("Backspace at its end (which would take the atomic line) holds it", () => {
    const { view, now } = fake(make(doc, to))
    deleteCharBackward(view)
    expect(now().doc.toString()).toBe(doc)
    expect(now().field(holdingField)).toBe(true)
  })

  it("Delete at its start, and at its end over the words below, hold it", () => {
    for (const at of [from, to]) {
      const { view, now } = fake(make(doc, at))
      deleteCharForward(view)
      expect(now().doc.toString()).toBe(doc)
      expect(now().field(holdingField)).toBe(true)
    }
  })

  it("Backspace at the start of the words under it holds it rather than joining them on", () => {
    const { view, now } = fake(make(doc, to + 1))
    deleteCharBackward(view)
    expect(now().doc.toString()).toBe(doc)
    expect([now().selection.main.from, now().selection.main.to]).toEqual([from, to])
  })

  it("Backspace that only takes a blank line above it is an ordinary Backspace", () => {
    const spaced = `Words above\n\n${PIC}`
    const at = spaced.indexOf(PIC)
    const { view, now } = fake(make(spaced, at))
    deleteCharBackward(view)
    expect(now().doc.toString()).toBe(`Words above\n${PIC}`)
    expect(now().field(holdingField)).toBe(false)
  })
})
