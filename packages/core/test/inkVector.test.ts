import { describe, expect, it } from "vitest"
import { inkOutlines, inkPathData, inkSvg, inkVector, type Point } from "../src/index"

/**
 * Transcribed from `WriteMindTests/InkVectorTests.swift`. The Mac writes a PDF
 * and rasterises it with Core Graphics to look at what it paints; here the
 * loops are written as an SVG path, and the test fills them even-odd itself.
 */

/** A square mask with ink inside `rect`, minus `hole` (both in pixels). */
function mask(size: number, rect: { x: number; y: number; width: number; height: number } | null,
  hole?: { x: number; y: number; width: number; height: number }): Uint8Array {
  const pixels = new Uint8Array(size * size)
  const inside = (r: { x: number; y: number; width: number; height: number }, px: number, py: number) =>
    px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!rect || !inside(rect, x + 0.5, y + 0.5)) continue
      if (hole && inside(hole, x + 0.5, y + 0.5)) continue
      pixels[y * size + x] = 1
    }
  }
  return pixels
}

const whole = { x: 0, y: 0, width: 12, height: 12 }

/** Even-odd fill of the loops, sampled at (x, y) in a picture `scale` times the mask: 0 or 255. */
function filled(loops: Point[][], x: number, y: number, scale: number): number {
  const px = (x + 0.5) / scale, py = (y + 0.5) / scale
  let crossings = 0
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!
      if ((a.y > py) !== (b.y > py) && px < a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y)) crossings++
    }
  }
  return crossings % 2 === 1 ? 255 : 0
}

describe("tracing the writing into outlines", () => {
  it("a solid block traces to one rectangle", () => {
    const traced = inkOutlines(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, whole)
    expect(traced).toHaveLength(1)
    expect(traced[0]).toHaveLength(4)   // a rectangle needs four corners and no staircase
    const xs = traced[0]!.map((p) => p.x), ys = traced[0]!.map((p) => p.y)
    expect(Math.min(...xs)).toBe(3)
    expect(Math.max(...xs)).toBe(8)
    expect(Math.min(...ys)).toBe(4)
    expect(Math.max(...ys)).toBe(7)
  })

  it("a hole is traced as its own loop and stays empty", () => {
    const ring = mask(12, { x: 2, y: 2, width: 8, height: 8 }, { x: 4, y: 4, width: 4, height: 4 })
    const traced = inkOutlines(ring, 12, 12, whole)
    expect(traced).toHaveLength(2)   // the outside of the o and the inside of it
    expect(filled(traced, 3, 3, 1)).toBeGreaterThan(200)   // the ring is inked
    expect(filled(traced, 6, 6, 1)).toBeLessThan(40)       // the hole in the middle of it is not
  })

  it("nothing is traced from a blank page", () => {
    expect(inkOutlines(mask(12, null), 12, 12, whole)).toEqual([])
    expect(inkVector(mask(12, null), 12, 12, whole, "#000000")).toBeNull()
  })

  it("the staircase is thinned away", () => {
    // A diagonal stroke: one loop, and far fewer points than the hundreds of
    // unit steps its boundary is made of.
    const pixels = new Uint8Array(60 * 60)
    for (let i = 4; i < 56; i++) for (let w = 0; w < 3; w++) pixels[i * 60 + i + w] = 1
    const traced = inkOutlines(pixels, 60, 60, { x: 0, y: 0, width: 60, height: 60 })
    expect(traced).toHaveLength(1)
    expect(traced[0]!.length).toBeLessThan(40)   // a straight stroke is a few corners, not a staircase
    expect(traced[0]!.length).toBeGreaterThan(3)
  })

  it("the file is an SVG the size of the writing, in the pen's colour", () => {
    const svg = inkVector(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, whole, "#2d7dd2")
    expect(svg).not.toBeNull()
    expect(svg!.startsWith("<svg ")).toBe(true)
    expect(svg).toContain('width="12"')
    expect(svg).toContain('height="12"')
    expect(svg).toContain('viewBox="0 0 12 12"')
    expect(svg).toContain('fill="#2d7dd2"')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain("M3 4L8 4L8 7L3 7Z")
  })

  it("a part of the page is traced in the part's own pixels", () => {
    const traced = inkOutlines(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, { x: 2, y: 2, width: 8, height: 8 })
    const xs = traced[0]!.map((p) => p.x)
    expect(Math.min(...xs)).toBe(1)   // 3 - 2
    expect(Math.max(...xs)).toBe(6)
  })

  it("scales without going soft: eight times up the edge is still an edge", () => {
    const loops = inkOutlines(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, whole)
    const middle = 8 * 5 + 4
    expect(filled(loops, 8 * 3 + 4, middle, 8)).toBeGreaterThan(240)   // inside the stroke
    expect(filled(loops, 8 * 3 - 4, middle, 8)).toBeLessThan(15)       // outside it
    // A raster blown up eight times ramps across eight pixels; the outline is a step.
    const across: number[] = []
    for (let x = 8 * 3 - 4; x <= 8 * 3 + 4; x++) across.push(filled(loops, x, middle, 8))
    expect(across.filter((v) => v >= 16 && v < 240).length).toBeLessThanOrEqual(1)
  })

  it("writes path data and refuses an empty or colourless graphic", () => {
    expect(inkPathData([[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]])).toBe("M0 0L4 0L4 4Z")
    expect(inkSvg([], { width: 10, height: 10 }, "#000000")).toBeNull()
    expect(inkSvg([[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]], { width: 10, height: 10 }, "red"))
      .toContain('fill="#000000"')   // an unreadable colour is not written into the file
  })
})
