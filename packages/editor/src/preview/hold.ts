/**
 * "These cells are picked up." A bracket click, a drag down the brackets and
 * every whole-cell command that leaves cells selected say so with `setHolding`;
 * anything else that moves the selection or changes the words takes it back.
 *
 * It exists for the rendered page, where one selection has to mean two things:
 * a run of words selected inside a block (the block is open and the words are
 * selected in it) and a block held by its bracket (the block stays drawn, and
 * is lit). The two can be exactly the same characters; this is the word that
 * tells them apart. A leaf module on purpose — the brackets and the keys both
 * import it, and the page imports them.
 */

import { StateEffect, StateField } from "@codemirror/state"

export const setHolding = StateEffect.define<boolean>()

export const holdingField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHolding)) return effect.value
    if (transaction.docChanged || transaction.selection) return false
    return value
  },
})
