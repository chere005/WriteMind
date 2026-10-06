import { describe, expect, it } from "vitest"
import {
  apartAbove, cellSpacing, evalResult, cellStates, cellStatesSparse, deleteCell, duplicateCell, groupsOf, makeEvaluation,
  openCell, pasteCell, positioned, standsAlone, touchingRuns, writeAnswer,
} from "../src/index"
import { applied, range } from "../src/text/range"

/**
 * Port-only (Sean, 2026-10-05: "this math cell should be placed as its own cell, not connected to the cell before it"):
 * a block that is a cell by its kind stands apart from a block it touches, and every command that makes a cell writes
 * it with a blank line either side (core cells/apart.ts). Sean's note: an answer with a ```wl block straight under it.
 */
const SEAN = "Some words\n\n```eval wl\n2+2\n```\n\n```out\n4\n```\n```wl\nIntegrate[x^2, {x, 0, 1}]\n```\n\nAfter"

describe("reading: a block that stands alone is its own cell where it touches another", () => {
  it("the parser already ends the answer at its fence, and the maths after it is a block of its own", () => {
    const kinds = positioned(SEAN).map((b) => b.block.kind)
    expect(kinds).toEqual(["paragraph", "code", "code", "code", "paragraph"])
  })

  it("which kinds stand alone", () => {
    const of = (md: string) => standsAlone(positioned(md)[0]!.block)
    expect(of("```wl\nPi\n```")).toBe(true)
    expect(of("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(true)
    expect(of("![x](a.png)")).toBe(true)
    expect(of("# Title")).toBe(true)
    expect(of("---")).toBe(true)
    expect(of("words")).toBe(false)
    expect(of("- item")).toBe(false)
    expect(of("> quote")).toBe(false)
  })

  it("apartAbove: the maths under the answer, and nothing where a blank line already is", () => {
    const cells = positioned(SEAN)
    expect(cells.map((_, i) => apartAbove(cells, i))).toEqual([false, false, false, true, false])
    const list = positioned("Intro\n- a\n- b")
    expect(list.map((_, i) => apartAbove(list, i)), "words and a list touching are one thing to type in").toEqual([false, false])
    const heading = positioned("# Title\nRight under it")
    expect(heading.map((_, i) => apartAbove(heading, i))).toEqual([false, true])
  })

  it("never in a run of touching cells, so the caret in the answer opens the answer alone", () => {
    const cells = positioned(SEAN)
    const ranges = cells.map((c) => c.range)
    const alone = (i: number) => standsAlone(cells[i]!.block)
    expect(touchingRuns(ranges, alone).map((r) => [r.first, r.last])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]])
    const inAnswer = SEAN.indexOf("4\n```")
    expect(cellStates(ranges, [range(inAnswer, 0)], false, false, undefined, alone))
      .toEqual(["closed", "closed", "open", "closed", "closed"])
    const sparse = cellStatesSparse(cells, (c) => c.range, [range(inAnswer, 0)], false, false, undefined,
      (c) => standsAlone(c.block))
    expect([...sparse]).toEqual([[2, "open"]])
    // Words and a list still open together.
    const list = positioned("Intro\n- a\n- b")
    expect(cellStates(list.map((c) => c.range), [range(1, 0)], false, false, undefined, (i) => standsAlone(list[i]!.block)))
      .toEqual(["open", "open"])
  })

  it("an In/Out pair stays one pair, touching or not; the maths under the answer is no part of it", () => {
    const pairOf = (md: string) => groupsOf(positioned(md)).map((g) => [g.input.location, g.output.location])
    const cells = positioned(SEAN)
    expect(pairOf(SEAN)).toEqual([[cells[1]!.range.location, cells[2]!.range.location]])
    const touching = "```eval wl\n2+2\n```\n```out\n4\n```\n```wl\nPi\n```"
    const t = positioned(touching)
    expect(pairOf(touching), "a pair written touching is still one pair").toEqual([[t[0]!.range.location, t[1]!.range.location]])
    expect(t.map((_, i) => apartAbove(t, i)), "...of two cells, and the maths a third").toEqual([false, true, true])
  })

  it("a bar that is the cursor opens nothing, the maths included", () => {
    const cells = positioned(SEAN)
    const atMaths = cells[3]!.range.location
    expect(cellStates(cells.map((c) => c.range), [range(atMaths, 0)], false, true)).toEqual(Array(5).fill("closed"))
  })
})

describe("writing: a new cell gets a blank line either side, never two", () => {
  it("cellSpacing counts the line breaks already there", () => {
    expect(cellSpacing("", "")).toEqual({ lead: "", trail: "" })
    expect(cellSpacing("a", "b")).toEqual({ lead: "\n\n", trail: "\n\n" })
    expect(cellSpacing("a\n", "\nb")).toEqual({ lead: "\n", trail: "\n" })
    expect(cellSpacing("a\n\n", "\n\nb")).toEqual({ lead: "", trail: "" })
    expect(cellSpacing("a\n  \n", "\n \nb")).toEqual({ lead: "", trail: "" })
    expect(cellSpacing("\n", "\n")).toEqual({ lead: "", trail: "" })
    expect(cellSpacing("```\n", "")).toEqual({ lead: "\n", trail: "" })
  })

  it("the answer a run writes is not glued to a block that touched its cell", () => {
    const note = "```eval wl\n2+2\n```\n```wl\nPi\n```"
    const cell = positioned(note)[0]!.range
    const out = applied(note, writeAnswer(evalResult({ stdout: "4", status: 0 }), cell, note)).text
    expect(out.startsWith("```eval wl\n2+2\n```\n\n```out\n")).toBe(true)
    expect(out.endsWith("\n```\n\n```wl\nPi\n```")).toBe(true)
  })

  it("a pasted or duplicated cell has a blank line under it too", () => {
    const note = "```out\n4\n```\n```wl\nPi\n```"
    const answer = positioned(note)[0]!.range
    expect(applied(note, duplicateCell(answer, note)).text).toBe("```out\n4\n```\n\n```out\n4\n```\n\n```wl\nPi\n```")
    expect(applied("a\n\nb", pasteCell("x", range(0, 1), "a\n\nb")).text).toBe("a\n\nx\n\nb")
    expect(applied("a", pasteCell("x", range(0, 1), "a")).text).toBe("a\n\nx")
  })

  it("an evaluation cell at the end of a note that ends on a line break", () => {
    expect(applied("a\n", makeEvaluation("wolfram", null, "a\n")).text.startsWith("a\n\n```eval")).toBe(true)
    expect(applied("a\n\n", makeEvaluation("wolfram", null, "a\n\n")).text.startsWith("a\n\n```eval")).toBe(true)
  })

  it("a cell opened at the bar between two touching blocks is a cell of its own", () => {
    const at = SEAN.indexOf("```wl")
    const made = openCell({ kind: "text" }, SEAN, at, "x")
    expect(made.markdown).toContain("```out\n4\n```\n\nx\n\n```wl\n")
  })

  it("deleting a cell that touched its neighbours leaves them two cells", () => {
    const note = "Words\n```wl\nPi\n```\nMore"
    const maths = positioned(note)[1]!.range
    expect(applied(note, deleteCell(maths, note)).text).toBe("Words\n\nMore")
    const under = "```out\n4\n```\n```wl\nPi\n```\n\nAfter"
    const wl = positioned(under)[1]!.range
    expect(applied(under, deleteCell(wl, under)).text).toBe("```out\n4\n```\n\nAfter")
    // As before where blank lines were there already.
    expect(applied("a\n\nb\n\nc", deleteCell(range(3, 1), "a\n\nb\n\nc")).text).toBe("a\n\nc")
  })
})
