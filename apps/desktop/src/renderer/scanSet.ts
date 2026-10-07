/**
 * The document camera's SCANNED PAGES as tabs: which pages there are, what they are called, which one is open, and
 * how they are written to disk. Pure: no React, no DOM, no storage (scanTabs.ts is the live store;
 * test/scanSet.test.ts). The tablet's sheets are the model (sheetSet.ts, whose name rules this shares); the
 * difference is that the live Camera tab always comes first, can never be closed, and is what `current: null` means.
 *
 * A page is the picture as the camera gave it (a file beside the list, `scans/<id>.jpg`, main/scans.ts) and what the
 * person and the reader have said about it since: the quarter turns it is shown with, the box, Straighten's four
 * corners, the page's learned shape (long side over short, so two pages of one notebook come in the same size), and
 * the words read off it. Every field but the picture lives in the list, `userData/scans.json`:
 * `{ version: 1, pages: [{ id, name, w, h, turn, box?, quad?, straighten?, shape?, read?: { key, lines } }] }` (the box
 * as fractions of the UPRIGHT picture, the corners as fractions of it too). Read tolerantly: a bad page is dropped,
 * a bad field is its default, garbage is null. Which tab was open is NOT kept: a new launch starts on the camera.
 */

import type { Rect, Size } from "@writemind/core"
import { displayedFrame, zoomedRect } from "@writemind/core"
import type { Rotation } from "./cameraSettings"
import { cleanName, MAX_NAME } from "./sheetSet"

/** A page's picture is a whole camera frame; a runaway "+" fills the disk. */
export const MAX_PAGES = 40
export { MAX_NAME }

type CornerName = "topLeft" | "topRight" | "bottomRight" | "bottomLeft"
/** The page's corners as fractions of the picture shown (top-left origin): CameraPane's own. */
export type Quad01 = Record<CornerName, { x: number; y: number }>
const CORNERS: CornerName[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"]

/** What was read off a page: the words, and the key (`readKey`) of the box and corners it was read through. */
export interface PageReading { key: string; lines: string[] }

export interface ScanPage {
  id: string
  name: string
  /** The picture's own size, as the camera gave it (not turned). */
  width: number
  height: number
  /** How the picture is turned for the person (clockwise quarter turns, in degrees). */
  rotation: Rotation
  /** The box, as fractions of the upright picture, or null. */
  box: Rect | null
  straighten: boolean
  quad: Quad01 | null
  /** The page's learned shape (long side over short), or null while no page was found on it. */
  shape: number | null
  read: PageReading | null
}

export interface ScanSet {
  pages: ScanPage[]
  /** The open page's id; null is the live Camera tab. */
  current: string | null
}

export const emptySet = (): ScanSet => ({ pages: [], current: null })

/** "Page N", one past the highest "Page N" there is. */
export function nextPageName(pages: { name: string }[]): string {
  let highest = 0
  for (const page of pages) {
    const number = /^Page (\d{1,6})$/.exec(page.name)?.[1]
    if (number) highest = Math.max(highest, Number(number))
  }
  return `Page ${highest + 1}`
}

const has = (set: ScanSet, id: string): boolean => set.pages.some((page) => page.id === id)

/** A page at the end, and open. Unchanged at `MAX_PAGES` or for an id that is empty or taken. */
export function addPage(set: ScanSet, page: Omit<ScanPage, "name"> & { name?: string }): ScanSet {
  if (set.pages.length >= MAX_PAGES || !page.id || has(set, page.id)) return set
  const named: ScanPage = { ...page, name: cleanName(page.name) ?? nextPageName(set.pages) }
  return { pages: [...set.pages, named], current: page.id }
}

/** The page goes; if it was open its right-hand neighbour opens, else the left, else the camera. */
export function closePage(set: ScanSet, id: string): ScanSet {
  const index = set.pages.findIndex((page) => page.id === id)
  if (index < 0) return set
  const pages = set.pages.filter((page) => page.id !== id)
  const current = set.current === id ? (pages[Math.min(index, pages.length - 1)]?.id ?? null) : set.current
  return { pages, current }
}

export function renamePage(set: ScanSet, id: string, name: unknown): ScanSet {
  const clean = cleanName(name)
  const page = set.pages.find((one) => one.id === id)
  if (!clean || !page || page.name === clean) return set
  return updatePage(set, id, { name: clean })
}

/** A page opened, or null for the camera. An id that is not there changes nothing. */
export function selectPage(set: ScanSet, id: string | null): ScanSet {
  return set.current === id || (id !== null && !has(set, id)) ? set : { ...set, current: id }
}

/** `patch` laid over one page; the same set when nothing in it differs (so a save is not asked for nothing). */
export function updatePage(set: ScanSet, id: string, patch: Partial<Omit<ScanPage, "id">>): ScanSet {
  const page = set.pages.find((one) => one.id === id)
  if (!page) return set
  const next = { ...page, ...patch }
  if (JSON.stringify(next) === JSON.stringify(page)) return set
  return { ...set, pages: set.pages.map((one) => (one.id === id ? next : one)) }
}

// MARK: - The way back from a box on screen, and what a reading was read through

/**
 * A box kept as fractions of the upright picture, as the pane's own points: the picture fitted whole in `pane`
 * (`displayedFrame`), then through the zoom when there is one. The inverse of CameraPane's `regionOfBox`.
 */
export function boxOnPane(region: Rect, frame: Size, pane: Size, zoom: Rect | null): Rect | null {
  const shown = displayedFrame(frame, pane)
  if (shown.width <= 0 || shown.height <= 0) return null
  const drawn: Rect = {
    x: shown.x + region.x * shown.width, y: shown.y + region.y * shown.height,
    width: region.width * shown.width, height: region.height * shown.height,
  }
  return zoom ? zoomedRect(drawn, zoom, pane) : drawn
}

const r3 = (value: number): number => Math.round(value * 1000) / 1000

/**
 * What a reading of a page depended on: the box (or none), Straighten's corners (or none: the page is looked for) and
 * the turn. The same key later means the words kept are still the words, so they come in again without being read.
 */
export function readKey(region: Rect | null, corners: Quad01 | null, rotation: Rotation): string {
  return JSON.stringify([
    region ? [r3(region.x), r3(region.y), r3(region.width), r3(region.height)] : null,
    corners ? CORNERS.map((name) => [r3(corners[name].x), r3(corners[name].y)]) : null,
    rotation,
  ])
}

// MARK: - On disk

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const unit = (value: number): number => Math.min(1, Math.max(0, value))
const round = (value: number, places: number): number => {
  const k = 10 ** places
  return Math.round(value * k) / k
}

const turnOf = (value: unknown): Rotation => {
  if (!finite(value)) return 0
  return ((((Math.round(value / 90) * 90) % 360) + 360) % 360) as Rotation
}

function parseBox(raw: unknown): Rect | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  if (![o.x, o.y, o.width, o.height].every(finite)) return null
  const x = unit(o.x as number), y = unit(o.y as number)
  const width = Math.min(1 - x, o.width as number), height = Math.min(1 - y, o.height as number)
  return width > 0.005 && height > 0.005 ? { x, y, width, height } : null
}

function parseQuad(raw: unknown): Quad01 | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  const quad = {} as Quad01
  for (const name of CORNERS) {
    const point = o[name]
    if (typeof point !== "object" || point === null) return null
    const p = point as Record<string, unknown>
    if (!finite(p.x) || !finite(p.y)) return null
    quad[name] = { x: unit(p.x), y: unit(p.y) }
  }
  return quad
}

function parseReading(raw: unknown): PageReading | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.key !== "string" || o.key.length > 400 || !Array.isArray(o.lines)) return null
  const lines = o.lines.filter((line): line is string => typeof line === "string").slice(0, 2000).map((line) => line.slice(0, 2000))
  return { key: o.key, lines }
}

/** The ids that may name a file in the pictures' folder (main/scans.ts asks the same). */
export const GOOD_ID = /^[\w-]{1,64}$/

export function serialiseScans(set: ScanSet): string {
  return JSON.stringify({
    version: 1,
    pages: set.pages.map((page) => ({
      id: page.id, name: page.name, w: page.width, h: page.height, turn: page.rotation,
      ...(page.box ? { box: { x: round(page.box.x, 4), y: round(page.box.y, 4), width: round(page.box.width, 4), height: round(page.box.height, 4) } } : {}),
      ...(page.straighten ? { straighten: true } : {}),
      ...(page.quad ? { quad: Object.fromEntries(CORNERS.map((name) => [name, { x: round(page.quad![name].x, 4), y: round(page.quad![name].y, 4) }])) } : {}),
      ...(page.shape !== null ? { shape: round(page.shape, 5) } : {}),
      ...(page.read ? { read: { key: page.read.key, lines: page.read.lines } } : {}),
    })),
  })
}

/** What was kept, made safe (open on the camera); null when it is not a list of pages (the caller keeps what it has). */
export function parseScans(text: string | null | undefined): ScanSet | null {
  if (!text) return null
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (typeof raw !== "object" || raw === null) return null
  const list = (raw as Record<string, unknown>).pages
  if (!Array.isArray(list)) return null
  const pages: ScanPage[] = []
  const ids = new Set<string>()
  for (const item of list) {
    if (pages.length >= MAX_PAGES) break
    if (typeof item !== "object" || item === null) continue
    const o = item as Record<string, unknown>
    // Without a good id there is no picture to find, and without its size no place to put it.
    if (typeof o.id !== "string" || !GOOD_ID.test(o.id) || ids.has(o.id)) continue
    if (!finite(o.w) || !finite(o.h) || o.w < 1 || o.h < 1 || o.w > 20000 || o.h > 20000) continue
    ids.add(o.id)
    pages.push({
      id: o.id,
      name: cleanName(o.name) ?? nextPageName(pages),
      width: Math.round(o.w), height: Math.round(o.h),
      rotation: turnOf(o.turn),
      box: parseBox(o.box),
      straighten: o.straighten === true,
      quad: parseQuad(o.quad),
      shape: finite(o.shape) && o.shape >= 1 && o.shape < 100 ? o.shape : null,
      read: parseReading(o.read),
    })
  }
  return { pages, current: null }
}
