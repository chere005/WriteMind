/**
 * The box's row of buttons on the tablet sheet, what was left (docs/TODO.md "The buttons under the sheet's box"):
 *
 *  - a pen stroke that STARTS on the row was lost (the feed sent the whole contact to the button it began on): the native
 *    feed now holds a contact begun on `[data-pen-handover]` back until it is a tap (the button's, clicked) or has moved
 *    CLICK_SLOP_PX (the sheet's, from its first point): renderer/penFeed.ts `createDispatcher` + `env.handover`; the mouse
 *    and the window's own pen follow the same rule in BoxActions.tsx (`rowPressToSheet`, boxRow.ts);
 *  - "Bring in as Drawing Cell" keeps the ink where it sat in the box: the box IS the cell (boxRow.ts `landedFrame`,
 *    `cellOfBox`; dock.ts `dockNewInk(..., frame)`).
 *
 * Port-only: the Mac has neither the tablet sheet nor drawing cells, so there is no Swift test to transcribe.
 */

import { describe, expect, it } from "vitest"
import { EditorState, Transaction } from "@codemirror/state"
import { history, isolateHistory } from "@codemirror/commands"
import {
  INK_MIN_HEIGHT, inkCellOf, noTransform, placement, resolveShape, shapeSize, type CanvasItem, type Drawing,
} from "@writemind/core"
import { CLICK_SLOP_PX, createDispatcher, type DispatchEnv, type SynthInit } from "../src/renderer/penFeed"
import { cellOfBox, landedFrame, rowPressToSheet } from "../src/renderer/boxRow"
import { DrawingHistory } from "../src/renderer/drawingHistory"
import { EditClock, stepAcross, textTimeline, type TextHost } from "../src/renderer/editTimeline"
import { dockNewInk, type DockDeps } from "../src/renderer/dock"
import { landStrokes, splitByRegion, type InkStroke } from "../src/renderer/tabletPage"
import type { PenSample } from "../src/shared/pen"

// ---- the native feed: a contact begun on the row ----------------------------------------------------------------------

const sample = (x: number, y: number, o: Partial<PenSample> = {}): PenSample =>
  ({ t: 0, x, y, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "inject", ...o })

/** The sheet at (100, 50) 400 x 200; the box's row lies ON it, y 150 - 170 (a sheet fraction of 0.5 - 0.6). */
function rig({ handover = true }: { handover?: boolean } = {}) {
  const events: { target: string; init: SynthInit }[] = []
  const clicked: string[] = []
  const el = (name: string) => ({ name, isConnected: true } as unknown as Element)
  const sheet = el("sheet"), button = el("row-button")
  const env: DispatchEnv = {
    sheetRect: () => ({ left: 100, top: 50, width: 400, height: 200 }),
    turns: () => 0,
    elementAt: (_x, y) => (y >= 150 && y < 170 ? button : sheet),
    fallbackTarget: () => el("body"),
    dispatch: (target, init) => { events.push({ target: (target as unknown as { name: string }).name, init }) },
    clickable: (target) => (target === button ? ({ click: () => clicked.push("row-button") } as unknown as HTMLElement) : null),
    modifiers: () => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }),
    ...(handover ? { handover: (target: Element) => (target === button ? sheet : null) } : {}),
  }
  return { d: createDispatcher(env), events, clicked }
}
const contact = (events: { target: string; init: SynthInit }[]) =>
  events.filter((e) => ["pointerdown", "pointermove", "pointerup"].includes(e.init.type) && e.init.buttons + (e.init.type === "pointerup" ? 1 : 0) > 0)

describe("the pen feed: a contact begun on the box's row", () => {
  it("that moves is the SHEET's stroke from its first point (pointerdown there, every move, the pointerup); nothing is clicked", () => {
    const { d, events, clicked } = rig()
    // y 0.55 is on the row (sheet y 160); the stroke runs down onto the sheet
    d.batch([sample(0.3, 0.55), sample(0.3, 0.55, { tip: true, p: 0.35 }), sample(0.305, 0.56, { tip: true, p: 0.4 }),
      sample(0.32, 0.62, { tip: true, p: 0.5 }), sample(0.34, 0.75, { tip: true, p: 0.6 }), sample(0.34, 0.75)])
    const touch = contact(events)
    expect(touch.map((e) => e.init.type)).toEqual(["pointerdown", "pointermove", "pointermove", "pointermove", "pointerup"])
    expect(new Set(touch.map((e) => e.target))).toEqual(new Set(["sheet"]))
    const down = touch[0]!.init
    expect([down.clientX, down.clientY, down.pressure, down.button, down.buttons]).toEqual([220, 160, 0.35, 0, 1])
    // the small first move (2 px) is not dropped: it was held, then given to the sheet in order
    expect(touch[1]!.init.clientY).toBeCloseTo(162, 6)
    expect(clicked).toEqual([])
    // the row's button never heard of the contact
    expect(events.filter((e) => e.target === "row-button" && e.init.type !== "pointerover" && e.init.type !== "pointerenter"
      && e.init.type !== "pointermove")).toEqual([])
  })

  it("is held back until it says what it is: nothing is dispatched for the press while it has moved under CLICK_SLOP_PX", () => {
    const { d, events } = rig()
    d.batch([sample(0.3, 0.55), sample(0.3, 0.55, { tip: true, p: 0.4 }), sample(0.3 + 3 / 400, 0.55, { tip: true, p: 0.4 })])
    expect(events.some((e) => e.init.type === "pointerdown")).toBe(false)
    // ...and once it passes the slop it all goes to the sheet at once
    d.batch([sample(0.3 + CLICK_SLOP_PX / 400, 0.55, { tip: true, p: 0.4 })])
    expect(contact(events).map((e) => [e.init.type, e.target])).toEqual([["pointerdown", "sheet"], ["pointermove", "sheet"], ["pointermove", "sheet"]])
  })

  it("a tap (lifted before it moved) is the button's: its pointerdown, moves and pointerup, then ONE click", () => {
    const { d, events, clicked } = rig()
    d.batch([sample(0.3, 0.55), sample(0.3, 0.55, { tip: true, p: 0.4 }), sample(0.3 + 2 / 400, 0.55, { tip: true, p: 0.4 }), sample(0.3 + 2 / 400, 0.55)])
    expect(contact(events).map((e) => [e.init.type, e.target])).toEqual([["pointerdown", "row-button"], ["pointermove", "row-button"], ["pointerup", "row-button"]])
    expect(clicked).toEqual(["row-button"])
  })

  it("a side button held as the pen touches the row and moves: the sheet's too (its box or erase), never a click", () => {
    const { d, events, clicked } = rig()
    d.batch([sample(0.3, 0.55), sample(0.3, 0.55, { lower: true }), sample(0.3, 0.55, { lower: true, tip: true, p: 0.4 }),
      sample(0.4, 0.8, { lower: true, tip: true, p: 0.4 }), sample(0.4, 0.8, { lower: true }), sample(0.4, 0.8)])
    const touch = contact(events)
    // The press in the air went to the row as it happened; the tip's contact, from the touch, is the sheet's: a press in
    // the air at the touch point first (as the sheet has it when the pen comes down with a button held), then the moves.
    expect(touch.filter((e) => e.target === "row-button").map((e) => [e.init.type, e.init.buttons])).toEqual([["pointerdown", 2]])
    const onSheet = touch.filter((e) => e.target === "sheet")
    expect(onSheet.map((e) => e.init.type)).toEqual(["pointerdown", "pointermove", "pointermove", "pointermove", "pointerup"])
    expect([onSheet[0]!.init.button, onSheet[0]!.init.buttons, onSheet[0]!.init.clientX, onSheet[0]!.init.clientY]).toEqual([2, 2, 220, 160])
    expect(onSheet[1]!.init.buttons).toBe(3)
    expect(clicked).toEqual([])
  })

  it("a side button pressed in the air over the row reaches it AT ONCE (the double-tap's timing reads each press then)", () => {
    const { d, events, clicked } = rig()
    d.batch([sample(0.3, 0.55), sample(0.3, 0.55, { lower: true })])
    expect(contact(events).map((e) => [e.init.type, e.target])).toEqual([["pointerdown", "row-button"]])
    d.batch([sample(0.3, 0.55)])
    expect(contact(events).map((e) => [e.init.type, e.target])).toEqual([["pointerdown", "row-button"], ["pointerup", "row-button"]])
    // A tip that touches and lifts again within the slop, with the button held: the row's, never the sheet's.
    d.batch([sample(0.3, 0.55, { lower: true }), sample(0.3, 0.55, { lower: true, tip: true, p: 0.4 }),
      sample(0.3, 0.55, { lower: true }), sample(0.3, 0.55)])
    expect(events.some((e) => e.target === "sheet" && e.init.type === "pointerdown")).toBe(false)
    expect(clicked).toEqual([])
  })

  it("the pen leaving range (or the feed reset) mid-tap ends it on the button, as any contact ends", () => {
    const { d, events } = rig()
    d.batch([sample(0.3, 0.55), sample(0.3, 0.55, { tip: true, p: 0.4 })])
    d.reset()
    expect(contact(events).map((e) => [e.init.type, e.target])).toEqual([["pointerdown", "row-button"], ["pointerup", "row-button"]])
  })

  it("with no handover in the page (no row over the sheet) a contact keeps the element it began on, as before", () => {
    const { d, events, clicked } = rig({ handover: false })
    d.batch([sample(0.3, 0.55, { tip: true, p: 0.4 }), sample(0.3, 0.8, { tip: true, p: 0.4 }), sample(0.3, 0.8)])
    expect(new Set(contact(events).map((e) => e.target))).toEqual(new Set(["row-button"]))
    expect(clicked).toEqual([])
  })
})

describe("rowPressToSheet: the mouse's (and the window pen's) press on the row", () => {
  const sheet = { left: 100, top: 50, width: 400, height: 200 }
  it("is the sheet's once it has moved CLICK_SLOP_PX from where it began over the sheet", () => {
    expect(rowPressToSheet(sheet, { x: 200, y: 160 }, { x: 200 + CLICK_SLOP_PX - 0.5, y: 160 }, CLICK_SLOP_PX)).toBe(false)
    expect(rowPressToSheet(sheet, { x: 200, y: 160 }, { x: 200, y: 160 + CLICK_SLOP_PX }, CLICK_SLOP_PX)).toBe(true)
  })
  it("never when it began off the sheet (the row in the pane's margin under a whole-sheet box keeps its presses)", () => {
    expect(rowPressToSheet(sheet, { x: 200, y: 260 }, { x: 200, y: 150 }, CLICK_SLOP_PX)).toBe(false)
  })
})

// ---- Bring in as Drawing Cell: the box is the cell ------------------------------------------------------------------

const PANE = { width: 800, height: 600 }
const stroke = (id: string, points: { x: number; y: number }[], width = 2): CanvasItem => ({
  kind: "stroke",
  stroke: { id, colorHex: "#1D2B3A", width, points, pressures: points.map(() => 0.5), transform: noTransform(), group: null },
})
const cellPoints = (items: CanvasItem[], w: number) =>
  items.flatMap((item) => (item.kind === "stroke" ? item.stroke.points.map((p) => ({ x: p.x * w, y: p.y * w })) : []))

describe("cellOfBox: the ink keeps where it sat in the box", () => {
  it("the box's top-left is the cell's (less a hair of air), the cell as tall as the box", () => {
    // the box landed at (100, 80) 300 x 150 px; ink 60 px in and 40 px down from its corner
    const frame = { x: 100, y: 80, width: 300, height: 150 }
    const ink = stroke("a", [{ x: 160 / 800, y: 120 / 600 }, { x: 220 / 800, y: 150 / 600 }])
    const cell = cellOfBox([ink], PANE, frame, 700)!
    const air = 2   // half the 2 px pen, and a pixel
    const pts = cellPoints(cell.items, 700)
    expect(pts[0]!.x).toBeCloseTo(air + 60, 6)
    expect(pts[0]!.y).toBeCloseTo(air + 40, 6)
    expect(pts[1]!.x).toBeCloseTo(air + 120, 6)
    expect(cell.aspect * 700).toBeCloseTo(150 + 2 * air, 6)
    const first = cell.items[0]!
    expect(first.kind === "stroke" && first.stroke.pressures).toEqual([0.5, 0.5])
    expect(first.kind === "stroke" && first.stroke.width).toBe(2)
  })

  it("a box wider than the column is scaled down whole (ink, gaps and pen widths) to fit across it", () => {
    const frame = { x: 0, y: 0, width: 800, height: 400 }
    const ink = stroke("a", [{ x: 400 / 800, y: 200 / 600 }, { x: 600 / 800, y: 200 / 600 }], 4)
    const cell = cellOfBox([ink], PANE, frame, 406)!   // 406 = 400 across + 3 px of air either side
    const k = 0.5
    const pts = cellPoints(cell.items, 406)
    expect(pts[0]!.x).toBeCloseTo(3 + 400 * k, 6)
    expect(pts[0]!.y).toBeCloseTo(3 + 200 * k, 6)
    expect(pts[1]!.x - pts[0]!.x).toBeCloseTo(200 * k, 6)
    expect(cell.aspect * 406).toBeCloseTo(400 * k + 6, 6)
    const first = cell.items[0]!
    expect(first.kind === "stroke" && first.stroke.width).toBeCloseTo(2, 6)
  })

  it("a flat box still makes a cell a line and a half tall; nothing to place or not a plain stroke: null", () => {
    const flat = cellOfBox([stroke("a", [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }])], PANE, { x: 150, y: 115, width: 200, height: 10 }, 700)!
    expect(flat.aspect * 700).toBeCloseTo(INK_MIN_HEIGHT, 6)
    expect(cellOfBox([], PANE, { x: 0, y: 0, width: 10, height: 10 }, 700)).toBeNull()
    const base = stroke("b", [{ x: 0.2, y: 0.2 }])
    const turned: CanvasItem = base.kind === "stroke" ? { kind: "stroke", stroke: { ...base.stroke, transform: { dx: 0, dy: 0, scale: 1, rotation: 0.3 } } } : base
    expect(cellOfBox([turned], PANE, { x: 0, y: 0, width: 100, height: 100 }, 700)).toBeNull()
  })
})

describe("landedFrame + landStrokes: what the sheet hands the cell", () => {
  it("the strokes land inside the landed box exactly where they sat in the dashed box", () => {
    const units = { width: 1000, height: 625 }
    const pageSize = shapeSize(resolveShape(1.6, null), false)
    const region = { x: 0.4, y: 0.2, width: 0.3, height: 0.25 }
    // a word 0.05 / 0.08 of the sheet in from the box's corner
    const word: InkStroke = { colorHex: "#000000", width: 2, points: [{ x: 0.45, y: 0.28 }, { x: 0.6, y: 0.3 }, { x: 0.62, y: 0.4 }] }
    const inside = splitByRegion([word], region).inside
    const onPage = { x: region.x * pageSize.width, y: region.y * pageSize.height, width: region.width * pageSize.width, height: region.height * pageSize.height }
    const frame = landedFrame(onPage, pageSize, PANE)
    const scale = frame.width * PANE.width / onPage.width   // pane px per page px
    // landed as Writing lands them (the ink's own frame, as takeFromSheet does): the box frame is independent of it
    const inkFrame = { x: 0.45 * pageSize.width - 3, y: 0.28 * pageSize.height - 3, width: 0.17 * pageSize.width + 6, height: 0.12 * pageSize.height + 6 }
    const where = placement({ frame: inkFrame, pageSize, pane: PANE, nudge: 0 })
    const landed = landStrokes(inside, { surface: units, pageSize, frame: inkFrame, where, pane: PANE })
    const first = landed[0]!
    if (first.kind !== "stroke") throw new Error("not a stroke")
    const p = first.stroke.points[0]!
    expect(p.x * PANE.width - frame.x * PANE.width).toBeCloseTo((0.45 - 0.4) * pageSize.width * scale, 6)
    expect(p.y * PANE.height - frame.y * PANE.height).toBeCloseTo((0.28 - 0.2) * pageSize.height * scale, 6)
    // the landed box keeps the dashed box's shape
    expect((frame.height * PANE.height) / (frame.width * PANE.width)).toBeCloseTo(onPage.height / onPage.width, 6)
  })
})

// ---- dockNewInk with the box's frame, against the note's real histories (as boxActions.test.ts wires them) -----------

class Note implements TextHost {
  clock = new EditClock()
  history = new DrawingHistory(this.clock)
  state: EditorState
  drawing: Drawing = { items: [] }
  constructor(doc: string) { this.state = EditorState.create({ doc, extensions: [history(), textTimeline(this.clock)] }) }
  dispatch(tr: Transaction): void { this.state = tr.state }
  get words(): string { return this.state.doc.toString() }
  deps(): DockDeps {
    return {
      history: this.history, drawing: () => this.drawing, apply: (next) => { this.drawing = next }, depth: 0,
      words: {
        cursorOffset: () => this.state.doc.length,
        write: (line, offset) => {
          this.dispatch(this.state.update({ changes: { from: offset, insert: `\n${line}\n\n` }, userEvent: "input.dock", annotations: isolateHistory.of("full") }))
          return true
        },
      },
    }
  }
  step(which: "undo" | "redo") {
    return stepAcross(which, { clock: this.clock, text: this, history: this.history, current: () => this.drawing, apply: (next) => { this.drawing = next } })
  }
}

describe("dockNewInk with the box's frame", () => {
  it("makes the box the cell (ink where it sat in it, not at the left pad), in ONE Undo step", () => {
    const note = new Note("Words.")
    // the box landed at 0.25 / 0.2 of the pane, 0.375 x 0.25 (300 x 150 px); the ink 80 px in, 30 px down
    const frame = { x: 0.25, y: 0.2, width: 0.375, height: 0.25 }
    const ink = stroke("a", [{ x: 280 / 800, y: 150 / 600 }, { x: 330 / 800, y: 170 / 600 }])
    const id = dockNewInk(note.deps(), [ink], PANE, { left: 32, width: 700 }, 6, frame)!
    const cell = inkCellOf(note.drawing, id)!
    const pts = cellPoints(cell.items, 700)
    expect(pts[0]!.x).toBeCloseTo(2 + 80, 6)
    expect(pts[0]!.y).toBeCloseTo(2 + 30, 6)
    expect(cell.aspect * 700).toBeCloseTo(150 + 4, 6)
    expect(note.step("undo")).toBe("both")
    expect(note.words).toBe("Words.")
    expect(inkCellOf(note.drawing, id)).toBeNull()
  })
})
