/**
 * The drawings of a note as the SVGs the Wolfram Engine turns into Images (`ImportString[svg, {"SVG", "Image"}]`, Sean,
 * 2026-10-06: "use wolfram's import of SVG as "Image" instead of "Graphics""): a drawing cell, a band of the floating
 * drawing layer, a Mac PDF capture.
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * ONE VECTOR WRITER. A drawing cell is the very svg its snapshot is (`inkCellSvg`, the PDF's `itemSvg` inside), from
 * the SIDECAR and never from the snapshot file: the file may be a save behind, its background is transparent, its
 * words are a `<foreignObject>` the engine's importer drops, and its pictures are linked by name. Here the
 * background is white (a dark notebook shows the page it was drawn on), the words are SVG text broken where the
 * screen broke them, and the pictures are inlined by the main process (`inlineSvgPictures`).
 *
 * THE SIZE IT IS SHOWN AT is the width it had on screen, up to 640 points — a notebook window's comfortable width —
 * and the viewBox stays the drawing's own width, so a line keeps its thickness relative to the drawing.
 */

import { bounds, type Size } from "../../drawing/geometry"
import { visibleItems, type Drawing, type InkCell } from "../../drawing/model"
import { itemSvg, type WordBreaker } from "../drawing"
import { inkCellSvg } from "../inkSnapshot"
import { escapeHtml } from "../inline"
import type { WolframBand, WolframSvg } from "./plan"

/** The widest an image is shown in the notebook, in points. */
export const MAX_SHOWN = 640
const WHITE = "#FFFFFF"
/** Floating objects closer than this, top to bottom, are one picture. */
const BAND_JOIN = 16
/** The air round a band's objects. */
const BAND_PAD = 8

const n = (value: number): string => String(Math.round(value * 100) / 100)

/** The width something `width` wide on screen is shown at: whole points, at most `MAX_SHOWN`. */
/**
 * The SVG as pure ASCII: every other character as a numeric reference (`&#233;`). `ImportString` takes a string whose
 * characters are all at or below U+00FF for raw BYTES and fails on a label like "café"; ASCII is the same in both
 * readings, and the importer reads the references as the characters (the fallback cell's `ImportString[svg, ...]` and
 * the engine's byte route then agree).
 */
export const asciiSvg = (svg: string): string =>
  svg.replace(/[^\x00-\x7f]/gu, (char) => `&#${char.codePointAt(0)};`)

export const shownAt = (width: number): number => Math.max(1, Math.round(Math.min(width, MAX_SHOWN)))

/**
 * A drawing cell `W` wide on screen, as the engine is handed it. `transparent`: no white page under the ink (a COPY
 * into Mathematica, Sean, 2026-10-06: it pastes as the ink alone, on whatever the notebook's background is).
 */
export function wolframInkSvg(cell: InkCell, W: number, words?: WordBreaker, transparent = false): WolframSvg {
  const width = Math.max(1, W)
  const shown = shownAt(width)
  const svg = asciiSvg(inkCellSvg(cell, width, {
    mediaUrl: (file) => file, shown, ...(transparent ? {} : { background: WHITE }), ...(words ? { words } : {}),
  }))
  return { svg, shown }
}

/**
 * THE FLOATING DRAWING LAYER, as pictures between the cells. In the port floating ink is the default
 * (PLAN-docking: "an ink cell is something you ask for"), so leaving it out would leave out most drawings. The
 * objects on the page, top to bottom, are cut into BANDS — an object within 16 px of the band above joins it — and
 * each band is one picture of that strip of the page (8 px of air round it, never above or left of the page), placed
 * after the last cell that starts above its middle (`after`, a cell's source offset; null: before the first cell).
 * `cells` are the cells' tops in the drawing layer's own document coordinates.
 */
export function floatingBands(drawing: Drawing, pane: Size, cells: readonly { top: number; offset: number }[],
  words?: WordBreaker): WolframBand[] {
  const options = { mediaUrl: (file: string) => file, ...(words ? { words } : {}) }
  const placed = visibleItems(drawing).flatMap((item, order) => {
    if (item.kind === "cell") return []
    const box = bounds(item, pane)
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || !(box.height > 0)) return []
    const body = itemSvg(item, pane, options)
    return body ? [{ box, body, order }] : []
  }).sort((a, b) => a.box.y - b.box.y || a.order - b.order)

  const bands: { left: number; top: number; right: number; bottom: number; items: { body: string; order: number }[] }[] = []
  for (const one of placed) {
    const last = bands[bands.length - 1]
    if (last && one.box.y <= last.bottom + BAND_JOIN) {
      last.left = Math.min(last.left, one.box.x)
      last.right = Math.max(last.right, one.box.x + one.box.width)
      last.bottom = Math.max(last.bottom, one.box.y + one.box.height)
      last.items.push(one)
    } else {
      bands.push({ left: one.box.x, top: one.box.y, right: one.box.x + one.box.width, bottom: one.box.y + one.box.height, items: [one] })
    }
  }

  return bands.map((band) => {
    const x = Math.max(0, band.left - BAND_PAD)
    const y = Math.max(0, band.top - BAND_PAD)
    const w = Math.max(1, band.right + BAND_PAD - x)
    const h = Math.max(1, band.bottom + BAND_PAD - y)
    const shown = shownAt(w)
    const middle = y + h / 2
    let after: { top: number; offset: number } | null = null
    for (const cell of cells) if (cell.top <= middle && (after === null || cell.top >= after.top)) after = cell
    // Back to front, as the page draws them.
    const body = [...band.items].sort((a, b) => a.order - b.order).map((one) => one.body).join("")
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n(shown)}" height="${n(shown * h / w)}" `
      + `viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${WHITE}"/>`
      + `${body}</svg>`
    return { svg: asciiSvg(svg), shown, after: after ? after.offset : null }
  })
}

// MARK: - Pictures inside a drawing

const IMAGE_TAG = /<image\b[^>]*>/g
const attribute = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
const unescapeAttribute = (value: string): string =>
  value.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

/**
 * The pictures a drawing's svg links to by name (`mediaUrl: (file) => file`), each once, with the widest it is drawn
 * at (in the svg's own units): what the main process reads, shrinks if it is far bigger than that, and inlines.
 */
export function svgPictures(svg: string): { name: string; width: number }[] {
  const out = new Map<string, number>()
  for (const tag of svg.match(IMAGE_TAG) ?? []) {
    const href = attribute(tag, "href")
    if (href === null) continue
    const name = unescapeAttribute(href)
    if (name.startsWith("data:")) continue
    const width = Number(attribute(tag, "width") ?? "0")
    out.set(name, Math.max(out.get(name) ?? 0, Number.isFinite(width) ? width : 0))
  }
  return [...out].map(([name, width]) => ({ name, width }))
}

/**
 * The svg with every picture it links to put INSIDE it (`dataUrl`: a `data:` URL for a name, or null for a file that
 * is not there — that picture is left out, as the PDF leaves out a missing one), so it is whole wherever it goes: the
 * engine's import, and the cell that imports it later when there is no engine.
 */
export function inlineSvgPictures(svg: string, dataUrl: (name: string) => string | null): string {
  return svg.replace(IMAGE_TAG, (tag) => {
    const href = attribute(tag, "href")
    if (href === null) return tag
    const name = unescapeAttribute(href)
    if (name.startsWith("data:")) return tag
    const url = dataUrl(name)
    if (url === null) return ""
    return tag.replace(/\shref="[^"]*"/, () => ` href="${escapeHtml(url)}"`)
  })
}

/**
 * A Mac capture that is a one-page PDF, as a picture the engine can import: its paths' svg (`dataUrl`, `w` × `h` in
 * its own units) inside one of ours, on white, `shown` points wide.
 */
export function pictureSvg(dataUrl: string, w: number, h: number, shown: number): string {
  const width = Math.max(1, w)
  const height = Math.max(1, h)
  const wide = shownAt(shown)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(wide)}" height="${n(wide * height / width)}" viewBox="0 0 ${n(width)} ${n(height)}">`
    + `<rect width="100%" height="100%" fill="${WHITE}"/>`
    + `<image href="${escapeHtml(dataUrl)}" x="0" y="0" width="${n(width)}" height="${n(height)}" preserveAspectRatio="none"/></svg>`
}
