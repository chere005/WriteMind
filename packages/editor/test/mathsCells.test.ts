import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, undo } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { MARKDOWN_MARKER, blocks, escapePlain } from "@writemind/core"
import { fence, mathsCell, textCell } from "../src/keys"
import { notebookField } from "../src/notebook"
import { armedField } from "../src/seams"
import { textCells } from "../src/textCells"

/**
 * THE MATHS CELL'S KEYS in the editor (Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a
 * math cell type.. that should be ctrl + 9"): Ctrl+9 makes or converts one, Ctrl+7 and Ctrl+8 turn one back, and each
 * is ONE undo step. The rules themselves are core's (packages/core/test/mathsCells.test.ts); the typesetting when the
 * caret leaves, and the real keys, are e2e/suites/cells/07-maths-cell.mjs.
 */

const make = (doc: string, at = 0, head = at): EditorState => EditorState.create({
  doc, selection: EditorSelection.single(at, head), extensions: [notebookField, armedField, history(), textCells],
})

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
const doc = (view: EditorView) => view.state.doc.toString()
const caret = (view: EditorView) => view.state.selection.main.head

describe("Ctrl+9, the maths cell", () => {
  it("on a text cell's words: the cell becomes a maths cell (escapes out), the caret in its source; ONE undo gives it back", () => {
    const text = "Intro\n\nIntegrate\\[x^2, {x, 0, 1}] \\* 2\n\nEnd"
    const view = fakeView(make(text, text.indexOf("x^2")))
    expect(mathsCell(view)).toBe(true)
    expect(doc(view)).toBe("Intro\n\n```wl\nIntegrate[x^2, {x, 0, 1}] * 2\n```\n\nEnd")
    expect(doc(view).slice(caret(view), caret(view) + 3)).toBe("x^2")
    undo(view)
    expect(doc(view)).toBe(text)
  })

  it("on an empty line: a new empty maths cell, its own cell, the caret inside", () => {
    const view = fakeView(make("a\n\n\n\nb", 3))
    mathsCell(view)
    expect(doc(view)).toBe("a\n\n```wl\n\n```\n\nb")
    expect(caret(view)).toBe("a\n\n```wl\n".length)
  })

  it("in an emptied markdown cell: the maths cell takes its place, marker and all", () => {
    const text = `a\n\n${MARKDOWN_MARKER}\n\n\nb`
    const view = fakeView(make(text, `a\n\n${MARKDOWN_MARKER}\n`.length))
    mathsCell(view)
    expect(blocks(doc(view)).map((one) => one.kind)).toEqual(["paragraph", "code", "paragraph"])
    expect(doc(view)).not.toContain(MARKDOWN_MARKER)
    expect(doc(view).slice(caret(view) - 6, caret(view))).toBe("```wl\n")
  })

  it("in a maths cell: nothing; in a code block: its fence becomes ```wl", () => {
    const maths = "```wl\nx^2\n```"
    const view = fakeView(make(maths, 7))
    expect(mathsCell(view)).toBe(true)
    expect(doc(view)).toBe(maths)
    const code = fakeView(make("```python\nx^2\n```", 11))
    mathsCell(code)
    expect(doc(code)).toBe(maths)
    undo(code)
    expect(doc(code)).toBe("```python\nx^2\n```")
  })
})

describe("back from a maths cell", () => {
  const maths = "a\n\n```wl\nx*y + z\n```\n\nb"
  const inside = maths.indexOf("y +")

  it("Ctrl+7: a text cell of its source, PURE plain text (escaped, never typeset); ONE undo", () => {
    const view = fakeView(make(maths, inside))
    textCell(view)
    expect(doc(view)).toBe(`a\n\n${escapePlain("x*y + z")}\n\nb`)
    expect(blocks(doc(view))[1]).toEqual({ kind: "paragraph", text: "x*y + z" })
    undo(view)
    expect(doc(view)).toBe(maths)
  })

  it("Ctrl+8: a Wolfram Language code block of the same source; ONE undo; Ctrl+9 makes it maths again", () => {
    const view = fakeView(make(maths, inside))
    fence(view)
    expect(doc(view)).toBe("a\n\n```wolfram\nx*y + z\n```\n\nb")
    undo(view)
    expect(doc(view)).toBe(maths)
    fence(view)
    mathsCell(view)
    expect(doc(view)).toBe(maths)
  })

  it("Ctrl+7 on a text cell stays what it was (PURE plain text: Ctrl+7 never makes maths)", () => {
    const text = "Integrate\\[x^2, {x, 0, 1}]"
    const view = fakeView(make(text, 3))
    textCell(view)
    expect(doc(view)).toBe(text)
  })
})
