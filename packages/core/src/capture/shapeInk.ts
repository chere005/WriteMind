/**
 * A blob of ink read as a drawn figure: the shape it is, the straight edges
 * it is made of, and how well an ellipse fits it.
 *
 * Ported from `WriteMind/Camera/ShapeInk.swift`. The method is "fit
 * primitives to the ink": a Hough transform over the component's pixels
 * proposes straight edges, each proposal is kept only if a real run of ink
 * lies along it, and a three-parameter ellipse is fitted to the outline's
 * radius about its centre. What the edges and the ellipse and the enclosed
 * area together say is the shape.
 *
 * Masks are `Uint8Array`s of 0/1, the same as `components()` in ink.ts.
 */

import { components, type Component } from "./ink"
import { makeRect } from "./rects"
import type { Point, Rect } from "../drawing/shapes"

// MARK: - What comes out

export type ShapeInkKind =
  | "rectangle" | "roundedRectangle" | "oval" | "diamond" | "triangle" | "parallelogram"
  | "check" | "cross"
  /** A straight stroke: the app's ConnectorItem with no heads. */
  | "line"
  /** A straight stroke with a heavy end: ConnectorItem with endHead. */
  | "arrow"
  /** Not a figure — writing, a scribble, a table, a letter. */
  | "none"

const NODE_KINDS_SET: ReadonlySet<ShapeInkKind> = new Set<ShapeInkKind>(
  ["rectangle", "roundedRectangle", "oval", "diamond", "triangle", "parallelogram"])

export const isNodeKind = (kind: ShapeInkKind): boolean => NODE_KINDS_SET.has(kind)
export const isConnectorKind = (kind: ShapeInkKind): boolean => kind === "line" || kind === "arrow"

/** A straight edge found in the ink. */
export interface InkEdge {
  /** radians, the normal's angle */
  theta: number
  /** px from the local centre */
  rho: number
  /** projection of the first supporting pixel */
  from: number
  /** ... and of the last */
  to: number
  /** supporting pixels */
  support: number
  /** fraction of 1px bins along the run with ink */
  continuity: number
}

export const edgeLength = (e: InkEdge): number => e.to - e.from

export interface InkMetrics {
  width: number
  height: number
  pixels: number
  /** Ink plus anything it encloses, over the bounding box. 1 for a rectangle, pi/4 for an oval, 1/2 for a diamond or a triangle. */
  closure: number
  /** Enclosed regions big enough to be a cell rather than a pinhole. */
  holeCount: number
  edges: InkEdge[]
  /** Fraction of the ink lying on one of those edges. */
  lineCoverage: number
  /** RMS radial error of the best ellipse, over the mean radius. */
  ellipseResidual: number
  /** How much of the four corner squares the shape fills: 1 sharp, about pi/4 when rounded. */
  cornerOccupancy: number
  /** Angle between the two parallel pairs, degrees (0 if not a quad). */
  pairAngle: number
  /** Edges within 8 degrees of the bounding box's own axes. */
  axisEdges: number
  /** Widest perpendicular spread over the narrowest, along a stroke. */
  spreadRatio: number
  /** Which end of a stroke carries the heavy end: -1 start, 1 end. */
  headEnd: number
  /** Where two fitted edges meet, how far the nearest ink is, over the short side. */
  cornerGap: number
  /** Ink that is NOT on the longest edge, and where along that edge it sits. */
  offMass: number
  offCentroid: number
  /** How far that off-spine ink is spread along the edge. */
  offSpread: number
  /** The longest edge over the second longest. */
  armRatio: number
  /** How far the off-spine ink reaches sideways, over the spine's length. */
  offReach: number
}

const newMetrics = (): InkMetrics => ({
  width: 0, height: 0, pixels: 0, closure: 0, holeCount: 0, edges: [], lineCoverage: 0,
  ellipseResidual: 1, cornerOccupancy: 0, pairAngle: 0, axisEdges: 0, spreadRatio: 1,
  headEnd: 0, cornerGap: 0, offMass: 0, offCentroid: 0.5, offSpread: 0, armRatio: 0, offReach: 0,
})

export interface ShapeReading {
  kind: ShapeInkKind
  /** In mask pixels, top-left origin, the same frame as Component. */
  box: Rect
  /** For a line or an arrow: the two ends in mask pixels. */
  start: Point
  end: Point
  metrics: InkMetrics
}

// MARK: - The numbers that decide

export interface ShapeTuning {
  thetaBins: number
  rhoQuantum: number
  lineTolerance: number
  lineToleranceFloor: number
  minimumExtent: number
  minimumExtentPixels: number
  minimumContinuity: number
  maximumOverlap: number
  maximumEdges: number
  maximumProposals: number
  closeRadius: number
  closeRadiusFloor: number
  pinhole: number
  minimumSize: number
  closedFloor: number
  rectFloor: number
  curvedBand: [number, number]
  wedgeBand: [number, number]
  sharpCorner: number
  ovalResidual: number
  quadResidual: number
  triangleResidual: number
  polygonCoverage: number
  squarePair: number
  arrowSpread: number
  arrowHeadMass: number
  arrowHeadSpread: number
  arrowHeadReach: number
}

export const defaultShapeTuning = (): ShapeTuning => ({
  // Hough accumulator: 90 angle bins over 180 degrees, 2px per distance bin.
  // The accumulator only proposes; the least-squares fit that follows puts
  // the line where the ink actually is.
  thetaBins: 90,
  rhoQuantum: 2.0,
  // How far from a proposed line ink still counts as on it.
  lineTolerance: 0.035,
  lineToleranceFloor: 2.5,
  // A kept edge has to run this far across the figure, and be this unbroken.
  minimumExtent: 0.40,
  minimumExtentPixels: 12.0,
  minimumContinuity: 0.80,
  // A proposal already this well covered by kept edges is the same edge again.
  maximumOverlap: 0.70,
  maximumEdges: 6,
  maximumProposals: 24,
  // The gap a hand leaves at a corner, closed before the inside is measured.
  closeRadius: 0.07,
  closeRadiusFloor: 5.0,
  // An enclosed region smaller than this much of the box is a pinhole.
  pinhole: 0.01,
  // Smaller than this much of the page's short side and it is writing.
  minimumSize: 1.0 / 22.0,
  // Class boundaries: measured gaps between the classes they separate.
  closedFloor: 0.30,
  rectFloor: 0.85,
  curvedBand: [0.64, 0.88],
  wedgeBand: [0.40, 0.62],
  sharpCorner: 0.02,
  ovalResidual: 0.05,
  quadResidual: 0.22,
  triangleResidual: 0.25,
  polygonCoverage: 0.85,
  squarePair: 84.0,
  arrowSpread: 2.0,
  arrowHeadMass: 0.35,
  arrowHeadSpread: 0.18,
  arrowHeadReach: 0.20,
})

const inBand = (v: number, band: [number, number]): boolean => v >= band[0] && v <= band[1]

/** Swift's `.rounded()`: halves go away from zero. */
const roundAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))

/** Swift `truncatingRemainder`: the sign follows the dividend, like JS `%`. */
const rem = (a: number, b: number): number => a % b

const FOUR: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]]

// MARK: - Taking a blob apart

/**
 * On a real page an arrow TOUCHES the box it points at, and the two arrive
 * as one blob, which is neither a box nor an arrow. So: if a blob encloses
 * something, the figure is the ink hugging what it encloses, and whatever
 * else is attached is peeled off and read on its own.
 *
 * Returns the blob unchanged when there is nothing to peel.
 */
export function inkParts(component: Component, tuning = defaultShapeTuning()): Component[] {
  const w = component.maxX - component.minX + 1
  const h = component.maxY - component.minY + 1
  const area = component.pixels.length
  if (!(w >= 8 && h >= 8 && area >= 40)) return [component]
  const long = Math.max(w, h)
  const close = Math.max(roundAway(tuning.closeRadiusFloor), roundAway(tuning.closeRadius * long))
  const pad = close + 2
  const lw = w + 2 * pad, lh = h + 2 * pad
  const ink = new Uint8Array(lw * lh)
  for (const pixel of component.pixels) {
    const x = (pixel % component.stride) - component.minX
    const y = Math.floor(pixel / component.stride) - component.minY
    ink[(y + pad) * lw + (x + pad)] = 1
  }
  const sealed = closingDisc(ink, lw, lh, close)
  const hole = largestHole(sealed, lw, lh)
  if (hole === null || hole.size < Math.max(64, Math.trunc((w * h) / 20))) return [component]

  // How far the outline can sit from what it encloses: its own thickness
  // and a little over.
  const stroke = Math.max(1.0, area / (2 * (w + h)))
  const reach = 3 * Math.max(4, roundAway(2 * stroke) + 3)
  const away = chamfer(hole.mask, lw, lh)
  const near = new Uint8Array(lw * lh)
  for (let i = 0; i < lw * lh; i++) near[i] = away[i]! <= reach ? 1 : 0

  const body: number[] = [], rest: number[] = []
  for (const pixel of component.pixels) {
    const x = (pixel % component.stride) - component.minX
    const y = Math.floor(pixel / component.stride) - component.minY
    if (near[(y + pad) * lw + (x + pad)]) body.push(pixel); else rest.push(pixel)
  }
  if (!(rest.length >= Math.max(40, Math.trunc(area / 20)) && body.length >= Math.trunc(area / 3))) {
    return [component]
  }

  const out: Component[] = []
  const first = makeComponent(body, component.stride)
  if (first !== null) out.push(first)
  // What was stuck on may be several separate things.
  const grid = new Uint8Array(lw * lh)
  for (const pixel of rest) {
    const x = (pixel % component.stride) - component.minX
    const y = Math.floor(pixel / component.stride) - component.minY
    grid[(y + pad) * lw + (x + pad)] = 1
  }
  for (const piece of components(grid, lw, lh)) {
    if (piece.pixels.length < 40) continue
    const pixels = piece.pixels.map((index) => {
      const x = (index % lw) - pad + component.minX
      const y = Math.floor(index / lw) - pad + component.minY
      return y * component.stride + x
    })
    const made = makeComponent(pixels, component.stride)
    if (made !== null) out.push(made)
  }
  return out
}

export function makeComponent(pixels: number[], stride: number): Component | null {
  if (pixels.length === 0) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const pixel of pixels) {
    const x = pixel % stride, y = Math.floor(pixel / stride)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { stride, minX, minY, maxX, maxY, pixels }
}

/** Background regions the edge of the mask cannot reach. */
function outsideOf(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(width * height)
  const stack: number[] = []
  const seed = (i: number): void => {
    if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i) }
  }
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1) }
  while (stack.length > 0) {
    const index = stack.pop()!
    const x = index % width, y = Math.floor(index / width)
    for (const [dx, dy] of FOUR) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const n = ny * width + nx
      if (!mask[n] && !outside[n]) { outside[n] = 1; stack.push(n) }
    }
  }
  return outside
}

export function largestHole(mask: Uint8Array, width: number, height: number):
  { mask: Uint8Array; size: number } | null {
  const outside = outsideOf(mask, width, height)
  const seen = new Uint8Array(width * height)
  let best: number[] = []
  const stack: number[] = []
  for (let start = 0; start < width * height; start++) {
    if (mask[start] || outside[start] || seen[start]) continue
    const region: number[] = []
    seen[start] = 1
    stack.push(start)
    while (stack.length > 0) {
      const index = stack.pop()!
      region.push(index)
      const x = index % width, y = Math.floor(index / width)
      for (const [dx, dy] of FOUR) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const n = ny * width + nx
        if (!mask[n] && !outside[n] && !seen[n]) { seen[n] = 1; stack.push(n) }
      }
    }
    if (region.length > best.length) best = region
  }
  if (best.length === 0) return null
  const out = new Uint8Array(width * height)
  for (const index of best) out[index] = 1
  return { mask: out, size: best.length }
}

// MARK: - Reading one blob

export function readShape(component: Component, shortSide: number,
  tuning = defaultShapeTuning()): ShapeReading {
  const w = component.maxX - component.minX + 1
  const h = component.maxY - component.minY + 1
  const area = component.pixels.length
  const box = makeRect(component.minX, component.minY, w, h)
  const reading: ShapeReading = {
    kind: "none", box, start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, metrics: newMetrics(),
  }
  const m = newMetrics()
  m.width = w; m.height = h; m.pixels = area
  reading.metrics = m

  const long = Math.max(w, h)
  if (!(long >= shortSide * tuning.minimumSize)) return reading
  if (!(w >= 5 && h >= 5 && area >= 24)) return reading

  // The blob on its own little grid, with a margin for the closing.
  const close = Math.max(roundAway(tuning.closeRadiusFloor), roundAway(tuning.closeRadius * long))
  const pad = close + 2
  const lw = w + 2 * pad, lh = h + 2 * pad
  const ink = new Uint8Array(lw * lh)
  const xs: number[] = [], ys: number[] = []
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  for (const pixel of component.pixels) {
    const x = (pixel % component.stride) - component.minX
    const y = Math.floor(pixel / component.stride) - component.minY
    ink[(y + pad) * lw + (x + pad)] = 1
    xs.push(x - cx)
    ys.push(y - cy)
  }

  // What the figure encloses, once a hand's gaps are closed.
  const sealed = closingDisc(ink, lw, lh, close)
  const { solid, holes } = filled(sealed, lw, lh)
  let inside = 0
  for (let y = pad; y < pad + h; y++) {
    for (let x = pad; x < pad + w; x++) if (solid[y * lw + x]) inside += 1
  }
  m.closure = inside / (w * h)
  const pinhole = Math.max(9, Math.trunc(tuning.pinhole * (w * h)))
  m.holeCount = holes.filter((size) => size >= pinhole).length

  // Straight edges.
  m.edges = houghEdges(xs, ys, w, h, tuning)
  m.lineCoverage = edgeCoverage(xs, ys, m.edges, w, h, tuning)

  // The ellipse.
  m.ellipseResidual = ellipseResidualOf(xs, ys)

  // Corners and pairs.
  m.cornerOccupancy = cornerOccupancyOf(solid, lw, lh, pad, w, h)
  const pairs = parallelPairs(m.edges)
  m.pairAngle = pairs.angle
  m.axisEdges = m.edges.filter((edge) => {
    const a = Math.abs(rem(edge.theta, Math.PI / 2))
    return Math.min(a, Math.PI / 2 - a) <= 8 * Math.PI / 180
  }).length

  const tol = Math.max(tuning.lineToleranceFloor, tuning.lineTolerance * long)
  m.cornerGap = cornerGapOf(xs, ys, m.edges, Math.min(w, h))

  // A stroke's thickening towards one end, and the ink beside it.
  const spine = m.edges[0]
  if (spine !== undefined) {
    const spread = spreadAlong(xs, ys, spine)
    m.spreadRatio = spread.ratio
    m.headEnd = spread.head
    const off = offSpine(xs, ys, spine, tol)
    m.offMass = off.mass
    m.offCentroid = off.centroid
    m.offSpread = off.spread
    m.offReach = off.reach
    if (m.edges.length >= 2) m.armRatio = edgeLength(spine) / Math.max(1, edgeLength(m.edges[1]!))
  }

  reading.metrics = m
  reading.kind = decide(m, tuning)

  if (isConnectorKind(reading.kind) && spine !== undefined) {
    const d = { x: -Math.sin(spine.theta), y: Math.cos(spine.theta) }
    const n = { x: Math.cos(spine.theta), y: Math.sin(spine.theta) }
    const ox = component.minX + cx + n.x * spine.rho
    const oy = component.minY + cy + n.y * spine.rho
    let a = { x: ox + d.x * spine.from, y: oy + d.y * spine.from }
    let b = { x: ox + d.x * spine.to, y: oy + d.y * spine.to }
    // The head is the end the arrow points at.
    if (reading.kind === "arrow" && m.headEnd < 0) [a, b] = [b, a]
    reading.start = a
    reading.end = b
  }
  return reading
}

// MARK: - The decision

export function decide(m: InkMetrics, tuning: ShapeTuning): ShapeInkKind {
  // A grid of cells is a table, not a box — whatever its outline.
  if (m.holeCount >= 3) return "none"

  if (m.closure >= tuning.closedFloor && m.holeCount >= 1) {
    // Round first: the ellipse fit is the sharpest single number on the page.
    if (m.ellipseResidual <= tuning.ovalResidual && inBand(m.closure, tuning.curvedBand)) {
      return "oval"
    }
    // Everything else closed is a polygon, so its ink has to lie on
    // straight edges and its radius must NOT be elliptical.
    if (!(m.lineCoverage >= tuning.polygonCoverage)) return "none"

    if (inBand(m.closure, tuning.wedgeBand) && (m.edges.length === 3 || m.edges.length === 4)) {
      // A diamond's radius is nearly elliptical, a triangle's is nowhere near.
      if (m.ellipseResidual <= tuning.quadResidual) return "diamond"
      if (m.ellipseResidual >= tuning.triangleResidual && m.edges.length === 3) return "triangle"
      return "none"
    }
    if (!(m.edges.length === 4 && m.ellipseResidual <= tuning.quadResidual)) return "none"
    // Square corners and a nearly full box: a rectangle, and where the
    // fitted edges meet says whether its corners are rounded.
    if (m.closure >= tuning.rectFloor && m.pairAngle >= tuning.squarePair) {
      return m.cornerGap <= tuning.sharpCorner ? "rectangle" : "roundedRectangle"
    }
    // Pushed over: two parallel pairs that are not at right angles.
    if (inBand(m.closure, tuning.curvedBand) && m.pairAngle > 40 && m.pairAngle < tuning.squarePair) {
      return "parallelogram"
    }
    return "none"
  }

  // Open strokes.
  const spine = m.edges[0]
  if (spine === undefined || !(m.lineCoverage >= 0.60)) return "none"
  // A cross is two edges that meet in the middle of both.
  if (m.edges.length === 2 && edgesCrossing(spine, m.edges[1]!) && edgeAngle(spine, m.edges[1]!) >= 25) {
    return "cross"
  }
  // An arrowhead is a small clump at one end that does not reach far
  // sideways. A check's second arm clumps at one end too — the sideways
  // reach is what tells them apart.
  const clumped = m.offMass <= tuning.arrowHeadMass
    && m.offSpread <= tuning.arrowHeadSpread
    && m.offReach <= tuning.arrowHeadReach
    && (m.offCentroid <= 0.25 || m.offCentroid >= 0.75)
  if (m.spreadRatio >= tuning.arrowSpread && clumped) return "arrow"
  if (m.offMass < 0.05 && m.spreadRatio < tuning.arrowSpread) return "line"
  // Two arms meeting at a point, one much longer than the other.
  if (m.offReach > tuning.arrowHeadReach && m.offMass <= 0.45
    && (m.offCentroid <= 0.25 || m.offCentroid >= 0.75)) return "check"
  if (m.edges.length === 2 && edgeAngle(spine, m.edges[1]!) >= 25) return "check"
  return "none"
}

export function edgeAngle(a: InkEdge, b: InkEdge): number {
  let between = Math.abs(a.theta - b.theta) * 180 / Math.PI
  if (between > 90) between = 180 - between
  return between
}

/** Two edges whose runs overlap in the middle cross; two that meet at a tip do not. */
export function edgesCrossing(a: InkEdge, b: InkEdge): boolean {
  // Where the lines meet, in the local frame.
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta)
  if (!(Math.abs(det) > 1e-6)) return false
  const x = (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det
  const y = (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det
  const interior = (e: InkEdge): boolean => {
    const t = -Math.sin(e.theta) * x + Math.cos(e.theta) * y
    const at = (t - e.from) / Math.max(1, edgeLength(e))
    return at > 0.15 && at < 0.85
  }
  return interior(a) && interior(b)
}

// MARK: - Hough

interface Proposal { value: number; t: number; r: number }

export function houghEdges(xs: number[], ys: number[], width: number, height: number,
  tuning: ShapeTuning): InkEdge[] {
  const count = xs.length
  if (count < 20) return []
  const long = Math.max(width, height)
  const tol = Math.max(tuning.lineToleranceFloor, tuning.lineTolerance * long)
  const diag = Math.sqrt(width * width + height * height) / 2
  const rhoBins = Math.ceil((2 * diag) / tuning.rhoQuantum) + 3
  const zero = Math.trunc(rhoBins / 2)
  const thetas = tuning.thetaBins
  const cosines = new Float64Array(thetas), sines = new Float64Array(thetas)
  for (let t = 0; t < thetas; t++) {
    const angle = (t * Math.PI) / thetas
    cosines[t] = Math.cos(angle); sines[t] = Math.sin(angle)
  }

  const accumulator = new Int32Array(thetas * rhoBins)
  for (let i = 0; i < count; i++) {
    const x = xs[i]!, y = ys[i]!
    for (let t = 0; t < thetas; t++) {
      const rho = x * cosines[t]! + y * sines[t]!
      const bin = zero + roundAway(rho / tuning.rhoQuantum)
      if (bin >= 0 && bin < rhoBins) accumulator[t * rhoBins + bin]! += 1
    }
  }
  // Blur along rho by a fraction of the wander a hand puts into a straight
  // edge, so one wobbly edge is one peak rather than five.
  const blur = Math.max(1, roundAway(tol / 3 / tuning.rhoQuantum))
  const smoothed = new Int32Array(thetas * rhoBins)
  for (let t = 0; t < thetas; t++) {
    let running = 0
    const base = t * rhoBins
    for (let r = 0; r < Math.min(blur, rhoBins); r++) running += accumulator[base + r]!
    for (let r = 0; r < rhoBins; r++) {
      smoothed[base + r] = running
      const drop = r - blur, add = r + blur + 1
      if (drop >= 0) running -= accumulator[base + drop]!
      if (add < rhoBins) running += accumulator[base + add]!
    }
  }

  // Propose the strongest cells, no two of them the same edge.
  let proposals: Proposal[] = []
  for (let t = 0; t < thetas; t++) {
    for (let r = 1; r < rhoBins - 1; r++) {
      const v = smoothed[t * rhoBins + r]!
      if (v < 8) continue
      if (smoothed[t * rhoBins + r - 1]! > v || smoothed[t * rhoBins + r + 1]! > v) continue
      proposals.push({ value: v, t, r })
    }
  }
  proposals.sort((a, b) => b.value - a.value)
  // Only a few peaks are worth the fit. Thin them before the expensive part.
  const shortlist: Proposal[] = []
  if (proposals.length > 0) {
    const best = proposals[0]!.value
    const floor = Math.max(8, Math.trunc(best / 5))
    for (const proposal of proposals) {
      if (proposal.value < floor) continue
      const line = { theta: (proposal.t * Math.PI) / thetas, rho: (proposal.r - zero) * tuning.rhoQuantum }
      let nearOne = false
      for (const chosen of shortlist) {
        const other = { theta: (chosen.t * Math.PI) / thetas, rho: (chosen.r - zero) * tuning.rhoQuantum }
        if (sameLine(line, other, 9 * Math.PI / 180, blur * 3 * tuning.rhoQuantum)) { nearOne = true; break }
      }
      if (nearOne) continue
      shortlist.push(proposal)
      if (shortlist.length >= tuning.maximumProposals) break
    }
  }
  proposals = shortlist

  const kept: InkEdge[] = []
  const covered = new Uint8Array(count)
  for (const proposal of proposals) {
    if (kept.length >= tuning.maximumEdges) break
    // The same line as one already kept.
    const proposed = { theta: (proposal.t * Math.PI) / thetas, rho: (proposal.r - zero) * tuning.rhoQuantum }
    if (kept.some((e) => sameLine(proposed, { theta: e.theta, rho: e.rho }, 8 * Math.PI / 180, tol))) continue

    // The accumulator only PROPOSES; a total-least-squares fit to the ink
    // near the proposal settles where the edge really is.
    let theta = (proposal.t * Math.PI) / thetas
    let rho = (proposal.r - zero) * tuning.rhoQuantum
    let support: number[] = []
    let low = Infinity, high = -Infinity
    for (let pass = 0; pass < 3; pass++) {
      const ct = Math.cos(theta), st = Math.sin(theta)
      support = []
      low = Infinity; high = -Infinity
      for (let i = 0; i < count; i++) {
        if (Math.abs(xs[i]! * ct + ys[i]! * st - rho) <= tol) {
          support.push(i)
          const t = -xs[i]! * st + ys[i]! * ct
          if (t < low) low = t
          if (t > high) high = t
        }
      }
      if (support.length < 8) break
      if (pass >= 2) break
      const fit = principalAxis(xs, ys, support)
      if (fit === null) break
      // Keep the fit on the same side of the figure.
      let turned = Math.abs(fit.theta - theta)
      turned = Math.min(turned, Math.PI - turned)
      if (!(turned < 25 * Math.PI / 180)) break
      theta = fit.theta; rho = fit.rho
    }
    const extent = high - low
    const st = Math.sin(theta), ct = Math.cos(theta)
    const span = Math.min(width * Math.abs(st) + height * Math.abs(ct),
      Math.sqrt(width * width + height * height))
    if (!(extent >= Math.max(tuning.minimumExtentPixels, tuning.minimumExtent * span))) continue

    // Unbroken: nearly every 1px step along the run has ink on it.
    const bins = Math.ceil(extent) + 1
    const hit = new Uint8Array(bins)
    for (const i of support) {
      const t = -xs[i]! * st + ys[i]! * ct
      const bin = roundAway(t - low)
      if (bin >= 0 && bin < bins) hit[bin] = 1
    }
    let hits = 0
    for (let b = 0; b < bins; b++) if (hit[b]) hits++
    const continuity = hits / bins
    if (!(continuity >= tuning.minimumContinuity)) continue

    let fresh = 0
    for (const i of support) if (!covered[i]) fresh++
    if (!((support.length - fresh) / support.length <= tuning.maximumOverlap)) continue

    for (const i of support) covered[i] = 1
    kept.push({ theta, rho, from: low, to: high, support: support.length, continuity })
  }
  return kept.sort((a, b) => edgeLength(b) - edgeLength(a))
}

/**
 * Whether two (theta, rho) pairs name the SAME line. theta lives on a half
 * circle, so one line can be written two ways — (0, +125) and (pi, -125).
 */
export function sameLine(a: { theta: number; rho: number }, b: { theta: number; rho: number },
  angleTolerance: number, distanceTolerance: number): boolean {
  const dot = Math.cos(a.theta) * Math.cos(b.theta) + Math.sin(a.theta) * Math.sin(b.theta)
  const limit = Math.cos(angleTolerance)
  if (dot >= limit) return Math.abs(a.rho - b.rho) <= distanceTolerance
  if (-dot >= limit) return Math.abs(a.rho + b.rho) <= distanceTolerance
  return false
}

/** Total least squares through a set of points: the line that minimises the perpendicular distance. */
export function principalAxis(xs: number[], ys: number[], indices: number[]):
  { theta: number; rho: number } | null {
  const n = indices.length
  if (n < 8) return null
  let mx = 0, my = 0
  for (const i of indices) { mx += xs[i]!; my += ys[i]! }
  mx /= n; my /= n
  let sxx = 0, syy = 0, sxy = 0
  for (const i of indices) {
    const dx = xs[i]! - mx, dy = ys[i]! - my
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy
  }
  // The smaller eigenvector of the covariance is the line's normal.
  const normal = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2
  let theta = rem(normal, Math.PI)
  if (theta < 0) theta += Math.PI
  return { theta, rho: mx * Math.cos(theta) + my * Math.sin(theta) }
}

export function edgeCoverage(xs: number[], ys: number[], edges: InkEdge[],
  width: number, height: number, tuning: ShapeTuning): number {
  if (xs.length === 0 || edges.length === 0) return 0
  const tol = Math.max(tuning.lineToleranceFloor, tuning.lineTolerance * Math.max(width, height))
  let on = 0
  for (let i = 0; i < xs.length; i++) {
    for (const edge of edges) {
      const ct = Math.cos(edge.theta), st = Math.sin(edge.theta)
      if (!(Math.abs(xs[i]! * ct + ys[i]! * st - edge.rho) <= tol)) continue
      const t = -xs[i]! * st + ys[i]! * ct
      if (t >= edge.from - tol && t <= edge.to + tol) { on += 1; break }
    }
  }
  return on / xs.length
}

/** The two pairs of parallel edges a quadrilateral makes, and the angle between them. */
export function parallelPairs(edges: InkEdge[]): { pairs: number; angle: number } {
  if (edges.length !== 4) return { pairs: 0, angle: 0 }
  const used = [false, false, false, false]
  const directions: number[] = []
  for (let i = 0; i < 4; i++) {
    if (used[i]) continue
    let best = -1, bestGap = Infinity
    for (let j = i + 1; j < 4; j++) {
      if (used[j]) continue
      let gap = Math.abs(edges[i]!.theta - edges[j]!.theta)
      if (gap > Math.PI / 2) gap = Math.PI - gap
      if (gap < bestGap) { bestGap = gap; best = j }
    }
    if (!(best >= 0 && bestGap <= 12 * Math.PI / 180)) continue
    used[i] = true; used[best] = true
    // theta lives on a half circle, so two parallel edges can read as 0.01
    // and 3.13 radians. Bring the second onto the first's branch.
    const a = edges[i]!.theta
    let b = edges[best]!.theta
    if (Math.abs(a - b) > Math.PI / 2) b += a > b ? Math.PI : -Math.PI
    let mean = (a + b) / 2
    if (mean < 0) mean += Math.PI
    if (mean >= Math.PI) mean -= Math.PI
    directions.push(mean)
  }
  if (directions.length !== 2) return { pairs: directions.length, angle: 0 }
  let between = Math.abs(directions[0]! - directions[1]!) * 180 / Math.PI
  if (between > 90) between = 180 - between
  return { pairs: 2, angle: between }
}

// MARK: - The ellipse

/**
 * An ellipse about the figure's centre has 1/r^2 = A + B cos2phi + C
 * sin2phi, which is a three-parameter least squares. The residual is the RMS
 * gap between the ink's radius and that ellipse's, over the mean radius.
 */
export function ellipseResidualOf(xs: number[], ys: number[]): number {
  const count = xs.length
  if (count < 24) return 1
  const s = new Array<number>(9).fill(0)
  const rhs = [0, 0, 0]
  const radii: number[] = [], phis: number[] = []
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(xs[i]! * xs[i]! + ys[i]! * ys[i]!)
    if (!(r > 1)) continue
    const phi = Math.atan2(ys[i]!, xs[i]!)
    radii.push(r); phis.push(phi)
    const basis = [1.0, Math.cos(2 * phi), Math.sin(2 * phi)]
    const u = 1 / (r * r)
    for (let a = 0; a < 3; a++) {
      rhs[a]! += basis[a]! * u
      for (let b = 0; b < 3; b++) s[a * 3 + b]! += basis[a]! * basis[b]!
    }
  }
  if (radii.length < 24) return 1
  const p = solve3(s, rhs)
  if (p === null) return 1
  let sum = 0, mean = 0
  for (let i = 0; i < radii.length; i++) {
    const u = p[0]! + p[1]! * Math.cos(2 * phis[i]!) + p[2]! * Math.sin(2 * phis[i]!)
    if (!(u > 1e-9)) return 1
    const fit = 1 / Math.sqrt(u)
    const d = radii[i]! - fit
    sum += d * d
    mean += radii[i]!
  }
  mean /= radii.length
  if (!(mean > 0)) return 1
  return Math.sqrt(sum / radii.length) / mean
}

export function solve3(a: number[], b: number[]): number[] | null {
  const m: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) m[i]![j] = a[i * 3 + j]!
    m[i]![3] = b[i]!
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row
    }
    if (!(Math.abs(m[pivot]![col]!) > 1e-12)) return null
    const swap = m[col]!; m[col] = m[pivot]!; m[pivot] = swap
    const d = m[col]![col]!
    for (let j = col; j < 4; j++) m[col]![j]! /= d
    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const f = m[row]![col]!
      if (f === 0) continue
      for (let j = col; j < 4; j++) m[row]![j]! -= f * m[col]![j]!
    }
  }
  return [m[0]![3]!, m[1]![3]!, m[2]![3]!]
}

// MARK: - Shape of the outline

/**
 * Dilate then erode, so a hand's gap at a corner does not let the inside of
 * the figure leak out. The structuring element is a DISC, built from a 3-4
 * chamfer distance, not a square: a square element bridges a gap in a
 * horizontal edge and fails on the same gap in a diagonal one.
 */
export function closingDisc(ink: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (!(radius > 0)) return ink
  const reach = 3 * radius
  const outward = chamfer(ink, width, height)
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) outside[i] = outward[i]! <= reach ? 0 : 1
  const inward = chamfer(outside, width, height)
  const closed = new Uint8Array(width * height)
  // Erode by one pixel LESS than the dilation: the chamfer is only within 8%
  // of Euclidean, and at a large radius that error eats the whole bridge.
  for (let i = 0; i < width * height; i++) closed[i] = inward[i]! > reach - 3 || ink[i] ? 1 : 0
  return closed
}

/**
 * Distance from every pixel to the nearest set pixel, in thirds of a pixel,
 * by the two-pass 3-4 chamfer.
 */
export function chamfer(mask: Uint8Array, width: number, height: number): Int32Array {
  const far = 1 << 24
  const d = new Int32Array(width * height).fill(far)
  for (let i = 0; i < width * height; i++) if (mask[i]) d[i] = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (d[i] === 0) continue
      let best = d[i]!
      if (y > 0) {
        if (x > 0) best = Math.min(best, d[i - width - 1]! + 4)
        best = Math.min(best, d[i - width]! + 3)
        if (x + 1 < width) best = Math.min(best, d[i - width + 1]! + 4)
      }
      if (x > 0) best = Math.min(best, d[i - 1]! + 3)
      d[i] = best
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (d[i] === 0) continue
      let best = d[i]!
      if (y + 1 < height) {
        if (x + 1 < width) best = Math.min(best, d[i + width + 1]! + 4)
        best = Math.min(best, d[i + width]! + 3)
        if (x > 0) best = Math.min(best, d[i + width - 1]! + 4)
      }
      if (x + 1 < width) best = Math.min(best, d[i + 1]! + 3)
      d[i] = best
    }
  }
  return d
}

/** The figure with whatever it encloses filled in, and the sizes of the enclosed regions. */
export function filled(mask: Uint8Array, width: number, height: number):
  { solid: Uint8Array; holes: number[] } {
  const outside = outsideOf(mask, width, height)
  const solid = mask.slice()
  const holes: number[] = []
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  for (let start = 0; start < width * height; start++) {
    if (mask[start] || outside[start] || seen[start]) continue
    let size = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length > 0) {
      const index = stack.pop()!
      size += 1
      solid[index] = 1
      const x = index % width, y = Math.floor(index / width)
      for (const [dx, dy] of FOUR) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const n = ny * width + nx
        if (!mask[n] && !outside[n] && !seen[n]) { seen[n] = 1; stack.push(n) }
      }
    }
    holes.push(size)
  }
  return { solid, holes }
}

/** How full the four corners of the bounding box are: sharp fills its square, rounded about pi/4 of it. */
export function cornerOccupancyOf(solid: Uint8Array, width: number, _height: number,
  pad: number, w: number, h: number): number {
  const side = Math.max(3, roundAway(0.20 * Math.min(w, h)))
  if (!(side * 2 < Math.min(w, h))) return 1
  let total = 0, filledCount = 0
  for (const [ox, oy] of [[0, 0], [w - side, 0], [0, h - side], [w - side, h - side]] as const) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        total += 1
        if (solid[(pad + oy + y) * width + (pad + ox + x)]) filledCount += 1
      }
    }
  }
  return total === 0 ? 1 : filledCount / total
}

/**
 * Where two edges meet is a corner of the figure; how far the nearest ink is
 * from that meeting point separates a sharp corner from one rounded off.
 * Scale free: divided by the box's short side.
 */
export function cornerGapOf(xs: number[], ys: number[], edges: InkEdge[], minSide: number): number {
  if (!(edges.length >= 3 && minSide > 0)) return 0
  const gaps: number[] = []
  for (let a = 0; a < edges.length; a++) {
    for (let b = a + 1; b < edges.length; b++) {
      const ea = edges[a]!, eb = edges[b]!
      let between = Math.abs(ea.theta - eb.theta)
      if (between > Math.PI / 2) between = Math.PI - between
      if (!(between >= 25 * Math.PI / 180)) continue
      const det = Math.cos(ea.theta) * Math.sin(eb.theta) - Math.sin(ea.theta) * Math.cos(eb.theta)
      if (!(Math.abs(det) > 1e-9)) continue
      const px = (ea.rho * Math.sin(eb.theta) - eb.rho * Math.sin(ea.theta)) / det
      const py = (eb.rho * Math.cos(ea.theta) - ea.rho * Math.cos(eb.theta)) / det
      const atEnd = (e: InkEdge): boolean => {
        const t = -Math.sin(e.theta) * px + Math.cos(e.theta) * py
        const at = (t - e.from) / Math.max(1, edgeLength(e))
        return at > -0.25 && at < 1.25 && (at < 0.3 || at > 0.7)
      }
      if (!(atEnd(ea) && atEnd(eb))) continue
      let best = Infinity
      for (let i = 0; i < xs.length; i++) {
        const d = (xs[i]! - px) * (xs[i]! - px) + (ys[i]! - py) * (ys[i]! - py)
        if (d < best) best = d
      }
      gaps.push(Math.sqrt(best))
    }
  }
  if (gaps.length === 0) return 0
  return gaps.reduce((s, g) => s + g, 0) / gaps.length / minSide
}

/** The ink that is not on the figure's longest edge: how much, and where along the edge. */
export function offSpine(xs: number[], ys: number[], edge: InkEdge, tolerance: number):
  { mass: number; centroid: number; spread: number; reach: number } {
  const ct = Math.cos(edge.theta), st = Math.sin(edge.theta)
  const length = Math.max(1, edgeLength(edge))
  let off = 0
  const total = xs.length
  let sum = 0, square = 0, reach = 0
  for (let i = 0; i < xs.length; i++) {
    const across = Math.abs(xs[i]! * ct + ys[i]! * st - edge.rho)
    if (!(across > tolerance)) continue
    off += 1
    reach = Math.max(reach, across)
    const at = (-xs[i]! * st + ys[i]! * ct - edge.from) / length
    sum += at
    square += at * at
  }
  if (!(off > 0 && total > 0)) return { mass: 0, centroid: 0.5, spread: 0, reach: 0 }
  const mean = sum / off
  const variance = Math.max(0, square / off - mean * mean)
  return { mass: off / total, centroid: mean, spread: Math.sqrt(variance), reach: reach / length }
}

/** Along a stroke, how much wider the ink is at one end than the other. */
export function spreadAlong(xs: number[], ys: number[], edge: InkEdge): { ratio: number; head: number } {
  const ct = Math.cos(edge.theta), st = Math.sin(edge.theta)
  const slices = 5
  const spread = new Array<number>(slices).fill(0)
  const length = Math.max(1, edgeLength(edge))
  for (let i = 0; i < xs.length; i++) {
    const t = -xs[i]! * st + ys[i]! * ct
    const at = (t - edge.from) / length
    if (!(at >= 0 && at <= 1)) continue
    const slice = Math.min(slices - 1, Math.trunc(at * slices))
    const perpendicular = Math.abs(xs[i]! * ct + ys[i]! * st - edge.rho)
    spread[slice] = Math.max(spread[slice]!, perpendicular)
  }
  // The two ends against the middle, so a thick pen does not read as a head.
  const middle = Math.max(0.5, spread[2]!)
  const low = spread[0]! / middle, high = spread[4]! / middle
  return { ratio: Math.max(low, high), head: high >= low ? 1 : -1 }
}
