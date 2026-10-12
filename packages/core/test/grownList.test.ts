import { describe, expect, it } from "vitest"
import { listOnGrownLine } from "../src/cells/grownList"
import { positioned } from "../src/markdown/parser"
import { range, replacing } from "../src/text/range"
import type { ListStyle } from "../src/markdown/formatting"

/**
 * A LIST CHOSEN ON THE LINE A NEWLINE GREW (Sean, 2026-10-11: "the input cursor should go to where it is typing when inserting a
 * checklist or bullets"). Port-first. `|` marks the caret. Under a list the list's own command answers (null here), except that
 * a number counts on; under any other cell the list is the cell the bar under that cell would open, the grown line gone.
 * The editor's `list` command applies it (editor/test/grownList.test.ts) and e2e editor/10..12 press it on both pages.
 */
const apply = (marked: string, style: ListStyle): { text: string; caret: number } | null => {
  const text = marked.replace("|", "")
  const change = listOnGrownLine(text, range(marked.indexOf("|"), 0), style)
  return change ? { text: replacing(text, change.range, change.replacement), caret: change.selection.location } : null
}

describe("a list chosen on the line a newline grew under a cell that is not a list", () => {
  it("opens as its own cell under it, as the bar would, the caret in its item (not a cell touching it)", () => {
    for (const [marked, style, expected, caret] of [
      ["Alpha\n|\n\nBeta", "dots", "Alpha\n\n- \n\nBeta", 9],
      ["Alpha\n|", "todo", "Alpha\n\n- [ ] ", 13],
      ["Alpha\n|\n", "numbered", "Alpha\n\n1. ", 10],
      ["# Title\n|\n\nbody", "dashes", "# Title\n\n* \n\nbody", 11],
      ["> said\n|", "dots", "> said\n\n- ", 10],
      ["```\nx\n```\n|", "dots", "```\nx\n```\n\n- ", 13],
      ["a\n\nb\n|\n\nc", "todo", "a\n\nb\n\n- [ ] \n\nc", 12],
    ] as const) {
      const out = apply(marked, style)
      expect(out, marked).not.toBeNull()
      expect(out!.text, marked).toBe(expected)
      expect(out!.caret, marked).toBe(caret)
      // A cell of its own: the cells above and below are what they were, apart from it.
      const cells = positioned(out!.text)
      const item = cells.find((cell) => cell.range.location <= caret && caret <= cell.range.location + cell.range.length)
      expect(item?.block.kind, marked).toBe(style === "dots" ? "bullets" : style === "todo" ? "todos" : style)
    }
  })
})

describe("a list chosen on the line a newline grew under a list", () => {
  it("counts on from the number above (it wrote `1. ` under `2. b`)", () => {
    expect(apply("1. a\n2. b\n|", "numbered")).toEqual({ text: "1. a\n2. b\n3. ", caret: 13 })
    expect(apply("1) a\n2) b\n|\n\nnext", "numbered")).toEqual({ text: "1) a\n2) b\n3) \n\nnext", caret: 13 })
    expect(apply("- x\n9. b\n|", "numbered")).toEqual({ text: "- x\n9. b\n10. ", caret: 13 })
  })

  it("is the list's own command's otherwise: its next item, or another kind's touching it", () => {
    for (const [marked, style] of [
      ["- one\n|", "dots"], ["- one\n|", "todo"], ["* one\n|\n\nb", "dashes"], ["- [ ] one\n|", "numbered"], ["1. a\n|", "dots"],
    ] as const) {
      expect(apply(marked, style), marked).toBeNull()
    }
  })
})

describe("not on a grown line", () => {
  it("is nothing: an empty note, a line of words, the bar's blank line, a selection", () => {
    expect(apply("|", "dots")).toBeNull()
    expect(apply("Alpha|", "dots")).toBeNull()
    expect(apply("Alpha\n\n|\n\nBeta", "dots")).toBeNull()
    expect(apply("Alpha\n|\nBeta", "dots")).toBeNull()
    expect(listOnGrownLine("Alpha\n", range(5, 1), "dots")).toBeNull()
  })
})
