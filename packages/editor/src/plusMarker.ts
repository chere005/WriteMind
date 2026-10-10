/**
 * The + at a seam, in the page's own left margin (docs/PLAN-bars-2026-10.md (b); the wireframe, docs/ui-2026-10/
 * FinalMain.png): a small round marker beside the line between two cells, drawn in the gap and never over a cell's
 * text, with a 24 px hit target (a small control is hard to hit exactly). The Mac drew a ten-point dot ON the seam and
 * clipped what it answered for to the seam's own height (core `plusTarget`: "a hand five points up in the cell above
 * would promise a press that never arrives"); here the marker stands in the margin, where there is no text to promise
 * anything about, so the target is the whole square round it. Pure, so the geometry has a test.
 */

import { PAGE_LEFT } from "./theme"

/** The marker itself, a filled circle. */
export const PLUS_DIAMETER = 20
/** What a press on it reaches. */
export const PLUS_HIT = 24
/** Its centre across the page: the middle of the left margin, clear of the words that start at `PAGE_LEFT`. */
export const PLUS_CENTRE_X = PAGE_LEFT / 2

export interface PlusBox { x: number; y: number; width: number; height: number }

const square = (line: number, side: number): PlusBox =>
  ({ x: PLUS_CENTRE_X - side / 2, y: line - side / 2, width: side, height: side })

/** The drawn marker on a seam whose bar is at `line` (the seam's own coordinates). */
export const plusMarker = (line: number): PlusBox => square(line, PLUS_DIAMETER)

/** What answers a press for the marker on `line`. */
export const plusHit = (line: number): PlusBox => square(line, PLUS_HIT)

/** Whether the point (x, y) of the page is on the marker's hit target. Inclusive on all four edges. */
export function onPlusMarker(x: number, y: number, line: number): boolean {
  const box = plusHit(line)
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
}
