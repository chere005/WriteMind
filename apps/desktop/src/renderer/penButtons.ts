/**
 * What a press of the pen (or the mouse) means, with no React and no DOM in
 * it so the tests can ask it directly. Shared by the notes page
 * (`Canvas.tsx`), the tablet surface and the full-screen pad, so they can
 * never disagree about which button does what.
 *
 * WHAT CHROMIUM DELIVERS FOR A WACOM PEN (Windows Ink, 2-button pen):
 *
 *   tip                 button 0,  buttons bit 1
 *   lower side button   button 2,  buttons bit 2   (the "right click")
 *   upper side button   button 1,  buttons bit 4   (the "middle click"); some
 *                       drivers send it as the lower button too, and then the
 *                       two cannot be told apart — both read as "lower"
 *   eraser end          button 5,  buttons bit 32
 *
 * A side button pressed while the pen hovers arrives as a pointerdown with
 * `button` set and the tip bit clear; pressed with the tip already down it
 * is only a pointermove whose `buttons` changed; held at contact it is
 * `button 0` with the bit already set. All three are read the same way.
 *
 * Each of four SLOTS (lower, upper, eraser end, tip held with Alt) is given
 * an ACTION by the person. A HOLD action works while the button is down
 * during a gesture (marquee, extend, erase, pan). A TAP action fires once
 * when the button is pressed and let go again WITHOUT the tip touching
 * (undo, next colour, ...).
 */

export type PenAction =
  | "select" | "add" | "erase" | "pan"
  | "undo" | "redo" | "toggleErase" | "toggleSelect"
  | "nextColour" | "wider" | "thinner" | "togglePenDraws" | "contextMenu"
  | "deleteSelection" | "clearSelection" | "none"

/** Things only a key (an ExpressKey) asks for. */
export type PenCommandAction =
  | "togglePen" | "prevColour" | "sendWriting" | "sendPage" | "clearSheet"

export type Slot = "lower" | "upper" | "eraser" | "tipAlt"
export const SLOTS: Slot[] = ["lower", "upper", "eraser", "tipAlt"]

export type PenButtonMap = Record<Slot, PenAction>

export const DEFAULT_BUTTONS: PenButtonMap = {
  lower: "select",   // ⌘-drag, the marquee
  upper: "pan",      // the hand, to turn the page
  eraser: "erase",
  tipAlt: "none",
}

/** Held while a gesture lasts; every other action is a tap. */
export const HOLD_ACTIONS: PenAction[] = ["select", "add", "erase", "pan"]
export const isHold = (action: PenAction): boolean => HOLD_ACTIONS.includes(action)

/** The choices the Pen popover offers, in its order, with the words for each. */
export const ACTION_CHOICES: { action: PenAction; label: string }[] = [
  { action: "select", label: "Select (hold, like ⌘ drag)" },
  { action: "add", label: "Add to selection (hold, like ⇧)" },
  { action: "erase", label: "Erase (hold)" },
  { action: "pan", label: "Pan the page (hold)" },
  { action: "undo", label: "Undo (tap)" },
  { action: "redo", label: "Redo (tap)" },
  { action: "toggleErase", label: "Erase tool on/off (tap)" },
  { action: "toggleSelect", label: "Select tool on/off (tap)" },
  { action: "nextColour", label: "Next colour (tap)" },
  { action: "wider", label: "Wider pen (tap)" },
  { action: "thinner", label: "Thinner pen (tap)" },
  { action: "togglePenDraws", label: "Pen always draws on/off (tap)" },
  { action: "deleteSelection", label: "Delete selection (tap)" },
  { action: "clearSelection", label: "Clear selection (tap)" },
  { action: "contextMenu", label: "Right-click (tap)" },
  { action: "none", label: "None" },
]

export const SLOT_NAMES: Record<Slot, string> = {
  lower: "Lower side button", upper: "Upper side button", eraser: "Eraser end", tipAlt: "Tip + Alt",
}

export const ACTION_WORDS: Record<PenAction, string> = Object.fromEntries(
  ACTION_CHOICES.map((choice) => [choice.action, choice.label.replace(/ \((hold|tap).*$/, "")]),
) as Record<PenAction, string>

export const ALL_ACTIONS: PenAction[] = ACTION_CHOICES.map((choice) => choice.action)
export const isPenAction = (value: unknown): value is PenAction =>
  typeof value === "string" && (ALL_ACTIONS as string[]).includes(value)

// MARK: - Reading the buttons

export interface PressLike {
  pointerType: string
  button: number
  buttons: number
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  /** Not a standard field; a few builds expose it for the eraser end. */
  isEraser?: boolean
}

const BIT = { tip: 1, lower: 2, upper: 4, eraser: 32 }

export const isEraserEnd = (event: PressLike): boolean =>
  event.pointerType === "pen" && (event.button === 5 || (event.buttons & BIT.eraser) !== 0 || event.isEraser === true)

export const isSideButton = (event: PressLike): boolean =>
  event.pointerType === "pen" && (event.button === 2 || (event.buttons & BIT.lower) !== 0)

export const isUpperButton = (event: PressLike): boolean =>
  event.pointerType === "pen" && (event.button === 1 || (event.buttons & BIT.upper) !== 0)

/** Which button of the pen this event is made by, or null for the plain tip. */
export function slotOf(event: PressLike): Slot | null {
  if (event.pointerType !== "pen") return null
  if (isEraserEnd(event)) return "eraser"
  if (isSideButton(event)) return "lower"
  if (isUpperButton(event)) return "upper"
  if (event.altKey && (event.buttons & BIT.tip) !== 0) return "tipAlt"
  return null
}

/** Whether the physical button behind `slot` is still down in this event. */
export function slotHeld(event: PressLike, slot: Slot): boolean {
  switch (slot) {
    case "eraser": return (event.buttons & BIT.eraser) !== 0 || event.isEraser === true
    case "lower": return (event.buttons & BIT.lower) !== 0
    case "upper": return (event.buttons & BIT.upper) !== 0
    case "tipAlt": return event.altKey === true && (event.buttons & BIT.tip) !== 0
  }
}

/** The tip is on the tablet. */
export const tipDown = (event: PressLike): boolean => (event.buttons & BIT.tip) !== 0

// MARK: - What a press means

export interface PressSettings {
  buttons?: Partial<PenButtonMap>
  /** The old two-way choice, honoured when `buttons` says nothing about the lower button. */
  sideButton?: "selects" | "erases"
  eraser: boolean
  selectTool?: boolean
}

export function buttonsOf(settings: PressSettings): PenButtonMap {
  const lower = settings.buttons?.lower
    ?? (settings.sideButton === "erases" ? "erase" : DEFAULT_BUTTONS.lower)
  return { ...DEFAULT_BUTTONS, ...settings.buttons, lower }
}

export type Press =
  | { kind: "draw" }
  | { kind: "erase" }
  /** `tool`: the Select tool is on (a press on an object moves it; on nothing, a marquee). */
  | { kind: "select"; additive: boolean; tool: boolean }
  | { kind: "pan" }
  /** A tap action: the runtime fires it on the release; the surfaces must ignore the press. */
  | { kind: "tap"; action: PenAction; slot: Slot }
  | { kind: "ignore" }

export function resolvePress(event: PressLike, settings: PressSettings): Press {
  const slot = slotOf(event)
  if (slot) {
    const action = buttonsOf(settings)[slot]
    switch (action) {
      case "select": return { kind: "select", additive: false, tool: false }
      case "add": return { kind: "select", additive: true, tool: false }
      case "erase": return { kind: "erase" }
      case "pan": return { kind: "pan" }
      case "none":
        // A button given nothing to do does nothing — but the tip held with
        // Alt is simply a plain tip, and a tip pressed while a button is
        // held still writes.
        if (!(slot === "tipAlt" || (event.button === 0 && tipDown(event)))) return { kind: "ignore" }
        break
      default: return { kind: "tap", action, slot }
    }
  }
  if (settings.eraser) return { kind: "erase" }
  if (settings.selectTool) return { kind: "select", additive: false, tool: true }
  if (event.ctrlKey || event.metaKey) return { kind: "select", additive: false, tool: false }
  return { kind: "draw" }
}

export type PressAction = "draw" | "erase" | "select" | "pan" | "ignore"

/** The shared surfaces' view: tap actions are theirs to ignore (the runtime has them). */
export function pressAction(event: PressLike, settings: PressSettings): PressAction {
  const press = resolvePress(event, settings)
  return press.kind === "tap" ? "ignore" : press.kind
}

// MARK: - A tap

export interface TapState { slot: Slot | null; touched: boolean; action: PenAction | null }
export const noTap: TapState = { slot: null, touched: false, action: null }
export type Phase = "down" | "move" | "up" | "cancel"

/**
 * One pen event in, the tap state out, and the action to fire if this event
 * completed a tap: a TAP-action button pressed and let go without the tip
 * having touched in between. Pure, so a double fire is a test and not a
 * guess.
 */
export function tapStep(
  state: TapState, phase: Phase, event: PressLike, buttons: PenButtonMap,
): { state: TapState; fire: PenAction | null } {
  if (event.pointerType !== "pen") return { state, fire: null }
  if (phase === "cancel") return { state: noTap, fire: null }
  if (phase === "up") {
    const fire = state.slot !== null && !state.touched ? state.action : null
    return { state: noTap, fire }
  }
  if (state.slot === null) {
    const slot = slotOf(event)
    if (!slot) return { state, fire: null }
    const action = buttons[slot]
    if (isHold(action) || action === "none") return { state, fire: null }
    // Tip + Alt cannot be "let go without the tip touching": it fires on the press.
    if (slot === "tipAlt") return phase === "down"
      ? { state: { slot, touched: true, action }, fire: action }
      : { state, fire: null }
    return { state: { slot, touched: tipDown(event), action }, fire: null }
  }
  const touched = state.touched || tipDown(event)
  if (!slotHeld(event, state.slot)) {
    // The button came up without a pointerup of its own.
    return { state: noTap, fire: touched ? null : state.action }
  }
  return { state: touched === state.touched ? state : { ...state, touched }, fire: null }
}

// MARK: - Cycling colours and widths

export const PEN_WIDTHS = [1, 2, 3, 5, 8, 12]

/** The next (or previous) colour in `presets`; one not in the list starts from the first. */
export function cycleColour(current: string, presets: string[], direction: 1 | -1 = 1): string {
  if (presets.length === 0) return current
  const index = presets.findIndex((hex) => hex.toLowerCase() === current.toLowerCase())
  if (index < 0) return presets[direction === 1 ? 0 : presets.length - 1]!
  return presets[(index + direction + presets.length) % presets.length]!
}

/** One step wider or thinner along `widths`, stopping at the ends. */
export function stepWidth(current: number, widths: number[], direction: 1 | -1): number {
  const sorted = [...widths].sort((a, b) => a - b)
  if (direction === 1) return sorted.find((w) => w > current) ?? sorted[sorted.length - 1]!
  return [...sorted].reverse().find((w) => w < current) ?? sorted[0]!
}

// MARK: - Keys (ExpressKeys)

/** The menu/command id each key-only pen command runs. */
export const PEN_COMMANDS: Record<string, PenAction | PenCommandAction> = {
  penToggle: "togglePen",
  penErase: "toggleErase",
  penSelect: "toggleSelect",
  penNextColour: "nextColour",
  penPrevColour: "prevColour",
  penWider: "wider",
  penThinner: "thinner",
  penAlwaysDraws: "togglePenDraws",
  penDelete: "deleteSelection",
  penClearSelection: "clearSelection",
  penSendWriting: "sendWriting",
  penSendPage: "sendPage",
  penClearSheet: "clearSheet",
}
