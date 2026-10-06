import { describe, expect, it } from "vitest"
import { positioned, positionedUpdate, linesOf, type PositionedBlock } from "../src/markdown/parser"
import { cellStates, cellStatesSparse, keepsNewlines, returnInBlock, staysClosed, touchingRuns } from "../src/cells/preview"
import { ALL_KINDS, KIND_GROUPS, kindName, opening, openCell, sameKind } from "../src/cells/types"
import { applied, range, type Range } from "../src/text/range"

/**
 * The picture block (docs\PLAN-docking-ink-cells.md (a); the Mac's planned `MarkdownBlock.picture(alt:path:)` in
 * C:\GIT\WriteMindSwift\docs\PLAN-docking.md): a line that is nothing but one image is a cell of its own, recognised before
 * the paragraph branch, flushing like a heading. Plus the cell kinds that make one, and the page's rules for it (never
 * open, never in a run of touching cells).
 */

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const PIC = "![](.drawings/media/aa.jpg)"
const INK = `![ink](../.drawings/media/ink-${ID}.svg)`

const kinds = (text: string) => positioned(text).map((b) => b.block.kind)
const slices = (text: string) => positioned(text).map((b) => text.slice(b.range.location, b.range.location + b.range.length))

describe("a line that is nothing but one image is a picture cell", () => {
  it("names its file and, for an ink cell, its id", () => {
    const [one] = positioned(PIC)
    expect(one).toEqual({ block: { kind: "picture", alt: "", path: ".drawings/media/aa.jpg", file: "aa.jpg", ink: null }, range: range(0, PIC.length) })
    const [ink] = positioned(INK)
    expect(ink!.block).toEqual({ kind: "picture", alt: "ink", path: `../.drawings/media/ink-${ID}.svg`, file: `ink-${ID}.svg`, ink: ID })
    const [away] = positioned("![a cat](https://example.com/cat.png)")
    expect(away!.block).toEqual({ kind: "picture", alt: "a cat", path: "https://example.com/cat.png", file: null, ink: null })
  })

  it("splits from a paragraph line straight above or below it (the Mac's rule), ranges exact", () => {
    const text = `words above\n${PIC}\nwords below`
    expect(kinds(text)).toEqual(["paragraph", "picture", "paragraph"])
    expect(slices(text)).toEqual(["words above", PIC, "words below"])
  })

  it("ends a list, a to-do list and a quote above it", () => {
    for (const above of ["- one", "- [ ] todo", "* star", "1. first", "> quoted"]) {
      const text = `${above}\n${PIC}`
      expect(kinds(text)).toHaveLength(2)
      expect(slices(text)[1]).toBe(PIC)
    }
  })

  it("leaves an image inside a list item or a quote, words round an image, and a fence alone", () => {
    expect(kinds(`- ${PIC}`)).toEqual(["bullets"])
    expect(kinds(`> ${PIC}`)).toEqual(["quote"])
    expect(kinds(`see ${PIC} here`)).toEqual(["paragraph"])
    expect(kinds("```\n" + PIC + "\n```")).toEqual(["code"])
  })

  it("is a cell between blank lines like any other, and two picture lines are two cells", () => {
    const text = `# Title\n\n${PIC}\n\n\n\n${INK}\n${PIC}\n`
    expect(kinds(text)).toEqual(["heading", "picture", "blank", "picture", "picture"])
    expect(slices(text)).toEqual(["# Title", PIC, "", INK, PIC])
    // An indented picture line keeps its range from the line's start, as a heading does.
    expect(slices(`para\n   ${PIC}`)).toEqual(["para", `   ${PIC}`])
  })

  it("is never a cell Return carries on in", () => {
    expect(keepsNewlines(positioned(PIC)[0]!.block)).toBe(false)
    expect(staysClosed(positioned(PIC)[0]!.block)).toBe(true)
    expect(staysClosed(positioned("words")[0]!.block)).toBe(false)
  })
})

// MARK: - The incremental parse with picture lines in it

let seed = 1
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]!
const LINES = [
  "", "", "", "words of a paragraph", "# Heading", "- bullet", "> quote", "---", "```", "let a = 1", "1. one",
  PIC, PIC, INK, "  ![](x.png)  ", "![a](b.png) and words", "- ![](c.png)", "![]()", "![](unclosed.png",
]
const FRAGMENTS = ["\n", "\n\n", "x", "# ", "- ", "```", "> ", PIC, "\n" + PIC + "\n", "!", "[", "](", ")", "![](", INK, " "]
const randomDoc = (lines: number): string => Array.from({ length: lines }, () => pick(LINES)).join("\n")

describe("positionedUpdate with picture lines", () => {
  it("equals a whole parse after every edit of long random chains", () => {
    seed = 31
    let checked = 0
    for (let chain = 0; chain < 40; chain++) {
      let text = randomDoc(5 + Math.floor(rnd() * 40))
      let blocks: PositionedBlock[] = positioned(text)
      for (let step = 0; step < 40; step++) {
        const from = Math.floor(rnd() * (text.length + 1))
        const to = rnd() < 0.4 ? from : Math.min(text.length, from + Math.floor(rnd() * 12))
        const insert = rnd() < 0.2 ? "" : pick(FRAGMENTS)
        const next = text.slice(0, from) + insert + text.slice(to)
        blocks = positionedUpdate(blocks, { from, toOld: to, toNew: from + insert.length }, linesOf(next))
        text = next
        expect(JSON.stringify(blocks)).toBe(JSON.stringify(positioned(text)))
        checked++
      }
    }
    expect(checked).toBe(1600)
  })
})

// MARK: - The kinds that make one

describe("the ink and picture cell kinds", () => {
  it("are named for the menu, and the Drawing Cell is the + menu's last group, on its own", () => {
    expect(kindName({ kind: "ink" })).toBe("Drawing Cell")
    expect(kindName({ kind: "picture", line: PIC })).toBe("Picture")
    expect(KIND_GROUPS[KIND_GROUPS.length - 1]).toEqual([{ kind: "ink" }])
    expect(ALL_KINDS.some((kind) => kind.kind === "picture")).toBe(false)
    expect(sameKind({ kind: "picture", line: PIC }, { kind: "picture", line: PIC })).toBe(true)
    expect(sameKind({ kind: "picture", line: PIC }, { kind: "picture", line: INK })).toBe(false)
    expect(sameKind({ kind: "ink" }, { kind: "ink" })).toBe(true)
  })

  it("writes nothing for an ink cell (the app makes it): a plain cell opens", () => {
    expect(opening({ kind: "ink" }, "a\n\n\n\nb", 3)).toBeNull()
    expect(openCell({ kind: "ink" }, "a\n\nb", 1).markdown).toBe("a\n\n\n\nb")
  })

  it("writes a docked picture's line as a cell of its own, through the one block builder", () => {
    const opened = openCell({ kind: "picture", line: PIC }, "a\n\nb", 1)
    expect(opened.markdown).toBe(`a\n\n${PIC}\n\nb`)
    expect(opened.cell).toEqual(range(3, PIC.length))
    expect(opened.caret).toBe(3 + PIC.length)
    expect(kinds(opened.markdown)).toEqual(["paragraph", "picture", "paragraph"])
    // At the end of the note, and in an empty one.
    expect(openCell({ kind: "picture", line: PIC }, "a", 1).markdown).toBe(`a\n\n${PIC}`)
    expect(openCell({ kind: "picture", line: PIC }, "", 0).markdown).toBe(PIC)
  })

  it("puts the line after the caret's line when that line has words", () => {
    const change = opening({ kind: "picture", line: PIC }, "words here\n\nnext", 3)!
    const done = applied("words here\n\nnext", change)
    expect(done.text).toBe(`words here\n\n${PIC}\n\nnext`)
    expect(kinds(done.text)).toEqual(["paragraph", "picture", "paragraph"])
  })
})

// MARK: - The page's rules: never open, never in a run

describe("a picture cell on the page", () => {
  const text = `above\n${PIC}\nbelow`
  const blocks = positioned(text)
  const cells = blocks.map((b) => b.range)
  const apart = (i: number) => staysClosed(blocks[i]!.block)
  const caret = (at: number): Range[] => [range(at, 0)]

  it("never joins the cells it touches into one run", () => {
    expect(touchingRuns(cells)).toEqual([{ first: 0, last: 2 }, { first: 0, last: 2 }, { first: 0, last: 2 }])
    expect(touchingRuns(cells, apart)).toEqual([{ first: 0, last: 0 }, { first: 1, last: 1 }, { first: 2, last: 2 }])
  })

  it("never opens: a caret at either end of it leaves it drawn, and the words beside it open alone", () => {
    const start = cells[1]!.location
    expect(cellStates(cells, caret(start + PIC.length), false, false, apart)).toEqual(["closed", "closed", "closed"])
    expect(cellStates(cells, caret(2), false, false, apart)).toEqual(["open", "closed", "closed"])
    // The caret at the paragraph's end, which is also one before the picture's start: the paragraph opens.
    expect(cellStates(cells, caret(start - 1), false, false, apart)).toEqual(["open", "closed", "closed"])
  })

  it("can still be held, by its bracket or inside a wider selection", () => {
    expect(cellStates(cells, [cells[1]!], true, false, apart)).toEqual(["closed", "held", "closed"])
    expect(cellStates(cells, [range(0, text.length)], false, false, apart)).toEqual(["held", "held", "held"])
  })

  it("is the same in the sparse states the editor asks for, on random notes and selections", () => {
    seed = 5
    for (let n = 0; n < 400; n++) {
      const note = randomDoc(3 + Math.floor(rnd() * 12))
      const parsed = positioned(note)
      const ranges = parsed.map((b) => b.range)
      const from = Math.floor(rnd() * (note.length + 1))
      const length = rnd() < 0.6 ? 0 : Math.floor(rnd() * (note.length - from + 1))
      const holding = rnd() < 0.3
      const dense = cellStates(ranges, [range(from, length)], holding, false, (i) => staysClosed(parsed[i]!.block))
      const sparse = cellStatesSparse(parsed, (b) => b.range, [range(from, length)], holding, false, (b) => staysClosed(b.block))
      dense.forEach((state, i) => expect(sparse.get(i) ?? "closed").toBe(state))
      parsed.forEach((b, i) => { if (staysClosed(b.block)) expect(sparse.get(i)).not.toBe("open") })
    }
  })

  it("is never split by Return: before it a cell opens above, after it one below", () => {
    const start = cells[1]!.location
    const below = applied(text, returnInBlock(text, range(start + PIC.length, 0))!)
    expect(below.text.split("\n")).toContain(PIC)
    // (The new cell the caret is in is an empty one, between the picture and the words below.)
    expect(kinds(below.text).filter((kind) => kind !== "blank")).toEqual(["paragraph", "picture", "paragraph"])
    expect(below.selection.location).toBeGreaterThan(start + PIC.length)
    const above = applied(text, returnInBlock(text, range(start, 0))!)
    expect(above.text.split("\n")).toContain(PIC)
    expect(above.selection.location).toBeLessThanOrEqual(above.text.indexOf(PIC))
  })
})
