import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, insertNewlineAndIndent, undo, undoDepth } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { notebook, notebookField } from "../src/notebook"
import { armedField, armedTypeField, armSeam, barFromField, returnClosesTheCell } from "../src/seams"
import { foldField } from "../src/fold"
import { renderedField } from "../src/rendered"
import { holdingField } from "../src/preview/hold"
import { textCells } from "../src/textCells"
import {
  backspaceInItemLine, deleteIntoItemLine, emptyLineAt, leftOffEmptyLine, lineBreakAt, newlineInCell, selectLeftOffEmptyLine,
} from "../src/emptyLines"

/**
 * CTRL+ENTER IN THE EDITOR (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the current cell.."; "this
 * should not be two separate cells"). The rule is core `lineInCell` (core lineInCell.test.ts, every kind of cell); what the
 * editor adds: the key writes it as ONE undo step with the caret on the new line, the empty line it keeps (`<br>`) stays an
 * empty line while it is edited — typed on, it is a line of words; Backspace takes it away whole; Return at its end grows
 * the cell as at the end of any line — and the caret stands after its `<br>`. The real keys on both pages are
 * e2e/suites/cells/22 and 23.
 */

const make = (doc: string, caret = doc.length): { view: EditorView; state: () => EditorState } => {
  const box = {
    state: EditorState.create({
      doc, selection: EditorSelection.single(caret),
      extensions: [notebookField, foldField, renderedField, holdingField, armedField, armedTypeField, barFromField, history(), textCells],
    }),
    dom: { classList: { contains: () => false } },
    dispatch(spec: TransactionSpec | Transaction) {
      box.state = spec instanceof Transaction ? spec.state : box.state.update(spec).state
    },
    focus() {},
  }
  return { view: box as unknown as EditorView, state: () => box.state }
}

const doc = (state: EditorState): string => state.doc.toString()
const head = (state: EditorState): number => state.selection.main.head
/** A key's edit as CodeMirror's own command makes it: `insert` over [from, to), the caret after it. */
const edit = (view: EditorView, from: number, to: number, insert: string, userEvent: string): void =>
  view.dispatch(view.state.update({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length), userEvent }))
const cells = (state: EditorState) => notebook(state).cells.map((cell) => cell.block.kind)

describe("the key", () => {
  it("at the end of a text cell: an empty line the cell keeps, the caret on it; again and again, all the one cell", () => {
    const { view, state } = make("hello\n\nworld", 5)
    expect(newlineInCell(view)).toBe(true)
    expect(doc(state())).toBe("hello\n<br>\n\nworld")
    expect(head(state())).toBe(10)
    newlineInCell(view)
    newlineInCell(view)
    expect(doc(state())).toBe("hello\n<br>\n<br>\n<br>\n\nworld")
    expect(cells(state())).toEqual(["paragraph", "paragraph"])
    expect(notebook(state()).cells[0]!.block).toEqual({ kind: "paragraph", text: "hello\n\n\n" })
    expect(state().field(armedField)).toBeNull()
  })

  it("is ONE undo step each, however quickly they come, and what is typed after it is a step of its own", () => {
    const { view, state } = make("hello")
    newlineInCell(view)
    newlineInCell(view)
    edit(view, head(state()), head(state()), "x", "input.type")
    expect(doc(state())).toBe("hello\n<br>\nx")
    undo(view)
    expect(doc(state())).toBe("hello\n<br>\n<br>")
    undo(view)
    expect(doc(state())).toBe("hello\n<br>")
    undo(view)
    expect(doc(state())).toBe("hello")
    expect(undoDepth(state())).toBe(0)
  })

  it("in a list item: the same item's next line; in a quote, the quote's; in a fence a plain newline", () => {
    const list = make("- one\n- two", 5)
    newlineInCell(list.view)
    expect(doc(list.state())).toBe("- one\n  <br>\n- two")
    expect(cells(list.state())).toEqual(["bullets"])
    // (A quote's new line starts with `<br>`: its lines join with a space when it is drawn — the review of agent/ctrlenter, P1.)
    const quote = make("> a")
    newlineInCell(quote.view)
    newlineInCell(quote.view)
    expect(doc(quote.state())).toBe("> a\n> <br>\n> <br>")
    expect(cells(quote.state())).toEqual(["quote"])
    const code = make("```py\nx\n```", 7)
    newlineInCell(code.view)
    expect(doc(code.state())).toBe("```py\nx\n\n```")
  })

  it("does nothing where a cell is one line, at a bar, over a held cell, between cells — and is still the key's (CodeMirror's Mod-Enter never runs)", () => {
    for (const [note, at] of [["# Title", 7], ["---", 3], ["a\n\nb", 2], ["| a | b |\n|---|---|\n| 1 | 2 |", 25]] as const) {
      const { view, state } = make(note, at)
      expect(newlineInCell(view), note).toBe(true)
      expect(doc(state()), note).toBe(note)
    }
    const bar = make("hello\n\nworld", 6)
    bar.view.dispatch({ effects: armSeam.of(7) })
    expect(newlineInCell(bar.view)).toBe(true)
    expect(doc(bar.state())).toBe("hello\n\nworld")
    const held = make("hello\n\nworld")
    held.view.dispatch({ selection: EditorSelection.single(0, 5) })
    expect(newlineInCell(held.view)).toBe(true)
    expect(doc(held.state())).toBe("hello\n\nworld")
  })

  it("never writes a blank line that would split the cell (CodeMirror's Mod-Enter wrote Alpha|\\n\\nBeta as Alpha\\n|\\n\\nBeta)", () => {
    const { view, state } = make("Alpha\nBeta", 5)
    newlineInCell(view)
    expect(doc(state())).toBe("Alpha\n<br>\nBeta")
    expect(cells(state())).toEqual(["paragraph"])
  })
})

describe("the empty line it keeps, edited", () => {
  // The review of agent/ctrlenter (P1): in a markdown cell and a quote the `<br>` stays in front of the words typed on the line
  // — a single newline there is a space when the cell is drawn, and the `<br>` is what keeps them a line of their own. (It
  // used to go there too, and the line Ctrl+Enter made was gone on the rendered page.)
  it("typing on it makes it a line of words: the `<br>` goes in the same step in a text cell and a list item, and stays in front of the words in a markdown cell and a quote", () => {
    for (const [note, typed, after] of [
      ["hello\n<br>", "w", "hello\nw"],
      ["<!-- markdown -->\nhello\n<br>", "*", "<!-- markdown -->\nhello\n<br>*"],
      ["> hello\n> <br>", "w", "> hello\n> <br>w"],
      ["- one\n  <br>", "m", "- one\n  m"],
      ["- <br>\n  one", "z", "- z\n  one"],
    ] as const) {
      const { view, state } = make(note)
      const kept = emptyLineAt(state(), state().doc.lineAt(note.indexOf("<br>")))!
      view.dispatch({ selection: EditorSelection.cursor(kept.to) })
      edit(view, kept.to, kept.to, typed, "input.type")
      expect(doc(state()), note).toBe(after)
      expect(head(state()), note).toBe(after.indexOf(typed, note.indexOf("<br>") - 1) + 1)
      undo(view)
      expect(doc(state()), note).toBe(note)
    }
  })

  it("a `#` typed on it in a text cell is the escape rule's (the words are literal), a `<br>` typed is words too", () => {
    const { view, state } = make("hello\n<br>")
    edit(view, 10, 10, "#", "input.type")
    edit(view, head(state()), head(state()), " ", "input.type")
    expect(doc(state())).toBe("hello\n\\# ")
    const typing = make("hello\n")
    for (const key of ["<", "b", "r", ">"]) edit(typing.view, head(typing.state()), head(typing.state()), key, "input.type")
    expect(doc(typing.state())).toBe("hello\n\\<br>")
    expect(notebook(typing.state()).cells[0]!.block).toEqual({ kind: "paragraph", text: "hello\n<br>" })
  })

  it("Backspace takes the line away whole (the `<br>`, then the newline before it, in one step)", () => {
    const { view, state } = make("hello\n<br>\n\nworld", 10)
    // (The editor's own Backspace takes an atomic `<br>` whole.)
    edit(view, 6, 10, "", "delete.backward")
    expect(doc(state())).toBe("hello\n\nworld")
    expect(head(state())).toBe(5)
    expect(cells(state())).toEqual(["paragraph", "paragraph"])
    undo(view)
    expect(doc(state())).toBe("hello\n<br>\n\nworld")
    const middle = make("hello\n<br>\nworld", 10)
    edit(middle.view, 6, 10, "", "delete.backward")
    expect(doc(middle.state())).toBe("hello\nworld")
    const list = make("- one\n  <br>")
    edit(list.view, 8, 12, "", "delete.backward")
    expect(doc(list.state())).toBe("- one")
    // An item's first line kept empty: the words under it come back up.
    const first = make("- <br>\n  one", 6)
    edit(first.view, 2, 6, "", "delete.backward")
    expect(doc(first.state())).toBe("- one")
    expect(head(first.state())).toBe(2)
  })

  it("Backspace at the start of the line under it, and Delete at the end of the line above it, join over it", () => {
    const { view, state } = make("hello\n<br>\nworld", 11)
    edit(view, 10, 11, "", "delete.backward")
    expect(doc(state())).toBe("hello\nworld")
    const above = make("hello\n<br>\nworld", 5)
    above.view.dispatch(above.state().update({ changes: { from: 5, to: 6 }, userEvent: "delete.forward" }))
    expect(doc(above.state())).toBe("hello\nworld")
    expect(cells(above.state())).toEqual(["paragraph"])
  })

  it("Return at its end is Return at the end of any line: the cell grows, and the next Return arms the bar under it", () => {
    const { view, state } = make("hello\n<br>\n\nworld", 10)
    insertNewlineAndIndent(view)
    expect(doc(state())).toBe("hello\n<br>\n\n\nworld")
    expect(returnClosesTheCell(view)).toBe(true)
    expect(doc(state())).toBe("hello\n<br>\n\nworld")
    expect(state().field(armedField)).not.toBeNull()
  })

  it("a caret put in front of its `<br>` stands after it; Left from there goes on to the line above", () => {
    const { view, state } = make("hello\n<br>\nworld", 0)
    view.dispatch({ selection: EditorSelection.cursor(6) })
    expect(head(state())).toBe(10)
    view.dispatch({ selection: EditorSelection.cursor(8) })
    expect(head(state())).toBe(10)
    expect(leftOffEmptyLine(view)).toBe(true)
    expect(head(state())).toBe(5)
    // (A bar that is up keeps the caret it parks at the start of the cell under it, an empty line or not.)
    const bar = make("hello\n\n<br>\nworld", 0)
    bar.view.dispatch({ selection: EditorSelection.cursor(7), effects: armSeam.of(7) })
    expect([head(bar.state()), bar.state().field(armedField)]).toEqual([7, 7])
    // (A `<br>` in a code block is code: the caret goes where it is put.)
    const code = make("```\n<br>\n```", 0)
    code.view.dispatch({ selection: EditorSelection.cursor(4) })
    expect(head(code.state())).toBe(4)
    expect(emptyLineAt(code.state(), code.state().doc.line(2))).toBeNull()
  })
})

describe("the review of agent/ctrlenter", () => {
  it("P1: a markdown cell's and a quote's line that starts afresh keeps its `<br>` as it is typed, and the caret stands after it", () => {
    const md = make("<!-- markdown -->\nfirst", 23)
    newlineInCell(md.view)
    for (const key of ["s", "e", "c"]) edit(md.view, head(md.state()), head(md.state()), key, "input.type")
    expect(doc(md.state())).toBe("<!-- markdown -->\nfirst\n<br>sec")
    expect(notebook(md.state()).cells[0]!.block).toMatchObject({ text: "first\nsec" })
    // The caret put in front of the `<br>` stands after it, at the start of the words; Left goes on to the line above.
    md.view.dispatch({ selection: EditorSelection.cursor(24) })
    expect(head(md.state())).toBe(28)
    expect(lineBreakAt(md.state(), md.state().doc.line(3))).toMatchObject({ alone: false, joins: true, first: false })
    expect(leftOffEmptyLine(md.view)).toBe(true)
    expect(head(md.state())).toBe(23)
    const quote = make("> a", 3)
    newlineInCell(quote.view)
    edit(quote.view, head(quote.state()), head(quote.state()), "b", "input.type")
    expect(doc(quote.state())).toBe("> a\n> <br>b")
    expect(notebook(quote.state()).cells[0]!.block).toEqual({ kind: "quote", text: "a\nb" })
  })

  it("P1: Backspace at the start of such a line's words joins it to the line above, as at the start of any line", () => {
    const md = make("<!-- markdown -->\nfirst\n<br>second", 28)
    // (The editor's own Backspace takes the atomic `<br>` whole.)
    edit(md.view, 24, 28, "", "delete.backward")
    expect(doc(md.state())).toBe("<!-- markdown -->\nfirstsecond")
    expect(head(md.state())).toBe(23)
    undo(md.view)
    expect(doc(md.state())).toBe("<!-- markdown -->\nfirst\n<br>second")
    const quote = make("> first\n> <br>second", 14)
    edit(quote.view, 10, 14, "", "delete.backward")
    expect(doc(quote.state())).toBe("> firstsecond")
    // A quote's empty line: Backspace takes the line, `>` and all.
    const empty = make("> first\n> <br>", 14)
    edit(empty.view, 10, 14, "", "delete.backward")
    expect(doc(empty.state())).toBe("> first")
    // Delete at the end of the line above joins over it: the `<br>` is no line's head any more, and goes.
    const above = make("<!-- markdown -->\nfirst\n<br>second", 23)
    above.view.dispatch(above.state().update({ changes: { from: 23, to: 24 }, userEvent: "delete.forward" }))
    expect(doc(above.state())).toBe("<!-- markdown -->\nfirstsecond")
  })

  it("P1: a selection that took the hidden `<br>` with words (typed over, or deleted) leaves the rest a line of its own", () => {
    const typedOver = make("<!-- markdown -->\nfirst\n<br>second", 24)
    // (From the start of the line, as Shift+Home or a drag from the margin takes it: the `<br>` and "sec".)
    typedOver.view.dispatch(typedOver.state().update({ changes: { from: 24, to: 31, insert: "S" }, selection: EditorSelection.cursor(25), userEvent: "input.type" }))
    expect(doc(typedOver.state())).toBe("<!-- markdown -->\nfirst\n<br>Sond")
    const deleted = make("> first\n> <br>second", 10)
    deleted.view.dispatch(deleted.state().update({ changes: { from: 10, to: 17 }, userEvent: "delete.backward" }))
    expect(doc(deleted.state())).toBe("> first\n> <br>ond")
    expect(notebook(deleted.state()).cells[0]!.block).toEqual({ kind: "quote", text: "first\nond" })
  })

  it("P2: Backspace in an item's next line's indentation joins its words to the line above; Delete from above the same", () => {
    const { view, state } = make("- one\n  more\n- two", 8)
    expect(backspaceInItemLine(view)).toBe(true)
    expect(doc(state())).toBe("- onemore\n- two")
    expect(head(state())).toBe(5)
    expect(cells(state())).toEqual(["bullets"])
    undo(view)
    expect(doc(state())).toBe("- one\n  more\n- two")
    const todo = make("- [ ] milk\n      eggs", 17)
    expect(backspaceInItemLine(todo.view)).toBe(true)
    expect(doc(todo.state())).toBe("- [ ] milkeggs")
    expect(todo.state().selection.main.empty).toBe(true)
    const del = make("- one\n  more\n- two", 5)
    expect(deleteIntoItemLine(del.view)).toBe(true)
    expect(doc(del.state())).toBe("- onemore\n- two")
    // Not its business in the middle of the words, nor in a text cell.
    expect(backspaceInItemLine(make("- one\n  more", 10).view)).toBe(false)
    expect(backspaceInItemLine(make("one\n  more", 6).view)).toBe(false)
  })

  it("P3 a: Shift+Left from an empty line takes the line break, not the hidden `<br>` alone", () => {
    const { view, state } = make("hello\n<br>\nworld", 10)
    expect(selectLeftOffEmptyLine(view)).toBe(true)
    expect([state().selection.main.anchor, state().selection.main.head]).toEqual([10, 5])
    // From further right, a selection already running: its head goes on the same way.
    const run = make("hello\n<br>\nworld", 0)
    run.view.dispatch({ selection: EditorSelection.range(13, 10) })
    expect(selectLeftOffEmptyLine(run.view)).toBe(true)
    expect([run.state().selection.main.anchor, run.state().selection.main.head]).toEqual([13, 5])
  })
})
