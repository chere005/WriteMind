/**
 * The pen's DOUBLE-TAP actions and the ExpressKey commands, run from one place.
 *
 * The parts of the app that own the thing an action changes register a
 * handler (`registerPenHandlers`): the app owns colour, width and the pen
 * mode, the undo hook owns undo (the note's ONE timeline, the same as
 * Ctrl+Z / Ctrl+Y), the drawing canvas owns the selection. The toggles that
 * live in `penSettings` need no handler. A button and a keystroke both end in
 * `runPenAction`, so they cannot disagree. Undo and redo with the pen over the
 * tablet sheet take back the sheet's own strokes first (tabletFocus.ts).
 *
 * `installPenActions` is the runtime for the buttons. It listens on the
 * window in the capture phase, before any surface:
 *
 *  - a press that is not a gesture (a side button pressed in the air) is
 *    swallowed there, so no surface (notes page, ink cell, tablet sheet) ever
 *    starts anything from it, and neither does the editor under it;
 *  - the same events drive `tapStep`, which fires a button's double-tap
 *    action once, on the second release. A single tap does nothing.
 *  - THE ECHO: on Windows Ink a side button pressed in the air may never reach
 *    the page as a pen event at all, only as the Wacom driver's right (lower)
 *    or middle (upper) MOUSE click at the pen. A mouse right / middle press
 *    while the pen is near, not touching, and not reporting the button itself
 *    is read as that button (and swallowed: it is not a click).
 *
 * HOLD actions (select, add, erase, pan) are not here: they are gestures, and
 * each surface runs them while the pen touches (penButtons.resolvePress).
 */

import { echoed, inContact, noTap, resolvePress, tapStep, PEN_COMMANDS, type Phase, type PenAction, type PenCommandAction, type PressLike, type TapState } from "./penButtons"
import { penNear, penSettings, setEraser, setPenDraws, setSelectTool, setSheetEraser, setSheetSelect, sheetTools } from "./penSettings"
import { penOnSheet, tabletUndo } from "./tabletFocus"
import { penGate } from "./penGate"

type Id = PenAction | PenCommandAction
const handlers = new Map<Id, () => void>()

/** Register what the owner of some actions does; the returned function takes them back. */
export function registerPenHandlers(map: Partial<Record<Id, () => void>>): () => void {
  const mine: [Id, () => void][] = []
  for (const [id, handler] of Object.entries(map) as [Id, () => void][]) {
    handlers.set(id, handler)
    mine.push([id, handler])
  }
  return () => { for (const [id, handler] of mine) if (handlers.get(id) === handler) handlers.delete(id) }
}

let lastPoint = { x: 0, y: 0 }
let allowMenu = false
/** True while a pen "right-click" action is dispatching its contextmenu event. */
export const penMenuAllowed = (): boolean => allowMenu

/** When a pen side button was last down (pen events or the driver's echo). */
let sideAt = -Infinity
/**
 * PER BUTTON (buttons bit 2 = lower, 4 = upper): when a PEN event last reported that side button itself (an echo just
 * after it is the same press), and whether a real (trusted) pen POINTERDOWN has reported it in the air (that button's
 * echo is then off for good). Per bit, because Windows Ink's pen data has one barrel flag: the lower button can come
 * as a pen event while the upper one only ever comes as the driver's middle click, and must keep its double tap.
 */
const penSideAt: Record<2 | 4, number> = { 2: -Infinity, 4: -Infinity }
const airSeen: Record<2 | 4, boolean> = { 2: false, 4: false }
/** The side buttons the driver's echo holds down now: the pen's hover samples meanwhile do not release them. */
let echoBits = 0
/** A side button of the pen is down now or was within `within` ms: no context menu may open. */
export const penButtonInUse = (within = 1000): boolean => performance.now() - sideAt < within

function rightClick(): void {
  const target = document.elementFromPoint(lastPoint.x, lastPoint.y) ?? document.body
  allowMenu = true
  try {
    target.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, composed: true, button: 2, buttons: 0,
      clientX: lastPoint.x, clientY: lastPoint.y, view: window,
    }))
  } finally { allowMenu = false }
}

/** The tablet bar's buttons, found by what they say (CameraPane.tsx owns them). */
function pressTabletButton(match: string): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".camera-bar button, [data-tablet]")]
  const found = buttons.find((button) => button.dataset.tablet === match.toLowerCase()
    || button.textContent?.trim() === match)
  if (found && !found.disabled) found.click()
}

/**
 * Erase / Select on or off FOR THE SURFACE THE PEN IS OVER (or was last over, tabletFocus.ts): the tablet sheet has
 * its own pair, the notebook's is the toolbar's ⌫ / ⬚. A double tap, an ExpressKey and the menu all come here.
 */
function toggleTool(which: "erase" | "select"): void {
  if (penOnSheet()) {
    const sheet = sheetTools()
    if (which === "erase") setSheetEraser(!sheet.eraser)
    else setSheetSelect(!sheet.selectTool)
    return
  }
  const now = penSettings()
  if (which === "erase") setEraser(!now.eraser)
  else setSelectTool(!now.selectTool)
}

/** `byPen`: a double tap of a side button (the sheet's undo then only when the pen is over the sheet, tabletFocus.ts). */
export function runPenAction(action: Id, byPen = false): boolean {
  // The sheet under the pen has its own strokes to take back (with nothing there, the note's turn).
  if ((action === "undo" || action === "redo") && tabletUndo(action, byPen)) return true
  const owner = handlers.get(action)
  if (owner) { owner(); return true }
  const now = penSettings()
  switch (action) {
    case "toggleErase": toggleTool("erase"); return true
    case "toggleSelect": toggleTool("select"); return true
    case "togglePenDraws": setPenDraws(!now.penDraws); return true
    case "contextMenu": rightClick(); return true
    case "sendWriting": pressTabletButton("Writing"); return true
    case "sendPage": pressTabletButton("Page"); return true
    case "clearSheet": pressTabletButton("clear"); return true
    case "none": return true
    default: return false
  }
}

/** A menu item or key by its command id ("penNextColour", ...). */
export function runPenCommand(id: string): boolean {
  const action = PEN_COMMANDS[id]
  return action ? runPenAction(action) : false
}

let tap: TapState = noTap
let installed = false

function step(phase: Phase, event: PressLike): void {
  const result = tapStep(tap, phase, event, penSettings().buttons, performance.now())
  tap = result.state
  if (result.fire) runPenAction(result.fire, true)
}

export function installPenActions(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  const hear = (phase: Phase) => (event: PointerEvent) => {
    if (event.pointerType === "mouse") { echo(phase, event); return }
    if (event.pointerType !== "pen") return
    lastPoint = { x: event.clientX, y: event.clientY }
    const side = event.buttons & 6
    if (side !== 0) {
      sideAt = performance.now()
      for (const bit of [2, 4] as const) {
        if ((side & bit) === 0) continue
        penSideAt[bit] = sideAt
        // The system itself reports this side button pressed in the air: its driver click is never needed (or counted).
        if (phase === "down" && event.isTrusted && !inContact(event)) airSeen[bit] = true
      }
    }
    // The pen touching (or the gesture cancelled) ends any press the echo was holding.
    if (phase === "cancel" || inContact(event)) echoBits = 0
    if (phase === "down") {
      const press = resolvePress(event, penSettings())
      const sheet = event.target instanceof Element && event.target.closest(".tablet") !== null
      // Not the surfaces' business: a side button in the air, or a pan over a sheet that has nowhere to scroll.
      if (press.kind === "ignore" || (press.kind === "pan" && sheet)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    // While the echo holds a button, the pen's own hover samples carry it too (penButtons.echoed).
    step(phase, echoed(event, echoBits))
  }
  /** The driver's mouse click for a side button pressed in the air (see the header). */
  const echo = (phase: Phase, event: PointerEvent) => {
    if (phase === "cancel") { echoBits = 0; return }
    if (phase !== "down" && phase !== "up") return
    const bit = event.button === 2 ? 2 : event.button === 1 ? 4 : 0
    // While the native feed owns the pen (the sheet), its samples carry the buttons themselves: an echo would count twice.
    if (bit === 0 || airSeen[bit] || !penNear(1000) || penGate().captureOn()) return
    const now = performance.now()
    // The pen reported this press itself (not an echo), or a release whose press was not taken as one.
    if ((phase === "down" && now - penSideAt[bit] < 300) || (phase === "up" && (echoBits & bit) === 0)) return
    event.preventDefault()
    event.stopPropagation()
    sideAt = now
    echoBits = phase === "down" ? echoBits | bit : echoBits & ~bit
    step(phase === "down" ? "down" : echoBits !== 0 ? "move" : "up",
      { pointerType: "pen", button: event.button, buttons: echoBits, pressure: 0 })
  }
  window.addEventListener("pointerdown", hear("down"), true)
  window.addEventListener("pointermove", hear("move"), true)
  window.addEventListener("pointerup", hear("up"), true)
  window.addEventListener("pointercancel", hear("cancel"), true)
}
