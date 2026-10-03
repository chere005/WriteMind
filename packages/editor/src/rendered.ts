/**
 * The rendered page. The Mac has a second editor for it, block by block;
 * here it is the SAME editor with the markdown's own marks put away — the
 * `#`, the `**`, the backticks, the URL of a link — except on the line the
 * caret is on, which shows its source so it can be edited. The seams, the
 * brackets, the cells and the folding are therefore the very ones the
 * markdown side has, which is what "the same place, whichever mode" asks.
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

export const setRendered = StateEffect.define<boolean>()

export const renderedField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setRendered)) return effect.value
    return value
  },
  provide: (field) => EditorView.editorAttributes.from(field, (on) => (on ? { class: "wm-rendered" } : { class: "" })),
})

export const rendered: Extension = renderedField
