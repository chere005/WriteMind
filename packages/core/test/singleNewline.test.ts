import { describe, expect, it } from "vitest"
import { growth } from "../src/cells/growth"
import { arm, structuralLines } from "../src/cells/seams"
import { blockAtCaret, expand, mergeCells, splitCell } from "../src/cells/editing"
import { linesOf, positioned } from "../src/markdown/parser"
import { replacing, range, type Range } from "../src/text/range"

/**
 * Port-first (Sean, 2026-10-10: "a single newline should expand the size of the cell to include the line the input
 * cursor is on"). `|` marks the caret in the notes below; a blank line (two newlines in a row) still separates cells.
 */
const note = (marked: string): { text: string; caret: number } => ({
  text: marked.replace("|", ""),
  caret: marked.indexOf("|"),
})

const grownBy = (marked: string, selection?: (caret: number) => Range) => {
  const { text, caret } = note(marked)
  return growth(positioned(text), linesOf(text), selection ? selection(caret) : range(caret, 0))
}

describe("a single newline grows the cell the caret is under", () => {
  it("takes the new line Return leaves under a paragraph, at the end of the note", () => {
    expect(grownBy("hello\n|")).toEqual({ index: 0, line: range(6, 0) })
  })

  it("takes it in the middle of a note too, while a blank line is still left to separate the cells", () => {
    // Return at the end of `hello` in `hello¶¶world`: the new line, then the blank line that was there.
    expect(grownBy("hello\n|\n\nworld")).toEqual({ index: 0, line: range(6, 0) })
    expect(grownBy("a\n\nb\n|\n\nc")).toEqual({ index: 1, line: range(5, 0) })
  })

  it("is the last line of a paragraph of several lines", () => {
    expect(grownBy("one\ntwo\nthree\n|")).toEqual({ index: 0, line: range(14, 0) })
  })

  it("is the same for a markdown cell", () => {
    expect(grownBy("<!-- markdown -->\nwords\n|")).toEqual({ index: 0, line: range(24, 0) })
  })

  it("takes a line of white space as the empty line it is", () => {
    expect(grownBy("hello\n   |")).toEqual({ index: 0, line: range(6, 3) })
  })

  it("takes the line when only the empty end of the note follows it", () => {
    expect(grownBy("hello\n|\n")).toEqual({ index: 0, line: range(6, 0) })
  })

  it("is not a blank line: the only empty line between two cells separates them", () => {
    expect(grownBy("hello\n|\nworld")).toBeNull()
  })

  it("is not the line after a blank line: that is the next cell, not this one", () => {
    expect(grownBy("hello\n\n|")).toBeNull()
    expect(grownBy("hello\n\n|\nworld")).toBeNull()
  })

  it("is not the caret on the words", () => {
    expect(grownBy("hello|")).toBeNull()
    expect(grownBy("hel|lo\n")).toBeNull()
  })

  it("is not a selection", () => {
    expect(grownBy("hello\n|", (caret) => range(caret - 2, 2))).toBeNull()
    expect(grownBy("hello\n|", (caret) => range(caret, 0))).not.toBeNull()
  })

  // CHANGED 2026-10-11 (Sean: "a single newline grows all those contents"): it was a paragraph's alone, and a heading, a list,
  // a quote, a fenced block and a table kept the line out of the cell. Every kind that is typed in takes it now; only a
  // picture or an ink cell, which is drawn and never typed in, does not.
  it("is every kind's: a heading, a rule, a list, a quote, a fenced block, a table", () => {
    const rows = [
      ["# Title\n|", 0], ["---\n|", 0], ["- a\n|", 0], ["* a\n|", 0], ["1. a\n|", 0], ["- [ ] a\n|", 0], ["> q\n|", 0],
      ["```\nx\n```\n|", 0], ["```wl\nx^2\n```\n|", 0], ["```eval python\n1\n```\n|", 0], ["a\n\n# Title\n|\n\nb", 1],
    ] as const
    for (const [marked, index] of rows) {
      const { text, caret } = note(marked)
      expect(grownBy(marked), JSON.stringify(marked)).toEqual({ index, line: range(caret, 0) })
      expect(text.length).toBeGreaterThan(0)
    }
    // (A table's own pipes are the caret's mark in the notes above, so this one says where it is.)
    const table = "| a | b |\n|---|---|\n"
    expect(growth(positioned(table), linesOf(table), range(table.length, 0))).toEqual({ index: 0, line: range(table.length, 0) })
  })

  it("is not a picture's or an ink cell's, nor the line under a fence that is not closed", () => {
    for (const marked of ["![](a.png)\n|", "![ink](snapshots/ink-1f6f4f0e-0000-4000-8000-000000000000.svg)\n|", "```\nx\n|"]) {
      expect(grownBy(marked), JSON.stringify(marked)).toBeNull()
    }
  })

  it("is the same lone-blank-line rule for every kind: between two cells it is the bar's", () => {
    for (const marked of ["# Title\n|\nbody", "- a\n|\nbody", "> q\n|\nbody", "```\nx\n```\n|\nbody"]) {
      expect(grownBy(marked), JSON.stringify(marked)).toBeNull()
    }
    expect(grownBy("# Title\n|\n\nbody")).toEqual({ index: 0, line: range(8, 0) })
  })

  it("is nothing in a note with no cells", () => {
    expect(grownBy("|")).toBeNull()
    expect(grownBy("\n|")).toBeNull()
  })
})

describe("the line a single newline opened is not a bar", () => {
  it("is in the cell, not between two: the caret there arms nothing", () => {
    const { text, caret } = note("hello\n|\n\nworld")
    expect(arm(range(caret, 0), text, null)).toBeNull()
    // At the end of the note, where it used to arm the bar under the last cell.
    const tail = note("hello\n|\n")
    expect(arm(range(tail.caret, 0), tail.text, null)).toBeNull()
  })

  it("leaves the blank line under it as the bar, and the lone blank line between two cells as it was", () => {
    const { text } = note("hello\n\n\nworld")
    // (The second of the two blank lines is the bar's: `barCaret` puts the caret there.)
    expect(arm(range(7, 0), text, null)).toBe(8)
    const lone = note("hello\n|\nworld")
    expect(arm(range(lone.caret, 0), lone.text, null)).toBe(7)
  })

  it("does not change what a blank line is: two newlines in a row still separate the cells", () => {
    expect(structuralLines("hello\n\n\nworld")).toHaveLength(2)
    expect(positioned("hello\n\n\nworld").map((one) => one.range)).toEqual([range(0, 5), range(8, 5)])
  })
})

describe("the cell commands find the cell a single newline grew", () => {
  it("names it as the cell the caret is in", () => {
    const { text, caret } = note("one\n\ntwo\n|\n\nthree")
    expect(blockAtCaret(caret, text)?.range).toEqual(range(5, 3))
    // (Nothing under the caret and no growth: not in any cell.)
    const between = note("one\n|\ntwo")
    expect(blockAtCaret(between.caret, between.text)).toBeNull()
  })

  it("Merge Cells joins THAT cell to the one below it, not the last two cells of the note", () => {
    const { text, caret } = note("a\n\nb\n|\n\nc\n\nd")
    const change = mergeCells(text, range(caret, 0))!
    expect(replacing(text, change.range, change.replacement)).toBe("a\n\nb\nc\n\nd")
  })

  it("Split Cell has nothing to cut on the empty line: it does nothing, as at the end of a cell", () => {
    const { text, caret } = note("hello world\n|")
    expect(splitCell(text, range(caret, 0))).toBeNull()
  })

  it("Expand selection grows from the empty line to the cell it is in", () => {
    const { text, caret } = note("hello world\n|\n\nbye")
    expect(expand(range(caret, 0), text)).toEqual(range(0, 11))
  })
})
