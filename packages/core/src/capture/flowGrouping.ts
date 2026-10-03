/**
 * A sketched flow chart lifted off a page: which blob of ink is a box,
 * which words are its label, and which arrow joins which pair of boxes.
 *
 * Ported from `WriteMind/Camera/FlowGrouping.swift`. The idea the whole
 * thing turns on: a NODE IS A HOLE. A drawn box, oval or diamond encloses a
 * piece of paper, and that piece of paper is a background region the page's
 * edge cannot reach. Finding nodes as holes rather than as blobs survives
 * the two things that ruin blob analysis on a real page — an arrow that
 * touches the box (the blob merges, the hole does not) and a box drawn in
 * two strokes that do not quite meet (one closing pass and the hole is
 * back).
 *
 * Masks are `Uint8Array`s of 0/1; rectangles are `{x, y, width, height}`
 * in mask pixels with the origin at the top left.
 */

import type { Size } from "../drawing/geometry"
import { newID } from "../drawing/model"
import type { Point, Rect } from "../drawing/shapes"
import { components, componentCentre, type Component } from "./ink"
import {
  makeRect, rectArea, rectContainsPoint, rectContainsRect, rectInset, rectIntersection,
  rectIntersects, rectMaxX, rectMaxY, rectMidX, rectMidY, rectMinX, rectMinY, rectUnion,
} from "./rects"

// MARK: - What comes out

export interface FlowNode {
  index: number
  /** The outer edge of the drawn outline, in mask pixels. */
  box: Rect
  /** The paper it encloses. */
  hole: Rect
  kind: string
  /** How far the hole's own edges sit from that shape's, a fraction of its width. */
  kindError: number
  /** How much of its own box the paper inside fills. */
  holeFill: number
  skew: number
  label: string
  words: number[]
  /** The node this one is drawn inside, if any. */
  parent: number | null
  /** Cells of a table are not flow-chart nodes. */
  isTableCell: boolean
  /** A ring drawn round a word to stress it, not a box round a step. */
  isEmphasis: boolean
  /** Set when the hole is no shape at all. */
  isShapeless: boolean
}

export const isFlowNode = (n: FlowNode): boolean =>
  !n.isTableCell && !n.isEmphasis && !n.isShapeless

export interface FlowEdge {
  from: number | null
  to: number | null
  /** Ends in mask pixels, tail first. */
  tail: Point
  head: Point
  headAtEnd: boolean
  headAtStart: boolean
  /** Why an end is loose, for the report. */
  note: string
}

export interface FlowRejected { reason: string; box: Rect }

export interface FlowSheet {
  width: number
  height: number
  strokeWidth: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  tables: Rect[]
  freeWords: number[]
  rejected: FlowRejected[]
}

/** A word the recogniser read, with its box in MASK pixels (top-left origin). */
export interface FlowWord { text: string; box: Rect }

// MARK: - The numbers

export interface FlowSettings {
  /** A hole smaller than this across is a letter's counter, not a box (fraction of the short side). */
  minimumHoleSide: number
  /** …and it has to have some area as well as some width. */
  minimumHoleArea: number
  /** Closing this much joins up a box whose ends did not meet. */
  closingRadius: number
  /** A word is a node's label when this much of it is inside. */
  labelCoverage: number
  /** How far an arrow's end may stop short of a box and still count. */
  attachTolerance: number
  /** Two boxes this close to equally near an end make it ambiguous. */
  ambiguityRatio: number
  /** A stroke shorter than this is not a connector. */
  minimumStrokeLength: number
  /** End-to-end distance over the length of the line actually drawn. */
  straightness: number
  /** A stroke with this much of itself lying in a box's outline is a crumb of it. */
  debrisShare: number
  headRatio: number
  /** Both ends this much heavier than the shaft: a two-headed arrow. */
  doubleHeadRatio: number
  underlineOverlap: number
  underlineDrop: number
  /** How far past the paper inside a box the outline is rubbed out, in stroke widths. */
  outlineGrow: number
  /** Below headRatio but above this, the heavier end still carries the head. */
  weakHeadRatio: number
  /** With no head to be seen at all, a chart is read down the page and left to right. */
  readingOrder: boolean
  /** A hole whose edges are further than this from every shape's is not a box. */
  shapeError: number
  /** A ring holding a word this tightly, with nothing on it, is emphasis. */
  emphasisFill: number
}

export const defaultFlowSettings = (): FlowSettings => ({
  minimumHoleSide: 1.0 / 22,
  minimumHoleArea: 0.4,
  closingRadius: 1.0 / 100,
  labelCoverage: 0.5,
  attachTolerance: 1.0 / 22,
  ambiguityRatio: 1.3,
  minimumStrokeLength: 1.0 / 18,
  straightness: 0.5,
  debrisShare: 0.85,
  headRatio: 1.35,
  doubleHeadRatio: 1.5,
  underlineOverlap: 0.55,
  underlineDrop: 0.55,
  outlineGrow: 1.3,
  weakHeadRatio: 1.25,
  readingOrder: true,
  shapeError: 0.075,
  emphasisFill: 0.25,
})

const roundAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))

// MARK: - Holes

export interface Hole {
  box: Rect
  area: number
  /** y → (first x, last x, count) — enough to tell a diamond from a triangle without keeping every pixel. */
  rows: Map<number, [number, number, number]>
}

/** Background the page's edge cannot reach, 4-connected so a diagonal touch of ink still seals a box. */
export function findHoles(ink: Uint8Array, width: number, height: number): Hole[] {
  const seen = new Uint8Array(width * height)
  const out: Hole[] = []
  const stack: number[] = []
  for (let start = 0; start < width * height; start++) {
    if (ink[start] || seen[start]) continue
    let area = 0
    let minX = width, maxX = -1, minY = height, maxY = -1
    const rows = new Map<number, [number, number, number]>()
    let open = false
    seen[start] = 1
    stack.push(start)
    while (stack.length > 0) {
      const index = stack.pop()!
      const x = index % width, y = Math.floor(index / width)
      area += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const had = rows.get(y)
      if (had !== undefined) rows.set(y, [Math.min(had[0], x), Math.max(had[1], x), had[2] + 1])
      else rows.set(y, [x, x, 1])
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) open = true
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const n = ny * width + nx
        if (!ink[n] && !seen[n]) { seen[n] = 1; stack.push(n) }
      }
    }
    if (open) continue
    out.push({ box: makeRect(minX, minY, maxX - minX + 1, maxY - minY + 1), area, rows })
  }
  return out
}

// MARK: - Entry point

export function readFlow(ink: Uint8Array, width: number, height: number, words: FlowWord[],
  settings: FlowSettings = defaultFlowSettings()): FlowSheet {
  const shortSide = Math.min(width, height)
  const stroke = strokeWidthOf(ink, width, height)
  const closingRadius = Math.max(2, roundAway(settings.closingRadius * shortSide))
  const closedInk = closingBox(ink, width, height, closingRadius)

  // 1. Nodes are the holes.
  const minSide = Math.max(6.0, settings.minimumHoleSide * shortSide)
  // Letters' counters go now; the slivers a word cuts a box into stay,
  // because two of them put together are still a box.
  const holes = findHoles(closedInk, width, height).filter((hole) =>
    Math.min(hole.box.width, hole.box.height) >= minSide / 3
    && Math.max(hole.box.width, hole.box.height) >= minSide
    && hole.area >= (minSide * minSide * settings.minimumHoleArea) / 3)

  // 2. A word that crosses an outline cuts the paper inside in two. Where a
  //    word straddles the cut, the two pieces are one node.
  const merged = mergeSplitHoles(holes, words).filter((hole) =>
    hole.box.width >= minSide && hole.box.height >= minSide
    && hole.area >= minSide * minSide * settings.minimumHoleArea)

  // 3. A ring of boxes joined by arrows encloses a piece of paper too, and
  //    that piece is not a box. The bigger of two half-overlapping holes is the loop.
  const kept = withoutLoops(merged)

  // 4. A grid of same-sized holes is a table, not a row of nodes.
  const { boxes: tableGroups, members: tableMembers } = findTables(kept, stroke)

  const nodes: FlowNode[] = []
  kept.forEach((hole, index) => {
    const grown = rectInset(hole.box, -(stroke + 2), -(stroke + 2))
    const fit = kindOfHole(hole)
    nodes.push({
      index, box: grown, hole: hole.box, kind: fit.name, kindError: fit.error,
      holeFill: hole.area / Math.max(1, hole.box.width * hole.box.height),
      skew: slide(hole), label: "", words: [], parent: null,
      isTableCell: tableMembers.has(index), isEmphasis: false,
      isShapeless: fit.error > settings.shapeError,
    })
  })

  // 4. Nesting: the smallest box that holds this one is its parent.
  for (let i = 0; i < nodes.length; i++) {
    let best: number | null = null
    for (let j = 0; j < nodes.length; j++) {
      if (i === j || !rectContainsRect(nodes[j]!.box, nodes[i]!.box)) continue
      if (best === null || rectArea(nodes[j]!.box) < rectArea(nodes[best]!.box)) best = j
    }
    nodes[i]!.parent = best
  }

  // 5. Labels: the innermost box that holds enough of the word.
  const freeWords: number[] = []
  words.forEach((word, w) => {
    if (!(word.box.width > 0 && word.box.height > 0)) return
    let best: number | null = null
    for (let i = 0; i < nodes.length; i++) {
      if (!(isFlowNode(nodes[i]!) || nodes[i]!.isTableCell)) continue
      const cover = rectArea(rectIntersection(nodes[i]!.box, word.box)) / rectArea(word.box)
      if (!(cover >= settings.labelCoverage)) continue
      if (best === null || rectArea(nodes[i]!.box) < rectArea(nodes[best]!.box)) best = i
    }
    if (best !== null) nodes[best]!.words.push(w); else freeWords.push(w)
  })
  for (const node of nodes) {
    node.label = node.words.slice()
      .sort((a, b) => {
        const wa = words[a]!.box, wb = words[b]!.box
        return wa.y === wb.y ? wa.x - wb.x : wa.y - wb.y
      })
      .map((i) => words[i]!.text).join(" ")
  }

  // 6. What is left of the ink once the outlines are gone: the strokes.
  // Only the outlines of things that really are boxes come away.
  const outlines = nodes.filter((n) => !n.isShapeless).map((n) => kept[n.index]!)
  const strokeMask = withoutOutlines(ink, width, height, outlines, stroke, settings.outlineGrow)
  const pieces = components(strokeMask, width, height)
  const edges: FlowEdge[] = []
  const rejected: FlowRejected[] = []
  const minLength = settings.minimumStrokeLength * shortSide
  const tolerance = settings.attachTolerance * shortSide

  // An arrow whose head landed ON a box loses the head when the outline is
  // rubbed out: the two barbs come away as their own little blobs. They are
  // kept, because where they lie is the best evidence left of which end the
  // head was.
  const crumbs: { centre: Point; area: number }[] = []
  for (const piece of pieces) {
    if (!(piece.pixels.length >= Math.trunc(stroke * 3))) continue
    if (!(Math.max(pieceWidth(piece), pieceHeight(piece)) < Math.trunc(minLength))) continue
    const pbox = pieceBox(piece)
    if (words.some((w) => rectArea(rectIntersection(w.box, pbox)) > 0)) continue
    crumbs.push({ centre: componentCentre(piece), area: piece.pixels.length })
  }
  const barbs = (p: Point, radius: number): number =>
    crumbs.filter((c) => Math.hypot(c.centre.x - p.x, c.centre.y - p.y) <= radius)
      .reduce((s, c) => s + c.area, 0)

  for (const piece of pieces) {
    const box = pieceBox(piece)
    // Label text: it sits inside a node, or it is a word the recogniser read.
    if (words.some((w) => rectArea(rectIntersection(w.box, box)) > rectArea(box) / 2)) {
      rejected.push({ reason: "text", box }); continue
    }
    const ends2 = endpointsOf(piece, width)
    if (ends2 === null) continue
    const [a, b] = ends2
    const length = Math.hypot(a.x - b.x, a.y - b.y)
    if (!(length >= minLength)) { rejected.push({ reason: "short", box }); continue }
    // Near enough straight: the ink drawn (its area over the pen's width) is
    // not much more than the distance between the ends. A scribble runs to
    // several times that.
    const drawn = piece.pixels.length / stroke
    if (!(length / Math.max(drawn, 1) >= settings.straightness)) {
      rejected.push({ reason: "scribble", box }); continue
    }
    // A crumb of an outline the rubbing out left behind.
    if (debrisOf(piece, outlines, stroke, settings.outlineGrow) >= settings.debrisShare) {
      rejected.push({ reason: "outline crumb", box }); continue
    }

    // Which end carries the barbs, along the stroke's OWN axis rather than
    // its box, so a diagonal arrow is read too. A barb is about as long
    // whatever the arrow's length, so the ink is weighed in a window of that
    // size at each end.
    const window = Math.min(length * 0.3, Math.max(stroke * 8 + 10, 30))
    const [atA, atB, shaftDensity] = endsOf(piece, a, b, length, window, width)
    const ratio = Math.max(atA, atB) / Math.max(1, Math.min(atA, atB))
    let tail = a, head = b
    let headAtEnd = false, headAtStart = false
    let sawBarbs = false
    if (ratio >= settings.weakHeadRatio) {
      if (atA > atB) { tail = b; head = a }
      headAtEnd = true
      sawBarbs = true
    } else {
      // No barbs left on the stroke itself: look for the blobs the rubbing
      // out knocked off, by each end.
      const reach = window * 1.4
      const barbsA = barbs(a, reach), barbsB = barbs(b, reach)
      const floor = Math.trunc(stroke * stroke * 4)
      if (Math.max(barbsA, barbsB) >= floor
        && Math.max(barbsA, barbsB) >= Math.max(1, Math.min(barbsA, barbsB)) * 1.5) {
        if (barbsA > barbsB) { tail = b; head = a }
        headAtEnd = true
        sawBarbs = true
      } else if (settings.readingOrder) {
        // Nothing to choose between the ends: a chart is read down the page,
        // and left to right where two things are level.
        if (Math.abs(b.y - a.y) >= Math.abs(b.x - a.x)) {
          if (a.y > b.y) { tail = b; head = a }
        } else if (a.x > b.x) { tail = b; head = a }
        headAtEnd = true
      }
    }
    // Both ends heavier than the plain shaft between them: two heads.
    const plain = shaftDensity * window
    if (!sawBarbs && plain > 0 && Math.min(atA, atB) >= plain * settings.doubleHeadRatio) {
      headAtEnd = true; headAtStart = true
    }

    const [fromNode, fromNote] = attach(tail, nodes, tolerance, settings)
    const [toNode, toNote] = attach(head, nodes, tolerance, settings)

    if (fromNode === null && toNode === null) {
      if (isUnderline(tail, head, stroke, words, settings)) {
        rejected.push({ reason: "underline", box }); continue
      }
      if (!sawBarbs) { rejected.push({ reason: "loose line", box }); continue }
    }
    if (fromNode !== null && fromNode === toNode) {
      rejected.push({ reason: "both ends on one box", box }); continue
    }
    edges.push({
      from: fromNode, to: toNode, tail, head, headAtEnd, headAtStart,
      note: [fromNote, toNote].filter((s) => s !== "")
        .concat([`len${length.toFixed(0)} ends ${atA}/${atB} r${ratio.toFixed(2)}${sawBarbs ? "" : " byorder"}`])
        .join(" "),
    })
  }

  // 7. A ring round a word with nothing attached is emphasis.
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.words.length === 0 || node.parent !== null || node.isTableCell) continue
    if (nodes.some((n) => n.parent === i)) continue
    if (edges.some((e) => e.from === i || e.to === i)) continue
    // A box has room round its label; a ring drawn to stress a word hugs it.
    const covered = node.words.map((w) => rectArea(words[w]!.box)).reduce((s, v) => s + v, 0)
      / rectArea(node.hole)
    if (covered >= settings.emphasisFill) node.isEmphasis = true
  }

  return { width, height, strokeWidth: stroke, nodes, edges, tables: tableGroups, freeWords, rejected }
}

const pieceWidth = (c: Component): number => c.maxX - c.minX + 1
const pieceHeight = (c: Component): number => c.maxY - c.minY + 1
const pieceBox = (c: Component): Rect => makeRect(c.minX, c.minY, pieceWidth(c), pieceHeight(c))

// MARK: - Which box an end belongs to

/**
 * The box nearest an arrow's end, when one is near enough and no other is
 * nearly as near. Inside a box beats near one; when an end is inside two
 * nested boxes it belongs to the OUTER one, because the arrow came from
 * outside and that is the edge it crossed.
 */
export function attach(point: Point, nodes: FlowNode[], tolerance: number,
  settings: FlowSettings): [number | null, string] {
  const inside: number[] = []
  const near: { index: number; distance: number }[] = []
  nodes.forEach((node, i) => {
    if (!isFlowNode(node)) return
    const d = distanceToBox(point, node.box)
    if (d === 0) inside.push(i); else if (d <= tolerance) near.push({ index: i, distance: d })
  })
  if (inside.length > 0) {
    // The outermost of the boxes it is inside: the first of equal areas wins.
    let outer = inside[0]!
    for (const i of inside) if (rectArea(nodes[i]!.box) > rectArea(nodes[outer]!.box)) outer = i
    return [outer, ""]
  }
  if (near.length === 0) return [null, "free end"]
  near.sort((p, q) => p.distance - q.distance)
  if (near.length >= 2 && near[1]!.distance <= near[0]!.distance * settings.ambiguityRatio) {
    return [near[0]!.index, "ambiguous end"]
  }
  return [near[0]!.index, ""]
}

export function distanceToBox(point: Point, box: Rect): number {
  const dx = Math.max(rectMinX(box) - point.x, 0, point.x - rectMaxX(box))
  const dy = Math.max(rectMinY(box) - point.y, 0, point.y - rectMaxY(box))
  return Math.hypot(dx, dy)
}

// MARK: - A line under a word

export function isUnderline(tail: Point, head: Point, stroke: number, words: FlowWord[],
  settings: FlowSettings): boolean {
  const dy = Math.abs(tail.y - head.y), dx = Math.abs(tail.x - head.x)
  if (!(dx > 0 && dy <= stroke * 2.5)) return false
  const x0 = Math.min(tail.x, head.x), x1 = Math.max(tail.x, head.x)
  const y = (tail.y + head.y) / 2
  for (const word of words) {
    if (!(word.box.width > 0)) continue
    const overlap = Math.min(x1, rectMaxX(word.box)) - Math.max(x0, rectMinX(word.box))
    if (!(overlap >= word.box.width * settings.underlineOverlap)) continue
    const foot = rectMaxY(word.box)
    if (y >= foot - word.box.height * 0.2 && y <= foot + word.box.height * settings.underlineDrop) {
      return true
    }
  }
  return false
}

// MARK: - Tables

function makeRoot(parent: number[]): (i: number) => number {
  const root = (i: number): number => {
    if (parent[i] === i) return i
    const r = root(parent[i]!)
    parent[i] = r
    return r
  }
  return root
}

/**
 * Holes that touch side by side in rows and columns, all much the same size,
 * are the cells of a table. Two pieces of one node are not: they are
 * different sizes and there are only two of them.
 */
export function findTables(holes: Hole[], stroke: number): { boxes: Rect[]; members: Set<number> } {
  const gap = stroke * 4 + 6
  const parent = holes.map((_, i) => i)
  const root = makeRoot(parent)
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i]!.box, b = holes[j]!.box
      const xOverlap = Math.min(rectMaxX(a), rectMaxX(b)) - Math.max(rectMinX(a), rectMinX(b))
      const yOverlap = Math.min(rectMaxY(a), rectMaxY(b)) - Math.max(rectMinY(a), rectMinY(b))
      const xGap = Math.max(rectMinX(a) - rectMaxX(b), rectMinX(b) - rectMaxX(a))
      const yGap = Math.max(rectMinY(a) - rectMaxY(b), rectMinY(b) - rectMaxY(a))
      const sideBySide = xGap <= gap && yOverlap >= Math.min(a.height, b.height) * 0.6
      const stacked = yGap <= gap && xOverlap >= Math.min(a.width, b.width) * 0.6
      if (sideBySide || stacked) parent[root(i)] = root(j)
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < holes.length; i++) {
    const r = root(i)
    const g = groups.get(r)
    if (g === undefined) groups.set(r, [i]); else g.push(i)
  }

  const boxes: Rect[] = []
  const members = new Set<number>()
  for (const group of groups.values()) {
    if (group.length < 3) continue
    const widths = group.map((i) => holes[i]!.box.width)
    const heights = group.map((i) => holes[i]!.box.height)
    const regular = Math.max(...widths) <= Math.min(...widths) * 1.3
      && Math.max(...heights) <= Math.min(...heights) * 1.3
    if (!regular) continue
    const rows = new Set(group.map((i) =>
      roundAway(rectMidY(holes[i]!.box) / Math.max(1, Math.min(...heights)))))
    const columns = new Set(group.map((i) =>
      roundAway(rectMidX(holes[i]!.box) / Math.max(1, Math.min(...widths)))))
    if (!(rows.size >= 2 || columns.size >= 3)) continue
    let union = holes[group[0]!]!.box
    for (const i of group.slice(1)) union = rectUnion(union, holes[i]!.box)
    boxes.push(union)
    for (const i of group) members.add(i)
  }
  return { boxes, members }
}

/**
 * A word that crosses an outline splits the paper inside it in two. The
 * evidence for that, rather than for two boxes side by side, is a word lying
 * ACROSS the gap between them. Table cells are divided by a ruled line with
 * no word over it, so they are left alone.
 */
export function mergeSplitHoles(holes: Hole[], words: FlowWord[]): Hole[] {
  const parent = holes.map((_, i) => i)
  const root = makeRoot(parent)
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      if (!straddled(holes[i]!.box, holes[j]!.box, words)) continue
      parent[root(i)] = root(j)
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < holes.length; i++) {
    const r = root(i)
    const g = groups.get(r)
    if (g === undefined) groups.set(r, [i]); else g.push(i)
  }
  const out: Hole[] = []
  for (const group of groups.values()) {
    let box = holes[group[0]!]!.box
    let area = 0
    const rows = new Map<number, [number, number, number]>()
    for (const i of group) {
      box = rectUnion(box, holes[i]!.box)
      area += holes[i]!.area
      for (const [y, run] of holes[i]!.rows) {
        const had = rows.get(y)
        if (had !== undefined) rows.set(y, [Math.min(had[0], run[0]), Math.max(had[1], run[1]), had[2] + run[2]])
        else rows.set(y, run)
      }
    }
    out.push({ box, area, rows })
  }
  return out.sort((p, q) => (p.box.y === q.box.y ? p.box.x - q.box.x : p.box.y - q.box.y))
}

/** Holes that half-overlap another hole are the paper caught inside a ring of boxes and arrows. The bigger one goes. */
export function withoutLoops(holes: Hole[]): Hole[] {
  const drop = new Set<number>()
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i]!.box, b = holes[j]!.box
      if (!(rectIntersects(a, b) && !rectContainsRect(a, b) && !rectContainsRect(b, a))) continue
      drop.add(rectArea(a) >= rectArea(b) ? i : j)
    }
  }
  return holes.filter((_, i) => !drop.has(i))
}

export function straddled(a: Rect, b: Rect, words: FlowWord[]): boolean {
  // One box drawn inside another is not one box cut in two.
  if (rectIntersects(a, b)) return false
  for (const word of words) {
    if (!(word.box.width > 0)) continue
    // Stacked: the word reaches from inside the upper into the lower.
    const [top, bottom] = rectMidY(a) <= rectMidY(b) ? [a, b] : [b, a]
    if (rectMinY(bottom) >= rectMaxY(top) && rectMinY(bottom) - rectMaxY(top) <= word.box.height * 1.5
      && rectMinY(word.box) <= rectMaxY(top) && rectMaxY(word.box) >= rectMinY(bottom)) {
      const over = Math.min(
        Math.min(rectMaxX(word.box), rectMaxX(top)) - Math.max(rectMinX(word.box), rectMinX(top)),
        Math.min(rectMaxX(word.box), rectMaxX(bottom)) - Math.max(rectMinX(word.box), rectMinX(bottom)))
      if (over >= Math.min(top.width, bottom.width) * 0.2) return true
    }
    // Side by side.
    const [left, right] = rectMidX(a) <= rectMidX(b) ? [a, b] : [b, a]
    if (rectMinX(right) >= rectMaxX(left) && rectMinX(right) - rectMaxX(left) <= word.box.width
      && rectMinX(word.box) <= rectMaxX(left) && rectMaxX(word.box) >= rectMinX(right)) {
      const over = Math.min(
        Math.min(rectMaxY(word.box), rectMaxY(left)) - Math.max(rectMinY(word.box), rectMinY(left)),
        Math.min(rectMaxY(word.box), rectMaxY(right)) - Math.max(rectMinY(word.box), rectMinY(right)))
      if (over >= Math.min(left.height, right.height) * 0.2) return true
    }
  }
  return false
}

// MARK: - What kind of box

/**
 * Which outline the paper inside is the shape of: every candidate drawn as a
 * pair of edges down a unit square, and the one whose edges sit closest to
 * the hole's own wins. The winner's error is kept, because a hole that fits
 * NOTHING well — the loop in the middle of a scribble — is not a box at all.
 */
export const SHAPE_TEMPLATES = ["rectangle", "roundedRectangle", "oval", "diamond",
  "triangle", "triangleDown", "parallelogram", "parallelogramBack"]

export function kindOfHole(hole: Hole): { name: string; error: number } {
  let best = { name: "other", error: Infinity }
  for (const name of SHAPE_TEMPLATES) {
    const error = profileError(hole, name)
    if (error < best.error) best = { name, error }
  }
  if (best.name === "triangleDown") best.name = "triangle"
  if (best.name === "parallelogramBack") best.name = "parallelogram"
  return best
}

/** Where a template's two edges sit, a fraction of the way across, at height `u` down it. */
export function templateEdges(name: string, u: number, aspect: number): [number, number] {
  switch (name) {
    case "rectangle": return [0, 1]
    case "roundedRectangle": {
      const rx = 0.18, ry = Math.min(0.45, rx * aspect)
      const into = u < ry ? (ry - u) / ry : (u > 1 - ry ? (u - (1 - ry)) / ry : 0)
      const dx = rx * (1 - Math.sqrt(1 - into * into))
      return [dx, 1 - dx]
    }
    case "oval": {
      const h = Math.sqrt(Math.max(0, 0.25 - (u - 0.5) * (u - 0.5)))
      return [0.5 - h, 0.5 + h]
    }
    case "diamond": {
      const d = Math.abs(u - 0.5)
      return [d, 1 - d]
    }
    case "triangle": return [(1 - u) / 2, 1 - (1 - u) / 2]      // point at the top
    case "triangleDown": return [u / 2, 1 - u / 2]
    case "parallelogram": {                                       // leans right, as the app draws it
      const s = 0.20
      return [s * (1 - u), 1 - s * u]
    }
    default: {                                                    // leans the other way
      const s = 0.20
      return [s * u, 1 - s * (1 - u)]
    }
  }
}

/**
 * How far the hole's edges are from a template's, as a fraction of its
 * width, averaged down it. The top and bottom twelfth are left out: that is
 * where a pen overshoots a corner and where the closing bites.
 */
export function profileError(hole: Hole, template: string): number {
  const ys = [...hole.rows.keys()].sort((p, q) => p - q)
  if (ys.length < 8) return Infinity
  const w = hole.box.width, h = hole.box.height
  const aspect = w / Math.max(1, h)
  const x0 = hole.box.x, y0 = hole.box.y
  const skip = Math.max(1, Math.trunc(ys.length / 12))
  let total = 0, count = 0
  for (const y of ys.slice(skip, ys.length - skip)) {
    const row = hole.rows.get(y)
    if (row === undefined) continue
    const u = (y - y0) / Math.max(1, h - 1)
    const left = (row[0] - x0) / w, right = (row[1] + 1 - x0) / w
    const [idealLeft, idealRight] = templateEdges(template, u, aspect)
    total += Math.abs(left - idealLeft) + Math.abs(right - idealRight)
    count += 2
  }
  return count > 0 ? total / count : Infinity
}

/** How far the rows slide sideways down the shape: 0 for anything upright, a fifth of the width or so for a parallelogram. */
export function slide(hole: Hole): number {
  const ys = [...hole.rows.keys()].sort((p, q) => p - q)
  if (ys.length < 8) return 0
  const n = ys.length
  const mean = (from: number, to: number): number => {
    const v = ys.slice(from, to).map((y) => hole.rows.get(y)![0])
    return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)
  }
  return (mean(Math.trunc(n / 5), Math.trunc(2 * n / 5)) - mean(Math.trunc(3 * n / 5), Math.trunc(4 * n / 5)))
    / hole.box.width
}

// MARK: - Rubbing the outlines out

/**
 * The ink with every node's outline rubbed out, so what is left is the
 * arrows and the loose lines. Growing the hole by the stroke and a bit
 * covers the outline itself and nothing else.
 */
export function withoutOutlines(ink: Uint8Array, width: number, height: number, holes: Hole[],
  stroke: number, factor: number): Uint8Array {
  const out = ink.slice()
  const grow = Math.max(2, roundAway(stroke * factor) + 1)
  for (const hole of holes) {
    const x0 = Math.max(0, Math.trunc(rectMinX(hole.box)) - grow)
    const x1 = Math.min(width - 1, Math.trunc(rectMaxX(hole.box)) + grow)
    const y0 = Math.max(0, Math.trunc(rectMinY(hole.box)) - grow)
    const y1 = Math.min(height - 1, Math.trunc(rectMaxY(hole.box)) + grow)
    const inner = rectInset(hole.box, grow, grow)
    const band = rectInset(hole.box, -grow, -grow)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // Only the ring: keep whatever is well inside the box.
        if (rectContainsPoint(inner, { x, y })) continue
        const row = hole.rows.get(y)
        const nearRow = row !== undefined ? x >= row[0] - grow && x <= row[1] + grow : false
        const inBand = rectContainsPoint(band, { x, y })
        if (nearRow || (inBand && rowNear(hole, y, grow, x))) out[y * width + x] = 0
      }
    }
  }
  return out
}

/** How much of a stroke lies in the band a box's outline occupies. */
export function debrisOf(piece: Component, holes: Hole[], stroke: number, factor: number): number {
  const band = Math.max(2, roundAway(stroke * factor) + 1) * 2 + Math.trunc(stroke)
  let inside = 0
  for (const index of piece.pixels) {
    const p = { x: index % piece.stride, y: Math.floor(index / piece.stride) }
    for (const hole of holes) {
      if (rectContainsPoint(rectInset(hole.box, -band, -band), p)) {
        if (!rectContainsPoint(rectInset(hole.box, band, band), p)) { inside += 1; break }
      }
    }
  }
  return inside / Math.max(1, piece.pixels.length)
}

export function rowNear(hole: Hole, y: number, grow: number, x: number): boolean {
  for (let dy = -grow; dy <= grow; dy++) {
    const row = hole.rows.get(y + dy)
    if (row !== undefined && x >= row[0] - grow && x <= row[1] + grow) return true
  }
  return false
}

// MARK: - Strokes

/** The two ends of a stroke: furthest from the middle, then furthest from that. */
export function endpointsOf(piece: Component, width: number): [Point, Point] | null {
  if (piece.pixels.length === 0) return null
  const point = (index: number): Point => ({ x: index % width, y: Math.floor(index / width) })
  const centre = componentCentre(piece)
  const furthest = (p: Point): Point => {
    let best = point(piece.pixels[0]!), bestD = -1
    for (const index of piece.pixels) {
      const q = point(index)
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d > bestD) { bestD = d; best = q }
    }
    return best
  }
  const a = furthest(centre)
  const b = furthest(a)
  return [a, b]
}

/** Ink within `window` of each end, measured along the line from `a` to `b`, and how much ink a unit of plain shaft carries. */
export function endsOf(piece: Component, a: Point, b: Point, length: number, window: number,
  width: number): [number, number, number] {
  if (!(length > 0 && window > 0)) return [0, 0, 0]
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length
  let first = 0, last = 0, middle = 0
  for (const index of piece.pixels) {
    const px = (index % width) - a.x, py = Math.floor(index / width) - a.y
    const t = px * ux + py * uy
    if (t <= window) first += 1; else if (t >= length - window) last += 1; else middle += 1
  }
  const span = length - 2 * window
  return [first, last, span > 1 ? middle / span : 0]
}

/** How thick the pen was: the median of the narrower of the two runs through every ink pixel. */
export function strokeWidthOf(ink: Uint8Array, width: number, height: number): number {
  const horizontal = new Int32Array(width * height)
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      if (!ink[y * width + x]) { x += 1; continue }
      let end = x
      while (end < width && ink[y * width + end]) end += 1
      for (let i = x; i < end; i++) horizontal[y * width + i] = end - x
      x = end
    }
  }
  const samples: number[] = []
  for (let x = 0; x < width; x++) {
    let y = 0
    while (y < height) {
      if (!ink[y * width + x]) { y += 1; continue }
      let end = y
      while (end < height && ink[end * width + x]) end += 1
      for (let i = y; i < end; i++) samples.push(Math.min(end - y, horizontal[i * width + x]!))
      y = end
    }
  }
  if (samples.length === 0) return 2
  samples.sort((p, q) => p - q)
  return Math.max(1.0, samples[Math.trunc(samples.length / 2)]!)
}

// MARK: - Morphology

export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const rows = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      const lo = Math.max(0, x - radius), hi = Math.min(width - 1, x + radius)
      for (let i = lo; i <= hi; i++) rows[y * width + i] = 1
    }
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!rows[y * width + x]) continue
      const lo = Math.max(0, y - radius), hi = Math.min(height - 1, y + radius)
      for (let i = lo; i <= hi; i++) out[i * width + x] = 1
    }
  }
  return out
}

/** Dilate then erode with a square element (FlowGrouping's own closing; ShapeInk's is a disc). */
export function closingBox(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const grown = dilate(mask, width, height, radius)
  const inverted = grown.map((v) => (v ? 0 : 1))
  const shrunk = dilate(inverted, width, height, radius)
  return shrunk.map((v) => (v ? 0 : 1))
}

// MARK: - Putting the sheet on the canvas

/**
 * The page laid into the drawing pane: as big as it goes with a margin
 * round it, the same scale both ways so nothing is stretched, and centred.
 * Everything the app stores is a fraction of the pane, and a shape's width
 * is a fraction of the pane's WIDTH while its centre's y is a fraction of
 * the pane's HEIGHT, so the two need different divisors.
 */
export class FlowPlacement {
  constructor(readonly pane: Size, readonly page: Size, readonly margin = 0.06) {}

  get scale(): number {
    return Math.min(this.pane.width / Math.max(this.page.width, 1),
      this.pane.height / Math.max(this.page.height, 1)) * (1 - this.margin * 2)
  }

  get origin(): Point {
    return {
      x: (this.pane.width - this.page.width * this.scale) / 2,
      y: (this.pane.height - this.page.height * this.scale) / 2,
    }
  }

  /** A point in mask pixels as a fraction of the pane. */
  fraction(p: Point): Point {
    const o = this.origin
    return { x: (o.x + p.x * this.scale) / this.pane.width, y: (o.y + p.y * this.scale) / this.pane.height }
  }

  /** A width in mask pixels as a fraction of the pane's width. */
  widthFraction(w: number): number { return (w * this.scale) / this.pane.width }
}

/** What the app should make: one entry per node, one per connector. */
export interface PlacedShape {
  id: string
  kind: string
  center: Point
  width: number
  aspect: number
  label: string
}

export interface PlacedConnector {
  start: Point
  end: Point
  startNode: string | null
  endNode: string | null
  startHead: boolean
  endHead: boolean
}

export interface PlacedSheet { shapes: PlacedShape[]; connectors: PlacedConnector[] }

export function placeSheet(sheet: FlowSheet, pane: Size, margin = 0.06): PlacedSheet {
  const placement = new FlowPlacement(pane, { width: sheet.width, height: sheet.height }, margin)
  const ids = new Map<number, string>()
  const shapes: PlacedShape[] = []
  sheet.nodes.forEach((node, index) => {
    if (!isFlowNode(node)) return
    const id = newID()
    ids.set(index, id)
    shapes.push({
      id, kind: node.kind,
      center: placement.fraction({ x: rectMidX(node.box), y: rectMidY(node.box) }),
      width: placement.widthFraction(node.box.width),
      aspect: node.box.height / Math.max(node.box.width, 1),
      label: node.label,
    })
  })
  const connectors = sheet.edges.map((edge): PlacedConnector => ({
    start: placement.fraction(edge.tail), end: placement.fraction(edge.head),
    startNode: edge.from === null ? null : ids.get(edge.from) ?? null,
    endNode: edge.to === null ? null : ids.get(edge.to) ?? null,
    startHead: edge.headAtStart, endHead: edge.headAtEnd,
  }))
  return { shapes, connectors }
}
