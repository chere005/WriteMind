/**
 * Where the window was, and where it opens next time. Pure: the shell hands
 * in the displays and reads the answer, so the rules (never off-screen, never
 * smaller than the minimum, maximised stays maximised) are a test.
 *
 * The Mac gets this from AppKit's frame autosave; Electron has none.
 */

import { DEFAULT_WINDOW, MIN_WINDOW } from "../shared/layout"

export interface Rect { x: number; y: number; width: number; height: number }

export interface SavedWindow {
  /** The window's NORMAL bounds (what it is when not maximised or minimised). */
  bounds: Rect
  maximized: boolean
}

export interface Placement {
  /** Only the size when the position should be left to the system. */
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export function parseSaved(text: string | null): SavedWindow | null {
  if (!text) return null
  try {
    const raw = JSON.parse(text) as Partial<SavedWindow>
    const b = raw.bounds as Partial<Rect> | undefined
    if (!b) return null
    const numbers = [b.x, b.y, b.width, b.height]
    if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null
    return {
      bounds: { x: b.x!, y: b.y!, width: b.width!, height: b.height! },
      maximized: raw.maximized === true,
    }
  } catch {
    return null
  }
}

/** How much of `a` lies inside `b`, in pixels. */
function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  }
}

/**
 * Where to open. A saved window comes back as it was, unless it would be
 * (nearly) off every display — a monitor unplugged since — in which case the
 * size is kept and the system places it. No saved window: the Mac's default
 * size, centred on the primary display, clamped to what that display has.
 *
 * `workAreas` are the displays' usable rectangles; the first is the primary.
 */
export function placeWindow(saved: SavedWindow | null, workAreas: Rect[]): Placement {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: 1920, height: 1080 }
  const fit = (size: { width: number; height: number }, area: Rect) => ({
    width: Math.max(MIN_WINDOW.width, Math.min(size.width, area.width)),
    height: Math.max(MIN_WINDOW.height, Math.min(size.height, area.height)),
  })

  if (saved) {
    const size = {
      width: Math.max(MIN_WINDOW.width, Math.round(saved.bounds.width)),
      height: Math.max(MIN_WINDOW.height, Math.round(saved.bounds.height)),
    }
    // Visible enough to be grabbed: 100 x 50 px of it on some display.
    const seen = workAreas.some((area) => {
      const o = overlap({ ...saved.bounds, ...size }, area)
      return o.width >= 100 && o.height >= 50
    })
    if (seen) {
      return { x: Math.round(saved.bounds.x), y: Math.round(saved.bounds.y), ...size, maximized: saved.maximized }
    }
    const small = fit(size, primary)
    return { ...small, maximized: saved.maximized }
  }

  const size = fit(DEFAULT_WINDOW, primary)
  return {
    x: Math.round(primary.x + (primary.width - size.width) / 2),
    y: Math.round(primary.y + (primary.height - size.height) / 2),
    ...size,
    maximized: false,
  }
}
