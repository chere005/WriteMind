/**
 * Undoing the perspective: a photograph of a page, resampled through the
 * page's four corners into the upright rectangle it really is.
 *
 * The Swift side hands the corners to Core Image's `CIPerspectiveCorrection`.
 * That is Apple's; this is the same job in plain arrays, so it runs in the
 * renderer on a canvas's `ImageData` (and in the test runner, which has no
 * canvas at all): for every pixel of the squared-up page, where is it in the
 * photograph? — the homography `unitSquareTo` already builds, asked the
 * other way round — and the four pixels round that spot are blended.
 */

import type { Size } from "../drawing/geometry"
import { applyHomography, EDGE_INSET, unitSquareTo, type Quad } from "./page"

/**
 * `source` is RGBA, `sw`×`sh`, top-left origin. `quad` is the page's corners
 * in the photograph's pixels with y UP (the Vision convention `Quad` keeps).
 * The result is RGBA, `page.width`×`page.height`. `inset` is the fraction of
 * each side cut away, because the corners sit ON the page's edge and the
 * edge itself — its shadow, the desk behind a curl — is not the page.
 */
export function warpToPage(source: Uint8ClampedArray, sw: number, sh: number, quad: Quad,
  page: Size, inset: number = EDGE_INSET): Uint8ClampedArray<ArrayBuffer> {
  const w = Math.max(1, Math.round(page.width)), h = Math.max(1, Math.round(page.height))
  const out = new Uint8ClampedArray(w * h * 4)
  const map = unitSquareTo(quad)
  const span = 1 - 2 * inset
  for (let y = 0; y < h; y++) {
    const v = inset + ((y + 0.5) / h) * span
    for (let x = 0; x < w; x++) {
      const u = inset + ((x + 0.5) / w) * span
      const at = applyHomography(map, { x: u, y: v })
      // Back to the photograph's own rows, which run downwards.
      const px = at.x - 0.5, py = (sh - at.y) - 0.5
      const x0 = Math.floor(px), y0 = Math.floor(py)
      const fx = px - x0, fy = py - y0
      const to = (y * w + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        const sample = (cx: number, cy: number): number => {
          const ix = Math.min(Math.max(cx, 0), sw - 1), iy = Math.min(Math.max(cy, 0), sh - 1)
          return source[(iy * sw + ix) * 4 + channel]!
        }
        const top = sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx
        const bottom = sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx
        out[to + channel] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return out
}

/** A quad drawn on a picture (top-left origin, y DOWN) as the y-up one the page maths wants. */
export function quadFromPixels(corners: {
  topLeft: { x: number; y: number }
  topRight: { x: number; y: number }
  bottomRight: { x: number; y: number }
  bottomLeft: { x: number; y: number }
}, height: number): Quad {
  const up = (p: { x: number; y: number }) => ({ x: p.x, y: height - p.y })
  return {
    topLeft: up(corners.topLeft), topRight: up(corners.topRight),
    bottomRight: up(corners.bottomRight), bottomLeft: up(corners.bottomLeft),
  }
}

type Vec = [number, number, number]
const cross = (a: Vec, b: Vec): Vec =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * The page's true proportions, width over height, from where its corners
 * landed in a photograph — the pinhole-camera estimate of Zhang & He
 * ("Whiteboard scanning and image enhancement", 2007). The lengths of the
 * quad's own edges are NOT the page's shape: a page tilted away from the
 * camera is shorter than it is wide whatever it really is. Assumes square
 * pixels and the principal point at the middle of the frame, which is what a
 * phone or webcam is. `corners` are in the photograph's pixels, y down.
 * Null when there is no perspective to measure by (the sides are parallel,
 * so the edge lengths ARE the shape) or the corners do not describe a
 * camera that could have taken it.
 */
export function pageAspect(corners: {
  topLeft: { x: number; y: number }
  topRight: { x: number; y: number }
  bottomRight: { x: number; y: number }
  bottomLeft: { x: number; y: number }
}, frame: Size): number | null {
  const u0 = frame.width / 2, v0 = frame.height / 2
  const at = (p: { x: number; y: number }): Vec => [p.x - u0, p.y - v0, 1]
  const m1 = at(corners.topLeft), m2 = at(corners.topRight)
  const m3 = at(corners.bottomLeft), m4 = at(corners.bottomRight)
  const c14 = cross(m1, m4)
  const d2 = dot(cross(m2, m4), m3), d3 = dot(cross(m3, m4), m2)
  if (Math.abs(d2) < 1e-9 || Math.abs(d3) < 1e-9) return null
  const k2 = dot(c14, m3) / d2, k3 = dot(c14, m2) / d3
  const n2: Vec = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]]
  const n3: Vec = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]]
  const parallel = Math.abs(n2[2] * n3[2])
  if (parallel < 1e-4) return null
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2])
  if (!(f2 > 1)) return null
  const top = (n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2]
  const bottom = (n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2]
  const ratio = Math.sqrt(top / bottom)
  return Number.isFinite(ratio) && ratio > 0.2 && ratio < 5 ? ratio : null
}

/**
 * Quarter turns CLOCKWISE, as the video pane shows them (`NotebookCapture.
 * rotated` on the Mac): an RGBA picture turned `turns` quarter turns, so a
 * capture of a camera that is mounted sideways comes in upright. The picture
 * stays at the origin; at an odd number of turns its width and height swap.
 */
export function quarterTurned(source: Uint8ClampedArray | Uint8Array, width: number, height: number, turns: number):
{ data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const quarter = ((Math.round(turns) % 4) + 4) % 4
  const swap = quarter % 2 === 1
  const w = swap ? height : width, h = swap ? width : height
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Where this pixel of the turned picture was in the original.
      const sx = quarter === 0 ? x : quarter === 1 ? y : quarter === 2 ? width - 1 - x : width - 1 - y
      const sy = quarter === 0 ? y : quarter === 1 ? height - 1 - x : quarter === 2 ? height - 1 - y : x
      const from = (sy * width + sx) * 4, to = (y * w + x) * 4
      out[to] = source[from]!
      out[to + 1] = source[from + 1]!
      out[to + 2] = source[from + 2]!
      out[to + 3] = source[from + 3]!
    }
  }
  return { data: out, width: w, height: h }
}
