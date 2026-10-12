import { EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state"
import { EditorView, type ViewUpdate } from "@codemirror/view"
import { describe, expect, it } from "vitest"
import { positioned, type CellKind } from "@writemind/core"
import { cellKindAt, sameCellKind, watchCellKind } from "../src/cellKind"
import { foldField } from "../src/fold"
import { itemOpened, itemOpenedField, notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armSeam, armedField, armedTypeField, setArmedType } from "../src/seams"
import { holdingField } from "../src/preview/hold"
import { tableCell } from "../src/keys"

/**
 * The toolbar's Style button needs the caret's cell kind (docs/PLAN-bars-2026-10.md P1): `cellKindAt` answers it from the
 * cells the editor already holds, and `watchCellKind` tells the page only when it CHANGES. Port-only, no Swift test.
 */

const extensions: Extension = [notebookField, itemOpenedField, foldField, renderedField, holdingField, armedField, armedTypeField]
const NOTE = [
  "# Title", "", "Some words here", "", "- one", "- two", "", "> quoted", "", "```python", "print(1)", "```", "", "```wl", "x^2", "```",
].join("\n")
const at = (needle: string, inside = 0): number => NOTE.indexOf(needle) + inside

const stateAt = (doc: string, anchor: number): EditorState =>
  EditorState.create({ doc, selection: EditorSelection.cursor(anchor), extensions })

/** Enough of an EditorView: the state, a dispatch that applies (appendConfig included), focus and the root's classes. */
function fakeView(doc: string, anchor = 0): EditorView & { focused: number; updates: (() => void)[] } {
  const box = {
    state: stateAt(doc, anchor),
    focused: 0,
    dom: { classList: { contains: () => false } },
    dispatch(spec: TransactionSpec) { box.state = box.state.update(spec).state },
    focus() { box.focused++ },
  }
  return box as unknown as EditorView & { focused: number; updates: (() => void)[] }
}

/** Move the selection and run the editor's update listeners as CodeMirror would after the dispatch. */
function move(view: EditorView, anchor: number, spec: TransactionSpec = {}): void {
  const startState = view.state
  const transaction = startState.update({ selection: EditorSelection.cursor(anchor), ...spec })
  ;(view as unknown as { state: EditorState }).state = transaction.state
  const update = {
    view, startState, state: transaction.state, transactions: [transaction],
    selectionSet: transaction.selection !== undefined, docChanged: transaction.docChanged,
  } as unknown as ViewUpdate
  for (const listener of view.state.facet(EditorView.updateListener)) listener(update)
}

/** Apply a transaction that moves no caret and changes no word (an effect only) and run the update listeners. */
function tell(view: EditorView, spec: TransactionSpec): void {
  const startState = view.state
  const transaction = startState.update(spec)
  ;(view as unknown as { state: EditorState }).state = transaction.state
  const update = {
    view, startState, state: transaction.state, transactions: [transaction],
    selectionSet: transaction.selection !== undefined, docChanged: transaction.docChanged,
  } as unknown as ViewUpdate
  for (const listener of view.state.facet(EditorView.updateListener)) listener(update)
}

describe("cellKindAt", () => {
  it("names the cell the caret is in", () => {
    expect(cellKindAt(stateAt(NOTE, at("Title", 2)))).toEqual({ kind: "heading", level: 1 })
    expect(cellKindAt(stateAt(NOTE, at("words", 2)))).toEqual({ kind: "text" })
    expect(cellKindAt(stateAt(NOTE, at("two", 1)))).toEqual({ kind: "list", style: "dots" })
    expect(cellKindAt(stateAt(NOTE, at("quoted", 1)))).toEqual({ kind: "quote" })
    expect(cellKindAt(stateAt(NOTE, at("print", 2)))).toEqual({ kind: "code" })
    expect(cellKindAt(stateAt(NOTE, at("x^2", 1)))).toEqual({ kind: "maths" })
  })

  it("counts both ends of a cell as inside it", () => {
    const start = at("Some words here")
    expect(cellKindAt(stateAt(NOTE, start))).toEqual({ kind: "text" })
    expect(cellKindAt(stateAt(NOTE, start + "Some words here".length))).toEqual({ kind: "text" })
  })

  it("is none on a blank line between cells, and in an empty note", () => {
    expect(cellKindAt(stateAt(NOTE, at("# Title") + "# Title\n".length))).toBeNull()
    expect(cellKindAt(stateAt("", 0))).toBeNull()
  })

  it("follows an edit that changes the kind: a heading marker typed turns Text into a Title", () => {
    const state = stateAt("Words", 5)
    expect(cellKindAt(state)).toEqual({ kind: "text" })
    const next = state.update({ changes: { from: 0, insert: "# " }, selection: EditorSelection.cursor(7) }).state
    expect(cellKindAt(next)).toEqual({ kind: "heading", level: 1 })
  })

  it("at an ARMED BAR is the kind the bar will open (the caret is in no cell)", () => {
    const doc = "One\n\nTwo"
    const state = stateAt(doc, 4)
    const armed = state.update({ effects: [armSeam.of(5), setArmedType.of({ kind: "quote" })] }).state
    expect(armed.field(armedField)).toBe(5)
    expect(cellKindAt(armed)).toEqual({ kind: "quote" })
    const plain = state.update({ effects: armSeam.of(5) }).state
    expect(cellKindAt(plain)).toEqual({ kind: "text" })
  })

  it("agrees with the parser's own reading of every cell of the note (the observer asks no second parse)", () => {
    for (const cell of positioned(NOTE)) {
      if (cell.block.kind === "blank") continue
      const state = stateAt(NOTE, cell.range.location + Math.min(1, cell.range.length))
      expect(cellKindAt(state)).not.toBeNull()
    }
  })
})

describe("a list that mixes kinds is ONE cell, and the Style button names the item the caret is on", () => {
  // Sean, 2026-10-11, of a dashes list with a to-do list straight under it: "this should not be two separate cells".
  const MIXED = "* hello\n* how\n- [ ] Are you\n1. one"
  const where = (needle: string, inside = 1): number => MIXED.indexOf(needle) + inside

  it("a dash is Dashes, a box To-do, a number Numbered, in the one cell", () => {
    expect(positioned(MIXED)).toHaveLength(1)
    expect(cellKindAt(stateAt(MIXED, where("hello")))).toEqual({ kind: "list", style: "dashes" })
    expect(cellKindAt(stateAt(MIXED, where("Are you")))).toEqual({ kind: "list", style: "todo" })
    expect(cellKindAt(stateAt(MIXED, where("one")))).toEqual({ kind: "list", style: "numbered" })
    // (At the very start of an item's line, its marker: still that item.)
    expect(cellKindAt(stateAt(MIXED, where("- [ ]", 0)))).toEqual({ kind: "list", style: "todo" })
  })

  it("on the empty line a single newline (or an empty last item's Return) left under the list: its last item's kind", () => {
    const grown = MIXED.replace("\n1. one", "") + "\n"
    expect(cellKindAt(stateAt(grown, grown.length))).toEqual({ kind: "list", style: "todo" })
  })

  it("the watcher hears the kind change as the caret walks from a dash to a box inside the one cell", () => {
    const view = fakeView(MIXED, where("hello"))
    const heard: string[] = []
    watchCellKind(view, (kind) => heard.push(kind?.kind === "list" ? kind.style : kind?.kind ?? "none"))
    move(view, where("how"))
    move(view, where("Are you"))
    move(view, where("one"))
    expect(heard).toEqual(["dashes", "todo", "numbered"])
  })
})

describe("a cell a command has just opened EMPTY (the + menu's pick)", () => {
  // The parser reads a lone marker as a paragraph, so a list the + menu has just opened would be named Text by the Style
  // button; the command says which line it opened (`itemOpened`) and the button names the list.
  const items: [string, CellKind][] = [
    ["- ", { kind: "list", style: "dots" }], ["* ", { kind: "list", style: "dashes" }],
    ["1. ", { kind: "list", style: "numbered" }], ["- [ ] ", { kind: "list", style: "todo" }],
  ]
  for (const [marker, want] of items) {
    it(`names "${marker}" as ${want.kind === "list" ? want.style : ""} once the command has said it opened it`, () => {
      const doc = `One\n\n${marker}\n\nTwo`
      const state = stateAt(doc, 5 + marker.length)
      expect(cellKindAt(state.update({ effects: itemOpened.of(5) }).state)).toEqual(want)
    })
  }

  it("leaves a marker TYPED by hand to the parser (nothing opened it): a lone `- ` is Text", () => {
    expect(cellKindAt(stateAt("One\n\n- \n\nTwo", 7))).toEqual({ kind: "text" })
  })

  it("stops naming it when the caret leaves the line or a word is typed (the field lets go)", () => {
    const opened = stateAt("One\n\n- \n\nTwo", 7).update({ effects: itemOpened.of(5) }).state
    expect(cellKindAt(opened.update({ selection: EditorSelection.cursor(1) }).state)).toEqual({ kind: "text" })
    const typed = opened.update({ changes: { from: 7, insert: "a" }, selection: EditorSelection.cursor(8) }).state
    expect(cellKindAt(typed)).toEqual({ kind: "list", style: "dots" })   // (now a real item: the parser says so)
  })

  it("names a Markdown cell opened empty: the caret on the empty line under its marker", () => {
    const doc = "One\n\n<!-- markdown -->\n\n\nTwo"
    const under = "One\n\n<!-- markdown -->\n".length
    expect(cellKindAt(stateAt(doc, under))).toEqual({ kind: "markdown" })
    expect(cellKindAt(stateAt(doc, "One\n\n<!-- markdown -->".length))).toEqual({ kind: "markdown" })
  })

  it("the watcher hears the item being opened although the transaction that says so moves nothing", () => {
    const view = fakeView("One\n\n- \n\nTwo", 7)
    const heard: string[] = []
    watchCellKind(view, (kind) => heard.push(kind ? (kind.kind === "list" ? `list:${kind.style}` : kind.kind) : "none"))
    expect(heard).toEqual(["text"])
    tell(view, { effects: itemOpened.of(5) })
    expect(heard).toEqual(["text", "list:dots"])
  })
})

describe("watchCellKind", () => {
  it("hears the current kind at once, and then only a CHANGE of kind", () => {
    const view = fakeView(NOTE, at("Title", 1))
    const heard: (string | null)[] = []
    watchCellKind(view, (kind) => heard.push(kind ? kind.kind : null))
    expect(heard).toEqual(["heading"])
    move(view, at("Title", 4))          // the caret moves inside the same cell: nothing to say
    expect(heard).toEqual(["heading"])
    move(view, at("words", 1))          // another cell, another kind
    expect(heard).toEqual(["heading", "text"])
    move(view, at("words", 3))
    expect(heard).toEqual(["heading", "text"])
    move(view, at("one", 0))
    expect(heard).toEqual(["heading", "text", "list"])
  })

  it("hears a kind change that an edit made without the caret leaving the cell", () => {
    const view = fakeView("Words", 5)
    const heard: string[] = []
    watchCellKind(view, (kind) => heard.push(kind?.kind ?? "none"))
    move(view, 7, { changes: { from: 0, insert: "# " } })
    expect(heard).toEqual(["text", "heading"])
  })

  it("hears an arrow-armed bar come up and go (a bar names the kind it will open)", () => {
    const view = fakeView("One\n\nTwo", 1)
    const heard: string[] = []
    watchCellKind(view, (kind) => heard.push(kind?.kind ?? "none"))
    move(view, 4, { effects: [armSeam.of(5), setArmedType.of({ kind: "quote" })] })
    expect(heard).toEqual(["text", "quote"])
    move(view, 1, { effects: armSeam.of(null) })
    expect(heard).toEqual(["text", "quote", "text"])
  })

  it("stops when it is told to, and a second subscriber is a second ear", () => {
    const view = fakeView(NOTE, at("Title", 1))
    const a: unknown[] = []
    const b: unknown[] = []
    const stopA = watchCellKind(view, (kind) => a.push(kind))
    watchCellKind(view, (kind) => b.push(kind))
    stopA()
    move(view, at("words", 1))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
  })

  it("compares kinds by what they are", () => {
    expect(sameCellKind(null, null)).toBe(true)
    expect(sameCellKind({ kind: "text" }, null)).toBe(false)
    expect(sameCellKind({ kind: "heading", level: 1 }, { kind: "heading", level: 2 })).toBe(false)
    expect(sameCellKind({ kind: "list", style: "dots" }, { kind: "list", style: "dots" })).toBe(true)
  })
})

describe("the Table command (the toolbar's Table button)", () => {
  const table = "|  |  |\n| --- | --- |\n|  |  |\n|  |  |"

  it("on an empty line writes the table there with the caret in the first header cell, as ONE change", () => {
    const view = fakeView("One\n\n\nTwo", 5)
    let changes = 0
    const dispatch = view.dispatch.bind(view)
    ;(view as unknown as { dispatch: (spec: TransactionSpec) => void }).dispatch = (spec) => { changes++; dispatch(spec) }
    tableCell(view)
    expect(view.state.doc.toString()).toBe(`One\n\n${table}\n\nTwo`)
    expect(view.state.selection.main.head).toBe("One\n\n".length + 2)
    expect(changes).toBe(1)
    expect(view.focused).toBeGreaterThan(0)
  })

  it("in a cell with words, makes the table AFTER that cell (the words are never split)", () => {
    const view = fakeView("One two three\n\nFour", 5)
    tableCell(view)
    expect(view.state.doc.toString()).toBe(`One two three\n\n${table}\n\nFour`)
    const head = view.state.selection.main.head
    expect(view.state.sliceDoc(head - 2, head)).toBe("| ")
    expect(cellKindAt(view.state)).toEqual({ kind: "table" })
  })

  it("at an armed bar is the cell the bar opens, the bar gone and the caret in the first header cell", () => {
    const view = fakeView("One\n\nTwo", 4)
    view.dispatch({ effects: armSeam.of(5) })
    tableCell(view)
    expect(view.state.doc.toString()).toBe(`One\n\n${table}\n\nTwo`)
    expect(view.state.field(armedField)).toBeNull()
    expect(view.state.selection.main.head).toBe("One\n\n".length + 2)
  })

  it("in an empty note writes just the table", () => {
    const view = fakeView("", 0)
    tableCell(view)
    expect(view.state.doc.toString()).toBe(table)
    expect(view.state.selection.main.head).toBe(2)
  })
})
