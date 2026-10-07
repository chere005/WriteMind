/**
 * The language icons an evaluation cell's mark shows in place of letters (port-only: Sean, a608cc3, "use icons for
 * WL, CPP, Python"). The core holds the DRAWINGS as data and the rules they keep; the page turns them into SVG
 * (`packages/editor/src/eval`), and `e2e/suites/cells/08-language-icons.mjs` looks at them in the real app.
 */

import { describe, expect, it } from "vitest"
import { EVALUATORS, evaluatorBadge, evaluatorIcon, languageIcon, type Evaluator } from "../src"

/** Every number a path names, with the command it follows (an arc's flags are not points, and are skipped). */
function coordinates(d: string): number[] {
  const out: number[] = []
  for (const part of d.match(/[MLHVAZ][^MLHVAZ]*/g) ?? []) {
    const command = part[0]!
    const numbers = (part.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number)
    if (command === "A") {
      // rx ry rotation large sweep x y — only rx, ry and the end point are on the grid
      for (let i = 0; i + 6 < numbers.length + 1; i += 7) out.push(numbers[i]!, numbers[i + 1]!, numbers[i + 5]!, numbers[i + 6]!)
    } else {
      out.push(...numbers)
    }
  }
  return out
}

describe("the language icons", () => {
  it("has one for every environment a cell can run as, and a text mark for nothing else", () => {
    for (const evaluator of EVALUATORS) {
      const icon = evaluatorIcon(evaluator)
      expect(icon.size, evaluator).toBe(16)
      expect(icon.shapes.length, evaluator).toBeGreaterThan(0)
    }
    expect(languageIcon("eval wl")).toBe(evaluatorIcon("wolfram"))
    expect(languageIcon("eval python")).toBe(evaluatorIcon("python"))
    expect(languageIcon("eval c")).toBe(evaluatorIcon("c"))
    expect(languageIcon("eval c++")).toBe(evaluatorIcon("cpp"))
    expect(languageIcon("eval rust")).toBe(evaluatorIcon("rust"))
    // the spellings a person types by hand mean the same environment
    expect(languageIcon("eval cpp")).toBe(evaluatorIcon("cpp"))
    // a language this app cannot run, and a code cell that never runs, have nothing to draw: their marks stay text
    expect(languageIcon("eval fortran")).toBeNull()
    expect(languageIcon("python")).toBeNull()
    expect(languageIcon(null)).toBeNull()
  })

  it("draws each language differently, so no two marks can be mistaken for each other", () => {
    const drawn = EVALUATORS.map((evaluator) => JSON.stringify(evaluatorIcon(evaluator).shapes))
    expect(new Set(drawn).size).toBe(EVALUATORS.length)
    // C and C++ are the same hexagon; the pluses and the smaller letter are what tell them apart
    expect(evaluatorIcon("cpp").shapes.length).toBeGreaterThan(evaluatorIcon("c").shapes.length)
  })

  it("keeps every shape on the 16 x 16 grid, in path commands a page can draw", () => {
    for (const evaluator of EVALUATORS) {
      for (const shape of evaluatorIcon(evaluator).shapes) {
        expect(shape.d, evaluator).toMatch(/^[MLHVAZ0-9 .,-]+$/)
        expect(shape.d.startsWith("M"), evaluator).toBe(true)
        for (const value of coordinates(shape.d)) {
          expect(value, `${evaluator}: ${shape.d}`).toBeGreaterThanOrEqual(0)
          expect(value, `${evaluator}: ${shape.d}`).toBeLessThanOrEqual(16)
        }
        if (shape.paint === "stroke") {
          // a line thin enough to vanish at 14 px, or thick enough to fill the grid, is a mistake
          expect(shape.width, evaluator).toBeGreaterThanOrEqual(1)
          expect(shape.width, evaluator).toBeLessThanOrEqual(2.5)
        }
      }
    }
  })

  it("names no colour: it is monochrome, painted in whatever the mark's own colour is (light and dark themes alike)", () => {
    for (const evaluator of EVALUATORS) {
      for (const shape of evaluatorIcon(evaluator).shapes) {
        expect(Object.keys(shape).sort().every((key) => ["d", "paint", "round", "width"].includes(key)), evaluator).toBe(true)
      }
    }
  })

  it("leaves the letters where they were: the badge, the tooltip and the accessible name still read WL, PY, C, C++, RS", () => {
    const letters = (evaluator: Evaluator) => evaluatorBadge(evaluator)
    expect(EVALUATORS.map(letters)).toEqual(["WL", "PY", "C", "C++", "RS"])
  })
})
