import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { friendly, leaf } from "../src/renderer/errors"
import { canTrashSection, newlySeen, sectionPaths } from "../src/renderer/sidebarTree"
import { rescueUnsaved, stamp } from "../src/main/rescue"
import type { Section } from "../src/renderer/wm"

const section = (name: string, depth: number, sections: Section[] = []): Section =>
  ({ path: `/p/${name}`, name, depth, notes: [], sections })

describe("Edit Notes puts a trash button only on nested folders, never on a project folder (verifier editmode.mjs)", () => {
  it("offers it for a folder inside a project folder, not for a project folder itself", () => {
    expect(canTrashSection(section("project folder", 0))).toBe(false)
    expect(canTrashSection(section("nested", 1))).toBe(true)
    expect(canTrashSection(section("deeper", 4))).toBe(true)
  })
})

describe("every section starts open, and one the person closed stays closed", () => {
  const tree = (...children: Section[]): Section => ({ path: "", name: "P", depth: -1, notes: [], sections: children })

  it("lists every section that has a row, project folders included", () => {
    const root = tree(section("A", 0, [section("A1", 1, [section("A1a", 2)])]), section("B", 0))
    expect(sectionPaths(root)).toEqual(["/p/A", "/p/A1", "/p/A1a", "/p/B"])
  })

  it("opens a section the first time the tree has it — at launch, in a new project, when one is made", () => {
    const seen = new Set<string>()
    expect(newlySeen(tree(section("A", 0, [section("Sub 1", 1)])), seen)).toEqual(["/p/A", "/p/Sub 1"])
    // The same tree again (every save reads it again) opens nothing: a section closed in between stays closed.
    expect(newlySeen(tree(section("A", 0, [section("Sub 1", 1)])), seen)).toEqual([])
    // A new section is opened as it is made.
    expect(newlySeen(tree(section("A", 0, [section("Sub 1", 1), section("New Section", 1)])), seen)).toEqual(["/p/New Section"])
  })

  it("opens one that went away and came back, and every section of another project", () => {
    const seen = new Set<string>()
    newlySeen(tree(section("A", 0, [section("X", 1)])), seen)
    newlySeen(tree(section("A", 0)), seen)
    expect(newlySeen(tree(section("A", 0, [section("X", 1)])), seen)).toEqual(["/p/X"])
    expect(newlySeen(tree(section("Other", 0, [section("Y", 1)])), seen)).toEqual(["/p/Other", "/p/Y"])
  })
})

describe("what went wrong, in words", () => {
  it("turns the system's codes into a reason, and drops Electron's wrapper", () => {
    const wrapped = (code: string) => new Error(`Error invoking remote method 'note:write': Error: ${code}: operation failed, open 'C:\\n\\one.md'`)
    expect(friendly(wrapped("EPERM"))).toBe("it is read-only or open in another program")
    expect(friendly(wrapped("EBUSY"))).toBe("it is open in another program")
    expect(friendly(wrapped("ENOSPC"))).toBe("the disk is full")
    expect(friendly(wrapped("ENOENT"))).toBe("it is no longer there")
    expect(friendly(new Error("Error invoking remote method 'x': Error: something odd"))).toBe("something odd")
    expect(friendly("plain")).toBe("plain")
    expect(friendly(undefined)).toBe("something went wrong")
  })

  it("names the file by its last part", () => {
    expect(leaf("C:\\notes\\sub\\one.md")).toBe("one.md")
    expect(leaf("/a/b/two.md")).toBe("two.md")
  })
})

describe("text that could not be saved is kept where it can be come back to", () => {
  it("writes a note into Recovered with its name and the time, and never over an earlier copy", async () => {
    const data = mkdtempSync(path.join(os.tmpdir(), "wm-rescue-"))
    const when = new Date(2026, 9, 3, 14, 15, 2)
    expect(stamp(when)).toBe("20261003-141502")
    // A note's path as this system writes it: a Windows path is only ever met on Windows (and a Mac's
    // path.basename would rightly take all of "C:\notes\one.md" for one name).
    const noteFile = process.platform === "win32" ? "C:\\notes\\one.md" : "/notes/one.md"
    const first = await rescueUnsaved(data, noteFile, "first words", "note", when)
    const second = await rescueUnsaved(data, noteFile, "second words", "note", when)
    expect(path.basename(first)).toBe("one (20261003-141502).md")
    expect(second).not.toBe(first)
    expect(readFileSync(first, "utf8")).toBe("first words")
    expect(readFileSync(second, "utf8")).toBe("second words")
    expect(path.dirname(first)).toBe(path.join(data, "Recovered"))
  })

  it("keeps a drawing's JSON as it is, under a name that says what it is", async () => {
    const data = mkdtempSync(path.join(os.tmpdir(), "wm-rescue-"))
    const where = await rescueUnsaved(data, "/notes/page.md", '{"items":[]}', "drawing", new Date(2026, 9, 3, 1, 2, 3))
    expect(path.basename(where)).toBe("page (20261003-010203).drawing.json")
    expect(existsSync(where)).toBe(true)
  })
})
