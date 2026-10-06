// Text cells and markdown cells (docs/PLAN-text-cells.md; Sean, 2026-10-05). Port-first: the Mac has no text cells
// yet, so these are the port's own rules and nothing is transcribed.
import { describe, expect, it } from "vitest"
import { blocks, positioned, positionedUpdate, linesOf } from "../src/markdown/parser"
import {
  MARKDOWN_MARKER, escapeLine, escapeLineMapped, escapeOffsets, escapePlain, looksMarkdown, unescapeLine, unescapePlain,
  unescapeLineMapped,
} from "../src/markdown/plainText"
import { makeMarkdownCell, makeTextCell, plainCells, viaMarkdownCells, writeRich } from "../src/cells/textCells"
import { openCell, KIND_GROUPS, kindName } from "../src/cells/types"
import { returnInBlock } from "../src/cells/preview"
import { toggleWrap, BOLD } from "../src/markdown/formatting"
import { blockHtml } from "../src/export/blocks"
import { inlineHtml } from "../src/export/inline"
import { inlineSegments } from "../src/markdown/sourceStyle"
import { apply } from "../src/markdown/formatting"
import { applySpan } from "../src/markdown/spans"

let seed = 3
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const ALPHABET = ["a", "b", " ", " ", "*", "**", "_", "`", "[", "]", "(", ")", "<", ">", "~", "~~", "\\", "#", "-", "+", "1", ".", "|", "!", ":", "x y", "wl:", "u>", "!--"]
const randomLine = (): string => Array.from({ length: Math.floor(rnd() * 9) }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join("")

describe("the escape rule", () => {
  it("writes nothing for words with nothing special in them", () => {
    for (const words of ["foo", "two words", "a * b", "snake_case_name", "2 * 3 * 4", "#hashtag", "- ", "1.", "a | b", "x < y"]) {
      expect(escapeLine(words), words).toBe(words)
    }
  })

  it("escapes a line-start mark, and only that", () => {
    expect(escapeLine("# not a heading")).toBe("\\# not a heading")
    expect(escapeLine("- not a bullet")).toBe("\\- not a bullet")
    expect(escapeLine("* not a dash")).toBe("\\* not a dash")
    expect(escapeLine("+ plus")).toBe("\\+ plus")
    expect(escapeLine("> not a quote")).toBe("\\> not a quote")
    expect(escapeLine("1. not a list")).toBe("1\\. not a list")
    expect(blocks("a\n" + escapeLine("```"))).toEqual([{ kind: "paragraph", text: "a\n```" }])
    expect(escapeLine("---")).toBe("\\---")
    expect(escapeLine("| a | b |")).toBe("\\| a | b |")
    expect(escapeLine("  - indented")).toBe("  \\- indented")
  })

  it("escapes inline marks that would make markup", () => {
    expect(escapeLine("**bold**")).not.toBe("**bold**")
    expect(unescapeLine(escapeLine("**bold**"))).toBe("**bold**")
    expect(escapeLine("a *b* c")).toBe("a \\*b* c")
    expect(escapeLine("[label](url)")).toBe("\\[label](url)")
    expect(escapeLine("`code`")).toBe("\\`code`")
    expect(escapeLine("<u>x</u>")).toBe("\\<u>x\\</u>")
    expect(escapeLine("~~gone~~")).toBe("\\~~gone~~")
    expect(escapeLine("a \\* b")).toBe("a \\\\* b")
    expect(escapeLine(MARKDOWN_MARKER)).toBe("\\" + MARKDOWN_MARKER)
  })

  it("on random lines: reads back as written, never looks like markdown, and is one paragraph line", () => {
    seed = 3
    for (let i = 0; i < 4000; i++) {
      const words = randomLine()
      const file = escapeLine(words)
      expect(unescapeLine(file), JSON.stringify(words)).toBe(words)
      expect(looksMarkdown(file), JSON.stringify([words, file])).toBe(false)
      if (words.trim().length > 0) {
        const parsed = blocks("first line\n" + file)
        expect(parsed.length, JSON.stringify([words, file])).toBe(1)
        expect(parsed[0]).toEqual({ kind: "paragraph", text: "first line\n" + words })
      }
      const mapped = escapeLineMapped(words)
      expect(mapped.at.length).toBe(words.length + 1)
      expect(mapped.at[words.length]).toBe(file.length)
      for (let k = 0; k < words.length; k++) expect(file.slice(mapped.at[k]!, mapped.at[k + 1]!).endsWith(words[k]!)).toBe(true)
    }
  })

  it("names its escapes, each one character on screen", () => {
    expect(escapeOffsets("\\# a \\*b*")).toEqual([0, 5])
    expect(unescapePlain("\\# a\n\\- b")).toBe("# a\n- b")
    expect(escapePlain("# a\n- b")).toBe("\\# a\n\\- b")
  })
})

describe("the parser", () => {
  it("Sean's five lines are a text cell of five lines", () => {
    expect(blocks("foo\nbar\nbaz\nbez\nfoo")).toEqual([{ kind: "paragraph", text: "foo\nbar\nbaz\nbez\nfoo" }])
  })

  it("the marker makes the paragraph under it a markdown cell, and is inside its range", () => {
    const note = "intro\n\n" + MARKDOWN_MARKER + "\none **two**\nthree"
    const cells = positioned(note)
    expect(cells.map((c) => c.block)).toEqual([
      { kind: "paragraph", text: "intro" },
      { kind: "paragraph", text: "one **two** three", markdown: true, head: MARKDOWN_MARKER.length + 1 },
    ])
    expect(cells[1]!.range).toEqual({ location: 7, length: note.length - 7 })
  })

  it("a marker under a paragraph line starts a cell of its own", () => {
    const cells = positioned("a\n" + MARKDOWN_MARKER + "\nb")
    expect(cells.map((c) => c.block.kind)).toEqual(["paragraph", "paragraph"])
    expect(cells[1]!.range.location).toBe(2)
  })

  it("older notes: unescaped markup with no marker is a markdown cell; escaped, it is a text cell", () => {
    expect(blocks("some **bold**\nwords")).toEqual([{ kind: "paragraph", text: "some **bold** words", markdown: true }])
    expect(blocks(escapeLine("some **bold**"))).toEqual([{ kind: "paragraph", text: "some **bold**" }])
    expect(blocks("a `wl:x^2` b")[0]).toMatchObject({ markdown: true })
    expect(blocks("snake_case_name")[0]).toEqual({ kind: "paragraph", text: "snake_case_name" })
    expect(looksMarkdown("a <span style=\"color: red\">x</span>")).toBe(true)
    expect(looksMarkdown("[a](b)")).toBe(true)
  })

  it("the incremental parse agrees on notes with markers and escapes", () => {
    seed = 21
    const LINES = ["", "words", "\\# esc", MARKDOWN_MARKER, "**b**", "# H", "- li", "more"]
    const FRAGS = ["\n", "x", MARKDOWN_MARKER + "\n", "*", "\\", "# ", "\n\n"]
    for (let chain = 0; chain < 40; chain++) {
      let text = Array.from({ length: 12 }, () => LINES[Math.floor(rnd() * LINES.length)]).join("\n")
      let cells = positioned(text)
      for (let step = 0; step < 30; step++) {
        const from = Math.floor(rnd() * (text.length + 1))
        const to = Math.min(text.length, from + Math.floor(rnd() * 5))
        const insert = FRAGS[Math.floor(rnd() * FRAGS.length)]!
        const next = text.slice(0, from) + insert + text.slice(to)
        cells = positionedUpdate(cells, { from, toOld: to, toNew: from + insert.length }, linesOf(next))
        text = next
        expect(cells).toEqual(positioned(text))
      }
    }
  })
})

describe("switching", () => {
  // Sean, 2026-10-05: "when converting a cell to markdown, it just processes markdown".
  it("Ctrl+Shift+7 puts the marker on top and takes the escapes out: the words are read as markdown now", () => {
    const note = escapePlain("a **x** b\nc")
    expect(note).not.toBe("a **x** b\nc")
    const at = note.indexOf("x")
    const change = makeMarkdownCell(note, { location: at, length: 1 })!
    const after = apply(note, change)
    expect(after).toBe(`${MARKDOWN_MARKER}\na **x** b\nc`)
    expect(after.slice(change.selection.location, change.selection.location + change.selection.length)).toBe("x")
    expect(blocks(after)).toEqual([{ kind: "paragraph", text: "a **x** b c", markdown: true, head: MARKDOWN_MARKER.length + 1 }])
    // A cell that is markdown already is left as it is.
    expect(makeMarkdownCell(after, { location: after.length, length: 0 })).toBeNull()
  })

  it("block markup at the head of the words makes that block: the marker goes down to the words, or goes", () => {
    const note = escapePlain("# a **x**")
    const change = makeMarkdownCell(note, { location: note.indexOf("x"), length: 0 })!
    const after = apply(note, change)
    expect(after).toBe("# a **x**")
    expect(after[change.selection.location]).toBe("x")
    const two = escapePlain("# Title\nmore *y*")
    expect(apply(two, makeMarkdownCell(two, { location: 0, length: 0 })!)).toBe(`# Title\n${MARKDOWN_MARKER}\nmore *y*`)
    expect(blocks(apply(two, makeMarkdownCell(two, { location: 0, length: 0 })!)).map((one) => one.kind)).toEqual(["heading", "paragraph"])
  })

  it("keeps Link Here's anchors, a line that is the marker, and a fence that would not close in the cell", () => {
    expect(unescapeLineMapped(`<a id="a\\-b"></a>x \\*y*`)).toEqual({ text: `<a id="a\\-b"></a>x *y*`, removed: [19] })
    const anchored = `<a id="wm-1"></a>bar \\*b*`
    expect(apply(anchored, makeMarkdownCell(anchored, { location: 20, length: 0 })!)).toBe(`${MARKDOWN_MARKER}\n<a id="wm-1"></a>bar *b*`)
    const marker = escapePlain(`a\n${MARKDOWN_MARKER}`)
    expect(apply(marker, makeMarkdownCell(marker, { location: 0, length: 0 })!)).toBe(`${MARKDOWN_MARKER}\n${marker}`)
    const unclosed = escapePlain("```js\ncode *x*")
    expect(apply(unclosed, makeMarkdownCell(unclosed, { location: 0, length: 0 })!)).toBe(`${MARKDOWN_MARKER}\n${escapeLine("```js")}\ncode *x*`)
    const closed = escapePlain("```\n*x*\n```") + "\n\nnext"
    expect(apply(closed, makeMarkdownCell(closed, { location: 0, length: 0 })!)).toBe("```\n*x*\n```\n\nnext")
  })

  it("Ctrl+7 takes the marker and the formatting off and keeps the words and their lines", () => {
    const note = MARKDOWN_MARKER + "\nsome **bold**\n**#** words"
    const after = apply(note, makeTextCell(note, { location: 20, length: 0 })!)
    expect(after).toBe("some bold\n\\# words")
    expect(blocks(after)).toEqual([{ kind: "paragraph", text: "some bold\n# words" }])
  })

  it("Ctrl+Shift+7 on a heading makes a markdown paragraph of its words", () => {
    const after = apply("# Title", makeMarkdownCell("# Title", { location: 3, length: 0 })!)
    expect(after).toBe(MARKDOWN_MARKER + "\nTitle")
  })

  it("a rich-text action in a text cell makes it a markdown cell first, as ONE edit", () => {
    const note = "one two\n\nnext"
    const change = viaMarkdownCells(note, { location: 4, length: 3 }, (text, where) => toggleWrap(text, where, BOLD))!
    expect(apply(note, change)).toBe(MARKDOWN_MARKER + "\none **two**\n\nnext")
    expect(change.selection).toEqual({ location: MARKDOWN_MARKER.length + 1 + 6, length: 3 })
    // In a markdown cell (or a heading) it is the action as it was.
    const marked = MARKDOWN_MARKER + "\none two"
    expect(apply(marked, viaMarkdownCells(marked, { location: 22, length: 3 }, (t, w) => toggleWrap(t, w, BOLD))!))
      .toBe(MARKDOWN_MARKER + "\none **two**")
    expect(writeRich("see /link here", { location: 4, length: 5 }, "[A](B.md)").text).toBe(MARKDOWN_MARKER + "\nsee [A](B.md) here")
  })

  it("/link says where the link landed, with escapes and markers after it too", () => {
    const landed = (source: string): string => {
      const { text, link } = writeRich(source, { location: source.indexOf("/link"), length: 5 }, "[A](B.md)")
      return text.slice(link.location, link.location + link.length)
    }
    expect(landed(escapePlain("*a* see /link then *b* and *c*"))).toBe("[A](B.md)")
    expect(landed(escapePlain("see /link here\n# below *x*"))).toBe("[A](B.md)")
    expect(landed(escapePlain("# Title /link\nmore *y*"))).toBe("[A](B.md)")
  })

  it("a selection that only touches a text cell at an end leaves it alone; a no-op action switches nothing", () => {
    const words = escapePlain("**c**")
    const note = "one two\n\n" + words
    // From "two" to column 0 of the next cell: that cell is not selected, so it stays a text cell.
    const change = viaMarkdownCells(note, { location: 4, length: note.indexOf(words) - 4 }, (t, w) => toggleWrap(t, w, BOLD))!
    const after = apply(note, change)
    expect(after.startsWith(MARKDOWN_MARKER)).toBe(true)
    expect(after.split(MARKDOWN_MARKER).length).toBe(2)
    expect(after.endsWith(words)).toBe(true)
    // The T menu's Remove on a text cell takes nothing off and switches nothing.
    const plain = escapePlain("one **two**")
    expect(apply(plain, viaMarkdownCells(plain, { location: 0, length: 3 }, (t, w) => applySpan(t, w, {}))!)).toBe(plain)
  })

  it("a marker line inside a fence that closes in the cell is code, shown as it was", () => {
    const note = escapePlain("```\n" + MARKDOWN_MARKER + "\n```")
    expect(apply(note, makeMarkdownCell(note, { location: 0, length: 0 })!)).toBe("```\n" + MARKDOWN_MARKER + "\n```")
  })

  it("the automatic switch reads the words as markdown too, and acts on the same visible characters", () => {
    const note = "intro\n\n" + escapePlain("2*3*4 and **y**")
    const at = note.indexOf("and")
    const change = viaMarkdownCells(note, { location: at, length: 3 }, (text, where) => toggleWrap(text, where, BOLD))!
    const after = apply(note, change)
    expect(after).toBe(`intro\n\n${MARKDOWN_MARKER}\n2*3*4 **and** **y**`)
    expect(after.slice(change.selection.location, change.selection.location + change.selection.length)).toBe("and")
    const link = escapePlain("**a** see /link")
    expect(writeRich(link, { location: link.indexOf("/link"), length: 5 }, "[A](B.md)").text)
      .toBe(`${MARKDOWN_MARKER}\n**a** see [A](B.md)`)
  })

  it("the + menu and the bar: Text and Markdown first; a character typed into a new text cell is literal", () => {
    expect(KIND_GROUPS[0]!.map(kindName)).toEqual(["Text", "Markdown"])
    expect(openCell({ kind: "text" }, "a", 1, "#").markdown).toBe("a\n\n\\#")
    const made = openCell({ kind: "markdown" }, "a", 1, "x")
    expect(made.markdown).toBe("a\n\n" + MARKDOWN_MARKER + "\nx")
    expect(blocks(made.markdown)[1]).toMatchObject({ kind: "paragraph", markdown: true, text: "x" })
  })

  it("Return in a markdown cell leaves two markdown cells; in a text cell the halves are escaped again", () => {
    const marked = MARKDOWN_MARKER + "\none two"
    const split = apply(marked, returnInBlock(marked, { location: MARKDOWN_MARKER.length + 4, length: 0 })!)
    expect(split).toBe(MARKDOWN_MARKER + "\none\n\n" + MARKDOWN_MARKER + "\ntwo")
    const text = "a # b"
    expect(apply(text, returnInBlock(text, { location: 2, length: 0 })!)).toBe("a \n\n\\# b")
  })
})

describe("the paper and the page's inline reader", () => {
  it("a text cell prints its lines as typed, nothing formatted; a markdown cell as markdown", () => {
    const [text] = blocks("foo\nbar\n\\*not* bold")
    expect(blockHtml(text!)).toBe('<div class="para">foo\nbar\n*not* bold</div>')
    const [md] = blocks(MARKDOWN_MARKER + "\n**bold** \\*not*")
    expect(blockHtml(md!)).toBe('<div class="para"><b>bold</b> *not*</div>')
  })

  it("an escape is its character in a markdown cell, on the page and on paper", () => {
    expect(inlineSegments("\\*x*").map((s) => [s.text, !!s.italic])).toEqual([["*x*", false]])
    expect(inlineHtml("\\<u>x")).toBe("&lt;u&gt;x")
  })
})

// The gate's findings (2026-10-05): what a paste at the bar keeps, Link Here's anchors, Ctrl+7's losses, long lines.
describe("anchors, pictures, pastes and long lines", () => {
  const BS = String.fromCharCode(92)

  it("a paste at the bar is written as it is; what is typed there is literal", () => {
    const cells = `# Heading\n\n${MARKDOWN_MARKER}\nsome **bold** words\n\n- one\n- two`
    expect(openCell({ kind: "text" }, "", 0, cells, false).markdown).toBe(cells)
    expect(openCell({ kind: "text" }, "", 0, "# x").markdown).toBe(`${BS}# x`)
  })

  it("Link Here's anchor in a text cell leaves it a text cell, its lines kept and the anchor not among its words", () => {
    const linked = `foo\n<a id="wm-1"></a>bar\nbaz\nbez\nfoo`
    expect(blocks(linked)).toEqual([{ kind: "paragraph", text: "foo\nbar\nbaz\nbez\nfoo" }])
    expect(looksMarkdown(`see <mark id="wm-2">this part</mark> here`)).toBe(false)
    expect(looksMarkdown(`see <mark>this part</mark> here`)).toBe(true)
    // The escape rule leaves an anchor alone (and still escapes the markup round it).
    expect(escapeLine(`<a id="wm-1"></a>a *b*`)).toBe(`<a id="wm-1"></a>a ${BS}*b*`)
    expect(blockHtml(blocks(linked)[0]!)).not.toContain("wm-1")
  })

  it("Ctrl+7 keeps Link Here's anchors and an inline picture's markdown", () => {
    const run = (md: string): string => {
      const change = makeTextCell(md, { location: md.length, length: 0 })!
      return md.slice(0, change.range.location) + change.replacement + md.slice(change.range.location + change.range.length)
    }
    expect(run(`${MARKDOWN_MARKER}\nfoo\n<a id="wm-1"></a>bar **b**`)).toBe(`foo\n<a id="wm-1"></a>bar b`)
    expect(run(`${MARKDOWN_MARKER}\nsee <mark id="wm-2">this part</mark> here`)).toBe(`see <mark id="wm-2">this part</mark> here`)
    const picture = run(`${MARKDOWN_MARKER}\nan image ![diagram](media/x.png) *inline*`)
    expect(picture).toContain("media/x.png")
    expect(blocks(picture)).toEqual([{ kind: "paragraph", text: "an image ![diagram](media/x.png) inline" }])
  })

  // Sean, 2026-10-06 ("yes"): Ctrl+7 keeps inline maths' whole `wl:` source as the text cell's words.
  describe("Ctrl+7 keeps inline maths' whole source", () => {
    const toText = (md: string): string => apply(md, makeTextCell(md, { location: md.length, length: 0 })!)
    const toMarkdown = (md: string): string => apply(md, makeMarkdownCell(md, { location: 0, length: 0 })!)
    const BT = "`"

    it("one maths span: backticks and wl: kept, escaped as typed words, shown as typed", () => {
      const text = toText(`${MARKDOWN_MARKER}\nArea ${BT}wl:Pi r^2${BT} here`)
      expect(text).toBe(`Area ${BS}${BT}wl:Pi r^2${BT} here`)
      expect(blocks(text)).toEqual([{ kind: "paragraph", text: `Area ${BT}wl:Pi r^2${BT} here` }])
      expect(looksMarkdown(text)).toBe(false)
    })

    it("several maths spans, and maths beside bold (the bold goes, the maths stays)", () => {
      const several = toText(`${MARKDOWN_MARKER}\n${BT}wl:a${BT} and ${BT}wl:b^2${BT}\nthen ${BT}wl:Sqrt[c]${BT}`)
      expect(unescapePlain(several)).toBe(`${BT}wl:a${BT} and ${BT}wl:b^2${BT}\nthen ${BT}wl:Sqrt[c]${BT}`)
      expect(blocks(several)).toEqual([{ kind: "paragraph", text: `${BT}wl:a${BT} and ${BT}wl:b^2${BT}\nthen ${BT}wl:Sqrt[c]${BT}` }])
      const bold = toText(`${MARKDOWN_MARKER}\n**big**${BT}wl:x^2${BT} *it* [see](a.md) ${BT}wl:y${BT}**b**`)
      expect(unescapePlain(bold)).toBe(`big${BT}wl:x^2${BT} it see ${BT}wl:y${BT}b`)
      expect(blocks(bold)[0]).toMatchObject({ kind: "paragraph", text: `big${BT}wl:x^2${BT} it see ${BT}wl:y${BT}b` })
      expect(blocks(bold)[0]).not.toHaveProperty("markdown", true)
    })

    it("Ctrl+7 then Ctrl+Shift+7 gives back the same maths segments", () => {
      for (const words of [`Area ${BT}wl:Pi r^2${BT} here`, `${BT}wl:a${BT} and ${BT}wl:b^2${BT}`, `${BT}wl:x_1 + x_2${BT} end`]) {
        const md = `${MARKDOWN_MARKER}\n${words}`
        const back = toMarkdown(toText(md))
        expect(back).toBe(md)
        const maths = (line: string) => inlineSegments(line).filter((one) => one.math !== undefined).map((one) => one.math)
        expect(maths(back.split("\n")[1]!)).toEqual(maths(words))
        expect(maths(words).length).toBeGreaterThan(0)
      }
    })

    it("maths holding backslashes and markup characters comes back exact; an empty `wl:` is code, and does not hang", () => {
      for (const words of [`a ${BT}wl:a${BS}b${BT} z`, `${BT}wl:a${BS}*b${BT} z`, `${BT}wl:"${BS}${BS}n"${BT}`, `${BT}wl:a*b*c${BT} and ${BT}wl:x~~y~~${BT}`,
        `${BT}wl:[l](u)${BT}${BT}wl:<|a->1|>${BT}`, `x\n  ${BT}wl:y${BT} b\nthird ${BT}wl:z${BT} and ${BT}wl:a+b${BT} end`]) {
        const md = `${MARKDOWN_MARKER}\n${words}`
        expect(toMarkdown(toText(md))).toBe(md)
      }
      expect(inlineSegments(`${BT}wl:${BT} x`).some((one) => one.math !== undefined)).toBe(false)
      expect(toText(`${MARKDOWN_MARKER}\n${BT}wl:${BT} x`)).toBe("wl: x")
    })
  })

  it("a long pasted line is escaped quickly, and stays literal", () => {
    for (const line of ["*a* ".repeat(4000), "x_y `c` [l](u) ".repeat(1000), "*a* ".repeat(15000)]) {
      const started = Date.now()
      const made = escapeLine(line)
      expect(Date.now() - started).toBeLessThan(1500)
      expect(looksMarkdown(made)).toBe(false)
      expect(unescapeLine(made)).toBe(line)
    }
  })

  it("whole cells on the plain-text clipboard: a text cell's words, a markdown cell without its marker", () => {
    expect(plainCells(`2${BS}*3*4\n<a id="wm-1"></a>bar\n\n${MARKDOWN_MARKER}\n**b**\n\n# h`)).toBe(`2*3*4\nbar\n\n**b**\n\n# h`)
  })
})

describe("a block written into a paragraph keeps each half its kind", () => {
  it("display maths or Ctrl+8 in a text cell: the halves are escaped again", async () => {
    const { insertMath } = await import("../src/math/templates")
    const { codeBlock } = await import("../src/markdown/formatting")
    const note = "total cost # items - see list"
    const maths = apply(note, insertMath(note, { location: 11, length: 0 }, "x^2", true))
    expect(blocks(maths).map((b) => b.kind)).toEqual(["paragraph", "code", "paragraph"])
    expect(blocks(maths)[2]).toEqual({ kind: "paragraph", text: "# items - see list" })
    const code = apply(note, codeBlock(note, { location: 0, length: 18 }))
    expect(blocks(code).map((b) => b.kind)).toEqual(["code", "paragraph"])
  })

  it("in a markdown cell the second half gets a marker of its own", async () => {
    const { insertMath } = await import("../src/math/templates")
    const note = `${MARKDOWN_MARKER}\none **two** three`
    const out = apply(note, insertMath(note, { location: note.indexOf("three"), length: 0 }, "x", true))
    expect(blocks(out).filter((b) => b.kind === "paragraph").every((b) => b.kind === "paragraph" && b.markdown)).toBe(true)
    const atWords = apply(note, insertMath(note, { location: MARKDOWN_MARKER.length + 1, length: 0 }, "x", true))
    expect(atWords.startsWith("```")).toBe(true)
    expect(atWords).toContain(`\n\n${MARKDOWN_MARKER}\none **two** three`)
  })
})
