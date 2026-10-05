import { describe, expect, it } from "vitest"
import type { Rect } from "../src/drawing/shapes"
import { localMeanRadius } from "../src/capture/ink"
import {
  arrow, betweenWords, checkbox, edgesInked, encircles, encirclesClearly, endsWithArrow, inkBoxSide, isArrowRead,
  isBoxRead, isOperatorRead, isRing, isRingRead, looksLikeMaths, mostlyInside, normaliseArrows,
  sameBand, startsLine, startsWithArrow, strayTimesAsX, struckThrough, superscripted, taskItem,
  wallThickness, wolfram,
} from "../src/capture/handwritingMarks"
import { Canvas } from "./raster"

/**
 * The marks on a page that are not letters: a line through a word, an arrow,
 * a ring, a power. Transcribed from
 * `WriteMindTests/HandwritingMarksTests.swift`.
 */
const width = 200, height = 60
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h })

/** An ink mask drawn by hand: every rect filled. */
function mask(rects: Rect[]): Uint8Array {
  const ink = new Uint8Array(width * height)
  for (const rect of rects) {
    for (let y = Math.trunc(rect.y); y < rect.y + rect.height; y++) {
      for (let x = Math.trunc(rect.x); x < rect.x + rect.width; x++) {
        if (y >= 0 && y < height && x >= 0 && x < width) ink[y * width + x] = 1
      }
    }
  }
  return ink
}

describe("a line through a word", () => {
  const word = r(20, 20, 80, 20)
  it("a bar across the middle of a word is a strikethrough", () => {
    expect(struckThrough(word, mask([r(20, 29, 80, 2)]), width, height)).toBe(true)
  })
  it("a line under the word is not", () => {
    expect(struckThrough(word, mask([r(20, 41, 80, 2)]), width, height)).toBe(false)
  })
  it("a short dash inside a word is not", () => {
    expect(struckThrough(word, mask([r(40, 29, 20, 2)]), width, height)).toBe(false)
  })
  it("a solid block is not a thin line", () => {
    expect(struckThrough(word, mask([word]), width, height)).toBe(false)
  })
})

describe("arrows", () => {
  it("point where their head is", () => {
    const shaft = r(20, 29, 60, 3), head = r(70, 24, 10, 13), box = r(20, 24, 60, 13)
    expect(arrow(box, mask([shaft, head]), width, height)).toBe("→")
    expect(arrow(box, mask([shaft, r(20, 24, 10, 13)]), width, height)).toBe("←")
  })
  it("can point down", () => {
    const shaft = r(60, 5, 3, 45), head = r(55, 40, 13, 10), box = r(55, 5, 13, 45)
    expect(arrow(box, mask([shaft, head]), width, height)).toBe("↓")
  })
  it("a plain line is not an arrow", () => {
    const line = r(20, 29, 80, 3)
    expect(arrow(line, mask([line]), width, height)).toBeNull()
  })
  it("what a reader writes as an arrow becomes one", () => {
    expect(normaliseArrows("A -> B")).toBe("A → B")
    expect(normaliseArrows("A --> B")).toBe("A → B")
    expect(normaliseArrows("A => B")).toBe("A → B")
    expect(normaliseArrows("B <- A")).toBe("B ← A")
  })
  it("an arrow is not a word with a line through it", () => {
    expect(isArrowRead("→")).toBe(true)
    expect(isArrowRead(" ↔ ")).toBe(true)
    expect(isArrowRead("→x")).toBe(false)
    expect(isArrowRead("")).toBe(false)
    expect(startsWithArrow("→ Lyon")).toBe(true)
    expect(startsWithArrow("Lyon →")).toBe(false)
    expect(endsWithArrow("Paris →")).toBe(true)
  })
})

describe("a ring round a word", () => {
  it("is round and hollow and holds its word", () => {
    const ring = r(10, 10, 60, 50)
    expect(isRing(ring, 0.2, 200)).toBe(true)
    expect(isRing(ring, 0.9, 200)).toBe(false)
    expect(isRing(r(0, 0, 80, 6), 0.2, 200)).toBe(false)
    expect(encircles(ring, r(20, 22, 40, 22))).toBe(true)
    expect(encircles(ring, r(60, 22, 60, 22))).toBe(false)
  })
  it("an O that is really a ring is dropped", () => {
    expect(isRingRead("O")).toBe(true)
    expect(isRingRead("0")).toBe(true)
    expect(isRingRead("Op")).toBe(false)
  })
})

describe("an arrow between two words", () => {
  // A line of writing 30 tall with three words, whose boxes run right up to
  // each other the way a reader's do; the ink has real gaps.
  const band = r(20, 10, 180, 30)
  const words = [r(20, 12, 66, 26), r(86, 12, 60, 26), r(146, 12, 54, 26)]
  const letters = [r(20, 12, 40, 26), r(90, 12, 40, 26), r(160, 12, 40, 26)]
  const between = (box: Rect, extra: Rect[] = []) => betweenWords(box, band, words, [...letters, ...extra, box])

  it("in the gap belongs to the word after it", () => {
    expect(between(r(64, 20, 22, 8))).toBe(1)
    expect(between(r(134, 20, 22, 8))).toBe(2)
  })
  it("over a word belongs to nobody", () => {
    expect(between(r(95, 20, 30, 8))).toBeNull()
  })
  it("at either end of the line is not between words", () => {
    expect(between(r(0, 20, 16, 8))).toBeNull()
    expect(between(r(206, 20, 16, 8))).toBeNull()
  })
  it("on another line is not on this one", () => {
    expect(between(r(64, 60, 22, 8))).toBeNull()
  })
  it("the gap is found in the ink and not in the word boxes", () => {
    expect(mostlyInside(r(64, 20, 22, 8), words[0]!)).toBe(true)
    expect(between(r(64, 20, 22, 8))).toBe(1)
    expect(between(r(64, 20, 22, 8), [r(70, 18, 6, 12)])).toBeNull()
  })
  it("two readings are on the same band or they are not", () => {
    expect(sameBand(band, r(220, 14, 180, 30))).toBe(true)
    expect(sameBand(band, r(220, 50, 180, 30))).toBe(false)
  })
})

describe("checkboxes", () => {
  const square = { x: 20, y: 16, size: 24 }
  const lineBox = r(56, 14, 130, 30)

  function drawn(draw: (c: Canvas) => void): Uint8Array {
    const c = new Canvas(width, height)
    c.lineWidth = 3
    draw(c)
    return c.mask()
  }
  const box = (c: Canvas) => c.strokeRect(square.x, square.y, square.size, square.size)
  const tick = (c: Canvas, inset: number) => {
    const x = square.x + inset, y = square.y + inset, s = square.size - 2 * inset
    c.polyline([{ x: x + 5, y: y + s / 2 }, { x: x + s / 2, y: y + s - 5 }, { x: x + s - 4, y: y + 4 }])
  }
  /** The tight box of everything inked — what a connected component hands the rules. */
  function inkBox(m: Uint8Array): Rect {
    let x0 = width, x1 = -1, y0 = height, y1 = -1
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!m[y * width + x]) continue
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    return r(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
  }
  const read = (m: Uint8Array, line: Rect = lineBox) => checkbox(inkBox(m), line, m, width, height)

  it("an empty box at the head of a line is an unticked task", () => {
    expect(read(drawn(box))).toBe(false)
  })
  it("a box with a tick in it is ticked", () => {
    expect(read(drawn((c) => { box(c); tick(c, 3) }))).toBe(true)
    expect(read(drawn((c) => { box(c); tick(c, 0) }))).toBe(true)
  })
  it("a cross in the box counts as ticked too", () => {
    expect(read(drawn((c) => {
      box(c)
      c.line({ x: square.x + 4, y: square.y + 4 }, { x: square.x + 20, y: square.y + 20 })
      c.line({ x: square.x + 4, y: square.y + 20 }, { x: square.x + 20, y: square.y + 4 })
    }))).toBe(true)
  })
  it("a filled square is not a checkbox", () => {
    expect(read(drawn((c) => c.fillRect(square.x, square.y, square.size, square.size)))).toBeNull()
  })
  it("a fat bullet the threshold hollowed out is still not a checkbox", () => {
    const radius = localMeanRadius(width, height)
    const hollowed = drawn((c) => {
      c.lineWidth = radius
      c.strokeRect(square.x + radius / 2, square.y + radius / 2, square.size - radius, square.size - radius)
    })
    expect(read(hollowed)).toBeNull()
  })
  it("the walls of a drawn box are a pen's width and no more", () => {
    const m = drawn(box)
    expect(wallThickness(inkBox(m), m, width, height)).toBeLessThan(inkBoxSide(inkBox(m)) * 0.25)
  })
  it("a thin box is still read on a page-sized mask", () => {
    expect(localMeanRadius(1200, 1600)).toBe(30)
    expect(3).toBeLessThan(30 / 2)
  })
  it("the four-edges rule is what separates a box from a round letter", () => {
    // An O drawn as an ellipse stands in for the font's: the corners of its
    // bounding box are empty, the corners of a square's are inked.
    const m = drawn(box)
    const o = drawn((c) => c.strokeEllipse(square.x, square.y, square.size, square.size))
    expect(edgesInked(inkBox(m), m, width, height)).toBeCloseTo(1, 3)
    expect(edgesInked(inkBox(o), o, width, height)).toBeLessThan(0.95)
    expect(read(o)).toBeNull()
  })
  it("a box that is not the size of the writing is left alone", () => {
    const m = drawn(box)
    expect(read(m, r(56, 22, 130, 8))).toBeNull()
    expect(read(m, r(56, 0, 130, 58))).toBeNull()
  })
  it("only a mark at the head of a line counts", () => {
    const line = r(56, 14, 130, 30)
    const at = (dx: number, dy: number) => r(square.x + dx, square.y + dy, square.size, square.size)
    expect(startsLine(at(0, 0), line)).toBe(true)
    expect(startsLine(at(90, 0), line)).toBe(false)
    expect(startsLine(at(0, 34), line)).toBe(false)
  })
  it("a line becomes a markdown task item", () => {
    expect(taskItem("milk", true)).toBe("- [x] milk")
    expect(taskItem("bread", false)).toBe("- [ ] bread")
    expect(taskItem("• bread", false)).toBe("- [ ] bread")
    expect(taskItem("- bread", false)).toBe("- [ ] bread")
    expect(taskItem("  ", true)).toBe("")
  })
  it("what a reader reads a drawn box as is dropped", () => {
    for (const text of ["D", "O", "0", "[]", "[ ]", "□", "X", "V", "•"]) expect(isBoxRead(text), text).toBe(true)
    for (const text of ["milk", "Go", "42x", "は い"]) expect(isBoxRead(text), text).toBe(false)
  })
  it("mostly inside is not symmetrical", () => {
    const outer = r(0, 0, 40, 40)
    expect(mostlyInside(r(5, 5, 20, 20), outer)).toBe(true)
    expect(mostlyInside(outer, r(5, 5, 20, 20))).toBe(false)
    expect(mostlyInside(r(30, 30, 40, 40), outer)).toBe(false)
  })
})

describe("maths", () => {
  it("a sum is maths and a sentence is not", () => {
    expect(looksLikeMaths("x = 2y + 1")).toBe(true)
    expect(looksLikeMaths("3 × 4 = 12")).toBe(true)
    expect(looksLikeMaths("buy 3 apples and bread")).toBe(false)
    expect(looksLikeMaths("hello there")).toBe(false)
  })
  it("an operator alone is never a word struck out", () => {
    expect(isOperatorRead("=")).toBe(true)
    expect(isOperatorRead(" + ")).toBe(true)
    expect(isOperatorRead("≤")).toBe(true)
    expect(isOperatorRead("2y")).toBe(false)
    expect(isOperatorRead("x=1")).toBe(false)
    expect(isOperatorRead("")).toBe(false)
  })
  it("a times sign with nothing to multiply is the letter x", () => {
    expect(strayTimesAsX("× = 2y + 1")).toBe("x = 2y + 1")
    expect(strayTimesAsX("2y + 1 = ×")).toBe("2y + 1 = x")
    expect(strayTimesAsX("3 × 4")).toBe("3 × 4")
    expect(strayTimesAsX("(a + b) × 2")).toBe("(a + b) × 2")
  })
  it("the signs a hand writes become Wolfram", () => {
    expect(wolfram("3 × 4 ÷ 2")).toBe("3 * 4 / 2")
    expect(wolfram("x ≤ 5")).toBe("x <= 5")
    expect(wolfram("π r^2")).toBe("Pi r^2")
  })
  it("a raised digit becomes a power", () => {
    const big = r(0, 10, 10, 20), small = r(12, 8, 6, 9)
    expect(superscripted([{ character: "x", box: big }, { character: "2", box: small }])).toBe("x^2")
    const onTheLine = r(12, 10, 10, 20)
    expect(superscripted([{ character: "2", box: onTheLine }, { character: "x", box: big }])).toBe("2x")
  })
})

/**
 * PORT ONLY (no Swift twin): Windows' OCR engine boxes each word to its ink, where Vision's boxes are line-high,
 * and the rules above - made for line-high boxes - invented marks on plain typed text. See `StrikeReader`.
 */
describe("when the reader's word boxes hug the ink (Windows)", () => {
  // A 5-letter word whose tight box is 60 x 24: one 3-wide stem to a letter, 12 columns to a letter.
  const word = r(20, 10, 60, 24)
  const letters = (): Rect[] => [0, 1, 2, 3, 4].map((i) => r(20 + i * 12, 10, 3, 24))
  const tight = (characters: number) => ({ tight: true, characters })

  it("a letter's crossbar is not a strike through a short word", () => {
    // The t and the o of "to": a bar across t, the top of o - one row 80% inked - in a box that hugs them.
    const to = r(20, 10, 26, 24)
    const ink = mask([r(20, 20, 10, 2), r(32, 20, 14, 2), r(22, 10, 3, 24), r(32, 22, 3, 12), r(43, 22, 3, 12)])
    expect(struckThrough(to, ink, width, height)).toBe(true)                 // Vision's rule, as it always was
    expect(struckThrough(to, ink, width, height, tight(2))).toBe(false)      // here it is the word's own crossbar
  })
  it("the line along the tops of the lower-case letters is not a strike", () => {
    // A cap over every stem: 83% of one row (a gap of two columns between the letters), a stem's width of ink above and below.
    const ink = mask([...letters(), ...[0, 1, 2, 3, 4].map((i) => r(20 + i * 12, 20, 10, 2))])
    expect(struckThrough(word, ink, width, height)).toBe(true)
    expect(struckThrough(word, ink, width, height, tight(5))).toBe(false)
  })
  it("a pen line the whole width of the word is one", () => {
    expect(struckThrough(word, mask([...letters(), r(20, 21, 60, 3)]), width, height, tight(5))).toBe(true)
    // ...a wobble of a row or two does not spoil it...
    expect(struckThrough(word, mask([...letters(), r(20, 21, 20, 2), r(40, 22, 20, 2), r(60, 21, 20, 3)]), width, height, tight(5))).toBe(true)
    // ...but a line with a hole in it, or one that stops short, is not a pen line through the word.
    expect(struckThrough(word, mask([...letters(), r(20, 21, 24, 3), r(52, 21, 28, 3)]), width, height, tight(5))).toBe(false)
    expect(struckThrough(word, mask([...letters(), r(20, 21, 49, 3)]), width, height, tight(5))).toBe(false)
  })
  it("a word of one to three letters is never struck: it is nothing but crossbar", () => {
    const bar = mask([r(20, 21, 60, 3)])
    for (const n of [0, 1, 2, 3]) expect(struckThrough(word, bar, width, height, tight(n))).toBe(false)
    expect(struckThrough(word, bar, width, height, tight(4))).toBe(true)
    expect(struckThrough(word, bar, width, height, { tight: true })).toBe(false)
  })

  it("a ring is clearly bigger than the word, a glyph the size of the word is not a ring", () => {
    const tv = r(20, 20, 30, 20)
    // The blob 'TV' IS the word's box: isRing takes it for a ring, encircles takes 100% of the word for held.
    expect(isRing(tv, 0.3, 200)).toBe(true)
    expect(encircles(tv, tv)).toBe(true)
    expect(encirclesClearly(tv, tv)).toBe(false)
    expect(encirclesClearly(r(19, 19, 32, 22), tv)).toBe(false)               // a pixel of blur is not a ring
    expect(encirclesClearly(r(15, 14, 40, 32), tv)).toBe(true)
    expect(encirclesClearly(r(15, 14, 40, 22), tv)).toBe(false)               // not over the bottom
    expect(encirclesClearly(r(15, 14, 30, 32), tv)).toBe(false)               // not past the right
  })
})
