/**
 * The tablet's SHEETS as tabs: which sheets there are, what they are called, which one is open, and how they are
 * written to disk. Pure: no React, no DOM, no storage (tabletSheets.ts is the live store; test/sheetSet.test.ts).
 *
 * Every operation returns a new set (or the same one when nothing changes). The last sheet is never closed (it is
 * cleared instead), a new sheet is "Sheet N" after the highest "Sheet N" there is, and next / previous wrap round.
 *
 * ON DISK (userData/sheets.json, main/sheets.ts): `{ version: 1, current, sheets: [{ id, name, paper, strokes }] }`,
 * a stroke as `{ c: colour, w: width, p: [x0, y0, x1, y1, ...], r?: [pressure, ...] }` (points rounded to 1/10000 of
 * the sheet, pressures to 1/1000). Read tolerantly: a bad stroke or sheet is dropped, an unknown paper falls back to
 * the default, garbage is null (the caller keeps what it has). `plain`: the last plain sheet that was open (sheetFollow.ts).
 *
 * A sheet BOUND to an ink cell (cellSheets.ts: right-click a drawing cell ▸ Open in Tablet Sheet) also has
 * `cell: { note, cell }` (the note's file and the cell's id) and, when it was written on while its note was not in
 * front, `pending: true` (that writing lands in the cell when the note is). A bad `cell` is dropped: a plain sheet.
 */

import type { Point } from "@writemind/core"
import type { InkStroke } from "./tabletPage"
import { parsePaper, type Paper } from "./tabletPaper"

export interface SheetTab { id: string; name: string }
export interface SheetSet { tabs: SheetTab[]; current: string }

/** More than this is a runaway "+" rather than a way of working. */
export const MAX_SHEETS = 50
export const MAX_NAME = 40

export const firstSet = (id: string): SheetSet => ({ tabs: [{ id, name: "Sheet 1" }], current: id })

/** "Sheet N", one past the highest "Sheet N" there is (a closed "Sheet 3" is reused when it was the last). */
export function nextSheetName(tabs: SheetTab[]): string {
  let highest = 0
  for (const tab of tabs) {
    const number = /^Sheet (\d{1,6})$/.exec(tab.name)?.[1]
    if (number) highest = Math.max(highest, Number(number))
  }
  return `Sheet ${highest + 1}`
}

/** A name as typed, made safe: one line, spaces collapsed, at most `MAX_NAME` characters; null for nothing. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim()
  return name.length > 0 ? name : null
}

const has = (set: SheetSet, id: string): boolean => set.tabs.some((tab) => tab.id === id)

/** A new sheet at the end, and open. Unchanged at `MAX_SHEETS` or for an id that is taken. */
export function addSheet(set: SheetSet, id: string, name?: string): SheetSet {
  if (set.tabs.length >= MAX_SHEETS || !id || has(set, id)) return set
  return { tabs: [...set.tabs, { id, name: cleanName(name) ?? nextSheetName(set.tabs) }], current: id }
}

/** The sheet goes; the open one moves to its right-hand neighbour, else the left. The last sheet stays. */
export function closeSheet(set: SheetSet, id: string): SheetSet {
  const index = set.tabs.findIndex((tab) => tab.id === id)
  if (index < 0 || set.tabs.length <= 1) return set
  const tabs = set.tabs.filter((tab) => tab.id !== id)
  const current = set.current === id ? tabs[Math.min(index, tabs.length - 1)]!.id : set.current
  return { tabs, current }
}

export function renameSheet(set: SheetSet, id: string, name: unknown): SheetSet {
  const clean = cleanName(name)
  const tab = set.tabs.find((one) => one.id === id)
  if (!clean || !tab || tab.name === clean) return set
  return { ...set, tabs: set.tabs.map((one) => (one.id === id ? { ...one, name: clean } : one)) }
}

export function selectSheet(set: SheetSet, id: string): SheetSet {
  return set.current === id || !has(set, id) ? set : { ...set, current: id }
}

/** The next (+1) or previous (-1) sheet, round the end. */
export function stepSheet(set: SheetSet, by: 1 | -1): SheetSet {
  if (set.tabs.length <= 1) return set
  const index = Math.max(0, set.tabs.findIndex((tab) => tab.id === set.current))
  const next = set.tabs[(index + by + set.tabs.length) % set.tabs.length]!
  return selectSheet(set, next.id)
}

// MARK: - Bound to an ink cell

/** The ink cell a sheet writes into: the note's file and the cell's id (`ink-<id>.svg`). */
export interface CellRef { note: string; cell: string }

export const sameCell = (a: CellRef | null | undefined, b: CellRef | null | undefined): boolean =>
  !!a && !!b && a.note === b.note && a.cell === b.cell

const CELL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A cell reference read back, or null (a plain sheet). */
export function parseCellRef(raw: unknown): CellRef | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  const note = o.note, cell = o.cell
  // eslint-disable-next-line no-control-regex -- a file name never holds a control character
  if (typeof note !== "string" || note.length === 0 || note.length > 4096 || /[\u0000-\u001f]/.test(note)) return null
  if (typeof cell !== "string" || !CELL_ID.test(cell)) return null
  return { note, cell }
}

const DRAWING = " Drawing"

/**
 * The name of a sheet bound to a cell of the note titled `title`: "<title> Drawing" (the title cut to fit
 * `MAX_NAME`), and "<title> Drawing 2", 3... when the note's other cells have the name already.
 */
export function boundSheetName(title: string, tabs: SheetTab[]): string {
  const head = (cleanName(title) ?? "Note").slice(0, MAX_NAME - DRAWING.length - 3).trim()
  const base = `${head}${DRAWING}`
  const taken = new Set(tabs.map((tab) => tab.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

// MARK: - On disk

export interface StoredSheet {
  id: string; name: string; paper: Paper; strokes: InkStroke[]
  /** The ink cell this sheet writes into (absent: a plain sheet). */
  cell?: CellRef
  /** Written on while the cell's note was not in front: it lands in the cell when the note is. */
  pending?: boolean
  /** The cell's aspect (height / width) when it was last seen, so its frame shows before its note is open. */
  shape?: number
}
export interface StoredSheets {
  current: string; sheets: StoredSheet[]
  /** The last plain (unbound) sheet that was open (sheetFollow.ts): another note in front goes back to it. */
  plain?: string
}

const DEFAULT_INK = "#2D7DD2"
const round = (value: number, places: number): number => {
  const k = 10 ** places
  return Math.round(value * k) / k
}

export function serialiseSheets(stored: StoredSheets): string {
  return JSON.stringify({
    version: 1,
    current: stored.current,
    ...(stored.plain ? { plain: stored.plain } : {}),
    sheets: stored.sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      paper: { kind: sheet.paper.kind, spacing: sheet.paper.spacing, colour: sheet.paper.colour },
      strokes: sheet.strokes.map((stroke) => ({
        c: stroke.colorHex,
        w: round(stroke.width, 3),
        p: stroke.points.flatMap((point) => [round(point.x, 4), round(point.y, 4)]),
        ...(stroke.pressures ? { r: stroke.pressures.map((pressure) => round(pressure, 3)) } : {}),
      })),
      ...(sheet.cell ? { cell: { note: sheet.cell.note, cell: sheet.cell.cell } } : {}),
      ...(sheet.cell && sheet.pending ? { pending: true } : {}),
      ...(sheet.cell && sheet.shape !== undefined && goodShape(sheet.shape) ? { shape: round(sheet.shape, 5) } : {}),
    })),
  })
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
/** A cell's aspect worth keeping (a cell is never 1000 times wider than tall, nor taller than 100 widths). */
const goodShape = (value: number): boolean => value > 0.001 && value < 100
const unit = (value: number): number => Math.min(1, Math.max(0, value))

function parseStroke(raw: unknown): InkStroke | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  const flat = o.p
  if (!Array.isArray(flat) || flat.length < 2 || flat.length % 2 !== 0 || !flat.every(finite)) return null
  const points: Point[] = []
  for (let i = 0; i < flat.length; i += 2) points.push({ x: unit(flat[i] as number), y: unit(flat[i + 1] as number) })
  const colorHex = typeof o.c === "string" && /^#[0-9a-f]{6}$/i.test(o.c) ? o.c : DEFAULT_INK
  const width = finite(o.w) && o.w > 0 && o.w <= 500 ? o.w : 2
  const r = o.r
  const pressures = Array.isArray(r) && r.length === points.length && r.every(finite) ? r.map((one) => unit(one as number)) : undefined
  return { colorHex, width, points, ...(pressures ? { pressures } : {}) }
}

/** What was kept, made safe; null when there is nothing usable (the caller keeps what it has). */
export function parseSheets(text: string | null | undefined): StoredSheets | null {
  if (!text) return null
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (typeof raw !== "object" || raw === null) return null
  const list = (raw as Record<string, unknown>).sheets
  if (!Array.isArray(list)) return null
  const sheets: StoredSheet[] = []
  const ids = new Set<string>()
  for (const item of list) {
    if (sheets.length >= MAX_SHEETS) break
    if (typeof item !== "object" || item === null) continue
    const o = item as Record<string, unknown>
    let id = typeof o.id === "string" && /^[\w-]{1,64}$/.test(o.id) ? o.id : ""
    if (!id || ids.has(id)) {
      let n = sheets.length + 1
      while (ids.has(`s${n}`)) n++
      id = `s${n}`
    }
    ids.add(id)
    const strokes = Array.isArray(o.strokes)
      ? o.strokes.map(parseStroke).filter((stroke): stroke is InkStroke => stroke !== null)
      : []
    const cell = parseCellRef(o.cell)
    sheets.push({
      id,
      name: cleanName(o.name) ?? nextSheetName(sheets.map((one) => ({ id: one.id, name: one.name }))),
      paper: parsePaper(o.paper),
      strokes,
      ...(cell ? {
        cell,
        ...(o.pending === true ? { pending: true } : {}),
        ...(finite(o.shape) && goodShape(o.shape) ? { shape: o.shape } : {}),
      } : {}),
    })
  }
  if (sheets.length === 0) return null
  const wanted = (raw as Record<string, unknown>).current
  const current = typeof wanted === "string" && ids.has(wanted) ? wanted : sheets[0]!.id
  const plain = (raw as Record<string, unknown>).plain
  const keep = typeof plain === "string" && sheets.some((sheet) => sheet.id === plain && !sheet.cell) ? plain : null
  return { current, sheets, ...(keep ? { plain: keep } : {}) }
}
