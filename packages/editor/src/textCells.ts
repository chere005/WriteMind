/**
 * TEXT CELLS AND MARKDOWN CELLS in the editor, both panes (docs/PLAN-text-cells.md; the rules are the core's
 * `plainText.ts` and `cells/textCells.ts`). Port-first: the Mac has no text cells yet.
 *
 * - The marker line (`<!-- markdown -->`) is HIDDEN on both pages and the caret never stands in it: it belongs to the
 *   cell under it, so Backspace at the start of that cell's words (and Delete at the end of the line above it) works
 *   as if it were not there.
 * - What is TYPED into a text cell is literal: each line the typing touched is written again by the escape rule in
 *   the same transaction (one Undo), the caret kept on the same character. A paste into a text cell is literal too.
 * - An older note's markdown cell (markdown by the older-notes rule, no marker) gets its marker when it is edited.
 * - Copy (and Cut) out of a text cell give the words, without the escapes' backslashes.
 *
 * The escapes themselves are hidden by the notebook's decorations (`decorations.ts`), each one character with what it
 * escapes for the caret.
 */

import {
  ChangeSet, EditorSelection, EditorState, MapMode, Prec, StateField, Transaction,
  type Extension, type TransactionSpec,
} from "@codemirror/state"
import { Decoration, EditorView, keymap, type Command, type DecorationSet } from "@codemirror/view"
import {
  MARKDOWN_MARKER, end, escapeLineMapped, escapeOffsets, firstCellFromBy, hiddenInText, isMarkdownMarker, isTextCell,
  positioned, type PositionedBlock,
} from "@writemind/core"
import { cellWritten, notebook } from "./notebook"
import { armSeam, armedField } from "./seams"
import { heldCells } from "./brackets"

// MARK: - The marker, hidden

const hiddenMarker = Decoration.replace({})

/** The marked cell whose marker line starts at `pos`, or null. */
function markedCellAt(cells: readonly PositionedBlock[], pos: number): PositionedBlock | null {
  const i = firstCellFromBy(cells, pos + 1, (cell) => cell.range) - 1
  const cell = i >= 0 ? cells[i] : undefined
  return cell && cell.range.location === pos && cell.block.kind === "paragraph" && cell.block.head ? cell : null
}

function markersOf(state: EditorState, cells: readonly PositionedBlock[]): DecorationSet {
  const ranges = []
  for (const cell of cells) {
    if (cell.block.kind !== "paragraph" || !cell.block.head) continue
    const line = state.doc.lineAt(cell.range.location)
    // The line and its newline: the cell's words stand where the marker was.
    const to = Math.min(line.to + 1, state.doc.length)
    if (to > line.from) ranges.push(hiddenMarker.range(line.from, to))
  }
  return Decoration.set(ranges)
}

/** The hidden markers (they cross a line break, so they come from state, not from a view plugin). */
export const markerField = StateField.define<{ cells: readonly PositionedBlock[]; set: DecorationSet }>({
  create: (state) => {
    const cells = notebook(state).cells
    return { cells, set: markersOf(state, cells) }
  },
  update(value, tr) {
    const cells = notebook(tr.state).cells
    return cells === value.cells ? value : { cells, set: markersOf(tr.state, cells) }
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.set),
    EditorView.atomicRanges.of((view) => view.state.field(field).set),
  ],
})

/** The marker lines in a state, as decorations (tests). */
export const hiddenMarkers = (state: EditorState): DecorationSet => state.field(markerField).set

// MARK: - The caret never stands in a marker

function offMarkers(tr: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  const selection = tr.selection
  if (!selection) return tr
  // A bar that is up keeps its own caret (two cells that touch: it waits at the cell's start).
  if (tr.effects.some((effect) => effect.is(armSeam) && effect.value !== null)) return tr
  if ((tr.startState.field(armedField, false) ?? null) !== null && !tr.effects.some((effect) => effect.is(armSeam))) return tr
  const doc = tr.newDoc
  const cells = notebook(tr.startState).cells
  const back = tr.docChanged ? tr.changes.invertedDesc : null
  const was = tr.startState.selection.main.head
  const wasNow = tr.docChanged ? tr.changes.mapPos(was, 1) : was
  let moved = false
  const ranges = selection.ranges.map((r) => {
    if (!r.empty) return r
    const line = doc.lineAt(r.head)
    if (line.number >= doc.lines || !isMarkdownMarker(line.text)) return r
    if (!markedCellAt(cells, back ? back.mapPos(line.from, 1) : line.from)) return r
    const words = line.to + 1
    moved = true
    // Walking back out of the cell's words goes on to the line above, not back into them.
    return EditorSelection.cursor(wasNow >= words && line.from > 0 ? line.from - 1 : words)
  })
  if (!moved) return tr
  return [tr, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }] as const
}

// MARK: - Typing in a text cell is literal

/** Blocks a line typed straight under one of them carries on, in markdown (a list's next item, a table's row). */
const CARRIED_ON = new Set(["bullets", "dashes", "todos", "numbered", "quote", "table"])

/**
 * Whether `text`, a line that is an item's marker and nothing else (`2. `, `- `, `* `), is the next item of the list
 * `above` (the cell on the line over it): a number under a numbered list, `-` or `+` under dots, `*` under dashes, either
 * under a to-do list.
 */
function continuesList(text: string, above: PositionedBlock | undefined): boolean {
  const marker = /^\s*([-+*]|\d{1,4}[.)])\s*$/.exec(text)?.[1]
  if (!marker || !above) return false
  const kind = above.block.kind
  if (/^\d/.test(marker)) return kind === "numbered"
  if (marker === "*") return kind === "dashes" || kind === "todos"
  return kind === "bullets" || kind === "todos"
}

/** The keys and the clipboard: typing, a paste, a drop, a delete — and Return (CodeMirror's newline and its indent). */
function literalEvent(tr: Transaction): boolean {
  if (tr.isUserEvent("input.type.compose")) return false
  if (tr.isUserEvent("input.type") || tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop") || tr.isUserEvent("delete")) return true
  if (tr.annotation(Transaction.userEvent) !== "input") return false
  let newline = true
  tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => { if (!/^\n[ \t]*$/.test(inserted.toString())) newline = false })
  return newline
}

function literalTyping(tr: Transaction): Transaction | TransactionSpec | readonly [Transaction, TransactionSpec] {
  if (!tr.docChanged || tr.annotation(cellWritten) || !literalEvent(tr)) return tr
  const start = tr.startState
  const cells = notebook(start).cells
  const oldDoc = start.doc
  const doc = tr.newDoc
  const paste = tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop")

  // A character typed in front of a marker (a caret the bar left at a cell's start) goes in after it, in the words.
  let count = 0
  let only: { from: number; to: number; text: string } | null = null
  tr.changes.iterChanges((fromA, toA, _fb, _tb, inserted) => { count++; only = { from: fromA, to: toA, text: inserted.toString() } })
  const lone = only as { from: number; to: number; text: string } | null
  if (count === 1 && lone && lone.from === lone.to && lone.text.length > 0) {
    const cell = markedCellAt(cells, lone.from)
    if (cell && cell.block.kind === "paragraph" && cell.block.head) {
      const at = Math.min(lone.from + cell.block.head, oldDoc.length)
      return {
        changes: { from: at, insert: lone.text },
        selection: EditorSelection.cursor(at + lone.text.length),
        userEvent: tr.annotation(Transaction.userEvent) ?? "input.type",
        scrollIntoView: true,
      }
    }
  }

  /** The cell the line above `line` is in (before the change), or undefined when that line is blank or the first. */
  const cellAbove = (line: { number: number }): PositionedBlock | undefined => {
    if (line.number < 2) return undefined
    const above = oldDoc.line(line.number - 1)
    if (above.text.trim().length === 0) return undefined
    const j = firstCellFromBy(cells, above.from + 1, (one) => one.range) - 1
    const over = j >= 0 ? cells[j] : undefined
    return over && above.from >= over.range.location && above.from <= end(over.range) ? over : undefined
  }

  /** Whether a line that began at `old` (before the change) is a text cell's: the cell it is in, or would join. */
  const textAt = (old: number): boolean => {
    const i = firstCellFromBy(cells, old + 1, (cell) => cell.range) - 1
    const cell = i >= 0 ? cells[i] : undefined
    const line = oldDoc.lineAt(Math.min(old, oldDoc.length))
    if (cell && cell.block.kind !== "blank" && old >= cell.range.location && old <= end(cell.range)) {
      // An item's marker and nothing else (`2. `, `- `: what Return in a list writes) is a paragraph to the parser,
      // so a text cell of its own; straight under an item of its list it is that list's next item, and what is typed
      // after it is the list's (`1. a`, Return, `b` is `2. b`, not `2\. b`). Only a line that is the whole cell's
      // first line: `words` then `2. ` is one text cell, and stays literal.
      if (isTextCell(cell.block) && cell.range.location === line.from && continuesList(line.text, cellAbove(line))) return false
      return isTextCell(cell.block)
    }
    // On a line of its own: it joins the cell ending on the line above, or it is a new cell — plain words, unless it
    // is a paste (markdown pasted between cells stays what it was).
    const over = cellAbove(line)
    if (over) {
      if (isTextCell(over.block)) return true
      if (CARRIED_ON.has(over.block.kind) || over.block.kind === "paragraph") return false
    }
    return !paste
  }

  const inserted: Array<[number, number]> = []
  const touched = new Set<number>()
  const olderNotes = new Set<number>()
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    if (toB > fromB) inserted.push([fromB, toB])
    const last = doc.lineAt(toB).number
    for (let n = doc.lineAt(fromB).number; n <= last && touched.size < 5000; n++) touched.add(n)
    // A markdown cell of an older note (no marker) gets its marker when it is edited.
    for (let i = Math.max(0, firstCellFromBy(cells, fromA, (cell) => cell.range) - 1); i < cells.length; i++) {
      const cell = cells[i]!
      if (cell.range.location > toA) break
      if (end(cell.range) < fromA || cell.block.kind !== "paragraph" || !cell.block.markdown || cell.block.head) continue
      const at = tr.changes.mapPos(cell.range.location, -1, MapMode.TrackDel)
      if (at !== null) olderNotes.add(at)
    }
  })
  const back = tr.changes.invertedDesc
  const isInserted = (q: number): boolean => inserted.some(([from, to]) => q >= from && q < to)
  const escapes = new Map<number, Set<number>>()
  const oldEscape = (p: number): boolean => {
    const line = oldDoc.lineAt(p)
    let set = escapes.get(line.number)
    if (!set) {
      set = new Set(escapeOffsets(line.text).map((offset) => offset + line.from))
      escapes.set(line.number, set)
    }
    return set.has(p)
  }

  interface Fix { from: number; to: number; insert: string; chars: number[]; at: number[] }
  const fixes: Fix[] = []
  for (const n of [...touched].sort((a, b) => a - b)) {
    const line = doc.line(n)
    if (line.length === 0 || isMarkdownMarker(line.text)) continue
    if (!textAt(back.mapPos(line.from, 1))) continue
    let visible = ""
    // Where each visible character is in the note now.
    const chars: number[] = []
    for (let q = line.from; q < line.to; q++) {
      if (!isInserted(q) && oldEscape(back.mapPos(q, 1))) continue
      visible += line.text[q - line.from]
      chars.push(q)
    }
    const made = escapeLineMapped(visible)
    if (made.text === line.text) continue
    fixes.push({ from: line.from, to: line.to, insert: made.text, chars, at: made.at })
  }
  if (fixes.length === 0 && olderNotes.size === 0) return tr

  const changes = [
    ...[...olderNotes].map((at) => ({ from: at, to: at, insert: MARKDOWN_MARKER + "\n" })),
    ...fixes.map((fix) => ({ from: fix.from, to: fix.to, insert: fix.insert })),
  ].sort((a, b) => a.from - b.from || (a.to - a.from) - (b.to - b.from))
  const set = ChangeSet.of(changes, doc.length)
  const point = (p: number): number => {
    const fix = fixes.find((one) => p >= one.from && p <= one.to)
    if (!fix) return set.mapPos(p, 1)
    let v = 0
    while (v < fix.chars.length && fix.chars[v]! < p) v++
    return set.mapPos(fix.from, -1) + fix.at[v]!
  }
  const now = tr.newSelection
  const selection = EditorSelection.create(
    now.ranges.map((r) => EditorSelection.range(point(r.anchor), point(r.head))), now.mainIndex)
  return [tr, { changes, selection, sequential: true }] as const
}

// MARK: - A marker keeps to its words

/** Whether `text` (a marker line and the lines after it) reads as a markdown cell with words under its marker. */
function markerHasWords(text: string): boolean {
  const first = positioned(text)[0]
  return first !== undefined && first.block.kind === "paragraph" && !!first.block.head && first.block.text.trim().length > 0
}

/**
 * A markdown cell's marker goes where its words go. Typing a block's markup at the start of the words (`# `, `- `,
 * `> `, ```` ``` ````) makes them a heading, a list, a quote or a fence: the marker has nothing left to mark and goes
 * (in the same transaction, so one Undo takes both back). Return at the start of the words moves them down a line: the
 * marker goes down with them. (A cell emptied of its words keeps its marker, to be typed into again.)
 */
function keepMarkers(tr: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  if (!tr.docChanged || tr.annotation(cellWritten)) return tr
  if (!tr.isUserEvent("input") && !tr.isUserEvent("delete")) return tr
  const cells = notebook(tr.startState).cells
  const marked = new Set<PositionedBlock>()
  tr.changes.iterChangedRanges((fromA, toA) => {
    for (let i = Math.max(0, firstCellFromBy(cells, fromA, (cell) => cell.range) - 1); i < cells.length; i++) {
      const cell = cells[i]!
      if (cell.range.location > toA + 1) break
      if (end(cell.range) + 1 < fromA || cell.block.kind !== "paragraph" || !cell.block.head) continue
      marked.add(cell)
    }
  })
  if (marked.size === 0) return tr
  const doc = tr.newDoc
  const changes: Array<{ from: number; to: number; insert?: string }> = []
  const linesFrom = (number: number): string => doc.sliceString(doc.line(number).from, doc.line(Math.min(doc.lines, number + 3)).to)
  for (const cell of marked) {
    if (cell.block.kind !== "paragraph" || !cell.block.head) continue
    const at = tr.changes.mapPos(cell.range.location, 1, MapMode.TrackDel)
    if (at === null) continue
    const line = doc.lineAt(at)
    if (line.from !== at || !isMarkdownMarker(line.text) || markerHasWords(linesFrom(line.number))) continue
    const lineEnd = line.number < doc.lines ? line.to + 1 : line.to
    // Return at the start of the words: they stand lower now, under blank lines; the marker goes down to them.
    const words = tr.changes.mapPos(cell.range.location + cell.block.head, 1)
    const wordsLine = doc.lineAt(Math.min(words, doc.length))
    if (wordsLine.number > line.number + 1 && wordsLine.from === words) {
      let blank = true
      for (let n = line.number + 1; n < wordsLine.number; n++) if (doc.line(n).text.trim().length > 0) blank = false
      if (blank && markerHasWords(MARKDOWN_MARKER + "\n" + linesFrom(wordsLine.number))) {
        changes.push({ from: line.from, to: lineEnd }, { from: wordsLine.from, to: wordsLine.from, insert: MARKDOWN_MARKER + "\n" })
        continue
      }
    }
    // The words are a block of another kind now (or went to the cell above): the marker goes.
    if (line.number < doc.lines && doc.line(line.number + 1).text.trim().length > 0) changes.push({ from: line.from, to: lineEnd })
  }
  if (changes.length === 0) return tr
  changes.sort((a, b) => a.from - b.from)
  const set = ChangeSet.of(changes, doc.length)
  return [tr, { changes, selection: tr.newSelection.map(set, 1), sequential: true }] as const
}

// MARK: - Backspace and Delete beside a marker

const barUp = (state: EditorState): boolean => (state.field(armedField, false) ?? null) !== null

/** Backspace at the start of a markdown cell's words: what it would do with no marker there (the marker stays with them). */
const backspaceAtMarker: Command = (view) => {
  const { state } = view
  const main = state.selection.main
  if (barUp(state) || state.selection.ranges.length !== 1 || !main.empty) return false
  const doc = state.doc
  const line = doc.lineAt(main.head)
  if (main.head !== line.from || line.number < 2) return false
  const marker = doc.line(line.number - 1)
  if (!isMarkdownMarker(marker.text) || !markedCellAt(notebook(state).cells, marker.from)) return false
  if (marker.number < 2) return true
  const before = doc.line(marker.number - 1)
  if (before.text.trim().length === 0) {
    // A blank line above: it goes, and the cell (marker and all) moves up to the cell above.
    view.dispatch({
      changes: { from: before.from, to: marker.from },
      selection: EditorSelection.cursor(main.head - (marker.from - before.from)),
      userEvent: "delete.backward", scrollIntoView: true,
    })
  } else {
    // Touching the cell above: the words join its last line, and the marker goes with the line break.
    view.dispatch({
      changes: { from: before.to, to: line.from },
      selection: EditorSelection.cursor(before.to),
      userEvent: "delete.backward", scrollIntoView: true,
    })
  }
  return true
}

/** Delete at the end of a line a marked cell touches: the cell's words join this line, the marker going with them. */
const deleteBeforeMarker: Command = (view) => {
  const { state } = view
  const main = state.selection.main
  if (barUp(state) || state.selection.ranges.length !== 1 || !main.empty) return false
  const doc = state.doc
  const line = doc.lineAt(main.head)
  if (main.head !== line.to || line.number >= doc.lines || line.text.trim().length === 0) return false
  const next = doc.line(line.number + 1)
  if (!isMarkdownMarker(next.text) || !markedCellAt(notebook(state).cells, next.from)) return false
  view.dispatch({
    changes: { from: line.to, to: next.number < doc.lines ? next.to + 1 : next.to },
    selection: EditorSelection.cursor(line.to),
    userEvent: "delete.forward", scrollIntoView: true,
  })
  return true
}

// MARK: - Copy gives the words

/** The selection's text with a text cell's escapes left out, or null when it holds none (the editor's own copy). */
export function plainSelection(state: EditorState): string | null {
  const cells = notebook(state).cells
  let changed = false
  const parts = state.selection.ranges.filter((r) => !r.empty).map((r) => {
    let out = ""
    let pos = r.from
    while (pos < r.to) {
      const line = state.doc.lineAt(pos)
      const stop = Math.min(line.to, r.to)
      const i = firstCellFromBy(cells, line.from + 1, (cell) => cell.range) - 1
      const cell = i >= 0 ? cells[i] : undefined
      const plain = cell !== undefined && isTextCell(cell.block) && line.from >= cell.range.location && line.from <= end(cell.range)
      // (A text cell's escapes' backslashes, and Link Here's id anchors, are not its words.)
      const skip = plain ? new Set(hiddenInText(line.text).flatMap(([from, to]) =>
        Array.from({ length: to - from }, (_v, k) => line.from + from + k))) : null
      for (let q = pos; q < stop; q++) {
        if (skip?.has(q)) { changed = true; continue }
        out += line.text[q - line.from]
      }
      if (stop < r.to) out += "\n"
      pos = line.to + 1
    }
    return out
  })
  return changed ? parts.join("\n") : null
}

function copyPlain(event: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  if (!event.clipboardData || view.state.selection.ranges.every((r) => r.empty)) return false
  // Held cells are copied whole, as markdown (keys.ts).
  if (heldCells(view).length > 0) return false
  const words = plainSelection(view.state)
  if (words === null) return false
  event.clipboardData.setData("text/plain", words)
  event.preventDefault()
  if (cut) view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut", scrollIntoView: true })
  return true
}

export const textCells: Extension = [
  markerField,
  // (Filters run last-registered first: this one sees what the one under it made.)
  EditorState.transactionFilter.of(keepMarkers),
  EditorState.transactionFilter.of((tr) => {
    const typed = literalTyping(tr)
    return typed === tr ? offMarkers(tr) : typed
  }),
  Prec.highest(keymap.of([
    { key: "Backspace", run: backspaceAtMarker },
    { key: "Delete", run: deleteBeforeMarker },
  ])),
  EditorView.domEventHandlers({
    copy: (event, view) => copyPlain(event, view, false),
    cut: (event, view) => copyPlain(event, view, true),
  }),
]
