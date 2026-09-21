/**
 * The keys, and the one place a formatting command is declared.
 *
 * Every one of them is a call into the core and nothing else: the same
 * function the Mac's Format menu runs, handed the same text and the same
 * selection. A key that had its own idea of what bold means would be a
 * second answer to a question that already has one.
 */

import { insertNewlineAndIndent } from "@codemirror/commands"
import type { Extension } from "@codemirror/state"
import { EditorView, keymap, type Command } from "@codemirror/view"
import {
  BOLD, ITALIC, STRIKE, UNDERLINE_CLOSE, UNDERLINE_OPEN,
  caretLine, codeBlock, indent, listContinuation, mergeCells, moveSection, outdent,
  outdentForBackspace, setHeading, splitCell, substring, toggleList, toggleQuote, toggleWrap,
  type Edit, type Heading, type ListStyle, type Range,
} from "@writemind/core"
import { applyEdit } from "./notebook"

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

export const heading = (level: Heading): Command =>
  run((text, where) => setHeading(text, where, level))

export const list = (style: ListStyle): Command =>
  run((text, where) => toggleList(text, where, style))

export const quote: Command = run((text, where) => toggleQuote(text, where))
export const fence: Command = run((text, where) => codeBlock(text, where))
export const indentLines: Command = run((text, where) => indent(text, where))
export const outdentLines: Command = run((text, where) => outdent(text, where))
export const splitTheCell: Command = run((text, where) => splitCell(text, where))
export const mergeTheCell: Command = run((text, where) => mergeCells(text, where))
export const moveUp: Command = run((text, where) => moveSection(text, where, true))
export const moveDown: Command = run((text, where) => moveSection(text, where, false))

/** Backspace inside a line's prefix takes a level off; anywhere else it is a backspace. */
const backspaceOutdents: Command = (view) => {
  const change = outdentForBackspace(view.state.doc.toString(), selection(view))
  if (!change) return false
  applyEdit(view, change)
  return true
}

/** Return at the end of a list item carries the list on. */
const carryTheListOn: Command = (view) => {
  const main = view.state.selection.main
  if (!main.empty) return false
  const text = view.state.doc.toString()
  const line = caretLine(text, main.from)
  const body = substring(text, line).replace(/\n$/, "")
  if (main.from !== line.location + body.length) return false
  const next = listContinuation(body)
  if (next === null) return false
  if (next === "") {
    // An empty item: Return ends the list rather than adding to it.
    applyEdit(view, {
      range: { location: line.location, length: body.length },
      replacement: "",
      selection: { location: line.location, length: 0 },
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
export const notebookKeys: Extension = keymap.of([
  { key: "Mod-b", run: wrap(BOLD), preventDefault: true },
  { key: "Mod-i", run: wrap(ITALIC), preventDefault: true },
  { key: "Mod-u", run: wrap(UNDERLINE_OPEN, UNDERLINE_CLOSE), preventDefault: true },
  { key: "Shift-Mod-x", run: wrap(STRIKE), preventDefault: true },
  { key: "Shift-Mod-l", run: list("dots"), preventDefault: true },
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
