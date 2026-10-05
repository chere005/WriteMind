/**
 * reachGeometry.ts - the pure half of the REACH HINT (docs/spikes/DESIGN-pen-capture.md 7.7; SheetReach.tsx draws it).
 *
 * The tablet maps to the whole display, but the notes window usually covers only part of it (Sean's saved window is 1280 x 800 on a 1920 x 1200
 * display: about two thirds each way). A pen over the rest of the tablet is over the desktop or another program, so a tap there clicks
 * THAT. The hint hatches that part of the sheet so the person can see where the pen stops being theirs. It is advice drawn on the sheet:
 * nothing is blocked by it.
 *
 * All rectangles are fractions of the DISPLAY in the screen frame (0..1, y down); `reachRects` turns the complement of the allowed one into
 * rectangles on the SHEET, as the person sees it (fractions of the sheet), through the person's orientation.
 */

import { screenToSheet, type Turns } from "../shared/orientation"

export interface Rect01 { x0: number; y0: number; x1: number; y1: number }

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const EPS = 0.004

/** A rectangle with its corners in order and inside 0..1, or null when it is empty, not a number, or the whole display. */
export function normalise(r: Rect01 | null | undefined): Rect01 | null {
  if (!r) return null
  const x0 = clamp01(Math.min(r.x0, r.x1)), x1 = clamp01(Math.max(r.x0, r.x1))
  const y0 = clamp01(Math.min(r.y0, r.y1)), y1 = clamp01(Math.max(r.y0, r.y1))
  if (![r.x0, r.x1, r.y0, r.y1].every(Number.isFinite)) return null
  if (x1 - x0 < EPS || y1 - y0 < EPS) return null
  return { x0, y0, x1, y1 }
}

/** The four bands of the display outside `allowed`, in the screen frame (empty bands left out). */
export function outsideBands(allowed: Rect01): Rect01[] {
  const a = allowed
  const bands: Rect01[] = [
    { x0: 0, y0: 0, x1: 1, y1: a.y0 },       // above
    { x0: 0, y0: a.y1, x1: 1, y1: 1 },       // below
    { x0: 0, y0: a.y0, x1: a.x0, y1: a.y1 }, // left of
    { x0: a.x1, y0: a.y0, x1: 1, y1: a.y1 }, // right of
  ]
  return bands.filter((b) => b.x1 - b.x0 >= EPS && b.y1 - b.y0 >= EPS)
}

/** A screen-frame rectangle as the rectangle it is on the sheet (a quarter turn swaps the axes; a rectangle stays a rectangle). */
export function toSheetRect(r: Rect01, turns: Turns): Rect01 {
  const a = screenToSheet({ x: r.x0, y: r.y0 }, turns)
  const b = screenToSheet({ x: r.x1, y: r.y1 }, turns)
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
}

export interface ReachInput {
  /** The window's content rectangle as fractions of its display (the `dom` backend's `cover.*` facts). */
  cover: Rect01 | null
  /** The display's work area (without the taskbar) as fractions of the display (`work.*`). */
  work: Rect01 | null
  turns: Turns
  /** The pen sink is armed and effective: only what lies outside the work area (the taskbar band) is then reachable by a stray tap. */
  containedBySink: boolean
}

/** Which rectangle the pen is confined to for the hint: the sink makes the whole work area the pen's, otherwise only the window. */
export function allowedRect(input: Pick<ReachInput, "cover" | "work" | "containedBySink">): Rect01 | null {
  return normalise(input.containedBySink ? input.work : input.cover)
}

/** The hatched rectangles, in fractions of the sheet. Empty = no hint (no geometry, or the whole display is allowed). */
export function reachRects(input: ReachInput): Rect01[] {
  const allowed = allowedRect(input)
  if (!allowed) return []
  return outsideBands(allowed).map((b) => toSheetRect(b, input.turns))
}

/** The share of the tablet the window covers, for the chip's words ("reaches 62% of the tablet"): the smaller of the two axes. */
export function reachShare(cover: Rect01 | null): number | null {
  const c = normalise(cover)
  return c ? Math.min(c.x1 - c.x0, c.y1 - c.y0) : null
}
