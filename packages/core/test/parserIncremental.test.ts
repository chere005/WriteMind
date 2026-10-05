import { describe, expect, it } from "vitest"
import { positioned, positionedUpdate, linesOf } from "../src/markdown/parser"
import { sections, sectionsFromCells, sectionContaining } from "../src/cells/outline"
import { positioned as positionedOld } from "./reference/parserOld"
import { sectionsOld } from "./reference/outlineOld"

/**
 * e3-editor-perf (2026-10-03): the parser is now a line machine that can be started in the middle and stopped when it
 * is back in step (`positionedUpdate`), and the outline is worked out from the parsed cells (`sectionsFromCells`).
 * None of that may change an answer, so: the new whole-document parse against a frozen copy of the old one, the
 * incremental parse against the whole-document parse after every edit of long random chains of edits, and the new
 * outline against the old.
 */

let seed = 1
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]!

const LINES = [
  "", "", "", "   ", "text of a paragraph", "more words here", "  indented words", "# Heading", "## Sub heading", "### Third", "###### Author",
  "# Heading", "## Sub heading", "####### seven", "#hashtag", "- bullet", "- [ ] todo", "- [x] done", "* star item", "+ plus item",
  "1. one", "2) two", "> quote", ">", "---", "***", "___", "- - -", "```", "```ts", "  ```", "``` ", "let a = 1", "`inline` code", "- []x",
  "text with trailing  ", "\t- tabbed",
]
const randomDoc = (lines: number): string => Array.from({ length: lines }, () => pick(LINES)).join("\n") + (rnd() < 0.3 ? "\n" : "")
const FRAGMENTS = ["\n", "\n\n", "\n\n\n", "x", "# ", "- ", "```", "\n```\n", "> ", "---", " ", "a b c", "\n# H\n", "- [ ] ", "1. ", "```ts\n", "\n\n\n\n"]

function randomEdit(text: string): { from: number; to: number; insert: string } {
  const from = Math.floor(rnd() * (text.length + 1))
  const kind = rnd()
  const to = kind < 0.35 ? from : Math.min(text.length, from + Math.floor(rnd() * (rnd() < 0.2 ? 80 : 6)))
  const insert = kind < 0.2 ? "" : pick(FRAGMENTS) + (rnd() < 0.3 ? pick(FRAGMENTS) : "")
  return { from, to, insert }
}

describe("the parser machine", () => {
  it("reads every document the way the old parser did", () => {
    seed = 7
    for (let i = 0; i < 1500; i++) {
      const text = randomDoc(Math.floor(rnd() * 40))
      expect(positioned(text)).toEqual(positionedOld(text))
    }
  })

  it("isRule reads what the old one did", () => {
    const samples = ["---", "- - -", "***", "___", "--", "- *-", "---x", "-- -", "   ", "", "_ _ _ _", "* * *", "-\t-\t-", "—-—"]
    for (const s of samples) expect(positioned(s)).toEqual(positionedOld(s))
  })
})

describe("positionedUpdate, the incremental parse", () => {
  it("equals a whole parse after every edit of long random chains of edits", () => {
    seed = 11
    let checked = 0
    for (let chain = 0; chain < 60; chain++) {
      let text = randomDoc(5 + Math.floor(rnd() * 60))
      let blocks = positioned(text)
      for (let step = 0; step < 50; step++) {
        const { from, to, insert } = randomEdit(text)
        const next = text.slice(0, from) + insert + text.slice(to)
        blocks = positionedUpdate(blocks, { from, toOld: to, toNew: from + insert.length }, linesOf(next))
        text = next
        const whole = positioned(text)
        if (JSON.stringify(blocks) !== JSON.stringify(whole)) {
          throw new Error(`chain ${chain} step ${step}: edit ${JSON.stringify({ from, to, insert })} on ${JSON.stringify(text)}\n`
            + `incremental ${JSON.stringify(blocks)}\nwhole       ${JSON.stringify(whole)}`)
        }
        checked++
      }
    }
    expect(checked).toBe(3000)
  })

  it("equals a whole parse when several places change at once (the hull of a multi-cursor edit)", () => {
    seed = 23
    for (let n = 0; n < 400; n++) {
      const text = randomDoc(10 + Math.floor(rnd() * 40))
      const a = randomEdit(text)
      // a second edit after the first one's end
      const rest = text.length - a.to
      const b = { from: a.to + Math.floor(rnd() * (rest + 1)), insert: pick(FRAGMENTS) }
      const bTo = Math.min(text.length, b.from + Math.floor(rnd() * 4))
      const next = text.slice(0, a.from) + a.insert + text.slice(a.to, b.from) + b.insert + text.slice(bTo)
      const blocks = positionedUpdate(positioned(text), { from: a.from, toOld: bTo, toNew: next.length - (text.length - bTo) }, linesOf(next))
      expect(blocks).toEqual(positioned(next))
    }
  })

  it("does the work of the edit and not of the note", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `## Section ${i}\n\nSome words in paragraph ${i}.\n\n- item\n- item\n`).join("\n")
    const before = positioned(text)
    const at = text.indexOf("paragraph 1000")
    const next = text.slice(0, at) + "X" + text.slice(at)
    const t0 = performance.now()
    let after = before
    for (let i = 0; i < 20; i++) after = positionedUpdate(before, { from: at, toOld: at, toNew: at + 1 }, linesOf(next))
    const each = (performance.now() - t0) / 20
    expect(after).toEqual(positioned(next))
    // The whole parse of this note takes tens of milliseconds; the update is dominated by shifting the blocks after the edit.
    expect(each).toBeLessThan(20)
  })
})

describe("sectionsFromCells, the outline from the parsed cells", () => {
  it("equals the old outline on random notes", () => {
    seed = 31
    for (let i = 0; i < 1500; i++) {
      const text = randomDoc(Math.floor(rnd() * 50))
      expect(sectionsFromCells(positioned(text), linesOf(text))).toEqual(sectionsOld(text))
      expect(sections(text)).toEqual(sectionsOld(text))
    }
  })

  it("sectionContaining finds the innermost section", () => {
    seed = 41
    const naive = (caret: number, all: ReturnType<typeof sections>) => {
      let best: (typeof all)[number] | null = null
      for (const s of all) if (s.range.location <= caret && caret <= s.range.location + s.range.length) if (!best || s.depth > best.depth) best = s
      return best
    }
    for (let i = 0; i < 300; i++) {
      const text = randomDoc(40)
      const all = sections(text)
      for (let caret = 0; caret <= text.length; caret += 3) expect(sectionContaining(caret, all)).toBe(naive(caret, all))
    }
  })
})

import { arm, armIn } from "../src/cells/seams"
import { armOld } from "./reference/armOld"

describe("armIn, the bar a caret stands in", () => {
  it("answers as the old arm did, for every caret in random notes", () => {
    seed = 53
    for (let i = 0; i < 600; i++) {
      const text = randomDoc(Math.floor(rnd() * 30))
      const blocks = positioned(text)
      const doc = linesOf(text)
      const standing = rnd() < 0.3 ? Math.floor(rnd() * (text.length + 1)) : null
      for (let caret = 0; caret <= text.length; caret++) {
        const want = armOld({ location: caret, length: 0 }, text, standing)
        expect(armIn({ location: caret, length: 0 }, doc, () => blocks, standing), `${JSON.stringify(text)} @${caret}`).toBe(want)
        expect(arm({ location: caret, length: 0 }, text, standing)).toBe(want)
      }
    }
  })
})

import { cellsOf, cellsOfSorted, holds, holdsSorted } from "../src/cells/selection"
describe("holds / cellsOf over cells in order", () => {
  it("answer as the unsorted ones do (for cells that have a length)", () => {
    seed = 61
    for (let i = 0; i < 300; i++) {
      const cells = positioned(randomDoc(40)).map((c) => c.range).filter((r) => r.length > 0)
      if (cells.length === 0) continue
      const brackets = [cells[Math.floor(rnd() * cells.length)]!, { location: cells[0]!.location, length: cells[cells.length - 1]!.location + cells[cells.length - 1]!.length - cells[0]!.location }]
      const a = Math.floor(rnd() * cells.length), b = Math.floor(rnd() * cells.length)
      const selection = rnd() < 0.5 ? cells.slice(Math.min(a, b), Math.max(a, b) + 1) : [{ location: cells[a]!.location, length: cells[b]!.location + cells[b]!.length - cells[a]!.location }].filter((r) => r.length > 0)
      for (const bracket of brackets) {
        expect(cellsOfSorted(bracket, cells)).toEqual(cellsOf(bracket, cells))
        expect(holdsSorted(bracket, cells, selection)).toBe(holds(bracket, cells, selection))
      }
    }
  })
})
