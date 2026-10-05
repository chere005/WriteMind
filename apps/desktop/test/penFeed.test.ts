/**
 * The renderer's side of the native pen feed (renderer/penFeed.ts createDispatcher): samples through the orientation onto the
 * sheet and the click rule for a button the pen taps. No DOM: the page is the fake DispatchEnv.
 */
import { describe, expect, it } from "vitest"
import { createDispatcher, type DispatchEnv, type SynthInit } from "../src/renderer/penFeed"
import type { PenSample, Turn } from "../src/shared/pen"

const sample = (x: number, y: number, o: Partial<PenSample> = {}): PenSample =>
  ({ t: 0, x, y, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "inject", ...o })

function rig(turns: Turn = 0) {
  const events: { target: string; init: SynthInit }[] = []
  const clicked: string[] = []
  const env: DispatchEnv = {
    sheetRect: () => ({ left: 100, top: 50, width: 400, height: 200 }),
    turns: () => turns,
    elementAt: (x, y) => ({ name: y < 80 ? "strip-button" : "sheet", isConnected: true } as unknown as Element),
    fallbackTarget: () => ({ name: "body", isConnected: true } as unknown as Element),
    dispatch: (target, init) => { events.push({ target: (target as unknown as { name: string }).name, init }) },
    clickable: (target) => ((target as unknown as { name: string }).name === "strip-button"
      ? ({ click: () => clicked.push("strip-button") } as unknown as HTMLElement) : null),
    modifiers: () => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }),
  }
  return { d: createDispatcher(env), events, clicked }
}

describe("sample -> pointer events on the sheet", () => {
  it("lands the four tablet corners on the sheet's corners for each orientation", () => {
    const TL = [100, 50], TR = [500, 50], BL = [100, 250], BR = [500, 250]
    const want: Record<number, number[][]> = { 0: [TL, TR, BL, BR], 1: [TR, BR, TL, BL], 2: [BR, BL, TR, TL], 3: [BL, TL, BR, TR] }
    for (const turns of [0, 1, 2, 3] as Turn[]) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]]
      corners.forEach(([cx, cy], i) => {
        const { d, events } = rig(turns)
        d.batch([sample(cx!, cy!)])
        const move = events.find((e) => e.init.type === "pointerover")!.init
        // the last pixel is just inside the right / bottom edge
        expect(move.clientX).toBeCloseTo(want[turns]![i]![0]!, 0)
        expect(move.clientY).toBeCloseTo(want[turns]![i]![1]!, 0)
      })
    }
  })

  it("a stroke is pointerdown, moves with the pressure, pointerup, in that order", () => {
    const { d, events } = rig()
    d.batch([sample(0.5, 0.5), sample(0.5, 0.5, { tip: true, p: 0.3 }), sample(0.6, 0.5, { tip: true, p: 0.6 }), sample(0.6, 0.5)])
    const types = events.map((e) => e.init.type)
    expect(types).toEqual(["pointerover", "pointerenter", "pointermove", "pointerdown", "pointermove", "pointerup"])
    const down = events.find((e) => e.init.type === "pointerdown")!.init
    expect([down.button, down.buttons, down.pressure]).toEqual([0, 1, 0.3])
    expect(events.find((e) => e.init.type === "pointerup")!.init.buttons).toBe(0)
  })

  it("keeps the stroke on the element that took the pointerdown", () => {
    const { d, events } = rig()
    d.batch([sample(0.5, 0.5, { tip: true, p: 0.4 }), sample(0.5, 0.0, { tip: true, p: 0.4 }), sample(0.5, 0.0)])
    const targets = events.filter((e) => ["pointerdown", "pointermove", "pointerup"].includes(e.init.type)).map((e) => e.target)
    expect(new Set(targets)).toEqual(new Set(["sheet"]))
  })

  it("a pen-up on the button its pen-down started on clicks it (synthetic pointer events never produce a click)", () => {
    const { d, clicked } = rig()
    d.batch([sample(0.5, 0.0), sample(0.5, 0.0, { tip: true, p: 0.5 }), sample(0.5, 0.0, { tip: true, p: 0.5 }), sample(0.5, 0.0)])
    expect(clicked).toEqual(["strip-button"])
  })

  it("a side button pressed in the air over a button never clicks it (its taps are the pen's own: Undo, Redo)", () => {
    const { d, clicked } = rig()
    d.batch([sample(0.5, 0.0), sample(0.5, 0.0, { lower: true }), sample(0.5, 0.0), sample(0.5, 0.0, { upper: true }), sample(0.5, 0.0)])
    expect(clicked).toEqual([])
  })

  it("a drag that leaves the button does not click it", () => {
    const { d, clicked } = rig()
    d.batch([sample(0.5, 0.0, { tip: true, p: 0.5 }), sample(0.9, 0.0, { tip: true, p: 0.5 }), sample(0.9, 0.0)])
    expect(clicked).toEqual([])
  })

  it("drops a batch when the sheet is not showing, and reset ends a contact without a pointercancel", () => {
    const { d, events } = rig()
    d.batch([sample(0.5, 0.5, { tip: true, p: 0.5 })])
    d.reset()
    const types = events.map((e) => e.init.type)
    expect(types).toContain("pointerup")
    expect(types).not.toContain("pointercancel")
    expect(types.at(-1)).toBe("pointerleave")
  })

  it("carries the side buttons in buttons (lower 2, upper 4)", () => {
    const { d, events } = rig()
    d.batch([sample(0.5, 0.5), sample(0.5, 0.5, { lower: true }), sample(0.5, 0.5, { upper: true, lower: true })])
    const moves = events.filter((e) => e.init.type === "pointerdown" || e.init.type === "pointermove")
    expect(moves.map((e) => e.init.buttons)).toEqual([0, 2, 6])
  })
})
