/**
 * How the tablet is turned relative to the screen, as pure arithmetic (no DOM,
 * no Electron) so main, the page and the tests all use the same numbers.
 *
 * THE DRIVER MAPS THE WHOLE TABLET TO THE WHOLE SCREEN, absolutely. If the
 * tablet is physically turned a quarter turn (a landscape Intuos used as a
 * portrait pad), a stroke the person draws "up" on it arrives as a stroke
 * across the screen. The ORIENTATION says how the tablet is turned, in
 * Wacom's own words, and the sheet (the paper the person sees) is the tablet
 * as the person sees it, so a screen point is turned back into a sheet point.
 *
 *   0  Landscape               the tablet is as the screen is
 *   1  Portrait                turned 90 degrees clockwise
 *   2  Landscape (flipped)     turned 180 degrees
 *   3  Portrait (flipped)      turned 270 degrees clockwise
 *
 * Landscape (0) is the default: the sheet is the tablet as it lies on the
 * desk (main/pen/frame.ts gives the device's own frame), and the person's
 * choice here is the ONLY thing that turns it. Nothing is calibrated.
 *
 * Points are fractions 0..1 with a top-left origin.
 */

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

/** Quarter turns clockwise. */
export type Turns = 0 | 1 | 2 | 3
export type Orientation = Turns

export const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 0, label: "Landscape" },
  { value: 2, label: "Landscape (flipped)" },
  { value: 1, label: "Portrait" },
  { value: 3, label: "Portrait (flipped)" },
]

export const turnsOf = (orientation: Orientation): Turns => orientation

/** The stored string back to an orientation; anything unknown (an old "match" too) is Landscape. */
export function parseOrientation(raw: unknown): Orientation {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : 0
}

/** Whether the sheet is portrait for the given display shape (width over height). */
export const sheetAspectFor = (screenAspect: number, turns: Turns): number =>
  turns % 2 === 1 ? 1 / screenAspect : screenAspect

/** A screen point (fractions of the display) as a point on the sheet the person sees. */
export function screenToSheet(p: Pt, turns: Turns): Pt {
  switch (turns) {
    case 0: return { x: p.x, y: p.y }
    case 1: return { x: 1 - p.y, y: p.x }
    case 2: return { x: 1 - p.x, y: 1 - p.y }
    default: return { x: p.y, y: 1 - p.x }
  }
}

/** The inverse: a sheet point, and where on the display the driver puts the pen for it. */
export function sheetToScreen(p: Pt, turns: Turns): Pt {
  switch (turns) {
    case 0: return { x: p.x, y: p.y }
    case 1: return { x: p.y, y: 1 - p.x }
    case 2: return { x: 1 - p.x, y: 1 - p.y }
    default: return { x: 1 - p.y, y: p.x }
  }
}

/** Turn a sheet point by `by` quarter turns clockwise inside the same square unit (for "Rotate ink"). */
export function rotateSheetPoint(p: Pt, by: Turns): Pt {
  switch (by) {
    case 0: return { x: p.x, y: p.y }
    case 1: return { x: 1 - p.y, y: p.x }
    case 2: return { x: 1 - p.x, y: 1 - p.y }
    default: return { x: p.y, y: 1 - p.x }
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Where on the display (0..1) a pointer is, from its client position inside a
 * window that covers the display. The first and last PHYSICAL pixel are the
 * tablet's edges, so the corners land on 0 and 1 exactly, at any scale.
 */
export function displayFraction(client: Pt, window: { width: number; height: number }, dpr = 1): Pt {
  const w = Math.max(1, window.width * dpr - 1), h = Math.max(1, window.height * dpr - 1)
  return { x: clamp01(client.x * dpr / w), y: clamp01(client.y * dpr / h) }
}

/** A pointer on the display, to a point on the sheet through the tablet's orientation. */
export const tabletToSheet = (fraction: Pt, turns: Turns): Pt => screenToSheet(fraction, turns)

/** The sheet point, as a pixel inside a rectangle that is the sheet. */
export const sheetPixel = (p: Pt, rect: Box): Pt =>
  ({ x: rect.x + p.x * rect.width, y: rect.y + p.y * rect.height })
