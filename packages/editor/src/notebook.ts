/**
 * The notebook the editor is looking at: the cells, and the sections that
 * group them. One state field, recomputed only when the document changes,
 * because everything else — the brackets, the seams, the decorations, the
 * fold — is drawn FROM it and none of them may parse the note again.
 *
 * This is the CodeMirror half of what `MarkdownTextView.refreshBrackets`
 * did on the Mac: the model is the same, the measuring is not.
 */

import { StateField, type ChangeSet, type EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import {
  positioned, positionedUpdate, sectionsFromCells, type Hull, type PositionedBlock, type Range, type Section,
} from "@writemind/core"

export interface Notebook {
  cells: PositionedBlock[]
  sections: Section[]
}

/** What a transaction changed, as the one stretch of text that covers every change in it. */
export function hullOf(changes: ChangeSet): Hull {
  let from = Infinity
  let toOld = -1
  let toNew = -1
  changes.iterChangedRanges((fromA, toA, _fromB, toB) => {
    if (fromA < from) from = fromA
    if (toA > toOld) toOld = toA
    if (toB > toNew) toNew = toB
  })
  return { from: from === Infinity ? 0 : from, toOld: Math.max(toOld, 0), toNew: Math.max(toNew, 0) }
}

/**
 * The cells are not parsed again on a keystroke: `positionedUpdate` starts at the block the edit touched and
 * stops where the parse is back in step with the last one, and the sections are worked out from the cells and the
 * lines at their edges (`parserIncremental.test.ts` is the proof that the answers are the whole-parse ones).
 * Nothing here turns the document into a string after the first time.
 */
export const notebookField = StateField.define<Notebook>({
  create(state) {
    const cells = positioned(state.doc.toString())
    return { cells, sections: sectionsFromCells(cells, state.doc) }
  },
  update(value, transaction) {
    if (!transaction.docChanged) return value
    const cells = positionedUpdate(value.cells, hullOf(transaction.changes), transaction.state.doc)
    return { cells, sections: sectionsFromCells(cells, transaction.state.doc) }
  },
})

export const notebook = (state: EditorState): Notebook => state.field(notebookField)

/** The cells' ranges, which is what every selection rule wants. */
export const cellRanges = (state: EditorState): Range[] =>
  notebook(state).cells.map((cell) => cell.range)

/** What is selected, as the core's ranges rather than CodeMirror's. */
export function selectedRanges(state: EditorState): Range[] {
  return state.selection.ranges.map((r) => ({ location: r.from, length: r.to - r.from }))
}

/**
 * A bar between two blocks is the cursor on the rendered page, and it is in no
 * block: a command that edits a block's words has nothing to edit there (the
 * Mac's `atArmedBar` — the ones that name a kind of block say so instead, see
 * `nameKind` in keys.ts). Read off the editor's own classes, so this file
 * needs to know nothing about the bar or the page.
 */
export const atBar = (view: EditorView): boolean =>
  view.dom.classList.contains("wm-armed") && view.dom.classList.contains("wm-rendered")

/** The one place a core `Edit` is applied, so undo sees it as one change. */
export function applyEdit(view: EditorView, change: {
  range: Range
  replacement: string
  selection: Range
}): void {
  if (atBar(view)) { view.focus(); return }
  const { range, replacement, selection } = change
  view.dispatch({
    changes: { from: range.location, to: range.location + range.length, insert: replacement },
    selection: { anchor: selection.location, head: selection.location + selection.length },
    scrollIntoView: true,
  })
  view.focus()
}

export const notebookState: Extension = [notebookField]
