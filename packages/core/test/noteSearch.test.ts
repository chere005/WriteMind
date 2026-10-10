import { describe, expect, it } from "vitest"
import {
  findSeed, foldMapped, foldSearch, markIn, matchNote, noteText, plainSearchLine, prepareQuery, snippetOf,
  type NoteFacts, type SearchQuery,
} from "../src/notes/search"

/**
 * The sidebar's search (src/notes/search.ts). New in the port, so these tests are its own: there is no XCTest they were
 * transcribed from.
 */

const query = (typed: string): SearchQuery => prepareQuery(typed)!
const facts = (title: string, stem = title, snippet = ""): NoteFacts => ({ title, stem, snippet })
const hit = (typed: string, note: NoteFacts, text: string | null) =>
  matchNote(query(typed), note, text === null ? null : noteText(text))

describe("folding", () => {
  it("ignores case and accents, both ways round", () => {
    expect(foldSearch("Café ÉCOLE Ñandú")).toBe("cafe ecole nandu")
    expect(foldSearch("café")).toBe("cafe") // an e and a combining acute
    expect(foldSearch("CAFÉ")).toBe(foldSearch("cafe"))
  })

  it("leaves a letter that is not an accented one alone", () => {
    expect(foldSearch("Straße")).toBe("straße")
    expect(foldSearch("Ørsted")).toBe("ørsted")
    // kana with a dakuten, Hangul and Greek are letters of their own (only Latin combining marks are accents)
    expect(foldSearch("がぎ")).not.toBe(foldSearch("かき"))
    expect(foldSearch("한국어")).toBe("한국어".normalize("NFKD"))
  })

  it("takes a ligature and a full-width letter apart", () => {
    expect(foldSearch("ﬁsh")).toBe("fish")
    expect(foldSearch("ＡＢＣ１")).toBe("abc1")
  })

  it("makes a run of white space one space and keeps the line breaks", () => {
    expect(foldSearch("a \t  b c")).toBe("a b c")
    expect(foldSearch("a  \n  b")).toBe("a \n b")
  })

  it("is the same with or without the way back (the ASCII path and the per-character path agree)", () => {
    for (const sample of ["Hello  World\nTwo\tthree", "plain ascii 123", "Ünï Çödé  ﬁ\nnext line", "日本語 テスト  ガ"]) {
      expect(foldMapped(sample).text).toBe(foldSearch(sample))
    }
  })

  it("carries a position in the folded text back to the original", () => {
    const folded = foldMapped("Un café  noir")
    expect(folded.text).toBe("un cafe noir")
    const at = folded.text.indexOf("cafe")
    expect("Un café  noir".slice(folded.from[at]!, folded.to[at + 3]!)).toBe("café")
    // the two spaces are one, and it spans both
    const space = folded.text.indexOf(" noir")
    expect("Un café  noir".slice(folded.from[space]!, folded.to[space]!)).toBe("  ")
  })

  it("counts an astral character as the one character it is", () => {
    const folded = foldMapped("a😀b")
    expect(folded.text).toBe("a😀b")
    expect(folded.text.indexOf("b")).toBe(3)
    expect(folded.from[3]).toBe(3)
  })
})

describe("the query", () => {
  it("is nothing when it is blank", () => {
    expect(prepareQuery("")).toBeNull()
    expect(prepareQuery("   \n ")).toBeNull()
  })
  it("is folded, with one space between words", () => {
    expect(prepareQuery("  Heat   FLOW ")).toEqual({ words: "Heat   FLOW", needle: "heat flow" })
  })
})

describe("the words of a note", () => {
  it("are the plain lines, not the markup", () => {
    const body = noteText("# Title\n\nSome **bold** and `code` and [a link](https://example.com/x)\n- one\n- [x] two\n1. three\n> quoted")
    expect(body.plain.split("\n")).toEqual([
      "Title", "Some bold and code and a link", "one", "two", "three", "quoted",
    ])
    expect(body.folded.split("\n")).toHaveLength(6)
  })

  it("leave out a picture, an ink cell, a rule, a fence's own line and the marker above a markdown cell", () => {
    const body = noteText([
      "<!-- markdown -->", "words", "![a picture](media/p.png)", "---", "```python", "print(1)", "```", "| a | b |", "|---|---|", "| 1 | 2 |",
    ].join("\n"))
    expect(body.plain.split("\n")).toEqual(["words", "print(1)", "a b", "1 2"])
  })

  it("take off Link Here's anchors and the escapes", () => {
    expect(plainSearchLine('<a id="wm-1234"></a>first \\*not bold\\* words')).toBe("first *not bold* words")
    expect(plainSearchLine('with <mark id="wm-2">a phrase</mark> in it')).toBe("with a phrase in it")
  })

  it("read through a byte order mark and Windows line ends", () => {
    expect(noteText("﻿one\r\ntwo\r\n").plain).toBe("one\ntwo")
  })
})

describe("a title match", () => {
  it("ranks first, marks the match in the title, and shows the note's own first words when the words say nothing", () => {
    const found = hit("heat", facts("Field Notes on Heat Flow", "Field Notes on Heat Flow", "first words"), "# Field Notes on Heat Flow\n")
    expect(found?.tier).toBe(1)
    expect(found?.titleMark).toEqual({ from: 15, to: 19 })
    // the heading line IS the title: not shown again under itself, so the note's own first words are
    expect(found?.snippet).toEqual({ text: "first words", mark: null })
    expect(found?.line).toBeNull()
  })

  it("is tier 0 at the start of the title", () => {
    expect(hit("field", facts("Field Notes"), "")?.tier).toBe(0)
  })

  it("ignores case and accents, and marks the match where the original has it", () => {
    const found = hit("cafe", facts("Le Café Noir"), "")
    expect(found?.titleMark).toEqual({ from: 3, to: 7 })
    expect(hit("ECOLE", facts("école primaire"), "")?.tier).toBe(0)
  })

  it("falls back to the file's name (tier 2), with nothing marked in the title", () => {
    const found = hit("draft", facts("Chapter One", "Chapter One draft 2"), "unrelated")
    expect(found?.tier).toBe(2)
    expect(found?.titleMark).toBeNull()
    expect(found?.snippet.text).toBe("")
  })

  it("finds a note that could not be read by its title (and says nothing of its words)", () => {
    const found = hit("broken", facts("Broken note", "Broken note", "(its first words)"), null)
    expect(found?.tier).toBe(0)
    expect(found?.snippet.text).toBe("(its first words)")
    expect(hit("words", facts("Broken note"), null)).toBeNull()
  })
})

describe("a body match", () => {
  const text = "# Heat\nfirst line\nThe gauge reads Low in the morning\nlast line"

  it("is tier 3, with the line and the match marked in it", () => {
    const found = hit("gauge", facts("Heat"), text)
    expect(found?.tier).toBe(3)
    expect(found?.titleMark).toBeNull()
    expect(found?.snippet).toEqual({ text: "The gauge reads Low in the morning", mark: { from: 4, to: 9 } })
    expect(found?.matched).toBe("gauge")
    expect(found?.line).toBe(2)
  })

  it("matches case-blind and accent-blind, and reports the words as the note has them", () => {
    const found = hit("CAFE", facts("Menu"), "# Menu\nA small Café on the corner")
    expect(found?.matched).toBe("Café")
    expect(found?.snippet.mark).toEqual({ from: 8, to: 12 })
  })

  it("is the FIRST match in the note", () => {
    const found = hit("two", facts("N"), "one\ntwo and two\nthree two")
    expect(found?.line).toBe(1)
    expect(found?.snippet.mark).toEqual({ from: 0, to: 3 })
  })

  it("reads a phrase across a run of spaces, but never across two lines", () => {
    expect(hit("heat flow", facts("N"), "the heat    flow here")?.matched).toBe("heat    flow")
    expect(hit("heat flow", facts("N"), "the heat\nflow here")).toBeNull()
  })

  it("finds nothing in markup that is not words", () => {
    expect(hit("example.com", facts("N"), "[a link](https://example.com/x)")).toBeNull()
    expect(hit("media", facts("N"), "![a picture](media/p.png)")).toBeNull()
  })

  it("finds words in code and maths source", () => {
    expect(hit("integrate", facts("N"), "```wl\nIntegrate[x^2, x]\n```")?.snippet.text).toBe("Integrate[x^2, x]")
  })

  it("is not a match when only the title has it and the words do not (the snippet is the note's own)", () => {
    const found = hit("zebra", facts("Zebra stripes", "z", "own words"), "# Zebra stripes\n")
    expect(found?.tier).toBe(0)
    expect(found?.snippet.text).toBe("own words")
    const bare = hit("zebra", facts("Zebra stripes", "z", "own words"), "x")
    expect(bare?.snippet.text).toBe("own words")
  })

  it("shows another line of the words when the title has matched and the words have the query too", () => {
    const found = hit("heat", facts("Heat flow", "Heat flow", "first"), "# Heat flow\nthe heat rises\n")
    expect(found?.tier).toBe(0)
    expect(found?.snippet).toEqual({ text: "the heat rises", mark: { from: 4, to: 8 } })
    expect(found?.line).toBe(1)
  })

  it("counts a heading line as words when it is not the title (a second heading)", () => {
    const found = hit("later", facts("Heat flow", "Heat flow", "first"), "# Heat flow\n## Later on\n")
    expect(found?.tier).toBe(3)
    expect(found?.snippet.text).toBe("Later on")
  })

  it("does not take one line's text for another's when the folded text is shorter (ligatures, accents)", () => {
    const found = hit("fish", facts("N"), "ﬁrst line\nﬁsh and chips")
    expect(found?.line).toBe(1)
    expect(found?.matched).toBe("ﬁsh")
  })
})

describe("the snippet", () => {
  it("is the whole line when it is short", () => {
    expect(snippetOf("short line", { from: 6, to: 10 })).toEqual({ text: "short line", mark: { from: 6, to: 10 } })
  })

  it("is cut round the match, with an ellipsis where it was cut, and the match still marked on the right words", () => {
    const line = "alpha ".repeat(30) + "NEEDLE" + " omega".repeat(30)
    const at = line.indexOf("NEEDLE")
    const cut = snippetOf(line, { from: at, to: at + 6 })
    expect(cut.text.startsWith("…")).toBe(true)
    expect(cut.text.endsWith("…")).toBe(true)
    expect(cut.text.length).toBeLessThanOrEqual(104)
    expect(cut.text.slice(cut.mark!.from, cut.mark!.to)).toBe("NEEDLE")
  })

  it("keeps the start of a long line when the match is near it", () => {
    const line = "NEEDLE " + "tail ".repeat(50)
    const cut = snippetOf(line, { from: 0, to: 6 })
    expect(cut.text.startsWith("NEEDLE")).toBe(true)
    expect(cut.text.startsWith("…")).toBe(false)
    expect(cut.mark).toEqual({ from: 0, to: 6 })
  })

  it("keeps the end of a long line when the match is near it", () => {
    const line = "head ".repeat(50) + "NEEDLE"
    const at = line.indexOf("NEEDLE")
    const cut = snippetOf(line, { from: at, to: at + 6 })
    expect(cut.text.endsWith("NEEDLE")).toBe(true)
    expect(cut.text.slice(cut.mark!.from, cut.mark!.to)).toBe("NEEDLE")
  })

  it("has no mark for a note's own words", () => {
    expect(snippetOf("x".repeat(300), null).text).toHaveLength(101)
  })
})

describe("markIn", () => {
  it("is null when the words are not there", () => {
    expect(markIn(query("zzz"), "Field Notes")).toBeNull()
  })
})

describe("the words the Find bar is given", () => {
  const raw = "the **heat** flow and the Café"
  it("are the match as the note has it, when the note's text has it as written", () => {
    expect(findSeed(raw, { matched: "Café" }, "cafe")).toBe("Café")
  })
  it("are what was typed when the plain match is not in the raw text (it crossed a mark)", () => {
    expect(findSeed(raw, { matched: "heat flow" }, "heat flow")).toBe("heat")
  })
  it("are the typed words when nothing better is known", () => {
    expect(findSeed(raw, { matched: "" }, "flow")).toBe("flow")
    expect(findSeed(raw, { matched: "" }, "nothing here")).toBe("nothing here")
  })
})

describe("many notes", () => {
  it("fold and search three thousand notes of a few thousand characters in well under a second", () => {
    const body = Array.from({ length: 80 }, (_, i) => `line ${i} of the gauge notes, heat flow and café ${"words ".repeat(8)}`).join("\n")
    const notes = Array.from({ length: 3000 }, (_, i) => noteText(`# Note ${i}\n${body}\nunique${i} end`))
    const q = query("UNIQUE2999")
    const started = performance.now()
    const found = notes.filter((one, i) => matchNote(q, facts(`Note ${i}`), one) !== null)
    expect(found).toHaveLength(1)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
