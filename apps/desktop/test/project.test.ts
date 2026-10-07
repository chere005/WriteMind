import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ProjectStore, cleanPath, isForeignPath, parseProject, projectSessionFile, readProjectSession,
  stringifyProject, writeProjectSession,
} from "../src/main/project"
import { duplicateNote, projectTree, setExcluded, writeDrawing, readDrawing } from "../src/main/notes"
import { loadNote } from "../src/main/wmStore"
import { readWm, writeWm } from "./wmFiles"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-project-"))

describe("a project is a list of folders in a JSON file", () => {
  it("reads a file written before `excluded` existed", () => {
    expect(parseProject('{"version":1,"folders":["/a"]}')).toEqual({ version: 1, folders: ["/a"], excluded: [], files: [] })
    expect(parseProject("not json")).toBeNull()
  })

  it("writes sorted keys, and reads what it wrote", () => {
    const text = stringifyProject({ version: 1, folders: ["/a", "/b"], excluded: [], files: [] })
    expect(text.indexOf('"excluded"')).toBeLessThan(text.indexOf('"folders"'))
    expect(parseProject(text)).toEqual({ version: 1, folders: ["/a", "/b"], excluded: [], files: [] })
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
    writeWm(path.join(home, "one.wm"), "# One")
    writeWm(path.join(other, "two.wm"), "# Two")
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
    writeWm(path.join(home, "Drafts", "d.wm"), "# D")
    writeWm(path.join(home, "a.wm"), "# A")
    setExcluded([path.join(home, "Drafts")])
    try {
      const shown = await projectTree([home], home, "P")
      expect(shown.sections).toEqual([])
    } finally { setExcluded([]) }
    expect((await projectTree([home], home, "P")).sections).toHaveLength(1)
  })
})

describe("Edit Notes > Duplicate", () => {
  it("copies the note beside itself, with its drawing and pictures, as another note (a new id), right after it in the order", async () => {
    const home = scratch()
    const a = writeWm(path.join(home, "a.wm"), "# A", { entries: { "media/aa.png": "png" } })
    writeWm(path.join(home, "b.wm"), "# B")
    await loadNote(a)
    await writeDrawing(home, a, JSON.stringify({ items: [{ kind: "stroke", id: "s", points: [{ x: 0.1, y: 0.1 }] }] }))
    const copy = await duplicateNote(home, a)
    expect(path.basename(copy)).toBe("a copy.wm")
    const made = readWm(copy)
    const first = readWm(a)
    expect(made.text).toBe("# A")
    expect(JSON.parse(made.drawing!).items[0].id).toBe("s")
    expect(made.entries["media/aa.png"]!.toString()).toBe("png")
    expect(made.manifest.id).not.toBe(first.manifest.id)
    expect(JSON.parse(await readDrawing(home, copy) ?? "{}").items).toHaveLength(1)
    const tree = await projectTree([home], home, "P")
    const names = tree.notes.map((note) => path.basename(note.path))
    expect(names.indexOf("a copy.wm")).toBe(names.indexOf("a.wm") + 1)
  })
})

// ProjectTests.swift: the file is the Mac's, in both directions.
describe("a project file is the Mac's file", () => {
  it("is written the way Foundation prints it (sorted keys, ` : `, an empty array as a blank line)", () => {
    expect(stringifyProject({ version: 1, folders: ["/a/notes", "/b/more notes"], excluded: [] })).toBe([
      "{",
      '  "excluded" : [',
      "",
      "  ],",
      '  "files" : [',
      "",
      "  ],",
      '  "folders" : [',
      '    "/a/notes",',
      '    "/b/more notes"',
      "  ],",
      '  "version" : 1',
      "}",
    ].join("\n"))
    expect(stringifyProject({ version: 1, folders: ["/a"], excluded: ["/a/old"] })).toContain('"excluded" : [\n    "/a/old"\n  ]')
  })

  it("reads a file the Mac wrote, whatever its spacing, and the other way round", () => {
    const fromMac = '{\n  "excluded" : [\n\n  ],\n  "folders" : [\n    "/Users/s/Documents/WriteMind"\n  ],\n  "version" : 1\n}'
    expect(parseProject(fromMac)).toEqual({ version: 1, folders: ["/Users/s/Documents/WriteMind"], excluded: [], files: [] })
    const ours = stringifyProject({ version: 1, folders: ["/a", "/b"], excluded: ["/a/x"] })
    expect(JSON.parse(ours)).toEqual({ version: 1, folders: ["/a", "/b"], excluded: ["/a/x"], files: [] })
  })

  it("keeps a path from the other kind of machine exactly as written, and says it is not ours", () => {
    expect(isForeignPath("/Users/s/Notes", "win32")).toBe(true)
    expect(isForeignPath("C:\\Users\\s", "win32")).toBe(false)
    expect(isForeignPath("\\\\server\\share", "win32")).toBe(false)
    expect(isForeignPath("C:\\Users\\s", "darwin")).toBe(true)
    expect(isForeignPath("/Users/s/Notes", "darwin")).toBe(false)
    expect(cleanPath("/Users/s/Notes", "win32")).toBe("/Users/s/Notes")
  })

  it("opens a project whose folders are another machine's, and saves it back unchanged", async () => {
    const dir = scratch()
    const file = path.join(dir, "FromMac.writemind-project")
    writeFileSync(file, '{"version":1,"folders":["/Users/s/Documents/WriteMind"],"excluded":["/Users/s/Documents/WriteMind/Old"]}')
    const store = new ProjectStore(scratch())
    expect(await store.open(file)).toBe(true)
    if (process.platform === "win32") {
      expect(store.folders).toEqual(["/Users/s/Documents/WriteMind"])
      expect(store.excluded).toEqual(["/Users/s/Documents/WriteMind/Old"])
    }
    store.dirty = true
    await store.save()
    const again = parseProject(readFileSync(file, "utf8"))!
    if (process.platform === "win32") expect(again.folders).toEqual(["/Users/s/Documents/WriteMind"])
    expect(again.excluded).toHaveLength(1)
  })

  it("opens a project with no folders on the default one, and refuses what is not a project", async () => {
    const dir = scratch()
    const home = scratch()
    const empty = path.join(dir, "Empty.writemind-project")
    writeFileSync(empty, '{"version":1,"folders":[]}')
    const store = new ProjectStore(home)
    store.addFolder(scratch())
    expect(await store.open(empty)).toBe(true)
    expect(store.folders).toEqual([path.resolve(home)])
    expect(store.file).toBe(empty)

    const junk = path.join(dir, "junk.writemind-project")
    writeFileSync(junk, "this is not json")
    const before = [...store.folders]
    expect(await store.open(junk)).toBe(false)
    expect(await store.open(path.join(dir, "missing.writemind-project"))).toBe(false)
    expect(store.folders).toEqual(before)
    expect(store.file).toBe(empty)
    expect(parseProject("[1,2]")).toBeNull()
    expect(parseProject("null")).toBeNull()
  })
})

describe("the folders of a project (ProjectStore)", () => {
  it("adding the same folder twice is one folder, spelled any way", () => {
    const home = scratch()
    const other = scratch()
    const store = new ProjectStore(home)
    expect(store.addFolder(other)).toBe(true)
    expect(store.addFolder(other + path.sep)).toBe(false)
    expect(store.addFolder(path.join(other, "..", path.basename(other)))).toBe(false)
    if (process.platform === "win32") expect(store.addFolder(other.toUpperCase())).toBe(false)
    expect(store.folders).toHaveLength(2)
  })

  it("a folder inside another may be added, and removing one leaves the other", () => {
    const home = scratch()
    const inner = path.join(home, "Inner")
    mkdirSync(inner)
    const store = new ProjectStore(home)
    expect(store.addFolder(inner)).toBe(true)
    expect(store.folders).toHaveLength(2)
    expect(store.removeFolder(inner)).toBe(true)
    expect(store.folders).toEqual([path.resolve(home)])
    expect(store.removeFolder(home)).toBe(false)
  })

  it("hiding and showing a folder marks the project edited, once", () => {
    const home = scratch()
    const store = new ProjectStore(home)
    expect(store.dirty).toBe(false)
    expect(store.exclude(path.join(home, "Drafts"))).toBe(true)
    expect(store.exclude(path.join(home, "Drafts"))).toBe(false)
    expect(store.dirty).toBe(true)
    expect(store.include(path.join(home, "Drafts"))).toBe(true)
    expect(store.include(path.join(home, "Drafts"))).toBe(false)
    expect(store.excluded).toEqual([])
  })

  it("an untitled project that has changed is 'edited' too (the Mac's hasUnsavedProjectChanges)", () => {
    const store = new ProjectStore(scratch())
    store.addFolder(scratch())
    expect(store.file).toBeNull()
    expect(store.dirty).toBe(true)
    store.newProject()
    expect(store.dirty).toBe(false)
  })
})

describe("a session for each project (ProjectSession)", () => {
  it("two projects with the same file name in different places do not share a session file", () => {
    const one = projectSessionFile("/u", path.resolve("/x/A.writemind-project"))
    const two = projectSessionFile("/u", path.resolve("/y/A.writemind-project"))
    expect(one).not.toBe(two)
    expect(path.basename(projectSessionFile("/u", null))).toBe("default.json")
    expect(path.basename(one)).not.toMatch(/[\/]/)
    expect(path.extname(one)).toBe(".json")
  })

  it("is written and read back under the project's own file, and the untitled project's is separate", async () => {
    const userData = scratch()
    await writeProjectSession(userData, "/p/Work.writemind-project", '{"open":["a"]}')
    await writeProjectSession(userData, null, '{"open":["b"]}')
    expect(await readProjectSession(userData, "/p/Work.writemind-project", userData)).toBe('{"open":["a"]}')
    expect(await readProjectSession(userData, null, userData)).toBe('{"open":["b"]}')
    expect(await readProjectSession(userData, "/p/Other.writemind-project", userData)).toBeNull()
  })

  it("the untitled project falls back to the session kept per notes folder before projects had their own", async () => {
    const userData = scratch()
    const root = scratch()
    const { sessionFileName } = await import("@writemind/core")
    mkdirSync(path.join(userData, "sessions"), { recursive: true })
    writeFileSync(path.join(userData, "sessions", sessionFileName(path.resolve(root))), '{"open":["old"]}')
    expect(await readProjectSession(userData, null, root)).toBe('{"open":["old"]}')
  })
})

// docs/SPEC-WM.md section 4 and vector 13: the project file lists `.wm` files, takes relative paths, keeps what it does not know.
describe("vector 13: the project file's files, relative paths and unknown keys", () => {
  it("(a) the Mac-shaped file reads with no files, and is written back with an empty `files` list", async () => {
    const dir = scratch()
    const file = path.join(dir, "Mac.writemind-project")
    writeFileSync(file, '{"excluded":[],"folders":["/a"],"version":1}')
    const store = new ProjectStore(scratch())
    expect(await store.open(file)).toBe(true)
    expect(store.files).toEqual([])
    store.dirty = true
    await store.save()
    expect(readFileSync(file, "utf8")).toBe('{\n  "excluded" : [\n\n  ],\n  "files" : [\n\n  ],\n  "folders" : [\n    "/a"\n  ],\n  "version" : 1\n}')
  })

  it("(b) a relative file resolves against the project file's folder; a save writes x-future back and the paths relative", async () => {
    const dir = scratch()
    const file = path.join(dir, "proj.writemind-project")
    writeFileSync(file, '{"x-future":{"a":1},"files":["Notes/T.wm"],"folders":["Notes"],"version":1}')
    const store = new ProjectStore(scratch())
    expect(await store.open(file)).toBe(true)
    expect(store.files).toEqual([path.join(dir, "Notes", "T.wm")])
    expect(store.folders).toEqual([path.join(dir, "Notes")])
    store.setFiles([path.join(dir, "Notes", "T.wm"), path.join(os.tmpdir(), "Elsewhere.wm")])
    expect(store.dirty).toBe(true)
    await store.save()
    const written = readFileSync(file, "utf8")
    expect(JSON.parse(written)).toEqual({
      "x-future": { a: 1 }, excluded: [], files: ["Notes/T.wm", path.join(os.tmpdir(), "Elsewhere.wm")], folders: ["Notes"], version: 1,
    })
    expect(written).toContain('"x-future" : {\n    "a" : 1\n  }')
    // ...and read again it is the same project.
    const again = new ProjectStore(scratch())
    await again.open(file)
    expect(again.files).toEqual(store.files)
    expect(again.extra).toEqual({ "x-future": { a: 1 } })
  })

  it("(c) a path from the other kind of machine is kept as written, (d) a duplicate is listed once", async () => {
    const dir = scratch()
    const file = path.join(dir, "p.writemind-project")
    const foreign = process.platform === "win32" ? "/Users/x" : "C:\\Users\\x"
    writeFileSync(file, JSON.stringify({ version: 1, folders: [dir, dir, `${dir}${path.sep}.`, foreign], files: ["a.wm", "./a.wm"] }))
    const store = new ProjectStore(scratch())
    await store.open(file)
    expect(store.folders).toEqual([dir, foreign])
    expect(store.files).toEqual([path.join(dir, "a.wm")])
    store.dirty = true
    await store.save()
    expect(parseProject(readFileSync(file, "utf8"))!.folders).toEqual([".", foreign])
  })

  it("ignores a listed file that is not a .wm (and keeps it), and a project of a newer version is shown and kept at its version", async () => {
    const dir = scratch()
    const file = path.join(dir, "n.writemind-project")
    writeFileSync(file, '{"version":3,"folders":["/a"],"files":["Old.md","New.wm"],"future":true}')
    const store = new ProjectStore(scratch())
    await store.open(file)
    expect(store.newer).toBe(true)
    expect(store.notes).toEqual([path.join(dir, "New.wm")])
    expect(store.files).toHaveLength(2)
    await store.save()
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 3, future: true, files: ["Old.md", "New.wm"] })
    store.newProject()
    expect(store.newer).toBe(false)
    expect(store.version).toBe(1)
  })
})
