import { describe, expect, it } from "vitest"
import { pressureScale, readDrawing, readPressures, widthsAlong, writeDrawing } from "../src/index"

describe("a pen's pressure", () => {
  it("draws at the pen's own width at half pressure", () => {
    expect(pressureScale(0.5)).toBeCloseTo(1)
    expect(pressureScale(0)).toBeLessThan(pressureScale(1))
    expect(pressureScale(5)).toBe(pressureScale(1))
    expect(pressureScale(Number.NaN)).toBeCloseTo(1)
  })

  it("gives a width per point, or none for a mouse stroke", () => {
    expect(widthsAlong(4, [0.5, 1], 2)).toEqual([4, 4 * pressureScale(1)])
    expect(widthsAlong(4, undefined, 2)).toBeNull()
    expect(widthsAlong(4, [0.5], 2)).toBeNull()
  })

  it("reads only well-formed pressures", () => {
    expect(readPressures([0.2, 2, -1], 3)).toEqual([0.2, 1, 0])
    expect(readPressures([0.2, "x"], 2)).toBeUndefined()
    expect(readPressures([0.2], 2)).toBeUndefined()
    expect(readPressures(undefined, 0)).toBeUndefined()
  })

  it("survives the sidecar, and an old sidecar still opens", () => {
    const json = writeDrawing({ items: [{
      kind: "stroke",
      stroke: {
        id: "a", colorHex: "#000000", width: 3,
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], pressures: [0.1, 0.9],
        transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null,
      },
    }] })
    const back = readDrawing(json).items[0]!
    expect(back.kind === "stroke" && back.stroke.pressures).toEqual([0.1, 0.9])
    const old = readDrawing(JSON.stringify({ items: [{ kind: "stroke", id: "b", points: [{ x: 0, y: 0 }] }] })).items[0]!
    expect(old.kind === "stroke" && old.stroke.pressures).toBeUndefined()
  })
})
