import { describe, expect, it } from "vitest"
import {
  arming, backspaceInEmptyBlock, touchingRuns, cellKey, cellStates, keepsNewlines, opened, previewPlusTarget,
  previewPositions, previewSeams, PREVIEW_GAP_HEIGHT, PREVIEW_SIDE_INSET, PREVIEW_TAIL_HEIGHT,
  PREVIEW_TOP_INSET, returnInBlock, seamAt, seamKey, stillHeld, topRow, type PreviewRow, type SeamID,
} from "../src"
import { positioned } from "../src/markdown/parser"
import { blocks as parsedBlocks } from "../src/markdown/parser"
import { insertBlock, removeBlock, splitBlock, listContinuation } from "../src/cells/editing"
import { deleteCell, editsOver, movingCells } from "../src/cells/commands"
import { replacing, range, substring, type Edit } from "../src/text/range"
import { minimalChange } from "../src/text/diff"

/** The edits applied to a note, back to front as `editsOver` returns them. */
const applying = (edits: Edit[], text: string): string =>
  edits.reduce((out, e) => replacing(out, e.range, e.replacement), text)

const kinds = (note: string): string[] => positioned(note).map(({ block }) =>
  block.kind === "blank" ? `blank(${block.lines})` : block.kind === "paragraph" ? `p:${block.text}` : block.kind)

/** Transcribed from `WriteMindTests/PreviewLayoutTests.swift` (CellBracketTests, TopCellTests, CellSpacingTests). */
describe("where the rendered page puts each cell", () => {
  const rows = (heights: number[]): PreviewRow[] => heights.map((height, id) => ({ id, height }))

  it("gives every cell its place in order", () => {
    const places = previewPositions(rows([20, 30, 10]), 4, 10)
    expect(places.get(0)).toEqual({ top: 10, bottom: 30 })
    expect(places.get(1)).toEqual({ top: 34, bottom: 64 })
    expect(places.get(2)!.top).toBe(68)
  })

  it("is moved by nothing on the drawing layer — there is no argument left to say so", () => {
    const places = previewPositions(rows([20, 20]), 0, 0)
    expect(places.get(0)!.top).toBe(0)
    expect(places.get(1)!.top).toBe(20)
  })

  it("makes every gap the same small one", () => {
    expect(PREVIEW_GAP_HEIGHT).toBeLessThanOrEqual(10)
    expect(PREVIEW_GAP_HEIGHT).toBeGreaterThan(0)
    const places = previewPositions([{ id: 1, height: 40 }, { id: 2, height: 120 }, { id: 3, height: 18 }],
      PREVIEW_GAP_HEIGHT, PREVIEW_TOP_INSET)
    expect(places.get(2)!.top - places.get(1)!.bottom).toBeCloseTo(PREVIEW_GAP_HEIGHT, 3)
    expect(places.get(3)!.top - places.get(2)!.bottom).toBeCloseTo(PREVIEW_GAP_HEIGHT, 3)
  })
})

describe("the cell at the top of the window", () => {
  const places = new Map([
    [0, { top: 20, bottom: 80 }],
    [12, { top: 94, bottom: 180 }],
    [40, { top: 194, bottom: 600 }],
    [90, { top: 614, bottom: 700 }],
  ])

  it("is the first cell at the top of the page", () => {
    expect(topRow(places, 0)).toBe(0)
  })

  it("moves on as the page scrolls past a cell", () => {
    expect(topRow(places, 100)).toBe(12)
    expect(topRow(places, 300)).toBe(40)
    expect(topRow(places, 5_000)).toBe(90)
  })

  it("counts a cell almost at the top as the top one", () => {
    expect(topRow(places, 194)).toBe(40)
    expect(topRow(places, 190)).toBe(40)
    expect(topRow(places, 180)).toBe(12)
  })

  it("stays on the same cell however many times the mode is switched", () => {
    let scroll = 300
    for (let i = 0; i < 4; i++) {
      const cell = topRow(places, scroll)
      expect(cell).toBe(40)
      scroll = places.get(cell ?? 0)?.top ?? 0
    }
  })

  it("has no top cell on an empty page", () => {
    expect(topRow(new Map(), 0)).toBeNull()
  })

  it("finds the cell from an offset inside it", () => {
    const text = "First cell\n\n## A heading\n\nWords under it"
    const cells = positioned(text)
    expect(cells.filter((c) => c.range.location <= 30).at(-1)?.range.location).toBe(26)
    expect(cells.filter((c) => c.range.location <= 0).at(-1)?.range.location).toBe(0)
  })
})

/** Transcribed from `WriteMindTests/PreviewSeamTests.swift`. */
describe("the seams of the rendered page", () => {
  const page: PreviewRow[] = [{ id: 0, height: 40 }, { id: 12, height: 60 }, { id: 30, height: 20 }]
  const top = PREVIEW_TOP_INSET + PREVIEW_GAP_HEIGHT
  const places = () => previewPositions(page, PREVIEW_GAP_HEIGHT, top)

  it("has a seam above every cell and one under the last", () => {
    const out = previewSeams(page, 44, 600)
    expect(out).toHaveLength(4)
    expect(out.map((seam) => seam.offset)).toEqual([0, 12, 30, 44])
  })

  it("makes the first seam the whole top of the page and not just the gap", () => {
    const out = previewSeams(page, 44, 600)
    expect(out[0]!.top).toBe(0)
    expect(out[0]!.bottom).toBe(PREVIEW_TOP_INSET + PREVIEW_GAP_HEIGHT)
  })

  it("makes the seam between two cells the whole space between them", () => {
    const out = previewSeams(page, 44, 600)
    expect(out[1]!.top).toBe(places().get(0)!.bottom)
    expect(out[1]!.bottom).toBe(places().get(12)!.top)
    expect(out[1]!.bottom - out[1]!.top).toBeCloseTo(PREVIEW_GAP_HEIGHT, 3)
  })

  it("runs the tail to the bottom of the page", () => {
    const out = previewSeams(page, 44, 600)
    expect(out.at(-1)!.top).toBe(places().get(30)!.bottom)
    expect(out.at(-1)!.bottom).toBe(600)
  })

  it("still has a tail under the last cell of a note taller than the window", () => {
    const out = previewSeams(page, 44, 100)
    expect(out.at(-1)!.bottom - out.at(-1)!.top).toBe(PREVIEW_TAIL_HEIGHT)
  })

  it("makes an empty note one seam over the whole page, its bar where the first cell lands", () => {
    expect(previewSeams([], 0, 600)).toEqual([
      { top: 0, bottom: 600, offset: 0, line: PREVIEW_TOP_INSET + PREVIEW_GAP_HEIGHT / 2 },
    ])
  })

  it("puts no point inside a cell inside a seam", () => {
    const out = previewSeams(page, 44, 600)
    for (const place of places().values()) {
      for (let y = place.top + 0.5; y < place.bottom; y += 0.5) expect(seamAt(y, out)).toBeNull()
    }
  })

  it("opens the same cells at the same offsets as the markdown pane would", () => {
    const note = "# Title\n\nBody\n\n- one\n- two"
    const cells = positioned(note)
    const rows = cells.map((cell) => ({ id: cell.range.location, height: 30 }))
    expect(previewSeams(rows, note.length, 600).map((seam) => seam.offset))
      .toEqual([...cells.map((cell) => cell.range.location), note.length])
  })

  it("leaves two seams at the same offset after an empty cell at the end, told apart by their place", () => {
    const rows: PreviewRow[] = [{ id: 0, height: 40 }, { id: 11, height: 0 }]
    const out = previewSeams(rows, 11, 600)
    expect(out.filter((seam) => seam.offset === 11)).toHaveLength(2)
    const one: SeamID = { index: 1, offset: 11 }
    const other: SeamID = { index: 2, offset: 11 }
    expect(one).not.toEqual(other)
  })

  it("always has a seam under the last cell for the down arrow to land on", () => {
    for (const note of ["Only cell", "First cell\n\nSecond cell", ""]) {
      const cells = positioned(note)
      const rows = cells.map((cell) => ({ id: cell.range.location, height: 30 }))
      expect(previewSeams(rows, note.length, 600)).toHaveLength(cells.length + 1)
    }
  })

  it("draws the + where the rendered page draws it", () => {
    const seam = { top: 100, bottom: 108, offset: 12, line: 104 }
    const target = previewPlusTarget(seam)
    expect(target.y + target.height / 2).toBeCloseTo(seam.line - seam.top, 3)
    expect(PREVIEW_SIDE_INSET + 2).toBeGreaterThanOrEqual(target.x)
    expect(PREVIEW_SIDE_INSET + 2).toBeLessThanOrEqual(target.x + target.width)
    expect(300).toBeGreaterThan(target.x + target.width)
    expect(target.y).toBeGreaterThanOrEqual(0)
    expect(target.y + target.height).toBeLessThanOrEqual(seam.bottom - seam.top)
  })

  it("makes the hand no wider than the button under it", () => {
    const seam = { top: 100, bottom: 108, offset: 12, line: 104 }
    const target = previewPlusTarget(seam)
    expect(target.x).toBeGreaterThanOrEqual(PREVIEW_SIDE_INSET)
    expect(target.x + target.width).toBeLessThanOrEqual(PREVIEW_SIDE_INSET + 10)
    expect(PREVIEW_SIDE_INSET - 2).toBeLessThan(target.x)
  })
})

/** Transcribed from `PreviewSeamTests.swift` (PreviewSeamKeyTests). */
describe("what a key in an armed seam means", () => {
  it("opens a cell for a printable character and puts it in", () => {
    expect(seamKey({ key: "x" })).toEqual({ kind: "write", text: "x" })
    expect(seamKey({ key: "X", shift: true })).toEqual({ kind: "write", text: "X" })
    expect(seamKey({ key: " " })).toEqual({ kind: "write", text: " " })
    expect(seamKey({ key: "#", shift: true })).toEqual({ kind: "write", text: "#" })
  })

  it("opens an empty one on Return and takes the bar back on Escape", () => {
    expect(seamKey({ key: "Enter" })).toEqual({ kind: "empty" })
    expect(seamKey({ key: "Escape" })).toEqual({ kind: "disarm" })
  })

  it("does not take a shortcut for typing", () => {
    expect(seamKey({ key: "s", meta: true })).toEqual({ kind: "pass" })
    expect(seamKey({ key: "d", ctrl: true })).toEqual({ kind: "pass" })
  })

  it("walks the bar into the cell beside it on an arrow", () => {
    expect(seamKey({ key: "ArrowDown" })).toEqual({ kind: "step", up: false })
    expect(seamKey({ key: "ArrowUp" })).toEqual({ kind: "step", up: true })
  })

  it("does not take a delete, a tab or nothing at all for a character", () => {
    expect(seamKey({ key: "Delete" })).toEqual({ kind: "pass" })
    expect(seamKey({ key: "Backspace" })).toEqual({ kind: "pass" })
    expect(seamKey({ key: "Tab" })).toEqual({ kind: "pass" })
    expect(seamKey({ key: "" })).toEqual({ kind: "pass" })
    expect(seamKey({ key: "Dead" })).toEqual({ kind: "pass" })
    expect(seamKey({ key: "Shift" })).toEqual({ kind: "pass" })
  })

  it("takes one character that is two code units for a character", () => {
    expect(seamKey({ key: "\u{1F600}" })).toEqual({ kind: "write", text: "\u{1F600}" })
  })

  const write = (text: string) => ({ kind: "write", text }) as const

  it("makes a character typed between two cells a cell of its own", () => {
    const out = opened(write("x"), { kind: "text" }, 12, "First cell\n\nSecond cell")
    expect(out?.markdown).toBe("First cell\n\nx\n\nSecond cell")
    expect(out?.editing).toEqual(range(12, 1))
    expect(out?.draft).toBe("x")
    expect(parsedBlocks(out!.markdown).map((b) => b.kind === "paragraph" ? b.text : b.kind))
      .toEqual(["First cell", "x", "Second cell"])
  })

  it("types above the first cell and under the last", () => {
    expect(opened(write("x"), { kind: "text" }, 0, "First cell\n\nSecond cell")?.markdown)
      .toBe("x\n\nFirst cell\n\nSecond cell")
    expect(opened(write("x"), { kind: "text" }, 10, "Only cell\n")?.markdown).toBe("Only cell\n\nx")
    expect(opened(write("x"), { kind: "text" }, 9, "Only cell")?.markdown).toBe("Only cell\n\nx")
    expect(opened(write("x"), { kind: "text" }, 0, "")?.markdown).toBe("x")
  })

  it("leaves every one of a run of empty lines beside a typed cell", () => {
    const note = "baz\n" + "\n".repeat(10) + "# asdf"
    const out = opened(write("x"), { kind: "text" }, 5, note)
    expect(kinds(out!.markdown)).toEqual(["p:baz", "p:x", "blank(8)", "heading"])
  })

  it("opens an empty cell on Return there, with nothing typed in it", () => {
    const out = opened({ kind: "empty" }, { kind: "text" }, 12, "First cell\n\nSecond cell")
    expect(out?.markdown).toBe("First cell\n\n\n\nSecond cell")
    expect(out?.editing).toEqual(range(12, 0))
    expect(out?.draft).toBe("")
  })

  it("adds exactly one cell for one character in any seam of any note", () => {
    const notes = ["", "First cell\n\nSecond cell", "# Title\n\nBody\n\n- one\n- two",
      "baz\n" + "\n".repeat(10) + "# asdf", "Only cell", "Only cell\n"]
    for (const note of notes) {
      const before = kinds(note)
      const cells = positioned(note)
      const rows = cells.map((cell) => ({ id: cell.range.location, height: 30 }))
      const out = previewSeams(rows, note.length, 600)
      expect(out).toHaveLength(before.length + 1)
      out.forEach((seam, index) => {
        const made = opened(write("x"), { kind: "text" }, seam.offset, note)
        const wanted = [...before]
        wanted.splice(index, 0, "p:x")
        expect(kinds(made!.markdown), `seam ${index} of ${JSON.stringify(note)}`).toEqual(wanted)
      })
    }
  })

  it("writes nothing when the bar is only armed and then taken back", () => {
    const note = "First cell\n\nSecond cell"
    const leaving = [{ key: "Escape" }, { key: "ArrowDown" }, { key: "ArrowUp" }, { key: "Delete" },
      { key: "Tab" }, { key: "s", meta: true }]
    for (const key of leaving) {
      expect(opened(seamKey(key), { kind: "text" }, 12, note), key.key).toBeNull()
    }
  })

  it("opens the kind the + chose", () => {
    const out = opened(write("x"), { kind: "heading", level: 1 }, 12, "First cell\n\nSecond cell")
    expect(out?.markdown).toBe("First cell\n\n# x\n\nSecond cell")
    const code = opened({ kind: "empty" }, { kind: "code" }, 12, "First cell\n\nSecond cell")
    expect(code?.fence).not.toBeNull()
    expect(code?.draft).toBe("")
  })
})

/** Transcribed from `ArmedBarTests.swift` (ArmedBarChoiceTests). */
describe("the kind a bar carries", () => {
  it("keeps what the + chose when the same bar is armed again, and drops it anywhere else", () => {
    const bar: SeamID = { index: 1, offset: 12 }
    expect(arming(bar, bar, { kind: "quote" })).toEqual({ kind: "quote" })
    expect(arming(bar, null, { kind: "quote" })).toEqual({ kind: "text" })
    expect(arming(bar, { index: 2, offset: 30 }, { kind: "quote" })).toEqual({ kind: "text" })
  })
})

/** Transcribed from `CellSelectionTests.swift` (HeldCellKeyTests). */
describe("what a key means while cells are held", () => {
  it("replaces what is held with a printable character", () => {
    expect(cellKey({ key: "x" })).toEqual({ kind: "replace", text: "x" })
    expect(cellKey({ key: "X", shift: true })).toEqual({ kind: "replace", text: "X" })
    expect(cellKey({ key: "#", shift: true })).toEqual({ kind: "replace", text: "#" })
  })

  it("takes them on a delete and lets them go on Escape", () => {
    expect(cellKey({ key: "Backspace" })).toEqual({ kind: "remove" })
    expect(cellKey({ key: "Delete" })).toEqual({ kind: "remove" })
    expect(cellKey({ key: "Escape" })).toEqual({ kind: "clear" })
  })

  it("does not take a shortcut for typing", () => {
    expect(cellKey({ key: "Backspace", ctrl: true })).toEqual({ kind: "pass" })
    expect(cellKey({ key: "s", meta: true })).toEqual({ kind: "pass" })
    expect(cellKey({ key: "ArrowDown" })).toEqual({ kind: "pass" })
    expect(cellKey({ key: "" })).toEqual({ kind: "pass" })
  })
})

/** Transcribed from `CellCommandTests.swift` (moving what is held). */
describe("what is still held after a whole-cell command", () => {
  const four = "One\n\nTwo\n\nThree\n\nFour"
  const cells = () => positioned(four).map((block) => block.range)

  it("keeps a moved run held where it landed", () => {
    const run = [cells()[0]!, cells()[1]!]
    const edits = movingCells(run, false, four)
    const moved = applying(edits, four)
    const still = stillHeld(edits.at(-1)!.selection, moved)
    expect(still.map((r) => substring(moved, r))).toEqual(["One", "Two"])
  })

  it("holds nothing after the cells were deleted", () => {
    const edits = editsOver([cells()[0]!, cells()[1]!], four, (span, text) => deleteCell(span, text))
    expect(stillHeld(edits.at(-1)!.selection, applying(edits, four))).toEqual([])
  })
})

/** Transcribed from `WriteMindTests/PreviewEditingTests.swift`. */
describe("the document surgery of the rendered page", () => {
  it("gives a new block between two others a blank line on each side", () => {
    const out = insertBlock("# Title\n\nBody", 9)
    expect(out.markdown).toBe("# Title\n\n\n\nBody")
    expect(out.caret).toBe(9)
    expect(out.markdown.slice(out.caret)).toBe("\n\nBody")
  })

  it("follows the last block with a new one at the end", () => {
    expect(insertBlock("Body", 4)).toEqual({ markdown: "Body\n\n", caret: 6 })
  })

  it("pushes the first block down for a new one at the start", () => {
    expect(insertBlock("Body", 0)).toEqual({ markdown: "\n\nBody", caret: 0 })
  })

  it("keeps every one of a run of empty lines beside a new block", () => {
    const note = "baz\n" + "\n".repeat(10) + "# asdf"
    const out = insertBlock(note, 5)
    expect(out.caret).toBe(5)
    expect(kinds(replacing(out.markdown, range(out.caret, 0), "x")))
      .toEqual(["p:baz", "p:x", "blank(8)", "heading"])
  })

  it("makes a new block in an empty note just the caret", () => {
    expect(insertBlock("", 0)).toEqual({ markdown: "", caret: 0 })
  })

  it("splits a block on Return and edits the tail", () => {
    const out = splitBlock("Top\n\nHello world\n\nBottom", range(5, 11), "Hello", "world")
    expect(out.markdown).toBe("Top\n\nHello\n\nworld\n\nBottom")
    expect(substring(out.markdown, out.editing)).toBe("world")
  })

  it("takes an empty block and its blank lines away on backspace", () => {
    const out = removeBlock("Top\n\n\n\nBottom", range(5, 0))
    expect(out.markdown).toBe("Top\n\nBottom")
    expect(out.previous).toEqual(range(0, 3))
  })

  it("leaves nothing to go back to when the only block is removed", () => {
    const out = removeBlock("\n\n", range(2, 0))
    expect(out.markdown).toBe("")
    expect(out.previous).toBeNull()
  })

  it("carries lists on and ends them on an empty item", () => {
    expect(listContinuation("- one")).toBe("- ")
    expect(listContinuation("  - nested")).toBe("  - ")
    expect(listContinuation("3. three")).toBe("4. ")
    expect(listContinuation("> quoted")).toBe("> ")
    expect(listContinuation("- ")).toBe("")
    expect(listContinuation("2) ")).toBe("")
    expect(listContinuation("plain prose")).toBeNull()
  })
})

// MARK: - The port's own rules for the one-selection page

const type = (text: string, edit: Edit | null): string => {
  if (!edit) throw new Error("no edit")
  return replacing(text, edit.range, edit.replacement)
}

describe("Return in an open block", () => {
  it("starts the next block where the caret is, rewriting only that block", () => {
    const note = "Top\n\nHello world\n\nBottom"
    const edit = returnInBlock(note, range(10, 0))
    expect(type(note, edit)).toBe("Top\n\nHello\n\nworld\n\nBottom")
    // The caret lands at the start of what was in front of it.
    expect(edit!.selection.location).toBe(12)
    // Nothing outside the block moved.
    expect(edit!.range).toEqual(range(5, 11))
  })

  it("leaves an empty block after a block's last word", () => {
    const note = "# Title\n\nBody"
    const edit = returnInBlock(note, range(7, 0))
    expect(type(note, edit)).toBe("# Title\n\n\n\nBody")
    expect(edit!.selection.location).toBe(9)
    // That empty block is a cell of its own, which the caret is in.
    expect(kinds(type(note, edit))).toEqual(["heading", "blank(1)", "p:Body"])
  })

  it("splits a heading and keeps the tail a paragraph", () => {
    const note = "# Title here"
    expect(type(note, returnInBlock(note, range(7, 0)))).toBe("# Title\n\nhere")
  })

  it("replaces a selection by the break", () => {
    const note = "Hello big world"
    expect(type(note, returnInBlock(note, range(5, 4)))).toBe("Hello\n\nworld")
  })

  it("carries a list on", () => {
    const note = "Top\n\n- one\n- two\n\nBottom"
    const edit = returnInBlock(note, range(16, 0))
    expect(type(note, edit)).toBe("Top\n\n- one\n- two\n- \n\nBottom")
    expect(edit!.selection.location).toBe(19)
  })

  it("carries a to-do list on with an empty box", () => {
    const note = "- [x] milk"
    expect(type(note, returnInBlock(note, range(10, 0)))).toBe("- [x] milk\n- [ ] ")
  })

  it("carries a quote on", () => {
    const note = "> said"
    expect(type(note, returnInBlock(note, range(6, 0)))).toBe("> said\n> ")
  })

  it("numbers the next item", () => {
    const note = "1. one\n2. two"
    expect(type(note, returnInBlock(note, range(13, 0)))).toBe("1. one\n2. two\n3. ")
  })

  it("ends a list on an empty item, the next block opening after it", () => {
    const note = "Top\n\n- one\n- two\n- \n\nBottom"
    const edit = returnInBlock(note, range(19, 0))
    expect(type(note, edit)).toBe("Top\n\n- one\n- two\n\n\n\nBottom")
    expect(kinds(type(note, edit))).toEqual(["p:Top", "bullets", "blank(1)", "p:Bottom"])
    expect(edit!.selection.location).toBe(18)
  })

  it("does the plain thing in a code block and on a line that is not a list item", () => {
    expect(returnInBlock("```\nlet x\n```", range(8, 0))).toBeNull()
    expect(returnInBlock("", range(0, 0))).toBeNull()
  })

  it("never touches a character outside the block", () => {
    const note = "A\n\nB B\n\nC"
    const edit = returnInBlock(note, range(4, 0))!
    const before = note.slice(0, edit.range.location)
    const after = note.slice(edit.range.location + edit.range.length)
    expect(before).toBe("A\n\n")
    expect(after).toBe("\n\nC")
  })

  it("absorbs the space a break was typed in front of", () => {
    expect(type("one two", returnInBlock("one two", range(3, 0)))).toBe("one\n\ntwo")
  })
})

describe("Backspace in an empty block", () => {
  it("takes the block and its blank lines away and lands at the end of the one before", () => {
    const note = "Top\n\n\n\nBottom"
    const out = backspaceInEmptyBlock(note, 5)
    expect(out).toEqual({ markdown: "Top\n\nBottom", caret: 3 })
  })

  it("takes a trailing empty line away", () => {
    expect(backspaceInEmptyBlock("# Title\n\n", 9)).toEqual({ markdown: "# Title", caret: 7 })
  })

  it("is not what Backspace on a bar between two cells does", () => {
    expect(backspaceInEmptyBlock("A\n\nB", 2)).toBeNull()
  })

  it("is not what Backspace in a block with words in it does", () => {
    expect(backspaceInEmptyBlock("Top\n\nWords", 8)).toBeNull()
    expect(backspaceInEmptyBlock("Top", 3)).toBeNull()
  })

  it("lands on 0 when the only block goes", () => {
    expect(backspaceInEmptyBlock("\n\n", 2)).toEqual({ markdown: "", caret: 0 })
  })
})

describe("which blocks are open", () => {
  const note = "First\n\nSecond\n\nThird"
  const cells = positioned(note).map((block) => block.range)
  const states = (selection: ReturnType<typeof range>[], holding = false, armed = false) =>
    cellStates(cells, selection, holding, armed)

  it("opens the block the caret is in, at either end of it", () => {
    expect(states([range(8, 0)])).toEqual(["closed", "open", "closed"])
    expect(states([range(7, 0)])).toEqual(["closed", "open", "closed"])
    expect(states([range(13, 0)])).toEqual(["closed", "open", "closed"])
  })

  it("opens none while the caret is on the line between two", () => {
    expect(states([range(6, 0)])).toEqual(["closed", "closed", "closed"])
  })

  it("opens none while the bar is the cursor", () => {
    expect(states([range(7, 0)], false, true)).toEqual(["closed", "closed", "closed"])
  })

  it("keeps a text selection inside one block open, even when it is all of the block's words", () => {
    expect(states([range(7, 6)])).toEqual(["closed", "open", "closed"])
    expect(states([range(8, 3)])).toEqual(["closed", "open", "closed"])
  })

  it("holds a cell whose bracket was clicked, and opens nothing", () => {
    expect(states([range(7, 6)], true)).toEqual(["closed", "held", "closed"])
  })

  it("holds several cells and lets none of them open", () => {
    expect(states([cells[0]!, cells[2]!], true)).toEqual(["held", "closed", "held"])
  })

  it("holds the cells a wider selection covers and opens the two it ends in", () => {
    // From the middle of First to the middle of Third.
    expect(states([range(2, 15)])).toEqual(["open", "held", "open"])
    // Select all: everything is covered, so everything is held.
    expect(states([range(0, note.length)])).toEqual(["held", "held", "held"])
  })

  it("opens a cell for every cursor", () => {
    expect(states([range(2, 0), range(15, 0)])).toEqual(["open", "closed", "open"])
  })
})

describe("keeps newlines", () => {
  it("is the list, the quote and the code", () => {
    const kind = (text: string) => keepsNewlines(positioned(text)[0]?.block)
    expect(kind("- a")).toBe(true)
    expect(kind("- [ ] a")).toBe(true)
    expect(kind("* a")).toBe(true)
    expect(kind("1. a")).toBe(true)
    expect(kind("> a")).toBe(true)
    expect(kind("```\na\n```")).toBe(true)
    expect(kind("plain")).toBe(false)
    expect(kind("# head")).toBe(false)
    expect(keepsNewlines(undefined)).toBe(false)
  })
})

describe("a whole-note rewrite as one change", () => {
  it("is the smallest change between the two", () => {
    expect(minimalChange("abcdef", "abXdef")).toEqual({ from: 2, to: 3, insert: "X" })
    expect(minimalChange("abc", "abc")).toEqual({ from: 3, to: 3, insert: "" })
    expect(minimalChange("", "x")).toEqual({ from: 0, to: 0, insert: "x" })
    expect(minimalChange("Top\n\n\n\nBottom", "Top\n\nBottom")).toEqual({ from: 5, to: 7, insert: "" })
  })
})

describe("cells that touch are one thing to type in", () => {
  // A list carried on by Return: the new "- " is a paragraph of one dash to the parser.
  const note = "Top\n\n- one\n- two\n- \n\nBottom"
  const cells = positioned(note).map((block) => block.range)

  it("reads the list and its new empty item as touching", () => {
    expect(cells).toHaveLength(4)
    expect(touchingRuns(cells).map((run) => [run.first, run.last])).toEqual([[0, 0], [1, 2], [1, 2], [3, 3]])
  })

  it("opens both when the caret is in either", () => {
    expect(cellStates(cells, [range(19, 0)], false, false)).toEqual(["closed", "open", "open", "closed"])
    expect(cellStates(cells, [range(7, 0)], false, false)).toEqual(["closed", "open", "open", "closed"])
  })

  it("does not join cells with a blank line between them", () => {
    const apart = positioned("a\n\nb").map((block) => block.range)
    expect(touchingRuns(apart).map((run) => [run.first, run.last])).toEqual([[0, 0], [1, 1]])
  })
})

describe("the parser's ranges are exact", () => {
  // A block whose last line was the line that STARTED the next block used to take that line's end
  // as its own, so a list carried on by Return overlapped the new item beside it and the page,
  // which opens blocks by range, opened both. (The Swift parser has the same latent overlap.)
  const notes = [
    "Top\n\n- one\n- two\n- \n\nBottom",
    "text\n- item\n> quote\n# heading\n```\ncode\n```\nafter",
    "a\n1. one\n2. two\nb\n* dash\n- [ ] todo\n---\nend",
  ]
  for (const note of notes) {
    it(`never overlaps two blocks: ${JSON.stringify(note).slice(0, 30)}…`, () => {
      const cells = positioned(note)
      for (let i = 1; i < cells.length; i++) {
        expect(cells[i - 1]!.range.location + cells[i - 1]!.range.length, `${i}`).toBeLessThanOrEqual(cells[i]!.range.location)
      }
      for (const cell of cells) expect(cell.range.location + cell.range.length).toBeLessThanOrEqual(note.length)
    })
  }

  it("ends a block at the end of its own last line", () => {
    const cells = positioned("para\n- item")
    expect(cells.map((c) => substring("para\n- item", c.range))).toEqual(["para", "- item"])
  })
})
