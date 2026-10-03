import { describe, expect, it } from "vitest"
import {
  copyCell, deleteCell, duplicateCell, editsOver, moveCell, movingCells, pasteCell, positioned,
  replacing, substring, type Edit, type Range,
} from "../src/index"

/** Transcribed from `WriteMindTests/CellCommandTests.swift`. */
const note = "First cell\n\nSecond cell\n\nThird cell"
const four = "One\n\nTwo\n\nThree\n\nFour"

const cell = (index: number, text = note): Range => positioned(text)[index]!.range
const apply = (change: Edit | null, text: string) =>
  change ? replacing(text, change.range, change.replacement) : text
const applyAll = (edits: Edit[], text: string) =>
  edits.reduce((out, change) => replacing(out, change.range, change.replacement), text)
const deleting = (picked: Range[], text: string) =>
  applyAll(editsOver(picked, text, (span, whole) => deleteCell(span, whole)), text)

describe("delete", () => {
  it("closes the stack behind the cell", () => {
    expect(apply(deleteCell(cell(1), note), note)).toBe("First cell\n\nThird cell")
  })
  it("takes the blank line above the last cell", () => {
    expect(apply(deleteCell(cell(2), note), note)).toBe("First cell\n\nSecond cell")
  })
  it("leaves nothing of the only cell", () => {
    const one = "The only cell"
    expect(apply(deleteCell(cell(0, one), one), one)).toBe("")
  })
  it("lands the caret where the cell was", () => {
    expect(deleteCell(cell(0), note).selection).toEqual({ location: 0, length: 0 })
  })
})

describe("copy, duplicate and paste", () => {
  it("copies a cell as its own markdown", () => {
    expect(copyCell(cell(1), note)).toBe("Second cell")
  })
  it("duplicates under the cell", () => {
    expect(apply(duplicateCell(cell(0), note), note))
      .toBe("First cell\n\nFirst cell\n\nSecond cell\n\nThird cell")
  })
  it("pastes a cell in as a cell, left selected", () => {
    const change = pasteCell("## A heading", cell(0), note)
    const after = apply(change, note)
    expect(after).toBe("First cell\n\n## A heading\n\nSecond cell\n\nThird cell")
    expect(substring(after, change.selection)).toBe("## A heading")
  })
})

describe("move", () => {
  it("up swaps with the cell above", () => {
    expect(apply(moveCell(cell(1), true, note), note)).toBe("Second cell\n\nFirst cell\n\nThird cell")
  })
  it("down swaps with the cell below", () => {
    expect(apply(moveCell(cell(1), false, note), note)).toBe("First cell\n\nThird cell\n\nSecond cell")
  })
  it("keeps the selection on the cell that moved", () => {
    const change = moveCell(cell(1), true, note)!
    expect(substring(apply(change, note), change.selection)).toBe("Second cell")
  })
  it("has nowhere to go at the ends", () => {
    expect(moveCell(cell(0), true, note)).toBeNull()
    expect(moveCell(cell(2), false, note)).toBeNull()
  })
  it("keeps whatever separated them", () => {
    const spaced = "One\n\n\nTwo"
    expect(apply(moveCell(cell(1, spaced), true, spaced), spaced)).toBe("Two\n\n\nOne")
  })
  it("moves a heading with its own markdown", () => {
    const text = "## Title\n\nWords"
    expect(apply(moveCell(cell(1, text), true, text), text)).toBe("Words\n\n## Title")
  })
  it("moves a run of cells as one", () => {
    const run = { location: cell(1).location, length: cell(2).location + cell(2).length - cell(1).location }
    expect(apply(moveCell(run, true, note), note)).toBe("Second cell\n\nThird cell\n\nFirst cell")
  })
})

describe("several cells at once", () => {
  const cells = positioned(four).map((block) => block.range)

  it("comes back back to front", () => {
    const edits = editsOver([cells[0]!, cells[2]!], four, (s, t) => deleteCell(s, t))
    expect(edits).toHaveLength(2)
    expect(edits[0]!.range.location).toBeGreaterThan(edits[1]!.range.location)
  })
  it("leaves the cells between two that are not neighbours", () => {
    expect(deleting([cells[0]!, cells[2]!], four)).toBe("Two\n\nFour")
  })
  it("closes the stack behind three", () => {
    expect(deleting([cells[0]!, cells[1]!, cells[2]!], four)).toBe("Four")
  })
  it("takes the blank line above a run at the end", () => {
    expect(deleting([cell(1), cell(2)], note)).toBe("First cell")
  })
  it("takes a cell handed in twice once", () => {
    expect(deleting([cell(1), cell(1)], note)).toBe("First cell\n\nThird cell")
  })
  it("reads a range over several cells as all of them", () => {
    const whole = { location: cell(0).location, length: cell(1).location + cell(1).length }
    expect(deleting([whole], note)).toBe("Third cell")
  })
  it("duplicates a run under itself", () => {
    expect(applyAll(editsOver([cell(0), cell(1)], note, (s, t) => duplicateCell(s, t)), note))
      .toBe("First cell\n\nSecond cell\n\nFirst cell\n\nSecond cell\n\nThird cell")
  })
  it("does nothing for an empty selection", () => {
    expect(editsOver([], note, (s, t) => deleteCell(s, t))).toEqual([])
  })
})

describe("moving what is held", () => {
  it("writes nothing twice for cells with holes in them", () => {
    const five = "A\n\nB\n\nC\n\nD\n\nE"
    const c = positioned(five).map((block) => block.range)
    expect(applyAll(movingCells([c[0]!, c[2]!, c[4]!], false, five), five)).toBe("B\n\nA\n\nD\n\nC\n\nE")
  })
  it("moves two neighbours as one run", () => {
    const c = positioned(four).map((block) => block.range)
    expect(applyAll(movingCells([c[0]!, c[1]!], false, four), four)).toBe("Three\n\nOne\n\nTwo\n\nFour")
  })
})
