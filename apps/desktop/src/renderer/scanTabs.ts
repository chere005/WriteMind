/**
 * THE DOCUMENT CAMERA'S SCANNED PAGES, live: each page scanned under the camera is a tab of its own beside the live
 * "Camera" tab, kept so a stack of pages can be scanned first and brought in later, or brought in again. The pure
 * rules (add / close / rename / open, the file format) are `scanSet.ts`; this is the state the camera pane shows and
 * the writer that keeps it, as `tabletSheets.ts` is for the tablet's sheets.
 *
 * KEPT ACROSS RESTARTS in userData/scans.json plus scans/<id>.jpg (main/scans.ts). The list is written after a quiet
 * moment and at quit; a picture is written BEFORE its page joins the list (`keepPage`), so the list never names a
 * missing file. Nothing is written until the file has been read, so a slow start cannot write an empty list over it.
 * Which tab is open is kept for the session only: a new launch starts on the camera.
 */

import { useSyncExternalStore } from "react"
import { addPage, closePage, emptySet, MAX_PAGES, parseScans, renamePage, selectPage, serialiseScans, updatePage, type ScanPage, type ScanSet } from "./scanSet"

let seq = 0
const newId = (): string => `p${Date.now().toString(36)}${(++seq).toString(36)}`

let set: ScanSet = emptySet()
let loaded = false
const listeners = new Set<() => void>()

const api = (): NonNullable<Window["wm"]["scans"]> | null => (typeof window === "undefined" ? null : window.wm?.scans ?? null)

export const scans = (): ScanSet => set
export const scansLoaded = (): boolean => loaded
export const canKeepMore = (): boolean => set.pages.length < MAX_PAGES && api() !== null
export const subscribeScans = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const useScans = (): ScanSet => useSyncExternalStore(subscribeScans, scans)

function apply(next: ScanSet): boolean {
  if (next === set) return false
  set = next
  listeners.forEach((listener) => listener())
  save()
  return true
}

/**
 * Keep a new page: its picture (JPEG bytes of the frame as the camera gave it) goes to disk first, then the page joins
 * the end of the list and opens. The id of the page, or null when it could not be kept (no room, no disk, no file API).
 */
export async function keepPage(bytes: Uint8Array, page: Omit<ScanPage, "id" | "name">): Promise<string | null> {
  const files = api()
  if (!files || set.pages.length >= MAX_PAGES) return null
  const id = newId()
  if (!(await files.put(id, bytes))) return null
  if (!apply(addPage(set, { ...page, id }))) { files.drop(id); return null }
  return id
}

/** The page goes, picture and all (the strip asks first). */
export function closeScan(id: string): boolean {
  if (!apply(closePage(set, id))) return false
  api()?.drop(id)
  return true
}

export const renameScan = (id: string, name: string): boolean => apply(renamePage(set, id, name))
/** Open a page, or the camera (null). */
export const openScan = (id: string | null): boolean => apply(selectPage(set, id))
/** What was done to a page since (its box, corners, turn, shape, reading): kept with it. */
export const changeScan = (id: string, patch: Partial<Omit<ScanPage, "id">>): boolean => apply(updatePage(set, id, patch))

/** A page's picture as the file holds it, or null (the file is gone). */
export async function pageBytes(id: string): Promise<Uint8Array | null> {
  try { return (await api()?.get(id)) ?? null } catch { return null }
}

// MARK: - Kept on disk

const SAVE_MS = 400
let timer: ReturnType<typeof setTimeout> | null = null

function writeNow(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (!loaded) return
  try { api()?.save(serialiseScans(set)) } catch { /* main is gone: kept for the session */ }
}

function save(): void {
  if (!loaded || typeof window === "undefined") return
  if (timer) clearTimeout(timer)
  timer = setTimeout(writeNow, SAVE_MS)
}

/** What was on disk comes first, a page kept before it arrived after it. */
function adopt(stored: ScanSet | null): void {
  loaded = true
  if (!stored) {
    // Nothing usable on disk: a page kept before the answer came is written now, not at its next change.
    if (set.pages.length > 0) save()
    return
  }
  const early = set.pages.filter((page) => !stored.pages.some((one) => one.id === page.id))
  set = { pages: [...stored.pages, ...early].slice(0, MAX_PAGES), current: set.current }
  listeners.forEach((listener) => listener())
  // Pictures no page names (a crash between a picture and the list) go; only ever after a list that was READ.
  api()?.sweep(set.pages.map((page) => page.id))
  if (early.length > 0) save()
}

if (typeof window !== "undefined") {
  const files = api()
  if (files) {
    files.load().then((text) => adopt(parseScans(text)), () => adopt(null))
    window.addEventListener("pagehide", writeNow)
    window.addEventListener("beforeunload", writeNow)
  } else {
    loaded = true
  }
  // End-to-end scripts (WRITEMIND_E2E, whose preload adds `e2eWindow`) read the list and drive the tabs.
  if ((window as unknown as { wm?: { e2eWindow?: unknown } }).wm?.e2eWindow) {
    ;(window as unknown as Record<string, unknown>).__wmScans = {
      set: () => set, open: openScan, close: closeScan, rename: renameScan, loaded: () => loaded, flush: writeNow,
      bytes: pageBytes,
    }
  }
}
