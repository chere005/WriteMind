import { describe, expect, it } from "vitest"
import { kindLabel, kindMenuItems } from "../src/renderer/kindMenu"

/** The Style button's words (docs/PLAN-bars-2026-10.md P1): the caret's cell kind, and the menu's check on it. */
describe("the Style button's label", () => {
  it("names every kind of the menu", () => {
    expect(kindLabel(null)).toBe("Text")
    expect(kindLabel({ kind: "text" })).toBe("Text")
    expect(kindLabel({ kind: "heading", level: 1 })).toBe("Title")
    expect(kindLabel({ kind: "heading", level: 6 })).toBe("Author")
    expect(kindLabel({ kind: "heading", level: 5 })).toBe("Subsubsection")
    expect(kindLabel({ kind: "list", style: "dashes" })).toBe("Dashes")
    expect(kindLabel({ kind: "list", style: "todo" })).toBe("To-do")
    expect(kindLabel({ kind: "quote" })).toBe("Quote")
    expect(kindLabel({ kind: "markdown" })).toBe("Markdown")
    expect(kindLabel({ kind: "code" })).toBe("Code")
    expect(kindLabel({ kind: "evaluation", evaluator: "python" })).toBe("Runnable code")
    expect(kindLabel({ kind: "maths" })).toBe("Maths")
    expect(kindLabel({ kind: "ink" })).toBe("Drawing")
  })

  it("names the cells the menu does not offer (a table, a picture) when the caret is in one", () => {
    expect(kindLabel({ kind: "table" })).toBe("Table")
    expect(kindLabel({ kind: "picture", line: "![](x.png)" })).toBe("Picture")
  })

  it("the menu ticks exactly the caret's kind, whichever evaluator a runnable cell uses", () => {
    const ticked = (kind: Parameters<typeof kindMenuItems>[1]) =>
      kindMenuItems("darwin", kind, () => undefined).filter((item) => typeof item === "object" && "label" in item && item.checked).map((item) => (item as { label: string }).label)
    expect(ticked({ kind: "heading", level: 3 })).toEqual(["Section"])
    expect(ticked({ kind: "evaluation", evaluator: "rust" })).toEqual(["Runnable code"])
    expect(ticked({ kind: "list", style: "numbered" })).toEqual(["Numbered"])
    expect(ticked({ kind: "table" })).toEqual([])
    expect(ticked(null)).toEqual([])
  })
})
