/**
 * Finding words in a note. The Mac's text view has a find bar (`usesFindBar = true`:
 * ⌘F, ⌘G / ⇧⌘G for the next and the previous, ⌘E to use the selection, ⌥⌘F to replace);
 * this is the model behind the same bar here: where the matches are, which one comes
 * next from a place in the note (wrapping round), and what a replace leaves.
 *
 * Matching ignores case unless asked not to, as the Mac's bar does by default, and can
 * be limited to whole words.
 */

import { range, type Range } from "./range"

export interface FindOptions {
  /** Off by default: "note" finds "Note". */
  caseSensitive: boolean
  /** Off by default: "cat" finds the start of "category". */
  wholeWord: boolean
}

export const defaultFindOptions: FindOptions = { caseSensitive: false, wholeWord: false }

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}_]/u.test(character)

/** Every match of `query` in `text`, in order, none overlapping. An empty query matches nothing. */
export function findAll(text: string, query: string, options: FindOptions = defaultFindOptions, limit = 20000): Range[] {
  if (query.length === 0) return []
  const haystack = options.caseSensitive ? text : text.toLowerCase()
  const needle = options.caseSensitive ? query : query.toLowerCase()
  // (lower-casing can change a string's length for a few letters; then positions would drift, so match as is)
  const safeHay = haystack.length === text.length ? haystack : text
  const safeNeedle = haystack.length === text.length ? needle : query
  const found: Range[] = []
  let from = 0
  while (found.length < limit) {
    const at = safeHay.indexOf(safeNeedle, from)
    if (at < 0) break
    const stop = at + safeNeedle.length
    from = stop > at ? stop : at + 1
    if (options.wholeWord && (isWordCharacter(text[at - 1]) || isWordCharacter(text[stop]))) {
      // (a match that is only part of a word is skipped, and the search goes on one letter in)
      from = at + 1
      continue
    }
    found.push(range(at, safeNeedle.length))
  }
  return found
}

/**
 * The match to go to from a place: the first one starting at or after `from` (going on), or the last one
 * ending at or before `from` (going back) — wrapping round the note when there is none. The index in
 * `matches`, or null when there are no matches at all.
 */
export function nextMatch(matches: Range[], from: number, backwards = false): number | null {
  if (matches.length === 0) return null
  if (!backwards) {
    const index = matches.findIndex((match) => match.location >= from)
    return index < 0 ? 0 : index
  }
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index]!
    if (match.location + match.length <= from) return index
  }
  return matches.length - 1
}

/** The index of the match that is exactly this range, if any (the current one). */
export const matchAt = (matches: Range[], selection: Range): number | null => {
  const index = matches.findIndex((match) => match.location === selection.location && match.length === selection.length)
  return index < 0 ? null : index
}

/** The note after replacing every match with `replacement`. */
export function replacingAll(text: string, matches: Range[], replacement: string): string {
  let out = ""
  let last = 0
  for (const match of matches) {
    out += text.slice(last, match.location) + replacement
    last = match.location + match.length
  }
  return out + text.slice(last)
}
