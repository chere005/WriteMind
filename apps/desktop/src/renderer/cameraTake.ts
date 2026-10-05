/**
 * Taking a picture off the camera: the Mac's `NotebookCapture.capture`, with no
 * React in it. The frame is already upright (the pane turned it); what comes
 * out is the bytes to put on the drawing layer and where they sit on the page.
 *
 *   frame ─▶ the page found (or the four corners dragged by hand) ─▶ squared up
 *         ─▶ resampled to the notebook's page shape, its edge trimmed ─▶
 *   WRITING: the ink lifted off the whole page, the box's part of it traced into outlines (SVG)
 *   PAGE:    the box's part of the page, as a picture
 *   RAW:     the frame, or the box's part of it, as the camera saw it
 *
 * The ink is lifted off the WHOLE page and the section only picks which of it
 * comes in, as on the Mac: a stroke that runs across the box is not "the page
 * edge" just because the box is small.
 */

import {
  darkerThanPaper, EDGE_INSET, findPage, inkVector, isPlausiblePage, marks, pageBox, quadFromPixels, resolveShape, shapeSize,
  writingBox, writingMask, type Rect, type Size,
} from "@writemind/core"
import { grayOf, measuredPage, straightened, type Corners } from "./capturePipeline"
import type { CaptureMode } from "./cameraSettings"

/** The longest side of the picture the page finder looks at: it is cheap at this size and no less sure. */
const FINDER_SIDE = 960

/** A page found in the frame, in the frame's own pixels (y down). */
export interface DetectedPage {
  corners: Corners
  confidence: number
  /** The page's share of the frame. */
  coverage: number
  method: "segmentation" | "lines"
}

/** Where the page is in `picture`, or null: nothing page-shaped, or the page IS the frame. */
export function detectPage(picture: CanvasImageSource, frame: Size): DetectedPage | null {
  if (frame.width < 16 || frame.height < 16) return null
  const scale = Math.min(1, FINDER_SIDE / Math.max(frame.width, frame.height))
  const w = Math.max(16, Math.round(frame.width * scale)), h = Math.max(16, Math.round(frame.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext("2d", { willReadFrequently: true })!
  context.drawImage(picture, 0, 0, w, h)
  const found = findPage(context.getImageData(0, 0, w, h).data, w, h)
  if (!found) return null
  const back = (p: { x: number; y: number }) => ({ x: p.x * frame.width / w, y: p.y * frame.height / h })
  return {
    corners: {
      topLeft: back(found.corners.topLeft), topRight: back(found.corners.topRight),
      bottomRight: back(found.corners.bottomRight), bottomLeft: back(found.corners.bottomLeft),
    },
    confidence: found.confidence, coverage: found.coverage, method: found.method,
  }
}

export interface TakeOptions {
  mode: CaptureMode
  /** The upright picture, and its size in pixels. */
  picture: CanvasImageSource
  frame: Size
  /** The box dragged on it, as fractions of the picture (top-left origin), or null for all of it. */
  region: Rect | null
  /** The page's corners as dragged by hand ("Straighten"), in frame pixels, or null to look for the page. */
  corners: Corners | null
  /** The notebook's page shape so far (long side over short), or null. */
  rememberedShape: number | null
  /** `#rrggbb`: the writing is brought in in this. */
  colour: string
}

export type Taken =
  | { trouble: string }
  | {
    blob: Blob
    /** The normalised page, in its pixels. */
    pageSize: Size
    /** The picture's box on that page (page pixels, top-left origin): the whole page, the box, or the writing's. */
    frameOnPage: Rect
    /** What the chart reader and the text reader are given: the box's part of the page, as pixels. */
    cut: HTMLCanvasElement
    /** The page's shape if a page was found (worth remembering), else null. */
    learnedShape: number | null
    pageFound: boolean
    /** How the page was found, for the note under the viewfinder. */
    how: "hand" | "segmentation" | "lines" | null
    /** The writing came in as outlines (an SVG) rather than pixels. */
    vector: boolean
  }

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality))

const whole = (canvas: HTMLCanvasElement): Rect => ({ x: 0, y: 0, width: canvas.width, height: canvas.height })

function cropped(source: HTMLCanvasElement | CanvasImageSource, area: Rect): HTMLCanvasElement {
  const x = Math.round(area.x), y = Math.round(area.y)
  const w = Math.max(1, Math.round(area.width)), h = Math.max(1, Math.round(area.height))
  const cut = document.createElement("canvas")
  cut.width = w
  cut.height = h
  cut.getContext("2d", { willReadFrequently: true })!.drawImage(source, x, y, w, h, 0, 0, w, h)
  return cut
}

export async function takePicture(options: TakeOptions): Promise<Taken> {
  const { mode, picture, frame, region } = options

  // THE RAW PICTURE: the frame as the camera sees it, or the box's part of it.
  if (mode === "raw") {
    const area: Rect = region
      ? {
        x: Math.round(region.x * frame.width), y: Math.round(region.y * frame.height),
        width: Math.round(region.width * frame.width), height: Math.round(region.height * frame.height),
      }
      : { x: 0, y: 0, width: frame.width, height: frame.height }
    if (area.width < 2 || area.height < 2) return { trouble: "There is no camera picture to take." }
    const cut = cropped(picture, area)
    const blob = await blobOf(cut, "image/jpeg", 0.9)
    if (!blob) return { trouble: "There is no camera picture to take." }
    const size = { width: cut.width, height: cut.height }
    return {
      blob, pageSize: size, frameOnPage: { x: 0, y: 0, ...size }, cut,
      learnedShape: null, pageFound: false, how: null, vector: false,
    }
  }

  // THE PAGE: dragged by hand, or found by itself.
  let corners = options.corners
  let how: "hand" | "segmentation" | "lines" | null = corners ? "hand" : null
  if (!corners) {
    const found = detectPage(picture, frame)
    if (found) { corners = found.corners; how = found.method }
  }

  /** The page the picture is cut from: squared up when a page was found, else the frame itself. */
  let work: HTMLCanvasElement
  let pageSize: Size
  let inset = 0
  let section: Rect
  let learnedShape: number | null = null
  if (corners && how === "hand" && !isPlausiblePage(corners)) {
    return { trouble: "Those corners do not make a page - drag them onto the page's four corners." }
  }
  if (corners) {
    const measured = measuredPage(corners, frame)
    const shape = resolveShape(measured.ratio, options.rememberedShape)
    learnedShape = shape.ratio
    pageSize = shapeSize(shape, measured.portrait)
    inset = EDGE_INSET
    work = straightened(picture, frame, corners, pageSize, inset)
    if (region) {
      const box = pageBox({
        region, quad: quadFromPixels(corners, frame.height),
        frame: { x: 0, y: 0, width: frame.width, height: frame.height }, inset, pageSize,
      })
      if (!box) return { trouble: "That box is not on the page." }
      section = box
    } else {
      section = { x: 0, y: 0, width: pageSize.width, height: pageSize.height }
    }
  } else {
    // No page: the frame stands in for one (so the placement arithmetic still applies), and a shape
    // measured off it is not worth remembering.
    const portrait = frame.height >= frame.width
    const ratio = Math.max(frame.width, frame.height) / Math.max(1, Math.min(frame.width, frame.height))
    pageSize = shapeSize(resolveShape(ratio, options.rememberedShape), portrait)
    work = document.createElement("canvas")
    work.width = Math.max(1, Math.round(frame.width))
    work.height = Math.max(1, Math.round(frame.height))
    work.getContext("2d", { willReadFrequently: true })!.drawImage(picture, 0, 0, work.width, work.height)
    section = region
      ? {
        x: Math.round(region.x * work.width), y: Math.round(region.y * work.height),
        width: Math.max(1, Math.round(region.width * work.width)),
        height: Math.max(1, Math.round(region.height * work.height)),
      }
      : whole(work)
    // The section is in the work canvas pixels here; the page units come back below.
  }
  /** Page pixels per pixel of `work`. */
  const toPage = pageSize.width / work.width
  const inPage = (area: Rect): Rect => ({
    x: area.x * toPage, y: area.y * toPage, width: area.width * toPage, height: area.height * toPage,
  })

  const cut = cropped(work, section)
  if (mode === "page") {
    const blob = await blobOf(cut, "image/jpeg", 0.9)
    if (!blob) return { trouble: "There is no page to take." }
    return {
      blob, pageSize, frameOnPage: inPage(section), cut,
      learnedShape, pageFound: corners !== null, how, vector: false,
    }
  }

  // THE WRITING, lifted off the whole page; only the box's part of it comes in.
  const gray = work.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, work.width, work.height)
  const found = marks(darkerThanPaper(grayOf(gray.data, work.width * work.height), work.width, work.height), work.width, work.height)
  const mask = writingMask(found)
  const inked = writingBox(found, 6, region ? section : undefined)
  if (!inked) return { trouble: region ? "No writing found in that section." : "No writing found on the page. Move the notebook into the frame and try again." }

  // Outlines first; a graphic that cannot be traced (or is too faint to) falls back to the picture.
  const traced = inkVector(mask, work.width, work.height, inked, options.colour)
  // A page of dense writing traces to megabytes of outlines: past a sane size the picture is kept instead.
  const svg = traced && traced.length < 6_000_000 ? traced : null
  let blob: Blob | null = svg ? new Blob([svg], { type: "image/svg+xml" }) : null
  if (!blob) {
    const out = document.createElement("canvas")
    out.width = inked.width
    out.height = inked.height
    const ink = out.getContext("2d")!
    const image = ink.createImageData(inked.width, inked.height)
    const colour = options.colour.replace("#", "")
    const cr = parseInt(colour.slice(0, 2), 16), cg = parseInt(colour.slice(2, 4), 16), cb = parseInt(colour.slice(4, 6), 16)
    for (let y = 0; y < inked.height; y++) {
      for (let x = 0; x < inked.width; x++) {
        if (!mask[(inked.y + y) * work.width + inked.x + x]) continue
        const to = (y * inked.width + x) * 4
        image.data[to] = cr
        image.data[to + 1] = cg
        image.data[to + 2] = cb
        image.data[to + 3] = 255
      }
    }
    ink.putImageData(image, 0, 0)
    blob = await blobOf(out, "image/png")
  }
  if (!blob) return { trouble: "No writing found on the page." }
  return {
    blob, pageSize, frameOnPage: inPage(inked), cut,
    learnedShape, pageFound: corners !== null, how, vector: svg !== null,
  }
}
