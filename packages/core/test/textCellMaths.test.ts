// No maths typeset in a TEXT cell, anywhere (Sean, 2026-10-05: "math shouldn't be typeset in non-markdown mode";
// docs/PLAN-text-cells.md). A text cell shows `wl:` and its backticks as typed: the parser, the paper (PDF / HTML
// export), the plain-text copy and the sidebar's snippet. Maths cells (```wl fences) and markdown cells (by their
// marker, or by the older-notes rule) keep typesetting. Port-first: the Mac has no text cells, nothing is transcribed.
// (The source pane is pinned in packages/editor/test/mathInline.test.ts, the rendered page by
// e2e/suites/maths/11-text-cells-show-maths-as-typed.mjs.)
import { describe, expect, it } from "vitest"
import { blocks, positioned } from "../src/markdown/parser"
import { MARKDOWN_MARKER, escapePlain } from "../src/markdown/plainText"
import { plainCells, viaMarkdownCells } from "../src/cells/textCells"
import { blockHtml } from "../src/export/blocks"
import { noteBlocks } from "../src/export/document"
import { insertMath } from "../src/math/templates"
import { makeNote } from "../src/notes/note"
import { anchorIn } from "../src/notes/linking"
import { end, range, type Edit } from "../src/text/range"

const BT = "`"
const apply = (text: string, change: Edit | null): string =>
  change ? text.slice(0, change.range.location) + change.replacement + text.slice(end(change.range)) : text

/** What the escape rule writes when `words` are typed into a text cell. */
const typed = (words: string): string => escapePlain(words)

/** One cell on paper. */
const paper = (markdown: string): string => blockHtml(blocks(markdown)[0]!)

describe("a text cell: maths as typed, never typeset", () => {
  const words = `Area ${BT}wl:Pi r^2${BT} and ${BT}wl:Sqrt[x]${BT}\nsecond line ${BT}wl:x^2${BT} too`
  const source = typed(words)

  it("what the escape rule writes stays a text cell (the parser)", () => {
    expect(source).not.toBe(words)
    expect(source).toContain("\\`wl:")
    const cells = positioned(source)
    expect(cells).toHaveLength(1)
    expect(cells[0]!.block).toMatchObject({ kind: "paragraph", text: words })
    expect(cells[0]!.block).not.toHaveProperty("markdown")
    // Both ways an escape may stand: the opening backtick only (what the rule writes), or the pair.
    expect(blocks(`a \\${BT}wl:c-d${BT} b`)[0]).not.toHaveProperty("markdown")
    expect(blocks(`a \\${BT}wl:c-d\\${BT} b`)[0]).not.toHaveProperty("markdown")
  })

  it("the paper (PDF / HTML export) shows the backticks and the WL, line for line", () => {
    const html = paper(source)
    expect(html).not.toContain("wm-math")
    expect(html).not.toContain("<code")
    expect(html).toContain(`${BT}wl:Pi r^2${BT} and ${BT}wl:Sqrt[x]${BT}\nsecond line ${BT}wl:x^2${BT} too`)
    // through the whole note's cells as well (exportPdf's `noteBlocks`)
    const [cell] = noteBlocks(source)
    expect(cell!.html).toBe(html)
  })

  it("a fence typed into a text cell is words, not a maths cell", () => {
    const fence = typed("```wl\nx^2\n```")
    expect(positioned(fence)).toHaveLength(1)
    expect(positioned(fence)[0]!.block.kind).toBe("paragraph")
    expect(paper(fence)).not.toContain("wm-math")
    expect(paper(fence)).toContain("```wl\nx^2\n```")
  })

  it("copy gives the maths as typed (the plain-text clipboard)", () => {
    expect(plainCells(source)).toBe(words)
  })

  it("the sidebar's snippet keeps a text cell's backticks (and every other character it shows)", () => {
    const note = makeNote("/n/Shapes.md", 0, `# Shapes\n${typed(`A ${BT}wl:x^2${BT} b\n# not a heading *nor bold*`)}`)
    expect(note.title).toBe("Shapes")
    expect(note.snippet).toBe(`A ${BT}wl:x^2${BT} b · # not a heading *nor bold*`)
  })

  it("Link Here's title keeps a text cell's backticks, with no stray backslash (caret and selection)", () => {
    const text = `# N\n\n${typed(`Area ${BT}wl:Pi r^2${BT} here`)}`
    const at = text.indexOf("Area")
    const caret = anchorIn(text, range(at + 2, 0), () => "wm-1")
    expect(caret.title).toBe(`Area ${BT}wl:Pi r^2${BT} here`)
    const stop = text.indexOf(" here")
    const picked = anchorIn(text, range(at, stop - at), () => "wm-2")
    expect(picked.title).toBe(`Area ${BT}wl:Pi r^2${BT}`)
    // a markdown cell's title still has its markup off
    const md = `${MARKDOWN_MARKER}\nArea ${BT}wl:Pi r^2${BT} **here**`
    expect(anchorIn(md, range(md.indexOf("Area") + 1, 0), () => "wm-3").title).toBe("Area wl:Pi r^2 here")
  })
})

describe("maths cells and markdown cells keep typesetting", () => {
  it("a marked markdown cell, and an older note's paragraph with unescaped wl: maths (the older-notes rule)", () => {
    const marked = `${MARKDOWN_MARKER}\nArea ${BT}wl:Pi r^2${BT}`
    const older = `Area ${BT}wl:Pi r^2${BT}`
    for (const markdown of [marked, older]) {
      expect(blocks(markdown)[0]).toMatchObject({ kind: "paragraph", markdown: true })
      expect(paper(markdown)).toContain("wm-math wm-math-inline")
      expect(paper(markdown)).not.toContain("wl:")
    }
    // The older-notes rule is read again from the file each time: no marker is written by reading.
    expect(blocks(older)[0]).not.toHaveProperty("head")
  })

  it("a ```wl fence is a maths cell, typeset on paper", () => {
    expect(paper("```wl\nx^2\n```")).toContain("wm-math-block")
  })

  it("headings, lists and quotes are their own kinds and typeset", () => {
    for (const markdown of [`# Sum ${BT}wl:a+b${BT}`, `- item ${BT}wl:a+b${BT}`, `> quoted ${BT}wl:a+b${BT}`]) {
      expect(paper(markdown), markdown).toContain("wm-math wm-math-inline")
    }
  })

  it("a note of all of them: only the text cell is words", () => {
    const note = [
      typed(`Plain ${BT}wl:x^2${BT} words`), "",
      `${MARKDOWN_MARKER}\nMarked ${BT}wl:a+b${BT}`, "",
      `Older ${BT}wl:c-d${BT}`, "",
      "```wl\nx^3\n```",
    ].join("\n")
    const html = noteBlocks(note).map((one) => one.html).filter((one) => !one.includes('class="blank"'))
    expect(html).toHaveLength(4)
    expect(html[0]).toContain(`Plain ${BT}wl:x^2${BT} words`)
    expect(html[0]).not.toContain("wm-math")
    expect(html.slice(1).every((one) => one.includes("wm-math"))).toBe(true)
  })

  it("the sidebar's snippet of a markdown cell still takes its markup off", () => {
    const note = makeNote("/n/x.md", 0, `${MARKDOWN_MARKER}\nArea ${BT}wl:x^2${BT} **b**`)
    expect(note.snippet).toBe("Area wl:x^2 b")
  })
})

describe("inline maths put into a text cell makes it a markdown cell first (the automatic switch)", () => {
  it("the palette's inline insert (and Ctrl+Enter the other way): the marker goes on, the maths typesets", () => {
    const note = typed("Area *is*")
    const at = { location: note.length, length: 0 }
    const after = apply(note, viaMarkdownCells(note, at, (marked, where) => insertMath(marked, where, "Pi r^2", false)))
    expect(after).toBe(`${MARKDOWN_MARKER}\nArea *is*${BT}wl:Pi r^2${BT}`)
    expect(blocks(after)[0]).toMatchObject({ markdown: true })
    expect(paper(after)).toContain("wm-math wm-math-inline")
  })
})
