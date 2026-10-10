import { describe, expect, it } from "vitest"
import { makeNote } from "@writemind/core"
import { firstMatch, readiness } from "../src/renderer/foundOpen"
import { addRowDrop, moveTargets, stepResult } from "../src/renderer/sidebarTree"
import { noteMenu, projectMenu, sectionMenu, type RowActions } from "../src/renderer/SidebarProject"
import type { Section } from "../src/renderer/wm"
import type { MenuItem } from "../src/renderer/FloatingMenu"

/** The sidebar's own rules that have an answer without a window (docs/PLAN-bars-2026-10.md P3). */

const note = (file: string) => makeNote(file, 1, `# ${file.split("/").pop()!.replace(/\.wm$/, "")}\n`)
const section = (path: string, depth: number, notes: string[], sections: Section[] = []): Section =>
  ({ path, name: path.split("/").pop()!, depth, notes: notes.map(note), sections })

/** Notes/: a.wm, b.wm · Notes/Ideas: c.wm · Notes/Ideas/2026: d.wm · Notes/Empty */
const tree = (): Section => section("/n", 0, ["/n/a.wm", "/n/b.wm"], [
  section("/n/Ideas", 1, ["/n/Ideas/c.wm"], [section("/n/Ideas/2026", 2, ["/n/Ideas/2026/d.wm"])]),
  section("/n/Empty", 1, []),
])
const find = (root: Section, path: string): Section => {
  const walk = (s: Section): Section | null => (s.path === path ? s : s.sections.map(walk).find(Boolean) ?? null)
  return walk(root)!
}

describe("Move to ▸", () => {
  it("lists the project's folder and every section in the tree's order, each at its depth", () => {
    expect(moveTargets(tree(), "/n/a.wm").map((t) => [t.name, t.depth])).toEqual([["n", 0], ["Ideas", 1], ["2026", 2], ["Empty", 1]])
  })
  it("greys the note's own section and only that", () => {
    expect(moveTargets(tree(), "/n/Ideas/c.wm").map((t) => t.here)).toEqual([false, true, false, false])
    expect(moveTargets(tree(), "/n/a.wm").map((t) => t.here)).toEqual([true, false, false, false])
  })
  it("starts at the folders of a project of several (the root has no path of its own)", () => {
    const root: Section = { path: "", name: "P", depth: -1, notes: [], sections: [section("/a", 0, ["/a/x.wm"]), section("/b", 0, [])] }
    expect(moveTargets(root, "/a/x.wm").map((t) => [t.name, t.depth, t.here])).toEqual([["a", 0, true], ["b", 0, false]])
  })
  it("compares folders as the file system does (case-blind on Windows)", () => {
    const root = section("C:\\Notes", 0, ["C:\\Notes\\a.wm"])
    expect(moveTargets(root, "c:\\notes\\a.wm", true)[0]!.here).toBe(true)
    expect(moveTargets(root, "c:\\notes\\a.wm", false)[0]!.here).toBe(false)
  })
  it("is nothing without a tree", () => { expect(moveTargets(null, "/n/a.wm")).toEqual([]) })
})

describe("a drop on a section's add row", () => {
  it("puts a note before the section's first note", () => {
    expect(addRowDrop({ kind: "note", path: "/n/a.wm" }, find(tree(), "/n/Ideas"))).toEqual({ kind: "place", file: "/n/a.wm", folder: "/n/Ideas", before: "c.wm" })
  })
  it("puts a note at the end of a section that has none (nothing to go before)", () => {
    expect(addRowDrop({ kind: "note", path: "/n/a.wm" }, find(tree(), "/n/Empty"))).toEqual({ kind: "place", file: "/n/a.wm", folder: "/n/Empty", before: null })
  })
  it("puts a note from the same section before the first, unless it already is the first", () => {
    expect(addRowDrop({ kind: "note", path: "/n/b.wm" }, tree())).toEqual({ kind: "place", file: "/n/b.wm", folder: "/n", before: "a.wm" })
    expect(addRowDrop({ kind: "note", path: "/n/a.wm" }, tree())).toBeNull()
  })
  it("moves a section inside the section, never into itself, inside what it holds, or where it already is", () => {
    const root = tree()
    expect(addRowDrop({ kind: "section", path: "/n/Empty" }, find(root, "/n/Ideas"))).toEqual({ kind: "move-section", folder: "/n/Empty", target: "/n/Ideas" })
    expect(addRowDrop({ kind: "section", path: "/n/Ideas" }, find(root, "/n/Ideas"))).toBeNull()
    expect(addRowDrop({ kind: "section", path: "/n/Ideas" }, find(root, "/n/Ideas/2026"))).toBeNull()
    expect(addRowDrop({ kind: "section", path: "/n/Ideas" }, root)).toBeNull()
  })
})

describe("the arrow keys in the results", () => {
  it("Down goes on and stops at the last; Up goes back and, from the first, to the field", () => {
    expect(stepResult(-1, "ArrowDown", 3)).toBe(0)
    expect(stepResult(0, "ArrowDown", 3)).toBe(1)
    expect(stepResult(2, "ArrowDown", 3)).toBe(2)
    expect(stepResult(2, "ArrowUp", 3)).toBe(1)
    expect(stepResult(0, "ArrowUp", 3)).toBe(-1)
    expect(stepResult(-1, "ArrowUp", 3)).toBe(-1)
  })
  it("has nothing to move to with no results", () => {
    expect(stepResult(-1, "ArrowDown", 0)).toBe(-1)
    expect(stepResult(3, "End", 5)).toBe(4)
    expect(stepResult(3, "Home", 5)).toBe(0)
  })
})

describe("opening a result", () => {
  it("finds the words the note has, as written, and where the first is", () => {
    expect(firstMatch("# Menu\nA small Café here\nanother café", { matched: "Café" }, "cafe")).toEqual({ seed: "Café", first: { location: 15, length: 4 } })
  })
  it("falls back to the typed words when the match crossed a mark", () => {
    const got = firstMatch("the **heat** flow", { matched: "heat flow" }, "heat flow")
    expect(got.seed).toBe("heat")
    expect(got.first).toEqual({ location: 6, length: 4 })
  })
  it("has no place when the words are gone from the note", () => {
    expect(firstMatch("changed since", { matched: "" }, "needle").first).toBeNull()
  })
})

const recorder = () => {
  const log: string[] = []
  const actions = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => { log.push(`${name}:${args.map((a) => (typeof a === "string" ? a : (a as { path?: string }).path ?? "")).join(",")}`) } }) as unknown as RowActions
  return { log, actions }
}
const labelsOf = (items: MenuItem[]) => items.map((i) => (i === "-" ? "-" : "label" in i ? i.label : "header" in i ? i.header : "custom"))

describe("the sidebar's menus", () => {
  it("a note's: Open, Rename…, Duplicate, Move to, Reveal, Move to Trash… (red)", () => {
    const { actions } = recorder()
    const items = noteMenu(note("/n/a.wm"), tree(), "darwin", actions)
    expect(labelsOf(items)).toEqual(["Open", "Rename…", "Duplicate", "Move to", "-", "Reveal in Finder", "-", "Move to Trash…"])
    const last = items.at(-1) as Extract<MenuItem, { label: string }>
    expect(last.danger).toBe(true)
  })
  it("Move to is indented to the depth and greys the note's own folder; picking one moves the note there", () => {
    const { actions, log } = recorder()
    const move = (noteMenu(note("/n/Ideas/c.wm"), tree(), "linux", actions)[3] as Extract<MenuItem, { label: string }>).submenu as Extract<MenuItem, { label: string }>[]
    expect(move.map((m) => [m.label, m.disabled, (m.labelStyle as { paddingLeft?: number } | undefined)?.paddingLeft ?? 0])).toEqual([
      ["n", false, 0], ["Ideas", true, 12], ["2026", false, 24], ["Empty", false, 12],
    ])
    move[3]!.onClick!()
    expect(log).toEqual(["moveNote:/n/Ideas/c.wm,/n/Empty"])
  })
  it("the Trash is the Recycle Bin on Windows", () => {
    expect(labelsOf(noteMenu(note("C:\\n\\a.wm"), section("C:\\n", 0, []), "win32", recorder().actions)).at(-1)).toBe("Move to Recycle Bin…")
  })
  it("a section's has one label for a new section, on a project folder and in a section", () => {
    const { actions } = recorder()
    const root = tree()
    expect(labelsOf(sectionMenu(root, true, null, "darwin", actions)).slice(0, 2)).toEqual(["New Note Here", "New Section"])
    expect(labelsOf(sectionMenu(find(root, "/n/Ideas"), true, null, "darwin", actions)).slice(0, 3)).toEqual(["New Note Here", "New Section", "Rename…"])
    const item = sectionMenu(find(root, "/n/Ideas"), true, null, "darwin", actions)[1] as Extract<MenuItem, { label: string }>
    expect(item.dataBar).toBe("new-section")
  })
  it("the project menu has the menu bar's Project items, Hidden Sections when there are hidden ones, Reveal and Clean Up", () => {
    const project = {
      name: "P", file: null, edited: false,
      folders: [{ path: "/n", name: "n", exists: true }, { path: "/m", name: "m", exists: true }],
      excluded: [{ path: "/n/Old", name: "Old", exists: true }],
    }
    const items = projectMenu("darwin", project, tree(), recorder().actions)
    expect(labelsOf(items)).toEqual([
      "Add Folder to Project…", "Remove Folder from Project", "Hidden Sections", "-", "Save Project", "Save Project As…", "Open Project…",
      "New Project", "-", "Reveal in Finder", "Clean Up Unused Files…",
    ])
    expect((items[1] as { disabled?: boolean }).disabled).toBe(false)
    const alone = projectMenu("darwin", { ...project, folders: [project.folders[0]!], excluded: [] }, tree(), recorder().actions)
    expect(labelsOf(alone)).not.toContain("Hidden Sections")
    expect((alone[1] as { disabled?: boolean }).disabled).toBe(true)
  })
})

describe("a result waits for the live editor of its note (foundOpen.readiness)", () => {
  const want = { path: "/n/a.wm", at: 1000 }
  const words = "the first needle"
  const live = { connected: true, doc: words }

  it("is ready when the note in front is the one wanted and its editor holds its words", () => {
    expect(readiness(want, 1100, "/n/a.wm", live, words)).toBe("ready")
  })
  it("waits while the note is not the one in front, there is no editor, or the editor holds other words", () => {
    expect(readiness(want, 1100, "/n/b.wm", live, words)).toBe("wait")
    expect(readiness(want, 1100, "/n/a.wm", null, words)).toBe("wait")
    expect(readiness(want, 1100, "/n/a.wm", { connected: true, doc: "another note" }, words)).toBe("wait")
  })
  it("waits for an editor that is no longer on the page, even when its words are the words wanted", () => {
    // The page keeps the last editor it was handed after its tab is closed: a result opened next in a note with the
    // same words must not put the caret on that dead editor (the live one never got it).
    expect(readiness(want, 1100, "/n/a.wm", { connected: false, doc: words }, words)).toBe("wait")
  })
  it("gives up after a few seconds, so it can never fire on a note opened by hand later", () => {
    expect(readiness(want, 1000 + 5001, "/n/a.wm", null, words)).toBe("expired")
    expect(readiness(want, 1000 + 4999, "/n/a.wm", null, words)).toBe("wait")
  })
})
