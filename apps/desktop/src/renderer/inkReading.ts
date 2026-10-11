/**
 * READING PEN HANDWRITING ON THE NOTE PAGE (Sean, 2026-10-10: "no ocr for the pen on top of rendered notepage"): the strokes that
 * are picked on the drawing layer, painted as black ink on white paper and handed to the app's one reader (ocrClient.ts), as the
 * Wacom sheet's Text does (tabletCapture.ts `readSheetText`) and a picture's Read does.
 *
 * The strokes are painted by the core's own vector writer (`itemSvg`, export/drawing.ts: the same one the page, the PDF and a
 * copied drawing cell use), in the pane's px with the pen's pressure and the strokes' own transforms, so what is read is exactly
 * what is on the page. Every colour is forced to black: a pen picked to read on a dark window (a pale yellow, a white) is not
 * ink on white paper, and the reader lifts ink by how dark it is.
 */

import { bounds, itemSvg, type CanvasItem, type Size } from "@writemind/core"
import { readCanvasLines } from "./ocrClient"

/** The blank paper round the ink, in the pane's px: the reader drops ink on the very edge of a picture as the page's own edge. */
const MARGIN = 28
/** The raster's long side: handwriting is read at a size the reader is good at, however small it was written. */
const TARGET_SIDE = 1600
const MAX_SCALE = 4

/** What the picked items are painted as: one SVG of black ink on white, in the pane's px, and the size it is at on the raster. */
export function inkSvg(items: CanvasItem[], pane: Size): { svg: string; width: number; height: number; scale: number } | null {
  const frames = items.map((item) => bounds(item, pane))
    .filter((frame) => Number.isFinite(frame.x + frame.y + frame.width + frame.height))
  if (frames.length === 0) return null
  const left = Math.min(...frames.map((frame) => frame.x)) - MARGIN
  const top = Math.min(...frames.map((frame) => frame.y)) - MARGIN
  const right = Math.max(...frames.map((frame) => frame.x + frame.width)) + MARGIN
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height)) + MARGIN
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top)
  const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_SIDE / Math.max(width, height)))
  const body = items.map((item) => itemSvg(item, pane, { mediaUrl: () => "", paper: "#ffffff" }))
    .join("")
    .replace(/(stroke|fill)="#[0-9a-fA-F]{3,8}"/g, '$1="#000000"')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" `
    + `viewBox="${left} ${top} ${width} ${height}"><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>`
  return { svg, width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

/** The strokes painted onto a canvas (black on white), or null when there is nothing to paint. */
export async function inkRaster(items: CanvasItem[], pane: Size): Promise<HTMLCanvasElement | null> {
  const painted = inkSvg(items, pane)
  if (!painted) return null
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(painted.svg)}`
  try { await image.decode() } catch { return null }
  const canvas = document.createElement("canvas")
  canvas.width = painted.width
  canvas.height = painted.height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** The picked strokes' words, in reading order: [] when the reader finds none, null when it could not be asked or did not answer. */
export async function readInkLines(items: CanvasItem[], pane: Size, signal?: AbortSignal): Promise<string[] | null> {
  const canvas = await inkRaster(items, pane)
  if (!canvas) return []
  return readCanvasLines(canvas, signal)
}
