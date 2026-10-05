/**
 * An ink cell as ONE svg (docs\PLAN-docking-ink-cells.md (f), (g)): the file `ink-<id>.svg` its markdown line points
 * at, which any markdown viewer (and the Mac) shows, and the cell as the PDF inlines it.
 *
 * The same vector writer as the drawing on paper (`itemSvg`, export/drawing.ts), at the cell's width with
 * `cellFrame(W)` as the size its items are measured in; `W × aspect` tall, so the file carries the size the cell
 * had; a transparent background; clipped to the cell (an svg's own box clips). With `metadata` it also carries the
 * cell itself as JSON in `<metadata id="writemind-ink">`, which `readInkSnapshot` reads back: a later round adopts a
 * cell pasted into another note from it.
 */

import { cellFrame } from "../drawing/inkCell"
import { decodeDrawing, writeDrawing, type InkCell } from "../drawing/model"
import { itemSvg } from "./drawing"
import { PAPER_HEX } from "./inline"

const n = (value: number): string => String(Math.round(value * 100) / 100)

/** Text that goes inside an XML element: `&`, `<` and `>` escaped (JSON has no other character XML minds). */
const xmlText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** The metadata element's id. */
export const INK_METADATA_ID = "writemind-ink"

export interface InkSvgOptions {
  /** A picture's file name → where the svg can load it from (beside the snapshot: the name itself). */
  mediaUrl(file: string): string
  /** Put the cell's JSON in a `<metadata>` (the snapshot file does; the PDF does not need it). */
  metadata?: boolean
  /** What it is read against, for `readableInk`. White by default. */
  paper?: string
}

/** The height an ink cell this wide is shown at. */
export const inkCellHeight = (cell: InkCell, width: number): number => Math.max(1, width * cell.aspect)

/** The cell as it is written into the snapshot's metadata: the sidecar's own item. */
export function inkCellJson(cell: InkCell): string {
  const written = JSON.parse(writeDrawing({ items: [{ kind: "cell", cell }] })) as { items: unknown[] }
  return JSON.stringify(written.items[0])
}

/** The cell as one svg, `width` wide and `width × aspect` tall. An empty cell is an empty svg of its size. */
export function inkCellSvg(cell: InkCell, width: number, options: InkSvgOptions): string {
  const w = Math.max(1, width)
  const h = inkCellHeight(cell, w)
  const size = cellFrame(w)
  const ink = { mediaUrl: options.mediaUrl, paper: options.paper ?? PAPER_HEX }
  const body = cell.items.map((item) => itemSvg(item, size, ink)).join("")
  const meta = options.metadata ? `<metadata id="${INK_METADATA_ID}">${xmlText(inkCellJson(cell))}</metadata>` : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" class="wm-ink-cell" data-ink-cell="${cell.id}" width="${n(w)}" height="${n(h)}" `
    + `viewBox="0 0 ${n(w)} ${n(h)}" style="display:block;overflow:hidden">${meta}${body}</svg>`
}

/**
 * The cell a snapshot carries in its metadata, read by the sidecar's own reader (a damaged item inside is dropped);
 * null when the svg has none or it is not a cell.
 */
export function readInkSnapshot(svg: string): InkCell | null {
  const found = new RegExp(`<metadata[^>]*\\bid="${INK_METADATA_ID}"[^>]*>([\\s\\S]*?)</metadata>`).exec(svg)
  if (!found) return null
  const json = found[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").trim()
  if (!json.startsWith("{")) return null
  const item = decodeDrawing(`{"items":[${json}]}`).drawing.items[0]
  return item && item.kind === "cell" ? item.cell : null
}
