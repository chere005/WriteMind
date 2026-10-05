// The tablet's sheets as tabs (renderer/sheetSet.ts). Port-only: the Mac has no tablet sheet, so there is no Swift
// test to transcribe; these hold the rules the strip and the keys lean on, and the file read back tolerantly.
import { describe, expect, it } from "vitest"
import {
  addSheet, cleanName, closeSheet, firstSet, MAX_NAME, MAX_SHEETS, nextSheetName, parseSheets, renameSheet,
  selectSheet, serialiseSheets, stepSheet, type SheetSet, type StoredSheets,
} from "../src/renderer/sheetSet"
import { DEFAULT_PAPER } from "../src/renderer/tabletPaper"

const three = (): SheetSet => addSheet(addSheet(firstSet("a"), "b"), "c")
const names = (set: SheetSet) => set.tabs.map((tab) => tab.name)

describe("sheet tabs", () => {
  it("starts with one sheet, open", () => {
    expect(firstSet("a")).toEqual({ tabs: [{ id: "a", name: "Sheet 1" }], current: "a" })
  })

  it("+ adds Sheet 2, Sheet 3 at the end and opens it", () => {
    const set = three()
    expect(names(set)).toEqual(["Sheet 1", "Sheet 2", "Sheet 3"])
    expect(set.current).toBe("c")
  })

  it("names a new sheet one past the highest Sheet N, ignoring renamed ones", () => {
    expect(nextSheetName([{ id: "a", name: "Maths" }])).toBe("Sheet 1")
    expect(nextSheetName([{ id: "a", name: "Sheet 1" }, { id: "b", name: "Sheet 7" }, { id: "c", name: "Sheet 7b" }])).toBe("Sheet 8")
    // The last one closed: its number comes back.
    expect(names(addSheet(closeSheet(three(), "c"), "d"))).toEqual(["Sheet 1", "Sheet 2", "Sheet 3"])
  })

  it("adds nothing past the limit or with an id that is taken", () => {
    let set = firstSet("s0")
    for (let i = 1; i < MAX_SHEETS + 5; i++) set = addSheet(set, `s${i}`)
    expect(set.tabs).toHaveLength(MAX_SHEETS)
    const same = three()
    expect(addSheet(same, "b")).toBe(same)
    expect(addSheet(same, "")).toBe(same)
  })

  it("closing the open sheet opens its right-hand neighbour, else the left", () => {
    const set = selectSheet(three(), "b")
    expect(closeSheet(set, "b")).toEqual({ tabs: [{ id: "a", name: "Sheet 1" }, { id: "c", name: "Sheet 3" }], current: "c" })
    expect(closeSheet(three(), "c").current).toBe("b")
    // Another sheet closed: the open one stays open.
    expect(closeSheet(three(), "a").current).toBe("c")
  })

  it("never closes the last sheet (it is cleared instead)", () => {
    const one = firstSet("a")
    expect(closeSheet(one, "a")).toBe(one)
    expect(closeSheet(three(), "nope")).toEqual(three())
  })

  it("renames with a clean name; an empty one changes nothing", () => {
    const set = three()
    expect(names(renameSheet(set, "b", "  Maths\n  notes "))).toEqual(["Sheet 1", "Maths notes", "Sheet 3"])
    expect(renameSheet(set, "b", "   ")).toBe(set)
    expect(renameSheet(set, "zz", "X")).toBe(set)
    expect(cleanName("x".repeat(100))).toHaveLength(MAX_NAME)
    expect(cleanName(42)).toBeNull()
  })

  it("selects only a sheet that is there", () => {
    const set = three()
    expect(selectSheet(set, "a").current).toBe("a")
    expect(selectSheet(set, "nope")).toBe(set)
    expect(selectSheet(set, "c")).toBe(set)
  })

  it("next and previous go round the end", () => {
    let set = selectSheet(three(), "a")
    set = stepSheet(set, 1); expect(set.current).toBe("b")
    set = stepSheet(set, 1); expect(set.current).toBe("c")
    set = stepSheet(set, 1); expect(set.current).toBe("a")
    set = stepSheet(set, -1); expect(set.current).toBe("c")
    const one = firstSet("a")
    expect(stepSheet(one, 1)).toBe(one)
  })
})

describe("sheets on disk", () => {
  const stored: StoredSheets = {
    current: "b",
    sheets: [
      { id: "a", name: "Sheet 1", paper: DEFAULT_PAPER, strokes: [] },
      {
        id: "b", name: "Maths", paper: { kind: "lines", spacing: "large", colour: "dark" },
        strokes: [
          { colorHex: "#2D7DD2", width: 2.123456, points: [{ x: 0.123456789, y: 0.5 }, { x: 0.25, y: 0.75 }], pressures: [0.31234, 0.9] },
          { colorHex: "#000000", width: 4, points: [{ x: 1, y: 0 }] },
        ],
      },
    ],
  }

  it("round-trips the sheets, their paper and ink, and the open one", () => {
    const back = parseSheets(serialiseSheets(stored))!
    expect(back.current).toBe("b")
    expect(back.sheets.map((sheet) => [sheet.id, sheet.name])).toEqual([["a", "Sheet 1"], ["b", "Maths"]])
    expect(back.sheets[1]!.paper).toEqual({ kind: "lines", spacing: "large", colour: "dark" })
    const [first, second] = back.sheets[1]!.strokes
    expect(first!.points[0]!.x).toBeCloseTo(0.1235, 9)
    expect(first!.width).toBeCloseTo(2.123, 9)
    expect(first!.pressures).toEqual([0.312, 0.9])
    expect(second).toEqual({ colorHex: "#000000", width: 4, points: [{ x: 1, y: 0 }] })
  })

  it("writes points flat and short", () => {
    const text = serialiseSheets(stored)
    expect(JSON.parse(text).sheets[1].strokes[0].p).toEqual([0.1235, 0.5, 0.25, 0.75])
    expect(JSON.parse(text).version).toBe(1)
  })

  it("reads garbage as nothing, so the caller keeps what it has", () => {
    for (const text of [null, "", "{", "[]", "42", '{"sheets":7}', '{"sheets":[]}', '{"sheets":[5, null, "x"]}']) {
      expect(parseSheets(text), String(text)).toBeNull()
    }
  })

  it("drops what is broken and keeps the rest", () => {
    const back = parseSheets(JSON.stringify({
      current: "gone",
      sheets: [
        {
          id: "a", name: "", paper: { kind: "wallpaper" },
          strokes: [
            { c: "red", w: -3, p: [0.1, 0.2, 2, -1], r: [0.5] },
            { c: "#123456", w: 3, p: [0.1, 0.2, 0.3] },
            { c: "#123456", w: 3, p: [0.1, "x"] },
            "nonsense",
          ],
        },
        { id: "a", name: "Twin" },
        { name: "No id" },
      ],
    }))!
    expect(back.current).toBe("a")
    expect(back.sheets.map((sheet) => sheet.name)).toEqual(["Sheet 1", "Twin", "No id"])
    expect(new Set(back.sheets.map((sheet) => sheet.id)).size).toBe(3)
    expect(back.sheets[0]!.paper).toEqual(DEFAULT_PAPER)
    // The colour and width fall back, the points are kept on the sheet, a pressure list of the wrong length goes.
    expect(back.sheets[0]!.strokes).toEqual([{ colorHex: "#2D7DD2", width: 2, points: [{ x: 0.1, y: 0.2 }, { x: 1, y: 0 }] }])
    expect(back.sheets[1]!.strokes).toEqual([])
  })

  it("keeps at most the limit of sheets", () => {
    const many = { sheets: Array.from({ length: MAX_SHEETS + 10 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, strokes: [] })) }
    expect(parseSheets(JSON.stringify(many))!.sheets).toHaveLength(MAX_SHEETS)
  })
})
