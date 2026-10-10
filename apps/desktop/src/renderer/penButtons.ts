/**
 * What a press of the pen (or the mouse) means, with no React and no DOM in
 * it so the tests can ask it directly. Shared by the notes page
 * (`Canvas.tsx`, ink cells included: they draw with the same engine) and the
 * tablet sheet (`TabletSurface.tsx`), so they can never disagree about which
 * button does what.
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
 * A side button can arrive in more than one way, and every one is read:
 *  - pressed while the pen hovers: a pointerdown with `button` set, the tip
 *    bit clear and no pressure (the native tablet feed, penFeed.ts, always
 *    sends it so); on Windows Ink it may also not arrive at all, or only as
 *    the driver's right / middle MOUSE click (penActions.ts hears that echo);
 *  - the pen then touching: a pointermove that gains the contact (tip bit, or
 *    pressure);
 *  - pressed with the tip already down: a pointermove whose `buttons` changed;
 *  - held at contact: `button 0` with the bit already set, or (Windows Ink:
 *    the barrel at contact is the SECOND button, not the first) `button 2`
 *    with pressure and without the tip's bit.
 *
 * TWO JOBS PER SIDE BUTTON (Sean, 2026-10-05: "first button hold to erase
 * stroke, double tap to undo.. second button hold to select, double tap to
 * redo"). Each SLOT (lower, upper, eraser end, tip held with Alt) has a HOLD
 * action, which works while the button is held and the pen TOUCHES (erase,
 * select, add, pan), and the two side buttons also have a DOUBLE-TAP action:
 * two press-and-release of the button in the air, without the tip touching,
 * the second press within DOUBLE_TAP_MS of the first release (undo, redo,
 * ...). A single tap does nothing; a press held in the air does nothing.
 * The eraser end and Tip + Alt are touches, not presses in the air, so they
 * have a hold action only.
 */

import { WIDTH_LADDER } from "@writemind/core"

export type HoldAction = "select" | "add" | "erase" | "pan" | "none"
export type TapAction =
  | "undo" | "redo" | "toggleErase" | "toggleSelect"
  | "nextColour" | "wider" | "thinner" | "togglePenDraws" | "contextMenu"
  | "deleteSelection" | "clearSelection" | "none"
export type PenAction = HoldAction | TapAction

/** Things only a key (an ExpressKey) asks for. */
export type PenCommandAction =
  | "togglePen" | "prevColour" | "sendWriting" | "sendPage" | "clearSheet" | "nextSheet" | "prevSheet"

export type Slot = "lower" | "upper" | "eraser" | "tipAlt"
export const SLOTS: Slot[] = ["lower", "upper", "eraser", "tipAlt"]
/** The two side buttons: the only ones pressed in the air, so the only ones with a double tap. */
export type SideSlot = "lower" | "upper"
export const hasDoubleTap = (slot: Slot): slot is SideSlot => slot === "lower" || slot === "upper"

export interface SlotActions {
  /** While the button is held and the pen touches. */
  hold: HoldAction
  /** Two quick presses in the air (side buttons only; "none" elsewhere). */
  double: TapAction
}
export type PenButtonMap = Record<Slot, SlotActions>

/**
 * Sean's buttons (2026-10-05): "first button hold to erase stroke, double tap to undo.. second button hold to select, double
 * tap to redo". On his pen the SECOND is the one on Right Click (the "lower" slot: DOM button 2, Wintab's right-click bit) and the
 * FIRST is the other one, which the Wacom driver only lets through once it is set to Middle Click (the "upper" slot).
 */
export const DEFAULT_BUTTONS: PenButtonMap = {
  lower: { hold: "select", double: "redo" },   // the second button: the marquee (inside a selection: move it) / Redo
  upper: { hold: "erase", double: "undo" },    // the first button: rub out whole strokes / Undo
  eraser: { hold: "erase", double: "none" },
  tipAlt: { hold: "none", double: "none" },
}

/** The defaults of the first 0.5 test build, which had the two side buttons the wrong way round for Sean: a stored map equal to it was never chosen. */
export const SWAPPED_DEFAULTS: Pick<PenButtonMap, "lower" | "upper"> = {
  lower: { hold: "erase", double: "undo" },
  upper: { hold: "select", double: "redo" },
}

/** What each button did before a button had two jobs (0.4.0 and earlier): a stored value equal to it was never chosen. */
export const OLD_DEFAULTS: Record<Slot, PenAction> = { lower: "select", upper: "pan", eraser: "erase", tipAlt: "none" }

/** The choices the Pen popover offers in each column, in its order, with the app's words. */
export const HOLD_CHOICES: { action: HoldAction; label: string }[] = [
  { action: "erase", label: "Erase strokes" },
  { action: "select", label: "Select" },
  { action: "add", label: "Add to selection" },
  { action: "pan", label: "Pan the page" },
  { action: "none", label: "Nothing" },
]
export const DOUBLE_CHOICES: { action: TapAction; label: string }[] = [
  { action: "undo", label: "Undo" },
  { action: "redo", label: "Redo" },
  { action: "toggleErase", label: "Erase tool on/off" },
  { action: "toggleSelect", label: "Select tool on/off" },
  { action: "nextColour", label: "Next colour" },
  { action: "wider", label: "Wider pen" },
  { action: "thinner", label: "Thinner pen" },
  { action: "togglePenDraws", label: "Pen always draws on/off" },
  { action: "deleteSelection", label: "Delete selection" },
  { action: "clearSelection", label: "Clear selection" },
  { action: "contextMenu", label: "Right-click" },
  { action: "none", label: "Nothing" },
]

export const SLOT_NAMES: Record<Slot, string> = {
  lower: "Second button (Right Click)", upper: "First button (Middle Click)", eraser: "Eraser end", tipAlt: "Tip + Alt",
}

/** The popover's order: the first button first. */
export const ROW_ORDER: Slot[] = ["upper", "lower", "eraser", "tipAlt"]

export const ACTION_WORDS: Record<PenAction, string> = Object.fromEntries(
  [...HOLD_CHOICES, ...DOUBLE_CHOICES].map((choice) => [choice.action, choice.label]),
) as Record<PenAction, string>

export const HOLD_ACTIONS: HoldAction[] = HOLD_CHOICES.map((choice) => choice.action)
export const TAP_ACTIONS: TapAction[] = DOUBLE_CHOICES.map((choice) => choice.action)
export const isHoldAction = (value: unknown): value is HoldAction =>
  typeof value === "string" && (HOLD_ACTIONS as string[]).includes(value)
export const isTapAction = (value: unknown): value is TapAction =>
  typeof value === "string" && (TAP_ACTIONS as string[]).includes(value)
export const isPenAction = (value: unknown): value is PenAction => isHoldAction(value) || isTapAction(value)

// MARK: - The settings, old and new

/**
 * One stored value for a slot, of either age, as the slot's two jobs.
 *  - `{ hold, double }` (this version): each job kept if it is one, else the default's.
 *  - a single action (0.4.0 and earlier): the old default (never chosen) becomes the new default; a deliberate
 *    choice is kept — a hold action as the HOLD job, a one-shot action (which used to fire on a single tap in the
 *    air) as the DOUBLE TAP of a side button. The other job takes the new default.
 */
export function slotFrom(value: unknown, slot: Slot): SlotActions {
  const fallback = DEFAULT_BUTTONS[slot]
  if (value && typeof value === "object") {
    const pair = value as { hold?: unknown; double?: unknown }
    return {
      hold: isHoldAction(pair.hold) ? pair.hold : fallback.hold,
      double: hasDoubleTap(slot) && isTapAction(pair.double) ? pair.double : fallback.double,
    }
  }
  if (!isPenAction(value) || value === OLD_DEFAULTS[slot]) return { ...fallback }
  if (isHoldAction(value)) return { ...fallback, hold: value }
  return hasDoubleTap(slot) ? { ...fallback, double: value } : { ...fallback }
}

/**
 * The buttons from what `localStorage` holds (`writemind.pen`), of any age: `slots` (this version), else the old
 * `buttons` map, else the oldest two-way `sideButton`. Anything unreadable is the default.
 */
export function migrateButtons(raw: unknown): PenButtonMap {
  const stored = (raw && typeof raw === "object" ? raw : {}) as { slots?: unknown; buttons?: unknown; sideButton?: unknown }
  const map = { ...DEFAULT_BUTTONS }
  if (stored.slots && typeof stored.slots === "object") {
    for (const slot of SLOTS) map[slot] = slotFrom((stored.slots as Record<string, unknown>)[slot], slot)
    // The swapped defaults of the first test build were never chosen: they become the right ones.
    const same = (a: SlotActions, b: SlotActions): boolean => a.hold === b.hold && a.double === b.double
    if (same(map.lower, SWAPPED_DEFAULTS.lower) && same(map.upper, SWAPPED_DEFAULTS.upper)) {
      map.lower = { ...DEFAULT_BUTTONS.lower }
      map.upper = { ...DEFAULT_BUTTONS.upper }
    }
    return map
  }
  const old = (stored.buttons && typeof stored.buttons === "object" ? stored.buttons : {}) as Record<string, unknown>
  for (const slot of SLOTS) {
    // The oldest choice, from before every button had an action: the lower button erased.
    const value = slot === "lower" && old.lower === undefined && stored.sideButton === "erases" ? "erase" : old[slot]
    map[slot] = slotFrom(value, slot)
  }
  return map
}

/** The hold actions alone: what is stored as `buttons` for an older WriteMind that reads the same key. */
export const holdMap = (map: PenButtonMap): Record<Slot, HoldAction> =>
  Object.fromEntries(SLOTS.map((slot) => [slot, map[slot].hold])) as Record<Slot, HoldAction>

// MARK: - The popover's model

export interface ButtonRow {
  slot: Slot
  name: string
  hold: HoldAction
  /** null: this button has no double tap (the eraser end and Tip + Alt are touches). */
  double: TapAction | null
}

/** One row per button for the Pen popover: the name, the hold job, the double-tap job. */
export const buttonRows = (map: PenButtonMap): ButtonRow[] => ROW_ORDER.map((slot) => ({
  slot, name: SLOT_NAMES[slot], hold: map[slot].hold, double: hasDoubleTap(slot) ? map[slot].double : null,
}))

/** The side buttons in words, for the Pen chip's tooltip. */
export const buttonSummary = (map: PenButtonMap): string =>
  buttonRows(map).filter((row) => row.double !== null)
    .map((row) => `${row.name}: hold ${ACTION_WORDS[row.hold]}, double-tap ${ACTION_WORDS[row.double!]}`).join(". ")

// MARK: - Reading the buttons

export interface PressLike {
  pointerType: string
  button: number
  buttons: number
  /** 0 while hovering; > 0 in contact (0.5 from a pen that has no pressure). */
  pressure?: number
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  /** Not a standard field; a few builds expose it for the eraser end. */
  isEraser?: boolean
}

const BIT = { tip: 1, lower: 2, upper: 4, eraser: 32 }
const SIDE = BIT.lower | BIT.upper

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

/** The tip's bit is set. */
export const tipDown = (event: PressLike): boolean => (event.buttons & BIT.tip) !== 0

/**
 * The pen TOUCHES the tablet: the tip, the eraser end, or a side button with pressure (Windows Ink reports the barrel
 * held at contact as the second button instead of the first, with the pen's pressure). A side button in the air has
 * no pressure. Any other pointer: a button is down.
 */
export function inContact(event: PressLike): boolean {
  if ((event.buttons & (BIT.tip | BIT.eraser)) !== 0) return true
  if (event.pointerType !== "pen") return event.buttons !== 0
  return (event.buttons & SIDE) !== 0 && (event.pressure ?? 0) > 0
}

/**
 * The pen has just touched WITH a button held, after not touching: the moment a hold gesture begins when the button
 * was pressed in the air first (Chromium sends that touch as a pointermove, not a pointerdown). `was`: the pen
 * touched at the previous event.
 */
export const holdBegins = (was: boolean, event: PressLike): boolean =>
  event.pointerType === "pen" && !was && inContact(event) && slotOf(event) !== null && slotOf(event) !== "tipAlt"

/** A pen gesture lasts while the pen touches: this event (a lift with a side button still held) ends it. */
export const penLifted = (event: PressLike): boolean => event.pointerType === "pen" && !inContact(event)

// MARK: - What a press means

export interface PressSettings {
  /** Each slot's jobs; an old single action per slot is read as `slotFrom` reads it. */
  buttons?: Partial<Record<Slot, SlotActions | PenAction>>
  /** The oldest two-way choice, honoured when `buttons` says nothing about the lower button. */
  sideButton?: "selects" | "erases"
  eraser: boolean
  selectTool?: boolean
}

export function buttonsOf(settings: PressSettings): PenButtonMap {
  const map = { ...DEFAULT_BUTTONS }
  for (const slot of SLOTS) {
    const value = settings.buttons?.[slot]
    if (value !== undefined) map[slot] = slotFrom(value, slot)
  }
  if (settings.buttons?.lower === undefined && settings.sideButton) {
    map.lower = { ...map.lower, hold: settings.sideButton === "erases" ? "erase" : "select" }
  }
  return map
}

export type Press =
  | { kind: "draw" }
  | { kind: "erase" }
  /**
   * `tool`: the Select tool is on (a press on an object moves it; on nothing, a marquee). `move`: a press inside the
   * current selection's box moves the selection (the Select tool and the pen's Select button; not Ctrl).
   */
  | { kind: "select"; additive: boolean; tool: boolean; move: boolean }
  | { kind: "pan" }
  /** Nothing for a surface to do: a side button in the air (its double tap is the runtime's, penActions.ts). */
  | { kind: "ignore" }

export function resolvePress(event: PressLike, settings: PressSettings): Press {
  const slot = slotOf(event)
  if (slot) {
    // A side button pressed in the air does nothing; held while the pen touches, it is its hold action.
    if (hasDoubleTap(slot) && !inContact(event)) return { kind: "ignore" }
    switch (buttonsOf(settings)[slot].hold) {
      case "select": return { kind: "select", additive: false, tool: false, move: true }
      case "add": return { kind: "select", additive: true, tool: false, move: false }
      case "erase": return { kind: "erase" }
      case "pan": return { kind: "pan" }
      case "none":
        // A button given nothing to hold does nothing — but the tip held with Alt is a plain tip, and a pen that
        // touches while a side button is held still writes.
        if (slot === "eraser") return { kind: "ignore" }
        break
    }
  }
  if (settings.eraser) return { kind: "erase" }
  if (settings.selectTool) return { kind: "select", additive: false, tool: true, move: true }
  if (event.ctrlKey || event.metaKey) return { kind: "select", additive: false, tool: false, move: false }
  return { kind: "draw" }
}

export type PressAction = "draw" | "erase" | "select" | "pan" | "ignore"

/** The surfaces' view of a press. */
export function pressAction(event: PressLike, settings: PressSettings): PressAction {
  return resolvePress(event, settings).kind
}

/** A press at `point` is inside the selection's box (`box`: null when nothing is selected), with `slop` around it. */
export const insideBox = (point: { x: number; y: number }, box: { x: number; y: number; width: number; height: number } | null, slop = 4): boolean =>
  box !== null && point.x >= box.x - slop && point.x <= box.x + box.width + slop
    && point.y >= box.y - slop && point.y <= box.y + box.height + slop

// MARK: - The double tap

/** The second press must begin within this long of the first one's release. */
export const DOUBLE_TAP_MS = 400
/** A press held longer than this is not a tap. */
export const TAP_HOLD_MS = 500

export interface TapState {
  /** The side button that was down at the previous event (to see presses and releases as edges). */
  down: SideSlot | null
  /** The side button whose taps are being counted, or null. */
  slot: SideSlot | null
  /** That button is down now, as a press that may be a tap. */
  held: boolean
  pressedAt: number
  releasedAt: number
  /** Taps completed in this run. */
  taps: number
  /** The pen touched during this press: a hold, not a tap. */
  touched: boolean
}
export const noTap: TapState = { down: null, slot: null, held: false, pressedAt: 0, releasedAt: 0, taps: 0, touched: false }
export type Phase = "down" | "move" | "up" | "cancel"

const sideDown = (buttons: number): SideSlot | null =>
  (buttons & BIT.lower) !== 0 ? "lower" : (buttons & BIT.upper) !== 0 ? "upper" : null

/**
 * One pen event in (with its time, ms), the tap state out, and the action to fire if this event completed a DOUBLE
 * TAP: a side button pressed and let go twice without the pen touching, each press at most TAP_HOLD_MS, the second
 * beginning at most DOUBLE_TAP_MS after the first ended. Presses and releases are read as changes of `buttons`, so a
 * press that arrives as a pointerdown, a pointermove or a lost pointerup all count alike. Pure: timings are injected.
 */
export function tapStep(
  state: TapState, phase: Phase, event: PressLike, buttons: PenButtonMap, now: number,
): { state: TapState; fire: TapAction | null } {
  if (event.pointerType !== "pen") return { state, fire: null }
  if (phase === "cancel") return { state: noTap, fire: null }
  const down = phase === "up" ? null : sideDown(event.buttons)
  const touching = phase !== "up" && inContact(event)
  let s: TapState = state
  // A run whose next press never came in time is over.
  if (s.slot !== null && !s.held && now - s.releasedAt > DOUBLE_TAP_MS) s = { ...noTap, down: s.down }
  if (down === s.down) {
    if (s.held && touching && !s.touched) s = { ...s, touched: true }
    // The pen touching between the two taps ends the run.
    if (!s.held && s.slot !== null && touching) s = { ...noTap, down }
    return { state: s, fire: null }
  }
  // The button that was down came up (or the other one took over).
  if (s.held) {
    const quick = !s.touched && now - s.pressedAt <= TAP_HOLD_MS
    if (!quick) s = noTap
    else if (s.taps + 1 >= 2) {
      const action = buttons[s.slot!].double
      return { state: { ...noTap, down }, fire: action === "none" ? null : action }
    } else s = { ...s, held: false, taps: s.taps + 1, releasedAt: now }
  }
  if (down !== null) {
    // A new press. Pressed WITH contact it is a hold, and the end of any run.
    if (touching) return { state: { ...noTap, down }, fire: null }
    if (s.slot !== down) s = { ...noTap, slot: down }
    s = { ...s, slot: down, held: true, pressedAt: now, touched: false }
  }
  return { state: { ...s, down }, fire: null }
}

/**
 * A pen event as the double tap reads it while the Wacom driver's mouse click (the ECHO, penActions.ts) holds the side
 * buttons `echoBits` down: the pen's own hover samples in between carry no side bit, and without this each one read
 * as the button's release a few ms after the press (so the window became press-to-press and real double taps missed).
 */
export const echoed = (event: PressLike, echoBits: number): PressLike =>
  echoBits === 0 ? event : {
    pointerType: event.pointerType, button: event.button, buttons: event.buttons | echoBits, pressure: event.pressure,
  }

// MARK: - Cycling colours and widths

/** The pen's widths: the one ladder the inspector over a picked object offers too (core `WIDTH_LADDER`). */
export const PEN_WIDTHS = WIDTH_LADDER

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
  penNextSheet: "nextSheet",
  penPrevSheet: "prevSheet",
}
