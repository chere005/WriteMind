/**
 * Folding, the part that is arithmetic. Ported from the pure bits of
 * `MarkdownTextView.Coordinator.snap` and `NoteStore.foldAllSections`.
 *
 * Folding is not an edit: a closed section is only HIDDEN (`hiddenRanges`),
 * the note's text is never touched, so nothing can be lost by collapsing.
 */

import { end, range, type Range } from "../text/range"
import { hasBody, sections } from "./outline"

/**
 * Moving the caret INTO a closed section puts it the other side of it
 * instead — after the fold going forwards, before it going backwards. A
 * selection (anything with a length) is left alone, and so is a caret on a
 * fold's edge.
 */
export function snap(selection: Range, hidden: Range[], backwards: boolean): Range {
  if (selection.length !== 0) return selection
  for (const fold of hidden) {
    if (fold.length > 0 && selection.location > fold.location && selection.location < end(fold)) {
      return range(backwards ? fold.location : end(fold), 0)
    }
  }
  return selection
}

/** Every section with something under its heading to hide. */
export const foldableKeys = (text: string): string[] =>
  sections(text).filter(hasBody).map((section) => section.key)

/** The keys after one section is closed or opened. */
export function setFolded(collapsed: Iterable<string>, key: string, folded: boolean): Set<string> {
  const next = new Set(collapsed)
  if (folded) next.add(key)
  else next.delete(key)
  return next
}
