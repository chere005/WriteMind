import type { Range } from "@writemind/core"
import { describe, expect, it } from "vitest"
import { bracketAt, bracketLine, DEEPEST, GUTTER_WIDTH, takes } from "../src/brackets"

/**
 * Transcribed from the Mac's `WriteMindTests/CellBracketKindTests.swift` (commit f6d2714 and the clamp before it),
 * for the gutter in `packages/editor/src/brackets.ts`. The port has no In/Out pair bracket of its own yet; its
 * range is kept in the data because what a bracket TAKES is a question about ranges, and the answer for a pair is
 * the one the Mac pins.
 */

const r = (location: number, length: number): Range => ({ location, length })

describe("CellBracketKindTests", () => {
  /**
   * WHAT A HOVER PROMISES IS WHAT A CLICK TAKES (Sean, 2026-09-22: "hovering over sections on the right side should
   * faintly indicate what would be selected if clicked"). Both the hover and the press ask `takes` over the
   * brackets that are cells — so a section promises the cells under it, a pair the two in it, and neither its own
   * merged range.
   */
  it("testAHoverPromisesTheCellsAClickWouldTake", () => {
    const input = r(10, 20)
    const output = r(32, 12)
    const after = r(46, 8)
    const brackets = [
      { key: "Notes", range: r(0, 54), isCell: false },
      { key: "eval:10", range: r(10, 34), isCell: false },
      { key: "cell:10", range: input, isCell: true },
      { key: "cell:32", range: output, isCell: true },
      { key: "cell:46", range: after, isCell: true },
    ]
    const cells = brackets.filter((b) => b.isCell).map((b) => b.range)
    expect(cells, "the pair's own bracket is not a cell").toEqual([input, output, after])

    const promise = (key: string) => takes(brackets.find((b) => b.key === key)!.range, cells)
    expect(promise("eval:10"), "a pair promises the two in it").toEqual([input, output])
    expect(promise("Notes")).toEqual([input, output, after])
    expect(promise("cell:32"), "a cell promises itself and nothing else").toEqual([output])
  })

  /**
   * Nesting is five points a level in a 22-point column, so a cell deep enough — three headings, and the group
   * inside them — was drawn past the left edge and simply was not there.
   */
  it("testNestingDeeperThanTheColumnSharesTheLastLine", () => {
    const deepest = bracketLine(DEEPEST)
    expect(deepest - 5, "the tick still fits inside the column").toBeGreaterThanOrEqual(0)
    expect(bracketLine(DEEPEST + 4)).toBe(deepest)
    expect(bracketLine(1), "deeper is further from the margin").toBeLessThan(bracketLine(0))
    expect(bracketLine(0)).toBeLessThanOrEqual(GUTTER_WIDTH)
  })
})

describe("the one reader for the bracket under the pointer (port; Mac 17f0f82 `cursor(at:)` / `bracket(at:)`)", () => {
  const section = { key: "s", depth: 0, top: 0, bottom: 200 }
  const cell = { key: "c", depth: 1, top: 40, bottom: 80 }
  const deepSection = { key: "d", depth: DEEPEST, top: 100, bottom: 200 }
  const deepCell = { key: "dc", depth: DEEPEST + 1, top: 120, bottom: 150 }
  const all = [section, cell, deepSection, deepCell]

  it("takes the nearest line within four pixels, and nothing beyond", () => {
    expect(bracketAt(bracketLine(1), 60, all)).toBe(cell)
    expect(bracketAt(bracketLine(0), 60, all)).toBe(section)
    // Two levels are five apart: whichever line is nearer wins, and past four from every line nothing does.
    expect(bracketAt(bracketLine(1) + 3, 60, all)).toBe(section)
    expect(bracketAt(bracketLine(1) - 2, 60, all)).toBe(cell)
    expect(bracketAt(bracketLine(DEEPEST) - 5, 10, all), "past four from every line").toBeNull()
  })

  it("reaches four pixels past either end, as the Mac's does", () => {
    expect(bracketAt(bracketLine(1), 40 - 4, all)).toBe(cell)
    expect(bracketAt(bracketLine(1), 80 + 4, all)).toBe(cell)
    expect(bracketAt(bracketLine(1), 40 - 5, all), "and no further").toBeNull()
  })

  it("between two on the same line (past the deepest level), the one inside the other", () => {
    expect(bracketAt(bracketLine(DEEPEST), 130, all)).toBe(deepCell)
    expect(bracketAt(bracketLine(DEEPEST), 180, all)).toBe(deepSection)
  })

  it("exactly between two lines, the first listed (the gutter lists the outer brackets first)", () => {
    const halfway = (bracketLine(0) + bracketLine(1)) / 2
    expect(bracketAt(halfway, 60, all)).toBe(section)
    expect(bracketAt(halfway, 60, [cell, section])).toBe(cell)
  })

  it("a cell holding no cell stands for itself", () => {
    expect(takes(r(5, 3), [r(0, 4), r(10, 4)])).toEqual([r(5, 3)])
  })
})
