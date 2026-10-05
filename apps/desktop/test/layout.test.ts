import { describe, expect, it } from "vitest"
import {
  DEFAULT_VIDEO_SHARE, fractionFor, NOTES_MIN, readFraction, VIDEO_MIN, videoWidth,
} from "../src/shared/layout"
import { parseSaved, placeWindow } from "../src/main/windowState"

describe("the divider between the notes and the video (ContentView's HSplitView)", () => {
  it("shares what is left 720 : 420 until the divider is dragged", () => {
    expect(DEFAULT_VIDEO_SHARE).toBeCloseTo(420 / 1140, 6)
    // 1280 wide, 250 sidebar: 1030 shared.
    expect(videoWidth(1030, null)).toBe(Math.round(1030 * 420 / 1140))
  })

  it("never lets the notes fall under 460 or the video under 280", () => {
    expect(videoWidth(1000, 0.9)).toBe(1000 - NOTES_MIN)
    expect(videoWidth(1000, 0.1)).toBe(VIDEO_MIN)
  })

  it("at the smallest window with the sidebar out the video keeps its minimum", () => {
    // 900 - 250 = 650: the notes squeeze to 370 rather than the video going under 280.
    expect(videoWidth(650, null)).toBe(VIDEO_MIN)
    expect(videoWidth(740, 0.5)).toBe(280)
  })

  it("remembers a drag as a fraction, so a resize keeps the proportion", () => {
    const fraction = fractionFor(1000, 400)
    expect(fraction).toBe(0.4)
    expect(videoWidth(1500, fraction)).toBe(600)
  })

  it("ignores a stored fraction that makes no sense", () => {
    expect(readFraction("0.4")).toBe(0.4)
    expect(readFraction(0.4)).toBe(0.4)
    expect(readFraction("banana")).toBeNull()
    expect(readFraction(0)).toBeNull()
    expect(readFraction(0.99)).toBeNull()
    expect(readFraction(null)).toBeNull()
  })
})

describe("where the window opens", () => {
  const display = { x: 0, y: 0, width: 1920, height: 1040 }

  it("is 1280 x 800, centred, when nothing was saved", () => {
    expect(placeWindow(null, [display])).toEqual({ x: 320, y: 120, width: 1280, height: 800, maximized: false })
  })

  it("is clamped to a small display but never below 900 x 560", () => {
    const small = placeWindow(null, [{ x: 0, y: 0, width: 1024, height: 700 }])
    expect(small.width).toBe(1024)
    expect(small.height).toBe(700)
    const tiny = placeWindow(null, [{ x: 0, y: 0, width: 800, height: 500 }])
    expect(tiny.width).toBe(900)
    expect(tiny.height).toBe(560)
  })

  it("comes back where it was", () => {
    const saved = { bounds: { x: 100, y: 60, width: 1100, height: 700 }, maximized: false }
    expect(placeWindow(saved, [display])).toEqual({ x: 100, y: 60, width: 1100, height: 700, maximized: false })
  })

  it("comes back maximised if it was", () => {
    const saved = { bounds: { x: 100, y: 60, width: 1100, height: 700 }, maximized: true }
    expect(placeWindow(saved, [display]).maximized).toBe(true)
  })

  it("keeps the size but not the position when its monitor is gone", () => {
    const saved = { bounds: { x: 3000, y: 100, width: 1100, height: 700 }, maximized: false }
    const placed = placeWindow(saved, [display])
    expect(placed.x).toBeUndefined()
    expect(placed.width).toBe(1100)
    expect(placed.height).toBe(700)
  })

  it("keeps a window that is half off an edge, and drops one that is almost wholly off", () => {
    const half = { bounds: { x: -500, y: 20, width: 1100, height: 700 }, maximized: false }
    expect(placeWindow(half, [display]).x).toBe(-500)
    const gone = { bounds: { x: -1050, y: 20, width: 1100, height: 700 }, maximized: false }
    expect(placeWindow(gone, [display]).x).toBeUndefined()
  })

  it("raises a saved size that is under the minimum", () => {
    const placed = placeWindow({ bounds: { x: 0, y: 0, width: 300, height: 200 }, maximized: false }, [display])
    expect(placed.width).toBe(900)
    expect(placed.height).toBe(560)
  })

  it("reads the saved file, and a damaged one is no file", () => {
    expect(parseSaved('{"bounds":{"x":1,"y":2,"width":1000,"height":600},"maximized":true}'))
      .toEqual({ bounds: { x: 1, y: 2, width: 1000, height: 600 }, maximized: true })
    expect(parseSaved("{")).toBeNull()
    expect(parseSaved('{"bounds":{"x":"a"}}')).toBeNull()
    expect(parseSaved(null)).toBeNull()
  })
})
