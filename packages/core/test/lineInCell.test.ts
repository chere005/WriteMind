import { describe, expect, it } from "vitest"
import { lineInCell } from "../src/cells/lineInCell"
import { returnInBlock } from "../src/cells/preview"
import { makeTextCell, plainCells } from "../src/cells/textCells"
import { mergeCells } from "../src/cells/editing"
import { closingReturn } from "../src/cells/newline"
import { growth } from "../src/cells/growth"
import { EMPTY_LINE, emptyLineSpan, emptyLinesRead, isEmptyLine, joinedLines } from "../src/markdown/emptyLine"
import { linesOf, positioned, type PositionedBlock } from "../src/markdown/parser"
import { escapeLine, escapeLineHead, hiddenInText, plainLine, reescapePlain } from "../src/markdown/plainText"
import { hiddenInNote } from "../src/text/findVisible"
import { blockHtml } from "../src/export/blocks"
import { makeNote } from "../src/notes/note"
import { plainSearchLine } from "../src/notes/search"
import { range, type Range } from "../src/text/range"

/**
 * CTRL+ENTER, THE NEWLINE THAT NEVER LEAVES THE CELL (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the
 * current cell.."; "this should not be two separate cells"). Port-first: the Mac has no such key yet. `‸` marks the caret
 * (and `«`…`»` a selection) in the notes below. The rule is core `lineInCell`; the empty line a cell keeps is `<br>`
 * (markdown/emptyLine.ts). The editor binds the key (editor/test/lineInCell.test.ts) and e2e/suites/cells/22 and 23 press
 * it on both pages.
 */
const CARET = "‸"

const marked = (text: string): { text: string; selection: Range } => {
  if (text.includes("«")) {
    const from = text.indexOf("«")
    const to = text.indexOf("»") - 1
    return { text: text.replace("«", "").replace("»", ""), selection: range(from, to - from) }
  }
  const at = text.indexOf(CARET)
  return { text: text.replace(CARET, ""), selection: range(at, 0) }
}

/** The note after one Ctrl+Enter, the caret marked; null when the key does nothing there. */
const press = (note: string): string | null => {
  const { text, selection } = marked(note)
  const made = lineInCell(positioned(text), linesOf(text), selection)
  if (made.kind === "none") return null
  const after = text.slice(0, made.from) + made.insert + text.slice(made.to)
  return after.slice(0, made.caret) + CARET + after.slice(made.caret)
}

const cellsOf = (note: string): PositionedBlock[] => positioned(note.replace(CARET, ""))
const kinds = (note: string): string[] => cellsOf(note).map((cell) => cell.block.kind)

describe("Ctrl+Enter in a text cell", () => {
  it("at the end: a new empty line, the caret on it, the cell the one it was", () => {
    expect(press("hello‸")).toBe("hello\n<br>‸")
    expect(kinds("hello\n<br>")).toEqual(["paragraph"])
    expect(cellsOf("hello\n<br>")[0]!.range).toEqual(range(0, 10))
  })

  it("again and again: empty lines, every one of them the cell's (Return, Return would have armed the bar)", () => {
    let note = "hello‸"
    for (let i = 0; i < 3; i++) note = press(note)!
    expect(note).toBe("hello\n<br>\n<br>\n<br>‸")
    const cells = cellsOf(note)
    expect(cells.length).toBe(1)
    expect(cells[0]!.block).toEqual({ kind: "paragraph", text: "hello\n\n\n" })
  })

  it("in the middle of a line: the words after the caret go down to the new line of the same cell", () => {
    expect(press("hel‸lo")).toBe("hel\n‸lo")
    expect(press("hello\nwor‸ld\n\nnext")).toBe("hello\nwor\n‸ld\n\nnext")
    expect(kinds("hello\nwor\nld\n\nnext")).toEqual(["paragraph", "paragraph"])
  })

  it("at the start: an empty line above the words, the caret stays with them", () => {
    expect(press("‸hello")).toBe("<br>\n‸hello")
    expect(press("one\n‸two")).toBe("one\n<br>\n‸two")
    expect(kinds("<br>\nhello")).toEqual(["paragraph"])
  })

  it("on an empty line it keeps: another one under it (the caret on the line is at its end)", () => {
    expect(press("hello\n<br>‸")).toBe("hello\n<br>\n<br>‸")
    expect(press("hello\n‸<br>")).toBe("hello\n<br>\n<br>‸")
    expect(press("hello\n<br>‸\nworld")).toBe("hello\n<br>\n<br>‸\nworld")
  })

  it("with a cell below: the cell grows, the one below stays where it is, no bar", () => {
    expect(press("hello‸\n\nworld")).toBe("hello\n<br>‸\n\nworld")
    expect(kinds("hello\n<br>\n\nworld")).toEqual(["paragraph", "paragraph"])
  })

  it("the words that move down stay words: a `#` at the start of the new line is escaped", () => {
    expect(press("a ‸# b")).toBe("a \n‸\\# b")
    expect(kinds("a \n\\# b")).toEqual(["paragraph"])
    expect(press("x ‸- y")).toBe("x \n‸\\- y")
  })

  it("a selection is replaced by the newline", () => {
    expect(press("he«ll»o")).toBe("he\n‸o")
    expect(press("he«llo»")).toBe("he\n<br>‸")
  })

  it("on the line a single Return grew: that line is kept empty and the caret goes on to a new one", () => {
    expect(press("hello\n‸")).toBe("hello\n<br>\n<br>‸")
    expect(press("hello\n‸\n\nworld")).toBe("hello\n<br>\n<br>‸\n\nworld")
  })
})

describe("Ctrl+Enter in a markdown cell", () => {
  it("breaks the line at the caret and keeps the marker over the words", () => {
    expect(press("<!-- markdown -->\nsome **wo‸rds**")).toBe("<!-- markdown -->\nsome **wo\n‸rds**")
    expect(press("<!-- markdown -->\nwords‸")).toBe("<!-- markdown -->\nwords\n<br>‸")
    expect(press("<!-- markdown -->\n‸words")).toBe("<!-- markdown -->\n<br>\n‸words")
    expect(kinds("<!-- markdown -->\n<br>\nwords")).toEqual(["paragraph"])
  })

  it("the words moved to the head of a line do not become a block of their own", () => {
    expect(press("<!-- markdown -->\nx ‸# y")).toBe("<!-- markdown -->\nx \n‸\\# y")
    expect(press("<!-- markdown -->\nx ‸> y")).toBe("<!-- markdown -->\nx \n‸\\> y")
    expect(kinds("<!-- markdown -->\nx \n\\# y")).toEqual(["paragraph"])
  })

  it("its words read an empty line it keeps as an empty line", () => {
    const cell = cellsOf("<!-- markdown -->\nsome\n<br>\n**words**")[0]!
    expect(cell.block).toMatchObject({ kind: "paragraph", markdown: true, text: "some\n\n**words**" })
  })
})

describe("Ctrl+Enter in a list", () => {
  it("at the end of an item: the SAME item's next line, empty, under its words; never a new item", () => {
    expect(press("- one‸")).toBe("- one\n  <br>‸")
    expect(press("- one\n- two‸")).toBe("- one\n- two\n  <br>‸")
    expect(press("1. one‸")).toBe("1. one\n   <br>‸")
    expect(press("* one‸")).toBe("* one\n  <br>‸")
    expect(press("- [ ] one‸")).toBe("- [ ] one\n      <br>‸")
    for (const note of ["- one\n  <br>", "1. one\n   <br>", "- [ ] one\n      <br>", "* one\n  <br>"]) {
      expect(cellsOf(note).length, note).toBe(1)
    }
    expect(cellsOf("- one\n  <br>")[0]!.block).toEqual({ kind: "bullets", items: ["one\n"] })
    expect(cellsOf("- [x] one\n      <br>")[0]!.block).toEqual({ kind: "todos", items: [{ text: "one\n", done: true }] })
  })

  it("again and again, then words: all the one item", () => {
    let note = "- one‸\n- two"
    note = press(note)!
    note = press(note)!
    expect(note).toBe("- one\n  <br>\n  <br>‸\n- two")
    expect(cellsOf(note)[0]!.block).toEqual({ kind: "bullets", items: ["one\n\n", "two"] })
    expect(cellsOf("- one\n  <br>\n  more\n- two")[0]!.block).toEqual({ kind: "bullets", items: ["one\n\nmore", "two"] })
  })

  it("in the middle of an item: its words after the caret on its next line", () => {
    expect(press("- on‸e")).toBe("- on\n  ‸e")
    expect(press("- [ ] milk an‸d eggs")).toBe("- [ ] milk an\n      ‸d eggs")
    expect(cellsOf("- [ ] milk an\n      d eggs")[0]!.block).toEqual({ kind: "todos", items: [{ text: "milk an\nd eggs", done: false }] })
  })

  it("at the start of an item's words: the item's first line is kept empty, the words under it", () => {
    expect(press("- ‸one")).toBe("- <br>\n  ‸one")
    expect(press("‸- one")).toBe("- <br>\n  ‸one")
    expect(kinds("- <br>\n  one")).toEqual(["bullets"])
  })

  it("on an item's empty line: another under it (no marker is taken off, the cell does not end)", () => {
    expect(press("- one\n  <br>‸")).toBe("- one\n  <br>\n  <br>‸")
    expect(press("- one\n- ‸")).toBe("- one\n- <br>\n  <br>‸")
  })

  it("the words that move down stay the item's words: never a nested item", () => {
    expect(press("- a ‸- b")).toBe("- a \n  ‸\\- b")
    expect(press("1. a ‸2. b")).toBe("1. a \n   ‸2\\. b")
    expect(kinds("- a \n  \\- b")).toEqual(["bullets"])
  })

  it("on the line a single Return grew under the list (an empty item's marker taken off): kept, and one more", () => {
    expect(press("- one\n‸")).toBe("- one\n  <br>\n  <br>‸")
    expect(kinds("- one\n  <br>\n  <br>")).toEqual(["bullets"])
  })
})

describe("Ctrl+Enter in a quote", () => {
  it("a new line of the quote, the caret after its `> `; an empty quote line is the quote's own empty line", () => {
    expect(press("> a‸")).toBe("> a\n> ‸")
    expect(press("> a\n> ‸")).toBe("> a\n> \n> ‸")
    expect(press("> a‸b")).toBe("> a\n> ‸b")
    expect(kinds("> a\n> \n> ")).toEqual(["quote"])
    expect(cellsOf("> a\n>\n> b")[0]!.block).toEqual({ kind: "quote", text: "a\n\nb" })
    expect(press("> a\n‸")).toBe("> a\n> \n> ‸")
  })
})

describe("Ctrl+Enter in a fence is a plain newline, inside the fence", () => {
  it("in the code", () => {
    expect(press("```\nx‸\n```")).toBe("```\nx\n‸\n```")
    expect(press("```py\nif a:\n    b‸\n```")).toBe("```py\nif a:\n    b\n‸\n```")
    expect(press("```wl\nx^2‸\n```")).toBe("```wl\nx^2\n‸\n```")
  })

  it("on the opening fence: the first line of the code; on the closing one: the last", () => {
    expect(press("```py‸\nx\n```")).toBe("```py\n‸\nx\n```")
    expect(press("```\nx\n```‸")).toBe("```\nx\n‸\n```")
    expect(press("```\nx\n‸```")).toBe("```\nx\n‸\n```")
    expect(kinds("```\nx\n\n```")).toEqual(["code"])
  })

  it("a selection that takes a fence line does nothing", () => {
    expect(press("```\n«x\n```»")).toBeNull()
    expect(press("```\n«x»\n```")).toBe("```\n\n‸\n```")
  })
})

describe("Ctrl+Enter where a cell is one line, and where there is no cell", () => {
  it("a heading, a rule, a table: nothing (a second line would be a second cell)", () => {
    expect(press("# Ti‸tle")).toBeNull()
    expect(press("# Title‸")).toBeNull()
    expect(press("---‸")).toBeNull()
    const table = "| a | b |\n|---|---|\n| 1 | 2 |"
    const made = lineInCell(positioned(table), linesOf(table), range(table.length - 3, 0))
    expect(made.kind).toBe("none")
    expect(press("# Title\n‸")).toBeNull()
  })

  it("between two cells, or in an empty note: nothing", () => {
    expect(press("a\n‸\nb")).toBeNull()
    expect(press("‸")).toBeNull()
    expect(press("a\n\n‸\n\nb")).toBeNull()
  })
})

describe("the empty line a cell keeps", () => {
  it("is `<br>` alone on its line, after a list item's head; any spelling of it reads the same", () => {
    expect(EMPTY_LINE).toBe("<br>")
    expect(emptyLineSpan("<br>")).toEqual([0, 4])
    expect(emptyLineSpan("  <br>  ")).toEqual([2, 6])
    expect(emptyLineSpan("- <br>")).toEqual([2, 6])
    expect(emptyLineSpan("- [ ] <br>")).toEqual([6, 10])
    expect(emptyLineSpan("12. <BR/>")).toEqual([4, 9])
    expect(emptyLineSpan("<br />")).toEqual([0, 6])
    for (const not of ["", "br", "a<br>", "<br>a", "\\<br>", "# <br>", "> <br>", "<br><br>", "-<br>"]) expect(isEmptyLine(not), not).toBe(false)
    expect(emptyLinesRead("a\n  <br>\nb")).toBe("a\n  \nb")
    expect(joinedLines(["a", "b"])).toBe("a b")
    expect(joinedLines(["a", "<br>", "b", "c", ""])).toBe("a\n\nb c\n")
  })

  it("is hidden whole in a text cell, which reads it as an empty line", () => {
    expect(hiddenInText("<br>")).toEqual([[0, 4]])
    expect(plainLine("<br>")).toBe("")
    expect(cellsOf("a\n<br>\nb")[0]!.block).toEqual({ kind: "paragraph", text: "a\n\nb" })
    // Find looks through it: nothing of it is there to be found on the page.
    const text = "a\n<br>\nb\n\n- x\n  <br>\n\n<!-- markdown -->\ny\n<br>"
    const hidden = hiddenInNote(text, positioned(text))
    for (const at of [text.indexOf("<br>"), text.indexOf("  <br>") + 2, text.lastIndexOf("<br>")]) {
      expect(hidden.some(([from, to]) => from === at && to === at + 4), String(at)).toBe(true)
    }
  })

  it("is never what typing writes: a `<br>` typed into a text cell is written escaped, and reads as the words", () => {
    expect(escapeLine("<br>")).toBe("\\<br>")
    expect(cellsOf("a\n\\<br>\nb")[0]!.block).toEqual({ kind: "paragraph", text: "a\n<br>\nb" })
    expect(isEmptyLine("\\<br>")).toBe(false)
  })

  it("stays one when a text cell is taken apart and written again (reescapePlain), and a typed `<br>` stays words", () => {
    expect(reescapePlain("a\n<br>\n\\<br>\n\\# b")).toBe("a\n<br>\n\\<br>\n\\# b")
  })

  it("survives Return on the rendered page splitting a text cell", () => {
    const text = "one\n<br>\ntwo three"
    const change = returnInBlock(text, range(text.indexOf(" three"), 0))!
    const after = text.slice(0, change.range.location) + change.replacement + text.slice(change.range.location + change.range.length)
    expect(after).toBe("one\n<br>\ntwo\n\nthree")
  })

  it("survives Ctrl+7 (a markdown cell made a text cell) and a markdown cell merged into a text cell", () => {
    const md = "<!-- markdown -->\n**a**\n<br>\nb"
    const made = makeTextCell(md, range(md.length, 0))!
    expect(made.replacement).toBe("a\n<br>\nb")
    const two = "x\n\n<!-- markdown -->\ny\n<br>"
    const merged = mergeCells(two, range(0, 0))!
    const after = two.slice(0, merged.range.location) + merged.replacement + two.slice(merged.range.location + merged.range.length)
    expect(after).toBe("x\ny\n<br>")
    expect(kinds(after)).toEqual(["paragraph"])
  })

  it("is copied out of a text cell as the empty line it is", () => {
    expect(plainCells("a\n<br>\nb")).toBe("a\n\nb")
  })

  it("is not the line a single Return grows, and Return after it grows the cell as after any line", () => {
    const text = "hello\n<br>\n"
    expect(growth(positioned(text), linesOf(text), range(text.length, 0))).toEqual({ index: 0, line: range(text.length, 0) })
    expect(growth(positioned("hello\n<br>"), linesOf("hello\n<br>"), range(10, 0))).toBeNull()
    expect(closingReturn(positioned(text), linesOf(text), range(text.length, 0))).toMatchObject({ index: 0, below: true })
  })

  it("is no words in the sidebar's line under a note's title, nor in Search Notes", () => {
    expect(makeNote("/n/a.wm", 0, "# T\n\nhello\n<br>\nworld").snippet).toBe("hello · world")
    expect(makeNote("/n/a.wm", 0, "- one\n  <br>\n  two").snippet).toBe("one · two")
    for (const line of ["<br>", "  <br>", "- <br>"]) expect(plainSearchLine(line), line).toBeNull()
    expect(plainSearchLine("\\<br>")).toBe("<br>")
  })

  it("is printed as an empty line (the PDF): a text cell's, a markdown cell's, a list item's, a quote's", () => {
    const html = (note: string) => blockHtml(positioned(note)[0]!.block)
    expect(html("a\n<br>\nb")).toContain("a\n\nb")
    expect(html("<!-- markdown -->\na\n<br>\nb")).toContain("a\n\nb")
    expect(html("- a\n  <br>\n  b")).toContain("a\n\nb")
    expect(html("- <br>\n  b")).not.toContain("&lt;br")
    expect(html("> a\n>\n> b")).toContain("a\n\nb")
  })
})

describe("the parser reads a list item's next lines as the item's (CommonMark's continuation lines)", () => {
  it("an indented line under an item, or an empty line kept, carries the item on", () => {
    expect(cellsOf("- a\n  b")[0]!.block).toEqual({ kind: "bullets", items: ["a\nb"] })
    expect(cellsOf("1. a\n   b\n2. c")[0]!.block).toEqual({ kind: "numbered", items: ["a\nb", "c"] })
    expect(cellsOf("- a\n<br>")[0]!.block).toEqual({ kind: "bullets", items: ["a\n"] })
    expect(kinds("- a\n  b")).toEqual(["bullets"])
  })

  it("a line that is not indented is still a cell of its own, and an indented item is still an item", () => {
    expect(kinds("- a\nb")).toEqual(["bullets", "paragraph"])
    expect(cellsOf("- a\n  - b")[0]!.block).toEqual({ kind: "bullets", items: ["a", "b"] })
    expect(kinds("- a\n  # b")).toEqual(["bullets", "heading"])
    expect(kinds("- a\n  > b")).toEqual(["bullets", "quote"])
  })

  it("escapeLineHead escapes only what would open a block", () => {
    expect(escapeLineHead("# a")).toBe("\\# a")
    expect(escapeLineHead("  - a")).toBe("  \\- a")
    expect(escapeLineHead("3. a")).toBe("3\\. a")
    expect(escapeLineHead("a *b*")).toBe("a *b*")
    expect(escapeLineHead("\\# a")).toBe("\\# a")
  })
})
