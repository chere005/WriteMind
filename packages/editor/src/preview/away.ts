/**
 * "The caret is put away." Escape in an open block on the rendered page (Mac
 * `BlockEditor`'s cancelOperation → `move(.out)`: the cell closes and nothing
 * is open). This page has one selection and so always a caret; put away, that
 * caret is hidden and the block it is in is drawn like the rest. Anything that
 * moves the selection or changes the words brings it back, so the next arrow
 * or keystroke carries on where it was. A leaf module, like `hold.ts`.
 */

import { StateEffect, StateField } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

export const putAway = StateEffect.define<boolean>()

export const awayField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(putAway)) return effect.value
    if (transaction.docChanged || transaction.selection) return false
    return value
  },
  provide: (field) => EditorView.editorAttributes.from(field, (away) => (away ? AWAY : NOT_AWAY)),
})

const AWAY = { class: "wm-pv-away" }
const NOT_AWAY = {} as Record<string, string>
