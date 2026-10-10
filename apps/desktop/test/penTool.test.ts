import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  nextPenButton, penSettings, pressEraseKey, putToolsDown, setEraser, setPenTool, setSelectTool, type PenButtonState,
} from "../src/renderer/penSettings"
import { PEN_SWATCHES, PEN_WIDTHS, nearestWidth, sameInk, swatchOf } from "../src/renderer/penLook"

/**
 * THE BAR'S ONE PEN BUTTON (docs/PLAN-bars-2026-10.md P1; Sean, 2026-10-10: "i only need a pen enabled and disabled
 * button.. and a dropdown to choose between pen or eraser (which switches the mode of the single button)").
 */

const at = (tool: "pen" | "eraser", eraser: boolean, down: boolean): PenButtonState => ({ tool, eraser, down })

describe("the pen button's step", () => {
  it("a click toggles the pen when the button is the pen", () => {
    expect(nextPenButton(at("pen", false, false), "button")).toEqual(at("pen", false, true))
    expect(nextPenButton(at("pen", false, true), "button")).toEqual(at("pen", false, false))
  })

  it("a click toggles the eraser when the button is the eraser, and leaves the pen's mode alone", () => {
    expect(nextPenButton(at("eraser", false, false), "button")).toEqual(at("eraser", true, false))
    expect(nextPenButton(at("eraser", true, true), "button")).toEqual(at("eraser", false, true))
  })

  it("the menu's Pen makes the button the pen AND puts it down, whichever it was", () => {
    expect(nextPenButton(at("pen", false, false), "choosePen")).toEqual(at("pen", false, true))
    expect(nextPenButton(at("eraser", true, false), "choosePen")).toEqual(at("pen", false, true))
    expect(nextPenButton(at("pen", false, true), "choosePen")).toEqual(at("pen", false, true))
  })

  it("the menu's Eraser makes the button the eraser AND turns it on (the wireframe: the same button, now erasing)", () => {
    expect(nextPenButton(at("pen", false, true), "chooseEraser")).toEqual(at("eraser", true, true))
    expect(nextPenButton(at("eraser", false, false), "chooseEraser")).toEqual(at("eraser", true, false))
  })

  it("⌥⌘1 is the button when the pen is its tool, and the menu's Pen when the eraser is", () => {
    expect(nextPenButton(at("pen", false, false), "keyPen")).toEqual(at("pen", false, true))
    expect(nextPenButton(at("pen", false, true), "keyPen")).toEqual(at("pen", false, false))
    expect(nextPenButton(at("eraser", true, false), "keyPen")).toEqual(at("pen", false, true))
    // with the eraser the tool but off, ⌥⌘1 sets it to the pen and toggles it: down
    expect(nextPenButton(at("eraser", false, true), "keyPen")).toEqual(at("pen", false, true))
  })

  it("⌥⌘2 is the button when the eraser is its tool, and the menu's Eraser when the pen is", () => {
    expect(nextPenButton(at("pen", false, true), "keyEraser")).toEqual(at("eraser", true, true))
    expect(nextPenButton(at("eraser", true, true), "keyEraser")).toEqual(at("eraser", false, true))
    expect(nextPenButton(at("eraser", false, true), "keyEraser")).toEqual(at("eraser", true, true))
  })

  it("never leaves the eraser on while the button is the pen", () => {
    for (const tool of ["pen", "eraser"] as const) for (const eraser of [false, true]) for (const down of [false, true]) {
      for (const press of ["button", "choosePen", "chooseEraser", "keyPen", "keyEraser"] as const) {
        const next = nextPenButton(at(tool, eraser, down), press)
        if (next.tool === "pen") expect(next.eraser).toBe(false)
      }
    }
  })
})

describe("the pen's state in the store", () => {
  beforeEach(() => { setPenTool("pen"); setEraser(false); setSelectTool(false) })

  it("starts as the pen with nothing erasing, and remembers the button's tool", () => {
    expect(penSettings().tool).toBe("pen")
    setPenTool("eraser")
    expect(penSettings().tool).toBe("eraser")
    expect(penSettings().eraser).toBe(false)
  })

  it("turning the eraser on makes it the button's tool, and turning it off does not change the tool", () => {
    setEraser(true)
    expect(penSettings()).toMatchObject({ tool: "eraser", eraser: true })
    setEraser(false)
    expect(penSettings()).toMatchObject({ tool: "eraser", eraser: false })
  })

  it("the Select tool and the eraser exclude each other", () => {
    setEraser(true)
    setSelectTool(true)
    expect(penSettings()).toMatchObject({ eraser: false, selectTool: true })
    setEraser(true)
    expect(penSettings()).toMatchObject({ eraser: true, selectTool: false })
  })

  it("⌥⌘2 (and the pen's Erase action) sets the tool to the eraser and toggles it", () => {
    pressEraseKey()
    expect(penSettings()).toMatchObject({ tool: "eraser", eraser: true })
    pressEraseKey()
    expect(penSettings()).toMatchObject({ tool: "eraser", eraser: false })
    pressEraseKey()
    expect(penSettings()).toMatchObject({ tool: "eraser", eraser: true })
  })

  it("putting the tools down turns the eraser off but keeps it as the button", () => {
    setEraser(true)
    putToolsDown()
    expect(penSettings()).toMatchObject({ tool: "eraser", eraser: false })
  })
})

describe("the pen's look, once", () => {
  it("offers the six presets in the wireframe's order: black, red, blue, green, amber, purple", () => {
    expect(PEN_SWATCHES.map((one) => one.name)).toEqual(["Black", "Red", "Blue", "Green", "Amber", "Purple"])
    expect(new Set(PEN_SWATCHES.map((one) => one.hex.toLowerCase())).size).toBe(6)
  })

  it("knows a preset whatever the case a picker answers in, and a custom colour is none", () => {
    expect(sameInk("#2d7dd2", "#2D7DD2")).toBe(true)
    expect(swatchOf("#2d7dd2")?.name).toBe("Blue")
    expect(swatchOf("#123456")).toBeNull()
  })

  it("has the width ladder 1 2 3 5 8 12 and marks the nearest to one that is off it", () => {
    expect(PEN_WIDTHS).toEqual([1, 2, 3, 5, 8, 12])
    expect(nearestWidth(3)).toBe(3)
    expect(nearestWidth(4.2)).toBe(5)
    expect(nearestWidth(40)).toBe(12)
  })
})

describe("the button's tool is remembered with the rest of the pen's settings", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it("comes back as the eraser (and never ON: the app does not come up erasing), and an old profile comes up as the pen", async () => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
    vi.resetModules()
    const first = await import("../src/renderer/penSettings")
    first.setPenTool("eraser")
    first.setEraser(true)
    expect(JSON.parse(store.get("writemind.pen")!).tool).toBe("eraser")
    vi.resetModules()
    const again = await import("../src/renderer/penSettings")
    expect(again.penSettings()).toMatchObject({ tool: "eraser", eraser: false, selectTool: false })

    store.set("writemind.pen", JSON.stringify({ penDraws: false, pressure: true }))
    vi.resetModules()
    const old = await import("../src/renderer/penSettings")
    expect(old.penSettings()).toMatchObject({ tool: "pen", penDraws: false })
  })
})
