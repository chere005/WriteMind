import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_BUTTONS, DOUBLE_TAP_MS, PEN_COMMANDS, SLOTS, TAP_HOLD_MS, buttonRows, buttonSummary, cycleColour, echoed,
  holdBegins, inContact, insideBox, migrateButtons, noTap, penLifted, resolvePress, slotOf, stepWidth, tapStep,
  type PenButtonMap, type PressLike, type SlotActions, type TapAction, type TapState,
} from "../src/renderer/penButtons"
import { COMMANDS, commandForKey, matches } from "../src/shared/commands"

const pen = (button: number, buttons: number, extra: Partial<PressLike> = {}): PressLike =>
  ({ pointerType: "pen", button, buttons, pressure: buttons & 1 ? 0.5 : 0, ...extra })
const tool = { eraser: false, selectTool: false }
const map = (over: Partial<PenButtonMap>): PenButtonMap => ({ ...DEFAULT_BUTTONS, ...over })
/** The timing tests' own map (lower = erase / undo, upper = select / redo), so they do not move when the defaults do. */
const FIXED: PenButtonMap = map({ lower: { hold: "erase", double: "undo" }, upper: { hold: "select", double: "redo" } })
const both = (hold: SlotActions["hold"], double: TapAction): SlotActions => ({ hold, double })

describe("which pen button an event is", () => {
  it("reads the tip, both side buttons and the eraser end however the driver sends them", () => {
    expect(slotOf(pen(0, 1))).toBeNull()
    expect(slotOf(pen(2, 2))).toBe("lower")       // pressed while hovering
    expect(slotOf(pen(0, 3))).toBe("lower")       // already held at contact
    expect(slotOf(pen(-1, 3))).toBe("lower")      // a pointermove that gained the bit
    expect(slotOf(pen(1, 4))).toBe("upper")
    expect(slotOf(pen(0, 5))).toBe("upper")
    expect(slotOf(pen(5, 32))).toBe("eraser")
    expect(slotOf(pen(0, 33))).toBe("eraser")
    expect(slotOf(pen(0, 1, { isEraser: true }))).toBe("eraser")
  })
  it("the eraser outranks the lower button, which outranks the upper", () => {
    expect(slotOf(pen(0, 34))).toBe("eraser")
    expect(slotOf(pen(0, 6))).toBe("lower")
  })
  it("the tip with Alt is its own slot, and only with the tip down", () => {
    expect(slotOf(pen(0, 1, { altKey: true }))).toBe("tipAlt")
    expect(slotOf(pen(-1, 0, { altKey: true }))).toBeNull()
  })
  it("a mouse has no pen buttons", () => {
    expect(slotOf({ pointerType: "mouse", button: 2, buttons: 2 })).toBeNull()
    expect(slotOf({ pointerType: "touch", button: 0, buttons: 1 })).toBeNull()
  })
})

describe("touching", () => {
  it("is the tip, the eraser end, or a side button WITH pressure (Windows Ink's barrel at contact)", () => {
    expect(inContact(pen(0, 1))).toBe(true)
    expect(inContact(pen(5, 32))).toBe(true)
    expect(inContact(pen(2, 2))).toBe(false)                       // in the air
    expect(inContact(pen(2, 2, { pressure: 0.4 }))).toBe(true)     // the barrel at contact
    expect(inContact(pen(-1, 0))).toBe(false)
  })
  it("a hold begins where the touch begins, with a button held", () => {
    expect(holdBegins(false, pen(-1, 3))).toBe(true)
    expect(holdBegins(true, pen(-1, 3))).toBe(false)               // already touching (a stroke the button came into)
    expect(holdBegins(false, pen(-1, 2))).toBe(false)              // still in the air
    expect(holdBegins(false, pen(0, 1))).toBe(false)               // a plain tip is a pointerdown, not this
    expect(holdBegins(false, pen(-1, 1, { altKey: true }))).toBe(false)
  })
  it("a pen gesture ends where the touch ends, even with the button still held", () => {
    expect(penLifted(pen(-1, 2))).toBe(true)
    expect(penLifted(pen(-1, 3))).toBe(false)
    expect(penLifted({ pointerType: "mouse", button: -1, buttons: 0 })).toBe(false)
  })
})

describe("what a press resolves to", () => {
  it("defaults: the second button (Right Click) held at contact selects, the first (Middle Click) erases, eraser erases, tip draws", () => {
    expect(resolvePress(pen(0, 3), tool)).toEqual({ kind: "select", additive: false, tool: false, move: true })
    expect(resolvePress(pen(-1, 5), tool)).toEqual({ kind: "erase" })
    expect(resolvePress(pen(5, 32), tool)).toEqual({ kind: "erase" })
    expect(resolvePress(pen(0, 1), tool)).toEqual({ kind: "draw" })
    // Windows Ink: the barrel at contact is button 2 with pressure.
    expect(resolvePress(pen(2, 2, { pressure: 0.3 }), tool)).toEqual({ kind: "select", additive: false, tool: false, move: true })
  })
  it("a side button pressed in the air does nothing (its double tap is the runtime's)", () => {
    expect(resolvePress(pen(2, 2), tool)).toEqual({ kind: "ignore" })
    expect(resolvePress(pen(1, 4), tool)).toEqual({ kind: "ignore" })
    expect(resolvePress(pen(2, 2), { ...tool, selectTool: true })).toEqual({ kind: "ignore" })
  })
  it("each hold action", () => {
    expect(resolvePress(pen(0, 3), { ...tool, buttons: map({ lower: both("add", "undo") }) }))
      .toEqual({ kind: "select", additive: true, tool: false, move: false })
    expect(resolvePress(pen(0, 5), { ...tool, buttons: map({ upper: both("erase", "redo") }) })).toEqual({ kind: "erase" })
    expect(resolvePress(pen(0, 5), { ...tool, buttons: map({ upper: both("pan", "redo") }) })).toEqual({ kind: "pan" })
    expect(resolvePress(pen(0, 1, { altKey: true }), { ...tool, buttons: map({ tipAlt: both("pan", "none") }) }))
      .toEqual({ kind: "pan" })
  })
  it("a button with nothing to hold does nothing, but the pen touching under it still writes", () => {
    const none = { ...tool, buttons: map({ lower: both("none", "undo"), eraser: both("none", "none") }) }
    expect(resolvePress(pen(2, 2), none)).toEqual({ kind: "ignore" })
    expect(resolvePress(pen(0, 3), none)).toEqual({ kind: "draw" })
    expect(resolvePress(pen(0, 1, { altKey: true }), none)).toEqual({ kind: "draw" })
    expect(resolvePress(pen(5, 32), none)).toEqual({ kind: "ignore" })
  })
  it("the old settings shapes are still read: a single action per slot, and the two-way side button", () => {
    expect(resolvePress(pen(0, 3), { ...tool, sideButton: "selects" }).kind).toBe("select")
    expect(resolvePress(pen(0, 3), { ...tool, sideButton: "erases" }).kind).toBe("erase")
    expect(resolvePress(pen(0, 3), { ...tool, buttons: { lower: "pan" } }).kind).toBe("pan")
  })
  it("the tools: Erase makes any pointer erase, Select makes a press select (and move what is selected)", () => {
    expect(resolvePress({ pointerType: "mouse", button: 0, buttons: 1 }, { ...tool, eraser: true }))
      .toEqual({ kind: "erase" })
    expect(resolvePress(pen(0, 1), { ...tool, selectTool: true }))
      .toEqual({ kind: "select", additive: false, tool: true, move: true })
    // A button held at contact still wins over the tool.
    expect(resolvePress(pen(0, 5), { ...tool, selectTool: true })).toEqual({ kind: "erase" })
  })
  it("Ctrl and ⌘ select, as before, and do not move a selection", () => {
    expect(resolvePress(pen(0, 1, { ctrlKey: true }), tool)).toEqual({ kind: "select", additive: false, tool: false, move: false })
    expect(resolvePress({ pointerType: "mouse", button: 0, buttons: 1, metaKey: true }, tool).kind).toBe("select")
  })
  it("a press inside the selection's box (with a little slop) is inside it", () => {
    const box = { x: 100, y: 100, width: 50, height: 20 }
    expect(insideBox({ x: 120, y: 110 }, box)).toBe(true)
    expect(insideBox({ x: 98, y: 110 }, box)).toBe(true)
    expect(insideBox({ x: 160, y: 110 }, box)).toBe(false)
    expect(insideBox({ x: 120, y: 110 }, null)).toBe(false)
  })
})

/** Feed a list of [ms, phase, event] through the tap tracker; returns what fired. */
function play(buttons: PenButtonMap, events: [number, ("down" | "move" | "up" | "cancel"), PressLike][]): TapAction[] {
  let state: TapState = noTap
  const fired: TapAction[] = []
  for (const [at, phase, event] of events) {
    const step = tapStep(state, phase, event, buttons, at)
    state = step.state
    if (step.fire) fired.push(step.fire)
  }
  return fired
}
/** One press and release of a button in the air, starting at `at`, held `ms`. */
const tapAt = (at: number, button: number, bit: number, ms = 80): [number, "down" | "up", PressLike][] =>
  [[at, "down", pen(button, bit)], [at + ms, "up", pen(button, 0)]]

describe("a double tap: two quick presses of a side button in the air", () => {
  it("defaults: lower = Undo, upper = Redo, fired once on the second release", () => {
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(200, 2, 2)])).toEqual(["undo"])
    expect(play(FIXED, [...tapAt(0, 1, 4), ...tapAt(200, 1, 4)])).toEqual(["redo"])
  })
  it("a single tap does nothing; a triple tap is one double", () => {
    expect(play(FIXED, tapAt(0, 2, 2))).toEqual([])
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(200, 2, 2), ...tapAt(400, 2, 2)])).toEqual(["undo"])
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(200, 2, 2), ...tapAt(400, 2, 2), ...tapAt(600, 2, 2)]))
      .toEqual(["undo", "undo"])
  })
  it("the second press must come within DOUBLE_TAP_MS of the first release", () => {
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(80 + DOUBLE_TAP_MS, 2, 2)])).toEqual(["undo"])
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(80 + DOUBLE_TAP_MS + 1, 2, 2)])).toEqual([])
    // ... and a late one starts a run of its own.
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(1000, 2, 2), ...tapAt(1200, 2, 2)])).toEqual(["undo"])
  })
  it("a press held in the air longer than TAP_HOLD_MS is not a tap", () => {
    expect(play(FIXED, [...tapAt(0, 2, 2, TAP_HOLD_MS + 1), ...tapAt(TAP_HOLD_MS + 100, 2, 2)])).toEqual([])
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(200, 2, 2, TAP_HOLD_MS + 1)])).toEqual([])
  })
  it("the pen touching during a press, or between the two, is no double tap", () => {
    expect(play(FIXED, [
      [0, "down", pen(2, 2)], [30, "move", pen(-1, 3)], [60, "move", pen(-1, 2)], [80, "up", pen(2, 0)],
      ...tapAt(200, 2, 2),
    ])).toEqual([])
    expect(play(FIXED, [...tapAt(0, 2, 2), [120, "down", pen(0, 1)], [150, "up", pen(0, 0)], ...tapAt(200, 2, 2)])).toEqual([])
    // Held at contact (Windows Ink's barrel), then released: a hold, not a tap.
    expect(play(FIXED, [
      [0, "down", pen(2, 2, { pressure: 0.5 })], [80, "up", pen(2, 0)], ...tapAt(200, 2, 2),
    ])).toEqual([])
  })
  it("a hold that ends with the pen lifted first, then the button let go, is no tap either", () => {
    expect(play(FIXED, [
      [0, "down", pen(0, 3)], [40, "move", pen(-1, 2)], [60, "up", pen(2, 0)],
      ...tapAt(150, 2, 2),
    ])).toEqual([])
  })
  it("two different buttons are no double tap", () => {
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(200, 1, 4)])).toEqual([])
    expect(play(FIXED, [...tapAt(0, 2, 2), ...tapAt(200, 1, 4), ...tapAt(400, 1, 4)])).toEqual(["redo"])
  })
  it("works when the button arrives as pointermoves only, and when the pointerup is lost", () => {
    expect(play(FIXED, [
      [0, "move", pen(-1, 2)], [80, "move", pen(-1, 0)], [200, "move", pen(-1, 2)], [280, "move", pen(-1, 0)],
    ])).toEqual(["undo"])
  })
  it("a cancel ends the run; a mouse never taps; Nothing fires nothing", () => {
    expect(play(FIXED, [...tapAt(0, 2, 2), [150, "cancel", pen(2, 0)], ...tapAt(200, 2, 2)])).toEqual([])
    const mouse = (buttons: number): PressLike => ({ pointerType: "mouse", button: 2, buttons })
    expect(play(FIXED, [[0, "down", mouse(2)], [80, "up", mouse(0)], [200, "down", mouse(2)], [280, "up", mouse(0)]])).toEqual([])
    expect(play(map({ lower: both("erase", "none") }), [...tapAt(0, 2, 2), ...tapAt(200, 2, 2)])).toEqual([])
  })
  it("each button fires its own double-tap action", () => {
    const set = map({ lower: both("erase", "nextColour"), upper: both("select", "toggleErase") })
    expect(play(set, [...tapAt(0, 2, 2), ...tapAt(200, 2, 2), ...tapAt(1000, 1, 4), ...tapAt(1200, 1, 4)]))
      .toEqual(["nextColour", "toggleErase"])
  })
  it("THE ECHO: the pen's hover samples between the driver's mouse press and release do not end the press", () => {
    // The driver's right click (lower) at 0-150 and 450-550 ms: 300 ms from release to press, inside the rule.
    // Hover moves (no side bit) come 8 ms after each press; penActions runs them through `echoed` while it holds the bit.
    const hover = pen(-1, 0)
    const echoedRun = (merge: boolean): [number, "down" | "move" | "up", PressLike][] => [
      [0, "down", pen(2, 2)], [8, "move", merge ? echoed(hover, 2) : hover], [150, "up", pen(2, 0)], [300, "move", hover],
      [450, "down", pen(2, 2)], [458, "move", merge ? echoed(hover, 2) : hover], [550, "up", pen(2, 0)],
    ]
    expect(play(FIXED, echoedRun(true))).toEqual(["undo"])
    // Without it (the bug): each hover move read as the release, and the second press came 442 ms after the first one "ended".
    expect(play(FIXED, echoedRun(false))).toEqual([])
    expect(echoed(hover, 0)).toBe(hover)
    expect(echoed(hover, 4).buttons).toBe(4)
  })
})

describe("the saved settings, old and new (migrateButtons)", () => {
  it("nothing stored: the new defaults", () => {
    expect(migrateButtons(undefined)).toEqual(DEFAULT_BUTTONS)
    expect(migrateButtons("garbage")).toEqual(DEFAULT_BUTTONS)
  })
  it("an old map that only ever had the old defaults becomes the new defaults", () => {
    expect(migrateButtons({ buttons: { lower: "select", upper: "pan", eraser: "erase", tipAlt: "none" }, sideButton: "selects" }))
      .toEqual(DEFAULT_BUTTONS)
  })
  it("a deliberate old choice is kept: a hold as the hold, a one-shot as the double tap", () => {
    const m = migrateButtons({ buttons: { lower: "add", upper: "nextColour", eraser: "pan", tipAlt: "select" } })
    expect(m.lower).toEqual({ hold: "add", double: "redo" })
    expect(m.upper).toEqual({ hold: "erase", double: "nextColour" })
    expect(m.eraser).toEqual({ hold: "pan", double: "none" })
    expect(m.tipAlt).toEqual({ hold: "select", double: "none" })
  })
  it("the oldest two-way side button, and a one-shot on a button that has no double tap", () => {
    expect(migrateButtons({ sideButton: "erases" }).lower).toEqual({ hold: "erase", double: "redo" })
    expect(migrateButtons({ sideButton: "selects" })).toEqual(DEFAULT_BUTTONS)
    expect(migrateButtons({ buttons: { eraser: "undo" } }).eraser).toEqual(DEFAULT_BUTTONS.eraser)
  })
  it("this version's pairs are read as they are; what is not an action falls back per job", () => {
    const m = migrateButtons({
      slots: { lower: { hold: "pan", double: "wider" }, upper: { hold: "bogus", double: "thinner" }, eraser: { hold: "none", double: "undo" } },
      buttons: { lower: "select" },
    })
    expect(m.lower).toEqual({ hold: "pan", double: "wider" })
    expect(m.upper).toEqual({ hold: "erase", double: "thinner" })
    expect(m.eraser).toEqual({ hold: "none", double: "none" })
    expect(m.tipAlt).toEqual(DEFAULT_BUTTONS.tipAlt)
  })
})

describe("the saved settings in localStorage (penSettings.ts)", () => {
  async function loadWith(saved: unknown) {
    vi.resetModules()
    const store = new Map<string, string>()
    if (saved !== undefined) store.set("writemind.pen", JSON.stringify(saved))
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    })
    const mod = await import("../src/renderer/penSettings")
    return { mod, store }
  }
  it("come up with Sean's defaults", async () => {
    const { mod } = await loadWith(undefined)
    expect(mod.penSettings().buttons).toEqual(DEFAULT_BUTTONS)
    expect(mod.penSettings().sideButton).toBe("selects")
  })
  it("migrate a 0.4.0 store and keep each job across a reload, writing the old fields for an older build", async () => {
    const { mod, store } = await loadWith({ penDraws: false, buttons: { lower: "select", upper: "pan", eraser: "erase", tipAlt: "none" } })
    expect(mod.penSettings().buttons).toEqual(DEFAULT_BUTTONS)
    expect(mod.penSettings().penDraws).toBe(false)
    mod.setButton("upper", "double", "nextColour")
    mod.setButton("lower", "hold", "select")
    mod.setButton("eraser", "double", "undo")   // the eraser end has no double tap: ignored
    const saved = JSON.parse(store.get("writemind.pen")!)
    expect(saved.slots.upper).toEqual({ hold: "erase", double: "nextColour" })
    expect(saved.slots.eraser).toEqual({ hold: "erase", double: "none" })
    expect(saved.buttons).toEqual({ lower: "select", upper: "erase", eraser: "erase", tipAlt: "none" })
    expect(saved.sideButton).toBe("selects")
    const again = await loadWith(saved)
    expect(again.mod.penSettings().buttons.upper).toEqual({ hold: "erase", double: "nextColour" })
    expect(again.mod.penSettings().buttons.lower).toEqual({ hold: "select", double: "redo" })
    for (const slot of SLOTS) expect(typeof again.mod.penSettings().buttons[slot].hold).toBe("string")
  })
  it("the Erase and Select tools exclude each other and are never remembered", async () => {
    const { mod, store } = await loadWith(undefined)
    mod.setEraser(true)
    mod.setSelectTool(true)
    expect(mod.penSettings()).toMatchObject({ eraser: false, selectTool: true })
    expect(store.get("writemind.pen")).not.toContain("selectTool")
    mod.putToolsDown()
    expect(mod.penSettings()).toMatchObject({ eraser: false, selectTool: false })
  })
})

describe("the Pen popover's model", () => {
  it("one row per button, a hold and (side buttons only) a double tap", () => {
    expect(buttonRows(DEFAULT_BUTTONS)).toEqual([
      { slot: "upper", name: "First button (Middle Click)", hold: "erase", double: "undo" },
      { slot: "lower", name: "Second button (Right Click)", hold: "select", double: "redo" },
      { slot: "eraser", name: "Eraser end", hold: "erase", double: null },
      { slot: "tipAlt", name: "Tip + Alt", hold: "none", double: null },
    ])
  })
  it("says the side buttons in the app's words", () => {
    expect(buttonSummary(DEFAULT_BUTTONS)).toBe(
      "First button (Middle Click): hold Erase strokes, double-tap Undo. Second button (Right Click): hold Select, double-tap Redo")
  })
  it("Sean's buttons: the second (Right Click) selects / redoes, the first (Middle Click) erases / undoes", () => {
    expect(DEFAULT_BUTTONS.lower).toEqual({ hold: "select", double: "redo" })
    expect(DEFAULT_BUTTONS.upper).toEqual({ hold: "erase", double: "undo" })
  })
  it("the swapped defaults of the first test build become the right ones; a real choice stays", () => {
    expect(migrateButtons({ slots: { lower: { hold: "erase", double: "undo" }, upper: { hold: "select", double: "redo" } } }))
      .toEqual(DEFAULT_BUTTONS)
    expect(migrateButtons({ slots: { lower: { hold: "erase", double: "wider" }, upper: { hold: "select", double: "redo" } } }).lower)
      .toEqual({ hold: "erase", double: "wider" })
  })
})

describe("colours and widths", () => {
  const presets = ["#111111", "#2D7DD2", "#E5484D", "#2FB457"]
  it("cycles forward and back, and a colour outside the list starts at the end it faces", () => {
    expect(cycleColour("#111111", presets)).toBe("#2D7DD2")
    expect(cycleColour("#2fb457", presets)).toBe("#111111")
    expect(cycleColour("#111111", presets, -1)).toBe("#2FB457")
    expect(cycleColour("#abcdef", presets)).toBe("#111111")
  })
  it("steps along the widths and stops at the ends", () => {
    const widths = [1, 2, 3, 5, 8, 12]
    expect(stepWidth(3, widths, 1)).toBe(5)
    expect(stepWidth(4, widths, 1)).toBe(5)
    expect(stepWidth(12, widths, 1)).toBe(12)
    expect(stepWidth(3, widths, -1)).toBe(2)
    expect(stepWidth(1, widths, -1)).toBe(1)
  })
})

describe("the ExpressKey commands", () => {
  it("every pen command in the table has an action, and every action a command", () => {
    const ids = COMMANDS.filter((c) => c.id.startsWith("pen")).map((c) => c.id).sort()
    expect(ids).toEqual(Object.keys(PEN_COMMANDS).sort())
  })
  it("no two commands share a key, so one press is one action", () => {
    const seen = new Map<string, string>()
    for (const command of COMMANDS) {
      if (!command.key) continue
      const key = command.key.toLowerCase()
      expect(seen.get(key), `${command.id} and ${seen.get(key)} both take ${command.key}`).toBeUndefined()
      seen.set(key, command.id)
    }
  })
  it("is heard by the page and found from a key event", () => {
    const event = { key: "4", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false }
    expect(commandForKey(event, "win32")?.id).toBe("penNextColour")
    expect(commandForKey({ ...event, key: "w", shiftKey: true }, "win32")?.id).toBe("penSendPage")
    expect(commandForKey({ ...event, key: "w" }, "win32")?.id).toBe("penSendWriting")
    // Not the heading ladder's Ctrl+4.
    expect(commandForKey({ ...event, altKey: false }, "win32")).toBeNull()
  })
  it("still means its physical key where Ctrl+Alt is AltGr and types another character", () => {
    expect(matches({ key: "¡", code: "Digit1", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false },
      "CmdOrCtrl+Alt+1", "win32")).toBe(true)
    expect(matches({ key: "¡", code: "Digit2", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false },
      "CmdOrCtrl+Alt+1", "win32")).toBe(false)
    // A plain Ctrl chord never takes the fallback.
    expect(matches({ key: "ß", code: "KeyS", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
      "CmdOrCtrl+S", "win32")).toBe(false)
  })
})
