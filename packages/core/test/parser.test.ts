import { describe, expect, it } from "vitest"
import { blocks, positioned, type Block } from "../src/markdown/parser"

/** Transcribed from `WriteMindTests/MarkdownParserTests.swift`. */
describe("the parser", () => {
  it("reads headings, paragraphs and rules", () => {
    expect(blocks("# Title\n\nline one\nline two\n\n---\n## Sub")).toEqual<Block[]>([
      { kind: "heading", level: 1, text: "Title" },
      // A TEXT cell keeps its line breaks (docs/PLAN-text-cells.md: the port's rule since 2026-10-05; the Mac joins them).
      { kind: "paragraph", text: "line one\nline two" },
      { kind: "rule" },
      { kind: "heading", level: 2, text: "Sub" },
    ])
  })

  it("does not read a hash without a space as a heading", () => {
    expect(blocks("#hashtag")).toEqual<Block[]>([{ kind: "paragraph", text: "#hashtag" }])
  })

  it("reads lists, quotes and code", () => {
    const source = "- a\n- b\n\n1. x\n2) y\n> quoted\n> more\n```swift\nlet a = 1\n\nlet b = 2\n```\nafter"
    expect(blocks(source)).toEqual<Block[]>([
      { kind: "bullets", items: ["a", "b"] },
      { kind: "numbered", items: ["x", "y"] },
      { kind: "quote", text: "quoted more" },
      { kind: "code", language: "swift", body: "let a = 1\n\nlet b = 2" },
      { kind: "paragraph", text: "after" },
    ])
  })

  it("lets a list interrupt a paragraph", () => {
    expect(blocks("text\n- item")).toEqual<Block[]>([
      { kind: "paragraph", text: "text" },
      { kind: "bullets", items: ["item"] },
    ])
  })

  it("still renders an unclosed fence as code", () => {
    expect(blocks("```\nx")).toEqual<Block[]>([{ kind: "code", language: null, body: "x" }])
  })

  // Sean, 2026-09-20: "code blocks are only ``` and ` and `` blocks".
  it("keeps an indented line a paragraph, indentation and all", () => {
    expect(blocks("    four spaces in front")).toEqual<Block[]>([
      { kind: "paragraph", text: "    four spaces in front" },
    ])
  })

  it("keeps the indented lines inside a list part of the list", () => {
    expect(blocks("- one\n    - nested")).toHaveLength(1)
  })

  it("reads a task list before it reads a bullet", () => {
    expect(blocks("- [ ] milk\n- [x] eggs")).toEqual<Block[]>([
      { kind: "todos", items: [{ text: "milk", done: false }, { text: "eggs", done: true }] },
    ])
  })

  it("does not read a box with no space after it as a task", () => {
    expect(blocks("- []x")).toEqual<Block[]>([{ kind: "bullets", items: ["[]x"] }])
  })

  // Port-first (the Mac reads a lone marker as a paragraph line): Sean, 2026-10-11, "the input cursor should go to where it is
  // typing when inserting a checklist or bullets" — a list made by a command is its marker alone until a word is typed.
  it("reads a marker with no words, written with its space, as an empty item of its list where a cell or a list goes on", () => {
    const kinds = (text: string) => positioned(text).map((cell) => cell.block)
    // An empty note, the page between two cells (the bar's), a list of its own kind above (the next item).
    expect(kinds("- ")).toEqual<Block[]>([{ kind: "bullets", items: [""] }])
    expect(kinds("* ")).toEqual<Block[]>([{ kind: "dashes", items: [""] }])
    expect(kinds("+ ")).toEqual<Block[]>([{ kind: "bullets", items: [""] }])
    expect(kinds("1. ")).toEqual<Block[]>([{ kind: "numbered", items: [""] }])
    expect(kinds("12) ")).toEqual<Block[]>([{ kind: "numbered", items: [""] }])
    expect(kinds("a\n\n- \n\nb")).toEqual<Block[]>([
      { kind: "paragraph", text: "a" }, { kind: "bullets", items: [""] }, { kind: "paragraph", text: "b" },
    ])
    expect(kinds("- one\n- ")).toEqual<Block[]>([{ kind: "bullets", items: ["one", ""] }])
    // Under a list of its kind, as Return writes it, it is that list's next item with or without its space (3.9.0's rule).
    expect(kinds("- one\n-")).toEqual<Block[]>([{ kind: "bullets", items: ["one", ""] }])
    expect(kinds("1. one\n2.")).toEqual<Block[]>([{ kind: "numbered", items: ["one", ""] }])
    // Under a heading, a list of another kind or a quote: a list of its own (touching).
    expect(kinds("# H\n1. ")).toEqual<Block[]>([{ kind: "heading", level: 1, text: "H" }, { kind: "numbered", items: [""] }])
    expect(kinds("* one\n- ")).toEqual<Block[]>([{ kind: "dashes", items: ["one"] }, { kind: "bullets", items: [""] }])
    expect(kinds("> q\n- ")).toEqual<Block[]>([{ kind: "quote", text: "q" }, { kind: "bullets", items: [""] }])
    // Its range is the line as written, the space after the marker included: the caret after it is in the cell.
    expect(positioned("a\n\n* ")[1]!.range).toEqual({ location: 3, length: 2 })
    // Not a marker: two of them, a rule, a number with more after it, an escaped one (a text cell's words).
    expect(kinds("--")[0]!.kind).toBe("paragraph")
    expect(kinds("***")[0]!.kind).toBe("rule")
    expect(kinds("1.5")[0]!.kind).toBe("paragraph")
    expect(kinds("\\- ")[0]!.kind).toBe("paragraph")
    expect(kinds("12345. ")[0]!.kind).toBe("paragraph")
  })

  it("keeps a lone marker in a paragraph, and one with no space after it, as the words they always were (2026-10-11)", () => {
    // OLD NOTES KEEP THEIR SHAPE: a text cell with a `-` or a `1.` on a line of its own, or a cell that is a `*` and nothing
    // else, was one paragraph in every version before 2026-10-11, and the Swift app reads it so. Straight under a paragraph's
    // line a marker alone is that paragraph's words (CommonMark: an empty item cannot interrupt a paragraph), and with no space
    // after it, it starts no list anywhere (the editor draws no bullet for it either).
    const kinds = (text: string) => positioned(text).map((cell) => cell.block.kind)
    expect(kinds("Alpha\n-\nBeta\n\nShopping:\n1.\n\n*")).toEqual(["paragraph", "paragraph", "paragraph"])
    expect(kinds("Alpha\n- \nBeta\n\nShopping:\n1. ")).toEqual(["paragraph", "paragraph"])
    expect(kinds("a\n- ")).toEqual(["paragraph"])
    expect(kinds("<!-- markdown -->\n* ")).toEqual(["paragraph"])
    for (const alone of ["-", "+", "*", "1.", "12)", "# H\n-", "> q\n*"]) {
      expect(kinds(alone).filter((kind) => kind === "bullets" || kind === "dashes" || kind === "numbered"), alone).toEqual([])
    }
    // (A carriage return is not the space: a Windows file's `-\r` is the words `-`.)
    expect(kinds("-\r")).toEqual(["paragraph"])
    expect(kinds("- \r")).toEqual(["bullets"])
  })
})

/** Transcribed from `WriteMindTests/BlankLineTests.swift`. */
describe("blank lines, which are the note's and not the editor's", () => {
  const kinds = (text: string) =>
    positioned(text).map(({ block }) =>
      block.kind === "blank" ? `blank(${block.lines})` : block.kind)

  it("reads ten blank lines as three cells, one of them eight lines tall", () => {
    expect(kinds("baz\n" + "\n".repeat(10) + "# asdf")).toEqual(["paragraph", "blank(8)", "heading"])
  })

  it("reads one blank line as the seam between two cells", () => {
    expect(kinds("foo\n\nbar")).toEqual(["paragraph", "paragraph"])
  })

  it("reads two as the two separators with nothing between them", () => {
    expect(kinds("foo\n\n\nbar")).toEqual(["paragraph", "paragraph"])
  })

  it("makes a cell of one empty line out of three", () => {
    expect(kinds("foo\n\n\n\nbar")).toEqual(["paragraph", "blank(1)", "paragraph"])
  })

  it("gives the empty cell its own place in the note", () => {
    const found = positioned("foo\n\n\n\n\nbar")
    expect(found).toHaveLength(3)
    expect(found[1]!.range.location).toBeGreaterThan(found[0]!.range.location)
    expect(found[1]!.range.location).toBeLessThan(found[2]!.range.location)
  })

  it("leaves the cell after an empty cell covering its own text", () => {
    // The blank cell used to leave the open block's end behind it, so the
    // cell after it came out with a range of NEGATIVE length. Every seam
    // and every edit of a rendered cell is measured off these ranges.
    const found = positioned("baz\n" + "\n".repeat(10) + "# asdf")
    expect(found).toHaveLength(3)
    expect(found[0]!.range).toEqual({ location: 0, length: 3 })
    expect(found[2]!.range.length).toBeGreaterThan(0)
    expect(found[2]!.range).toEqual({ location: 14, length: 6 })
  })

  it("keeps blank lines inside a fence part of the code", () => {
    expect(kinds("```swift\nlet a = 1\n\n\n\nlet b = 2\n```")).toEqual(["code"])
  })
})
