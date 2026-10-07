/**
 * File ▸ Export… (Ctrl+E): ONE command and ONE save panel, and the format is
 * chosen in it (the Mac's `ExportMenu.export()`, 2026-09-21: "export is
 * either as pdf or as project (which is just the directory structure)..
 * output format is chosen in the save menu").
 *
 * The panel's "Save as type" list is the Mac's Format popup
 * (`@writemind/core`'s `export/formats.ts` says how the answer is read back).
 * A PDF is the note as it reads (`exportPdf.ts`); a Wolfram notebook is the
 * note as cells of Mathematica's, its drawings Images (`wolfram/notebookFile.ts`,
 * port-only), and what the export has to say about its drawings is said once
 * the file is written (`tell`); a project is the FOLDERS
 * and nothing else — the folders in it and the ones kept out of it, no note
 * copied, because the notes are already files and a project is only the shape
 * they sit in. An exported project is a copy: the open project keeps its own
 * file and stays exactly as it was ("Save Project As…" is the one that moves
 * it).
 *
 * No Electron at run time in here (the dialogs come in through `deps`), so
 * the whole flow is a vitest (`test/exportFile.test.ts`).
 */

import type { BrowserWindow, SaveDialogOptions } from "electron"
import path from "node:path"
import {
  ExportFormatChooser, exportFilters, exportTarget, formatExtension, formatMessage, offeredFormats, suggestedName,
  type ExportFormat,
} from "@writemind/core"
import { writeFileAtomic } from "./atomic"
import type { ExportRequest } from "./exportPdf"
import { stringifyProject, type Project } from "./project"

export interface ExportFileDeps {
  window: BrowserWindow | null
  /** Where the panel opens: the folder a person looks in for a file they made. */
  documents: string
  /** The save dialog (the test run answers it ahead of time). */
  askSave(parent: BrowserWindow, options: SaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  /** The open project: its name, and the folders in it and kept out of it. */
  project(): { name: string; project: Project }
  /** The note on paper, written to `file`; throws when it cannot be. */
  writePdf(file: string, request: ExportRequest): Promise<void>
  /**
   * The note as a Wolfram notebook, written to `file`; throws when it cannot be. Resolves what to tell the person
   * about its drawings (some could not be made: they appear when its cells are evaluated), or null.
   */
  writeNotebook(file: string, request: ExportRequest): Promise<{ message: string; detail: string } | null>
  /** A failed export is worth a word: a file that silently did not appear is the worst of the three outcomes. */
  report(parent: BrowserWindow, message: string, detail: string): Promise<void>
  /** A written export with something to say (a notebook whose drawings were not all made): one OK. */
  tell(parent: BrowserWindow, notice: { message: string; detail: string }): Promise<void>
}

/** The project as a file: the folders and the excluded ones, and no note. */
export async function writeProjectFile(file: string, project: Project): Promise<void> {
  await writeFileAtomic(file, stringifyProject(project))
}

/**
 * Ask where it goes and what it is, then write it. `request` is the note in
 * front (null when none is open: then only the project is offered). Resolves
 * what was written, or null when the panel was cancelled or the write failed.
 */
export async function exportFile(request: ExportRequest | null, deps: ExportFileDeps):
  Promise<{ format: ExportFormat; file: string } | null> {
  const parent = deps.window
  if (!parent) return null
  const { name, project } = deps.project()
  // Nothing to make: no page to print and no folders to name (the Mac's menu item is disabled then).
  if (!request && project.folders.length === 0) return null

  const chooser = new ExportFormatChooser()
  chooser.setFormats(offeredFormats(request !== null))
  const first = chooser.format
  // The name follows the format the panel opens on (the Mac renames it as the popup moves; Windows swaps
  // only the extension when another type is picked).
  const suggested = first !== "project" && request
    ? suggestedName(request.noteFile, formatExtension(first))
    : `${name}.${formatExtension("project")}`
  const where = await deps.askSave(parent, {
    title: request ? `Export “${request.title}”` : `Export “${name}”`,
    message: formatMessage(first),
    defaultPath: path.join(deps.documents, suggested),
    filters: exportFilters(chooser.formats),
    properties: ["createDirectory", "showOverwriteConfirmation"],
  })
  if (where.canceled || !where.filePath) return null

  const target = exportTarget(where.filePath, chooser)
  let notice: { message: string; detail: string } | null = null
  try {
    switch (target.format) {
      case "pdf":
        if (request) { await deps.writePdf(target.file, request); break }
        await writeProjectFile(target.file, project)
        break
      case "wolfram":
        if (request) { notice = await deps.writeNotebook(target.file, request); break }
        await writeProjectFile(target.file, project)
        break
      case "project":
        await writeProjectFile(target.file, project)
        break
    }
  } catch (error) {
    await deps.report(parent, `Could not write “${path.basename(target.file)}”`,
      (error as Error).message || "WriteMind could not export this.")
    return null
  }
  // Said after the file is there, so the file is never held up by the dialog.
  if (notice) await deps.tell(parent, notice)
  return target
}
