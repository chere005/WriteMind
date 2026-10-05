/**
 * The notebook editor: CodeMirror, extended until it is WriteMind's.
 *
 * What the Mac needed a TextKit 1 layout manager, a typesetter, two
 * overlay NSViews and seven rounds of cursor debugging for is here in a few
 * files — and every RULE in them is imported from `@writemind/core`, which
 * is the same model the Swift app runs.
 */

export { notebookState, notebookField, notebook, cellRanges, selectedRanges, applyEdit } from "./notebook"
export { notebookDecorations, safeSpanStyle } from "./decorations"
export { seamExtensions, armedField, armedTypeField, armSeam, setArmedType, pageSeams } from "./seams"
export { cellBrackets, heldCells, GUTTER_WIDTH } from "./brackets"
export { notebookKeys, wrap, heading, list, listStyleSource, quote, fence, indentLines, outdentLines } from "./keys"
export { codeTypingKeys } from "./codeTyping"
export { notebookTheme } from "./theme"
export { textConventions } from "./conventions"
export { find, findField, setFind, findCount, findNextMatch, replaceMatch, replaceEvery } from "./find"
export { hiddenMarkerDeletion } from "./markerDeletion"
export { pasteHtmlAsText, htmlToPlain } from "./paste"
export {
  folding, foldField, foldSection, setFolds, foldedKeys, hiddenNow, toggleFold, foldAll, unfoldAll,
  sectionAtCaret, revealAt, foldsHiding,
} from "./fold"
export { applyTextStyle, linkClicks, linkTrigger, selectNext, selectAllOccurrences, tagFence } from "./extras"
export { rendered, renderedField, setRendered, markersField, setMarkers, marksAway } from "./rendered"
export {
  preview, setPreview, topCell, previewField, holdingField, setHolding, followLink, renderBlock, caretAt,
  pictureSource, previewReturn, previewBackspace, BlockWidget,
} from "./preview"
export { cellBoxes } from "./seams"
export { mathRendering, mathElement, mathDOM, installMathStyles, showsSource, MATH_CSS, MATHML_NS } from "./math"
