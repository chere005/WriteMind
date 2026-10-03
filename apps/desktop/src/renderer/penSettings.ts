/**
 * The tablet pen's settings and what the app has seen of it.
 *
 * A Wacom (or any Windows Ink) pen arrives as `pointerType: "pen"` pointer
 * events. Two choices belong to the person, kept in localStorage:
 *
 *  - `penDraws`: the pen's tip draws on the page whatever the mode is, so
 *    the mouse can keep selecting and typing while the pen writes. (Off, the
 *    pen follows the ✎ button like the mouse does.)
 *  - `pressure`: pressure changes the width of the stroke.
 *  - `buttons`: the ACTION each of the pen's buttons has (lower side
 *    button, upper side button, eraser end, tip held with Alt) — see
 *    penButtons.ts. `sideButton` is the old two-way choice for the lower
 *    button, kept as a derived field so older readers still work.
 *
 * `eraser` is the Erase TOOL and `selectTool` the Select tool (toggles on
 * the toolbar, on the tablet surface and on ExpressKeys): neither is
 * remembered, so the app never comes up erasing, and they exclude each other.
 *
 * And one thing is learned, not chosen: whether the pen has been SEEN, and
 * whether it reports pressure at all. A driver without Windows Ink sends
 * every sample at 0.5 (or 0 while hovering); saying so is the difference
 * between "Wacom support is missing" and "turn on Windows Ink".
 */

import { useSyncExternalStore } from "react"
import { DEFAULT_BUTTONS, SLOTS, isPenAction, type PenButtonMap, type Slot } from "./penButtons"

export type PenSeen = "none" | "pen" | "pressure"

export type SideButton = "selects" | "erases"

export interface PenSettings {
  penDraws: boolean
  pressure: boolean
  /** Derived from `buttons.lower`: erases, or selects. */
  sideButton: SideButton
  buttons: PenButtonMap
  /** The Erase tool is on: a press rubs out strokes, whatever the pointer. */
  eraser: boolean
  /** The Select tool is on: a press picks up / moves objects or pulls a marquee. */
  selectTool: boolean
  seen: PenSeen
}

const KEY = "writemind.pen"

const sideOf = (buttons: PenButtonMap): SideButton => (buttons.lower === "erase" ? "erases" : "selects")

function load(): Pick<PenSettings, "penDraws" | "pressure" | "sideButton" | "buttons"> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PenSettings>
    const buttons: PenButtonMap = { ...DEFAULT_BUTTONS }
    // The old two-way choice, from before every button had an action.
    if (raw.sideButton === "erases") buttons.lower = "erase"
    for (const slot of SLOTS) {
      const value = (raw.buttons as Record<string, unknown> | undefined)?.[slot]
      if (isPenAction(value)) buttons[slot] = value
    }
    return {
      penDraws: raw.penDraws ?? true, pressure: raw.pressure ?? true, buttons, sideButton: sideOf(buttons),
    }
  } catch {
    return { penDraws: true, pressure: true, buttons: { ...DEFAULT_BUTTONS }, sideButton: "selects" }
  }
}

let state: PenSettings = { ...load(), eraser: false, selectTool: false, seen: "none" }
const listeners = new Set<() => void>()

function set(next: Partial<PenSettings>): void {
  state = { ...state, ...next }
  try {
    localStorage.setItem(KEY, JSON.stringify({
      penDraws: state.penDraws, pressure: state.pressure, sideButton: state.sideButton, buttons: state.buttons,
    }))
  } catch { /* private window: the setting lasts the session */ }
  listeners.forEach((listener) => listener())
}

export const penSettings = (): PenSettings => state
export const setPenDraws = (penDraws: boolean) => set({ penDraws })
export const setPressure = (pressure: boolean) => set({ pressure })
export const setButton = (slot: Slot, action: PenButtonMap[Slot]) => {
  const buttons = { ...state.buttons, [slot]: action }
  set({ buttons, sideButton: sideOf(buttons) })
}
export const setSideButton = (sideButton: SideButton) => setButton("lower", sideButton === "erases" ? "erase" : "select")
export const setEraser = (eraser: boolean) => set(eraser ? { eraser, selectTool: false } : { eraser })
export const setSelectTool = (selectTool: boolean) => set(selectTool ? { selectTool, eraser: false } : { selectTool })
/** Both one-gesture tools put away: the pen writes again. */
export const putToolsDown = () => { if (state.eraser || state.selectTool) set({ eraser: false, selectTool: false }) }

/** When a pen was last seen (any event, hovering too): a touch just after it is a palm. */
let penAt = -Infinity
export const penNear = (within = 1200): boolean => performance.now() - penAt < within

/** Called for every pointer event: the one place a pen is noticed. */
export function noticePen(event: PointerEvent): void {
  if (event.pointerType !== "pen") return
  penAt = performance.now()
  // Anything but the two values a driver without pressure sends.
  const varies = event.pressure > 0 && event.pressure !== 0.5
  if (state.seen === "pressure") return
  if (varies) set({ seen: "pressure" })
  else if (state.seen === "none") set({ seen: "pen" })
}

let installed = false
export function watchPen(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  window.addEventListener("pointerdown", noticePen, true)
  window.addEventListener("pointermove", noticePen, true)
}

export function usePenSettings(): PenSettings {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    penSettings,
  )
}
