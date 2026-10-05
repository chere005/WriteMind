// shared/keyGroups.ts: the Keyboard Shortcuts list (F1) puts the ten number keys first, as one group (Sean, 2026-10-05).
import { describe, expect, it } from "vitest"
import { keyList } from "../src/shared/keyList"
import { cellKeysTitle, withNumberKeysFirst } from "../src/shared/keyGroups"

describe("the number keys, grouped first", () => {
  for (const platform of ["win32", "darwin"]) {
    it(`on ${platform}: one group first, 1 … 9 then 0, taken out of their menus, nothing lost`, () => {
      const plain = keyList(platform)
      const grouped = withNumberKeysFirst(plain, platform)
      const first = grouped[0]!
      expect(first.menu).toBe(cellKeysTitle(platform))
      const digits = first.rows.map((row) => row.keys.slice(-1))
      const sorted = [...digits].sort((a, b) => (a === "0" ? 10 : Number(a)) - (b === "0" ? 10 : Number(b)))
      expect(digits).toEqual(sorted)
      expect(digits.slice(0, 7)).toEqual(["1", "2", "3", "4", "5", "6", "7"])
      // No number key is left in a menu group, and every row is still listed exactly once.
      for (const group of grouped.slice(1)) for (const row of group.rows) expect(row.keys).not.toMatch(/^(Ctrl|Cmd)\+\d$/)
      const ids = (groups: typeof plain) => groups.flatMap((g) => g.rows.map((r) => r.id)).sort()
      expect(ids(grouped)).toEqual(ids(plain))
    })
  }
  it("on Windows the group holds the headings, Code Block, Evaluation Cell and Drawing Cell", () => {
    const first = withNumberKeysFirst(keyList("win32"), "win32")[0]!
    const keys = first.rows.map((row) => row.keys)
    expect(keys).toContain("Ctrl+8")
    expect(keys).toContain("Ctrl+9")
    expect(keys).toContain("Ctrl+0")
    expect(keys[keys.length - 1]).toBe("Ctrl+0")
  })
})
