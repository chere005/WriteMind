/**
 * FINDING THE PAGE IN THE FRAME, with no platform in it.
 *
 * On the Mac this is Vision's document segmentation (then a rectangle search)
 * in `NotebookCapture.pageQuad`; that is Apple's and does not exist on Windows
 * or Linux. This is the same job in plain arrays, so it runs in the renderer on
 * a canvas's `ImageData`, and in the test runner, which has no canvas at all.
 *
 * TWO WAYS TO FIND IT, the second only when the first is not sure:
 *
 *  1. SEGMENTATION. Paper is the bright, colourless thing on the desk. The
 *     frame is shrunk (which melts a printed dot grid into the paper's own
 *     tone), a threshold is chosen from the picture itself (Otsu), the specks
 *     and thin bridges to desk clutter are opened away, the holes writing and
 *     shadows leave in the page are filled, and the largest blob that
 *     is page-shaped is taken. Its convex hull is reduced to the four
 *     straight edges that enclose it (a corner the hull has rounded off, or
 *     one clipped by the frame, comes back as the corner it is).
 *  2. LINES. When the desk is as pale as the paper there is no blob to take,
 *     but there is still an edge: a Hough vote over the picture's gradient
 *     picks out the long straight edges, and the four that make the best
 *     convex page (edge support along every side) win.
 *
 * Either answer is then REFINED at a higher resolution: along each side the
 * real edge is searched for across the margin the coarse answer could be
 * out by, a line is fitted to what was found with the outliers (a pen across
 * the edge, a curl) thrown out, and the corners are the lines' intersections.
 *
 * Corners are in the frame's pixels, y DOWN, named by where they sit in the
 * picture. `FoundPage.coverage` is the page's share of the frame, so the
 * caller can tell "the page" from "the page fills the frame, so nothing was
 * found".
 */

export interface PagePoint { x: number; y: number }

export interface PageCorners {
  topLeft: PagePoint
  topRight: PagePoint
  bottomRight: PagePoint
  bottomLeft: PagePoint
}

export interface FoundPage {
  corners: PageCorners
  /** 0…1: how sure the finder is. Below `MINIMUM_CONFIDENCE` nothing is returned. */
  confidence: number
  /** The page's share of the frame, 0…1. */
  coverage: number
  method: "segmentation" | "lines"
}

export const MINIMUM_CONFIDENCE = 0.45

/** The coarse picture's longest side, in pixels. */
const COARSE_SIDE = 160
/** The picture the edges are refined on. */
const FINE_SIDE = 480
/** The picture the line vote is taken on. */
const LINES_SIDE = 240

// MARK: - small geometry

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx

function polygonArea(points: PagePoint[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!, b = points[(index + 1) % points.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function intersection(a: PagePoint, b: PagePoint, c: PagePoint, d: PagePoint): PagePoint | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y
  const denominator = cross(rx, ry, sx, sy)
  if (Math.abs(denominator) < 1e-9) return null
  const t = cross(c.x - a.x, c.y - a.y, sx, sy) / denominator
  return { x: a.x + t * rx, y: a.y + t * ry }
}

/** Andrew's monotone chain. Returns the hull with positive shoelace area (clockwise on screen, y down). */
function convexHull(input: PagePoint[]): PagePoint[] {
  const points = input.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  if (points.length < 3) return points
  const build = (list: PagePoint[]): PagePoint[] => {
    const hull: PagePoint[] = []
    for (const point of list) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]!, b = hull[hull.length - 1]!
        if (cross(b.x - a.x, b.y - a.y, point.x - a.x, point.y - a.y) <= 0) hull.pop()
        else break
      }
      hull.push(point)
    }
    hull.pop()
    return hull
  }
  const lower = build(points), upper = build(points.slice().reverse())
  const hull = lower.concat(upper)
  return polygonArea(hull) < 0 ? hull.reverse() : hull
}

/**
 * The four straight edges that enclose a convex polygon most tightly: edges
 * are removed one at a time, the one whose removal adds the least area (its
 * two neighbours are extended until they meet), until four are left.
 */
function enclosingQuad(hull: PagePoint[]): PagePoint[] | null {
  let polygon = hull.slice()
  if (polygon.length < 4) return null
  while (polygon.length > 4) {
    const count = polygon.length
    let best = -1, bestArea = Infinity, bestPoint: PagePoint | null = null
    for (let index = 0; index < count; index++) {
      const a = polygon[(index - 1 + count) % count]!, b = polygon[index]!
      const c = polygon[(index + 1) % count]!, d = polygon[(index + 2) % count]!
      const meet = intersection(a, b, c, d)
      if (!meet) continue
      // The neighbours must converge BEYOND the edge, not behind it.
      if ((meet.x - b.x) * (b.x - a.x) + (meet.y - b.y) * (b.y - a.y) <= 0) continue
      if ((meet.x - c.x) * (c.x - d.x) + (meet.y - c.y) * (c.y - d.y) <= 0) continue
      const added = Math.abs(cross(c.x - b.x, c.y - b.y, meet.x - b.x, meet.y - b.y)) / 2
      if (added < bestArea) { bestArea = added; best = index; bestPoint = meet }
    }
    if (best >= 0 && bestPoint) {
      const next: PagePoint[] = []
      for (let index = 0; index < count; index++) {
        if (index === best) next.push(bestPoint)
        else if (index !== (best + 1) % count) next.push(polygon[index]!)
      }
      polygon = next
    } else {
      // No edge can be removed by extension (the neighbours are parallel, or
      // diverge): drop the corner that is the least of the shape.
      let drop = 0, smallest = Infinity
      for (let index = 0; index < count; index++) {
        const a = polygon[(index - 1 + count) % count]!, b = polygon[index]!, c = polygon[(index + 1) % count]!
        const area = Math.abs(cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y)) / 2
        if (area < smallest) { smallest = area; drop = index }
      }
      polygon = polygon.filter((_, index) => index !== drop)
    }
  }
  return polygon
}

/** The four corners, named by where they are in the picture, clockwise from the top left. */
function named(quad: PagePoint[]): PageCorners {
  // Clockwise on screen (y down) already (positive shoelace); start at the corner nearest the top left.
  let start = 0, least = Infinity
  quad.forEach((point, index) => {
    const sum = point.x + point.y
    if (sum < least) { least = sum; start = index }
  })
  const at = (offset: number): PagePoint => {
    const point = quad[(start + offset) % 4]!
    return { x: point.x, y: point.y }
  }
  return { topLeft: at(0), topRight: at(1), bottomRight: at(2), bottomLeft: at(3) }
}

const cornersOf = (corners: PageCorners): PagePoint[] =>
  [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]

/** Convex, and every angle one a page could have under perspective. */
function plausible(quad: PagePoint[]): boolean {
  for (let index = 0; index < 4; index++) {
    const a = quad[(index + 3) % 4]!, b = quad[index]!, c = quad[(index + 1) % 4]!
    const turn = cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y)
    if (turn <= 0) return false
    const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)
    const lengths = Math.hypot(a.x - b.x, a.y - b.y) * Math.hypot(c.x - b.x, c.y - b.y)
    if (lengths < 1e-9) return false
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / lengths))) * 180 / Math.PI
    if (angle < 45 || angle > 135) return false
  }
  // No side a sliver of another.
  const sides = quad.map((point, index) => {
    const next = quad[(index + 1) % 4]!
    return Math.hypot(next.x - point.x, next.y - point.y)
  })
  return Math.min(...sides) > 0.12 * Math.max(...sides)
}

/**
 * Whether four corners (as dragged by hand) could be a page: convex, in the order top-left, top-right, bottom-right,
 * bottom-left (a crossed or mirrored set is not), every angle one a page has under perspective, no side a sliver of
 * another. The same test the finder's own quads pass.
 */
export function isPlausiblePage(corners: PageCorners): boolean {
  const points = cornersOf(corners)
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) && plausible(points)
}

// MARK: - pictures

interface Plane { data: Float32Array; width: number; height: number }

/** How white a pixel is: the mean of its luma and its weakest channel, so a coloured desk is not paper. */
function whiteness(rgba: Uint8ClampedArray | Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count)
  for (let index = 0; index < count; index++) {
    const r = rgba[index * 4]!, g = rgba[index * 4 + 1]!, b = rgba[index * 4 + 2]!
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    out[index] = (luma + Math.min(r, g, b)) / 2
  }
  return out
}

/** Area-averaged shrink. */
function shrink(source: Uint8Array, width: number, height: number, longest: number): Plane {
  const factor = Math.min(1, longest / Math.max(width, height))
  const w = Math.max(2, Math.round(width * factor)), h = Math.max(2, Math.round(height * factor))
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * height / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / h))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * width / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / w))
      let sum = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += source[yy * width + xx]!
      data[y * w + x] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return { data, width: w, height: h }
}

function blur(plane: Plane): Plane {
  const { data, width, height } = plane
  const out = new Float32Array(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          sum += data[yy * width + xx]!
          count++
        }
      }
      out[y * width + x] = sum / count
    }
  }
  return { data: out, width, height }
}

function sample(plane: Plane, x: number, y: number): number {
  const { data, width, height } = plane
  const px = Math.min(Math.max(x - 0.5, 0), width - 1), py = Math.min(Math.max(y - 0.5, 0), height - 1)
  const x0 = Math.floor(px), y0 = Math.floor(py)
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
  const fx = px - x0, fy = py - y0
  const top = data[y0 * width + x0]! * (1 - fx) + data[y0 * width + x1]! * fx
  const bottom = data[y1 * width + x0]! * (1 - fx) + data[y1 * width + x1]! * fx
  return top * (1 - fy) + bottom * fy
}

function otsu(plane: Plane): number {
  const histogram = new Float64Array(256)
  for (const value of plane.data) histogram[Math.max(0, Math.min(255, Math.round(value)))]! += 1
  const total = plane.data.length
  let sumAll = 0
  for (let level = 0; level < 256; level++) sumAll += level * histogram[level]!
  let weightB = 0, sumB = 0, bestVariance = -1, best = 128
  for (let level = 0; level < 256; level++) {
    weightB += histogram[level]!
    if (weightB === 0) continue
    const weightF = total - weightB
    if (weightF === 0) break
    sumB += level * histogram[level]!
    const meanB = sumB / weightB, meanF = (sumAll - sumB) / weightF
    const variance = weightB * weightF * (meanB - meanF) ** 2
    if (variance > bestVariance) { bestVariance = variance; best = level }
  }
  return best
}

// MARK: - masks

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          // Outside the frame counts as paper, so a page clipped by the frame is not eaten from that side.
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          if (!mask[yy * width + xx]) { keep = 0; break }
        }
      }
      out[y * width + x] = keep
    }
  }
  return out
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          if (mask[yy * width + xx]) { hit = 1; break }
        }
      }
      out[y * width + x] = hit
    }
  }
  return out
}

/** Background not reachable from the frame's edge is inside something: it becomes part of it. */
function fillHoles(mask: Uint8Array, width: number, height: number): void {
  const seen = new Uint8Array(mask.length)
  const stack: number[] = []
  const push = (x: number, y: number): void => {
    const index = y * width + x
    if (mask[index] || seen[index]) return
    seen[index] = 1
    stack.push(index)
  }
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1) }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y) }
  while (stack.length > 0) {
    const index = stack.pop()!
    const x = index % width, y = (index - x) / width
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }
  for (let index = 0; index < mask.length; index++) if (!mask[index] && !seen[index]) mask[index] = 1
}

interface Blob { label: number; area: number }

/** 4-connected blobs, largest first. `labels` gets each pixel's blob (0 = none). */
function blobs(mask: Uint8Array, width: number, height: number, labels: Int32Array): Blob[] {
  labels.fill(0)
  const found: Blob[] = []
  const stack: number[] = []
  let next = 1
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    let area = 0
    labels[start] = next
    stack.push(start)
    while (stack.length > 0) {
      const index = stack.pop()!
      area++
      const x = index % width, y = (index - x) / width
      const visit = (neighbour: number): void => {
        if (mask[neighbour] && !labels[neighbour]) { labels[neighbour] = next; stack.push(neighbour) }
      }
      if (x > 0) visit(index - 1)
      if (x < width - 1) visit(index + 1)
      if (y > 0) visit(index - width)
      if (y < height - 1) visit(index + width)
    }
    found.push({ label: next, area })
    next++
  }
  return found.sort((a, b) => b.area - a.area)
}

/** The extreme pixel corners of one blob, row by row: what its hull is made of. */
function hullPoints(labels: Int32Array, label: number, width: number, height: number): PagePoint[] {
  const points: PagePoint[] = []
  for (let y = 0; y < height; y++) {
    let left = -1, right = -1
    for (let x = 0; x < width; x++) {
      if (labels[y * width + x] === label) { if (left < 0) left = x; right = x }
    }
    if (left < 0) continue
    points.push({ x: left, y }, { x: left, y: y + 1 }, { x: right + 1, y }, { x: right + 1, y: y + 1 })
  }
  return points
}

// MARK: - edges, and scoring a quad against them

/** Inside-brighter-than-outside contrast across the side from `a` to `b`, in whiteness levels, sampled just either side. */
function sideContrast(plane: Plane, a: PagePoint, b: PagePoint, centre: PagePoint, reach: number):
{ contrast: number; border: boolean } {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < 1) return { contrast: 0, border: false }
  let nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length
  // Point the normal towards the page's inside.
  if (nx * (centre.x - a.x) + ny * (centre.y - a.y) < 0) { nx = -nx; ny = -ny }
  const samples = Math.max(6, Math.round(length / 3))
  let total = 0, used = 0, onBorder = 0
  for (let step = 0; step < samples; step++) {
    const t = 0.08 + 0.84 * (step + 0.5) / samples
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
    const ox = x - nx * reach, oy = y - ny * reach
    if (ox < 0 || oy < 0 || ox > plane.width || oy > plane.height) { onBorder++; continue }
    const inside = sample(plane, x + nx * reach, y + ny * reach)
    const outside = sample(plane, ox, oy)
    total += inside - outside
    used++
  }
  return { contrast: used > 0 ? total / used : 0, border: onBorder > samples * 0.6 }
}

/** The smoothed gradient of a plane, for the line vote and for support. */
interface Gradient { gx: Float32Array; gy: Float32Array; magnitude: Float32Array; width: number; height: number }

function gradientOf(plane: Plane): Gradient {
  const { data, width, height } = plane
  const gx = new Float32Array(data.length), gy = new Float32Array(data.length)
  const magnitude = new Float32Array(data.length)
  const at = (x: number, y: number): number =>
    data[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8
      const index = y * width + x
      gx[index] = dx
      gy[index] = dy
      magnitude[index] = Math.hypot(dx, dy)
    }
  }
  return { gx, gy, magnitude, width, height }
}

// MARK: - 1. segmentation

interface Candidate { quad: PagePoint[]; score: number }

function scoreBlob(plane: Plane, quad: PagePoint[], blobArea: number): number {
  const area = polygonArea(quad)
  const frameArea = plane.width * plane.height
  const share = area / frameArea
  // A blob that is the whole frame is not a page in it.
  if (share < 0.12 || share > 0.97) return 0
  if (!plausible(quad)) return 0
  // The corners may be a little outside the frame (a clipped page) but not far.
  for (const point of quad) {
    if (point.x < -0.12 * plane.width || point.x > 1.12 * plane.width
      || point.y < -0.12 * plane.height || point.y > 1.12 * plane.height) return 0
  }
  const fill = Math.min(1, blobArea / area)
  if (fill < 0.72) return 0
  const centre = {
    x: (quad[0]!.x + quad[1]!.x + quad[2]!.x + quad[3]!.x) / 4,
    y: (quad[0]!.y + quad[1]!.y + quad[2]!.y + quad[3]!.y) / 4,
  }
  let contrast = 0, sides = 0
  for (let index = 0; index < 4; index++) {
    const side = sideContrast(plane, quad[index]!, quad[(index + 1) % 4]!, centre, 2.5)
    // A side the frame cuts off is worth something (a page can run off the edge) but not as much as a seen edge.
    if (side.border) { contrast += 0.55; sides++; continue }
    contrast += Math.max(0, Math.min(1, side.contrast / 35))
    sides++
  }
  contrast /= sides
  return Math.min(1, (fill - 0.5) * 2) * contrast * (0.65 + 0.35 * Math.min(1, share))
}

function segmentationCandidates(coarse: Plane): Candidate[] {
  const smooth = blur(coarse)
  const base = otsu(smooth)
  const out: Candidate[] = []
  const { width, height } = smooth
  const labels = new Int32Array(width * height)
  const thresholds = new Set<number>([base, base - 14, base + 14, base - 28])
  for (let level = 96; level <= 228; level += 12) thresholds.add(level)
  for (const threshold of thresholds) {
    let mask: Uint8Array = new Uint8Array(width * height)
    for (let index = 0; index < mask.length; index++) mask[index] = smooth.data[index]! > threshold ? 1 : 0
    mask = dilate(erode(mask, width, height), width, height)
    fillHoles(mask, width, height)
    const found = blobs(mask, width, height, labels)
    for (const blob of found.slice(0, 3)) {
      if (blob.area < 0.1 * width * height) break
      const hull = convexHull(hullPoints(labels, blob.label, width, height))
      const quad = enclosingQuad(hull)
      if (!quad) continue
      // The opening shaved a pixel off every edge: give it back.
      const grown = grow(quad, 1)
      const score = scoreBlob(smooth, grown, blob.area + Math.sqrt(blob.area) * 2)
      if (score > 0) out.push({ quad: grown, score })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

/** A convex quad pushed out by `by` on every side. */
function grow(quad: PagePoint[], by: number): PagePoint[] {
  const centre = {
    x: (quad[0]!.x + quad[1]!.x + quad[2]!.x + quad[3]!.x) / 4,
    y: (quad[0]!.y + quad[1]!.y + quad[2]!.y + quad[3]!.y) / 4,
  }
  const lines = quad.map((point, index) => {
    const next = quad[(index + 1) % 4]!
    const length = Math.hypot(next.x - point.x, next.y - point.y) || 1
    let nx = -(next.y - point.y) / length, ny = (next.x - point.x) / length
    if (nx * (centre.x - point.x) + ny * (centre.y - point.y) > 0) { nx = -nx; ny = -ny }
    return {
      a: { x: point.x + nx * by, y: point.y + ny * by },
      b: { x: next.x + nx * by, y: next.y + ny * by },
    }
  })
  const grown = quad.map((_, index) => {
    const previous = lines[(index + 3) % 4]!, line = lines[index]!
    return intersection(previous.a, previous.b, line.a, line.b) ?? quad[index]!
  })
  return grown
}

// MARK: - 2. lines

interface Line {
  /** The unit normal, pointing INTO the page. */
  nx: number
  ny: number
  /** nx·x + ny·y = rho. */
  rho: number
  votes: number
}

function houghLines(gradient: Gradient): Line[] {
  const { gx, gy, magnitude, width, height } = gradient
  // The edges that count: a good share of the strongest ones, never the faintest texture.
  const sorted = Float32Array.from(magnitude).sort()
  const top = sorted[Math.floor(sorted.length * 0.985)] ?? 0
  const floor = Math.max(4, top * 0.3)
  const diagonal = Math.hypot(width, height)
  const rhoBins = Math.ceil(2 * diagonal) + 1
  const thetaBins = 360
  const votes = new Float32Array(thetaBins * rhoBins)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x
      const m = magnitude[index]!
      if (m < floor) continue
      const phi = Math.atan2(gy[index]!, gx[index]!)
      const centre = Math.round((phi < 0 ? phi + 2 * Math.PI : phi) * thetaBins / (2 * Math.PI))
      for (let spread = -4; spread <= 4; spread++) {
        const bin = (centre + spread + thetaBins) % thetaBins
        const theta = bin * 2 * Math.PI / thetaBins
        const rho = (x + 0.5) * Math.cos(theta) + (y + 0.5) * Math.sin(theta)
        votes[bin * rhoBins + Math.round(rho + diagonal)]! += m
      }
    }
  }
  // Peaks: a local maximum over a window, strong enough to be a page edge (a fifth of the short side of edge).
  const need = Math.min(width, height) * 0.15 * floor
  const peaks: Line[] = []
  for (let bin = 0; bin < thetaBins; bin++) {
    for (let r = 2; r < rhoBins - 2; r++) {
      const value = votes[bin * rhoBins + r]!
      if (value < need) continue
      let isPeak = true
      for (let dt = -6; dt <= 6 && isPeak; dt++) {
        const other = (bin + dt + thetaBins) % thetaBins
        for (let dr = -5; dr <= 5; dr++) {
          if (dt === 0 && dr === 0) continue
          const rr = r + dr
          if (rr < 0 || rr >= rhoBins) continue
          const v = votes[other * rhoBins + rr]!
          if (v > value || (v === value && (dt < 0 || (dt === 0 && dr < 0)))) { isPeak = false; break }
        }
      }
      if (!isPeak) continue
      const theta = bin * 2 * Math.PI / thetaBins
      peaks.push({ nx: Math.cos(theta), ny: Math.sin(theta), rho: r - diagonal, votes: value })
    }
  }
  return peaks.sort((a, b) => b.votes - a.votes).slice(0, 14)
}

const angleBetween = (a: Line, b: Line): number =>
  Math.acos(Math.max(-1, Math.min(1, a.nx * b.nx + a.ny * b.ny))) * 180 / Math.PI

function lineIntersection(a: Line, b: Line): PagePoint | null {
  const det = a.nx * b.ny - a.ny * b.nx
  if (Math.abs(det) < 1e-6) return null
  return { x: (a.rho * b.ny - a.ny * b.rho) / det, y: (a.nx * b.rho - a.rho * b.nx) / det }
}

/** How much of a side runs along a real edge facing the right way (0…1), and whether it lies on the frame's border. */
function sideSupport(gradient: Gradient, a: PagePoint, b: PagePoint, nx: number, ny: number, floor: number):
number {
  const { gx, gy, magnitude, width, height } = gradient
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < 2) return 0
  const samples = Math.max(8, Math.round(length / 2))
  let hit = 0, used = 0, outside = 0
  for (let step = 0; step < samples; step++) {
    const t = (step + 0.5) / samples
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
    if (x < 1 || y < 1 || x > width - 2 || y > height - 2) { outside++; continue }
    used++
    let good = false
    for (let k = -2; k <= 2 && !good; k++) {
      const px = Math.floor(x + nx * k), py = Math.floor(y + ny * k)
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const index = py * width + px
      const m = magnitude[index]!
      if (m >= floor && (gx[index]! * nx + gy[index]! * ny) / m > 0.75) good = true
    }
    if (good) hit++
  }
  // A side the frame cuts off has nothing to show for it, and does not count against the page.
  if (outside > samples * 0.5) return 1
  return used > 0 ? hit / used : 0
}

function lineCandidates(plane: Plane): Candidate[] {
  const gradient = gradientOf(blur(plane))
  const lines = houghLines(gradient)
  if (lines.length < 4) return []
  const sorted = Float32Array.from(gradient.magnitude).sort()
  const top = sorted[Math.floor(sorted.length * 0.985)] ?? 0
  const floor = Math.max(3, top * 0.25)
  const frameArea = plane.width * plane.height
  const out: Candidate[] = []

  // Pairs of lines facing each other; two such pairs that are roughly square to each other make a page.
  const opposite: [number, number][] = []
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (angleBetween(lines[i]!, lines[j]!) < 135) continue
      // Facing: each one's inside is on the other's side.
      const a = lines[i]!, b = lines[j]!
      const dot = a.nx * b.nx + a.ny * b.ny
      if (b.rho * dot - a.rho <= 0 || a.rho * dot - b.rho <= 0) continue
      opposite.push([i, j])
    }
  }
  for (let p = 0; p < opposite.length; p++) {
    for (let q = p + 1; q < opposite.length; q++) {
      const [i, j] = opposite[p]!, [k, l] = opposite[q]!
      if (i === k || i === l || j === k || j === l) continue
      const a = lines[i]!, b = lines[j]!, c = lines[k]!, d = lines[l]!
      const between = angleBetween(a, c)
      if (between < 50 || between > 130) continue
      // Cycle: a, c, b, d.
      const corners = [lineIntersection(a, c), lineIntersection(c, b), lineIntersection(b, d), lineIntersection(d, a)]
      if (corners.some((corner) => corner === null)) continue
      let quad = corners as PagePoint[]
      if (polygonArea(quad) < 0) quad = quad.slice().reverse()
      const area = polygonArea(quad)
      const share = area / frameArea
      if (share < 0.12 || share > 1.2 || !plausible(quad)) continue
      if (quad.some((point) => point.x < -0.15 * plane.width || point.x > 1.15 * plane.width
        || point.y < -0.15 * plane.height || point.y > 1.15 * plane.height)) continue
      let total = 0, weakest = 1
      const inward = [a, c, b, d]
      for (let side = 0; side < 4; side++) {
        const from = (corners as PagePoint[])[(side + 3) % 4]!, to = (corners as PagePoint[])[side]!
        const line = inward[side]!
        const support = sideSupport(gradient, from, to, line.nx, line.ny, floor)
        total += support
        weakest = Math.min(weakest, support)
      }
      if (weakest < 0.3) continue
      const score = (total / 4) * (0.65 + 0.35 * Math.min(1, share)) * Math.min(1, 0.4 + weakest)
      out.push({ quad, score })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

// MARK: - refinement

interface FittedLine { point: PagePoint; direction: PagePoint }

/** A line fitted through points with the outliers thrown away; null when too few agree. */
function robustLine(points: PagePoint[], tolerance: number): FittedLine | null {
  let current = points
  for (let round = 0; round < 4; round++) {
    if (current.length < 6) return null
    let mx = 0, my = 0
    for (const point of current) { mx += point.x; my += point.y }
    mx /= current.length
    my /= current.length
    let sxx = 0, sxy = 0, syy = 0
    for (const point of current) {
      sxx += (point.x - mx) ** 2
      sxy += (point.x - mx) * (point.y - my)
      syy += (point.y - my) ** 2
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    const direction = { x: Math.cos(angle), y: Math.sin(angle) }
    const normal = { x: -direction.y, y: direction.x }
    const residual = (point: PagePoint): number => Math.abs((point.x - mx) * normal.x + (point.y - my) * normal.y)
    const sortedResiduals = points.map(residual).sort((a, b) => a - b)
    const cutoff = Math.max(tolerance, 2.5 * (sortedResiduals[Math.floor(sortedResiduals.length * 0.5)] ?? 0))
    const kept = points.filter((point) => residual(point) <= cutoff)
    if (round === 3 || kept.length === current.length) {
      return kept.length >= 6 && kept.length >= points.length * 0.3 ? { point: { x: mx, y: my }, direction } : null
    }
    current = kept
  }
  return null
}

/** Move each side of `quad` onto the edge actually found near it, in a finer picture. */
function refine(plane: Plane, quad: PagePoint[], scale: number, band: number): PagePoint[] {
  const centre = {
    x: (quad[0]!.x + quad[1]!.x + quad[2]!.x + quad[3]!.x) / 4,
    y: (quad[0]!.y + quad[1]!.y + quad[2]!.y + quad[3]!.y) / 4,
  }
  const lines: (FittedLine | null)[] = []
  for (let side = 0; side < 4; side++) {
    const a = quad[side]!, b = quad[(side + 1) % 4]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 8) { lines.push(null); continue }
    let nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length
    if (nx * (centre.x - a.x) + ny * (centre.y - a.y) < 0) { nx = -nx; ny = -ny }
    const found: PagePoint[] = []
    const samples = Math.max(10, Math.min(60, Math.round(length / 4)))
    let clipped = 0
    for (let step = 0; step < samples; step++) {
      const t = 0.06 + 0.88 * (step + 0.5) / samples
      const sx = a.x + (b.x - a.x) * t, sy = a.y + (b.y - a.y) * t
      if (sx < band || sy < band || sx > plane.width - band || sy > plane.height - band) { clipped++; continue }
      let best = 0, bestScore = 0
      for (let k = -band; k <= band; k += 0.5) {
        let inside = 0, outside = 0
        for (let m = 1; m <= 3; m++) {
          inside += sample(plane, sx + nx * (k + m), sy + ny * (k + m))
          outside += sample(plane, sx + nx * (k - m), sy + ny * (k - m))
        }
        const response = (inside - outside) / 3
        if (response > bestScore) { bestScore = response; best = k }
      }
      if (bestScore < 10) continue
      found.push({ x: sx + nx * best, y: sy + ny * best })
    }
    // A side the frame cuts off is not searched for.
    if (clipped > samples * 0.4) { lines.push(null); continue }
    lines.push(robustLine(found, 0.8 * scale))
  }
  const fitted = quad.map((corner, index) => {
    const before = lines[(index + 3) % 4], after = lines[index]
    if (!before || !after) return corner
    const meet = intersection(
      before.point, { x: before.point.x + before.direction.x, y: before.point.y + before.direction.y },
      after.point, { x: after.point.x + after.direction.x, y: after.point.y + after.direction.y })
    if (!meet) return corner
    // A corner is only moved as far as the coarse answer could have been wrong.
    return Math.hypot(meet.x - corner.x, meet.y - corner.y) <= band * 3 ? meet : corner
  })
  return plausible(fitted) ? fitted : quad
}

// MARK: - the entry point

export interface FindPageOptions {
  /** Lowest confidence returned. */
  minimum?: number
}

/**
 * Where the page is in an RGBA frame (`width`×`height`, top-left origin), or
 * null when nothing page-shaped is there. The answer's corners are in the
 * frame's own pixels.
 */
export function findPage(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number,
  options: FindPageOptions = {}): FoundPage | null {
  if (width < 16 || height < 16 || rgba.length < width * height * 4) return null
  const minimum = options.minimum ?? MINIMUM_CONFIDENCE
  const white = whiteness(rgba, width * height)
  const coarse = shrink(white, width, height, COARSE_SIDE)
  const fine = shrink(white, width, height, FINE_SIDE)
  const toFrame = (point: PagePoint, plane: Plane): PagePoint => ({
    x: Math.min(Math.max(point.x * width / plane.width, 0), width),
    y: Math.min(Math.max(point.y * height / plane.height, 0), height),
  })
  const finish = (quad: PagePoint[], plane: Plane, confidence: number, method: FoundPage["method"],
    bandPixels: number): FoundPage | null => {
    // Refine on the finer picture: the answer scaled up to it first.
    const factor = fine.width / plane.width
    const scaled = quad.map((point) => ({ x: point.x * factor, y: point.y * factor }))
    const refined = refine(blur(fine), scaled, factor, bandPixels)
    const clamped = refined.map((point) => toFrame(point, fine))
    if (!plausible(clamped)) return null
    const coverage = Math.abs(polygonArea(clamped)) / (width * height)
    // A page that IS the frame is no finding: there is nothing to square up.
    if (coverage > 0.96) return null
    return { corners: named(clamped), confidence, coverage, method }
  }

  const segmented = segmentationCandidates(coarse)
  const best = segmented[0]
  // Sure of the blob: refine and be done. The band is what the coarse answer could be out by.
  if (best && best.score >= 0.6) {
    const found = finish(best.quad, coarse, best.score, "segmentation", Math.max(4, Math.round(FINE_SIDE / COARSE_SIDE * 2.5)))
    if (found) return found
  }
  const lineBase = shrink(white, width, height, LINES_SIDE)
  const lined = lineCandidates(lineBase)
  const line = lined[0]
  const useLine = line && line.score >= minimum && (!best || line.score > best.score)
  if (useLine) {
    const found = finish(line.quad, lineBase, line.score, "lines", Math.max(3, Math.round(FINE_SIDE / LINES_SIDE * 2)))
    if (found) return found
  }
  if (best && best.score >= minimum) {
    return finish(best.quad, coarse, best.score, "segmentation", Math.max(4, Math.round(FINE_SIDE / COARSE_SIDE * 2.5)))
  }
  return null
}

/** The four corners as an ordered list (top left, top right, bottom right, bottom left). */
export const pageCornerList = cornersOf
