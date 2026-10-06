import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

// The commands call the shell's dialog; here it is a spy.
const { showMessageBox } = vi.hoisted(() => ({ showMessageBox: vi.fn(async (..._args: unknown[]) => ({ response: 0 })) }))
vi.mock("electron", () => ({ dialog: { showMessageBox, showOpenDialog: vi.fn(), showSaveDialog: vi.fn() } }))

import { ProjectStore } from "../src/main/project"
import { runProjectCommand, type ProjectDeps } from "../src/main/projectCommands"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-psave-"))

function deps(project: ProjectStore): ProjectDeps & { changed: ReturnType<typeof vi.fn> } {
  const changed = vi.fn(async () => undefined)
  return {
    project, window: () => ({} as never), home: () => project.folders[0]!, documents: () => os.tmpdir(),
    askOpen: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    askSave: vi.fn(async () => ({ canceled: true })),
    changed,
  }
}

// t05 (verifier): Save Project on a project file that cannot be written had no try/catch: no dialog, the menu still
// said "edited", the main process got an unhandled rejection, and `Save.writemind-project.tmp` stayed in the person's folder.
describe("Save Project when the project file will not take it", () => {
  it("says so in a dialog, keeps the project edited, and leaves nothing beside the file", async () => {
    const dir = scratch()
    const project = new ProjectStore(scratch())
    const file = path.join(dir, "Save.writemind-project")
    await project.saveAs(file)
    project.addFolder(scratch())
    expect(project.dirty).toBe(true)
    const before = readFileSync(file, "utf8")
    chmodSync(file, 0o444)
    showMessageBox.mockClear()
    const wiring = deps(project)
    try {
      await expect(runProjectCommand("saveProject", wiring)).resolves.toBe(true)
    } finally { chmodSync(file, 0o644) }
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(showMessageBox.mock.calls[0])).toContain("could not save the project")
    expect(wiring.changed).not.toHaveBeenCalled()
    expect(project.dirty).toBe(true)
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(readdirSync(dir)).toEqual(["Save.writemind-project"])
  })

  it("saves, and tells the page, when it can", async () => {
    const dir = scratch()
    const project = new ProjectStore(scratch())
    await project.saveAs(path.join(dir, "Fine.writemind-project"))
    project.addFolder(scratch())
    showMessageBox.mockClear()
    const wiring = deps(project)
    await runProjectCommand("saveProject", wiring)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(wiring.changed).toHaveBeenCalledWith("saved")
    expect(project.dirty).toBe(false)
    expect(readdirSync(dir)).toEqual(["Fine.writemind-project"])
  })

  it("never leaves a .tmp when the save cannot be made (ProjectStore.save, Save As)", async () => {
    const dir = scratch()
    const project = new ProjectStore(scratch())
    const file = path.join(dir, "Locked.writemind-project")
    writeFileSync(file, "{}")
    project.file = file
    chmodSync(file, 0o444)
    try {
      await expect(project.save()).rejects.toBeTruthy()
    } finally { chmodSync(file, 0o644) }
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(readdirSync(dir)).toEqual(["Locked.writemind-project"])
  })
})

// t11 (verifier): a remembered project file on an unreachable share held the window back for 29.5 s.
describe("starting with a remembered project whose file does not answer", () => {
  it("gives up on the file after the wait and starts from the folders it was cached with — keeping the file", async () => {
    const home = scratch()
    const folder = scratch()
    const state = path.join(scratch(), "project.json")
    // A file on a share that does not answer: a UNC path on Windows, the share's mount on a Mac (the reader never
    // answers either way; a Mac's path.basename would rightly take all of a UNC path for one name).
    const remembered = process.platform === "win32"
      ? "\\\\198.51.100.23\\notes\\Work.writemind-project" : "/Volumes/notes/Work.writemind-project"
    writeFileSync(state, JSON.stringify({ file: remembered, folders: [folder], excluded: [] }))
    const store = new ProjectStore(home)
    const started = Date.now()
    await store.restore(state, 150, () => new Promise<string>(() => undefined))
    expect(Date.now() - started).toBeLessThan(2000)
    expect(store.folders).toEqual([path.resolve(folder)])
    expect(store.file).toBe(remembered)
    expect(store.name).toBe("Work")
  })

  it("opens the file when it answers in time", async () => {
    const home = scratch()
    const dir = scratch()
    const folder = scratch()
    const file = path.join(dir, "Work.writemind-project")
    writeFileSync(file, JSON.stringify({ version: 1, folders: [folder], excluded: [] }))
    const state = path.join(scratch(), "project.json")
    writeFileSync(state, JSON.stringify({ file, folders: [home], excluded: [] }))
    const store = new ProjectStore(home)
    await store.restore(state, 1000)
    expect(store.file).toBe(file)
    expect(store.folders).toEqual([path.resolve(folder)])
  })

  it("forgets a file that is plainly gone, as before (it is the folders that come back)", async () => {
    const home = scratch()
    const folder = scratch()
    const state = path.join(scratch(), "project.json")
    writeFileSync(state, JSON.stringify({ file: path.join(scratch(), "deleted.writemind-project"), folders: [folder], excluded: [] }))
    const store = new ProjectStore(home)
    await store.restore(state, 1000)
    expect(store.file).toBeNull()
    expect(store.folders).toEqual([path.resolve(folder)])
  })
})
