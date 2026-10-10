/**
 * THE BUNDLED READER: PaddleOCR's PP-OCRv5 (a text-line DETECTOR and a CTC RECOGNISER, both ONNX) run on
 * onnxruntime's WebAssembly build, so a Mac, a Windows box and an Arch box read a picture with the same weights and
 * the same arithmetic, and nothing is installed. docs/OCR-BUNDLED.md says why this engine and where the files come
 * from.
 *
 * What is here is the arithmetic around the two networks, kept free of onnxruntime itself (the session and the
 * tensor class are handed in) so it can be tested with stand-ins:
 *
 *   picture -> detector input (resized, multiple of 32, ImageNet-normalised BGR)
 *           -> probability map -> lines (connected blobs, their minimum-area rectangles, grown by DB's unclip)
 *           -> each line cut out upright at 48 px high -> recogniser -> CTC greedy decode
 *           -> the `Words` shape the other readers give: lines AND words, boxed as fractions of the picture, y down,
 *              with the recogniser's own confidence.
 *
 * The word boxes come from the CTC timesteps: each character is emitted at a column of the cut-out line, so a
 * word's left and right are where its first and last characters were seen. They are line-high, like Vision's.
 */

import type { Rgba } from "./png"

// MARK: - The runtime, as far as this file needs it

export interface TensorLike { readonly dims: readonly number[]; readonly data: unknown }
export type TensorMaker = (data: Float32Array, dims: number[]) => TensorLike
export interface SessionLike {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>
}

/** A recogniser and its CTC alphabet (index 0 the blank). */
export interface Recogniser { session: SessionLike; alphabet: string[] }

export interface Engine {
  det: SessionLike
  /** The English recogniser: every line is read with it. */
  rec: Recogniser
  /** The multilingual one, when shipped: a line it reads as Japanese is taken from it (`pickReading`). */
  japanese?: Recogniser
  tensor: TensorMaker
}

/** What one picture gave, in the shape `helpers.ts`'s `Words.lines` has. */
export interface BundledLine {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
  words: { text: string; x: number; y: number; width: number; height: number }[]
}

export interface ReadTuning {
  /** The longest side the detector sees (the picture is scaled down to it, never up past `minSide`). */
  maxSide: number
  /** A small picture is scaled UP until its short side is at least this. */
  minSide: number
  /** Probability above which a pixel is text. */
  threshold: number
  /** A line whose mean probability is below this is dropped. */
  boxThreshold: number
  /** DB's unclip ratio: how far a line's core is grown back out to the ink's edge. */
  unclip: number
  /** A line read with less confidence than this is not returned (a doodle, the paper's grain). */
  minConfidence: number
}

export const DEFAULT_TUNING: ReadTuning = {
  maxSide: 1600, minSide: 640, threshold: 0.3, boxThreshold: 0.5, unclip: 1.6, minConfidence: 0.5,
}

/** Thrown, and nothing else, when the read was taken back between two steps. */
const checkStop = (shouldStop?: () => boolean): void => {
  if (shouldStop?.()) throw Object.assign(new Error("cancelled"), { name: "AbortError" })
}

// MARK: - Pixels

/** Grey-level-independent bilinear sample of one channel of an RGBA picture, transparent counted as white. */
function sampler(image: Rgba): (x: number, y: number, out: Float32Array) => void {
  const { width, height, data } = image
  const px = (x: number, y: number, c: number): number => {
    const o = (y * width + x) * 4
    const a = data[o + 3]! / 255
    return data[o + c]! * a + 255 * (1 - a)
  }
  return (x, y, out) => {
    const fx = Math.min(width - 1, Math.max(0, x - 0.5)), fy = Math.min(height - 1, Math.max(0, y - 0.5))
    const x0 = Math.floor(fx), y0 = Math.floor(fy)
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
    const ax = fx - x0, ay = fy - y0
    for (let c = 0; c < 3; c += 1) {
      const top = px(x0, y0, c) * (1 - ax) + px(x1, y0, c) * ax
      const bottom = px(x0, y1, c) * (1 - ax) + px(x1, y1, c) * ax
      out[c] = top * (1 - ay) + bottom * ay
    }
  }
}

/**
 * Sample a parallelogram of the picture (origin + u * s + v * t, s and t in 0..1) into an outW x outH RGB grid,
 * averaging `k` x `k` samples a pixel when it is shrinking a lot - a thin pen line must not fall between samples.
 */
function sampleQuad(image: Rgba, origin: Point, u: Point, v: Point, outW: number, outH: number): Float32Array {
  const take = sampler(image)
  const spanU = Math.hypot(u.x, u.y) / outW, spanV = Math.hypot(v.x, v.y) / outH
  const k = Math.max(1, Math.min(4, Math.ceil(Math.max(spanU, spanV))))
  const out = new Float32Array(outW * outH * 3)
  const rgb = new Float32Array(3)
  for (let j = 0; j < outH; j += 1) {
    for (let i = 0; i < outW; i += 1) {
      let r = 0, g = 0, b = 0
      for (let sj = 0; sj < k; sj += 1) {
        for (let si = 0; si < k; si += 1) {
          const s = (i + (si + 0.5) / k) / outW, t = (j + (sj + 0.5) / k) / outH
          take(origin.x + u.x * s + v.x * t, origin.y + u.y * s + v.y * t, rgb)
          r += rgb[0]!; g += rgb[1]!; b += rgb[2]!
        }
      }
      const o = (j * outW + i) * 3, n = k * k
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n
    }
  }
  return out
}

// MARK: - Detection

export interface Point { x: number; y: number }

/** A text line as the detector found it: a rotated rectangle in PICTURE pixels. */
export interface LineBox {
  center: Point
  /** Unit vector along the line (pointing right-ish). */
  u: Point
  /** Unit vector across it (pointing down-ish). */
  v: Point
  halfWidth: number
  halfHeight: number
  score: number
}

/** The detector's input size for a picture: scaled into [minSide, maxSide], each side a multiple of 32. */
export function detectorSize(width: number, height: number, tuning: ReadTuning = DEFAULT_TUNING):
{ width: number; height: number } {
  let scale = 1
  if (Math.max(width, height) > tuning.maxSide) scale = tuning.maxSide / Math.max(width, height)
  else if (Math.min(width, height) < tuning.minSide) {
    scale = Math.min(tuning.minSide / Math.min(width, height), tuning.maxSide / Math.max(width, height))
  }
  const round = (side: number) => Math.max(32, Math.round((side * scale) / 32) * 32)
  return { width: round(width), height: round(height) }
}

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]

/** NCHW float input for the detector: BGR (Paddle reads with OpenCV), ImageNet mean and deviation. */
export function detectorInput(image: Rgba, size: { width: number; height: number }): Float32Array {
  const rgb = sampleQuad(image, { x: 0, y: 0 }, { x: image.width, y: 0 }, { x: 0, y: image.height }, size.width, size.height)
  const plane = size.width * size.height
  const out = new Float32Array(plane * 3)
  for (let p = 0; p < plane; p += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgb[p * 3 + (2 - c)]! / 255  // BGR
      out[c * plane + p] = (value - MEAN[c]!) / STD[c]!
    }
  }
  return out
}

const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Andrew's monotone chain. */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 2) return sorted
  const lower: Point[] = [], upper: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop(); lower.pop()
  return lower.concat(upper)
}

/**
 * The smallest rectangle round a set of points (rotating calipers over the hull's edges), oriented so `u` runs
 * along the LONGER side... unless that would make the line more than 45 degrees off horizontal for a box that is
 * nearly square - then the more horizontal axis is `u`. `v` points down.
 */
export function minAreaRect(points: Point[]): Omit<LineBox, "score"> {
  const hull = convexHull(points)
  let best = { area: Infinity, center: { x: 0, y: 0 }, u: { x: 1, y: 0 }, w: 0, h: 0 }
  const edges = hull.length >= 2 ? hull.length : 1
  for (let i = 0; i < edges; i += 1) {
    const a = hull[i] ?? { x: 0, y: 0 }, b = hull[(i + 1) % hull.length] ?? a
    let ux = b.x - a.x, uy = b.y - a.y
    const length = Math.hypot(ux, uy)
    if (length === 0) { ux = 1; uy = 0 } else { ux /= length; uy /= length }
    let minS = Infinity, maxS = -Infinity, minT = Infinity, maxT = -Infinity
    for (const p of hull) {
      const s = p.x * ux + p.y * uy, t = -p.x * uy + p.y * ux
      minS = Math.min(minS, s); maxS = Math.max(maxS, s); minT = Math.min(minT, t); maxT = Math.max(maxT, t)
    }
    const area = (maxS - minS) * (maxT - minT)
    if (area < best.area) {
      const cs = (minS + maxS) / 2, ct = (minT + maxT) / 2
      best = { area, center: { x: cs * ux - ct * uy, y: cs * uy + ct * ux }, u: { x: ux, y: uy }, w: maxS - minS, h: maxT - minT }
    }
  }
  let u = best.u, w = best.w, h = best.h
  // The long side is the line; a box near square keeps whichever axis is nearer horizontal.
  const swap = h > w * 1.25 ? true : w > h * 1.25 ? false : Math.abs(u.y) > Math.abs(u.x)
  if (swap) { u = { x: -u.y, y: u.x }; [w, h] = [h, w] }
  if (u.x < 0 || (u.x === 0 && u.y < 0)) u = { x: -u.x, y: -u.y }
  const v = { x: -u.y, y: u.x }
  return { center: best.center, u, v: v.y < 0 ? { x: -v.x, y: -v.y } : v, halfWidth: w / 2, halfHeight: h / 2 }
}

/**
 * The lines in a probability map (`map` is width x height, 0..1): blobs above `threshold`, eight-connected, each
 * one's minimum-area rectangle grown by DB's unclip distance (area * ratio / perimeter), scored by the mean
 * probability inside it. Coordinates are the MAP's.
 */
export function linesInMap(map: Float32Array, width: number, height: number, tuning: ReadTuning = DEFAULT_TUNING): LineBox[] {
  const label = new Int32Array(width * height)
  const lines: LineBox[] = []
  const stack: number[] = []
  let next = 0
  for (let start = 0; start < map.length; start += 1) {
    if (label[start] !== 0 || map[start]! <= tuning.threshold) continue
    next += 1
    label[start] = next
    stack.push(start)
    // The left and right ends of each row of the blob are enough for its hull.
    const rowMin = new Map<number, number>(), rowMax = new Map<number, number>()
    let count = 0, sum = 0
    while (stack.length > 0) {
      const at = stack.pop()!
      const x = at % width, y = (at - x) / width
      count += 1
      sum += map[at]!
      if (!(rowMin.get(y)! <= x)) rowMin.set(y, x)
      if (!(rowMax.get(y)! >= x)) rowMax.set(y, x)
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue
          const n = ny * width + nx
          if (label[n] === 0 && map[n]! > tuning.threshold) { label[n] = next; stack.push(n) }
        }
      }
    }
    if (count < 4) continue
    const points: Point[] = []
    for (const [y, x] of rowMin) {
      points.push({ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 })
      const right = rowMax.get(y)!
      points.push({ x: right, y }, { x: right + 1, y }, { x: right, y: y + 1 }, { x: right + 1, y: y + 1 })
    }
    const rect = minAreaRect(points)
    if (Math.min(rect.halfWidth, rect.halfHeight) * 2 < 3) continue
    const score = sum / count
    if (score < tuning.boxThreshold) continue
    const w = rect.halfWidth * 2, h = rect.halfHeight * 2
    const distance = (w * h * tuning.unclip) / (2 * (w + h))
    lines.push({ ...rect, halfWidth: rect.halfWidth + distance, halfHeight: rect.halfHeight + distance, score })
  }
  return lines
}

// MARK: - Recognition

const REC_HEIGHT = 48
/** PaddleOCR pads every line to at least this wide (its 3 x 48 x 320 shape). */
const REC_MIN_WIDTH = 320
/** And no line is cut wider than this (a very long line is still read, just squeezed). */
const REC_MAX_WIDTH = 3200

/** A cut-out line: the picture's pixels under `box`, upright, 48 high, normalised for the recogniser. */
export interface Strip {
  /** NCHW float, 3 x 48 x `padded`. */
  data: Float32Array
  /** Width the line's own pixels take. */
  width: number
  /** Width after padding. */
  padded: number
  /** Where the strip came from: its top-left corner and its two edge vectors, in picture pixels. */
  origin: Point
  along: Point
  across: Point
}

/** Cut `box` out of the picture. A box much taller than wide is a vertical line, read turned a quarter left. */
export function cutStrip(image: Rgba, box: LineBox): Strip {
  let u = box.u, v = box.v, hw = box.halfWidth, hh = box.halfHeight
  if (hh * 2 >= hw * 2 * 1.5) {
    // Paddle's np.rot90: the top of the line becomes its left, the right its top.
    const nu = v, nv = { x: -u.x, y: -u.y }
    u = nu; v = nv; [hw, hh] = [hh, hw]
  }
  const along = { x: u.x * hw * 2, y: u.y * hw * 2 }, across = { x: v.x * hh * 2, y: v.y * hh * 2 }
  const origin = { x: box.center.x - u.x * hw - v.x * hh, y: box.center.y - u.y * hw - v.y * hh }
  const width = Math.max(1, Math.min(REC_MAX_WIDTH, Math.ceil((REC_HEIGHT * hw) / Math.max(1e-6, hh))))
  const padded = Math.max(REC_MIN_WIDTH, width)
  const rgb = sampleQuad(image, origin, along, across, width, REC_HEIGHT)
  const plane = padded * REC_HEIGHT
  const data = new Float32Array(plane * 3)  // padding is 0 after normalising, as Paddle's is
  for (let y = 0; y < REC_HEIGHT; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c += 1) data[c * plane + y * padded + x] = rgb[o + (2 - c)]! / 127.5 - 1  // BGR
    }
  }
  return { data, width, padded, origin, along, across }
}

/** One character the recogniser emitted, and the timesteps it spans. */
export interface Emitted { char: string; first: number; last: number; probability: number }

/**
 * CTC greedy decoding of a [T, C] probability matrix: the best class each step, repeats collapsed, blanks dropped.
 * Returns the characters with the steps each was seen at.
 */
export function ctcDecode(probabilities: Float32Array, steps: number, classes: number, alphabet: string[]): Emitted[] {
  const out: Emitted[] = []
  let previous = -1
  for (let t = 0; t < steps; t += 1) {
    let best = 0, bestP = -Infinity
    const row = t * classes
    for (let c = 0; c < classes; c += 1) {
      const p = probabilities[row + c]!
      if (p > bestP) { bestP = p; best = c }
    }
    if (best !== 0 && best === previous && out.length > 0) {
      const last = out[out.length - 1]!
      last.last = t
      last.probability = Math.max(last.probability, bestP)
    } else if (best !== 0) {
      out.push({ char: alphabet[best] ?? "", first: t, last: t, probability: bestP })
    }
    previous = best
  }
  return out
}

/**
 * A decoded strip as a line of the reading: its text, its confidence (the mean probability of its characters,
 * PaddleOCR's own), its box, and its words - split at the spaces, each spanning from its first character's step
 * to its last's. Boxes are fractions of the picture (`pictureWidth` x `pictureHeight`), y down, axis-aligned.
 */
export function lineFrom(emitted: Emitted[], steps: number, strip: Strip, pictureWidth: number, pictureHeight: number):
BundledLine | null {
  const text = emitted.map((one) => one.char).join("").replace(/\s+/g, " ").trim()
  if (text === "") return null
  const kept = emitted.filter((one) => one.char.trim() !== "")
  const confidence = kept.reduce((sum, one) => sum + one.probability, 0) / Math.max(1, kept.length)
  const stepWidth = strip.padded / Math.max(1, steps)
  /** The picture-fraction box of the strip between two columns of the cut (in strip pixels). */
  const boxBetween = (from: number, to: number) => {
    const s0 = Math.max(0, Math.min(1, from / strip.width)), s1 = Math.max(0, Math.min(1, to / strip.width))
    const corners = [s0, s1].flatMap((s) => [0, 1].map((t) => ({
      x: strip.origin.x + strip.along.x * s + strip.across.x * t,
      y: strip.origin.y + strip.along.y * s + strip.across.y * t,
    })))
    const xs = corners.map((p) => Math.max(0, Math.min(pictureWidth, p.x)))
    const ys = corners.map((p) => Math.max(0, Math.min(pictureHeight, p.y)))
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x: x / pictureWidth, y: y / pictureHeight, width: (Math.max(...xs) - x) / pictureWidth, height: (Math.max(...ys) - y) / pictureHeight }
  }
  const words: BundledLine["words"] = []
  let current: Emitted[] = []
  const flush = () => {
    if (current.length === 0) return
    const from = current[0]!.first * stepWidth, to = (current[current.length - 1]!.last + 1) * stepWidth
    words.push({ text: current.map((one) => one.char).join(""), ...boxBetween(from - stepWidth / 2, to + stepWidth / 2) })
    current = []
  }
  for (const one of emitted) {
    if (one.char.trim() === "") flush()
    else current.push(one)
  }
  flush()
  return { text, confidence, ...boxBetween(0, strip.width), words }
}

/** Kana, kanji, half-width katakana: what says a reading is Japanese (textRecognition's `isJapaneseCode`). */
export const hasJapanese = (text: string): boolean => /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿ｦ-ﾝ]/.test(text)

/**
 * Which reading of a line to keep. The English recogniser reads English handwriting markedly better than the
 * multilingual one (measured, docs/OCR-BUNDLED.md), and reads Japanese as nothing, or as the digits beside it - with
 * confidence. So the multilingual reading is kept only when it found JAPANESE and is about as sure of itself as the
 * English one: the Mac's rule (`TextRecognition.readBest`: Japanese only when it found Japanese), line by line.
 */
export function pickReading(english: BundledLine | null, japanese: BundledLine | null): BundledLine | null {
  if (japanese && hasJapanese(japanese.text) && japanese.confidence >= (english?.confidence ?? 0) - 0.05) return japanese
  return english
}

async function recognise(engine: Engine, recogniser: Recogniser, strip: Strip, image: Rgba): Promise<BundledLine | null> {
  const { session, alphabet } = recogniser
  const out = await session.run({ [session.inputNames[0]!]: engine.tensor(strip.data, [1, 3, REC_HEIGHT, strip.padded]) })
  const probabilities = out[session.outputNames[0]!]!
  const [, steps, classes] = probabilities.dims as [number, number, number]
  if (classes !== alphabet.length) throw new Error(`the recogniser has ${classes} classes and its dictionary ${alphabet.length}`)
  const emitted = ctcDecode(probabilities.data as Float32Array, steps, classes, alphabet)
  return lineFrom(emitted, steps, strip, image.width, image.height)
}

// MARK: - The whole read

export interface Reading {
  lines: BundledLine[]
  /** Milliseconds spent in each half, for the diagnostics. */
  timing: { detect: number; recognise: number }
}

export interface ReadChoices {
  /** Ask the multilingual recogniser too (when the engine has one). False: English only, one pass a line. */
  japanese?: boolean
  /** Asked between steps; a stop throws an AbortError. */
  shouldStop?: () => boolean
}

/** Read one picture. */
export async function readPicture(engine: Engine, image: Rgba, tuning: ReadTuning = DEFAULT_TUNING,
  choices: ReadChoices = {}): Promise<Reading> {
  const { shouldStop } = choices
  const japanese = choices.japanese !== false ? engine.japanese : undefined
  const started = Date.now()
  const size = detectorSize(image.width, image.height, tuning)
  const input = engine.tensor(detectorInput(image, size), [1, 3, size.height, size.width])
  checkStop(shouldStop)
  const detOut = await engine.det.run({ [engine.det.inputNames[0]!]: input })
  checkStop(shouldStop)
  const map = detOut[engine.det.outputNames[0]!]!
  const [mapH, mapW] = [map.dims[2]!, map.dims[3]!]
  const scaleX = image.width / mapW, scaleY = image.height / mapH
  const boxes = linesInMap(map.data as Float32Array, mapW, mapH, tuning).map((box): LineBox => {
    // Back into picture pixels. The two scales are equal up to the rounding to 32, near enough for a box.
    const toPicture = (p: Point) => ({ x: p.x * scaleX, y: p.y * scaleY })
    const ends = [
      toPicture({ x: box.center.x - box.u.x * box.halfWidth, y: box.center.y - box.u.y * box.halfWidth }),
      toPicture({ x: box.center.x + box.u.x * box.halfWidth, y: box.center.y + box.u.y * box.halfWidth }),
    ]
    const sides = [
      toPicture({ x: box.center.x - box.v.x * box.halfHeight, y: box.center.y - box.v.y * box.halfHeight }),
      toPicture({ x: box.center.x + box.v.x * box.halfHeight, y: box.center.y + box.v.y * box.halfHeight }),
    ]
    const halfWidth = Math.hypot(ends[1]!.x - ends[0]!.x, ends[1]!.y - ends[0]!.y) / 2
    const halfHeight = Math.hypot(sides[1]!.x - sides[0]!.x, sides[1]!.y - sides[0]!.y) / 2
    const u = { x: (ends[1]!.x - ends[0]!.x) / (2 * halfWidth || 1), y: (ends[1]!.y - ends[0]!.y) / (2 * halfWidth || 1) }
    const v = { x: (sides[1]!.x - sides[0]!.x) / (2 * halfHeight || 1), y: (sides[1]!.y - sides[0]!.y) / (2 * halfHeight || 1) }
    return { center: toPicture(box.center), u, v, halfWidth, halfHeight, score: box.score }
  })
  const detect = Date.now() - started

  const lines: BundledLine[] = []
  for (const box of boxes) {
    checkStop(shouldStop)
    const strip = cutStrip(image, box)
    const english = await recognise(engine, engine.rec, strip, image)
    const line = japanese ? pickReading(english, await recognise(engine, japanese, strip, image)) : english
    if (line && line.confidence >= tuning.minConfidence) lines.push(line)
  }
  // Reading order: top to bottom, then left to right (textRecognition's tidyReading refines this into bands).
  lines.sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x)
  return { lines, timing: { detect, recognise: Date.now() - started - detect } }
}
