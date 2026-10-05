/**
 * THE TABLET'S SHEETS, live: one `TabletPage` per tab (its own ink and its own stroke undo), each with its own paper,
 * and the open one. The pure rules (add / close / rename / next / previous, the file format) are `sheetSet.ts`; this
 * is the state the video pane shows and the writer that keeps it.
 *
 * Every caller that used to hold THE sheet asks for `currentSheet()` now (CameraPane, tabletCapture's
 * `takeFromSheet`, TabletSurface through its `page` prop, so Undo / Clear / Erase / Bring in act on the open tab).
 * All sheets share one shape (the tablet's orientation): switching never moves the sheet or the pen's mapping.
 *
 * THE PAPER of the open sheet is `tabletPaper`'s current paper (PaperMenu and the surface read it from there): opening
 * a sheet hands it its paper, and a paper chosen is the open sheet's. A new sheet takes the open sheet's paper.
 *
 * KEPT ACROSS RESTARTS in userData/sheets.json (main/sheets.ts: written atomically, debounced, read tolerantly), not
 * localStorage: ink can be large. Nothing is written until the file has been read, so a slow start cannot write an
 * empty set over it.
 *
 * A sheet BOUND to an ink cell (cellSheets.ts) has a `CellPage` (cellPage.ts) for its page: it is opened by a
 * right-click on the cell (`openCellSheet`), keeps its binding across restarts, and is made a plain sheet again
 * (`unbindSheet`, with a quiet word, `notice`) when the cell or its note is gone.
 *
 * A tab picked BY HAND (`selectSheet`: a click on it; `stepSheet`: Pen ▸ Next / Previous Sheet) goes through the
 * picker cellSheets.ts sets (a bound tab brings its note to the front first, sheetFollow.ts); `showSheet` opens one
 * as it is. The last PLAIN tab that was open is remembered (`lastPlainSheet`, kept in the file as `plain`): another
 * note coming to the front sends the sheet back to it.
 */

import { useSyncExternalStore } from "react"
import { sheetAspectFor } from "../shared/orientation"
import { CellPage } from "./cellPage"
import { rememberPlain, type FollowSheets } from "./sheetFollow"
import { currentTurns, subscribeOrientation, tabletAspect } from "./orientation"
import {
  addSheet as addTo, boundSheetName, closeSheet as closeIn, firstSet, MAX_SHEETS, parseSheets, renameSheet as renameIn,
  sameCell, selectSheet as selectIn, serialiseSheets, stepSheet as stepIn, type CellRef, type SheetSet, type StoredSheets,
} from "./sheetSet"
import { screenAspect, TabletPage, type InkStroke } from "./tabletPage"
import { paper as currentPaper, setPaper, subscribePaper, type Paper } from "./tabletPaper"

/**
 * The sheet's shape: the screen's, turned by the tablet's orientation (landscape on a landscape display unless the
 * tablet is turned a quarter turn).
 */
export const currentSheetAspect = (): number => sheetAspectFor(tabletAspect() ?? screenAspect(), currentTurns())

interface Entry { page: TabletPage; paper: Paper; off: () => void }

export interface SheetTabView {
  id: string; name: string; inked: boolean
  /** The ink cell it writes into (cellSheets.ts), or null for a plain sheet. */
  cell: CellRef | null
  /** A quiet word about it (its cell is gone: it is a plain sheet now), or null. */
  notice: string | null
}
export interface SheetTabsView { tabs: SheetTabView[]; current: string; canAdd: boolean }

let seq = 0
const newId = (): string => `s${Date.now().toString(36)}${(++seq).toString(36)}`

const entries = new Map<string, Entry>()
/** Quiet words per sheet, for this session (cellSheets.ts: "its cell is gone"). */
const notices = new Map<string, string>()
let set: SheetSet
let loaded = false
/** The last plain (unbound) tab that was open (sheetFollow.ts). */
let lastPlain: string | null = null
let view: SheetTabsView = { tabs: [], current: "", canAdd: true }
let viewKey = ""
const listeners = new Set<() => void>()

function entryFor(id: string, strokes: InkStroke[], paper: Paper, cell?: CellRef, pending?: boolean, shape?: number): Entry {
  const page = cell ? new CellPage(currentSheetAspect(), id, cell, pending, shape ?? null) : new TabletPage(currentSheetAspect())
  page.strokes = strokes
  const entry: Entry = { page, paper, off: () => undefined }
  entry.off = page.onChange(changed)
  return entry
}

const cellOf = (page: TabletPage | undefined): CellRef | null => (page instanceof CellPage ? page.ref : null)

function refreshView(): void {
  lastPlain = rememberPlain(followSheets(), lastPlain)
  const tabs = set.tabs.map((tab) => {
    const page = entries.get(tab.id)?.page
    return { id: tab.id, name: tab.name, inked: (page?.strokes.length ?? 0) > 0, cell: cellOf(page), notice: notices.get(tab.id) ?? null }
  })
  const canAdd = set.tabs.length < MAX_SHEETS
  const key = JSON.stringify([tabs, set.current, canAdd])
  if (key === viewKey) return
  viewKey = key
  view = { tabs, current: set.current, canAdd }
  listeners.forEach((listener) => listener())
}

/** A sheet's ink (or history) changed: the tabs may need their ink mark, and the file wants writing. */
function changed(): void {
  refreshView()
  save()
}

/** The open sheet's paper is the paper the menu and the surface show. */
function showPaper(): void {
  const entry = entries.get(set.current)
  if (entry) setPaper(entry.paper)
}

function apply(next: SheetSet): boolean {
  if (next === set) return false
  const switched = next.current !== set.current
  set = next
  if (switched) showPaper()
  refreshView()
  save()
  return true
}

// The first sheet, before the file is read: the paper last chosen (the one sheet of before tabs keeps its paper).
{
  const id = newId()
  entries.set(id, entryFor(id, [], currentPaper()))
  set = firstSet(id)
  refreshView()
}

// A paper chosen is the open sheet's.
subscribePaper(() => {
  const entry = entries.get(set.current)
  const now = currentPaper()
  if (!entry || (entry.paper.kind === now.kind && entry.paper.spacing === now.spacing && entry.paper.colour === now.colour)) return
  entry.paper = now
  save()
})
// Every sheet has the tablet's shape.
subscribeOrientation(() => {
  const aspect = currentSheetAspect()
  for (const entry of entries.values()) entry.page.setAspect(aspect)
})

// MARK: - What the pane asks

/** The tabs as the follow rules see them (sheetFollow.ts): each one's id and the cell it is bound to. */
export function followSheets(): FollowSheets {
  return { tabs: set.tabs.map((tab) => ({ id: tab.id, cell: cellOf(entries.get(tab.id)?.page) })), current: set.current }
}
/** The last plain tab that was open, or null. */
export const lastPlainSheet = (): string | null => lastPlain
export const sheetsLoaded = (): boolean => loaded

/** The open sheet. */
export const currentSheet = (): TabletPage => entries.get(set.current)!.page
export const sheetTabs = (): SheetTabsView => view
export const subscribeSheets = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const useSheetTabs = (): SheetTabsView => useSyncExternalStore(subscribeSheets, sheetTabs)

/** A new, empty sheet after the others, on the open sheet's paper, and open. */
export function addSheet(): string | null {
  const id = newId()
  const entry = entryFor(id, [], { ...currentPaper() })
  entries.set(id, entry)
  if (!apply(addTo(set, id))) { entry.off(); entries.delete(id); return null }
  return id
}

/** Close a sheet (its ink goes with it: the strip asks first when there is any). The last sheet stays. */
export function closeSheet(id: string): boolean {
  const entry = entries.get(id)
  const open = set.current === id
  if (!entry || !apply(closeIn(set, id))) return false
  entry.off()
  entries.delete(id)
  notices.delete(id)
  // The open tab closed: the neighbour that opened in its place may be bound to a note that is not in front.
  if (open) picker?.landed?.()
  return true
}

// MARK: - Sheets bound to ink cells (cellSheets.ts)

/** The sheet bound to this cell, or null. */
export function sheetOfCell(ref: CellRef): string | null {
  for (const [id, entry] of entries) if (sameCell(cellOf(entry.page), ref)) return id
  return null
}

/**
 * The sheet bound to the cell, open: the one there is (switched to), else a new one at the end named after the note
 * ("<title> Drawing"), on the open sheet's paper. Null when no sheet can be added (`MAX_SHEETS`).
 */
export function openCellSheet(ref: CellRef, title: string): string | null {
  const had = sheetOfCell(ref)
  if (had) { showSheet(had); return had }
  const id = newId()
  const entry = entryFor(id, [], { ...currentPaper() }, ref)
  entries.set(id, entry)
  if (!apply(addTo(set, id, boundSheetName(title, set.tabs)))) { entry.off(); entries.delete(id); return null }
  return id
}

/**
 * Bound, and holding writing that has not reached its cell yet (its note was not in front): closing it would lose that.
 * Read from the page itself (not the tabs' view, which a change of `pending` does not refresh: refreshing it from inside
 * the binding's own sync would run that sync again in the middle of itself).
 */
export function sheetPending(id: string): boolean {
  const page = entries.get(id)?.page
  return page instanceof CellPage && page.ref !== null && page.pending
}

/** Every page bound to a cell now. */
export const boundPages = (): CellPage[] =>
  [...entries.values()].map((entry) => entry.page).filter((page): page is CellPage => page instanceof CellPage && page.ref !== null)

/** The cell or its note is gone: the sheet is a plain sheet from now on, keeping its ink, and says so quietly. */
export function unbindSheet(id: string, notice: string): void {
  const page = entries.get(id)?.page
  if (!(page instanceof CellPage) || !page.ref) return
  page.unbind()
  notices.set(id, notice)
  refreshView()
  save()
}

/** A note was renamed or moved (`from` a file, or a folder of them): the sheets bound to its cells follow it. */
export function renameBoundNotes(from: string, to: string): void {
  let moved = false
  for (const page of boundPages()) {
    const note = page.ref!.note
    const next = note === from ? to
      : note.startsWith(from + "/") || note.startsWith(from + "\\") ? to + note.slice(from.length) : null
    if (next === null || next === note) continue
    page.ref = { ...page.ref!, note: next }
    moved = true
  }
  if (moved) { refreshView(); save() }
}

/** Something kept on disk changed that is not a page's ink (a sheet's `pending`). */
export const sheetsChanged = (): void => save()

export const renameSheet = (id: string, name: string): boolean => apply(renameIn(set, id, name))
/** Open a sheet as it is (the follow rules' own moves, and a bound sheet opened from its cell). */
export const showSheet = (id: string): boolean => apply(selectIn(set, id))

/** A tab picked by hand, and the tab a pick is waiting to open (its note is on its way), if any. */
export interface SheetPicker {
  pick(id: string): boolean; waiting(): string | null
  /** The open tab was closed and its neighbour opened by itself: the follow rules look at it. */
  landed?(): void
}
let picker: SheetPicker | null = null
/** cellSheets.ts: picks go through it (sheetFollow.ts). Returns the way to let go. */
export function setSheetPicker(next: SheetPicker): () => void {
  picker = next
  return () => { if (picker === next) picker = null }
}
/** A tab picked by hand (a click on it). */
export const selectSheet = (id: string): boolean => (picker ? picker.pick(id) : showSheet(id))
/** Next (+1) / previous (-1) sheet, round the end (Pen ▸ Next / Previous Sheet), from the tab a pick waits for if any. */
export function stepSheet(by: 1 | -1): boolean {
  const from = picker?.waiting() ?? null
  const base = from && set.tabs.some((tab) => tab.id === from) ? { ...set, current: from } : set
  const next = stepIn(base, by)
  return next !== base && selectSheet(next.current)
}
export const sheetHasInk = (id: string): boolean => (entries.get(id)?.page.strokes.length ?? 0) > 0

// MARK: - Kept on disk

const SAVE_MS = 600
let timer: ReturnType<typeof setTimeout> | null = null

function snapshot(): StoredSheets {
  return {
    current: set.current,
    ...(lastPlain ? { plain: lastPlain } : {}),
    sheets: set.tabs.map((tab) => {
      const entry = entries.get(tab.id)!
      const page = entry.page
      const cell = cellOf(page)
      return {
        id: tab.id, name: tab.name, paper: entry.paper, strokes: page.strokes,
        ...(cell ? { cell, pending: (page as CellPage).pending, ...((page as CellPage).shape !== null ? { shape: (page as CellPage).shape! } : {}) } : {}),
      }
    }),
  }
}

function writeNow(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (!loaded) return
  try { window.wm?.sheets?.save(serialiseSheets(snapshot())) } catch { /* main is gone: kept for the session */ }
}

function save(): void {
  if (!loaded || typeof window === "undefined") return
  if (timer) clearTimeout(timer)
  timer = setTimeout(writeNow, SAVE_MS)
}

/** What was on disk takes the place of the empty first sheet (a sheet written on before it arrived is kept too). */
function adopt(stored: StoredSheets | null): void {
  loaded = true
  if (!stored) {
    // Nothing on disk: a sheet written on before the answer came is written now, not at its next change.
    if ([...entries.values()].some((entry) => entry.page.strokes.length > 0)) save()
    return
  }
  const before = [...entries.entries()]
  const early = before.filter(([, entry]) => entry.page.strokes.length > 0)
  for (const [id, entry] of before) {
    if (!early.some(([kept]) => kept === id)) { entry.off(); entries.delete(id) }
  }
  let next: SheetSet = { tabs: [], current: stored.current }
  for (const sheet of stored.sheets) {
    entries.set(sheet.id, entryFor(sheet.id, sheet.strokes, sheet.paper, sheet.cell, sheet.pending, sheet.shape))
    next = { ...next, tabs: [...next.tabs, { id: sheet.id, name: sheet.name }] }
  }
  for (const [id] of early) next = addTo(next, id)
  set = { ...next, current: early.length > 0 ? next.current : stored.current }
  lastPlain = stored.plain ?? null
  showPaper()
  refreshView()
  if (early.length > 0) save()
}

if (typeof window !== "undefined") {
  const api = window.wm?.sheets
  if (api) {
    api.load().then((text) => adopt(parseSheets(text)), () => adopt(null))
    // A window that closes writes what the last half second held.
    window.addEventListener("pagehide", writeNow)
    window.addEventListener("beforeunload", writeNow)
  } else {
    loaded = true
  }
  // End-to-end scripts (WRITEMIND_E2E, whose preload adds `e2eWindow`) read the open sheet's strokes and drive the tabs.
  if ((window as unknown as { wm?: { e2eWindow?: unknown } }).wm?.e2eWindow) {
    const w = window as unknown as Record<string, unknown>
    Object.defineProperty(w, "__wmSheet", { configurable: true, get: currentSheet })
    w.__wmSheets = {
      view: sheetTabs, add: addSheet, close: closeSheet, rename: renameSheet, select: selectSheet, step: stepSheet,
      show: showSheet, plain: () => lastPlain,
      loaded: () => loaded, flush: writeNow,
      bound: () => boundPages().map((page) => ({ sheet: page.sheet, ...page.ref, pending: page.pending, frame: page.frame })),
    }
  }
}
