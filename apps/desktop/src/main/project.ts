/**
 * A project is a list of folders in a JSON file — Sublime Text's shape, and
 * the Mac's (`Project.swift`, `ProjectStore.swift`). What is NOT in the file
 * is the session (which notes are open, where the caret was), which already
 * lives in the app's user-data folder.
 *
 * The folders are the durable part, so the file reads as a file: absolute
 * paths, pretty-printed, sorted keys. `excluded` are folders INSIDE the
 * project's folders that are kept out of the sidebar and left on disk ("Remove
 * Folder from Project" — the Trash is for a folder that should go).
 *
 * This file has no Electron in it: the dialogs are the shell's, and this is
 * the part that can be tested.
 */

import { promises as fs } from "node:fs"
import path from "node:path"

export const PROJECT_EXTENSION = "writemind-project"

export interface Project {
  version: number
  folders: string[]
  excluded: string[]
}

const clean = (folder: string): string => path.resolve(folder)
const same = (a: string, b: string): boolean =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b

/** A project file written before `excluded` existed still opens. */
export function parseProject(text: string): Project | null {
  try {
    const given = JSON.parse(text) as Partial<Project>
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : []
    return {
      version: typeof given.version === "number" ? given.version : 1,
      folders: strings(given.folders),
      excluded: strings(given.excluded),
    }
  } catch {
    return null
  }
}

export function stringifyProject(project: Project): string {
  // Sorted keys, paths unescaped: the file is meant to be read and edited by hand.
  return JSON.stringify({
    excluded: project.excluded, folders: project.folders, version: project.version,
  }, null, 2) + "\n"
}

/** What the app remembers between launches: the file (if any) and the folders. */
interface Remembered { file: string | null; folders: string[]; excluded: string[] }

export class ProjectStore {
  folders: string[]
  excluded: string[] = []
  file: string | null = null
  /** The folders have changed since the file was written (only meaningful with a file). */
  dirty = false

  constructor(defaultFolder: string) {
    this.folders = [clean(defaultFolder)]
  }

  /** "Untitled Project", or the file's name without its extension. */
  get name(): string {
    return this.file ? path.basename(this.file, path.extname(this.file)) : "Untitled Project"
  }

  get project(): Project {
    return { version: 1, folders: [...this.folders], excluded: [...this.excluded] }
  }

  addFolder(folder: string): boolean {
    const next = clean(folder)
    if (this.folders.some((one) => same(one, next))) return false
    this.folders.push(next)
    this.dirty = true
    return true
  }

  removeFolder(folder: string): boolean {
    const next = clean(folder)
    // A project always has a folder; the menu disables the last one, this is the belt.
    if (this.folders.length <= 1) return false
    const left = this.folders.filter((one) => !same(one, next))
    if (left.length === this.folders.length) return false
    this.folders = left
    this.dirty = true
    return true
  }

  exclude(folder: string): void {
    const next = clean(folder)
    if (this.excluded.some((one) => same(one, next))) return
    this.excluded.push(next)
    this.dirty = true
  }

  include(folder: string): void {
    const next = clean(folder)
    const left = this.excluded.filter((one) => !same(one, next))
    if (left.length === this.excluded.length) return
    this.excluded = left
    this.dirty = true
  }

  /** A project of one folder, with no file yet. */
  newProject(startingAt: string): void {
    this.folders = [clean(startingAt)]
    this.excluded = []
    this.file = null
    this.dirty = false
  }

  async open(file: string): Promise<boolean> {
    const parsed = parseProject(await fs.readFile(file, "utf8").catch(() => ""))
    if (!parsed || parsed.folders.length === 0) return false
    this.folders = parsed.folders.map(clean)
    this.excluded = parsed.excluded.map(clean)
    this.file = file
    this.dirty = false
    return true
  }

  /** Save over the project's own file; false when there is none yet (ask for one). */
  async save(): Promise<boolean> {
    if (!this.file) return false
    await this.write(this.file)
    return true
  }

  async saveAs(file: string): Promise<void> {
    const named = path.extname(file) ? file : `${file}.${PROJECT_EXTENSION}`
    await this.write(named)
    this.file = named
  }

  private async write(file: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const partial = `${file}.tmp`
    await fs.writeFile(partial, stringifyProject(this.project), "utf8")
    await fs.rename(partial, file)
    this.dirty = false
  }

  // MARK: - Between launches

  async remember(stateFile: string): Promise<void> {
    const state: Remembered = { file: this.file, folders: this.folders, excluded: this.excluded }
    await fs.mkdir(path.dirname(stateFile), { recursive: true })
    await fs.writeFile(stateFile, JSON.stringify(state), "utf8")
  }

  /** Come back to the project that was open: its file if it has one, else its cached folders. */
  async restore(stateFile: string): Promise<void> {
    let state: Remembered | null = null
    try { state = JSON.parse(await fs.readFile(stateFile, "utf8")) as Remembered } catch { return }
    if (state.file && await this.open(state.file)) return
    if (Array.isArray(state.folders) && state.folders.length > 0) {
      this.folders = state.folders.map(clean)
      this.excluded = (state.excluded ?? []).map(clean)
      this.file = null
    }
  }
}
