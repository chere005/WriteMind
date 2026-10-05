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

import { rotateSheetPoint } from "../shared/orientation"
import { newID, noTransform, pressureScale, type CanvasItem, type Point, type Rect, type Size } from "@writemind/core"

/**
 * The sheet is resolution-independent. Points are fractions of the sheet and
 * widths are in REFERENCE UNITS: the sheet is `SHEET_REF` units wide whatever
 * its size on screen (a 500 px pane, a 1920 px overlay), so a stroke
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
/**
 * One change to the sheet, so that two views of it (the notes window and the
 * grab overlay) can keep the same strokes AND the same undo history by
 * replaying the same operations in the same order.
 */
export interface SheetState { strokes: InkStroke[]; past: InkStroke[][]; future: InkStroke[][] }

export type SheetOp =
  | { op: "mark" }
  | { op: "add"; stroke: InkStroke }
  | { op: "replace"; strokes: InkStroke[] }
  | { op: "removeAt"; index: number }
  | { op: "undo" }
  | { op: "redo" }

export class TabletPage {
  /**
   * Width over height of the sheet. The sheet has the SCREEN's shape turned by
   * the tablet's orientation (a driver in Pen mode maps the whole tablet to the
   * whole screen, so that is the shape of the tablet as seen through the pen),
   * and every view of it — the pane and the grab overlay —
   * fits that shape inside itself. Strokes are fractions of the sheet, so
   * changing the shape never destroys ink: it only changes the page shape the
   * next capture is made on (rotate the ink with `rotateInk` if it should turn).
   */
  aspect: number
  strokes: InkStroke[] = []
  private past: InkStroke[][] = []
  private future: InkStroke[][] = []
  private opListeners = new Set<(op: SheetOp) => void>()
  private changeListeners = new Set<() => void>()
  private applying = false

  constructor(aspect = 16 / 9) { this.aspect = aspect > 0.2 && aspect < 5 ? aspect : 16 / 9 }

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }

  /** Hear every change as an operation (not the ones this page is told to apply). */
  onOp(listener: (op: SheetOp) => void): () => void {
    this.opListeners.add(listener)
    return () => { this.opListeners.delete(listener) }
  }
  /** Hear that anything changed: strokes, history or shape. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }
  private emit(op: SheetOp | null): void {
    if (op && !this.applying) this.opListeners.forEach((listener) => listener(op))
    this.changeListeners.forEach((listener) => listener())
  }

  setAspect(aspect: number): void {
    const next = aspect > 0.2 && aspect < 5 ? aspect : 16 / 9
    if (Math.abs(next - this.aspect) < 1e-9) return
    this.aspect = next
    this.emit(null)
  }

  /** Turn every stroke a quarter turn clockwise in place (the "Rotate ink" button). */
  rotateInk(by: 1 | 2 | 3): void {
    const turn = (p: Point): Point => rotateSheetPoint(p, by)
    this.replace(this.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map(turn) })))
  }

  /** A change is about to be made: this is what Undo returns to. */
  mark(): void {
    this.past.push(this.strokes)
    if (this.past.length > 100) this.past.shift()
    this.future = []
    this.emit({ op: "mark" })
  }

  private silently(fn: () => void): void {
    const was = this.applying
    this.applying = true
    try { fn() } finally { this.applying = was }
  }

  add(stroke: InkStroke): void {
    this.silently(() => this.mark())
    this.strokes = [...this.strokes, stroke]
    this.emit({ op: "add", stroke })
  }
  /** Replace the strokes as ONE undo (a clear, a capture's removal). */
  replace(next: InkStroke[]): void {
    this.silently(() => this.mark())
    this.strokes = next
    this.emit({ op: "replace", strokes: next })
  }
  clear(): void { if (this.strokes.length > 0) this.replace([]) }
  /** Remove one stroke WITHOUT marking: an erase gesture marks once, at its first hit. */
  removeAt(index: number): void {
    this.strokes = this.strokes.filter((_, i) => i !== index)
    this.emit({ op: "removeAt", index })
  }

  undo(): boolean {
    const back = this.past.pop()
    if (!back) return false
    this.future.push(this.strokes)
    this.strokes = back
    this.emit({ op: "undo" })
    return true
  }

  redo(): boolean {
    const forward = this.future.pop()
    if (!forward) return false
    this.past.push(this.strokes)
    this.strokes = forward
    this.emit({ op: "redo" })
    return true
  }

  /** Do what another view of the sheet did. Not announced again. */
  apply(op: SheetOp): void {
    this.silently(() => {
      switch (op.op) {
        case "mark": this.mark(); break
        case "add": this.add(op.stroke); break
        case "replace": this.replace(op.strokes); break
        case "removeAt": this.removeAt(op.index); break
        case "undo": this.undo(); break
        case "redo": this.redo(); break
      }
    })
  }

  /** The whole state INCLUDING history, to bring another view into step (it is cloned in one piece, so shared strokes stay shared). */
  exportState(): SheetState { return { strokes: this.strokes, past: this.past, future: this.future } }
  importState(state: SheetState): void {
    this.strokes = state.strokes
    this.past = state.past
    this.future = state.future
    this.emit(null)
  }
}


// MARK: - The sheet's geometry (no React, no DOM, so it can be tested with numbers)
//
// THE DRIVER OWNS THE MAPPING. A Wacom tablet in Pen mode is mapped by its
// driver to the whole screen (or to the portion of it the person chose in
// Wacom Tablet Properties > Mapping): the pen's absolute position on the
// tablet becomes an absolute position on the screen. An app cannot change
// that. What it CAN do is make the part of the screen the driver maps to be
// the sheet:
//
//  - GRAB: a transparent overlay over the display receives the pen wherever it
//    is, and the pen's place on the display becomes a place on the sheet.
//  - TABLET AREA: the sheet is a rectangle on the screen, and this says exactly
//    which one, in physical pixels, so it can be given to the driver.
//
// (There is no full-screen mode: the app never enters full screen.)

/** The largest rectangle of shape `aspect` (width over height) that fits in `container`, centred. */
export function fitRect(container: Size, aspect: number): Rect {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) {
    return { x: 0, y: 0, width: Math.max(0, container.width), height: Math.max(0, container.height) }
  }
  let width = container.width, height = width / aspect
  if (height > container.height) { height = container.height; width = height * aspect }
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height }
}

/** The sheet's shape from a screen's size, or `fallback` when the size is unusable. */
export function aspectOf(width: number, height: number, fallback = 16 / 9): number {
  return width > 0 && height > 0 && width / height > 0.2 && width / height < 5 ? width / height : fallback
}

/** The shape the sheet takes on this machine: the screen's (or a number kept for testing). */
export function screenAspect(): number {
  try {
    const kept = Number(localStorage.getItem("writemind.sheetAspect"))
    if (kept > 0.2 && kept < 5) return kept
  } catch { /* no storage */ }
  return typeof window === "undefined" ? 16 / 9 : aspectOf(window.screen.width, window.screen.height)
}

/** Where the window is on the desktop, as the shell reports it (device-independent pixels). */
export interface DisplayInfo {
  /** The window's content area. */
  content: Rect
  /** The display the window is on. */
  display: Rect
  /** Physical pixels per device-independent pixel on that display (1.5 at 150%). */
  scale: number
}

/** A rectangle in the physical pixels of one display, origin at that display's top-left. */
export interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
  /** Opposite corner, inclusive of the rectangle (what the second click of 'Click to define' lands on). */
  right: number
  bottom: number
  /** The display's own size in physical pixels. */
  screenWidth: number
  screenHeight: number
}

/**
 * The sheet's rectangle on the display, in PHYSICAL pixels. `inWindow` is the
 * sheet's getBoundingClientRect (CSS pixels from the page's top-left);
 * `info` is where the page itself is on the desktop. A page's CSS pixel is
 * a device-independent one, so the conversion to physical is the display's
 * scale — which is what makes the answer right at 150% and on a second monitor.
 */
export function physicalRect(inWindow: Rect, info: DisplayInfo): PhysicalRect {
  const left = info.content.x - info.display.x + inWindow.x
  const top = info.content.y - info.display.y + inWindow.y
  const x = Math.round(left * info.scale), y = Math.round(top * info.scale)
  const width = Math.round(inWindow.width * info.scale), height = Math.round(inWindow.height * info.scale)
  return {
    x, y, width, height, right: x + width - 1, bottom: y + height - 1,
    screenWidth: Math.round(info.display.width * info.scale), screenHeight: Math.round(info.display.height * info.scale),
  }
}

/**
 * Without the shell's answer (a browser, a test) the window's own numbers
 * will do: `screenX/Y` are the window's outer corner and `devicePixelRatio`
 * the scale. Less exact — the frame's thickness is guessed from the
 * outer/inner difference — but never missing.
 */
export function fallbackInfo(win: {
  screenX: number; screenY: number; outerWidth: number; outerHeight: number
  innerWidth: number; innerHeight: number; devicePixelRatio: number
  screen: { width: number; height: number }
}): DisplayInfo {
  const side = Math.max(0, (win.outerWidth - win.innerWidth) / 2)
  const top = Math.max(0, win.outerHeight - win.innerHeight - side)
  return {
    content: { x: win.screenX + side, y: win.screenY + top, width: win.innerWidth, height: win.innerHeight },
    display: { x: 0, y: 0, width: win.screen.width, height: win.screen.height },
    scale: win.devicePixelRatio || 1,
  }
}

/** A line a person can read: "x 1,234 y 56 to x 2,000 y 480 (766 × 424 px)". */
export function describeArea(area: PhysicalRect): string {
  const n = (value: number) => value.toLocaleString("en-US")
  return `x ${n(area.x)}, y ${n(area.y)}  to  x ${n(area.right)}, y ${n(area.bottom)}  (${n(area.width)} × ${n(area.height)} px of ${n(area.screenWidth)} × ${n(area.screenHeight)})`
}

/** A pen hovering within this many pixels of the sheet's top edge brings the Grab strip down. */
export const STRIP_EDGE = 28

/**
 * Whether Grab's top strip should be showing. It comes down when the pen
 * (or pointer) is at the top edge or over the strip itself, stays while a
 * pointer is on it, and goes away on its own a moment after the pointer
 * leaves — and never while a stroke is being written.
 */
export function stripWanted(state: {
  y: number | null
  overStrip: boolean
  writing: boolean
  pinned: boolean
  sinceLeft: number
  hideAfter?: number
}): boolean {
  if (state.writing) return false
  if (state.pinned || state.overStrip) return true
  if (state.y !== null && state.y <= STRIP_EDGE) return true
  return state.sinceLeft < (state.hideAfter ?? 1800)
}
