import { describe, expect, it } from "vitest"
import { findVisible, hiddenInNote, positioned } from "../src/index"

/**
 * Find is exact (docs/PLAN-bars-2026-10.md P7 (e), Sean 2026-10-10: "be diligent to make sure the cell behavior, moving the
 * input cursor, search, and undo are all implemented properly"): the search runs over what the page shows. No Swift original.
 */
const run = (text: string, query: string, options = { caseSensitive: false, wholeWord: false }) =>
  findVisible(text, query, options, hiddenInNote(text, positioned(text)))
const slices = (text: string, query: string, options?: { caseSensitive: boolean; wholeWord: boolean }) =>
  run(text, query, options).map((m) => text.slice(m.location, m.location + m.length))

describe("what a note hides", () => {
  it("a markdown cell's marker line is hidden, newline and all", () => {
    const text = "One\n\n<!-- markdown -->\n**Two**"
    expect(hiddenInNote(text, positioned(text))).toEqual([[5, 5 + "<!-- markdown -->\n".length]])
  })

  it("a text cell's escapes' backslashes are hidden, and a markdown cell's backslashes are not", () => {
    const text = "a\\*b\n\n<!-- markdown -->\nc\\*d"
    const hidden = hiddenInNote(text, positioned(text))
    expect(hidden).toContainEqual([1, 2])
    expect(hidden.some(([from]) => from > 7 && from < 25 && text[from] === "\\")).toBe(false)
  })

  it("a text cell's id anchors are hidden", () => {
    const text = 'see <a id="wm-1"></a>here'
    const hidden = hiddenInNote(text, positioned(text))
    expect(hidden).toEqual([[4, 4 + '<a id="wm-1"></a>'.length]])
  })

  it("a note of plain text hides nothing", () => {
    const text = "One\n\nTwo\n\n- three"
    expect(hiddenInNote(text, positioned(text))).toEqual([])
  })
})

describe("finding what is shown", () => {
  it("finds the star a text cell shows: `a*b` is spelled `a\\*b` in the file, and the match covers the backslash", () => {
    const text = "star a\\*b done"
    const [match] = run(text, "a*b")
    expect(match).toEqual({ location: 5, length: 4 })
    expect(text.slice(match!.location, match!.location + match!.length)).toBe("a\\*b")
  })

  it("does not find the marker line: nobody can see it", () => {
    const text = "One\n\n<!-- markdown -->\nmarkdown words"
    expect(run(text, "markdown")).toEqual([{ location: 23, length: 8 }])
    expect(run(text, "<!--")).toEqual([])
  })

  it("is the plain search where nothing is hidden (positions are the source's)", () => {
    const text = "Alpha one\n\nalpha two"
    expect(run(text, "alpha")).toEqual([{ location: 0, length: 5 }, { location: 11, length: 5 }])
  })

  it("keeps the options: case and whole words", () => {
    const text = "Alpha alphabet alpha"
    expect(run(text, "alpha", { caseSensitive: true, wholeWord: false }).length).toBe(2)
    expect(run(text, "alpha", { caseSensitive: false, wholeWord: true }).length).toBe(2)
  })

  it("finds inside code and maths source (fences are cells whose source is what is shown)", () => {
    const text = "```python\nalpha = 1\n```\n\n```wl\nAlpha[x]\n```"
    expect(slices(text, "alpha")).toEqual(["alpha", "Alpha"])
  })

  it("finds across cells and in a markdown cell's own markup (the markdown side shows it)", () => {
    const text = "Alpha\n\n<!-- markdown -->\n**Alpha** two"
    expect(run(text, "alpha").length).toBe(2)
  })

  it("an empty query matches nothing, a regex is never read (the dot is a dot)", () => {
    expect(run("abc a.c", "")).toEqual([])
    expect(slices("abc a.c", "a.c")).toEqual(["a.c"])
    expect(slices("(x) [y]", "(x")).toEqual(["(x"])
  })

  it("on the rendered page a link's address is hidden too: it is drawn as its words", () => {
    const text = "[Alpha link](https://example.com/alpha)"
    const cells = positioned(text)
    expect(findVisible(text, "alpha", { caseSensitive: false, wholeWord: false }, hiddenInNote(text, cells)).length).toBe(2)
    expect(findVisible(text, "alpha", { caseSensitive: false, wholeWord: false }, hiddenInNote(text, cells, true)).length).toBe(1)
  })

  it("...but a code fence's brackets are code, not a link", () => {
    const text = "```js\nf](x)\n```"
    expect(hiddenInNote(text, positioned(text), true)).toEqual([])
  })
})
