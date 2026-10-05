/**
 * Where an object actually is: the base points, the matrix, hit testing on
 * the INK rather than the box, marquee intersection where touching is
 * enough, and the move/scale/rotate maths a group and a single object
 * share. Ported from `WriteMind/Drawing/DrawingGeometry.swift`.
 *
 * Pure, and tested — the same reason it was pure over there.
 */

import {
  isClosed as shapeIsClosed, isNode, polylines, type Point, type Rect,
} from "./shapes"
import {
  isHidden, itemTransform, type CanvasItem, type Drawing, type ItemTransform,
} from "./model"

export interface Size { width: number; height: number }

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Distance from a point to a line segment. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 0) return distance(point, a)
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
  t = Math.min(Math.max(t, 0), 1)
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy })
}

export const rectFrom = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
})

export const rectContains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.x && point.x <= rect.x + rect.width
  && point.y >= rect.y && point.y <= rect.y + rect.height

const direction = (a: Point, b: Point, c: Point): number =>
  (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)

const onSegment = (a: Point, b: Point, point: Point): boolean =>
  Math.min(a.x, b.x) <= point.x && point.x <= Math.max(a.x, b.x)
  && Math.min(a.y, b.y) <= point.y && point.y <= Math.max(a.y, b.y)

/** Do two segments cross? Orientation signs, with the collinear cases folded in. */
export function cross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = direction(p3, p4, p1), d2 = direction(p3, p4, p2)
  const d3 = direction(p1, p2, p3), d4 = direction(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  if (d1 === 0 && onSegment(p3, p4, p1)) return true
  if (d2 === 0 && onSegment(p3, p4, p2)) return true
  if (d3 === 0 && onSegment(p1, p2, p3)) return true
  if (d4 === 0 && onSegment(p1, p2, p4)) return true
  return false
}

export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (rectContains(rect, a) || rectContains(rect, b)) return true
  const corners: Point[] = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
  ]
  for (let index = 0; index < 4; index++) {
    if (cross(a, b, corners[index]!, corners[(index + 1) % 4]!)) return true
  }
  return false
}

/** Where segment a–b crosses segment c–d, or null when it does not. */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-9) return null
  const ac = { x: c.x - a.x, y: c.y - a.y }
  const t = (ac.x * s.y - ac.y * s.x) / denominator
  const u = (ac.x * r.y - ac.y * r.x) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a.x + t * r.x, y: a.y + t * r.y }
}

export function polygonContains(points: Point[], point: Point): boolean {
  if (points.length <= 2) return false
  let inside = false
  let j = points.length - 1
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[j]!
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
    j = i
  }
  return inside
}

/** The box a centred, width-and-aspect item occupies, in view points. */
export function boxOf(center: Point, width: number, aspect: number, size: Size): Rect {
  const w = width * size.width
  const h = w * aspect
  return { x: center.x * size.width - w / 2, y: center.y * size.height - h / 2, width: w, height: h }
}

const cornersOf = (rect: Rect): Point[] => [
  { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
]

/** How long an arrow's head is, for a line this wide. */
export const headLength = (lineWidth: number): number => 7 + 2.5 * lineWidth

/** The whole route of a connector, ends included. */
export const route = (connector: { start: Point; end: Point; bends: Point[] }): Point[] =>
  [connector.start, ...connector.bends, connector.end]

/**
 * The outline before the transform, in view points: a stroke's own points,
 * or the four corners of a picture.
 */
export function basePoints(item: CanvasItem, size: Size): Point[] {
  switch (item.kind) {
    case "stroke":
      return item.stroke.points.map((p) => ({ x: p.x * size.width, y: p.y * size.height }))
    case "image":
      return cornersOf(boxOf(item.image.center, item.image.width, item.image.aspect, size))
    case "shape":
      // Every polyline of it, so a cross's box still holds both strokes.
      return polylines(item.shape.kind,
        boxOf(item.shape.center, item.shape.width, item.shape.aspect, size)).flat()
    case "connector":
      return route(item.connector).map((p) => ({ x: p.x * size.width, y: p.y * size.height }))
  }
}

/** A picture and a closed shape are hit anywhere inside; a line only on the line. */
export function itemIsClosed(item: CanvasItem): boolean {
  switch (item.kind) {
    case "image": return true
    case "shape": return shapeIsClosed(item.shape.kind)
    default: return false
  }
}

const unionRect = (points: Point[]): Rect => {
  // A loop, not Math.min(...xs): a very long stroke would overflow the argument limit.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const inset = (rect: Rect, by: number): Rect => ({
  x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2,
})

/**
 * The box the item occupies before the transform. A stroke's ink is as wide
 * as the pen, so half a nib is added on every side.
 */
export function baseBounds(item: CanvasItem, size: Size): Rect {
  if (item.kind === "shape") {
    // The box the shape was drawn into, not the outline's extent — a check
    // mark's handles should hold its box, not hug the tick.
    return boxOf(item.shape.center, item.shape.width, item.shape.aspect, size)
  }
  const points = basePoints(item, size)
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const rect = unionRect(points)
  if (item.kind === "stroke") return inset(rect, item.stroke.width / 2)
  if (item.kind === "connector") {
    return inset(rect, Math.max(item.connector.lineWidth / 2, headLength(item.connector.lineWidth) / 2))
  }
  return rect
}

export function baseCenter(item: CanvasItem, size: Size): Point {
  const rect = baseBounds(item, size)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** Where the item's centre actually is now. */
export function placedCenter(item: CanvasItem, size: Size): Point {
  const centre = baseCenter(item, size)
  const transform = itemTransform(item)
  return { x: centre.x + transform.dx * size.width, y: centre.y + transform.dy * size.height }
}

/**
 * Rotate and scale about the item's own centre, then translate — the same
 * matrix `CGAffineTransform` was building, written out.
 */
export function applyMatrix(item: CanvasItem, size: Size, point: Point): Point {
  return matrixOf(item, size)(point)
}

/**
 * The same matrix as a function of a point, with the item's centre worked out
 * ONCE. The centre of a stroke is the middle of its box, which is a pass over
 * all its points: asking for it again for every point made every outline, hit
 * test and repaint quadratic in the length of the stroke (a 500-point stroke
 * cost a quarter of a million point allocations each time it was painted).
 */
export function matrixOf(item: CanvasItem, size: Size): (point: Point) => Point {
  const centre = baseCenter(item, size)
  const t = itemTransform(item)
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation)
  const ox = centre.x + t.dx * size.width, oy = centre.y + t.dy * size.height
  return (point) => {
    const x = (point.x - centre.x) * t.scale
    const y = (point.y - centre.y) * t.scale
    return { x: ox + x * c - y * s, y: oy + x * s + y * c }
  }
}

/** The outline where it is now. */
export const outline = (item: CanvasItem, size: Size): Point[] =>
  basePoints(item, size).map(matrixOf(item, size))

/** The four corners of the item's own box where they are now. */
export const frameCorners = (item: CanvasItem, size: Size): Point[] =>
  cornersOf(baseBounds(item, size)).map(matrixOf(item, size))

/** The upright box around the item where it is now — what the handles hang off. */
export function bounds(item: CanvasItem, size: Size): Rect {
  return unionRect(frameCorners(item, size))
}

/** The upright box around a set of items. */
export function boundsOf(drawing: Drawing, ids: Set<string>, size: Size): Rect | null {
  const boxes = drawing.items
    .filter((item) => ids.has(itemIdOf(item)) && !isHidden(item))
    .map((item) => bounds(item, size))
  if (boxes.length === 0) return null
  return boxes.reduce((whole, box) => {
    const minX = Math.min(whole.x, box.x), minY = Math.min(whole.y, box.y)
    return {
      x: minX, y: minY,
      width: Math.max(whole.x + whole.width, box.x + box.width) - minX,
      height: Math.max(whole.y + whole.height, box.y + box.height) - minY,
    }
  })
}

const itemIdOf = (item: CanvasItem): string => {
  switch (item.kind) {
    case "stroke": return item.stroke.id
    case "image": return item.image.id
    case "shape": return item.shape.id
    case "connector": return item.connector.id
  }
}

const near = (point: Point, lines: Point[][], reach: number): boolean => {
  for (const line of lines) {
    if (line.length < 2) continue
    for (let index = 0; index < line.length - 1; index++) {
      if (distanceToSegment(point, line[index]!, line[index + 1]!) <= reach) return true
    }
  }
  return false
}

/**
 * Does a click land on the item? ON THE INK, not on the box around it —
 * otherwise one big stroke would swallow every click near it.
 */
export function hitTest(item: CanvasItem, point: Point, size: Size): boolean {
  const shape = outline(item, size)
  if (shape.length === 0) return false
  const scale = itemTransform(item).scale
  switch (item.kind) {
    case "image":
      return polygonContains(shape, point)
    case "shape": {
      const reach = Math.max((item.shape.lineWidth * scale) / 2, 6)
      if (shapeIsClosed(item.shape.kind)) {
        return polygonContains(shape, point) || near(point, [[...shape, shape[0]!]], reach)
      }
      const place = matrixOf(item, size)
      const lines = polylines(item.shape.kind, baseBounds(item, size))
        .map((line) => line.map(place))
      return near(point, lines, reach)
    }
    case "connector":
      return near(point, [shape], Math.max((item.connector.lineWidth * scale) / 2, 6))
    case "stroke": {
      const reach = Math.max((item.stroke.width * scale) / 2, 6)
      if (shape.length === 1) return distance(point, shape[0]!) <= reach
      return near(point, [shape], reach)
    }
  }
}

/** How far apart two segments are: 0 when they cross or touch. */
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (cross(a, b, c, d)) return 0
  return Math.min(
    distanceToSegment(a, c, d), distanceToSegment(b, c, d),
    distanceToSegment(c, a, b), distanceToSegment(d, a, b),
  )
}

/**
 * The strokes the eraser rubs out in moving from `from` to `to`: every stroke whose ink the path in between
 * comes within reach of — not only the strokes under the two ends. A pen at 60 Hz moving across the page
 * reports a point every 20 to 30 points, and testing the points alone let an eraser pass straight over a
 * stroke that lay between two of them (a quick scribble left half the strokes behind). A click is the same
 * thing with `from == to`.
 */
export function strokesSwept(drawing: Drawing, from: Point, to: Point, size: Size): Set<string> {
  const out = new Set<string>()
  for (const item of drawing.items) {
    if (item.kind !== "stroke" || isHidden(item)) continue
    const shape = outline(item, size)
    if (shape.length === 0) continue
    const reach = Math.max((item.stroke.width * item.stroke.transform.scale) / 2, 6)
    if (shape.length === 1) {
      if (distanceToSegment(shape[0]!, from, to) <= reach) out.add(item.stroke.id)
      continue
    }
    for (let index = 0; index < shape.length - 1; index++) {
      if (segmentDistance(from, to, shape[index]!, shape[index + 1]!) <= reach) {
        out.add(item.stroke.id)
        break
      }
    }
  }
  return out
}

/**
 * Does the marquee touch the item at all? Touching is enough — the whole
 * drawing does not have to be inside the rectangle.
 */
export function intersects(item: CanvasItem, rect: Rect, size: Size): boolean {
  const shape = outline(item, size)
  if (shape.length === 0) return false
  if (shape.some((point) => rectContains(rect, point))) return true
  if (shape.length === 1) return false
  const closed = itemIsClosed(item)
  for (let index = 0; index < shape.length - 1; index++) {
    if (segmentIntersectsRect(shape[index]!, shape[index + 1]!, rect)) return true
  }
  if (closed && segmentIntersectsRect(shape[shape.length - 1]!, shape[0]!, rect)) return true
  // A marquee drawn entirely inside a picture still selects it.
  return closed && polygonContains(shape,
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
}

/** The topmost item under a point — a hidden picture is not there at all. */
export function indexAt(drawing: Drawing, point: Point, size: Size): number | null {
  for (let index = drawing.items.length - 1; index >= 0; index--) {
    const item = drawing.items[index]!
    if (isHidden(item)) continue
    if (hitTest(item, point, size)) return index
  }
  return null
}

/**
 * The topmost node (a flow-chart shape or a picture) under a point — the
 * Swift `attachable(at:)`. An arrow dropped with an end here is attached to
 * it, and follows it from then on.
 */
export function attachableAt(drawing: Drawing, point: Point, size: Size): string | null {
  for (let index = drawing.items.length - 1; index >= 0; index--) {
    const item = drawing.items[index]!
    if (isHidden(item)) continue
    const node = item.kind === "image" || (item.kind === "shape" && isNode(item.shape.kind))
    if (node && hitTest(item, point, size)) return itemIdOf(item)
  }
  return null
}

/** Everything the marquee touches. */
export function idsTouching(drawing: Drawing, rect: Rect, size: Size): Set<string> {
  const out = new Set<string>()
  for (const item of drawing.items) {
    if (isHidden(item)) continue
    if (intersects(item, rect, size)) out.add(itemIdOf(item))
  }
  return out
}

/**
 * Where `item` ends up after a gesture that started with `original`:
 * dragged by `translate`, then scaled and turned about `pivot`. Pure, and
 * shared by the drag of the items themselves and the drags of the handles,
 * so one item and a group of twelve behave the same way.
 */
export function transformed(item: CanvasItem, original: ItemTransform, options: {
  translate?: { dx: number; dy: number }
  scale?: number
  rotate?: number
  pivot: Point
  size: Size
}): ItemTransform {
  const { pivot, size } = options
  if (size.width <= 0 || size.height <= 0) return original
  const translate = options.translate ?? { dx: 0, dy: 0 }
  const scale = options.scale ?? 1
  const rotate = options.rotate ?? 0

  const snapshot = { ...item } as CanvasItem
  const placed = placedCenter(withOriginal(snapshot, original), size)
  const moved = { x: placed.x + translate.dx, y: placed.y + translate.dy }
  const offset = { x: moved.x - pivot.x, y: moved.y - pivot.y }
  const c = Math.cos(rotate), s = Math.sin(rotate)
  const turned = {
    x: pivot.x + scale * (offset.x * c - offset.y * s),
    y: pivot.y + scale * (offset.x * s + offset.y * c),
  }
  const base = baseCenter(item, size)
  return {
    scale: Math.max(0.02, original.scale * scale),
    rotation: original.rotation + rotate,
    dx: (turned.x - base.x) / size.width,
    dy: (turned.y - base.y) / size.height,
  }
}

const withOriginal = (item: CanvasItem, transform: ItemTransform): CanvasItem => {
  switch (item.kind) {
    case "stroke": return { kind: "stroke", stroke: { ...item.stroke, transform } }
    case "image": return { kind: "image", image: { ...item.image, transform } }
    case "shape": return { kind: "shape", shape: { ...item.shape, transform } }
    case "connector": return { kind: "connector", connector: { ...item.connector, transform } }
  }
}

/**
 * Where a line from `centre` towards `target` leaves the item — the point
 * an arrow attached to it lands on. The OUTERMOST crossing of the outline,
 * so a star's arrow stops at its points.
 */
export function boundaryPoint(item: CanvasItem, centre: Point, target: Point, size: Size): Point {
  const shape = outline(item, size)
  if (shape.length < 2) return centre
  const edges: [Point, Point][] = []
  for (let index = 0; index < shape.length - 1; index++) edges.push([shape[index]!, shape[index + 1]!])
  edges.push([shape[shape.length - 1]!, shape[0]!])
  let best: { t: number; point: Point } | null = null
  for (const [a, b] of edges) {
    const hit = segmentIntersection(centre, target, a, b)
    if (!hit) continue
    const t = distance(centre, hit)
    if (!best || t > best.t) best = { t, point: hit }
  }
  return best ? best.point : centre
}

/** The angle of a point about a pivot — what a rotate handle is dragged through. */
export const angleAbout = (point: Point, pivot: Point): number =>
  Math.atan2(point.y - pivot.y, point.x - pivot.x)

/**
 * How much bigger the drag has made the selection. Clamped, so a flick
 * through the pivot cannot turn an object inside out.
 */
export function scaleFactor(start: Point, current: Point, pivot: Point): number {
  const before = distance(start, pivot)
  if (before <= 1) return 1
  return Math.min(Math.max(distance(current, pivot) / before, 0.05), 20)
}

/**
 * A picture with only the part inside `rect` (fractions of it, top-left
 * origin) left, on a new file: the kept part stays exactly where it was on
 * the pane, and the transform is untouched.
 */
export function cropped(item: CanvasItem, rect: Rect, file: string, aspect: number, size: Size):
CanvasItem {
  if (item.kind !== "image" || size.width <= 0 || size.height <= 0) return item
  const image = item.image
  const base = baseBounds(item, size)
  // The kept part's centre before the transform, and where it is now.
  const centre = {
    x: base.x + (rect.x + rect.width / 2) * base.width,
    y: base.y + (rect.y + rect.height / 2) * base.height,
  }
  const placed = applyMatrix(item, size, centre)
  // The transform turns and scales about the item's own centre and then
  // moves it by (dx, dy), so the new centre goes where the kept part is
  // now, less that move.
  return {
    kind: "image",
    image: {
      ...image,
      file,
      width: image.width * rect.width,
      aspect,
      center: {
        x: (placed.x - image.transform.dx * size.width) / size.width,
        y: (placed.y - image.transform.dy * size.height) / size.height,
      },
    },
  }
}

/**
 * One corner of the crop box dragged to `point` (fractions of the picture):
 * 0 top left, 1 top right, 2 bottom right, 3 bottom left. The box stays
 * inside the picture and never thinner than `minimum`.
 */
export function cropRect(rect: Rect, corner: number, point: Point, minimum = 0.05): Rect {
  const x = Math.min(Math.max(point.x, 0), 1), y = Math.min(Math.max(point.y, 0), 1)
  let minX = rect.x, minY = rect.y
  let maxX = rect.x + rect.width, maxY = rect.y + rect.height
  switch (corner) {
    case 0: minX = Math.min(x, maxX - minimum); minY = Math.min(y, maxY - minimum); break
    case 1: maxX = Math.max(x, minX + minimum); minY = Math.min(y, maxY - minimum); break
    case 2: maxX = Math.max(x, minX + minimum); maxY = Math.max(y, minY + minimum); break
    default: minX = Math.min(x, maxX - minimum); maxY = Math.max(y, minY + minimum); break
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Where a new picture lands: under the caret's line, one gap below it and
 * flush with the text's left edge — and NOTHING MOVES to make room, because
 * the object floats over the note and the note does not know it is there.
 * The middle of what is on screen when there is no caret to go by.
 */
export function placedCentre(options: {
  width: number
  height: number
  pane: Size
  scroll: number
  caretLine?: Rect | null
  gap?: number
}): Point {
  const { width, height, pane, scroll } = options
  const gap = options.gap ?? 8
  const line = options.caretLine
  if (!line) {
    return { x: 0.5, y: (scroll + pane.height / 2) / Math.max(pane.height, 1) }
  }
  const x = Math.min(line.x + width / 2, Math.max(width / 2, pane.width - width / 2))
  const y = line.y + line.height + gap + height / 2
  return { x: x / Math.max(pane.width, 1), y: y / Math.max(pane.height, 1) }
}
