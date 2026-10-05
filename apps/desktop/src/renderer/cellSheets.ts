/**
 * TABLET SHEETS BOUND TO INK CELLS, live (Sean, 2026-10-05: "you can also right click and open the drawing cell as a
 * new tab in the wacom/video editor to write in"). The geometry and the two directions of the sync are cellSheet.ts;
 * the page is cellPage.ts; the tabs and the file are tabletSheets.ts; the right-click menu is CellMenu.tsx.
 *
 * - Right-click a drawing cell (either pane) ▸ Open in Tablet Sheet: the video pane shows the Tablet, and the sheet
 *   bound to that cell opens (a new tab "<note> Drawing" the first time). The sheet keeps the tablet's shape; the cell
 *   is the frame in it, the cell's strokes in it.
 * - Writing, rubbing out or clearing on that sheet edits the CELL: each change is written into the note's drawing as
 *   ONE undo step of the note's timeline (a stroke at its pen-up; an erase gesture as one step), through the app's own
 *   `changeDrawing`, so the sidecar is saved, the cell's `ink-<id>.svg` snapshot rewritten and the cell repainted as
 *   for any edit. The sheet has no undo of its own: its Undo is the note's.
 * - The cell's own changes (a stroke drawn in the note, an Undo, a resize) come back to the sheet.
 * - The binding is the note's FILE and the cell's id; it is kept in sheets.json, so it survives a restart. While the
 *   note is not the one in front, the sheet shows the cell as it was last seen and what is written there is kept
 *   (`pending`, on disk too) and lands in the cell when the note comes in front.
 * - The cell gone from the note in front (a second later, still gone), or the note's file gone: the tab says so
 *   quietly and is a plain sheet from then on, keeping its ink.
 *
 * - THE SHEET AND THE NOTE FOLLOW EACH OTHER (Sean, 2026-10-05; the rules are sheetFollow.ts): a bound tab picked by
 *   hand (a click, Pen ▸ Next / Previous Sheet) brings its note to the front (its tab, else opened as from the
 *   sidebar) and opens when the note is there, the cell scrolled into view; any other note coming to the front while
 *   a bound tab is open sends the sheet back to the last plain tab (else the first, else a new "Sheet 1"). So a bound
 *   tab is open only with its note in front; `pending` is left for the moment between (and a sheets file from before).
 *
 * The app is reached through ONE host (App.tsx sets it): the note in front and its drawing, how to apply an edit,
 * a cell's shown width, a note's title, how to show the Tablet, how to bring a note to the front and show a cell.
 */

import { useSyncExternalStore } from "react"
import { inkCellOf, withInkCell, type Drawing, type InkCell, type Rect } from "@writemind/core"
import { CellPage } from "./cellPage"
import { cellFrameOn, cellWithSheet, placementFor, placementKey, sameStrokes, sheetStrokesOf, type Placement } from "./cellSheet"
import { runPenAction } from "./penActions"
import { pickTab, sheetForFront, type Waiting } from "./sheetFollow"
import type { CellRef } from "./sheetSet"
import {
  addSheet, boundPages, currentSheet, followSheets, lastPlainSheet, openCellSheet, setSheetPicker, sheetsChanged,
  sheetsLoaded, sheetTabs, showSheet, subscribeSheets, unbindSheet,
} from "./tabletSheets"

export interface CellSheetHost {
  /** The note in front and its drawing as it is NOW (a change applied a moment ago included), or null. */
  front(): { note: string; drawing: Drawing } | null
  /** Apply an edit of the note in front's drawing; `record`: it begins a new undo step of the note's timeline. */
  edit(next: Drawing, record: boolean): void
  /** A cell's shown width in px, or null when it is not drawn. */
  width(cell: string): number | null
  /** A note's title, for the tab's name and the quiet words. */
  title(note: string): string
  /** Show the video pane, on the Tablet. */
  showTablet(): void
  /** Bring this note to the front: its tab, else opened as from the sidebar. Rejects when it cannot be read. */
  bring(note: string): Promise<void>
  /** Scroll the cell into view in its note, when that note is in front (nothing else moves: not the caret). */
  reveal(ref: CellRef): void
}

/** How long a cell may be missing from its note in front before the sheet lets go of it (an Undo then a Redo is not "gone"). */
const GONE_MS = 1200
/** How often a sheet whose note is not in front may ask whether the note's file is still there. */
const CHECK_MS = 5000

let host: CellSheetHost | null = null
/** The note in front, as last reported. */
let front: string | null = null
const listeners = new Set<() => void>()
let version = 0
const bump = (): void => { version++; listeners.forEach((listener) => listener()) }

/** App.tsx: the app's side. Returns the way to let go. */
export function setCellSheetHost(next: CellSheetHost): () => void {
  host = next
  syncAll()
  return () => { if (host === next) host = null }
}

/** App.tsx, on every change of the note in front or of its drawing. */
export function cellSheetsSaw(note: string | null, drawing: Drawing): void {
  if (note !== front) {
    front = note
    // The picked tab's note was brought, and another note is in front after it: that pick is over (the person went
    // elsewhere), so it neither opens later nor bases Next / Previous Sheet.
    if (waiting && brought === waiting && note !== null && note !== waiting.note) waiting = null
    bump()
    if (settled) followFront()
    else settle()
  }
  for (const page of boundPages()) if (page.ref!.note === note) syncPage(page, drawing)
}

/** Each cell's width as last really shown: a cell scrolled out of the editor (not drawn) keeps its scale. */
const lastWidth = new Map<string, number>()
const widthOf = (cell: string): number | null => {
  const now = host?.width(cell) ?? null
  if (now !== null) lastWidth.set(cell, now)
  return now ?? lastWidth.get(cell) ?? null
}
const placeOf = (page: CellPage, cell: InkCell): Placement => placementFor(page.aspect, cell, widthOf(cell.id))

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
    && Math.abs(a.width - b.width) < 1e-9 && Math.abs(a.height - b.height) < 1e-9)

/** The cell → the sheet (or, with writing pending from while the note was away, the sheet → the cell). */
function syncPage(page: CellPage, drawing: Drawing): void {
  const ref = page.ref
  if (!ref) return
  const cell = inkCellOf(drawing, ref.cell)
  if (!cell) { goneLater(page); return }
  const place = placeOf(page, cell)
  const moved = !sameRect(page.frame, place.frame)
  page.frame = place.frame
  if (page.shape !== cell.aspect) { page.shape = cell.aspect; sheetsChanged() }
  if (page.pending) {
    // What was written while the note was away lands now, as one step.
    page.pending = false
    sheetsChanged()
    write(page, true)
    bump()
    return
  }
  const key = placementKey(place)
  if (cell !== page.seen || key !== page.seenKey) {
    const strokes = sheetStrokesOf(cell, page.links, place)
    page.seen = cell
    page.seenKey = key
    if (!sameStrokes(strokes, page.strokes)) page.show(strokes)
  }
  if (moved) bump()
}

/** The sheet → the cell. False when nothing was written (no change, or the note is not in front: then it waits). */
function write(page: CellPage, record: boolean): boolean {
  const ref = page.ref
  if (!ref || !host) return false
  const now = host.front()
  if (!now || now.note !== ref.note) {
    if (!page.pending) { page.beginWaiting(true); sheetsChanged(); bump() }
    checkAway(page)
    return false
  }
  const cell = inkCellOf(now.drawing, ref.cell)
  if (!cell) {
    // Kept on the sheet; it lands if the cell comes back (a Redo), else the sheet lets go of it, ink and all.
    if (!page.pending) { page.beginWaiting(true); sheetsChanged() }
    goneLater(page)
    return false
  }
  const place = placeOf(page, cell)
  page.frame = place.frame
  const next = cellWithSheet(cell, page.strokes, page.links, place)
  if (next === cell) return false
  const drawing = withInkCell(now.drawing, next)
  // Seen before it is applied: the drawing coming back from the app is this one, and changes nothing here.
  page.seen = inkCellOf(drawing, ref.cell)
  page.seenKey = placementKey(place)
  host.edit(drawing, record)
  return true
}

// Every change the sheet makes: a stroke (pen-up), a clear, and an erase gesture (marked once, then one rub at a time).
CellPage.edited = (page, op) => {
  if (op.op === "mark") { page.stepWaiting = true; return }
  const record = op.op === "removeAt" ? page.stepWaiting : true
  page.stepWaiting = false
  write(page, record)
}
// Away: the sheet's Undo is its own (cellPage.ts), never the note in front's.
CellPage.away = (page) => !!page.ref && front !== page.ref.note
// The tablet turned: the cell is placed again.
CellPage.reshaped = (page) => {
  const now = host?.front()
  if (now && page.ref && now.note === page.ref.note) syncPage(page, now.drawing)
  bump()
}

// MARK: - Gone

const goneTimers = new Map<CellPage, ReturnType<typeof setTimeout>>()

const titleOf = (note: string): string => host?.title(note) ?? note.split(/[\\/]/).pop() ?? note

function goneLater(page: CellPage): void {
  if (goneTimers.has(page)) return
  goneTimers.set(page, setTimeout(() => {
    goneTimers.delete(page)
    const ref = page.ref
    const now = host?.front()
    if (!ref || !now || now.note !== ref.note) return
    if (inkCellOf(now.drawing, ref.cell)) { syncPage(page, now.drawing); return }
    unbindSheet(page.sheet, `Its drawing cell is no longer in “${titleOf(ref.note)}”: this is a plain sheet now, with its ink.`)
    bump()
  }, GONE_MS))
}

const asked = new WeakMap<CellPage, number>()

/** A sheet whose note is not in front: is the note's file still there? (Only a file that is not there lets go.) */
function checkAway(page: CellPage): void {
  const ref = page.ref
  const read = typeof window === "undefined" ? undefined : window.wm?.readNote
  if (!ref || !read) return
  const now = Date.now()
  if ((asked.get(page) ?? 0) > now - CHECK_MS) return
  asked.set(page, now)
  read(ref.note).then(() => undefined, (error: unknown) => {
    const why = String((error as { message?: unknown } | null)?.message ?? error)
    if (!/ENOENT|no such file/i.test(why)) return
    if (page.ref?.note !== ref.note || host?.front()?.note === ref.note) return
    noteGone(page)
  })
}

const isGone = (error: unknown): boolean =>
  /ENOENT|no such file/i.test(String((error as { message?: unknown } | null)?.message ?? error))

function noteGone(page: CellPage): void {
  if (!page.ref) return
  unbindSheet(page.sheet, `The note “${titleOf(page.ref.note)}” is gone: this is a plain sheet now, with its ink.`)
  bump()
}

/** Every bound sheet against what is known now (the host arrived, the sheets were read from disk, a tab opened). */
function syncAll(): void {
  const now = host?.front() ?? null
  for (const page of boundPages()) {
    if (now && page.ref!.note === now.note) syncPage(page, now.drawing)
    else checkAway(page)
  }
  settle()
}
subscribeSheets(syncAll)

// MARK: - The sheet and the note follow each other (sheetFollow.ts)

/** A bound tab picked by hand, waiting for its note to come to the front. */
let waiting: Waiting | null = null
/** The pick whose note has been brought (its bring settled), or null. */
let brought: Waiting | null = null
/** For the e2e scripts: the sheet sent to a plain tab by another note, picked tabs opened when their note came, notes brought. */
let follows = 0
let arrivals = 0
let brings = 0
/** Once the sheets are read and a note is in front, the open sheet is held to it (after a restart too). */
let settled = false

function settle(): void {
  if (settled || front === null || !sheetsLoaded()) return
  settled = true
  followFront()
}

/** A note came to the front: the tab waiting for it opens, or a bound tab of another note gives way to a plain one. */
function followFront(): void {
  const asked = waiting
  if (asked && asked.note === front) waiting = null
  const move = sheetForFront(followSheets(), front, lastPlainSheet(), asked)
  if (move.kind === "keep") return
  if (move.kind === "new") { follows++; addSheet(); return }
  showSheet(move.id)
  const page = asked && move.id === asked.sheet ? boundPages().find((one) => one.sheet === move.id) : undefined
  if (page?.ref) { arrivals++; host?.reveal(page.ref) } else follows++
}

setSheetPicker({
  waiting: () => waiting?.sheet ?? null,
  // The open tab closed: its neighbour may be a bound tab of a note that is not in front (then a plain tab instead).
  landed() { if (settled) followFront() },
  pick(id) {
    const pick = pickTab(followSheets(), id, front)
    if (!pick) return false
    if (pick.kind === "open" || !host) {
      waiting = null
      const changed = showSheet(id)
      if (pick.kind === "open" && pick.cell) host?.reveal(pick.cell)
      return changed
    }
    // A bound tab of a note that is not in front: the note first; the tab opens when it is there (followFront).
    if (waiting?.sheet === id) return true
    const cell = pick.cell
    const asked: Waiting = { sheet: id, note: cell.note }
    waiting = asked
    brings++
    host.bring(cell.note).then(() => {
      if (waiting !== asked) return
      brought = asked
      if (front === cell.note) followFront()
    }, (error: unknown) => {
      if (waiting !== asked) return
      waiting = null
      // The note is gone: the tab says so and is a plain sheet now, and opens as one.
      const page = boundPages().find((one) => one.sheet === id)
      if (page && isGone(error)) { noteGone(page); showSheet(id) }
    })
    return true
  },
})

// MARK: - What the menu and the pane ask

/** The cell with this id is a live cell of the note in front. */
export function cellInFront(cell: string): boolean {
  const now = host?.front()
  return !!now && inkCellOf(now.drawing, cell) !== null
}

/**
 * Right-click ▸ Open in Tablet Sheet: the Tablet shows, and the sheet bound to this cell of the note in front opens
 * (made the first time). False when the cell is not a live cell of the note in front, or no sheet can be added.
 */
export function openInTabletSheet(cell: string): boolean {
  const now = host?.front()
  if (!host || !now || !inkCellOf(now.drawing, cell)) return false
  const id = openCellSheet({ note: now.note, cell }, host.title(now.note))
  if (!id) return false
  const page = boundPages().find((one) => one.sheet === id)
  if (page) syncPage(page, now.drawing)
  host.showTablet()
  bump()
  return true
}

/** The sheet's Undo / Redo on a bound sheet: the note's (the pen's own Undo, which asks the sheet first and finds nothing). */
export const stepNote = (which: "undo" | "redo"): void => { runPenAction(which) }

export interface CellSheetView {
  /** The open sheet writes into a cell. */
  bound: boolean
  /** Its note is not the one in front: what is written waits for it. */
  away: boolean
  /** Writing done while away is waiting. */
  pending: boolean
  /** The note's title. */
  title: string
  /** The cell on the sheet (fractions of the sheet), or null. */
  frame: Rect | null
  /** A quiet word (the cell is gone), or null. */
  notice: string | null
}

const PLAIN: CellSheetView = { bound: false, away: false, pending: false, title: "", frame: null, notice: null }
let shown: CellSheetView = PLAIN
let shownKey = JSON.stringify(PLAIN)

function viewNow(): CellSheetView {
  const page = currentSheet()
  const tabs = sheetTabs()
  const notice = tabs.tabs.find((tab) => tab.id === tabs.current)?.notice ?? null
  let next: CellSheetView
  if (page instanceof CellPage && page.ref) {
    const frame = page.frame ?? (page.shape !== null ? cellFrameOn(page.aspect, page.shape) : null)
    next = {
      bound: true, away: front !== page.ref.note, pending: page.pending, title: titleOf(page.ref.note), frame, notice,
    }
  } else {
    next = { ...PLAIN, notice }
  }
  const key = JSON.stringify(next)
  if (key !== shownKey) { shown = next; shownKey = key }
  return shown
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  const off = subscribeSheets(listener)
  return () => { listeners.delete(listener); off() }
}

/** The open sheet's binding, for the video pane (CameraPane.tsx). */
export const useCellSheet = (): CellSheetView => useSyncExternalStore(subscribe, viewNow)

/** For the e2e scripts: how many times the binding's view changed. */
export const cellSheetVersion = (): number => version
/** For the e2e scripts: the sheet's moves made because a note came to the front, and the notes picks brought. */
export const followCounts = (): { follows: number; arrivals: number; brings: number; waiting: string | null } =>
  ({ follows, arrivals, brings, waiting: waiting?.sheet ?? null })
if (typeof window !== "undefined" && (window as unknown as { wm?: { e2eWindow?: unknown } }).wm?.e2eWindow) {
  (window as unknown as Record<string, unknown>).__wmFollow = followCounts
}
