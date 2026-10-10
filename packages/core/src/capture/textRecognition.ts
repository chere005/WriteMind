/**
 * The words in a picture, put together as markdown. Ported from
 * `WriteMind/Camera/TextRecognition.swift` (everything in it that is not the
 * call into Vision): the reader's lines and the words in them, sorted onto
 * the marks drawn on the page — a line through a word, a ring round one, an
 * arrow, a box at the head of a line, a sum — and written as the markdown the
 * Mac writes. Tests: `packages/core/test/textRecognition.test.ts`
 * (`WriteMindTests/TextRecognitionTests.swift`).
 *
 * WHICH READER IS NOT THIS FILE'S BUSINESS. macOS gives Vision's lines,
 * Windows gives `Windows.Media.Ocr`'s (apps/desktop/src/helpers/wm-ocr.ps1),
 * tesseract gives text and nothing else; all of them arrive as an
 * `OcrReading`, boxes as FRACTIONS of the picture with y DOWN, and the same
 * rules turn it into a note. A reader with no word boxes gets estimated ones
 * (a line's box shared out by letters), enough to say which word has a bar
 * through it. A reader with no per-character boxes (Windows) cannot raise a
 * digit into a power; that is the one rule of the Mac's that this data
 * cannot carry.
 */

import type { Rect } from "../drawing/shapes"
import { mathInline } from "../math/typesetter"
import type { OcrEngine } from "../platform/capabilities"
import { componentFill, darkerThanPaper, localMean, marks as findMarks, type Marks } from "./ink"
import { boxToPicture, deskewGray, paperLevel, usableAngle } from "./deskew"
import {
  arrow, betweenWords, checkbox, encircles, encirclesClearly, endsWithArrow, isArrowRead, isBoxRead, isOperatorRead,
  isRing, isRingRead, looksLikeMaths, mostlyInside, normaliseArrows, sameBand, startsLine,
  startsWithArrow, struckThrough, superscripted, taskItem, wolfram, type MarkWord,
} from "./handwritingMarks"
import { rectIntersects, rectMaxX, rectUnion } from "./rects"
import type { FlowWord } from "./flowGrouping"

// MARK: - What a reader hands back

/** One word with its box, as fractions of the picture (y down). */
export interface OcrWord { text: string; x: number; y: number; width: number; height: number }

/** One line of the reading. `words` may be absent (Vision's `text` command, tesseract). */
export interface OcrLine {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
  words?: OcrWord[]
}

export interface OcrReading {
  lines: OcrLine[]
  /**
   * Which reader made it. It matters to the mark rules: Windows' word boxes hug the
   * ink, Vision's (and the estimated ones) are line-high (see `StrikeReader`).
   */
  engine?: OcrEngine | null
  /**
   * How far the reader turned a tilted picture to read it, in degrees (clockwise
   * positive; Windows' `TextAngle`). Every box in the reading is in THAT frame:
   * see deskew.ts. Null/absent: the boxes are on the picture as it is.
   */
  angle?: number | null
  /** The language the reading was made in, when the reader says (BCP-47). */
  language?: string | null
  /** Every language the reader can read on this machine. */
  installed?: string[]
  /** Whether Japanese is among them. */
  japanese?: boolean
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/**
 * A reader's JSON, which is not trusted: anything missing is dropped, boxes
 * are kept inside the picture, a line with no text is not a line. Returns the
 * reader's own `error` as a string when it said it could not read.
 */
export function parseOcrJson(json: string): { reading: OcrReading } | { error: string } {
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return { error: "the reader did not answer in JSON" } }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "the reader did not answer in JSON" }
  const object = raw as Record<string, unknown>
  if (typeof object.error === "string" && !Array.isArray(object.lines)) return { error: object.error }

  const box = (value: Record<string, unknown>) => {
    const x = clamp01(finite(value.x, 0)), y = clamp01(finite(value.y, 0))
    return {
      x, y,
      width: Math.min(1 - x, Math.max(0, finite(value.width, 0))),
      height: Math.min(1 - y, Math.max(0, finite(value.height, 0))),
    }
  }
  const lines: OcrLine[] = []
  for (const entry of Array.isArray(object.lines) ? object.lines : []) {
    if (typeof entry !== "object" || entry === null) continue
    const line = entry as Record<string, unknown>
    const text = typeof line.text === "string" ? line.text : ""
    const words: OcrWord[] = []
    for (const part of Array.isArray(line.words) ? line.words : []) {
      if (typeof part !== "object" || part === null) continue
      const word = part as Record<string, unknown>
      if (typeof word.text !== "string" || word.text.trim() === "") continue
      words.push({ text: word.text, ...box(word) })
    }
    if (text.trim() === "" && words.length === 0) continue
    lines.push({
      text, confidence: finite(line.confidence, 1), ...box(line),
      ...(words.length > 0 ? { words } : {}),
    })
  }
  return {
    reading: {
      lines,
      ...(object.engine === "bundled" || object.engine === "vision" || object.engine === "windows" || object.engine === "tesseract"
        ? { engine: object.engine } : {}),
      ...(typeof object.angle === "number" && Number.isFinite(object.angle) ? { angle: object.angle } : {}),
      language: typeof object.language === "string" ? object.language : null,
      installed: Array.isArray(object.installed)
        ? object.installed.filter((tag): tag is string => typeof tag === "string") : [],
      japanese: object.japanese === true,
    },
  }
}

// MARK: - Japanese and what counts as text

/**
 * Kana, kanji and the full-width forms — what tells a Japanese reading from
 * an English one.
 */
export function isJapaneseCode(code: number): boolean {
  return (code >= 0x3040 && code <= 0x309f)   // hiragana
    || (code >= 0x30a0 && code <= 0x30ff)     // katakana
    || (code >= 0x31f0 && code <= 0x31ff)     // katakana phonetic extensions
    || (code >= 0x3400 && code <= 0x4dbf)     // kanji, extension A
    || (code >= 0x4e00 && code <= 0x9fff)     // kanji
    || (code >= 0xff66 && code <= 0xff9d)     // half-width katakana
}

export const isJapanese = (text: string): boolean =>
  Array.from(text).some((c) => isJapaneseCode(c.codePointAt(0)!))

/** A single stroke that a doodle or a dot grid reads as, rather than a word. */
export const isStrokeLike = (c: string): boolean => "ー一ノ丶丿亅乀乁〇々〜・。、".includes(c)

/**
 * Vision finds "text" in a doodle, a dot grid, a diagram: a few stray
 * characters read with little confidence. Only what is read with some
 * confidence, has a word in it, and is mostly letters and digits counts.
 * Japanese counts too: one kana is a word, so 「え」 is kept — but the strokes
 * a doodle reads as (ー 一 ノ 丶 、 。) are not.
 */
export function looksLikeText(text: string, confidence: number): boolean {
  if (confidence < 0.3) return false
  const visible = Array.from(text).filter((c) => !/\s/.test(c))
  if (visible.length === 0) return false
  const alphanumeric = (c: string): boolean => /[\p{L}\p{M}\p{N}]/u.test(c)
  const letters = visible.filter(alphanumeric).length
  if (letters / visible.length < 0.5) return false
  return text.split(/\s+/).filter((token) => token.length > 0).some((token) => {
    const chars = Array.from(token)
    return chars.filter(alphanumeric).length >= 2
      || chars.some((c) => isJapaneseCode(c.codePointAt(0)!) && !isStrokeLike(c))
  })
}

/** Characters that run together without a space: kana, kanji, CJK punctuation, full-width forms. */
const isCjkGlyph = (c: string): boolean => {
  const code = c.codePointAt(0)!
  return isJapaneseCode(code) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef)
    || (code >= 0xac00 && code <= 0xd7af)
}

/** Words written out as a line: spaces between them, except between two Japanese characters. */
export function joinWords(texts: string[]): string {
  let out = ""
  for (const text of texts) {
    if (text === "") continue
    if (out !== "") {
      const last = Array.from(out).pop()!, first = Array.from(text)[0]!
      if (!(isCjkGlyph(last) && isCjkGlyph(first))) out += " "
    }
    out += text
  }
  return out
}

// MARK: - A reading, tidied

const boxOf = (item: { x: number; y: number; width: number; height: number }): Rect =>
  ({ x: item.x, y: item.y, width: item.width, height: item.height })

/**
 * A line's words. A reader with no word boxes gets its line's box shared out
 * by letters, which is enough to say which word is the struck one. Windows'
 * Japanese reading comes one CHARACTER to a word ("会 議"), which would put
 * a line through each; runs of Japanese characters are put back together.
 */
export function wordsOf(line: OcrLine): OcrWord[] {
  let words: OcrWord[]
  if (line.words && line.words.length > 0) {
    words = line.words
  } else {
    const tokens = line.text.split(/\s+/).filter((token) => token.length > 0)
    const letters = tokens.reduce((sum, token) => sum + Array.from(token).length, 0) + Math.max(0, tokens.length - 1)
    let at = line.x
    words = tokens.map((text) => {
      const share = (Array.from(text).length / Math.max(1, letters)) * line.width
      const word = { text, x: at, y: line.y, width: share, height: line.height }
      at += share + (1 / Math.max(1, letters)) * line.width
      return word
    })
  }
  const merged: OcrWord[] = []
  for (const word of words) {
    const last = merged[merged.length - 1]
    if (last) {
      const left = Array.from(last.text).pop()!, right = Array.from(word.text)[0]!
      if (isCjkGlyph(left) && isCjkGlyph(right)) {
        const union = rectUnion(boxOf(last), boxOf(word))
        merged[merged.length - 1] = { text: last.text + word.text, ...union }
        continue
      }
    }
    merged.push(word)
  }
  return merged
}

/**
 * Lines in reading order: top to bottom, and lines on the same band left to
 * right. Each line's text is made from its words so Windows' spaced-out
 * Japanese reads as Japanese.
 *
 * ON THE SAME BAND is `sameBand` (the boxes overlap by most of the shorter
 * one's height), not "the middles are close": a line's box is the box of its
 * words, so a word with a descender (the p of "pay") sits lower than one
 * without ("rent") and a middle-to-middle test splits one line of writing in
 * two. And Windows' engine splits a line where the gap is wide - "pay    rent
 * today" comes back as three lines - so neighbours on a band that are no more
 * than a line-height and a half apart are put back into one line (further
 * apart they stay separate readings: a column, or an arrow's worth of gap,
 * which `arrowsBetweenPieces` deals with).
 */
export function tidyReading(reading: OcrReading): OcrReading {
  const lines = reading.lines.map((line): OcrLine => {
    const words = wordsOf(line)
    return {
      ...line, words,
      text: words.length > 0 ? joinWords(words.map((word) => word.text)) : line.text.trim(),
    }
  })
  const byHeight = [...lines].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2))
  const bands: { box: Rect; lines: OcrLine[] }[] = []
  for (const line of byHeight) {
    const box = boxOf(line)
    const band = bands.find((one) => sameBand(one.box, box))
    if (band) { band.lines.push(line); band.box = rectUnion(band.box, box) } else bands.push({ box, lines: [line] })
  }
  const ordered: OcrLine[] = []
  for (const band of bands) {
    band.lines.sort((a, b) => a.x - b.x)
    let current = null as OcrLine | null
    for (const line of band.lines) {
      if (current !== null && line.x - (current.x + current.width) <= 1.5 * Math.max(current.height, line.height)) {
        const words: OcrWord[] = [...(current.words ?? []), ...(line.words ?? [])]
        const union = rectUnion(boxOf(current), boxOf(line))
        current = {
          ...current, ...union, words,
          text: joinWords(words.map((word) => word.text)),
          confidence: Math.min(current.confidence, line.confidence),
        }
        continue
      }
      if (current !== null) ordered.push(current)
      current = line
    }
    if (current !== null) ordered.push(current)
  }
  return { ...reading, lines: ordered }
}

// MARK: - The page's ink

/** The picture's ink sorted into blobs, in the mask's pixels. */
export interface ReadingPage {
  ink: Uint8Array
  width: number
  height: number
  marks: Marks
  /**
   * The grey picture the ink was lifted from (the mask's size), kept so the page can be turned
   * into the frame a reader straightened its boxes in (`composeLines`).
   */
  gray?: Uint8Array
}

/** A page whose paper is darker than this is light writing on dark paper. */
const DARK_PAPER = 100

/** How wide a picture is looked at when hunting for the dot grid. */
export const GRID_SEARCH_WIDTH = 1400

/** The ink of a grey picture (top row first) sorted into blobs; null when too small to read. */
export function readingPageOf(gray: Uint8Array, width: number, height: number): ReadingPage | null {
  if (width <= 8 || height <= 8 || gray.length !== width * height) return null
  // LIGHT WRITING ON DARK PAPER (a dark-mode screenshot, chalk on a board): the ink is what is LIGHTER
  // than the paper. Every rule below was made for dark ink, and on the paper's own halo it struck out
  // "white" and "black" of "white on black". Turn the picture over and they see what they always have.
  const seen = paperLevel(gray) < DARK_PAPER ? gray.map((level) => 255 - level) : gray
  const ink = darkerThanPaper(seen, width, height)
  return { ink, width, height, marks: findMarks(ink, width, height), gray }
}

/**
 * The page in the frame the reader's boxes are in: a tilted picture is straightened by the engine
 * before it reads (`OcrReading.angle`), and the ink is turned the same way so the boxes sit on it.
 */
export function pageInReaderFrame(page: ReadingPage, angle: number | null | undefined): ReadingPage {
  const degrees = usableAngle(angle)
  if (degrees === 0 || !page.gray) return page
  return readingPageOf(deskewGray(page.gray, page.width, page.height, degrees), page.width, page.height) ?? page
}

/**
 * The same picture with a printed dot grid painted out in the paper's own
 * colour (Sean, 2026-09-19: "if the paper has a dot background, make sure to
 * ignore the dots"). `rgba` is the picture at ITS size (`imageWidth` by
 * `imageHeight`), `page` the ink found at the mask's size; the picture is
 * changed in place. False when there is no grid — the picture then goes to
 * the reader untouched, so nothing is lost on the pages that never had dots.
 */
export function paintOutDots(rgba: Uint8ClampedArray, imageWidth: number, imageHeight: number,
  gray: Uint8Array, page: ReadingPage): boolean {
  const lattice = page.marks.lattice
  if (!lattice || lattice.size === 0) return false
  const { width, height } = page
  const paper = localMean(gray, width, height, Math.max(8, Math.trunc(Math.min(width, height) / 40)))
  const scaleX = imageWidth / width, scaleY = imageHeight / height
  for (const index of lattice) {
    const dot = page.marks.components[index]!
    const centre = Math.min(paper.length - 1,
      Math.trunc((dot.minY + dot.maxY) / 2) * width + Math.trunc((dot.minX + dot.maxX) / 2))
    const level = paper[centre]!
    // A pixel of slack round the dot: its edge is grey, and grey left
    // behind is what a reader takes for a full stop.
    const x0 = Math.max(0, Math.floor((dot.minX - 1) * scaleX))
    const x1 = Math.min(imageWidth, Math.ceil((dot.maxX + 2) * scaleX))
    const y0 = Math.max(0, Math.floor((dot.minY - 1) * scaleY))
    const y1 = Math.min(imageHeight, Math.ceil((dot.maxY + 2) * scaleY))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const at = (y * imageWidth + x) * 4
        rgba[at] = level
        rgba[at + 1] = level
        rgba[at + 2] = level
        rgba[at + 3] = 255
      }
    }
  }
  return true
}

// MARK: - Putting the reading together

interface Reading1 {
  text: string
  box: Rect
  words: MarkWord[]
  /** How far down the line sits (0…1) — what everything sorts by. */
  y: number
}

/** A mask box for a fraction box. */
const inMask = (item: { x: number; y: number; width: number; height: number }, page: ReadingPage): Rect => ({
  x: item.x * page.width, y: item.y * page.height, width: item.width * page.width, height: item.height * page.height,
})

const blobBox = (page: ReadingPage, index: number): Rect => {
  const blob = page.marks.components[index]!
  return { x: blob.minX, y: blob.minY, width: blob.maxX - blob.minX + 1, height: blob.maxY - blob.minY + 1 }
}

/** The hollow rings drawn round words. */
export function rings(page: ReadingPage): Rect[] {
  const shortSide = Math.min(page.width, page.height)
  return page.marks.writing.flatMap((index) => {
    const blob = page.marks.components[index]!
    const box = blobBox(page, index)
    return isRing(box, componentFill(blob), shortSide) ? [box] : []
  })
}

/** A checkbox found at the head of a line, and whether it is ticked. */
export interface FoundCheckbox { box: Rect; ticked: boolean }

/**
 * The box drawn at the start of a line, if there is one. The geometry is
 * `checkbox`; the guard that makes it safe on a page of ordinary writing is
 * here: a square that sits inside a WORD the reader read — the O of "Order",
 * the 口 of a Japanese line — is a letter, not a box. Only a reading of a
 * single character, which is what a drawn box comes back as when it comes
 * back at all, is allowed to sit on one.
 */
export function checkboxStartingLine(line: Rect, words: MarkWord[], page: ReadingPage): FoundCheckbox | null {
  for (const index of page.marks.writing) {
    const box = blobBox(page, index)
    if (!startsLine(box, line)) continue
    const ticked = checkbox(box, line, page.ink, page.width, page.height)
    if (ticked === null) continue
    // Either way round: the square inside a word is one of its letters, and
    // a word inside the square is what a small flow-chart node has in it.
    const read = words.find((word) => word.box !== null && (mostlyInside(box, word.box) || mostlyInside(word.box, box)))
    if (read && !isBoxRead(read.text)) continue
    return { box, ticked }
  }
  return null
}

/** Where an arrow found in the ink goes. */
export type ArrowPlace =
  | { kind: "inline"; line: number; before: number }
  /** On a line of its own: beside the writing, or above or below it. */
  | { kind: "ownLine" }
  /** Over a line's words — the reader has already read it. */
  | { kind: "read" }

/** Which of the three a mark's box is, against the lines that were read. Pure geometry. */
export function place(box: Rect, lines: { box: Rect; words: MarkWord[] }[], among: Rect[],
  tight = false): ArrowPlace {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    // A reader whose boxes hug the ink: a mark that sits INSIDE a word's box is one of the word's own
    // letters (the l, the t, the f - tall and a little lopsided, which is what an arrow is), never an
    // arrow. Vision's boxes are loose, an arrow in a gap IS mostly inside one, so they do not get this.
    if (tight && line.words.some((word) => word.box !== null && mostlyInside(box, word.box))) return { kind: "read" }
    // The reader may have read this very arrow: putting a second one in
    // gave "Paris → → Lyon".
    if (line.words.some((word) => isArrowRead(normaliseArrows(word.text)) && word.box !== null
      && rectIntersects(word.box, box))) return { kind: "read" }
    const before = betweenWords(box, line.box, line.words.map((word) => word.box), among)
    if (before !== null) return { kind: "inline", line: index, before }
  }
  const overlapped = lines.some((line) => {
    const x0 = Math.max(line.box.x, box.x), x1 = Math.min(rectMaxX(line.box), rectMaxX(box))
    const y0 = Math.max(line.box.y, box.y), y1 = Math.min(line.box.y + line.box.height, box.y + box.height)
    if (x1 < x0 || y1 < y0) return false
    return y1 - y0 > box.height * 0.5 && x1 - x0 > box.width * 0.5
  })
  return overlapped ? { kind: "read" } : { kind: "ownLine" }
}

/**
 * The arrows the reader did not read, sorted onto the lines: the ones that
 * belong between two words of a line, and the ones that get a line of their
 * own at the height they sit at.
 */
export function arrowsOnPage(page: ReadingPage, lines: { box: Rect; words: MarkWord[] }[], tight = false):
{ inline: Map<number, Map<number, string>>; ownLine: { y: number; text: string; box: Rect }[] } {
  const inline = new Map<number, Map<number, string>>()
  const ownLine: { y: number; text: string; box: Rect }[] = []
  const boxes = page.marks.writing.map((index) => blobBox(page, index))
  for (const box of boxes) {
    const where = place(box, lines, boxes, tight)
    if (where.kind === "read") continue
    const glyph = arrow(box, page.ink, page.width, page.height)
    if (glyph === null) continue
    if (where.kind === "inline") {
      const row = inline.get(where.line) ?? new Map<number, string>()
      row.set(where.before, glyph)
      inline.set(where.line, row)
    } else {
      ownLine.push({ y: (box.y + box.height / 2) / page.height, text: glyph, box })
    }
  }
  return { inline, ownLine }
}

/** One line of the reading while it is being put together. */
export interface Piece { y: number; box: Rect; text: string }

/**
 * A reader may BREAK A LINE AT A DRAWN ARROW: "Paris → Lyon" comes back as
 * two readings, "Paris" and "→ Lyon", side by side on one band. Put them back
 * into one line. Deliberately narrow, because joining two readings that were
 * not one line would be worse than leaving them apart: the right-hand piece
 * must BEGIN with an arrow (or the left-hand one END with one), the two must
 * sit on the same band, the right one must start clear of the left one, and
 * the gap between them must be no more than three times the taller one's
 * height — an arrow's worth of gap, not a column of a table away. `pieces`
 * arrive in READING ORDER and only a piece and the one before it are joined.
 */
export function joinAcrossArrows(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  for (const piece of pieces) {
    const last = out[out.length - 1]
    if (last !== undefined
      && (startsWithArrow(piece.text) || endsWithArrow(last.text))
      && sameBand(last.box, piece.box)
      && piece.box.x >= rectMaxX(last.box)
      && piece.box.x - rectMaxX(last.box) <= 3 * Math.max(last.box.height, piece.box.height)) {
      out[out.length - 1] = { ...last, text: last.text + " " + piece.text, box: rectUnion(last.box, piece.box) }
      continue
    }
    out.push(piece)
  }
  return out
}

/**
 * An arrow drawn in the gap between two readings that sit on one band, which
 * the reader did not read and which is therefore on no line of its own: Vision
 * reads such an arrow and breaks the line there (`joinAcrossArrows` mends
 * that); Windows' engine splits a line at a wide gap and says nothing of what
 * was drawn in it. The arrow goes between the two, whatever the gap - the arrow
 * IS the evidence that they are one line. `pieces` are in reading order.
 * Returns the pieces, and the arrows that were nobody's to place.
 */
export function arrowsBetweenPieces(pieces: Piece[], arrows: { y: number; text: string; box: Rect }[]):
{ pieces: Piece[]; rest: { y: number; text: string; box: Rect }[] } {
  const out = pieces.map((piece) => ({ ...piece }))
  const rest: { y: number; text: string; box: Rect }[] = []
  for (const mark of [...arrows].sort((a, b) => a.box.x - b.box.x)) {
    const centre = mark.box.x + mark.box.width / 2
    const at = out.findIndex((left, i) => {
      const right = out[i + 1]
      if (!right || !sameBand(left.box, right.box)) return false
      const top = Math.min(left.box.y, right.box.y), bottom = Math.max(left.box.y + left.box.height, right.box.y + right.box.height)
      const middle = mark.box.y + mark.box.height / 2
      return rectMaxX(left.box) <= centre && centre <= right.box.x && middle >= top && middle <= bottom
    })
    if (at < 0) { rest.push(mark); continue }
    const left = out[at]!, right = out[at + 1]!
    out.splice(at, 2, {
      y: left.y, box: rectUnion(left.box, right.box),
      text: joinWords([left.text, mark.text, right.text]),
    })
  }
  return { pieces: out, rest }
}

/**
 * One line of writing, with what is drawn over it taken into account.
 * `ignoring` is a mark the line is not made of — the checkbox at its head —
 * so the single letter the reader read that mark as is dropped. `inserting`
 * puts a drawn mark — an arrow — in FRONT of the word at that index, so
 * "A → B" comes back as one line.
 */
export function markedLine(line: Reading1, page: ReadingPage, ringed: Rect[], ignoring: Rect | null,
  inserting: Map<number, string>, characters?: { character: string; box: Rect | null }[], tight = false): string {
  const fallback = normaliseArrows(line.text.trim())
  const pieces: string[] = []
  line.words.forEach((word, index) => {
    const arrowHere = inserting.get(index)
    if (arrowHere !== undefined) pieces.push(arrowHere)
    if (ignoring && isBoxRead(word.text) && word.box !== null && mostlyInside(word.box, ignoring)) return
    let piece = normaliseArrows(word.text)
    // An arrow is not a word with a line through it: its shaft IS a bar
    // across the middle of its own box ("Paris ~~→~~ Lyon").
    if (isArrowRead(piece)) { pieces.push(piece); return }
    // Nor is an operator: a word has to be more than the bar itself before
    // a bar through it means anything, and an = or a + IS the bar.
    // (A struck word is often read with the bar itself as a character - "mi+k" - so every mark counts.)
    const letters = Array.from(piece).filter((c) => !/\s/.test(c)).length
    if (!isOperatorRead(piece) && word.box !== null
      && struckThrough(word.box, page.ink, page.width, page.height, tight ? { tight, characters: letters } : {})) {
      piece = "~~" + piece + "~~"
    } else if (word.box !== null
      && ringed.some((ring) => (tight ? encirclesClearly(ring, word.box!) : encircles(ring, word.box!)))) {
      piece = "**" + piece + "**"
    }
    pieces.push(piece)
  })
  const marked = pieces.length === 0 ? fallback : joinWords(pieces)

  // Algebra is written as this app's maths, with the little raised digits
  // put back as powers (when the reader gave character boxes).
  if (looksLikeMaths(marked) && !marked.includes("~~") && !marked.includes("**")) {
    const raised = characters ? superscripted(characters) : ""
    const expression = wolfram(raised === "" ? marked : raised)
    if (expression !== "") return mathInline(expression)
  }
  return marked
}

/**
 * The reading as lines of markdown, top to bottom. With no ink mask there is
 * nothing drawn to read: the words, in order, and that is all. Empty when
 * nothing could be read.
 */
export function composeLines(raw: OcrReading, drawn: ReadingPage | null): string[] {
  // The ink in the frame the reader's boxes are in (a tilted picture is straightened by the engine).
  const page = drawn === null ? null : pageInReaderFrame(drawn, raw.angle)
  const tight = raw.engine === "windows"
  // A ring the reader took for a letter is not a letter: dropped BEFORE the
  // lines are tidied, or it would be put into the line it sits beside.
  const ringed = page === null ? [] : rings(page)
  /**
   * A line that is a ring drawn round something and read as an O. With boxes that hug the ink the
   * same blob is a typed capital O, D, Q or the digit 0 read as itself: only a ring that has another
   * word clearly inside it is a drawn one.
   */
  const isDrawnRing = (line: OcrLine, ring: Rect): boolean => {
    if (!encircles({ x: ring.x - 2, y: ring.y - 2, width: ring.width + 4, height: ring.height + 4 }, inMask(line, page!))) {
      return false
    }
    if (!tight) return true
    return raw.lines.some((other) => other !== line
      && (other.words ?? []).some((word) => encirclesClearly(ring, inMask(word, page!))))
  }
  const input: OcrReading = page === null ? raw : {
    ...raw,
    lines: raw.lines.filter((line) => !(isRingRead(line.text.trim()) && ringed.some((ring) => isDrawnRing(line, ring)))),
  }
  const reading = tidyReading(input)
  if (page === null) {
    return reading.lines
      .map((line) => ({ text: line.text.trim(), confidence: line.confidence }))
      .filter((line) => looksLikeText(line.text, line.confidence))
      .map((line) => normaliseArrows(line.text))
      .filter((text) => text !== "")
  }

  // Every word on the page, whether or not its reading was kept: what tells
  // a checkbox from a small flow-chart node is the word INSIDE the square,
  // and the reader reads that as a line of its own.
  const onThePage: MarkWord[] = []
  const read: Reading1[] = []
  for (const line of reading.lines) {
    const text = line.text.trim()
    const words: MarkWord[] = (line.words ?? []).map((word) => ({ text: word.text, box: inMask(word, page) }))
    onThePage.push(...words)
    if (!looksLikeText(text, line.confidence)) continue
    const box = inMask(line, page)
    read.push({ text, box, words, y: line.y + line.height / 2 })
  }

  // The arrows nobody read: some belong between two words of a line, the
  // rest on a line of their own.
  const placed = arrowsOnPage(page, read.map((line) => ({ box: line.box, words: line.words })), tight)
  const pieces: Piece[] = []
  read.forEach((line, index) => {
    // A box drawn at the head of the line makes the line a task. The box goes
    // to `marked` too, so the letter the reader read it as does not stay in
    // the words.
    const tick = checkboxStartingLine(line.box, onThePage, page)
    let text = markedLine(line, page, ringed, tick?.box ?? null, placed.inline.get(index) ?? new Map(), undefined, tight)
    if (tick) text = taskItem(text, tick.ticked)
    pieces.push({ y: line.y, box: line.box, text })
  })

  // A table ruled on the page used to come in as a markdown table. Tables
  // went out of the app whole on 2026-09-20, so the rules are ink and the
  // words in them are prose like any other.
  // The pieces are already in reading order (the Mac re-sorts them by height,
  // which loses "left to right on one band"); an arrow with a line of its own
  // goes in before the first piece that sits lower than it does.
  const between = arrowsBetweenPieces(joinAcrossArrows(pieces), placed.ownLine)
  const lines = between.pieces.map((piece) => ({ y: piece.y, text: piece.text }))
  for (const own of [...between.rest].sort((a, b) => a.y - b.y)) {
    const at = lines.findIndex((line) => line.y > own.y)
    lines.splice(at < 0 ? lines.length : at, 0, own)
  }
  return lines.map((line) => line.text).filter((text) => text !== "")
}

// MARK: - The flow chart's words

/**
 * The words of a reading as the flow-chart reader takes them: each word's
 * box in the PIXELS of the picture it was read from (`size`), so a node can
 * be labelled with the words inside it. Every word counts, whatever its
 * confidence — a node's label is often one short word.
 */
export function flowWordsFrom(input: OcrReading, size: { width: number; height: number }): FlowWord[] {
  const out: FlowWord[] = []
  // A tilted picture was straightened by the reader: its boxes are turned back onto the picture's own pixels.
  const angle = usableAngle(input.angle)
  for (const line of tidyReading(input).lines) {
    for (const word of line.words ?? []) {
      const text = word.text.trim()
      if (text === "" || !(word.width > 0 && word.height > 0)) continue
      // A rule of the chart read as "|" or "_" is not a label.
      if (!/[\p{L}\p{N}]/u.test(text)) continue
      out.push({
        text,
        box: boxToPicture(
          { x: word.x * size.width, y: word.y * size.height, width: word.width * size.width, height: word.height * size.height },
          size.width, size.height, angle),
      })
    }
  }
  return out
}

