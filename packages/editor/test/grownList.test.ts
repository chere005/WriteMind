import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, undo } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { cellKindAt } from "../src/cellKind"
import { foldField } from "../src/fold"
import { list } from "../src/keys"
import { grownCell, itemOpenedField, notebook, notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armedField, armedTypeField, barFromField } from "../src/seams"

/**
 * A LIST CHOSEN ON THE LINE A NEWLINE GREW (Sean, 2026-10-11: "the input cursor should go to where it is typing when inserting a
 * checklist or bullets"; the rule is core `listOnGrownLine`): under a cell that is not a list it is the cell the bar under that
 * cell opens — a cell of its own, a blank line between, the caret in its item — not a second cell touching the first (drawn
 * apart on the rendered page, hugging on the markdown side); under a numbered list Numbered counts on. One Undo gives the grown
 * line back. The real keys on both pages: e2e/suites/editor/10..12 (`_listItems.mjs`).
 */
function fakeView(doc: string, caret: number): EditorView {
  const box = {
    state: EditorState.create({
      doc, selection: EditorSelection.single(caret),
      extensions: [notebookField, itemOpenedField, foldField, renderedField, armedField, armedTypeField, barFromField, history()],
    }),
    dom: { classList: { contains: () => false } },
    dispatch(spec: TransactionSpec | Transaction) {
      box.state = spec instanceof Transaction ? spec.state : box.state.update(spec).state
    },
    focus() {},
  }
  return box as unknown as EditorView
}

const doc = (view: EditorView): string => view.state.doc.toString()
const head = (view: EditorView): number => view.state.selection.main.head

describe("a list chosen on the line a newline grew", () => {
  it("under a text cell is a cell of its own under it, as the bar would open it, named by the Style button", () => {
    for (const [style, marker, label] of [["dots", "- ", "dots"], ["todo", "- [ ] ", "todo"], ["numbered", "1. ", "numbered"]] as const) {
      const view = fakeView("Alpha\n\n\nBeta", 6)
      expect(grownCell(view.state), "the caret is on the grown line").not.toBeNull()
      expect(list(style)(view)).toBe(true)
      expect(doc(view), style).toBe(`Alpha\n\n${marker}\n\nBeta`)
      expect(head(view), style).toBe(7 + marker.length)
      expect(notebook(view.state).cells.length, `${style}: three cells, apart`).toBe(3)
      expect(cellKindAt(view.state), style).toEqual({ kind: "list", style: label })
      undo(view)
      expect(doc(view), "one Undo gives the grown line back").toBe("Alpha\n\n\nBeta")
      expect(head(view)).toBe(6)
    }
  })

  it("under a heading, at the note's end, the same", () => {
    const view = fakeView("# Title\n", 8)
    expect(list("dashes")(view)).toBe(true)
    expect(doc(view)).toBe("# Title\n\n* ")
    expect(head(view)).toBe(11)
  })

  it("under a numbered list counts on from its last number (it wrote `1. `)", () => {
    const view = fakeView("1. a\n2. b\n\n\nnext", 10)
    expect(list("numbered")(view)).toBe(true)
    expect(doc(view)).toBe("1. a\n2. b\n3. \n\nnext")
    expect(head(view)).toBe(13)
    expect(notebook(view.state).cells.length, "the list's own cell still").toBe(2)
  })

  it("under a list is that list's next item otherwise, the list's own command", () => {
    const view = fakeView("- one\n\n\nBeta", 6)
    expect(list("dots")(view)).toBe(true)
    expect(doc(view)).toBe("- one\n- \n\nBeta")
    expect(notebook(view.state).cells.length).toBe(2)
  })
})
