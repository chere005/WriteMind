/**
 * Two independent switches, as on the Mac (`AppState.mode` and `showMarkers`):
 *
 * - `renderedField` is the Markdown Preview / Markdown Editor toggle. On:
 *   every block is DRAWN (`preview/`) except the one being written in, which
 *   is its own markdown with the marks put away on every line but the
 *   caret's. The seams, the brackets, the cells and the folding are the very
 *   ones the markdown side has — it is the same document, selection and undo
 *   — which is what "the same place, whichever mode" asks.
 * - `markersField` is View ▸ Hide / Show Markdown Markers, and it is about
 *   the SOURCE side: with the markers hidden the markdown editor reads as
 *   the finished page — the `**`, the `#`, the link's URL are put away on
 *   every line but the ones the caret is in — and the file is untouched.
 *   Shown (the Mac's default) they are drawn faded beside the words. On the
 *   rendered page the open block always hides its marks, whatever this says.
 */

import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

export const setRendered = StateEffect.define<boolean>()
export const setMarkers = StateEffect.define<boolean>()

export const renderedField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setRendered)) return effect.value
    return value
  },
  provide: (field) => EditorView.editorAttributes.from(field, (on) => (on ? { class: "wm-rendered" } : { class: "" })),
})

/** Whether the markdown markers are shown (true, the Mac's default) or put away. */
export const markersField = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setMarkers)) return effect.value
    return value
  },
  provide: (field) => EditorView.editorAttributes.from(field, (on) => (on ? { class: "" } : { class: "wm-markers-hidden" })),
})

export const rendered: Extension = [renderedField, markersField]

/** Whether the marks on lines the caret is not in are put away: on the rendered page always, else when asked. */
export const marksAway = (state: EditorState): boolean =>
  state.field(renderedField, false) === true || state.field(markersField, false) === false
