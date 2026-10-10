import { describe, expect, it } from "vitest"
import { PLUS_CENTRE_X, PLUS_DIAMETER, PLUS_HIT, onPlusMarker, plusHit, plusMarker } from "../src/plusMarker"
import { PAGE_LEFT } from "../src/theme"

/**
 * The seam's + (docs/PLAN-bars-2026-10.md (b); the wireframe): a round marker in the left margin on the bar's line, a
 * 24 px hit target, never over the words.
 */
describe("the + marker", () => {
  it("is a 20 px circle in the middle of the left margin, on the bar's line", () => {
    const box = plusMarker(100)
    expect(box.width).toBe(PLUS_DIAMETER)
    expect(PLUS_DIAMETER).toBe(20)
    expect(box.y + box.height / 2).toBe(100)
    expect(box.x + box.width / 2).toBe(PLUS_CENTRE_X)
  })

  it("stands wholly in the margin: its right edge is left of where the words start", () => {
    const box = plusMarker(100)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThan(PAGE_LEFT)
  })

  it("answers presses in a 24 px square round its centre", () => {
    expect(PLUS_HIT).toBe(24)
    const hit = plusHit(100)
    expect(hit.width).toBe(24)
    expect(hit.height).toBe(24)
    expect(hit.x + hit.width / 2).toBe(PLUS_CENTRE_X)
    expect(hit.y + hit.height / 2).toBe(100)
  })

  it("takes a press on the edge of the target and not a pixel beyond (inclusive, as a seam is)", () => {
    const hit = plusHit(100)
    expect(onPlusMarker(PLUS_CENTRE_X, 100, 100)).toBe(true)
    expect(onPlusMarker(hit.x, hit.y, 100)).toBe(true)
    expect(onPlusMarker(hit.x + hit.width, hit.y + hit.height, 100)).toBe(true)
    expect(onPlusMarker(hit.x - 0.5, 100, 100)).toBe(false)
    expect(onPlusMarker(PLUS_CENTRE_X, hit.y - 0.5, 100)).toBe(false)
    expect(onPlusMarker(PLUS_CENTRE_X, hit.y + hit.height + 0.5, 100)).toBe(false)
  })

  it("reaches past a seam's own 8 px height: the target is not clipped to the seam (the marker is in the margin, beside no words)", () => {
    // A seam 8 px tall with its bar in the middle: 12 px above the bar is still on the target.
    expect(onPlusMarker(PLUS_CENTRE_X, 100 - 12, 100)).toBe(true)
    expect(onPlusMarker(PLUS_CENTRE_X, 100 + 12, 100)).toBe(true)
  })

  it("does not take a press over the words", () => {
    expect(onPlusMarker(PAGE_LEFT + 4, 100, 100)).toBe(false)
  })
})
