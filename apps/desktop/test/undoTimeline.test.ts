/**
 * The note's ONE Undo (renderer/editTimeline.ts, drawingHistory.ts, useUndo.ts).
 *
 * The words keep CodeMirror's history, the drawing keeps snapshots, and every
 * edit on either side is numbered on the note's clock. These tests drive the
 * REAL CodeMirror history (headless, no DOM) and the real DrawingHistory with
 * long random interleavings of word edits and drawing edits, and check against
 * an oracle that after EVERY undo and redo the pair (words, drawing) is exactly
 * what it was before / after the most recent edit.
 *
 * No Swift original: the Mac has no combined timeline (it routes Cmd-Z by mode,
 * `AppState.drawingOwnsUndo`, and keeps `store.undoDrawing` as the drawing's own
 * pair); this is a port-only rule, and the Edit > Undo Drawing pair is tested
 * here as well.
 */

import { describe, expect, it } from "vitest"
import { EditorState, Transaction } from "@codemirror/state"
import { history, undoDepth } from "@codemirror/commands"
import { noTransform, type CanvasItem, type Drawing } from "@writemind/core"
import { DrawingHistory } from "../src/renderer/drawingHistory"
import { changedBox, EditClock, stepAcross, textTimeline, type TextHost } from "../src/renderer/editTimeline"

// A small seeded generator, so a failure can be replayed.
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const stroke = (id: string, x = 0.1): CanvasItem => ({
  kind: "stroke",
  stroke: {
    id, colorHex: "#2D7DD2", width: 3, points: [{ x, y: 0.1 }, { x: x + 0.1, y: 0.2 }],
    transform: noTransform(), group: null,
  },
})

/** One note: its clock, its words, its drawing and its history. */
class Note implements TextHost {
  clock = new EditClock()
  history: DrawingHistory
  state: EditorState
  drawing: Drawing = { items: [] }
  time = 1_700_000_000_000
  private counter = 0

  constructor(doc = "") {
    this.history = new DrawingHistory(this.clock)
    this.state = EditorState.create({ doc, extensions: [history(), textTimeline(this.clock)] })
  }

  dispatch(tr: Transaction): void { this.state = tr.state }
  get words(): string { return this.state.doc.toString() }
  get ids(): string[] { return this.drawing.items.map((item) => (item.kind === "stroke" ? item.stroke.id : "?")) }

  // --- words ---
  type(text: string, gap = 100): boolean {
    this.time += gap
    const before = undoDepth(this.state)
    this.state = this.state.update({
      changes: { from: this.state.doc.length, insert: text },
      selection: { anchor: this.state.doc.length + text.length },
      userEvent: "input.type", annotations: Transaction.time.of(this.time),
    }).state
    return undoDepth(this.state) === before
  }
  backspace(gap = 100): boolean | null {
    if (this.state.doc.length === 0) return null
    this.time += gap
    const before = undoDepth(this.state)
    const end = this.state.doc.length
    this.state = this.state.update({
      changes: { from: end - 1, to: end },
      selection: { anchor: end - 1 },
      userEvent: "delete.backward", annotations: Transaction.time.of(this.time),
    }).state
    return undoDepth(this.state) === before
  }
  paste(text: string): void {
    this.time += 100
    const at = Math.floor(this.state.doc.length / 2)
    this.state = this.state.update({
      changes: { from: at, insert: text }, userEvent: "input.paste",
      annotations: Transaction.time.of(this.time),
    }).state
  }
  moveCaret(): void {
    this.time += 100
    const to = this.state.selection.main.head === 0 ? this.state.doc.length : 0
    this.state = this.state.update({ selection: { anchor: to }, userEvent: "select" }).state
  }

  // --- drawing ---
  private fresh(): string { return `s${++this.counter}` }
  /** The edit as the canvas makes it: record the drawing as it was, then change it. */
  edit(next: Drawing): void {
    this.history.record(this.drawing)
    this.drawing = next
  }
  draw(): void { this.edit({ items: [...this.drawing.items, stroke(this.fresh(), this.counter / 100)] }) }
  remove(pick: number): boolean {
    if (this.drawing.items.length === 0) return false
    const at = pick % this.drawing.items.length
    this.edit({ items: this.drawing.items.filter((_, index) => index !== at) })
    return true
  }
  nudge(pick: number): boolean {
    if (this.drawing.items.length === 0) return false
    const at = pick % this.drawing.items.length
    this.edit({
      items: this.drawing.items.map((item, index) =>
        index === at && item.kind === "stroke"
          ? { kind: "stroke" as const, stroke: { ...item.stroke, width: item.stroke.width + 1 } } : item),
    })
    return true
  }

  // --- undo / redo, the app's way ---
  step(which: "undo" | "redo") {
    return stepAcross(which, {
      clock: this.clock, text: this, history: this.history,
      current: () => this.drawing, apply: (next) => { this.drawing = next },
    })
  }
  snapshot(): { words: string; drawing: Drawing } { return { words: this.words, drawing: this.drawing } }
}

type Op = "type" | "backspace" | "paste" | "caret" | "draw" | "remove" | "nudge" | "gap" | "undo" | "redo" | "together"
const OPS: Op[] = ["type", "type", "type", "backspace", "paste", "caret", "draw", "draw", "remove", "nudge", "gap",
  "undo", "undo", "redo", "together"]

/** The oracle: the states after each event, and where we are among them. */
class Oracle {
  states: { words: string; drawing: Drawing }[]
  at = 0
  /** Whether the last operation was a word edit CodeMirror may have joined onto. */
  lastWasText = false
  constructor(first: { words: string; drawing: Drawing }) { this.states = [first] }

  /** A new event: the redo side is dropped. */
  push(next: { words: string; drawing: Drawing }): void {
    this.states = [...this.states.slice(0, this.at + 1), next]
    this.at = this.states.length - 1
  }
  /** The last event is carried on (typing that CodeMirror grouped). */
  extend(next: { words: string; drawing: Drawing }): void {
    this.states[this.at] = next
  }
}

function sameDrawing(a: Drawing, b: Drawing): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function run(seed: number, count: number, note = new Note()): void {
  const rnd = random(seed)
  const oracle = new Oracle(note.snapshot())
  const log: string[] = []
  const fail = (message: string) => {
    throw new Error(`seed ${seed}: ${message}\n  ops: ${log.slice(-40).join(" ")}\n  oracle@${oracle.at}: `
      + oracle.states.slice(-8).map((x) => `${JSON.stringify(x.words)}/${x.drawing.items.length}`).join(" | "))
  }
  // The histories keep a limited number of events (CodeMirror 100, the drawing 200); the
  // oracle keeps them all, so a long run is walked back down now and then to stay inside.
  let draining = false
  for (let i = 0; i < count; i++) {
    if (oracle.at >= 90) draining = true
    if (oracle.at <= 30) draining = false
    const op = draining ? "undo" : OPS[Math.floor(rnd() * OPS.length)]!
    log.push(op)
    switch (op) {
      case "type": {
        const joined = note.type("a")
        if (joined && oracle.lastWasText) oracle.extend(note.snapshot()); else oracle.push(note.snapshot())
        oracle.lastWasText = true
        break
      }
      case "backspace": {
        const joined = note.backspace()
        if (joined === null) break
        if (joined && oracle.lastWasText) oracle.extend(note.snapshot()); else oracle.push(note.snapshot())
        oracle.lastWasText = true
        break
      }
      case "paste": note.paste("PP"); oracle.push(note.snapshot()); oracle.lastWasText = true; break
      case "caret": note.moveCaret(); oracle.lastWasText = false; break
      case "draw": note.draw(); oracle.push(note.snapshot()); oracle.lastWasText = false; break
      case "remove": if (note.remove(Math.floor(rnd() * 100))) { oracle.push(note.snapshot()); oracle.lastWasText = false } break
      case "nudge": if (note.nudge(Math.floor(rnd() * 100))) { oracle.push(note.snapshot()); oracle.lastWasText = false } break
      case "gap": note.time += 700; oracle.lastWasText = false; break
      case "together": {
        // A picture read into words: the words go in and the picture is put away, as ONE edit.
        note.clock.together()
        note.paste("WW")
        note.draw()
        oracle.push(note.snapshot())
        oracle.lastWasText = false
        break
      }
      case "undo": case "redo": {
        const message = stepOracle(op, note, oracle)
        if (message) fail(message)
        break
      }
    }
  }
  // And all the way back, then all the way forward again.
  for (let guard = 0; oracle.at > 0 && guard < 10_000; guard++) {
    const message = stepOracle("undo", note, oracle)
    if (message) fail("final undo: " + message)
  }
  expect(note.step("undo")).toBeNull()
  for (let guard = 0; oracle.at < oracle.states.length - 1 && guard < 10_000; guard++) {
    const message = stepOracle("redo", note, oracle)
    if (message) fail("final redo: " + message)
  }
  expect(note.step("redo")).toBeNull()
}

/**
 * One undo or redo, checked. CodeMirror may hold an event with no net effect
 * (a letter typed and taken back in one group): the app steps over it, so the
 * oracle steps over states equal to the one it is leaving.
 */
function stepOracle(which: "undo" | "redo", note: Note, oracle: Oracle): string | null {
  const dir = which === "undo" ? -1 : 1
  const here = oracle.states[oracle.at]!
  let to = oracle.at + dir
  while (to >= 0 && to < oracle.states.length && same(oracle.states[to]!, here)) to += dir
  const took = note.step(which)
  // A step that found nothing leaves the history as it was, so typing still joins; any other ends the group.
  if (took !== null) oracle.lastWasText = false
  if (to < 0 || to >= oracle.states.length) {
    // Nothing visible is left: the step is nothing, or only no-op events were left to consume.
    if (took !== null && took !== "text") return `${which} took ${took} but nothing was there`
    if (!same(note.snapshot(), here)) return `${which} changed something with nothing to ${which}`
    oracle.at = to < 0 ? 0 : oracle.states.length - 1
    return null
  }
  if (took === null) return `${which} found nothing, expected a step to #${to}`
  const want = oracle.states[to]!
  oracle.at = to
  if (note.words !== want.words) return `${which} (took ${took}): words ${JSON.stringify(note.words)} != ${JSON.stringify(want.words)}`
  if (!sameDrawing(note.drawing, want.drawing)) return `${which}: drawing ${note.ids} != ${want.drawing.items.length} items`
  return null
}

const same = (a: { words: string; drawing: Drawing }, b: { words: string; drawing: Drawing }): boolean =>
  a.words === b.words && sameDrawing(a.drawing, b.drawing)

describe("one Undo for the words and the drawing", () => {
  it("takes back exactly the most recent edit, whichever side made it", () => {
    const note = new Note()
    note.type("hello")           // T1
    note.draw()                  // D2
    note.type(" world")          // T3: must not join the group the drawing has moved past
    note.draw()                  // D4
    expect(note.words).toBe("hello world")
    expect(note.ids).toEqual(["s1", "s2"])
    expect(note.step("undo")).toBe("drawing")
    expect(note.ids).toEqual(["s1"])
    expect(note.step("undo")).toBe("text")
    expect(note.words).toBe("hello")
    expect(note.step("undo")).toBe("drawing")
    expect(note.ids).toEqual([])
    expect(note.words).toBe("hello")
    expect(note.step("undo")).toBe("text")
    expect(note.words).toBe("")
    expect(note.step("undo")).toBeNull()
  })

  it("typing is grouped as CodeMirror groups it, but a drawing edit ends the group", () => {
    const note = new Note()
    note.type("a"); note.type("b"); note.type("c")      // one group
    note.draw()
    note.type("d"); note.type("e")                       // another
    expect(note.step("undo")).toBe("text")
    expect(note.words).toBe("abc")
    expect(note.step("undo")).toBe("drawing")
    expect(note.step("undo")).toBe("text")
    expect(note.words).toBe("")
  })

  it("redo brings back the edit that was undone last, in the order the edits were made", () => {
    const note = new Note()
    note.type("one")
    note.draw()
    note.type(" two", 900)
    note.step("undo"); note.step("undo"); note.step("undo")
    expect(note.words).toBe("")
    expect(note.ids).toEqual([])
    expect(note.step("redo")).toBe("text")
    expect(note.words).toBe("one")
    expect(note.step("redo")).toBe("drawing")
    expect(note.step("redo")).toBe("text")
    expect(note.words).toBe("one two")
    expect(note.step("redo")).toBeNull()
  })

  it("a new edit on either side ends every redo, on both sides", () => {
    const a = new Note()
    a.type("words"); a.draw()
    a.step("undo"); a.step("undo")                // both undone
    a.draw()                                       // a new drawing edit: the words' redo is dead too
    expect(a.step("redo")).toBeNull()
    expect(a.words).toBe("")

    const b = new Note()
    b.type("words"); b.draw()
    b.step("undo"); b.step("undo")
    b.type("new", 900)                             // a new word edit: the drawing's redo is dead too
    expect(b.step("redo")).toBeNull()
    expect(b.ids).toEqual([])
  })

  it("an edit made after an undo does not resurrect what was undone before it", () => {
    const note = new Note()
    note.draw(); note.draw()          // s1 s2
    note.step("undo")                 // s1
    note.type("x")
    note.step("undo")                 // the word
    expect(note.step("redo")).toBe("text")
    expect(note.step("redo")).toBeNull()   // s2 is gone for good
    expect(note.ids).toEqual(["s1"])
  })

  it("a picture read into words is ONE edit (the words go in and the picture is put away)", () => {
    const note = new Note()
    note.draw()
    note.type("before")
    note.clock.together()
    note.paste("read words")
    note.edit({ items: note.drawing.items.map((item) => item.kind === "stroke"
      ? { kind: "stroke" as const, stroke: { ...item.stroke, width: 9 } } : item) })
    expect(note.step("undo")).toBe("both")
    expect(note.words).toBe("before")
    expect(note.drawing.items[0]!.kind === "stroke" && note.drawing.items[0]!.stroke.width).toBe(3)
    expect(note.step("redo")).toBe("both")
    expect(note.words).toContain("read words")
  })

  it("Undo Drawing / Redo Drawing (the Edit menu's own pair) work on the drawing alone", () => {
    const note = new Note()
    note.draw()                       // D1
    note.type("words")                // T2
    note.draw()                       // D3
    // The menu's Undo Drawing takes the drawing's newest edit and leaves the words.
    const back = note.history.undo(note.drawing)!
    note.drawing = back
    expect(note.ids).toEqual(["s1"])
    expect(note.words).toBe("words")
    expect(note.history.canRedo).toBe(true)
    // Redo Drawing puts it back.
    note.drawing = note.history.redo(note.drawing)!
    expect(note.ids).toEqual(["s1", "s2"])
    // And the app's Undo, which follows the timeline, still reverses D3, T2, D1 in that order.
    expect(note.step("undo")).toBe("drawing")
    expect(note.step("undo")).toBe("text")
    expect(note.step("undo")).toBe("drawing")
    expect(note.step("undo")).toBeNull()
  })

  it("an undone drawing edit made out of order by Undo Drawing is still redone in its place", () => {
    const note = new Note()
    note.draw()
    note.type("w")
    note.drawing = note.history.undo(note.drawing)!       // Undo Drawing: D1 goes, T2 stays
    expect(note.step("undo")).toBe("text")                 // the app's Undo: the words
    expect(note.step("undo")).toBeNull()
    expect(note.words).toBe("")
  })

  it("each note has its own timeline: an edit in one does not touch the other's undo or redo", () => {
    const a = new Note(), b = new Note()
    a.type("alpha"); a.draw()
    b.type("beta"); b.draw()
    a.step("undo")                       // a: the drawing is undone, its redo is waiting
    b.draw(); b.type("more", 900)        // edits in b must not kill a's redo
    expect(a.step("redo")).toBe("drawing")
    expect(a.ids).toEqual(["s1"])
    b.step("undo"); b.step("undo"); b.step("undo")
    expect(b.words).toBe("beta")
    expect(a.words).toBe("alpha")
  })

  it("the editor state kept while a tab is behind keeps its stamps with it", () => {
    const note = new Note()
    note.type("kept"); note.draw()
    const away = note.state              // put aside as the tab goes behind another
    const back = new Note()
    back.clock = note.clock
    back.history = note.history
    back.drawing = note.drawing
    back.state = away                    // ...and picked up again
    expect(back.step("undo")).toBe("drawing")
    expect(back.step("undo")).toBe("text")
    expect(back.words).toBe("")
  })

  it("survives the history trimming its oldest events (hundreds of separate edits)", () => {
    const note = new Note()
    for (let i = 0; i < 400; i++) {
      if (i % 2 === 0) note.paste("p"); else note.draw()
    }
    const edits: ("drawing" | "text" | "both" | null)[] = []
    for (let i = 0; i < 80; i++) edits.push(note.step("undo"))
    // The newest was a drawing edit (399 is odd), then words, alternately.
    expect(edits.slice(0, 6)).toEqual(["drawing", "text", "drawing", "text", "drawing", "text"])
    for (let i = 0; i < 80; i++) expect(note.step("redo")).not.toBeNull()
    expect(note.drawing.items.length).toBe(200)
  })

  it.each(Array.from({ length: 150 }, (_, i) => i + 1))("random interleaving, seed %i (300 operations)", (seed) => {
    run(seed, 300)
  })

  it("long random interleavings (5 x 3000 operations)", () => {
    for (let seed = 1000; seed < 1005; seed++) {
      // A note with words already in it, so the edits are not all at the end of nothing.
      run(seed, 3000, new Note("An existing note.\n\nWith two paragraphs."))
    }
  })
})

describe("where an Undo changed the drawing (so the page can be scrolled to it)", () => {
  const pane = { width: 1000, height: 600 }
  const at = (id: string, y: number): CanvasItem => ({
    kind: "stroke",
    stroke: { id, colorHex: "#000000", width: 2, points: [{ x: 0.1, y }, { x: 0.2, y }], transform: noTransform(), group: null },
  })

  it("is nothing when nothing differs", () => {
    const one = at("a", 0.2)
    expect(changedBox({ items: [one] }, { items: [one] }, pane)).toBeNull()
  })

  it("is the item that was added, taken away, or changed — and only that", () => {
    const keep = at("keep", 0.1), far = at("far", 3.0)
    const box = changedBox({ items: [keep] }, { items: [keep, far] }, pane)!
    expect(box.y).toBeGreaterThan(1700)
    expect(box.y).toBeLessThan(1900)
    const gone = changedBox({ items: [keep, far] }, { items: [keep] }, pane)!
    expect(gone.y).toBeCloseTo(box.y, 6)
    const moved = at("far", 3.5)
    const both = changedBox({ items: [keep, far] }, { items: [keep, moved] }, pane)!
    // an item that is there in both states, changed: where it is now
    expect(both.y).toBeGreaterThan(2000)
    expect(both.y).toBeLessThan(2200)
  })
})
