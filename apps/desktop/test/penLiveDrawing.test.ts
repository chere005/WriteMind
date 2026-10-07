import { describe, expect, it } from "vitest"
import { heldSlot, type PenLive } from "../src/renderer/penLive"

/**
 * A button pressed or let go WHILE A STROKE IS BEING DRAWN does nothing (Sean, 2026-10-06): the pen cursor and the Pen chip
 * read `heldSlot`, which is null for a stroke that began with no side button held.
 */
const live = (over: Partial<PenLive>): PenLive => ({
  tip: false, lower: false, upper: false, eraser: false, alt: false, pressure: 0,
  seen: { tip: true, lower: true, upper: true, eraser: false }, pen: true, drawing: false, ...over,
})

describe("a side button during a stroke", () => {
  it("is not a held button once the stroke began with none", () => {
    expect(heldSlot(live({ tip: true, upper: true, drawing: true }))).toBeNull()
    expect(heldSlot(live({ tip: true, lower: true, drawing: true }))).toBeNull()
  })
  it("still is one in the air, and one held at contact", () => {
    expect(heldSlot(live({ upper: true }))).toBe("upper")
    expect(heldSlot(live({ tip: true, upper: true, drawing: false }))).toBe("upper")
  })
})
