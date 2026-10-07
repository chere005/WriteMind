/**
 * The notebook editor: CodeMirror, extended until it is WriteMind's.
 *
 * What the Mac needed a TextKit 1 layout manager, a typesetter, two
 * overlay NSViews and seven rounds of cursor debugging for is here in a few
 * files — and every RULE in them is imported from `@writemind/core`, which
 * is the same model the Swift app runs.
 */

export { notebookState, notebookField, notebook, cellRanges, selectedRanges, applyEdit, cellWritten } from "./notebook"
export { notebookDecorations, safeSpanStyle } from "./decorations"
export { seamExtensions, armedField, armedTypeField, armSeam, setArmedType, pageSeams } from "./seams"
export { cellBrackets, heldCells, GUTTER_WIDTH } from "./brackets"
export { notebookKeys, wrap, heading, list, listStyleSource, quote, fence, mathsCell, indentLines, outdentLines, textCell, markdownCell, mergeTheCell } from "./keys"
// Held cells copied (the app copies their drawing cells for Mathematica too), and the cells' own clipboard type.
export { cellsCopied, CELLS_MIME } from "./keys"
// Text cells and markdown cells (docs/PLAN-text-cells.md): the hidden marker, literal typing, plain copy.
export { textCells, markerField, hiddenMarkers, plainSelection, redoWaiting } from "./textCells"
export { codeTypingKeys } from "./codeTyping"
export { notebookTheme } from "./theme"
export { textConventions } from "./conventions"
export { find, findField, setFind, findCount, findNextMatch, replaceMatch, replaceEvery } from "./find"
export { hiddenMarkerDeletion } from "./markerDeletion"
export { pasteHtmlAsText, htmlToPlain, takesPastedPicture, DRAWING_MIME, drawingPasted, pasteDrawing } from "./paste"
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
export { cellBoxes, showDropBar, dropBarField, seamAfterCellAt } from "./seams"
// The pointer over the page, and making a cell (Sean, 2026-10-05: one hit-test for cursor and click; the cell made at once).
export { pointerPlace, armAt, openCellAt, openBarForWriting, armAtNoteEnd, OWN_POINTER, type PointerPlace } from "./seams"
// A cell that touches another but stands apart from it (Sean, 2026-10-05): the gap drawn over it, and the measure.
export { apartCells, gapAt, APART_GAP } from "./apart"
export { makesCellAfter } from "./dock"
// Picture and ink cells, the rect registry and docking (docs\PLAN-docking-ink-cells.md (c), (d)).
export {
  pictureCells, pictureCellsField, inkCellPainter, setInkAspects, inkAspectsField, repaintInkCells, holdPictureCell,
  pictureCellsOf, picturesWhole, pictureCellLine, type InkCellPainter,
} from "./pictureCells"
export { inkCellPlaces, inkCellsMoved, type InkCellPlace } from "./inkCellRegistry"
export { cursorSeam, dropTargetAt, insertCellLine, removeCellLine, columnBox, showDropTarget, type DropTarget } from "./dock"
export { PICTURE_LINE, pictureCellDom, lastColumnWidth } from "./pictureDom"
// Tables (the first part of "Tables, from scratch"): the grid in the markdown, Tab between cells, Return adds a row.
export { tables, tableKeys, tableAt, tableTabCommand, tableReturnCommand } from "./tables"
export { mathRendering, mathElement, mathDOM, installMathStyles, showsSource, MATH_CSS, MATHML_NS } from "./math"
export {
  evaluationCells, evalHost, evalField, evaluationCell, runCell, evaluatesHere, groupsIn, type EvalHost,
} from "./eval/index"
