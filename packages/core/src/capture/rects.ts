/**
 * The handful of `CGRect` operations the flow-chart reader leans on, with
 * CoreGraphics' own edge rules: `contains(point)` is half-open, two rects
 * that only share an edge do not intersect, and a missing intersection has
 * no area.
 */

import type { Point, Rect } from "../drawing/shapes"

export const makeRect = (x: number, y: number, width: number, height: number): Rect =>
  ({ x, y, width, height })

export const rectMinX = (r: Rect): number => r.x
export const rectMaxX = (r: Rect): number => r.x + r.width
export const rectMinY = (r: Rect): number => r.y
export const rectMaxY = (r: Rect): number => r.y + r.height
export const rectMidX = (r: Rect): number => r.x + r.width / 2
export const rectMidY = (r: Rect): number => r.y + r.height / 2
export const rectArea = (r: Rect | null): number => (r === null ? 0 : r.width * r.height)

export const rectInset = (r: Rect, dx: number, dy: number): Rect =>
  ({ x: r.x + dx, y: r.y + dy, width: r.width - 2 * dx, height: r.height - 2 * dy })

export function rectIntersects(a: Rect, b: Rect): boolean {
  return rectMinX(a) < rectMaxX(b) && rectMaxX(a) > rectMinX(b)
    && rectMinY(a) < rectMaxY(b) && rectMaxY(a) > rectMinY(b)
}

/** The overlap, or null when there is none. */
export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(rectMinX(a), rectMinX(b)), x1 = Math.min(rectMaxX(a), rectMaxX(b))
  const y0 = Math.max(rectMinY(a), rectMinY(b)), y1 = Math.min(rectMaxY(a), rectMaxY(b))
  if (x1 < x0 || y1 < y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x0 = Math.min(rectMinX(a), rectMinX(b)), x1 = Math.max(rectMaxX(a), rectMaxX(b))
  const y0 = Math.min(rectMinY(a), rectMinY(b)), y1 = Math.max(rectMaxY(a), rectMaxY(b))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** CGRect.contains(CGRect): the other lies wholly inside, edges allowed. */
export const rectContainsRect = (outer: Rect, inner: Rect): boolean =>
  rectMinX(inner) >= rectMinX(outer) && rectMaxX(inner) <= rectMaxX(outer)
  && rectMinY(inner) >= rectMinY(outer) && rectMaxY(inner) <= rectMaxY(outer)

/** CGRect.contains(CGPoint): half-open, the far edges are outside. */
export const rectContainsPoint = (r: Rect, p: Point): boolean =>
  p.x >= rectMinX(r) && p.x < rectMaxX(r) && p.y >= rectMinY(r) && p.y < rectMaxY(r)
