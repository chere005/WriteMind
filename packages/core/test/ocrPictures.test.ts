import { describe, expect, it } from "vitest"
import type { Rect } from "../src/drawing/shapes"
import { boxToPicture, deskewGray, MIN_SKEW_DEGREES, paperLevel, usableAngle } from "../src/capture/deskew"
import {
  composeLines, flowWordsFrom, pageInReaderFrame, parseOcrJson, readingPageOf, tidyReading, type OcrReading,
} from "../src/capture/textRecognition"
import { loadOcrFixture } from "./ocrFixtures"

/**
 * Windows' OCR engine on real pictures (fixtures/ocr: a reading of a picture Chromium drew, see ocrFixtures.ts).
 *
 * The rules that sort a reading onto the marks drawn on the page - a bar through a word, a ring round one, an
 * arrow in a gap - were made for Vision, whose word boxes are line-high. Windows' boxes hug the glyphs, and on
 * PLAIN TYPED TEXT with nothing drawn on it they invented ~~strikes~~, **bold** and arrows (measured on the live
 * reader: 34 of 81 lines of ordinary prose). And the engine straightens a tilted picture and reports its boxes in
 * the straightened frame (`angle`), so on a hand-held photo the ink was nowhere near its boxes.
 * Nothing here is a hand-made box: these are what the engine said.
 */

const MARKS = /~~|\*\*|[↑↓→←↔]/

/** The text of every line the reader read, in the order the note gets them. */
const readAs = (reading: OcrReading): string[] => tidyReading(reading).lines.map((line) => line.text.trim())

describe("plain typed text grows no marks (Windows' tight word boxes)", () => {
  // Each of these pictures has words that used to be struck (a, to, at, see, up, from, station) or ringed
  // (A, TV, T, B) and arrows between words (the l, t, k of a word); none has anything drawn on it.
  const typed = [
    "prose-Arial-36", "prose-Consolas-40", "prose-SegoeUI-18", "prose-Arial-16", "prose-TimesNewRoman-44",
    "wide-Tahoma-24", "wide-Calibri-16", "case-single_letters_print",
  ]
  for (const name of typed) {
    it(`${name}: every line comes back as it was read`, () => {
      const { reading, page } = loadOcrFixture(name)
      const lines = composeLines(reading, page)
      expect(lines.filter((line) => MARKS.test(line))).toEqual([])
      expect(lines).toEqual(readAs(reading))
    })
  }

  it("the sentences that used to come back marked, now plain", () => {
    const lines = (name: string) => { const { reading, page } = loadOcrFixture(name); return composeLines(reading, page) }
    expect(lines("prose-SegoeUI-18")).toContain("Call Bob to get the new TV set up")
    expect(lines("prose-SegoeUI-18")).toContain("The T-shirt is on the table by the TV")
    expect(lines("prose-Arial-36")).toContain("I think we should go to the park at noon")
    expect(lines("prose-Arial-36")).toContain("Buy eggs, milk, bread and a box of tea")
    expect(lines("prose-Consolas-40")).toContain("Meeting with Dr. Lee at 10 on Friday")
    expect(lines("case-single_letters_print")[0]).toBe("A cat and I went to see Plan B")
    expect(lines("wide-ComicSansMS-28")).toContain("Plan: wake at 6, run at 7, work from 9 to 5")
  })

  it("light writing on a dark page is not struck through", () => {
    // The ink of white-on-black is what is LIGHTER than the paper; seen the wrong way round, the paper's
    // halo round each letter was a bar through "white" and "black".
    const { reading, page } = loadOcrFixture("case-white_on_black")
    expect(composeLines(reading, page)).toEqual(["white on black"])
    expect(page.ink.reduce((sum, v) => sum + v, 0)).toBeGreaterThan(200)
  })
})

describe("what is really drawn on the page is still read", () => {
  it("a pen line through a word", () => {
    for (const name of ["strike-Arial-w3-j2.5-o0", "strike-ComicSansMS-w5-j0-o0", "strike-SegoePrint-w3-j0-o0"]) {
      const { reading, page } = loadOcrFixture(name)
      const [line] = composeLines(reading, page)
      expect(line, name).toMatch(/~~[^~]+~~/)
      expect(line, name).toContain("~~fresh~~")
      // The words around it are not struck.
      expect(line, name).toMatch(/^buy .*and ~~fresh~~ bread today$/)
    }
  })
  it("a ring round a word", () => {
    const { reading, page } = loadOcrFixture("case-ring_one_word_tight")
    expect(composeLines(reading, page)).toEqual(["read **this** now"])
  })
})

describe("a tilted picture (the reader's angle)", () => {
  it("the engine reports the angle it straightened by, and parseOcrJson keeps it", () => {
    expect(loadOcrFixture("tilt-5").reading.angle).toBeCloseTo(4.9, 1)
    expect(loadOcrFixture("tilt--4").reading.angle).toBeCloseTo(-4.1, 1)
    const parsed = parseOcrJson(JSON.stringify({ angle: 3.5, engine: "windows", lines: [{ text: "hi", words: [{ text: "hi", x: 0, y: 0, width: 0.1, height: 0.1 }] }] }))
    expect("reading" in parsed && parsed.reading.angle).toBe(3.5)
    expect("reading" in parsed && parsed.reading.engine).toBe("windows")
    const odd = parseOcrJson(JSON.stringify({ angle: "tilted", engine: "morse", lines: [{ text: "hi" }] }))
    expect("reading" in odd && odd.reading.angle).toBeUndefined()
    expect("reading" in odd && odd.reading.engine).toBeUndefined()
  })

  /** The share of the ink that lies inside some word's box (a pixel of slack). */
  function inkInBoxes(name: string, turned: boolean): number {
    const { reading, page } = loadOcrFixture(name)
    const there = turned ? pageInReaderFrame(page, reading.angle) : page
    const boxes = reading.lines.flatMap((line) => (line.words ?? []).map((word) => ({
      x0: word.x * there.width - 2, y0: word.y * there.height - 2,
      x1: (word.x + word.width) * there.width + 2, y1: (word.y + word.height) * there.height + 2,
    })))
    let total = 0, inside = 0
    for (let i = 0; i < there.ink.length; i++) {
      if (!there.ink[i]) continue
      total++
      const x = i % there.width, y = (i - x) / there.width
      if (boxes.some((box) => x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1)) inside++
    }
    return inside / total
  }

  it("the ink does not sit in the boxes as the picture is, and does once it is turned the way the engine turned it", () => {
    for (const name of ["tilt-3", "tilt--4", "tilt-5"]) {
      expect(inkInBoxes(name, false), `${name} as it is`).toBeLessThan(0.9)
      expect(inkInBoxes(name, true), `${name} turned`).toBeGreaterThan(0.99)
    }
    // A page the engine did not turn is left alone.
    expect(inkInBoxes("tilt-0", false)).toBeGreaterThan(0.99)
    expect(inkInBoxes("tilt-0", true)).toBeGreaterThan(0.99)
    expect(inkInBoxes("tilt-12", true)).toBeGreaterThan(0.95)
  })

  it("plain text at 0, 3, -4 and 5 degrees comes back as the same four lines, with no arrows", () => {
    const upright = (() => { const { reading, page } = loadOcrFixture("tilt-0"); return composeLines(reading, page) })()
    expect(upright).toHaveLength(4)
    for (const name of ["tilt-3", "tilt--4", "tilt-5"]) {
      const { reading, page } = loadOcrFixture(name)
      const lines = composeLines(reading, page)
      expect(lines, name).toEqual(upright)
      expect(lines.some((line) => MARKS.test(line)), name).toBe(false)
    }
    // At 12 degrees the engine itself loses the start of the first line off the picture's edge; what it did read has no marks.
    const { reading, page } = loadOcrFixture("tilt-12")
    expect(composeLines(reading, page).some((line) => MARKS.test(line))).toBe(false)
  })

  it("a flow chart's labels are boxed on the picture's own pixels, not the straightened frame", () => {
    const { reading, width, height } = loadOcrFixture("tilt-5")
    const size = { width: 1100, height: 460 }
    const straight = flowWordsFrom({ ...reading, angle: 0 }, size)
    const turned = flowWordsFrom(reading, size)
    expect(turned).toHaveLength(straight.length)
    // The last word of the first line moves down the page by about (distance from the centre) x tan(angle).
    const last = (words: typeof turned) => words.find((word) => word.text === "three")!.box
    expect(last(turned).y).toBeGreaterThan(last(straight).y + 5)
    // ...and the turned box is where the ink of "three" is (it holds ink the straightened one does not).
    const page = loadOcrFixture("tilt-5").page
    const scale = page.width / size.width
    const inkIn = (box: Rect) => {
      let n = 0
      for (let y = Math.floor(box.y * scale); y < Math.ceil((box.y + box.height) * scale); y++) {
        for (let x = Math.floor(box.x * scale); x < Math.ceil((box.x + box.width) * scale); x++) if (page.ink[y * page.width + x]) n++
      }
      return n
    }
    expect(inkIn(last(turned))).toBeGreaterThan(inkIn(last(straight)) * 2)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
})

describe("deskew", () => {
  it("a negligible or wild angle is no angle", () => {
    expect(usableAngle(null)).toBe(0)
    expect(usableAngle(undefined)).toBe(0)
    expect(usableAngle(Number.NaN)).toBe(0)
    expect(usableAngle(MIN_SKEW_DEGREES / 2)).toBe(0)
    expect(usableAngle(60)).toBe(0)
    expect(usableAngle(-3.2)).toBe(-3.2)
  })
  it("a box is its own box with no angle, and turns about the picture's centre otherwise", () => {
    const box = { x: 100, y: 50, width: 40, height: 20 }
    expect(boxToPicture(box, 400, 200, 0)).toEqual(box)
    // A quarter turn clockwise about (200, 100): a point 100 to the LEFT of the centre goes 100 UP from it.
    const quarter = boxToPicture({ x: 100, y: 100, width: 10, height: 10 }, 400, 200, 90)
    expect(quarter.x).toBeCloseTo(190, 5)
    expect(quarter.y).toBeCloseTo(0, 5)
    expect(quarter.width).toBeCloseTo(10, 5)
    expect(quarter.height).toBeCloseTo(10, 5)
    // Turning forward then the ink back by the same angle is the identity on a point at the centre.
    const centre = boxToPicture({ x: 195, y: 95, width: 10, height: 10 }, 400, 200, 7)
    expect(centre.x + centre.width / 2).toBeCloseTo(200, 3)
    expect(centre.y + centre.height / 2).toBeCloseTo(100, 3)
  })
  it("turns the ink the way the box turns, and fills what it uncovers with the paper", () => {
    const w = 200, h = 100
    const gray = new Uint8Array(w * h).fill(240)
    // A dark bar along the row y = 50, from x = 20 to x = 180.
    for (let x = 20; x < 180; x++) for (let y = 49; y < 52; y++) gray[y * w + x] = 20
    expect(paperLevel(gray)).toBe(240)
    const turned = deskewGray(gray, w, h, 10)
    // Turning the ink 10 degrees "back" puts the bar's right end 10 degrees ABOVE where it was: R(+10) sampled.
    const centreOfBar = (g: Uint8Array, x: number) => {
      let sum = 0, n = 0
      for (let y = 0; y < h; y++) if (g[y * w + x]! < 100) { sum += y; n++ }
      return n ? sum / n : NaN
    }
    expect(centreOfBar(gray, 160)).toBe(50)
    const right = centreOfBar(turned, 160), left = centreOfBar(turned, 40)
    // The pixel at p in the result is the picture's pixel at R(10)(p - c) + c: a point to the right of the centre
    // reads from lower down, so the bar shows higher on the right.
    expect(left).toBeGreaterThan(right)
    expect(left - right).toBeGreaterThan(15)
    // The corner uncovered by the turn is paper, not ink.
    expect(turned[0]).toBe(240)
    expect(turned[w * h - 1]).toBe(240)
    // No angle, same picture.
    expect(Array.from(deskewGray(gray, w, h, 0))).toEqual(Array.from(gray))
  })
  it("a page without its grey picture is left as it is", () => {
    const gray = new Uint8Array(100 * 100).fill(255)
    const page = readingPageOf(gray, 100, 100)!
    expect(pageInReaderFrame({ ...page, gray: undefined }, 5)).toEqual({ ...page, gray: undefined })
    expect(pageInReaderFrame(page, 0)).toBe(page)
  })
})
