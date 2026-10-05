// The tablet sheet's OWN Erase / Select (Sean, 2026-10-05: "clicking in the notebook exits erase mode from the drawing
// side"): penSettings `sheetTools`, tabletFocus `penOnSheet`, penActions `toggleErase` / `toggleSelect` by where the pen
// is. No Swift original: the Mac has no tablet sheet.
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolvePress } from "../src/renderer/penButtons"

class FakeNode {
  children: FakeNode[] = []
  constructor(readonly name: string) {}
  add(child: FakeNode): FakeNode { this.children.push(child); return child }
  contains(other: FakeNode | null): boolean {
    return other === this || this.children.some((child) => child.contains(other))
  }
}

async function fresh() {
  vi.resetModules()
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (event: unknown) => void) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn) },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn) },
  })
  vi.stubGlobal("Node", FakeNode)
  const fire = (type: string, pointerType: string, target: FakeNode | null) =>
    listeners.get(type)?.forEach((fn) => fn({ type, pointerType, target }))
  const settings = await import("../src/renderer/penSettings")
  const focus = await import("../src/renderer/tabletFocus")
  const actions = await import("../src/renderer/penActions")
  return { settings, focus, actions, store, fire, listeners }
}

afterEach(() => { vi.unstubAllGlobals() })

describe("the sheet's own tools (penSettings.ts)", () => {
  it("are a pair of their own: the notebook's toggles and putToolsDown leave them alone, and the other way round", async () => {
    const { settings } = await fresh()
    settings.setSheetEraser(true)
    expect(settings.sheetTools()).toEqual({ eraser: true, selectTool: false })
    expect(settings.penSettings()).toMatchObject({ eraser: false, selectTool: false })
    // The notebook: the toolbar pen button, Ctrl+P and a placement tool all end in putToolsDown.
    settings.setEraser(true)
    settings.putToolsDown()
    expect(settings.penSettings().eraser).toBe(false)
    expect(settings.sheetTools().eraser).toBe(true)
    settings.setSelectTool(true)
    expect(settings.sheetTools()).toEqual({ eraser: true, selectTool: false })
    settings.setSheetEraser(false)
    expect(settings.penSettings().selectTool).toBe(true)
  })
  it("Erase and Select exclude each other on the sheet, and neither is remembered", async () => {
    const { settings, store } = await fresh()
    settings.setSheetEraser(true)
    settings.setSheetSelect(true)
    expect(settings.sheetTools()).toEqual({ eraser: false, selectTool: true })
    settings.setSheetEraser(true)
    expect(settings.sheetTools()).toEqual({ eraser: true, selectTool: false })
    settings.setPressure(false)   // writes the store
    expect(store.get("writemind.pen") ?? "").not.toMatch(/sheet|eraser":true|selectTool/)
  })
  it("a press on the sheet is resolved with the sheet's tools and the pen's buttons", async () => {
    const { settings } = await fresh()
    const tip = { pointerType: "pen", button: 0, buttons: 1, pressure: 0.5 }
    settings.setEraser(true)
    expect(resolvePress(tip, settings.sheetPressSettings()).kind).toBe("draw")
    expect(resolvePress(tip, settings.penSettings()).kind).toBe("erase")
    settings.setSheetSelect(true)
    expect(resolvePress(tip, settings.sheetPressSettings())).toMatchObject({ kind: "select", tool: true })
    // A side button held while the pen touches keeps its own hold job on the sheet too (whatever the tools say).
    const side = { pointerType: "pen", button: 2, buttons: 3, pressure: 0.5 }
    const job = resolvePress(side, { ...settings.penSettings(), eraser: false, selectTool: false }).kind
    expect(job).not.toBe("draw")
    expect(resolvePress(side, settings.sheetPressSettings()).kind).toBe(job)
  })
})

describe("where the pen is (tabletFocus.ts)", () => {
  it("only the pen's own events move it; it stays where the pen was last; no sheet means the notebook", async () => {
    const { focus, fire } = await fresh()
    const doc = new FakeNode("body")
    const pane = doc.add(new FakeNode("camera"))
    const sheet = pane.add(new FakeNode("tablet"))
    const words = doc.add(new FakeNode("cm-content"))
    fire("pointermove", "pen", sheet)
    expect(focus.penOnSheet()).toBe(false)   // no sheet is watched yet
    const stop = focus.watchSheetPen(pane as unknown as Element)
    fire("pointermove", "pen", sheet)
    expect(focus.penOnSheet()).toBe(true)
    fire("pointerdown", "mouse", words)       // a mouse click in the notebook
    expect(focus.penOnSheet()).toBe(true)
    fire("pointermove", "pen", pane)          // over the sheet's header
    expect(focus.penOnSheet()).toBe(true)
    fire("pointermove", "pen", words)
    expect(focus.penOnSheet()).toBe(false)
    fire("pointerdown", "pen", sheet)
    stop()
    expect(focus.penOnSheet()).toBe(false)
  })
  it("a sheet mounted before the old one lets go keeps watching", async () => {
    const { focus, fire, listeners } = await fresh()
    const a = new FakeNode("a"), b = new FakeNode("b")
    const stopA = focus.watchSheetPen(a as unknown as Element)
    const stopB = focus.watchSheetPen(b as unknown as Element)
    stopA()
    expect(listeners.get("pointermove")?.size).toBe(1)
    fire("pointermove", "pen", b)
    expect(focus.penOnSheet()).toBe(true)
    stopB()
    expect(listeners.get("pointermove")?.size).toBe(0)
  })
})

describe("the pen's toggles act on the surface the pen is over (penActions.ts)", () => {
  it("toggleErase / toggleSelect: the sheet's pair over the sheet, the notebook's elsewhere", async () => {
    const { settings, focus, actions, fire } = await fresh()
    const doc = new FakeNode("body")
    const pane = doc.add(new FakeNode("camera"))
    const words = doc.add(new FakeNode("cm-content"))
    // No sheet showing: the notebook's.
    actions.runPenAction("toggleErase", true)
    expect(settings.penSettings().eraser).toBe(true)
    expect(settings.sheetTools().eraser).toBe(false)
    const stop = focus.watchSheetPen(pane as unknown as Element)
    fire("pointermove", "pen", pane)
    actions.runPenAction("toggleErase", true)
    expect(settings.sheetTools().eraser).toBe(true)
    expect(settings.penSettings().eraser).toBe(true)
    // An ExpressKey (Ctrl+Alt+3) with the pen last over the sheet.
    expect(actions.runPenCommand("penSelect")).toBe(true)
    expect(settings.sheetTools()).toEqual({ eraser: false, selectTool: true })
    expect(settings.penSettings()).toMatchObject({ eraser: true, selectTool: false })
    fire("pointermove", "pen", words)
    actions.runPenAction("toggleErase", true)
    expect(settings.penSettings().eraser).toBe(false)
    expect(settings.sheetTools().selectTool).toBe(true)
    stop()
  })
})
