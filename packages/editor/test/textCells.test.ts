import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, undo } from "@codemirror/commands"
import { markdownCell, textCell, wrap } from "../src/keys"
import { describe, expect, it } from "vitest"
import { MARKDOWN_MARKER } from "@writemind/core"
import { cellWritten, notebookField } from "../src/notebook"
import { armedField } from "../src/seams"
import { hiddenMarkers, plainSelection, textCells } from "../src/textCells"

/**
 * Text cells and markdown cells in the editor (docs/PLAN-text-cells.md; Sean, 2026-10-05; port-first): typing in a
 * text cell is literal (the escape rule, in the same transaction), the marker is hidden and the caret never stands in
 * it, an older note's markdown cell gets its marker when it is edited, and copy gives the words. The view's half (the
 * hidden escapes, the rendered page, the PDF) is held by C:\CLAUDIO\agents\e2e\text\text-cells.mjs.
 */

const M = MARKDOWN_MARKER
const make = (doc: string, at = 0, head = at): EditorState => EditorState.create({
  doc, selection: EditorSelection.single(at, head), extensions: [notebookField, armedField, history(), textCells],
})
const type = (state: EditorState, from: number, insert: string, to = from, userEvent = "input.type"): EditorState =>
  state.update({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length), userEvent }).state
const caret = (state: EditorState) => state.selection.main.head

describe("typing in a text cell is literal", () => {
  it("a line-start mark is written with its backslash, the caret after what was typed", () => {
    let state = make("foo")
    state = type(state, 0, "#")
    expect(state.doc.toString()).toBe("#foo")
    state = type(state, 1, " ")
    expect(state.doc.toString()).toBe("\\# foo")
    expect(caret(state)).toBe(3)
  })

  it("an inline mark that closes markup is escaped where it opened, and ONE undo takes the keystroke back", () => {
    let state = make("a *b", 4)
    state = type(state, 4, "*")
    expect(state.doc.toString()).toBe("a \\*b*")
    expect(caret(state)).toBe(6)
    const view = { state, dispatch: (tr: unknown) => { state = (tr as { state: EditorState }).state } }
    undo(view as never)
    expect(state.doc.toString()).toBe("a *b")
  })

  it("Return (CodeMirror's newline) splitting a line before a mark escapes the new line", () => {
    const state = type(make("foo # bar", 4), 4, "\n", 4, "input")
    expect(state.doc.toString()).toBe("foo \n\\# bar")
    expect(caret(state)).toBe(5)
  })

  it("a new line typed under a text cell is the cell's; a new cell on its own is a text cell too", () => {
    let state = make("foo\n", 4)
    state = type(state, 4, "- x")
    expect(state.doc.toString()).toBe("foo\n\\- x")
    state = make("# Head\n\n", 8)
    state = type(state, 8, "1. x")
    expect(state.doc.toString()).toBe("# Head\n\n1\\. x")
  })

  it("under a list it is the list's (raw markdown), and a paste between cells stays what it was", () => {
    expect(type(make("- a\n", 4), 4, "- b").doc.toString()).toBe("- a\n- b")
    expect(type(make("a\n\n\n", 3), 3, "# H", 3, "input.paste").doc.toString()).toBe("a\n\n# H\n")
  })

  it("the empty item Return in a list leaves (`2. `, `- `) is the list's: what is typed after it is not escaped", () => {
    // CI on 1b9010a (editor/01): the parser trims `2. ` to `2.`, a paragraph, so a text cell; the next key escaped it.
    expect(type(make("1. a\n2. ", 8), 8, "b").doc.toString()).toBe("1. a\n2. b")
    expect(type(make("1) a\n2) ", 8), 8, "b").doc.toString()).toBe("1) a\n2) b")
    expect(type(make("- one\n- ", 8), 8, "two").doc.toString()).toBe("- one\n- two")
    expect(type(make("* one\n* ", 8), 8, "t").doc.toString()).toBe("* one\n* t")
    expect(type(make("- [ ] a\n- ", 10), 10, "b").doc.toString()).toBe("- [ ] a\n- b")
    // ...and no hole: an empty text cell, a marker under words or a heading, another list's marker stay literal
    let state = make("")
    for (const key of ["1", ".", " ", "x"]) state = type(state, state.doc.length, key)
    expect(state.doc.toString()).toBe("1\\. x")
    expect(type(make("words\n2. ", 9), 9, "x").doc.toString()).toBe("words\n2\\. x")
    expect(type(make("# H\n2. ", 7), 7, "x").doc.toString()).toBe("# H\n2\\. x")
    expect(type(make("- a\n2. ", 7), 7, "x").doc.toString()).toBe("- a\n2\\. x")
    expect(type(make("1. a\n\n2. ", 9), 9, "x").doc.toString()).toBe("1. a\n\n2\\. x")
  })

  it("a paste into a text cell is literal", () => {
    expect(type(make("x y", 1), 1, " **b** ", 1, "input.paste").doc.toString()).toBe("x \\*\\*b**  y")
  })

  it("leaves a markdown cell's typing alone, and a cell the bar writes whole", () => {
    const marked = make(M + "\nfoo")
    expect(type(marked, marked.doc.length, " **x**").doc.toString()).toBe(M + "\nfoo **x**")
    const written = make("foo", 3).update({ changes: { from: 3, insert: "\n\n# x" }, userEvent: "input.type", annotations: cellWritten.of(true) }).state
    expect(written.doc.toString()).toBe("foo\n\n# x")
  })

  it("an older note's markdown cell gets its marker when it is edited", () => {
    const state = type(make("a **b**", 7), 7, "c")
    expect(state.doc.toString()).toBe(M + "\na **b**c")
    expect(caret(state)).toBe(M.length + 1 + 8)
  })
})

describe("the marker", () => {
  const doc = "x\n\n" + M + "\nfoo"
  const marker = doc.indexOf(M)

  it("is hidden whole, with its newline", () => {
    const set = hiddenMarkers(make(doc))
    const found: [number, number][] = []
    set.between(0, doc.length, (from, to) => { found.push([from, to]) })
    expect(found).toEqual([[marker, marker + M.length + 1]])
  })

  it("the caret put in it goes to the words; walking back out of the words goes on to the line above", () => {
    const state = make(doc)
    expect(caret(state.update({ selection: EditorSelection.cursor(marker) }).state)).toBe(marker + M.length + 1)
    const inWords = make(doc, marker + M.length + 1)
    expect(caret(inWords.update({ selection: EditorSelection.cursor(marker) }).state)).toBe(marker - 1)
  })

  it("a character typed in front of it goes in after it, in the words", () => {
    const state = type(make(doc), marker, "z")
    expect(state.doc.toString()).toBe("x\n\n" + M + "\nzfoo")
  })
})

describe("copy", () => {
  it("gives a text cell's words without the escapes' backslashes", () => {
    const state = make("\\# a \\*b*\n\nnext", 0, 9)
    expect(plainSelection(state)).toBe("# a *b*")
    expect(plainSelection(make("plain words", 0, 5))).toBeNull()
  })
})

// Sean, 2026-10-05: "when converting a cell to markdown, it just processes markdown".
describe("converting a text cell to a markdown cell", () => {
  /** Enough of an EditorView for the commands: the state, a dispatch that applies, focus, and the root's classes. */
  function fakeView(state: EditorState): EditorView {
    const box = {
      state,
      dom: { classList: { contains: () => false } },
      dispatch(spec: TransactionSpec | Transaction) {
        box.state = spec instanceof Transaction ? spec.state : box.state.update(spec).state
      },
      focus() {},
    }
    return box as unknown as EditorView
  }
  const selected = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)

  it("Ctrl+Shift+7 reads the words as markdown (the backslashes go), and ONE undo gives the text cell back", () => {
    const text = "a \\*\\*x** b\nc"
    const view = fakeView(make(text, text.indexOf("x"), text.indexOf("x") + 1))
    markdownCell(view)
    expect(view.state.doc.toString()).toBe(`${M}\na **x** b\nc`)
    expect(selected(view)).toBe("x")
    undo(view)
    expect(view.state.doc.toString()).toBe(text)
  })

  it("Ctrl+7 keeps inline maths' source, Ctrl+Shift+7 makes it maths again; ONE undo takes back each step", () => {
    // Sean, 2026-10-06: "yes" (the whole `wl:` source stays as the text cell's words).
    const md = `${M}\nArea \`wl:Pi r^2\` and **b**`
    const view = fakeView(make(md, md.length))
    textCell(view)
    const text = "Area \\`wl:Pi r^2` and b"
    expect(view.state.doc.toString()).toBe(text)
    markdownCell(view)
    expect(view.state.doc.toString()).toBe(`${M}\nArea \`wl:Pi r^2\` and b`)
    undo(view)
    expect(view.state.doc.toString()).toBe(text)
    undo(view)
    expect(view.state.doc.toString()).toBe(md)
  })

  it("Ctrl+B on a word of a text cell bolds exactly that word, the rest read as markdown; ONE undo", () => {
    const text = "2\\*3\\*4 and \\*\\*y\\*\\*"
    const at = text.indexOf("and")
    const view = fakeView(make(text, at, at + 3))
    wrap("**")(view)
    expect(view.state.doc.toString()).toBe(`${M}\n2*3*4 **and** **y**`)
    expect(selected(view)).toBe("and")
    undo(view)
    expect(view.state.doc.toString()).toBe(text)
  })
})

// The gate's findings (2026-10-05): a marker keeps to its words.
describe("the marker keeps to its words", () => {
  const cell = `before\n\n${M}\nhello **world**\n\nafter`
  const words = cell.indexOf("hello")

  for (const [typed, made] of [["# ", "# hello **world**"], ["- ", "- hello **world**"], ["> ", "> hello **world**"]] as const) {
    it(`typing "${typed}" at the start of the words makes a block of them, and the marker goes`, () => {
      let state = make(cell, words)
      for (const c of typed) state = type(state, caret(state), c)
      expect(state.doc.toString()).toBe(`before\n\n${made}\n\nafter`)
      expect(caret(state)).toBe(8 + typed.length)
    })
  }

  it("ONE undo brings the marker back with the keystroke", () => {
    let state = make(cell, words)
    state = type(state, words, "#")
    state = type(state, words + 1, " ")
    const view = { state, dispatch: (tr: unknown) => { state = (tr as { state: EditorState }).state } }
    undo(view as never)
    // (The two keystrokes are one history event, as typing is.)
    expect(state.doc.toString()).toBe(cell)
  })

  it("a fence typed at the start of the words takes the marker away too", () => {
    let state = make(cell, words)
    for (const c of "```") state = type(state, caret(state), c)
    expect(state.doc.toString()).not.toContain(M)
  })

  it("Return at the start of the words moves them down, the marker with them", () => {
    const state = type(make(`${M}\nplain **words**`, M.length + 1), M.length + 1, "\n", M.length + 1, "input")
    expect(state.doc.toString()).toBe(`\n${M}\nplain **words**`)
    expect(caret(state)).toBe(1 + M.length + 1)
  })

  it("typing in the words, or emptying them, leaves the marker where it is", () => {
    expect(type(make(cell, words), words + 2, "#").doc.toString()).toBe(`before\n\n${M}\nhe#llo **world**\n\nafter`)
    const emptied = type(make(cell, words), words, "", words + "hello **world**".length, "delete.backward")
    expect(emptied.doc.toString()).toBe(`before\n\n${M}\n\n\nafter`)
  })
})
