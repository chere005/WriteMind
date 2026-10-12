import { describe, expect, it } from "vitest"
import {
  blocks, isListBlock, linesOf, listItemsOf, listStyleOfLine, positioned, positionedUpdate, type Block, type ListItem,
} from "../src/markdown/parser"
import { apply, toggleList, toggleTodo } from "../src/markdown/formatting"
import { kindOfBlock } from "../src/cells/types"
import { keepsNewlines, returnInBlock } from "../src/cells/preview"
import { closingReturn } from "../src/cells/newline"
import { growth } from "../src/cells/growth"
import { listContinuation, mergeCells, splitCell } from "../src/cells/editing"
import { copyCell, deleteCell, moveCell } from "../src/cells/commands"
import { readingSource } from "../src/cells/readingCell"
import { blockHtml } from "../src/export/blocks"
import { wolframPlan, type PlannedCell } from "../src/export/wolfram/plan"
import { range, replacing } from "../src/text/range"

/**
 * LIST LINES THAT TOUCH ARE ONE CELL, WHATEVER THEY ARE MARKED WITH (Sean, 2026-10-11, on a screenshot of a dashes list
 * with a to-do list straight under it and the bar drawn between them: "this should not be two separate cells"). Port-first:
 * the Mac's parser ends a list at a line of another kind, as this one did. A list of one kind is still that kind's block
 * (`bullets`, `dashes`, `numbered`, `todos`), so every note written before reads as it did except where lists touch; a list
 * that mixes kinds is a `mixed` block whose items each keep their kind. The real keys on both pages:
 * e2e/suites/cells/22-mixed-list-markdown.mjs and 23-mixed-list-rendered.mjs.
 */

const item = (style: ListItem["style"], text: string, done = false): ListItem => ({ style, text, done })
/** Sean's note, as the probe left it: four dashes, three to-dos (the last one empty), no blank line anywhere. */
const SEANS = "* hello\n* there\n* world\n* how\n- [ ] Are you\n- [ ] Doing today\n- [ ] "

describe("the parser: touching lists are one block", () => {
  it("reads Sean's dashes with the to-dos under them as ONE cell, every item its own kind", () => {
    const found = positioned(SEANS)
    expect(found).toHaveLength(1)
    expect(found[0]!.range).toEqual(range(0, SEANS.length))
    expect(found[0]!.block).toEqual({ kind: "mixed", items: [
      item("dashes", "hello"), item("dashes", "there"), item("dashes", "world"), item("dashes", "how"),
      item("todo", "Are you"), item("todo", "Doing today"), item("todo", ""),
    ] })
  })

  it("is the probe's note: `* hello`, `* how`, an empty line made a to-do, then words", () => {
    // (Return, Return, Style ▸ To-do, "Are you": what was two brackets and a seam on build a5bc6cd.)
    expect(blocks("* hello\n* how\n- [ ] Are you")).toEqual([
      { kind: "mixed", items: [item("dashes", "hello"), item("dashes", "how"), item("todo", "Are you")] },
    ])
  })

  it("joins every mix of dots, dashes, numbers and boxes, in any order, nested or not", () => {
    expect(blocks("1. a\n- b\n* c\n- [x] d\n+ e\n2) f")).toEqual([{ kind: "mixed", items: [
      item("numbered", "a"), item("dots", "b"), item("dashes", "c"), item("todo", "d", true), item("dots", "e"), item("numbered", "f"),
    ] }])
    // A nested item of another kind is the list's too (it used to cut the list in three).
    const nested = positioned("1. step\n   - detail\n2. step")
    expect(nested).toHaveLength(1)
    expect(listItemsOf(nested[0]!.block as Extract<Block, { kind: "mixed" }>).map((one) => one.style)).toEqual(["numbered", "dots", "numbered"])
  })

  it("leaves a list of one kind the block it always was", () => {
    expect(blocks("- a\n+ b")).toEqual([{ kind: "bullets", items: ["a", "b"] }])
    expect(blocks("* a\n* b")).toEqual([{ kind: "dashes", items: ["a", "b"] }])
    expect(blocks("1. a\n2) b")).toEqual([{ kind: "numbered", items: ["a", "b"] }])
    expect(blocks("- [ ] a\n* [x] b")).toEqual([{ kind: "todos", items: [{ text: "a", done: false }, { text: "b", done: true }] }])
  })

  it("still makes two cells of two lists with a blank line between them", () => {
    const found = positioned("* hello\n* how\n\n- [ ] Are you")
    expect(found.map((one) => one.block.kind)).toEqual(["dashes", "todos"])
    expect(found.map((one) => one.range)).toEqual([range(0, 13), range(15, 13)])
  })

  it("does not take in a quote, a paragraph line, a heading, a rule or a fence: those keep their rules", () => {
    expect(blocks("- a\n> q\n* b").map((one) => one.kind)).toEqual(["bullets", "quote", "dashes"])
    expect(blocks("- a\nwords\n* b").map((one) => one.kind)).toEqual(["bullets", "paragraph", "dashes"])
    expect(blocks("- a\n# H\n* b").map((one) => one.kind)).toEqual(["bullets", "heading", "dashes"])
    expect(blocks("- a\n---\n* b").map((one) => one.kind)).toEqual(["bullets", "rule", "dashes"])
    expect(blocks("- a\n```\nx\n```\n* b").map((one) => one.kind)).toEqual(["bullets", "code", "dashes"])
    expect(blocks("words\n- a\n* b").map((one) => one.kind)).toEqual(["paragraph", "mixed"])
  })

  it("reads a marker with nothing after it under ANY list as that list's next item, of its own kind", () => {
    expect(blocks("* how\n-")).toEqual([{ kind: "mixed", items: [item("dashes", "how"), item("dots", "")] }])
    expect(blocks("- [ ] a\n*")).toEqual([{ kind: "mixed", items: [item("todo", "a"), item("dashes", "")] }])
    expect(blocks("- a\n3.")).toEqual([{ kind: "mixed", items: [item("dots", "a"), item("numbered", "")] }])
    // (Its own kind's empty item stays that kind's block; under words or on its own it is still a paragraph line.)
    expect(blocks("- a\n-")).toEqual([{ kind: "bullets", items: ["a", ""] }])
    expect(blocks("words\n*").map((one) => one.kind)).toEqual(["paragraph"])
  })

  it("keeps the ranges exact for the cells round a mixed list", () => {
    const text = "Top\n\n* a\n- [ ] b\n1. c\n\nBottom"
    const found = positioned(text)
    expect(found.map((one) => one.block.kind)).toEqual(["paragraph", "mixed", "paragraph"])
    expect(text.slice(found[1]!.range.location, found[1]!.range.location + found[1]!.range.length)).toBe("* a\n- [ ] b\n1. c")
  })

  it("is parsed the same incrementally as whole, across the edits that join and part two lists", () => {
    const steps: Array<[string, number, number, string]> = [
      // [text, from, to, insert]: take the blank line between two lists out, put it back, change a dash to a box.
      ["* a\n\n- [ ] b\n\nend", 3, 4, ""],
      ["* a\n- [ ] b\n\nend", 3, 3, "\n"],
      ["* a\n* b\n* c\n\nend", 4, 5, "- [ ]"],
      ["# H\n\n- a\n1. b\n\n* c", 13, 14, ""],
      ["- a\nwords\n* b", 4, 9, "- [ ] w"],
    ]
    for (const [text, from, to, insert] of steps) {
      const next = text.slice(0, from) + insert + text.slice(to)
      const updated = positionedUpdate(positioned(text), { from, toOld: to, toNew: from + insert.length }, linesOf(next))
      expect(updated, JSON.stringify(next)).toEqual(positioned(next))
    }
  })
})

describe("the list helpers", () => {
  it("isListBlock answers for all five kinds and nothing else", () => {
    expect(["- a", "* a", "1. a", "- [ ] a", "- a\n* b"].map((text) => isListBlock(blocks(text)[0]))).toEqual([true, true, true, true, true])
    expect(["a", "# a", "> a", "---", "```\nx\n```"].map((text) => isListBlock(blocks(text)[0]))).toEqual([false, false, false, false, false])
    expect(isListBlock(null)).toBe(false)
  })

  it("listItemsOf gives the items of a one-kind list with their kind", () => {
    expect(listItemsOf({ kind: "todos", items: [{ text: "a", done: true }] })).toEqual([item("todo", "a", true)])
    expect(listItemsOf({ kind: "numbered", items: ["a"] })).toEqual([item("numbered", "a")])
  })

  it("listStyleOfLine reads a line's kind of item, empty or not, indented or not", () => {
    expect(["- a", "+ a", "* a", "1. a", "2) a", "- [ ] a", "* [x] a", "  - a", "-", "* ", "3.", "- [ ]", "a", "# a", "> a", ""]
      .map(listStyleOfLine)).toEqual(["dots", "dots", "dashes", "numbered", "numbered", "todo", "todo", "dots", "dots", "dashes",
      "numbered", "todo", null, null, null, null])
  })
})

describe("the Style button names the item the caret is on", () => {
  const mixed = blocks("* hello\n- [ ] Are you\n1. one\n- dot")[0]!
  it("a box is To-do, a dash Dashes, a number Numbered, a dot Dots, under one bracket", () => {
    expect(kindOfBlock(mixed, "* hello")).toEqual({ kind: "list", style: "dashes" })
    expect(kindOfBlock(mixed, "- [ ] Are you")).toEqual({ kind: "list", style: "todo" })
    expect(kindOfBlock(mixed, "1. one")).toEqual({ kind: "list", style: "numbered" })
    expect(kindOfBlock(mixed, "  - dot")).toEqual({ kind: "list", style: "dots" })
  })

  it("names the first item's kind with no line, or on a line that is no item; a one-kind list is its kind", () => {
    expect(kindOfBlock(mixed)).toEqual({ kind: "list", style: "dashes" })
    expect(kindOfBlock(mixed, "")).toEqual({ kind: "list", style: "dashes" })
    expect(kindOfBlock(blocks("- [ ] a")[0])).toEqual({ kind: "list", style: "todo" })
    expect(kindOfBlock(blocks("1. a")[0], "1. a")).toEqual({ kind: "list", style: "numbered" })
    // (Any other block ignores the line.)
    expect(kindOfBlock(blocks("# T")[0], "- a")).toEqual({ kind: "heading", level: 1 })
  })
})

describe("editing a mixed list", () => {
  it("ticks the box asked for, counting the boxes only", () => {
    const text = "* hello\n- [ ] Are you\n1. x\n- [ ] Doing today"
    const cell = positioned(text)[0]!.range
    expect(apply(text, toggleTodo(text, cell, 1)!)).toBe("* hello\n- [ ] Are you\n1. x\n- [x] Doing today")
    expect(apply(text, toggleTodo(text, cell, 0)!)).toBe("* hello\n- [x] Are you\n1. x\n- [ ] Doing today")
    expect(toggleTodo(text, cell, 2)).toBeNull()
  })

  it("Return on an item carries ITS kind on, on the rendered page as on the markdown side", () => {
    expect(listContinuation("- [ ] Are you")).toBe("- [ ] ")
    expect(listContinuation("* hello")).toBe("* ")
    const text = "* hello\n- [ ] Are you"
    expect(apply(text, returnInBlock(text, range(7, 0))!)).toBe("* hello\n* \n- [ ] Are you")
    expect(apply(text, returnInBlock(text, range(text.length, 0))!)).toBe("* hello\n- [ ] Are you\n- [ ] ")
    expect(keepsNewlines(blocks(text)[0])).toBe(true)
  })

  it("the empty LAST item's Return takes its marker off and keeps the line in the cell; the next Return arms the bar under the whole cell", () => {
    const text = SEANS
    const cleared = apply(text, returnInBlock(text, range(text.length, 0))!)
    expect(cleared).toBe("* hello\n* there\n* world\n* how\n- [ ] Are you\n- [ ] Doing today\n")
    // The line is the cell's (growth), and it is the ONE cell's.
    const cells = positioned(cleared)
    expect(cells).toHaveLength(1)
    expect(growth(cells, linesOf(cleared), range(cleared.length, 0))).toEqual({ index: 0, line: range(cleared.length, 0) })
    // The next Return: the line goes, the bar is under the list (index 0, below).
    const closed = closingReturn(cells, linesOf(cleared), range(cleared.length, 0))
    expect(closed).toEqual({ index: 0, remove: range(cleared.length - 1, 1), below: true })
  })

  it("an empty item in the MIDDLE of a mixed list ends it there: what is above and what is below become two cells", () => {
    const text = "* a\n- [ ] \n1. c"
    const out = apply(text, returnInBlock(text, range(10, 0))!)
    expect(out).toBe("* a\n\n1. c")
    expect(positioned(out).map((one) => one.block.kind)).toEqual(["dashes", "numbered"])
  })

  it("a single newline at the end grows the whole cell", () => {
    const text = "* a\n- [ ] b\n"
    expect(growth(positioned(text), linesOf(text), range(text.length, 0))?.index).toBe(0)
  })

  it("Style ▸ a kind on one item changes that item, and the cell stays one", () => {
    const text = "* hello\n* how\n"
    // (The probe: the caret on the empty line the second Return left, To-do picked, words typed.)
    const made = apply(text, toggleList(text, range(text.length, 0), "todo"))
    expect(made).toBe("* hello\n* how\n- [ ] ")
    expect(positioned(made + "Are you")).toHaveLength(1)
    // ...and on an item with words: that item only.
    expect(apply(SEANS, toggleList(SEANS, range(2, 0), "numbered"))).toBe(SEANS.replace("* hello", "1. hello"))
  })

  it("split (Ctrl+D) cuts a mixed list in two, merge (Ctrl+M) makes two lists of different kinds ONE cell", () => {
    const text = "* a\n* b\n- [ ] c\n- [ ] d"
    const split = apply(text, splitCell(text, range(8, 0))!)
    expect(split).toBe("* a\n* b\n\n- [ ] c\n- [ ] d")
    expect(positioned(split)).toHaveLength(2)
    const merged = apply(split, mergeCells(split, range(0, 0))!)
    expect(merged).toBe(text)
    expect(positioned(merged)).toHaveLength(1)
  })

  it("a held mixed list copies, deletes and moves whole", () => {
    const text = "Top\n\n* a\n- [ ] b\n\nBottom"
    const cell = positioned(text)[1]!.range
    expect(copyCell(cell, text)).toBe("* a\n- [ ] b")
    expect(apply(text, deleteCell(cell, text))).toBe("Top\n\nBottom")
    expect(apply(text, moveCell(cell, false, text)!)).toBe("Top\n\nBottom\n\n* a\n- [ ] b")
    expect(apply(text, moveCell(cell, true, text)!)).toBe("* a\n- [ ] b\n\nTop\n\nBottom")
  })
})

describe("a mixed list read, exported and brought in", () => {
  it("a reading that is all list lines of several kinds is one list cell, kept as written", () => {
    expect(readingSource(["- [ ] milk", "* eggs", "1. bread"])).toBe("- [ ] milk\n* eggs\n1. bread")
    expect(positioned(readingSource(["- [ ] milk", "* eggs"])!)).toHaveLength(1)
  })

  it("on paper each item is its own kind and the numbered ones count through the list", () => {
    const html = blockHtml(blocks("* dash\n- [x] done\n1. one\n- dot\n2. two")[0]!)
    const marks = [...html.matchAll(/<span class="(mark|box)"[^>]*>(.*?)<\/span>/g)].map((m) => (m[1] === "box" ? "box" : m[2]))
    expect(marks).toEqual(["–", "box", "1.", "•", "2."])
    expect(html.match(/<div class="row">/g)).toHaveLength(5)
    // A one-kind list is drawn exactly as it was.
    expect(blockHtml(blocks("1. a\n2. b")[0]!)).toBe(blockHtml({ kind: "numbered", items: ["a", "b"] }))
  })

  it("as a Wolfram notebook: a cell per item in its own style, the numbered items counting through the list", () => {
    const render = (cell: PlannedCell): string => cell.pieces.map((piece) => (typeof piece === "string" ? piece : `<${piece.as}:${piece.job}>`)).join("")
    const cells = wolframPlan("* dash\n- [ ] box\n1. one\n  - sub\n2. two\n- dot\n3. three", { inks: {}, bands: [], column: 700 }, new Map(), "file").cells.map(render)
    expect(cells).toEqual([
      `Cell["dash", "Item", CellDingbat -> "\\:2013"]`,
      `Cell[TextData[{"\\:2610 ", "box"}], "Item"]`,
      `Cell["one", "ItemNumbered", CounterAssignments -> {{"ItemNumbered", 0}}]`,
      `Cell["sub", "Subitem"]`,
      `Cell["two", "ItemNumbered", CounterAssignments -> {{"ItemNumbered", 1}}]`,
      `Cell["dot", "Item"]`,
      `Cell["three", "ItemNumbered", CounterAssignments -> {{"ItemNumbered", 2}}]`,
    ])
  })

  it("the note reads back as one cell: what is saved is the text, and the text parses to the one list", () => {
    const saved = replacing(SEANS, range(SEANS.length, 0), "x")
    expect(positioned(saved).map((one) => one.block.kind)).toEqual(["mixed"])
  })
})
