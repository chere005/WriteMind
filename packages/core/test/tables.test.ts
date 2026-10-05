import { describe, expect, it } from "vitest"
import { blocks, positioned, positionedUpdate, linesOf } from "../src/markdown/parser"
import {
  delimiterAligns, drawnRows, emptyRow, hasPipe, headerCells, rowCells, rowSpans, tableReturn, tableTab,
} from "../src/markdown/table"
import { blockHtml } from "../src/export/blocks"

/**
 * Tables, from scratch — part one (port-first; the Mac took tables out on 2026-09-20 and has none to transcribe):
 * a GitHub-style pipe table is ONE cell, drawn as a table on the page and on paper, typed as its markdown.
 */

const KEYS = "| Key | Does |\n|:---|---:|\n| Ctrl+B | **bold** |\n| Ctrl+I | _italic_ |"

describe("reading a table", () => {
  it("reads the header, each column's alignment and the rows, as one cell over all of its lines", () => {
    const found = positioned(KEYS)
    expect(found).toEqual([{
      block: {
        kind: "table", header: ["Key", "Does"], align: ["left", "right"],
        rows: [["Ctrl+B", "**bold**"], ["Ctrl+I", "_italic_"]],
      },
      range: { location: 0, length: KEYS.length },
    }])
  })

  it("reads centre alignment, and a column with no colon has none", () => {
    expect(delimiterAligns("| :-: | --- | ---: | :-- |")).toEqual(["center", null, "right", "left"])
    expect(delimiterAligns("|---|-x-|")).toBeNull()
    expect(delimiterAligns("---")).toBeNull() // a rule, not a delimiter row: no pipe
  })

  it("does without the pipes at the ends", () => {
    expect(blocks("a | b\n--- | ---\n1 | 2")).toEqual([
      { kind: "table", header: ["a", "b"], align: [null, null], rows: [["1", "2"]] },
    ])
  })

  it("pads a short row with empty cells and cuts a long one at the header's width", () => {
    expect(blocks("| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n| | x")).toEqual([{
      kind: "table", header: ["a", "b", "c"], align: [null, null, null],
      rows: [["1", "", ""], ["1", "2", "3"], ["", "x", ""]],
    }])
  })

  it("reads an escaped pipe as a pipe inside its cell", () => {
    expect(rowCells("| x \\| y | z |")).toEqual(["x | y", "z"])
    expect(blocks("| a | b |\n|---|---|\n| x \\| y | `c\\|d` |")[0]).toEqual({
      kind: "table", header: ["a", "b"], align: [null, null], rows: [["x | y", "`c|d`"]],
    })
    expect(hasPipe("only \\| escaped")).toBe(false)
    expect(hasPipe("a \\\\| b")).toBe(true) // the backslash is escaped, not the pipe
  })

  it("keeps the inline markdown in a cell as it is written", () => {
    const table = blocks("| **b** | [link](x) |\n|---|---|\n| `code` | ~~gone~~ |")[0]
    expect(table).toEqual({ kind: "table", header: ["**b**", "[link](x)"], align: [null, null], rows: [["`code`", "~~gone~~"]] })
  })

  it("a lone line of pipes is not a table", () => {
    expect(blocks("| a | b |")).toEqual([{ kind: "paragraph", text: "| a | b |" }])
    expect(blocks("| a | b |\nmore words")).toEqual([{ kind: "paragraph", text: "| a | b | more words" }])
    // A delimiter row with a different number of cells is not one either.
    expect(blocks("| a | b |\n|---|")).toEqual([{ kind: "paragraph", text: "| a | b | |---|" }])
    // A rule under a line of pipes is a rule.
    expect(blocks("| a | b |\n---").map((b) => b.kind)).toEqual(["paragraph", "rule"])
  })

  it("a table inside a list is not one", () => {
    const note = "- item\n  | a | b |\n  |---|---|\n  | 1 | 2 |"
    expect(blocks(note).some((b) => b.kind === "table")).toBe(false)
    expect(blocks("1. one\n   | a | b |\n   |---|---|").some((b) => b.kind === "table")).toBe(false)
    // …nor inside a quote, nor inside a fence.
    expect(blocks("> | a | b |\n> |---|---|").map((b) => b.kind)).toEqual(["quote"])
    expect(blocks("```\n| a | b |\n|---|---|\n```").map((b) => b.kind)).toEqual(["code"])
    expect(headerCells("  | a | b |")).toBe(-1)
    expect(headerCells(" | a | b |")).toBe(2)
  })

  it("a table straight under a paragraph line takes that line as its header, as GitHub does", () => {
    const note = "My keys:\nmore words\n| a | b |\n|---|---|\n| 1 | 2 |"
    const found = positioned(note)
    expect(found).toEqual([
      { block: { kind: "paragraph", text: "My keys: more words" }, range: { location: 0, length: 19 } },
      {
        block: { kind: "table", header: ["a", "b"], align: [null, null], rows: [["1", "2"]] },
        range: { location: 20, length: note.length - 20 },
      },
    ])
  })

  it("ends at a blank line, a list item, a quote, a heading or a line with no pipe in it", () => {
    const kinds = (note: string) => blocks(note).map((b) => b.kind)
    expect(kinds("| a |\n|---|\n| 1 |\n\nafter")).toEqual(["table", "paragraph"])
    expect(kinds("| a |\n|---|\n| 1 |\n- item | x")).toEqual(["table", "bullets"])
    expect(kinds("| a |\n|---|\n| 1 |\n> q | x")).toEqual(["table", "quote"])
    expect(kinds("| a |\n|---|\n| 1 |\n# H | x")).toEqual(["table", "heading"])
    expect(kinds("| a |\n|---|\n| 1 |\nplain words")).toEqual(["table", "paragraph"])
    const ranged = positioned("| a |\n|---|\n| 1 |\nplain words")
    expect(ranged[0]!.range).toEqual({ location: 0, length: 17 })
    expect(ranged[1]!.range).toEqual({ location: 18, length: 11 })
  })

  it("splits a row into spans of its own line, the end pipes in none", () => {
    expect(rowSpans("| a | b |")).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }])
    expect(rowSpans("a|b")).toEqual([{ from: 0, to: 1 }, { from: 2, to: 3 }])
    expect(rowSpans("|a||b|")).toEqual([{ from: 1, to: 2 }, { from: 3, to: 3 }, { from: 4, to: 5 }])
  })
})

// MARK: - The incremental parser must agree with the whole one

let seed = 1
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]!

const LINES = [
  "", "", "", "words of a paragraph", "more words", "# Heading", "- bullet", "  indented", "> quote", "---", "```",
  "| a | b |", "| a | b |", "|---|---|", "|---|---|", "| :-- | --: |", "|---|", "a | b", "--- | ---", "| 1 | 2 |",
  "| 1 | 2 | 3 |", "| x \\| y |", "  | a | b |", "- a | b", "1. one | two", "| only", "| |", "|", "text | with pipe",
]
const FRAGMENTS = [
  "\n", "\n\n", "|", " | ", "---", "|---|---|", ":", "\\", "x", "- ", "> ", "# ", "```", "\n| a | b |\n|---|---|\n",
  "\n| 1 | 2 |", " ", "a b",
]
const randomDoc = (lines: number): string => Array.from({ length: lines }, () => pick(LINES)).join("\n")

describe("positionedUpdate with tables in the note", () => {
  it("equals a whole parse after every edit of long random chains of edits", () => {
    seed = 97
    let checked = 0
    for (let chain = 0; chain < 80; chain++) {
      let text = randomDoc(5 + Math.floor(rnd() * 40))
      let parsed = positioned(text)
      for (let step = 0; step < 60; step++) {
        const from = Math.floor(rnd() * (text.length + 1))
        const kind = rnd()
        const to = kind < 0.35 ? from : Math.min(text.length, from + Math.floor(rnd() * (rnd() < 0.2 ? 60 : 6)))
        const insert = kind < 0.2 ? "" : pick(FRAGMENTS) + (rnd() < 0.3 ? pick(FRAGMENTS) : "")
        const next = text.slice(0, from) + insert + text.slice(to)
        parsed = positionedUpdate(parsed, { from, toOld: to, toNew: from + insert.length }, linesOf(next))
        text = next
        const whole = positioned(text)
        if (JSON.stringify(parsed) !== JSON.stringify(whole)) {
          throw new Error(`chain ${chain} step ${step}: edit ${JSON.stringify({ from, to, insert })} on ${JSON.stringify(text)}\n`
            + `incremental ${JSON.stringify(parsed)}\nwhole       ${JSON.stringify(whole)}`)
        }
        checked++
      }
    }
    expect(checked).toBe(4800)
    // (And the pool does make tables, of every shape.)
    seed = 5
    let tables = 0
    for (let i = 0; i < 200; i++) tables += blocks(randomDoc(30)).filter((b) => b.kind === "table").length
    expect(tables).toBeGreaterThan(50)
  })

  it("gives a header back to the paragraph above when the delimiter row stops being one", () => {
    const text = "p1\n| a | b |\n|---|---|\n| 1 | 2 |"
    const old = positioned(text)
    expect(old.map((b) => b.block.kind)).toEqual(["paragraph", "table"])
    const at = text.indexOf("|---|")
    const next = text.slice(0, at) + "xyz" + text.slice(at + 9)
    const updated = positionedUpdate(old, { from: at, toOld: at + 9, toNew: at + 3 }, linesOf(next))
    expect(updated).toEqual(positioned(next))
    expect(updated.map((b) => b.block.kind)).toEqual(["paragraph"])
  })
})

// MARK: - Drawing it, and printing it

describe("the cells the rendered page draws", () => {
  it("knows where each cell's words start in the source, and pads short rows", () => {
    const source = "| Key | Does |\n|:---|---:|\n| Ctrl+B | **bold** |\n| x |"
    const rows = drawnRows(source, 2)
    expect(rows.map((row) => row.map((cell) => cell.source))).toEqual([["Key", "Does"], ["Ctrl+B", "**bold**"], ["x", ""]])
    for (const row of rows) {
      for (const cell of row) if (cell.source) expect(source.slice(cell.at, cell.at + cell.source.length)).toBe(cell.source)
    }
    // The padded cell's place is the end of its row's text.
    expect(rows[2]![1]!.at).toBe(source.length)
  })

  it("puts an empty cell's place after the space that pads it", () => {
    const source = "| a | b |\n|---|---|\n|  | x |"
    const empty = drawnRows(source, 2)[1]![0]!
    expect(empty.source).toBe("")
    expect(empty.at).toBe(source.lastIndexOf("|  |") + 2)
  })
})

describe("a table on paper", () => {
  it("is a real table: a header row, aligned cells, inline markdown and escaped pipes printed", () => {
    const table = blocks(KEYS + "\n| a \\| b | `x` |")[0]!
    const html = blockHtml(table)
    expect(html).toContain('<div class="table"><table><thead><tr><th style="text-align:left">Key</th><th style="text-align:right">Does</th></tr></thead>')
    expect(html).toContain('<td style="text-align:right"><b>bold</b></td>')
    expect(html).toContain('<td style="text-align:right"><i>italic</i></td>')
    expect(html).toContain('<td style="text-align:left">a | b</td>')
    expect(html).toContain("<code>x</code>")
    expect(html.match(/<tr>/g)).toHaveLength(4)
  })

  it("escapes what it prints", () => {
    const html = blockHtml({ kind: "table", header: ["<b>"], align: [null], rows: [["a & b"]] })
    expect(html).toContain("<th>&lt;b&gt;</th>")
    expect(html).toContain("<td>a &amp; b</td>")
  })
})

// MARK: - Tab and Return

describe("Tab between cells", () => {
  const source = "| Key | Does |\n|---|---|\n| Ctrl+B | bold |"
  const words = (step: ReturnType<typeof tableTab>) => step && source.slice(step.anchor, step.head)

  it("walks along the row, over the delimiter row, and selects the words of the cell it lands in", () => {
    expect(words(tableTab(source, 2, 2, false))).toBe("Does")
    const fromDoes = tableTab(source, source.indexOf("Does"), source.indexOf("Does"), false)
    expect(words(fromDoes)).toBe("Ctrl+B")
    expect(words(tableTab(source, source.indexOf("Ctrl"), source.indexOf("Ctrl") + 6, false))).toBe("bold")
  })

  it("walks back with Shift+Tab and stops at the first cell", () => {
    expect(words(tableTab(source, source.indexOf("bold"), source.indexOf("bold"), true))).toBe("Ctrl+B")
    expect(words(tableTab(source, source.indexOf("Ctrl"), source.indexOf("Ctrl"), true))).toBe("Does")
    expect(words(tableTab(source, 3, 3, true))).toBe("Key")
  })

  it("adds a row past the last cell, and puts the caret in its first cell", () => {
    const step = tableTab(source, source.indexOf("bold"), source.indexOf("bold"), false)!
    expect(step.change).toEqual({ from: source.length, to: source.length, insert: "\n|  |  |" })
    const after = source + step.change!.insert
    expect(after.slice(0, step.anchor).split("\n").pop()).toBe("| ")
    expect(blocks(after)[0]).toMatchObject({ kind: "table", rows: [["Ctrl+B", "bold"], ["", ""]] })
  })

  it("is not a table's business when the selection reaches over two lines", () => {
    expect(tableTab(source, 2, source.indexOf("Ctrl"), false)).toBeNull()
  })
})

describe("Return in a table", () => {
  const source = "| Key | Does |\n|---|---|\n| Ctrl+B | bold |"
  const apply = (step: NonNullable<ReturnType<typeof tableReturn>>) =>
    source.slice(0, step.change!.from) + step.change!.insert + source.slice(step.change!.to)

  it("adds an empty row under the caret's row, the caret in its first cell", () => {
    const step = tableReturn(source, source.indexOf("Ctrl"))!
    const after = apply(step)
    expect(after).toBe(source + "\n" + emptyRow(2))
    expect(step.anchor).toBe(source.length + 3)
  })

  it("in the header, adds the row under the delimiter row", () => {
    const after = apply(tableReturn(source, 4)!)
    expect(after.split("\n")).toEqual(["| Key | Does |", "|---|---|", "|  |  |", "| Ctrl+B | bold |"])
  })

  it("on an empty last row, ends the table: the row goes and the caret lands after a blank line", () => {
    const withEmpty = source + "\n|  |  |"
    const step = tableReturn(withEmpty, withEmpty.length - 3)!
    const after = withEmpty.slice(0, step.change!.from) + step.change!.insert + withEmpty.slice(step.change!.to)
    expect(after).toBe(source + "\n\n")
    expect(step.anchor).toBe(after.length)
  })

  it("leaves Return at the very start of the header alone (room above the table)", () => {
    expect(tableReturn(source, 0)).toBeNull()
  })
})
