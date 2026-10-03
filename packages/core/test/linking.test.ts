import { describe, expect, it } from "vitest"
import {
  anchorIn, anchorOffset, justTypedTrigger, linkMarkdown, parseLink, slug, triggerRange,
} from "../src/notes/linking"
import {
  allOccurrences, applySpan, nextOccurrence, normalise, removeSpan, selectNextOccurrence,
  spanCSS, spanIsEmpty, styleFromTag, wordRange, type SpanStyle,
} from "../src/markdown/spans"
import { applied, range } from "../src/text/range"

const id = () => "wm-test0001"

/** Transcribed from `WriteMindTests/SpanAndSelectionTests.swift`. */
describe("MarkdownLinking", () => {
  it("makes the slug a markdown renderer would", () => {
    expect(slug("The bar")).toBe("the-bar")
    expect(slug("Notes & Ideas — 2026!")).toBe("notes-ideas-2026")
    expect(slug("!!!")).toBe("section")
  })

  it("marks a highlighted run and links it in the target", () => {
    const anchor = anchorIn("before dawn after", range(7, 5), id)
    expect(anchor.title).toBe("dawn")
    expect(anchor.rewrittenText).toBe('before <mark id="wm-test0001">dawn</mark> after')
    expect(anchor.id.startsWith("wm-")).toBe(true)
  })

  it("uses a heading's slug for a caret on it and writes nothing", () => {
    const anchor = anchorIn("# Title\n\n## The bar\n\nbody", range(12, 0), id)
    expect(anchor.id).toBe("the-bar")
    expect(anchor.title).toBe("The bar")
    expect(anchor.rewrittenText).toBeNull()
  })

  it("puts an anchor in front of any other block", () => {
    const anchor = anchorIn("# Title\n\nthe whole block here", range(12, 0), id)
    expect(anchor.rewrittenText).toBe('# Title\n\n<a id="wm-test0001"></a>the whole block here')
    expect(anchor.title).toBe("the whole block here")
  })

  it("encodes the file name and carries the anchor", () => {
    expect(linkMarkdown("The bar", "My Note.md", "the-bar")).toBe("[The bar](My%20Note.md#the-bar)")
    expect(linkMarkdown("Whole", "A.md", null)).toBe("[Whole](A.md)")
  })

  it("fires the trigger only at a word boundary", () => {
    expect(justTypedTrigger("see /link", 9)).toBe(true)
    expect(justTypedTrigger("/link", 5)).toBe(true)
    expect(justTypedTrigger("docs/link", 9)).toBe(false)
    expect(justTypedTrigger("see /link ", 10)).toBe(false)
  })

  it("finds the trigger again after the caret has moved on", () => {
    const text = "one /link two"
    expect(triggerRange(text, 9)).toEqual(range(4, 5))
    expect(triggerRange(text, 13)).toEqual(range(4, 5))
    expect(triggerRange("nothing here", 3)).toBeNull()
  })

  it("treats a whitespace-only selection as a caret in that block", () => {
    const heading = anchorIn("# Title\n\nbody here", range(7, 2), id)
    expect(heading.rewrittenText).toBeNull()
    expect(heading.id).toBe("title")
    const plain = anchorIn("body here\n", range(9, 1), id)
    expect(plain.rewrittenText).toBe('<a id="wm-test0001"></a>body here\n')
  })
})

describe("SpanStyle", () => {
  const style: SpanStyle = { family: "Georgia", size: 18, colorHex: "#2D7DD2" }
  const run = (text: string, change: ReturnType<typeof applySpan>) => applied(text, change).text

  it("names only the parts that are set", () => {
    expect(spanCSS(style)).toBe("font-family: Georgia; font-size: 18px; color: #2D7DD2")
    expect(spanCSS({ size: 20 })).toBe("font-size: 20px")
    expect(spanIsEmpty({})).toBe(true)
  })
  it("wraps the selection and keeps the word selected", () => {
    const edit = applySpan("at dawn", range(3, 4), style)
    const out = run("at dawn", edit)
    expect(out).toBe('at <span style="font-family: Georgia; font-size: 18px; color: #2D7DD2">dawn</span>')
    expect(out.slice(edit.selection.location, edit.selection.location + edit.selection.length)).toBe("dawn")
  })
  it("replaces an existing span rather than nesting", () => {
    const text = '<span style="color: #FF0000">dawn</span>'
    expect(run(text, applySpan(text, range(0, text.length), { size: 20 })))
      .toBe('<span style="font-size: 20px">dawn</span>')
  })
  it("finds the span when only its text is selected", () => {
    const text = 'a <span style="color: #FF0000">dawn</span> b'
    expect(text.slice(31, 35)).toBe("dawn")
    expect(run(text, applySpan(text, range(31, 4), { size: 20 }))).toBe('a <span style="font-size: 20px">dawn</span> b')
  })
  it("strips the span for an empty style", () => {
    const text = 'a <span style="color: #FF0000">dawn</span> b'
    expect(run(text, removeSpan(text, range(31, 4)))).toBe("a dawn b")
  })
  it("parses the tag back into a style", () => {
    const parsed = styleFromTag("<span style=\"font-family: 'Georgia'; font-size: 18px; color: #2D7DD2\">")
    expect(parsed).toEqual({ family: "Georgia", size: 18, colorHex: "#2D7DD2" })
  })
})

describe("select next occurrence", () => {
  const step = (text: string, ranges: ReturnType<typeof range>[], wholeWord = false) =>
    selectNextOccurrence(text, ranges, wholeWord)

  it("takes the word under and before the caret", () => {
    const text = "let total = total_count"
    expect(wordRange(text, 5)).toEqual(range(4, 5))
    expect(wordRange(text, 9)).toEqual(range(4, 5))
    expect(wordRange(text, 13)).toEqual(range(12, 11))
  })
  it("is null on empty space and empty text", () => {
    expect(wordRange("a  b", 2)).toBeNull()
    expect(wordRange("", 0)).toBeNull()
  })
  it("the first press takes the word and turns on whole-word matching", () => {
    const first = step("one two one", [range(1, 0)])
    expect(first?.ranges).toEqual([range(0, 3)])
    expect(first?.wholeWord).toBe(true)
  })
  it("each press adds the next occurrence, then there are none", () => {
    const text = "one two one two one"
    let ranges = [range(0, 3)]
    for (const expected of [8, 16]) {
      const next = step(text, ranges, true)!
      expect(next.reveal).toEqual(range(expected, 3))
      ranges = next.ranges
    }
    expect(ranges).toHaveLength(3)
    expect(step(text, ranges, true)).toBeNull()
  })
  it("whole-word matching skips the word inside another", () => {
    const text = "one oneself one"
    expect(step(text, [range(0, 3)], true)?.reveal).toEqual(range(12, 3))
    expect(step(text, [range(0, 3)], false)?.reveal).toEqual(range(4, 3))
  })
  it("wraps to the top", () => {
    expect(step("one two one", [range(8, 3)], true)?.reveal).toEqual(range(0, 3))
  })
  it("never selects overlapping matches", () => {
    const next = step("aaaa", [range(0, 2)])
    expect(next?.reveal).toEqual(range(2, 2))
    expect(next?.ranges).toEqual([range(0, 2), range(2, 2)])
  })
  it("clamps stale ranges rather than failing", () => {
    const next = step("one", [range(0, 3), range(40, 3)])
    expect(next?.ranges.some((r) => r.location + r.length > 3) ?? false).toBe(false)
  })
  it("normalises duplicates and order", () => {
    expect(normalise([range(8, 3), range(0, 3), range(0, 3)], 11)).toEqual([range(0, 3), range(8, 3)])
  })
  it("leaves no word under the caret alone", () => {
    expect(step("a  b", [range(2, 0)])).toBeNull()
    expect(step("", [range(0, 0)])).toBeNull()
    expect(step("abc", [])).toBeNull()
  })
  it("select-all takes every match and honours word bounds", () => {
    expect(allOccurrences("one oneself one", "one", true)).toEqual([range(0, 3), range(12, 3)])
    expect(allOccurrences("one oneself one", "one", false)).toHaveLength(3)
  })
  it("a term spanning lines still matches, and an empty term matches nothing", () => {
    expect(step("a\nb x a\nb", [range(0, 3)])?.reveal).toEqual(range(6, 3))
    expect(nextOccurrence("abc", "", 0, [])).toBeNull()
  })
})

describe("following a link", () => {
  it("parses the file and the anchor, decoding the name", () => {
    expect(parseLink("My%20Note.md#the-bar")).toEqual({ file: "My Note.md", anchor: "the-bar" })
    expect(parseLink("A.md")).toEqual({ file: "A.md", anchor: null })
    expect(parseLink("A.md#")).toEqual({ file: "A.md", anchor: null })
  })
  it("finds a written anchor", () => {
    const text = 'one\n\nbefore <mark id="wm-1234abcd">dawn</mark> after\n\n<a id="wm-ffff0000"></a>block'
    expect(anchorOffset(text, "wm-1234abcd")).toBe(text.indexOf("<mark"))
    expect(anchorOffset(text, "wm-ffff0000")).toBe(text.indexOf("<a id"))
  })
  it("finds a heading by its slug", () => {
    const text = "# Title\n\n## The bar\n\nbody"
    expect(anchorOffset(text, "the-bar")).toBe(text.indexOf("## The bar"))
    expect(anchorOffset(text, "title")).toBe(0)
  })
  it("is null for a place that is gone", () => {
    expect(anchorOffset("# Title", "wm-00000000")).toBeNull()
  })
})
