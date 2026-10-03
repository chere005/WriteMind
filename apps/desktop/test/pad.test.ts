import { describe, expect, it } from "vitest"
import { planEnter, planExit, type WindowMemory } from "../src/main/pad"
import {
  aspectOf, describeArea, fallbackInfo, fitRect, physicalRect, stripWanted, STRIP_EDGE,
} from "../src/renderer/padGeometry"
import { SHEET_REF, strokeUnder, TabletPage, type InkStroke } from "../src/renderer/tabletPage"

describe("the sheet is fitted inside whatever holds it, never stretched", () => {
  it("fills a container of its own shape", () => {
    expect(fitRect({ width: 1920, height: 1080 }, 16 / 9)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })
  it("letterboxes in a taller pane and pillarboxes in a wider one, centred", () => {
    const tall = fitRect({ width: 500, height: 900 }, 16 / 9)
    expect(tall.width).toBe(500)
    expect(tall.height).toBeCloseTo(281.25, 6)
    expect(tall.y).toBeCloseTo((900 - 281.25) / 2, 6)
    expect(tall.x).toBe(0)
    const wide = fitRect({ width: 2000, height: 500 }, 16 / 9)
    expect(wide.height).toBe(500)
    expect(wide.width).toBeCloseTo(888.888, 2)
    expect(wide.x).toBeCloseTo((2000 - 888.888) / 2, 2)
    expect(tall.width / tall.height).toBeCloseTo(16 / 9, 9)
  })
  it("survives an empty container", () => {
    expect(fitRect({ width: 0, height: 0 }, 16 / 9)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
  it("takes the screen's shape, and ignores a nonsense one", () => {
    expect(aspectOf(2560, 1440)).toBeCloseTo(16 / 9, 9)
    expect(aspectOf(0, 0)).toBeCloseTo(16 / 9, 9)
    expect(aspectOf(10000, 100, 1.5)).toBe(1.5)
  })
})

describe("the sheet's rectangle in physical pixels (for the driver's 'Click to define')", () => {
  const rect = { x: 100, y: 50, width: 400, height: 225 }
  it("at 100%: window position plus the pane's offset", () => {
    const area = physicalRect(rect, {
      content: { x: 300, y: 200, width: 1440, height: 900 }, display: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1,
    })
    expect(area).toMatchObject({ x: 400, y: 250, width: 400, height: 225, right: 799, bottom: 474, screenWidth: 1920, screenHeight: 1080 })
  })
  it("at 150%: CSS pixels are scaled to the display's physical ones", () => {
    const area = physicalRect(rect, {
      content: { x: 200, y: 100, width: 1280, height: 720 }, display: { x: 0, y: 0, width: 1280, height: 720 }, scale: 1.5,
    })
    expect(area).toMatchObject({ x: 450, y: 225, width: 600, height: 338, screenWidth: 1920, screenHeight: 1080 })
  })
  it("on a second monitor it is relative to THAT display's origin", () => {
    const area = physicalRect(rect, {
      content: { x: 2000, y: 100, width: 1000, height: 700 }, display: { x: 1920, y: 0, width: 2560, height: 1440 }, scale: 1,
    })
    expect(area.x).toBe(80 + 100)
    expect(area.y).toBe(150)
    expect(area.screenWidth).toBe(2560)
  })
  it("falls back to the window's own numbers", () => {
    const info = fallbackInfo({
      screenX: 100, screenY: 100, outerWidth: 1016, outerHeight: 839, innerWidth: 1000, innerHeight: 800,
      devicePixelRatio: 1.25, screen: { width: 1920, height: 1080 },
    })
    expect(info.scale).toBe(1.25)
    expect(info.content.x).toBe(108)
    expect(info.content.y).toBe(100 + (839 - 800 - 8))
  })
  it("is described in words the driver's dialog uses", () => {
    const text = describeArea(physicalRect(rect, {
      content: { x: 0, y: 0, width: 800, height: 600 }, display: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1,
    }))
    expect(text).toContain("x 100, y 50")
    expect(text).toContain("400 × 225")
    expect(text).toContain("1,920 × 1,080")
  })
})

describe("the strip comes down at the top edge and goes away on its own", () => {
  const idle = { y: 500, overStrip: false, writing: false, pinned: false, sinceLeft: 10_000 }
  it("is hidden when the pen is elsewhere", () => expect(stripWanted(idle)).toBe(false))
  it("shows at the top edge and while over it", () => {
    expect(stripWanted({ ...idle, y: STRIP_EDGE })).toBe(true)
    expect(stripWanted({ ...idle, overStrip: true })).toBe(true)
  })
  it("lingers a moment after the pointer leaves, then goes", () => {
    expect(stripWanted({ ...idle, sinceLeft: 500 })).toBe(true)
    expect(stripWanted({ ...idle, sinceLeft: 2500 })).toBe(false)
  })
  it("never shows while a stroke is being written", () => {
    expect(stripWanted({ ...idle, y: 3, overStrip: true, writing: true })).toBe(false)
  })
})

describe("Pad mode's window: what is remembered and put back", () => {
  const was = (extra: Partial<WindowMemory> = {}): WindowMemory => ({
    bounds: { x: 10, y: 20, width: 1440, height: 900 }, maximized: false, fullScreen: false,
    autoHideMenuBar: false, menuBarVisible: true, ...extra,
  })
  it("goes full screen and hides the menu bar", () => {
    expect(planEnter(was())).toEqual(["fullScreen", "hideMenuBar"])
  })
  it("a window that was already full screen is not asked to be again", () => {
    expect(planEnter(was({ fullScreen: true }))).toEqual(["hideMenuBar"])
  })
  it("leaving restores a normal window's bounds and the menu bar", () => {
    expect(planExit(was(), true)).toEqual([
      { step: "leaveFullScreen" },
      { step: "bounds", bounds: { x: 10, y: 20, width: 1440, height: 900 } },
      { step: "menuBar", autoHide: false, visible: true },
    ])
  })
  it("a maximised window is maximised again, not given its old bounds", () => {
    const steps = planExit(was({ maximized: true }), true)
    expect(steps.map((step) => step.step)).toEqual(["leaveFullScreen", "maximize", "menuBar"])
  })
  it("a window that was full screen before stays full screen", () => {
    expect(planExit(was({ fullScreen: true }), true).map((step) => step.step)).toEqual(["menuBar"])
  })
  it("when full screen was already lost, it is not left twice", () => {
    expect(planExit(was(), false).map((step) => step.step)).toEqual(["bounds", "menuBar"])
  })
})

describe("the sheet is resolution-independent", () => {
  const stroke = (width: number): InkStroke => ({ colorHex: "#000", width, points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] })
  it("keeps the shape it was made with", () => {
    expect(new TabletPage(16 / 10).aspect).toBeCloseTo(1.6, 9)
    expect(new TabletPage(0).aspect).toBeCloseTo(16 / 9, 9)
  })
  it("a stroke's width is in reference units, so the eraser reaches the same distance at any size", () => {
    // 3 px on a 500 px sheet is 6 units; on a 2000 px sheet the same stroke is 12 px wide.
    const strokes = [stroke(3 * SHEET_REF / 500)]
    const at = (dy: number, width: number) =>
      strokeUnder(strokes, { x: 0.5, y: 0.5 + dy }, { width, height: width / (16 / 9) }, 0, width / SHEET_REF)
    for (const width of [500, 2000]) {
      expect(at(0.004, width)).toBe(0)
      expect(at(0.02, width)).toBe(-1)
    }
  })
})
