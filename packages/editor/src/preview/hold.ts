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

import { EditorState, Prec, StateEffect, StateField, type Extension } from "@codemirror/state"
import { keymap, ViewPlugin } from "@codemirror/view"

export const setHolding = StateEffect.define<boolean>()

export const holdingField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHolding)) return effect.value
    if (transaction.docChanged || transaction.selection) return false
    return value
  },
})


/**
 * A HELD BLOCK IS NOT A SELECTION THE BROWSER CAN HOLD. On the rendered page a held cell's range ends in a drawn block, which
 * has no text for the page's own selection to stand in, so after the window is laid out again (the video pane opening, the
 * sidebar toggling, a click on a button taking and giving back the focus) the browser's selection no longer matches, and
 * CodeMirror reads it back — on the spot, or at the start of the NEXT key — and finds a caret at the end of the block. The
 * cells the person had picked were let go by a click on a toolbar button, and the key that followed (Ctrl+Shift+Down) then
 * extended a selection instead of moving the cell (docs/PLAN-bars-2026-10.md P7 (c)). Two read-backs are refused while
 * cells are held: one that arrives with no key, press or touch on the notebook just before it, and one that arrives as a
 * key is being heard but BEFORE any key command has run (the editor flushes what it has seen of the page's selection first).
 * Everything the person does is taken: the arrows, a click, the brackets, a command's own selection.
 */
let lastInput = 0
let flushing = false
const INPUT = ["mousedown", "pointerdown", "touchstart", "compositionstart", "beforeinput", "paste", "cut", "copy", "dragstart"]
const HEARD_FOR = 150

export const holdGuard: Extension = [
  ViewPlugin.define((view) => {
    const heard = () => { lastInput = performance.now() }
    // A key: the read-back the editor makes first is not the key's (the guard `any` below says when its commands start).
    const key = () => { lastInput = performance.now(); flushing = true; setTimeout(() => { flushing = false }, 0) }
    for (const name of INPUT) view.dom.addEventListener(name, heard, true)
    view.dom.addEventListener("keydown", key, true)
    return {
      destroy() {
        for (const name of INPUT) view.dom.removeEventListener(name, heard, true)
        view.dom.removeEventListener("keydown", key, true)
      },
    }
  }),
  // The first key handler of all: from here on, a selection is the key's own.
  Prec.highest(keymap.of([{ any: () => { flushing = false; return false } }])),
  EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged || tr.effects.length > 0 || !tr.isUserEvent("select") || tr.isUserEvent("select.pointer")) return tr
    if (tr.startState.field(holdingField, false) !== true) return tr
    if (!flushing && performance.now() - lastInput < HEARD_FOR) return tr
    // Only the read-back's own shape: the held cells collapsed to a caret.
    const was = tr.startState.selection
    if (was.ranges.every((r) => r.empty) || !tr.selection.ranges.every((r) => r.empty)) return tr
    return []
  }),
]
