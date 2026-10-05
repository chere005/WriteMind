import { describe, expect, it } from "vitest"
import { uprightSize, uprightTransform } from "../src/renderer/cameraTake"
import type { Rotation } from "../src/renderer/cameraSettings"

/**
 * No Swift original (Hold image is the port's own, Sean 2026-10-05). A held still and the live video are drawn upright
 * by ONE transform, so a capture of the held picture is the same way round (and the same size) as one of the live
 * picture, and both match what the pane's CSS `rotate()` shows.
 */

const apply = (m: number[], p: { x: number; y: number }) => ({ x: m[0]! * p.x + m[2]! * p.y + m[4]!, y: m[1]! * p.x + m[3]! * p.y + m[5]! })

/** Where CSS `rotate(deg)` (clockwise on screen, y down) puts a frame's corner, the turned frame placed at the origin. */
function cssTurned(rotation: Rotation, raw: { width: number; height: number }, p: { x: number; y: number }) {
  const t = rotation * Math.PI / 180
  const cx = raw.width / 2, cy = raw.height / 2
  const x = (p.x - cx) * Math.cos(t) - (p.y - cy) * Math.sin(t)
  const y = (p.x - cx) * Math.sin(t) + (p.y - cy) * Math.cos(t)
  const out = uprightSize(raw, rotation)
  return { x: x + out.width / 2, y: y + out.height / 2 }
}

describe("the picture drawn upright (live or held)", () => {
  const raw = { width: 640, height: 480 }

  it("a quarter turn either way swaps the sides; a half turn does not", () => {
    expect(uprightSize(raw, 0)).toEqual({ width: 640, height: 480 })
    expect(uprightSize(raw, 90)).toEqual({ width: 480, height: 640 })
    expect(uprightSize(raw, 180)).toEqual({ width: 640, height: 480 })
    expect(uprightSize(raw, 270)).toEqual({ width: 480, height: 640 })
  })

  it("every corner of the frame lands where the pane's CSS rotate() shows it", () => {
    const corners = [{ x: 0, y: 0 }, { x: raw.width, y: 0 }, { x: raw.width, y: raw.height }, { x: 0, y: raw.height }, { x: 100, y: 30 }]
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const m = uprightTransform(rotation, raw)
      for (const p of corners) {
        const got = apply(m, p), want = cssTurned(rotation, raw, p)
        expect(got.x).toBeCloseTo(want.x, 6)
        expect(got.y).toBeCloseTo(want.y, 6)
      }
    }
  })

  it("the frame fills the upright canvas exactly (nothing drawn off it, no gap)", () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const m = uprightTransform(rotation, raw)
      const out = uprightSize(raw, rotation)
      const pts = [{ x: 0, y: 0 }, { x: raw.width, y: raw.height }].map((p) => apply(m, p))
      expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(0, 6)
      expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(out.width, 6)
      expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(0, 6)
      expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(out.height, 6)
    }
  })

  it("a clockwise quarter turn takes the frame's top-left corner to the top-right", () => {
    expect(apply(uprightTransform(90, raw), { x: 0, y: 0 })).toEqual({ x: 480, y: 0 })
    expect(apply(uprightTransform(270, raw), { x: 0, y: 0 })).toEqual({ x: 0, y: 640 })
  })
})
