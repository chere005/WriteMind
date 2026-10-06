/**
 * The notes folder's rename, WriteMindCross -> WriteMind (main/notesFolderMove.ts). Every test works in a scratch
 * "Documents" and a scratch user-data folder under the system's temp folder: nothing here can see a real one.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { sessionFileName } from "@writemind/core"
import {
  findMedia, olderDrawingPath, readDrawing, saveInkSnapshot, saveMedia, setProjectFolders, writeDrawing,
} from "../src/main/notes"
import {
  MOVE_STATE_FILE, keptOldNotice, movedPath, rewriteJsonText, settleNotesFolder, type SettleOptions,
} from "../src/main/notesFolderMove"
import { readProjectSession } from "../src/main/project"

const quiet = (): void => undefined
function scratch() {
  const base = mkdtempSync(path.join(os.tmpdir(), "wm-folder-move-"))
  const documents = path.join(base, "Documents")
  const userData = path.join(base, "profile")
  mkdirSync(documents, { recursive: true })
  mkdirSync(userData, { recursive: true })
  const old = path.join(documents, "WriteMindCross")
  const now = path.join(documents, "WriteMind")
  const options = (more: Partial<SettleOptions> = {}): SettleOptions => ({ documents, userData, env: {}, log: quiet, ...more })
  return { base, documents, userData, old, now, options }
}
const put = (file: string, text: string): string => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}
const json = (file: string): any => JSON.parse(readFileSync(file, "utf8"))
const drawing = (colour: string) => JSON.stringify({ items: [{ kind: "stroke", id: `s-${colour}`, colorHex: colour, width: 3, points: [{ x: 0.1, y: 0.1 }], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null }] })
const win = process.platform === "win32"

afterEach(() => { setProjectFolders([]) })

describe("a path under the old folder", () => {
  const from = "C:\\Users\\S\\Documents\\WriteMindCross"
  const to = "C:\\Users\\S\\Documents\\WriteMind"
  it("moves with its prefix only, separator-aware, case-insensitive on Windows", () => {
    expect(movedPath(from, from, to, "win32")).toBe(to)
    expect(movedPath(`${from}\\`, from, to, "win32")).toBe(`${to}\\`)
    expect(movedPath(`${from}\\Ideas\\a.md`, from, to, "win32")).toBe(`${to}\\Ideas\\a.md`)
    expect(movedPath("c:\\users\\s\\documents\\writemindcross\\Ideas\\A.md", from, to, "win32")).toBe(`${to}\\Ideas\\A.md`)
    // written with forward slashes: kept that way
    expect(movedPath("C:/Users/S/Documents/WriteMindCross/Ideas/a.md", from, to, "win32")).toBe("C:/Users/S/Documents/WriteMind/Ideas/a.md")
    // a look-alike, a parent and somewhere else: untouched
    expect(movedPath("C:\\Users\\S\\Documents\\WriteMindCross2\\a.md", from, to, "win32")).toBeNull()
    expect(movedPath("C:\\Users\\S\\Documents\\WriteMindCrossa.md", from, to, "win32")).toBeNull()
    expect(movedPath("C:\\Users\\S\\Documents", from, to, "win32")).toBeNull()
    expect(movedPath("D:\\Notes\\WriteMindCross\\a.md", from, to, "win32")).toBeNull()
    expect(movedPath("a.md", from, to, "win32")).toBeNull()
  })
  it("is case-sensitive on a Mac or Linux", () => {
    const mac = "/Users/sean/Documents/WriteMindCross"
    expect(movedPath(`${mac}/Ideas/a.md`, mac, "/Users/sean/Documents/WriteMind", "darwin")).toBe("/Users/sean/Documents/WriteMind/Ideas/a.md")
    expect(movedPath("/Users/sean/Documents/writemindcross/a.md", mac, "/Users/sean/Documents/WriteMind", "darwin")).toBeNull()
    expect(movedPath("/Users/sean/Documents/WriteMindCross2/a.md", mac, "/Users/sean/Documents/WriteMind", "darwin")).toBeNull()
  })
  it("is rewritten in JSON text, keys and values, and every other byte is left as it was", () => {
    const text = `{\n  "root" : "C:\\\\Users\\\\S\\\\Documents\\\\WriteMindCross",\n  "keep": "C:\\\\Other\\\\x.md",\n`
      + `  "unsavedBuffers": { "C:\\\\Users\\\\S\\\\Documents\\\\WriteMindCross\\\\a.md": { "text": "hi \\"there\\"" } },\n  "n": 3\n}`
    const next = rewriteJsonText(text, from, to, "win32")!
    expect(next).toBe(text.split("WriteMindCross").join("WriteMind"))
    expect(JSON.parse(next).unsavedBuffers["C:\\Users\\S\\Documents\\WriteMind\\a.md"].text).toBe('hi "there"')
    expect(rewriteJsonText('{"a": "C:\\\\Other"}', from, to, "win32")).toBeNull()
    expect(rewriteJsonText("not json C:\\Users\\S\\Documents\\WriteMindCross", from, to, "win32")).toBeNull()
  })
})

describe("which folder a launch uses", () => {
  it("neither folder: the new one (a first install), and nothing is made or moved here", async () => {
    const s = scratch()
    const settled = await settleNotesFolder(s.options())
    expect(settled.outcome).toBe("first")
    expect(settled.root).toBe(s.now)
    expect(existsSync(s.now)).toBe(false)
    expect(settled.notice).toBeNull()
  })

  it("the old folder alone: moved to the new name, whole; a second launch does nothing", async () => {
    const s = scratch()
    put(path.join(s.old, "a.md"), "# A\n")
    put(path.join(s.old, "Ideas", "b.md"), "# B\n")
    const first = await settleNotesFolder(s.options())
    expect(first.outcome).toBe("moved")
    expect(first.root).toBe(s.now)
    expect(existsSync(s.old)).toBe(false)
    expect(readFileSync(path.join(s.now, "Ideas", "b.md"), "utf8")).toBe("# B\n")
    expect(json(path.join(s.userData, MOVE_STATE_FILE)).pending).toBeUndefined()
    const state = readFileSync(path.join(s.userData, MOVE_STATE_FILE), "utf8")
    const second = await settleNotesFolder(s.options())
    expect(second.outcome).toBe("new")
    expect(second.root).toBe(s.now)
    expect(readFileSync(path.join(s.userData, MOVE_STATE_FILE), "utf8")).toBe(state)
    expect(existsSync(s.old)).toBe(false)
  })

  it("a refused rename (a locked folder): the old folder this launch, nothing changed, and it is tried again next launch", async () => {
    const s = scratch()
    put(path.join(s.old, "a.md"), "# A\n")
    put(path.join(s.userData, "project.json"), JSON.stringify({ file: null, folders: [s.old], excluded: [] }))
    const lines: string[] = []
    const refused = await settleNotesFolder(s.options({
      rename: async () => { throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }) },
      log: (line) => lines.push(line),
    }))
    expect(refused.outcome).toBe("move-failed")
    expect(refused.root).toBe(s.old)
    expect(existsSync(path.join(s.old, "a.md"))).toBe(true)
    expect(existsSync(s.now)).toBe(false)
    expect(json(path.join(s.userData, "project.json")).folders).toEqual([s.old])
    expect(lines.join("\n")).toMatch(/could not move .*EPERM.*trying again next launch/)
    const next = await settleNotesFolder(s.options())
    expect(next.outcome).toBe("moved")
    expect(json(path.join(s.userData, "project.json")).folders).toEqual([s.now])
  })

  it.runIf(win)("a folder Windows really holds (a process working in it): not moved, not copied, moved once it lets go", async () => {
    const s = scratch()
    put(path.join(s.old, "a.md"), "# A\n")
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { cwd: s.old, stdio: "ignore" })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      const held = await settleNotesFolder(s.options())
      expect(held.outcome).toBe("move-failed")
      expect(held.root).toBe(s.old)
      expect(existsSync(s.now)).toBe(false)
    } finally {
      holder.kill()
      await new Promise((resolve) => holder.once("exit", resolve))
    }
    const later = await settleNotesFolder(s.options())
    expect(later.outcome).toBe("moved")
    expect(readFileSync(path.join(s.now, "a.md"), "utf8")).toBe("# A\n")
  }, 15000)

  it("both folders: the old one is used, and the person is told once", async () => {
    const s = scratch()
    put(path.join(s.old, "a.md"), "# mine\n")
    put(path.join(s.now, "swift.md"), "# the Swift app's\n")
    const first = await settleNotesFolder(s.options())
    expect(first.outcome).toBe("kept-old")
    expect(first.root).toBe(s.old)
    expect(first.notice).toBe(keptOldNotice(s.documents))
    expect(first.notice).toMatch(/Your notes stay in Documents.WriteMindCross, because a Documents.WriteMind folder already exists/)
    expect(await first.takeNotice()).toBe(first.notice)
    expect(await first.takeNotice()).toBeNull()
    const second = await settleNotesFolder(s.options())
    expect(second.outcome).toBe("kept-old")
    expect(second.root).toBe(s.old)
    expect(second.notice).toBeNull()
    expect(await second.takeNotice()).toBeNull()
    expect(readdirSync(s.now)).toEqual(["swift.md"])
    expect(existsSync(path.join(s.old, "a.md"))).toBe(true)
  })

  it("the Mac's words name the Swift app; Windows' do not", () => {
    expect(keptOldNotice("/Users/sean/Documents", "darwin")).toBe(
      "Your notes stay in Documents/WriteMindCross, because a Documents/WriteMind folder already exists (on a Mac, usually the Swift WriteMind's notes). Move or merge them yourself if you like.")
    expect(keptOldNotice("C:\\Users\\S\\Documents", "win32")).toBe(
      "Your notes stay in Documents\\WriteMindCross, because a Documents\\WriteMind folder already exists. Move or merge them yourself if you like.")
  })

  it("WRITEMIND_NOTES: that folder, and nothing is looked at or moved", async () => {
    const s = scratch()
    put(path.join(s.old, "a.md"), "# A\n")
    const elsewhere = path.join(s.base, "elsewhere")
    const settled = await settleNotesFolder(s.options({ env: { WRITEMIND_NOTES: elsewhere } }))
    expect(settled).toMatchObject({ outcome: "override", root: elsewhere, notice: null })
    expect(existsSync(path.join(s.old, "a.md"))).toBe(true)
    expect(existsSync(s.now)).toBe(false)
    expect(existsSync(path.join(s.userData, MOVE_STATE_FILE))).toBe(false)
  })

  it("a test instance moves nothing unless it was given a Documents folder of its own", async () => {
    const s = scratch()
    put(path.join(s.old, "a.md"), "# A\n")
    const looked = await settleNotesFolder(s.options({ env: { WRITEMIND_OFFSCREEN: "1" } }))
    expect(looked).toMatchObject({ outcome: "not-moved-in-test", root: s.old })
    expect(existsSync(s.now)).toBe(false)
    const e2e = await settleNotesFolder(s.options({ env: { WRITEMIND_E2E: "1" } }))
    expect(e2e.outcome).toBe("not-moved-in-test")
    const own = await settleNotesFolder(s.options({ env: { WRITEMIND_E2E: "1", WRITEMIND_DOCUMENTS: s.documents } }))
    expect(own).toMatchObject({ outcome: "moved", root: s.now })
  })
})

describe("what the app remembered follows the folder", () => {
  it("project, sessions (and their file names), sheets, project files: under the old folder rewritten, the rest untouched", async () => {
    const s = scratch()
    const note = put(path.join(s.old, "Ideas", "a.md"), "# A\n")
    const outside = path.join(s.documents, "Other", "x.md")
    const insideProject = put(path.join(s.old, "Mine.writemind-project"),
      `{\n  "excluded" : [\n    ${JSON.stringify(path.join(s.old, "Hidden"))}\n  ],\n  "folders" : [\n    ${JSON.stringify(s.old)},\n    ${JSON.stringify(path.dirname(outside))}\n  ],\n  "version" : 1\n}`)
    const topProject = put(path.join(s.documents, "Top.writemind-project"),
      `{\n  "excluded" : [\n\n  ],\n  "folders" : [\n    ${JSON.stringify(path.join(s.old, "Ideas"))},\n    "/Users/sean/Documents/WriteMindCross"\n  ],\n  "version" : 1\n}`)
    const topBefore = readFileSync(topProject, "utf8")
    const insideBefore = readFileSync(insideProject, "utf8")
    put(path.join(s.userData, "project.json"), JSON.stringify({ file: insideProject, folders: [s.old, path.dirname(outside)], excluded: [path.join(s.old, "Hidden")] }))
    // The session of the project in the moved folder: named from the project file's path.
    const session = { root: s.old, open: [{ path: note, caret: 3, collapsed: ["x"] }, { path: outside, caret: 0, collapsed: [] }],
      active: note, unsavedBuffers: { [note]: { text: "typed", base: null } } }
    put(path.join(s.userData, "Sessions", sessionFileName(path.resolve(insideProject))), JSON.stringify(session, null, 2))
    put(path.join(s.userData, "Sessions", "default.json"), JSON.stringify({ ...session, active: outside }, null, 2))
    // The session from before projects had their own: named from the notes folder.
    put(path.join(s.userData, "sessions", sessionFileName(path.resolve(s.old))), JSON.stringify({ root: s.old, open: [{ path: note, caret: 1, collapsed: [] }], active: note, unsavedBuffers: {} }))
    // The tablet's sheets: one bound to an ink cell of the note, one to a note elsewhere. Variants of the old path too.
    const variants = win ? [note.toLowerCase(), note.replace(/\\/g, "/")] : []
    put(path.join(s.userData, "sheets.json"), JSON.stringify({ version: 1, current: "s1", sheets: [
      { id: "s1", name: "A Drawing", paper: { kind: "plain", spacing: 0.05, colour: "#fff" }, strokes: [], cell: { note, cell: "0f8fad5b-d9cb-469f-a165-70867728950e" } },
      { id: "s2", name: "X Drawing", paper: { kind: "plain", spacing: 0.05, colour: "#fff" }, strokes: [], cell: { note: outside, cell: "1f8fad5b-d9cb-469f-a165-70867728950e" } },
      ...variants.map((one, i) => ({ id: `v${i}`, name: `V${i}`, paper: { kind: "plain", spacing: 0.05, colour: "#fff" }, strokes: [], cell: { note: one, cell: "2f8fad5b-d9cb-469f-a165-70867728950e" } })),
    ] }))
    put(path.join(s.userData, "window.json"), JSON.stringify({ width: 1280, height: 800 }))
    const windowBefore = readFileSync(path.join(s.userData, "window.json"), "utf8")

    const settled = await settleNotesFolder(s.options())
    expect(settled.outcome).toBe("moved")
    const moved = (one: string) => path.join(s.now, path.relative(s.old, one))
    const newNote = moved(note)
    const newProject = moved(insideProject)

    const project = json(path.join(s.userData, "project.json"))
    expect(project).toEqual({ file: newProject, folders: [s.now, path.dirname(outside)], excluded: [path.join(s.now, "Hidden")] })
    // its session followed its file name, and its paths
    const own = JSON.parse((await readProjectSession(s.userData, newProject, s.now))!)
    expect(own).toEqual({ ...session, root: s.now, open: [{ path: newNote, caret: 3, collapsed: ["x"] }, session.open[1]], active: newNote, unsavedBuffers: { [newNote]: { text: "typed", base: null } } })
    expect(existsSync(path.join(s.userData, "Sessions", sessionFileName(path.resolve(insideProject))))).toBe(false)
    expect(json(path.join(s.userData, "Sessions", "default.json")).active).toBe(outside)
    expect(json(path.join(s.userData, "Sessions", "default.json")).open[0].path).toBe(newNote)
    expect(json(path.join(s.userData, "sessions", sessionFileName(path.resolve(s.now)))).active).toBe(newNote)
    const sheets = json(path.join(s.userData, "sheets.json")).sheets as Array<{ cell: { note: string } }>
    expect(sheets[0]!.cell.note).toBe(newNote)
    expect(sheets[1]!.cell.note).toBe(outside)
    if (win) {
      expect(sheets[2]!.cell.note).toBe(newNote.slice(0, s.now.length) + note.toLowerCase().slice(s.old.length))
      expect(sheets[3]!.cell.note).toBe(newNote.replace(/\\/g, "/"))
    }
    expect(readFileSync(path.join(s.userData, "window.json"), "utf8")).toBe(windowBefore)
    // The project file inside the moved folder: only the old prefix changed, every other byte as it was.
    const inside = readFileSync(newProject, "utf8")
    const escaped = (one: string) => JSON.stringify(one).slice(1, -1)
    expect(inside).toBe(insideBefore.split(escaped(s.old)).join(escaped(s.now)))
    expect(JSON.parse(inside)).toEqual({ excluded: [path.join(s.now, "Hidden")], folders: [s.now, path.dirname(outside)], version: 1 })
    // The one at the top of Documents: its old folder moved, a Mac path left as written.
    expect(readFileSync(topProject, "utf8")).toBe(topBefore.replace(JSON.stringify(path.join(s.old, "Ideas")), JSON.stringify(path.join(s.now, "Ideas"))))
  })

  it("drawings, ink cells and pictures all read back after the move (today's names and the oldest, absolute-hash ones)", async () => {
    const s = scratch()
    const a = put(path.join(s.old, "a.md"), "# A\n")
    const b = put(path.join(s.old, "Ideas", "b.md"), "# B\n")
    const c = put(path.join(s.old, "Ideas", "Deep", "c.md"), "# C\n")
    setProjectFolders([s.old])
    await writeDrawing(s.old, a, drawing("#111111"))
    const picture = await saveMedia(s.old, new Uint8Array([137, 80, 78, 71, 1, 2, 3]), ".png", b)
    const ink = await saveInkSnapshot(s.old, b, "0f8fad5b-d9cb-469f-a165-70867728950e", "<svg xmlns='http://www.w3.org/2000/svg'/>")
    const bDrawing = JSON.stringify({ items: [{ kind: "image", id: "i1", file: picture.file, center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 1 },
      { kind: "cell", id: "0f8fad5b-d9cb-469f-a165-70867728950e", items: [] }] })
    await writeDrawing(s.old, b, bDrawing)
    put(b, `# B\n\n![ink](.drawings/media/${ink.file})\n`)
    // The oldest naming: the notes root's .drawings, hashed by the note's ABSOLUTE path.
    put(olderDrawingPath(s.old, c), drawing("#333333"))
    setProjectFolders([])

    const settled = await settleNotesFolder(s.options())
    expect(settled.outcome).toBe("moved")
    setProjectFolders([s.now])
    const at = (one: string) => path.join(s.now, path.relative(s.old, one))
    expect(await readDrawing(s.now, at(a))).toBe(drawing("#111111"))
    expect(await readDrawing(s.now, at(b))).toBe(bDrawing)
    expect(await readDrawing(s.now, at(c))).toBe(drawing("#333333"))
    expect(existsSync(olderDrawingPath(s.now, at(c)))).toBe(true)
    const pictureFile = await findMedia(s.now, picture.file)
    expect(pictureFile).toBe(path.join(s.now, ".drawings", "media", picture.file))
    expect([...readFileSync(pictureFile)]).toEqual([137, 80, 78, 71, 1, 2, 3])
    const inkFile = await findMedia(s.now, ink.file)
    expect(inkFile).toBe(path.join(s.now, ".drawings", "media", ink.file))
    expect(readFileSync(inkFile, "utf8")).toMatch(/^<svg/)
    expect(statSync(path.join(s.now, ".drawings")).isDirectory()).toBe(true)
    expect(existsSync(s.old)).toBe(false)
  })

  it("a move cut short between the rename and the rewrite is finished on the next launch", async () => {
    const s = scratch()
    const note = put(path.join(s.old, "a.md"), "# A\n")
    put(path.join(s.userData, "project.json"), JSON.stringify({ file: null, folders: [s.old], excluded: [] }))
    put(path.join(s.userData, "Sessions", "default.json"), JSON.stringify({ root: s.old, open: [{ path: note, caret: 0, collapsed: [] }], active: note, unsavedBuffers: {} }))
    // What a crash right after the rename leaves: the folder renamed, `pending` written, nothing rewritten.
    const { renameSync } = await import("node:fs")
    renameSync(s.old, s.now)
    put(path.join(s.userData, MOVE_STATE_FILE), JSON.stringify({ version: 1, pending: { from: s.old, to: s.now } }))
    const settled = await settleNotesFolder(s.options())
    expect(settled).toMatchObject({ outcome: "moved", root: s.now })
    expect(json(path.join(s.userData, "project.json")).folders).toEqual([s.now])
    expect(json(path.join(s.userData, "Sessions", "default.json")).active).toBe(path.join(s.now, "a.md"))
    expect(json(path.join(s.userData, MOVE_STATE_FILE)).pending).toBeUndefined()
    expect((await settleNotesFolder(s.options())).outcome).toBe("new")
  })
})
