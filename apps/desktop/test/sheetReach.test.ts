// The reach hint arithmetic (renderer/reachGeometry.ts) and the two presentational components, rendered to static markup.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import SheetReach from "../src/renderer/SheetReach"
import SheetStrip, { containedTag, type SheetStripProps } from "../src/renderer/SheetStrip"
import { allowedRect, normalise, outsideBands, reachRects, reachShare, toSheetRect, type Rect01 } from "../src/renderer/reachGeometry"

// Sean's saved window: 1280 x 800 at (320, 185) on a 1920 x 1200 display, taskbar 40 px at the bottom.
const COVER: Rect01 = { x0: 320 / 1920, y0: 185 / 1200, x1: 1600 / 1920, y1: 985 / 1200 }
const WORK: Rect01 = { x0: 0, y0: 0, x1: 1, y1: 1160 / 1200 }

describe("normalise", () => {
  it("orders the corners and clamps into the display", () => {
    expect(normalise({ x0: 0.8, y0: 0.9, x1: -0.2, y1: 0.1 })).toEqual({ x0: 0, y0: 0.1, x1: 0.8, y1: 0.9 })
  })
  it("empty, NaN and missing are no rectangle", () => {
    expect(normalise(null)).toBeNull()
    expect(normalise(undefined)).toBeNull()
    expect(normalise({ x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.8 })).toBeNull()
    expect(normalise({ x0: Number.NaN, y0: 0, x1: 1, y1: 1 })).toBeNull()
  })
})

describe("outsideBands", () => {
  it("the four bands around a window, and none when it covers the display", () => {
    expect(outsideBands({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 })).toEqual([
      { x0: 0, y0: 0, x1: 1, y1: 0.25 },
      { x0: 0, y0: 0.75, x1: 1, y1: 1 },
      { x0: 0, y0: 0.25, x1: 0.25, y1: 0.75 },
      { x0: 0.75, y0: 0.25, x1: 1, y1: 0.75 },
    ])
    expect(outsideBands({ x0: 0, y0: 0, x1: 1, y1: 1 })).toEqual([])
  })
  it("a maximised window leaves only the taskbar band", () => {
    const bands = outsideBands(WORK)
    expect(bands.length).toBe(1)
    expect(bands[0]).toMatchObject({ x0: 0, x1: 1, y0: 1160 / 1200, y1: 1 })
  })
})

describe("toSheetRect: a rectangle stays a rectangle through every orientation", () => {
  const r: Rect01 = { x0: 0, y0: 0.9, x1: 1, y1: 1 } // the bottom band of the display
  it("0: unchanged", () => expect(toSheetRect(r, 0)).toEqual(r))
  it("2: the band is at the top", () => {
    const s = toSheetRect(r, 2)
    expect(s.y0).toBeCloseTo(0); expect(s.y1).toBeCloseTo(0.1); expect(s.x0).toBeCloseTo(0); expect(s.x1).toBeCloseTo(1)
  })
  it("1: the band becomes a column on the left (portrait, turned 90 degrees clockwise)", () => {
    const s = toSheetRect(r, 1)
    expect(s.x0).toBeCloseTo(0); expect(s.x1).toBeCloseTo(0.1); expect(s.y0).toBeCloseTo(0); expect(s.y1).toBeCloseTo(1)
  })
  it("3: the band becomes a column on the right", () => {
    const s = toSheetRect(r, 3)
    expect(s.x0).toBeCloseTo(0.9); expect(s.x1).toBeCloseTo(1); expect(s.y0).toBeCloseTo(0); expect(s.y1).toBeCloseTo(1)
  })
  it("area is preserved", () => {
    for (const t of [0, 1, 2, 3] as const) {
      const s = toSheetRect({ x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.9 }, t)
      expect((s.x1 - s.x0) * (s.y1 - s.y0)).toBeCloseTo(0.3 * 0.7, 9)
    }
  })
})

describe("reachRects", () => {
  it("without the sink, everything outside the window is hatched", () => {
    const rects = reachRects({ cover: COVER, work: WORK, turns: 0, containedBySink: false })
    expect(rects.length).toBe(4)
    const covered = rects.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0)
    expect(covered).toBeCloseTo(1 - (1280 / 1920) * (800 / 1200), 6)
  })
  it("with the sink on, only the taskbar band is hatched", () => {
    const rects = reachRects({ cover: COVER, work: WORK, turns: 0, containedBySink: true })
    expect(rects.length).toBe(1)
    expect(rects[0]!.y0).toBeCloseTo(1160 / 1200)
  })
  it("no geometry, no hint", () => {
    expect(reachRects({ cover: null, work: null, turns: 0, containedBySink: false })).toEqual([])
    expect(reachRects({ cover: null, work: WORK, turns: 0, containedBySink: false })).toEqual([])
    expect(reachRects({ cover: COVER, work: null, turns: 0, containedBySink: true })).toEqual([])
  })
  it("a window that covers the whole display needs none", () => {
    expect(reachRects({ cover: { x0: 0, y0: 0, x1: 1, y1: 1 }, work: WORK, turns: 0, containedBySink: false })).toEqual([])
  })
  it("allowedRect picks the work area for the sink and the window otherwise", () => {
    expect(allowedRect({ cover: COVER, work: WORK, containedBySink: true })).toEqual(normalise(WORK))
    expect(allowedRect({ cover: COVER, work: WORK, containedBySink: false })).toEqual(normalise(COVER))
  })
  it("reachShare: the smaller axis of the window's cover", () => {
    expect(reachShare(COVER)).toBeCloseTo(800 / 1200, 6)
    expect(reachShare(null)).toBeNull()
  })
})

describe("SheetReach (markup)", () => {
  it("renders one strip per band, never takes a pointer, and nothing with no geometry", () => {
    const html = renderToStaticMarkup(createElement(SheetReach, { cover: COVER, work: WORK, turns: 0, containedBySink: false }))
    expect((html.match(/sheet-reach-strip/g) ?? []).length).toBe(4)
    expect(html).toContain('data-tablet="reach"')
    expect(html).toContain('aria-hidden="true"')
    expect(renderToStaticMarkup(createElement(SheetReach, { cover: null, work: null, turns: 0, containedBySink: false }))).toBe("")
  })
})

describe("SheetStrip (markup)", () => {
  const noop = () => undefined
  const props = (over: Partial<SheetStripProps> = {}): SheetStripProps => ({
    shown: true, colour: "#2D7DD2", colours: ["#2D7DD2", "#D9382C", "#1F9D55"], boxTool: false, eraser: false, clearAfter: false, canUndo: true, hasInk: true,
    orientationLabel: "Match screen", contained: "overlay",
    onSend: noop, onBoxTool: noop, onErase: noop, onUndo: noop, onClear: noop, onClearAfter: noop, onColour: noop, onWidth: noop, onOrientation: noop, onRotateInk: noop, onRelease: noop,
    ...over,
  })
  const render = (over: Partial<SheetStripProps> = {}) => renderToStaticMarkup(createElement(SheetStrip, props(over)))

  it("has every button of the old Grab strip, with Release instead of Exit, as real buttons", () => {
    const html = render()
    for (const id of ["send-writing", "send-page", "box", "erase", "undo", "clear", "clear-after", "thinner", "thicker", "orientation", "rotate-ink", "release"]) {
      expect(html, id).toContain(`data-tablet="strip-${id}"`)
    }
    expect((html.match(/data-tablet="strip-colour"/g) ?? []).length).toBe(3)
    expect(html).toContain("Send Writing")
    expect(html).toContain("Match screen")
    expect(html).not.toContain("Exit")
  })
  it("slides down only when shown", () => {
    expect(render({ shown: true })).toContain("sheet-strip shown")
    expect(render({ shown: false })).not.toContain("shown")
  })
  it("marks the active colour, tool states and disabled buttons", () => {
    const html = render({ colour: "#d9382c", boxTool: true, canUndo: false, hasInk: false })
    expect(html).toMatch(/data-colour="#D9382C"[^>]*class="sheet-strip-swatch on"|class="sheet-strip-swatch on"[^>]*data-colour="#D9382C"/)
    expect(html).toMatch(/strip-box"[^>]*class="sheet-strip-button on"|class="sheet-strip-button on"[^>]*strip-box/)
    expect(html).toMatch(/strip-undo[^>]*disabled/)
    expect(html).toMatch(/strip-clear"[^>]*disabled|disabled[^>]*strip-clear"/)
  })
  it("says how the pen is held, in words", () => {
    expect(containedTag("overlay")).toBe("Pen held to this sheet (overlay)")
    expect(containedTag(null)).toBe("Pen not held to this sheet")
    expect(render({ contained: null })).toContain("Pen not held to this sheet")
  })
})
