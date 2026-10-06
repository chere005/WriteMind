/**
 * What taking from the tablet sheet means. The video pane (CameraPane) shows the OPEN sheet (tabletSheets.ts: one
 * per tab) and takes from it through one function: the strokes with their pressures, the Page picture, the Box
 * section, the flow-chart reader, the learned page shape, the placement.
 *
 * No React in here. The sheets outlive the view (putting the video away does not wipe them; they are kept on disk).
 */

import {
  placement, resolveShape, shapeSize, type CanvasItem, type Rect, type Size,
} from "@writemind/core"
import { eraseRegion, landedFrame } from "./boxRow"
import { bandUnder, chartSummary, sheetChartLabelled } from "./capturePipeline"
import { wordsForChart } from "./ocrClient"
import {
  inkExtent, landStrokes, paintStrokes, regionOfSheetBox, SHEET_REF, splitByRegion, type InkStroke,
} from "./tabletPage"
import { inkOn, paintPaper, type Paper } from "./tabletPaper"
import { currentSheet, currentSheetAspect } from "./tabletSheets"

export { currentSheet, currentSheetAspect }

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
  /**
   * CELL only: the dashed box itself landed on the note at the same size as the strokes (fractions of the pane): the drawing
   * cell is this box, the ink where it sat in it (boxRow.ts `cellOfBox`, dock.ts `dockNewInk`).
   */
  frame?: Rect
}

/** The sheet's size in reference units: what widths and the page arithmetic are measured in. */
export const sheetUnits = (aspect: number = currentSheet().aspect): Size =>
  ({ width: SHEET_REF, height: SHEET_REF / aspect })

/**
 * The Page picture: the boxed part of the sheet as it looks, PAPER INCLUDED (the one place the paper goes), on a canvas
 * of the cut's size. `units` is the sheet in reference units, `region` the part taken (fractions of it).
 */
export function renderSheetPicture(strokes: InkStroke[], paper: Paper, units: Size, pageSize: Size, onPage: Rect,
  region: Rect, scale: number): HTMLCanvasElement {
  const cut = document.createElement("canvas")
  cut.width = Math.max(1, Math.round(onPage.width))
  cut.height = Math.max(1, Math.round(onPage.height))
  const context = cut.getContext("2d", { willReadFrequently: true })!
  paintPaper(context, paper, units,
    { x: region.x * units.width, y: region.y * units.height, width: region.width * units.width, height: region.height * units.height },
    { width: cut.width, height: cut.height })
  paintStrokes(context, strokes, (point) => ({
    x: point.x * pageSize.width - onPage.x, y: point.y * pageSize.height - onPage.y,
  }), scale, undefined, 0, (hex) => inkOn(paper, hex))
  return cut
}

/** The page's shape, learned from the first capture and kept; and the nudge between two captures. */
const learned = { shape: null as number | null, nudge: 0 }

export type SheetTake =
  | { trouble: string }
  | {
    capture: Capture; read: string | null
  }

/**
 * Take what is on the sheet. The same arithmetic as a camera with no page
 * found: the box is a fraction of the sheet, the sheet stands for a page of
 * the learned shape, and the capture is placed where it was on it. WRITING
 * brings the strokes themselves (pressure and all); PAGE brings the sheet as a
 * picture, which the "Aa" reader can read words out of. Either way the
 * flow-chart reader looks at a black-on-white raster of the same ink.
 *
 * `box` is the dashed box in FRACTIONS of the sheet (or null for all of it),
 * `shown` the sheet's size on screen (only the box's minimum size depends
 * on it), `pane` the notes pane the capture is landed on. NOTHING LEAVES THE
 * SHEET, whichever way it is brought in (Sean, 2026-10-06: "don't clear from the
 * drawing screen when bringing contents into the notebook"): Clear and Erase are
 * how writing goes. The paper is in the Page picture and nowhere else.
 *
 * CELL is Writing for a new drawing cell (the box's "Bring in as Drawing Cell", BoxActions.tsx): the same strokes at
 * the same size, with the box landed beside them (`frame`: the cell is the box), but no flow-chart reader (a cell holds
 * ink) and no nudge (nothing lands on the page to step aside from).
 */
export async function takeFromSheet(mode: "ink" | "page" | "cell", options: {
  box: Rect | null
  shown: Size
  pane: Size
  penColour: string
  penWidth: number
  paper: Paper
}): Promise<SheetTake> {
  const { box, shown, pane, penColour, penWidth, paper } = options
  // The OPEN sheet, as it is now: switching tabs while the reader works does not move what was taken.
  const sheet = currentSheet()
  if (shown.width <= 0 || shown.height <= 0) return { trouble: "no sheet to take from" }
  if (sheet.strokes.length === 0) return { trouble: "nothing written yet" }
  const region = regionOfSheetBox(box, shown)
  if (!region) return { trouble: "that box is not on the sheet" }
  const parts = splitByRegion(sheet.strokes, region)
  if (parts.inside.length === 0) return { trouble: "nothing written in that box" }

  // The page arithmetic runs on the sheet in REFERENCE units, so it is the
  // same whatever size the sheet was shown at when it was written.
  const units = sheetUnits(sheet.aspect)
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
    const picture = renderSheetPicture(parts.inside, paper, units, pageSize, onPage, region, scale)
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
  const cell = mode === "cell"
  const where = placement({ frame: frameOnPage, pageSize, pane, nudge: cell ? 0 : learned.nudge })
  if (!cell) learned.nudge = (learned.nudge + 0.02) % 0.1
  const aspect = frameOnPage.height / Math.max(1, frameOnPage.width)
  const strokes = mode !== "page"
    ? landStrokes(parts.inside, { surface: units, pageSize, frame: frameOnPage, where, pane })
    : undefined
  if (cell) {
    // The box landed as the strokes are (the same page scale, no nudge): the cell's frame.
    const frame = landedFrame(onPage, pageSize, pane)
    return { read: null, capture: { strokes: strokes!, center: where.center, width: where.width, aspect, frame } }
  }

  // The nodes of a chart are labelled with the words the machine's text reader
  // finds in the sheet (only a sheet that holds a chart is ever sent to it).
  // (A chart that cannot be read must not lose the capture.)
  const chart = await sheetChartLabelled(parts.inside, pageSize, onPage, frameOnPage, scale, pane, penColour, penWidth,
    bandUnder(where.center, where.width, aspect, pane), (canvas) => wordsForChart(canvas)).catch(() => [])
  const read = chartSummary(chart)
  return {
    read,
    capture: {
      ...(blob ? { blob } : {}),
      ...(strokes ? { strokes } : {}),
      center: where.center, width: where.width, aspect,
      ...(chart.length > 0 ? { chart } : {}),
    },
  }
}

/**
 * The box's Erase: what is inside the box rubbed off the OPEN sheet, by the Writing capture's own rule
 * (boxRow.ts `eraseRegion`), as ONE undo step on the sheet. The box stays. A trouble when there was nothing to rub out.
 */
export function eraseFromSheet(box: Rect | null, shown: Size): { trouble: string } | { removed: number } {
  const sheet = currentSheet()
  const region = regionOfSheetBox(box, shown)
  if (!region) return { trouble: "that box is not on the sheet" }
  const out = eraseRegion(sheet.strokes, region)
  if (out.removed === 0) return { trouble: "nothing written in that box" }
  sheet.replace(out.strokes)
  return { removed: out.removed }
}

// (End-to-end scripts read the open sheet as `window.__wmSheet`: tabletSheets.ts.)
