/**
 * A project is a list of folders in a JSON file — Sublime Text's shape, and
 * the Mac's (`Project.swift`, `ProjectStore.swift`). What is NOT in the file
 * is the session (which notes are open, where the caret was), which lives in
 * the app's user-data folder, one file per project.
 *
 * THE FILE IS THE MAC'S, BYTE FOR BYTE in shape: `{"excluded", "folders",
 * "version"}`, sorted keys, pretty-printed the way Foundation prints it
 * (`"key" : value`), paths unescaped. A `.writemind-project` saved on the Mac
 * opens here and the other way round; the paths in it belong to the machine
 * that wrote them, so a path from the OTHER kind of machine (`/Users/…` on
 * Windows, `C:\…` on a Mac) is kept exactly as written — it shows as a folder
 * that is not there, and saving does not mangle it.
 *
 * `excluded` are folders INSIDE the project's folders that are kept out of the
 * sidebar and left on disk ("Remove Folder from Project" — the Trash is for a
 * folder that should go).
 *
 * This file has no Electron in it: the dialogs are the shell's, and this is
 * the part that can be tested.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import {
  isWmName, parseProjectData, resolvePaths, sessionFileName, stringifyProjectData, writtenPath, type PathOps, type ProjectData,
} from "@writemind/core"
import { codeOf, within, writeFileAtomic } from "./atomic"

export const PROJECT_EXTENSION = "writemind-project"

/** The project file's version this build writes for a project of its own (a file that says more keeps what it said). */
export const PROJECT_VERSION = 1

export interface Project {
  version: number
  folders: string[]
  excluded: string[]
  /** The `.wm` files open in the project, in tab order (docs/SPEC-WM.md 4.1). */
  files: string[]
  /** Keys of the file this build does not know, kept as they were (4.3). */
  extra?: Record<string, unknown>
}

/**
 * A path that belongs to the other kind of machine: a POSIX absolute path on
 * Windows (it would resolve against the current drive and become somebody
 * else's folder), or a drive path anywhere else.
 */
export function isForeignPath(folder: string, platform: string = process.platform): boolean {
  if (platform === "win32") return /^\/(?![\\/])/.test(folder)
  return /^[A-Za-z]:[\\/]/.test(folder) || folder.startsWith("\\\\")
}

/** Absolute and tidy — except a path from another kind of machine, which is left exactly as it was written. */
export function cleanPath(folder: string, platform: string = process.platform): string {
  return isForeignPath(folder, platform) ? folder : path.resolve(folder)
}

const clean = (folder: string): string => cleanPath(folder)
const same = (a: string, b: string): boolean =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b

/** The path rules of this machine, as the pure project code asks for them. */
const ops: PathOps = path

/**
 * A project file's text as a project: the paths as the file has them (a relative one is resolved against the file's
 * folder by `ProjectStore`, which knows where the file is), the keys it does not know kept in `extra`. A project file
 * written before `excluded` or `files` existed still opens.
 */
export function parseProject(text: string): Project | null {
  const data = parseProjectData(text)
  if (!data) return null
  return {
    version: data.version, folders: data.folders, excluded: data.excluded, files: data.files,
    ...(Object.keys(data.extra).length > 0 ? { extra: data.extra } : {}),
  }
}

/**
 * Foundation's `.prettyPrinted + .sortedKeys + .withoutEscapingSlashes`:
 * two-space indent, a space either side of the colon, and an empty array as
 * an open bracket, a blank line and a close bracket. The Mac reads any JSON;
 * this is so that a project shared through a repository does not change shape each
 * time the other machine saves it. With `file`, a path under the file's folder is written relative to it
 * (`/`-separated); everything else is written as it is (docs/SPEC-WM.md 4.2).
 */
export function stringifyProject(project: Project, file: string | null = null): string {
  const written = (list: string[]): string[] =>
    list.map((one) => writtenPath(one, file, ops, isForeignPath, process.platform === "win32"))
  const data: ProjectData = {
    version: project.version, folders: written(project.folders), excluded: written(project.excluded),
    files: written(project.files ?? []), extra: project.extra ?? {},
  }
  return stringifyProjectData(data)
}

/** The paths of a read project made absolute (relative ones against the project file's folder), each place once. */
export function resolveProject(project: Project, file: string | null): Project {
  const resolve = (list: string[]): string[] => resolvePaths(list, file, ops, isForeignPath, process.platform === "win32")
  return { ...project, folders: resolve(project.folders), excluded: resolve(project.excluded), files: resolve(project.files) }
}

/** What the app remembers between launches: the file (if any) and the folders. */
interface Remembered { file: string | null; folders: string[]; excluded: string[] }

/**
 * Where a project's session is cached: one file per project, named from the
 * project file's own path so two projects called the same thing in different
 * places do not share one — and `default.json` for a project that has no file
 * yet (`ProjectSession.url(forProjectAt:)`).
 */
export function projectSessionFile(userData: string, projectFile: string | null): string {
  const name = projectFile ? sessionFileName(path.resolve(projectFile)) : "default.json"
  return path.join(userData, "Sessions", name)
}

export class ProjectStore {
  folders: string[]
  excluded: string[] = []
  /** The `.wm` files open in the project, in tab order (4.1); entries that are not `.wm` files are kept and ignored. */
  files: string[] = []
  /** The version the file said (kept when it is saved over), and the keys it has that this build does not know (4.3). */
  version = PROJECT_VERSION
  extra: Record<string, unknown> = {}
  file: string | null = null
  /** The folders have changed since the file was written. (True for an untitled project too: the menu says "edited" either way.) */
  dirty = false
  private readonly home: string

  constructor(defaultFolder: string) {
    this.home = clean(defaultFolder)
    this.folders = [this.home]
  }

  /** "Untitled Project", or the file's name without its extension. */
  get name(): string {
    return this.file ? path.basename(this.file, path.extname(this.file)) : "Untitled Project"
  }

  get project(): Project {
    return {
      version: this.version, folders: [...this.folders], excluded: [...this.excluded], files: [...this.files],
      ...(Object.keys(this.extra).length > 0 ? { extra: this.extra } : {}),
    }
  }

  /** The file was written by a newer WriteMind: it is shown, and saved over only after the person agrees (4.3). */
  get newer(): boolean { return this.version > PROJECT_VERSION }

  /** The `.wm` files the project lists, in order (the ones that are notes). */
  get notes(): string[] { return this.files.filter(isWmName) }

  /** The files open now, in tab order: what a save writes as `files`. Marks the project edited when it changes. */
  setFiles(files: string[]): void {
    const next = files.map(clean)
    if (next.length === this.files.length && next.every((one, at) => same(one, this.files[at]!))) return
    this.files = next
    this.dirty = true
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

  exclude(folder: string): boolean {
    const next = clean(folder)
    if (this.excluded.some((one) => same(one, next))) return false
    this.excluded.push(next)
    this.dirty = true
    return true
  }

  include(folder: string): boolean {
    const next = clean(folder)
    const left = this.excluded.filter((one) => !same(one, next))
    if (left.length === this.excluded.length) return false
    this.excluded = left
    this.dirty = true
    return true
  }

  /** A project of one folder, with no file yet. */
  newProject(startingAt: string = this.home): void {
    this.folders = [clean(startingAt)]
    this.excluded = []
    this.files = []
    this.version = PROJECT_VERSION
    this.extra = {}
    this.file = null
    this.dirty = false
  }

  /**
   * Open a project file. False — and nothing changed — when it cannot be read
   * or is not a project. A project with no folders opens too and shows the
   * default one, as the Mac does (`setFolders` falls back to its own folder).
   */
  async open(file: string, text?: string): Promise<boolean> {
    const read = parseProject(text ?? await fs.readFile(file, "utf8").catch(() => ""))
    if (!read) return false
    // A relative path is relative to the project file's folder; the same place twice is one (SPEC-WM 4.2).
    const parsed = resolveProject(read, file)
    this.folders = parsed.folders.length > 0 ? parsed.folders : [this.home]
    this.excluded = parsed.excluded
    this.files = parsed.files
    this.version = parsed.version
    this.extra = parsed.extra ?? {}
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

  /**
   * Beside-and-renamed (`atomic.ts`). A failure leaves the project file as it was, takes its `.tmp` away, and is
   * thrown to the caller, who says so — the project is still "edited".
   */
  private async write(file: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, stringifyProject(this.project, file))
    this.dirty = false
  }

  // MARK: - Between launches

  async remember(stateFile: string): Promise<void> {
    const state: Remembered = { file: this.file, folders: this.folders, excluded: this.excluded }
    await fs.mkdir(path.dirname(stateFile), { recursive: true })
    await writeFileAtomic(stateFile, JSON.stringify(state))
  }

  /**
   * Come back to the project that was open: its file if it has one (and it
   * still opens), else the folders it was cached with — the unsaved project
   * of the last session (`restoreSession`).
   *
   * THE FILE IS GIVEN `wait` MILLISECONDS. A project file on a share that is not
   * reachable takes half a minute to say so, and the window is not made until
   * this returns: after the wait the folders it was cached with are used, and
   * the project keeps its file (so the next launch tries again, and the name
   * in the menu is still the project's).
   */
  async restore(stateFile: string, wait = 3000,
    reader: (file: string) => Promise<string> = (file) => fs.readFile(file, "utf8")): Promise<void> {
    let state: Remembered | null = null
    try { state = JSON.parse(await fs.readFile(stateFile, "utf8")) as Remembered } catch { return }
    let unreachable = false
    if (state.file) {
      const text = await within(wait, reader(state.file).catch(() => ""))
      if (text === null) unreachable = true
      else if (await this.open(state.file, text)) return
    }
    if (Array.isArray(state.folders) && state.folders.length > 0) {
      this.folders = state.folders.filter((one): one is string => typeof one === "string").map(clean)
      this.excluded = (Array.isArray(state.excluded) ? state.excluded : [])
        .filter((one): one is string => typeof one === "string").map(clean)
      if (this.folders.length === 0) this.folders = [this.home]
      this.file = unreachable ? state.file : null
    }
  }
}

// MARK: - The session, one per project

/**
 * The cached session of a project (`ProjectSession.load(forProjectAt:)`), or
 * null. An untitled project keeps the old per-notes-folder file as a second
 * place to look, so the session from before projects had their own is not lost.
 */
export async function readProjectSession(userData: string, projectFile: string | null,
  legacyRoot: string): Promise<string | null> {
  const own = await fs.readFile(projectSessionFile(userData, projectFile), "utf8").catch(() => null)
  if (own !== null || projectFile !== null) return own
  return fs.readFile(path.join(userData, "sessions", sessionFileName(path.resolve(legacyRoot))), "utf8")
    .catch(() => null)
}

/**
 * A folder is made once, and every write waits on the SAME promise for it: the writes then go on in the order they
 * were asked in (one `mkdir` each would finish in any order, and an older session could land over a newer one).
 */
const sessionFolders = new Map<string, Promise<unknown>>()
function sessionFolder(dir: string): Promise<unknown> {
  let made = sessionFolders.get(dir)
  if (!made) {
    made = fs.mkdir(dir, { recursive: true })
    sessionFolders.set(dir, made)
    // (a folder that could not be made is tried again by the next write)
    made.catch(() => { if (sessionFolders.get(dir) === made) sessionFolders.delete(dir) })
  }
  return made
}

export async function writeProjectSession(userData: string, projectFile: string | null,
  json: string): Promise<void> {
  const file = projectSessionFile(userData, projectFile)
  await sessionFolder(path.dirname(file))
  // Written beside and renamed over — THROUGH THE SAME QUEUE EVERY OTHER WRITE GOES THROUGH (atomic.ts): the page
  // writes the session from a debounce, from the hot-exit throttle and from a flush on a switch, so two writes of
  // one project's session are often in flight together. A `.tmp` shared by hand (write, then rename) made them
  // trample each other — "ENOENT … rename default.json.tmp" in the red bar, an "EPERM" on five quick New Projects,
  // and in a direct test four overlapping writes lost 42 of 120 and left a session file that was not JSON.
  try {
    await writeFileAtomic(file, json)
  } catch (error) {
    // The folder was taken from under the app (a profile cleaned while it runs): made again, once.
    if (codeOf(error) !== "ENOENT") throw error
    sessionFolders.delete(path.dirname(file))
    await sessionFolder(path.dirname(file))
    await writeFileAtomic(file, json)
  }
}
