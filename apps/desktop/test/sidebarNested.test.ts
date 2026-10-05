import { describe, expect, it } from "vitest"
import { makeNote } from "@writemind/core"
import {
  distinctNotes, flatten, newlySeen, NO_FOLDER_TEXT, rowKeys, sectionAt, targetFolderOf,
} from "../src/renderer/sidebarTree"
import type { Section } from "../src/renderer/wm"

/**
 * A project folder that lies inside another project folder (Outer and Outer\Inner — project.test.ts says it may
 * be added, and PARITY says "both then show, as on the Mac") is in the tree twice, and so are its notes. Rows
 * with one React key made the sidebar keep what it had and add more with every read of the tree (verifier
 * nested.mjs: 4 Inner rows, then 8, then 12), and the footer counted the nested note twice.
 */

const note = (file: string) => makeNote(file, 1, `# ${file.split("\\").pop()}\n`)
const section = (path: string, depth: number, notes: string[], sections: Section[] = []): Section =>
  ({ path, name: path.split("\\").pop()!, depth, notes: notes.map(note), sections })

/** The project: Outer, then Outer\Inner as a project folder of its own — Inner is in the tree twice. */
const project = (): Section => {
  const inner = () => section("C:\\p\\Outer\\Inner", 1, ["C:\\p\\Outer\\Inner\\i.md"])
  const outer = section("C:\\p\\Outer", 0, ["C:\\p\\Outer\\o.md"], [inner()])
  const innerRoot = section("C:\\p\\Outer\\Inner", 0, ["C:\\p\\Outer\\Inner\\i.md"])
  return { path: "", name: "Untitled Project", depth: -1, notes: [], sections: [outer, innerRoot] }
}

const everythingOpen = (root: Section): Set<string> => {
  const open = new Set<string>()
  const walk = (one: Section) => { for (const child of one.sections) { open.add(child.path); walk(child) } }
  walk(root)
  return open
}

describe("a project folder inside another project folder", () => {
  it("every row has a key of its own", () => {
    const root = project()
    const rows = flatten(root, everythingOpen(root))
    const keys = rowKeys(rows)
    expect(keys).toHaveLength(rows.length)
    expect(new Set(keys).size).toBe(keys.length)
    // Inner is a section row twice, its add-row twice and its note twice
    expect(rows.filter((row) => row.kind === "section" && row.section.name === "Inner")).toHaveLength(2)
    expect(keys.filter((key) => key.startsWith("s:C:\\p\\Outer\\Inner"))).toHaveLength(2)
    expect(keys.filter((key) => key.startsWith("n:C:\\p\\Outer\\Inner\\i.md"))).toHaveLength(2)
  })

  it("the keys are the same every time the list is built from the same tree (a tree read again adds no rows)", () => {
    const first = rowKeys(flatten(project(), everythingOpen(project())))
    for (let read = 0; read < 6; read++) {
      const root = project()
      const rows = flatten(root, everythingOpen(root))
      expect(rows).toHaveLength(first.length)
      expect(rowKeys(rows)).toEqual(first)
    }
  })

  it("a note is one note, however many places it is listed in", () => {
    expect(distinctNotes(project(), true)).toBe(2)
    expect(distinctNotes({ ...project(), sections: [] }, true)).toBe(0)
    // the file system on Windows does not tell Inner from inner
    const root = project()
    root.sections[1]!.notes = [note("C:\\P\\OUTER\\INNER\\I.MD")]
    expect(distinctNotes(root, true)).toBe(2)
    expect(distinctNotes(root, false)).toBe(3)
  })

  it("a row finds ITS folder: the project folder is the root one, the subsection is the nested one", () => {
    const root = project()
    expect(sectionAt(root, "C:\\p\\Outer\\Inner", 0)!.depth).toBe(0)
    expect(sectionAt(root, "C:\\p\\Outer\\Inner", 1)!.depth).toBe(1)
    // without a depth, the first found; a depth nobody has falls back to what is there
    expect(sectionAt(root, "C:\\p\\Outer\\Inner")!.depth).toBe(1)
    expect(sectionAt(root, "C:\\p\\Outer\\Inner", 7)!.path).toBe("C:\\p\\Outer\\Inner")
    expect(sectionAt(root, "C:\\nowhere")).toBeNull()
    expect(sectionAt(null, "C:\\p")).toBeNull()
  })

  it("a section opens when it is first seen, once (the two Inners are one path)", () => {
    const seen = new Set<string>()
    expect(newlySeen(project(), seen).sort()).toEqual(["C:\\p\\Outer", "C:\\p\\Outer\\Inner"])
    expect(newlySeen(project(), seen)).toEqual([])
  })
})

describe("where New Note goes when nothing says", () => {
  it("in the folder of the note that is open", () => {
    expect(targetFolderOf("C:\\p\\Outer\\o.md", project())).toBe("C:\\p\\Outer")
  })

  it("else the one folder of the project, or the first of several that is there", () => {
    expect(targetFolderOf(null, section("C:\\p\\Only", 0, []))).toBe("C:\\p\\Only")
    expect(targetFolderOf(null, project())).toBe("C:\\p\\Outer")
  })

  it("with none of the project's folders on disk it is nowhere — never the app's own notes folder", () => {
    const none: Section = { path: "", name: "P", depth: -1, notes: [], sections: [] }
    expect(targetFolderOf(null, none)).toBe("")
    expect(targetFolderOf(null, null)).toBe("")
    expect(NO_FOLDER_TEXT).toMatch(/nowhere to go/)
  })
})
