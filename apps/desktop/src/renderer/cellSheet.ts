/**
 * A tablet sheet BOUND to an ink cell (Sean, 2026-10-05: "right click and open the drawing cell as a new tab in the
 * wacom/video editor to write in"). Pure: the geometry between the cell and the sheet, and both directions of the
 * sync. cellSheets.ts is the live side; test/cellSheet.test.ts holds the rules.
 *
 * THE FRAME. Every sheet keeps the tablet's shape, so the pen's mapping never changes (a sheet of the cell's shape
 * would squash the handwriting: the whole tablet is mapped onto the sheet). The cell is the largest rectangle of ITS
 * shape centred on the sheet (`cellFrameOn`); the sheet round it is shaded, and a stroke stops at the frame's edge.
 *
 * COORDINATES. A cell's items are fractions of its shown width W on both axes (core inkCell.ts), widths in px; a
 * sheet's strokes are fractions of the sheet, widths in `SHEET_REF` units across the whole sheet. Cell (x, y) is sheet
 * (frame.x + x·frame.width, frame.y + y / aspect · frame.height), and a width of w px is w · frame.width · SHEET_REF / W
 * units. A cell stroke's transform (moved, scaled, turned in the note) is baked into its SHEET copy, never into the
 * cell: a stroke the sheet did not change keeps its own item, as it was.
 *
 * THE LINKS. Each sheet stroke made from the cell (or written into it) knows its item, and each item its sheet stroke
 * (WeakMaps; neither side ever mutates a stroke or an item, so an object IS a version). Sheet → cell keeps every linked
 * item still on the sheet, drops the cell's strokes that are not (rubbed out on the sheet), adds one new item per
 * stroke no item made, and never touches anything else in the cell (its pictures). Cell → sheet reuses the sheet
 * stroke of every item it has seen at the same placement, so after an Undo in the note nothing else moves.
 */

import {
  cellFrame, isHidden, newID, noTransform, outline, type CanvasItem, type InkCell, type Rect,
} from "@writemind/core"
import { SHEET_REF, type InkStroke } from "./tabletPage"

/** Where a cell is on a sheet: the frame (fractions of the sheet), the cell's shown width W (px), its aspect (h / w). */
export interface Placement { frame: Rect; width: number; aspect: number }

/** The width a cell is measured at when it is not on the screen (inkCells.ts uses the same). */
export const CELL_WIDTH = 720

const finite = (value: number, fallback: number): number => (Number.isFinite(value) && value > 0 ? value : fallback)

/**
 * The cell's rectangle on a sheet of shape `sheetAspect` (width / height), in fractions of the sheet: as large as fits,
 * centred. `cellAspect` is the cell's height / width (InkCell.aspect).
 */
export function cellFrameOn(sheetAspect: number, cellAspect: number): Rect {
  const sheet = finite(sheetAspect, 16 / 9)
  const shape = 1 / finite(cellAspect, 200 / CELL_WIDTH) // the cell's width / height
  // In units where the sheet is `sheet` wide and 1 tall.
  let width = sheet, height = sheet / shape
  if (height > 1) { height = 1; width = shape }
  return { x: (sheet - width) / 2 / sheet, y: (1 - height) / 2, width: width / sheet, height }
}

export const placementFor = (sheetAspect: number, cell: InkCell, width: number | null): Placement => ({
  frame: cellFrameOn(sheetAspect, cell.aspect),
  width: finite(width ?? CELL_WIDTH, CELL_WIDTH),
  aspect: finite(cell.aspect, 200 / CELL_WIDTH),
})

const r6 = (value: number): string => (Math.round(value * 1e6) / 1e6).toString()
/** Two placements with the same key convert every stroke the same way. */
export const placementKey = (place: Placement): string =>
  [place.frame.x, place.frame.y, place.frame.width, place.frame.height, place.width, place.aspect].map(r6).join(",")

type StrokeItem = Extract<CanvasItem, { kind: "stroke" }>

/** A cell's stroke as the sheet shows it: where it is now (its transform applied), at the sheet's scale. */
export function strokeToSheet(item: StrokeItem, place: Placement): InkStroke {
  const { frame, width: W, aspect } = place
  const points = outline(item, cellFrame(W)).map((p) => ({
    x: frame.x + (p.x / W) * frame.width,
    y: frame.y + (p.y / (W * aspect)) * frame.height,
  }))
  const s = item.stroke
  return {
    colorHex: s.colorHex,
    width: (s.width * s.transform.scale * frame.width * SHEET_REF) / W,
    points,
    ...(s.pressures && s.pressures.length === points.length ? { pressures: s.pressures.slice() } : {}),
  }
}

/** A sheet stroke as a new item of the cell (points inside the frame; a stroke past its edge stops there). */
export function strokeToCell(stroke: InkStroke, place: Placement): StrokeItem {
  const { frame, width: W, aspect } = place
  const inside = clampToFrame(stroke, frame)
  return {
    kind: "stroke",
    stroke: {
      id: newID(),
      colorHex: stroke.colorHex,
      width: (stroke.width * W) / (frame.width * SHEET_REF),
      points: inside.points.map((p) => ({
        x: (p.x - frame.x) / frame.width,
        y: ((p.y - frame.y) / frame.height) * aspect,
      })),
      ...(inside.pressures ? { pressures: inside.pressures.slice() } : {}),
      transform: noTransform(),
      group: null,
    },
  }
}

/** The stroke with every point inside `frame` (the same object when it is inside already). */
export function clampToFrame(stroke: InkStroke, frame: Rect): InkStroke {
  const x0 = frame.x, x1 = frame.x + frame.width, y0 = frame.y, y1 = frame.y + frame.height
  const out = (p: { x: number; y: number }) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1
  if (!stroke.points.some(out)) return stroke
  return {
    ...stroke,
    points: stroke.points.map((p) => ({ x: Math.min(x1, Math.max(x0, p.x)), y: Math.min(y1, Math.max(y0, p.y)) })),
  }
}

/** Which sheet stroke stands for which cell item, and back (see THE LINKS above). */
export interface Links {
  items: WeakMap<InkStroke, CanvasItem>
  strokes: WeakMap<CanvasItem, InkStroke>
  /** The placement `strokes` were made at; another placement makes them again. */
  key: string
}
export const newLinks = (): Links => ({ items: new WeakMap(), strokes: new WeakMap(), key: "" })

const keyed = (links: Links, place: Placement): void => {
  const key = placementKey(place)
  if (links.key === key) return
  links.strokes = new WeakMap()
  links.key = key
}

/** The cell's strokes as the sheet shows them (in the cell's order). */
export function sheetStrokesOf(cell: InkCell, links: Links, place: Placement): InkStroke[] {
  keyed(links, place)
  const out: InkStroke[] = []
  for (const item of cell.items) {
    if (item.kind !== "stroke" || isHidden(item) || item.stroke.points.length === 0) continue
    let stroke = links.strokes.get(item)
    if (!stroke) {
      stroke = strokeToSheet(item, place)
      links.strokes.set(item, stroke)
    }
    links.items.set(stroke, item)
    out.push(stroke)
  }
  return out
}

/**
 * The cell with the sheet's strokes: its linked strokes kept (as they were), the ones no longer on the sheet gone, a
 * new item for each new sheet stroke (after the rest), its pictures untouched. The SAME cell when nothing changed.
 */
export function cellWithSheet(cell: InkCell, strokes: InkStroke[], links: Links, place: Placement): InkCell {
  keyed(links, place)
  const onSheet = new Set<CanvasItem>()
  const order: CanvasItem[] = []
  for (const stroke of strokes) {
    let item = links.items.get(stroke)
    if (!item) {
      if (stroke.points.length === 0) continue
      item = strokeToCell(stroke, place)
      links.items.set(stroke, item)
      links.strokes.set(item, stroke)
    }
    if (onSheet.has(item)) continue
    onSheet.add(item)
    order.push(item)
  }
  const had = new Set(cell.items)
  const items = cell.items.filter((item) => item.kind !== "stroke" || onSheet.has(item))
  for (const item of order) if (!had.has(item)) items.push(item)
  if (items.length === cell.items.length && items.every((item, i) => item === cell.items[i])) return cell
  return { ...cell, items }
}

/** The same strokes, the same objects, in the same order. */
export const sameStrokes = (a: readonly InkStroke[], b: readonly InkStroke[]): boolean =>
  a.length === b.length && a.every((stroke, i) => stroke === b[i])
