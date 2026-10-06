/**
 * The row of buttons under the tablet sheet's box (Sean, 2026-10-05: "under the selection box, have buttons for erase
 * selection, bring in writing, bring in writing (straight to a docked drawing cell at or after the input cursor"):
 * renderer/boxRow.ts (where the row goes, what Erase leaves) and renderer/dock.ts `dockNewInk` (the sheet's
 * writing as a NEW drawing cell, one Undo step in the note).
 *
 * Port-only: the Mac has neither the tablet sheet nor drawing cells, so there is no Swift test to transcribe.
 */

import { describe, expect, it } from "vitest"
import { EditorState, Transaction } from "@codemirror/state"
import { history, isolateHistory } from "@codemirror/commands"
import {
  INK_PAD, inkCellMarkdown, inkCellOf, inkCells, noTransform, type CanvasItem, type Drawing,
} from "@writemind/core"
import { eraseRegion, placeRow, ROW_GAP } from "../src/renderer/boxRow"
import { DrawingHistory } from "../src/renderer/drawingHistory"
import { EditClock, stepAcross, textTimeline, type TextHost } from "../src/renderer/editTimeline"
import { dockNewInk, type DockDeps } from "../src/renderer/dock"
import { splitByRegion, type InkStroke } from "../src/renderer/tabletPage"

const SHEET = { width: 800, height: 500 }
const ROW = { width: 300, height: 22 }

describe("placeRow: the row under the box", () => {
  it("goes centred under the box, a gap below it", () => {
    const box = { x: 0.25, y: 0.2, width: 0.5, height: 0.3 }
    const place = placeRow(box, SHEET, ROW)
    expect(place.side).toBe("below")
    expect(place.top).toBeCloseTo(0.5 * 500 + ROW_GAP, 6)
    expect(place.left + ROW.width / 2).toBeCloseTo(400, 6)
  })

  it("flips ABOVE the box at the sheet's bottom edge, and never covers it", () => {
    const box = { x: 0.1, y: 0.6, width: 0.3, height: 0.38 }
    const place = placeRow(box, SHEET, ROW)
    expect(place.side).toBe("above")
    expect(place.top + ROW.height).toBeLessThanOrEqual(0.6 * 500 - ROW_GAP + 1e-9)
  })

  it("stays inside the sheet across: a box at the left or right edge pulls the row in", () => {
    const left = placeRow({ x: 0, y: 0.1, width: 0.1, height: 0.1 }, SHEET, ROW)
    expect(left.left).toBe(ROW_GAP)
    const right = placeRow({ x: 0.9, y: 0.1, width: 0.1, height: 0.1 }, SHEET, ROW)
    expect(right.left + ROW.width).toBe(SHEET.width - ROW_GAP)
  })

  it("the whole sheet boxed: in the pane's margin just under the sheet, off the box; over it when only that has room", () => {
    const whole = { x: 0, y: 0, width: 1, height: 1 }
    const under = placeRow(whole, SHEET, ROW, ROW_GAP, { above: 100, below: 100 })
    expect(under.side).toBe("below")
    expect(under.top).toBeGreaterThanOrEqual(SHEET.height)
    const over = placeRow(whole, SHEET, ROW, ROW_GAP, { above: 40, below: 10 })
    expect(over.side).toBe("above")
    expect(over.top + ROW.height).toBeLessThanOrEqual(0)
  })

  it("the whole sheet boxed and no margin round it either: inside the box, on its bottom edge, on the sheet", () => {
    const place = placeRow({ x: 0, y: 0, width: 1, height: 1 }, SHEET, ROW)
    expect(place.side).toBe("inside")
    expect(place.top + ROW.height).toBeLessThanOrEqual(SHEET.height - ROW_GAP + 1e-9)
    expect(place.top).toBeGreaterThanOrEqual(ROW_GAP)
  })
})

const stroke = (points: [number, number][], width = 2): InkStroke => ({
  colorHex: "#1D2B3A", width, points: points.map(([x, y]) => ({ x, y })), pressures: points.map(() => 0.5),
})

describe("eraseRegion: the box's Erase", () => {
  const word1 = stroke([[0.1, 0.1], [0.15, 0.12], [0.2, 0.1]])
  const word2 = stroke([[0.6, 0.1], [0.65, 0.12], [0.7, 0.1]])
  const across = stroke([[0.3, 0.5], [0.45, 0.5], [0.55, 0.5], [0.7, 0.5]])
  const box = { x: 0.4, y: 0.05, width: 0.4, height: 0.5 }

  it("takes what is inside the box, keeps what is not (the same objects), and counts what it touched", () => {
    const out = eraseRegion([word1, word2], box)
    expect(out.removed).toBe(1)
    expect(out.strokes).toEqual([word1])
    expect(out.strokes[0]).toBe(word1)
  })

  it("cuts a stroke across the box's edge exactly as the Writing capture does (its outside part stays)", () => {
    const out = eraseRegion([word1, across], box)
    expect(out.removed).toBe(1)
    expect(out.strokes[0]).toBe(word1)
    expect(out.strokes.slice(1)).toEqual(splitByRegion([across], box).outside)
    expect(out.strokes[1]!.points).toEqual([{ x: 0.3, y: 0.5 }])
  })

  it("nothing in the box: nothing removed, the very same list", () => {
    const strokes = [word1]
    const out = eraseRegion(strokes, box)
    expect(out.removed).toBe(0)
    expect(out.strokes).toBe(strokes)
  })
})

// ---- dockNewInk: one Undo step, against the note's real histories (as dockUndo.test.ts wires them).

const PANE = { width: 800, height: 600 }
const COLUMN = { left: 32, width: 700 }

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
  deps(): DockDeps {
    return {
      history: this.history, drawing: () => this.drawing, apply: (next) => { this.drawing = next }, depth: 0,
      words: {
        cursorOffset: () => this.state.doc.length,
        write: (line, offset) => {
          if (this.refuse) return false
          this.dispatch(this.state.update({
            changes: { from: offset, insert: `\n${line}\n\n` }, userEvent: "input.dock", annotations: isolateHistory.of("full"),
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

/** Ink landed on the pane as Bring in Writing lands it: fractions of the pane. */
const landed = (id: string, x: number, y: number, w = 0.1, h = 0.05): CanvasItem => ({
  kind: "stroke",
  stroke: {
    id, colorHex: "#1D2B3A", width: 2, points: [{ x, y }, { x: x + w, y: y + h }, { x: x + w / 2, y: y + h }],
    pressures: [0.3, 0.6, 0.4], transform: noTransform(), group: null,
  },
})

describe("dockNewInk: the sheet's writing as a new drawing cell", () => {
  it("writes the cell's line at the seam and its item in ONE Undo step; the page keeps what it had", () => {
    const keep = landed("page", 0.5, 0.5)
    const note = new Note("A paragraph.\n\nAnother one.", [keep])
    const id = dockNewInk(note.deps(), [landed("a", 0.2, 0.1), landed("b", 0.35, 0.12)], PANE, COLUMN, 12)
    expect(id).not.toBeNull()
    expect(note.words).toBe(`A paragraph.\n${inkCellMarkdown(id!)}\n\n\n\nAnother one.`)
    const cell = inkCellOf(note.drawing, id!)!
    expect(cell.items.map((item) => item.kind)).toEqual(["stroke", "stroke"])
    expect(note.drawing.items[0]).toBe(keep)

    expect(note.step("undo")).toBe("both")
    expect(note.words).toBe("A paragraph.\n\nAnother one.")
    expect(inkCells(note.drawing)).toEqual([])
    expect(note.drawing.items).toEqual([keep])
    expect(note.step("redo")).toBe("both")
    expect(inkCellOf(note.drawing, id!)).not.toBeNull()
  })

  it("keeps the strokes' shape and size, the cell's height fitted to the ink with its pads", () => {
    const note = new Note("", [])
    const items = [landed("a", 0.2, 0.1, 0.1, 0.05), landed("b", 0.4, 0.2, 0.1, 0.05)]
    const id = dockNewInk(note.deps(), items, PANE, COLUMN, 0)!
    const cell = inkCellOf(note.drawing, id)!
    // The ink is 0.3 of the pane across (240 px) and 0.15 down (90 px): the cell is 90 + 2 pads tall (and the pen's
    // own width, which the ink's box takes in).
    const tall = cell.aspect * COLUMN.width
    expect(tall).toBeGreaterThanOrEqual(90 + 2 * INK_PAD - 1e-6)
    expect(tall).toBeLessThanOrEqual(90 + 2 * INK_PAD + 2 + 1e-6)
    const xs = cell.items.flatMap((item) => (item.kind === "stroke" ? item.stroke.points.map((p) => p.x * COLUMN.width) : []))
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(240, 6)
    // Where it sat on the sheet means nothing in the note: the ink starts at the cell's left pad (its box takes in half
    // the pen's 2 px, so the points start 1 px further in).
    expect(Math.min(...xs)).toBeCloseTo(INK_PAD + 1, 6)
    // Pressures and widths come along unchanged.
    const first = cell.items[0]!
    expect(first.kind === "stroke" && first.stroke.pressures).toEqual([0.3, 0.6, 0.4])
    expect(first.kind === "stroke" && first.stroke.width).toBe(2)
  })

  it("no ink, or words that would not take the line: nothing changes", () => {
    const note = new Note("Words.", [])
    expect(dockNewInk(note.deps(), [], PANE, COLUMN, 0)).toBeNull()
    note.refuse = true
    expect(dockNewInk(note.deps(), [landed("a", 0.1, 0.1)], PANE, COLUMN, 0)).toBeNull()
    expect(note.words).toBe("Words.")
    expect(note.drawing.items).toEqual([])
    expect(note.history.canUndo).toBe(false)
  })
})
