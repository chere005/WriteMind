import { describe, expect, it } from "vitest"
import {
  applyHomography, invertHomography, pageAspect, quadFromPixels, unitSquareTo, warpToPage, type Quad,
} from "../src/index"

/**
 * Not transcribed: the Swift side hands the corners to Core Image, which has
 * no test of ours. These check the maths that replaces it — a photograph
 * made BY the page's perspective, squared up again, is the page.
 */
describe("warpToPage", () => {
  // The page: eight columns and eight rows of alternating light and dark.
  const page = (u: number, v: number): number =>
    (Math.floor(u * 8) + Math.floor(v * 8)) % 2 === 0 ? 235 : 20

  // A photograph of that page seen at an angle (y UP quad, as Vision gives it).
  const sw = 640, sh = 480
  const quad: Quad = {
    topLeft: { x: 150, y: 400 }, topRight: { x: 520, y: 370 },
    bottomRight: { x: 590, y: 70 }, bottomLeft: { x: 90, y: 110 },
  }
  const photograph = new Uint8ClampedArray(sw * sh * 4)
  const back = invertHomography(unitSquareTo(quad))
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const { x: u, y: v } = applyHomography(back, { x: x + 0.5, y: sh - (y + 0.5) })
      const grey = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? page(u, v) : 128
      photograph.fill(grey, (y * sw + x) * 4, (y * sw + x) * 4 + 3)
      photograph[(y * sw + x) * 4 + 3] = 255
    }
  }

  it("squares a tilted page up into the page it is", () => {
    const out = warpToPage(photograph, sw, sh, quad, { width: 240, height: 320 }, 0)
    let wrong = 0
    for (let y = 0; y < 320; y++) {
      for (let x = 0; x < 240; x++) {
        const expected = page((x + 0.5) / 240, (y + 0.5) / 320)
        if (Math.abs(out[(y * 240 + x) * 4]! - expected) > 80) wrong++
      }
    }
    // Only the pixels on a square's edge may disagree.
    expect(wrong / (240 * 320)).toBeLessThan(0.04)
  })

  it("an upright page through its own corners comes out the same", () => {
    const flat = new Uint8ClampedArray(40 * 20 * 4)
    for (let i = 0; i < 40 * 20; i++) {
      flat[i * 4] = (i % 40) * 6; flat[i * 4 + 1] = 0; flat[i * 4 + 2] = 0; flat[i * 4 + 3] = 255
    }
    const whole: Quad = {
      topLeft: { x: 0, y: 20 }, topRight: { x: 40, y: 20 },
      bottomRight: { x: 40, y: 0 }, bottomLeft: { x: 0, y: 0 },
    }
    const out = warpToPage(flat, 40, 20, whole, { width: 40, height: 20 }, 0)
    for (let x = 0; x < 40; x++) expect(Math.abs(out[x * 4]! - flat[x * 4]!)).toBeLessThan(2)
  })

  it("corners drawn on the picture (y down) are turned into the y-up quad", () => {
    const q = quadFromPixels({
      topLeft: { x: 10, y: 5 }, topRight: { x: 90, y: 5 },
      bottomRight: { x: 90, y: 55 }, bottomLeft: { x: 10, y: 55 },
    }, 60)
    expect(q.topLeft).toEqual({ x: 10, y: 55 })
    expect(q.bottomRight).toEqual({ x: 90, y: 5 })
  })
})

describe("pageAspect", () => {
  // A 5:7 page seen by a pinhole camera (f = 520, principal point at the middle of a 640x480 frame).
  const photograph = (tiltX: number, tiltY: number, lift = 0) => {
    const project = (u: number, v: number) => {
      let X = (u - 0.5) * 500, Y = (v - 0.5) * 700, Z = 0
      const tx = tiltX * Math.PI / 180, ty = tiltY * Math.PI / 180
      let y2 = Y * Math.cos(tx) - Z * Math.sin(tx), z2 = Y * Math.sin(tx) + Z * Math.cos(tx); Y = y2; Z = z2
      const x2 = X * Math.cos(ty) + Z * Math.sin(ty); z2 = -X * Math.sin(ty) + Z * Math.cos(ty); X = x2; Z = z2
      Z += 1000
      return { x: 320 + 520 * X / Z, y: 240 + lift + 520 * Y / Z }
    }
    return {
      topLeft: project(0, 0), topRight: project(1, 0),
      bottomRight: project(1, 1), bottomLeft: project(0, 1),
    }
  }

  it("recovers the page's shape through a tilt that makes its edges lie", () => {
    for (const [tx, ty] of [[38, 14], [25, 6], [30, -20], [15, 30], [20, 3]] as const) {
      const ratio = pageAspect(photograph(tx, ty), { width: 640, height: 480 })
      expect(ratio, `tilt ${tx},${ty}`).not.toBeNull()
      expect(Math.abs(ratio! - 5 / 7) / (5 / 7), `tilt ${tx},${ty}`).toBeLessThan(0.03)
    }
  })

  it("gives up when there is no perspective to measure", () => {
    const flat = {
      topLeft: { x: 100, y: 50 }, topRight: { x: 300, y: 50 },
      bottomRight: { x: 300, y: 330 }, bottomLeft: { x: 100, y: 330 },
    }
    expect(pageAspect(flat, { width: 640, height: 480 })).toBeNull()
  })
})
