// Transcribed from WriteMindTests/NotebookOutlineTests.swift, "⌘; — what is UNDER the cell you are in"
// (Mac e8b3266). Sean, 2026-09-21: "collapse current cell's subsections (or highlighted cells) is cmd+;".
// The caret's own section is never folded: that would take the line you are standing on off screen.
import { describe, expect, it } from "vitest"
import { subsections, subsectionsFolding } from "../src/cells/subsections"

const nested = [
  "# Top", "", "words under top", "",
  "## First", "", "words under first", "",
  "### Deeper", "", "more words", "",
  "## Second", "", "words under second",
].join("\n")

const at = (needle: string, text = nested) => ({ location: text.indexOf(needle), length: 0 })

describe("NotebookOutlineTests: Collapse Subsections (Ctrl+;)", () => {
  it("the cell's own section is left open and everything under it is folded", () => {
    const keys = subsections([at("words under top")], nested)
    expect([...keys].sort()).toEqual(["Deeper", "First", "Second"])
    expect(keys, "the section the cell is in stays open").not.toContain("Top")
  })

  it("deeper in the tree only what is under that section folds", () => {
    expect(subsections([at("words under first")], nested)).toEqual(["Deeper"])
    // And a section with nothing under it folds nothing at all.
    expect(subsections([at("words under second")], nested)).toEqual([])
  })

  it("several held cells ask together and no key is named twice", () => {
    const keys = subsections([at("words under top"), at("words under first")], nested)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual(["Deeper", "First", "Second"])
  })

  it("a cell before the first heading has nothing under it", () => {
    const note = "loose words\n\n# Later\n\nunder it"
    expect(subsections([{ location: 0, length: 0 }], note)).toEqual([])
  })

  // One key both ways: any still open means fold, all closed means open.
  it("the one key goes both ways", () => {
    expect(subsectionsFolding(["A", "B"], new Set())).toBe(true)
    expect(subsectionsFolding(["A", "B"], new Set(["A"]))).toBe(true)
    expect(subsectionsFolding(["A", "B"], new Set(["A", "B"]))).toBe(false)
    expect(subsectionsFolding([], new Set())).toBe(false)
  })
})
