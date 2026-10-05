/**
 * What happens to a frame between the camera and the drawing layer, with no
 * React in it so that it can be driven from a test with a canvas that was
 * drawn by hand instead of a webcam.
 *
 *   frame ─▶ (straightened through the page's corners) ─▶ the box's part ─▶
 *   the ink lifted off the paper ─▶ the picture, and a flow chart read off
 *   the same ink as real nodes and arrows.
 */

import {
  flowChartItems, inkMask, mayHoldChart, pageAspect, placeFlowItems, quadFromPixels, warpToPage,
  type CanvasItem, type FlowWord, type Rect, type Size,
} from "@writemind/core"
import { paintStrokes, type InkStroke } from "./tabletPage"

/** Luma of an RGBA image. */
export function grayOf(data: Uint8ClampedArray, pixels: number): Uint8Array {
  const gray = new Uint8Array(pixels)
  for (let index = 0; index < pixels; index++) {
    gray[index] = Math.round(0.299 * data[index * 4]! + 0.587 * data[index * 4 + 1]!
      + 0.114 * data[index * 4 + 2]!)
  }
  return gray
}

export interface Corners {
  topLeft: { x: number; y: number }
  topRight: { x: number; y: number }
  bottomRight: { x: number; y: number }
  bottomLeft: { x: number; y: number }
}

const length = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/** Long side over short side of the page the corners enclose, and whether it stands upright. */
export function measuredPage(corners: Corners, frame: Size): { ratio: number; portrait: boolean } {
  // The pinhole estimate first: the lengths of the edges of a TILTED page are
  // not its shape. Edge lengths are what is left when there is no perspective.
  const aspect = pageAspect(corners, frame)
  if (aspect !== null) return { ratio: Math.max(aspect, 1 / aspect), portrait: aspect <= 1 }
  const across = (length(corners.topLeft, corners.topRight) + length(corners.bottomLeft, corners.bottomRight)) / 2
  const down = (length(corners.topLeft, corners.bottomLeft) + length(corners.topRight, corners.bottomRight)) / 2
  return {
    ratio: Math.max(across, down) / Math.max(1, Math.min(across, down)),
    portrait: down >= across,
  }
}

/**
 * The frame squared up through `corners` (the frame's own pixels, y DOWN)
 * into a canvas of `page` size. Perspective undone in the renderer — no
 * Core Image, no helper.
 */
export function straightened(frame: CanvasImageSource, frameSize: Size, corners: Corners,
  page: Size, inset: number): HTMLCanvasElement {
  const source = document.createElement("canvas")
  source.width = frameSize.width
  source.height = frameSize.height
  const context = source.getContext("2d", { willReadFrequently: true })!
  context.drawImage(frame, 0, 0, frameSize.width, frameSize.height)
  const pixels = context.getImageData(0, 0, frameSize.width, frameSize.height)
  const quad = quadFromPixels(corners, frameSize.height)
  const out = warpToPage(pixels.data, frameSize.width, frameSize.height, quad, page, inset)
  const result = document.createElement("canvas")
  result.width = Math.round(page.width)
  result.height = Math.round(page.height)
  result.getContext("2d")!.putImageData(
    new ImageData(out, result.width, result.height), 0, 0)
  return result
}

/**
 * The tablet's strokes drawn onto a canvas of the cut's size: the box
 * `onPage` (page pixels) of a page of `pageSize`, on white paper. `colour`
 * forces one ink (black, for the readers); without it each stroke keeps its
 * own (the Page picture). `scale` is page pixels per sheet point. `margin` is
 * blank paper added round the cut: the reader throws away ink on the very edge
 * of a picture as the page's own edge, and a sheet is written right up to it.
 */
export function renderSheet(strokes: InkStroke[], pageSize: Size, onPage: Rect, scale: number,
  colour?: string, margin = 0): HTMLCanvasElement {
  const cut = document.createElement("canvas")
  cut.width = Math.max(1, Math.round(onPage.width)) + 2 * margin
  cut.height = Math.max(1, Math.round(onPage.height)) + 2 * margin
  const context = cut.getContext("2d", { willReadFrequently: true })!
  context.fillStyle = "#fff"
  context.fillRect(0, 0, cut.width, cut.height)
  paintStrokes(context, strokes, (point) => ({
    x: point.x * pageSize.width - onPage.x + margin, y: point.y * pageSize.height - onPage.y + margin,
  }), scale, colour)
  return cut
}

/** The most pixels a side of the picture the flow chart is read from has. */
const READING_SIDE = 1200

/**
 * A flow chart sketched or photographed on `cut`, as the shapes and arrows
 * it is — or an empty list, which is what a page of prose gives. The ink is
 * lifted off the paper by the core's own pipeline (specks, the page edge and
 * the printed dot grid are already gone from the mask), at a size the
 * reading is quick at; the objects come back in fractions of `pane`, landed
 * in `landing` (a band under the picture they were read from).
 */
export function chartFrom(cut: CanvasImageSource, cutSize: Size, words: FlowWord[],
  pane: Size, colourHex: string, lineWidth: number, landing: Rect | null): CanvasItem[] {
  return chartOnInk(readingInk(cut, cutSize), words, pane, colourHex, lineWidth, landing)
}

/** The writing of a picture as the chart reader sees it: lifted off the paper at a size the reading is quick at. */
interface ReadingInk { mask: Uint8Array; w: number; h: number; scale: number }

/**
 * `source` drawn at `w`×`h`, halved in steps while it is more than twice as big. One big step of a canvas's bilinear
 * scaling samples only some of the pixels under each new one, so a pen line a few pixels thick breaks up into dashes and
 * the chart reader loses a box; halving averages every pixel in.
 */
function shrunk(source: CanvasImageSource, from: Size, w: number, h: number): HTMLCanvasElement {
  let current: CanvasImageSource = source
  let cw = Math.max(1, Math.round(from.width)), ch = Math.max(1, Math.round(from.height))
  while (cw >= 2 * w && ch >= 2 * h) {
    const step = document.createElement("canvas")
    step.width = Math.max(w, Math.floor(cw / 2))
    step.height = Math.max(h, Math.floor(ch / 2))
    const stepContext = step.getContext("2d", { willReadFrequently: true })!
    stepContext.imageSmoothingQuality = "high"
    stepContext.drawImage(current, 0, 0, step.width, step.height)
    current = step
    cw = step.width
    ch = step.height
  }
  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const context = out.getContext("2d", { willReadFrequently: true })!
  context.imageSmoothingQuality = "high"
  context.drawImage(current, 0, 0, w, h)
  return out
}

function readingInk(cut: CanvasImageSource, cutSize: Size): ReadingInk {
  const scale = Math.min(1, READING_SIDE / Math.max(cutSize.width, cutSize.height))
  const w = Math.max(9, Math.round(cutSize.width * scale))
  const h = Math.max(9, Math.round(cutSize.height * scale))
  const small = shrunk(cut, cutSize, w, h)
  const context = small.getContext("2d", { willReadFrequently: true })!
  const gray = grayOf(context.getImageData(0, 0, w, h).data, w * h)
  return { mask: inkMask(gray, w, h), w, h, scale }
}

function chartOnInk(ink: ReadingInk, words: FlowWord[], pane: Size, colourHex: string, lineWidth: number,
  landing: Rect | null): CanvasItem[] {
  const { mask, w, h, scale } = ink
  const found = flowChartItems(mask, w, h,
    words.map((word) => ({ text: word.text, box: {
      x: word.box.x * scale, y: word.box.y * scale,
      width: word.box.width * scale, height: word.box.height * scale } })),
    pane, colourHex, lineWidth)
  if (found.length === 0 || !landing) return found
  return placeFlowItems(found, landing, pane)
}

/** The words of a picture, boxed in ITS pixels - what labels a chart's nodes. */
export type LabelReader = (canvas: HTMLCanvasElement) => Promise<FlowWord[]>

/** A canvas holding `cut`, for the readers that want one. */
function canvasOf(cut: CanvasImageSource, size: Size): HTMLCanvasElement {
  if (typeof HTMLCanvasElement !== "undefined" && cut instanceof HTMLCanvasElement) return cut
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(size.width))
  canvas.height = Math.max(1, Math.round(size.height))
  canvas.getContext("2d")!.drawImage(cut, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * `chartFrom` with the NODES LABELLED. The shapes are found first, with no
 * words (a page of prose gives nothing, and then no reader is ever asked); only
 * a picture that holds a chart goes to the text reader, and the chart is then
 * read again with the words in hand (the Mac passes Vision's words in
 * from the start; asking only when there is something to label is what keeps
 * a reader that takes a few hundred milliseconds off every prose capture).
 * A reader that fails or finds nothing leaves the unlabelled chart, which is
 * what this was before.
 */
export async function chartFromLabelled(cut: CanvasImageSource, cutSize: Size, pane: Size, colourHex: string,
  lineWidth: number, landing: Rect | null, labels: LabelReader | null): Promise<CanvasItem[]> {
  const ink = readingInk(cut, cutSize)
  // No closed outline of a box's size: not a chart, and no reader is asked.
  if (!mayHoldChart(ink.mask, ink.w, ink.h)) return []
  let words: FlowWord[] = []
  if (labels) { try { words = await labels(canvasOf(cut, cutSize)) } catch { words = [] } }
  // The chart as ink alone has it - always read: words that are not words (an arrow head read as a letter) can make
  // the labelled reading lose a node, and then the ink's own reading is the better chart.
  const plain = chartOnInk(ink, [], pane, colourHex, lineWidth, landing)
  if (words.length > 0) {
    const labelled = chartOnInk(ink, words, pane, colourHex, lineWidth, landing)
    if (labelled.length > 0 && labelled.length >= plain.length) return labelled
  }
  return plain
}

/** What a capture says about the chart it read, or null when it read none. */
export function chartSummary(chart: CanvasItem[]): string | null {
  const nodes = chart.filter((item) => item.kind === "shape").length
  if (chart.length === 0) return null
  const named = labelledNodes(chart)
  return `Read a flow chart: ${nodes} ${nodes === 1 ? "node" : "nodes"}${named > 0 ? `, ${named} labelled` : ""}.`
}

/** How many of a chart's nodes arrived with a label. */
export const labelledNodes = (chart: CanvasItem[]): number =>
  chart.filter((item) => item.kind === "shape" && item.shape.label.trim() !== "").length

/**
 * The flow chart on the tablet's sheet. The reader is given what a camera
 * would give it — the whole box `region` (page pixels) as black ink on white
 * paper, with a blank margin round it because the reader drops ink on the very
 * edge as the page's edge — and the objects it finds are landed in `landing`,
 * the band under the capture, which is the size of `frame` (the ink's own
 * box, or the region again for a Page). The box the reader's 0…1 maps to is
 * worked out so a node ends up where the ink it was read from is in the frame.
 */
export function sheetChart(strokes: InkStroke[], pageSize: Size, region: Rect, frame: Rect,
  scale: number, pane: Size, colourHex: string, lineWidth: number, landing: Rect | null): CanvasItem[] {
  const margin = Math.round(Math.min(region.width, region.height) * 0.04) + 8
  const reading = renderSheet(strokes, pageSize, region, scale, "#000", margin)
  const found = chartFrom(reading, { width: reading.width, height: reading.height }, [], pane,
    colourHex, lineWidth, null)
  if (found.length === 0 || !landing) return found
  const fw = Math.max(1, frame.width), fh = Math.max(1, frame.height)
  return placeFlowItems(found, {
    x: landing.x + (region.x - margin - frame.x) / fw * landing.width,
    y: landing.y + (region.y - margin - frame.y) / fh * landing.height,
    width: (reading.width / fw) * landing.width,
    height: (reading.height / fh) * landing.height,
  }, pane)
}

/** `sheetChart` with the nodes labelled by the text reader (see `chartFromLabelled`). */
export async function sheetChartLabelled(strokes: InkStroke[], pageSize: Size, region: Rect, frame: Rect,
  scale: number, pane: Size, colourHex: string, lineWidth: number, landing: Rect | null,
  labels: LabelReader | null): Promise<CanvasItem[]> {
  const margin = Math.round(Math.min(region.width, region.height) * 0.04) + 8
  const reading = renderSheet(strokes, pageSize, region, scale, "#000", margin)
  const found = await chartFromLabelled(reading, { width: reading.width, height: reading.height }, pane,
    colourHex, lineWidth, null, labels)
  if (found.length === 0 || !landing) return found
  const fw = Math.max(1, frame.width), fh = Math.max(1, frame.height)
  return placeFlowItems(found, {
    x: landing.x + (region.x - margin - frame.x) / fw * landing.width,
    y: landing.y + (region.y - margin - frame.y) / fh * landing.height,
    width: (reading.width / fw) * landing.width,
    height: (reading.height / fh) * landing.height,
  }, pane)
}

/**
 * Where a picture of `width` (a fraction of the pane's width) and `aspect`
 * centred at `center` sits on the pane, in pane points, and the band of its
 * own size just under it that a chart read from it lands in.
 */
export function bandUnder(center: { x: number; y: number }, width: number, aspect: number,
  pane: Size): Rect {
  const w = width * pane.width
  const h = w * aspect
  const x = center.x * pane.width - w / 2
  const y = center.y * pane.height - h / 2
  return { x, y: Math.min(y + h + 12, pane.height - 40), width: w, height: h }
}
