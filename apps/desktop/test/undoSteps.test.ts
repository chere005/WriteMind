/**
 * THE PAGE'S HALF OF UNDO (docs/PLAN-undo.md): which step a press takes (the newest of the open note's own edit and the
 * journal's top file step, by the wall clock), what Edit ▸ Undo calls it, the text history surviving a rename, a move, a
 * close, and a file step closing the typing group in progress. The real CodeMirror history and the real `DrawingHistory`, no DOM.
 *
 * No Swift original (port-only; the Mac has no file-step undo).
 */

import { describe, expect, it } from "vitest"
import { EditorState, StateEffect, Transaction } from "@codemirror/state"
import { history, undo, undoDepth } from "@codemirror/commands"
import { noTransform, type CanvasItem, type Drawing } from "@writemind/core"
import { buildMenu } from "../src/main/menu"
import { initialMenuState, type MenuState } from "../src/shared/commands"
import { EMPTY_UNDO, menuText, pickStep, textRedoAlive, takenNotice, wallNow, type StepInfo } from "../src/shared/undo"
import { DrawingHistory } from "../src/renderer/drawingHistory"
import { closeTextGroups, EditClock, peekAcross, stepAcross, textTimeline, type Across, type TextHost } from "../src/renderer/editTimeline"
import { CLOSED_KEEP, closedHistories, forgetAll, historyOf, keepOnly, renameNote, stashText, takeText } from "../src/renderer/noteHistory"

const step = (label: string, at: number, undoneAt: number | null = null): StepInfo =>
  ({ id: "s1", kind: "renameNote", label, at, undoneAt })

describe("which step a press of Undo takes", () => {
  it("the newest of the note's own edit and the journal's top step", () => {
    expect(pickStep("undo", { label: "Typing", at: 10 }, step("Rename Note", 20))).toEqual({ from: "file", label: "Rename Note" })
    expect(pickStep("undo", { label: "Typing", at: 30 }, step("Rename Note", 20))).toEqual({ from: "text", label: "Typing" })
  })
  it("a tie is the file step's (the operation was asked for after the typing it flushed)", () => {
    expect(pickStep("undo", { label: "Typing", at: 20 }, step("Rename Note", 20))?.from).toBe("file")
  })
  it("with only one kind, that kind; with neither, nothing", () => {
    expect(pickStep("undo", null, step("New Note", 1))?.from).toBe("file")
    expect(pickStep("undo", { label: "Drawing", at: 1 }, null)?.from).toBe("text")
    expect(pickStep("undo", null, null)).toBeNull()
  })
  it("Redo is the one undone LAST: the greatest undoneAt, a file step's by its own", () => {
    expect(pickStep("redo", { label: "Typing", at: 50 }, step("Rename Note", 5, 40))?.from).toBe("text")
    expect(pickStep("redo", { label: "Typing", at: 30 }, step("Rename Note", 5, 40))?.from).toBe("file")
  })
  it("a text Redo undone before the newest file step was recorded is dead (a new step ends the redo path)", () => {
    expect(textRedoAlive(30, 20)).toBe(true)
    expect(textRedoAlive(10, 20)).toBe(false)
  })
  it("the menu says 'Undo Rename Note', and plain 'Undo' with nothing", () => {
    expect(menuText("Undo", "Rename Note")).toBe("Undo Rename Note")
    expect(menuText("Redo", null)).toBe("Redo")
    expect(takenNotice("a", "a 2")).toContain("a 2")
    expect(EMPTY_UNDO).toMatchObject({ undo: null, redo: null, newestAt: 0 })
  })
})

describe("Edit > Undo and Redo name the step and grey when there is none", () => {
  const edit = (state: Partial<MenuState>) => buildMenu({
    platform: "win32", state: { ...initialMenuState, ...state },
    project: { name: "P", edited: false, folders: [{ path: "/a", name: "a" }] }, run: () => {},
  }).find((one) => one.label === "Edit")!.submenu as { id?: string; label: string; enabled?: boolean }[]
  it("not said yet: plain and enabled (the page tells the shell once it has looked)", () => {
    const [undoItem, redoItem] = edit({})
    expect([undoItem!.label, undoItem!.enabled, redoItem!.label, redoItem!.enabled]).toEqual(["Undo", true, "Redo", true])
  })
  it("said null: plain and greyed", () => {
    const [undoItem, redoItem] = edit({ undoLabel: null, redoLabel: null })
    expect([undoItem!.label, undoItem!.enabled, redoItem!.label, redoItem!.enabled]).toEqual(["Undo", false, "Redo", false])
  })
  it("named: the step, enabled", () => {
    const [undoItem, redoItem] = edit({ undoLabel: "Rename Note", redoLabel: "Move to Trash" })
    expect([undoItem!.label, undoItem!.enabled, redoItem!.label, redoItem!.enabled]).toEqual(["Undo Rename Note", true, "Redo Move to Trash", true])
    expect([undoItem!.id, redoItem!.id]).toEqual(["undo", "redo"])
  })
})

// --- a note as the page holds it: words, drawing, one clock
const stroke = (id: string): CanvasItem => ({
  kind: "stroke",
  stroke: { id, colorHex: "#2D7DD2", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], transform: noTransform(), group: null },
})

class Held implements TextHost {
  clock: EditClock
  history: DrawingHistory
  state: EditorState
  drawing: Drawing = { items: [] }
  time = 1_700_000_000_000
  constructor(path = "/n.wm", doc = "") {
    const held = historyOf(path)
    this.clock = held.clock
    this.history = held.drawing
    this.state = EditorState.create({ doc, extensions: [history({ minDepth: 200 }), textTimeline(this.clock)] })
  }
  dispatch(tr: Transaction): void { this.state = tr.state }
  type(text: string, gap = 700, event = "input.type"): void {
    this.time += gap
    const end = this.state.doc.length
    this.state = this.state.update({
      changes: { from: end, insert: text }, selection: { anchor: end + text.length },
      userEvent: event, annotations: Transaction.time.of(this.time),
    }).state
  }
  draw(): void { this.history.record(this.drawing); this.drawing = { items: [...this.drawing.items, stroke(`s${this.drawing.items.length}`)] } }
  across(): Across { return { clock: this.clock, text: this, history: this.history, current: () => this.drawing, apply: (next) => { this.drawing = next } } }
}

describe("what the note offers the journal: the time of its newest edit and what to call it", () => {
  it("a typing step is 'Typing', a drawing step 'Drawing', and the later one is offered", () => {
    forgetAll()
    const note = new Held()
    expect(peekAcross("undo", note.across())).toBeNull()
    note.type("hello")
    const typing = peekAcross("undo", note.across())!
    expect(typing.label).toBe("Typing")
    expect(typing.at).toBeGreaterThan(0)
    note.draw()
    const drawing = peekAcross("undo", note.across())!
    expect(drawing.label).toBe("Drawing")
    expect(drawing.at).toBeGreaterThan(typing.at)
  })
  it("a paste and a cut are named as such", () => {
    forgetAll()
    const note = new Held()
    note.type("abc", 700, "input.paste")
    expect(peekAcross("undo", note.across())!.label).toBe("Paste")
    note.type("d", 700, "input.drop")
    expect(peekAcross("undo", note.across())!.label).toBe("Drop")
  })
  it("a Redo is offered with the time it was undone, later than the edit's own", () => {
    forgetAll()
    const note = new Held()
    note.type("x")
    const edited = peekAcross("undo", note.across())!.at
    const before = wallNow()
    expect(stepAcross("undo", note.across())).toBe("text")
    const redo = peekAcross("redo", note.across())!
    expect(redo.at).toBeGreaterThanOrEqual(before)
    expect(redo.at).toBeGreaterThan(edited)
    expect(peekAcross("undo", note.across())).toBeNull()
  })
  it("nothing to redo before an undo, and nothing after a new edit", () => {
    forgetAll()
    const note = new Held()
    note.type("x")
    expect(peekAcross("redo", note.across())).toBeNull()
    stepAcross("undo", note.across())
    note.type("y")
    expect(peekAcross("redo", note.across())).toBeNull()
  })
})

describe("a file step closes the typing group in progress", () => {
  it("typing a breath apart is ONE step; with a file step between it is TWO", () => {
    forgetAll()
    const joined = new Held("/j.wm")
    joined.type("a", 100)
    joined.type("b", 100)
    expect(undoDepth(joined.state)).toBe(1)
    forgetAll()
    const split = new Held("/s.wm")
    split.type("a", 100)
    closeTextGroups()           // the journal recorded a rename
    split.type("b", 100)
    expect(undoDepth(split.state)).toBe(2)
    // and it closes once: the typing after it joins again
    split.type("c", 100)
    expect(undoDepth(split.state)).toBe(2)
    undo({ state: split.state, dispatch: (tr) => split.dispatch(tr) })
    expect(split.state.doc.toString()).toBe("a")
  })
})

describe("the text history survives what happens to its note", () => {
  const extensions = (clock: EditClock) => [history({ minDepth: 200 }), textTimeline(clock)]

  it("a rename carries it: the state put aside under the old name is the new name's, and Ctrl+Z still works", () => {
    forgetAll()
    const note = new Held("/a.wm", "alpha\n")
    note.type("one")
    note.type("two")
    expect(undoDepth(note.state)).toBe(2)
    // the page renames the note: the history moves, then the editor (built for the old path) puts its state away under that path
    renameNote("/a.wm", "/b.wm")
    stashText("/a.wm", note.state)
    const aside = takeText("/b.wm", "alpha\nonetwo")
    expect(aside).not.toBeNull()
    // rebuilt for the new path with ITS extensions: the history, and the stamps beside it, are still there
    const rebuilt = aside!.update({ effects: StateEffect.reconfigure.of(extensions(historyOf("/b.wm").clock)) }).state
    expect(undoDepth(rebuilt)).toBe(2)
    const back = new Held("/b.wm")
    back.state = rebuilt
    expect(stepAcross("undo", back.across())).toBe("text")
    expect(back.state.doc.toString()).toBe("alpha\none")
    expect(stepAcross("undo", back.across())).toBe("text")
    expect(back.state.doc.toString()).toBe("alpha\n")
  })

  it("the new path's editor takes only a state whose words are the words in hand", () => {
    forgetAll()
    const note = new Held("/a.wm", "x")
    note.type("y")
    stashText("/a.wm", note.state)
    expect(takeText("/a.wm", "x")).toBeNull()          // the file says something else: the history is not used
  })

  it("renaming twice, and back, follows the note each time", () => {
    forgetAll()
    const note = new Held("/a.wm", "")
    note.type("t")
    renameNote("/a.wm", "/b.wm")
    renameNote("/b.wm", "/a.wm")
    stashText("/b.wm", note.state)           // a late stash under a name the note has left
    stashText("/a.wm", note.state)
    expect(takeText("/a.wm", "t")).not.toBeNull()
  })

  it("a closed note's history is kept (the last few), and comes back when the note is opened again", () => {
    forgetAll()
    const note = new Held("/c.wm", "")
    note.type("typed")
    const clock = historyOf("/c.wm").clock
    stashText("/c.wm", note.state)
    keepOnly([])                                       // its tab was closed
    expect(closedHistories()).toHaveLength(1)
    expect(historyOf("/c.wm").clock).toBe(clock)       // the same history, not a new one
    expect(closedHistories()).toHaveLength(0)
    expect(takeText("/c.wm", "typed")).not.toBeNull()
  })

  it("only the last few closed notes are kept", () => {
    forgetAll()
    for (let n = 0; n < CLOSED_KEEP + 3; n++) historyOf(`/n${n}.wm`)
    keepOnly([])
    expect(closedHistories()).toHaveLength(CLOSED_KEEP)
    // the oldest went: asking for it makes a fresh one
    const fresh = historyOf("/n0.wm")
    expect(fresh.drawing.canUndo).toBe(false)
  })

  it("a closed note that moved (Undo of a trash put it back under another name) takes its history along", () => {
    forgetAll()
    const held = historyOf("/gone.wm")
    keepOnly([])
    renameNote("/gone.wm", "/gone 2.wm")
    expect(historyOf("/gone 2.wm")).toBe(held)
  })

  it("the history goes deep: 250 separate typing steps and all of them are undoable down to the 200 CodeMirror keeps", () => {
    forgetAll()
    const note = new Held("/deep.wm")
    for (let n = 0; n < 250; n++) note.type("x", 700)
    let taken = 0
    while (stepAcross("undo", note.across()) !== null) taken++
    expect(taken).toBeGreaterThanOrEqual(200)
  })
})

