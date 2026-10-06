import { describe, expect, it } from "vitest"
import {
  apply, blockOrSelection, codeBlock, headingLevel, indent, outdent, outdentForBackspace,
  prefixLength, setHeading, toggleBullets, toggleList, toggleQuote, toggleTodo, toggleWrap,
  UNDERLINE_CLOSE, UNDERLINE_OPEN, type Heading,
} from "../src/markdown/formatting"
import { blocks, todoItem } from "../src/markdown/parser"
import { range } from "../src/text/range"

/** Transcribed from `WriteMindTests/MarkdownFormattingTests.swift`. */
describe("wrapping", () => {
  it("wraps the selection in bold and keeps it selected", () => {
    const change = toggleWrap("say word now", range(4, 4), "**")
    expect(apply("say word now", change)).toBe("say **word** now")
    expect(change.selection).toEqual(range(6, 4))
  })

  it("leaves the caret between the markers with no selection", () => {
    const change = toggleWrap("ab", range(1, 0), "**")
    expect(apply("ab", change)).toBe("a****b")
    expect(change.selection).toEqual(range(3, 0))
  })

  it("unwraps when the markers are inside the selection", () => {
    const text = "say **word** now"
    const change = toggleWrap(text, range(4, 8), "**")
    expect(apply(text, change)).toBe("say word now")
    expect(change.selection).toEqual(range(4, 4))
  })

  it("unwraps when the markers sit just outside the selection", () => {
    const text = "say **word** now"
    const change = toggleWrap(text, range(6, 4), "**")
    expect(apply(text, change)).toBe("say word now")
    expect(change.selection).toEqual(range(4, 4))
  })

  it("writes underline as HTML tags", () => {
    expect(apply("x", toggleWrap("x", range(0, 1), UNDERLINE_OPEN, UNDERLINE_CLOSE))).toBe("<u>x</u>")
  })

  it("clamps a selection past the end rather than falling over", () => {
    expect(apply("ab", toggleWrap("ab", range(10, 5), "_"))).toBe("ab__")
  })
})

describe("bullets", () => {
  it("adds one to every line the selection touches", () => {
    const text = "one\ntwo\nthree"
    const change = toggleBullets(text, range(1, 5))
    expect(apply(text, change)).toBe("- one\n- two\nthree")
    // The two bulleted lines stay selected — without the newline after them.
    expect(change.selection).toEqual(range(0, 11))
  })

  it("takes them away when every line has one", () => {
    const text = "- one\n- two\n"
    expect(apply(text, toggleBullets(text, range(0, 11)))).toBe("one\ntwo\n")
  })

  it("moves the caret past the marker on an empty line", () => {
    const change = toggleBullets("", range(0, 0))
    expect(change.replacement).toBe("- ")
    expect(change.selection).toEqual(range(2, 0))
  })

  it("pulls the caret back when the bullet goes", () => {
    const text = "- hello"
    const change = toggleBullets(text, range(7, 0))
    expect(apply(text, change)).toBe("hello")
    expect(change.selection).toEqual(range(5, 0))
  })
})

describe("indent and quote", () => {
  it("toggles a quote on every line the selection touches", () => {
    const text = "one\ntwo"
    const quoted = apply(text, toggleQuote(text, range(0, 7)))
    expect(quoted).toBe("> one\n> two")
    expect(apply(quoted, toggleQuote(quoted, range(0, 11)))).toBe("one\ntwo")
  })

  it("adds four spaces to a plain line and to a bullet", () => {
    expect(apply("a", indent("a", range(1, 0)))).toBe("    a")
    expect(apply("- item", indent("- item", range(0, 0)))).toBe("    - item")
  })

  it("nests a quote rather than shifting it", () => {
    expect(apply("> q", indent("> q", range(3, 0)))).toBe("> > q")
  })

  it("takes spaces off first, then the quote marker", () => {
    expect(apply("    > q", outdent("    > q", range(7, 0)))).toBe("> q")
    expect(apply("> q", outdent("> q", range(3, 0)))).toBe("q")
    expect(apply("q", outdent("q", range(1, 0)))).toBe("q")
  })

  it("spans a multi-line selection both ways", () => {
    const text = "- a\n- b"
    expect(apply(text, indent(text, range(0, 7)))).toBe("    - a\n    - b")
    const indented = "    - a\n    - b"
    expect(apply(indented, outdent(indented, range(0, 15)))).toBe("- a\n- b")
  })

  it("leaves blank lines alone", () => {
    const text = "a\n\nb"
    expect(apply(text, indent(text, range(0, 4)))).toBe("    a\n\n    b")
  })

  it("outdents on backspace inside the prefix and nowhere else", () => {
    const text = "    - item"
    expect(apply(text, outdentForBackspace(text, range(6, 0))!)).toBe("- item")
    expect(outdentForBackspace("    - item", range(8, 0))).toBeNull()
    expect(outdentForBackspace("plain", range(3, 0))).toBeNull()
    expect(outdentForBackspace("a\n  - b", range(2, 0))).toBeNull()
    expect(outdentForBackspace("  - item", range(2, 3))).toBeNull()
  })

  it("counts whitespace, quotes and the list marker as the prefix", () => {
    expect(prefixLength("  > > - x")).toBe(8)
    expect(prefixLength("plain")).toBe(0)
  })
})

describe("the whole paragraph moves with a caret", () => {
  it("indents every line of a wrapped paragraph", () => {
    const text = "one line\ntwo line\nthree line\n\nafter"
    expect(apply(text, indent(text, range(10, 0))))
      .toBe("    one line\n    two line\n    three line\n\nafter")
  })

  it("stops at a blank line", () => {
    const text = "a\n\nb\nc"
    expect(apply(text, indent(text, range(3, 0)))).toBe("a\n\n    b\n    c")
  })

  it("indents one bullet and not the whole list", () => {
    const text = "- one\n- two\n- three"
    expect(apply(text, indent(text, range(8, 0)))).toBe("- one\n    - two\n- three")
  })

  it("leaves a quote line and a heading standing alone", () => {
    const quote = "> one\n> two"
    expect(apply(quote, indent(quote, range(8, 0)))).toBe("> one\n> > two")
    const heading = "# Title\nbody"
    expect(apply(heading, indent(heading, range(2, 0)))).toBe("    # Title\nbody")
  })

  it("takes a real selection as given", () => {
    expect(blockOrSelection("a\nb", range(0, 3))).toEqual(range(0, 3))
  })
})

describe("the heading ladder", () => {
  it("writes each level's own marker", () => {
    const expected: [Heading, string][] = [
      [1, "# x"], [2, "## x"], [3, "### x"], [4, "#### x"], [5, "##### x"], [6, "###### x"],
    ]
    for (const [level, want] of expected) {
      expect(apply("x", setHeading("x", range(1, 0), level))).toBe(want)
    }
  })

  it("goes back to body when applied twice", () => {
    const once = apply("x", setHeading("x", range(0, 0), 3))
    expect(once).toBe("### x")
    expect(apply(once, setHeading(once, range(0, 0), 3))).toBe("x")
  })

  it("replaces the marker rather than stacking it", () => {
    expect(apply("### x", setHeading("### x", range(0, 0), 1))).toBe("# x")
  })

  it("strips whatever level is there for body", () => {
    expect(apply("###### byline", setHeading("###### byline", range(0, 0), 0))).toBe("byline")
  })

  it("takes the first line as the toggle and leaves the blanks", () => {
    const text = "a\n\nb"
    expect(apply(text, setHeading(text, range(0, 4), 2))).toBe("## a\n\n## b")
  })

  it("reads a line back", () => {
    expect(headingLevel("## x")).toBe(2)
    expect(headingLevel("###### x")).toBe(6)
    expect(headingLevel("#hashtag")).toBe(0)
    expect(headingLevel("####### too many")).toBe(0)
    expect(headingLevel("plain")).toBe(0)
  })
})

/** Transcribed from `WriteMindTests/ListStyleTests.swift`. */
describe("list styles", () => {
  it("writes each style's own marker", () => {
    const text = "one\ntwo"
    expect(apply(text, toggleList(text, range(0, 7), "dots"))).toBe("- one\n- two")
    expect(apply(text, toggleList(text, range(0, 7), "dashes"))).toBe("* one\n* two")
    expect(apply(text, toggleList(text, range(0, 7), "numbered"))).toBe("1. one\n2. two")
  })

  it("takes the markers away when asked for the style it already has", () => {
    const text = "- one\n- two"
    expect(apply(text, toggleList(text, range(0, 11), "dots"))).toBe("one\ntwo")
  })

  it("swaps the markers rather than stacking them", () => {
    const text = "- one\n- two"
    expect(apply(text, toggleList(text, range(0, 11), "numbered"))).toBe("1. one\n2. two")
  })

  it("keeps dots and dashes different blocks", () => {
    expect(blocks("- a\n- b")).toEqual([{ kind: "bullets", items: ["a", "b"] }])
    expect(blocks("* a\n* b")).toEqual([{ kind: "dashes", items: ["a", "b"] }])
    expect(blocks("- a\n* b")).toEqual([
      { kind: "bullets", items: ["a"] },
      { kind: "dashes", items: ["b"] },
    ])
  })

  it("still reads a star rule as a rule", () => {
    expect(blocks("***")).toEqual([{ kind: "rule" }])
  })

  // Tables came out of the Mac app whole on 2026-09-20 (pipes were prose there since); the port's rebuild, part one,
  // reads them again (tables.test.ts). A line of pipes with no delimiter row under it is still prose.
  it("reads a header, its delimiter row and a row as one table cell", () => {
    const note = "before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter"
    const found = blocks(note)
    expect(found).toHaveLength(3)
    expect(found[1]).toEqual({ kind: "table", header: ["a", "b"], align: [null, null], rows: [["1", "2"]] })
    expect(blocks("a | b is not a table")).toEqual([{ kind: "paragraph", text: "a | b is not a table" }])
  })
})

/** Transcribed from `WriteMindTests/TodoListTests.swift`. */
describe("to-do bullets", () => {
  it("reads an unticked box as a task that is not done", () => {
    expect(todoItem("- [ ] milk")).toEqual({ text: "milk", done: false })
  })

  it("reads a ticked box either way round in case", () => {
    expect(todoItem("- [x] milk")?.done).toBe(true)
    expect(todoItem("- [X] milk")?.done).toBe(true)
  })

  it("takes a star or a plus as the bullet too", () => {
    expect(todoItem("* [ ] a")?.text).toBe("a")
    expect(todoItem("+ [x] a")?.text).toBe("a")
  })

  it("reads an empty task as a task with nothing in it", () => {
    expect(todoItem("- [ ] ")?.text).toBe("")
  })

  it("refuses something that only looks like a box", () => {
    expect(todoItem("- [] milk")).toBeNull()
    expect(todoItem("- [?] milk")).toBeNull()
    expect(todoItem("- [x]milk")).toBeNull()
    expect(todoItem("[ ] milk")).toBeNull()
    expect(todoItem("- milk")).toBeNull()
  })

  it("writes an unticked box from the button", () => {
    const text = "milk\neggs"
    expect(apply(text, toggleList(text, range(0, 9), "todo"))).toBe("- [ ] milk\n- [ ] eggs")
  })

  it("takes the boxes away when pressed again", () => {
    const text = "- [ ] milk\n- [x] eggs"
    expect(apply(text, toggleList(text, range(0, 21), "todo"))).toBe("milk\neggs")
  })

  it("leaves no box behind when a task list becomes bullets", () => {
    const text = "- [x] milk"
    expect(apply(text, toggleList(text, range(0, 10), "dots"))).toBe("- milk")
  })

  it("ticks only the box that was pressed", () => {
    const note = "- [ ] milk\n- [ ] eggs"
    expect(apply(note, toggleTodo(note, range(0, 21), 1)!)).toBe("- [ ] milk\n- [x] eggs")
  })

  it("unticks a ticked box", () => {
    expect(apply("- [x] milk", toggleTodo("- [x] milk", range(0, 10), 0)!)).toBe("- [ ] milk")
  })

  it("keeps the indentation and the marker it was written with", () => {
    const note = "  * [ ] milk"
    expect(apply(note, toggleTodo(note, range(0, 12), 0)!)).toBe("  * [x] milk")
  })

  it("does nothing for an item that is no longer there", () => {
    expect(toggleTodo("- [ ] milk", range(0, 10), 3)).toBeNull()
    expect(toggleTodo("just words", range(0, 10), 0)).toBeNull()
  })

  it("does not reach out of its own cell", () => {
    const note = "- [ ] milk\n\n- [ ] eggs"
    expect(apply(note, toggleTodo(note, range(12, 10), 0)!)).toBe("- [ ] milk\n\n- [x] eggs")
  })
})

/**
 * Transcribed from the code-block tests — with a blank line either side of the fences where the Mac writes one line
 * break (Sean, 2026-10-05: a block is a cell of its own, never glued to the words above or below it; apart.ts).
 */
describe("the code block button", () => {
  it("fences a selection on lines of its own", () => {
    const text = "a\nb\nc"
    const change = codeBlock(text, range(2, 1))
    expect(apply(text, change)).toBe("a\n\n```\nb\n```\n\nc")
    expect(change.selection.location).toBe(3 + "```\nb\n```".length)
  })

  it("opens an empty block with the caret inside", () => {
    const change = codeBlock("hi", range(2, 0))
    expect(apply("hi", change)).toBe("hi\n\n```\n\n```")
    expect(change.selection).toEqual(range(8, 0))
  })

  it("keeps what is typed into an empty block inside it", () => {
    const change = codeBlock("hi", range(2, 0))
    const opened = apply("hi", change)
    const typed = opened.slice(0, change.selection.location) + "FSADF" + opened.slice(change.selection.location)
    expect(typed).toBe("hi\n\n```\nFSADF\n```")
    expect(blocks(typed).at(-1)).toEqual({ kind: "code", language: null, body: "FSADF" })
  })

  it("never doubles a blank line that is already there", () => {
    expect(apply("a\n\nb\n\nc", codeBlock("a\n\nb\n\nc", range(3, 1)))).toBe("a\n\n```\nb\n```\n\nc")
    expect(apply("a\n\n", codeBlock("a\n\n", range(3, 0)))).toBe("a\n\n```\n\n```")
    expect(apply("", codeBlock("", range(0, 0)))).toBe("```\n\n```")
  })
})
