/**
 * The row of buttons under the tablet sheet's dashed box (BoxActions.tsx): Erase, Bring in Writing, Bring in as
 * Drawing Cell (Sean, 2026-10-05: "under the selection box, have buttons for erase selection, bring in writing, bring
 * in writing (straight to a docked drawing cell at or after the input cursor"). Pure: where the row goes, what
 * Erase leaves on the sheet, when a press begun on the row is the sheet's, and the cell Bring in as Drawing Cell makes.
 * test/boxActions.test.ts and test/boxRowHandover.test.ts hold the rules.
 */

import { INK_MIN_HEIGHT, newID, placement, type CanvasItem, type InkCell, type Point, type Rect, type Size, type Stroke } from "@writemind/core"
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

/**
 * A press that began on the row (client px) is the SHEET's now (a stroke for the pen, a box for the mouse, from its first
 * point): it began over the sheet itself (the row lies on it; a row in the pane's margin keeps its presses) and has moved
 * `slop` px or more from there. Short of that it is still a click on the button (penFeed.ts CLICK_SLOP_PX, the pen feed's
 * own rule for the same row).
 */
export function rowPressToSheet(sheet: { left: number; top: number; width: number; height: number }, start: Point, point: Point,
  slop: number): boolean {
  const over = start.x >= sheet.left && start.x < sheet.left + sheet.width && start.y >= sheet.top && start.y < sheet.top + sheet.height
  return over && Math.hypot(point.x - start.x, point.y - start.y) >= slop
}

/**
 * The cell Bring in as Drawing Cell makes: THE BOX IS THE CELL. `frame` is the box landed on the note as Bring in Writing
 * lands it (pane px; tabletCapture.ts `Capture.frame`), `items` the landed strokes (pane fractions), `width` the column.
 * The ink keeps where it sat in the box: the box's top-left is the cell's (less a hair of air, half the widest stroke, so
 * ink cut at the box's edge is not shaved by the cell's), the cell as tall as the box (never under INK_MIN_HEIGHT), and
 * the whole box (ink, the gaps round it, stroke widths) scaled down only when it is wider than the column.
 * Null when there is nothing to place or something is not a plain landed stroke (the caller then frames the ink itself).
 */
export function cellOfBox(items: CanvasItem[], pane: Size, frame: Rect, width: number, id: string = newID()): InkCell | null {
  if (!(width > 0) || !(pane.width > 0) || !(pane.height > 0) || !(frame.width > 0) || !(frame.height > 0)) return null
  if (items.length === 0) return null
  const strokes: Stroke[] = []
  for (const item of items) {
    if (item.kind !== "stroke") return null
    const t = item.stroke.transform
    if (t.dx !== 0 || t.dy !== 0 || t.scale !== 1 || t.rotation !== 0) return null
    strokes.push(item.stroke)
  }
  const air = Math.ceil(Math.max(...strokes.map((stroke) => stroke.width)) / 2) + 1
  const k = Math.min(1, (width - 2 * air) / frame.width)
  if (!(k > 0)) return null
  const cellItems: CanvasItem[] = strokes.map((stroke) => ({
    kind: "stroke",
    stroke: {
      ...stroke,
      width: Math.max(0.5, stroke.width * k),
      points: stroke.points.map((p) => ({
        x: (air + (p.x * pane.width - frame.x) * k) / width,
        y: (air + (p.y * pane.height - frame.y) * k) / width,
      })),
      ...(stroke.pressures ? { pressures: stroke.pressures.slice() } : {}),
    },
  }))
  const height = Math.max(INK_MIN_HEIGHT, frame.height * k + 2 * air)
  return { id, aspect: height / width, items: cellItems }
}

/**
 * The box (`onPage`: the part of the page the sheet stands for, page px) landed on the note the way the Writing capture
 * lands the strokes inside it (core `placement` at the learned page scale, no nudge): fractions of the pane. The strokes
 * `landStrokes` lands from the same page sit inside it exactly where they sat in the box.
 */
export function landedFrame(onPage: Rect, pageSize: Size, pane: Size): Rect {
  const where = placement({ frame: onPage, pageSize, pane, nudge: 0 })
  const width = Math.max(1, pane.width), height = Math.max(1, pane.height)
  const tall = where.width * width * onPage.height / Math.max(1e-9, onPage.width) / height
  return { x: where.center.x - where.width / 2, y: where.center.y - tall / 2, width: where.width, height: tall }
}
