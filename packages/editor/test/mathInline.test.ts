import { ChangeSet, EditorState } from "@codemirror/state"
import type { DecorationSet } from "@codemirror/view"
import { describe, expect, it } from "vitest"
import { windowHoldsPage } from "../src/decorations"
import { inlineDecorations, linesOfRanges } from "../src/math"
import { notebookField } from "../src/notebook"

/**
 * Two crashes of a CodeMirror plugin that left a note's maths (or its headings and bullets) as raw text until the
 * note was reopened, found by an independent verifier of the maths lane (Mathslane-fix1). Neither needs a DOM: the
 * decorations are a function of a state and the visible ranges, and the window check of a ranges and a change.
 */

const count = (set: DecorationSet): number => { let n = 0; for (const c = set.iter(); c.value; c.next()) n++; return n }
const stateOf = (doc: string, anchor = 0) => EditorState.create({ doc, selection: { anchor }, extensions: [notebookField] })

describe("inline equations in a view whose visible ranges are split (the rendered page)", () => {
  // The rendered page replaces whole paragraphs, so view.visibleRanges is split round them. A one-line paragraph that
  // is not the first block is the END of one range and the START of the next; walking the lines of each range put
  // its equations into the sorted builder twice, CodeMirror threw "Ranges must be added sorted by from position and
  // startSide", and the plugin was gone for that view: every `wl:` in the note was raw text until it was reopened.
  const doc = "Intro.\n\nSee `wl:a+b` and `wl:a-b` here.\n"
  const line = stateOf(doc).doc.line(3)

  it("a line shared by two ranges is walked once", () => {
    expect(linesOfRanges(stateOf(doc).doc, [{ from: 0, to: 8 }, { from: 39, to: 40 }])).toEqual([1, 2, 3, 4])
    const shared = [{ from: 0, to: line.from + 3 }, { from: line.to - 2, to: doc.length }]
    expect(linesOfRanges(stateOf(doc).doc, shared)).toEqual([1, 2, 3, 4])
    // ...and a gap is still a gap
    expect(linesOfRanges(stateOf("a\nb\nc\nd\ne").doc, [{ from: 0, to: 3 }, { from: 6, to: 9 }])).toEqual([1, 2, 4, 5])
    expect(linesOfRanges(stateOf("").doc, [{ from: 0, to: 0 }])).toEqual([1])
    expect(linesOfRanges(stateOf("abc").doc, [])).toEqual([])
  })

  it("two equations on that line are decorated once each, and nothing throws", () => {
    const state = stateOf(doc)
    const visibleRanges = [{ from: 0, to: line.from + 3 }, { from: line.to - 2, to: doc.length }]
    expect(() => inlineDecorations({ state, visibleRanges })).not.toThrow()
    expect(count(inlineDecorations({ state, visibleRanges }))).toBe(2)
  })

  it("the decorations are the same however the view happens to be cut up", () => {
    const state = stateOf(doc)
    const whole = count(inlineDecorations({ state, visibleRanges: [{ from: 0, to: doc.length }] }))
    expect(whole).toBe(2)
    for (let cut = 0; cut <= doc.length; cut++) {
      // two ranges that meet or overlap on a line, wherever the cut falls
      const visibleRanges = [{ from: 0, to: cut }, { from: Math.min(doc.length, cut + 1), to: doc.length }]
      expect(count(inlineDecorations({ state, visibleRanges })), `cut at ${cut}`).toBe(whole)
    }
  })

  it("a heading, a quote and a paragraph before a fence are the same", () => {
    for (const text of [
      "# T\n\nSee `wl:a+b` and `wl:a-b` here.\n\nNext.\n",
      "Intro.\n\n> See `wl:a+b` and `wl:a-b` here.\n\nNext.\n",
      "Intro.\n\nSee `wl:a+b` and `wl:a-b` here.\n\n```wl\nx^2\n```\n",
    ]) {
      const state = stateOf(text)
      const at = text.indexOf("See `wl:") + 3
      const visibleRanges = [{ from: 0, to: at }, { from: at + 3, to: text.length }]
      expect(count(inlineDecorations({ state, visibleRanges })), JSON.stringify(text)).toBe(2)
    }
  })
})

describe("the markdown decorations' window check, after an edit that grows the note", () => {
  // The first character typed in an empty note, a keystroke at the end of a short one: the view's visible ranges are
  // ALREADY in the new document's positions when a plugin is updated, and the check mapped them through the change
  // again -- `changes.mapPos(1, 1)` on a change set of length 0 throws RangeError, and CodeMirror dropped the plugin:
  // headings, bullets and bold stayed raw markdown until the note was reopened.
  it("the first character of an empty note", () => {
    const changes = ChangeSet.of({ from: 0, insert: "a" }, 0)
    expect(() => windowHoldsPage(changes, { from: 0, to: 0 }, [{ from: 0, to: 1 }], { from: 0, to: 1 })).not.toThrow()
    const page = windowHoldsPage(changes, { from: 0, to: 0 }, [{ from: 0, to: 1 }], { from: 0, to: 1 })
    expect(page).toEqual({ holds: true, from: 0, to: 1 })
  })

  it("a keystroke at the end of a short note, and a pasted block there", () => {
    const short = "# Heading\n- item"
    for (const insert of ["x", "\n- more", "a much longer paste\nof several\nlines\n"]) {
      const changes = ChangeSet.of({ from: short.length, insert }, short.length)
      const grown = short.length + insert.length
      const page = windowHoldsPage(changes, { from: 0, to: short.length }, [{ from: 0, to: grown }], { from: 10, to: grown })
      expect(page.holds, JSON.stringify(insert)).toBe(true)
      expect(page.to).toBe(grown)
    }
  })

  it("setDoc: the whole note replaced by a longer one", () => {
    const changes = ChangeSet.of({ from: 0, to: 5, insert: "a considerably longer note\nwith lines" }, 5)
    const grown = "a considerably longer note\nwith lines".length
    expect(() => windowHoldsPage(changes, { from: 0, to: 5 }, [{ from: 0, to: grown }], { from: 0, to: grown })).not.toThrow()
  })

  it("it still says no when the page has left the decorated window", () => {
    const none = ChangeSet.of([], 100)
    expect(windowHoldsPage(none, { from: 20, to: 60 }, [{ from: 10, to: 50 }], { from: 30, to: 31 }).holds).toBe(false)
    expect(windowHoldsPage(none, { from: 20, to: 60 }, [{ from: 30, to: 70 }], { from: 30, to: 31 }).holds).toBe(false)
    expect(windowHoldsPage(none, { from: 20, to: 60 }, [{ from: 30, to: 50 }], { from: 10, to: 31 }).holds).toBe(false)
    expect(windowHoldsPage(none, { from: 20, to: 60 }, [{ from: 30, to: 50 }], { from: 30, to: 31 }).holds).toBe(true)
  })

  it("the window itself moves with the edit: an insert above pushes it down", () => {
    const changes = ChangeSet.of({ from: 0, insert: "12345" }, 100)
    expect(windowHoldsPage(changes, { from: 20, to: 60 }, [{ from: 30, to: 50 }], { from: 30, to: 31 })).toEqual({ holds: true, from: 25, to: 65 })
  })
})
