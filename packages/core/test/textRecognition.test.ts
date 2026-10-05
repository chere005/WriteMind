import { describe, expect, it } from "vitest"
import type { Rect } from "../src/drawing/shapes"
import {
  composeLines, flowWordsFrom, isJapanese, joinAcrossArrows, joinWords, looksLikeText, paintOutDots,
  parseOcrJson, place, readingPageOf, tidyReading, wordsOf, type OcrLine, type OcrReading, type OcrWord,
} from "../src/capture/textRecognition"
import { mathInline } from "../src/math/typesetter"
import { Canvas } from "./raster"

/**
 * The words of a picture put together as markdown. Transcribed from
 * `WriteMindTests/TextRecognitionTests.swift`: the Swift tests draw a page
 * and ask Vision; here the reader's answer is written out by hand (boxes as
 * fractions of the picture, y down - the shape `wm-ocr.ps1` and `wm-vision`
 * give) and the page's ink is drawn in code, so the rules that put the two
 * together are the ones under test.
 */
const W = 700, H = 200
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h })

/** A reading's word: a box in PIXELS of the W x H picture, turned into fractions. */
const word = (text: string, box: Rect): OcrWord =>
  ({ text, x: box.x / W, y: box.y / H, width: box.width / W, height: box.height / H })

function line(words: [string, Rect][], confidence = 1): OcrLine {
  const boxes = words.map(([, b]) => b)
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height))
  return {
    confidence,
    ...word(words.map(([t]) => t).join(" "), r(x0, y0, x1 - x0, y1 - y0)),
    words: words.map(([t, b]) => word(t, b)),
  }
}

const reading = (...lines: OcrLine[]): OcrReading => ({ lines })

/** A page of the picture's size, with whatever is drawn on it as ink. */
function pageOf(draw: (c: Canvas) => void = () => {}) {
  const c = new Canvas(W, H)
  c.lineWidth = 3
  draw(c)
  const gray = new Uint8Array(W * H)
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(c.data[i]!)
  return { page: readingPageOf(gray, W, H)!, gray }
}

describe("what counts as text", () => {
  it("kana counts as a word and a stroke does not", () => {
    expect(looksLikeText("え", 0.8)).toBe(true)
    expect(looksLikeText("メモ 123", 0.8)).toBe(true)
    expect(looksLikeText("ー", 0.9)).toBe(false)
    expect(looksLikeText("、 。 ・", 0.9)).toBe(false)
  })
  it("doodles and dots are not text", () => {
    expect(looksLikeText("Hello World", 0.9)).toBe(true)
    expect(looksLikeText("42", 0.6)).toBe(true)
    expect(looksLikeText("I like building tools.", 0.4)).toBe(true)
    expect(looksLikeText("~ ' ` -", 0.9)).toBe(false)
    expect(looksLikeText("l l l l", 0.8)).toBe(false)
    expect(looksLikeText("Hello", 0.1)).toBe(false)
    expect(looksLikeText("", 1)).toBe(false)
  })
  it("knows Japanese", () => {
    expect(isJapanese("会議")).toBe(true)
    expect(isJapanese("カタカナ")).toBe(true)
    expect(isJapanese("Meeting")).toBe(false)
  })
})

describe("the reader's JSON", () => {
  it("is parsed into lines with their words, boxes kept inside the picture", () => {
    const parsed = parseOcrJson(JSON.stringify({
      language: "en-US", installed: ["en-US"], japanese: false,
      lines: [{
        text: "Buy milk", confidence: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.1,
        words: [{ text: "Buy", x: 0.1, y: 0.2, width: 0.1, height: 0.1 }, { text: "milk", x: 0.9, y: 0.2, width: 0.5, height: 0.1 }],
      }],
    }))
    if (!("reading" in parsed)) throw new Error("expected a reading")
    expect(parsed.reading.language).toBe("en-US")
    expect(parsed.reading.japanese).toBe(false)
    expect(parsed.reading.lines[0]!.words).toHaveLength(2)
    // "milk" started at 0.9 and was 0.5 wide: it is cut to the picture's edge.
    expect(parsed.reading.lines[0]!.words![1]!.width).toBeCloseTo(0.1, 6)
  })
  it("drops what is not a line and reports the reader's own error", () => {
    const parsed = parseOcrJson(JSON.stringify({ lines: [null, 3, { text: "" }, { text: "ok", x: "bad" }] }))
    if (!("reading" in parsed)) throw new Error("expected a reading")
    expect(parsed.reading.lines.map((l) => l.text)).toEqual(["ok"])
    expect(parseOcrJson(JSON.stringify({ error: "no OCR language" }))).toEqual({ error: "no OCR language" })
    expect(parseOcrJson("not json")).toHaveProperty("error")
    expect(parseOcrJson("[]")).toHaveProperty("error")
  })
})

describe("Japanese comes back as Japanese", () => {
  it("joins words with spaces except between two Japanese characters", () => {
    expect(joinWords(["Meeting", "notes", "会", "議"])).toBe("Meeting notes 会議")
    expect(joinWords(["会", "議", "2026"])).toBe("会議 2026")
    expect(joinWords(["こ", "ん", "に", "ち", "は", "。"])).toBe("こんにちは。")
  })
  it("puts a run of characters read one to a word back into one word, with one box", () => {
    const l = line([["会", r(10, 10, 30, 30)], ["議", r(42, 10, 30, 30)], ["notes", r(100, 10, 80, 30)]])
    const words = wordsOf(l)
    expect(words.map((w) => w.text)).toEqual(["会議", "notes"])
    expect(words[0]!.width * W).toBeCloseTo(62, 5)
    expect(tidyReading(reading(l)).lines[0]!.text).toBe("会議 notes")
  })
  it("a line is read as words even when the reader gave no word boxes", () => {
    const words = wordsOf({ text: "Buy milk", confidence: 1, x: 0, y: 0, width: 0.5, height: 0.1 })
    expect(words.map((w) => w.text)).toEqual(["Buy", "milk"])
    expect(words[1]!.x).toBeGreaterThan(words[0]!.x + words[0]!.width - 1e-9)
    expect(words[1]!.x + words[1]!.width).toBeLessThanOrEqual(0.5 + 1e-9)
  })
})

describe("lines come back in reading order", () => {
  it("top to bottom, and left to right on one band", () => {
    const out = composeLines(reading(
      line([["second", r(30, 100, 150, 40)]]),
      line([["right", r(400, 20, 100, 40)]]),
      line([["left", r(30, 22, 100, 40)]]),
    ), null)
    expect(out).toEqual(["left", "right", "second"])
  })
  it("a word with a descender does not leave its line (the middles are not what makes a band)", () => {
    // "pay" hangs below its line, "rent" does not: three readings, one line of writing.
    const out = composeLines(reading(
      line([["rent", r(330, 40, 120, 40)]]),
      line([["today", r(560, 40, 150, 56)]]),
      line([["pay", r(40, 42, 90, 56)]]),
    ), null)
    expect(out).toEqual(["pay rent today"])
  })
  it("readings a wide gap apart stay separate (a column, not a word space)", () => {
    const out = composeLines(reading(
      line([["name", r(40, 40, 120, 40)]]), line([["address", r(500, 40, 160, 40)]])), null)
    expect(out).toEqual(["name", "address"])
  })
  it("a blank picture reads as nothing", () => {
    expect(composeLines(reading(), pageOf().page)).toEqual([])
  })
  it("English is left exactly as it was", () => {
    const { page } = pageOf()
    const out = composeLines(reading(
      line([["Buy", r(30, 20, 70, 40)], ["milk", r(110, 20, 90, 40)], ["and", r(210, 20, 70, 40)], ["bread", r(290, 20, 100, 40)]]),
      line([["call", r(30, 100, 80, 40)], ["the", r(120, 100, 60, 40)], ["plumber", r(190, 100, 150, 40)]]),
    ), page)
    expect(out).toEqual(["Buy milk and bread", "call the plumber"])
  })
  it("a page with round letters grows no task marker", () => {
    const { page } = pageOf()
    expect(composeLines(reading(
      line([["Order", r(30, 20, 120, 40)], ["flowers", r(160, 20, 150, 40)]]),
      line([["Odd", r(30, 100, 90, 40)], ["one", r(130, 100, 70, 40)], ["out", r(210, 100, 70, 40)]]),
    ), page)).toEqual(["Order flowers", "Odd one out"])
  })
  it("doodles read with no confidence are dropped", () => {
    const { page } = pageOf()
    expect(composeLines(reading(
      line([["Hello", r(30, 20, 100, 40)]]), line([["~ ' `", r(30, 100, 60, 40)]], 0.1)), page)).toEqual(["Hello"])
  })
})

describe("marks drawn over the words", () => {
  const buy = ["buy", r(30, 60, 80, 40)] as [string, Rect]
  const milk = ["milk", r(130, 60, 120, 40)] as [string, Rect]

  it("a line through a word arrives struck out", () => {
    const { page } = pageOf((c) => c.line({ x: 130, y: 80 }, { x: 250, y: 80 }))
    expect(composeLines(reading(line([buy, milk])), page)).toEqual(["buy ~~milk~~"])
  })
  it("a line under a word is not a strike", () => {
    const { page } = pageOf((c) => c.line({ x: 130, y: 112 }, { x: 250, y: 112 }))
    expect(composeLines(reading(line([buy, milk])), page)).toEqual(["buy milk"])
  })
  it("a ring round a word makes it bold", () => {
    const { page } = pageOf((c) => c.strokeEllipse(115, 35, 150, 80))
    expect(composeLines(reading(line([buy, milk])), page)).toEqual(["buy **milk**"])
  })
  it("a ring read as an O is not a letter of the note", () => {
    const { page } = pageOf((c) => c.strokeEllipse(115, 35, 150, 80))
    expect(composeLines(reading(
      line([buy, milk]), line([["O", r(150, 70, 70, 20)]])), page)).toEqual(["buy **milk**"])
  })
  it("an arrow the reader did not read goes between the two words", () => {
    // "Paris" and "Lyon" with a wide space between and a small arrow in it,
    // clear of the letters at both ends; the letters are blocks of ink.
    const { page } = pageOf((c) => {
      c.fillRect(30, 70, 150, 30)
      c.fillRect(420, 70, 120, 30)
      c.line({ x: 250, y: 85 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 75 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 95 }, { x: 350, y: 85 })
    })
    const out = composeLines(reading(line([["Paris", r(30, 70, 150, 30)], ["Lyon", r(420, 70, 120, 30)]])), page)
    expect(out).toEqual(["Paris → Lyon"])
  })
  it("an arrow the reader DID read is not put in twice", () => {
    const { page } = pageOf((c) => {
      c.fillRect(30, 70, 150, 30)
      c.fillRect(420, 70, 120, 30)
      c.line({ x: 250, y: 85 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 75 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 95 }, { x: 350, y: 85 })
    })
    const out = composeLines(reading(line([["Paris", r(30, 70, 150, 30)], ["->", r(250, 70, 100, 30)], ["Lyon", r(420, 70, 120, 30)]])), page)
    expect(out).toEqual(["Paris → Lyon"])
  })
  it("an arrow between two readings the engine split at the gap joins them into one line", () => {
    // Windows' engine hands "Paris" and "Lyon" back as two lines, and says nothing of the arrow between.
    const { page } = pageOf((c) => {
      c.fillRect(30, 70, 150, 30)
      c.fillRect(420, 70, 120, 30)
      c.line({ x: 250, y: 85 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 75 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 95 }, { x: 350, y: 85 })
    })
    const out = composeLines(reading(line([["Paris", r(30, 70, 150, 30)]]), line([["Lyon", r(420, 70, 120, 30)]])), page)
    expect(out).toEqual(["Paris → Lyon"])
  })
  it("…but an arrow BELOW two readings is not between them", () => {
    const { page } = pageOf((c) => {
      c.fillRect(30, 20, 150, 30)
      c.fillRect(420, 20, 120, 30)
      c.line({ x: 250, y: 150 }, { x: 350, y: 150 })
      c.line({ x: 335, y: 140 }, { x: 350, y: 150 })
      c.line({ x: 335, y: 160 }, { x: 350, y: 150 })
    })
    const out = composeLines(reading(line([["Paris", r(30, 20, 150, 30)]]), line([["Lyon", r(420, 20, 120, 30)]])), page)
    expect(out).toEqual(["Paris", "Lyon", "→"])
  })
  it("an arrow well away from the writing keeps a line of its own", () => {
    const { page } = pageOf((c) => {
      c.fillRect(30, 20, 150, 30)
      c.fillRect(420, 20, 120, 30)
      c.line({ x: 250, y: 150 }, { x: 350, y: 150 })
      c.line({ x: 335, y: 140 }, { x: 350, y: 150 })
      c.line({ x: 335, y: 160 }, { x: 350, y: 150 })
    })
    const out = composeLines(reading(line([["Paris", r(30, 20, 150, 30)], ["Lyon", r(420, 20, 120, 30)]])), page)
    expect(out).toEqual(["Paris Lyon", "→"])
  })
})

describe("checkboxes", () => {
  /** A list: a 34-pixel box at the head of each line, ticked or not, and the word beside it. */
  function checklist(items: [boolean, string][]) {
    const lines = items.map(([, text], i) => line([[text, r(84, 20 + i * 80, 130, 40)]]))
    const { page } = pageOf((c) => {
      items.forEach(([ticked], i) => {
        const y = 22 + i * 80
        c.strokeRect(30, y, 34, 34)
        if (ticked) c.polyline([{ x: 36, y: y + 17 }, { x: 47, y: y + 28 }, { x: 59, y: y + 6 }])
      })
    })
    return { lines, page }
  }
  it("a drawn box comes back as a task item", () => {
    const { lines, page } = checklist([[true, "milk"], [false, "bread"]])
    expect(composeLines(reading(...lines), page)).toEqual(["- [x] milk", "- [ ] bread"])
  })
  it("the letter the reader took the box for does not stay in the words", () => {
    const { page } = checklist([[false, "milk"]])
    const out = composeLines(reading(line([["D", r(30, 22, 34, 34)], ["milk", r(84, 20, 130, 40)]])), page)
    expect(out).toEqual(["- [ ] milk"])
  })
  it("a box drawn over a word halfway along is not the line's checkbox", () => {
    const { page } = pageOf((c) => c.strokeRect(260, 36, 34, 34))
    const out = composeLines(reading(line([["call", r(30, 30, 100, 40)], ["the", r(140, 30, 90, 40)], ["plumber", r(240, 30, 150, 40)]])), page)
    expect(out).toHaveLength(1)
    expect(out[0]!.startsWith("- [")).toBe(false)
  })
})

describe("maths", () => {
  it("a drawn line of algebra comes back as maths, with the operators not struck out", () => {
    // Every operator is a bar across the middle of its own box: ink for them.
    const { page } = pageOf((c) => {
      c.line({ x: 120, y: 70 }, { x: 150, y: 70 })     // =
      c.line({ x: 120, y: 82 }, { x: 150, y: 82 })
      c.line({ x: 260, y: 75 }, { x: 290, y: 75 })     // +
    })
    const out = composeLines(reading(line([
      ["x", r(40, 50, 40, 50)], ["=", r(115, 55, 40, 40)], ["2y", r(170, 50, 70, 50)],
      ["+", r(255, 55, 40, 40)], ["1", r(310, 50, 30, 50)],
    ])), page)
    expect(out).toEqual([mathInline("x = 2y + 1")])
  })
  it("a sentence with a number in it is not maths", () => {
    const { page } = pageOf()
    expect(composeLines(reading(line([["buy", r(30, 20, 80, 40)], ["3", r(120, 20, 30, 40)], ["apples", r(160, 20, 130, 40)]])), page))
      .toEqual(["buy 3 apples"])
  })
})

describe("two readings split by an arrow become one line", () => {
  const left = { y: 0.6, box: r(20, 40, 90, 32), text: "Paris" }
  it("joins the halves of one line", () => {
    const right = { y: 0.6, box: r(180, 42, 180, 34), text: "→ Lyon" }
    expect(joinAcrossArrows([left, right]).map((p) => p.text)).toEqual(["Paris → Lyon"])
  })
  it("a column away is not the same line", () => {
    const far = { y: 0.6, box: r(600, 42, 180, 34), text: "→ Lyon" }
    expect(joinAcrossArrows([left, far]).map((p) => p.text)).toEqual(["Paris", "→ Lyon"])
  })
  it("the line below is not this line", () => {
    const below = { y: 0.3, box: r(180, 120, 180, 34), text: "→ Lyon" }
    expect(joinAcrossArrows([left, below]).map((p) => p.text)).toEqual(["Paris", "→ Lyon"])
  })
  it("nothing but an arrow joins two readings", () => {
    const plain = { y: 0.6, box: r(180, 42, 180, 34), text: "Lyon" }
    expect(joinAcrossArrows([left, plain]).map((p) => p.text)).toEqual(["Paris", "Lyon"])
  })
  it("end to end", () => {
    const { page } = pageOf()
    expect(composeLines(reading(
      line([["Paris", r(20, 40, 90, 32)]]), line([["→", r(180, 42, 40, 34)], ["Lyon", r(230, 42, 130, 34)]])), page))
      .toEqual(["Paris → Lyon"])
  })
})

describe("where an arrow found in the ink goes", () => {
  const band = r(20, 10, 160, 30)
  const letters = [r(20, 12, 40, 26), r(140, 12, 40, 26)]
  const words = [{ text: "Paris", box: letters[0]! }, { text: "Lyon", box: letters[1]! }]
  const where = (arrow: Rect) => place(arrow, [{ box: band, words }], [...letters, arrow])

  it("goes inline, beside, or is left to the reader", () => {
    expect(where(r(70, 20, 50, 8))).toEqual({ kind: "inline", line: 0, before: 1 })
    expect(where(r(70, 70, 50, 8))).toEqual({ kind: "ownLine" })
    expect(where(r(220, 20, 40, 8))).toEqual({ kind: "ownLine" })
    expect(where(r(25, 18, 30, 8))).toEqual({ kind: "read" })
  })
  it("an arrow the reader did read, in the gap, is a duplicate", () => {
    const arrow = r(70, 20, 50, 8)
    const already = [words[0]!, { text: "→", box: arrow }, words[1]!]
    expect(place(arrow, [{ box: band, words: already }], [...letters, arrow])).toEqual({ kind: "read" })
  })
})

describe("the dot grid", () => {
  function dotted(): { rgba: Uint8ClampedArray; gray: Uint8Array } {
    const gray = new Uint8Array(W * H).fill(255)
    for (let y = 24; y < H; y += 24) for (let x = 24; x < W; x += 24) {
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) gray[(y + dy) * W + x + dx] = 158
    }
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < gray.length; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i]!
      rgba[i * 4 + 3] = 255
    }
    return { rgba, gray }
  }
  it("is painted out in the paper's own colour", () => {
    const { rgba, gray } = dotted()
    const page = readingPageOf(gray, W, H)!
    expect(page.marks.lattice).not.toBeNull()
    expect(paintOutDots(rgba, W, H, gray, page)).toBe(true)
    expect(rgba[(26 * W + 26) * 4]).toBeGreaterThan(235)
    expect(rgba[(26 * W + 26) * 4 + 3]).toBe(255)
  })
  it("a page with no grid is left untouched", () => {
    const gray = new Uint8Array(W * H).fill(255)
    const rgba = new Uint8ClampedArray(W * H * 4).fill(255)
    expect(paintOutDots(rgba, W, H, gray, readingPageOf(gray, W, H)!)).toBe(false)
  })
})

describe("the flow chart's words", () => {
  it("are the reader's words, in the pixels of the picture they were read from", () => {
    const words = flowWordsFrom(reading(
      line([["Start", r(100, 50, 80, 30)]]), line([["Go", r(300, 120, 40, 30)], ["on", r(350, 120, 40, 30)]])), { width: 1400, height: 400 })
    expect(words.map((w) => w.text)).toEqual(["Start", "Go", "on"])
    expect(words[0]!.box.x).toBeCloseTo(200, 6)
    expect(words[0]!.box.width).toBeCloseTo(160, 6)
    expect(words[0]!.box.y).toBeCloseTo(100, 6)
  })
  it("a stray bar the reader took for a letter is not a label", () => {
    const words = flowWordsFrom(reading(line([["|", r(100, 50, 6, 40)], ["Start", r(120, 50, 80, 30)], ["—", r(210, 60, 40, 6)]])), { width: W, height: H })
    expect(words.map((w) => w.text)).toEqual(["Start"])
  })
  it("a word with no box is not a word of the chart", () => {
    expect(flowWordsFrom({ lines: [{ text: "x", confidence: 1, x: 0, y: 0, width: 0, height: 0 }] }, { width: 100, height: 100 })).toEqual([])
  })
})

/**
 * PORT ONLY: the same marks, for a reader whose word boxes hug the ink (`engine: "windows"`). The rules were made
 * for Vision's line-high boxes; see `StrikeReader` and `ocrPictures.test.ts` (real readings of real pictures).
 */
describe("marks on a reading whose boxes hug the ink", () => {
  const windows = (...lines: OcrLine[]): OcrReading => ({ engine: "windows", lines })

  it("a letter-sized blob the size of its word is not a ring round it", () => {
    // 'TV': one hollow-ish blob as big as the box the reader gave it.
    const tv = r(130, 60, 80, 60)
    const { page } = pageOf((c) => c.strokeEllipse(tv.x, tv.y, tv.width, tv.height))
    const read = line([["call", r(30, 60, 80, 40)], ["TV", tv]])
    expect(composeLines(reading(read), page)).toEqual(["call **TV**"])                // Vision's boxes: unchanged
    expect(composeLines(windows(read), page)).toEqual(["call TV"])
  })
  it("a ring that was drawn round the word still is one", () => {
    const { page } = pageOf((c) => c.strokeEllipse(115, 35, 150, 80))
    expect(composeLines(windows(line([["buy", r(30, 60, 80, 40)], ["milk", r(130, 60, 120, 40)]])), page)).toEqual(["buy **milk**"])
  })
  it("a typed O beside a word is an O; the O a ring was read as is dropped", () => {
    // The engine splits a line at a wide gap: "Option" and "O" come back as two lines of one band.
    const alone = pageOf((c) => c.strokeEllipse(300, 40, 60, 60))
    const typed = [line([["Option", r(100, 40, 160, 60)]]), line([["O", r(300, 40, 60, 60)]])]
    expect(composeLines(reading(...typed), alone.page)).toEqual(["Option"])            // the Mac's rule: a ring read as O
    expect(composeLines(windows(...typed), alone.page)).toEqual(["Option O"])          // nothing inside it: a letter
    // The same ring with a word inside it is a drawn one, and the O it was read as goes.
    const drawn = pageOf((c) => c.strokeEllipse(115, 35, 150, 80))
    expect(composeLines(windows(
      line([["buy", r(30, 60, 80, 40)], ["milk", r(130, 60, 120, 40)]]), line([["O", r(115, 35, 150, 80)]])), drawn.page))
      .toEqual(["buy **milk**"])
  })
  it("a tall lopsided letter inside a word is not an arrow between words", () => {
    // The stem and hook of an f or a t: long, thin, one end heavier - which is what an arrow is.
    const { page } = pageOf((c) => {
      c.line({ x: 150, y: 60 }, { x: 150, y: 100 })
      c.line({ x: 150, y: 62 }, { x: 160, y: 66 })
      c.line({ x: 143, y: 74 }, { x: 158, y: 74 })
      c.fillRect(30, 70, 60, 30)
      c.fillRect(190, 70, 60, 30)
    })
    const read = line([["so", r(30, 70, 60, 30)], ["after", r(135, 55, 40, 50)], ["so", r(190, 70, 60, 30)]])
    expect(composeLines(windows(read), page)).toEqual(["so after so"])
  })
  it("an arrow in the gap between two words is still an arrow", () => {
    const { page } = pageOf((c) => {
      c.fillRect(30, 70, 150, 30)
      c.fillRect(420, 70, 120, 30)
      c.line({ x: 250, y: 85 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 75 }, { x: 350, y: 85 })
      c.line({ x: 335, y: 95 }, { x: 350, y: 85 })
    })
    expect(composeLines(windows(line([["Paris", r(30, 70, 150, 30)], ["Lyon", r(420, 70, 120, 30)]])), page)).toEqual(["Paris → Lyon"])
  })
  it("a bar through a long word is a strike, through a short one it is the word's crossbar", () => {
    const { page } = pageOf((c) => c.line({ x: 130, y: 80 }, { x: 250, y: 80 }))
    expect(composeLines(windows(line([["buy", r(30, 60, 80, 40)], ["milk", r(130, 60, 120, 40)]])), page)).toEqual(["buy ~~milk~~"])
    expect(composeLines(windows(line([["buy", r(30, 60, 80, 40)], ["to", r(130, 60, 120, 40)]])), page)).toEqual(["buy to"])
  })
})

describe("the reader's angle", () => {
  it("is kept by parseOcrJson, and only when it is a number", () => {
    const one = (extra: object) => {
      const parsed = parseOcrJson(JSON.stringify({ lines: [{ text: "hi", x: 0, y: 0, width: 0.1, height: 0.1 }], ...extra }))
      return "reading" in parsed ? parsed.reading : null
    }
    expect(one({ angle: -2.5, engine: "windows" })).toMatchObject({ angle: -2.5, engine: "windows" })
    expect(one({ angle: null })?.angle).toBeUndefined()
    expect(one({ angle: "x" })?.angle).toBeUndefined()
  })
  it("a flow chart's word keeps its place on a picture the reader did not turn", () => {
    const words = flowWordsFrom({ angle: 0, lines: [line([["Start", r(100, 50, 80, 30)]])] }, { width: 1400, height: 400 })
    expect(words[0]!.box.x).toBeCloseTo(200, 6)
    expect(words[0]!.box.y).toBeCloseTo(100, 6)
  })
})
