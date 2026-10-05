/**
 * The PDF export's pure half: what a cell looks like on paper and where the
 * sheets break. From `WriteMindTests/NotePDFTests.swift` — the half that does
 * not need a PDF reader (the page-plan arithmetic is `pagePlan.test.ts`; the
 * file that comes out is opened and looked at by the app's end-to-end script,
 * `agents/e2e/p1/t-export.mjs`).
 */
import { describe, expect, it } from "vitest"
import { BLOCK_CSS, blockHtml, codeHtml, headingLine, headingSize, PAGE } from "../src/export/blocks"
import { FALLBACK_PANE, GAP, columnWidth, exportPane, measureHtml, noteBlocks, printHtml, suggestedName } from "../src/export/document"
import { inkPieces, itemHtml } from "../src/export/drawing"
import { inlineHtml } from "../src/export/inline"
import { blocks, positioned } from "../src/markdown/parser"
import { noTransform, type CanvasItem, type Drawing } from "../src/drawing/model"

const media = { mediaUrl: (file: string) => `file:///media/${file}` }

describe("a note on paper: inline markdown", () => {
  it("bold, italic, strike, code and links", () => {
    expect(inlineHtml("a **bold** and _italic_ and ~~gone~~ word")).toBe(
      "a <b>bold</b> and <i>italic</i> and <s>gone</s> word")
    expect(inlineHtml("`x < y`")).toBe("<code>x &lt; y</code>")
    expect(inlineHtml("[a *b*](Some%20Note.md#wm-1)")).toContain('<a class="link" href="Some%20Note.md#wm-1">a <i>b</i></a>')
  })

  it("a link keeps an address only when a PDF reader should follow it", () => {
    expect(inlineHtml("[x](https://example.com/a?b=1&c=2)")).toContain('href="https://example.com/a?b=1&amp;c=2"')
    expect(inlineHtml("[x](javascript:alert(1))")).not.toContain("href")
    expect(inlineHtml("[x](file:///C:/secret.txt)")).not.toContain("href")
    expect(inlineHtml("[x](Other%20Note.md)")).toContain('href="Other%20Note.md"')
  })

  it("leaves markers that are not a style alone", () => {
    expect(inlineHtml("2 * 3 * 4")).toBe("2 * 3 * 4")
    expect(inlineHtml("snake_case_name")).toBe("snake_case_name")
    expect(inlineHtml("****")).toBe("****")
  })

  it("a code span keeps its stars", () => {
    expect(inlineHtml("`**not bold**`")).toBe("<code>**not bold**</code>")
  })

  it("other HTML stays literal text; the anchors /link writes are not on the page", () => {
    expect(inlineHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;")
    expect(inlineHtml('<a id="wm-1"></a>Heading')).toBe("Heading")
  })

  it("a span's colour is checked against the paper (testASpanColourIsCheckedAgainstThePaperItIsPrintedOn)", () => {
    const source = 'at <span style="color: #FFFF00">dawn</span>'
    // Yellow words would be blank paper; on screen the colour is left exactly as written.
    expect(inlineHtml(source, "#FFFFFF")).toContain("color:#000000")
    expect(inlineHtml('<span style="color: #2D7DD2">x</span>', "#FFFFFF")).toContain("color:#2D7DD2")
  })

  it("underline and a span's font and size", () => {
    expect(inlineHtml("<u>under</u>")).toContain("text-decoration:underline")
    const styled = inlineHtml('<span style="font-family: Georgia; font-size: 18px">big</span>')
    expect(styled).toContain("font-family:Georgia")
    expect(styled).toContain("font-size:18px")
    // Nothing else gets through the style.
    expect(inlineHtml('<span style="background:url(x); color: red">y</span>')).not.toContain("url(")
  })

  it("maths in a code span is typeset", () => {
    expect(inlineHtml("`wl:x^2`")).toContain("wm-math wm-math-inline")
    // in a line of prose maths is a linear run of text (like the notebook's), raised exponent and all: it cannot be
    // taller than its line, so it cannot run into the lines above and below it
    expect(inlineHtml("`wl:x^2`")).not.toContain("<math")
    expect(inlineHtml("`wl:x^2`")).toContain('<span class="wm-math-sz wm-math-up" style="font-size:0.7em;top:-0.5142857142857143em">2</span>')
    expect(inlineHtml("`wl:(a < b)/2`")).toContain("&lt;")
  })
})

describe("a note on paper: the cells", () => {
  const one = (markdown: string) => blockHtml(blocks(markdown)[0]!)

  it("the heading ladder is the Mac's 28/22/18/16/15 with the author line bigger than body", () => {
    expect([1, 2, 3, 4, 5, 6].map(headingSize)).toEqual([28, 22, 18, 16, 15, 17])
    expect(one("# Title")).toContain("font-size:28px;font-weight:700")
    expect(one("###### By me")).toContain("font-style:italic")
  })

  it("lists, to-dos, quotes, code and rules", () => {
    expect(one("- one\n- two")).toContain("•")
    expect(one("* one")).toContain("–")
    expect(one("1. one\n2. two")).toContain("2.")
    expect(one("- [x] done")).toContain("line-through")
    expect(one("> quoted")).toContain('class="quote"')
    expect(one("---")).toContain('class="rule"')
    expect(one("```ts\nlet a = 1\n```")).toContain('class="code"')
  })

  it("code is coloured with the Mac's light palette", () => {
    expect(codeHtml("let a = 1 // x", "ts")).toContain("color:#AD3DA4")
    expect(codeHtml("a < b", null)).toBe("a &lt; b")
  })

  it("a wl fence is set as maths, not shown as code", () => {
    expect(one("```wl\nx^2\n```")).toContain("wm-math-block")
  })

  it("a blank cell is as tall as its lines — the page's lines, 21.75 each", () => {
    const html = blockHtml({ kind: "blank", lines: 3 })
    expect(html).toContain("height:65.25px")
  })
})

// The ink was drawn on the rendered page of THIS app, and the paper is that page photographed onto a sheet: a cell
// that is taller on paper than on the page pushes every cell below it down the sheet, and a stroke under paragraph 6
// prints under paragraph 4 (verifier pclv10b-inkalign: 14 one-line paragraphs, 29.8 px between cells on the page and
// 36 on paper, because each PDF cell carried 3 px of padding above and below that the page does not have).
// `agents/e2e/Projectsandchromelane-fix1/e0-geometry.mjs` is the same comparison against the real page.
describe("a note on paper keeps the page's geometry (ink stays over the words it was drawn beside)", () => {
  const line = PAGE.line
  const pane = { width: 600, height: 700 }
  const topsOf = (markdown: string): number[] => {
    const printed = printHtml({ markdown, drawing: { items: [] }, pane, ...media }, positioned(markdown).map(() => line))
    return [...printed.html.matchAll(/class="blk" style="position:absolute;left:\d+px;top:([\d.]+)px/g)].map((m) => Number(m[1]))
  }

  it("the page's own numbers: 32 in, 16 down, 8 between, a line of 21.75", () => {
    expect([PAGE.left, PAGE.right, PAGE.top, PAGE.gap, PAGE.line]).toEqual([32, 36, 16, 8, 21.75])
    expect(GAP).toBe(8)
    expect(columnWidth({ width: 625, height: 626 })).toBe(557)
  })

  it("a cell has no padding of its own, and a paragraph's line is the page's line", () => {
    expect(BLOCK_CSS).not.toMatch(/\.blk\s*\{[^}]*padding/)
    expect(BLOCK_CSS).toContain(".para { font-size: 15px; line-height: 21.75px;")
    expect(BLOCK_CSS).toContain(".rule { padding: 8px 0; }")
    expect(BLOCK_CSS).toContain("padding: 12px 14px")
  })

  it("a heading is laid out in the box the page gives it (the type keeps the Mac's ladder)", () => {
    expect([1, 2, 3, 4, 5, 6].map(headingLine)).toEqual([32.4, 27.5, 27.55, 24.65, 23.2, 24.65])
    expect(blockHtml(blocks("## Two")[0]!)).toContain("font-size:22px;font-weight:600;line-height:27.5px")
  })

  const stroke = (id: string, y: number): CanvasItem => ({
    kind: "stroke",
    stroke: {
      id, colorHex: "#E02020", width: 2, group: null, transform: noTransform(),
      points: [{ x: 0.1, y }, { x: 0.6, y }],
    },
  })

  it("14 one-line paragraphs: a line drawn under paragraph k lands under paragraph k on paper", () => {
    const markdown = Array.from({ length: 14 }, (_, i) => `Paragraph number ${i + 1} sits here on its own line.`).join("\n\n")
    // the page: 16 down, then a line and a gap per paragraph — what the verifier measured, 29.75 apart
    const bottomOnPage = (k: number) => PAGE.top + (k - 1) * (line + GAP) + line
    const wanted = [2, 6, 11]
    const drawing: Drawing = { items: wanted.map((k) => stroke(`u${k}`, (bottomOnPage(k) + 1) / pane.height)) }
    const printed = printHtml({ markdown, drawing, pane, ...media }, Array.from({ length: 14 }, () => line))
    const cells = [...printed.html.matchAll(/<div class="blk" style="position:absolute;left:(\d+)px;top:([\d.]+)px;width:(\d+)px;height:([\d.]+)px">/g)]
      .map((m) => ({ left: Number(m[1]), top: Number(m[2]), height: Number(m[4]) }))
    expect(cells).toHaveLength(14)
    // 29.75 between cells, as on the page
    expect(cells[1]!.top - cells[0]!.top).toBeCloseTo(29.75, 5)
    expect(cells[13]!.top - cells[0]!.top).toBeCloseTo(13 * 29.75, 5)
    cells.forEach((cell) => expect(cell.left).toBe(32))
    // the strokes' y, in the same document coordinates the cells are in
    const lines = [...printed.html.matchAll(/<path d="M[\d.]+ ([\d.]+)L[\d.]+ ([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(lines).toHaveLength(3)
    wanted.forEach((k, index) => {
      const cell = cells[k - 1]!
      // within 2 px of paragraph k's bottom — and nowhere near any other paragraph's
      expect(Math.abs(lines[index]! - (cell.top + cell.height))).toBeLessThan(2)
      cells.forEach((other, at) => {
        if (at !== k - 1) expect(Math.abs(lines[index]! - (other.top + other.height))).toBeGreaterThan(20)
      })
    })
  })

  it("two blank lines are two gaps, one is one, none is one (the page draws each blank line as a gap of its own)", () => {
    expect(topsOf("# A\n# B")).toEqual([16, 16 + line + 8])
    expect(topsOf("# A\n\n# B")).toEqual([16, 16 + line + 8])
    expect(topsOf("# A\n\n\n# B")).toEqual([16, 16 + line + 16])
    // three blank lines: a gap, a cell one line tall, a gap
    expect(topsOf("# A\n\n\n\n# B")).toEqual([16, 16 + line + 8, 16 + line + 8 + line + 8])
    // blank lines before the first cell are gaps too
    expect(topsOf("\n\n# A")).toEqual([32])
    expect(topsOf("\n# A")).toEqual([24])
  })

  it("a rule or a code block straight under another cell takes no gap (their own padding is the air)", () => {
    expect(topsOf("# A\n---")).toEqual([16, 16 + line])
    expect(topsOf("# A\n```\nx\n```")).toEqual([16, 16 + line])
    expect(topsOf("# A\n\n---")).toEqual([16, 16 + line + 8])
    expect(topsOf("# A\n> q")).toEqual([16, 16 + line + 8])
  })
})

describe("a note on paper: the sheets", () => {
  const input = (markdown: string, drawing: Drawing = { items: [] }) =>
    ({ markdown, drawing, pane: { width: 600, height: 700 }, ...media })

  it("the file is named after the note", () => {
    expect(suggestedName("C:\\notes\\Trip to Rome.md")).toBe("Trip to Rome.pdf")
    expect(suggestedName("/n/a.b.markdown")).toBe("a.b.pdf")
  })

  it("a pane that is not a size is the fallback", () => {
    expect(exportPane({ width: 0, height: 0 })).toEqual(FALLBACK_PANE)
    expect(exportPane({ width: 800, height: 500 })).toEqual({ width: 800, height: 500 })
  })

  it("measures one box per cell, in the pane's column", () => {
    const parts = noteBlocks("# A\n\nbody\n\n- x")
    expect(parts).toHaveLength(3)
    const html = measureHtml(parts, { width: 600, height: 700 })
    expect(html.match(/class="blk"/g)).toHaveLength(3)
    // the page's text column: the pane less its 32 px on the left and 36 on the right (it was the Mac's 28 either side)
    expect(html).toContain("width: 532px")
    expect(html).toContain("margin: 16px 0 0 32px")
  })

  it("cells are placed one gap (8) apart from the page's own top (16) down, and a note that fits is one sheet", () => {
    const printed = printHtml(input("# A\n\nbody"), [40, 30])
    expect(printed.pages).toBe(1)
    expect(printed.html).toContain("left:32px;top:16px;width:532px;height:40px")
    expect(printed.html).toContain("left:32px;top:64px;width:532px;height:30px")
    expect(printed.sheets!.pages[0]!.left).toBe(54)
  })

  it("a break lands between cells and never inside one", () => {
    // 600 wide on 504 of paper: fit .84; a sheet holds 684/.84 = 814pt of document.
    const heights = [400, 400, 400]
    const printed = printHtml(input("a\n\nb\n\nc"), heights)
    expect(printed.pages).toBe(2)
    expect(printed.sheets!.pages.map((page) => page.pieces)).toEqual([[0, 1], [2]])
    // The second sheet starts at the top of the cell that moved to it.
    expect(printed.sheets!.pages[1]!.top).toBe(16 + 2 * 408)
  })

  it("a note with nothing in it is one blank sheet", () => {
    expect(printHtml(input(""), []).pages).toBe(1)
  })

  it("the drawing goes over the text, on the sheet where its box lies, and welds what it touches", () => {
    const stroke: CanvasItem = {
      kind: "stroke",
      stroke: {
        id: "s", colorHex: "#2D7DD2", width: 3, group: null, transform: noTransform(),
        points: [{ x: 0.2, y: 0.8 }, { x: 0.7, y: 0.85 }],
      },
    }
    const printed = printHtml(input("# A\n\nbody", { items: [stroke] }), [40, 30])
    expect(printed.pages).toBe(1)
    expect(printed.html).toContain("<svg")
    expect(printed.html.indexOf('class="blk"')).toBeLessThan(printed.html.indexOf("<svg"))
  })

  it("ink that would vanish on paper is darkened (testAPenColourThatWouldVanishOnPaperIsDarkened)", () => {
    const item: CanvasItem = {
      kind: "stroke",
      stroke: { id: "s", colorHex: "#FFFF00", width: 3, group: null, transform: noTransform(), points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] },
    }
    expect(itemHtml(item, { width: 600, height: 700 }, media)).toContain('stroke="#000000"')
    item.stroke.colorHex = "#2D7DD2"
    expect(itemHtml(item, { width: 600, height: 700 }, media)).toContain('stroke="#2D7DD2"')
  })

  it("a picture is an SVG image and a hidden one is not printed", () => {
    const image: CanvasItem = {
      kind: "image",
      image: { id: "i", file: "trace.png", center: { x: 0.5, y: 0.5 }, width: 0.5, aspect: 1, transform: noTransform(), hidden: false, group: null },
    }
    const pieces = inkPieces({ items: [image] }, { width: 80, height: 80 }, media)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]!.html).toContain('href="file:///media/trace.png"')
    expect(pieces[0]!.frame).toEqual({ x: 20, y: 20, width: 40, height: 40 })
    image.image.hidden = true
    expect(inkPieces({ items: [image] }, { width: 80, height: 80 }, media)).toHaveLength(0)
  })

  it("an empty text box prints nothing, a full one prints its words", () => {
    const box = (label: string, fillHex: string | null): CanvasItem => ({
      kind: "shape",
      shape: {
        id: "t", kind: "text", center: { x: 0.5, y: 0.5 }, width: 0.4, aspect: 0.3, colorHex: "#1C1C1E", lineWidth: 2,
        fillHex, label, transform: noTransform(), group: null,
      },
    })
    expect(itemHtml(box("", null), { width: 600, height: 600 }, media)).toBe("")
    expect(itemHtml(box("Hello <b>", null), { width: 600, height: 600 }, media)).toContain("Hello &lt;b&gt;")
    // Words in a pen colour that cannot be read on the card are changed to ones that can.
    expect(itemHtml(box("x", "#101010"), { width: 600, height: 600 }, media)).toContain("color:#FFFFFF")
  })
})
