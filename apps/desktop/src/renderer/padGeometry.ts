/**
 * The geometry of the tablet sheet, with no React and no DOM so that it can be
 * tested with numbers.
 *
 * THE DRIVER OWNS THE MAPPING. A Wacom tablet in Pen mode is mapped by its
 * driver to the whole screen (or to the portion of it the person chose in
 * Wacom Tablet Properties ▸ Mapping): the pen's absolute position on the
 * tablet becomes an absolute position on the screen. An app cannot change
 * that. What it CAN do is make the part of the screen the driver maps to be
 * the sheet:
 *
 *  - PAD MODE: the window goes full screen and shows only the sheet, so the
 *    whole tablet maps 1:1 (proportionally) onto the sheet.
 *  - TABLET AREA: for a person who keeps the notes in view, the sheet is a
 *    rectangle on the screen, and this file says exactly which one, in
 *    physical pixels, so it can be given to the driver.
 */

import type { Rect, Size } from "@writemind/core"

/** The largest rectangle of shape `aspect` (width over height) that fits in `container`, centred. */
export function fitRect(container: Size, aspect: number): Rect {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) {
    return { x: 0, y: 0, width: Math.max(0, container.width), height: Math.max(0, container.height) }
  }
  let width = container.width, height = width / aspect
  if (height > container.height) { height = container.height; width = height * aspect }
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height }
}

/** The sheet's shape from a screen's size, or `fallback` when the size is unusable. */
export function aspectOf(width: number, height: number, fallback = 16 / 9): number {
  return width > 0 && height > 0 && width / height > 0.2 && width / height < 5 ? width / height : fallback
}

/** The shape the sheet takes on this machine: the screen's (or a number kept for testing). */
export function screenAspect(): number {
  try {
    const kept = Number(localStorage.getItem("writemind.sheetAspect"))
    if (kept > 0.2 && kept < 5) return kept
  } catch { /* no storage */ }
  return typeof window === "undefined" ? 16 / 9 : aspectOf(window.screen.width, window.screen.height)
}

/** Where the window is on the desktop, as the shell reports it (device-independent pixels). */
export interface DisplayInfo {
  /** The window's content area. */
  content: Rect
  /** The display the window is on. */
  display: Rect
  /** Physical pixels per device-independent pixel on that display (1.5 at 150%). */
  scale: number
}

/** A rectangle in the physical pixels of one display, origin at that display's top-left. */
export interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
  /** Opposite corner, inclusive of the rectangle (what the second click of 'Click to define' lands on). */
  right: number
  bottom: number
  /** The display's own size in physical pixels. */
  screenWidth: number
  screenHeight: number
}

/**
 * The sheet's rectangle on the display, in PHYSICAL pixels. `inWindow` is the
 * sheet's getBoundingClientRect (CSS pixels from the page's top-left);
 * `info` is where the page itself is on the desktop. A page's CSS pixel is
 * a device-independent one, so the conversion to physical is the display's
 * scale — which is what makes the answer right at 150% and on a second monitor.
 */
export function physicalRect(inWindow: Rect, info: DisplayInfo): PhysicalRect {
  const left = info.content.x - info.display.x + inWindow.x
  const top = info.content.y - info.display.y + inWindow.y
  const x = Math.round(left * info.scale), y = Math.round(top * info.scale)
  const width = Math.round(inWindow.width * info.scale), height = Math.round(inWindow.height * info.scale)
  return {
    x, y, width, height, right: x + width - 1, bottom: y + height - 1,
    screenWidth: Math.round(info.display.width * info.scale), screenHeight: Math.round(info.display.height * info.scale),
  }
}

/**
 * Without the shell's answer (a browser, a test) the window's own numbers
 * will do: `screenX/Y` are the window's outer corner and `devicePixelRatio`
 * the scale. Less exact — the frame's thickness is guessed from the
 * outer/inner difference — but never missing.
 */
export function fallbackInfo(win: {
  screenX: number; screenY: number; outerWidth: number; outerHeight: number
  innerWidth: number; innerHeight: number; devicePixelRatio: number
  screen: { width: number; height: number }
}): DisplayInfo {
  const side = Math.max(0, (win.outerWidth - win.innerWidth) / 2)
  const top = Math.max(0, win.outerHeight - win.innerHeight - side)
  return {
    content: { x: win.screenX + side, y: win.screenY + top, width: win.innerWidth, height: win.innerHeight },
    display: { x: 0, y: 0, width: win.screen.width, height: win.screen.height },
    scale: win.devicePixelRatio || 1,
  }
}

/** A line a person can read: "x 1,234 y 56 to x 2,000 y 480 (766 × 424 px)". */
export function describeArea(area: PhysicalRect): string {
  const n = (value: number) => value.toLocaleString("en-US")
  return `x ${n(area.x)}, y ${n(area.y)}  to  x ${n(area.right)}, y ${n(area.bottom)}  (${n(area.width)} × ${n(area.height)} px of ${n(area.screenWidth)} × ${n(area.screenHeight)})`
}

/** Pen-state hover reveals the strip when it is within this many pixels of the top edge. */
export const STRIP_EDGE = 28

/**
 * Whether the pad's top strip should be showing. It comes down when the pen
 * (or pointer) is at the top edge or over the strip itself, stays while a
 * pointer is on it, and goes away on its own a moment after the pointer
 * leaves — and never while a stroke is being written.
 */
export function stripWanted(state: {
  y: number | null
  overStrip: boolean
  writing: boolean
  pinned: boolean
  sinceLeft: number
  hideAfter?: number
}): boolean {
  if (state.writing) return false
  if (state.pinned || state.overStrip) return true
  if (state.y !== null && state.y <= STRIP_EDGE) return true
  return state.sinceLeft < (state.hideAfter ?? 1800)
}
