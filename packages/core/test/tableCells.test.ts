import { describe, expect, it } from "vitest"
import { positioned } from "../src/markdown/parser"
import { replacing, range } from "../src/text/range"
import { tableBlock, emptyTable } from "../src/cells/tableCells"
import { kindOfBlock, openCell, opening, kindName } from "../src/cells/types"

/**
 * The toolbar's Table button (docs/PLAN-bars-2026-10.md P1): port-only, there is no Swift test to transcribe.
 * An empty two-column table, a header and two body rows, written as a cell of its own, the caret in the first
 * header cell, one edit.
 */

const apply = (text: string, at: number, length = 0) => {
  const change = tableBlock(text, range(at, length))
  return { text: replacing(text, change.range, change.replacement), caret: change.selection.location }
}

describe("the table the Table button writes", () => {
  it("is two columns and three rows: the header, the delimiter row, two body rows", () => {
    expect(emptyTable()).toBe("|  |  |\n| --- | --- |\n|  |  |\n|  |  |")
  })

  it("reads back as ONE table cell with two columns and two body rows", () => {
    const cells = positioned(emptyTable())
    expect(cells).toHaveLength(1)
    const block = cells[0]!.block
    expect(block.kind).toBe("table")
    if (block.kind === "table") {
      expect(block.header).toEqual(["", ""])
      expect(block.rows).toEqual([["", ""], ["", ""]])
    }
  })

  it("in an empty note: the table alone, the caret in the first header cell", () => {
    const { text, caret } = apply("", 0)
    expect(text).toBe(emptyTable())
    expect(caret).toBe(2)
    expect(text.slice(0, caret)).toBe("| ")
  })

  it("on an empty line between two cells: a blank line either side, never doubled", () => {
    const note = "Above\n\n\nBelow"
    const at = "Above\n\n".length
    const { text, caret } = apply(note, at)
    expect(text).toBe(`Above\n\n${emptyTable()}\n\nBelow`)
    const cells = positioned(text).filter((cell) => cell.block.kind !== "blank")
    expect(cells.map((cell) => cell.block.kind)).toEqual(["paragraph", "table", "paragraph"])
    expect(text.slice(caret - 2, caret)).toBe("| ")
    expect(caret).toBe("Above\n\n".length + 2)
  })

  it("at the end of a note that stops on a line of words: a blank line is added above, none below", () => {
    const { text } = apply("Words", "Words".length)
    expect(text).toBe(`Words\n\n${emptyTable()}`)
  })

  it("is the same cell the + menu's kind opens: opening(table) and tableBlock agree", () => {
    const note = "One\n\n\nTwo"
    const here = "One\n\n".length
    const direct = tableBlock(note, range(here, 0))
    const viaKind = opening({ kind: "table" }, note, here)
    expect(viaKind).toEqual(direct)
  })

  it("openCell makes a table cell at a seam with the caret in its first header cell", () => {
    const opened = openCell({ kind: "table" }, "One\n\nTwo", "One\n\n".length)
    const cells = positioned(opened.markdown).filter((cell) => cell.block.kind !== "blank")
    expect(cells.map((cell) => cell.block.kind)).toEqual(["paragraph", "table", "paragraph"])
    expect(opened.markdown.slice(opened.caret - 2, opened.caret)).toBe("| ")
  })
})

describe("kindOfBlock: what the Style button names", () => {
  const kind = (markdown: string) => {
    const cell = positioned(markdown).find((one) => one.block.kind !== "blank")
    return kindOfBlock(cell?.block)
  }

  it("names every kind the Style menu offers", () => {
    expect(kind("Words here")).toEqual({ kind: "text" })
    expect(kind("<!-- markdown -->\nWords **here**")).toEqual({ kind: "markdown" })
    expect(kind("# Title")).toEqual({ kind: "heading", level: 1 })
    expect(kind("###### Author")).toEqual({ kind: "heading", level: 6 })
    expect(kind("- one\n- two")).toEqual({ kind: "list", style: "dots" })
    expect(kind("* one")).toEqual({ kind: "list", style: "dashes" })
    expect(kind("1. one")).toEqual({ kind: "list", style: "numbered" })
    expect(kind("- [ ] one")).toEqual({ kind: "list", style: "todo" })
    expect(kind("> quoted")).toEqual({ kind: "quote" })
    expect(kind("```python\nprint(1)\n```")).toEqual({ kind: "code" })
    expect(kind("```wl\nx^2\n```")).toEqual({ kind: "maths" })
    expect(kind("```eval python\nprint(1)\n```")).toEqual({ kind: "evaluation", evaluator: "python" })
  })

  it("names a table, a picture and a drawing cell (not in the menu, but the caret can be in them)", () => {
    expect(kind(emptyTable())).toEqual({ kind: "table" })
    expect(kind("![alt](.drawings/media/a.png)")?.kind).toBe("picture")
    expect(kind("![](.drawings/media/ink-0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f.svg)")?.kind).toBe("ink")
  })

  it("is null for a rule, for the blank lines a note holds on purpose, and for no block at all", () => {
    expect(kind("---")).toBeNull()
    expect(kindOfBlock({ kind: "blank", lines: 2 })).toBeNull()
    expect(kindOfBlock(null)).toBeNull()
  })

  it("names the table", () => {
    expect(kindName({ kind: "table" })).toBe("Table")
  })
})
