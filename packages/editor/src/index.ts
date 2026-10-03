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
export { notebookKeys, wrap, heading, list, quote, fence, indentLines, outdentLines } from "./keys"
export { notebookTheme } from "./theme"
export {
  folding, foldField, foldSection, setFolds, foldedKeys, hiddenNow, toggleFold, foldAll, unfoldAll,
  sectionAtCaret,
} from "./fold"
export { applyTextStyle, linkClicks, linkTrigger, selectNext, selectAllOccurrences, tagFence } from "./extras"
export { rendered, renderedField, setRendered } from "./rendered"
