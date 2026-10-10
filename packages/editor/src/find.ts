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
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { findAll, findVisible, hiddenInNote, matchAt, nextMatch, replacingAll, type FindOptions, type Range } from "@writemind/core"
import { notebook } from "./notebook"
import { revealAt } from "./fold"
import { renderedField } from "./rendered"

export interface FindQuery extends FindOptions { query: string }

/** Turn the highlights on (with a query) or off (null). */
export const setFind = StateEffect.define<FindQuery | null>()

interface Found { query: FindQuery | null; matches: Range[]; decorations: DecorationSet }

const lit = Decoration.mark({ class: "wm-find-match" })
const current = Decoration.mark({ class: "wm-find-match wm-find-current" })

/** The matches of a query in a state: what the page shows (core findVisible), as source ranges. */
function matchesOf(state: EditorState, query: FindQuery): Range[] {
  // (What the page SHOWS: a marker line and a text cell's hidden backslashes are not there to find.)
  const text = state.doc.toString()
  return findVisible(text, query.query, query, hiddenInNote(text, notebook(state).cells, state.field(renderedField, false) === true))
}

/** `matches` is kept while neither the words nor the query changed: a caret move only changes which one is current. */
function build(state: EditorState, query: FindQuery | null, kept?: Range[]): Found {
  if (!query || query.query.length === 0) return { query, matches: [], decorations: Decoration.none }
  const matches = kept ?? matchesOf(state, query)
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
    // (The page switching dress changes what is shown: a link's address is there to find on the markdown side only.)
    const dress = transaction.state.field(renderedField, false) !== transaction.startState.field(renderedField, false)
    if (!changed && !dress && !transaction.docChanged && !transaction.selection) return value
    if (!query) return value.query === null ? value : { query: null, matches: [], decorations: Decoration.none }
    return build(transaction.state, query, changed || dress || transaction.docChanged ? undefined : value.matches)
  },
  provide: (field) => EditorView.decorations.from(field, (found) => found.decorations),
})

/**
 * THE RENDERED PAGE (docs/PLAN-bars-2026-10.md P7 (e): "matches ... in the rendered page"): a block that is DRAWN shows
 * no markdown for the decorations above to mark, so its words are marked where they are drawn, with the page's own
 * highlight (`::highlight(wm-find)`, editor.css): every occurrence of the words in the text of each drawn block. The
 * block the selection is in is open, and is marked by the decorations like any markdown. Where the page has no highlight
 * API (a test environment) nothing is marked, and the count and the moves are the same.
 */
const HIGHLIGHT = "wm-find"
const DRAWN = ".wm-pv, .wm-math-block"

type Highlights = { set(name: string, value: unknown): void; delete(name: string): void }
const registry = (): Highlights | null => (typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: Highlights }).highlights : null)

/** The ranges of the words in one drawn block's text (across its text nodes). */
export function wordsDrawnIn(block: Element, query: FindQuery): globalThis.Range[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; from: number }[] = []
  let text = ""
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, from: text.length })
    text += (node as Text).data
  }
  // The text node holding a character index: its first character for a start, its last for an end (exclusive).
  const at = (index: number, end: boolean): { node: Text; offset: number } | null => {
    for (const entry of nodes) {
      const length = entry.node.data.length
      if (end ? index > entry.from && index <= entry.from + length : index >= entry.from && index < entry.from + length) {
        return { node: entry.node, offset: index - entry.from }
      }
    }
    return null
  }
  const out: globalThis.Range[] = []
  for (const match of findAll(text, query.query, query)) {
    const from = at(match.location, false)
    const to = at(match.location + match.length, true)
    if (!from || !to) continue
    const range = document.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    out.push(range)
  }
  return out
}

const drawnHighlights = ViewPlugin.fromClass(class {
  private readonly measure = { key: "wm-find-drawn", read: () => null, write: () => this.paint() }
  constructor(private readonly view: EditorView) { view.requestMeasure(this.measure) }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged
      || update.state.field(findField, false) !== update.startState.field(findField, false)) update.view.requestMeasure(this.measure)
  }
  private paint(): void {
    const highlights = registry()
    if (!highlights) return
    const query = this.view.state.field(findField, false)?.query
    if (!query || query.query.length === 0) { highlights.delete(HIGHLIGHT); return }
    const ranges: globalThis.Range[] = []
    this.view.contentDOM.querySelectorAll(DRAWN).forEach((block) => { ranges.push(...wordsDrawnIn(block, query)) })
    if (ranges.length === 0 || typeof Highlight === "undefined") { highlights.delete(HIGHLIGHT); return }
    highlights.set(HIGHLIGHT, new Highlight(...ranges))
  }
  destroy(): void { registry()?.delete(HIGHLIGHT) }
})

export const find: Extension = [
  drawnHighlights,
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

/**
 * Go to a match: a closed section that hides it is opened first (a match nobody can see is not a match you have gone
 * to), it is SELECTED, and the page scrolls only as far as it must — left where it is when the match is on screen, else
 * the match in the middle. (The page used to jump to centre the match on every Enter, with the match already in view.)
 */
function goTo(view: EditorView, match: Range): void {
  revealAt(view, match.location)
  view.dispatch({ selection: EditorSelection.range(match.location, match.location + match.length) })
  const box = view.coordsAtPos(match.location)
  const scroller = view.scrollDOM.getBoundingClientRect()
  const visible = box !== null && box.top >= scroller.top + 24 && box.bottom <= scroller.bottom - 24
  if (!visible) view.dispatch({ effects: EditorView.scrollIntoView(match.location, { y: "center" }) })
}

/** Incremental, as the Mac's bar is: the first match from where the selection starts is selected as the words are typed. */
export function findFromSelection(view: EditorView): boolean {
  const found = view.state.field(findField, false)
  if (!found || found.matches.length === 0) return false
  const at = nextMatch(found.matches, view.state.selection.main.from)
  if (at === null) return false
  goTo(view, found.matches[at]!)
  return true
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
  goTo(view, found.matches[at]!)
  return true
}

/**
 * Find Next / Previous with the bar away (⌘G): go on looking for `query` from the selection, with nothing left lit
 * afterwards. (The page used to open the bar again instead, with the words in it and nothing selected.)
 */
export function findStep(view: EditorView, query: FindQuery, backwards = false): boolean {
  view.dispatch({ effects: setFind.of(query) })
  const moved = findNextMatch(view, backwards)
  view.dispatch({ effects: setFind.of(null) })
  return moved
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
