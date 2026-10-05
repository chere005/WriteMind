/**
 * GRAB mode's decisions, as pure logic (no Electron, no clock of its own: the
 * caller passes the time) so they can be tested and so main and the tests use
 * the same rules.
 *
 * The overlay window that grabs the tablet covers the whole display. Windows
 * lets a window be either hit-testable (it gets the pen AND the mouse) or
 * click-through (neither reaches it; a "forward" option still hands it mouse
 * MOVES). It cannot be hit-testable for the pen alone. So there are two modes
 * and the machine decides which one the overlay is in:
 *
 *   pen    the overlay takes everything: the pen writes on the sheet.
 *   mouse  the overlay is click-through: the mouse works the notes as usual.
 *
 * WITH THE GLOBAL HOOK (main/penHook.ts, `hooked`) the device is known for every
 * mouse event on the whole screen: a pen-signed event is PEN at once and an
 * unsigned one is MOUSE at once, wherever the cursor is. Everything below is
 * the fallback for when the hook cannot load.
 *
 * Into MOUSE: the first real mouse event the overlay gets (it is swallowed),
 *   or twenty seconds with no pen at all (the watchdog: nothing is held for
 *   ever).
 * Into PEN: a pen event seen by the main window (the pen is over it while the
 *   overlay is click-through), or the cursor moving with no mouse move
 *   forwarded to the overlay for it (something other than the mouse moved it).
 * `lock` pins a mode (the "pen only" choice, and the end-to-end scripts).
 */

export type GrabMode = "pen" | "mouse"

/** No pen event for this long while the overlay is taking everything: let go of the mouse. */
export const WATCHDOG_MS = 20_000
/** A cursor move is blamed on the pen when no mouse move showed up for it within this window. */
export const CURSOR_GRACE_MS = 150
/** A mouse move this soon after the pen is the pen's own compatibility event, not a mouse. */
export const MOUSE_AFTER_PEN_MS = 250
/** Cursor movement below this many pixels is not movement. */
export const CURSOR_JITTER = 2

export class GrabModes {
  mode: GrabMode = "mouse"
  lock: GrabMode | null = null
  private lastPen = -Infinity
  private lastMouse = -Infinity
  private since = 0
  private cursor: { x: number; y: number } | null = null
  private moved: number | null = null
  /** A stroke is being written: the mode does not change under it. */
  penDown = false
  /** The global hook is classifying input: the guesses below are not needed (or trusted). */
  hooked = false

  /** The hook saw a pen-signed mouse event. Returns true when the mode changed. */
  penSignature(now: number): boolean { return this.pen(now) }

  /** The hook saw an unsigned (real mouse) event. A pen's own echo and a stroke under way hold the mode. */
  realMouse(now: number): boolean {
    this.lastMouse = now
    if (this.penDown || now - this.lastPen < MOUSE_AFTER_PEN_MS) return false
    return this.set("mouse", now)
  }

  constructor(now = 0, start: GrabMode = "mouse") {
    this.since = now
    this.mode = start
  }

  private set(mode: GrabMode, now: number): boolean {
    if (this.lock) mode = this.lock
    if (mode === this.mode) return false
    this.mode = mode
    this.since = now
    this.moved = null
    return true
  }

  setLock(lock: GrabMode | null, now: number): boolean {
    this.lock = lock
    return lock ? this.set(lock, now) : false
  }

  /** The overlay got a pen event while capturing, or the main window saw one. Returns true when the mode changed. */
  pen(now: number): boolean {
    this.lastPen = now
    return this.set("pen", now)
  }

  /** A real mouse event reached the overlay while it was capturing. */
  mouseCaptured(now: number): boolean {
    this.lastMouse = now
    if (this.hooked) return false
    if (this.penDown || now - this.lastPen < MOUSE_AFTER_PEN_MS) return false
    return this.set("mouse", now)
  }

  /** A mouse move forwarded to the click-through overlay: the mouse is what is moving the cursor. */
  mouseForwarded(now: number): void { this.lastMouse = now }

  /** The cursor's position, polled. */
  cursorAt(x: number, y: number, now: number): void {
    if (this.hooked) return
    const before = this.cursor
    this.cursor = { x, y }
    if (!before) return
    if (Math.hypot(x - before.x, y - before.y) <= CURSOR_JITTER) return
    if (this.moved === null) this.moved = now
  }

  /** Called a few times a second. Returns true when the mode changed. */
  tick(now: number): boolean {
    if (this.mode === "mouse" && this.moved !== null && now - this.moved >= CURSOR_GRACE_MS) {
      const mouseMoved = this.lastMouse >= this.moved - CURSOR_GRACE_MS
      this.moved = null
      if (!mouseMoved) return this.set("pen", now)
    }
    if (this.mode === "pen" && !this.penDown && now - Math.max(this.lastPen, this.since) > WATCHDOG_MS) {
      return this.set("mouse", now)
    }
    return false
  }
}

// MARK: - The overlay must never look like a full-screen app

export interface PlainRect { x: number; y: number; width: number; height: number }

/** How far short of the display's bottom edge the overlay stops (DIP). */
export const OVERLAY_MARGIN = 2

/**
 * Where the overlay goes on a display. Windows treats a top-most window that
 * exactly covers a monitor as a full-screen app: it can hide the taskbar, mute
 * notifications and make the shell and games flicker. So the overlay is NEVER
 * the monitor's exact rectangle: it covers the whole display (the pen is the
 * tablet's whole surface; the taskbar band is Explorer's and wins the hit test
 * anyway) but stops `OVERLAY_MARGIN` short of the bottom edge. The page maps pen positions with
 * the DISPLAY rectangle the shell reports, not with the overlay's own size, so
 * the missing strip moves nothing.
 */
export function overlayBounds(display: PlainRect): PlainRect {
  return { x: display.x, y: display.y, width: display.width, height: Math.max(1, display.height - OVERLAY_MARGIN) }
}

/** True when `window` would be taken for a full-screen app on `display` (it covers every pixel of it). */
export function coversDisplay(window: PlainRect, display: PlainRect): boolean {
  return window.x <= display.x && window.y <= display.y &&
    window.x + window.width >= display.x + display.width &&
    window.y + window.height >= display.y + display.height
}
