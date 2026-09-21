import { describe, expect, it } from "vitest"
import { blocks, positioned, type Block } from "../src/markdown/parser"

/** Transcribed from `WriteMindTests/MarkdownParserTests.swift`. */
describe("the parser", () => {
  it("reads headings, paragraphs and rules", () => {
    expect(blocks("# Title\n\nline one\nline two\n\n---\n## Sub")).toEqual<Block[]>([
      { kind: "heading", level: 1, text: "Title" },
      { kind: "paragraph", text: "line one line two" },
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
