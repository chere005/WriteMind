// File ▸ Export… (main/exportFile.ts): one panel, PDF or Project chosen in it. The last test of
// WriteMindTests/ExportFormatTests.swift (Mac e8b3266) is transcribed here, beside the writer it tests.
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { BrowserWindow, SaveDialogOptions } from "electron"
import { PROJECT_FILE_EXTENSION } from "@writemind/core"
import { exportFile, writeProjectFile, type ExportFileDeps } from "../src/main/exportFile"
import { PROJECT_EXTENSION, parseProject } from "../src/main/project"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-export-"))
const note = {
  noteFile: "C:\\notes\\Lecture 3.md", title: "Lecture 3", markdown: "# Lecture 3\n\nwords", drawing: null,
  pane: { width: 700, height: 900 },
}

function deps(answer: string | null, over: Partial<ExportFileDeps> = {}) {
  const asked: SaveDialogOptions[] = []
  const pdfs: string[] = []
  const reports: string[] = []
  const d: ExportFileDeps = {
    window: {} as BrowserWindow,
    documents: "C:\\Users\\S\\Documents",
    askSave: async (_parent, options) => {
      asked.push(options)
      return answer ? { canceled: false, filePath: answer } : { canceled: true }
    },
    project: () => ({ name: "Course", project: { version: 1, folders: ["/a/notes", "/b/more"], excluded: ["/a/notes/old"] } }),
    writePdf: async (file) => { pdfs.push(file) },
    report: async (_parent, message) => { reports.push(message) },
    ...over,
  }
  return { d, asked, pdfs, reports }
}

describe("ExportFormatTests (the file it writes)", () => {
  it("each format names the extension it writes: the project's is the project file's own", () => {
    expect(PROJECT_FILE_EXTENSION).toBe(PROJECT_EXTENSION)
  })

  // An exported project is the FOLDERS and nothing else — it names no note, because the notes are already
  // files and a project is only the shape they sit in.
  it("an exported project is just the directory structure", async () => {
    const file = path.join(scratch(), `Out.${PROJECT_EXTENSION}`)
    await writeProjectFile(file, { version: 1, folders: ["/a/notes", "/b/more"], excluded: ["/a/notes/old"] })
    const text = readFileSync(file, "utf8")
    expect(text).toContain("/a/notes")
    expect(text).toContain("/a/notes/old")
    expect(text, "no note is written into it").not.toContain(".md")
    expect(parseProject(text)?.folders).toEqual(["/a/notes", "/b/more"])
  })
})

describe("File ▸ Export…: one panel, the format chosen in it", () => {
  it("with a note open the panel offers PDF then Project, named for the note, in Documents", async () => {
    const { d, asked } = deps(null)
    expect(await exportFile(note, d)).toBeNull()
    expect(asked).toHaveLength(1)
    expect(asked[0]!.filters).toEqual([
      { name: "PDF", extensions: ["pdf"] }, { name: "Project", extensions: [PROJECT_EXTENSION] },
    ])
    expect(asked[0]!.defaultPath).toBe(path.join("C:\\Users\\S\\Documents", "Lecture 3.pdf"))
    expect(asked[0]!.properties).toContain("showOverwriteConfirmation")
  })

  it("an answer ending .pdf is the note's PDF", async () => {
    const { d, pdfs } = deps("C:\\out\\Lecture 3.pdf")
    expect(await exportFile(note, d)).toEqual({ format: "pdf", file: "C:\\out\\Lecture 3.pdf" })
    expect(pdfs).toEqual(["C:\\out\\Lecture 3.pdf"])
  })

  it("an answer ending in the project's extension is the project, and no PDF is made", async () => {
    const file = path.join(scratch(), `Shape.${PROJECT_EXTENSION}`)
    const { d, pdfs } = deps(file)
    expect(await exportFile(note, d)).toEqual({ format: "project", file })
    expect(pdfs).toEqual([])
    expect(parseProject(readFileSync(file, "utf8"))).toEqual({
      version: 1, folders: ["/a/notes", "/b/more"], excluded: ["/a/notes/old"],
    })
  })

  it("with no note open only the project is offered, named for the project", async () => {
    const dir = scratch()
    const { d, asked } = deps(path.join(dir, "Course"))
    const done = await exportFile(null, d)
    expect(asked[0]!.filters).toEqual([{ name: "Project", extensions: [PROJECT_EXTENSION] }])
    expect(asked[0]!.defaultPath).toBe(path.join("C:\\Users\\S\\Documents", `Course.${PROJECT_EXTENSION}`))
    // A name typed without an extension still gets the one it chose.
    expect(done).toEqual({ format: "project", file: path.join(dir, `Course.${PROJECT_EXTENSION}`) })
    expect(existsSync(done!.file)).toBe(true)
  })

  it("asks nothing when there is nothing to make: no note and no folders", async () => {
    const { d, asked } = deps("C:\\x", { project: () => ({ name: "Empty", project: { version: 1, folders: [], excluded: [] } }) })
    expect(await exportFile(null, d)).toBeNull()
    expect(asked).toHaveLength(0)
  })

  it("a write that fails says so, and nothing is reported as made", async () => {
    const { d, reports } = deps("C:\\out\\Lecture 3.pdf", { writePdf: async () => { throw new Error("disk full") } })
    expect(await exportFile(note, d)).toBeNull()
    expect(reports).toEqual(["Could not write “Lecture 3.pdf”"])
  })
})
