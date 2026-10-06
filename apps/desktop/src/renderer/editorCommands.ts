/**
 * The editor's commands by name, for the menu bar and the toolbar. Each one
 * is a call into the core (or the editor package) that the keyboard shortcut
 * makes too: this table exists so a click on a menu item and a press of the
 * key are the same function and cannot drift.
 *
 * Cell commands act on the cells held by their brackets, and on the cell the
 * caret is in when none is held — the Mac's `EditorBridge.selectedCells`.
 */

import type { EditorView } from "@codemirror/view"
import {
  BOLD, ITALIC, STRIKE, UNDERLINE_CLOSE, UNDERLINE_OPEN, HEADING_LADDER, blockContaining,
  deleteCell, duplicateCell, editsOver, expand, fenceOf, mergeCells, moveCell, moveSection,
  splitCell, subsections, subsectionsFolding,
  type CodeLanguage, type Edit, type Heading, type ListStyle, type Range,
} from "@writemind/core"
import {
  applyEdit, evaluationCell, fence, foldAll, foldedKeys, heading, heldCells, indentLines, list, markdownCell, outdentLines, quote,
  sectionAtCaret, selectAllOccurrences, selectNext, tagFence, toggleFold, unfoldAll, wrap,
} from "@writemind/editor"
import { EditorSelection } from "@codemirror/state"

export interface EditorOptions {
  listStyle: ListStyle
  codeLanguage: CodeLanguage
}

const selection = (view: EditorView): Range => {
  const main = view.state.selection.main
  return { location: main.from, length: main.to - main.from }
}

/** The cells a whole-cell command takes: the held ones, else the caret's own. */
function cellsToAct(view: EditorView): Range[] {
  const held = view.state.selection.ranges.some((r) => !r.empty) ? heldCells(view) : []
  if (held.length > 0) return held
  const own = blockContaining(view.state.selection.main.head, view.state.doc.toString())
  return own ? [own.range] : []
}

/** Several edits as one transaction (back to front, as `editsOver` returns them). */
function applyEdits(view: EditorView, edits: Edit[]): boolean {
  if (edits.length === 0) return false
  const ascending = [...edits].sort((a, b) => a.range.location - b.range.location)
  let shift = 0
  const ranges = ascending.map((edit) => {
    const at = edit.selection.location + shift
    shift += edit.replacement.length - edit.range.length
    return EditorSelection.range(at, at + edit.selection.length)
  })
  view.dispatch({
    changes: edits.map((edit) => ({
      from: edit.range.location, to: edit.range.location + edit.range.length, insert: edit.replacement,
    })),
    selection: EditorSelection.create(ranges),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

const onCells = (view: EditorView, make: (span: Range, text: string) => Edit | null): boolean =>
  applyEdits(view, editsOver(cellsToAct(view), view.state.doc.toString(), make))

const edit = (view: EditorView, make: (text: string, where: Range) => Edit | null): boolean => {
  const change = make(view.state.doc.toString(), selection(view))
  if (!change) return false
  applyEdit(view, change)
  return true
}

/** One step wider: the word, the cell, the section, the note. */
export function expandSelection(view: EditorView): boolean {
  const wider = expand(selection(view), view.state.doc.toString())
  if (!wider) return false
  view.dispatch({
    selection: EditorSelection.range(wider.location, wider.location + wider.length),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

/** The commands a name can run. Returns whether the id was one of them. */
export function runEditorCommand(view: EditorView, id: string, options: EditorOptions): boolean {
  if (id.startsWith("heading:")) {
    const level = Number(id.slice("heading:".length)) as Heading
    if (!HEADING_LADDER.includes(level)) return false
    heading(level)(view)
    return true
  }
  switch (id) {
    case "bold": wrap(BOLD)(view); return true
    case "italic": wrap(ITALIC)(view); return true
    case "underline": wrap(UNDERLINE_OPEN, UNDERLINE_CLOSE)(view); return true
    case "strike": wrap(STRIKE)(view); return true
    case "markdownCell": markdownCell(view); return true
    case "list": list(options.listStyle)(view); return true
    case "quote": quote(view); return true
    case "outdent": outdentLines(view); return true
    case "indent": indentLines(view); return true
    case "codeBlock":
      if (options.codeLanguage === "plain") fence(view)
      else tagFence(fenceOf(options.codeLanguage))(view)
      return true
    case "splitCell": edit(view, (text, where) => splitCell(text, where)); return true
    case "mergeCells": edit(view, (text, where) => mergeCells(text, where)); return true
    case "duplicateCell": onCells(view, (span, text) => duplicateCell(span, text)); return true
    case "evaluationCell": evaluationCell(view); return true
    case "deleteCell": onCells(view, (span, text) => deleteCell(span, text)); return true
    case "moveCellUp": onCells(view, (span, text) => moveCell(span, true, text)); return true
    case "moveCellDown": onCells(view, (span, text) => moveCell(span, false, text)); return true
    case "moveSectionUp": edit(view, (text, where) => moveSection(text, where, true)); return true
    case "moveSectionDown": edit(view, (text, where) => moveSection(text, where, false)); return true
    case "selectNext": selectNext(view); return true
    case "selectAll": selectAllOccurrences(view); return true
    case "expandSelection": expandSelection(view); return true
    case "foldSection": {
      const section = sectionAtCaret(view.state)
      if (section) toggleFold(view, section.key, true)
      return true
    }
    case "unfoldSection": {
      const section = sectionAtCaret(view.state)
      if (section) toggleFold(view, section.key, false)
      return true
    }
    // Ctrl+; (the Mac's ⌘;): fold what is under the held cells (or the caret's), never the cells themselves;
    // all of it folded already → open it again.
    case "collapseSubsections": {
      const keys = subsections(cellsToAct(view), view.state.doc.toString())
      if (keys.length === 0) return true
      const fold = subsectionsFolding(keys, new Set(foldedKeys(view.state)))
      for (const key of keys) toggleFold(view, key, fold)
      return true
    }
    case "foldAll": foldAll(view); return true
    case "unfoldAll": unfoldAll(view); return true
    default: return false
  }
}

