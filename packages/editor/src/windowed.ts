/**
 * A rule that reads a character or a line is given that character or that line, not the whole note.
 *
 * The core's rules take `(text, selection)` and answer with an `Edit` — they were written for a string, and the
 * editor used to make one of the whole document (a pass over 500 KB, 2 MB) for every Return in a list, every
 * Backspace and every character typed in a code cell, to be read at one place. These helpers cut the window the rule
 * reads, run it, and move its answer back to where the window came from. `windowed.test.ts` holds each rule to its
 * answer over the whole text.
 */

import type { EditorState } from "@codemirror/state"
import { prefixLength, type Edit, type Range } from "@writemind/core"

const shifted = (edit: Edit, by: number): Edit => ({
  range: { location: edit.range.location + by, length: edit.range.length },
  replacement: edit.replacement,
  selection: { location: edit.selection.location + by, length: edit.selection.length },
})

/** Run `rule` over the text from `before` characters before the selection to `after` characters after it. */
export function aroundSelection<T extends Edit | null>(state: EditorState, selection: Range, before: number, after: number,
  rule: (text: string, selection: Range) => T): T {
  const base = Math.max(0, selection.location - before)
  const stop = Math.min(state.doc.length, selection.location + selection.length + after)
  const edit = rule(state.sliceDoc(base, stop), { location: selection.location - base, length: selection.length })
  return (edit ? shifted(edit, base) : edit) as T
}

/**
 * Run `rule` over the lines the selection touches (each with its newline), which is all a line rule reads.
 * `rule` gets the selection moved to match.
 */
export function overLines<T extends Edit | null>(state: EditorState, selection: Range,
  rule: (text: string, selection: Range) => T): T {
  const doc = state.doc
  const first = doc.lineAt(Math.min(selection.location, doc.length))
  const last = doc.lineAt(Math.min(selection.location + selection.length, doc.length))
  const base = first.from
  const stop = Math.min(doc.length, last.to + 1)
  const edit = rule(state.sliceDoc(base, stop), { location: selection.location - base, length: selection.length })
  return (edit ? shifted(edit, base) : edit) as T
}

/**
 * Whether Backspace with the caret at `at` could be an outdent: the caret is inside the prefix (indent, quote marks,
 * bullet) of its line. `outdentForBackspace` asks exactly this first, of the caret's line alone, and answers null when
 * the answer is no — which it is for nearly every Backspace. So the whole note is only turned into a string for the
 * one that might be.
 */
export function backspaceMayOutdent(state: EditorState, at: number): boolean {
  const doc = state.doc
  const line = doc.lineAt(at)
  const column = at - line.from
  if (column <= 0) return false
  const prefix = prefixLength(line.text + (line.to < doc.length ? "\n" : ""))
  return column <= prefix && prefix !== 0
}
