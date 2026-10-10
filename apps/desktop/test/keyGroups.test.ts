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

// The key list's own search ("Search keys…", docs/PLAN-bars-2026-10.md P6).
import { searchKeys } from "../src/shared/keyGroups"

describe("searching the key list", () => {
  const rows = (groups: ReturnType<typeof keyList>) => groups.flatMap((group) => group.rows.map((row) => row.id))

  it("an empty query is the whole list, untouched", () => {
    const all = keyList("darwin")
    expect(searchKeys(all, "", "darwin")).toBe(all)
    expect(searchKeys(all, "   ", "darwin")).toBe(all)
  })

  it("finds a command by its name, case and accents aside, and drops the groups with nothing left", () => {
    const found = searchKeys(keyList("win32"), "SAVE", "win32")
    expect(rows(found)).toContain("save")
    expect(rows(found)).not.toContain("newNote")
    expect(found.every((group) => group.rows.length > 0)).toBe(true)
    expect(searchKeys(keyList("win32"), "sàve", "win32").length).toBeGreaterThan(0)
  })

  it("finds a command by its key, in the words a person types and in the caps a Mac prints", () => {
    expect(rows(searchKeys(keyList("win32"), "ctrl+s", "win32"))).toContain("save")
    expect(rows(searchKeys(keyList("darwin"), "cmd s", "darwin"))).toContain("save")
    // ⌘ is also "command".
    expect(rows(searchKeys(keyList("darwin"), "command", "darwin"))).toContain("save")
    expect(rows(searchKeys(keyList("darwin"), "⌘", "darwin"))).toContain("save")
    const option = rows(searchKeys(keyList("darwin"), "⌥", "darwin"))
    expect(option).toContain("findReplace")
    expect(option).not.toContain("save")
    expect(rows(searchKeys(keyList("darwin"), "option", "darwin"))).toEqual(option)
  })

  it("every word must match: a name and a key narrow each other, and a stranger finds nothing", () => {
    const found = rows(searchKeys(keyList("win32"), "find shift", "win32"))
    expect(found).toContain("findPrevious")
    expect(found).not.toContain("find")
    expect(searchKeys(keyList("win32"), "zzzz nothing", "win32")).toEqual([])
  })

  it("a menu's name finds its rows", () => {
    const found = searchKeys(keyList("win32"), "pen", "win32")
    expect(found.some((group) => group.menu === "Pen")).toBe(true)
  })
})
