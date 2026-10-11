// THE WORDS OF ONE READING ARE ONE CELL (cells/readingCell.ts; Sean, 2026-10-10: "Text brought in should be grouped together").
// Port-first: the Mac has no reader of its own for this, so nothing is transcribed.
import { describe, expect, it } from "vitest"
import { positioned } from "../src/markdown/parser"
import { looksMarkdown, unescapePlain } from "../src/markdown/plainText"
import { insertReading, readingLines, readingSource } from "../src/cells/readingCell"

const cells = (markdown: string) => positioned(markdown).filter((cell) => cell.block.kind !== "blank")
const kinds = (markdown: string) => cells(markdown).map((cell) => cell.block.kind)
const oneList = (markdown: string) => kinds(markdown).length === 1 && ["todos", "bullets", "dashes", "numbered"].includes(kinds(markdown)[0]!)

/** A reading the way the reader returned it for the fixture's three lines of handwriting (e2e tablet/06). */
const FOX = ["The quick brownfox", "jumps over ~~the~~ ↓ lazy dog.", "0123466789"]

describe("what a reading comes to as lines", () => {
  it("drops the empty lines and the lines of spaces, so no blank line can be written into the words", () => {
    expect(readingLines(["a", "", "b", "   ", "\t", "c"])).toEqual(["a", "b", "c"])
    expect(readingLines(["", ""])).toEqual([])
    expect(readingLines([])).toEqual([])
  })

  it("takes a line apart at the line breaks it carries, and trims each piece", () => {
    expect(readingLines(["a\nb", "  c  ", "d\r\n\r\ne", "f\u2028g"])).toEqual(["a", "b", "c", "d", "e", "f", "g"])
  })
})

describe("a reading is ONE cell, its lines kept as lines", () => {
  it("the fixture's three lines (with a struck word the reader found) are one TEXT cell, line for line, as the reader wrote them", () => {
    const source = readingSource(FOX)!
    expect(kinds(source)).toEqual(["paragraph"])
    // A text cell: nothing in it is markdown (the marks are the characters they are), so the rendered page keeps every line
    // (a markdown cell runs its lines together there).
    const [cell] = cells(source)
    expect(cell!.block.kind === "paragraph" && cell!.block.markdown).toBeFalsy()
    expect(looksMarkdown(source)).toBe(false)
    expect(unescapePlain(source).split("\n")).toEqual(FOX)
  })

  it("an empty line from the reader does not split it", () => {
    const joined = ["first", "", "second"].join("\n")
    // (Written as the reader gave it, the empty line makes two cells.)
    expect(kinds(joined)).toEqual(["paragraph", "paragraph"])
    const source = readingSource(["first", "", "second", "  ", "third"])!
    expect(source).toBe("first\nsecond\nthird")
    expect(cells(source)).toHaveLength(1)
  })

  it("lines the parser would read as blocks of their own (dashes, numbers, a heading, a quote, a rule, a row) stay words in it", () => {
    const readings = [
      ["1. Milk", "2. Eggs", "then go home"],
      ["# 3 apples", "some words"],
      ["shopping", "- milk", "- eggs"],
      ["> said", "then more"],
      ["above", "---", "below"],
      ["a | b", "| c | d |", "|---|---|"],
      ["above", "```", "code?", "```", "below"],
      ["x = 2", "> y"],
    ]
    for (const lines of readings) {
      // (Written as they were read, with nothing done to them, these are several cells: that is the problem.)
      expect(cells(lines.join("\n")).length, lines.join(" / ")).toBeGreaterThan(1)
      const source = readingSource(lines)!
      expect(cells(source), lines.join(" / ")).toHaveLength(1)
      expect(kinds(source), lines.join(" / ")).toEqual(["paragraph"])
      // ...and a text cell shows the words exactly as they were read.
      expect(unescapePlain(source).split("\n"), lines.join(" / ")).toEqual(lines)
    }
  })

  it("a line that opens a fence is words, even when nothing closes it (it would take the rest of the note into its code)", () => {
    const source = readingSource(["```", "code?"])!
    expect(kinds(source)).toEqual(["paragraph"])
    const put = insertReading("a\n\nb", 1, ["```", "code?"])!
    expect(cells(put.markdown).map((cell) => cell.block.kind)).toEqual(["paragraph", "paragraph", "paragraph"])
    expect(kinds(readingSource(["```"])!)).toEqual(["paragraph"])
  })

  it("a reading that is all tasks, or all bullets, or all numbers, is one list and is left as the reader wrote it", () => {
    for (const lines of [["- [ ] milk", "- [x] eggs", "- [ ] bread"], ["- a", "- b"], ["1. a", "2. b"]]) {
      expect(readingSource(lines)).toBe(lines.join("\n"))
      expect(cells(readingSource(lines)!)).toHaveLength(1)
    }
  })

  it("a task among other words is one cell too, its box shown as read", () => {
    const source = readingSource(["Groceries", "- [ ] milk", "- [x] eggs"])!
    expect(cells(source)).toHaveLength(1)
    expect(kinds(source)).toEqual(["paragraph"])
    expect(unescapePlain(source)).toBe("Groceries\n- [ ] milk\n- [x] eggs")
  })

  it("a reading of ONE line keeps the reader's marks: a struck word, a ringed one, a line of maths typeset", () => {
    for (const line of ["jumps ~~over~~ it", "a **ringed** word", "`wl:x^2 + 1`"]) {
      expect(readingSource([line])).toBe(line)
      expect(looksMarkdown(line), line).toBe(true)
      expect(kinds(readingSource([line])!)).toEqual(["paragraph"])
    }
    // (...but a heading's hash, or a bullet's dash, in a reading of one line is the writer's own, and is one cell as well.)
    expect(cells(readingSource(["- milk"])!)).toHaveLength(1)
  })

  it("holds for any lines at all (random words and marks), in any order", () => {
    let seed = 11
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const pieces = ["a", "b", " ", " ", "*", "**", "_", "`", "[", "]", "(", ")", "<", ">", "~", "~~", "\\", "#", "-", "+", "1", ".", "|", "!", ":", "x y", "wl:", "---", "```", "- [ ] ", "1. ", "> ", "!--", "<!-- markdown -->"]
    for (let i = 0; i < 3000; i++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () =>
        Array.from({ length: Math.floor(rnd() * 7) }, () => pieces[Math.floor(rnd() * pieces.length)]).join(""))
      const source = readingSource(lines)
      if (readingLines(lines).length === 0) { expect(source).toBeNull(); continue }
      expect(cells(source!).length, JSON.stringify(lines)).toBe(1)
      expect(source!.includes("\n\n"), JSON.stringify(lines)).toBe(false)
      // Every line of a reading of several lines is still a line of the cell.
      if (readingLines(lines).length > 1 && !oneList(source!)) expect(source!.split("\n"), JSON.stringify(lines)).toHaveLength(readingLines(lines).length)
    }
  })

  it("a reading with no words is nothing to bring in", () => {
    expect(readingSource([])).toBeNull()
    expect(readingSource(["", "  "])).toBeNull()
    expect(insertReading("a\n\nb", 1, [])).toBeNull()
  })
})

describe("a reading put into a note", () => {
  const note = "# Title\n\nfirst cell\n\nlast cell"
  const where = (markdown: string, needle: string) => markdown.indexOf(needle)

  it("lands as exactly one new cell between the cells it is put between, however many lines it has", () => {
    const at = where(note, "last cell")
    const put = insertReading(note, at, ["one", "", "- two", "3. three"])!
    expect(put.lines).toBe(3)
    expect(cells(put.markdown)).toHaveLength(cells(note).length + 1)
    expect(put.markdown.slice(put.caret, put.end)).toBe("one\n\\- two\n3\\. three")
    expect(unescapePlain(put.markdown.slice(put.caret, put.end))).toBe("one\n- two\n3. three")
    expect(put.markdown.startsWith("# Title\n\nfirst cell\n\n")).toBe(true)
    expect(put.markdown.endsWith("\n\nlast cell")).toBe(true)
  })

  it("on an empty note, at the start, and at the end", () => {
    expect(cells(insertReading("", 0, FOX)!.markdown)).toHaveLength(1)
    const fox = readingSource(FOX)!
    const first = insertReading(note, 0, FOX)!
    expect(cells(first.markdown)).toHaveLength(cells(note).length + 1)
    expect(first.markdown.startsWith(fox + "\n\n# Title")).toBe(true)
    const last = insertReading(note, note.length, FOX)!
    expect(cells(last.markdown)).toHaveLength(cells(note).length + 1)
    expect(last.markdown.endsWith("\n\n" + fox)).toBe(true)
  })

  it("with the caret in the middle of a line it opens its own cell there and the words are never split by a blank line", () => {
    const put = insertReading("abc def", 3, ["x", "", "y"])!
    expect(put.markdown).toBe("abc\n\nx\ny\n\n def")
    expect(put.markdown.slice(put.caret, put.end)).toBe("x\ny")
  })
})
