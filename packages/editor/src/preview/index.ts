/**
 * Write in the preview: the Mac's block-by-block editor, on CodeMirror.
 *
 * Click a drawn block and it opens in place as its own markdown, styled as
 * it is typed; Return starts the next block, Backspace in an empty one takes
 * it away, the arrows walk cell, bar, cell; a box ticks, a link goes, maths
 * is typeset; and the brackets, the seams, the + and the folds are the very
 * ones the markdown side has. The toggle (`setPreview`) reopens on the cell
 * that was at the top of the window.
 */

import { Prec, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { PREVIEW_GAP_HEIGHT } from "@writemind/core"
import { cellOffsetAt } from "../seams"
import { renderedField, setRendered } from "../rendered"
import { previewField } from "./field"
import { holdingField, setHolding } from "./hold"
import { awayField } from "./away"
import { furniture } from "./furniture"
import { previewKeys } from "./keys"
import { previewTheme } from "./theme"

export { holdingField, setHolding } from "./hold"
export { awayField, putAway } from "./away"
export { furnitureAt, reminderAt } from "./furniture"
export { followLink } from "./follow"
export { previewField, BlockWidget } from "./field"
export { previewReturn, previewBackspace, previewKeys } from "./keys"
export { renderBlock, caretAt, pictureSource } from "./render"

/** The rendered page's extensions. Inert until `setRendered` turns the page on. */
export const preview: Extension = [holdingField, awayField, furniture, Prec.high(previewField), previewTheme, previewKeys]

/** The cell at the top of the window, as its offset — what the two modes agree on. */
export function topCell(view: EditorView): number | null {
  // (`topRow`'s rule — the last cell that starts at or above the fold, a line of tolerance — by search. And a pixel
  // more: the page's gaps are a blank line of the markdown side, 21.75px, so a cell scrolled to sit 8px down sits a
  // fraction below that, and was missed for the cell above it — every switch walked the page back a cell.)
  return cellOffsetAt(view, view.scrollDOM.scrollTop + 9)
}

/**
 * Turn the rendered page on or off, and keep the place: the cell that was at
 * the top of the window is put back at the top of the other side, whatever
 * height that side lays the note out at.
 */
export function setPreview(view: EditorView, on: boolean): void {
  if (view.state.field(renderedField, false) === on) return
  const top = topCell(view)
  view.dispatch({
    // The selection is named (unchanged) so every layer that rebuilds on "the selection moved" — the
    // typeset maths, which draws only what it can see, and the blocks drawn over it — looks again.
    selection: view.state.selection,
    effects: [
      setRendered.of(on),
      // Cells held by their brackets are still held on the other side.
      setHolding.of(view.state.field(holdingField, false) ?? false),
      ...(top === null ? [] : [EditorView.scrollIntoView(top, { y: "start", yMargin: PREVIEW_GAP_HEIGHT })]),
    ],
  })
}
