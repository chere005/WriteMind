/**
 * THE NOTES FOLDER WAS RENAMED (Sean, 2026-10-06: "rename WriteMind to WriteMindSwift and WriteMindCross to
 * WriteMind... make this change everywhere"). This app's notes used to be `<Documents>/WriteMindCross`; they are
 * `<Documents>/WriteMind` now, and the first launch after the rename MOVES the old folder, before anything reads
 * the notes (the watcher, the project, the quick reference). Which folder a launch uses:
 *
 *   - `WRITEMIND_NOTES` set: that folder, and nothing here runs at all.
 *   - the old folder there and the new one not there at all: ONE `rename` (same folder, so the same volume:
 *     atomic). Never copy-then-delete. A rename the system refuses (Explorer, OneDrive or an antivirus holding
 *     something in it: EPERM / EBUSY / EACCES / EXDEV) leaves everything as it was: the old folder is used this
 *     launch, the refusal is logged, and the next launch tries again.
 *   - both there: the OLD folder, and the person is told once (`notice`): on a Mac `~/Documents/WriteMind` is the
 *     Swift WriteMind's notes, and two apps writing one folder is the bug that cost two cells on 2026-09-20.
 *   - only the new one, or neither (a first install): the new one.
 *
 * AFTER A MOVE every path the app remembered under the old folder is rewritten to the new one (`rewriteRemembered`):
 * the JSON files in the user-data folder (the project and its folders, every session's open notes / front note /
 * unsaved text, the tablet sheets' ink-cell bindings, and anything else there that holds such a path), the sessions
 * whose FILE NAME is a hash of a moved path, the `.writemind-project` files (the remembered one, those at the top
 * of Documents where Save Project As puts them, and those inside the moved folder: only the old folder's prefix
 * in them changes, byte for byte the rest), and the drawings that were kept under a hash of the note's ABSOLUTE
 * path (`olderDrawingPath` in notes.ts) — renamed to the new path's hash. Today's drawings are named by the note's
 * path RELATIVE to its project folder, and pictures and ink cells by their own names, so those move with the
 * folder as they are. The renderer keeps no note path in its own storage (localStorage holds only choices), so
 * there is nothing of its to rewrite.
 *
 * A move whose rewrite was cut short (the app killed between the rename and the end of the rewrite) is finished on
 * the next launch: `pending` is written before the rename and taken away after the rewrite, and the rewrite only
 * ever changes what still names the old folder.
 *
 * TEST INSTANCES never move anything unless they were given a Documents folder of their own
 * (`WRITEMIND_DOCUMENTS`): an offscreen or end-to-end instance started without `WRITEMIND_NOTES` must not rename
 * the person's real notes folder from under the copy of the app they are using.
 */

import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { sessionFileName } from "@writemind/core"
import { codeOf, writeFileAtomic } from "./atomic"
import { LEGACY_EXTENSIONS } from "./legacyLayout"
import { PROJECT_EXTENSION } from "./project"

/** The notes folder's name in Documents, and the one it had until 2026-10-06. */
export const NOTES_FOLDER = "WriteMind"
export const OLD_NOTES_FOLDER = "WriteMindCross"
/** In the user-data folder: what the move has done and what the person has been told. */
export const MOVE_STATE_FILE = "notes-folder.json"
export const MOVE_LOG_FILE = "notes-folder.log"

export type FolderOutcome =
  /** `WRITEMIND_NOTES`: nothing looked at, nothing moved. */
  | "override"
  /** The old folder was moved to the new name now (or a cut-short move was finished). */
  | "moved"
  /** The rename was refused: the old folder this launch, tried again next launch. */
  | "move-failed"
  /** Both folders are there: the old one is used. */
  | "kept-old"
  /** The new folder is there (and the old is not): nothing to do. */
  | "new"
  /** Neither is there: a first install, in the new folder. */
  | "first"
  /** A test instance with no Documents folder of its own: whichever is there, nothing moved. */
  | "not-moved-in-test"

export interface Settled {
  root: string
  outcome: FolderOutcome
  /** What to tell the person, once (both folders there and not yet told); null otherwise. */
  notice: string | null
  /** The notice, the first time it is asked for (and remembered as shown); null after that and otherwise. */
  takeNotice(): Promise<string | null>
}

export interface SettleOptions {
  /** The Documents folder (`app.getPath("documents")`; tests hand in a scratch one). */
  documents: string
  /** The app's user-data folder, where the remembered state lives. */
  userData: string
  env?: Record<string, string | undefined>
  platform?: string
  /** The folder rename (tests make it refuse). */
  rename?: (from: string, to: string) => Promise<void>
  log?: (line: string) => void
}

interface MoveState {
  version: 1
  /** Written before the rename, taken away when the rewrite is done. */
  pending?: { from: string; to: string }
  /** The last move done. */
  moved?: { from: string; to: string; at: string }
  /** The "both folders are there" notice has been shown. */
  keptOldNoticeShown?: boolean
}

// MARK: - Paths

const windowsLike = (platform: string): boolean => platform === "win32"

/**
 * `value` with the folder `from` at its start replaced by `to`, or null when `value` is not `from` or under it.
 * Separator-aware (`…\WriteMindCross2` is not under `…\WriteMindCross`); on Windows case-insensitive and either
 * separator, and a path written with forward slashes keeps them. Everything after the folder is kept as written.
 */
export function movedPath(value: string, from: string, to: string, platform: string = process.platform): string | null {
  const win = windowsLike(platform)
  const trailing = win ? /[\\/]+$/ : /\/+$/
  const base = from.replace(trailing, "")
  if (base.length === 0 || value.length < base.length) return null
  const head = value.slice(0, base.length)
  const fold = (one: string): string => (win ? one.replace(/\//g, "\\").toLowerCase() : one)
  if (fold(head) !== fold(base)) return null
  const rest = value.slice(base.length)
  if (rest !== "" && !(win ? /^[\\/]/ : /^\//).test(rest)) return null
  const target = to.replace(trailing, "")
  const slashes = win && head.includes("/") && !head.includes("\\")
  return (slashes ? target.replace(/\\/g, "/") : target) + rest
}

/** A JSON string literal, keys included (outside a string JSON has no quote). */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g

/**
 * JSON text with every string (value or key) that names a path under `from` moved to `to`, and every other byte
 * as it was. Null when nothing changed, or when the text is not JSON (it is left alone).
 */
export function rewriteJsonText(text: string, from: string, to: string, platform: string = process.platform): string | null {
  try { JSON.parse(text) } catch { return null }
  let changed = false
  const next = text.replace(STRING_LITERAL, (literal) => {
    let value: unknown
    try { value = JSON.parse(literal) } catch { return literal }
    if (typeof value !== "string") return literal
    const moved = movedPath(value, from, to, platform)
    if (moved === null || moved === value) return literal
    changed = true
    return JSON.stringify(moved)
  })
  if (!changed) return null
  try { JSON.parse(next) } catch { return null }
  return next
}

// MARK: - The rewrite after a move

const sha = (value: string, length: number): string => createHash("sha1").update(value).digest("hex").slice(0, length)

async function isDirectory(folder: string): Promise<boolean> {
  return fs.stat(folder).then((one) => one.isDirectory(), () => false)
}
async function existsAtAll(file: string): Promise<boolean> {
  return fs.lstat(file).then(() => true, () => false)
}

/** Rewrite one JSON file in place (atomically), if it names anything under `from`. True when it was rewritten. */
async function rewriteFile(file: string, from: string, to: string, platform: string, log: (line: string) => void): Promise<boolean> {
  const text = await fs.readFile(file, "utf8").catch(() => null)
  if (text === null) return false
  const next = rewriteJsonText(text, from, to, platform)
  if (next === null) return false
  try {
    await writeFileAtomic(file, next)
    return true
  } catch (error) {
    log(`could not rewrite ${file}: ${codeOf(error) || String(error)}`)
    return false
  }
}

/** Files under `folder` (hidden folders not looked in) whose name passes `wanted`, relative to `folder`. */
async function filesUnder(folder: string, wanted: (name: string) => boolean, budget = { dirs: 2000 }, depth = 0,
  prefix = ""): Promise<string[]> {
  if (--budget.dirs < 0 || depth > 12) return []
  const entries = await fs.readdir(path.join(folder, prefix), { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const relative = prefix ? path.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) out.push(...await filesUnder(folder, wanted, budget, depth + 1, relative))
    else if (entry.isFile() && wanted(entry.name)) out.push(relative)
  }
  return out
}

const isNoteName = (name: string): boolean => (LEGACY_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase())
const isProjectName = (name: string): boolean => name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)

/**
 * Drawings kept under a hash of the note's ABSOLUTE path (`olderDrawingPath`: the notes root's `.drawings`,
 * `<stem>-<sha1(path) 12>.json`, from before drawings travelled with their folder) are renamed to the hash of the
 * note's new path, so the next read finds them (and the next save moves them to today's name, as before).
 */
async function renameAbsoluteSidecars(from: string, to: string, log: (line: string) => void): Promise<number> {
  const folder = path.join(to, ".drawings")
  const names = new Set(await fs.readdir(folder).catch(() => [] as string[]))
  if (![...names].some((name) => /-[0-9a-f]{12}\.json$/.test(name))) return 0
  let renamed = 0
  for (const relative of await filesUnder(to, isNoteName)) {
    const stem = path.basename(relative, path.extname(relative))
    const before = `${stem}-${sha(path.join(from, relative), 12)}.json`
    const after = `${stem}-${sha(path.join(to, relative), 12)}.json`
    if (before === after || !names.has(before) || names.has(after)) continue
    try {
      await fs.rename(path.join(folder, before), path.join(folder, after))
      names.delete(before)
      names.add(after)
      renamed++
    } catch (error) {
      log(`could not rename the drawing ${before}: ${codeOf(error) || String(error)}`)
    }
  }
  return renamed
}

/** A session file named from a moved path follows it (`Sessions/<name>-<hash>.json`), unless one is there already. */
async function followSessionFile(folder: string, before: string, after: string, log: (line: string) => void): Promise<void> {
  const from = path.join(folder, sessionFileName(path.resolve(before)))
  const to = path.join(folder, sessionFileName(path.resolve(after)))
  if (from === to || !(await existsAtAll(from)) || await existsAtAll(to)) return
  await fs.rename(from, to).catch((error) => log(`could not rename the session ${from}: ${codeOf(error) || String(error)}`))
}

/**
 * Every remembered path under `from` made a path under `to` (see the top of this file). Run after the folder was
 * renamed; safe to run again (it changes only what still names `from`).
 */
export async function rewriteRemembered(options: {
  from: string; to: string; userData: string; documents: string; platform?: string; log?: (line: string) => void
}): Promise<{ files: number; sidecars: number }> {
  const { from, to, userData, documents } = options
  const platform = options.platform ?? process.platform
  const log = options.log ?? (() => undefined)
  let files = 0

  // The project files: the one the app had open, those at the top of Documents (Save Project As starts there)
  // and those inside the moved folder. Their sessions are named from their paths, so a moved one's session follows.
  const projects = new Map<string, string>()
  const remembered = await fs.readFile(path.join(userData, "project.json"), "utf8")
    .then((text) => (JSON.parse(text) as { file?: unknown } | null)?.file)
    .catch(() => null)
  // (new path -> the path it had before the move)
  if (typeof remembered === "string" && remembered.length > 0) {
    projects.set(movedPath(remembered, from, to, platform) ?? remembered, remembered)
  }
  const top = await fs.readdir(documents, { withFileTypes: true }).catch(() => [])
  for (const entry of top) {
    if (entry.isFile() && isProjectName(entry.name)) projects.set(path.join(documents, entry.name), path.join(documents, entry.name))
  }
  for (const relative of await filesUnder(to, isProjectName)) {
    projects.set(path.join(to, relative), path.join(from, relative))
  }
  const sessionFolders = (await fs.readdir(userData, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() === "sessions")
    .map((entry) => path.join(userData, entry.name))
  for (const [now, before] of projects) {
    if (await rewriteFile(now, from, to, platform, log)) files++
    if (now !== before) for (const folder of sessionFolders) await followSessionFile(folder, before, now, log)
  }
  // The session from before projects had their own: named from the notes folder's path.
  for (const folder of sessionFolders) await followSessionFile(folder, from, to, log)

  // The user-data folder's own JSON (project.json, sheets.json, window.json, …) and every session.
  for (const folder of [userData, ...sessionFolders]) {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json") || entry.name === MOVE_STATE_FILE) continue
      if (await rewriteFile(path.join(folder, entry.name), from, to, platform, log)) files++
    }
  }

  const sidecars = await renameAbsoluteSidecars(from, to, log)
  return { files, sidecars }
}

// MARK: - Settling the folder at launch

async function readState(file: string): Promise<MoveState> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as Partial<MoveState>
    return raw && typeof raw === "object" ? { ...raw, version: 1 } : { version: 1 }
  } catch {
    return { version: 1 }
  }
}

async function writeState(file: string, state: MoveState, log: (line: string) => void): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(state, null, 2))
  } catch (error) {
    log(`could not write ${file}: ${codeOf(error) || String(error)}`)
  }
}

/** What the person is told when both folders are there. */
export function keptOldNotice(documents: string, platform: string = process.platform): string {
  const sep = windowsLike(platform) ? "\\" : "/"
  // The platform's own path rules, not the host's: a Windows path read on a Mac (the tests) has no "/" to cut at.
  const docs = (windowsLike(platform) ? path.win32 : path.posix).basename(documents.replace(/[\\/]+$/, "")) || "Documents"
  const whose = platform === "darwin" ? " (on a Mac, usually the Swift WriteMind's notes)" : ""
  return `Your notes stay in ${docs}${sep}${OLD_NOTES_FOLDER}, because a ${docs}${sep}${NOTES_FOLDER} folder already `
    + `exists${whose}. Move or merge them yourself if you like.`
}

/** The default logger: one line per event in the user-data folder's `notes-folder.log`, and the console. */
export function folderLog(userData: string): (line: string) => void {
  return (line) => {
    const stamped = `${new Date().toISOString()} ${line}\n`
    console.log(`WriteMind: ${line}`)
    void fs.mkdir(userData, { recursive: true })
      .then(() => fs.appendFile(path.join(userData, MOVE_LOG_FILE), stamped))
      .catch(() => undefined)
  }
}

/**
 * Which folder this launch keeps its notes in, moving the old one first when it should (the top of this file).
 * Never throws: whatever goes wrong unexpectedly, the old folder is used if it is still there.
 */
export async function settleNotesFolder(options: SettleOptions): Promise<Settled> {
  const log = options.log ?? folderLog(options.userData)
  try {
    return await settle({ ...options, log })
  } catch (error) {
    const env = options.env ?? process.env
    const from = path.join(options.documents, OLD_NOTES_FOLDER)
    const root = env.WRITEMIND_NOTES || (await isDirectory(from) ? from : path.join(options.documents, NOTES_FOLDER))
    log(`could not settle the notes folder (${String(error)}): using ${root}`)
    return { root, outcome: "move-failed", notice: null, takeNotice: async () => null }
  }
}

async function settle(options: SettleOptions & { log: (line: string) => void }): Promise<Settled> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const log = options.log
  const rename = options.rename ?? ((from: string, to: string) => fs.rename(from, to))
  const stateFile = path.join(options.userData, MOVE_STATE_FILE)
  const settled = (root: string, outcome: FolderOutcome, notice: string | null = null): Settled => {
    let pendingNotice = notice
    return {
      root, outcome, notice,
      takeNotice: async () => {
        const said = pendingNotice
        if (said === null) return null
        pendingNotice = null
        await writeState(stateFile, { ...(await readState(stateFile)), keptOldNoticeShown: true }, log)
        return said
      },
    }
  }

  const override = env.WRITEMIND_NOTES
  if (override) return settled(override, "override")

  const from = path.join(options.documents, OLD_NOTES_FOLDER)
  const to = path.join(options.documents, NOTES_FOLDER)
  const oldThere = await isDirectory(from)
  const newThere = await existsAtAll(to)

  // An offscreen / end-to-end instance with no Documents of its own looks, and moves nothing.
  const test = !!(env.WRITEMIND_E2E || env.WRITEMIND_OFFSCREEN)
  if (test && !env.WRITEMIND_DOCUMENTS) return settled(oldThere ? from : to, "not-moved-in-test")

  let state = await readState(stateFile)

  // A move whose rewrite was cut short: finished now (the folder was renamed, the paths were not all rewritten).
  if (state.pending) {
    const { from: was, to: now } = state.pending
    if (!(await isDirectory(was)) && await isDirectory(now)) {
      const done = await rewriteRemembered({ from: was, to: now, userData: options.userData, documents: options.documents, platform, log })
      log(`finished the move of ${was} to ${now} (${done.files} files rewritten, ${done.sidecars} drawings renamed)`)
      state = { ...state, moved: { from: was, to: now, at: new Date().toISOString() } }
      delete state.pending
      await writeState(stateFile, state, log)
      if (was === from && now === to) return settled(to, "moved")
    } else {
      delete state.pending
      await writeState(stateFile, state, log)
    }
  }

  if (oldThere && !newThere) {
    await writeState(stateFile, { ...state, pending: { from, to } }, log)
    try {
      await rename(from, to)
    } catch (error) {
      delete state.pending
      await writeState(stateFile, state, log)
      log(`could not move ${from} to ${to} (${codeOf(error) || String(error)}): using ${from} this launch, trying again next launch`)
      return settled(from, "move-failed")
    }
    const done = await rewriteRemembered({ from, to, userData: options.userData, documents: options.documents, platform, log })
    log(`moved ${from} to ${to} (${done.files} files rewritten, ${done.sidecars} drawings renamed)`)
    const next: MoveState = { ...state, moved: { from, to, at: new Date().toISOString() } }
    delete next.pending
    await writeState(stateFile, next, log)
    return settled(to, "moved")
  }

  if (oldThere && newThere) {
    return settled(from, "kept-old", state.keptOldNoticeShown ? null : keptOldNotice(options.documents, platform))
  }
  return settled(to, newThere ? "new" : "first")
}
