/**
 * Searching the notes (docs/PLAN-bars-2026-10.md, P3: the sidebar's search field). New in the port: the Swift app has
 * no note search, so there is no XCTest this file was transcribed from, and the tests beside it
 * (`test/noteSearch.test.ts`) are its own.
 *
 * WHAT A MATCH IS. The words typed (spaces between them folded to one) as a run inside a note's title, its file name
 * or one of its lines — never across two lines. Case does not matter and neither do accents: "cafe" finds "Café",
 * "ÉCOLE" finds "école", "strasse" does not find "Straße" (a letter is not an accent). It is NOT a search for
 * several words anywhere: "heat flow" is that phrase, which is how the Find bar reads it too, so the note a hit opens
 * on has the words the person typed lit.
 *
 * WHAT IS SEARCHED is what the note SHOWS, not its markup: a line has its `#`, `**`, backticks, list marks, link
 * addresses, anchors and escapes taken off (the same plain words the sidebar's snippet is made of), and the lines that
 * are not words — a picture, an ink cell, a rule, a fence's own line, the marker above a markdown cell — are not there.
 * (Code and maths source ARE words: they are searched.)
 *
 * FOLDING is per code point, once, so that a position found in the folded text can be carried back to the original
 * (`Folded.from` / `to`): the snippet is cut from the note's own line, with the match marked where it really is.
 * Only the Latin combining marks (U+0300 – U+036F) are dropped as accents: a kana's dakuten (が) and a Hangul syllable
 * are letters of their own and stay what they are.
 *
 * No platform in here: strings in, strings out. The main process reads the notes (through the note store) and caches
 * `noteText` per file; the page only draws what comes back.
 */

import { isMarkdownMarker, unescapeLine } from "../markdown/plainText"
import { pictureLine } from "../markdown/images"
import { isRule } from "../markdown/parser"
import { stripInlineMarkup } from "./note"

// MARK: - Folding

/** Latin combining marks: what makes "e" into "é" once a letter is taken apart (NFKD). */
const ACCENTS = /[̀-ͯ]/g

/** One code point as it is searched: taken apart, its accents off, lower case. ASCII is its own lower case. */
function foldPoint(unit: string): string {
  if (unit.charCodeAt(0) < 128) return unit.toLowerCase()
  return unit.normalize("NFKD").replace(ACCENTS, "").toLowerCase()
}

const isSpace = (character: string): boolean => character !== "\n" && /\s/u.test(character)

/** A string folded, and where each character of the result came from. */
export interface Folded {
  text: string
  /** For each UTF-16 unit of `text`: where the character it came from starts in the source… */
  from: number[]
  /** …and where it ends (one past). A run of spaces is one space that spans the run. */
  to: number[]
}

function fold(source: string, mapped: boolean): Folded {
  let text = ""
  const from: number[] = []
  const to: number[] = []
  let space = false
  for (let at = 0; at < source.length;) {
    const point = source.codePointAt(at)!
    const unit = String.fromCodePoint(point)
    const next = at + unit.length
    for (const character of foldPoint(unit)) {
      if (isSpace(character)) {
        // A run of white space is one space (the words typed are matched across a tab, a double space, a line's indent).
        if (space) { if (mapped) to[to.length - 1] = next } else {
          text += " "
          if (mapped) { from.push(at); to.push(next) }
          space = true
        }
        continue
      }
      space = false
      text += character
      if (mapped) for (let unitAt = 0; unitAt < character.length; unitAt++) { from.push(at); to.push(next) }
    }
    at = next
  }
  return { text, from, to }
}

/** The text as it is searched: lower case, no accents, white space runs one space, line breaks kept. */
export function foldSearch(source: string): string {
  // (The common case, a note in plain ASCII, is two native passes and no loop.)
  // eslint-disable-next-line no-control-regex
  if (/^[\u0000-\u007f]*$/.test(source)) return source.toLowerCase().replace(/[^\S\n]+/g, " ")
  return fold(source, false).text
}

/** The same, with the way back to the source's own positions. */
export const foldMapped = (source: string): Folded => fold(source, true)

// MARK: - The query

/** What was typed, ready to look for: folded, trimmed, one space between words. */
export interface SearchQuery {
  /** As typed (trimmed): what the Find bar is given when no better words are known. */
  words: string
  needle: string
}

/** The query for what was typed, or null when it is nothing to look for (blank). */
export function prepareQuery(typed: string): SearchQuery | null {
  const words = typed.replace(/[\r\n]+/g, " ").trim()
  if (words.length === 0) return null
  const needle = foldSearch(words)
  return needle.length === 0 ? null : { words, needle }
}

// MARK: - What a note is searched as

/** A note's words, ready to be looked in: the plain lines (for the snippet) and the same, folded (for the search). */
export interface NoteText {
  /** The note's plain lines, one per line, none empty. */
  plain: string
  /** `plain` folded: the same number of lines, in the same order. */
  folded: string
}

/** A line as the note shows it, or null when it is not words (see the top of the file). */
export function plainSearchLine(raw: string): string | null {
  const line = raw.trim()
  if (line.length === 0 || isMarkdownMarker(line)) return null
  // A fence's own line (```wl, ~~~), a rule, a picture or an ink cell.
  if (/^(```|~~~)[\w+#.\-]*$/.test(line) || isRule(line) || pictureLine(line) !== null) return null
  // A table's delimiter row (| --- | :---: |).
  if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes("-") && line.includes("|")) return null
  let out = stripInlineMarkup(unescapeLine(line))
  // A picture inside words keeps its description; a link keeps what is on show, never where it goes.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  // A to-do's box, a numbered list's number are marks and not words; a table's pipes are columns.
  out = out.replace(/^\[[ xX]\]\s+/, "").replace(/^\d{1,3}[.)]\s+/, "").replace(/\s*\|\s*/g, " ").trim()
  return out.length > 0 ? out : null
}

/** The searchable form of a note's text. */
export function noteText(text: string): NoteText {
  const lines: string[] = []
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split("\n")) {
    const line = plainSearchLine(raw)
    if (line !== null) lines.push(line)
  }
  const plain = lines.join("\n")
  return { plain, folded: foldSearch(plain) }
}

// MARK: - Matching

/** Where a match is in a string: `from` up to (not including) `to`. */
export interface Mark { from: number; to: number }

/** The line cut for the row: the words around the match, with the match's place in the cut. */
export interface Snippet { text: string; mark: Mark | null }

/** Characters of a line the row shows (the row clamps to one line anyway; this keeps the message small). */
const WIDTH = 100
/** How much of the line before the match stays on screen, when the line is cut. */
const LEAD = 32

/** `line` cut to about `WIDTH` characters round the match (an ellipsis where it was cut), the match marked in the cut. */
export function snippetOf(line: string, match: Mark | null): Snippet {
  if (line.length <= WIDTH) return { text: line, mark: match }
  if (!match) return { text: line.slice(0, WIDTH).trimEnd() + "…", mark: null }
  let start = Math.max(0, Math.min(match.from - LEAD, line.length - WIDTH))
  // (never start in the middle of a word when a word boundary is close by)
  if (start > 0) {
    const space = line.indexOf(" ", start)
    if (space >= 0 && space < match.from && space - start < 12) start = space + 1
  }
  const stop = Math.min(line.length, start + WIDTH)
  const head = start > 0 ? "…" : ""
  const text = head + line.slice(start, stop).trimEnd() + (stop < line.length ? "…" : "")
  const offset = head.length - start
  return { text, mark: { from: Math.max(head.length, match.from + offset), to: Math.min(text.length, match.to + offset) } }
}

/** How a note matched: the lower the tier the better it ranks. */
export type HitTier = 0 | 1 | 2 | 3
export const HIT_TIER = { titleStart: 0, title: 1, fileName: 2, body: 3 } as const

export interface NoteHit {
  tier: HitTier
  /** Where the title matched (marked in the row), or null (the file name or the words matched). */
  titleMark: Mark | null
  /** The line shown under the title: the first body line with the match, else the note's own first words. */
  snippet: Snippet
  /** The words as the note has them where it matched (with their accents and case); "" when only the title or file name did. */
  matched: string
  /** The 0-based line of `plain` the body matched in, or null. */
  line: number | null
}

/** What a hit needs to know of the note. */
export interface NoteFacts { title: string; stem: string; snippet: string }

/** The first match of the query in the note's words, as a line of the plain text and a place in it; null when there is none. */
function bodyMatch(query: SearchQuery, body: NoteText): { line: number; text: string; mark: Mark } | null {
  const at = body.folded.indexOf(query.needle)
  if (at < 0) return null
  let line = 0
  for (let i = body.folded.indexOf("\n"); i >= 0 && i < at; i = body.folded.indexOf("\n", i + 1)) line++
  // The same line in the plain text (folding never adds or takes away a line break).
  let start = 0
  for (let k = 0; k < line; k++) start = body.plain.indexOf("\n", start) + 1
  const stop = body.plain.indexOf("\n", start)
  const text = body.plain.slice(start, stop < 0 ? body.plain.length : stop)
  const mapped = foldMapped(text)
  const inLine = mapped.text.indexOf(query.needle)
  if (inLine < 0) return null
  return { line, text, mark: { from: mapped.from[inLine]!, to: mapped.to[inLine + query.needle.length - 1]! } }
}

/** Where the query is in a short string (a title), as that string's own marks; null when it is not. */
export function markIn(query: SearchQuery, source: string): Mark | null {
  const mapped = foldMapped(source)
  const at = mapped.text.indexOf(query.needle)
  if (at < 0) return null
  return { from: mapped.from[at]!, to: mapped.to[at + query.needle.length - 1]! }
}

/**
 * Whether the note matches, and how. The title is looked in first, then the file name, then the words; `body` null (a
 * note that could not be read) still matches by its title and file name. A note with the query in both its title and its
 * words ranks as a title match and shows the line of its words as the snippet.
 */
export function matchNote(query: SearchQuery, note: NoteFacts, body: NoteText | null): NoteHit | null {
  const title = markIn(query, note.title)
  const inBody = body ? bodyMatch(query, body) : null
  const named = title === null ? markIn(query, note.stem) : null
  if (title === null && named === null && inBody === null) return null
  const tier: HitTier = title ? (title.from === 0 ? 0 : 1) : named ? 2 : 3
  const shown = inBody ? snippetOf(inBody.text, inBody.mark) : snippetOf(note.snippet, null)
  return {
    tier,
    titleMark: title,
    snippet: shown,
    matched: inBody ? inBody.text.slice(inBody.mark.from, inBody.mark.to) : "",
    line: inBody ? inBody.line : null,
  }
}

/** The words the Find bar is given when a result is opened: the match as the note has it if the note's raw text has it, else what was typed. */
export function findSeed(noteText: string, hit: { matched: string }, typed: string): string {
  const has = (words: string): boolean => words.length > 0 && noteText.toLowerCase().includes(words.toLowerCase())
  if (has(hit.matched)) return hit.matched
  const words = typed.trim()
  if (has(words)) return words
  // (the words typed were matched across a markup mark: the longest of them that is in the note as written)
  const parts = words.split(/\s+/).filter(has).sort((a, b) => b.length - a.length)
  return parts[0] ?? words
}
