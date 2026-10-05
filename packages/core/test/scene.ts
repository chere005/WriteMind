/**
 * Photographs made by a pinhole camera looking at a dotted notebook page on a desk: the page is drawn in its own
 * coordinates and resampled through the projection (not a test file; shared by findPage.test.ts).
 */

import { applyHomography, invertHomography, unitSquareTo, type Quad } from "../src/index"

export type RGB = [number, number, number]
export interface Pt { x: number; y: number }
export interface Corners4 { tl: Pt; tr: Pt; br: Pt; bl: Pt }

/** A small deterministic noise source, so a failing scene can be reproduced. */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** The page's corners in a W×H frame for a pinhole camera (focal `f`) tilted about x then y, y down. */
export function project(W: number, H: number, options: {
  pageW: number; pageH: number; tiltX: number; tiltY: number; roll?: number; distance: number; f: number
  shiftX?: number; shiftY?: number
}): Corners4 {
  const point = (u: number, v: number): Pt => {
    let X = (u - 0.5) * options.pageW, Y = (v - 0.5) * options.pageH, Z = 0
    const roll = (options.roll ?? 0) * Math.PI / 180
    let x0 = X * Math.cos(roll) - Y * Math.sin(roll), y0 = X * Math.sin(roll) + Y * Math.cos(roll)
    X = x0; Y = y0
    const tx = options.tiltX * Math.PI / 180, ty = options.tiltY * Math.PI / 180
    const y2 = Y * Math.cos(tx) - Z * Math.sin(tx), z2 = Y * Math.sin(tx) + Z * Math.cos(tx)
    Y = y2; Z = z2
    const x2 = X * Math.cos(ty) + Z * Math.sin(ty); Z = -X * Math.sin(ty) + Z * Math.cos(ty); X = x2
    Z += options.distance
    return {
      x: W / 2 + (options.shiftX ?? 0) + options.f * X / Z,
      y: H / 2 + (options.shiftY ?? 0) + options.f * Y / Z,
    }
  }
  return { tl: point(0, 0), tr: point(1, 0), br: point(1, 1), bl: point(0, 1) }
}

export interface Scene {
  W: number; H: number
  /** Paper colour at page coordinates u, v in 0…1. */
  page: (u: number, v: number, x: number, y: number) => RGB
  /** What is behind the page at a pixel. */
  desk: (x: number, y: number) => RGB
  /** Anything laid over the picture afterwards (a pen, a cup). */
  over?: (x: number, y: number, rgb: RGB) => RGB
  seed?: number
  noise?: number
}

export function render(scene: Scene, corners: Corners4): Uint8ClampedArray {
  const { W, H } = scene
  const quad: Quad = { topLeft: corners.tl, topRight: corners.tr, bottomRight: corners.br, bottomLeft: corners.bl }
  const back = invertHomography(unitSquareTo(quad))
  const out = new Uint8ClampedArray(W * H * 4)
  const noise = random(scene.seed ?? 1)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = x + (sx + 0.5) / 2, py = y + (sy + 0.5) / 2
          const { x: u, y: v } = applyHomography(back, { x: px, y: py })
          const colour = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? scene.page(u, v, px, py) : scene.desk(px, py)
          r += colour[0]; g += colour[1]; b += colour[2]
        }
      }
      let rgb: RGB = [r / 4, g / 4, b / 4]
      if (scene.over) rgb = scene.over(x + 0.5, y + 0.5, rgb)
      const jitter = ((noise() - 0.5) * 2) * (scene.noise ?? 3)
      const at = (y * W + x) * 4
      out[at] = rgb[0] + jitter
      out[at + 1] = rgb[1] + jitter
      out[at + 2] = rgb[2] + jitter
      out[at + 3] = 255
    }
  }
  return out
}

/** Cream paper with a printed dot grid every 1/40 of the page's width, and some handwriting-ish strokes. */
export const notebook = (writing = true) => (u: number, v: number): RGB => {
  const base: RGB = [236, 232, 220]
  // Dots: 0.2% of the page wide, every 0.025 in u and 0.0179 in v (square on a 5:7 page).
  const du = (u / 0.025) % 1, dv = (v / 0.0178) % 1
  if (Math.hypot((du - 0.5) * 0.025, (dv - 0.5) * 0.0178 * 5 / 7) < 0.0035) return [150, 148, 140]
  if (writing) {
    // Three lines of "writing": dark horizontal wobbly strokes.
    for (const line of [0.3, 0.42, 0.55]) {
      const wobble = Math.sin(u * 60) * 0.004
      if (u > 0.15 && u < 0.8 && Math.abs(v - line - wobble) < 0.004) return [30, 40, 90]
    }
  }
  return base
}

/** Wood: dark brown with grain bands and a lighting gradient. */
export const wood = (W: number, H: number) => (x: number, y: number): RGB => {
  const grain = 12 * Math.sin(y * 0.35 + Math.sin(x * 0.02) * 4) + 6 * Math.sin(x * 0.9)
  const light = 1 - 0.25 * (x / W) - 0.1 * (y / H)
  return [(112 + grain) * light, (78 + grain * 0.8) * light, (50 + grain * 0.6) * light]
}

export const W = 640, H = 480

export function distance(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y) }
