// Port-only: no XCTest (the Mac has no Ctrl+Enter yet). THE REVIEW OF agent/ctrlenter, 2026-10-11 (Sean: "ctrl + enter adds
// a newline without leaving the current cell.."; "this should not be two separate cells"): the lines Ctrl+Enter makes have to
// survive the keys and the readers that come after it. Each block is one finding (P1, P2, P3 as the review numbered them).
// `‸` marks the caret (and `«`…`»` a selection). The keys on both pages are e2e/suites/cells/22 and 23 (_ctrlEnter.mjs).
import { describe, expect, it } from "vitest"
import { lineInCell } from "../src/cells/lineInCell"
import { backspaceInItem, deleteInItem, itemOfLine, returnInItem, type ItemEdit } from "../src/cells/itemLines"
import { returnInBlock } from "../src/cells/preview"
import { splitCell, mergeCells } from "../src/cells/editing"
import { makeTextCell } from "../src/cells/textCells"
import { lineBreakSpan, emptyLineSpan, joinedLines, emptyLinesRead } from "../src/markdown/emptyLine"
import { linesOf, positioned } from "../src/markdown/parser"
import { toggleList, toggleQuote } from "../src/markdown/formatting"
import { hiddenInText, plainLine, reescapePlain } from "../src/markdown/plainText"
import { blockHtml } from "../src/export/blocks"
import { wolframPlan } from "../src/export/wolfram/plan"
import { hiddenInNote } from "../src/text/findVisible"
import { plainSearchLine } from "../src/notes/search"
import { makeNote } from "../src/notes/note"
import { range, type Edit, type Range } from "../src/text/range"

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
const withCaret = (text: string, caret: number): string => text.slice(0, caret) + CARET + text.slice(caret)
const applied = (text: string, made: ItemEdit | null): string | null =>
  made === null ? null : withCaret(text.slice(0, made.from) + made.insert + text.slice(made.to), made.caret)
const appliedEdit = (text: string, change: Edit | null): string | null =>
  change === null ? null
    : withCaret(text.slice(0, change.range.location) + change.replacement + text.slice(change.range.location + change.range.length), change.selection.location)

/** Ctrl+Enter (core `lineInCell`). */
const ctrlEnter = (note: string): string => {
  const { text, selection } = marked(note)
  const made = lineInCell(positioned(text), linesOf(text), selection)
  if (made.kind === "none") throw new Error("nothing written: " + note)
  return withCaret(text.slice(0, made.from) + made.insert + text.slice(made.to), made.caret)
}
/** Return as the markdown side's `carryTheListOn` asks it first (core `returnInItem`); null: not this rule's. */
const returnKey = (note: string): string | null => {
  const { text, selection } = marked(note)
  return applied(text, returnInItem(positioned(text), linesOf(text), selection))
}
/** Return on the rendered page (core `returnInBlock`, which asks `returnInItem` first). */
const returnRendered = (note: string): string | null => {
  const { text, selection } = marked(note)
  return appliedEdit(text, returnInBlock(text, selection))
}
const backspace = (note: string): string | null => {
  const { text, selection } = marked(note)
  return applied(text, backspaceInItem(positioned(text), linesOf(text), selection))
}
const deleteKey = (note: string): string | null => {
  const { text, selection } = marked(note)
  return applied(text, deleteInItem(positioned(text), linesOf(text), selection))
}
const typed = (note: string, words: string): string => {
  const at = note.indexOf(CARET)
  return note.slice(0, at) + words + CARET + note.slice(at + 1)
}
const kinds = (note: string): string[] => positioned(note.replace(CARET, "")).map((cell) => cell.block.kind)
const html = (note: string): string => blockHtml(positioned(note)[0]!.block)
const wolfram = (note: string): string[] =>
  wolframPlan(note, { inks: {}, bands: [], column: 700 }, new Map(), "file").cells
    .map((cell) => cell.pieces.map((piece) => (typeof piece === "string" ? piece : "")).join(""))

describe("P1: in a markdown cell or a quote the line Ctrl+Enter makes is a line on the rendered page, in the PDF and in Wolfram", () => {
  it("a markdown cell: Ctrl+Enter, words typed — two lines, not one", () => {
    const note = typed(ctrlEnter("<!-- markdown -->\n**first** markdown line‸"), "second markdown line").replace(CARET, "")
    expect(note).toBe("<!-- markdown -->\n**first** markdown line\n<br>second markdown line")
    expect(positioned(note)[0]!.block).toMatchObject({ text: "**first** markdown line\nsecond markdown line" })
    expect(html(note)).toContain("markdown line\nsecond markdown line")
    expect(wolfram(note).join("")).toContain("\\nsecond markdown line")
  })

  it("a quote: Ctrl+Enter, words typed — two lines, not one", () => {
    const note = typed(ctrlEnter("> first quote line‸"), "second quote line").replace(CARET, "")
    expect(note).toBe("> first quote line\n> <br>second quote line")
    expect(positioned(note)[0]!.block).toEqual({ kind: "quote", text: "first quote line\nsecond quote line" })
    expect(html(note)).toContain("first quote line\nsecond quote line")
    expect(wolfram(note).join("")).toContain("first quote line\\nsecond quote line")
  })

  it("a `<br>` at a line's head starts it afresh (`lineBreakSpan`); alone, it is the empty line (`emptyLineSpan`)", () => {
    expect(lineBreakSpan("<br>words")).toEqual([0, 4])
    expect(lineBreakSpan("> <br>words")).toEqual([2, 6])
    expect(lineBreakSpan("  <BR/>x")).toEqual([2, 7])
    expect(lineBreakSpan("words<br>")).toBeNull()
    expect(lineBreakSpan("\\<br>words")).toBeNull()
    expect(emptyLineSpan("<br>words")).toBeNull()
    expect(joinedLines(["a", "<br>b", "c", "<br>", "<br>d"])).toBe("a\nb c\n\nd")
    expect(emptyLinesRead("a\n<br>b\n  <br>")).toBe("a\nb\n  ")
  })

  it("Find, Search Notes and the sidebar's line read its words without the tag", () => {
    const note = "<!-- markdown -->\nfirst\n<br>second\n\n> qa\n> <br>qb"
    const hidden = hiddenInNote(note, positioned(note))
    for (const at of [note.indexOf("<br>second"), note.indexOf("<br>qb")]) {
      expect(hidden.some(([from, to]) => from === at && to === at + 4), String(at)).toBe(true)
    }
    expect(plainSearchLine("<br>second words")).toBe("second words")
    expect(makeNote("/n/a.wm", 0, "<!-- markdown -->\nfirst\n<br>second").snippet).toBe("first · second")
  })

  it("a markdown cell made a text cell, merged into one, or a quote taken off: the line is a text cell's line, the tag gone", () => {
    const md = "<!-- markdown -->\nfirst\n<br>second\n<br>"
    expect(makeTextCell(md, range(md.length, 0))!.replacement).toBe("first\nsecond\n<br>")
    const two = "x\n\n<!-- markdown -->\ny\n<br>z"
    expect(appliedEdit(two, mergeCells(two, range(0, 0)))!.replace(CARET, "")).toBe("x\ny\nz")
    const quote = "> a\n> <br>b"
    const unquoted = appliedEdit(quote, toggleQuote(quote, range(0, quote.length)))!.replace(CARET, "")
    expect(unquoted).toBe("a\n<br>b")
    // In a text cell the tag is hidden (every line there is a line), and read as nothing.
    expect(hiddenInText("<br>b")).toEqual([[0, 4]])
    expect(plainLine("<br>b")).toBe("b")
    expect(positioned(unquoted)[0]!.block).toEqual({ kind: "paragraph", text: "a\nb" })
    expect(reescapePlain("<br>b #c")).toBe("b #c")
    // A list made of it: an item is a line of its own already.
    const listed = toggleList("<!-- markdown -->\nfirst\n<br>second", range(18, 5 + 1 + 10), "dots")
    expect(listed.replacement).toBe("- first\n- second")
  })
})

describe("P1: Return after Ctrl+Enter in a list carries the list on (3.9.0: \"Return on a list item adds another item\")", () => {
  it("at the end of a middle item's empty line: the next item after it, never a line of white space, one cell, no bar", () => {
    let note = ctrlEnter("- one‸\n- two\n- three")
    expect(note).toBe("- one\n  <br>‸\n- two\n- three")
    note = returnKey(note)!
    expect(note).toBe("- one\n  <br>\n- ‸\n- two\n- three")
    expect(kinds(note)).toEqual(["bullets"])
    expect(returnRendered("- one\n  <br>‸\n- two\n- three")).toBe(note)
  })

  it("at the end of a middle item's line of words: the next number", () => {
    expect(ctrlEnter("1. one‸\n2. two")).toBe("1. one\n   <br>‸\n2. two")
    // (Typed on, the line is words: the editor takes the `<br>` off in the same step, editor lineInCell.test.ts.)
    const note = "1. one\n   more‸\n2. two"
    expect(returnKey(note)).toBe("1. one\n   more\n2. ‸\n2. two")
    expect(kinds("1. one\n   more\n2. \n2. two")).toEqual(["numbered"])
    expect(returnRendered(note)).toBe("1. one\n   more\n2. ‸\n2. two")
  })

  it("on the last item: a new bullet, not more lines of item one", () => {
    expect(ctrlEnter("- one‸")).toBe("- one\n  <br>‸")
    const note = "- one\n  detail‸"
    expect(returnKey(note)).toBe("- one\n  detail\n- ‸")
    expect(returnRendered(note)).toBe("- one\n  detail\n- ‸")
    // and typed on: item two
    expect(positioned("- one\n  detail\n- two")[0]!.block).toEqual({ kind: "bullets", items: ["one\ndetail", "two"] })
    // a to-do carries on unticked
    expect(returnKey("- [x] milk\n      eggs‸")).toBe("- [x] milk\n      eggs\n- [ ] ‸")
  })

  it("at the end of an item's own line with next lines under it: the new item goes after them (the review's P3 f)", () => {
    expect(returnKey("- one‸\n  more\n- two")).toBe("- one\n  more\n- ‸\n- two")
    expect(returnRendered("- one‸\n  more\n- two")).toBe("- one\n  more\n- ‸\n- two")
  })

  it("at the start of a next line's words: that line is the next item", () => {
    expect(returnKey("- one\n  ‸more\n- two")).toBe("- one\n- ‸more\n- two")
    expect(returnRendered("- one\n  ‸more\n- two")).toBe("- one\n- ‸more\n- two")
  })

  it("is nobody's where there are no next lines, or in the middle of a line's words (the list's own Return answers)", () => {
    expect(returnKey("- one‸\n- two")).toBeNull()
    expect(returnKey("- o‸ne\n  more")).toBeNull()
    expect(returnKey("- one\n  mo‸re")).toBeNull()
    expect(returnKey("hello‸\nworld")).toBeNull()
  })

  it("the item a line belongs to: its own line and its last next line", () => {
    const text = "- a\n  - b\n    more\n    <br>\n- c"
    expect(itemOfLine(positioned(text), linesOf(text), 3)).toMatchObject({ first: 2, last: 4 })
    expect(itemOfLine(positioned(text), linesOf(text), 1)).toMatchObject({ first: 1, last: 1 })
  })
})

describe("P2: Backspace at the start of an item's next line joins it to the line above (no outdent, no split list)", () => {
  it("bullets, numbers, a to-do: one Backspace joins the words", () => {
    expect(backspace("- one\n  ‸more\n- two")).toBe("- one‸more\n- two")
    expect(backspace("- one\n ‸ more\n- two")).toBe("- one‸more\n- two")
    expect(backspace("- one\n‸  more\n- two")).toBe("- one‸more\n- two")
    expect(backspace("1. one\n   ‸more")).toBe("1. one‸more")
    expect(backspace("- [ ] milk\n      ‸eggs")).toBe("- [ ] milk‸eggs")
    expect(kinds("- onemore\n- two")).toEqual(["bullets"])
  })

  it("onto an empty line the item keeps: the words take its place", () => {
    expect(backspace("- one\n  <br>\n  ‸more")).toBe("- one\n  ‸more")
    expect(backspace("- <br>\n  ‸more")).toBe("- ‸more")
  })

  it("is nobody's in the middle of the words, on an item's own line, or outside a list", () => {
    expect(backspace("- one\n  mo‸re")).toBeNull()
    expect(backspace("- one\n- ‸two")).toBeNull()
    expect(backspace("one\n  ‸more")).toBeNull()
  })

  it("Delete at the end of the line above is the same join", () => {
    expect(deleteKey("- one‸\n  more\n- two")).toBe("- one‸more\n- two")
    expect(deleteKey("- one‸\n- two")).toBeNull()
  })
})

describe("P2: the List key over a selected list keeps an item's next lines the item's", () => {
  const all = (text: string) => range(0, text.length)
  it("swapping the kind re-indents them under the new marker; they never become items", () => {
    const text = "- one\n  more\n- two"
    expect(toggleList(text, all(text), "numbered").replacement).toBe("1. one\n   more\n2. two")
    expect(toggleList(text, all(text), "todo").replacement).toBe("- [ ] one\n      more\n- [ ] two")
    expect(toggleList("1. one\n   more\n   <br>\n2. two", all("1. one\n   more\n   <br>\n2. two"), "dots").replacement)
      .toBe("- one\n  more\n  <br>\n- two")
    expect(positioned("1. one\n   more\n2. two")[0]!.block).toEqual({ kind: "numbered", items: ["one\nmore", "two"] })
  })

  it("toggled off: the item's words and its next lines are a paragraph's lines", () => {
    const text = "- one\n  more\n- two"
    expect(toggleList(text, all(text), "dots").replacement).toBe("one\nmore\ntwo")
  })

  it("a caret on an item's next line takes the whole item, and the caret stays where it was in the words", () => {
    const text = "- one\n  more‸"
    const { text: plain, selection } = marked(text)
    const change = toggleList(plain, selection, "numbered")
    expect(appliedEdit(plain, change)).toBe("1. one\n   more‸")
  })

  it("an ordinary list is rewritten as it always was", () => {
    const text = "- a\n- b"
    expect(toggleList(text, all(text), "numbered").replacement).toBe("1. a\n2. b")
    expect(toggleList("a\n  b", all("a\n  b"), "dots").replacement).toBe("- a\n  - b")
  })
})

describe("P3: the parser reads a line as an item's next line only when it stands under the item's words", () => {
  it("indented at least to the words: the item's; less: a cell of its own, as before", () => {
    expect(positioned("- a\n  b")[0]!.block).toEqual({ kind: "bullets", items: ["a\nb"] })
    expect(kinds("- a\n b")).toEqual(["bullets", "paragraph"])
    expect(kinds("1. a\n  b")).toEqual(["numbered", "paragraph"])
    expect(positioned("1. a\n   b")[0]!.block).toEqual({ kind: "numbered", items: ["a\nb"] })
    expect(positioned("10. a\n    b")[0]!.block).toEqual({ kind: "numbered", items: ["a\nb"] })
    expect(kinds("10. a\n   b")).toEqual(["numbered", "paragraph"])
    // A to-do's box is its words, as CommonMark has it: two columns is under it.
    expect(positioned("- [ ] a\n  b")[0]!.block).toEqual({ kind: "todos", items: [{ text: "a\nb", done: false }] })
    // A nested item's words are further in.
    expect(kinds("- a\n  - b\n  c")).toEqual(["bullets", "paragraph"])
    expect(positioned("- a\n  - b\n    c")[0]!.block).toEqual({ kind: "bullets", items: ["a", "b\nc"] })
    // A tab is four columns, before the marker or after it — and what Ctrl+Enter writes under any head is the item's.
    expect(positioned("- a\n\tb")[0]!.block).toEqual({ kind: "bullets", items: ["a\nb"] })
    for (const head of ["- ", "-   ", "- \t", "\t- ", "  1. ", "100. ", "- [x] ", "*  "]) {
      // (Typed on, the empty line is words: the editor takes its `<br>` off.)
      const note = ctrlEnter(head + "a‸").replace(CARET, "").replace("<br>", "more") + "\n" + head.replace(/^([ \t]*)\d+/, "$1" + "9") + "b"
      expect(positioned(note).length, JSON.stringify(note)).toBe(1)
      expect(JSON.stringify(positioned(note)[0]!.block), JSON.stringify(note)).toContain("a\\nmore")
    }
    // The empty line an item keeps is the item's at any indentation.
    expect(positioned("- a\n<br>")[0]!.block).toEqual({ kind: "bullets", items: ["a\n"] })
  })
})

describe("P3: the rough edges", () => {
  it("(e) Split Cell on an empty line kept, or beside one: the cells part there, no `<br>` left at a cell's edge", () => {
    expect(appliedEdit("hello\n<br>\nworld", splitCell("hello\n<br>\nworld", range(10, 0)))!.replace(CARET, "")).toBe("hello\n\nworld")
    expect(appliedEdit("hello\n<br>\nworld", splitCell("hello\n<br>\nworld", range(11, 0)))!.replace(CARET, "")).toBe("hello\n\nworld")
    expect(appliedEdit("hello\n<br>\nworld", splitCell("hello\n<br>\nworld", range(5, 0)))!.replace(CARET, "")).toBe("hello\n\nworld")
    expect(appliedEdit("a\n<br>\n<br>\nb", splitCell("a\n<br>\n<br>\nb", range(6, 0)))!.replace(CARET, "")).toBe("a\n\nb")
    const md = "<!-- markdown -->\nfirst\n<br>second"
    expect(appliedEdit(md, splitCell(md, range(md.indexOf("second"), 0)))!.replace(CARET, ""))
      .toBe("<!-- markdown -->\nfirst\n\n<!-- markdown -->\nsecond")
    // (Nothing at a cell's end, kept lines or not.)
    expect(splitCell("hello\n<br>", range(10, 0))).toBeNull()
  })
})
