/**
 * The window's shape, once: the sizes the Mac's `ContentView` and
 * `WriteMindApp` give it, and the arithmetic of the divider between the notes
 * and the video. Nothing here knows about Electron or React, so the numbers
 * are a test and not a thing to measure on a screen.
 *
 * From the Mac:
 *  - the window opens 1280 x 800 and is never smaller than 900 x 560
 *    (`WindowGroup.defaultSize`, `.frame(minWidth: 900, minHeight: 560)`);
 *  - the sidebar is 250 wide and does not move;
 *  - the notes pane is at least 460 wide (ideal 720), the video at least 280
 *    (ideal 420) — `HSplitView` shares what is left in that proportion until
 *    the divider is dragged.
 */

export const DEFAULT_WINDOW = { width: 1280, height: 800 } as const
export const MIN_WINDOW = { width: 900, height: 560 } as const
export const SIDEBAR_WIDTH = 250
export const NOTES_MIN = 460
export const NOTES_IDEAL = 720
export const VIDEO_MIN = 280
export const VIDEO_IDEAL = 420

/** The share of the two panes the video gets when nobody has dragged the divider. */
export const DEFAULT_VIDEO_SHARE = VIDEO_IDEAL / (NOTES_IDEAL + VIDEO_IDEAL)

/**
 * How wide the video pane is, given the width the two panes share and the
 * fraction of it the video is meant to have (null: the default share).
 *
 * The notes keep their minimum while there is room for it; below that — the
 * window at its smallest with the sidebar out — the video gives way down to
 * its own minimum, and below THAT both squeeze in proportion (the window's
 * minimum width keeps this from ever being asked for in practice).
 */
export function videoWidth(available: number, fraction: number | null): number {
  if (!(available > 0)) return VIDEO_MIN
  const wanted = Math.round(available * (fraction ?? DEFAULT_VIDEO_SHARE))
  const notesMin = Math.min(NOTES_MIN, Math.max(0, available - VIDEO_MIN))
  const most = Math.max(VIDEO_MIN, available - notesMin)
  if (available < VIDEO_MIN + notesMin) return Math.max(0, available - notesMin)
  return Math.min(most, Math.max(VIDEO_MIN, wanted))
}

/** The fraction a dragged-to pixel width stands for, kept to four places so a resize does not drift it. */
export function fractionFor(available: number, video: number): number {
  if (!(available > 0)) return DEFAULT_VIDEO_SHARE
  return Math.round(Math.min(1, Math.max(0, video / available)) * 10000) / 10000
}

/** A stored fraction that is not a sensible one is no fraction. */
export function readFraction(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(value) && value > 0.05 && value < 0.95 ? value : null
}
