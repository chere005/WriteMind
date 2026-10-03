/**
 * Transcribed from `WriteMindTests/TextBoxStyleTests.swift`. The Swift tests
 * measure with NSString's real layout; here the measurer is a stand-in that
 * wraps at a fixed character width, which is all the rules ever needed from it.
 */

import { describe, expect, it } from "vitest"
import {
  contrastRatio, luminance, readableInk, rgbFromHex, textBoxAspect, textBoxHeight, TEXT_BOX,
  type Measure,
} from "../src/index"

/** Seven points a character, greedy word wrap, one line is `lineHeight`. */
const measure: Measure = (text, room) => {
  const perLine = Math.max(1, Math.floor(room / 7))
  let lines = 0
  for (const paragraph of text.split("\n")) {
    let used = 0
    lines++
    for (const word of paragraph.split(" ")) {
      if (used > 0 && used + 1 + word.length > perLine) { lines++; used = word.length }
      else used += (used > 0 ? 1 : 0) + word.length
    }
  }
  return lines * TEXT_BOX.lineHeight
}

describe("TextBoxStyleTests", () => {
  it("an empty box is still a line tall", () => {
    // It used to measure an empty string as nothing and collapse to a
    // sliver with a caret hanging out of it.
    const height = textBoxHeight("", 200, measure)
    expect(height).toBeGreaterThan(TEXT_BOX.padding.height * 2 + 10)
    expect(height).toBeLessThan(44)
  })

  it("the box grows with the words", () => {
    const one = textBoxHeight("One line", 200, measure)
    const many = textBoxHeight("words and more words ".repeat(8), 200, measure)
    expect(many).toBeGreaterThan(one * 2)
  })

  it("the height is the padding plus the text", () => {
    const width = 200
    const text = "Two words"
    const room = width - TEXT_BOX.padding.width * 2
    expect(textBoxHeight(text, width, measure))
      .toBeCloseTo(Math.ceil(measure(text, room)) + TEXT_BOX.padding.height * 2, 1)
  })

  it("an unmeasurably narrow box falls back", () => {
    expect(textBoxAspect("anything", 5, measure)).toBe(TEXT_BOX.fallbackAspect)
  })

  it("the aspect agrees with the height", () => {
    const width = 240
    expect(textBoxAspect("Some words here", width, measure))
      .toBeCloseTo(textBoxHeight("Some words here", width, measure) / width, 3)
  })

  // MARK: - Ink you can read

  it("dark ink on a light card is left alone", () => {
    expect(readableInk("#1A1A1A", "#FFF3B0")).toBe("#1A1A1A")
  })

  it("ink that would vanish is replaced", () => {
    // Black on navy, and white on pale yellow: both unreadable, both
    // turned round (Sean: "it should always be visible").
    expect(readableInk("#000000", "#101A44")).toBe("#FFFFFF")
    expect(readableInk("#FFFFFF", "#FFF3B0")).toBe("#000000")
  })

  it("with no card the pen is trusted", () => {
    // No fill means the note's own paper, which the pen was picked on.
    expect(readableInk("#3355FF", null)).toBe("#3355FF")
  })

  it("the contrast maths is the standard one", () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 1)
    expect(contrastRatio([1, 1, 1], [1, 1, 1])).toBeCloseTo(1, 1)
    expect(luminance([1, 1, 1])).toBeCloseTo(1, 3)
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 3)
  })

  it("a colour comes back out of its hex", () => {
    const colour = rgbFromHex("#3366CC")!
    expect(colour[0]).toBeCloseTo(0.2, 2)
    expect(colour[2]).toBeCloseTo(0.8, 2)
    expect(rgbFromHex("not a colour")).toBeNull()
  })
})
