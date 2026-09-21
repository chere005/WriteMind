/**
 * What `NSRange` and the handful of Foundation string functions the model
 * leans on mean here. A JavaScript string is UTF-16 code units, exactly as
 * `NSString` was, so every offset in a ported rule means the same character
 * it meant on the other side — that is the one thing that made transcribing
 * the ranges safe, and it is why nothing here counts "characters".
 */

export interface Range {
  location: number
  length: number
}

export const range = (location: number, length: number): Range => ({ location, length })
export const end = (r: Range): number => r.location + r.length
export const sameRange = (a: Range, b: Range): boolean =>
  a.location === b.location && a.length === b.length

/** NSLocationInRange: the end is NOT in the range. */
export const inRange = (location: number, r: Range): boolean =>
  location >= r.location && location < end(r)

export function intersection(a: Range, b: Range): Range {
  const start = Math.max(a.location, b.location)
  const stop = Math.min(end(a), end(b))
  return stop > start ? range(start, stop - start) : range(0, 0)
}

export function union(a: Range, b: Range): Range {
  const start = Math.min(a.location, b.location)
  return range(start, Math.max(end(a), end(b)) - start)
}

export const clamped = (r: Range, length: number): Range => {
  const start = Math.min(Math.max(r.location, 0), length)
  return range(start, Math.min(Math.max(r.length, 0), length - start))
}

export const substring = (text: string, r: Range): string => text.slice(r.location, end(r))

export const replacing = (text: string, r: Range, replacement: string): string =>
  text.slice(0, r.location) + replacement + text.slice(end(r))

/** NSString.lineRange(for:) — the line holding `location`, its newline included. */
export function lineRange(text: string, location: number): Range {
  const at = Math.min(Math.max(location, 0), text.length)
  let start = at
  while (start > 0 && text[start - 1] !== "\n") start--
  let stop = at
  while (stop < text.length && text[stop] !== "\n") stop++
  if (stop < text.length) stop++
  return range(start, stop - start)
}

/** The word at an index, `_`, `-` and `'` counting as letters. */
export function rangeOfWord(text: string, index: number): Range {
  if (text.length === 0 || index < 0 || index >= text.length) return range(index, 0)
  const isWord = (at: number): boolean => {
    if (at < 0 || at >= text.length) return false
    return /[\p{L}\p{N}_\-']/u.test(text[at]!)
  }
  if (!isWord(index)) return range(index, 0)
  let start = index
  let stop = index + 1
  while (isWord(start - 1)) start--
  while (isWord(stop)) stop++
  return range(start, stop - start)
}

/**
 * One change to the note: what to replace, with what, and where the caret
 * goes afterwards. Every pure rule in this package returns one of these
 * rather than touching a document, so the editor applies it in a way its
 * own undo can see.
 */
export interface Edit {
  range: Range
  replacement: string
  selection: Range
}

export const edit = (r: Range, replacement: string, selection: Range): Edit =>
  ({ range: r, replacement, selection })

/** An edit applied to plain text, for the tests and for any headless caller. */
export function applied(text: string, change: Edit): { text: string; selection: Range } {
  return { text: replacing(text, change.range, change.replacement), selection: change.selection }
}
