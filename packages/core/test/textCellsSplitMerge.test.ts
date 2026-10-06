// Split Cell / Merge Cells (Ctrl+D / Ctrl+M) with text cells and markdown cells (docs/PLAN-text-cells.md; port-first:
// the Mac has no text cells, so nothing here is transcribed). Each half of a split stays the kind it was (the rule
// Return and display maths keep, `keepingHalves`); a merge is Backspace's rule: the UPPER cell's kind wins.
import { describe, expect, it } from "vitest"
import { blocks } from "../src/markdown/parser"
import { MARKDOWN_MARKER } from "../src/markdown/plainText"
import { mergeCells, splitCell } from "../src/cells/editing"
import { apply } from "../src/markdown/formatting"
import { range } from "../src/text/range"

const M = MARKDOWN_MARKER

describe("Split Cell keeps each half its kind", () => {
  it("a text cell's halves are written by the escape rule again: a mid-line # that now starts a line stays literal", () => {
    const text = "foo # bar"
    const change = splitCell(text, range(text.indexOf("#"), 0))!
    const after = apply(text, change)
    expect(after).toBe("foo\n\n\\# bar")
    expect(blocks(after)).toEqual([{ kind: "paragraph", text: "foo" }, { kind: "paragraph", text: "# bar" }])
    // The caret lands on the blank line between them, the seam.
    expect(change.selection.location).toBe("foo\n".length)
  })

  it("an escape the cut leaves with nothing to escape goes, and the halves read as they did", () => {
    const text = "x \\*y z* w"
    const after = apply(text, splitCell(text, range(text.indexOf("z"), 0))!)
    expect(after).toBe("x *y\n\nz* w")
    expect(blocks(after)).toEqual([{ kind: "paragraph", text: "x *y" }, { kind: "paragraph", text: "z* w" }])
  })

  it("a markdown cell's second half gets a marker of its own; the caret is on the seam", () => {
    const text = `${M}\nfoo **bar** baz`
    const change = splitCell(text, range(text.indexOf("baz"), 0))!
    const after = apply(text, change)
    expect(after).toBe(`${M}\nfoo **bar**\n\n${M}\nbaz`)
    expect(blocks(after).map((one) => one.kind === "paragraph" && one.markdown)).toEqual([true, true])
    expect(after.slice(change.selection.location, change.selection.location + 1 + M.length)).toBe(`\n${M}`)
  })

  it("an older note's markdown cell (no marker) gives both halves a marker, so a half with no markup stays markdown", () => {
    const text = "**a** see <https://x.y>"
    expect(blocks(text).map((one) => one.kind === "paragraph" && one.markdown)).toEqual([true])
    const change = splitCell(text, range(text.indexOf("see"), 0))!
    const after = apply(text, change)
    expect(after).toBe(`${M}\n**a**\n\n${M}\nsee <https://x.y>`)
    expect(blocks(after).map((one) => one.kind === "paragraph" && one.markdown)).toEqual([true, true])
    expect(after.slice(change.selection.location, change.selection.location + 1 + M.length)).toBe(`\n${M}`)
  })

  it("the start of a markdown cell's words is an end of the cell: nothing to split", () => {
    const text = `${M}\nfoo bar`
    expect(splitCell(text, range(M.length + 1, 0))).toBeNull()
    expect(splitCell(text, range(text.length, 0))).toBeNull()
  })
})

describe("Merge Cells: the upper cell's kind wins (Backspace's rule)", () => {
  it("a markdown cell under a text cell loses its marker, and its markup is written as literal words", () => {
    const text = `plain words\n\n${M}\n**b** and \`c\``
    const change = mergeCells(text, range(1, 0))!
    const after = apply(text, change)
    expect(after).not.toContain(M)
    // ONE text cell, which shows the markdown as it was typed.
    expect(blocks(after)).toEqual([{ kind: "paragraph", text: "plain words\n**b** and `c`" }])
    expect(change.selection.location).toBe("plain words\n".length)
  })

  it("an older note's markdown (no marker) under a text cell is made literal too, so the text cell stays one", () => {
    const after = apply("plain\n\na **b**", mergeCells("plain\n\na **b**", range(1, 0))!)
    expect(blocks(after)).toEqual([{ kind: "paragraph", text: "plain\na **b**" }])
  })

  it("a text cell under a markdown cell keeps its escapes: its words read as they did, in a markdown cell", () => {
    const text = `${M}\n**a**\n\nx \\*y\\*`
    const after = apply(text, mergeCells(text, range(M.length + 2, 0))!)
    expect(after).toBe(`${M}\n**a**\nx \\*y\\*`)
    const [cell] = blocks(after)
    expect(cell).toMatchObject({ kind: "paragraph", markdown: true })
  })

  it("two markdown cells keep one marker, the upper one's", () => {
    const text = `${M}\na\n\n${M}\nb`
    expect(apply(text, mergeCells(text, range(M.length + 1, 0))!)).toBe(`${M}\na\nb`)
  })

  it("two text cells join as before; a text cell and an empty markdown cell under it leave no marker behind", () => {
    expect(apply("one\n\ntwo", mergeCells("one\n\ntwo", range(1, 0))!)).toBe("one\ntwo")
    const text = `a\n\n${M}\n\nb`
    const after = apply(text, mergeCells(text, range(0, 0))!)
    expect(after).not.toContain(M)
    expect(blocks(after).filter((one) => one.kind === "paragraph")).toHaveLength(2)
  })
})
