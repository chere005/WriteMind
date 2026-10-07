// Port-only: no XCTest. A note as the cells of a Wolfram notebook (src/export/wolfram/plan.ts): every row of the
// mapping, the slots the kernel answers, and what a cell is without its answer.
import { describe, expect, it } from "vitest"
import {
  drawingCode, inkIdsIn, listDepth, wolframPlan, type PlannedCell, type ResolvedPicture, type WolframMedia, type WolframPlan,
} from "../src/export/wolfram/plan"

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const OTHER = "0a0b0c0d-1111-4222-8333-444455556666"
const NO_MEDIA: WolframMedia = { inks: {}, bands: [], column: 700 }

/** A cell as text, its slots as `<as:job>`. */
const render = (cell: PlannedCell): string =>
  cell.pieces.map((piece) => (typeof piece === "string" ? piece : `<${piece.as}:${piece.job}>`)).join("")
const plan = (markdown: string, media: WolframMedia = NO_MEDIA, pictures: Map<string, ResolvedPicture | null> = new Map(),
  use: "file" | "clipboard" = "file"): WolframPlan => wolframPlan(markdown, media, pictures, use)
const cells = (markdown: string, media?: WolframMedia, pictures?: Map<string, ResolvedPicture | null>): string[] =>
  plan(markdown, media, pictures).cells.map(render)

describe("words", () => {
  it("makes the heading ladder the notebook's own styles", () => {
    expect(cells("# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F")).toEqual([
      `Cell["A", "Title"]`, `Cell["B", "Chapter"]`, `Cell["C", "Section"]`, `Cell["D", "Subsection"]`,
      `Cell["E", "Subsubsection"]`, `Cell["F", "Author"]`,
    ])
  })

  it("keeps a text cell's words and line breaks as typed, escapes gone", () => {
    expect(cells("one \\*two*\nthree \\# and \"quoted\"")).toEqual([`Cell["one *two*\\nthree # and \\"quoted\\"", "Text"]`])
  })

  it("writes a markdown cell's runs as StyleBoxes, and a plain one as a string", () => {
    expect(cells("<!-- markdown -->\nplain words")).toEqual([`Cell["plain words", "Text"]`])
    expect(cells("<!-- markdown -->\n**b** _i_ ~~s~~ <u>u</u> <mark id=\"wm-1\">h</mark> `c`")).toEqual([
      `Cell[TextData[{StyleBox["b", FontWeight -> "Bold"], " ", StyleBox["i", FontSlant -> "Italic"], " ", `
      + `StyleBox["s", FontVariations -> {"StrikeThrough" -> True}], " ", StyleBox["u", FontVariations -> {"Underline" -> True}], " ", `
      + `StyleBox["h", Background -> RGBColor[1., 0.953, 0.627]], " ", StyleBox["c", FontFamily -> "Source Code Pro"]}], "Text"]`,
    ])
  })

  it("takes a span's font, size and colour, and swaps a colour white paper cannot show", () => {
    expect(cells(`<!-- markdown -->\n<span style="font-family: Georgia; font-size: 18px; color: #FFFFF0">x</span>`)).toEqual([
      `Cell[TextData[{StyleBox["x", FontFamily -> "Georgia", FontSize -> 18, FontColor -> RGBColor[0.000, 0.000, 0.000]]}], "Text"]`,
    ])
  })

  it("links the web and mail, and keeps any other link's words alone", () => {
    expect(cells("<!-- markdown -->\n[site](https://a.b/c) [me](mailto:x@y.z) [js](javascript:void) [note](Other.md)")).toEqual([
      `Cell[TextData[{ButtonBox["site", BaseStyle -> "Hyperlink", ButtonData -> {URL["https://a.b/c"], None}, ButtonNote -> "https://a.b/c"], " ", `
      + `ButtonBox["me", BaseStyle -> "Hyperlink", ButtonData -> {URL["mailto:x@y.z"], None}, ButtonNote -> "mailto:x@y.z"], " ", "js", " ", "note"}], "Text"]`,
    ])
  })

  it("makes inline maths an InlineFormula the kernel typesets, its source the fallback", () => {
    const one = plan("<!-- markdown -->\nsay `wl:y = 2x` here")
    expect(render(one.cells[0]!)).toBe(`Cell[TextData[{"say ", <inline:wl-1.wl>, " here"}], "Text"]`)
    expect(one.jobs).toEqual([{ name: "wl-1.wl", text: "y == 2*x" }])
    const slot = one.cells[0]!.pieces.find((piece) => typeof piece !== "string")
    expect(slot).toMatchObject({ as: "inline", fallback: `Cell[BoxData["y == 2*x"], "InlineFormula"]` })
  })

  it("writes an inline picture as its alt words", () => {
    expect(cells("<!-- markdown -->\nsee ![a cat](x.png) here")).toEqual([`Cell["see a cat here", "Text"]`])
  })

  it("writes a quote as an italic Text cell with a bar", () => {
    expect(cells("> said")).toEqual([`Cell["said", "Text", CellFrame -> {{3, 0}, {0, 0}}, CellFrameColor -> GrayLevel[0.7], FontSlant -> "Italic"]`])
  })

  it("writes a rule as an empty framed cell, and nothing for blank lines", () => {
    expect(cells("a\n\n---\n\n\n\n\nb")).toEqual([
      `Cell["a", "Text"]`, `Cell["", "Text", CellFrame -> {{0, 0}, {1, 0}}, CellFrameColor -> GrayLevel[0.78], Editable -> False]`, `Cell["b", "Text"]`,
    ])
  })
})

describe("lists", () => {
  it("reads an item's depth off its indentation, a tab four columns", () => {
    expect(["- a", "  - a", "    - a", "      - a", "        - a", "\t- a"].map(listDepth)).toEqual([0, 1, 1, 2, 2, 1])
  })

  it("makes one cell per item, Item / Subitem / Subsubitem, a dash list with its dingbat", () => {
    expect(cells("- a\n  - b\n      - c")).toEqual([`Cell["a", "Item"]`, `Cell["b", "Subitem"]`, `Cell["c", "Subsubitem"]`])
    expect(cells("* a")).toEqual([`Cell["a", "Item", CellDingbat -> "\\:2013"]`])
  })

  it("numbers each list from one: its first item resets the counter", () => {
    expect(cells("1. a\n2. b\n   3. c\n\nwords\n\n1. again")).toEqual([
      `Cell["a", "ItemNumbered", CounterAssignments -> {{"ItemNumbered", 0}}]`, `Cell["b", "ItemNumbered"]`,
      `Cell["c", "SubitemNumbered"]`, `Cell["words", "Text"]`,
      `Cell["again", "ItemNumbered", CounterAssignments -> {{"ItemNumbered", 0}}]`,
    ])
  })

  it("writes a to-do with its box, and a done one struck and grey", () => {
    expect(cells("- [ ] milk\n- [x] eggs **now**")).toEqual([
      `Cell[TextData[{"\\:2610 ", "milk"}], "Item"]`,
      `Cell[TextData[{"\\:2611 ", StyleBox["eggs ", FontVariations -> {"StrikeThrough" -> True}, FontColor -> GrayLevel[0.5]], `
      + `StyleBox[StyleBox["now", FontWeight -> "Bold"], FontVariations -> {"StrikeThrough" -> True}, FontColor -> GrayLevel[0.5]]}], "Item"]`,
    ])
  })
})

describe("a table", () => {
  it("is a GridBox with rules, its header bold, each column aligned, a styled entry its own cell", () => {
    expect(cells("| A | B | C |\n|:-|:-:|--:|\n| 1 | **2** | 3 |")).toEqual([
      `Cell[TextData[{Cell[BoxData[GridBox[{{StyleBox["A", FontWeight -> "Bold"], StyleBox["B", FontWeight -> "Bold"], StyleBox["C", FontWeight -> "Bold"]}, `
      + `{"1", Cell[TextData[{StyleBox["2", FontWeight -> "Bold"]}]], "3"}}, GridBoxDividers -> {"Columns" -> {{True}}, "Rows" -> {{True}}}, `
      + `GridBoxAlignment -> {"Columns" -> {Left, Center, Right}}]]]}], "Text"]`,
    ])
  })
})

describe("code, runs and answers", () => {
  it("makes Wolfram code an Input cell, Python an ExternalLanguage cell, anything else a Program cell", () => {
    expect(cells("```wolfram\nPlot[x]\n```\n\n```mathematica\n1\n```\n\n```wls\n2\n```\n\n```m\n3\n```")).toEqual([
      `Cell[BoxData["Plot[x]"], "Input"]`, `Cell[BoxData["1"], "Input"]`, `Cell[BoxData["2"], "Input"]`, `Cell[BoxData["3"], "Input"]`,
    ])
    expect(cells("```python\nprint(1)\n```\n\n```py\n2\n```")).toEqual([
      `Cell["print(1)", "ExternalLanguage", CellEvaluationLanguage -> "Python"]`, `Cell["2", "ExternalLanguage", CellEvaluationLanguage -> "Python"]`,
    ])
    expect(cells("```rust\nfn main() {}\n```\n\n```\nplain\n```")).toEqual([`Cell["fn main() {}", "Program"]`, `Cell["plain", "Program"]`])
  })

  it("makes runnable cells the same, by the language they run", () => {
    expect(cells("```eval wl\n1+1\n```\n\n```eval python\nprint(2)\n```\n\n```eval c\nint main(){}\n```\n\n```eval c++\nx\n```\n\n```eval rust\ny\n```")).toEqual([
      `Cell[BoxData["1+1"], "Input"]`, `Cell["print(2)", "ExternalLanguage", CellEvaluationLanguage -> "Python"]`,
      `Cell["int main(){}", "Program"]`, `Cell["x", "Program"]`, `Cell["y", "Program"]`,
    ])
  })

  it("makes an answer an Output cell, the fence's escape taken off, and writes nothing for no output", () => {
    expect(cells("```out\n4\n\\```still output\n[stderr]\noops\n```")).toEqual([`Cell["4\\n\`\`\`still output\\n[stderr]\\noops", "Output"]`])
    expect(cells("```out\n[no output]\n```")).toEqual([])
  })

  it("makes a maths cell an Input the kernel typesets, in the kernel's spelling, its source the fallback", () => {
    const one = plan("```wl\nf(2) =\n  4\n```")
    expect(one.cells.map(render)).toEqual(["<maths:wl-1.wl>"])
    expect(one.jobs).toEqual([{ name: "wl-1.wl", text: "f[2] == 4" }])
    expect(one.cells[0]!.pieces[0]).toMatchObject({ fallback: `Cell[BoxData["f[2] == 4"], "Input", TaggingRules -> {"WriteMind" -> "maths"}]` })
  })

  it("asks the kernel once for the same maths written twice", () => {
    const one = plan("```wl\nx^2\n```\n\n<!-- markdown -->\nand `wl:x^2`")
    expect(one.jobs).toEqual([{ name: "wl-1.wl", text: "x^2" }])
    expect(one.cells.map(render)).toEqual(["<maths:wl-1.wl>", `Cell[TextData[{"and ", <inline:wl-1.wl>}], "Text"]`])
  })
})

describe("drawings and pictures", () => {
  const ink = { svg: `<svg width="400"/>`, shown: 400 }
  const line = `![ink](.drawings/media/ink-${ID}.svg)`

  it("makes a drawing cell an image the kernel makes from its svg, and a closed initialization cell without it", () => {
    const one = plan(line, { ...NO_MEDIA, inks: { [ID]: ink } })
    expect(one.cells).toHaveLength(1)
    expect(one.cells[0]!.drawing).toBe(true)
    expect(render(one.cells[0]!)).toBe("<image:ink-1.svg>")
    expect(one.jobs).toEqual([{ name: "ink-1.svg", text: ink.svg }])
    expect(one.images).toBe(1)
    expect(one.cells[0]!.pieces[0]).toMatchObject({
      tag: "ink",
      fallback: `Cell[BoxData[${JSON.stringify(drawingCode(ink.svg, 400, "drawing"))}], "Input", CellOpen -> False, InitializationCell -> True, TaggingRules -> {"WriteMind" -> "ink"}]`,
    })
    expect(drawingCode(ink.svg, 400, "drawing")).toBe(`(* WriteMind: a drawing. Evaluate this cell to see it. *)\n`
      + `Image[ImportString["<svg width=\\"400\\"/>", {"SVG", "Image"}, ImageResolution -> 144], ImageSize -> 400]`)
  })

  it("leaves the fallback open, with no initialization, on the clipboard", () => {
    const one = plan(line, { ...NO_MEDIA, inks: { [ID]: ink } }, new Map(), "clipboard")
    expect(one.use).toBe("clipboard")
    expect((one.cells[0]!.pieces[0] as { fallback: string }).fallback).toMatch(/"Input", TaggingRules -> \{"WriteMind" -> "ink"\}\]$/)
  })

  it("asks the kernel once for one drawing shown twice", () => {
    const one = plan(`${line}\n\n${line}`, { ...NO_MEDIA, inks: { [ID]: ink } })
    expect(one.jobs.map((job) => job.name)).toEqual(["ink-1.svg"])
    expect(one.cells.map(render)).toEqual(["<image:ink-1.svg>", "<image:ink-1.svg>"])
  })

  it("draws a drawing cell the sidecar has no item for from its snapshot file, and says so when there is neither", () => {
    const snapshot: ResolvedPicture = { kind: "file", path: "/media/ink.svg", format: "SVG" }
    const orphan = plan(line, NO_MEDIA, new Map([[`ink-${ID}.svg`, snapshot]]))
    expect(orphan.cells.map(render)).toEqual(["<image:pic-1.txt>"])
    expect(orphan.jobs).toEqual([{ name: "pic-1.txt", text: `{"/media/ink.svg", 640}` }])
    expect(orphan.cells[0]!.pieces[0]).toMatchObject({ tag: "picture", fallback: { picture: "/media/ink.svg", format: "SVG", shown: 640 } })
    expect(cells(`![ink](.drawings/media/ink-${OTHER}.svg)`)).toEqual([`Cell["Drawing (not found)", "Text", FontColor -> GrayLevel[0.55]]`])
  })

  it("makes a picture an image of its file, shown no wider than the column or 640 points", () => {
    const found: ResolvedPicture = { kind: "file", path: "C:\\media\\cat \"1\".png", format: "PNG" }
    const one = plan("![a cat](.drawings/media/cat.png)", { ...NO_MEDIA, column: 500 }, new Map([["cat.png", found]]))
    expect(one.jobs).toEqual([{ name: "pic-1.txt", text: `{"C:\\\\media\\\\cat \\"1\\".png", 500}` }])
    expect(one.cells[0]!.drawing).toBe(false)
  })

  it("makes a Mac PDF capture an image of its converted svg", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100" viewBox="0 0 640 200"></svg>`
    const one = plan("![](.drawings/media/trace.pdf)", NO_MEDIA, new Map([["trace.pdf", { kind: "svg", svg }]]))
    expect(one.jobs).toEqual([{ name: "pdf-1.svg", text: svg }])
    expect((one.cells[0]!.pieces[0] as { fallback: string }).fallback).toContain(`ImageSize -> 320`)
    expect((one.cells[0]!.pieces[0] as { fallback: string }).fallback).toContain("a picture. Evaluate")
  })

  it("makes a missing picture its words in grey italics, and a picture on the web a link", () => {
    expect(cells("![lost one](.drawings/media/gone.png)")).toEqual([
      `Cell[TextData[StyleBox["lost one", FontSlant -> "Italic"]], "Text", FontColor -> GrayLevel[0.55]]`,
    ])
    expect(cells("![](.drawings/media/gone.png)")).toEqual([
      `Cell[TextData[StyleBox["gone.png", FontSlant -> "Italic"]], "Text", FontColor -> GrayLevel[0.55]]`,
    ])
    expect(cells("![a cat](https://example.com/cat.png)")).toEqual([
      `Cell[TextData[{ButtonBox["a cat", BaseStyle -> "Hyperlink", ButtonData -> {URL["https://example.com/cat.png"], None}, ButtonNote -> "https://example.com/cat.png"]}], "Text"]`,
    ])
  })

  it("places each floating band after the cell it floats beside, or before them all", () => {
    const media: WolframMedia = {
      ...NO_MEDIA,
      bands: [{ svg: "<b2/>", shown: 100, after: 3 }, { svg: "<b1/>", shown: 100, after: null }, { svg: "<b3/>", shown: 100, after: 999 }],
    }
    const one = plan("a\n\nb\n\nc", media)
    // (Jobs are numbered in the order the cells are written.)
    expect(one.cells.map(render)).toEqual(["<image:band-1.svg>", `Cell["a", "Text"]`, `Cell["b", "Text"]`, "<image:band-2.svg>", `Cell["c", "Text"]`, "<image:band-3.svg>"])
    expect(one.jobs.map((job) => job.text)).toEqual(["<b1/>", "<b2/>", "<b3/>"])
    expect(one.cells.filter((cell) => cell.drawing)).toHaveLength(3)
    expect(one.images).toBe(3)
  })

  it("names the drawing cells a markdown holds, each once", () => {
    expect(inkIdsIn(`${`![ink](.drawings/media/ink-${ID}.svg)`}\n\n![](.drawings/media/cat.png)\n\n![ink](../.drawings/media/ink-${ID.toUpperCase()}.svg)`)).toEqual([ID])
    expect(inkIdsIn("words only")).toEqual([])
  })
})
