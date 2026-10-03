import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ProjectStore, parseProject, stringifyProject } from "../src/main/project"
import { duplicateNote, projectTree, setExcluded } from "../src/main/notes"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-project-"))

describe("a project is a list of folders in a JSON file", () => {
  it("reads a file written before `excluded` existed", () => {
    expect(parseProject('{"version":1,"folders":["/a"]}')).toEqual({ version: 1, folders: ["/a"], excluded: [] })
    expect(parseProject("not json")).toBeNull()
  })

  it("writes sorted keys, and reads what it wrote", () => {
    const text = stringifyProject({ version: 1, folders: ["/a", "/b"], excluded: [] })
    expect(text.indexOf('"excluded"')).toBeLessThan(text.indexOf('"folders"'))
    expect(parseProject(text)).toEqual({ version: 1, folders: ["/a", "/b"], excluded: [] })
  })

  it("adds a folder once, removes all but the last, and marks the project edited", async () => {
    const home = scratch()
    const other = scratch()
    const store = new ProjectStore(home)
    expect(store.name).toBe("Untitled Project")
    expect(store.addFolder(other)).toBe(true)
    expect(store.addFolder(other)).toBe(false)
    expect(store.folders).toHaveLength(2)
    expect(store.removeFolder(other)).toBe(true)
    expect(store.removeFolder(home)).toBe(false)
    expect(store.folders).toHaveLength(1)
    expect(await store.save()).toBe(false)
  })

  it("saves as, reopens, and comes back after a restart", async () => {
    const home = scratch()
    const other = scratch()
    const store = new ProjectStore(home)
    store.addFolder(other)
    const file = path.join(scratch(), "Work")
    await store.saveAs(file)
    expect(store.file).toBe(`${file}.writemind-project`)
    expect(store.name).toBe("Work")
    expect(store.dirty).toBe(false)
    store.exclude(path.join(other, "hidden"))
    expect(store.dirty).toBe(true)
    expect(await store.save()).toBe(true)

    const again = new ProjectStore(scratch())
    expect(await again.open(store.file!)).toBe(true)
    expect(again.folders).toEqual(store.folders)
    expect(again.excluded).toEqual(store.excluded)

    const state = path.join(scratch(), "project.json")
    await store.remember(state)
    const launch = new ProjectStore(scratch())
    await launch.restore(state)
    expect(launch.file).toBe(store.file)
    expect(launch.folders).toEqual(store.folders)
  })

  it("a project with no file is remembered by its folders alone", async () => {
    const home = scratch()
    const other = scratch()
    const store = new ProjectStore(home)
    store.addFolder(other)
    const state = path.join(scratch(), "project.json")
    await store.remember(state)
    const launch = new ProjectStore(scratch())
    await launch.restore(state)
    expect(launch.file).toBeNull()
    expect(launch.folders).toEqual(store.folders)
  })

  it("New Project starts again from one folder", () => {
    const home = scratch()
    const store = new ProjectStore(home)
    store.addFolder(scratch())
    store.newProject(home)
    expect(store.folders).toEqual([path.resolve(home)])
    expect(store.file).toBeNull()
  })
})

describe("the sidebar's tree for a project", () => {
  it("is the folder's own tree for one folder, and a rootless root of folders for several", async () => {
    const home = scratch()
    const other = scratch()
    writeFileSync(path.join(home, "one.md"), "# One")
    writeFileSync(path.join(other, "two.md"), "# Two")
    const single = await projectTree([home], home, "P")
    expect(single.path).toBe(home)
    expect(single.notes.map((note) => note.title)).toEqual(["One"])
    const both = await projectTree([home, other], home, "P")
    expect(both.path).toBe("")
    expect(both.sections.map((one) => one.path)).toEqual([home, other])
    expect(both.sections[1]!.notes.map((note) => note.title)).toEqual(["Two"])
  })

  it("keeps an excluded folder out, and leaves it on disk", async () => {
    const home = scratch()
    mkdirSync(path.join(home, "Drafts"))
    writeFileSync(path.join(home, "Drafts", "d.md"), "# D")
    writeFileSync(path.join(home, "a.md"), "# A")
    setExcluded([path.join(home, "Drafts")])
    try {
      const shown = await projectTree([home], home, "P")
      expect(shown.sections).toEqual([])
    } finally { setExcluded([]) }
    expect((await projectTree([home], home, "P")).sections).toHaveLength(1)
  })
})

describe("Edit Notes > Duplicate", () => {
  it("copies the note beside itself, with its drawing, right after it in the order", async () => {
    const home = scratch()
    writeFileSync(path.join(home, "a.md"), "# A")
    writeFileSync(path.join(home, "b.md"), "# B")
    const { writeDrawing, readDrawing } = await import("../src/main/notes")
    await writeDrawing(home, path.join(home, "a.md"), '{"items":[]}')
    const copy = await duplicateNote(home, path.join(home, "a.md"))
    expect(path.basename(copy)).toBe("a copy.md")
    expect(readFileSync(copy, "utf8")).toBe("# A")
    expect(await readDrawing(home, copy)).toBe('{"items":[]}')
    const tree = await projectTree([home], home, "P")
    const names = tree.notes.map((note) => path.basename(note.path))
    expect(names.indexOf("a copy.md")).toBe(names.indexOf("a.md") + 1)
  })
})
