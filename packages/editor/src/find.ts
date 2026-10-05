/**
 * Find in the note: the highlights, and the moves (next, previous, replace). The Mac's text
 * view has a find bar of its own (`usesFindBar`); the bar here is `FindBar.tsx`, and this is
 * what it drives. The model — where the matches are, which comes next — is the core's
 * `text/find`.
 *
 * Every match is lit while the bar is open; the one the selection is on is lit more. On the
 * rendered page the blocks that are drawn show no highlight (they are drawn over the words),
 * but going to a match selects it, which opens its block.
 */

import { EditorSelection, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view"
import { findAll, matchAt, nextMatch, replacingAll, type FindOptions, type Range } from "@writemind/core"

export interface FindQuery extends FindOptions { query: string }

/** Turn the highlights on (with a query) or off (null). */
export const setFind = StateEffect.define<FindQuery | null>()

interface Found { query: FindQuery | null; matches: Range[]; decorations: DecorationSet }

const lit = Decoration.mark({ class: "wm-find-match" })
const current = Decoration.mark({ class: "wm-find-match wm-find-current" })

function build(state: EditorState, query: FindQuery | null): Found {
  if (!query || query.query.length === 0) return { query, matches: [], decorations: Decoration.none }
  const matches = findAll(state.doc.toString(), query.query, query)
  const selection = state.selection.main
  const here = matchAt(matches, { location: selection.from, length: selection.to - selection.from })
  const builder = new RangeSetBuilder<Decoration>()
  matches.forEach((match, index) => {
    builder.add(match.location, match.location + match.length, index === here ? current : lit)
  })
  return { query, matches, decorations: builder.finish() }
}

export const findField = StateField.define<Found>({
  create: () => ({ query: null, matches: [], decorations: Decoration.none }),
  update(value, transaction) {
    let query = value.query
    let changed = false
    for (const effect of transaction.effects) {
      if (effect.is(setFind)) { query = effect.value; changed = true }
    }
    if (!changed && !transaction.docChanged && !transaction.selection) return value
    if (!query) return value.query === null ? value : { query: null, matches: [], decorations: Decoration.none }
    return build(transaction.state, query)
  },
  provide: (field) => EditorView.decorations.from(field, (found) => found.decorations),
})

export const find: Extension = [
  findField,
  EditorView.theme({
    ".wm-find-match": { backgroundColor: "rgba(255, 213, 0, 0.30)", borderRadius: "2px" },
    ".wm-find-current": { backgroundColor: "rgba(255, 150, 0, 0.55)", outline: "1px solid rgba(255, 150, 0, 0.9)" },
  }),
]

/** How many matches there are, and which is the selection (0 when none is). */
export function findCount(state: EditorState): { total: number; index: number } {
  const found = state.field(findField, false)
  if (!found) return { total: 0, index: 0 }
  const main = state.selection.main
  const here = matchAt(found.matches, { location: main.from, length: main.to - main.from })
  return { total: found.matches.length, index: here === null ? 0 : here + 1 }
}

/** Select the next match from the selection (the one after it, wrapping round), or the previous one. */
export function findNextMatch(view: EditorView, backwards = false): boolean {
  const found = view.state.field(findField, false)
  if (!found || found.matches.length === 0) return false
  const main = view.state.selection.main
  // From the selection's far side in the direction of travel; from the near side, a match that IS the selection would be found again.
  const from = backwards ? main.from : main.to
  const at = nextMatch(found.matches, from, backwards)
  if (at === null) return false
  const match = found.matches[at]!
  view.dispatch({
    selection: EditorSelection.range(match.location, match.location + match.length),
    effects: EditorView.scrollIntoView(match.location, { y: "center" }),
  })
  return true
}

/** Replace the selected match (if the selection is one) and go on to the next. */
export function replaceMatch(view: EditorView, replacement: string): boolean {
  const found = view.state.field(findField, false)
  if (!found) return false
  const main = view.state.selection.main
  const here = matchAt(found.matches, { location: main.from, length: main.to - main.from })
  if (here === null) return findNextMatch(view)
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: replacement },
    selection: { anchor: main.from + replacement.length },
    userEvent: "input.replace",
  })
  findNextMatch(view)
  return true
}

/** Replace every match, as one edit. Returns how many. */
export function replaceEvery(view: EditorView, replacement: string): number {
  const found = view.state.field(findField, false)
  if (!found || found.matches.length === 0) return 0
  const text = view.state.doc.toString()
  const next = replacingAll(text, found.matches, replacement)
  if (next === text) return 0
  const changes = found.matches.map((match) => ({ from: match.location, to: match.location + match.length, insert: replacement }))
  view.dispatch({ changes, userEvent: "input.replace" })
  return found.matches.length
}
