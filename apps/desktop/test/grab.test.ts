import { describe, expect, it } from "vitest"
import {
  displayFraction, parseOrientation, rotateSheetPoint, screenToSheet, sheetAspectFor, sheetPixel, sheetToScreen,
  tabletToSheet, turnsOf, ORIENTATIONS, type Turns,
} from "../src/shared/orientation"
import { CURSOR_GRACE_MS, GrabModes, MOUSE_AFTER_PEN_MS, WATCHDOG_MS } from "../src/shared/grab"
import { TabletPage, type InkStroke } from "../src/renderer/tabletPage"

const near = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x, 9)
  expect(a.y).toBeCloseTo(y, 9)
}

describe("tablet orientation: the tablet's place on the screen, as a place on the sheet", () => {
  it("offers Wacom's four turns and Match screen, in that wording", () => {
    expect(ORIENTATIONS.map((o) => o.label)).toEqual([
      "Match screen", "Landscape (0°)", "Portrait (90° clockwise)", "Landscape flipped (180°)", "Portrait flipped (270°)",
    ])
  })

  it("parses what was stored; anything else is Match screen", () => {
    expect(parseOrientation("match")).toBe("match")
    expect(parseOrientation("0")).toBe(0)
    expect(parseOrientation("1")).toBe(1)
    expect(parseOrientation(3)).toBe(3)
    expect(parseOrientation("4")).toBe("match")
    expect(parseOrientation("")).toBe("match")
    expect(parseOrientation(null)).toBe("match")
    expect(turnsOf("match")).toBe(0)
    expect(turnsOf(2)).toBe(2)
  })

  it("the sheet is landscape on a landscape display unless the tablet is turned a quarter turn", () => {
    const screen = 1920 / 1200
    expect(sheetAspectFor(screen, 0)).toBeCloseTo(1.6, 9)
    expect(sheetAspectFor(screen, 2)).toBeCloseTo(1.6, 9)
    expect(sheetAspectFor(screen, 1)).toBeCloseTo(1 / 1.6, 9)
    expect(sheetAspectFor(screen, 3)).toBeCloseTo(1 / 1.6, 9)
  })

  // The display's corners, as the sheet's corners. Rows: turns 0..3. Order: TL, TR, BR, BL of the DISPLAY.
  const TL = { x: 0, y: 0 }, TR = { x: 1, y: 0 }, BR = { x: 1, y: 1 }, BL = { x: 0, y: 1 }
  const expected: Record<Turns, [number, number][]> = {
    0: [[0, 0], [1, 0], [1, 1], [0, 1]],
    1: [[1, 0], [1, 1], [0, 1], [0, 0]],
    2: [[1, 1], [0, 1], [0, 0], [1, 0]],
    3: [[0, 1], [0, 0], [1, 0], [1, 1]],
  }
  for (const turns of [0, 1, 2, 3] as Turns[]) {
    it(`${turns * 90} degrees clockwise: each display corner is the right sheet corner, and it inverts`, () => {
      ;[TL, TR, BR, BL].forEach((corner, i) => {
        const sheet = screenToSheet(corner, turns)
        near(sheet, expected[turns][i]![0], expected[turns][i]![1])
        near(sheetToScreen(sheet, turns), corner.x, corner.y)
      })
    })
  }

  it("a stroke drawn UP on a tablet turned clockwise comes out upright on the sheet", () => {
    // Tablet turned 90 clockwise: the person's 'up' is the tablet's original left-to-right? No: the tablet's
    // original right edge is at the person's bottom, so drawing from the person's bottom to top runs from
    // the tablet's right edge (x=1) to its left edge (x=0), at a fixed height.
    const from = screenToSheet({ x: 1, y: 0.5 }, 1), to = screenToSheet({ x: 0, y: 0.5 }, 1)
    near(from, 0.5, 1)
    near(to, 0.5, 0)
  })

  it("a quarter turn four times is no turn; ink rotates the same way the mapping does", () => {
    let p = { x: 0.2, y: 0.7 }
    for (let i = 0; i < 4; i++) p = rotateSheetPoint(p, 1)
    near(p, 0.2, 0.7)
    near(rotateSheetPoint({ x: 0.2, y: 0.7 }, 2), 0.8, 0.3)
    near(rotateSheetPoint({ x: 0.2, y: 0.7 }, 3), 0.7, 0.8)
  })

  it("the first and last PHYSICAL pixel of the display are the tablet's edges, at 100% and at 150%", () => {
    near(displayFraction({ x: 0, y: 0 }, { width: 1920, height: 1200 }), 0, 0)
    near(displayFraction({ x: 1919, y: 1199 }, { width: 1920, height: 1200 }), 1, 1)
    // 150%: 1280 x 800 CSS px = 1920 x 1200 physical; the last physical pixel is 1919 / 1.5 CSS.
    near(displayFraction({ x: 1919 / 1.5, y: 1199 / 1.5 }, { width: 1280, height: 800 }, 1.5), 1, 1)
    near(displayFraction({ x: 960 / 1.5, y: 600 / 1.5 }, { width: 1280, height: 800 }, 1.5), 960 / 1919, 600 / 1199)
    // Outside the display (a captured pen) is held at the edge.
    near(displayFraction({ x: -5, y: 5000 }, { width: 1920, height: 1200 }), 0, 1)
  })

  it("the whole chain: a pen at the display's corner lands on the sheet rectangle's corner", () => {
    const rect = { x: 1000, y: 100, width: 400, height: 250 }
    const at = (x: number, y: number, turns: Turns) =>
      sheetPixel(tabletToSheet(displayFraction({ x, y }, { width: 1920, height: 1200 }), turns), rect)
    near(at(0, 0, 0), 1000, 100)
    near(at(1919, 1199, 0), 1400, 350)
    // Turned 90: the display's top-left is the sheet's top-right.
    near(at(0, 0, 1), 1400, 100)
    near(at(1919, 0, 1), 1400, 350)
  })
})

describe("grab modes: pen or mouse, no stuck states", () => {
  it("starts in mouse mode (nothing is held), and a pen takes the sheet", () => {
    const m = new GrabModes(0)
    expect(m.mode).toBe("mouse")
    expect(m.pen(100)).toBe(true)
    expect(m.mode).toBe("pen")
    expect(m.pen(120)).toBe(false)
  })

  it("a real mouse event lets the mouse through, unless it is the pen's own echo or a stroke is down", () => {
    const m = new GrabModes(0)
    m.pen(1000)
    expect(m.mouseCaptured(1000 + MOUSE_AFTER_PEN_MS - 10)).toBe(false)
    expect(m.mode).toBe("pen")
    m.penDown = true
    expect(m.mouseCaptured(5000)).toBe(false)
    m.penDown = false
    expect(m.mouseCaptured(5000)).toBe(true)
    expect(m.mode).toBe("mouse")
  })

  it("the cursor moving with no mouse move behind it is the pen; mouse movement is not", () => {
    const m = new GrabModes(0)
    m.cursorAt(10, 10, 0)
    m.cursorAt(300, 200, 1000)
    m.mouseForwarded(1020)
    expect(m.tick(1000 + CURSOR_GRACE_MS + 10)).toBe(false)
    expect(m.mode).toBe("mouse")
    m.cursorAt(600, 400, 2000)
    expect(m.tick(2000 + CURSOR_GRACE_MS + 10)).toBe(true)
    expect(m.mode).toBe("pen")
  })

  it("jitter is not movement", () => {
    const m = new GrabModes(0)
    m.cursorAt(10, 10, 0)
    m.cursorAt(11, 11, 100)
    expect(m.tick(1000)).toBe(false)
    expect(m.mode).toBe("mouse")
  })

  it("the watchdog lets go after 20 seconds with no pen, but never under a stroke", () => {
    const m = new GrabModes(0)
    m.pen(1000)
    expect(m.tick(1000 + WATCHDOG_MS - 1)).toBe(false)
    m.penDown = true
    expect(m.tick(1000 + WATCHDOG_MS + 5000)).toBe(false)
    m.penDown = false
    expect(m.tick(1000 + WATCHDOG_MS + 5001)).toBe(true)
    expect(m.mode).toBe("mouse")
  })

  it("a lock pins the mode: pen-only never lets the mouse through, and the watchdog cannot release it", () => {
    const m = new GrabModes(0, "pen")
    m.setLock("pen", 0)
    expect(m.mouseCaptured(5000)).toBe(false)
    expect(m.tick(WATCHDOG_MS * 3)).toBe(false)
    expect(m.mode).toBe("pen")
    m.setLock(null, 10)
    expect(m.tick(WATCHDOG_MS * 4)).toBe(true)
  })
})

describe("the sheet's operations keep two views identical, history included", () => {
  const stroke = (n: number): InkStroke => ({ colorHex: "#000000", width: 3, points: [{ x: n / 10, y: 0.1 }, { x: n / 10, y: 0.9 }] })

  it("replaying the ops one view heard makes the other view the same, and undo works there", () => {
    const a = new TabletPage(1.6), b = new TabletPage(1.6)
    a.onOp((op) => b.apply(op))
    a.add(stroke(1)); a.add(stroke(2)); a.add(stroke(3))
    a.mark(); a.removeAt(1)
    expect(b.strokes).toEqual(a.strokes)
    a.undo()
    expect(b.strokes).toEqual(a.strokes)
    expect(b.strokes).toHaveLength(3)
    a.replace([])
    expect(b.strokes).toHaveLength(0)
    a.undo()
    expect(b.strokes).toEqual(a.strokes)
    expect(a.canUndo).toBe(b.canUndo)
  })

  it("an applied op is not announced again (no echo)", () => {
    const a = new TabletPage(1.6)
    const heard: string[] = []
    a.onOp((op) => heard.push(op.op))
    a.apply({ op: "add", stroke: stroke(1) })
    expect(heard).toEqual([])
    expect(a.strokes).toHaveLength(1)
    expect(a.canUndo).toBe(true)
  })

  it("the state, history and all, can be handed to another view", () => {
    const a = new TabletPage(1.6), b = new TabletPage(1.6)
    a.add(stroke(1)); a.add(stroke(2)); a.undo()
    b.importState(a.exportState())
    expect(b.canRedo).toBe(true)
    b.redo()
    expect(b.strokes).toHaveLength(2)
  })

  it("changing the sheet's shape never touches the ink; rotating is asked for", () => {
    const page = new TabletPage(1.6)
    page.add(stroke(3))
    const before = JSON.stringify(page.strokes)
    page.setAspect(1 / 1.6)
    expect(page.aspect).toBeCloseTo(0.625, 9)
    expect(JSON.stringify(page.strokes)).toBe(before)
    page.rotateInk(1)
    expect(page.strokes[0]!.points[0]!.x).toBeCloseTo(0.9, 9)
    expect(page.strokes[0]!.points[0]!.y).toBeCloseTo(0.3, 9)
    page.undo()
    expect(JSON.stringify(page.strokes)).toBe(before)
  })
})

describe("the global hook: pen or mouse wherever the cursor is", () => {
  it("a pen signature is PEN at once; an unsigned event is MOUSE at once", () => {
    const m = new GrabModes(0)
    m.hooked = true
    expect(m.penSignature(100)).toBe(true)
    expect(m.mode).toBe("pen")
    expect(m.realMouse(100 + MOUSE_AFTER_PEN_MS + 1)).toBe(true)
    expect(m.mode).toBe("mouse")
    expect(m.penSignature(1000)).toBe(true)
  })

  it("the pen's own echo and a stroke under way hold the mode", () => {
    const m = new GrabModes(0)
    m.hooked = true
    m.penSignature(1000)
    expect(m.realMouse(1000 + MOUSE_AFTER_PEN_MS - 5)).toBe(false)
    m.penDown = true
    expect(m.realMouse(9000)).toBe(false)
    expect(m.mode).toBe("pen")
    m.penDown = false
    expect(m.realMouse(9000)).toBe(true)
  })

  it("with the hook the guesses are off: the cursor rule and overlay-mouse do nothing", () => {
    const m = new GrabModes(0)
    m.hooked = true
    m.cursorAt(0, 0, 0); m.cursorAt(500, 500, 100)
    expect(m.tick(1000)).toBe(false)
    m.penSignature(2000)
    expect(m.mouseCaptured(5000)).toBe(false)
    expect(m.mode).toBe("pen")
  })

  it("a lock still wins over the hook", () => {
    const m = new GrabModes(0, "pen")
    m.hooked = true
    m.setLock("pen", 0)
    expect(m.realMouse(9000)).toBe(false)
    expect(m.mode).toBe("pen")
  })
})
