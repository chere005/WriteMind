import { describe, expect, it } from "vitest"
import {
  applyMatrix, bounds, frameCorners, hitTest, matrixOf, noTransform, outline,
  type CanvasItem, type Size,
} from "../src/index"

/**
 * Port-only (no XCTest original): the geometry of a stroke must be LINEAR in
 * its length. `applyMatrix` used to work out the item's centre — a pass over
 * all its points — for every point it moved, so one 500-point stroke cost a
 * quarter of a million allocations to outline, hit-test or paint, and a page of
 * hand writing could not be erased over or dragged smoothly.
 */
const pane: Size = { width: 1000, height: 600 }

const longStroke = (count: number, transform = noTransform()): CanvasItem => ({
  kind: "stroke",
  stroke: {
    id: "long", colorHex: "#2D7DD2", width: 3,
    points: Array.from({ length: count }, (_, i) => ({ x: 0.1 + (i / count) * 0.8, y: 0.5 + Math.sin(i / 40) * 0.1 })),
    transform, group: null,
  },
})

describe("the matrix of an item", () => {
  it("matrixOf is applyMatrix with the centre worked out once", () => {
    const item = longStroke(50, { dx: 0.1, dy: -0.05, scale: 1.7, rotation: 0.6 })
    const place = matrixOf(item, pane)
    for (const point of [{ x: 0, y: 0 }, { x: 321, y: 77 }, { x: 999, y: 599 }]) {
      const a = applyMatrix(item, pane, point), b = place(point)
      expect(b.x).toBeCloseTo(a.x, 9)
      expect(b.y).toBeCloseTo(a.y, 9)
    }
  })

  it("outlines, hit tests and boxes of a 40,000-point stroke take milliseconds, not seconds", () => {
    const item = longStroke(40_000, { dx: 0.02, dy: 0.01, scale: 1.2, rotation: 0.3 })
    const started = performance.now()
    const shape = outline(item, pane)
    const box = bounds(item, pane)
    const corners = frameCorners(item, pane)
    // A point on the curve, and one far from it.
    const on = shape[20_000]!
    const hitOn = hitTest(item, on, pane)
    const hitOff = hitTest(item, { x: 5, y: 5 }, pane)
    const took = performance.now() - started
    expect(shape).toHaveLength(40_000)
    expect(corners).toHaveLength(4)
    expect(box.width).toBeGreaterThan(100)
    expect(hitOn).toBe(true)
    expect(hitOff).toBe(false)
    // Quadratic code needs several seconds here; linear code a few dozen milliseconds.
    expect(took).toBeLessThan(1000)
  })

  it("a stroke longer than the engine's argument limit still has a box", () => {
    const item = longStroke(300_000)
    const box = bounds(item, pane)
    expect(box.width).toBeGreaterThan(100)
  })
})
