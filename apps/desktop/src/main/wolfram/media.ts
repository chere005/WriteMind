/**
 * The files a note's drawings and pictures are, found and read for the Wolfram export and a copy into Mathematica:
 * each picture line's file (`resolvePictures`), and the pictures inside a drawing put INTO its svg (`inlineMedia`) so
 * the svg is whole wherever it goes — the engine, and the cell that imports it when there is no engine.
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * No Electron in here: the main process hands in its file reads and `nativeImage` (main.ts), the tests their fakes.
 */

import path from "node:path"
import {
  inlineSvgPictures, pictureKey, pictureSvg, positioned, shownAt, svgPictures,
  type ResolvedPicture, type WolframMedia, type WolframPlan,
} from "@writemind/core"

export interface MediaDeps {
  /** A media file of the note's project by name (`findMedia`), or null when it is not there. */
  findMedia(name: string): Promise<string | null>
  /** Whether a file is there, and its stamp for the cache (`mtimeMs:size`); null when it is not. */
  stat(file: string): Promise<{ mtimeMs: number; size: number } | null>
  readFile(file: string): Promise<Uint8Array>
  /** A Mac capture that is a one-page PDF, as the svg of its paths (pdfPicture.ts), or null. */
  pdfPicture(file: string): Promise<{ svg: string; width: number; height: number } | null>
  /**
   * A bitmap in any format the system reads (`nativeImage`), as a PNG no wider than `maxWidth` (null: as it is), with
   * the width it had; null when it cannot be read.
   */
  bitmap(file: string, maxWidth: number | null): Promise<{ png: Uint8Array; width: number } | null>
  /** A PNG written where the engine can import it from (a temp file), and its path. */
  tempPng(bytes: Uint8Array): Promise<string>
}

const FORMATS: Record<string, "PNG" | "JPEG" | "GIF" | "SVG"> = { ".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".gif": "GIF", ".svg": "SVG" }
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml" }

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
const svgUrl = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`

/** Where a picture line's path is on disk: its media file, else a path of its own (beside the note when relative). */
async function pictureFile(block: { file: string | null; path: string }, deps: MediaDeps, noteFolder: string | null): Promise<string | null> {
  if (block.file !== null) return deps.findMedia(block.file)
  const written = block.path.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(written) && !/^[a-z]:[\\/]/i.test(written)) return null
  const file = path.isAbsolute(written) ? written : noteFolder ? path.resolve(noteFolder, written) : null
  return file && (await deps.stat(file)) ? file : null
}

/**
 * Each picture line's picture (by `pictureKey`; null: not there), and each found file's stamp by its path. A drawing
 * cell's line needs nothing when its ink is in `media`; a picture on the web is fetched by nobody. Bitmaps the
 * engine may not import by their extension (WebP, HEIC…) go to it as a temporary PNG (`temps`, removed after).
 */
export async function resolvePictures(markdown: string, media: WolframMedia, deps: MediaDeps, noteFolder: string | null):
  Promise<{ pictures: Map<string, ResolvedPicture | null>; stamps: Map<string, string>; temps: string[] }> {
  const pictures = new Map<string, ResolvedPicture | null>()
  const stamps = new Map<string, string>()
  const temps: string[] = []
  for (const { block } of positioned(markdown)) {
    if (block.kind !== "picture") continue
    if (block.ink !== null && media.inks[block.ink]) continue
    const key = pictureKey(block)
    if (pictures.has(key) || (block.file === null && /^https?:/i.test(block.path))) continue
    const file = await pictureFile(block, deps, noteFolder)
    const stat = file ? await deps.stat(file) : null
    if (!file || !stat) { pictures.set(key, null); continue }
    const extension = path.extname(file).toLowerCase()
    if (extension === ".pdf") {
      const picture = await deps.pdfPicture(file).catch(() => null)
      pictures.set(key, picture
        ? { kind: "svg", svg: pictureSvg(svgUrl(picture.svg), picture.width, picture.height, Math.min(media.column, picture.width)) }
        : null)
      continue
    }
    const format = FORMATS[extension]
    if (format) {
      pictures.set(key, { kind: "file", path: file, format })
      stamps.set(file, `${stat.mtimeMs}:${stat.size}`)
      continue
    }
    const converted = await deps.bitmap(file, null).catch(() => null)
    if (!converted) { pictures.set(key, null); continue }
    const temp = await deps.tempPng(converted.png)
    temps.push(temp)
    pictures.set(key, { kind: "file", path: temp, format: "PNG" })
    stamps.set(temp, `${stat.mtimeMs}:${stat.size}:${file}`)
  }
  return { pictures, stamps, temps }
}

/**
 * A picture inside a drawing as a `data:` URL, or null when it is not there. A bitmap much bigger than it is drawn
 * (more than twice its drawn width: the engine renders at 144 dpi, two pixels a point) is shrunk to that first, so a
 * twelve-megapixel photo dropped into a drawing does not ride along at full size.
 */
async function pictureUrl(name: string, drawnWidth: number, deps: MediaDeps): Promise<string | null> {
  const file = await deps.findMedia(name)
  if (!file || !(await deps.stat(file))) return null
  const extension = path.extname(file).toLowerCase()
  if (extension === ".pdf") {
    const picture = await deps.pdfPicture(file).catch(() => null)
    return picture ? svgUrl(picture.svg) : null
  }
  if (extension === ".svg") return svgUrl(Buffer.from(await deps.readFile(file)).toString("utf8"))
  const want = Math.max(1, Math.ceil(drawnWidth * 2))
  const mime = MIME[extension]
  if (mime) {
    const shrunk = await deps.bitmap(file, want).catch(() => null)
    if (shrunk && shrunk.width > want) return `data:image/png;base64,${base64(shrunk.png)}`
    return `data:${mime};base64,${base64(await deps.readFile(file))}`
  }
  const converted = await deps.bitmap(file, want).catch(() => null)
  return converted ? `data:image/png;base64,${base64(converted.png)}` : null
}

/** One svg with its pictures inside it. */
async function inlined(svg: string, deps: MediaDeps): Promise<string> {
  const wanted = svgPictures(svg)
  if (wanted.length === 0) return svg
  const urls = new Map<string, string | null>()
  for (const { name, width } of wanted) urls.set(name, await pictureUrl(name, width, deps).catch(() => null))
  return inlineSvgPictures(svg, (name) => urls.get(name) ?? null)
}

/** The page's drawings with every picture inside them inlined. */
export async function inlineMedia(media: WolframMedia, deps: MediaDeps): Promise<WolframMedia> {
  const inks: WolframMedia["inks"] = {}
  for (const [id, ink] of Object.entries(media.inks)) inks[id] = { svg: await inlined(ink.svg, deps), shown: shownAt(ink.shown) }
  const bands: WolframMedia["bands"] = []
  for (const band of media.bands) bands.push({ ...band, svg: await inlined(band.svg, deps), shown: shownAt(band.shown) })
  return { inks, bands, column: media.column }
}

/** The cache stamps of a plan's jobs, by job name: each picture job's file's (`resolvePictures`'s `stamps`). */
export function stampsFor(plan: WolframPlan, byFile: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const cell of plan.cells) {
    for (const piece of cell.pieces) {
      if (typeof piece === "string" || typeof piece.fallback === "string") continue
      const stamp = byFile.get(piece.fallback.picture)
      if (stamp) out.set(piece.job, stamp)
    }
  }
  return out
}

/** The picture files of a plan whose jobs went unanswered, each once: the bytes a notebook carries for them. */
export function unansweredPictures(plan: WolframPlan, answers: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>()
  for (const cell of plan.cells) {
    for (const piece of cell.pieces) {
      if (typeof piece === "string" || typeof piece.fallback === "string" || answers.get(piece.job)) continue
      out.add(piece.fallback.picture)
    }
  }
  return [...out]
}

export { base64 }
