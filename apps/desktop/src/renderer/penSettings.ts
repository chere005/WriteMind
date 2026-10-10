/**
 * The tablet pen's settings and what the app has seen of it.
 *
 * A Wacom (or any Windows Ink) pen arrives as `pointerType: "pen"` pointer
 * events. The choices belong to the person, kept in localStorage
 * (`writemind.pen`):
 *
 *  - `penDraws`: the pen's tip draws on the page whatever the mode is, so
 *    the mouse can keep selecting and typing while the pen writes. (Off, the
 *    pen follows the ✎ button like the mouse does.)
 *  - `pressure`: pressure changes the width of the stroke.
 *  - `buttons`: each of the pen's buttons (lower side button, upper side
 *    button, eraser end, tip held with Alt) has a HOLD action and the side
 *    buttons a DOUBLE-TAP action too — see penButtons.ts. Stored as `slots`;
 *    `buttons` (the hold actions alone) and `sideButton` (the oldest two-way
 *    choice) are written as well, for an older WriteMind reading the same key.
 *    An older map is migrated by `migrateButtons`.
 *
 * `eraser` is the Erase TOOL and `selectTool` the Select tool OF THE NOTEBOOK
 * (the drawing layer over the words): neither is remembered, so the app never
 * comes up erasing, and they exclude each other. Since 2026-10-10 the bar has
 * ONE pen button (Sean: "i only need a pen enabled and disabled button.. and a
 * dropdown to choose between pen or eraser"): `tool` is what that button is
 * (remembered), `eraser` is its on / off when it is the eraser, and the Select
 * tool has no button of its own (⌥⌘3; the page says so while it is on).
 * The TABLET SHEET has its own pair (`sheetTools`: the eraser set by the pen's
 * Erase Tool toggle (the header has no Erase button since 2026-10-05), the
 * header's Select; one pair for the whole set of sheets, not per tab, not remembered
 * either): nothing done in the notebook (a click, the pen button, Ctrl+P, a
 * placement tool: `putToolsDown`) changes the sheet's, and the sheet's never
 * light the notebook toolbar. The pen's toggle actions pick the pair of the
 * surface the pen is over (penActions.ts, tabletFocus.ts).
 *
 * And one thing is learned, not chosen: whether the pen has been SEEN, and
 * whether it reports pressure at all. A driver without Windows Ink sends
 * every sample at 0.5 (or 0 while hovering); saying so is the difference
 * between "Wacom support is missing" and "turn on Windows Ink".
 */

import { useSyncExternalStore } from "react"
import {
  DEFAULT_BUTTONS, hasDoubleTap, holdMap, migrateButtons,
  type HoldAction, type PenButtonMap, type Slot, type TapAction,
} from "./penButtons"

export type PenSeen = "none" | "pen" | "pressure"

export type SideButton = "selects" | "erases"

/**
 * WHAT THE BAR'S ONE PEN BUTTON DOES (Sean, 2026-10-10: "i only need a pen enabled and disabled button.. and a dropdown
 * to choose between pen or eraser (which switches the mode of the single button)"). The button toggles its tool; the
 * dropdown picks which tool that is. `pen` is the notebook's pen mode (the canvas draws), `eraser` is the Erase tool.
 * Remembered like the rest of the pen's settings; whether it is ON is not (the app never comes up erasing).
 */
export type PenTool = "pen" | "eraser"

export interface PenSettings {
  penDraws: boolean
  pressure: boolean
  /** Derived from `buttons.lower.hold`: erases, or anything else ("selects"). */
  sideButton: SideButton
  buttons: PenButtonMap
  /** What the bar's one pen button is: the pen or the eraser (the button's own on / off is `mode` / `eraser`). */
  tool: PenTool
  /** The Erase tool is on: a press rubs out strokes, whatever the pointer. */
  eraser: boolean
  /** The Select tool is on: a press picks up / moves objects or pulls a marquee. */
  selectTool: boolean
  seen: PenSeen
}

const KEY = "writemind.pen"

const sideOf = (buttons: PenButtonMap): SideButton => (buttons.lower.hold === "erase" ? "erases" : "selects")

function load(): Pick<PenSettings, "penDraws" | "pressure" | "sideButton" | "buttons" | "tool"> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PenSettings> & { slots?: unknown }
    const buttons = migrateButtons(raw)
    return {
      penDraws: raw.penDraws ?? true, pressure: raw.pressure ?? true, buttons, sideButton: sideOf(buttons),
      tool: raw.tool === "eraser" ? "eraser" : "pen",
    }
  } catch {
    return { penDraws: true, pressure: true, buttons: { ...DEFAULT_BUTTONS }, sideButton: sideOf(DEFAULT_BUTTONS), tool: "pen" }
  }
}

let state: PenSettings = { ...load(), eraser: false, selectTool: false, seen: "none" }
const listeners = new Set<() => void>()

function set(next: Partial<PenSettings>): void {
  state = { ...state, ...next }
  try {
    localStorage.setItem(KEY, JSON.stringify({
      penDraws: state.penDraws, pressure: state.pressure, tool: state.tool,
      slots: state.buttons,
      // For an older WriteMind on the same profile.
      buttons: holdMap(state.buttons), sideButton: state.sideButton,
    }))
  } catch { /* private window: the setting lasts the session */ }
  listeners.forEach((listener) => listener())
}

export const penSettings = (): PenSettings => state
export const setPenDraws = (penDraws: boolean) => set({ penDraws })
export const setPressure = (pressure: boolean) => set({ pressure })
/** One job of one button: `hold` (while the pen touches) or `double` (two taps in the air; side buttons only). */
export function setButton(slot: Slot, job: "hold", action: HoldAction): void
export function setButton(slot: Slot, job: "double", action: TapAction): void
export function setButton(slot: Slot, job: "hold" | "double", action: HoldAction | TapAction): void {
  if (job === "double" && !hasDoubleTap(slot)) return
  const buttons = { ...state.buttons, [slot]: { ...state.buttons[slot], [job]: action } }
  set({ buttons, sideButton: sideOf(buttons) })
}
export const setSideButton = (sideButton: SideButton) => setButton("lower", "hold", sideButton === "erases" ? "erase" : "select")
// The Erase tool on is the eraser being the bar's tool: the button's picture says so whichever way it was turned on.
export const setEraser = (eraser: boolean) => set(eraser ? { eraser, tool: "eraser", selectTool: false } : { eraser })
/** The bar's one button is the pen or the eraser (the dropdown's choice): only WHICH, never on or off. */
export const setPenTool = (tool: PenTool) => set({ tool })
export const setSelectTool = (selectTool: boolean) => set(selectTool ? { selectTool, eraser: false } : { selectTool })

/** Where the bar's one pen button is: its tool, whether the eraser is on, whether the pen is down (the app's mode). */
export interface PenButtonState { tool: PenTool; eraser: boolean; down: boolean }

/**
 * What pressing the pen button, picking from its dropdown or pressing its key does (docs/PLAN-bars-2026-10.md P1).
 *
 *  - `button`: the button's own click toggles its tool — the pen down or up, or the eraser on or off.
 *  - `choosePen` / `chooseEraser`: the dropdown's Pen / Eraser. They set what the button is AND turn it on (the
 *    wireframe: "Eraser picked: the same button, now erasing"); the other tool is let go.
 *  - `keyPen` (⌥⌘1) / `keyEraser` (⌥⌘2): the key is the button when its tool is already the button's, and the dropdown's
 *    choice when it is not ("⌥⌘2 sets the tool to eraser and toggles it"). So a key and the menu cannot disagree.
 */
export type PenPress = "button" | "choosePen" | "chooseEraser" | "keyPen" | "keyEraser"

export function nextPenButton(now: PenButtonState, press: PenPress): PenButtonState {
  switch (press) {
    case "button":
      return now.tool === "pen" ? { tool: "pen", eraser: false, down: !now.down } : { tool: "eraser", eraser: !now.eraser, down: now.down }
    case "choosePen": return { tool: "pen", eraser: false, down: true }
    case "chooseEraser": return { tool: "eraser", eraser: true, down: now.down }
    case "keyPen": return nextPenButton(now, now.tool === "pen" ? "button" : "choosePen")
    case "keyEraser": return nextPenButton(now, now.tool === "eraser" ? "button" : "chooseEraser")
  }
}

/**
 * ⌥⌘2 / the pen's Erase action for the NOTEBOOK: the same step as the menu and the button (the eraser's half never needs
 * the pen's mode, which belongs to the app).
 */
export function pressEraseKey(): void {
  const next = nextPenButton({ tool: state.tool, eraser: state.eraser, down: false }, "keyEraser")
  setPenTool(next.tool)
  setEraser(next.eraser)
}

/** Both of the NOTEBOOK's one-gesture tools put away: the pen writes on the page again (the sheet's stay as they are). */
export const putToolsDown = () => { if (state.eraser || state.selectTool) set({ eraser: false, selectTool: false }) }

// MARK: - The tablet sheet's own tools

/** The sheet's Erase and Select: one pair for every sheet tab, never remembered. */
export interface SheetTools { eraser: boolean; selectTool: boolean }

let sheet: SheetTools = { eraser: false, selectTool: false }
const sheetListeners = new Set<() => void>()
function setSheet(next: Partial<SheetTools>): void {
  const merged = { ...sheet, ...next }
  if (merged.eraser === sheet.eraser && merged.selectTool === sheet.selectTool) return
  sheet = merged
  sheetListeners.forEach((listener) => listener())
}
export const sheetTools = (): SheetTools => sheet
export const setSheetEraser = (eraser: boolean) => setSheet(eraser ? { eraser, selectTool: false } : { eraser })
export const setSheetSelect = (selectTool: boolean) => setSheet(selectTool ? { selectTool, eraser: false } : { selectTool })
/** What a press ON THE SHEET is resolved with: the pen's buttons and choices, the sheet's own tools. */
export const sheetPressSettings = (): PenSettings => ({ ...state, eraser: sheet.eraser, selectTool: sheet.selectTool })
export function useSheetTools(): SheetTools {
  return useSyncExternalStore(
    (listener) => { sheetListeners.add(listener); return () => sheetListeners.delete(listener) },
    sheetTools,
  )
}

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
