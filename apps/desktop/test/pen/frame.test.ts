// main/pen/frame.ts: the 8 transforms, which of them keep the sheet landscape, the device frame, the device key. (Nothing is calibrated:
// the frame follows from the extents and the Orientation menu turns it.)
import { describe, expect, it } from "vitest"
import { applyFrame, type FrameTransform } from "../../src/shared/pen"
import { FRAME_CANDIDATES, defaultFrame, deviceExtents, frameKey, landscapeFrames, swapsAxes, tabletAspect, toSheet } from "../../src/main/pen/frame"

describe("the candidates", () => {
  it("are the 8 transforms, all different", () => {
    expect(FRAME_CANDIDATES).toHaveLength(8)
    expect(new Set(FRAME_CANDIDATES.map((f) => `${f.turn}${f.flipY}`)).size).toBe(8)
  })
  it("applyFrame: turning four times is the identity, and flipY mirrors y before the turn", () => {
    for (const flipY of [false, true]) {
      let p: [number, number] = [0.2, 0.7]
      for (let i = 0; i < 4; i++) p = applyFrame(p[0], p[1], { turn: 1, flipY: i === 0 ? flipY : false })
      // one mirror (first step only) then four quarter turns: the mirror survives, the turns cancel
      expect(p[0]).toBeCloseTo(0.2); expect(p[1]).toBeCloseTo(flipY ? 0.3 : 0.7)
    }
  })
  it("each transform is a bijection of the corners", () => {
    for (const f of FRAME_CANDIDATES) {
      const seen = new Set([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => applyFrame(x!, y!, f).join(",")))
      expect(seen.size).toBe(4)
    }
  })
})

describe("landscape-only frames: the device frame never makes the sheet portrait", () => {
  it("a device that reports PORTRAIT extents (Sean's 9499 x 15199) needs a quarter turn: only the 4 axis-swapping frames", () => {
    const set = landscapeFrames(9499, 15199)
    expect(set).toHaveLength(4)
    expect(set.every(swapsAxes)).toBe(true)
  })
  it("a device that reports landscape extents keeps the 4 non-swapping frames", () => {
    const set = landscapeFrames(15199, 9499)
    expect(set).toHaveLength(4)
    expect(set.some(swapsAxes)).toBe(false)
  })
  it("a square or unknown device allows all 8", () => {
    expect(landscapeFrames(1000, 1000)).toHaveLength(8)
    expect(landscapeFrames(null, null)).toHaveLength(8)
  })
  it("the sheet's shape under every allowed frame is wider than tall", () => {
    for (const [w, h] of [[9499, 15199], [15199, 9499]] as const) {
      for (const f of landscapeFrames(w, h)) {
        const sheetW = swapsAxes(f) ? h : w, sheetH = swapsAxes(f) ? w : h
        expect(sheetW).toBeGreaterThanOrEqual(sheetH)
      }
    }
  })
})

describe("defaults", () => {
  it("always landscape, y read up (Wintab): a portrait-reporting device (Sean's Intuos S) is also turned a quarter", () => {
    expect(defaultFrame(9499, 15199)).toEqual({ turn: 1, flipY: true })
    expect(defaultFrame(15200, 9500)).toEqual({ turn: 0, flipY: true })
    expect(defaultFrame(null, null)).toEqual({ turn: 0, flipY: true })
    for (const [w, h] of [[9499, 15199], [15199, 9499]] as const) expect(landscapeFrames(w, h)).toContainEqual(defaultFrame(w, h) as FrameTransform)
  })
  it("frameKey names family, device and extents", () => {
    expect(frameKey("wintab", "WACOM Tablet", 9499, 15199)).toBe("wintab:WACOM Tablet:9499x15199")
    expect(frameKey("wintab", "x", null, null)).toBe("wintab:x:?x?")
  })
  it("deviceExtents are the raw axis lengths; tabletAspect is long over short", () => {
    expect(deviceExtents({ rawX: [0, 9499], rawY: [0, 15199] })).toEqual({ width: 9499, height: 15199 })
    expect(deviceExtents(null)).toEqual({ width: null, height: null })
    expect(tabletAspect(9499, 15199)).toBeCloseTo(1.6, 2)
    expect(tabletAspect(15199, 9499)).toBeCloseTo(1.6, 2)
    expect(tabletAspect(null, 5)).toBe(1.6)
  })
  it("toSheet clamps", () => {
    expect(toSheet(-1, 2, { turn: 0, flipY: false })).toEqual([0, 1])
  })
})
