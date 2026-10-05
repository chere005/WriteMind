/**
 * The picture reader, as the renderer asks for it. Nothing here blocks the
 * page: the reading is done by a program in the main process, and the work
 * that is ours (lifting the ink, painting out a printed dot grid, putting the
 * reading together) is cut up so the page can paint between the pieces.
 *
 * THREE CALLERS, ONE ENGINE (and the main process reads a picture only once):
 *   - the Aa handle on a picture: `readPictureLines` - the markdown, with the
 *     Mac's struck / ringed / arrow / checkbox / maths rules;
 *   - the flow-chart reader: `wordsForChart` - the words of a capture, boxed,
 *     so a node arrives labelled;
 *   - the tablet / camera captures, which reach the chart reader through it.
 * Each returns null / [] rather than throwing when there is no reader, the
 * reader fails, or the request is taken back (an AbortSignal).
 */

import {
  composeLines, flowWordsFrom, paintOutDots, readingPageOf, GRID_SEARCH_WIDTH,
  type FlowWord, type OcrReading, type ReadingPage,
} from "@writemind/core"

let counter = 0
const nextId = (): string => `ocr-${Date.now().toString(36)}-${(counter += 1)}`

let available: Promise<boolean> | null = null

/** Whether this machine has a reader (asked once; the shell decides, see main/helpers.ts). */
export function ocrAvailable(): Promise<boolean> {
  return (available ??= (async () => {
    try { return (await window.wm.capabilities()).handwritingOCR === true } catch { return false }
  })())
}

/** Let the page paint before the next piece of work. */
const breathe = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(resolve, 0))
  else setTimeout(resolve, 0)
})

const cancelled = (signal?: AbortSignal): boolean => signal?.aborted === true

/**
 * Ask the main process for a reading. Taken back when `signal` aborts: the
 * engine is stopped if nobody else wants the same picture.
 */
export async function ask(request: { file?: string; bytes?: Uint8Array; languages?: string[] },
  signal?: AbortSignal, deadlineMs?: number): Promise<OcrReading | null> {
  if (cancelled(signal)) return null
  const id = nextId()
  const stop = () => { void window.wm.ocrCancel(id).catch(() => undefined) }
  signal?.addEventListener("abort", stop, { once: true })
  // A reader that never answers (a hung PowerShell) must not hold a capture for the main process's own minute:
  // past the deadline the request is taken back and the caller goes on without a reading.
  let late = false
  const timer = deadlineMs ? setTimeout(() => { late = true; stop() }, deadlineMs) : null
  try {
    return await window.wm.ocrRead({ id, ...request })
  } catch (error) {
    if (late) { console.warn("WriteMind: the picture reader did not answer in time"); return null }
    if (!cancelled(signal) && (error as { name?: string }).name !== "AbortError"
      && !String((error as Error).message ?? error).includes("cancelled")) {
      console.warn("WriteMind: the picture reader failed:", (error as Error).message ?? error)
    }
    return null
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener("abort", stop)
  }
}

/** How long a capture waits for the reader's words (labels for a chart, a box read as text) before going without. */
export const CAPTURE_READ_DEADLINE_MS = 8000

/** A canvas as PNG bytes, ready to send. */
export async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** Paper first, then the picture: transparent pixels must not read as black. */
function onWhite(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })!
  context.fillStyle = "#fff"
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  return canvas
}

/** The most pixels a side of the picture handed to the reader has. */
const READER_SIDE = 3200

export interface Prepared {
  /** What goes to the reader: the picture on white, a printed dot grid painted out. */
  canvas: HTMLCanvasElement
  /** True when a grid was found and removed (so the file on disk is not what is read). */
  cleaned: boolean
  /** The ink, sorted into blobs - what the marks are read from. Null for a picture too small. */
  page: ReadingPage | null
}

/**
 * The picture made ready to read: flattened onto white, its ink found, and a
 * printed dot grid (Sean, 2026-09-19: "make sure to ignore the dots") painted
 * out in the paper's own colour so a row of dots never arrives as text.
 */
export async function prepareForReading(source: CanvasImageSource, width: number, height: number,
  signal?: AbortSignal): Promise<Prepared | null> {
  if (width < 2 || height < 2) return null
  const scale = Math.min(1, READER_SIDE / Math.max(width, height))
  const w = Math.max(2, Math.round(width * scale)), h = Math.max(2, Math.round(height * scale))
  const canvas = onWhite(source, w, h)
  await breathe()
  if (cancelled(signal)) return null

  // The ink is looked for at most GRID_SEARCH_WIDTH across: a grid is just as
  // visible at that size as at 4000 pixels, and the search is quadratic.
  const sm = Math.min(1, GRID_SEARCH_WIDTH / w)
  const mw = Math.max(2, Math.round(w * sm)), mh = Math.max(2, Math.round(h * sm))
  const small = sm < 1 ? onWhite(canvas, mw, mh) : canvas
  const smallPixels = small.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, mw, mh).data
  const gray = new Uint8Array(mw * mh)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.299 * smallPixels[i * 4]! + 0.587 * smallPixels[i * 4 + 1]! + 0.114 * smallPixels[i * 4 + 2]!)
  }
  await breathe()
  if (cancelled(signal)) return null
  const page = readingPageOf(gray, mw, mh)
  if (!page) return { canvas, cleaned: false, page: null }

  await breathe()
  if (cancelled(signal)) return null
  const context = canvas.getContext("2d", { willReadFrequently: true })!
  const image = context.getImageData(0, 0, w, h)
  const cleaned = paintOutDots(image.data, w, h, gray, page)
  if (cleaned) context.putImageData(image, 0, 0)
  return { canvas, cleaned, page }
}

/**
 * Load a note's picture (served by the app's own scheme) as something drawable.
 * An <img>, as the drawing layer loads it: `fetch` of that scheme is refused to
 * a page loaded from a file, an image is not, and CORS is on so the pixels can be read.
 */
function loadPicture(file: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => resolve(image.naturalWidth > 0 ? image : null)
    image.onerror = () => resolve(null)
    image.src = `wm://media/${encodeURIComponent(file)}`
  })
}

/**
 * The words in a note's picture as lines of markdown - the Mac's rules: a
 * struck word as ~~struck~~, a ringed one bold, a drawn arrow as an arrow, a
 * box at the head of a line as a task, a line of algebra as this app's maths.
 * Empty when nothing could be read; null when the request was taken back.
 */
export async function readPictureLines(file: string, signal?: AbortSignal): Promise<string[] | null> {
  return (await readPictureResult(file, signal))?.lines ?? null
}

/** `readPictureLines` that also says whether the reader FAILED (no answer at all) as against reading nothing. */
export async function readPictureResult(file: string, signal?: AbortSignal):
Promise<{ lines: string[]; failed: boolean } | null> {
  const picture = await loadPicture(file)
  if (!picture) {
    // The file could not be drawn here; the reader can still try it as it is.
    const plain = await ask({ file }, signal)
    if (cancelled(signal)) return null
    return plain ? { lines: composeLines(plain, null), failed: false } : { lines: [], failed: true }
  }
  const prepared = await prepareForReading(picture, picture.naturalWidth, picture.naturalHeight, signal)
  if (cancelled(signal)) return null
  let reading: OcrReading | null
  // What goes is the picture AS THE PAGE SHOWS IT: upright (a phone photo carries its turn in an EXIF tag the
  // reader ignores), flattened on white (a transparent PNG with dark writing is otherwise black on black), a printed
  // grid painted out, an SVG (which no reader decodes) drawn. The marks are read off this same canvas, so the
  // boxes and the ink agree. Only a picture the page cannot draw at all is handed over as the file.
  if (prepared) {
    const bytes = await pngBytes(prepared.canvas)
    reading = bytes ? await ask({ bytes }, signal) : await ask({ file }, signal)
  } else {
    reading = await ask({ file }, signal)
  }
  if (cancelled(signal)) return null
  if (!reading) return { lines: [], failed: true }
  await breathe()
  return { lines: composeLines(reading, prepared?.page ?? null), failed: false }
}

/**
 * The words in a picture that has not been saved (a box of the camera's page), as lines of markdown with
 * the same rules as `readPictureLines`. Empty when nothing could be read; null when taken back.
 */
export async function readCanvasLines(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<string[] | null> {
  const prepared = await prepareForReading(canvas, canvas.width, canvas.height, signal)
  if (cancelled(signal)) return null
  const bytes = await pngBytes(prepared?.canvas ?? canvas)
  const reading = bytes ? await ask({ bytes }, signal, CAPTURE_READ_DEADLINE_MS) : null
  if (cancelled(signal)) return null
  if (!reading) return []
  await breathe()
  return composeLines(reading, prepared?.page ?? null)
}

/**
 * The picture with the drawn SHAPES rubbed out: the outlines of boxes and the
 * arrows joining them, which a text reader mistakes for part of the words
 * (Windows' engine reads a box with a thick pen line round it as nothing at
 * all, and the words in it with it). An outline is a mark that is big in BOTH
 * directions with little ink in it, or a long thin line; a word, however
 * long, is short. The reading still has the words' own boxes - they were
 * never touched - so a node is labelled by the words inside it as before.
 */
export function withoutOutlines(canvas: HTMLCanvasElement, page: ReadingPage): HTMLCanvasElement {
  const out = document.createElement("canvas")
  out.width = canvas.width
  out.height = canvas.height
  const context = out.getContext("2d", { willReadFrequently: true })!
  context.drawImage(canvas, 0, 0)
  const image = context.getImageData(0, 0, out.width, out.height)
  const sx = out.width / page.width, sy = out.height / page.height
  const wide = page.width * 0.12, tall = page.height * 0.12, long = Math.max(page.width, page.height) * 0.2
  const grow = Math.max(1, Math.ceil(Math.max(sx, sy)))
  let any = false
  for (const blob of page.marks.components) {
    const w = blob.maxX - blob.minX + 1, h = blob.maxY - blob.minY + 1
    const fill = blob.pixels.length / (w * h)
    const outline = (w > wide && h > tall && fill < 0.3) || (Math.max(w, h) > long && Math.min(w, h) <= 6)
    if (!outline) continue
    any = true
    for (const pixel of blob.pixels) {
      const px = Math.floor((pixel % page.width) * sx) - 1, py = Math.floor(Math.floor(pixel / page.width) * sy) - 1
      for (let dy = 0; dy < grow + 2; dy++) {
        const yy = py + dy
        if (yy < 0 || yy >= out.height) continue
        for (let dx = 0; dx < grow + 2; dx++) {
          const xx = px + dx
          if (xx < 0 || xx >= out.width) continue
          const at = (yy * out.width + xx) * 4
          image.data[at] = image.data[at + 1] = image.data[at + 2] = 255
        }
      }
    }
  }
  if (!any) return canvas
  context.putImageData(image, 0, 0)
  return out
}

/**
 * The words of a captured picture for the flow-chart reader: each word's box
 * in the PIXELS of `canvas`, so a node can be labelled with the words inside
 * it. [] when there is no reader or it found nothing.
 */
export async function wordsForChart(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<FlowWord[]> {
  if (!(await ocrAvailable()) || cancelled(signal)) return []
  const prepared = await prepareForReading(canvas, canvas.width, canvas.height, signal)
  if (!prepared) return []
  const forReading = prepared.page ? withoutOutlines(prepared.canvas, prepared.page) : prepared.canvas
  const bytes = await pngBytes(forReading)
  if (!bytes || cancelled(signal)) return []
  const reading = await ask({ bytes }, signal, CAPTURE_READ_DEADLINE_MS)
  return reading ? flowWordsFrom(reading, { width: canvas.width, height: canvas.height }) : []
}

// End-to-end scripts (WRITEMIND_E2E, whose preload adds `e2eWindow`) look inside the reading;
// nothing else does.
if (typeof window !== "undefined" && (window as unknown as { wm?: { e2eWindow?: unknown } }).wm?.e2eWindow) {
  ;(window as unknown as Record<string, unknown>).__wmOcr = { prepareForReading, readPictureLines, readPictureResult, wordsForChart, composeLines, ask, withoutOutlines }
}
