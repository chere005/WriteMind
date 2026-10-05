// Transcribed from WriteMindTests/NotebookCaptureTests.swift, the tests Mac commits 32ad5e1 (a capture lands the
// size the viewfinder showed it), 159e0f6 (traced writing is thinned to its own measured stroke) and 6685cb1 (a
// third of the stroke, and the stray grid dots go with the thinning) added.
import { describe, expect, it } from "vitest"
import { placement, PAGE_FRACTION } from "../src/capture/page"
import {
  inkBox, inkMask, inkStrokeWidth, marks, thinnedInk, thinnedWriting, writingMask, STROKE_FLOOR, STROKE_KEEP,
} from "../src/capture/ink"

const width = 120, height = 90

/** NotebookCaptureTests.page(): paper, a grid of printed dots, a shadow, one 5-pixel pen stroke. */
function page(): Uint8Array {
  const gray = new Uint8Array(width * height).fill(235)
  for (let y = 0; y < height; y++) for (let x = 0; x < 40; x++) gray[y * width + x] = 190
  for (let y = 6; y < height; y += 12) {
    for (let x = 6; x < width; x += 12) {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) gray[(y + dy) * width + x + dx]! -= 45
    }
  }
  for (let y = 38; y <= 42; y++) for (let x = 20; x <= 100; x++) gray[y * width + x] = 25
  return gray
}

/** A bar `thick` pixels tall and 80 long, in a mask of its own. */
function bar(thick: number): Uint8Array {
  const ink = new Uint8Array(width * height)
  for (let y = 20; y < 20 + thick; y++) for (let x = 20; x < 100; x++) ink[y * width + x] = 1
  return ink
}

const hasInk = (mask: Uint8Array): boolean => mask.some((one) => one !== 0)

describe("a capture lands the size the viewfinder showed it", () => {
  // Sean, 2026-09-22: "the drawing and image when selected from the camera are too small.. they should be the
  // size you can see in the output viewer". A page fills the pane the way the viewfinder fills it, less a margin.
  it("a page lands at the size the viewfinder shows it", () => {
    const pageSize = { width: 1200, height: 1600 }, pane = { width: 900, height: 600 }
    const whole = placement({ frame: { x: 0, y: 0, ...pageSize }, pageSize, pane, nudge: 0 })
    // Its HEIGHT is what fills the pane: a portrait page in a pane wider than it is tall is held by the short way.
    const pageHeight = whole.width * pane.width * 1600 / 1200
    expect(pageHeight / pane.height).toBeCloseTo(0.9, 3)
    expect(PAGE_FRACTION, "it used to be two fifths").toBeGreaterThan(0.8)
    expect(PAGE_FRACTION, "and it keeps its handles off the edges").toBeLessThan(1)
  })
})

describe("how heavy the writing comes out", () => {
  it("the keep is a third and the floor two pixels", () => {
    expect(STROKE_KEEP).toBe(0.35)
    expect(STROKE_FLOOR).toBe(2)
  })

  // Twice the area over the boundary is the width of anything long and thin, a little under by however much the
  // two ends are of the whole boundary.
  it("the stroke width is measured and not assumed", () => {
    expect(inkStrokeWidth(bar(8), width, height)).toBeGreaterThan(7)
    expect(inkStrokeWidth(bar(8), width, height)).toBeLessThan(9)
    expect(Math.abs(inkStrokeWidth(bar(2), width, height) - 2)).toBeLessThanOrEqual(0.2)
    // The page's own pen is five pixels thick.
    const mask = inkMask(page(), width, height)
    expect(Math.abs(inkStrokeWidth(mask, width, height) - 5)).toBeLessThanOrEqual(0.6)
    expect(inkStrokeWidth(new Uint8Array(16), 4, 4), "no ink, no width").toBe(0)
  })

  // Sean, 2026-09-22: "the scale is correct, but the thickness of the writing is too thick".
  it("a thick stroke is thinned and a fine one is left alone", () => {
    const thick = bar(8)
    const thinned = thinnedInk(thick, width, height, 0.5, 2.5)   // 159e0f6's values: half, floor 2.5
    const was = inkStrokeWidth(thick, width, height)
    expect(Math.abs(inkStrokeWidth(thinned, width, height) - was / 2), "half of what it was").toBeLessThanOrEqual(0.6)
    // A pencil line already at the floor comes through untouched: a capture with holes in it is worse than a heavy one.
    expect(thinnedInk(bar(2), width, height)).toEqual(bar(2))
    expect(thinnedInk(bar(1), width, height)).toEqual(bar(1))
  })

  it("at a third, an 8-pixel stroke comes out about three", () => {
    const thinned = thinnedInk(bar(8), width, height)
    const now = inkStrokeWidth(thinned, width, height)
    // 7.5 measured, target max(2, 2.6): two passes, four pixels off.
    expect(now).toBeGreaterThan(2.5)
    expect(now).toBeLessThan(4.6)
  })

  it("thinning never takes the writing away", () => {
    for (let thick = 1; thick <= 12; thick++) {
      const thinned = thinnedInk(bar(thick), width, height)
      expect(hasInk(thinned), `${thick} pixels thinned to nothing`).toBe(true)
      expect(inkStrokeWidth(thinned, width, height), `${thick} pixels`).toBeGreaterThanOrEqual(Math.min(thick, 2) - 0.1)
    }
  })

  // Sean, 2026-09-22: "now some of the background dots are getting picked up by mistake". A printed dot that got
  // past the lattice is a few pixels across, and the erosion that thins the pen leaves it under the speck limit -
  // so cleaning AGAIN after thinning takes the stragglers, and takes nothing off a real stroke.
  it("a stray grid dot does not survive the thinning", () => {
    const ink = new Uint8Array(width * height)
    // A pen stroke, and a 5-pixel dot away from it.
    for (let y = 20; y < 28; y++) for (let x = 20; x < 100; x++) ink[y * width + x] = 1
    for (let y = 60; y < 65; y++) for (let x = 60; x < 65; x++) ink[y * width + x] = 1
    expect(ink[62 * width + 62], "the dot is there to begin with").toBe(1)

    const thin = thinnedInk(ink, width, height)
    const cleaned = writingMask(marks(thin, width, height, { minimumSize: 7, minimumArea: 20 }))
    expect(cleaned.some((one, at) => one !== 0 && Math.floor(at / width) >= 55), "the dot is gone").toBe(false)
    expect(inkBox(cleaned, width, height), "and the stroke is not").not.toBeNull()
    expect(inkStrokeWidth(cleaned, width, height)).toBeGreaterThan(1.5)
  })

  it("the trace's order is clean, thin, clean again (the port's `thinnedWriting`)", () => {
    // The page: the first clean drops the dots and the shadow, the thinning takes the 5-pixel pen to about two.
    const raw = inkMask(page(), width, height)
    const cleaned = marks(raw, width, height)
    const after = writingMask(thinnedWriting(cleaned))
    expect(after[40 * width + 60], "the middle of the stroke is still ink").toBe(1)
    expect(after[38 * width + 60], "its edge is not").toBe(0)
    expect(inkStrokeWidth(after, width, height)).toBeLessThan(inkStrokeWidth(raw, width, height))
    expect(after[6 * width + 6], "no grid dot came back").toBe(0)
  })
})
