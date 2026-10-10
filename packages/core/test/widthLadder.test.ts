/**
 * The one width ladder and the one swatch set (core/drawing/shapes.ts). PORT-ONLY: Sean's wireframe (2026-10-10) has the
 * pen's menu and the inspector over a picked object offer the same six widths and the same six swatches.
 */

import { describe, expect, it } from "vitest"
import { nearestWidth, PRESET_COLOURS, WIDTH_LADDER } from "../src/index"

describe("the width ladder", () => {
  it("is the pen's six, ascending", () => {
    expect(WIDTH_LADDER).toEqual([1, 2, 3, 5, 8, 12])
    expect([...WIDTH_LADDER].sort((a, b) => a - b)).toEqual(WIDTH_LADDER)
    expect(PRESET_COLOURS).toHaveLength(6)
  })
  it("names the nearest rung for a width an object has", () => {
    expect(nearestWidth(3)).toBe(3)
    expect(nearestWidth(1.5)).toBe(1)     // a tie goes to the lower rung
    expect(nearestWidth(4)).toBe(3)
    expect(nearestWidth(4.1)).toBe(5)
    expect(nearestWidth(0)).toBe(1)
    expect(nearestWidth(24)).toBe(12)
  })
})
