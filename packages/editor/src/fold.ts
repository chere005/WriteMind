/**
 * Folding: a closed section hides its body and the note is never touched.
 * The Mac does it with a typesetter laying out zero-height line fragments;
 * here it is a REPLACE decoration over `hiddenRanges`, which is the same
 * idea — the text is still in the document, it is only not shown.
 *
 * The state is the set of section KEYS (the heading's words, plus an ordinal
 * for repeats), not offsets: an offset moves with every keystroke above it,
 * and a key is what survives a restart (the session keeps it per note).
 */

import {
  EditorSelection, StateEffect, StateField, type EditorState, type Extension,
} from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"
import {
  end, foldableKeys, hasBody, hiddenRange, sections, setFolded, snap, type Range, union,
} from "@writemind/core"
import { notebook } from "./notebook"

/** Close or open one section by key. */
export const foldSection = StateEffect.define<{ key: string; folded: boolean }>()
/** Replace the whole set (a note being restored, "fold all"). */
export const setFolds = StateEffect.define<string[]>()

class FoldedWidget extends WidgetType {
  override toDOM(view: EditorView): HTMLElement {
    const dot = document.createElement("span")
    dot.className = "wm-folded"
    dot.textContent = "⋯"
    dot.title = "Closed — double-click to open"
    dot.onmousedown = (event) => {
      event.preventDefault()
      const at = view.posAtDOM(dot)
      const section = notebook(view.state).sections.find((s) => end(s.headingRange) === at)
      if (section) view.dispatch({ effects: foldSection.of({ key: section.key, folded: false }) })
    }
    return dot
  }
  override eq(): boolean { return true }
  override ignoreEvent(): boolean { return false }
}
const folded = Decoration.replace({ widget: new FoldedWidget() })

/** The ranges the closed sections hide, merged (a closed section in a closed one is hidden once). */
export function hiddenOf(state: EditorState, collapsed: ReadonlySet<string>): Range[] {
  if (collapsed.size === 0) return []
  const length = state.doc.length
  const found = notebook(state).sections
    .filter((section) => collapsed.has(section.key) && hasBody(section))
    .map((section) => hiddenRange(section, length))
    .filter((r) => r.length > 0)
    .sort((a, b) => a.location - b.location)
  const merged: Range[] = []
  for (const r of found) {
    const last = merged[merged.length - 1]
    if (last && r.location <= end(last)) merged[merged.length - 1] = union(last, r)
    else merged.push(r)
  }
  return merged
}

interface Folds { collapsed: Set<string>; hidden: Range[]; decorations: DecorationSet }

const none: Folds = { collapsed: new Set(), hidden: [], decorations: Decoration.none }

function make(state: EditorState, collapsed: Set<string>): Folds {
  const hidden = hiddenOf(state, collapsed)
  return {
    collapsed,
    hidden,
    decorations: Decoration.set(hidden.map((r) => folded.range(r.location, end(r))), true),
  }
}

export const foldField = StateField.define<Folds>({
  create: () => none,
  update(value, transaction) {
    let collapsed = value.collapsed
    let changed = false
    for (const effect of transaction.effects) {
      if (effect.is(foldSection)) {
        collapsed = setFolded(collapsed, effect.value.key, effect.value.folded)
        changed = true
      } else if (effect.is(setFolds)) {
        collapsed = new Set(effect.value)
        changed = true
      }
    }
    if (!changed && !(transaction.docChanged && collapsed.size > 0)) return value
    // The sections come from the NOTEBOOK field, which is declared first and
    // so is already worked out for this transaction.
    return make(transaction.state, collapsed)
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})

/** The keys closed right now. */
export const foldedKeys = (state: EditorState): string[] => [...state.field(foldField).collapsed]
export const hiddenNow = (state: EditorState): Range[] => state.field(foldField).hidden

/** Close or open a section. A caret that would be left inside it moves to the heading. */
export function toggleFold(view: EditorView, key: string, folded?: boolean): void {
  const now = view.state.field(foldField).collapsed.has(key)
  const next = folded ?? !now
  view.dispatch({ effects: foldSection.of({ key, folded: next }) })
  if (next) {
    // A caret left inside what is now hidden steps back to the heading.
    const hidden = hiddenNow(view.state)
    const head = view.state.selection.main.head
    const inside = hidden.find((r) => head > r.location && head <= end(r))
    if (inside) view.dispatch({ selection: EditorSelection.cursor(inside.location) })
  }
}

export function foldAll(view: EditorView): void {
  view.dispatch({ effects: setFolds.of(foldableKeys(view.state.doc.toString())) })
}
export function unfoldAll(view: EditorView): void {
  view.dispatch({ effects: setFolds.of([]) })
}

/** The innermost section the caret is in, folded or not. */
export function sectionAtCaret(state: EditorState) {
  const caret = state.selection.main.head
  let best: ReturnType<typeof sections>[number] | null = null
  for (const section of notebook(state).sections) {
    if (section.range.location <= caret && caret <= end(section.range)) {
      if (!best || section.depth > best.depth) best = section
    }
  }
  return best
}

/**
 * The caret never rests inside what is hidden: moving into a closed section
 * puts it the other side, after the fold going forwards and before it going
 * back (`snap`, the Mac's own rule).
 */
const keepOutOfFolds = EditorView.updateListener.of((update) => {
  if (!update.selectionSet) return
  const hidden = update.state.field(foldField).hidden
  if (hidden.length === 0) return
  const sel = update.state.selection
  const before = update.startState.selection.main.head
  let moved = false
  const ranges = sel.ranges.map((r) => {
    if (!r.empty) return r
    const out = snap({ location: r.head, length: 0 }, hidden, r.head < before)
    if (out.location === r.head) return r
    moved = true
    return EditorSelection.cursor(out.location)
  })
  if (moved) {
    queueMicrotask(() => update.view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex) }))
  }
})

export const folding: Extension = [foldField, keepOutOfFolds]

/** Whether a range starts inside what a closed section hides. */
export const insideHidden = (state: EditorState, r: Range): boolean =>
  state.field(foldField).hidden.some((h) => r.location > h.location && r.location < end(h))
