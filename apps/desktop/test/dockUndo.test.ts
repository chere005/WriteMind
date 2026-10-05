/**
 * Docking and new ink cells are ONE undo step (renderer/dock.ts; docs\PLAN-docking-ink-cells.md (d), (e)).
 *
 * The words keep CodeMirror's real history (headless, no DOM) with the note's `textTimeline`, the drawing keeps the
 * real `DrawingHistory`, and Undo / Redo go through `stepAcross` exactly as Ctrl+Z, Edit ▸ Undo and the pen's double
 * tap do (useUndo.ts). The line is written the way the editor's `insertCellLine` writes it: one transaction,
 * `isolateHistory("full")`, userEvent "input.dock".
 *
 * No Swift original: the Mac's PLAN-docking.md asks for "ONE undo step for write + removal from the drawing" and
 * nothing of it is built there.
 */

import { describe, expect, it } from "vitest"
import { EditorState, Transaction } from "@codemirror/state"
import { history, isolateHistory } from "@codemirror/commands"
import {
  inkCellMarkdown, inkCellOf, inkCells, isHidden, noTransform, pictureMarkdown, writeDrawing,
  type CanvasItem, type Drawing,
} from "@writemind/core"
import { pictureFiles } from "../src/main/macDrawing"
import { DrawingHistory } from "../src/renderer/drawingHistory"
import { changedBox, changedCells, EditClock, stepAcross, textTimeline, type TextHost } from "../src/renderer/editTimeline"
import { depthOf, dockAsCell, dockInto, insertInkCell, oneStep, type DockDeps } from "../src/renderer/dock"

const stroke = (id: string, x = 0.1, y = 0.1): CanvasItem => ({
  kind: "stroke",
  stroke: {
    id, colorHex: "#2D7DD2", width: 3, points: [{ x, y }, { x: x + 0.1, y: y + 0.05 }],
    transform: noTransform(), group: null,
  },
})

const picture = (id: string, file = "0123456789abcdef.png"): CanvasItem => ({
  kind: "image",
  image: { id, file, center: { x: 0.4, y: 0.3 }, width: 0.3, aspect: 0.5, transform: noTransform(), hidden: false, group: null },
})

const shape = (id: string): CanvasItem => ({
  kind: "shape",
  shape: {
    id, kind: "rectangle", center: { x: 0.5, y: 0.5 }, width: 0.1, aspect: 1, colorHex: "#000000", fillHex: null,
    lineWidth: 2, label: "", transform: noTransform(), group: null,
  },
})

const PANE = { width: 800, height: 600 }
const COLUMN = { left: 32, width: 700 }

/** One open note: its clock, its words, its drawing and its history, wired the way App.tsx wires them. */
class Note implements TextHost {
  clock = new EditClock()
  history = new DrawingHistory(this.clock)
  state: EditorState
  drawing: Drawing
  refuse = false

  constructor(doc: string, items: CanvasItem[]) {
    this.state = EditorState.create({ doc, extensions: [history(), textTimeline(this.clock)] })
    this.drawing = { items }
  }

  dispatch(tr: Transaction): void { this.state = tr.state }
  get words(): string { return this.state.doc.toString() }

  type(text: string, at = this.state.doc.length): void {
    this.dispatch(this.state.update({ changes: { from: at, insert: text }, userEvent: "input.type" }))
  }

  draw(item: CanvasItem): void {
    this.history.record(this.drawing)
    this.drawing = { items: [...this.drawing.items, item] }
  }

  deps(): DockDeps {
    return {
      history: this.history,
      drawing: () => this.drawing,
      apply: (next) => { this.drawing = next },
      depth: 0,
      words: {
        cursorOffset: () => this.state.doc.length,
        write: (line, offset) => {
          if (this.refuse) return false
          this.dispatch(this.state.update({
            changes: { from: offset, insert: `${offset > 0 ? "\n" : ""}${line}\n` },
            userEvent: "input.dock", annotations: isolateHistory.of("full"),
          }))
          return true
        },
      },
    }
  }

  step(which: "undo" | "redo") {
    return stepAcross(which, {
      clock: this.clock, text: this, history: this.history,
      current: () => this.drawing, apply: (next) => { this.drawing = next },
    })
  }
}

const ids = (drawing: Drawing): string[] =>
  drawing.items.map((item) => (item.kind === "cell" ? `cell:${item.cell.items.length}` : item.kind === "stroke" ? item.stroke.id
    : item.kind === "image" ? item.image.id : item.kind === "shape" ? item.shape.id : "?"))

describe("dock as a cell: one Undo step", () => {
  it("ink: one Undo puts the strokes back on the page AND takes the line out; Redo docks again", () => {
    const note = new Note("# Title\n\nWords.", [stroke("a"), stroke("b", 0.3), stroke("c", 0.5, 0.6)])
    note.type(" More.")
    const before = { words: note.words, drawing: note.drawing }
    expect(dockAsCell(note.deps(), new Set(["a", "b"]), PANE, COLUMN, note.words.length)).toBe(true)
    const cell = inkCells(note.drawing)[0]!
    expect(note.words).toBe(`${before.words}\n${inkCellMarkdown(cell.id)}\n`)
    expect(ids(note.drawing)).toEqual(["c", "cell:2"])

    expect(note.step("undo")).toBe("both")
    expect(note.words).toBe(before.words)
    expect(note.drawing).toBe(before.drawing)

    expect(note.step("redo")).toBe("both")
    expect(note.words).toContain(inkCellMarkdown(cell.id))
    expect(ids(note.drawing)).toEqual(["c", "cell:2"])

    // And the Undo before the dock is the typing, on its own.
    expect(note.step("undo")).toBe("both")
    expect(note.step("undo")).toBe("text")
    expect(note.words).toBe("# Title\n\nWords.")
    expect(ids(note.drawing)).toEqual(["a", "b", "c"])
  })

  it("one picture: a picture cell line, the picture off the page, one Undo brings it back", () => {
    const note = new Note("Words.", [picture("p"), stroke("s")])
    expect(dockAsCell(note.deps(), new Set(["p"]), PANE, COLUMN, 0)).toBe(true)
    expect(note.words.startsWith(`${pictureMarkdown("0123456789abcdef.png")}\n`)).toBe(true)
    expect(ids(note.drawing)).toEqual(["s"])
    expect(inkCells(note.drawing)).toEqual([])
    expect(note.step("undo")).toBe("both")
    expect(note.words).toBe("Words.")
    expect(ids(note.drawing)).toEqual(["p", "s"])
  })

  it("a picture and ink become one ink cell; a selection with a shape is not docked at all", () => {
    const note = new Note("", [picture("p"), stroke("s"), shape("r")])
    expect(dockAsCell(note.deps(), new Set(["p", "r"]), PANE, COLUMN, 0)).toBe(false)
    expect(note.words).toBe("")
    expect(note.history.canUndo).toBe(false)
    expect(dockAsCell(note.deps(), new Set(["p", "s"]), PANE, COLUMN, 0)).toBe(true)
    const cell = inkCells(note.drawing)[0]!
    expect(cell.items.map((item) => item.kind).sort()).toEqual(["image", "stroke"])
    expect(ids(note.drawing)).toEqual(["r", "cell:2"])
  })

  it("words that cannot be written change nothing, and the unused share does not glue the next edit", () => {
    const note = new Note("Words.", [stroke("a")])
    note.refuse = true
    expect(dockAsCell(note.deps(), new Set(["a"]), PANE, COLUMN, 0)).toBe(false)
    expect(ids(note.drawing)).toEqual(["a"])
    expect(note.history.canUndo).toBe(false)
    // Within the share's two seconds: a letter, then a stroke. Each is its own Undo.
    note.type("!")
    note.draw(stroke("b"))
    expect(note.step("undo")).toBe("drawing")
    expect(note.words).toBe("Words.!")
    expect(note.step("undo")).toBe("text")
    expect(note.words).toBe("Words.")
  })

  it("oneStep: an edit made after a successful step is not part of it", () => {
    const note = new Note("", [])
    expect(oneStep(note.clock, () => { note.type("a"); return true }, () => { note.draw(stroke("x")); return true })).toBe(true)
    note.draw(stroke("y"))
    expect(note.step("undo")).toBe("drawing")
    expect(ids(note.drawing)).toEqual(["x"])
    expect(note.step("undo")).toBe("both")
    expect(note.words).toBe("")
    expect(ids(note.drawing)).toEqual([])
  })
})

describe("an empty ink cell", () => {
  it("is its line and its sidecar item, taken out by one Undo and put back by one Redo", () => {
    const note = new Note("Above.\n\nBelow.", [stroke("a")])
    const id = insertInkCell(note.deps(), 8, 700)
    expect(id).not.toBeNull()
    const cell = inkCellOf(note.drawing, id!)!
    expect(cell.items).toEqual([])
    expect(cell.aspect).toBeCloseTo(200 / 700, 6)
    expect(note.words).toBe(`Above.\n\n\n${inkCellMarkdown(id!)}\nBelow.`)
    expect(note.step("undo")).toBe("both")
    expect(note.words).toBe("Above.\n\nBelow.")
    expect(ids(note.drawing)).toEqual(["a"])
    expect(note.step("redo")).toBe("both")
    expect(inkCellOf(note.drawing, id!)).not.toBeNull()
    note.refuse = true
    expect(insertInkCell(note.deps(), 0, 700)).toBeNull()
    expect(inkCells(note.drawing)).toHaveLength(1)
  })
})

describe("docking into an ink cell", () => {
  it("is drawing-only: one record, one Undo, and the cell grows when the ink passes its bottom", () => {
    const note = new Note("x", [stroke("a"), stroke("b", 0.2, 0.8)])
    const id = insertInkCell(note.deps(), 0, 700)!
    const was = inkCellOf(note.drawing, id)!
    const words = note.words
    expect(dockInto(note.deps(), new Set(["b"]), PANE, id, 700, { x: 100, y: 190 })).toBe(true)
    const now = inkCellOf(note.drawing, id)!
    expect(now.items).toHaveLength(1)
    expect(now.aspect).toBeGreaterThan(was.aspect)
    expect(ids(note.drawing)).toEqual(["a", "cell:1"])
    expect(note.step("undo")).toBe("drawing")
    expect(note.words).toBe(words)
    expect(ids(note.drawing)).toEqual(["a", "b", "cell:0"])
    expect(dockInto(note.deps(), new Set(["b"]), PANE, "no-such-cell", 700, { x: 0, y: 0 })).toBe(false)
  })
})

describe("what an Undo reveals", () => {
  it("changedBox skips hidden items (a cell); changedCells names the cells that changed, came or went", () => {
    const note = new Note("", [])
    const id = insertInkCell(note.deps(), 0, 700)!
    const before = note.drawing
    const cell = inkCellOf(before, id)!
    const after: Drawing = { items: [{ kind: "cell", cell: { ...cell, items: [stroke("in")] } }] }
    expect(isHidden(after.items[0]!)).toBe(true)
    expect(changedBox(before, after, PANE)).toBeNull()
    expect(changedCells(before, after)).toEqual([id])
    expect(changedCells(after, { items: [] })).toEqual([id])
    expect(changedCells(after, after)).toEqual([])
  })
})

describe("a moved note takes its cells' media along", () => {
  it("pictureFiles names each ink cell's snapshot and the pictures inside cells, as the sidecar writes them", () => {
    const note = new Note("", [picture("p", "aaaa.png")])
    const id = insertInkCell(note.deps(), 0, 700)!
    expect(dockAsCell(note.deps(), new Set(["p"]), PANE, COLUMN, 0)).toBe(true)
    const inside: Drawing = { items: [...note.drawing.items, picture("q", "bbbb.jpg")] }
    expect(dockInto({ ...note.deps(), drawing: () => inside }, new Set(["q"]), PANE, id, 700, { x: 50, y: 50 })).toBe(true)
    const json = writeDrawing(note.drawing)
    expect(pictureFiles(json).sort()).toEqual(["bbbb.jpg", `ink-${id}.svg`].sort())
    expect(pictureFiles(JSON.stringify({ items: [{ kind: "cell", id: "../../evil", items: [] }] }))).toEqual([])
  })
})

describe("depthOf: the ../ a picture line needs", () => {
  it("counts the folders between the note and the deepest project folder holding it", () => {
    expect(depthOf("C:\\Notes\\a.md", ["C:\\Notes"], null)).toBe(0)
    expect(depthOf("C:\\Notes\\Sec\\Sub\\a.md", ["C:\\Notes"], null)).toBe(2)
    expect(depthOf("C:\\Notes\\Sec\\a.md", ["C:\\Notes", "C:\\Notes\\Sec"], null)).toBe(0)
    expect(depthOf("c:/notes/sec/a.md", ["C:\\Notes\\"], null)).toBe(1)
    expect(depthOf("D:\\Other\\x\\a.md", ["C:\\Notes"], "D:\\Other")).toBe(1)
    expect(depthOf("E:\\x.md", ["C:\\Notes"], null)).toBe(0)
  })
})
