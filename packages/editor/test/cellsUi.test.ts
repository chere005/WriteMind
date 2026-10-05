import { EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { describe, expect, it } from "vitest"
import { foldField } from "../src/fold"
import { notebookField } from "../src/notebook"
import { renderedField } from "../src/rendered"
import { armAt, armedField, armedTypeField, armSeam, openBarForWriting, openCellAt } from "../src/seams"
import { makesCellAfter } from "../src/dock"
import { fence, heading, list, quote } from "../src/keys"
import { tagFence } from "../src/extras"
import { holdingField } from "../src/preview/hold"

/**
 * The cells-ui lane (Sean, 2026-10-05): a click in a seam ARMS it, always (`armAt`, two cells that touch included);
 * a bar armed by hand survives a transaction that only names the selection it had; the + menu and every command that
 * MAKES a cell make it now, with the caret in it, at the armed bar on either page (the Mac's `atArmedBar`) or after the
 * caret's cell (`makesCellAfter`).
 */

const extensions: Extension = [notebookField, foldField, renderedField, holdingField, armedField, armedTypeField]

/** Enough of an EditorView for the commands: the state, a dispatch that applies, focus, and the root's classes. */
function fakeView(doc: string, anchor = 0): EditorView & { focused: number } {
  const box = {
    state: EditorState.create({ doc, selection: EditorSelection.cursor(anchor), extensions }),
    focused: 0,
    dom: { classList: { contains: () => false } },
    dispatch(spec: TransactionSpec) { box.state = box.state.update(spec).state },
    focus() { box.focused++ },
  }
  return box as unknown as EditorView & { focused: number }
}

const armed = (view: EditorView) => view.state.field(armedField)
const caret = (view: EditorView) => view.state.selection.main.head

describe("armAt (a click in a seam)", () => {
  it("puts the caret on the blank line between two cells and arms the bar there", () => {
    const view = fakeView("Alpha\n\nBeta", 0)
    armAt(view, 7)
    expect(armed(view)).toBe(7)
    expect(caret(view)).toBe(6)
  })

  it("arms the bar between two cells that TOUCH (no blank line), the caret waiting at the offset", () => {
    const doc = "# Title\nWords under it"
    const view = fakeView(doc, 2)
    armAt(view, doc.indexOf("Words"))
    expect(armed(view)).toBe(doc.indexOf("Words"))
    expect(caret(view)).toBe(doc.indexOf("Words"))
  })

  it("arms the two ends of the note", () => {
    const view = fakeView("Alpha\n\nBeta", 3)
    armAt(view, 0)
    expect([armed(view), caret(view)]).toEqual([0, 0])
    armAt(view, 11)
    expect([armed(view), caret(view)]).toEqual([11, 11])
  })
})

describe("a bar armed by hand", () => {
  const doc = "# Title\nWords under it"
  const at = doc.indexOf("Words")

  it("stays up through a transaction that names the selection it already had (a focus, a page switch)", () => {
    const view = fakeView(doc, 0)
    armAt(view, at)
    view.dispatch({ selection: view.state.selection })
    expect(armed(view)).toBe(at)
  })

  it("goes when the caret moves, and when the pointer's own selection lands (even on the same place)", () => {
    const view = fakeView(doc, 0)
    armAt(view, at)
    view.dispatch({ selection: { anchor: at + 1 } })
    expect(armed(view)).toBeNull()
    armAt(view, at)
    view.dispatch({ selection: { anchor: at }, userEvent: "select.pointer" })
    expect(armed(view)).toBeNull()
  })
})

describe("the + menu's choice makes the cell now", () => {
  it("a quote at the bar between two cells, the caret after its marker", () => {
    const view = fakeView("One\n\nTwo", 0)
    openCellAt(view, 5, { kind: "quote" })
    expect(view.state.doc.toString()).toBe("One\n\n> \n\nTwo")
    expect(caret(view)).toBe(7)
    expect(armed(view)).toBeNull()
  })

  it("body text: an empty cell of its own, the caret on its line", () => {
    const view = fakeView("One\n\nTwo", 0)
    openCellAt(view, 5, { kind: "text" })
    expect(view.state.doc.toString()).toBe("One\n\n\n\nTwo")
    expect(caret(view)).toBe(5)
    expect(armed(view)).toBeNull()
  })

  it("a code block at the end of the note, the caret on the line inside the fences", () => {
    const view = fakeView("One", 0)
    openCellAt(view, 3, { kind: "code" })
    expect(view.state.doc.toString()).toBe("One\n\n```\n\n```")
    expect(caret(view)).toBe(9)
  })
})

describe("commands that name a kind, at an armed bar on the MARKDOWN side", () => {
  const D = "One\n\nTwo"
  const atBar = () => { const view = fakeView(D, 0); armAt(view, 5); return view }

  it("Quote makes a quote cell there (not '> ' glued to the blank line)", () => {
    const view = atBar()
    quote(view)
    expect(view.state.doc.toString()).toBe("One\n\n> \n\nTwo")
    expect(caret(view)).toBe(7)
    expect(view.focused).toBeGreaterThan(0)
  })

  it("a heading, a list and a code block likewise", () => {
    let view = atBar()
    heading(1)(view)
    expect(view.state.doc.toString()).toBe("One\n\n# \n\nTwo")
    view = atBar()
    list("dashes")(view)
    expect(view.state.doc.toString()).toMatch(/^One\n\n[-*] \n\nTwo$/)
    view = atBar()
    fence(view)
    expect(view.state.doc.toString()).toBe("One\n\n```\n\n```\n\nTwo")
    expect(caret(view)).toBe(9)
  })

  it("a code block in a language: made at the bar, then tagged, the caret inside", () => {
    const view = atBar()
    tagFence("python")(view)
    expect(view.state.doc.toString()).toBe("One\n\n```python\n\n```\n\nTwo")
    expect(view.state.doc.lineAt(caret(view)).text).toBe("")
    expect(caret(view)).toBe(15)
  })
})

describe("Code Block in a cell with words (no bar, nothing selected)", () => {
  it("makes a new code cell AFTER the caret's cell, the caret in it", () => {
    const view = fakeView("Hello world\n\nNext", 3)
    fence(view)
    expect(view.state.doc.toString()).toBe("Hello world\n\n```\n\n```\n\nNext")
    expect(caret(view)).toBe(17)
  })

  it("at the end of the note too", () => {
    const view = fakeView("Hello", 5)
    fence(view)
    expect(view.state.doc.toString()).toBe("Hello\n\n```\n\n```")
    expect(caret(view)).toBe(11)
  })

  it("round a selection it still fences what is selected", () => {
    const view = fakeView("Hello world", 0)
    view.dispatch({ selection: { anchor: 0, head: 5 } })
    fence(view)
    expect(view.state.doc.toString()).toBe("```\nHello\n```\n world")
  })

  it("makesCellAfter leaves an empty line to `otherwise`", () => {
    const view = fakeView("A\n\n", 3)
    let asked = 0
    makesCellAfter({ kind: "code" }, () => { asked++; return true })(view)
    expect(asked).toBe(1)
  })
})

describe("openBarForWriting (maths at a bar)", () => {
  it("opens a body-text cell at the bar so what is written lands in it", () => {
    const view = fakeView("One\n\nTwo", 0)
    armAt(view, 5)
    expect(openBarForWriting(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("One\n\n\n\nTwo")
    expect(caret(view)).toBe(5)
    expect(armed(view)).toBeNull()
  })

  it("does nothing with no bar up", () => {
    const view = fakeView("One\n\nTwo", 1)
    expect(openBarForWriting(view)).toBe(false)
    expect(view.state.doc.toString()).toBe("One\n\nTwo")
  })
})
