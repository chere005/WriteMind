// THE THREE 2026-10-11 LIST RULES TOGETHER (WriteMind 3.10.0). Each came from its own branch with its own tests; these are
// where they meet. Sean, 2026-10-11: "this should not be two separate cells" (touching lists of any kinds are one cell),
// "the input cursor should go to where it is typing when inserting a checklist or bullets" (a marker alone with its space is
// an empty item), "ctrl + enter adds a newline without leaving the current cell.." (an item's next lines, `<br>` for an empty one).
import { describe, expect, it } from "vitest"
import { itemNumbers, linesOf, listItemsOf, listStyleOfLine, positioned, isListBlock } from "../src/markdown/parser"
import { range } from "../src/text/range"
import { lineInCell } from "../src/cells/lineInCell"
import { returnInItem } from "../src/cells/itemLines"
import { wolframPlan } from "../src/export/wolfram/plan"

const CARET = "‸"
const split = (note: string) => ({ text: note.replace(CARET, ""), at: note.indexOf(CARET) })
const ctrlEnter = (note: string): string => {
  const { text, at } = split(note)
  const made = lineInCell(positioned(text), linesOf(text), range(at, 0))
  if (made.kind === "none") throw new Error("Ctrl+Enter did nothing")
  const after = text.slice(0, made.from) + made.insert + text.slice(made.to)
  return after.slice(0, made.caret) + CARET + after.slice(made.caret)
}
const ret = (note: string): string => {
  const { text, at } = split(note)
  const made = returnInItem(positioned(text), linesOf(text), range(at, 0))
  if (!made) throw new Error("Return was not the item's")
  const after = text.slice(0, made.from) + made.insert + text.slice(made.to)
  return after.slice(0, made.caret) + CARET + after.slice(made.caret)
}
// Words typed on an empty line of a list item: the editor takes the `<br>` away in the same transaction (editor emptyLines.ts:
// every line of a list item is a line of its own already).
const type = (note: string, words: string): string => note.replace(/<br>‸/, CARET).replace(CARET, words + CARET)
const items = (note: string) => {
  const cells = positioned(note.replace(CARET, ""))
  expect(cells).toHaveLength(1)
  const block = cells[0]!.block
  expect(isListBlock(block)).toBe(true)
  return isListBlock(block) ? listItemsOf(block).map((one) => [one.style, one.text]) : []
}

describe("touching lists, empty items and Ctrl+Enter's next lines, together", () => {
  it("an item's next line in a mixed list stays that item's, and the list stays one cell", () => {
    const note = type(ctrlEnter("* dash‸\n1. one\n- [ ] box"), "more")
    expect(note.replace(CARET, "")).toBe("* dash\n  more\n1. one\n- [ ] box")
    expect(items(note)).toEqual([["dashes", "dash\nmore"], ["numbered", "one"], ["todo", "box"]])
  })

  it("an empty line kept under a number, in a mixed list: one cell, and the number is the item's, not the line's", () => {
    const note = ctrlEnter("- dot\n1. one‸\n2. two").replace(CARET, "")
    expect(items(note)).toEqual([["dots", "dot"], ["numbered", "one\n"], ["numbered", "two"]])
    // The numbers drawn count items: the kept line between `1.` and `2.` is no item and starts nothing.
    const itemLines = note.split("\n").filter((line) => listStyleOfLine(line) !== null)
    expect(itemNumbers(itemLines.map(listStyleOfLine))).toEqual([0, 1, 2])
  })

  it("Return after Ctrl+Enter's line adds the next item of THAT item's kind, in the same mixed cell", () => {
    const afterBox = ret(type(ctrlEnter("* dash\n- [ ] box‸"), "detail"))
    expect(afterBox.replace(CARET, "")).toBe("* dash\n- [ ] box\n      detail\n- [ ] ")
    expect(items(afterBox).map(([style]) => style)).toEqual(["dashes", "todo", "todo"])
    const afterDash = ret(type(ctrlEnter("1. one\n* dash‸"), "detail"))
    expect(afterDash.replace(CARET, "")).toBe("1. one\n* dash\n  detail\n* ")
    expect(items(afterDash).map(([style]) => style)).toEqual(["numbered", "dashes", "dashes"])
  })

  it("an empty item opened under another kind of list (the Style menu's To-do on the line under a dash) is that list's", () => {
    expect(items("* hello\n* how\n- [ ] ")).toEqual([["dashes", "hello"], ["dashes", "how"], ["todo", ""]])
    expect(items("* hello\n- ")).toEqual([["dashes", "hello"], ["dots", ""]])
  })

  it("the Wolfram notebook gives a mixed list with next lines one cell per item, numbers counted by item", () => {
    const cells = wolframPlan("* dash\n  more\n1. one\n   <br>\n2. two", { inks: {}, bands: [], column: 700 }, new Map(), "file").cells
      .map((cell) => cell.pieces.map((piece) => (typeof piece === "string" ? piece : "")).join(""))
    expect(cells).toHaveLength(3)
    expect(cells[0]).toContain("dash\\nmore")
    expect(cells[1]).toContain("CounterAssignments")
    expect(cells[2]).not.toContain("CounterAssignments")
  })
})
