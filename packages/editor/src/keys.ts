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
  editsOver, movingCells, pasteCell, plainCells,
  caretLine, codeBlock, indent, listContinuation, mergeCells, moveSection, outdent,
  outdentForBackspace, setHeading, splitCell, substring, toggleList, toggleQuote, toggleWrap,
  kindForHeading, makeMarkdownCell, makeTextCell, positioned, viaMarkdownCells, wholeChange,
  MATH_FENCE, mathsAsCode, mathsAsText, mathsCellPlan,
  type CellKind, type Edit, type Heading, type ListStyle, type Range,
} from "@writemind/core"
import { heldCells } from "./brackets"
import { codeTypingKeys } from "./codeTyping"
import { makesCellAfter } from "./dock"
import { extraKeys } from "./extras"
import { setHolding } from "./preview/hold"
import { applyEdit, notebookField } from "./notebook"
import { armedField, openArmed, openCellAt, setArmedType } from "./seams"
import { caretInEmptyCell } from "./textCells"
import { backspaceMayOutdent } from "./windowed"

const selection = (view: EditorView): Range => {
  const main = view.state.selection.main
  return { location: main.from, length: main.to - main.from }
}

const run = (make: (text: string, where: Range) => Edit | null): Command => (view) => {
  const change = make(view.state.doc.toString(), selection(view))
  if (!change) return false
  // A command is ONE undo step of its own, however soon the next keystroke comes: CodeMirror joins input typed within
  // half a second of a change beside it, and "Ctrl+1, then the title" must not undo as one.
  applyEdit(view, change, true)
  return true
}

/**
 * Bold, italic, underline, strike: in a TEXT cell the cell is made a markdown cell first, in the same edit (one Undo
 * takes both back: docs/PLAN-text-cells.md, "Automatic").
 */
export const wrap = (open: string, close = open): Command =>
  run((text, where) => viaMarkdownCells(text, where, (marked, at) => toggleWrap(marked, at, open, close)))

/**
 * A command that makes the cell a heading, a list or a quote, on a MARKDOWN cell: the marker goes first (it only ever
 * marks a paragraph), in the same edit.
 */
const unmarked = (make: (text: string, where: Range) => Edit | null) => (text: string, where: Range): Edit | null => {
  const cell = positioned(text).find((one) => one.range.location <= where.location && where.location <= end(one.range))
  const head = cell && cell.block.kind === "paragraph" ? cell.block.head ?? 0 : 0
  if (!cell || head === 0) return make(text, where)
  const at = cell.range.location
  const bare = text.slice(0, at) + text.slice(at + head)
  const shift = (pos: number) => (pos >= at + head ? pos - head : Math.min(pos, at))
  const from = shift(where.location)
  const change = make(bare, { location: from, length: Math.max(0, shift(end(where)) - from) })
  if (!change) return null
  const final = bare.slice(0, change.range.location) + change.replacement + bare.slice(end(change.range))
  return wholeChange(text, final, change.selection)
}
const end = (r: Range): number => r.location + r.length

/**
 * At a bar on the rendered page a command that makes a KIND of block MAKES that
 * block there, now (Mac 0fdd031; Sean, 2026-09-21: "if i click on something like
 * a style, or a bullet list, or a quoted section, etc.. it should create a cell
 * at the position of the bar ready for that type of input"): its marker in, the
 * caret where the words go, the bar gone. A command that acts ON a cell still
 * does nothing at a bar (`applyEdit`).
 */
export const nameKind = (kind: CellKind, command: Command): Command => (view) => {
  // AT ANY ARMED BAR, on either page (the Mac's `atArmedBar` asks the source pane's text view first): on the markdown
  // side the caret sits on the blank line the bar stands on, and a quote or a heading written THERE was glued to the
  // cells either side of it instead of being a cell of its own (Sean, 2026-10-05).
  if ((view.state.field(armedField, false) ?? null) === null) return command(view)
  view.dispatch({ effects: setArmedType.of(kind) })
  openArmed(view, "")
  // A button on the bar has the keyboard; the cell it made is where the typing goes.
  view.focus()
  return true
}

/**
 * Ctrl+7, TEXT (docs/PLAN-text-cells.md): a markdown cell becomes a text cell (its marker and its formatting go, its
 * words and their line breaks stay); a maths cell becomes a text cell of its source, plain words that never typeset;
 * a heading becomes body text, as the ladder's last rung always did.
 */
export const textCell: Command = nameKind({ kind: "text" }, (view) => {
  const text = view.state.doc.toString()
  const where = selection(view)
  const change = makeTextCell(text, where) ?? mathsAsText(text, where) ?? setHeading(text, where, 0)
  if (!change) return false
  // Each switch is its own undo step, however quickly the next comes (Ctrl+7 then Ctrl+Shift+7: Ctrl+Z undoes each).
  applyEdit(view, change, true)
  return true
})

/** Ctrl+Shift+7, MARKDOWN: the paragraph (or the heading's words) becomes a markdown cell — the marker on top. */
export const markdownCell: Command = nameKind({ kind: "markdown" }, (view) => {
  const change = makeMarkdownCell(view.state.doc.toString(), selection(view))
  if (change) applyEdit(view, change, true)
  return true
})

export const heading = (level: Heading): Command => level === 0 ? textCell
  : nameKind(kindForHeading(level), run(unmarked((text, where) => setHeading(text, where, level))))

export const list = (style: ListStyle): Command =>
  nameKind({ kind: "list", style }, run(unmarked((text, where) => toggleList(text, where, style))))

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

export const quote: Command = nameKind({ kind: "quote" }, run(unmarked((text, where) => toggleQuote(text, where))))
/** Ctrl+8, CODE BLOCK. In a maths cell: that cell becomes Wolfram Language code, the same source (`mathsAsCode`). */
export const fence: Command = nameKind({ kind: "code" }, (view) => {
  const change = mathsAsCode(view.state.doc.toString(), selection(view))
  if (change) { applyEdit(view, change, true); return true }
  return makesCellAfter({ kind: "code" }, run((text, where) => codeBlock(text, where)))(view)
})

/** An empty maths cell's opening fence line, with its newline: where the caret goes in one. */
const MATHS_OPEN = "```" + MATH_FENCE + "\n"

/**
 * Ctrl+9, MATHS CELL (Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell type..
 * that should be ctrl + 9"): a ```wl fence, typeset when the caret is not in it. At a bar, on an empty line or in an
 * emptied cell: a new empty one there, the caret inside. In a text or markdown cell: that cell becomes one, its words
 * the source (a selection: the selected words wrapped, as Ctrl+8 wraps them). In a code block: its fence becomes ```wl.
 * In an evaluation cell: a new one after the pair. In a maths cell: nothing. Its own undo step (core `mathsCellPlan`).
 */
export const mathsCell: Command = nameKind({ kind: "maths" }, (view) => {
  const state = view.state
  const where = selection(view)
  const emptied = caretInEmptyCell(state)
  if (emptied !== null) {
    // An emptied markdown cell: the maths cell takes its place, marker and all.
    const line = state.doc.lineAt(where.location)
    applyEdit(view, {
      range: { location: emptied, length: line.to - emptied },
      replacement: MATHS_OPEN + "\n```",
      selection: { location: emptied + MATHS_OPEN.length, length: 0 },
    }, true)
    return true
  }
  const plan = mathsCellPlan(state.doc.toString(), where)
  switch (plan.kind) {
    case "none": view.focus(); return true
    case "edit": applyEdit(view, plan.edit, true); return true
    case "after": openCellAt(view, plan.seam, { kind: "maths" }); view.focus(); return true
    case "new": return makesCellAfter({ kind: "maths" }, run((text, at) => codeBlock(text, at, MATH_FENCE)))(view)
  }
})
export const indentLines: Command = run((text, where) => indent(text, where))
export const outdentLines: Command = run((text, where) => outdent(text, where))
export const splitTheCell: Command = run((text, where) => splitCell(text, where))
/**
 * Merge Cells. Nothing in an emptied markdown cell: it has no words to join, and the caret there is in no cell, so the
 * core's rule (no cell → the note's last two) would join two cells far away (no bar is up there to stop it).
 */
export const mergeTheCell: Command = (view) => {
  if (caretInEmptyCell(view.state) !== null) { view.focus(); return true }
  return run((text, where) => mergeCells(text, where))(view)
}
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
  // The cell kinds by number (docs/PLAN-text-cells.md): 7 Text, Shift+7 Markdown, 8 Code block, 9 Maths cell. CodeMirror
  // reads a Shift+digit by its key code, so Ctrl+Shift+7 is heard although Shift+7 types "&" (Shift+8 Runnable code:
  // eval/index.ts; 0 Drawing cell is the app's, it writes the drawing too).
  { key: "Mod-7", run: heading(0) },
  { key: "Shift-Mod-7", run: markdownCell, preventDefault: true },
  { key: "Mod-8", run: fence },
  { key: "Mod-9", run: mathsCell, preventDefault: true },
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
export const CELLS_MIME = "application/x-writemind-cells"

/**
 * Told of every Copy and Cut of held cells, after the clipboard event has its words and its cells' markdown and
 * before a cut takes them out of the note: the app copies the drawing cells among them for Mathematica too
 * (main/wolfram/clipboard.ts). The first one given; none: nothing is told.
 */
export const cellsCopied = Facet.define<((copy: { markdown: string; plain: string }) => void) | null,
  ((copy: { markdown: string; plain: string }) => void) | null>({
  combine: (values) => values.find((value) => value !== null) ?? null,
})

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

type ClipboardHandler = (event: ClipboardEvent, view: EditorView) => boolean

/** Copy, cut and paste go through the DOM events, so the system clipboard is used. (The handlers alone: for the tests.) */
export const cellClipboardHandlers: { copy: ClipboardHandler; cut: ClipboardHandler; paste: ClipboardHandler } = {
  copy(event, view) {
    const held = heldOnes(view)
    if (held.length === 0 || !event.clipboardData) return false
    const markdown = heldMarkdown(view, held)
    const plain = plainCells(markdown)
    // Other apps get the words (no hidden escapes or markers); WriteMind gets the cells' markdown.
    event.clipboardData.setData("text/plain", plain)
    event.clipboardData.setData(CELLS_MIME, markdown)
    event.preventDefault()
    view.state.facet(cellsCopied)?.({ markdown, plain })
    return true
  },
  cut(event, view) {
    const held = heldOnes(view)
    if (held.length === 0 || !event.clipboardData) return false
    const markdown = heldMarkdown(view, held)
    const plain = plainCells(markdown)
    event.clipboardData.setData("text/plain", plain)
    event.clipboardData.setData(CELLS_MIME, markdown)
    event.preventDefault()
    // Told while the cells are still in the note: what is copied of them (a drawing cell's ink) is read from it.
    view.state.facet(cellsCopied)?.({ markdown, plain })
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
}

const cellClipboard = EditorView.domEventHandlers(cellClipboardHandlers)

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
