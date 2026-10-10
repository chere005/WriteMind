/**
 * A Copy (or Cut) of held cells that include a drawing cell, made pastable into Mathematica AS THE IMAGE ITSELF (Sean,
 * 2026-10-06: "copying a drawing cell should be pastable as a wolfram graphics to a wolfram notebook… paste those as
 * images… through clipboard wizardry serve something i can paste to a notebook as the image itself rather than the
 * link"). The page has already written its words and its cells' markdown; this writes the clipboard again with the
 * front end's own cells beside them, once at once and once more when the kernel has answered.
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * THE WINDOW NEVER WAITS: this runs in the main process after the page's copy is done, and the kernel run is async.
 *
 * WRITEMIND'S OWN COPY ALWAYS WINS INSIDE WRITEMIND: every write keeps the page's plain text and its custom data
 * (`clipboardKeeps`) and adds beside them; nothing is written at all unless the clipboard still holds THIS copy (its
 * plain text, and no newer copy since); and the page takes no picture off a clipboard that carries WriteMind's own
 * cells (`takesPastedPicture`), so a paste back is the cells and only the cells.
 *
 * - On a Mac (the front end's own type is known, `wolframClipboard.cell`): at once, the front end's cells with each
 *   drawing as the open Input cell that makes it — something that pastes as cells even before the engine answers —
 *   and when it answers, the same cells with the images themselves, and the PNG for other apps when exactly one
 *   drawing cell was copied.
 * - Elsewhere, nothing changes until the engine has answered (a machine without one copies exactly as before); then
 *   the PNG, and — when every held cell is a drawing — the plain text becomes the front end's linear syntax for the
 *   images, which it pastes as the images.
 *
 * COPY CELL (Sean, 2026-10-06: the tablet box's "Copy Cell", `WolframCopy.cell`): the same, for ONE drawing that is not in any
 * note, and the clipboard also carries it to every other app as a real SVG FILE (a temp file the app sweeps up later:
 * `CopyDeps.saveSvg`) — the file reference and the markup — and never as a PNG, which would win over the file. That is
 * written at once, on every platform, with or without an engine; the kernel only adds Mathematica's own type (or, off
 * a Mac, the linear syntax in the plain text).
 *
 * A failure is a line in the log and never a dialog: the copy the page made is still there.
 */

import { pathToFileURL } from "node:url"
import {
  clipboardCells, clipboardKeeps, drawingText, INK_ID, svgClipboardFor, wolframPlan, type KernelJob, type Slot, type WolframBand, type WolframMedia,
} from "@writemind/core"
import type { KernelAnswers, KernelOptions } from "./kernel"
import { inlineMedia, resolvePictures, stampsFor, type MediaDeps } from "./media"

/** How long the copy waits for the engine before it lets the first write stand. */
export const COPY_TIMEOUT_MS = 20_000
/** How long the page's own copy may take to reach the clipboard, and how often it is looked for. */
const LANDED_WITHIN_MS = 1000
const POLL_MS = 50

/** What the page sent (renderer/wolframMedia.ts: the held cells' drawings only). */
export interface WolframCopy {
  plain: string; markdown: string; media: WolframMedia; noteFile?: string | null
  /** A COPY CELL: the one drawing in `media` is also an SVG file for the other apps (and no PNG goes). */
  cell?: boolean
}

/** The most markdown a copy may carry across, and the most svg (all its drawings together). */
const MAX_MARKDOWN = 2 * 1024 * 1024
const MAX_SVG = 16 * 1024 * 1024

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/**
 * Only a well-formed copy crosses from the page: strings where strings go, ink cells by their ids, no more than
 * 2 MB of markdown and 16 MB of svg. Anything else is dropped (null) and nothing happens.
 */
export function validWolframCopy(value: unknown): WolframCopy | null {
  if (!value || typeof value !== "object") return null
  const copy = value as Record<string, unknown>
  if (typeof copy.plain !== "string" || typeof copy.markdown !== "string") return null
  if (copy.markdown.length > MAX_MARKDOWN || copy.plain.length > MAX_MARKDOWN) return null
  const media = copy.media as Record<string, unknown> | null | undefined
  if (!media || typeof media !== "object" || !finite(media.column) || !(media.column > 0)) return null
  const given = media.inks as Record<string, unknown> | null | undefined
  if (!given || typeof given !== "object" || Array.isArray(given)) return null
  let svg = 0
  const inks: WolframMedia["inks"] = {}
  for (const [id, ink] of Object.entries(given)) {
    const one = ink as Record<string, unknown> | null
    if (!INK_ID.test(id) || !one || typeof one.svg !== "string" || !finite(one.shown)) return null
    svg += one.svg.length
    inks[id] = { svg: one.svg, shown: one.shown }
  }
  const bands: WolframBand[] = []
  for (const band of Array.isArray(media.bands) ? media.bands as unknown[] : []) {
    const one = band as Record<string, unknown> | null
    if (!one || typeof one.svg !== "string" || !finite(one.shown) || !(one.after === null || finite(one.after))) return null
    svg += one.svg.length
    bands.push({ svg: one.svg, shown: one.shown, after: one.after as number | null })
  }
  if (svg > MAX_SVG) return null
  const noteFile = typeof copy.noteFile === "string" ? copy.noteFile : null
  // A copied cell is exactly one drawing, and nothing floating beside it.
  if (copy.cell === true && (Object.keys(inks).length !== 1 || bands.length > 0)) return null
  return { plain: copy.plain, markdown: copy.markdown, media: { inks, bands, column: media.column }, noteFile, ...(copy.cell === true ? { cell: true } : {}) }
}

/** An entry of the clipboard as `clipboard.read()` gives it. */
export interface ClipboardEntry { readonly types: readonly string[]; getType(type: string): Promise<unknown> }

export interface CopyDeps extends MediaDeps {
  clipboard: {
    readText(): Promise<string>
    read(): Promise<readonly ClipboardEntry[]>
    write(items: unknown[]): Promise<void>
  }
  /** An entry to write (Electron's `new ClipboardItem(entries)`). */
  item(entries: Record<string, Blob>): unknown
  /** The raw clipboard types (capabilities' `wolframClipboard`). */
  kinds: { cell: string | null; png: string | null }
  /** Where the platform is (Copy Cell: the raw type an SVG goes under, `svgClipboardType`). */
  platform?: string
  /** A COPY CELL's svg written to a file of its own (the previous one swept away); the file's path. */
  saveSvg?(svg: string): Promise<string>
  runKernel(jobs: readonly KernelJob[], options: KernelOptions): Promise<KernelAnswers>
  sleep(ms: number): Promise<void>
  removeTemp(file: string): Promise<void>
  log?(message: string): void
}

/** A raw type of the system's clipboard, as Electron names it. */
const raw = (format: string): string => `electron application/osclipboard;format="${format}"`
const text = (words: string): Blob => new Blob([words], { type: "text/plain" })

let copies = 0

/** The types on the clipboard that stay (WriteMind's own copy), read back as they are. */
async function keptEntries(deps: CopyDeps): Promise<Record<string, Blob>> {
  const entries: Record<string, Blob> = {}
  const [first] = await deps.clipboard.read()
  if (!first) return entries
  for (const type of first.types) {
    if (!clipboardKeeps(type)) continue
    const value = await first.getType(type).catch(() => null)
    if (value instanceof Blob) entries[type] = value
  }
  return entries
}

export async function copyForWolfram(copy: WolframCopy, deps: CopyDeps): Promise<void> {
  const mine = ++copies
  const expected = copy.plain
  // 1. The page's copy reaches the clipboard a moment after the page hears it: wait for it, a second at most.
  let landed = false
  for (let waited = 0; ; waited += POLL_MS) {
    if (await deps.clipboard.readText() === expected) { landed = true; break }
    if (waited >= LANDED_WITHIN_MS || mine !== copies) break
    await deps.sleep(POLL_MS)
  }
  if (!landed) return
  /** Whether the clipboard is still this copy's: nothing is written over a newer copy, ours or anybody's. */
  const still = async () => mine === copies && await deps.clipboard.readText() === expected

  // 2. The cells, as the front end's.
  const media = await inlineMedia(copy.media, deps)
  const folder = copy.noteFile ? copy.noteFile.replace(/[\\/][^\\/]*$/, "") : null
  const { pictures, stamps, temps } = await resolvePictures(copy.markdown, media, deps, folder)
  try {
    const plan = wolframPlan(copy.markdown, media, pictures, "clipboard")
    const cellType = deps.kinds.cell ? raw(deps.kinds.cell) : null
    const pngType = deps.kinds.png ? raw(deps.kinds.png) : "image/png"
    // A COPY CELL's file and markup for the other apps: beside everything this copy writes, both times.
    const svg = copy.cell ? Object.values(media.inks)[0]?.svg : undefined
    const file = svg !== undefined && deps.saveSvg ? await deps.saveSvg(svg) : null
    const types = svgClipboardFor(deps.platform ?? process.platform)
    const forOthers: Record<string, Blob> = svg === undefined ? {} : {
      ...(file ? { [types.file ? raw(types.file) : "text/uri-list"]: text(`${pathToFileURL(file).href}${types.end}`) } : {}),
      [raw(types.svg)]: text(svg),
    }

    // 3. Where the front end's own type is known (or for a copied cell, which is for the other apps too): its cells now,
    // each drawing the cell that makes it.
    if (cellType || svg !== undefined) {
      const entries = await keptEntries(deps)
      if (cellType) entries[cellType] = text(clipboardCells(plan, new Map()))
      Object.assign(entries, forOthers)
      if (!(await still())) return
      await deps.clipboard.write([deps.item(entries)])
    }
    if (plan.jobs.length === 0) return

    // 4. The kernel, once. A newer copy takes this run back (the id is the same).
    // (A copied cell asks for none: the file is its picture for the other apps.)
    const single = plan.cells.length === 1 && plan.cells[0]!.drawing && !copy.cell
    const ran = await deps.runKernel(plan.jobs, {
      id: "wolfram:copy", png: single, removeBackground: true,
      timeoutMs: COPY_TIMEOUT_MS, stamps: stampsFor(plan, stamps),
    })
    if (ran.state.kind !== "answered" && ran.state.kind !== "timedOut") {
      if (ran.state.kind !== "cancelled") deps.log?.(`WriteMind: the copy for Mathematica has no images (${ran.state.kind})`)
      return
    }
    if (ran.answers.size === 0) return

    // 5. The same cells with the images in them, the PNG beside them, and elsewhere the linear syntax.
    const entries = await keptEntries(deps)
    if (cellType) entries[cellType] = text(clipboardCells(plan, ran.answers))
    Object.assign(entries, forOthers)
    const slot = single ? plan.cells[0]!.pieces.find((piece): piece is Slot => typeof piece !== "string" && piece.as === "image") : undefined
    const png = slot ? ran.pngs.get(slot.job) : undefined
    if (png) entries[pngType] = new Blob([png as BlobPart], { type: "image/png" })
    let next = expected
    if (!cellType) {
      const linear = drawingText(plan, ran.answers)
      // Only beside WriteMind's own cells, which a paste back into WriteMind reads instead of the text.
      if (linear !== null && Object.keys(entries).some((type) => /chromium|web custom/i.test(type))) {
        entries["text/plain"] = text(linear)
        next = linear
      }
      if (!png && next === expected) return
    }
    if (!(await still())) return
    await deps.clipboard.write([deps.item(entries)])
  } finally {
    for (const temp of temps) await deps.removeTemp(temp).catch(() => undefined)
  }
}
