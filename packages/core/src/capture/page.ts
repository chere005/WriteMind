/**
 * A notebook page off the camera: where the page is in the frame, where a
 * box drawn on the video lands on it, what size the page comes out, and
 * where the capture goes on the drawing layer.
 *
 * Ported from the pure half of `WriteMind/Camera/NotebookCapture.swift`.
 * None of this is Apple's: the perspective maths is Heckbert's closed form
 * and the rest is arithmetic. What DOES need Vision on the Mac — finding
 * the page in the frame by itself, and reading handwriting — is asked for
 * through `Capabilities` and is not here.
 */

import type { Point, Rect } from "../drawing/shapes"
import type { Size } from "../drawing/geometry"

/** The four corners of the page, in image pixels, y UP. */
export interface Quad {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}

/**
 * A projective map from the unit square to a quad — the maths behind a
 * perspective correction, needed here to send points the OTHER way: a
 * section drawn on the camera picture has to find its place on the
 * squared-up page.
 */
export interface Homography {
  /** Row-major 3×3. */
  m: number[]
}

/**
 * (0,0) → topLeft, (1,0) → topRight, (1,1) → bottomRight, (0,1) →
 * bottomLeft: u runs across the page, v runs DOWN it.
 */
export function unitSquareTo(quad: Quad): Homography {
  const { x: x0, y: y0 } = quad.topLeft
  const { x: x1, y: y1 } = quad.topRight
  const { x: x2, y: y2 } = quad.bottomRight
  const { x: x3, y: y3 } = quad.bottomLeft
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // A parallelogram: plain affine.
    return { m: [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1] }
  }
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) <= 1e-12) return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
  const g = (dx3 * dy2 - dx2 * dy3) / det
  const h = (dx1 * dy3 - dx3 * dy1) / det
  return {
    m: [x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
      y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
      g, h, 1],
  }
}

export function applyHomography(homography: Homography, point: Point): Point {
  const m = homography.m
  const w = m[6]! * point.x + m[7]! * point.y + m[8]!
  if (Math.abs(w) <= 1e-12) return point
  return {
    x: (m[0]! * point.x + m[1]! * point.y + m[2]!) / w,
    y: (m[3]! * point.x + m[4]! * point.y + m[5]!) / w,
  }
}

export function invertHomography(homography: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = homography.m as [
    number, number, number, number, number, number, number, number, number]
  const cofA = e * i - f * h, cofB = -(d * i - f * g), cofC = d * h - e * g
  const det = a * cofA + b * cofB + c * cofC
  if (Math.abs(det) <= 1e-12) return homography
  const adjugate = [
    cofA, -(b * i - c * h), b * f - c * e,
    cofB, a * i - c * g, -(a * f - c * d),
    cofC, -(a * h - b * g), a * e - b * d,
  ]
  return { m: adjugate.map((value) => value / det) }
}

/** Where the camera picture sits in its pane: fitted whole, centred. */
export function displayedFrame(frame: Size, pane: Size): Rect {
  if (frame.width <= 0 || frame.height <= 0 || pane.width <= 0 || pane.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const scale = Math.min(pane.width / frame.width, pane.height / frame.height)
  const width = frame.width * scale, height = frame.height * scale
  return { x: (pane.width - width) / 2, y: (pane.height - height) / 2, width, height }
}

const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

/**
 * A rectangle drawn on the pane, as a fraction of the picture shown in it
 * (top-left origin), clipped to the picture; null when it misses it.
 */
export function regionOf(rect: Rect, frame: Size, pane: Size): Rect | null {
  const shown = displayedFrame(frame, pane)
  if (shown.width <= 0 || shown.height <= 0) return null
  const clipped = intersect(rect, shown)
  if (!clipped || clipped.width < 2 || clipped.height < 2) return null
  return {
    x: (clipped.x - shown.x) / shown.width,
    y: (clipped.y - shown.y) / shown.height,
    width: clipped.width / shown.width,
    height: clipped.height / shown.height,
  }
}

/**
 * Where a section of the camera picture lands on the normalised page: the
 * section's corners are taken through the page's perspective (or straight
 * across when no page was found and the frame stands in for one), past the
 * edge inset, and boxed. In page pixels, top-left origin, clipped to the
 * page; null when none of it is on the page.
 */
export function pageBox(options: {
  region: Rect
  quad: Quad | null
  frame: Rect
  inset: number
  pageSize: Size
}): Rect | null {
  const { region, quad, frame, inset, pageSize } = options
  const corners: Point[] = [
    { x: region.x, y: region.y },
    { x: region.x + region.width, y: region.y },
    { x: region.x + region.width, y: region.y + region.height },
    { x: region.x, y: region.y + region.height },
  ]
  let unit: Point[]
  if (quad) {
    const toSquare = invertHomography(unitSquareTo(quad))
    unit = corners.map((corner) => applyHomography(toSquare, {
      // A fraction of the upright frame, top-left origin → the frame's
      // own pixels, y up, which is where the quad lives.
      x: frame.x + corner.x * frame.width,
      y: frame.y + (1 - corner.y) * frame.height,
    }))
  } else {
    unit = corners
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of unit) {
    const u = (point.x - inset) / (1 - 2 * inset)
    const v = (point.y - inset) / (1 - 2 * inset)
    minX = Math.min(minX, u * pageSize.width)
    maxX = Math.max(maxX, u * pageSize.width)
    minY = Math.min(minY, v * pageSize.height)
    maxY = Math.max(maxY, v * pageSize.height)
  }
  const clipped = intersect(
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    { x: 0, y: 0, width: pageSize.width, height: pageSize.height })
  if (!clipped) return null
  const whole = {
    x: Math.floor(clipped.x), y: Math.floor(clipped.y),
    width: Math.ceil(clipped.x + clipped.width) - Math.floor(clipped.x),
    height: Math.ceil(clipped.y + clipped.height) - Math.floor(clipped.y),
  }
  return whole.width >= 2 && whole.height >= 2 ? whole : null
}

/**
 * EVERY CAPTURED PAGE IS THE SAME SIZE, BY MEMORY NOT BY MEASUREMENT.
 * Squaring a page up returns a rectangle whose proportions depend on how
 * the page was tilted towards the camera, so measuring each capture made
 * every page a slightly different size. The shape is learned from the first
 * page that was actually found; later pages within the tolerance are
 * resampled to exactly that, further off re-learns.
 */
export interface PageShape { ratio: number }

/** The short side, in pixels — enough for handwriting at 300dpi-ish. */
export const SHORT_SIDE = 1200
export const SHAPE_TOLERANCE = 0.12
/**
 * How much of each side of a found page is cut away before it is resampled:
 * the corners sit ON the page's edge, so the edge itself — its shadow, the
 * desk behind a curl — came in as a dark rim.
 */
export const EDGE_INSET = 0.025

export function resolveShape(measured: number, remembered: number | null): PageShape {
  const ratio = Math.max(1, measured)
  if (remembered !== null && remembered >= 1
    && Math.abs(ratio - remembered) / remembered <= SHAPE_TOLERANCE) {
    return { ratio: remembered }
  }
  return { ratio }
}

export function shapeSize(shape: PageShape, portrait: boolean): Size {
  const long = Math.round(SHORT_SIDE * shape.ratio)
  return portrait ? { width: SHORT_SIDE, height: long } : { width: long, height: SHORT_SIDE }
}

/** A page takes this much of the pane's shorter way. */
export const PAGE_FRACTION = 0.42

/**
 * Where a capture goes, as fractions of the pane. A whole page fits inside
 * `PAGE_FRACTION` of the pane either way; the writing off a page, or a
 * section of it, is placed at the scale the page would have had, WHERE IT
 * WAS ON THE PAGE — so two captures of the same notebook are the same size
 * on the pane and line up.
 */
export function placement(options: {
  frame: Rect
  pageSize: Size
  pane: Size
  nudge: number
}): { center: Point; width: number } {
  const { frame, pageSize, nudge } = options
  // A pane that has no size (the notes pane put away measures 0 x 0) would divide by zero and save NaN: it is
  // measured as the smallest pane there can be instead (the Mac's `paneSize` falls back to 900 x 600 below 40).
  const pane = { width: Math.max(1, options.pane.width), height: Math.max(1, options.pane.height) }
  const pageWidth = Math.min(
    pane.width * PAGE_FRACTION,
    pane.height * PAGE_FRACTION * pageSize.width / Math.max(1, pageSize.height))
  const scale = pageWidth / Math.max(1, pageSize.width)
  const dx = (frame.x + frame.width / 2 - pageSize.width / 2) * scale / pane.width
  const dy = (frame.y + frame.height / 2 - pageSize.height / 2) * scale / pane.height
  return {
    center: { x: 0.5 + nudge + dx, y: 0.5 + nudge + dy },
    width: frame.width * scale / pane.width,
  }
}

/**
 * Where a capture goes ON THE NOTE, as the centre of its picture in fractions of the pane (the layer
 * scrolls with the text, so y counts from the top of the DOCUMENT).
 *
 * `placement` says where a capture sat on the page it was taken from and how big it comes out - which
 * decides its SIZE and, when there is no caret to go by, its offset. Where it lands is the note's business
 * (the Mac's `placeCapture` / `placedCenter`):
 *   - one gap UNDER the caret's line and flush with the text, as a pasted picture lands - when that line is
 *     on screen;
 *   - otherwise the spot it had on the pane, carried down by how far the note is scrolled: the middle of
 *     what is on screen, never somewhere above or below the window (a capture that lands off screen looks
 *     like a capture that failed). The Mac goes under the caret whether or not the caret is in view; here a
 *     caret scrolled out of view does not send the picture out of view with it.
 * Two captures in a row do not land exactly on top of each other: `taken` are the centres already on the
 * page, and a landing within a hair of one steps along by `nudge` (diagonally).
 */
export function capturePlacedCentre(options: {
  /** The centre `placement` gave: fractions of the pane, as the capture sat on the pane. */
  center: Point
  /** Its width as a fraction of the pane's, and its height over its width. */
  width: number
  aspect: number
  pane: Size
  /** How far the note is scrolled, in points. */
  scroll: number
  /** The caret's line in document points, when the editor has one. */
  caretLine?: Rect | null
  gap?: number
  taken?: Point[]
  nudge?: number
}): Point {
  const { pane, scroll } = options
  const paneWidth = Math.max(pane.width, 1), paneHeight = Math.max(pane.height, 1)
  const width = options.width * paneWidth
  const height = width * options.aspect
  const gap = options.gap ?? 8
  const line = options.caretLine ?? null
  let centre: Point
  const lineOnScreen = line !== null && line.y + line.height >= scroll && line.y <= scroll + pane.height
  if (line && lineOnScreen) {
    const x = Math.min(line.x + width / 2, Math.max(width / 2, paneWidth - width / 2))
    const y = line.y + line.height + gap + height / 2
    centre = { x: x / paneWidth, y: y / paneHeight }
  } else {
    centre = { x: options.center.x, y: options.center.y + scroll / paneHeight }
  }
  const step = options.nudge ?? 0.03
  for (let tries = 0; tries < 6; tries++) {
    const here = centre
    if (!(options.taken ?? []).some((one) => Math.abs(one.x - here.x) < 0.01 && Math.abs(one.y - here.y) < 0.01)) break
    centre = { x: centre.x + step, y: centre.y + step }
  }
  return centre
}

/**
 * Where the words read out of a picture go in the note: in front of the first line that starts at or below the
 * picture's bottom edge `y` (the Mac's `EditorBridge.insert(_:belowDocumentY:)`), or at the very end when none does.
 * `block` is the editor's line at height `y` - what `view.lineBlockAtHeight(y)` gives (its offsets and its top and
 * bottom in document points) - or null for an empty note. The nearest line may be the one ABOVE the picture,
 * ending before `y`; the words then go on the line after that one.
 */
export function insertionPointBelow(block: { from: number; to: number; bottom: number } | null, y: number,
  documentLength: number): number {
  if (!block || documentLength <= 0) return Math.max(0, documentLength)
  if (block.bottom <= y + 0.5) return Math.min(block.to + 1, documentLength)
  return Math.min(block.from, documentLength)
}
