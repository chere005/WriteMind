/**
 * The writing lifted off a photographed page, as a VECTOR graphic.
 *
 * Ported from `WriteMind/Camera/InkVector.swift` (Sean, 2026-09-19: "when
 * getting the drawing, make it a vector graphic so it scales well"). The ink
 * mask is a grid of pixels, so a capture used to go on the page as a PNG: blow
 * it up with the handles and the strokes went soft. Here the same mask is
 * traced instead. Every boundary between ink and paper is one unit edge of a
 * pixel square; chained end to end those edges close into loops — the outside
 * of a stroke, and the hole inside an "o" or an "A" — and filling all of them
 * EVEN-ODD paints exactly the pixels the mask had, at any size, because the
 * loops are geometry rather than samples.
 *
 * The staircase those loops start out as is then thinned by Douglas–Peucker,
 * which drops the points that sit within `tolerance` of the line between their
 * neighbours: a straight pen stroke goes from hundreds of unit steps to a
 * handful of corners, and the file stays small enough to live beside the note.
 *
 * The Mac writes a one-page PDF; here the same loops are written as an SVG
 * (Chromium draws it, prints it in an exported PDF as vectors, and the
 * drawing layer scales it like any picture).
 */

import type { Point } from "../drawing/shapes"

/** How far a traced outline may stray from the pixels it came from. */
export const INK_TOLERANCE = 0.75

export interface InkBox { x: number; y: number; width: number; height: number }

/**
 * Every closed outline around the ink inside `box`, in the box's own pixels
 * with y running down — the same coordinates the raster capture uses, so a
 * traced capture lands exactly where a raster one did. `mask` is
 * `maskWidth` wide, one byte a pixel, non-zero for ink.
 */
export function inkOutlines(mask: Uint8Array, maskWidth: number, maskHeight: number, box: InkBox,
  tolerance: number = INK_TOLERANCE): Point[][] {
  const { x: x0, y: y0, width, height } = box
  if (width <= 0 || height <= 0) return []
  const stride = width + 1

  const inked = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const px = x + x0, py = y + y0
    if (px < 0 || py < 0 || px >= maskWidth || py >= maskHeight) return false
    return mask[py * maskWidth + px] !== 0
  }
  const node = (x: number, y: number): number => y * stride + x

  // Each edge is walked with the ink on one side, always the same side, so
  // the chaining below never has to ask which way is out.
  const next = new Map<number, number[]>()
  let count = 0
  const add = (from: number, to: number): void => {
    const held = next.get(from)
    if (held) held.push(to)
    else next.set(from, [to])
    count++
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inked(x, y)) continue
      if (!inked(x, y - 1)) add(node(x, y), node(x + 1, y))
      if (!inked(x + 1, y)) add(node(x + 1, y), node(x + 1, y + 1))
      if (!inked(x, y + 1)) add(node(x + 1, y + 1), node(x, y + 1))
      if (!inked(x - 1, y)) add(node(x, y + 1), node(x, y))
    }
  }
  if (count === 0) return []

  const loops: Point[][] = []
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    for (;;) {
      const ends = next.get(start)
      if (!ends || ends.length === 0) break
      const loop = [start]
      let here = ends.pop()!
      if (ends.length === 0) next.delete(start)
      // A pixel touched only at its corner has two edges leaving the same
      // node; either choice covers the same paper once the loops are filled
      // even-odd, so the first is taken.
      while (here !== start) {
        loop.push(here)
        const out = next.get(here)
        if (!out || out.length === 0) break
        const step = out.pop()!
        if (out.length === 0) next.delete(here)
        here = step
      }
      const points = loop.map((index): Point => ({ x: index % stride, y: Math.floor(index / stride) }))
      const simplified = simplifyClosed(points, tolerance)
      if (simplified) loops.push(simplified)
    }
  }
  return loops
}

/** How far a point is off the line between two others. */
export function perpendicular(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const length = Math.sqrt(dx * dx + dy * dy)
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  return Math.abs(dy * (point.x - a.x) - dx * (point.y - a.y)) / length
}

/** Douglas–Peucker over an open polyline, iteratively — a stroke can run to tens of thousands of points. */
export function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const spans: [number, number][] = [[0, points.length - 1]]
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [first, last] = span
    if (last <= first + 1) continue
    let worst = 0, index = first
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicular(points[i]!, points[first]!, points[last]!)
      if (distance > worst) { worst = distance; index = i }
    }
    if (worst <= tolerance) continue
    keep[index] = true
    spans.push([first, index], [index, last])
  }
  return points.filter((_, i) => keep[i])
}

/** Douglas–Peucker over a closed ring: cut at its first point, thinned as an open line, closed again. */
export function simplifyClosed(ring: Point[], tolerance: number): Point[] | null {
  if (ring.length <= 3) return ring.length >= 3 ? ring : null
  const line = [...ring, ring[0]!]
  const kept = simplifyOpen(line, tolerance)
  if (kept.length > 1 && kept[0]!.x === kept[kept.length - 1]!.x && kept[0]!.y === kept[kept.length - 1]!.y) kept.pop()
  return kept.length >= 3 ? kept : null
}

/** The loops as SVG path data (closed sub-paths, to be filled even-odd). */
export function inkPathData(loops: Point[][]): string {
  const parts: string[] = []
  for (const loop of loops) {
    if (loop.length < 3) continue
    parts.push(`M${loop.map((p) => `${p.x} ${p.y}`).join("L")}Z`)
  }
  return parts.join("")
}

/**
 * The loops as a standalone SVG the size of the box they were traced in, in
 * `colour` (`#rrggbb`). Null when there is nothing to draw, which leaves the
 * caller with the raster it already has.
 */
export function inkSvg(loops: Point[][], size: { width: number; height: number }, colour: string): string | null {
  if (loops.every((loop) => loop.length < 3) || size.width < 1 || size.height < 1) return null
  const fill = /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#000000"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" `
    + `viewBox="0 0 ${size.width} ${size.height}"><path fill="${fill}" fill-rule="evenodd" d="${inkPathData(loops)}"/></svg>`
}

/** The writing inside `box`, traced, as an SVG — null when there is no ink to trace. */
export function inkVector(mask: Uint8Array, maskWidth: number, maskHeight: number, box: InkBox,
  colour: string): string | null {
  return inkSvg(inkOutlines(mask, maskWidth, maskHeight, box), { width: box.width, height: box.height }, colour)
}
