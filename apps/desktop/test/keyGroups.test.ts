// shared/keyGroups.ts: the Keyboard Shortcuts list (F1) puts the number keys first, as one group (Sean, 2026-10-05), the
// Shift chords beside their digits (docs/PLAN-text-cells.md: Ctrl+Shift+7 Markdown, Ctrl+Shift+8 Runnable code).
import { describe, expect, it } from "vitest"
import { keyList } from "../src/shared/keyList"
import { cellKeysTitle, withNumberKeysFirst } from "../src/shared/keyGroups"

describe("the number keys, grouped first", () => {
  for (const platform of ["win32", "darwin"]) {
    it(`on ${platform}: one group first, 1 … 9 then 0 (each Shift chord after its digit), taken out of their menus, nothing lost`, () => {
      const plain = keyList(platform)
      const grouped = withNumberKeysFirst(plain, platform)
      const first = grouped[0]!
      expect(first.menu).toBe(cellKeysTitle(platform))
      const digits = first.rows.map((row) => row.keys.slice(-1))
      expect(digits).toEqual(["1", "2", "3", "4", "5", "6", "7", "7", "8", "8", "9", "0"])
      expect(first.rows.map((row) => row.keys.includes("Shift"))).toEqual([false, false, false, false, false, false, false, true, false, true, false, false])
      // No number key is left in a menu group, and every row is still listed exactly once.
      for (const group of grouped.slice(1)) for (const row of group.rows) expect(row.keys).not.toMatch(/^(Ctrl|Cmd)\+(Shift\+)?\d$/)
      const ids = (groups: typeof plain) => groups.flatMap((g) => g.rows.map((r) => r.id)).sort()
      expect(ids(grouped)).toEqual(ids(plain))
    })
  }
  it("on Windows the group holds the headings, Text, Markdown, Code Block, Evaluation Cell, Maths Cell and Drawing Cell", () => {
    const first = withNumberKeysFirst(keyList("win32"), "win32")[0]!
    expect(first.menu).toBe("Cell Types — Ctrl (+Shift) + a Number")
    // Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell type.. that should be
    // ctrl + 9 and make ctrl + 10 drawing cells" (the tenth digit key, 0, after 9 as on the keyboard).
    expect(first.rows.slice(6).map((row) => [row.name, row.keys])).toEqual([
      ["Text", "Ctrl+7"], ["Markdown", "Ctrl+Shift+7"], ["Code Block", "Ctrl+8"], ["Evaluation Cell", "Ctrl+Shift+8"],
      ["Maths Cell", "Ctrl+9"], ["Drawing Cell", "Ctrl+0"],
    ])
  })
})
