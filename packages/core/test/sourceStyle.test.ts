import { describe, expect, it } from "vitest"
import { inlineSegments, sourceStyleRuns, type SourceKind } from "../src/markdown/sourceStyle"

/** Transcribed from `WriteMindTests/PreviewEditingTests.swift` (MarkdownSourceStyleTests). */
const kinds = (source: string): [string, SourceKind, number | undefined][] =>
  sourceStyleRuns(source).map((run) =>
    [source.slice(run.range.location, run.range.location + run.range.length), run.kind, run.level])

const has = (source: string, text: string, kind: SourceKind): boolean =>
  kinds(source).some(([t, k]) => t === text && k === kind)

describe("the markdown of a block, styled as it is typed", () => {
  it("steps the markers back and styles the text they wrap", () => {
    const runs = kinds("some **bold** and _italic_ text")
    expect(runs.some(([t, k]) => t === "**" && k === "marker")).toBe(true)
    expect(runs.some(([t, k]) => t === "bold" && k === "bold")).toBe(true)
    expect(runs.some(([t, k]) => t === "italic" && k === "italic")).toBe(true)
    expect(runs.filter(([, k]) => k === "marker")).toHaveLength(4)
  })

  it("makes a heading its own size without the hashes", () => {
    const runs = kinds("## Section")
    expect(runs[0]).toEqual(["## ", "marker", undefined])
    expect(runs.at(-1)).toEqual(["Section", "heading", 2])
  })

  it("does not read markdown in code, and sets maths apart as code", () => {
    const runs = kinds("`**not bold**` and `wl:Pi`")
    expect(runs.some(([t, k]) => t === "**not bold**" && k === "code")).toBe(true)
    expect(runs.some(([, k]) => k === "bold")).toBe(false)
    expect(runs.some(([t, k]) => t === "wl:" && k === "marker")).toBe(true)
    expect(runs.some(([t, k]) => t === "Pi" && k === "math")).toBe(true)
  })

  it("reads links, lists, quotes and the toolbar's own HTML", () => {
    expect(has("[here](Other.md#wm-1)", "here", "linkText")).toBe(true)
    expect(has("[here](Other.md#wm-1)", "Other.md#wm-1", "linkURL")).toBe(true)
    expect(has("- item", "- ", "listMarker")).toBe(true)
    expect(has("2. item", "2. ", "listMarker")).toBe(true)
    expect(has("> said", "> ", "quoteMarker")).toBe(true)
    expect(has("<u>under</u>", "<u>", "marker")).toBe(true)
    expect(has('<span style="color: #fff">x</span>', "</span>", "marker")).toBe(true)
  })

  it("never reaches past the text or makes an empty run", () => {
    for (const source of ["", "*", "**", "`", "[](", "# ", "- ", "_a_ **b** `c` [d](e) <u>f</u>"]) {
      for (const run of sourceStyleRuns(source)) {
        expect(run.range.location + run.range.length, source).toBeLessThanOrEqual(source.length)
        expect(run.range.length, source).toBeGreaterThan(0)
      }
    }
  })

  it("colours a fence's body for its language, and sets a wl fence apart as maths", () => {
    const code = "```ts\nconst x = 1\n```"
    expect(sourceStyleRuns(code).some((run) => run.kind === "codeToken" && run.token === "keyword")).toBe(true)
    const maths = "```wl\nIntegrate[x, x]\n```"
    expect(sourceStyleRuns(maths).some((run) => run.kind === "mathFence")).toBe(true)
  })
})

describe("the words of a line once the marks are put away", () => {
  const plain = (source: string) => inlineSegments(source).map((s) => s.text).join("")

  it("is the text with the markers gone", () => {
    expect(plain("some **bold** and _italic_ text")).toBe("some bold and italic text")
    expect(plain("a `code` b")).toBe("a code b")
    expect(plain("a [link](x.md) b")).toBe("a link b")
    expect(plain("<u>u</u> and ~~gone~~")).toBe("u and gone")
  })

  it("tags each stretch with its look", () => {
    const [a, b, , c] = inlineSegments("x **b** _i_")
    expect(a).toMatchObject({ text: "x ", from: 0 })
    expect(b).toMatchObject({ text: "b", bold: true, from: 4 })
    expect(c).toMatchObject({ text: "i", italic: true })
    expect(inlineSegments("~~s~~")[0]).toMatchObject({ strike: true })
    expect(inlineSegments("`c`")[0]).toMatchObject({ code: true })
  })

  it("keeps every segment's text the source slice it stands for", () => {
    const source = "a **b _c_ d** e [f](g) `h` <u>i</u>"
    for (const segment of inlineSegments(source)) {
      if (segment.image || segment.math) continue
      expect(source.slice(segment.from, segment.to)).toBe(segment.text)
    }
  })

  it("carries a link's destination on its words", () => {
    const segments = inlineSegments("see [here](Other.md#wm-1) now")
    expect(segments.find((s) => s.href)).toMatchObject({ text: "here", href: "Other.md#wm-1" })
    expect(segments.some((s) => s.text.includes("Other.md"))).toBe(false)
  })

  it("sets a wl: span as maths", () => {
    const segments = inlineSegments("so `wl:Pi` it is")
    expect(segments.find((s) => s.math)).toMatchObject({ math: "Pi" })
    expect(segments.map((s) => s.text).join("")).toBe("so Pi it is")
  })

  it("reads a picture", () => {
    const segments = inlineSegments("before ![a cat](cat.png) after")
    expect(segments.find((s) => s.image)?.image).toEqual({ alt: "a cat", src: "cat.png" })
    expect(segments.some((s) => s.text.includes("cat.png"))).toBe(false)
  })

  it("applies underline and the text-style span across what is between the tags", () => {
    const segments = inlineSegments('<u>one</u> <span style="color: #f00">two</span>')
    expect(segments.find((s) => s.text === "one")).toMatchObject({ underline: true })
    expect(segments.find((s) => s.text === "two")?.spanStyle).toBe("color: #f00")
    expect(segments.find((s) => s.text === " ")?.underline).toBeUndefined()
  })

  // Port-only: the run /link marks with <mark id=…> is drawn highlighted (the Mac hides the tags and draws it plain).
  it("highlights what is between <mark> tags and hides the tags", () => {
    const segments = inlineSegments('see <mark id="wm-12345678">this run</mark> now')
    expect(segments.find((s) => s.text === "this run")).toMatchObject({ highlight: true })
    expect(segments.map((s) => s.text).join("")).toBe("see this run now")
    expect(segments.find((s) => s.text === "see ")?.highlight).toBeUndefined()
  })

  it("leaves a tag inside code alone", () => {
    expect(plain("`<u>x</u>`")).toBe("<u>x</u>")
  })

  it("takes the backslash off an escaped mark", () => {
    expect(plain("a \\* b")).toBe("a * b")
    expect(plain("C:\\Users")).toBe("C:\\Users")
  })

  it("is empty for nothing", () => {
    expect(inlineSegments("")).toEqual([])
  })
})
