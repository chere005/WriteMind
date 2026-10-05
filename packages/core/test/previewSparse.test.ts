import { describe, expect, it } from "vitest"
import { cellStates, cellStatesSparse } from "../src/cells/preview"
import { structuralLines, structuralLineStarts, isStructuralLine } from "../src/cells/seams"
import { linesOf, positioned } from "../src/markdown/parser"
import { end, range, type Range } from "../src/text/range"

/**
 * e3-editor-perf (2026-10-04): the rendered page no longer works out a state for every cell and the blank lines of the
 * whole note on every keystroke. `cellStatesSparse` is the open / held cells alone and `structuralLineStarts` is the
 * structural blank lines of one stretch; both are held to the whole-note answers (`cellStates`, `structuralLines`,
 * ported from MarkdownPreview.swift and CellSeams.swift) on random notes and selections.
 */

let seed = 5
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]!
const LINES = [
  "", "", "", "   ", "text of a paragraph", "more words", "# Heading", "## Sub", "- bullet", "- [ ] todo", "> quote", "---",
  "```", "```ts", "let a = 1", "1. one", "* star",
]
const randomDoc = (lines: number): string => Array.from({ length: lines }, () => pick(LINES)).join("\n") + (rnd() < 0.3 ? "\n" : "")

describe("structuralLineStarts", () => {
  it("is structuralLines, for the whole note and for any stretch of it", () => {
    seed = 3
    for (let i = 0; i < 1500; i++) {
      const text = randomDoc(Math.floor(rnd() * 40))
      const doc = linesOf(text)
      const whole = structuralLines(text).map((r) => r.location)
      expect(structuralLineStarts(doc, 0, text.length)).toEqual(whole)
      if (text.length > 0) {
        const a = Math.floor(rnd() * (text.length + 1))
        const b = Math.min(text.length, a + Math.floor(rnd() * 60))
        expect(structuralLineStarts(doc, a, b)).toEqual(whole.filter((s) => s >= a && s <= b))
      }
      // and the one-line question the placeholder asks
      for (let n = 1; n <= doc.lines; n++) {
        expect(isStructuralLine(doc, n)).toBe(whole.includes(doc.line(n).from) && (n < doc.lines || doc.line(n).to > doc.line(n).from || doc.length === 0))
      }
    }
  })
})

describe("cellStatesSparse", () => {
  it("is cellStates without the closed cells, on random notes and selections", () => {
    seed = 9
    let withOpen = 0
    let withHeld = 0
    for (let i = 0; i < 4000; i++) {
      const text = randomDoc(1 + Math.floor(rnd() * 40))
      const cells = positioned(text).map((p) => p.range)
      const selection: Range[] = []
      const count = rnd() < 0.7 ? 1 : 1 + Math.floor(rnd() * 3)
      for (let k = 0; k < count; k++) {
        const at = Math.floor(rnd() * (text.length + 1))
        const kind = rnd()
        if (kind < 0.4) selection.push(range(at, 0))
        else if (kind < 0.7 && cells.length > 0) { const c = pick(cells); selection.push(range(c.location, c.length)) }
        else if (cells.length > 1) {
          const a = pick(cells), b = pick(cells)
          const from = Math.min(a.location, b.location), to = Math.max(end(a), end(b))
          selection.push(range(from, to - from))
        } else selection.push(range(at, Math.min(text.length - at, Math.floor(rnd() * 30))))
      }
      const holding = rnd() < 0.3
      const armed = rnd() < 0.15
      const full = cellStates(cells, selection, holding, armed)
      const want = new Map<number, string>()
      full.forEach((state, index) => { if (state !== "closed") want.set(index, state) })
      const got = cellStatesSparse(cells, (c) => c, selection, holding, armed)
      expect([...got].sort((a, b) => a[0] - b[0])).toEqual([...want].sort((a, b) => a[0] - b[0]))
      if ([...want.values()].includes("open")) withOpen++
      if ([...want.values()].includes("held")) withHeld++
    }
    // the cases are not all empty
    expect(withOpen).toBeGreaterThan(800)
    expect(withHeld).toBeGreaterThan(200)
  })
})
