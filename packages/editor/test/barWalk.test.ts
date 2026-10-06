import { EditorSelection, EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { pictureMarkdown } from "@writemind/core"
import {
  barCaret, cellAtCaret, cellBeside, sameLineOnScreen, seamBeneath, shownBeyond, sideMove, verticalMove,
} from "../src/barWalk"
import { foldField, foldSection, hiddenNow } from "../src/fold"
import { notebook, notebookField } from "../src/notebook"

/**
 * The arrows walk cell, bar, cell on the markdown side (Sean, 2026-10-05: "pressing down arrow at the bottom of a cell
 * should move the cursor beneath the cell horizontally"). The rules as answers about a state; the view's half (the
 * line on screen, the column kept) is held by C:\GIT\WriteMindCross\e2e\suites\cells\04-arrows-to-bar.mjs.
 */

const make = (doc: string, anchor = 0, head = anchor): EditorState =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [notebookField, foldField] })

/** No line wraps here: the line on screen is the line of the note. */
const lines = (state: EditorState) => (head: number, edge: number) => state.doc.lineAt(head).number === state.doc.lineAt(edge).number

const down = (state: EditorState, armed: number | null = null) => verticalMove(state, armed, false, lines(state))
const up = (state: EditorState, armed: number | null = null) => verticalMove(state, armed, true, lines(state))

const fold = (state: EditorState, title: string): EditorState => {
  const section = notebook(state).sections.find((s) => state.sliceDoc(s.headingRange.location, s.headingRange.location + s.headingRange.length).includes(title))
  if (!section) throw new Error(`no section ${title}`)
  return state.update({ effects: foldSection.of({ key: section.key, folded: true }) }).state
}

describe("Down at the bottom of a cell", () => {
  const doc = "Alpha one\nalpha two\n\nBeta\n\nGamma"
  const beta = doc.indexOf("Beta")
  const gamma = doc.indexOf("Gamma")

  it("arms the bar beneath the cell from its last line, the caret on the blank line the bar stands on", () => {
    expect(down(make(doc, doc.indexOf("two")))).toEqual({ kind: "arm", offset: beta, caret: beta - 1 })
  })

  it("is the editor's own arrow on any other line of the cell", () => {
    expect(down(make(doc, 3))).toBeNull()
  })

  it("arms the bar after the last cell at the end of the note", () => {
    expect(down(make(doc, gamma + 2))).toEqual({ kind: "arm", offset: doc.length, caret: doc.length })
    // A note that ends in a newline: the same bar, after the last cell.
    const ended = doc + "\n"
    expect(down(make(ended, gamma))).toEqual({ kind: "arm", offset: ended.length, caret: ended.length })
  })

  it("arms the seam between two cells that touch, the caret waiting at the cell below", () => {
    const touching = "# Title\nRight under it\n\nNext"
    const under = touching.indexOf("Right")
    expect(down(make(touching, 3))).toEqual({ kind: "arm", offset: under, caret: under })
    expect(up(make(touching, under + 4))).toEqual({ kind: "arm", offset: under, caret: under })
  })

  it("counts only the closing fence of a code block as its bottom, and a blank line in it is no seam", () => {
    const code = "```js\nlet x = 1\n\nlet y = 2\n```\n\nAfter"
    expect(down(make(code, code.indexOf("let x")))).toBeNull()
    expect(down(make(code, code.indexOf("\n\nlet y") + 1))).toBeNull()
    expect(down(make(code, code.indexOf("let y")))).toBeNull()
    const after = code.indexOf("After")
    expect(down(make(code, code.lastIndexOf("```")))).toEqual({ kind: "arm", offset: after, caret: after - 1 })
    expect(up(make(code, code.indexOf("let x")))).toBeNull()
    expect(up(make(code, 2))).toEqual({ kind: "arm", offset: 0, caret: 0 })
  })

  it("takes a list and a table whole: only the last item, the last row, is the bottom", () => {
    const list = "- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEnd"
    const table = list.indexOf("| a")
    expect(down(make(list, 2))).toBeNull()
    expect(down(make(list, list.indexOf("two")))).toEqual({ kind: "arm", offset: table, caret: table - 1 })
    expect(down(make(list, list.indexOf("|---")))).toBeNull()
    const end = list.indexOf("End")
    expect(down(make(list, list.indexOf("| 1")))).toEqual({ kind: "arm", offset: end, caret: end - 1 })
    expect(up(make(list, list.indexOf("| a") + 2))).toEqual({ kind: "arm", offset: table, caret: table - 1 })
  })

  it("arms the seam between an evaluation cell and its answer, the seam a click arms there", () => {
    const pair = "```python\n1+1\n```\n\n```out\n2\n```"
    const out = pair.indexOf("```out")
    expect(down(make(pair, pair.indexOf("```\n\n")))).toEqual({ kind: "arm", offset: out, caret: out - 1 })
    expect(barCaret(make(pair), out)).toBe(out - 1)
  })

  it("declines a selection, and several carets", () => {
    expect(down(make(doc, 0, 4))).toBeNull()
    const two = EditorState.create({
      doc, selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(beta)]),
      extensions: [notebookField, foldField],
    })
    expect(verticalMove(two, null, false, lines(two))).toBeNull()
  })

  it("is the editor's own arrow on a line between cells with no bar up (one put out with Escape)", () => {
    expect(down(make(doc, beta - 1))).toBeNull()
  })
})

describe("an arrow from an armed bar", () => {
  const doc = "Alpha one\nalpha two\n\nBeta\n\nGamma"
  const beta = doc.indexOf("Beta")
  const gamma = doc.indexOf("Gamma")

  it("goes down to the start of the cell below and up to the end of the cell above", () => {
    const at = make(doc, beta - 1)
    expect(down(at, beta)).toEqual({ kind: "caret", at: beta, cell: { location: beta, length: 4 } })
    expect(up(at, beta)).toEqual({ kind: "caret", at: beta - 2, cell: { location: 0, length: beta - 2 } })
  })

  it("stays at the two ends of the note", () => {
    expect(up(make(doc, 0), 0)).toEqual({ kind: "stay" })
    expect(down(make(doc, doc.length), doc.length)).toEqual({ kind: "stay" })
    // ...and from the bar after the last cell, Up is the end of that cell.
    expect(up(make(doc, doc.length), doc.length)).toEqual({ kind: "caret", at: doc.length, cell: { location: gamma, length: 5 } })
  })

  it("Left and Right go to the end of the cell above and the start of the cell below", () => {
    expect(sideMove(make(doc, beta - 1), beta, true)).toEqual({ kind: "caret", at: beta - 2, cell: { location: 0, length: beta - 2 } })
    expect(sideMove(make(doc, beta - 1), beta, false)).toEqual({ kind: "caret", at: beta, cell: { location: beta, length: 4 } })
    expect(sideMove(make(doc, 0), 0, true)).toEqual({ kind: "stay" })
    expect(sideMove(make(doc, 3), null, true)).toBeNull()
  })
})

describe("picture and ink cells are never typed in", () => {
  const picture = pictureMarkdown("cafe0123cafe0123.png")
  const doc = `Above\n\n${picture}\n\nBelow`
  const at = doc.indexOf(picture)
  const below = doc.indexOf("Below")

  it("an arrow onto one from a bar arms the bar on its far side", () => {
    expect(down(make(doc, at - 1), at)).toEqual({ kind: "arm", offset: below, caret: below - 1 })
    expect(up(make(doc, below - 1), below)).toEqual({ kind: "arm", offset: at, caret: at - 1 })
  })

  it("an arrow with the caret beside one arms the bar on the side it points to", () => {
    expect(down(make(doc, at))).toEqual({ kind: "arm", offset: below, caret: below - 1 })
    expect(up(make(doc, at + picture.length))).toEqual({ kind: "arm", offset: at, caret: at - 1 })
  })

  it("Left and Right at a bar beside one step over it too, to the bar on its far side", () => {
    expect(sideMove(make(doc, at - 1), at, false)).toEqual({ kind: "arm", offset: below, caret: below - 1 })
    expect(sideMove(make(doc, below - 1), below, true)).toEqual({ kind: "arm", offset: at, caret: at - 1 })
  })

  it("touching the cell above, it is still a cell of its own", () => {
    const touching = `Words\n${picture}\n\nAfter`
    const pic = touching.indexOf(picture)
    expect(down(make(touching, 2))).toEqual({ kind: "arm", offset: pic, caret: pic })
    const after = touching.indexOf("After")
    expect(down(make(touching, pic), pic)).toEqual({ kind: "arm", offset: after, caret: after - 1 })
  })
})

describe("a closed section is stepped over as one", () => {
  const doc = "# Open\n\nWords\n\n# Closed\n\nhidden one\n\nhidden two\n\n# After\n\nTail"
  const closedAt = doc.indexOf("# Closed")
  const after = doc.indexOf("# After")

  it("Down from the closed heading arms the seam after what it hides, never a caret in it", () => {
    const state = fold(make(doc, closedAt + 3), "Closed")
    expect(hiddenNow(state).length).toBe(1)
    const move = down(state)
    expect(move).toMatchObject({ kind: "arm", offset: after })
    const hidden = hiddenNow(state)[0]!
    const caret = (move as { caret: number }).caret
    expect(caret <= hidden.location || caret >= hidden.location + hidden.length).toBe(true)
  })

  it("from the bar under it, Up goes to the heading and Down to the next cell", () => {
    const state = fold(make(doc, after), "Closed")
    expect(up(state, after)).toEqual({ kind: "caret", at: closedAt + "# Closed".length, cell: { location: closedAt, length: 8 } })
    expect(down(state, after)).toMatchObject({ kind: "caret", at: after })
  })

  it("a cell that starts right where the hidden part ends is on show", () => {
    const touching = "# Closed\nhidden\n# Next\n\nTail"
    const state = fold(make(touching, 3), "Closed")
    const next = touching.indexOf("# Next")
    const cells = notebook(state).cells
    const closed = cells.findIndex((c) => c.range.location === 0)
    expect(cells[shownBeyond(state, cells, closed, 1)]!.range.location).toBe(next)
    expect(seamBeneath(state, closed)).toBe(next)
    expect(cellBeside(state, next, false)!.range.location).toBe(next)
  })
})

describe("cells of empty lines", () => {
  // Five blank lines: the first and last separate, the three between are a cell the note holds on purpose.
  const doc = "P\n\n\n\n\n\nQ"
  const q = doc.indexOf("Q")

  it("are cells on the markdown side, walked through like any other", () => {
    const state = make(doc, 0)
    const blank = notebook(state).cells.find((c) => c.block.kind === "blank")!
    expect(blank).toBeDefined()
    const toBlank = down(state)
    expect(toBlank).toEqual({ kind: "arm", offset: blank.range.location, caret: 2 })
    expect(down(make(doc, 2), blank.range.location)).toMatchObject({ kind: "caret", at: blank.range.location })
    expect(down(make(doc, q - 1), q)).toMatchObject({ kind: "caret", at: q })
  })

  it("are passed over on the rendered page, which draws none", () => {
    expect(cellBeside(make(doc), 2, false, false)!.range.location).toBe(q)
    expect(cellBeside(make(doc), q, true, false)!.range.location).toBe(0)
  })
})

describe("the caret at a cell", () => {
  it("is in the cell up to the end of its last line, and in none on a line between", () => {
    const doc = "One\n\nTwo"
    expect(cellAtCaret(make(doc), 3)?.cell.range.location).toBe(0)
    expect(cellAtCaret(make(doc), 4)).toBeNull()
    expect(cellAtCaret(make(doc), 5)?.index).toBe(1)
  })
})

describe("one line on screen", () => {
  it("is the same top, or a middle inside the other's height (a tall inline formula)", () => {
    expect(sameLineOnScreen({ top: 10, bottom: 30 }, { top: 10.5, bottom: 30 })).toBe(true)
    expect(sameLineOnScreen({ top: 4, bottom: 40 }, { top: 12, bottom: 30 })).toBe(true)
    expect(sameLineOnScreen({ top: 10, bottom: 30 }, { top: 30, bottom: 50 })).toBe(false)
  })
})
