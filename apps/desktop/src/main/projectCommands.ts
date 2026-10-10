/**
 * The Project menu's commands and the sidebar's, as the main process does
 * them: the dialogs (which the page cannot open), the project file, and the
 * word to the page that the project has changed. The rules about folders and
 * the file are `project.ts`'s; this is the wiring, kept out of `main.ts`.
 */

import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from "electron"
import { promises as fs } from "node:fs"
import path from "node:path"
import { within } from "./atomic"
import { PROJECT_EXTENSION, type ProjectStore } from "./project"

export type ProjectChange = "switch" | "folders" | "saved"

/** What the page needs to know about the open project. */
export interface ProjectInfo {
  name: string
  /** The project's file, or null for the untitled one. This is also the key of its session. */
  file: string | null
  /** The folders have changed since the file was written (or the project has no file and has changed). */
  edited: boolean
  folders: { path: string; name: string; exists: boolean }[]
  /** Folders kept out of the sidebar and left on disk. */
  excluded: { path: string; name: string; exists: boolean }[]
  /** The file was written by a newer WriteMind (SPEC-WM 4.3): shown as it is, and saved over only after the person agrees. */
  newer?: boolean
}

/** The ids this module answers: the page and the menu send them to the main process. */
export const PROJECT_COMMANDS =
  /^(addFolder|checkFolders|saveProject|saveProjectAs|openProject|newProject|(removeFolder|excludeFolder|includeFolder):.*)$/

/** A folder on a share that is not reachable says so after half a minute; the sidebar does not wait that long to be drawn. */
const isFolder = async (folder: string): Promise<boolean> =>
  !!(await within(4000, fs.stat(folder)))?.isDirectory()

const named = async (folder: string) => ({
  path: folder, name: path.basename(folder) || folder, exists: await isFolder(folder),
})

export async function projectInfo(project: ProjectStore): Promise<ProjectInfo> {
  return {
    name: project.name,
    file: project.file,
    edited: project.dirty,
    folders: await Promise.all(project.folders.map(named)),
    excluded: await Promise.all(project.excluded.map(named)),
    ...(project.newer ? { newer: true } : {}),
  }
}

export interface ProjectDeps {
  project: ProjectStore
  window(): BrowserWindow | null
  /** Where a new project starts: the app's own notes folder. */
  home(): string
  /** Where the dialogs open when the project has no folder of its own to offer. */
  documents(): string
  /** The `.wm` files open in the window now, in tab order: a save writes them as the project's `files` (SPEC-WM 4.1). */
  openFiles?(): string[]
  /** Whether to save over a project file a newer WriteMind wrote (it keeps the version it had). */
  confirmNewer?(parent: BrowserWindow, file: string): Promise<boolean>
  /** The dialogs, which a test run answers ahead of time. */
  askOpen(parent: BrowserWindow, options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>
  askSave(parent: BrowserWindow, options: SaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  /**
   * The project changed: watch its folders, re-read the tree, remember it,
   * rebuild the menu and tell the page. `switch` is another project
   * (open, new) — the page keeps this one's session and loads that one's;
   * `folders` is the same project with other folders; `saved` is only its file.
   */
  changed(kind: ProjectChange): Promise<void>
}

const FILTERS = [{ name: "WriteMind project", extensions: [PROJECT_EXTENSION] }]

/** Run one project command. False when the id is not one of ours. */
export async function runProjectCommand(id: string, deps: ProjectDeps): Promise<boolean> {
  const { project } = deps
  const parent = deps.window() ?? undefined
  if (!PROJECT_COMMANDS.test(id)) return false

  if (id === "addFolder") {
    if (!parent) return true
    const chosen = await deps.askOpen(parent, {
      properties: ["openDirectory", "createDirectory"],
      title: `Add a folder of notes to “${project.name}”`,
      buttonLabel: "Add to Project",
    })
    // The same folder twice is the same folder once, and nothing changes.
    if (!chosen.canceled && chosen.filePaths[0] && project.addFolder(chosen.filePaths[0])) await deps.changed("folders")
  } else if (id === "checkFolders") {
    // "Check Again" on the panel that says the folders are not there: the folders are looked for afresh, the ones
    // that have come back are watched, and the page is told what is there now.
    await deps.changed("folders")
  } else if (id.startsWith("removeFolder:")) {
    if (project.removeFolder(id.slice("removeFolder:".length))) await deps.changed("folders")
  } else if (id.startsWith("excludeFolder:")) {
    if (project.exclude(id.slice("excludeFolder:".length))) await deps.changed("folders")
  } else if (id.startsWith("includeFolder:")) {
    if (project.include(id.slice("includeFolder:".length))) await deps.changed("folders")
  } else if (id === "saveProject") {
    if (deps.openFiles) project.setFiles(deps.openFiles())
    // A project file a NEWER WriteMind wrote is saved over only after the person says so (SPEC-WM 4.3).
    if (project.file && project.newer && parent && !(await (deps.confirmNewer ?? confirmNewer)(parent, project.file))) return true
    // A project file that is read-only, locked or gone says so, as Save As does: the project stays "edited".
    try {
      if (!(await project.save())) return runProjectCommand("saveProjectAs", deps)
    } catch (error) {
      if (parent) {
        await dialog.showMessageBox(parent, {
          type: "warning", message: "WriteMind could not save the project.",
          detail: `${(error as Error).message}\nThe project is still open and still edited.`,
        })
      }
      return true
    }
    await deps.changed("saved")
  } else if (id === "saveProjectAs") {
    if (!parent) return true
    if (deps.openFiles) project.setFiles(deps.openFiles())
    const where = await deps.askSave(parent, {
      // Beside the project's file when it has one, else in Documents.
      defaultPath: path.join(project.file ? path.dirname(project.file) : deps.documents(),
        `${project.name}.${PROJECT_EXTENSION}`),
      title: "Save this project's folders as a file you can reopen",
      filters: FILTERS,
    })
    if (!where.canceled && where.filePath) {
      try {
        await project.saveAs(where.filePath)
      } catch (error) {
        await dialog.showMessageBox(parent, {
          type: "warning", message: "WriteMind could not save the project.", detail: (error as Error).message,
        })
        return true
      }
      await deps.changed("saved")
    }
  } else if (id === "openProject") {
    if (!parent) return true
    const chosen = await deps.askOpen(parent, {
      properties: ["openFile"],
      title: "Choose a WriteMind project",
      filters: [...FILTERS, { name: "All files", extensions: ["*"] }],
    })
    if (chosen.canceled || !chosen.filePaths[0]) return true
    if (await project.open(chosen.filePaths[0])) await deps.changed("switch")
    else {
      await dialog.showMessageBox(parent, {
        type: "warning", message: "WriteMind could not open that project.",
        detail: `“${path.basename(chosen.filePaths[0])}” is not a WriteMind project file.`,
      })
    }
  } else if (id === "newProject") {
    project.newProject(deps.home())
    await deps.changed("switch")
  }
  return true
}

/** The question before a newer WriteMind project file is saved over. */
async function confirmNewer(parent: BrowserWindow, file: string): Promise<boolean> {
  const answer = await dialog.showMessageBox(parent, {
    type: "question", message: "This project was saved by a newer WriteMind.",
    detail: `“${path.basename(file)}” may hold settings this version does not understand. Saving keeps them as they are, but this version may not show them.`,
    buttons: ["Save", "Cancel"], defaultId: 1, cancelId: 1,
  })
  return answer.response === 0
}
