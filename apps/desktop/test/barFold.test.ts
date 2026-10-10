import { describe, expect, it } from "vitest"
import {
  ALL_SECTIONS, barParts, foldAt, foldFor, hasMore, neededWidth, type BarSections, type FoldLevel,
} from "../src/renderer/barFold"
import { migrateCollapsed, sectionsAway, TOOL_GROUPS } from "../src/renderer/toolGroups"

/**
 * The bar's fold ladder (docs/PLAN-bars-2026-10.md P1): a pure function of the width. The widths are the bar's own CSS;
 * e2e/suites/chrome/12-toolbar-fold.mjs holds the real row to them at 460 / 560 / 640 / 760.
 */

const ids = (level: FoldLevel, sections: BarSections = ALL_SECTIONS) => barParts(level, sections).map((part) => part.id)

describe("the fold ladder", () => {
  it("shows everything from about 660px up (the plan says 700 to be safe: it must at least fit there)", () => {
    expect(foldFor(760)).toBe(0)
    expect(foldFor(700)).toBe(0)
    expect(neededWidth(0, ALL_SECTIONS)).toBeLessThanOrEqual(700)
  })

  it("folds the inserts and the section moves first, and nothing else", () => {
    expect(foldFor(640)).toBe(1)
    expect(foldFor(560)).toBe(1)
    expect(ids(1)).not.toContain("table")
    expect(ids(1)).not.toContain("secup")
    expect(ids(1)).toContain("list")
    expect(ids(1)).toContain("style")
    expect(foldAt(1)).toEqual({ inserts: true, blocks: false, glyph: false })
  })

  it("then list, quote and code: the 460px pane of the wireframe is Style, B I U S, Aa, the pen and the dots", () => {
    expect(foldFor(460)).toBe(2)
    expect(ids(2)).toEqual(["style", "air1", "bold", "italic", "underline", "strike", "font", "grow", "pen", "more"])
    expect(barParts(2, ALL_SECTIONS).find((part) => part.id === "style")!.width).toBe(110)
  })

  it("last turns the Style button into its glyph, far below the narrowest pane the bar is held to", () => {
    expect(foldFor(340)).toBe(3)
    expect(barParts(3, ALL_SECTIONS).find((part) => part.id === "style")!.width).toBe(28)
    expect(neededWidth(2, ALL_SECTIONS)).toBeLessThan(460)
    expect(neededWidth(2, ALL_SECTIONS)).toBeGreaterThan(340)
  })

  it("never needs more width as it folds (each level is narrower than the one before)", () => {
    const widths = ([0, 1, 2, 3] as const).map((level) => neededWidth(level, ALL_SECTIONS))
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(widths[i - 1]!)
  })

  it("is monotone: a narrower bar never folds LESS", () => {
    let last = 0
    for (let width = 900; width >= 300; width -= 5) {
      const level = foldFor(width)
      expect(level).toBeGreaterThanOrEqual(last)
      last = level
    }
  })

  it("picks the least folded level that fits, to the pixel", () => {
    for (const level of [1, 2, 3] as const) {
      const need = neededWidth((level - 1) as FoldLevel, ALL_SECTIONS)
      expect(foldFor(need)).toBe(level - 1)
      expect(foldFor(need - 1)).toBe(level)
    }
  })

  it("holds at 460px: the row at that level fits in 460 with room to spare", () => {
    expect(neededWidth(foldFor(460), ALL_SECTIONS)).toBeLessThanOrEqual(460)
  })

  it("the ⋯ button is there only when something SHOWN has folded into it", () => {
    expect(hasMore(0, ALL_SECTIONS)).toBe(false)
    expect(hasMore(1, ALL_SECTIONS)).toBe(true)
    expect(hasMore(2, ALL_SECTIONS)).toBe(true)
    expect(ids(0)).not.toContain("more")
    expect(ids(1)).toContain("more")
    // the Style button's glyph is not "folded": nothing moved
    expect(hasMore(1, { ...ALL_SECTIONS, insert: false })).toBe(false)
    expect(hasMore(3, { ...ALL_SECTIONS, insert: false })).toBe(true)
    expect(hasMore(3, { ...ALL_SECTIONS, insert: false, blocks: false })).toBe(false)
  })

  it("a section put away takes no width and folds nothing (it is shown only in the checklist)", () => {
    const noInserts = { ...ALL_SECTIONS, insert: false }
    expect(ids(0, noInserts)).not.toContain("table")
    expect(ids(0, noInserts)).not.toContain("secup")
    expect(foldFor(520, noInserts)).toBeLessThan(foldFor(520) + 1)
    expect(foldFor(470, noInserts)).toBe(0)
    expect(foldFor(470)).toBe(1)
    expect(ids(1, noInserts)).not.toContain("more")
    const noPen = { ...ALL_SECTIONS, pen: false }
    expect(ids(0, noPen)).not.toContain("pen")
    expect(neededWidth(0, noPen)).toBe(neededWidth(0, ALL_SECTIONS) - 44 - 2)
  })

  it("keeps a 12px air between groups and none at the ends", () => {
    const parts = barParts(0, ALL_SECTIONS)
    expect(parts[0]!.id).toBe("style")
    expect(parts.filter((part) => part.id.startsWith("air"))).toHaveLength(4)
    expect(parts.filter((part) => part.id.startsWith("air")).every((part) => part.width === 12)).toBe(true)
  })

  it("is the same row a bar with no sections draws: the spacer alone", () => {
    const none: BarSections = { text: false, blocks: false, insert: false, pen: false }
    expect(ids(0, none)).toEqual(["grow"])
    expect(foldFor(100, none)).toBe(0)
  })
})

describe("the four sections of the bar", () => {
  it("are Text, Blocks, Insert and Pen", () => {
    expect(TOOL_GROUPS.map((group) => group.id)).toEqual(["text", "blocks", "insert", "pen"])
    expect(TOOL_GROUPS.map((group) => group.title)).toEqual(["Text", "Blocks", "Insert", "Pen"])
  })

  it("carry what was put away in the six old sections: each one new section is away when ALL its old ones were", () => {
    expect(migrateCollapsed(["style"])).toEqual(["text"])
    expect(migrateCollapsed(["structure"])).toEqual(["blocks"])
    expect(migrateCollapsed(["capture"])).toEqual(["pen"])
    // Insert took three old ones (Insert, Maths, Flow Chart): one of them put away is not the whole of Insert away
    expect(migrateCollapsed(["maths"])).toEqual([])
    expect(migrateCollapsed(["insert", "maths"])).toEqual([])
    expect(migrateCollapsed(["insert", "maths", "flowchart"])).toEqual(["insert"])
  })

  it("migrates only the old ids (an old Insert is not the new one: the four are kept under their own key)", () => {
    expect(migrateCollapsed(["nonsense", "text"])).toEqual([])
    expect(migrateCollapsed([])).toEqual([])
    expect(migrateCollapsed(["style", "structure", "insert", "maths", "flowchart", "capture"])).toEqual(["text", "blocks", "insert", "pen"])
  })

  it("reads the remembered four as the ids it knows, in the bar's order", () => {
    expect(sectionsAway(["pen", "text", "nonsense"])).toEqual(["text", "pen"])
    expect(sectionsAway(null)).toEqual([])
    expect(sectionsAway("text")).toEqual([])
  })
})
