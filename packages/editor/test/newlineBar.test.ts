import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, insertNewlineAndIndent, undo, undoDepth, redo } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { cellAtCaret } from "../src/barWalk"
import { cellKindAt } from "../src/cellKind"
import { foldField } from "../src/fold"
import { grownCell, itemOpenedField, notebook, notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armedField, armedTypeField, armSeam, barFromField, openArmed, returnClosesTheCell } from "../src/seams"
import { holdingField, setHolding } from "../src/preview/hold"
import { typesetBlocks } from "../src/math"

/**
 * THE SECOND NEWLINE ARMS THE BAR (Sean, 2026-10-11: "a single newline grows all those contents.. the second newline should
 * make the cursor horizontal with the +, not start the next cell"; the rule is core newline.ts, `newlineBar.test.ts` there).
 * What the editor adds: the first Return grows EVERY kind of cell (the Style button names it, the cell's range runs down to
 * the line), the second ends it — one transaction that takes the grown line out and puts the bar under the cell, with its own
 * undo step — and typing at that bar opens the next cell. The real key on the real page, both pages, is
 * e2e/suites/cells/20-newline-bar.mjs.
 */

const make = (doc: string, caret = doc.length, extra: Array<unknown> = []): EditorView => {
  const box = {
    state: EditorState.create({
      doc, selection: EditorSelection.single(caret),
      extensions: [notebookField, itemOpenedField, foldField, renderedField, holdingField, armedField, armedTypeField, barFromField, history(), ...extra as []],
    }),
    dom: { classList: { contains: () => false } },
    dispatch(spec: TransactionSpec | Transaction) {
      box.state = spec instanceof Transaction ? spec.state : box.state.update(spec).state
    },
    focus() {},
  }
  return box as unknown as EditorView
}

/** The first Return as the markdown side does it: a newline, and the item's marker in a list (the rest of the app's keys, applied). */
function firstReturn(view: EditorView, carry = ""): void {
  const head = view.state.selection.main.head
  if (carry === "") insertNewlineAndIndent(view)
  else view.dispatch({ changes: { from: head, insert: "\n" + carry }, selection: EditorSelection.cursor(head + 1 + carry.length), userEvent: "input" })
}

const doc = (view: EditorView): string => view.state.doc.toString()
const armed = (view: EditorView): number | null => view.state.field(armedField)
const head = (view: EditorView): number => view.state.selection.main.head

interface Kind { name: string; cell: string; carry?: string; label: string }
const KINDS: Kind[] = [
  { name: "a text cell", cell: "hello", label: "text" },
  { name: "a markdown cell", cell: "<!-- markdown -->\nsome **words**", label: "markdown" },
  { name: "a heading", cell: "# Title", label: "heading" },
  { name: "a rule", cell: "---", label: "" },
  { name: "a list", cell: "- one", carry: "- ", label: "list" },
  { name: "a numbered list", cell: "1. one\n2. two", carry: "3. ", label: "list" },
  { name: "a to-do list", cell: "- [ ] one", carry: "- [ ] ", label: "list" },
  { name: "a quote", cell: "> quoted", carry: "> ", label: "quote" },
  { name: "a code block's closing fence", cell: "```\nx\n```", label: "code" },
  { name: "a maths cell", cell: "```wl\nx^2\n```", label: "maths" },
  { name: "a table", cell: "| a | b |\n|---|---|\n| 1 | 2 |", carry: "|  |  |", label: "table" },
]

describe("the first Return grows every kind of cell, and the second ends it with the bar", () => {
  for (const kind of KINDS) {
    for (const tail of ["", "\n\nworld"]) {
      describe(`${kind.name}${tail ? " with a cell below" : " at the end of the note"}`, () => {
        const start = kind.cell + tail
        const grow = (): EditorView => {
          const view = make(start, kind.cell.length)
          // (A table's Return is the table's own key; the empty row is what it writes, so the test writes it the same way.)
          firstReturn(view, kind.carry ?? "")
          return view
        }

        it("the first Return: the caret is on the new line and the cell has taken it, named by the Style button, no bar", () => {
          const view = grow()
          expect(armed(view)).toBeNull()
          const label = cellKindAt(view.state)?.kind ?? ""
          expect(label).toBe(kind.label)
          if (!kind.carry) {
            const grown = grownCell(view.state)
            expect(grown, doc(view)).not.toBeNull()
            expect(grown!.cell.range.location).toBe(0)
            expect(grown!.line.location).toBe(head(view))
            // The arrows read the cell as running down to the line.
            expect(cellAtCaret(view.state, head(view))?.cell.range.length).toBe(head(view) - 0)
          } else {
            // (A list's item, a quote's line, a table's row is the cell's own already.)
            const cell = notebook(view.state).cells[0]!.range
            expect(cell.location + cell.length).toBe(head(view))
          }
        })

        it("the second Return: the grown line goes, the bar is up under the cell, the note is as it was", () => {
          const view = grow()
          expect(returnClosesTheCell(view)).toBe(true)
          expect(doc(view)).toBe(start)
          const cell = notebook(view.state).cells[0]!
          const bar = armed(view)
          expect(bar).not.toBeNull()
          // Under the cell: the next cell's start, or the end of the note.
          expect(bar).toBe(tail ? start.length - "world".length : start.length)
          // The caret waits where the bar stands — on the blank line it stands on, else at the offset — and no cell is lit by it.
          expect(head(view)).toBe(tail ? cell.range.location + cell.range.length + 1 : start.length)
          expect(cellKindAt(view.state)).toEqual({ kind: "text" })
          expect(grownCell(view.state)).toBeNull()
        })

        it("typing at that bar opens the next cell after it", () => {
          const view = grow()
          returnClosesTheCell(view)
          expect(openArmed(view, "x")).toBe(true)
          expect(armed(view)).toBeNull()
          const cells = notebook(view.state).cells
          expect(doc(view).startsWith(kind.cell + "\n\nx")).toBe(true)
          expect(doc(view)).toBe(kind.cell + "\n\nx" + (tail ? "\n\nworld" : ""))
          expect(cells.map((one) => one.block.kind).length).toBeGreaterThanOrEqual(2)
        })

        it("ONE Undo takes the arming back to the grown cell, the next takes the newline back", () => {
          const view = grow()
          const grown = doc(view)
          const caret = head(view)
          returnClosesTheCell(view)
          undo(view)
          expect(doc(view)).toBe(grown)
          expect(head(view)).toBe(caret)
          expect(armed(view)).toBeNull()
          undo(view)
          expect(doc(view)).toBe(start)
          expect(head(view)).toBe(kind.cell.length)
          // Redo walks it forward again, the bar up at the end.
          redo(view)
          redo(view)
          expect(doc(view)).toBe(start)
        })
      })
    }
  }
})

describe("the second Return is its own undo step, however soon it comes", () => {
  it("is not joined to the newline before it", () => {
    const view = make("hello", 5)
    firstReturn(view)
    const depth = undoDepth(view.state)
    returnClosesTheCell(view)
    expect(undoDepth(view.state)).toBe(depth + 1)
  })
})

describe("the second Return stands down where Return is somebody else's", () => {
  it("with a bar already up (that Return opens an empty cell), a selection, held cells, or a note that cannot be written to", () => {
    const grown = (): EditorView => { const view = make("hello\n\nworld", 5); firstReturn(view); return view }
    const up = grown()
    up.dispatch({ effects: armSeam.of(8) })
    expect(returnClosesTheCell(up)).toBe(false)
    const selected = grown()
    selected.dispatch({ selection: EditorSelection.range(6, 5) })
    expect(returnClosesTheCell(selected)).toBe(false)
    const held = grown()
    held.dispatch({ effects: setHolding.of(true) })
    expect(returnClosesTheCell(held)).toBe(false)
    const readOnly = make("hello\n", 6, [EditorState.readOnly.of(true)])
    expect(returnClosesTheCell(readOnly)).toBe(false)
    // (On the words, on the lone blank line between two cells, nothing to end.)
    expect(returnClosesTheCell(make("hello", 5))).toBe(false)
    expect(returnClosesTheCell(make("hello\n\nworld", 6))).toBe(false)
  })
})

describe("the bar the second Return puts up", () => {
  it("is the one an arrow would have put there: the caret waits on the blank line, Escape gives the caret back at the cell's end", () => {
    const view = make("hello\n\nworld", 5)
    firstReturn(view)
    returnClosesTheCell(view)
    expect(armed(view)).toBe(7)
    expect(head(view)).toBe(6)
    expect(view.state.field(barFromField)).toBe(5)
  })

  it("under a cell that touches the next (no blank line to wait on) is armed by hand at the next cell's start", () => {
    const view = make("# Title\nbody", 7)
    firstReturn(view)
    // (Return at the end of a heading with a cell touching it makes the lone blank line: that line is the bar's already.)
    expect(armed(view)).toBe(9)
    expect(returnClosesTheCell(view)).toBe(false)
  })

  it("at the end of a note that ends with its newline is the bar under the last cell, at the end", () => {
    const view = make("hello\n", 5)
    firstReturn(view)
    expect(doc(view)).toBe("hello\n\n")
    returnClosesTheCell(view)
    expect(doc(view)).toBe("hello\n")
    expect(armed(view)).toBe(6)
    expect(head(view)).toBe(6)
  })
})

describe("a list, a quote or a table is ended by its empty item, and never with nothing above it", () => {
  it("a list with a single empty item (just opened) is not ended by the rule: nothing is under it", () => {
    expect(returnClosesTheCell(make("one\n\n- ", 7))).toBe(false)
    expect(returnClosesTheCell(make("one\n\n> ", 7))).toBe(false)
  })

  it("an empty item in the middle of a list is not the end of it", () => {
    expect(returnClosesTheCell(make("- one\n- \n- three", 8))).toBe(false)
  })

  it("an empty last item of a list followed by a cell: the bar goes between the two", () => {
    const view = make("- one\n- two\n\nbody", 11)
    firstReturn(view, "- ")
    expect(doc(view)).toBe("- one\n- two\n- \n\nbody")
    expect(cellKindAt(view.state)).toEqual({ kind: "list", style: "dots" })
    expect(notebook(view.state).cells[0]!.range).toEqual({ location: 0, length: 14 })
    returnClosesTheCell(view)
    expect(doc(view)).toBe("- one\n- two\n\nbody")
    expect(armed(view)).toBe(13)
  })
})

describe("beside a picture the bar goes on that side", () => {
  const picture = "![](a.png)"
  it("after it the bar goes under, before it above, and the note is untouched", () => {
    const text = `intro\n\n${picture}\n\noutro`
    const after = make(text, 7 + picture.length)
    expect(returnClosesTheCell(after)).toBe(true)
    expect(doc(after)).toBe(text)
    expect(armed(after)).toBe(text.length - "outro".length)
    const before = make(text, 7)
    expect(returnClosesTheCell(before)).toBe(true)
    expect(doc(before)).toBe(text)
    expect(armed(before)).toBe(7)
  })
})

describe("a maths cell the newline grew", () => {
  const cell = "```wl\nx^2\n```"

  it("stays source while the caret is on its new line (the caret is in it), and is typeset when the bar is up or the caret is elsewhere", () => {
    const view = make(cell + "\n\nafter", cell.length)
    expect(typesetBlocks(view.state)).toHaveLength(0)
    firstReturn(view)
    expect(typesetBlocks(view.state)).toHaveLength(0)
    returnClosesTheCell(view)
    expect(armed(view)).not.toBeNull()
    expect(typesetBlocks(view.state)).toHaveLength(1)
    // (A caret in the words below the cell: the cell is drawn.)
    const away = make(cell + "\n\nafter", cell.length + 4)
    expect(typesetBlocks(away.state)).toHaveLength(1)
  })
})
