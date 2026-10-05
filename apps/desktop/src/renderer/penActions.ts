/**
 * The pen's TAP actions and the ExpressKey commands, run from one place.
 *
 * The parts of the app that own the thing an action changes register a
 * handler (`registerPenHandlers`): the app owns colour, width and the pen
 * mode, the undo hook owns undo, the drawing canvas owns the selection. The
 * toggles that live in `penSettings` need no handler. A button press and a
 * keystroke both end in `runPenAction`, so they cannot disagree.
 *
 * `installPenActions` is the runtime for the buttons. It listens on the
 * window in the capture phase, before any surface:
 *
 *  - a press whose action is a TAP, or NONE, is swallowed there, so no
 *    surface (notes page, tablet sheet, grab overlay) ever starts a gesture from it;
 *  - the same events drive `tapStep`, which fires the action once when the
 *    button comes up without the tip having touched.
 *
 * HOLD actions (select, add, erase, pan) are not here: they are gestures,
 * and each surface runs them.
 */

import { noTap, resolvePress, tapStep, PEN_COMMANDS, type Phase, type PenAction, type PenCommandAction, type TapState } from "./penButtons"
import { penSettings, setEraser, setPenDraws, setSelectTool } from "./penSettings"

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

export function runPenAction(action: Id): boolean {
  const owner = handlers.get(action)
  if (owner) { owner(); return true }
  const now = penSettings()
  switch (action) {
    case "toggleErase": setEraser(!now.eraser); return true
    case "toggleSelect": setSelectTool(!now.selectTool); return true
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

export function installPenActions(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  const hear = (phase: Phase) => (event: PointerEvent) => {
    if (event.pointerType !== "pen") return
    lastPoint = { x: event.clientX, y: event.clientY }
    const settings = penSettings()
    if (phase === "down") {
      const press = resolvePress(event, settings)
      const sheet = event.target instanceof Element && event.target.closest(".tablet") !== null
      // Not the surfaces' business: a tap, a button with nothing to do, or a
      // pan over a sheet that has nowhere to scroll.
      if (press.kind === "tap" || press.kind === "ignore" || (press.kind === "pan" && sheet)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const step = tapStep(tap, phase, event, settings.buttons)
    tap = step.state
    if (step.fire) runPenAction(step.fire)
  }
  window.addEventListener("pointerdown", hear("down"), true)
  window.addEventListener("pointermove", hear("move"), true)
  window.addEventListener("pointerup", hear("up"), true)
  window.addEventListener("pointercancel", hear("cancel"), true)
}
