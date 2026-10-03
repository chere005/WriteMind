/**
 * Font, size and colour on a run of text, and Sublime's ⌘D. Ported from
 * `WriteMind/Editor/MarkdownSpans.swift`.
 *
 * Markdown carries none of font, size or colour, so they are written as
 * `<span style="…">…</span>` — the same trade already made for `<u>`:
 * portable HTML that other markdown readers understand, rather than a private
 * marker only this app can read.
 */

import { clamped, edit, range, substring, type Edit, type Range } from "../text/range"

export interface SpanStyle {
  family?: string | null
  size?: number | null
  colorHex?: string | null
}

export const spanIsEmpty = (style: SpanStyle): boolean =>
  !style.family && style.size == null && !style.colorHex

/** `font-family: Georgia; font-size: 18px; color: #2D7DD2` */
export function spanCSS(style: SpanStyle): string {
  const parts: string[] = []
  if (style.family) parts.push(`font-family: ${style.family}`)
  if (style.size != null) parts.push(`font-size: ${Math.round(style.size)}px`)
  if (style.colorHex) parts.push(`color: ${style.colorHex}`)
  return parts.join("; ")
}

/** The style a `<span style="…">` tag carries, read back. */
export function styleFromTag(tag: string): SpanStyle {
  const style: SpanStyle = {}
  const found = /style="([^"]*)"/.exec(tag)
  if (!found) return style
  for (const part of found[1]!.split(";")) {
    const colon = part.indexOf(":")
    if (colon < 0) continue
    const name = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (name === "font-family") style.family = value.replace(/^['"]|['"]$/g, "")
    else if (name === "font-size") {
      const size = parseFloat(value)
      if (!Number.isNaN(size)) style.size = size
    } else if (name === "color") style.colorHex = value
  }
  return style
}

const WRAPPED = /^<span\s[^>]*>([\s\S]*)<\/span>$/

/** The span tags sitting immediately outside `r`, if any. */
function enclosingSpan(text: string, r: Range): Range | null {
  const closing = "</span>"
  const afterAt = r.location + r.length
  if (text.slice(afterAt, afterAt + closing.length) !== closing) return null
  const before = text.slice(0, r.location)
  if (!before.endsWith(">")) return null
  const openStart = before.lastIndexOf("<span ")
  if (openStart < 0) return null
  const opening = before.slice(openStart)
  if (opening.slice(1).includes("<")) return null
  return range(openStart, afterAt + closing.length - openStart)
}

/**
 * Wrap the selection in a styled span — replacing one that is already there
 * rather than nesting, and removing it when the style is empty.
 */
export function applySpan(text: string, selection: Range, style: SpanStyle): Edit {
  let where = clamped(selection, text.length)
  let inner = substring(text, where)

  const wrapped = WRAPPED.exec(inner)
  if (wrapped) {
    inner = wrapped[1]!
  } else {
    const outer = enclosingSpan(text, where)
    if (outer) where = outer
  }

  if (spanIsEmpty(style)) {
    return edit(where, inner, range(where.location, inner.length))
  }
  const open = `<span style="${spanCSS(style)}">`
  return edit(where, open + inner + "</span>", range(where.location + open.length, inner.length))
}

/** Take the styling off the selection, leaving its text. */
export const removeSpan = (text: string, selection: Range): Edit => applySpan(text, selection, {})

// MARK: - Sublime's ⌘D

export interface OccurrenceStep {
  ranges: Range[]
  wholeWord: boolean
  /** The range that was just added, to scroll to. */
  reveal: Range
}

const isWordCharacter = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_]/u.test(c)

/** The word around `location` — letters, digits and underscores. */
export function wordRange(text: string, location: number): Range | null {
  if (text.length === 0) return null
  let start = Math.min(Math.max(0, location), text.length)
  let stop = start
  // A caret just past a word takes that word, as Sublime does.
  while (start > 0 && isWordCharacter(text[start - 1])) start--
  while (stop < text.length && isWordCharacter(text[stop])) stop++
  return stop > start ? range(start, stop - start) : null
}

/** True when nothing word-like touches either end of the range. */
export function isWholeWord(r: Range, text: string): boolean {
  if (r.location > 0 && isWordCharacter(text[r.location - 1])) return false
  const after = r.location + r.length
  if (after < text.length && isWordCharacter(text[after])) return false
  return true
}

/**
 * In order, inside the document, with no duplicates and no overlaps — what a
 * multiple selection requires, and what a stale range set after an edit will
 * not be.
 */
export function normalise(ranges: Range[], length: number): Range[] {
  const out: Range[] = []
  const sorted = ranges.map((r) => clamped(r, length)).sort((a, b) => a.location - b.location)
  for (const r of sorted) {
    const previous = out[out.length - 1]
    if (previous) {
      if (previous.location === r.location && previous.length === r.length) continue
      const overlap = Math.min(previous.location + previous.length, r.location + r.length)
        - Math.max(previous.location, r.location)
      if (overlap > 0) continue
      // Two carets in the same spot are one caret.
      if (previous.length === 0 && r.length === 0 && previous.location === r.location) continue
    }
    out.push(r)
  }
  return out
}

/**
 * The next occurrence of `term` after `location`, wrapping to the top,
 * skipping anything that OVERLAPS a range already selected — not just an exact
 * repeat, because an overlapping pair makes the editor discard the lot.
 */
export function nextOccurrence(text: string, term: string, after: number, skipping: Range[],
  wholeWord = false): Range | null {
  const termLength = term.length
  if (termLength === 0 || text.length < termLength) return null
  const start = Math.min(Math.max(0, after), text.length)
  const windows: [number, number][] = [[start, text.length], [0, Math.min(start, text.length)]]
  for (const [from, to] of windows) {
    let searchFrom = from
    while (searchFrom < to) {
      const found = text.indexOf(term, searchFrom)
      if (found < 0 || found + termLength > to) break
      const hit = range(found, termLength)
      const clashes = skipping.some((r) =>
        Math.min(r.location + r.length, found + termLength) - Math.max(r.location, found) > 0
        || (r.location === found && r.length === termLength))
      if (!clashes && (!wholeWord || isWholeWord(hit, text))) return hit
      searchFrom = found + 1
    }
  }
  return null
}

/**
 * One press of ⌘D against whatever is selected now. Null when there is
 * nothing to do — no word under the caret, or every occurrence taken — and
 * then the selection is left exactly as it was.
 */
export function selectNextOccurrence(text: string, ranges: Range[], wholeWord: boolean): OccurrenceStep | null {
  const clean = normalise(ranges, text.length)
  const last = clean[clean.length - 1]
  if (!last) return null

  // Nothing selected yet: take the word under the caret.
  if (clean.every((r) => r.length === 0)) {
    const word = wordRange(text, last.location)
    if (!word) return null
    const next = clean.filter((r) => r.length > 0)
    next.push(word)
    return { ranges: normalise(next, text.length), wholeWord: true, reveal: word }
  }

  // The term is the newest non-empty range — the one the last press added.
  const newest = [...clean].reverse().find((r) => r.length > 0)
  if (!newest) return null
  const term = substring(text, newest)
  if (term.length === 0) return null

  const searchFrom = Math.max(...clean.map((r) => r.location + r.length))
  const found = nextOccurrence(text, term, searchFrom, clean, wholeWord)
  if (!found) return null
  return { ranges: normalise([...clean, found], text.length), wholeWord, reveal: found }
}

/** Every occurrence at once — Sublime's "Select All Occurrences". */
export function allOccurrences(text: string, term: string, wholeWord: boolean): Range[] {
  const found: Range[] = []
  if (term.length === 0) return found
  let from = 0
  while (from < text.length) {
    const hit = text.indexOf(term, from)
    if (hit < 0) break
    const r = range(hit, term.length)
    if (!wholeWord || isWholeWord(r, text)) found.push(r)
    from = hit + 1
  }
  return found
}
