/**
 * The notebook the editor is looking at: the cells, and the sections that
 * group them. One state field, recomputed only when the document changes,
 * because everything else — the brackets, the seams, the decorations, the
 * fold — is drawn FROM it and none of them may parse the note again.
 *
 * This is the CodeMirror half of what `MarkdownTextView.refreshBrackets`
 * did on the Mac: the model is the same, the measuring is not.
 */

import { StateField, type EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import {
  positioned, sections, type PositionedBlock, type Range, type Section,
} from "@writemind/core"

export interface Notebook {
  cells: PositionedBlock[]
  sections: Section[]
}

export const notebookField = StateField.define<Notebook>({
  create(state) {
    const text = state.doc.toString()
    return { cells: positioned(text), sections: sections(text) }
  },
  update(value, transaction) {
    if (!transaction.docChanged) return value
    const text = transaction.state.doc.toString()
    return { cells: positioned(text), sections: sections(text) }
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

/** The one place a core `Edit` is applied, so undo sees it as one change. */
export function applyEdit(view: EditorView, change: {
  range: Range
  replacement: string
  selection: Range
}): void {
  const { range, replacement, selection } = change
  view.dispatch({
    changes: { from: range.location, to: range.location + range.length, insert: replacement },
    selection: { anchor: selection.location, head: selection.location + selection.length },
    scrollIntoView: true,
  })
  view.focus()
}

export const notebookState: Extension = [notebookField]
