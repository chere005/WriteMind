/**
 * Ink cells: cells of the note you draw in with the pen (docs\PLAN-docking-ink-cells.md (b), (d)). Pure.
 *
 * A cell is ONE item of the drawing, `{ kind: "cell", cell: InkCell }`, hidden on the page. Its own items are in
 * fractions of the cell's shown WIDTH `W` on both axes, so every function of the drawing layer works on them
 * unchanged with `size = cellFrame(W)` and points local to the cell's top-left. Stroke widths stay in px, as on the
 * page.
 *
 * Page → cell is a pure TRANSLATION in points: a page point `(x·pane.w, y·pane.h)` less the cell's origin, over `W`;
 * a transform's `dx, dy` (pane fractions) become `dx·pane.w/W, dy·pane.h/W`; a picture's or a shape's `width` (a
 * fraction of the pane's width) becomes `width·pane.w/W`. Every point of an item lands exactly where it was, less the
 * origin, whatever the pane's aspect ratio is (`inkCell.test.ts` holds every item's bounds to 0.01 px).
 */

import { bounds, transformed, type Size } from "./geometry"
import {
  isHidden, itemId, itemTransform, newID, removing, withTransform,
  type CanvasItem, type Drawing, type InkCell, type ItemTransform,
} from "./model"
import type { Point, Rect } from "./shapes"
import { inkFileName, mediaFiles } from "../markdown/images"

/** The air round docked ink inside its cell, in px. */
export const INK_PAD = 12
/** The least an ink cell can be, in px: a line and a half of handwriting. */
export const INK_MIN_HEIGHT = 48
/** A new, empty ink cell, in px. */
export const INK_DEFAULT_HEIGHT = 200

/** The text column, in page px: where an ink cell's drawing area is. */
export interface Column { left: number; width: number }

/** The size every core function is handed for a cell's items: its width on both axes. */
export const cellFrame = (width: number): Size => ({ width, height: width })

/** Every ink cell of the drawing, in order. */
export function inkCells(drawing: Drawing): InkCell[] {
  const out: InkCell[] = []
  for (const item of drawing.items) if (item.kind === "cell") out.push(item.cell)
  return out
}

/** The ink cell with this id (the first, should there be two), or null. */
export function inkCellOf(drawing: Drawing, id: string): InkCell | null {
  for (const item of drawing.items) if (item.kind === "cell" && item.cell.id === id) return item.cell
  return null
}

/** A cell never holds a cell. */
const flat = (items: CanvasItem[]): CanvasItem[] =>
  items.some((item) => item.kind === "cell") ? items.filter((item) => item.kind !== "cell") : items

/** The drawing with this cell in it: the cell with its id replaced (where it was in the order), else appended. */
export function withInkCell(drawing: Drawing, cell: InkCell): Drawing {
  const next: CanvasItem = { kind: "cell", cell: { ...cell, items: flat(cell.items) } }
  let found = false
  const items = drawing.items.map((item) => {
    if (found || item.kind !== "cell" || item.cell.id !== cell.id) return item
    found = true
    return next
  })
  if (!found) items.push(next)
  return { items }
}

/** A new, empty cell for a column this wide: `INK_DEFAULT_HEIGHT` tall. */
export function newInkCell(width: number, id: string = newID()): InkCell {
  return { id, aspect: INK_DEFAULT_HEIGHT / Math.max(1, width), items: [] }
}

/** The upright box round some items, in the px of `size`; null when none of them has one. */
function unionBounds(items: CanvasItem[], size: Size): Rect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const item of items) {
    if (isHidden(item)) continue
    const box = bounds(item, size)
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return minX <= maxX && minY <= maxY ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null
}

/** The bottom of a cell's ink, in px of a cell this wide (0 for an empty cell). */
export function inkBottom(cell: InkCell, width: number): number {
  const box = unionBounds(cell.items, cellFrame(width))
  return box ? Math.max(0, box.y + box.height) : 0
}

/** The least aspect a cell can be resized to: its ink's own bottom and the pad, and never under `INK_MIN_HEIGHT`. */
export function minAspect(cell: InkCell, width: number): number {
  const w = Math.max(1, width)
  const bottom = inkBottom(cell, w)
  return Math.max(INK_MIN_HEIGHT, bottom > 0 ? bottom + INK_PAD : 0) / w
}

/**
 * What a page selection can be docked as: exactly one picture → a picture cell; strokes and pictures in any other
 * mix → one ink cell; anything with a shape, an arrow or a text box in it (or nothing at all) → null, and the dock
 * handle is not shown. A picture with no file cannot be a picture cell on its own.
 */
export function dockable(drawing: Drawing, ids: Set<string>): "picture" | "ink" | null {
  if (ids.size === 0) return null
  const picked = drawing.items.filter((item) => ids.has(itemId(item)) && !isHidden(item))
  if (picked.length === 0) return null
  if (picked.some((item) => item.kind !== "stroke" && item.kind !== "image")) return null
  if (picked.length === 1 && picked[0]!.kind === "image") return picked[0]!.image.file ? "picture" : null
  return "ink"
}

/**
 * The picked items taken off the page: the drawing without them, and the items themselves in the drawing's order.
 * Cells and hidden items are never taken. An arrow attached to a taken item was NOT picked, so it stays: the end on
 * the taken item lets go of it and stays where the routing last put it (the stored `start`/`end`/`bends` are the
 * routed points, baked in by `reconnect`).
 */
export function takenOut(drawing: Drawing, ids: Set<string>): { drawing: Drawing; items: CanvasItem[] } {
  const items = drawing.items.filter((item) => ids.has(itemId(item)) && !isHidden(item))
  if (items.length === 0) return { drawing, items }
  const gone = new Set(items.map(itemId))
  const rest = drawing.items.map((item): CanvasItem => {
    if (item.kind !== "connector") return item
    const c = item.connector
    const start = c.startNode !== null && gone.has(c.startNode)
    const end = c.endNode !== null && gone.has(c.endNode)
    if (!start && !end) return item
    return { kind: "connector", connector: { ...c, startNode: start ? null : c.startNode, endNode: end ? null : c.endNode } }
  })
  return { drawing: removing({ items: rest }, gone), items }
}

/**
 * Page items as cell items: points, centres and transforms moved from pane fractions to fractions of `width`, less
 * `origin` (the cell's top-left, in page px). Every point lands where it was less the origin. Cells are left out.
 */
export function toCell(items: CanvasItem[], pane: Size, origin: Point, width: number): CanvasItem[] {
  if (!(pane.width > 0 && pane.height > 0 && width > 0)) return flat(items)
  const pt = (p: Point): Point => ({ x: (p.x * pane.width - origin.x) / width, y: (p.y * pane.height - origin.y) / width })
  const tf = (t: ItemTransform): ItemTransform => ({
    ...t, dx: (t.dx * pane.width) / width, dy: (t.dy * pane.height) / width,
  })
  const wide = (w: number): number => (w * pane.width) / width
  const out: CanvasItem[] = []
  for (const item of items) {
    switch (item.kind) {
      case "stroke": {
        const s = item.stroke
        out.push({ kind: "stroke", stroke: { ...s, points: s.points.map(pt), transform: tf(s.transform),
          ...(s.pressures ? { pressures: s.pressures.slice() } : {}) } })
        break
      }
      case "image": {
        const i = item.image
        out.push({ kind: "image", image: { ...i, center: pt(i.center), width: wide(i.width), transform: tf(i.transform) } })
        break
      }
      case "shape": {
        const s = item.shape
        out.push({ kind: "shape", shape: { ...s, center: pt(s.center), width: wide(s.width), transform: tf(s.transform) } })
        break
      }
      case "connector": {
        const c = item.connector
        out.push({ kind: "connector", connector: { ...c, start: pt(c.start), end: pt(c.end), bends: c.bends.map(pt),
          transform: tf(c.transform), ...(c.overrides ? { overrides: c.overrides.map((o) => ({ ...o })) } : {}) } })
        break
      }
      case "cell":
        break
    }
  }
  return out
}

/**
 * The inverse of `toCell`: cell items (fractions of a cell `width` px wide) as page items of `pane`, the cell's top-left
 * at `origin` (page px). Used to paste ink copied in a cell that is no longer on the screen (another note, or its line
 * deleted) onto the page. Cells are left out.
 */
export function toPage(items: CanvasItem[], pane: Size, origin: Point, width: number): CanvasItem[] {
  if (!(pane.width > 0 && pane.height > 0 && width > 0)) return flat(items)
  const pt = (p: Point): Point => ({ x: (p.x * width + origin.x) / pane.width, y: (p.y * width + origin.y) / pane.height })
  const tf = (t: ItemTransform): ItemTransform => ({ ...t, dx: (t.dx * width) / pane.width, dy: (t.dy * width) / pane.height })
  const wide = (w: number): number => (w * width) / pane.width
  const out: CanvasItem[] = []
  for (const item of items) {
    switch (item.kind) {
      case "stroke": {
        const s = item.stroke
        out.push({ kind: "stroke", stroke: { ...s, points: s.points.map(pt), transform: tf(s.transform),
          ...(s.pressures ? { pressures: s.pressures.slice() } : {}) } })
        break
      }
      case "image": {
        const i = item.image
        out.push({ kind: "image", image: { ...i, center: pt(i.center), width: wide(i.width), transform: tf(i.transform) } })
        break
      }
      case "shape": {
        const s = item.shape
        out.push({ kind: "shape", shape: { ...s, center: pt(s.center), width: wide(s.width), transform: tf(s.transform) } })
        break
      }
      case "connector": {
        const c = item.connector
        out.push({ kind: "connector", connector: { ...c, start: pt(c.start), end: pt(c.end), bends: c.bends.map(pt),
          transform: tf(c.transform), ...(c.overrides ? { overrides: c.overrides.map((o) => ({ ...o })) } : {}) } })
        break
      }
      case "cell":
        break
    }
  }
  return out
}

/** The items scaled by `k` about `pivot` (page px), the way the scale handle does it; the same items when k is 1. */
function scaledAbout(items: CanvasItem[], k: number, pivot: Point, pane: Size): CanvasItem[] {
  if (k === 1) return items
  return items.map((item) => withTransform(item, transformed(item, itemTransform(item), { scale: k, pivot, size: pane })))
}

/** How much to scale ink this wide to fit a cell this wide inside its pads (1 when it fits). */
const fitScale = (inkWidth: number, width: number): number => {
  const room = width - 2 * INK_PAD
  return inkWidth > room && inkWidth > 0 && room > 0 ? room / inkWidth : 1
}

/**
 * A NEW ink cell made of page items: their left edge kept where it was in the column (shifted left if it would run
 * out of the cell), scaled down uniformly if they are wider than the cell less its pads, their top `INK_PAD` down,
 * and the cell as tall as the ink and both pads (at least `INK_MIN_HEIGHT`). `column` is the text column in page px.
 */
export function inkCellFrom(items: CanvasItem[], pane: Size, column: Column, id: string = newID()): InkCell {
  const width = column.width
  const page = flat(items)
  const box = width > 0 ? unionBounds(page, pane) : null
  if (!box) return { ...newInkCell(width, id), items: width > 0 ? toCell(page, pane, { x: 0, y: 0 }, width) : [] }
  const k = fitScale(box.width, width)
  const scaled = scaledAbout(page, k, { x: box.x, y: box.y }, pane)
  const w = box.width * k
  const left = k < 1 ? INK_PAD : Math.min(Math.max(box.x - column.left, 0), Math.max(0, width - INK_PAD - w))
  const origin = { x: box.x - left, y: box.y - INK_PAD }
  const height = Math.max(INK_MIN_HEIGHT, box.height * k + 2 * INK_PAD)
  return { id, aspect: height / width, items: toCell(scaled, pane, origin, width) }
}

/**
 * Page items docked INTO an existing cell: the middle of their bounds goes to `at` (cell-local px), clamped inside the
 * cell across and below `INK_PAD` at the top; scaled down the same way when they are wider than the cell; and the
 * cell grows (its aspect) when their bottom passes its own.
 */
export function mergedInto(cell: InkCell, items: CanvasItem[], pane: Size, width: number, at: Point): InkCell {
  const page = flat(items)
  const box = width > 0 ? unionBounds(page, pane) : null
  if (!box) return cell
  const k = fitScale(box.width, width)
  const scaled = scaledAbout(page, k, { x: box.x, y: box.y }, pane)
  const w = box.width * k, h = box.height * k
  const left = Math.min(Math.max(at.x - w / 2, 0), Math.max(0, width - w))
  const top = Math.max(at.y - h / 2, INK_PAD)
  const origin = { x: box.x - left, y: box.y - top }
  const aspect = Math.max(cell.aspect, (top + h + INK_PAD) / width)
  return { ...cell, aspect, items: [...flat(cell.items), ...toCell(scaled, pane, origin, width)] }
}

/**
 * Every media file the drawing needs kept: floating pictures (hidden ones too: a picture read into words is put
 * away, not thrown away), each ink cell's snapshot `ink-<id>.svg`, and the pictures inside cells. Each once.
 * A media sweep must keep these AND `mediaFiles(markdown)` of every note, or it deletes docked pictures.
 */
export function drawingMediaFiles(drawing: Drawing): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (file: string): void => { if (file && !seen.has(file)) { seen.add(file); out.push(file) } }
  const walk = (items: CanvasItem[]): void => {
    for (const item of items) {
      if (item.kind === "image") add(item.image.file)
      else if (item.kind === "cell") { add(inkFileName(item.cell.id)); walk(item.cell.items) }
    }
  }
  walk(drawing.items)
  return out
}

/**
 * THE RULE FOR ANY MEDIA SWEEP (none exists in the port; the Mac's `pruneMedia` read the sidecars only, and would
 * have deleted every docked picture): a file of a project's `.drawings/media` is in use when ANY note of the project
 * names it in its markdown (`mediaFiles`: picture cells, ink cells' snapshots, inline pictures) or in its sidecar
 * (`drawingMediaFiles`). A sweep deletes only what is in neither, and only with every note of the project read.
 */
export function mediaInUse(notes: Iterable<{ markdown: string; drawing: Drawing }>): Set<string> {
  const used = new Set<string>()
  for (const note of notes) {
    for (const file of mediaFiles(note.markdown)) used.add(file)
    for (const file of drawingMediaFiles(note.drawing)) used.add(file)
  }
  return used
}

/**
 * The cells of `after` that are not the very same object in `before` (new, or changed by any edit, undo or resize):
 * the ones whose widget repaints and whose snapshot is rewritten. Everything when there was no `before`.
 */
export function changedInkCells(before: Drawing | null, after: Drawing): InkCell[] {
  const old = new Map<string, InkCell>()
  if (before) for (const item of before.items) if (item.kind === "cell" && !old.has(item.cell.id)) old.set(item.cell.id, item.cell)
  return inkCells(after).filter((cell) => old.get(cell.id) !== cell)
}
