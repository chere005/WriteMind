/**
 * Deleting text that has hidden markers in it. Ported from `WriteMind/Editor/MarkerDeletion.swift`.
 *
 * The markers are still in the note — `**` round bold, `~~` round struck text, `#` in
 * front of a heading — they are only drawn with no width. So a selection made with the
 * eye can cut a pair in half: take "**bo" out of "**bold**" and the note is left holding
 * `ld**`, which renders as a stray pair of asterisks.
 *
 * A delete therefore takes whole markers, never half of one, and when it takes one half
 * of a pair it takes the other half too — otherwise the text left behind is marked up
 * with an opener that never closes.
 */

import { end, range, type Range } from "../text/range"
import { sourceStyleRuns } from "./sourceStyle"

/** The marker either side of a styled run — the two halves that have to go together. */
export interface MarkerPair { open: Range; close: Range }

/** What a block's markdown is made of, as far as deleting is concerned. */
export interface MarkerStructure {
  markers: Range[]
  pairs: MarkerPair[]
}

/** The structure the Mac's own style pass finds (`MarkdownSourceStyle.runs`). */
export function markerStructure(source: string): MarkerStructure {
  const runs = sourceStyleRuns(source)
  const markers = runs.filter((run) => run.kind === "marker").map((run) => run.range)
  const pairs: MarkerPair[] = []
  for (const run of runs) {
    if (!["bold", "italic", "strikethrough", "code", "math"].includes(run.kind)) continue
    const open = markers.find((marker) => end(marker) === run.range.location)
    const close = markers.find((marker) => marker.location === end(run.range))
    if (open && close) pairs.push({ open, close })
  }
  return { markers, pairs }
}

const intersect = (a: Range, b: Range): Range => {
  const start = Math.max(a.location, b.location)
  const stop = Math.min(end(a), end(b))
  return stop > start ? range(start, stop - start) : range(0, 0)
}
const union = (a: Range, b: Range): Range => {
  const start = Math.min(a.location, b.location)
  return range(start, Math.max(end(a), end(b)) - start)
}

/**
 * The ranges a delete should really take, biggest location first so a caller can apply
 * them back to front without recomputing anything. One range — the one asked for — when
 * there is nothing to widen. The FIRST element, after sorting, is not necessarily the
 * range asked for: `askedDeletion` says which is which.
 */
export function widenedDeletions(asked: Range, length: number, structure: MarkerStructure): Range[] {
  // A range that runs off the end is nobody's edit.
  const clipped = intersect(asked, range(0, length))
  const start = clipped.length === 0 ? range(Math.min(asked.location, length), 0) : clipped
  if (start.length === 0 || structure.markers.length === 0) return [start]

  let wanted = start
  // A marker the delete only clips is taken whole.
  for (const marker of structure.markers) {
    const overlap = intersect(marker, wanted)
    if (overlap.length > 0 && overlap.length < marker.length) wanted = union(wanted, marker)
  }

  // …and a pair with one half gone loses the other half as well.
  const extra: Range[] = []
  for (const pair of structure.pairs) {
    const opener = intersect(pair.open, wanted).length === pair.open.length
    const closer = intersect(pair.close, wanted).length === pair.close.length
    if (opener && !closer) extra.push(pair.close)
    if (closer && !opener) extra.push(pair.open)
  }
  return [wanted, ...extra].sort((a, b) => b.location - a.location)
}

/** `MarkerDeletion.deletions(for:in:)`: the widening over a whole source string. */
export const markerDeletions = (asked: Range, source: string): Range[] =>
  widenedDeletions(asked, source.length, markerStructure(source))

/**
 * Which of the deletions is the range the user actually selected — the one a replacement
 * goes into. The others are orphaned markers and are only ever removed.
 */
export const askedDeletion = (asked: Range, deletions: Range[]): Range =>
  deletions.find((one) => intersect(one, asked).length > 0) ?? asked
