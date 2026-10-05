/**
 * The marks a page of handwriting carries that are not letters: a line
 * through a word, an arrow between two of them, a ring round one, a box at
 * the head of a line, and the little raised digits that make a power.
 * Ported from `WriteMind/Camera/HandwritingMarks.swift`; its tests are
 * `packages/core/test/handwritingMarks.test.ts`
 * (`WriteMindTests/HandwritingMarksTests.swift`).
 *
 * Pure geometry over the ink mask and the boxes a text reader gives back, so
 * every rule can be tested without a camera. Boxes are `Rect`s in MASK
 * pixels, y DOWN (the same way round as the mask), the ink a 0/1 buffer.
 */

import type { Rect } from "../drawing/shapes"
import { localMeanRadius } from "./ink"
import { rectIntersection, rectMaxX, rectMaxY, rectMidX } from "./rects"

/** A word the reader read, with its box in mask pixels. */
export interface MarkWord { text: string; box: Rect | null }

const isNull = (box: Rect | null): box is null => box === null

// MARK: - A line through a word

/**
 * What `struckThrough` is told about the reader whose box it was given.
 *
 * VISION'S WORD BOXES ARE LINE-HIGH, Windows' hug the glyphs. The bar rule was
 * made for the first: in a line-high box a single row 80% inked in the middle
 * half is a pen line, because no letter fills a row. In a box that hugs the ink
 * the same row is a letter's own crossbar (the t and the o of "to", the top of
 * an a, the line along the tops of the lower-case letters): on plain typed prose
 * it struck a word in 13 of 48 lines. So when the box hugs the ink a word has to
 * be more than its crossbar:
 *   - it is not a SHORT word (1 to 3 letters are mostly crossbar; a pen line
 *     through "to" cannot be told from the word), and
 *   - the bar is a PEN LINE: it runs the whole width of the box. The box of a
 *     struck word includes the bar, so a pen line leaves no gap in its row
 *     (97% of the columns inked within a row either side, 90% in the row itself);
 *     the busiest row of plain letters measured 92% (2,500 typed words, 26 faces).
 */
export interface StrikeReader {
  /** The reader's word boxes hug the ink. */
  tight?: boolean
  /** Characters in the word (marks included) - what "a short word" is measured in. */
  characters?: number
}

/** The shortest word a bar through it can be told from its own crossbars (tight boxes only). */
export const MIN_STRUCK_CHARACTERS = 4
/** How much of a tight word's width a pen line fills in its own row, and with the rows beside it. */
export const PEN_LINE_ROW = 0.9
export const PEN_LINE_BAND = 0.97

/**
 * A bar across the middle of the word, thin, and reaching most of the way
 * over: that is a word struck out, not a letter.
 */
export function struckThrough(word: Rect, ink: Uint8Array, width: number, height: number,
  reader: StrikeReader = {}): boolean {
  const x0 = Math.max(0, Math.trunc(word.x)), x1 = Math.min(width, Math.ceil(word.x + word.width))
  const y0 = Math.max(0, Math.trunc(word.y)), y1 = Math.min(height, Math.ceil(word.y + word.height))
  if (!(x1 - x0 >= 8 && y1 - y0 >= 5 && ink.length === width * height)) return false
  if (reader.tight && (reader.characters ?? 0) < MIN_STRUCK_CHARACTERS) return false
  const span = x1 - x0
  const box = y1 - y0

  const coverage = (y: number): number => {
    if (y < 0 || y >= height) return 0
    let count = 0
    for (let x = x0; x < x1; x++) if (ink[y * width + x]) count++
    return count / span
  }
  /** The columns with ink in this row or the one above or below it (a pen line wobbles by a pixel or two). */
  const band = (y: number): number => {
    let count = 0
    for (let x = x0; x < x1; x++) {
      for (let dy = -1; dy <= 1; dy++) {
        const row = y + dy
        if (row >= 0 && row < height && ink[row * width + x]) { count++; break }
      }
    }
    return count / span
  }

  // Only the middle half of the word: a line under it is an underline, and
  // the tops of the letters are not a bar.
  const from = y0 + Math.trunc(box / 4), to = y0 + Math.trunc((box * 3) / 4)
  for (let y = from; y <= Math.max(from, to); y++) {
    const row = coverage(y)
    if (row < 0.8) continue
    // Thin: the ink a few rows away has to be much sparser, or this is a
    // solid block rather than a stroke through the word.
    const away = Math.max(2, Math.trunc(box / 6))
    if (!(coverage(y - away) < 0.5 && coverage(y + away) < 0.5)) continue
    if (reader.tight && !(row >= PEN_LINE_ROW && band(y) >= PEN_LINE_BAND)) continue
    return true
  }
  return false
}

// MARK: - Arrows

/**
 * A long thin mark with one end heavier than the other is an arrow, and the
 * heavy end is the head. Null for anything else — a plain line is a line.
 */
export function arrow(box: Rect, ink: Uint8Array, width: number, height: number): string | null {
  const x0 = Math.max(0, Math.trunc(box.x)), x1 = Math.min(width, Math.ceil(box.x + box.width))
  const y0 = Math.max(0, Math.trunc(box.y)), y1 = Math.min(height, Math.ceil(box.y + box.height))
  const w = x1 - x0, h = y1 - y0
  if (!(w > 0 && h > 0 && ink.length === width * height)) return null
  const long = Math.max(w, h), short = Math.min(w, h)
  if (!(long >= 14 && long / Math.max(1, short) >= 3)) return null

  const horizontal = w >= h
  const quarter = Math.max(1, Math.trunc(long / 4))
  let head = 0, tail = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!ink[y * width + x]) continue
      const along = horizontal ? x - x0 : y - y0
      if (along < quarter) tail++
      if (along >= long - quarter) head++
    }
  }
  if (!(head > 0 || tail > 0)) return null
  const ratio = Math.max(head, tail) / Math.max(1, Math.min(head, tail))
  if (ratio < 1.4) return null
  const pointsForward = head > tail
  if (horizontal) return pointsForward ? "→" : "←"
  return pointsForward ? "↓" : "↑"
}

/** Whether two readings sit on the same line of writing. */
export function sameBand(one: Rect, other: Rect): boolean {
  if (!(one.height > 0 && other.height > 0)) return false
  const top = Math.max(one.y, other.y), bottom = Math.min(rectMaxY(one), rectMaxY(other))
  return bottom - top >= 0.6 * Math.min(one.height, other.height)
}

/**
 * Where an arrow drawn in the gap between two words belongs: the index of
 * the word it goes in FRONT of, so the line reads "A → B" rather than
 * carrying the arrow away onto a line of its own.
 *
 * TWO DIFFERENT THINGS ANSWER THE TWO QUESTIONS: the INK answers "is it in
 * a gap?" (nothing else on this line's band may share the arrow's columns,
 * and there must be ink both sides of it), the reader answers "which word
 * does it go in front of?" (its word boxes are loose but in ORDER). `words`
 * are in reading order and the index that comes back indexes that array.
 */
export function betweenWords(box: Rect, line: Rect, words: (Rect | null)[], marks: Rect[]): number | null {
  if (!(box.width > 0 && box.height > 0 && words.length >= 2)) return null
  // On the line's own band, not a line above or below it.
  const top = Math.max(box.y, line.y), bottom = Math.min(rectMaxY(box), rectMaxY(line))
  if (bottom - top < 0.5 * box.height) return null

  let inkLeft = false, inkRight = false
  for (const mark of marks) {
    if (mark === box || (mark.x === box.x && mark.y === box.y && mark.width === box.width && mark.height === box.height)) continue
    if (!(mark.width > 1) || !sameBand(mark, line)) continue
    if (rectMaxX(mark) <= box.x) { inkLeft = true; continue }
    if (mark.x >= rectMaxX(box)) { inkRight = true; continue }
    return null // something is drawn where the arrow is: not a gap
  }
  if (!(inkLeft && inkRight)) return null

  const midX = rectMidX(box)
  const after = words.findIndex((word) => !isNull(word) && rectMidX(word) > midX)
  if (after <= 0) return null
  if (!words.slice(0, after).some((word) => !isNull(word) && rectMidX(word) < midX)) return null
  return after
}

/** The arrows themselves, as characters. */
export const ARROW_GLYPHS = new Set(["→", "←", "↔", "↑", "↓"])

const trimSpaces = (text: string): string => text.replace(/^[ \t]+|[ \t]+$/g, "")

/** A reading that is nothing but an arrow: neither struck out nor a word. */
export function isArrowRead(text: string): boolean {
  const bare = trimSpaces(text)
  return bare.length > 0 && Array.from(bare).every((c) => ARROW_GLYPHS.has(c))
}

export function startsWithArrow(text: string): boolean {
  const first = Array.from(trimSpaces(text))[0]
  return first !== undefined && ARROW_GLYPHS.has(first)
}

export function endsWithArrow(text: string): boolean {
  const all = Array.from(trimSpaces(text))
  const last = all[all.length - 1]
  return last !== undefined && ARROW_GLYPHS.has(last)
}

/** What a reader itself reads an arrow as, when it reads one at all. */
export function normaliseArrows(text: string): string {
  let out = text
  for (const [drawn, glyph] of [["<->", "↔"], ["<-->", "↔"], ["-->", "→"], ["->", "→"], ["=>", "→"],
    ["<--", "←"], ["<-", "←"], ["<=", "←"]] as const) {
    out = out.split(drawn).join(glyph)
  }
  return out
}

// MARK: - A ring round a word

/** A big round outline with nothing much inside it. */
export function isRing(box: Rect, fill: number, shortSide: number): boolean {
  const aspect = box.height / Math.max(1, box.width)
  return box.width >= shortSide / 40 && aspect >= 0.5 && aspect <= 2 && fill <= 0.35
}

/** Whether a ring holds a word — most of the word, not a corner of it. */
export function encircles(ring: Rect, word: Rect): boolean {
  const overlap = rectIntersection(ring, word)
  if (overlap === null || !(word.width > 0 && word.height > 0)) return false
  return (overlap.width * overlap.height) / (word.width * word.height) >= 0.8
}

/**
 * `encircles` for a reader whose word boxes hug the ink (Windows). There the
 * box of a CAPITAL, a short word in capitals ("TV"), a letter with a loop, is the
 * very blob `isRing` takes for a ring - hollow, squarish, as big as the word - and
 * "a ring that covers 80% of the word" is the word itself: plain typed "Call Bob
 * about the new TV set" came back with **TV** bold. A ring that was DRAWN round a
 * word is bigger than the word's ink on EVERY side, by more than a pixel's blur.
 */
export function encirclesClearly(ring: Rect, word: Rect): boolean {
  if (!(word.width > 0 && word.height > 0)) return false
  const margin = Math.max(2, 0.06 * word.height)
  return ring.x <= word.x - margin && ring.y <= word.y - margin
    && rectMaxX(ring) >= rectMaxX(word) + margin && rectMaxY(ring) >= rectMaxY(word) + margin
}

/** The letter a ring is read as by mistake. Dropped when a ring is already there. */
export function isRingRead(text: string): boolean {
  return ["O", "o", "0", "()", "( )", "◦", "○", "Q", "D"].includes(trimSpaces(text))
}

// MARK: - Checkboxes

/**
 * A hand-drawn box at the start of a line is a task. Null for anything that
 * is not one; true when there is ink inside it. The rules, cheapest to fail
 * first: roughly square; about the height of the writing; all four edges of
 * its own bounding box inked (a closed box has them, a letter has not); walls
 * only a pen's width thick (a hollowed-out bullet is not a box); not a blot.
 * A box that is not clearly a box leaves its line alone.
 */
export function checkbox(box: Rect, line: Rect, ink: Uint8Array, width: number, height: number): boolean | null {
  const shortSide = Math.min(box.width, box.height)
  if (shortSide < 8) return null
  const aspect = box.width / Math.max(1, box.height)
  if (aspect < 0.6 || aspect > 1.7) return null
  if (!(line.height > 0 && box.height >= line.height * 0.5 && box.height <= line.height * 1.8)) return null
  if (edgesInked(box, ink, width, height) < 0.8) return null
  const radius = localMeanRadius(width, height)
  const walls = wallThickness(box, ink, width, height)
  if (walls >= radius * 0.5 && walls >= shortSide * 0.25) return null
  const inside = insideInk(box, ink, width, height)
  // A tick fills about a third of the inside and a cross about three
  // fifths; a filled square small enough to stay solid fills all of it.
  if (inside >= 0.7) return null
  return inside >= 0.08
}

/** The short side of a box — what the wall rule measures against. */
export const inkBoxSide = (box: Rect): number => Math.min(box.width, box.height)

/**
 * How deep the ink is at the four walls of a box: from the middle of each
 * edge, inwards, the run of ink before the first gap. The THINNEST of the
 * four, because one heavy side is a pen pressed harder and a blob is thick
 * on every side.
 */
export function wallThickness(box: Rect, ink: Uint8Array, width: number, height: number): number {
  const x0 = Math.max(0, Math.trunc(box.x)), x1 = Math.min(width, Math.ceil(box.x + box.width))
  const y0 = Math.max(0, Math.trunc(box.y)), y1 = Math.min(height, Math.ceil(box.y + box.height))
  if (!(x1 > x0 && y1 > y0 && ink.length === width * height)) return 0
  const midX = Math.trunc((x0 + x1) / 2), midY = Math.trunc((y0 + y1) / 2)

  const run = (steps: number[], at: (step: number) => boolean): number => {
    let depth = 0
    for (const step of steps) {
      if (!at(step)) break
      depth++
    }
    return depth
  }
  const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)

  const top = run(range(y0, y1), (y) => ink[y * width + midX] === 1)
  const bottom = run(range(y0, y1).reverse(), (y) => ink[y * width + midX] === 1)
  const left = run(range(x0, x1), (x) => ink[midY * width + x] === 1)
  const right = run(range(x0, x1).reverse(), (x) => ink[midY * width + x] === 1)
  return Math.min(top, bottom, left, right)
}

/**
 * How much of the WORST of the four edges of a box is inked: for each edge,
 * the fraction of the positions along it that have ink within a band a fifth
 * of the box's short side deep.
 */
export function edgesInked(box: Rect, ink: Uint8Array, width: number, height: number): number {
  const x0 = Math.max(0, Math.trunc(box.x)), x1 = Math.min(width, Math.ceil(box.x + box.width))
  const y0 = Math.max(0, Math.trunc(box.y)), y1 = Math.min(height, Math.ceil(box.y + box.height))
  if (!(x1 > x0 && y1 > y0 && ink.length === width * height)) return 0
  const band = Math.max(2, Math.trunc(Math.min(x1 - x0, y1 - y0) / 5))

  const down = (x: number, from: number, to: number): boolean => {
    for (let y = from; y < to; y++) if (ink[y * width + x]) return true
    return false
  }
  const across = (y: number, from: number, to: number): boolean => {
    for (let x = from; x < to; x++) if (ink[y * width + x]) return true
    return false
  }
  const columns = x1 - x0, rows = y1 - y0
  let top = 0, bottom = 0, left = 0, right = 0
  for (let x = x0; x < x1; x++) {
    if (down(x, y0, Math.min(y1, y0 + band))) top++
    if (down(x, Math.max(y0, y1 - band), y1)) bottom++
  }
  for (let y = y0; y < y1; y++) {
    if (across(y, x0, Math.min(x1, x0 + band))) left++
    if (across(y, Math.max(x0, x1 - band), x1)) right++
  }
  return Math.min(top / columns, bottom / columns, left / rows, right / rows)
}

/**
 * How much of the INSIDE of a box is ink — the box less a quarter of its
 * short side all round, so the outline itself is not counted. The whole mask
 * is read, not one blob: a tick that never touched the box is a component of
 * its own.
 */
export function insideInk(box: Rect, ink: Uint8Array, width: number, height: number): number {
  const x0 = Math.max(0, Math.trunc(box.x)), x1 = Math.min(width, Math.ceil(box.x + box.width))
  const y0 = Math.max(0, Math.trunc(box.y)), y1 = Math.min(height, Math.ceil(box.y + box.height))
  if (!(x1 > x0 && y1 > y0 && ink.length === width * height)) return 0
  const inset = Math.max(2, Math.trunc(Math.min(x1 - x0, y1 - y0) / 4))
  const ix0 = x0 + inset, ix1 = x1 - inset, iy0 = y0 + inset, iy1 = y1 - inset
  if (!(ix1 > ix0 && iy1 > iy0)) return 0
  let inked = 0
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) if (ink[y * width + x]) inked++
  return inked / ((ix1 - ix0) * (iy1 - iy0))
}

/**
 * Whether a mark sits at the START of a line: on the line's band, and no
 * further right than its own width past where the line begins. A box the
 * reader did not read sits in the margin to the LEFT of the line's own box;
 * one it read as a letter is the line's first character, so both ends of
 * that slack are needed.
 */
export function startsLine(box: Rect, line: Rect): boolean {
  if (!(box.width > 0 && box.height > 0 && line.height > 0)) return false
  // A box does not start a line that is INSIDE it: that is a tick read as a
  // character, or the label of a small flow-chart node.
  if (mostlyInside(line, box)) return false
  const top = Math.max(box.y, line.y), bottom = Math.min(rectMaxY(box), rectMaxY(line))
  if (bottom - top < 0.5 * Math.min(box.height, line.height)) return false
  if (box.x < line.x - 4 * box.width) return false
  return rectMaxX(box) <= line.x + 1.5 * box.width
}

/** Whether most of `inner` is inside `outer`. */
export function mostlyInside(inner: Rect, outer: Rect): boolean {
  const overlap = rectIntersection(inner, outer)
  if (overlap === null || !(inner.width > 0 && inner.height > 0)) return false
  return (overlap.width * overlap.height) / (inner.width * inner.height) >= 0.6
}

/**
 * What a reader reads a drawn checkbox as, when it reads one at all: an empty
 * box comes back as D, O, 0 or a pair of brackets, a ticked one as X or V.
 * Only ever asked of a reading that sits inside the box's own outline —
 * where a single character IS the box, not a word of the note.
 */
export function isBoxRead(text: string): boolean {
  const bare = text.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
  if (bare === "") return true
  if (["□", "☐", "☑", "☒", "▢", "■", "▪︎", "口", "回", "目"].includes(bare)) return true
  const chars = Array.from(bare)
  return chars.length === 1 && /[\p{L}\p{N}]/u.test(chars[0]!)
}

/**
 * The line as a markdown task item. Empty when the box was all there was — a
 * checkbox with nothing beside it is not a task.
 */
export function taskItem(text: string, ticked: boolean): string {
  let bare = trimSpaces(text)
  // One list marker is enough: the box's own left edge, or a dash drawn
  // beside it, reads as a bullet often enough to matter.
  for (const marker of ["- [x] ", "- [ ] ", "- ", "* ", "• ", "·"]) {
    if (bare.startsWith(marker)) {
      bare = trimSpaces(bare.slice(marker.length))
      break
    }
  }
  if (bare === "") return ""
  return (ticked ? "- [x] " : "- [ ] ") + bare
}

// MARK: - Maths

/** The signs a sum is made of. */
export const OPERATOR_GLYPHS = new Set(Array.from("=+−-×÷/^√∑∫<>≤≥≠·"))

/**
 * A reading that is nothing but an operator. Like an arrow, IT IS NEVER A
 * WORD WITH A LINE THROUGH IT: an = is two bars across the middle of its own
 * box and a + is one, which is precisely the shape `struckThrough` hunts for.
 */
export function isOperatorRead(text: string): boolean {
  const bare = trimSpaces(text)
  return bare.length > 0 && Array.from(bare).every((c) => OPERATOR_GLYPHS.has(c))
}

const isLetter = (c: string): boolean => /\p{L}/u.test(c)
const isNumber = (c: string): boolean => /\p{N}/u.test(c)

/**
 * A line that is a sum rather than a sentence: it carries an operator, and
 * what letters it has are the short names of variables.
 */
export function looksLikeMaths(text: string): boolean {
  const bare = trimSpaces(text)
  if (bare === "") return false
  const chars = Array.from(bare)
  if (!chars.some((c) => OPERATOR_GLYPHS.has(c))) return false
  if (!chars.some((c) => isNumber(c) || isLetter(c))) return false
  const words = bare.split(/[^\p{L}]+/u).filter((w) => w.length > 0)
  // One or two short names is algebra; "the sum of x" is a sentence.
  if (words.length > 3 || !words.every((w) => Array.from(w).length <= 3)) return false
  return true
}

/**
 * A × THAT CANNOT BE A TIMES SIGN IS THE LETTER x. Multiplication is infix:
 * it needs a number or a name on BOTH sides of it. A × with an operator, or
 * nothing at all, to one side is a reader taking a handwritten variable for
 * the sign it is drawn like.
 */
export function strayTimesAsX(text: string): string {
  const chars = Array.from(text)
  const ends = (at: number, opening: boolean): boolean => {
    if (at < 0 || at >= chars.length) return false
    const c = chars[at]!
    return isNumber(c) || isLetter(c) || c === (opening ? "(" : ")")
  }
  const past = (from: number, step: number): number => {
    let at = from + step
    while (at >= 0 && at < chars.length && /\s/.test(chars[at]!)) at += step
    return at
  }
  let out = ""
  chars.forEach((c, index) => {
    if (c !== "×") { out += c; return }
    const left = ends(past(index, -1), false)
    const right = ends(past(index, 1), true)
    out += left && right ? c : "x"
  })
  return out
}

/** The same line as Wolfram Language: the signs a hand writes turned into the ones a parser reads. */
export function wolfram(text: string): string {
  let out = trimSpaces(strayTimesAsX(text))
  for (const [written, wl] of [["×", "*"], ["·", "*"], ["÷", "/"], ["−", "-"], ["≤", "<="], ["≥", ">="],
    ["≠", "!="], ["√", "Sqrt"], ["∑", "Sum"], ["∫", "Integrate"], ["π", "Pi"], ["∞", "Infinity"]] as const) {
    out = out.split(written).join(wl)
  }
  return trimSpaces(out)
}

/**
 * `x²` written by hand comes back as "x2" with the 2 sitting high and small;
 * put the caret back in. `characters` are in reading order with their boxes
 * in mask pixels. (Windows' reader gives word boxes only, so there nothing
 * is raised; a reader that gives character boxes gets its powers back.)
 */
export function superscripted(characters: { character: string; box: Rect | null }[]): string {
  const plain = characters.map((c) => c.character).join("")
  const bodies = characters.filter((c) => !/\s/.test(c.character) && c.box !== null)
  if (bodies.length < 2) return plain
  const heights = bodies.map((c) => c.box!.height).sort((a, b) => a - b)
  const median = heights[Math.trunc(heights.length / 2)]!
  if (!(median > 0)) return plain
  const baseline = bodies.map((c) => rectMaxY(c.box!)).sort((a, b) => a - b)[Math.trunc(bodies.length / 2)]!

  let out = ""
  for (const { character, box } of characters) {
    const raised = box !== null && rectMaxY(box) <= baseline - median * 0.25
    const small = box !== null && box.height <= median * 0.75
    if (raised && small && (isNumber(character) || isLetter(character))) {
      if (!out.endsWith("^")) out += "^"
      out += character
    } else {
      out += character
    }
  }
  return out
}

