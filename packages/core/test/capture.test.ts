import { describe, expect, it } from "vitest"
import {
  applyHomography, displayedFrame, invertHomography, pageBox, placement, PAGE_FRACTION,
  regionOf, resolveShape, shapeSize, unitSquareTo,
} from "../src/capture/page"
import { inkBox, inkMask, localMeanRadius } from "../src/capture/ink"

/**
 * A page drawn in code: paper, a grid of printed dots, a shadow down one
 * side, and one thick pen stroke. Only the stroke is ink. Transcribed from
 * `WriteMindTests/NotebookCaptureTests.swift`.
 */
const width = 120, height = 90

function page(shadow = true): Uint8Array {
  const gray = new Uint8Array(width * height).fill(235)
  // A shadow: the left third is darker, evenly — not ink.
  if (shadow) {
    for (let y = 0; y < height; y++) for (let x = 0; x < 40; x++) gray[y * width + x] = 190
  }
  // Printed dots every 12 pixels, 2×2, a little darker than the paper.
  for (let y = 6; y < height; y += 12) {
    for (let x = 6; x < width; x += 12) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) gray[(y + dy) * width + x + dx]! -= 45
      }
    }
  }
  // The pen: a 5-pixel-thick line from (20, 40) to (100, 40).
  for (let y = 38; y <= 42; y++) for (let x = 20; x <= 100; x++) gray[y * width + x] = 25
  return gray
}

describe("lifting the writing off the paper", () => {
  it("takes the stroke and leaves the dots and the shadow", () => {
    const mask = inkMask(page(), width, height)
    expect(mask[40 * width + 60]).toBe(1)
    expect(mask[40 * width + 25]).toBe(1)
    expect(mask[6 * width + 6]).toBe(0)
    expect(mask[20 * width + 10]).toBe(0)
    expect(mask[20 * width + 41]).toBe(0)

    const box = inkBox(mask, width, height, 0)!
    expect(box.y).toBe(38)
    expect(box.height).toBe(5)
    expect(box.x).toBe(20)
    expect(box.width).toBe(81)
  })

  it("finds nothing on a page with nothing written on it", () => {
    const blank = page()
    for (let y = 38; y <= 42; y++) for (let x = 20; x <= 100; x++) blank[y * width + x] = 235
    expect(inkBox(inkMask(blank, width, height), width, height)).toBeNull()
  })

  it("leaves a little room round the writing", () => {
    const box = inkBox(inkMask(page(), width, height), width, height)!
    // 81 wide and 5 tall, plus a 6 pixel margin on each side.
    expect(box.width).toBe(93)
    expect(box.height).toBe(17)
  })

  it("reads a mark the width of the page as an edge, not writing", () => {
    const gray = new Uint8Array(width * height).fill(235)
    for (let x = 0; x < width; x++) {
      gray[45 * width + x] = 20
      gray[46 * width + x] = 20
      gray[47 * width + x] = 20
    }
    expect(inkBox(inkMask(gray, width, height), width, height)).toBeNull()
  })

  it("keeps the local-mean radius the one number everything else asks for", () => {
    expect(localMeanRadius(1200, 1600)).toBe(30)
    expect(localMeanRadius(80, 60)).toBe(8)
  })
})

describe("every page the same shape", () => {
  it("remembers the first one and keeps a tilted page on it", () => {
    expect(resolveShape(1.4, null).ratio).toBeCloseTo(1.4, 6)
    expect(resolveShape(1.47, 1.4).ratio).toBeCloseTo(1.4, 6)
    expect(resolveShape(1.62, 1.4).ratio).toBeCloseTo(1.62, 6)
    expect(resolveShape(0.7, null).ratio).toBe(1)
  })

  it("sizes the page from the short side", () => {
    expect(shapeSize({ ratio: 1.4 }, true)).toEqual({ width: 1200, height: 1680 })
    expect(shapeSize({ ratio: 1.4 }, false)).toEqual({ width: 1680, height: 1200 })
  })
})

describe("where a capture lands", () => {
  const pageSize = { width: 1200, height: 1600 }
  const pane = { width: 900, height: 600 }

  it("puts the writing where it was on the page, at the page's scale", () => {
    const pageHeight = 600 * PAGE_FRACTION
    const pageWidth = pageHeight * 1200 / 1600
    const scale = pageWidth / 1200
    const whole = placement({
      frame: { x: 0, y: 0, width: 1200, height: 1600 }, pageSize, pane, nudge: 0,
    })
    expect(whole.center.x).toBeCloseTo(0.5, 4)
    expect(whole.center.y).toBeCloseTo(0.5, 4)
    expect(whole.width).toBeCloseTo(pageWidth / 900, 4)

    const ink = placement({
      frame: { x: 0, y: 0, width: 600, height: 800 }, pageSize, pane, nudge: 0,
    })
    expect(ink.width).toBeCloseTo(600 * scale / 900, 4)
    expect(ink.center.x).toBeCloseTo(0.5 - 300 * scale / 900, 4)
    expect(ink.center.y).toBeCloseTo(0.5 - 400 * scale / 600, 4)

    // Two captures of the same notebook: the same size on the pane.
    const again = placement({
      frame: { x: 0, y: 0, width: 1200, height: 1600 }, pageSize, pane, nudge: 0.03,
    })
    expect(again.width).toBeCloseTo(whole.width, 4)
    expect(again.center.x).toBeCloseTo(0.53, 4)
  })
})

describe("the perspective", () => {
  it("sends the quad's corners to the unit square and back", () => {
    // A page seen tilted: narrower at the top.
    const quad = {
      topLeft: { x: 1, y: 2 }, topRight: { x: 3, y: 2 },
      bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 4, y: 0 },
    }
    const toQuad = unitSquareTo(quad)
    const toSquare = invertHomography(toQuad)
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      expect(a.x).toBeCloseTo(b.x, 6)
      expect(a.y).toBeCloseTo(b.y, 6)
    }
    near(applyHomography(toQuad, { x: 1, y: 1 }), quad.bottomRight)
    near(applyHomography(toQuad, { x: 0, y: 1 }), quad.bottomLeft)
    near(applyHomography(toSquare, quad.topLeft), { x: 0, y: 0 })
    near(applyHomography(toSquare, quad.topRight), { x: 1, y: 0 })
    near(applyHomography(toSquare, quad.bottomRight), { x: 1, y: 1 })
    near(applyHomography(toSquare, quad.bottomLeft), { x: 0, y: 1 })
    near(applyHomography(toSquare, { x: 2, y: 2 }), { x: 0.5, y: 0 })
  })

  it("turns a box on the pane into a fraction of the picture shown", () => {
    // A 400×300 picture in an 800×400 pane is shown 533 wide and 400 tall.
    const frame = { width: 400, height: 300 }, pane = { width: 800, height: 400 }
    const shown = displayedFrame(frame, pane)
    expect(shown.x).toBeCloseTo(400 / 3, 3)
    expect(shown.width).toBeCloseTo(1600 / 3, 3)
    expect(shown.height).toBeCloseTo(400, 3)

    const region = regionOf({ x: 0, y: 100, width: 400, height: 100 }, frame, pane)!
    expect(region.x).toBeCloseTo(0, 6)
    expect(region.width).toBeCloseTo((400 - 400 / 3) / (1600 / 3), 6)
    expect(region.y).toBeCloseTo(0.25, 6)
    expect(region.height).toBeCloseTo(0.25, 6)
    expect(regionOf({ x: 0, y: 0, width: 100, height: 100 }, frame, pane)).toBeNull()
  })

  it("finds a section's box on the page, past the inset", () => {
    const frame = { x: 0, y: 0, width: 400, height: 300 }
    // A page that fills the frame exactly, y up as the camera counts it.
    const square = {
      topLeft: { x: 0, y: 300 }, topRight: { x: 400, y: 300 },
      bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 400, y: 0 },
    }
    const pageSize = { width: 1200, height: 900 }
    const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

    const plain = pageBox({ region, quad: square, frame, inset: 0, pageSize })!
    expect(plain).toEqual({ x: 300, y: 225, width: 600, height: 450 })

    // Past a 10% inset, 0.25 of the frame is (0.25 − 0.1) / 0.8 of the
    // page. Boxed to whole pixels, so an edge may sit ONE pixel out —
    // which is the tolerance the Swift suite uses for the same reason.
    const inset = pageBox({ region, quad: square, frame, inset: 0.1, pageSize })!
    const within = (value: number, wanted: number) =>
      expect(Math.abs(value - wanted)).toBeLessThanOrEqual(1)
    within(inset.x, 225)
    within(inset.x + inset.width, 975)
    within(inset.y, 168.75)
    within(inset.y + inset.height, 731.25)

    expect(pageBox({
      region: { x: 0.99, y: 0.99, width: 0.01, height: 0.01 },
      quad: square, frame, inset: 0.1, pageSize,
    })).toBeNull()

    const noPage = pageBox({ region, quad: null, frame, inset: 0, pageSize })!
    expect(noPage).toEqual(plain)
  })
})
