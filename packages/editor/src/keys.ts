/**
 * The keys, and the one place a formatting command is declared.
 *
 * Every one of them is a call into the core and nothing else: the same
 * function the Mac's Format menu runs, handed the same text and the same
 * selection. A key that had its own idea of what bold means would be a
 * second answer to a question that already has one.
 */

import { insertNewlineAndIndent } from "@codemirror/commands"
import { EditorSelection, Facet } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView, keymap, type Command } from "@codemirror/view"
import {
  BOLD, ITALIC, STRIKE, UNDERLINE_CLOSE, UNDERLINE_OPEN, copyCell, deleteCell, duplicateCell,
  editsOver, movingCells, pasteCell,
  caretLine, codeBlock, indent, listContinuation, mergeCells, moveSection, outdent,
  outdentForBackspace, setHeading, splitCell, substring, toggleList, toggleQuote, toggleWrap,
  kindForHeading, type CellKind, type Edit, type Heading, type ListStyle, type Range,
} from "@writemind/core"
import { heldCells } from "./brackets"
import { codeTypingKeys } from "./codeTyping"
import { extraKeys } from "./extras"
import { setHolding } from "./preview/hold"
import { applyEdit, atBar, notebookField } from "./notebook"
import { setArmedType } from "./seams"
import { backspaceMayOutdent } from "./windowed"

const selection = (view: EditorView): Range => {
  const main = view.state.selection.main
  return { location: main.from, length: main.to - main.from }
}

const run = (make: (text: string, where: Range) => Edit | null): Command => (view) => {
  const change = make(view.state.doc.toString(), selection(view))
  if (!change) return false
  applyEdit(view, change)
  return true
}

export const wrap = (open: string, close = open): Command =>
  run((text, where) => toggleWrap(text, where, open, close))

/**
 * At a bar on the rendered page a command that makes a KIND of block names it
 * instead (Cmd-1 there means what Title on the + means): the next thing typed
 * opens a block of that kind and nothing is written until it is.
 */
export const nameKind = (kind: CellKind, command: Command): Command => (view) => {
  if (!atBar(view)) return command(view)
  view.dispatch({ effects: setArmedType.of(kind) })
  // A button on the bar has the keyboard; what is typed next goes to the bar, so the page takes it back.
  view.focus()
  return true
}

export const heading = (level: Heading): Command =>
  nameKind(kindForHeading(level), run((text, where) => setHeading(text, where, level)))

export const list = (style: ListStyle): Command =>
  nameKind({ kind: "list", style }, run((text, where) => toggleList(text, where, style)))

/**
 * The style Format ▸ List writes: the one the chevron beside the list button
 * picked (the Mac's bulletStyle, which ⇧⌘L reads too). The app gives
 * the editor a function so the key always asks the CURRENT choice.
 */
export const listStyleSource = Facet.define<() => ListStyle, () => ListStyle>({
  combine: (sources) => sources[0] ?? (() => "dots"),
})

/** The list key: the chevron's style, read at the moment of the press. */
const chosenList: Command = (view) => list(view.state.facet(listStyleSource)())(view)

export const quote: Command = nameKind({ kind: "quote" }, run((text, where) => toggleQuote(text, where)))
export const fence: Command = nameKind({ kind: "code" }, run((text, where) => codeBlock(text, where)))
export const indentLines: Command = run((text, where) => indent(text, where))
export const outdentLines: Command = run((text, where) => outdent(text, where))
export const splitTheCell: Command = run((text, where) => splitCell(text, where))
export const mergeTheCell: Command = run((text, where) => mergeCells(text, where))
export const moveUp: Command = run((text, where) => moveSection(text, where, true))
export const moveDown: Command = run((text, where) => moveSection(text, where, false))

/** Backspace inside a line's prefix takes a level off; anywhere else it is a backspace. */
const backspaceOutdents: Command = (view) => {
  const where = selection(view)
  if (where.length !== 0 || !backspaceMayOutdent(view.state, where.location)) return false
  const change = outdentForBackspace(view.state.doc.toString(), where)
  if (!change) return false
  applyEdit(view, change)
  return true
}

/** Return at the end of a list item carries the list on. */
const carryTheListOn: Command = (view) => {
  const main = view.state.selection.main
  if (!main.empty) return false
  // The line the caret is in, from the document's own lines (not a string made of the whole note for every Return).
  const line = view.state.doc.lineAt(main.from)
  const body = line.text
  if (main.from !== line.from + body.length) return false
  const next = listContinuation(body)
  if (next === null) return false
  if (next === "") {
    // An empty item: Return ends the list rather than adding to it.
    applyEdit(view, {
      range: { location: line.from, length: body.length },
      replacement: "",
      selection: { location: line.from, length: 0 },
    })
    return true
  }
  applyEdit(view, {
    range: { location: main.from, length: 0 },
    replacement: "\n" + next,
    selection: { location: main.from + 1 + next.length, length: 0 },
  })
  return true
}

/**
 * EVERY FORMATTING SHORTCUT IS DECLARED HERE, once — the Mac learned that
 * the hard way, where a key attached to a toolbar button stopped working
 * the moment its section was collapsed.
 */
const baseKeys: Extension = keymap.of([
  { key: "Mod-b", run: wrap(BOLD), preventDefault: true },
  { key: "Mod-i", run: wrap(ITALIC), preventDefault: true },
  { key: "Mod-u", run: wrap(UNDERLINE_OPEN, UNDERLINE_CLOSE), preventDefault: true },
  { key: "Shift-Mod-x", run: wrap(STRIKE), preventDefault: true },
  { key: "Shift-Mod-l", run: chosenList, preventDefault: true },
  { key: "Ctrl-Mod-q", run: quote, preventDefault: true },
  { key: "Mod-1", run: heading(1) },
  { key: "Mod-2", run: heading(2) },
  { key: "Mod-3", run: heading(6) },
  { key: "Mod-4", run: heading(3) },
  { key: "Mod-5", run: heading(4) },
  { key: "Mod-6", run: heading(5) },
  { key: "Mod-7", run: heading(0) },
  { key: "Mod-8", run: fence },
  { key: "Mod-]", run: indentLines, preventDefault: true },
  { key: "Mod-[", run: outdentLines, preventDefault: true },
  { key: "Tab", run: indentLines, shift: outdentLines, preventDefault: true },
  { key: "Backspace", run: backspaceOutdents },
  { key: "Ctrl-d", run: splitTheCell, preventDefault: true },
  { key: "Ctrl-m", run: mergeTheCell, preventDefault: true },
  { key: "Ctrl-Mod-ArrowUp", run: moveUp, preventDefault: true },
  { key: "Ctrl-Mod-ArrowDown", run: moveDown, preventDefault: true },
  { key: "Enter", run: carryTheListOn },
  { key: "Enter", run: insertNewlineAndIndent },
])

// MARK: - Whole cells

/**
 * A cell is a thing you can hold (Sean, 2026-09-20): once its bracket is
 * clicked, Delete takes it, ⌘C copies it whole, ⌘X cuts it, ⌘V puts one back
 * after it, and typing replaces it. These are the core's `CellCommands`
 * applied to what `heldCells` says is held — and each one declines (returns
 * false) when nothing is held, so an ordinary selection keeps the ordinary
 * editor's behaviour.
 */
const CELLS_MIME = "application/x-writemind-cells"

/** Several edits as ONE transaction, with the selection mapped through them. */
function applyEdits(view: EditorView, edits: Edit[], keep: "caret" | "cells"): void {
  const ascending = [...edits].sort((a, b) => a.range.location - b.range.location)
  let shift = 0
  const ranges = ascending.map((edit) => {
    const at = edit.selection.location + shift
    shift += edit.replacement.length - edit.range.length
    return EditorSelection.range(at, at + (keep === "cells" ? edit.selection.length : 0))
  })
  view.dispatch({
    changes: edits.map((edit) => ({
      from: edit.range.location,
      to: edit.range.location + edit.range.length,
      insert: edit.replacement,
    })),
    selection: keep === "cells"
      ? EditorSelection.create(ranges)
      : EditorSelection.create([ranges[0]!]),
    // Cells left selected are cells held: say so, so the rendered page keeps them drawn.
    effects: keep === "cells" ? setHolding.of(true) : [],
    scrollIntoView: true,
  })
  view.focus()
}

const heldOnes = (view: EditorView): Range[] => {
  const selected = view.state.selection.ranges.some((r) => !r.empty)
  return selected ? heldCells(view) : []
}

export const deleteHeldCells: Command = (view) => {
  const held = heldOnes(view)
  if (held.length === 0) return false
  const text = view.state.doc.toString()
  const edits = editsOver(held, text, (span, whole) => deleteCell(span, whole))
  if (edits.length === 0) return false
  applyEdits(view, edits, "caret")
  return true
}

export const duplicateHeldCells: Command = (view) => {
  const held = heldOnes(view)
  if (held.length === 0) return false
  const text = view.state.doc.toString()
  const edits = editsOver(held, text, (span, whole) => duplicateCell(span, whole))
  if (edits.length === 0) return false
  applyEdits(view, edits, "cells")
  return true
}

const moveHeld = (up: boolean): Command => (view) => {
  const held = heldOnes(view)
  if (held.length === 0) return false
  const edits = movingCells(held, up, view.state.doc.toString())
  if (edits.length === 0) return true // held, but at the end of the note: say nothing
  applyEdits(view, edits, "cells")
  return true
}

/** The held cells' markdown, one after another with a blank line between. */
const heldMarkdown = (view: EditorView, held: Range[]): string => {
  const text = view.state.doc.toString()
  return held.map((cell) => copyCell(cell, text)).join("\n\n")
}

/** Copy, cut and paste go through the DOM events, so the system clipboard is used. */
const cellClipboard = EditorView.domEventHandlers({
  copy(event, view) {
    const held = heldOnes(view)
    if (held.length === 0 || !event.clipboardData) return false
    const markdown = heldMarkdown(view, held)
    event.clipboardData.setData("text/plain", markdown)
    event.clipboardData.setData(CELLS_MIME, markdown)
    event.preventDefault()
    return true
  },
  cut(event, view) {
    const held = heldOnes(view)
    if (held.length === 0 || !event.clipboardData) return false
    const markdown = heldMarkdown(view, held)
    event.clipboardData.setData("text/plain", markdown)
    event.clipboardData.setData(CELLS_MIME, markdown)
    event.preventDefault()
    deleteHeldCells(view)
    return true
  },
  paste(event, view) {
    const markdown = event.clipboardData?.getData(CELLS_MIME)
    if (!markdown) return false
    const text = view.state.doc.toString()
    const cells = view.state.field(notebookField).cells.map((cell) => cell.range)
    const held = heldOnes(view)
    // After the last held cell, or after the cell the caret is in.
    const caret = view.state.selection.main.head
    const after = held.length > 0
      ? held[held.length - 1]!
      : cells.find((r) => caret >= r.location && caret <= r.location + r.length)
    event.preventDefault()
    if (!after) {
      // Nothing to go after: an empty note takes the cells as they are.
      applyEdit(view, {
        range: { location: 0, length: text.length },
        replacement: markdown,
        selection: { location: 0, length: markdown.length },
      })
      return true
    }
    applyEdits(view, [pasteCell(markdown, after, text)], "cells")
    return true
  },
})

/**
 * Typing over held cells REPLACES them: the first is overwritten by what was
 * typed and the rest go, with the blank lines that held them apart. (The
 * editor's own answer to several ranges is to type into every one.)
 */
const typingOverCells = EditorView.inputHandler.of((view, _from, _to, typed) => {
  const held = heldOnes(view)
  if (held.length < 2 || typed.length === 0) return false
  const text = view.state.doc.toString()
  const edits = editsOver(held, text, (span, whole) => deleteCell(span, whole))
  const front = edits[edits.length - 1]
  if (!front) return false
  const tail = text.slice(front.range.location, front.range.location + front.range.length).match(/\n+$/)
  edits[edits.length - 1] = {
    range: front.range,
    replacement: typed + (tail ? tail[0] : ""),
    selection: { location: front.range.location + typed.length, length: 0 },
  }
  applyEdits(view, edits, "caret")
  return true
})

export const cellKeys: Extension = [
  keymap.of([
    { key: "Backspace", run: deleteHeldCells },
    { key: "Delete", run: deleteHeldCells },
    { key: "Ctrl-Backspace", run: deleteHeldCells },
    { key: "Ctrl-Shift-d", run: duplicateHeldCells, preventDefault: true },
    { key: "Ctrl-Shift-ArrowUp", run: moveHeld(true), preventDefault: true },
    { key: "Ctrl-Shift-ArrowDown", run: moveHeld(false), preventDefault: true },
  ]),
  cellClipboard,
  typingOverCells,
]

/** Cell commands first, so a held cell gets Delete before the editor's own. */
export const notebookKeys: Extension = [cellKeys, codeTypingKeys, baseKeys, extraKeys]

/** Move the held cells one place — what dragging a held bracket does. */
export const moveHeldCells = (view: EditorView, up: boolean): boolean => moveHeld(up)(view)
