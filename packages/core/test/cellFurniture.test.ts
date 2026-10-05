import { describe, expect, it } from "vitest"
import {
  cellFurniture, EMPTY_BOX, furnitureBehind, furnitureIsEmpty, headingMarkers, outsideFurniture, sourceStyleRuns,
  TICKED_BOX, type FurnitureReading,
} from "../src/markdown/sourceStyle"
import { range, substring } from "../src/text/range"

/**
 * Transcribed from `WriteMindTests/CellFurnitureTests.swift` and the furniture half of
 * `WriteMindTests/MarkerHidingTests.swift` (Mac 0fdd031): what the rendered page's open block treats as furniture
 * (Sean, 2026-09-21: "only edit the text in a reminders list or bullet list").
 */
const read = (source: string): FurnitureReading => cellFurniture(source, sourceStyleRuns(source))
const reserved = (source: string): string[] => read(source).reserved.map((r) => substring(source, r))
const hidden = (source: string): string[] => read(source).hidden.map((r) => substring(source, r)).sort()
const glyphs = (source: string): [number, string][] => [...read(source).glyphs.entries()]

describe("a bullet is drawn, and still out of reach", () => {
  it("is reserved but not hidden", () => {
    expect(reserved("- first\n- second")).toEqual(["- ", "- "])
    // The dash is drawn as a round bullet; hiding it would leave a list with no marker.
    expect(hidden("- first\n- second")).toEqual([])
    expect(read("- first").glyphs.size).toBe(0)
  })

  it("reserves a numbered list the same way", () => {
    expect(reserved("1. one\n2. two")).toEqual(["1. ", "2. "])
  })

  it("finds no furniture at all in plain prose", () => {
    expect(furnitureIsEmpty(read("Just some words, and **bold** ones."))).toBe(true)
  })
})

describe("a reminder", () => {
  it("is one box and the words after it", () => {
    const source = "- [ ] a reminder"
    // The marker and the brackets go; the box stands for all of them.
    expect(hidden(source)).toEqual([" ", "- ", "]"])
    expect(glyphs(source)).toEqual([[2, EMPTY_BOX]])
    // Reserved up to and including the space, twice over and deliberately: the `- ` as a list marker, the whole
    // head as a box.
    expect(reserved(source)).toEqual(["- ", "- [ ] "])
    expect(outsideFurniture(range(0, 0), read(source).reserved)).toEqual(range(6, 0)) // past ALL of it
  })

  it("gets the ticked box when it is done", () => {
    expect(glyphs("- [x] done")).toEqual([[2, TICKED_BOX]])
    expect(glyphs("- [X] done")).toEqual([[2, TICKED_BOX]])
  })

  it("reserves its indent too when it is nested", () => {
    expect(reserved("    - [ ] nested")).toEqual(["- ", "    - [ ] "])
    expect(glyphs("    - [ ] nested")).toEqual([[6, EMPTY_BOX]])
  })

  it("still has its box with no words yet", () => {
    expect(glyphs("- [ ]")).toEqual([[2, EMPTY_BOX]])
    expect(reserved("- [ ]")).toEqual(["- ", "- [ ]"])
  })

  it("is not what is not a reminder", () => {
    expect(read("- [] x").glyphs.size).toBe(0) // no room for a state in the box
    expect(read("a [ ] mid-line").glyphs.size).toBe(0)
    expect(read("- [ ]x").glyphs.size).toBe(0) // the box is followed by a space or nothing
  })

  it("is a list of reminders: three boxes, three markers and three heads", () => {
    const source = "- [x] done\n- [ ] not yet\n- [ ] nor this"
    const reading = read(source)
    expect(reading.glyphs.size).toBe(3)
    expect(reading.reserved).toHaveLength(6)
    // Every box is a `[` in the note, and the note is untouched.
    for (const at of reading.glyphs.keys()) expect(source.slice(at, at + 1)).toBe("[")
  })
})

describe("a heading", () => {
  it("has its hashes hidden and reserved", () => {
    expect(hidden("## Section")).toEqual(["## "])
    expect(reserved("## Section")).toEqual(["## "])
    expect(read("###### Deep").hidden.map((r) => substring("###### Deep", r))[0]).toBe("###### ")
  })

  it("leaves a fence and an inline pair alone", () => {
    expect(furnitureIsEmpty(read("```swift\nlet x = 1\n```"))).toBe(true)
    expect(furnitureIsEmpty(read("Plain **bold** here"))).toBe(true)
    expect(furnitureIsEmpty(read("#no space after"))).toBe(true)
  })
})

/** The two glyphs drawn for a box: the Mac's pair, because U+2610 is missing from its system font. */
describe("the boxes", () => {
  it("are U+25A1 and U+2611", () => {
    expect(EMPTY_BOX).toBe("□")
    expect(TICKED_BOX).toBe("☑")
  })
})

/** `MarkerHidingTests.swift`, the furniture half. */
describe("furniture: hidden even on the caret's own line", () => {
  const furniture = (source: string): string[] =>
    headingMarkers(sourceStyleRuns(source), source).map((r) => substring(source, r))

  it("is the hashes at the head of a line and nothing else", () => {
    expect(furniture("## Section")).toEqual(["## "])
    expect(furniture("###### Deep\n\n# Top")).toEqual(["###### ", "# "])
    expect(furniture("Plain **bold** here")).toEqual([])
    expect(furniture("```swift\nlet x = 1\n```")).toEqual([])
    expect(furniture("a #hashtag mid-line")).toEqual([])
    expect(furniture("#no space after")).toEqual([])
  })

  it("is an empty heading's hashes too", () => {
    expect(furniture("## ")).toEqual(["## "])
  })

  it("pushes the caret out of the front of a piece", () => {
    const piece = [range(0, 3)]
    // Anywhere inside it — including its very start, where a click on the left edge and Home both land.
    for (const at of [0, 1, 2]) expect(outsideFurniture(range(at, 0), piece)).toEqual(range(3, 0))
    // Past it, and a real selection, are left exactly as they are.
    expect(outsideFurniture(range(5, 0), piece)).toEqual(range(5, 0))
    expect(outsideFurniture(range(0, 9), piece)).toEqual(range(0, 9))
    expect(outsideFurniture(range(1, 0), [])).toEqual(range(1, 0))
  })

  it("lets a backspace behind a piece take the whole piece", () => {
    const piece = [range(0, 3)]
    expect(furnitureBehind(3, piece)).toEqual(piece[0])
    expect(furnitureBehind(4, piece)).toBeNull()
    expect(furnitureBehind(0, piece)).toBeNull()
    expect(furnitureBehind(3, [])).toBeNull()
  })
})
