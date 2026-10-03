/**
 * The tablet sheet's memory and what taking from it means. Both the video pane
 * (CameraPane) and the full-screen pad (PadMode) show THE SAME sheet and take
 * from it through THE SAME function, so a capture made in either is the same
 * capture: the strokes with their pressures, the Page picture, the Box
 * section, the flow-chart reader, the learned page shape, the placement.
 *
 * No React in here. The sheet outlives both views (putting the video away, or
 * leaving the pad, does not wipe the page).
 */

import {
  placement, regionOf, resolveShape, shapeSize, type CanvasItem, type Rect, type Size,
} from "@writemind/core"
import { bandUnder, renderSheet, sheetChart } from "./capturePipeline"
import { screenAspect } from "./padGeometry"
import { inkExtent, landStrokes, SHEET_REF, splitByRegion, TabletPage } from "./tabletPage"

export interface Capture {
  /** The picture's bytes, ready for `saveMedia`. Absent when the writing comes in as strokes. */
  blob?: Blob
  /** The tablet's writing as real stroke items, already placed (no picture goes with them). */
  strokes?: CanvasItem[]
  /** Where it goes and how big, as fractions of the notes pane. */
  center: { x: number; y: number }
  width: number
  aspect: number
  /** A flow chart read off the same page: the nodes and arrows, already placed under the picture. */
  chart?: CanvasItem[]
}

/** The one sheet, in the shape of this machine's screen. */
export const sheet = new TabletPage(screenAspect())

/** The sheet's size in reference units: what widths and the page arithmetic are measured in. */
export const sheetUnits = (aspect: number = sheet.aspect): Size =>
  ({ width: SHEET_REF, height: SHEET_REF / aspect })

export const keptClearAfter = (): boolean => {
  try { return localStorage.getItem("writemind.tabletClearAfter") !== "false" } catch { return true }
}
export const keepClearAfter = (on: boolean): void => {
  try { localStorage.setItem("writemind.tabletClearAfter", String(on)) } catch { /* session only */ }
}

/** The page's shape, learned from the first capture and kept; and the nudge between two captures. */
const learned = { shape: null as number | null, nudge: 0 }

export type SheetTake =
  | { trouble: string }
  | { capture: Capture; read: string | null; cleared: boolean }

/**
 * Take what is on the sheet. The same arithmetic as a camera with no page
 * found: the box is a fraction of the sheet, the sheet stands for a page of
 * the learned shape, and the capture is placed where it was on it. WRITING
 * brings the strokes themselves (pressure and all); PAGE brings the sheet as a
 * picture, which the "Aa" reader can read words out of. Either way the
 * flow-chart reader looks at a black-on-white raster of the same ink.
 *
 * `box` is the dashed box in FRACTIONS of the sheet (or null for all of it),
 * `shown` the sheet's size on screen (only its shape and the box's minimum
 * size depend on it), `pane` the notes pane the capture is landed on. When
 * `clearAfter` is on, what was taken leaves the sheet (one Undo brings it back).
 */
export async function takeFromSheet(mode: "ink" | "page", options: {
  box: Rect | null
  shown: Size
  pane: Size
  penColour: string
  penWidth: number
  clearAfter: boolean
}): Promise<SheetTake> {
  const { box, shown, pane, penColour, penWidth, clearAfter } = options
  if (shown.width <= 0 || shown.height <= 0) return { trouble: "no sheet to take from" }
  if (sheet.strokes.length === 0) return { trouble: "nothing written yet" }
  const region = box
    ? regionOf({ x: box.x * shown.width, y: box.y * shown.height, width: box.width * shown.width, height: box.height * shown.height },
      shown, shown)
    : { x: 0, y: 0, width: 1, height: 1 }
  if (!region) return { trouble: "that box is not on the sheet" }
  const parts = splitByRegion(sheet.strokes, region)
  if (parts.inside.length === 0) return { trouble: "nothing written in that box" }

  // The page arithmetic runs on the sheet in REFERENCE units, so it is the
  // same whatever size the sheet was shown at when it was written.
  const units = sheetUnits()
  const portrait = units.height >= units.width
  const measured = Math.max(units.width, units.height) / Math.max(1, Math.min(units.width, units.height))
  const page = resolveShape(measured, learned.shape)
  learned.shape = page.ratio
  const pageSize = shapeSize(page, portrait)
  const onPage: Rect = {
    x: region.x * pageSize.width, y: region.y * pageSize.height,
    width: region.width * pageSize.width, height: region.height * pageSize.height,
  }
  /** Page pixels per reference unit. */
  const scale = pageSize.width / units.width

  let blob: Blob | undefined
  let frameOnPage = onPage
  if (mode === "page") {
    const picture = renderSheet(parts.inside, pageSize, onPage, scale)
    blob = (await new Promise<Blob | null>((resolve) => picture.toBlob(resolve, "image/jpeg", 0.9))) ?? undefined
    if (!blob) return { trouble: "could not make the picture" }
  } else {
    // The writing's own box, padded by the pen, so it lands where it was.
    const extent = inkExtent(parts.inside)!
    const pad = Math.max(...parts.inside.map((stroke) => stroke.width)) * scale + 2
    frameOnPage = {
      x: extent.x * pageSize.width - pad, y: extent.y * pageSize.height - pad,
      width: extent.width * pageSize.width + 2 * pad, height: extent.height * pageSize.height + 2 * pad,
    }
  }
  const where = placement({ frame: frameOnPage, pageSize, pane, nudge: learned.nudge })
  learned.nudge = (learned.nudge + 0.02) % 0.1
  const aspect = frameOnPage.height / Math.max(1, frameOnPage.width)
  const strokes = mode === "ink"
    ? landStrokes(parts.inside, { surface: units, pageSize, frame: frameOnPage, where, pane })
    : undefined

  const chart = sheetChart(parts.inside, pageSize, onPage, frameOnPage, scale, pane, penColour, penWidth,
    bandUnder(where.center, where.width, aspect, pane))
  const nodes = chart.filter((item) => item.kind === "shape").length
  const read = chart.length > 0
    ? `Read a flow chart: ${nodes} ${nodes === 1 ? "node" : "nodes"}.` : null
  if (clearAfter) sheet.replace(parts.outside)
  return {
    read, cleared: clearAfter,
    capture: {
      ...(blob ? { blob } : {}),
      ...(strokes ? { strokes } : {}),
      center: where.center, width: where.width, aspect,
      ...(chart.length > 0 ? { chart } : {}),
    },
  }
}

// End-to-end scripts (WRITEMIND_E2E, whose preload adds `e2eWindow`) read the
// stored strokes to check that they are normalised; nothing else does.
if (typeof window !== "undefined" && (window as unknown as { wm?: { e2eWindow?: unknown } }).wm?.e2eWindow) {
  ;(window as unknown as Record<string, unknown>).__wmSheet = sheet
}
