/**
 * The row of buttons under the tablet sheet's dashed box (BoxActions.tsx): Erase, Bring in Writing, Bring in as
 * Drawing Cell (Sean, 2026-10-05: "under the selection box, have buttons for erase selection, bring in writing, bring
 * in writing (straight to a docked drawing cell at or after the input cursor"). Pure: where the row goes, and what
 * Erase leaves on the sheet. test/boxActions.test.ts holds the rules.
 */

import type { Rect, Size } from "@writemind/core"
import { splitByRegion, type InkStroke } from "./tabletPage"

/** Room between the box's edge and the row, and between the row and the sheet's edge, in px. */
export const ROW_GAP = 6

/** Where the row goes, in px of the sheet (top-left of the row); `side` says whether it is under, over or inside the box. */
export interface RowPlace { left: number; top: number; side: "below" | "above" | "inside" }

/**
 * The row's place: centred under the box; ABOVE it when there is no room under it; when there is room on neither side
 * on the sheet (a box as tall as the sheet: a double-click boxes it all), just under the sheet or just over it, in the
 * pane's margin round the sheet (`room`, px), never on the box; and only when the pane has no margin either, inside
 * the box along its bottom edge. Kept on the sheet across.
 * `box` is in FRACTIONS of the sheet, `sheet` the sheet's size on screen, `row` the row's own size (px).
 */
export function placeRow(box: Rect, sheet: Size, row: Size, gap = ROW_GAP,
  room: { above: number; below: number } = { above: 0, below: 0 }): RowPlace {
  const x = box.x * sheet.width, y = box.y * sheet.height
  const w = box.width * sheet.width, h = box.height * sheet.height
  const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))
  const left = clamp(x + w / 2 - row.width / 2, gap, Math.max(gap, sheet.width - gap - row.width))
  const below = y + h + gap
  if (below + row.height <= sheet.height - gap / 2) return { left, top: below, side: "below" }
  const above = y - gap - row.height
  if (above >= gap / 2) return { left, top: above, side: "above" }
  // Off the sheet, in the pane's margin under it (or over it): the box reaches the sheet's edge there.
  if (y + h >= sheet.height - gap && room.below >= gap + row.height) return { left, top: sheet.height + gap, side: "below" }
  if (y <= gap && room.above >= gap + row.height) return { left, top: -gap - row.height, side: "above" }
  // Neither: inside the box, on its bottom edge (and never off the sheet).
  const inside = clamp(y + h - gap - row.height, gap, Math.max(gap, sheet.height - gap - row.height))
  return { left, top: inside, side: "inside" }
}

const within = (point: { x: number; y: number }, region: Rect): boolean =>
  point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height

/**
 * The sheet's strokes with what is inside `region` (fractions of the sheet) rubbed out, by the SAME rule as the box's
 * Writing capture (`splitByRegion`): a stroke wholly inside goes, one that crosses the box's edge keeps its parts
 * outside it, and a stroke the box does not touch is kept AS IT IS (the same object, so a sheet bound to a drawing cell
 * keeps its link to the cell's item). `removed` counts the strokes the box touched (0: nothing to erase).
 */
export function eraseRegion(strokes: InkStroke[], region: Rect): { strokes: InkStroke[]; removed: number } {
  const out: InkStroke[] = []
  let removed = 0
  for (const stroke of strokes) {
    const inside = stroke.points.filter((point) => within(point, region)).length
    if (inside === 0) { out.push(stroke); continue }
    removed++
    if (inside === stroke.points.length) continue
    out.push(...splitByRegion([stroke], region).outside)
  }
  return { strokes: removed === 0 ? strokes : out, removed }
}
