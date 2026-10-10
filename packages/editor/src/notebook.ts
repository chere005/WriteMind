/**
 * The notebook the editor is looking at: the cells, and the sections that
 * group them. One state field, recomputed only when the document changes,
 * because everything else — the brackets, the seams, the decorations, the
 * fold — is drawn FROM it and none of them may parse the note again.
 *
 * This is the CodeMirror half of what `MarkdownTextView.refreshBrackets`
 * did on the Mac: the model is the same, the measuring is not.
 */

import { Annotation, StateEffect, StateField, type ChangeSet, type EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { isolateHistory } from "@codemirror/commands"
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

/**
 * A change that WRITES a cell whole (the bar opening one of a kind, with what was typed already written by the core's
 * rules): the text-cell typing rule (`textCells.ts`) leaves it as it is.
 */
export const cellWritten = Annotation.define<boolean>()

/**
 * AN ITEM THE APP OPENED, not one that was typed. A list made by a command (the + menu, the Style menu, Ctrl+Shift+L at
 * a bar) is written as its marker and nothing else (`- `, `1. `), which the parser reads as a paragraph, so a text cell
 * of its own, and what is typed in a text cell is literal: the first word typed after the marker came out as `\- word`
 * (docs/PLAN-bars-2026-10.md (a), found 2026-10-10). The command says which line it opened (`itemOpened`), and the next
 * thing typed at the end of that line is the list's: the field is the start of that line, mapped through edits, and
 * is let go by any edit and by the caret leaving the line.
 */
export const itemOpened = StateEffect.define<number>()

export const itemOpenedField = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(itemOpened)) return effect.value
    if (value === null) return null
    // (An edit puts it away: the character typed after the marker is read by the rule in the same transaction, from the
    // state BEFORE it, so the marker is still the open item then.)
    if (transaction.docChanged) return null
    if (!transaction.selection) return value
    const head = transaction.state.selection.main
    return head.empty && transaction.state.doc.lineAt(head.head).from === value ? value : null
  },
})

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

/**
 * The one place a core `Edit` is applied, so undo sees it as one change. `apart`: its own undo step, never joined to
 * the edit before or after it however quickly they come (Ctrl+7 then Ctrl+Shift+7: one Ctrl+Z undoes each).
 */
export function applyEdit(view: EditorView, change: {
  range: Range
  replacement: string
  selection: Range
}, apart = false): void {
  if (atBar(view)) { view.focus(); return }
  const { range, replacement, selection } = change
  view.dispatch({
    changes: { from: range.location, to: range.location + range.length, insert: replacement },
    selection: { anchor: selection.location, head: selection.location + selection.length },
    scrollIntoView: true,
    ...(apart ? { annotations: isolateHistory.of("full") } : {}),
  })
  view.focus()
}

export const notebookState: Extension = [notebookField, itemOpenedField]
