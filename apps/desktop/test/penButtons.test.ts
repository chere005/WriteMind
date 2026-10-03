import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_BUTTONS, PEN_COMMANDS, SLOTS, cycleColour, noTap, resolvePress, slotOf, stepWidth, tapStep,
  type PenAction, type PenButtonMap, type PressLike, type TapState,
} from "../src/renderer/penButtons"
import { COMMANDS, commandForKey, matches } from "../src/shared/commands"

const pen = (button: number, buttons: number, extra: Partial<PressLike> = {}): PressLike =>
  ({ pointerType: "pen", button, buttons, ...extra })
const tool = { eraser: false, selectTool: false }
const map = (over: Partial<PenButtonMap>): PenButtonMap => ({ ...DEFAULT_BUTTONS, ...over })

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

describe("what a press resolves to", () => {
  it("defaults: lower selects (like ⌘), upper pans, eraser erases, tip draws", () => {
    expect(resolvePress(pen(2, 2), tool)).toEqual({ kind: "select", additive: false, tool: false })
    expect(resolvePress(pen(1, 4), tool)).toEqual({ kind: "pan" })
    expect(resolvePress(pen(5, 32), tool)).toEqual({ kind: "erase" })
    expect(resolvePress(pen(0, 1), tool)).toEqual({ kind: "draw" })
  })
  it("each hold action", () => {
    expect(resolvePress(pen(2, 2), { ...tool, buttons: map({ lower: "add" }) }))
      .toEqual({ kind: "select", additive: true, tool: false })
    expect(resolvePress(pen(2, 2), { ...tool, buttons: map({ lower: "erase" }) })).toEqual({ kind: "erase" })
    expect(resolvePress(pen(1, 4), { ...tool, buttons: map({ upper: "select" }) }).kind).toBe("select")
    expect(resolvePress(pen(0, 1, { altKey: true }), { ...tool, buttons: map({ tipAlt: "pan" }) }))
      .toEqual({ kind: "pan" })
  })
  it("a tap action is not a gesture: the surfaces ignore the press", () => {
    expect(resolvePress(pen(2, 2), { ...tool, buttons: map({ lower: "undo" }) }))
      .toEqual({ kind: "tap", action: "undo", slot: "lower" })
  })
  it("a button with no action does nothing, but a tip pressed under it still writes", () => {
    const none = { ...tool, buttons: map({ lower: "none" }) }
    expect(resolvePress(pen(2, 2), none)).toEqual({ kind: "ignore" })
    expect(resolvePress(pen(0, 3), none)).toEqual({ kind: "draw" })
    expect(resolvePress(pen(0, 1, { altKey: true }), none)).toEqual({ kind: "draw" })
  })
  it("the old two-way side button choice still works when no map is given", () => {
    expect(resolvePress(pen(2, 2), { ...tool, sideButton: "erases" })).toEqual({ kind: "erase" })
  })
  it("the tools: Erase makes any pointer erase, Select makes a press select", () => {
    expect(resolvePress({ pointerType: "mouse", button: 0, buttons: 1 }, { ...tool, eraser: true }))
      .toEqual({ kind: "erase" })
    expect(resolvePress(pen(0, 1), { ...tool, selectTool: true })).toEqual({ kind: "select", additive: false, tool: true })
    // A button still wins over the tool.
    expect(resolvePress(pen(1, 4), { ...tool, selectTool: true })).toEqual({ kind: "pan" })
  })
  it("Ctrl and ⌘ select, as before", () => {
    expect(resolvePress(pen(0, 1, { ctrlKey: true }), tool).kind).toBe("select")
    expect(resolvePress({ pointerType: "mouse", button: 0, buttons: 1, metaKey: true }, tool).kind).toBe("select")
  })
})

/** Feed a list of events through the tap tracker; returns what fired. */
function play(buttons: PenButtonMap, events: [("down" | "move" | "up" | "cancel"), PressLike][]): PenAction[] {
  let state: TapState = noTap
  const fired: PenAction[] = []
  for (const [phase, event] of events) {
    const step = tapStep(state, phase, event, buttons)
    state = step.state
    if (step.fire) fired.push(step.fire)
  }
  return fired
}

describe("a tap: a button pressed and let go without the tip", () => {
  const taps = map({ lower: "undo", upper: "nextColour", eraser: "redo" })
  it("fires exactly once, on the release", () => {
    expect(play(taps, [["down", pen(2, 2)], ["move", pen(-1, 2)], ["up", pen(2, 0)]])).toEqual(["undo"])
    expect(play(taps, [["down", pen(1, 4)], ["up", pen(1, 0)]])).toEqual(["nextColour"])
    expect(play(taps, [["down", pen(5, 32)], ["up", pen(5, 0)]])).toEqual(["redo"])
  })
  it("does not fire if the tip touched while the button was down", () => {
    expect(play(taps, [["down", pen(2, 2)], ["move", pen(-1, 3)], ["move", pen(-1, 2)], ["up", pen(2, 0)]])).toEqual([])
    expect(play(taps, [["down", pen(0, 3)], ["up", pen(0, 0)]])).toEqual([])
  })
  it("works when the button arrives as a pointermove only, and when the pointerup is lost", () => {
    expect(play(taps, [["move", pen(-1, 2)], ["move", pen(-1, 2)], ["move", pen(-1, 0)]])).toEqual(["undo"])
  })
  it("two presses are two actions; a cancel is none", () => {
    expect(play(taps, [["down", pen(2, 2)], ["up", pen(2, 0)], ["down", pen(2, 2)], ["up", pen(2, 0)]]))
      .toEqual(["undo", "undo"])
    expect(play(taps, [["down", pen(2, 2)], ["cancel", pen(2, 0)]])).toEqual([])
  })
  it("a hold action or None is never a tap; a mouse never is", () => {
    expect(play(DEFAULT_BUTTONS, [["down", pen(2, 2)], ["up", pen(2, 0)]])).toEqual([])
    expect(play(map({ lower: "none" }), [["down", pen(2, 2)], ["up", pen(2, 0)]])).toEqual([])
    expect(play(taps, [["down", { pointerType: "mouse", button: 2, buttons: 2 }], ["up", { pointerType: "mouse", button: 2, buttons: 0 }]])).toEqual([])
  })
  it("Tip + Alt with a tap action fires on the press, once", () => {
    const alt = map({ tipAlt: "undo" })
    expect(play(alt, [["down", pen(0, 1, { altKey: true })], ["move", pen(-1, 1, { altKey: true })], ["up", pen(0, 0, { altKey: true })]]))
      .toEqual(["undo"])
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

describe("the saved settings", () => {
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
  it("come up with the Mac's idioms", async () => {
    const { mod } = await loadWith(undefined)
    expect(mod.penSettings().buttons).toEqual(DEFAULT_BUTTONS)
    expect(mod.penSettings().sideButton).toBe("selects")
  })
  it("carry the old side-button choice over", async () => {
    const { mod } = await loadWith({ sideButton: "erases" })
    expect(mod.penSettings().buttons.lower).toBe("erase")
    expect(mod.penSettings().sideButton).toBe("erases")
  })
  it("keep a button's action across a reload, and drop what is not an action", async () => {
    const { mod, store } = await loadWith({ buttons: { lower: "undo", upper: "bogus" } })
    expect(mod.penSettings().buttons.lower).toBe("undo")
    expect(mod.penSettings().buttons.upper).toBe("pan")
    mod.setButton("eraser", "redo")
    expect(JSON.parse(store.get("writemind.pen")!).buttons).toMatchObject({ lower: "undo", eraser: "redo" })
    for (const slot of SLOTS) expect(typeof mod.penSettings().buttons[slot]).toBe("string")
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
