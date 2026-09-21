import { describe, expect, it } from "vitest"
import { positioned } from "../src/markdown/parser"
import { apply } from "../src/markdown/formatting"
import {
  anchor, between, cellAt, cellFromSeam, cellsOf, covers, holds, picked, toggling,
  type Span,
} from "../src/cells/selection"
import {
  blockContaining, expand, insertBlock, listContinuation, mergeCells, removeBlock,
  splitCell, tidied,
} from "../src/cells/editing"
import { cellDepth, hiddenRanges, moveSection, sections } from "../src/cells/outline"
import { openCell } from "../src/cells/types"
import { range, substring } from "../src/text/range"

const note = "First cell\n\nSecond cell\n\nThird cell"
const cells = () => positioned(note).map((block) => block.range)

/** Three cells, each 20 points tall with an 8-point seam between them. */
const stack = (): Span[] => [
  { top: 20, bottom: 40, range: cells()[0]! },
  { top: 48, bottom: 68, range: cells()[1]! },
  { top: 76, bottom: 96, range: cells()[2]! },
]

/** Transcribed from `WriteMindTests/CellSelectionTests.swift`. */
describe("an outer bracket holds the cells inside it", () => {
  const sectioned = "# Head\n\nOne\n\nTwo\n\n# Next\n\nThree"
  const sectionedCells = () => positioned(sectioned).map((block) => block.range)
  const firstSection = () => sections(sectioned)[0]!.range

  it("stands for every cell under the heading", () => {
    const held = cellsOf(firstSection(), sectionedCells())
    expect(held).toHaveLength(3)
    expect(held[0]).toEqual(sectionedCells()[0])
  })

  it("stands for itself and nothing else on a plain cell", () => {
    const one = sectionedCells()[1]!
    expect(cellsOf(one, sectionedCells())).toEqual([one])
  })

  it("answers with itself when it holds no whole cell", () => {
    const half = range(1, 2)
    expect(cellsOf(half, sectionedCells())).toEqual([half])
  })

  it("lights every bracket inside it and none after it", () => {
    const held = cellsOf(firstSection(), sectionedCells())
    for (const cell of held) expect(covers(cell, held)).toBe(true)
    expect(covers(sectionedCells().at(-1)!, held)).toBe(false)
  })

  it("takes a nested section with its parent", () => {
    const nested = "# Outer\n\nOne\n\n## Inner\n\nTwo"
    const all = positioned(nested).map((block) => block.range)
    const outer = sections(nested).find((section) => section.depth === 0)!
    expect(cellsOf(outer.range, all)).toHaveLength(all.length)
  })

  it("is held when every cell under it is", () => {
    const all = sectionedCells()
    const inside = cellsOf(firstSection(), all)
    expect(holds(firstSection(), all, inside)).toBe(true)
    expect(holds(firstSection(), all, inside.slice(0, 2))).toBe(false)
  })
})

describe("dragging a bar up or down", () => {
  it("starts on the cell below when the drag goes down", () => {
    expect(cellFromSeam(44, true, stack())).toEqual(cells()[1])
  })

  it("starts on the cell above when it goes up", () => {
    expect(cellFromSeam(44, false, stack())).toEqual(cells()[0])
  })

  it("takes the first cell at the top of the note and the last at the bottom", () => {
    expect(cellFromSeam(10, false, stack())).toEqual(cells()[0])
    expect(cellFromSeam(400, true, stack())).toEqual(cells()[2])
  })

  it("has nothing to drag to in a note with no cells", () => {
    expect(cellFromSeam(44, true, [])).toBeNull()
  })

  it("takes both cells on a drag from a bar down two", () => {
    const from = cellFromSeam(44, true, stack())!
    const over = cellAt(90, stack())!
    expect(between(from, over, cells())).toEqual([cells()[1], cells()[2]])
  })

  it("reads spans out of order top to bottom all the same", () => {
    expect(cellFromSeam(44, true, [...stack()].reverse())).toEqual(cells()[1])
  })
})

describe("what lights a bracket", () => {
  it("takes one range over the whole cell", () => {
    expect(covers(cells()[1]!, [cells()[1]!])).toBe(true)
    expect(covers(cells()[1]!, [range(0, 40)])).toBe(true)
    expect(covers(cells()[1]!, [range(12, 4)])).toBe(false)
  })

  it("does not pick the section round two cells picked separately", () => {
    const selection = [cells()[0]!, cells()[1]!]
    const section = range(cells()[0]!.location, cells()[1]!.location + cells()[1]!.length - cells()[0]!.location)
    expect(covers(cells()[0]!, selection)).toBe(true)
    expect(covers(cells()[1]!, selection)).toBe(true)
    expect(covers(section, selection)).toBe(false)
  })

  it("lists the picked cells in the note's order", () => {
    expect(picked(cells(), [cells()[2]!, cells()[0]!])).toEqual([cells()[0], cells()[2]])
    expect(picked(cells(), [range(2, 0)])).toEqual([])
  })
})

describe("shift, and the drag", () => {
  it("reaches every cell between the two", () => {
    expect(between(cells()[0]!, cells()[2]!, cells())).toEqual(cells())
    expect(between(cells()[2]!, cells()[0]!, cells())).toEqual(cells())
    expect(between(cells()[1]!, cells()[1]!, cells())).toEqual([cells()[1]])
  })

  it("still reaches the cell clicked from a range that is not one", () => {
    expect(between(range(900, 4), cells()[1]!, cells())).toEqual([cells()[1]])
  })

  it("drops an anchor that no longer names a bracket", () => {
    expect(anchor(cells()[1]!, cells())).toEqual(cells()[1])
    expect(anchor(range(13, 12), cells())).toBeNull()
    expect(anchor(null, cells())).toBeNull()
  })

  it("would have reached the wrong run with a stale anchor", () => {
    const stale = range(13, 12)
    expect(between(stale, cells()[2]!, cells())).toHaveLength(2)
    expect(between(anchor(stale, cells()) ?? cells()[2]!, cells()[2]!, cells())).toEqual([cells()[2]])
  })

  it("toggles a cell out and back in", () => {
    const both = toggling(cells()[2]!, [cells()[0]!])
    expect(both).toEqual([cells()[0], cells()[2]])
    expect(toggling(cells()[0]!, both)).toEqual([cells()[2]])
  })
})

describe("which bracket the pointer is on", () => {
  const spans: Span[] = [
    { top: 0, bottom: 20, range: range(0, 10) },
    { top: 30, bottom: 50, range: range(12, 11) },
  ]

  it("answers with the cell the pointer is inside", () => {
    expect(cellAt(10, spans)).toEqual(spans[0]!.range)
    expect(cellAt(40, spans)).toEqual(spans[1]!.range)
  })

  it("takes the nearer one over the space between two cells", () => {
    expect(cellAt(24, spans)).toEqual(spans[0]!.range)
    expect(cellAt(27, spans)).toEqual(spans[1]!.range)
    expect(cellAt(900, spans)).toEqual(spans[1]!.range)
  })

  it("has no cell to drag over on an empty page", () => {
    expect(cellAt(10, [])).toBeNull()
  })
})

/** Transcribed from `WriteMindTests/NotebookCellTests.swift` and its neighbours. */
describe("splitting and merging", () => {
  it("cuts a cell in two at the caret and leaves the bar between the halves", () => {
    const text = "one two"
    const change = splitCell(text, range(3, 0))!
    expect(apply(text, change)).toBe("one\n\ntwo")
    // The caret lands on the blank line, which is the seam.
    expect(change.selection.location).toBe(4)
  })

  it("adds no spurious newline when the cut is at a line boundary", () => {
    const text = "One\ntwo"
    const change = splitCell(text, range(3, 0))!
    expect(apply(text, change)).toBe("One\n\ntwo")
  })

  it("does nothing at either end of a cell or inside a fence", () => {
    expect(splitCell("one", range(0, 0))).toBeNull()
    expect(splitCell("one", range(3, 0))).toBeNull()
    expect(splitCell("```\na b\n```", range(5, 0))).toBeNull()
  })

  it("joins a cell to the one below it", () => {
    const text = "one\n\ntwo"
    const change = mergeCells(text, range(1, 0))!
    expect(apply(text, change)).toBe("one\ntwo")
  })

  it("will not let a heading take another cell's words", () => {
    expect(mergeCells("# Head\n\nbody", range(1, 0))).toBeNull()
  })
})

describe("growing the selection", () => {
  it("takes the word, then the cell, then the section, then the note", () => {
    const text = "# Head\n\nOne two\n\nThree"
    const word = expand(range(9, 0), text)!
    expect(substring(text, word)).toBe("One")
    const cell = expand(word, text)!
    expect(substring(text, cell)).toBe("One two")
    const section = expand(cell, text)!
    expect(substring(text, section)).toBe(text)
  })
})

describe("one blank line between two cells", () => {
  it("squeezes a run of them back to one", () => {
    expect(tidied("a\n\n\n\nb", 0)?.text).toBe("a\n\nb")
  })

  it("keeps the caret's own blank line, which is the cell being typed into", () => {
    const out = tidied("a\n\n\n\nb", 3)
    expect(out?.text).toBe("a\n\n\nb")
  })

  it("leaves blank lines inside a fence alone", () => {
    expect(tidied("```\n\n\n\n```", 0)).toBeNull()
  })

  it("has nothing to do on an ordinary note", () => {
    expect(tidied("a\n\nb", 0)).toBeNull()
  })
})

/** Transcribed from `WriteMindTests/PreviewEditingTests.swift`. */
describe("opening and removing a cell", () => {
  it("puts the blank lines a new cell needs on both sides", () => {
    const out = insertBlock("# Title\n\nBody", 9)
    expect(out.markdown).toBe("# Title\n\n\n\nBody")
    expect(out.caret).toBe(9)
    const at = insertBlock("Body", 4)
    expect(at.markdown).toBe("Body\n\n")
    expect(at.caret).toBe(6)
    const start = insertBlock("Body", 0)
    expect(start.markdown).toBe("\n\nBody")
    expect(start.caret).toBe(0)
    expect(insertBlock("", 0)).toEqual({ markdown: "", caret: 0 })
  })

  it("keeps every one of the empty lines of a blank cell beside it", () => {
    // The newlines after the caret are that cell's own content, not the
    // blank line this cell needs under it. Reading them as the separator
    // left the eight-line cell a six-line one.
    const note = "baz\n" + "\n".repeat(10) + "# asdf"
    const out = insertBlock(note, 5)
    expect(out.caret).toBe(5)
    const typed = out.markdown.slice(0, out.caret) + "x" + out.markdown.slice(out.caret)
    expect(positioned(typed).map(({ block }) => block.kind === "blank" ? `blank(${block.lines})` : block.kind))
      .toEqual(["paragraph", "paragraph", "blank(8)", "heading"])
  })

  it("takes the blank lines with a removed cell", () => {
    const out = removeBlock("a\n\nb\n\nc", range(3, 1))
    expect(out.markdown).toBe("a\n\nc")
  })

  it("carries a list on and ends it on an empty item", () => {
    expect(listContinuation("- milk")).toBe("- ")
    expect(listContinuation("  * [ ] milk")).toBe("  * [ ] ")
    expect(listContinuation("- [x] milk")).toBe("- [ ] ")
    expect(listContinuation("- [ ] ")).toBe("")
    expect(listContinuation("1. one")).toBe("2. ")
    expect(listContinuation("plain")).toBeNull()
  })

  it("finds the block a character is in", () => {
    expect(blockContaining(0, note)?.range).toEqual(cells()[0])
    expect(blockContaining(13, note)?.range).toEqual(cells()[1])
  })
})

/** Transcribed from `WriteMindTests/CellTypeTests.swift`. */
describe("the + on the bar chooses a kind", () => {
  it("opens a plain cell for text", () => {
    const out = openCell({ kind: "text" }, "a", 1, "x")
    expect(out.markdown).toBe("a\n\nx")
  })

  it("writes the marker and puts the caret after it", () => {
    const heading = openCell({ kind: "heading", level: 3 }, "a", 1, "x")
    expect(heading.markdown).toBe("a\n\n### x")
    const list = openCell({ kind: "list", style: "todo" }, "a", 1, "x")
    expect(list.markdown).toBe("a\n\n- [ ] x")
    const quote = openCell({ kind: "quote" }, "a", 1, "x")
    expect(quote.markdown).toBe("a\n\n> x")
  })

  it("opens a fenced block with the words inside it", () => {
    const code = openCell({ kind: "code" }, "a", 1, "x")
    expect(code.markdown).toBe("a\n\n```\nx\n```")
  })
})

/** Transcribed from `WriteMindTests/NotebookOutlineTests.swift`. */
describe("the outline", () => {
  const nested = "# One\n\nbody\n\n## Two\n\nmore\n\n# Three\n\nlast"

  it("reads every heading with its depth", () => {
    const found = sections(nested)
    expect(found.map((section) => section.title)).toEqual(["One", "Two", "Three"])
    expect(found.map((section) => section.depth)).toEqual([0, 1, 0])
  })

  it("gives a repeated title an ordinal so the fold state can be remembered", () => {
    const found = sections("# A\n\nx\n\n# A\n\ny")
    expect(found.map((section) => section.key)).toEqual(["A", "A#2"])
  })

  it("does not read a hash inside a fence as a heading", () => {
    expect(sections("```\n# not a heading\n```")).toEqual([])
  })

  it("draws a cell one step inside the section that holds it", () => {
    const found = sections(nested)
    expect(cellDepth(0, found)).toBe(1)
    expect(cellDepth(nested.indexOf("more"), found)).toBe(2)
  })

  it("hides a closed section's body and nothing else", () => {
    const hidden = hiddenRanges(nested, new Set(["Two"]))
    expect(hidden).toHaveLength(1)
    expect(substring(nested, hidden[0]!)).toContain("more")
    expect(substring(nested, hidden[0]!)).not.toContain("Three")
  })

  it("moves a section with everything nested in it", () => {
    const change = moveSection(nested, range(nested.indexOf("Three"), 0), true)!
    expect(apply(nested, change).startsWith("# Three")).toBe(true)
  })
})
