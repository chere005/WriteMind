/**
 * How a flow-chart line gets from one node to another: straight where it
 * can be, otherwise right angles and as few of them as possible, round
 * anything in the way, and in its own lane where another line already has
 * one ("lines are always straight with corners, minimal paths, and never
 * overlap unless they must"). Pure geometry — the view draws what this
 * returns, and the drag of a segment is applied here too.
 *
 * Ported from `WriteMind/Drawing/ConnectorRouting.swift`, plus
 * `Drawing.reconnect` / `nodeBoxes` from `Drawing.swift`, which is what
 * calls it. (The geometry.ts `route` is only the polyline of a connector's
 * stored corners; THIS is what works the corners out.)
 */

import {
  rectInset, rectMaxX, rectMaxY, rectMidX, rectMidY, rectMinX, rectMinY, rectUnion,
} from "../capture/rects"
import {
  boundaryPoint, bounds, outline, placedCenter, type Size,
} from "./geometry"
import {
  isHidden, isRouted, itemWithID, noTransform, type CanvasItem, type ConnectorItem,
  type Drawing, type SegmentOverride,
} from "./model"
import { isNode, type Point, type Rect } from "./shapes"

/** Centres this close count as lined up, and the line is drawn straight. */
export const TOLERANCE = 8
/** How far apart two lines are put when they would share a corridor. */
export const CHANNEL_STEP = 8
/** A corner has to clear a box by this much to count as going round it. */
export const CLEARANCE = 4

export type Side = "left" | "right" | "top" | "bottom"

const roundAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))
const ALL_SIDES: Side[] = ["right", "left", "bottom", "top"]

/**
 * Which way a line leaves `a` on its way to `b`: out of the side that faces
 * the other box, and out of the top or bottom when the two are stacked
 * rather than side by side.
 */
export function sidesBetween(a: Rect, b: Rect): [Side, Side] {
  const horizontal = Math.max(rectMinX(a) - rectMaxX(b), rectMinX(b) - rectMaxX(a))
  const vertical = Math.max(rectMinY(a) - rectMaxY(b), rectMinY(b) - rectMaxY(a))
  if (horizontal >= vertical) {
    return rectMidX(b) >= rectMidX(a) ? ["right", "left"] : ["left", "right"]
  }
  return rectMidY(b) >= rectMidY(a) ? ["bottom", "top"] : ["top", "bottom"]
}

export function pointOnSide(box: Rect, side: Side): Point {
  switch (side) {
    case "left": return { x: rectMinX(box), y: rectMidY(box) }
    case "right": return { x: rectMaxX(box), y: rectMidY(box) }
    case "top": return { x: rectMidX(box), y: rectMinY(box) }
    case "bottom": return { x: rectMidX(box), y: rectMaxY(box) }
  }
}

export const isVerticalSide = (side: Side): boolean => side === "top" || side === "bottom"

export function oppositeSide(side: Side): Side {
  switch (side) {
    case "left": return "right"
    case "right": return "left"
    case "top": return "bottom"
    case "bottom": return "top"
  }
}

function goes(from: Point, to: Point, side: Side): boolean {
  switch (side) {
    case "right": return to.x > from.x + 0.001
    case "left": return to.x < from.x - 0.001
    case "bottom": return to.y > from.y + 0.001
    case "top": return to.y < from.y - 0.001
  }
}

/** The line has to actually leave the box by the side it says it does. */
export function leaves(path: Point[], side: Side): boolean {
  return path.length >= 2 && goes(path[0]!, path[1]!, side)
}

/** And arrive at the other from outside it: coming in through the left side means the last step travels right. */
export function enters(path: Point[], side: Side): boolean {
  if (path.length < 2) return false
  return goes(path[path.length - 2]!, path[path.length - 1]!, oppositeSide(side))
}

/** Corners that are not corners: a zero-length step, or a point in the middle of a straight run. */
export function simplified(path: Point[]): Point[] {
  const out: Point[] = []
  for (const point of path) {
    const last = out[out.length - 1]
    if (last !== undefined && Math.abs(last.x - point.x) < 0.001 && Math.abs(last.y - point.y) < 0.001) continue
    out.push(point)
  }
  if (out.length <= 2) return out
  const trimmed = [out[0]!]
  for (let index = 1; index < out.length - 1; index++) {
    const before = trimmed[trimmed.length - 1]!, here = out[index]!, after = out[index + 1]!
    const straightX = Math.abs(before.x - here.x) < 0.001 && Math.abs(here.x - after.x) < 0.001
    const straightY = Math.abs(before.y - here.y) < 0.001 && Math.abs(here.y - after.y) < 0.001
    if (straightX || straightY) continue
    trimmed.push(here)
  }
  trimmed.push(out[out.length - 1]!)
  return trimmed
}

/** Manhattan length of a path. */
export function pathLength(path: Point[]): number {
  let total = 0
  for (let index = 0; index + 1 < path.length; index++) {
    total += Math.abs(path[index + 1]!.x - path[index]!.x) + Math.abs(path[index + 1]!.y - path[index]!.y)
  }
  return total
}

/** A horizontal or vertical segment against a box. */
export function crosses(a: Point, b: Point, box: Rect): boolean {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y)
  return maxX > rectMinX(box) && minX < rectMaxX(box) && maxY > rectMinY(box) && minY < rectMaxY(box)
}

/** Whether a path misses every box in `boxes`. */
export function clear(path: Point[], boxes: Rect[]): boolean {
  if (path.length < 2) return true
  for (const box of boxes) {
    const shrunk = rectInset(box, 0.5, 0.5)
    if (!(shrunk.width > 0 && shrunk.height > 0)) continue
    for (let index = 0; index + 1 < path.length; index++) {
      if (crosses(path[index]!, path[index + 1]!, shrunk)) return false
    }
  }
  return true
}

/**
 * One way out and one way in: straight if the two line up, one corner if the
 * line changes direction once, otherwise out, across and in.
 */
export function candidate(a: Rect, exit: Side, b: Rect, entry: Side, channel = 0): Point[] | null {
  const from = pointOnSide(a, exit)
  const to = pointOnSide(b, entry)
  const shift = channel * CHANNEL_STEP
  let path: Point[]

  const exitV = isVerticalSide(exit), entryV = isVerticalSide(entry)
  if (!exitV && !entryV) {
    if (Math.abs(from.y - to.y) <= TOLERANCE) {
      const y = (from.y + to.y) / 2
      path = [{ x: from.x, y }, { x: to.x, y }]
    } else {
      const x = (from.x + to.x) / 2 + shift
      path = [from, { x, y: from.y }, { x, y: to.y }, to]
    }
  } else if (exitV && entryV) {
    if (Math.abs(from.x - to.x) <= TOLERANCE) {
      const x = (from.x + to.x) / 2
      path = [{ x, y: from.y }, { x, y: to.y }]
    } else {
      const y = (from.y + to.y) / 2 + shift
      path = [from, { x: from.x, y }, { x: to.x, y }, to]
    }
  } else if (!exitV && entryV) {
    path = [from, { x: to.x, y: from.y }, to]
  } else {
    path = [from, { x: from.x, y: to.y }, to]
  }

  path = simplified(path)
  if (!(path.length >= 2 && leaves(path, exit) && enters(path, entry))) return null
  return path
}

/**
 * The long ways round: out of one box, past everything in the way, and back
 * in. Four bends, so they only ever win when nothing shorter is clear.
 */
export function detours(a: Rect, exit: Side, b: Rect, entry: Side, boxes: Rect[], channel = 0): Point[][] {
  const from = pointOnSide(a, exit), to = pointOnSide(b, entry)
  const all = boxes.reduce((union, box) => rectUnion(union, box), rectUnion(a, b))
  const shift = channel * CHANNEL_STEP
  const step = 16
  const out: Point[][] = []

  if (!isVerticalSide(exit) && !isVerticalSide(entry)) {
    const outX = from.x + (exit === "right" ? step : -step)
    const inX = to.x + (entry === "left" ? -step : step)
    for (const y of [rectMinY(all) - step - shift, rectMaxY(all) + step + shift]) {
      out.push(simplified([from, { x: outX, y: from.y }, { x: outX, y }, { x: inX, y }, { x: inX, y: to.y }, to]))
    }
  }
  if (isVerticalSide(exit) && isVerticalSide(entry)) {
    const outY = from.y + (exit === "bottom" ? step : -step)
    const inY = to.y + (entry === "top" ? -step : step)
    for (const x of [rectMinX(all) - step - shift, rectMaxX(all) + step + shift]) {
      out.push(simplified([from, { x: from.x, y: outY }, { x, y: outY }, { x, y: inY }, { x: to.x, y: inY }, to]))
    }
  }
  return out.filter((p) => p.length >= 2 && leaves(p, exit) && enters(p, entry))
}

/**
 * The whole line, corner by corner, ends included. `obstacles` are the other
 * nodes; the two being joined are added to them, so a line never cuts
 * through either end's own box.
 *
 * Every way out of one box into the other is tried — four sides by four
 * sides — and the one with the fewest corners wins, the shortest of those if
 * there is a tie. That is what "minimal" means here, and it is also what
 * routes round whatever is in the way: a path that crosses something is
 * simply not a candidate.
 */
export function connectorPath(a: Rect, b: Rect, obstacles: Rect[] = [], channel = 0): Point[] {
  const boxes = [...obstacles, a, b]
  let best: { score: number; path: Point[] } | null = null
  const consider = (path: Point[] | null): void => {
    if (path === null || !clear(path, boxes)) return
    const score = path.length * 10_000 + pathLength(path)
    if (best === null || score < best.score) best = { score, path }
  }
  for (const exit of ALL_SIDES) {
    for (const entry of ALL_SIDES) consider(candidate(a, exit, b, entry, channel))
  }
  // Nothing direct is clear, so the line goes round the outside of
  // everything — over the top, under the bottom, or out to one side.
  if (best === null) {
    for (const exit of ALL_SIDES) {
      for (const entry of ALL_SIDES) {
        for (const detour of detours(a, exit, b, entry, boxes, channel)) consider(detour)
      }
    }
  }
  if (best !== null) return (best as { score: number; path: Point[] }).path
  // Boxed in even then (two nodes on top of each other): a plain corner,
  // which at least joins them and still turns a right angle.
  const [exit, entry] = sidesBetween(a, b)
  const from = pointOnSide(a, exit), to = pointOnSide(b, entry)
  return simplified(isVerticalSide(exit)
    ? [from, { x: from.x, y: to.y }, to]
    : [from, { x: to.x, y: from.y }, to])
}

// MARK: - Segments the hand can move

/** The middle of every segment, with which way it runs — where the circles go. */
export function segmentMidpoints(path: Point[]): { index: number; point: Point; vertical: boolean }[] {
  const out: { index: number; point: Point; vertical: boolean }[] = []
  for (let index = 0; index + 1 < path.length; index++) {
    const a = path[index]!, b = path[index + 1]!
    out.push({
      index, point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      vertical: Math.abs(a.x - b.x) < Math.abs(a.y - b.y),
    })
  }
  return out
}

/**
 * One segment moved sideways, with the segments either side of it
 * stretching to follow. `value` is the new x of a vertical segment or the
 * new y of a horizontal one.
 */
export function movedSegment(path: Point[], segment: number, value: number): Point[] {
  if (!(path.length >= 2 && segment >= 0 && segment + 1 < path.length)) return path
  const out = path.map((p) => ({ ...p }))
  const vertical = Math.abs(path[segment]!.x - path[segment + 1]!.x) < Math.abs(path[segment]!.y - path[segment + 1]!.y)
  if (vertical) {
    out[segment]!.x = value
    out[segment + 1]!.x = value
  } else {
    out[segment]!.y = value
    out[segment + 1]!.y = value
  }
  return out
}

/** Where a dragged segment sits now, in the coordinate its override remembers. */
export function segmentValue(path: Point[], segment: number): number | null {
  if (!(segment >= 0 && segment + 1 < path.length)) return null
  const a = path[segment]!, b = path[segment + 1]!
  return Math.abs(a.x - b.x) < Math.abs(a.y - b.y) ? a.x : a.y
}

/** An endpoint kept on its box's edge. */
export function clampedToBox(point: Point, box: Rect): Point {
  const inside = {
    x: Math.min(Math.max(point.x, rectMinX(box)), rectMaxX(box)),
    y: Math.min(Math.max(point.y, rectMinY(box)), rectMaxY(box)),
  }
  // Whichever edge it is nearest is the one it sits on.
  const distances = [inside.x - rectMinX(box), rectMaxX(box) - inside.x,
    inside.y - rectMinY(box), rectMaxY(box) - inside.y]
  let nearest = 0
  for (let i = 1; i < 4; i++) if (distances[i]! < distances[nearest]!) nearest = i
  switch (nearest) {
    case 0: return { x: rectMinX(box), y: inside.y }
    case 1: return { x: rectMaxX(box), y: inside.y }
    case 2: return { x: inside.x, y: rectMinY(box) }
    default: return { x: inside.x, y: rectMaxY(box) }
  }
}

/**
 * The path with every remembered drag put back — and the ends kept on their
 * boxes, so a line that was dragged along a node's edge stays attached to it.
 */
export function applyingOverrides(overrides: SegmentOverride[], path: Point[],
  start: Rect | null, end: Rect | null, size: Size): Point[] {
  if (path.length < 2) return path
  let out = path
  for (const override of overrides) {
    if (!(override.index >= 0 && override.index + 1 < out.length)) continue
    const a = out[override.index]!, b = out[override.index + 1]!
    const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y)
    if (vertical !== override.vertical) continue                    // the line has changed shape
    out = movedSegment(out, override.index, override.value * (vertical ? size.width : size.height))
  }
  if (out === path) out = path.map((p) => ({ ...p }))
  if (start !== null) out[0] = clampedToBox(out[0]!, start)
  if (end !== null) out[out.length - 1] = clampedToBox(out[out.length - 1]!, end)
  return out
}

/**
 * Which lane each line takes, so two that would run down the same corridor
 * do not sit on top of each other. Lines whose middle segment was dragged by
 * hand keep exactly where they were put.
 */
export function channelsFor(paths: Point[][], fixed: ReadonlySet<number>): number[] {
  const lanes = paths.map(() => 0)
  const used = new Map<string, number[]>()
  paths.forEach((path, index) => {
    if (path.length !== 4 || fixed.has(index)) return
    const a = path[1]!, b = path[2]!
    const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y)
    const coordinate = vertical ? a.x : a.y
    const key = `${vertical ? "v" : "h"}-${roundAway(coordinate / CHANNEL_STEP)}`
    const group = used.get(key)
    if (group === undefined) used.set(key, [index]); else group.push(index)
  })
  for (const group of used.values()) {
    if (group.length <= 1) continue
    group.forEach((index, offset) => { lanes[index] = offset - Math.trunc((group.length - 1) / 2) })
  }
  return lanes
}

// MARK: - Putting a drawing's lines back on its nodes

/** The boxes of everything a line can be attached to — what it has to route around. */
export function nodeBoxes(drawing: Drawing, size: Size): Rect[] {
  const out: Rect[] = []
  for (const item of drawing.items) {
    if (isHidden(item)) continue
    if ((item.kind === "shape" && isNode(item.shape.kind)) || item.kind === "image") {
      out.push(bounds(item, size))
    }
  }
  return out
}

const sameRect = (p: Rect, q: Rect): boolean =>
  p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height

/**
 * Put every attached connector end back on the edge of what it is attached
 * to, after anything has moved. A connector's own transform is baked into
 * its points first, so a dragged arrow stays dragged and only its attached
 * ends snap. A line with an end on a node turns right angles (the routing
 * is worked out here and baked into the item, so everything that draws or
 * clicks a connector reads one list of points); a line from the palette
 * stays straight. Returns the same drawing when nothing moved.
 */
export function reconnect(drawing: Drawing, size: Size): Drawing {
  if (!(size.width > 0 && size.height > 0)) return drawing
  const normalised = (p: Point): Point => ({ x: p.x / size.width, y: p.y / size.height })
  const items: CanvasItem[] = drawing.items.slice()
  let changed = false

  const routedIndices: number[] = []
  const routedBoxes: { start: Rect | null; end: Rect | null }[] = []
  const obstacleBoxes = nodeBoxes(drawing, size)

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    if (item.kind !== "connector") continue
    let connector: ConnectorItem = item.connector
    const before = JSON.stringify(connector)
    const t = connector.transform
    const identity = noTransform()
    if (t.dx !== identity.dx || t.dy !== identity.dy || t.scale !== identity.scale || t.rotation !== identity.rotation) {
      const placed = outline(item, size)
      if (placed.length >= 2) {
        connector = {
          ...connector,
          start: normalised(placed[0]!),
          end: normalised(placed[placed.length - 1]!),
          bends: placed.slice(1, -1).map(normalised),
        }
      }
      connector = { ...connector, transform: noTransform() }
    }
    const startNode = connector.startNode === null ? null : itemWithID({ items }, connector.startNode)
    const endNode = connector.endNode === null ? null : itemWithID({ items }, connector.endNode)
    const a = startNode !== null
      ? placedCenter(startNode, size)
      : { x: connector.start.x * size.width, y: connector.start.y * size.height }
    const b = endNode !== null
      ? placedCenter(endNode, size)
      : { x: connector.end.x * size.width, y: connector.end.y * size.height }
    if (isRouted(connector)) {
      routedIndices.push(index)
      routedBoxes.push({
        start: startNode !== null ? bounds(startNode, size) : null,
        end: endNode !== null ? bounds(endNode, size) : null,
      })
    } else {
      connector = { ...connector, bends: [] }
      if (startNode !== null) connector = { ...connector, start: normalised(boundaryPoint(startNode, a, b, size)) }
      if (endNode !== null) connector = { ...connector, end: normalised(boundaryPoint(endNode, b, a, size)) }
    }
    // Only write it back when something actually moved.
    if (JSON.stringify(connector) !== before) {
      items[index] = { kind: "connector", connector }
      changed = true
    }
  }

  if (routedIndices.length > 0) {
    /** A free end is a box with no size: the routing joins two boxes. */
    const boxOf = (given: Rect | null, p: Point): Rect => given ?? { x: p.x, y: p.y, width: 0, height: 0 }
    const endsOf = (offset: number, connector: ConnectorItem): [Rect, Rect] => {
      const boxes = routedBoxes[offset]!
      return [
        boxOf(boxes.start, { x: connector.start.x * size.width, y: connector.start.y * size.height }),
        boxOf(boxes.end, { x: connector.end.x * size.width, y: connector.end.y * size.height }),
      ]
    }

    const paths: Point[][] = routedIndices.map((index, offset) => {
      const item = items[index]!
      if (item.kind !== "connector") return []
      const [from, to] = endsOf(offset, item.connector)
      const others = obstacleBoxes.filter((box) => !sameRect(box, from) && !sameRect(box, to))
      return connectorPath(from, to, others)
    })

    // Two lines that would run down the same corridor are moved apart —
    // unless a hand put one there.
    const fixed = new Set<number>()
    routedIndices.forEach((index, offset) => {
      const item = items[index]!
      if (item.kind === "connector" && (item.connector.overrides?.length ?? 0) > 0) fixed.add(offset)
    })
    const lanes = channelsFor(paths, fixed)

    routedIndices.forEach((index, offset) => {
      const item = items[index]!
      if (item.kind !== "connector") return
      const connector = item.connector
      const boxes = routedBoxes[offset]!
      const [from, to] = endsOf(offset, connector)
      const others = obstacleBoxes.filter((box) => !sameRect(box, from) && !sameRect(box, to))
      let path = connectorPath(from, to, others, lanes[offset]!)
      path = applyingOverrides(connector.overrides ?? [], path, boxes.start, boxes.end, size)
      const next: ConnectorItem = {
        ...connector,
        start: normalised(path[0]!),
        end: normalised(path[path.length - 1]!),
        bends: path.slice(1, -1).map(normalised),
      }
      if (JSON.stringify(next) !== JSON.stringify(connector)) {
        items[index] = { kind: "connector", connector: next }
        changed = true
      }
    })
  }
  return changed ? { items } : drawing
}
