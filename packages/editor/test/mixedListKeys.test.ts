import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { history, undo } from "@codemirror/commands"
import { describe, expect, it } from "vitest"
import { foldField } from "../src/fold"
import { itemOpenedField, notebookField } from "../src/notebook"
import { renderedField, setRendered } from "../src/rendered"
import { armedField, armedTypeField, barFromField } from "../src/seams"
import { holdingField } from "../src/preview/hold"
import { awayField } from "../src/preview/away"
import { furniture, listItemBeside } from "../src/preview/furniture"
import { previewBackspace, reminderDelete } from "../src/preview/keys"
import { carryTheListOn } from "../src/keys"

/**
 * THE KEYS IN A LIST THAT MIXES KINDS (Sean, 2026-10-11, of a dashes list with a to-do list straight under it: "this should
 * not be two separate cells"). On the rendered page Backspace at the start of a to-do's words joins them to the item above
 * and Delete at their end pulls the next item's words up — whatever kind that item is, now that it is in the same cell (the
 * key asked for a to-do above and did nothing under a dash). On the markdown side each list Return is its own undo step,
 * as it is on the rendered page and as a plain Return is. The real keys: e2e/suites/cells/22 and 23.
 */

const make = (doc: string, caret: number, rendered = true): EditorView => {
  const box = {
    state: EditorState.create({
      doc, selection: EditorSelection.single(caret),
      extensions: [notebookField, itemOpenedField, foldField, renderedField, holdingField, armedField, armedTypeField, barFromField,
        awayField, furniture, history()],
    }).update({ effects: setRendered.of(rendered) }).state,
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

describe("Backspace at the start of a to-do's words on the rendered page, in a list that mixes kinds", () => {
  it("joins the words to a dash or a number above, the caret at the seam", () => {
    const dash = make("* a\n- [ ] b\n\nend", 10)
    expect(previewBackspace(dash)).toBe(true)
    expect([doc(dash), head(dash)]).toEqual(["* ab\n\nend", 3])
    const number = make("1. a\n- [ ] b", 11)
    expect(previewBackspace(number)).toBe(true)
    expect([doc(number), head(number)]).toEqual(["1. ab", 4])
    // (Under a to-do, as it always did.)
    const todo = make("- [ ] a\n- [ ] b", 14)
    expect(previewBackspace(todo)).toBe(true)
    expect([doc(todo), head(todo)]).toEqual(["- [ ] ab", 7])
  })

  it("takes an EMPTY to-do away, the caret ending the item above, or starting the one below", () => {
    const under = make("* a\n- [ ] \n\nend", 10)
    expect(previewBackspace(under)).toBe(true)
    expect([doc(under), head(under)]).toEqual(["* a\n\nend", 3])
    const over = make("- [ ] \n* b", 6)
    expect(previewBackspace(over)).toBe(true)
    expect([doc(over), head(over)]).toEqual(["* b", 2])
  })

  it("joins nothing across a cell's edge: a rule written `* * *` over a to-do is no item of its list", () => {
    const view = make("* * *\n- [ ] b", 12)
    expect(previewBackspace(view)).toBe(true)
    expect([doc(view), head(view)]).toEqual(["* * *\n- [ ] b", 12])
  })
})

describe("Delete at the end of a to-do's words on the rendered page", () => {
  it("pulls the next item's words up whatever it is marked with, its marker gone", () => {
    for (const [text, want] of [["- [ ] a\n* b", "- [ ] ab"], ["- [ ] a\n1. b", "- [ ] ab"], ["- [ ] a\n- b", "- [ ] ab"], ["- [ ] a\n- [ ] b", "- [ ] ab"]]) {
      const view = make(text!, 7)
      expect(reminderDelete(view), text).toBe(true)
      expect([doc(view), head(view)], text).toEqual([want, 7])
    }
  })
})

describe("listItemBeside", () => {
  it("finds the words of any kind of item next to a line in the same list cell, and nothing outside it", () => {
    const state = make("* dash\n1. one\n- [ ] box\n-\n\nwords", 0).state
    const words = (at: number, there: number): string | null => {
      const found = listItemBeside(state, at, there)
      return found ? state.sliceDoc(found.text.location, found.text.location + found.text.length) : null
    }
    expect(words(14, 0)).toBe("dash")
    expect(words(14, 7)).toBe("one")
    expect(words(0, 14)).toBe("box")
    expect(words(14, 24)).toBe("")
    expect(words(14, 27)).toBeNull()
    expect(listItemBeside(make("* a\n- [ ] b", 0, false).state, 4, 0)).toBeNull()
  })
})

describe("a list Return on the markdown side is its own undo step", () => {
  it("two Returns in a row undo one at a time, however quickly they come (the rendered page's returnInBlock already did)", () => {
    // (The two Returns a moment apart: CodeMirror joins changes that touch within half a second, unless one says not to.)
    const enter = carryTheListOn
    const view = make("* hello\n* how", 13, false)
    expect(enter(view)).toBe(true)
    expect(doc(view)).toBe("* hello\n* how\n* ")
    expect(enter(view)).toBe(true)
    expect(doc(view)).toBe("* hello\n* how\n")
    undo(view)
    expect(doc(view)).toBe("* hello\n* how\n* ")
    undo(view)
    expect(doc(view)).toBe("* hello\n* how")
  })
})
