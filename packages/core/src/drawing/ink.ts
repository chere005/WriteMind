/**
 * The SHAPE of what the pen and the arrow tool leave behind, with no context
 * to draw it into. Ported from `WriteMind/Drawing/InkPaths.swift` and the
 * `head` / `shortened` / `dash` helpers of `ConnectorItem` in `Shapes.swift`.
 *
 * The canvas paints these, and so can anything else that wants the same
 * lines (the PDF export): one description of the shape, many places it is
 * painted.
 */

import { headLength } from "./geometry"
import type { ConnectorItem, Stroke } from "./model"
import type { Point } from "./shapes"

/**
 * An arrowhead: a filled triangle with its tip at `tip`, pointing away from
 * `from` (the Swift `ConnectorItem.head`).
 */
export function headTriangle(tip: Point, from: Point, lineWidth: number): Point[] {
  const length = headLength(lineWidth)
  const dx = tip.x - from.x, dy = tip.y - from.y
  const distance = Math.max(Math.hypot(dx, dy), 0.001)
  const ux = dx / distance, uy = dy / distance
  const base = { x: tip.x - ux * length, y: tip.y - uy * length }
  const half = length * 0.45
  return [
    tip,
    { x: base.x - uy * half, y: base.y + ux * half },
    { x: base.x + uy * half, y: base.y - ux * half },
  ]
}

/** Where the line stops short of a head, so the tip is the point. */
export function shortened(tip: Point, from: Point, by: number): Point {
  const dx = tip.x - from.x, dy = tip.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance <= by) return from
  return { x: tip.x - dx / distance * by, y: tip.y - dy / distance * by }
}

/** The dash pattern for a line, in points. */
export function dashPattern(connector: Pick<ConnectorItem, "line" | "lineWidth">): number[] {
  switch (connector.line) {
    case "solid": return []
    case "dashed": return [connector.lineWidth * 4, connector.lineWidth * 3]
    case "dotted": return [0.1, connector.lineWidth * 2.2]
  }
}

/**
 * A connector: the line, with each end that carries a head pulled back along
 * its own last segment so the head's TIP is the point, and the heads
 * themselves as filled triangles.
 */
export function connectorPaths(
  connector: Pick<ConnectorItem, "startHead" | "endHead" | "lineWidth">,
  points: Point[],
): { line: Point[]; heads: Point[][] } {
  if (points.length < 2) return { line: [], heads: [] }
  const head = headLength(connector.lineWidth)
  const drawn = points.slice()
  const last = drawn.length - 1
  if (connector.startHead !== "none") drawn[0] = shortened(points[0]!, points[1]!, head * 0.8)
  if (connector.endHead !== "none") drawn[last] = shortened(points[last]!, points[last - 1]!, head * 0.8)
  const heads: Point[][] = []
  if (connector.startHead === "arrow") heads.push(headTriangle(points[0]!, points[1]!, connector.lineWidth))
  if (connector.endHead === "arrow") heads.push(headTriangle(points[last]!, points[last - 1]!, connector.lineWidth))
  return { line: drawn, heads }
}

export type CurveStep =
  | { op: "M"; to: Point }
  | { op: "L"; to: Point }
  | { op: "Q"; control: Point; to: Point }

/**
 * A stroke: the smoothed line through its samples, or a dot when the pen went
 * down and did not move. The curve is quadratics through the MIDPOINTS of the
 * samples, which is what takes the corners off a raw mouse trail.
 */
export function strokeCurve(stroke: Pick<Stroke, "width">, points: Point[]):
{ dot: { centre: Point; diameter: number } } | { steps: CurveStep[] } | null {
  const first = points[0]
  if (!first) return null
  if (points.length === 1) return { dot: { centre: first, diameter: stroke.width } }
  const steps: CurveStep[] = [{ op: "M", to: first }]
  if (points.length === 2) {
    steps.push({ op: "L", to: points[1]! })
  } else {
    for (let index = 1; index < points.length - 1; index++) {
      const here = points[index]!, next = points[index + 1]!
      steps.push({ op: "Q", control: here, to: { x: (here.x + next.x) / 2, y: (here.y + next.y) / 2 } })
    }
    steps.push({ op: "L", to: points[points.length - 1]! })
  }
  return { steps }
}
