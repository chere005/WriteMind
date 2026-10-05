/**
 * What the pen is reporting RIGHT NOW, and what it has ever reported: the
 * tip, the lower and upper side buttons, the eraser end and the pressure.
 * It feeds three readers — the "Test buttons" panel in the Pen popover, the
 * Pen chip (which names the action a held button has), and the pen cursor
 * (which draws the marquee ring / eraser cross / hand for it).
 *
 * Subscribers hear about a change in WHICH BUTTONS are down; pressure alone
 * is only broadcast to a reader that asked for it (`watchPressure`), once a
 * frame, so a drawing stroke does not re-render anything.
 */

import { useEffect, useSyncExternalStore } from "react"
import { buttonsOf, slotOf, type HoldAction, type Slot } from "./penButtons"
import { penSettings } from "./penSettings"

export interface PenLive {
  tip: boolean
  lower: boolean
  upper: boolean
  eraser: boolean
  alt: boolean
  pressure: number
  /** Which buttons the system has EVER reported since the window opened. */
  seen: { tip: boolean; lower: boolean; upper: boolean; eraser: boolean }
  /** The pointer is a pen, and the last event came from it. */
  pen: boolean
}

let live: PenLive = {
  tip: false, lower: false, upper: false, eraser: false, alt: false, pressure: 0,
  seen: { tip: false, lower: false, upper: false, eraser: false }, pen: false,
}
/** What the buttons readers see: a new object only when a button changed. */
let shown = live
/** What the pressure readers see: replaced once a frame while the pen moves. */
let shownPressure = live
const listeners = new Set<() => void>()
const pressureListeners = new Set<() => void>()
let pressureWatchers = 0
let frame: number | null = null

export const penLive = (): PenLive => live
const notify = () => { shown = live; shownPressure = live; listeners.forEach((listener) => listener()) }

function sample(event: PointerEvent): void {
  if (event.pointerType !== "pen") return
  const tip = (event.buttons & 1) !== 0
  const lower = (event.buttons & 2) !== 0
  const upper = (event.buttons & 4) !== 0
  const eraser = (event.buttons & 32) !== 0 || event.button === 5 && event.type === "pointerdown"
  const alt = event.altKey
  const changed = tip !== live.tip || lower !== live.lower || upper !== live.upper
    || eraser !== live.eraser || alt !== live.alt || !live.pen
  const seen = {
    tip: live.seen.tip || tip, lower: live.seen.lower || lower,
    upper: live.seen.upper || upper, eraser: live.seen.eraser || eraser,
  }
  const grew = seen.tip !== live.seen.tip || seen.lower !== live.seen.lower
    || seen.upper !== live.seen.upper || seen.eraser !== live.seen.eraser
  live = { tip, lower, upper, eraser, alt, pressure: tip || eraser ? event.pressure : 0, seen, pen: true }
  if (changed || grew) notify()
  else if (pressureWatchers > 0 && frame === null) {
    frame = requestAnimationFrame(() => { frame = null; shownPressure = live; pressureListeners.forEach((listener) => listener()) })
  }
}

let installed = false
export function watchLive(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    window.addEventListener(type, (event) => sample(event as PointerEvent), true)
  }
  document.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "pen" || !live.pen) return
    live = { ...live, tip: false, lower: false, upper: false, eraser: false, pressure: 0 }
    notify()
  }, true)
}

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The action of the button that is held now, if one is: what the pen is "in". */
export function heldSlot(state: PenLive = live): Slot | null {
  if (!state.pen) return null
  return slotOf({
    pointerType: "pen", button: -1, altKey: state.alt,
    buttons: (state.tip ? 1 : 0) | (state.lower ? 2 : 0) | (state.upper ? 4 : 0) | (state.eraser ? 32 : 0),
  })
}

/** The HOLD action of that button: what the pen will do when it touches. */
export function heldAction(state: PenLive = live): HoldAction | null {
  const slot = heldSlot(state)
  return slot ? buttonsOf(penSettings())[slot].hold : null
}

export function usePenLive(options: { pressure?: boolean } = {}): PenLive {
  useEffect(() => {
    if (!options.pressure) return
    pressureWatchers++
    return () => { pressureWatchers-- }
  }, [options.pressure])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      if (options.pressure) pressureListeners.add(listener)
      return () => { listeners.delete(listener); pressureListeners.delete(listener) }
    },
    () => (options.pressure ? shownPressure : shown),
  )
}

