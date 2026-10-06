import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { describe, expect, it } from "vitest"
import { APART_GAP, apartCells, gapAt } from "../src/apart"
import { showsSource, typesetBlocks } from "../src/math"
import { notebookField } from "../src/notebook"
import { armedField, armSeam } from "../src/seams"

/**
 * Port-only (Sean, 2026-10-05). (1) "this math cell should be placed as its own cell, not connected to the cell before
 * it": a ```wl block straight under an answer's closing fence draws the gap a blank line would have made, and is
 * measured below it (apart.ts). (2) "when i put the cursor in between, it shouldn't unrender the math until i'm
 * actually in that cell": while a bar is the cursor, the caret parked against the cell below it opens nothing.
 */
const F = "```"
const SEAN = `Some words\n\n${F}eval wl\n2+2\n${F}\n\n${F}out\n4\n${F}\n${F}wl\nIntegrate[x^2, {x, 0, 1}]\n${F}\n\nAfter`
const MATHS = SEAN.indexOf(`${F}wl`)

const make = (doc: string, caret = 0) =>
  EditorState.create({ doc, selection: { anchor: caret }, extensions: [notebookField, armedField] })

describe("a block straight under a cell it stands apart from", () => {
  it("draws a blank line's gap above it, and only there", () => {
    const state = make(SEAN)
    expect(gapAt(state, MATHS)).toBe(APART_GAP)
    expect(gapAt(state, SEAN.indexOf(`${F}out`)), "a blank line holds the answer off already").toBe(0)
    expect(gapAt(state, 0)).toBe(0)
    expect(gapAt(state, MATHS + 1), "no cell starts there").toBe(0)
    expect(gapAt(make("Intro\n- a"), 6), "words and a list touching are one thing to type in").toBe(0)
    expect(gapAt(make("# Title\nwords"), 8)).toBe(APART_GAP)
  })

  it("the gap is a block of air in front of the cell, whatever draws the cell", () => {
    const state = EditorState.create({ doc: SEAN, extensions: [notebookField, armedField, apartCells] })
    const found: number[] = []
    for (const set of state.facet(EditorView.decorations)) {
      if (typeof set === "function") continue
      for (const cursor = set.iter(); cursor.value; cursor.next()) {
        if (cursor.value.spec.block && cursor.from === cursor.to) found.push(cursor.from)
      }
    }
    expect(found).toEqual([MATHS])
    const edited = state.update({ changes: { from: MATHS, insert: "\n" } }).state
    let left = 0
    for (const set of edited.facet(EditorView.decorations)) {
      if (typeof set === "function") continue
      for (const cursor = set.iter(); cursor.value; cursor.next()) left++
    }
    expect(left, "a blank line between them now: no air needed").toBe(0)
  })
})

describe("a bar that is the cursor opens no cell", () => {
  it("the maths below a bar armed by hand at its start stays typeset", () => {
    const parked = make(SEAN, MATHS)
    expect(typesetBlocks(parked), "a real caret at the start of the block opens it").toEqual([])
    const armed = parked.update({ selection: { anchor: MATHS }, effects: armSeam.of(MATHS) }).state
    expect(armed.field(armedField)).toBe(MATHS)
    expect(typesetBlocks(armed).map((b) => b.from)).toEqual([MATHS])
    expect(showsSource(armed, MATHS, MATHS + 10)).toBe(false)
  })

  it("and opens when the bar goes and the caret is really in it", () => {
    const armed = make(SEAN, MATHS).update({ selection: { anchor: MATHS }, effects: armSeam.of(MATHS) }).state
    const inside = armed.update({ selection: { anchor: MATHS + 6 } }).state
    expect(inside.field(armedField)).toBeNull()
    expect(typesetBlocks(inside)).toEqual([])
    const escaped = armed.update({ effects: armSeam.of(null) }).state
    expect(typesetBlocks(escaped), "Escape leaves a real caret at its start").toEqual([])
  })

  it("a selection that covers the maths still keeps it typeset, bar or none", () => {
    const state = make(SEAN).update({ selection: { anchor: 0, head: SEAN.length } }).state
    expect(typesetBlocks(state)).toHaveLength(1)
  })
})
