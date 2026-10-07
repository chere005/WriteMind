// Transcribed from WriteMindTests/ExportFormatTests.swift (Mac e8b3266): the format popup under the save panel
// (Sean, 2026-09-21: "export is either as pdf or as project (which is just the directory structure).. output
// format is chosen in the save menu"). The last Swift test (an exported project is just the directory structure)
// writes a file, and is in apps/desktop/test/exportFile.test.ts beside the main process's writer.
import { describe, expect, it } from "vitest"
import {
  EXPORT_FORMATS, ExportFormatChooser, PROJECT_FILE_EXTENSION, exportFilters, exportTarget, formatExtension,
  formatMessage, formatTitle, offeredFormats, type ExportFormat,
} from "../src/export/formats"
import { suggestedName } from "../src/export/document"

// CHANGED 2026-10-06 (Sean: "add export to wolfram notebook"): the popup has a third format, the port's own Wolfram
// Notebook (.nb), between PDF and Project; the lines that counted two formats count three (docs/PARITY.md).
describe("ExportFormatTests", () => {
  it("the popup offers every format by its own name", () => {
    const chooser = new ExportFormatChooser()
    expect(chooser.formats.map(formatTitle)).toEqual(["PDF", "Wolfram Notebook", "Project"])
    expect(chooser.format, "the one somebody means when they press Ctrl+E").toBe("pdf")
  })

  // Nothing is offered that cannot be made: with no note open there is no page to print.
  it("with no note open only the project is offered", () => {
    const chooser = new ExportFormatChooser()
    chooser.setFormats(["project"])
    expect(chooser.formats.map(formatTitle)).toEqual(["Project"])
    expect(chooser.format, "and it is what an export would write").toBe("project")
    // An empty list is not an answer; the old one stands.
    chooser.setFormats([])
    expect(chooser.formats).toEqual(["project"])
    expect(offeredFormats(false)).toEqual(["project"])
    expect(offeredFormats(true)).toEqual(["pdf", "wolfram", "project"])
  })

  it("changing the format is announced", () => {
    const chooser = new ExportFormatChooser()
    const heard: ExportFormat[] = []
    chooser.onChange = (format) => heard.push(format)
    chooser.onChange(chooser.format)
    expect(heard).toEqual(["pdf"])
    // Port: the popup moving is announced; moving to where it already is, or to something not listed, is not.
    chooser.choose("project")
    chooser.choose("project")
    expect(heard).toEqual(["pdf", "project"])
    chooser.setFormats(["project"])
    chooser.choose("pdf")
    expect(heard).toEqual(["pdf", "project"])
  })

  it("each format names the extension it writes", () => {
    expect(formatExtension("pdf")).toBe("pdf")
    expect(formatExtension("project")).toBe(PROJECT_FILE_EXTENSION)
    expect(formatExtension("wolfram")).toBe("nb")
    expect(EXPORT_FORMATS.length).toBe(3)
    expect(formatMessage("project")).toContain("the folders, not the notes")
    expect(formatMessage("wolfram")).toBe("Where the Wolfram notebook goes.")
  })

  // Port-only: the name the panel opens with follows the format it opens on.
  it("suggests the note's own name with the format's extension", () => {
    expect(suggestedName("C:\\notes\\Lecture 3.md")).toBe("Lecture 3.pdf")
    expect(suggestedName("/notes/Lecture 3.md", "nb")).toBe("Lecture 3.nb")
    expect(suggestedName("/notes/README", "nb")).toBe("README.nb")
  })
})

// Port-only: Windows' save dialog is the popup ("Save as type"), and its answer is read back from the file name.
describe("the save dialog's answer", () => {
  it("lists the offered formats as the dialog's file types, in the popup's order", () => {
    expect(exportFilters(offeredFormats(true))).toEqual([
      { name: "PDF", extensions: ["pdf"] },
      { name: "Wolfram Notebook", extensions: ["nb"] },
      { name: "Project", extensions: [PROJECT_FILE_EXTENSION] },
    ])
    expect(exportFilters(offeredFormats(false))).toEqual([{ name: "Project", extensions: [PROJECT_FILE_EXTENSION] }])
  })

  it("is the format its extension names, whatever the case", () => {
    const chooser = new ExportFormatChooser()
    expect(exportTarget("C:\\Users\\S\\Documents\\Notes.writemind-project", chooser))
      .toEqual({ format: "project", file: "C:\\Users\\S\\Documents\\Notes.writemind-project" })
    expect(chooser.format, "the chooser follows the answer").toBe("project")
    expect(exportTarget("C:\\out\\Lecture 3.PDF", new ExportFormatChooser()))
      .toEqual({ format: "pdf", file: "C:\\out\\Lecture 3.PDF" })
    expect(exportTarget("/Users/s/Documents/Lecture 3.nb", new ExportFormatChooser()))
      .toEqual({ format: "wolfram", file: "/Users/s/Documents/Lecture 3.nb" })
  })

  it("a name typed without one still gets the extension it chose", () => {
    expect(exportTarget("C:\\out\\Lecture", new ExportFormatChooser())).toEqual({ format: "pdf", file: "C:\\out\\Lecture.pdf" })
    const projectOnly = new ExportFormatChooser()
    projectOnly.setFormats(offeredFormats(false))
    expect(exportTarget("/home/s/Shape", projectOnly)).toEqual({ format: "project", file: "/home/s/Shape.writemind-project" })
    // A dot in a folder's name is not an extension, nor is a name's leading dot.
    expect(exportTarget("C:\\v1.2\\Lecture", new ExportFormatChooser()).file).toBe("C:\\v1.2\\Lecture.pdf")
    expect(exportTarget("/home/s/.hidden", new ExportFormatChooser()).file).toBe("/home/s/.hidden.pdf")
  })

  it("a format that is not offered is not written: the file says what it is", () => {
    const projectOnly = new ExportFormatChooser()
    projectOnly.setFormats(["project"])
    expect(exportTarget("C:\\out\\x.pdf", projectOnly)).toEqual({ format: "project", file: "C:\\out\\x.pdf.writemind-project" })
  })
})
