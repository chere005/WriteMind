/**
 * CTRL+ENTER AND THE EMPTY LINE A CELL KEEPS, in the editor, both pages (Sean, 2026-10-11: "ctrl + enter adds a newline
 * without leaving the current cell.."; "this should not be two separate cells"). Port-first: the Mac has no such key yet.
 * The rules are the core's: `lineInCell` (what the key writes, cells/lineInCell.ts), `lineBreakSpan` / `emptyLineSpan` (the
 * `<br>` at the head of a line — the empty line inside a cell, and in a markdown cell or a quote the line that starts
 * afresh: markdown/emptyLine.ts, which says why it is that) and `itemLines.ts` (Return, Backspace and Delete beside a list
 * item's next lines). This file is the keys, and what keeps those lines what they are while they are edited:
 *
 * - Ctrl+Enter — Mod-Enter, the app's convention (Cmd+Enter on a Mac), and the real Ctrl+Enter on a Mac too — writes the
 *   core's line in ONE undo step of its own, the caret on the new line. CodeMirror's own Mod-Enter (`insertBlankLine`,
 *   which wrote "Alpha|\n\nBeta" as "Alpha\n|\n\nBeta": a blank line, so a second cell) never runs. Shift+Enter is not
 *   this key's (it runs a runnable cell). At a bar, over held cells, with several carets: the key does nothing.
 * - The `<br>` is drawn as nothing on both pages (decorations.ts) and the caret steps over it whole. A caret that would
 *   stand in front of it stands after it — the end of an empty line, the start of a line's words — and Left (and
 *   Shift+Left) from there goes on to the line above (`leftOffEmptyLine`). RETURN THERE IS RETURN AT THE END OF A LINE OF
 *   THE CELL (decided on the review of agent/ctrlenter): the line is the cell's, so in a text or markdown cell the cell
 *   grows under it and the next Return arms the bar, and in a list the next item comes. Return never takes away a line
 *   Ctrl+Enter made; only the line Return itself grew (nothing written on it yet) closes the cell.
 * - Typing on an empty line (a paste, a drop, a line joined onto it) makes it a line of words. In a text cell and a list item
 *   the `<br>` goes, in the same transaction (every line there is a line of its own already); in a MARKDOWN CELL and a QUOTE
 *   it stays in front of the words — it is what keeps them a line of their own when the cell is drawn (the review's P1).
 *   Taking the `<br>` away (Backspace or Delete on the line, or a selection of it deleted) takes the LINE away with its
 *   newline, as those keys take an empty line: a blank line is never left behind to split the cell in two; and Backspace
 *   at the start of a markdown cell's or a quote's line of words joins it to the line above, as at the start of any line.
 */

import { EditorSelection, EditorState, Prec, type Extension, type Line, type Transaction, type TransactionSpec } from "@codemirror/state"
import { isolateHistory } from "@codemirror/commands"
import { keymap, type Command, type EditorView } from "@codemirror/view"
import {
  EMPTY_LINE, backspaceInItem, deleteInItem, emptyLineSpan, end, firstCellFromBy, joinsLines, lineBreakSpan, lineHead, lineInCell,
  type ItemEdit,
} from "@writemind/core"
import { cellWritten, notebook } from "./notebook"
import { armedField } from "./seams"
import { holdingField } from "./preview/hold"

/** The cells whose lines can be empty lines they keep: a paragraph (a text cell or a markdown cell), a list and a quote. */
const KEEPS = new Set(["paragraph", "bullets", "dashes", "numbered", "todos", "mixed", "quote"])

/** The `<br>` at the head of a line its cell keeps it on, as offsets in the note (`lineBreakAt`). */
export interface LineBreak {
  from: number
  to: number
  /** Nothing after it: the empty line. */
  alone: boolean
  /** Its cell joins lines with a space (a markdown cell, a quote): the `<br>` is what keeps a line of words a line. */
  joins: boolean
  /** The line is its cell's first line of words: there is no line above in the cell to join to. */
  first: boolean
}

/**
 * The `<br>` at the head of `line` (a line of `state`) when its cell keeps it there: alone (an empty line) in a text cell, a
 * markdown cell, a list or a quote; with words after it in a markdown cell or a quote (a line that starts afresh), or in a
 * text cell (where it is hidden and goes when the line is typed on). Null anywhere else — a `<br>` in a code block is code.
 */
export function lineBreakAt(state: EditorState, line: Line): LineBreak | null {
  const span = lineBreakSpan(line.text)
  if (!span) return null
  const cells = notebook(state).cells
  const cell = cells[firstCellFromBy(cells, line.from + 1, (one) => one.range) - 1]
  if (!cell || !KEEPS.has(cell.block.kind) || line.from < cell.range.location || line.from > end(cell.range)) return null
  const alone = line.text.slice(span[1]).trim().length === 0
  const joins = joinsLines(cell.block)
  // (Before words, in a text cell too — come there by a change of kind, it is drawn as nothing and goes when the line is
  // typed on — but never in a list item, where WriteMind writes none.)
  if (!alone && !joins && cell.block.kind !== "paragraph") return null
  const head = cell.block.kind === "paragraph" ? cell.block.head ?? 0 : 0
  return { from: line.from + span[0], to: line.from + span[1], alone, joins, first: line.from <= cell.range.location + head }
}

/** The `<br>` of `line` (a line of `state`) when the line is an empty line its cell keeps, as offsets in the note. */
export function emptyLineAt(state: EditorState, line: Line): { from: number; to: number } | null {
  const found = lineBreakAt(state, line)
  return found && found.alone ? { from: found.from, to: found.to } : null
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

/** The line a caret at the `<br>`'s end stands on, when the caret is there (`leftOffEmptyLine`). */
function standingAfterBreak(state: EditorState, head: number): Line | null {
  // (At a bar, Left is the bar's: into the cell above, seams.ts.)
  if ((state.field(armedField, false) ?? null) !== null) return null
  const line = state.doc.lineAt(head)
  const found = lineBreakAt(state, line)
  return found && head === found.to ? line : null
}

/**
 * Left from an empty line a cell keeps — whose caret stands after its `<br>`, at the end of the line — goes on to the end of
 * the line above, as Left from the start of any line does; and from the start of the words of a line that starts afresh
 * (a markdown cell's, a quote's) the same. (The editor's own step would stop in front of the `<br>`, the same place to the
 * eye, and `caretAfterEmptyLines` would put it straight back.) An item's empty line too: the line is empty to the eye, its
 * indentation and marker no place to stand.
 */
export const leftOffEmptyLine: Command = (view) => {
  const state = view.state
  const { ranges, main } = state.selection
  if (ranges.length !== 1 || !main.empty) return false
  const line = standingAfterBreak(state, main.head)
  if (!line) return false
  if (line.from === 0) return true
  view.dispatch({ selection: EditorSelection.cursor(line.from - 1), scrollIntoView: true, userEvent: "select" })
  return true
}

/**
 * Shift+Left the same: the selection's head goes from after the `<br>` to the end of the line above, so the first press
 * takes the line break, which is what shows. (It used to take the hidden `<br>` alone: a press with nothing to see — the
 * review of agent/ctrlenter, P3.)
 */
export const selectLeftOffEmptyLine: Command = (view) => {
  const state = view.state
  const { ranges, main } = state.selection
  if (ranges.length !== 1) return false
  const line = standingAfterBreak(state, main.head)
  if (!line) return false
  if (line.from === 0) return true
  view.dispatch({ selection: EditorSelection.range(main.anchor, line.from - 1), scrollIntoView: true, userEvent: "select" })
  return true
}

// MARK: - Backspace and Delete beside a list item's next line

/** A core join applied: one change, the caret where the core says, Backspace's or Delete's own undo step. */
function joined(view: EditorView, made: ItemEdit | null, userEvent: string): boolean {
  if (!made) return false
  view.dispatch({
    changes: { from: made.from, to: made.to, insert: made.insert },
    selection: EditorSelection.cursor(made.caret),
    scrollIntoView: true,
    userEvent,
    // (Written whole by the core: an empty line it joined onto has lost its `<br>` already.)
    annotations: cellWritten.of(true),
  })
  return true
}

const caretOnly = (state: EditorState): number | null => {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return null
  if ((state.field(armedField, false) ?? null) !== null || state.field(holdingField, false)) return null
  return state.selection.main.head
}

/**
 * Backspace in the indentation of a list item's next line, or at the start of its words, joins its words to the line above
 * (core `backspaceInItem`; the review of agent/ctrlenter, P2): the editor's own Backspace took one indent unit off, and the
 * line, out from under the item, became a paragraph between two lists.
 */
export const backspaceInItemLine: Command = (view) => {
  const at = caretOnly(view.state)
  if (at === null) return false
  return joined(view, backspaceInItem(notebook(view.state).cells, view.state.doc, { location: at, length: 0 }), "delete.backward")
}

/** Delete at the end of the line above an item's next line: the same join, from above (core `deleteInItem`). */
export const deleteIntoItemLine: Command = (view) => {
  const at = caretOnly(view.state)
  if (at === null) return false
  return joined(view, deleteInItem(notebook(view.state).cells, view.state.doc, { location: at, length: 0 }), "delete.forward")
}

// MARK: - The caret stands after the `<br>`

/** A caret in front of (or inside) a kept `<br>` goes to its end: the one place on that line it stands. */
function caretAfterEmptyLines(tr: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  if (!tr.selection && !tr.docChanged) return tr
  const selection = tr.newSelection
  const doc = tr.newDoc
  let state: EditorState | null = null
  let moved = false
  const ranges = selection.ranges.map((r) => {
    if (!r.empty) return r
    const line = doc.lineAt(r.head)
    const span = lineBreakSpan(line.text)
    if (!span || r.head < line.from + span[0] || r.head >= line.from + span[1]) return r
    // (The new state, only now that it is needed: a `<br>` in a code block is code, and the caret goes where it is put; and a
    // bar that is up keeps the caret it parked, at the start of the cell under it.)
    state ??= tr.state
    if ((state.field(armedField, false) ?? null) !== null) return r
    const kept = lineBreakAt(state, line)
    if (!kept) return r
    moved = true
    return EditorSelection.cursor(kept.to)
  })
  if (!moved) return tr
  return [tr, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }] as const
}

// MARK: - Edited, it stays what it is or becomes a line of words

/** A quote line with nothing on it but its `>`: what is left when its `<br>` is taken. */
const BARE_QUOTE = /^[ \t]*>[ \t]*$/
/** A quote line's head, or a line's indentation. */
const QUOTE_OR_INDENT = /^[ \t]*(?:>[ \t]?)?/

/**
 * A kept `<br>` that an edit reached. Still at the head of its line: alone (Return at its end, an indent) — nothing to do;
 * words after it now — in a markdown cell or a quote it stays (it keeps them a line of their own), in a text cell or a list
 * item the `<br>` goes (typed, pasted on). Not at the head any more (a line joined onto it) — it goes. The `<br>` taken away
 * (Backspace on the line) — an empty line goes with its newline, the one before it for Backspace and the one after it for
 * Delete, as an empty line goes (a quote's `>` with it); a line of words in a markdown cell or a quote joins the line above,
 * as Backspace at the start of a line joins it. An item's first line kept empty (`- <br>`) taken away brings the item's
 * next line up onto it (what Ctrl+Enter at the start of its words had moved down).
 */
function keepEmptyLines(tr: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  if (!tr.docChanged || tr.annotation(cellWritten)) return tr
  if (!tr.isUserEvent("input") && !tr.isUserEvent("delete")) return tr
  const start = tr.startState
  const old = start.doc
  const kept: Array<LineBreak & { line: number }> = []
  const seen = new Set<number>()
  tr.changes.iterChangedRanges((fromA, toA) => {
    const first = old.lineAt(fromA).number
    const last = old.lineAt(toA).number
    for (let n = first; n <= last && seen.size < 2000; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = old.line(n)
      if (!line.text.includes("<")) continue
      const found = lineBreakAt(start, line)
      if (found) kept.push({ ...found, line: n })
    }
  })
  if (kept.length === 0) return tr

  const doc = tr.newDoc
  const deleting = tr.isUserEvent("delete")
  const backward = tr.isUserEvent("delete.backward")
  const changes: Array<{ from: number; to: number; insert?: string }> = []
  for (const one of kept) {
    const text = old.sliceString(one.from, one.to)
    const from = tr.changes.mapPos(one.from, 1)
    const to = tr.changes.mapPos(one.to, -1)
    if (to - from === text.length && doc.sliceString(from, to) === text) {
      const line = doc.lineAt(from)
      const span = lineBreakSpan(line.text)
      if (span && line.from + span[0] === from && (one.joins || emptyLineSpan(line.text))) continue
      // Words on its line now, in a cell whose every line is a line already — or no longer at a line's head: the `<br>` goes.
      changes.push({ from, to })
      continue
    }
    // The `<br>` went. Where its line starts now (when it still does: the newline in front of it was not taken).
    const at = tr.changes.mapPos(old.line(one.line).from, -1)
    const line = doc.lineAt(at)
    if (line.from !== at) continue
    // Taken with words — a selection typed over, or deleted, that began in front of the hidden `<br>` — in a markdown cell or
    // a quote: what is left of the line is still a line of its own, so the `<br>` goes back in front of it. (Only the key
    // that took the `<br>` ALONE, Backspace at the start of the words, means the line break.)
    let alone = false
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA === one.from && toA === one.to && inserted.length === 0) alone = true
    })
    const wasQuote = /^[ \t]*>/.test(old.line(one.line).text)
    if (!alone && one.joins && !one.first && line.text.trim().length > 0 && !lineBreakSpan(line.text)
      && wasQuote === /^[ \t]*>/.test(line.text) && !(one.alone && BARE_QUOTE.test(line.text))) {
      const head = line.from + QUOTE_OR_INDENT.exec(line.text)![0].length
      changes.push({ from: head, to: head, insert: EMPTY_LINE })
      continue
    }
    if (!deleting) continue
    // Its line goes with it, unless it is a line of the note's other words now.
    if (line.text.trim().length === 0 || (one.alone && BARE_QUOTE.test(line.text))) {
      if ((backward || line.number === doc.lines) && line.number > 1) changes.push({ from: line.from - 1, to: line.to })
      else if (line.number < doc.lines) changes.push({ from: line.from, to: line.to + 1 })
      continue
    }
    // An item's first line, its head and nothing else now: the item's next line comes up onto it.
    const head = lineHead(line.text)
    if (one.alone && head.length === line.text.length && line.number < doc.lines) {
      const next = doc.line(line.number + 1)
      const lead = /^[ \t]*/.exec(next.text)![0].length
      if (lead > 0 && lineHead(next.text).length === lead) changes.push({ from: line.to, to: next.from + lead })
      continue
    }
    // A markdown cell's or a quote's line of words whose `<br>` Backspace took (at the start of its words): it joins the line
    // above, as Backspace at the start of any line joins it — the `<br>` was what kept it a line of its own.
    if (alone && !one.alone && one.joins && backward && !one.first && line.number > 1) {
      changes.push({ from: line.from - 1, to: line.from + QUOTE_OR_INDENT.exec(line.text)![0].length })
    }
  }
  if (changes.length === 0) return tr
  changes.sort((a, b) => a.from - b.from)
  return [tr, { changes, sequential: true }] as const
}

/**
 * The keys and the lines' keeping. Registered AFTER the text cells' typing rule (textCells.ts), so that rule sees a `<br>`
 * already gone from a line typed on: filters run last-registered first.
 */
export const emptyLines: Extension = [
  EditorState.transactionFilter.of(caretAfterEmptyLines),
  EditorState.transactionFilter.of(keepEmptyLines),
  // Above CodeMirror's own Mod-Enter (insertBlankLine) and its Left.
  Prec.high(keymap.of([
    { key: "Mod-Enter", run: newlineInCell, preventDefault: true },
    { key: "Ctrl-Enter", run: newlineInCell, preventDefault: true },
    { key: "ArrowLeft", run: leftOffEmptyLine },
    { key: "Shift-ArrowLeft", run: selectLeftOffEmptyLine },
    { mac: "Alt-ArrowLeft", win: "Ctrl-ArrowLeft", linux: "Ctrl-ArrowLeft", run: leftOffEmptyLine },
    { mac: "Shift-Alt-ArrowLeft", win: "Shift-Ctrl-ArrowLeft", linux: "Shift-Ctrl-ArrowLeft", run: selectLeftOffEmptyLine },
  ])),
  // Ahead of the rendered page's Backspace and Delete and the editor's own (which takes one indent unit off).
  Prec.highest(keymap.of([
    { key: "Backspace", run: backspaceInItemLine },
    { key: "Delete", run: deleteIntoItemLine },
  ])),
]
