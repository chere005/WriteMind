/**
 * Lifting the writing off the paper: what is darker than the paper round
 * it, sorted into specks, page edges, the printed dot grid, and the
 * writing. Ported from `WriteMind/Camera/NotebookCapture.swift`.
 *
 * This is the part of the camera that is OURS on both platforms. Finding
 * the page in the frame is Apple's ML and Windows does without it (the box
 * is dragged by hand); everything below is arithmetic over a grey buffer
 * and runs the same on either.
 */

export interface Component {
  stride: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  pixels: number[]
}

export const componentWidth = (c: Component): number => c.maxX - c.minX + 1
export const componentHeight = (c: Component): number => c.maxY - c.minY + 1
export const componentArea = (c: Component): number => c.pixels.length
/** How much of its box is ink: 1 for a solid dot, small for a ring. */
export const componentFill = (c: Component): number =>
  componentArea(c) / (componentWidth(c) * componentHeight(c))
export const componentCentre = (c: Component): { x: number; y: number } =>
  ({ x: (c.minX + c.maxX) / 2, y: (c.minY + c.maxY) / 2 })

/**
 * How far the "darker than the paper round it" test looks. It is the one
 * number that decides how big a solid shape has to be before the test
 * hollows it out, so anything that has to tell a drawn outline from a
 * filled blob asks for it rather than guessing.
 */
export const localMeanRadius = (width: number, height: number): number =>
  Math.max(8, Math.floor(Math.min(width, height) / 40))

/**
 * The average of a square window round every pixel, from a summed-area
 * table so the window's size does not matter.
 */
export function localMean(gray: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const stride = width + 1
  const sums = new Int32Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]!
      sums[(y + 1) * stride + (x + 1)] = sums[y * stride + (x + 1)]! + rowSum
    }
  }
  const mean = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius), bottom = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width - 1, x + radius)
      const total = sums[(bottom + 1) * stride + (right + 1)]! - sums[top * stride + (right + 1)]!
        - sums[(bottom + 1) * stride + left]! + sums[top * stride + left]!
      const count = (bottom - top + 1) * (right - left + 1)
      mean[y * width + x] = Math.max(0, Math.min(255, Math.trunc(total / count)))
    }
  }
  return mean
}

/**
 * Every pixel darker than the paper round it by `threshold` levels — the
 * raw ink, dots and specks and page edge included.
 */
export function darkerThanPaper(gray: Uint8Array, width: number, height: number,
  threshold = 28): Uint8Array {
  const mean = localMean(gray, width, height, localMeanRadius(width, height))
  const ink = new Uint8Array(width * height)
  for (let index = 0; index < width * height; index++) {
    if (mean[index]! - gray[index]! >= threshold) ink[index] = 1
  }
  return ink
}

/** The 8-connected blobs of a mask, in the order their first pixel is met. */
export function components(ink: Uint8Array, width: number, height: number): Component[] {
  const label = new Int32Array(width * height)
  const found: Component[] = []
  let next = 1
  const stack: number[] = []

  for (let start = 0; start < width * height; start++) {
    if (!ink[start] || label[start] !== 0) continue
    const pixels: number[] = []
    let minX = width, maxX = -1, minY = height, maxY = -1
    label[start] = next
    stack.push(start)
    while (stack.length > 0) {
      const index = stack.pop()!
      pixels.push(index)
      const x = index % width, y = (index - (index % width)) / width
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const neighbour = ny * width + nx
        if (ink[neighbour] && label[neighbour] === 0) {
          label[neighbour] = next
          stack.push(neighbour)
        }
      }
    }
    next += 1
    found.push({ stride: width, minX, minY, maxX, maxY, pixels })
  }
  return found
}

/**
 * The printed dot grid, found by its REGULARITY rather than its size — at
 * page resolution a printed dot can reach the speck limit and had been
 * getting through. The candidates are the small roundish blobs; the spacing
 * is the median nearest-neighbour distance among them; a candidate is on
 * the grid when two others sit at that spacing in directions at least 60°
 * apart, so a row of dots counts and a full stop beside one dot does not.
 */
export function dotLattice(all: Component[], width: number, height: number, options: {
  tolerance?: number
  minimumDots?: number
  maximumCandidates?: number
} = {}): Set<number> | null {
  const tolerance = options.tolerance ?? 0.15
  const minimumDots = options.minimumDots ?? 20
  const maximumCandidates = options.maximumCandidates ?? 5000
  const limit = Math.max(6, Math.floor(Math.min(width, height) / 80))

  const candidates: { index: number; x: number; y: number }[] = []
  all.forEach((component, index) => {
    const w = componentWidth(component), h = componentHeight(component)
    const long = Math.max(w, h), short = Math.min(w, h)
    if (long > limit || long > 2 * short || componentFill(component) < 0.3) return
    const centre = componentCentre(component)
    candidates.push({ index, x: centre.x, y: centre.y })
  })
  const count = candidates.length
  if (count < minimumDots || count > maximumCandidates) return null
  candidates.sort((a, b) => a.x - b.x)

  // Nearest neighbours, sweeping each way along x: once the x gap alone is
  // more than the nearest so far, nothing further is nearer.
  const nearest = new Array<number>(count).fill(Infinity)
  for (let i = 0; i < count; i++) {
    for (const step of [1, -1]) {
      let j = i + step
      while (j >= 0 && j < count && Math.abs(candidates[j]!.x - candidates[i]!.x) < nearest[i]!) {
        const d = Math.hypot(candidates[j]!.x - candidates[i]!.x, candidates[j]!.y - candidates[i]!.y)
        if (d < nearest[i]!) nearest[i] = d
        j += step
      }
    }
  }
  const spacing = [...nearest].sort((a, b) => a - b)[Math.floor(count / 2)]!
  if (!Number.isFinite(spacing) || spacing < 3) return null
  const near = (1 - tolerance) * spacing, far = (1 + tolerance) * spacing

  const lattice = new Set<number>()
  for (let i = 0; i < count; i++) {
    const directions: { dx: number; dy: number }[] = []
    for (const step of [1, -1]) {
      let j = i + step
      while (j >= 0 && j < count && Math.abs(candidates[j]!.x - candidates[i]!.x) <= far) {
        const dx = candidates[j]!.x - candidates[i]!.x, dy = candidates[j]!.y - candidates[i]!.y
        const d = Math.hypot(dx, dy)
        if (d >= near && d <= far) directions.push({ dx: dx / d, dy: dy / d })
        j += step
      }
    }
    // Two neighbours at least 60° apart: the cosine between their
    // directions is at most 0.5.
    let apart = false
    for (let a = 0; a < directions.length && !apart; a++) {
      for (let b = a + 1; b < directions.length; b++) {
        if (directions[a]!.dx * directions[b]!.dx + directions[a]!.dy * directions[b]!.dy <= 0.5) {
          apart = true
          break
        }
      }
    }
    if (apart) lattice.add(candidates[i]!.index)
  }
  if (lattice.size < minimumDots || lattice.size * 2 < count) return null
  return lattice
}

export interface Marks {
  width: number
  height: number
  components: Component[]
  /** Indices of the dots of a printed grid — null when the page has none. */
  lattice: Set<number> | null
  /** Indices of what is left once specks, the page edge and the grid are gone. */
  writing: number[]
}

/**
 * Every blob sorted into what it is. A speck is smaller than `minimumSize`
 * across or `minimumArea` in pixels; a page edge is a mark most of the
 * width or height of the page; a grid dot is one the lattice search picked
 * out, whatever its size.
 */
export function marks(ink: Uint8Array, width: number, height: number, options: {
  minimumSize?: number
  minimumArea?: number
  /** A picture with no page edge in it (the tablet sheet, drawn on white): a mark across it is writing, not an edge. */
  keepEdges?: boolean
} = {}): Marks {
  const minimumSize = options.minimumSize ?? 7
  const minimumArea = options.minimumArea ?? 20
  const all = components(ink, width, height)
  const lattice = dotLattice(all, width, height)
  const writing: number[] = []
  all.forEach((component, index) => {
    const isSpeck = componentArea(component) < minimumArea
      || Math.max(componentWidth(component), componentHeight(component)) < minimumSize
    const isEdge = !options.keepEdges
      && (componentWidth(component) > width * 0.85 || componentHeight(component) > height * 0.85)
    const isDot = lattice?.has(index) ?? false
    if (!isSpeck && !isEdge && !isDot) writing.push(index)
  })
  return { width, height, components: all, lattice, writing }
}

export function maskOf(found: Marks, indices: Iterable<number>): Uint8Array {
  const mask = new Uint8Array(found.width * found.height)
  for (const index of indices) {
    for (const pixel of found.components[index]!.pixels) mask[pixel] = 1
  }
  return mask
}

export const writingMask = (found: Marks): Uint8Array => maskOf(found, found.writing)

/** Connected marks, with the specks, the page edges and the dot grid taken out. */
export function inkMask(gray: Uint8Array, width: number, height: number, options: {
  threshold?: number
  minimumSize?: number
  minimumArea?: number
  keepEdges?: boolean
} = {}): Uint8Array {
  const raw = darkerThanPaper(gray, width, height, options.threshold ?? 28)
  return writingMask(marks(raw, width, height, options))
}

// MARK: - How heavy traced writing comes out (Mac commits 159e0f6, 6685cb1)

/**
 * HOW MUCH OF ITS OWN WIDTH A TRACED STROKE KEEPS (`NotebookCapture.strokeKeep`). Sean, 2026-09-22: "the scale is
 * correct, but the thickness of the writing is too thick". A capture lands at more than twice the size it used to
 * (`PAGE_FRACTION`) and the trace is faithful, so the pen arrived twice as heavy beside the note's text. A THIRD:
 * half of it was still heavy, said twice the same day.
 */
export const STROKE_KEEP = 0.35

/**
 * How thin a stroke is ever allowed to get, in mask pixels (`NotebookCapture.strokeFloor`). Under about this a
 * pencil line comes apart into dots, and a capture with holes in it is worse than a heavy one — so a stroke already
 * at the floor is left exactly as it was.
 */
export const STROKE_FLOOR = 2.0

/**
 * THE INK'S MEAN STROKE WIDTH, in mask pixels: twice the area over the boundary (`NotebookCapture.strokeWidth`).
 * For anything long and thin that IS its width, whatever shape it is — a long run of pixels has two long sides and
 * two short ends, so the ends fall out of the ratio. Measured rather than assumed, because a fine pencil and a
 * marker are four times apart and one number eroded off both would break the first and barely touch the second.
 */
export function inkStrokeWidth(mask: Uint8Array, width: number, height: number): number {
  const inked = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0
  let area = 0, boundary = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      area += 1
      if (!inked(x - 1, y)) boundary += 1
      if (!inked(x + 1, y)) boundary += 1
      if (!inked(x, y - 1)) boundary += 1
      if (!inked(x, y + 1)) boundary += 1
    }
  }
  return boundary > 0 ? 2 * area / boundary : 0
}

/**
 * The ink, thinned to `keep` of its measured width — one pixel off every side per pass, so a stroke loses two of
 * its width each time (`NotebookCapture.thinned`). Nothing is thinned past `floor`, and a stroke already at or under
 * it is returned untouched (the same array) rather than eroded to nothing.
 */
export function thinnedInk(mask: Uint8Array, width: number, height: number,
  keep = STROKE_KEEP, floor = STROKE_FLOOR): Uint8Array {
  const measured = inkStrokeWidth(mask, width, height)
  const target = Math.max(floor, measured * keep)
  // Swift's `.rounded()` is half away from zero; for a positive count that is Math.round, and a negative one is no pass.
  const passes = Math.round((measured - target) / 2)
  if (!(passes > 0)) return mask
  let ink = Uint8Array.from(mask)
  for (let pass = 0; pass < passes; pass++) {
    const before = ink
    ink = Uint8Array.from(before)
    const inked = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && before[y * width + x] !== 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!before[y * width + x]) continue
        if (!inked(x - 1, y) || !inked(x + 1, y) || !inked(x, y - 1) || !inked(x, y + 1)) ink[y * width + x] = 0
      }
    }
  }
  return ink
}

/**
 * The writing as the TRACE takes it: CLEAN, THIN, THEN CLEAN AGAIN (the `.ink` case of `NotebookCapture.capture`,
 * Mac commit 6685cb1). `cleaned` is the first pass's marks (specks, the printed grid and the page's edge already
 * dropped), which is what the stroke width is measured off — measuring the raw ink would be measuring the dots as
 * much as the pen. The second pass is there BECAUSE of the thinning: a printed dot that got past the lattice is a few
 * pixels across, and the erosion leaves it under the speck limit, so the dots that survived the grid search come out
 * in the wash (Sean, 2026-09-22: "now some of the background dots are getting picked up by mistake").
 */
export function thinnedWriting(cleaned: Marks, options: { minimumSize?: number; minimumArea?: number; keepEdges?: boolean } = {}): Marks {
  const thin = thinnedInk(writingMask(cleaned), cleaned.width, cleaned.height)
  return marks(thin, cleaned.width, cleaned.height, {
    minimumSize: options.minimumSize ?? 7, minimumArea: options.minimumArea ?? 20, keepEdges: options.keepEdges,
  })
}

/**
 * The writing's box with a little room round it, kept inside the page — the
 * writing inside `within` only (page pixels, top-left origin), when there is
 * one (`NotebookCapture.inkBox(of:within:)`: a section of the page).
 */
export function inkBox(mask: Uint8Array, width: number, height: number, margin = 6,
  within?: { x: number; y: number; width: number; height: number }):
{ x: number; y: number; width: number; height: number } | null {
  const fromX = within ? Math.max(0, Math.trunc(within.x)) : 0
  const fromY = within ? Math.max(0, Math.trunc(within.y)) : 0
  const toX = within ? Math.min(width, Math.ceil(within.x + within.width)) : width
  const toY = within ? Math.min(height, Math.ceil(within.y + within.height)) : height
  if (toX <= fromX || toY <= fromY) return null
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = fromY; y < toY; y++) {
    for (let x = fromX; x < toX; x++) {
      if (!mask[y * width + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  const x0 = Math.max(0, minX - margin), y0 = Math.max(0, minY - margin)
  const x1 = Math.min(width - 1, maxX + margin), y1 = Math.min(height - 1, maxY + margin)
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/**
 * The box of the writing PROPER — the port's refinement of `inkBox`. A printed dot the
 * lattice search missed (the dots at the far side of a tilted page come out blurred and
 * irregular) is a mark just over the speck limit, and `inkBox` would stretch the picture
 * to reach it: a line of writing came in the size of the whole page. Marks too small to
 * be writing on their own (area under `SIGNIFICANT_AREA` and no side over
 * `SIGNIFICANT_SIDE`) only count when they sit within `reach` of the writing that is
 * (an i-dot, a full stop, a comma); a page with no larger mark at all keeps them all.
 * `within` is a section of the page (page pixels); only marks whose centre is in it count.
 */
export const SIGNIFICANT_AREA = 60
export const SIGNIFICANT_SIDE = 16

export function writingBox(found: Marks, margin = 6, within?: { x: number; y: number; width: number; height: number },
  reach = 28): { x: number; y: number; width: number; height: number } | null {
  /** A mark as far as it lies in the section: a drawing joined up across the page is cut at the section's edge. */
  interface Part { minX: number; minY: number; maxX: number; maxY: number; area: number }
  const partsHere: Part[] = []
  for (const index of found.writing) {
    const c = found.components[index]!
    if (!within) {
      partsHere.push({ minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY, area: componentArea(c) })
      continue
    }
    const left = within.x, top = within.y, right = within.x + within.width, bottom = within.y + within.height
    if (c.maxX + 1 <= left || c.minX >= right || c.maxY + 1 <= top || c.minY >= bottom) continue
    if (c.minX >= left && c.maxX + 1 <= right && c.minY >= top && c.maxY + 1 <= bottom) {
      partsHere.push({ minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY, area: componentArea(c) })
      continue
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, area = 0
    for (const pixel of c.pixels) {
      const x = pixel % found.width, y = (pixel - x) / found.width
      if (x < left || x >= right || y < top || y >= bottom) continue
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (area > 0) partsHere.push({ minX, minY, maxX, maxY, area })
  }
  if (partsHere.length === 0) return null
  const large = (p: Part): boolean =>
    p.area >= SIGNIFICANT_AREA || Math.max(p.maxX - p.minX + 1, p.maxY - p.minY + 1) >= SIGNIFICANT_SIDE
  const writing = partsHere.filter(large)
  const base = writing.length > 0 ? writing : partsHere
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const take = (p: Part): void => {
    minX = Math.min(minX, p.minX); minY = Math.min(minY, p.minY)
    maxX = Math.max(maxX, p.maxX); maxY = Math.max(maxY, p.maxY)
  }
  base.forEach(take)
  if (writing.length > 0) {
    // The small marks that belong to the writing: near it. Taking one can bring another into reach, so go until none does.
    const small = partsHere.filter((p) => !large(p))
    const taken = new Set<Part>()
    for (let grew = true; grew;) {
      grew = false
      for (const p of small) {
        if (taken.has(p)) continue
        if (p.maxX >= minX - reach && p.minX <= maxX + reach && p.maxY >= minY - reach && p.minY <= maxY + reach) {
          taken.add(p)
          take(p)
          grew = true
        }
      }
    }
  }
  const x0 = Math.max(0, minX - margin), y0 = Math.max(0, minY - margin)
  const x1 = Math.min(found.width - 1, maxX + margin), y1 = Math.min(found.height - 1, maxY + margin)
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}
