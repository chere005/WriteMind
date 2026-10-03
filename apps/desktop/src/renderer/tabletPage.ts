/**
 * The tablet as a SOURCE for the video pane: a sheet of paper written on with
 * the pen, in place of a page under a document camera. No React, no DOM, so
 * the geometry can be tested with strokes drawn by hand.
 *
 * Why strokes and not pixels. A camera has only pixels, so the Writing button
 * lifts ink off the paper (threshold, components) and what lands is a
 * picture. The tablet KNOWS the ink — every point and its pressure — so
 * Writing brings in the real stroke items, placed exactly where the box was,
 * at the scale a page would have had; nothing is re-traced and a pen stroke
 * stays a pen stroke (editable, erasable, recoloured). The raster path
 * (`paintStrokes` onto a canvas) exists for the two readers that want pixels:
 * the flow-chart reader and the OCR on the Page picture. Everything between
 * the box and the placement is the camera's own arithmetic in the core
 * (`regionOf`, `resolveShape`, `shapeSize`, `placement`).
 */

import { newID, noTransform, pressureScale, type CanvasItem, type Point, type Rect, type Size } from "@writemind/core"

/**
 * The sheet is resolution-independent. Points are fractions of the sheet and
 * widths are in REFERENCE UNITS: the sheet is `SHEET_REF` units wide whatever
 * its size on screen (a 500 px pane, a 1920 px full-screen pad), so a stroke
 * drawn on one looks the same on the other and lands in the note the same.
 */
export const SHEET_REF = 1000

/** One stroke on the sheet: points are FRACTIONS of the sheet (0…1, top-left origin). */
export interface InkStroke {
  colorHex: string
  /** The pen's width in sheet reference units (`SHEET_REF` across) at half pressure. */
  width: number
  points: Point[]
  /** 0…1, one per point; absent for the mouse. */
  pressures?: number[]
}

/** Distance from a point to a segment. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * The topmost stroke within `radius` sheet points of `point` (a fraction of
 * the sheet), or -1. The eraser rubs out WHOLE strokes, as `Canvas.eraseAt`.
 */
export function strokeUnder(strokes: InkStroke[], point: Point, size: Size, radius: number,
  /** Pixels per reference unit, to turn a stroke's width into pixels. */
  unit = 1): number {
  const at = { x: point.x * size.width, y: point.y * size.height }
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index]!
    const reach = radius + stroke.width * unit / 2
    const px = stroke.points.map((one) => ({ x: one.x * size.width, y: one.y * size.height }))
    if (px.length === 1 && Math.hypot(at.x - px[0]!.x, at.y - px[0]!.y) <= reach) return index
    for (let i = 1; i < px.length; i++) {
      if (distanceToSegment(at, px[i - 1]!, px[i]!) <= reach) return index
    }
  }
  return -1
}

const inside = (point: Point, region: Rect): boolean =>
  point.x >= region.x && point.x <= region.x + region.width
  && point.y >= region.y && point.y <= region.y + region.height

/**
 * The parts of the strokes inside `region` (fractions of the sheet) and the
 * parts outside it. A stroke that crosses the edge is cut where its points
 * leave: the box brings in the section of the writing that is in it.
 */
export function splitByRegion(strokes: InkStroke[], region: Rect): { inside: InkStroke[]; outside: InkStroke[] } {
  const kept: InkStroke[] = [], left: InkStroke[] = []
  for (const stroke of strokes) {
    let run: number[] = []
    let runIn = false
    const flush = () => {
      if (run.length === 0) return
      const part: InkStroke = {
        colorHex: stroke.colorHex, width: stroke.width,
        points: run.map((i) => stroke.points[i]!),
        ...(stroke.pressures ? { pressures: run.map((i) => stroke.pressures![i]!) } : {}),
      }
      ;(runIn ? kept : left).push(part)
      run = []
    }
    stroke.points.forEach((point, i) => {
      const here = inside(point, region)
      if (run.length > 0 && here !== runIn) {
        flush()
      }
      runIn = here
      run.push(i)
    })
    flush()
  }
  return { inside: kept, outside: left }
}

/** The ink's own box in fractions of the sheet, or null for no ink. */
export function inkExtent(strokes: InkStroke[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x)
      y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y)
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * Strokes drawn on a canvas. `toPixel` maps a point (fraction of the sheet) to
 * canvas pixels; `scale` is canvas pixels per sheet point, for the widths.
 * `colour` overrides every stroke's colour (the reader wants black on white).
 */
export function paintStrokes(context: CanvasRenderingContext2D, strokes: InkStroke[],
  toPixel: (point: Point) => Point, scale: number, colour?: string, from = 0): void {
  context.lineCap = "round"
  context.lineJoin = "round"
  for (const stroke of strokes) {
    const points = stroke.points.map(toPixel)
    if (points.length === 0) continue
    context.strokeStyle = colour ?? stroke.colorHex
    const pressures = stroke.pressures
    if (points.length === 1) {
      context.lineWidth = Math.max(0.5, stroke.width * scale)
      context.beginPath()
      context.moveTo(points[0]!.x, points[0]!.y)
      context.lineTo(points[0]!.x + 0.01, points[0]!.y)
      context.stroke()
      continue
    }
    if (pressures && pressures.length === points.length) {
      // Each segment at the mean of its ends' pressure, as the notes page paints a pen stroke.
      for (let i = Math.max(1, from); i < points.length; i++) {
        context.lineWidth = Math.max(0.25,
          stroke.width * scale * pressureScale((pressures[i - 1]! + pressures[i]!) / 2))
        context.beginPath()
        context.moveTo(points[i - 1]!.x, points[i - 1]!.y)
        context.lineTo(points[i]!.x, points[i]!.y)
        context.stroke()
      }
      continue
    }
    context.lineWidth = Math.max(0.5, stroke.width * scale)
    context.beginPath()
    context.moveTo(points[Math.max(0, from - 1)]!.x, points[Math.max(0, from - 1)]!.y)
    for (let i = Math.max(1, from); i < points.length; i++) context.lineTo(points[i]!.x, points[i]!.y)
    context.stroke()
  }
}

/**
 * Strokes (fractions of the sheet) as note items, landed on the pane.
 *
 * `frame` is the box on the page, in page pixels, that `where` (from the
 * core's `placement`) put on the pane; a point is carried from the sheet to
 * the page (`pageSize`) and from there to the pane at the same scale the
 * frame was placed at, so the ink sits where it was on the sheet and a
 * pen's width shrinks with it.
 */
export function landStrokes(strokes: InkStroke[], options: {
  surface: Size
  pageSize: Size
  frame: Rect
  where: { center: Point; width: number }
  pane: Size
}): CanvasItem[] {
  const { surface, pageSize, frame, where, pane } = options
  const toPane = where.width * pane.width / Math.max(1, frame.width)
  const widthScale = pageSize.width / Math.max(1, surface.width) * toPane
  const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2
  return strokes.map((stroke): CanvasItem => ({
    kind: "stroke",
    stroke: {
      id: newID(),
      colorHex: stroke.colorHex,
      width: Math.max(1, stroke.width * widthScale),
      points: stroke.points.map((point) => ({
        x: where.center.x + (point.x * pageSize.width - cx) * toPane / pane.width,
        y: where.center.y + (point.y * pageSize.height - cy) * toPane / pane.height,
      })),
      ...(stroke.pressures ? { pressures: [...stroke.pressures] } : {}),
      transform: noTransform(),
      group: null,
    },
  }))
}

/**
 * The sheet's memory: strokes and an undo stack of whole stroke lists (the
 * lists are never mutated, so a snapshot is a pointer). Kept at module level
 * by the pane so that putting the video away and bringing it back does not
 * wipe the page.
 */
export class TabletPage {
  /**
   * Width over height of the sheet. The sheet has the SCREEN's shape (a
   * driver in Pen mode maps the whole tablet to the whole screen, so that is
   * the shape of the tablet as seen through the pen), and every view of it —
   * the pane, the full-screen pad — fits that shape inside itself.
   */
  readonly aspect: number
  strokes: InkStroke[] = []
  private past: InkStroke[][] = []
  private future: InkStroke[][] = []

  constructor(aspect = 16 / 9) { this.aspect = aspect > 0.2 && aspect < 5 ? aspect : 16 / 9 }

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }

  /** A change is about to be made: this is what Undo returns to. */
  mark(): void {
    this.past.push(this.strokes)
    if (this.past.length > 100) this.past.shift()
    this.future = []
  }

  add(stroke: InkStroke): void { this.mark(); this.strokes = [...this.strokes, stroke] }
  /** Replace the strokes as ONE undo (a clear, a capture's removal). */
  replace(next: InkStroke[]): void { this.mark(); this.strokes = next }
  clear(): void { if (this.strokes.length > 0) this.replace([]) }
  /** Remove one stroke WITHOUT marking: an erase gesture marks once, at its first hit. */
  removeAt(index: number): void { this.strokes = this.strokes.filter((_, i) => i !== index) }

  undo(): boolean {
    const back = this.past.pop()
    if (!back) return false
    this.future.push(this.strokes)
    this.strokes = back
    return true
  }

  redo(): boolean {
    const forward = this.future.pop()
    if (!forward) return false
    this.past.push(this.strokes)
    this.strokes = forward
    return true
  }
}
