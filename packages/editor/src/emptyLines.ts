/**
 * CTRL+ENTER AND THE EMPTY LINE A CELL KEEPS, in the editor, both pages (Sean, 2026-10-11: "ctrl + enter adds a newline
 * without leaving the current cell.."; "this should not be two separate cells"). Port-first: the Mac has no such key yet.
 * The rules are the core's: `lineInCell` (what the key writes, cells/lineInCell.ts) and `emptyLineSpan` (the `<br>` an
 * empty line inside a cell holds, markdown/emptyLine.ts, which says why it is that). This file is the key, and what keeps
 * that line an empty line while it is edited:
 *
 * - Ctrl+Enter — Mod-Enter, the app's convention (Cmd+Enter on a Mac), and the real Ctrl+Enter on a Mac too — writes the
 *   core's line in ONE undo step of its own, the caret on the new line. CodeMirror's own Mod-Enter (`insertBlankLine`,
 *   which wrote "Alpha|\n\nBeta" as "Alpha\n|\n\nBeta": a blank line, so a second cell) never runs. Shift+Enter is not
 *   this key's (it runs a runnable cell). At a bar, over held cells, with several carets: the key does nothing.
 * - The `<br>` is drawn as nothing on both pages (decorations.ts) and the caret steps over it whole. A caret that would
 *   stand in front of it stands after it — the end of the line — so Return there is Return at the end of an empty line
 *   (the cell grows, the next Return arms the bar), and Left from it goes on to the line above (`leftOffEmptyLine`).
 * - Typing on the line (a paste, a drop, a line joined onto it by Delete or Backspace) makes it a line of words: the
 *   `<br>` goes, in the same transaction. Taking the `<br>` away (Backspace or Delete on the line, or a selection of it
 *   deleted) takes the LINE away with its newline, as those keys take an empty line: a blank line is never left behind
 *   to split the cell in two.
 */

import { EditorSelection, EditorState, Prec, type Extension, type Line, type Transaction, type TransactionSpec } from "@codemirror/state"
import { isolateHistory } from "@codemirror/commands"
import { keymap, type Command } from "@codemirror/view"
import { emptyLineSpan, end, firstCellFromBy, lineHead, lineInCell } from "@writemind/core"
import { cellWritten, notebook } from "./notebook"
import { armedField } from "./seams"
import { holdingField } from "./preview/hold"

/** The cells whose lines can be empty lines they keep: a paragraph (a text cell or a markdown cell) and a list. */
const KEEPS = new Set(["paragraph", "bullets", "dashes", "numbered", "todos"])

/** The `<br>` of `line` (a line of `state`) when the line is an empty line its cell keeps, as offsets in the note. */
export function emptyLineAt(state: EditorState, line: Line): { from: number; to: number } | null {
  const span = emptyLineSpan(line.text)
  if (!span) return null
  const cells = notebook(state).cells
  const cell = cells[firstCellFromBy(cells, line.from + 1, (one) => one.range) - 1]
  if (!cell || !KEEPS.has(cell.block.kind) || line.from < cell.range.location || line.from > end(cell.range)) return null
  return { from: line.from + span[0], to: line.from + span[1] }
}

// MARK: - The key

/** Ctrl+Enter: a new line where the caret is, in the cell it is in (core `lineInCell`). */
export const newlineInCell: Command = (view) => {
  const state = view.state
  if (state.readOnly) return false
  // There is no cell to stay in at a bar, and nothing is typed over held cells: the key is this one's, and does nothing.
  if ((state.field(armedField, false) ?? null) !== null || state.field(holdingField, false)) return true
  if (state.selection.ranges.length !== 1) return true
  const main = state.selection.main
  // (A selection that holds a whole cell holds it: keys.ts's held cells.)
  if (!main.empty && notebook(state).cells.some((cell) => cell.range.length > 0 && main.from <= cell.range.location && main.to >= end(cell.range))) return true
  const made = lineInCell(notebook(state).cells, state.doc, { location: main.from, length: main.to - main.from })
  if (made.kind === "none") return true
  view.dispatch({
    changes: { from: made.from, to: made.to, insert: made.insert },
    selection: EditorSelection.cursor(made.caret),
    scrollIntoView: true,
    userEvent: "input",
    // Written whole by the core's rules (a text cell's words already escaped: textCells.ts leaves it as it is); ONE undo step
    // however soon the next key comes.
    annotations: [cellWritten.of(true), isolateHistory.of("full")],
  })
  return true
}

/**
 * Left from an empty line a cell keeps — whose caret stands after its `<br>`, at the end of the line — goes on to the end of
 * the line above, as Left from the start of any line does. (The editor's own step would stop in front of the `<br>`, the
 * same place to the eye, and `caretAfterEmptyLines` would put it straight back.) An item's empty line too: the line is
 * empty to the eye, its indentation and marker no place to stand.
 */
export const leftOffEmptyLine: Command = (view) => {
  const state = view.state
  const { ranges, main } = state.selection
  // (At a bar, Left is the bar's: into the cell above, seams.ts.)
  if (ranges.length !== 1 || !main.empty || (state.field(armedField, false) ?? null) !== null) return false
  const line = state.doc.lineAt(main.head)
  const kept = emptyLineAt(state, line)
  if (!kept || main.head !== kept.to) return false
  if (line.from === 0) return true
  view.dispatch({ selection: EditorSelection.cursor(line.from - 1), scrollIntoView: true, userEvent: "select" })
  return true
}

// MARK: - The caret stands after the `<br>`

/** A caret in front of (or inside) the `<br>` of an empty line kept goes to its end: the one place on that line it stands. */
function caretAfterEmptyLines(tr: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  if (!tr.selection && !tr.docChanged) return tr
  const selection = tr.newSelection
  const doc = tr.newDoc
  let state: EditorState | null = null
  let moved = false
  const ranges = selection.ranges.map((r) => {
    if (!r.empty) return r
    const line = doc.lineAt(r.head)
    const span = emptyLineSpan(line.text)
    if (!span || r.head < line.from + span[0] || r.head >= line.from + span[1]) return r
    // (The new state, only now that it is needed: a `<br>` in a code block is code, and the caret goes where it is put; and a
    // bar that is up keeps the caret it parked, at the start of the cell under it.)
    state ??= tr.state
    if ((state.field(armedField, false) ?? null) !== null) return r
    const kept = emptyLineAt(state, line)
    if (!kept) return r
    moved = true
    return EditorSelection.cursor(kept.to)
  })
  if (!moved) return tr
  return [tr, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }] as const
}

// MARK: - Edited, it stays an empty line or becomes a line of words

/**
 * An empty line kept that an edit reached: still `<br>` alone (Return at its end, an indent) — nothing to do; words on it
 * now (typed, pasted, a line joined onto it) — the `<br>` goes; the `<br>` taken away (Backspace on the line) — the line
 * goes with its newline, the one before it for Backspace and the one after it for Delete, as an empty line goes. An item's
 * first line kept empty (`- <br>`) taken away brings the item's next line up onto it (what Ctrl+Enter at the start of its
 * words had moved down).
 */
function keepEmptyLines(tr: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  if (!tr.docChanged || tr.annotation(cellWritten)) return tr
  if (!tr.isUserEvent("input") && !tr.isUserEvent("delete")) return tr
  const start = tr.startState
  const old = start.doc
  const kept: Array<{ from: number; to: number; line: number }> = []
  const seen = new Set<number>()
  tr.changes.iterChangedRanges((fromA, toA) => {
    const first = old.lineAt(fromA).number
    const last = old.lineAt(toA).number
    for (let n = first; n <= last && seen.size < 2000; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = old.line(n)
      if (!line.text.includes("<")) continue
      const span = emptyLineAt(start, line)
      if (span) kept.push({ ...span, line: n })
    }
  })
  if (kept.length === 0) return tr

  const doc = tr.newDoc
  const deleting = tr.isUserEvent("delete")
  const backward = tr.isUserEvent("delete.backward")
  const changes: Array<{ from: number; to: number }> = []
  for (const one of kept) {
    const text = old.sliceString(one.from, one.to)
    const from = tr.changes.mapPos(one.from, 1)
    const to = tr.changes.mapPos(one.to, -1)
    if (to - from === text.length && doc.sliceString(from, to) === text) {
      const line = doc.lineAt(from)
      const span = emptyLineSpan(line.text)
      if (span && line.from + span[0] === from) continue
      // Words on its line now: the `<br>` goes.
      changes.push({ from, to })
      continue
    }
    if (!deleting) continue
    // The `<br>` went: so does its line, unless it is a line of the note's other words now.
    const at = tr.changes.mapPos(old.line(one.line).from, -1)
    const line = doc.lineAt(at)
    if (line.from !== at) continue
    if (line.text.trim().length === 0) {
      if ((backward || line.number === doc.lines) && line.number > 1) changes.push({ from: line.from - 1, to: line.to })
      else if (line.number < doc.lines) changes.push({ from: line.from, to: line.to + 1 })
      continue
    }
    // An item's first line, its head and nothing else now: the item's next line comes up onto it.
    const head = lineHead(line.text)
    if (head.length === line.text.length && line.number < doc.lines) {
      const next = doc.line(line.number + 1)
      const lead = /^[ \t]*/.exec(next.text)![0].length
      if (lead > 0 && lineHead(next.text).length === lead) changes.push({ from: line.to, to: next.from + lead })
    }
  }
  if (changes.length === 0) return tr
  changes.sort((a, b) => a.from - b.from)
  return [tr, { changes, sequential: true }] as const
}

/**
 * The key and the empty line's keeping. Registered AFTER the text cells' typing rule (textCells.ts), so that rule sees a
 * `<br>` already gone from a line typed on: filters run last-registered first.
 */
export const emptyLines: Extension = [
  EditorState.transactionFilter.of(caretAfterEmptyLines),
  EditorState.transactionFilter.of(keepEmptyLines),
  // Above CodeMirror's own Mod-Enter (insertBlankLine) and its Left.
  Prec.high(keymap.of([
    { key: "Mod-Enter", run: newlineInCell, preventDefault: true },
    { key: "Ctrl-Enter", run: newlineInCell, preventDefault: true },
    { key: "ArrowLeft", run: leftOffEmptyLine },
    { mac: "Alt-ArrowLeft", win: "Ctrl-ArrowLeft", linux: "Ctrl-ArrowLeft", run: leftOffEmptyLine },
  ])),
]
