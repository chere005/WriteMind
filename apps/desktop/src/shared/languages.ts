/**
 * File ▸ Language Setup…, the pure half (main/eval/languages.ts is the Electron half; test/languages.test.ts holds
 * this one). Port-only: the Mac's override is `defaults write com.seancheren.WriteMind evalTool.<name> <path>`, read
 * by `Evaluator.tool()` (WriteMind/Eval/Evaluator.swift), with no screen in front of it.
 *
 * WHAT IS KEPT: userData/languages.json, `{ "version": 1, "tools": { "python": "/Users/s/venv/bin/python3" } }` — one
 * full path per language that has a choice, and nothing for a language that finds its program by itself. Not
 * localStorage: the main process reads it for every run. Read tolerantly (anything it cannot use is no choice at
 * all, so a cell finds its program by itself as before), written whole. The version is there for the day a Mac App
 * Store build has to keep a security-scoped bookmark beside each path; this reader takes version 1 only.
 *
 * WHAT IS ASKED where (main/eval/languages.ts): the screen's report is the file system only, and a program is started
 * only by a press — Choose… and Use ask its version, Test runs a fixed program. Nothing is started when the screen
 * opens.
 */

import {
  EVALUATORS, isEvaluator, isToolName, type Evaluator, type TestAnswer, type ToolReport,
} from "@writemind/core"

/** In the user-data folder, beside update.json. */
export const LANGUAGES_FILE = "languages.json"

/** Far longer than any path a person has; a value past it is not one. */
const MAX_PATH = 4096

/**
 * WHETHER A PATH IS A FULL ONE on that platform: a drive and a separator (`C:\`, `C:/`) or a UNC share
 * (`\\server\share`) on Windows, a leading `/` everywhere else. `C:x` is NOT full: it means "x in drive C's current
 * folder", which is whatever folder the app last looked in there.
 */
export function isAbsolutePath(file: string, platform: string): boolean {
  if (platform === "win32") return /^[A-Za-z]:[\\/]/.test(file) || /^\\\\[^\\]+\\[^\\]+/.test(file)
  return file.startsWith("/")
}

/** The last part of a path, as that platform separates them (no node:path here: the page imports this file too). */
const baseName = (file: string, platform: string): string =>
  file.split(platform === "win32" ? /[\\/]/ : /\//).pop() ?? file

/** The folder a path is in, or null when it has none. */
const folderOf = (file: string, platform: string): string | null => {
  const at = Math.max(file.lastIndexOf("/"), platform === "win32" ? file.lastIndexOf("\\") : -1)
  return at > 0 ? file.slice(0, at) : at === 0 ? file.slice(0, 1) : null
}

/**
 * The choices in the file's text. A missing file, bad JSON, something that is not an object or a version this
 * reader does not know is no choice at all; so is any one entry that is not a language, not a string, longer than a
 * path is, holding a NUL, not a full path, not named as that language's program, or on Windows not an `.exe` / `.com`
 * — each dropped by itself, the rest kept. A file written by hand is held to what Choose… would have accepted.
 */
export function readLanguageSettings(text: string | null, platform: string): Partial<Record<Evaluator, string>> {
  if (!text) return {}
  let parsed: unknown
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, "")) } catch { return {} }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
  const { version, tools } = parsed as { version?: unknown; tools?: unknown }
  if (version !== 1 || typeof tools !== "object" || tools === null || Array.isArray(tools)) return {}
  const chosen: Partial<Record<Evaluator, string>> = {}
  for (const [key, value] of Object.entries(tools as Record<string, unknown>)) {
    if (!isEvaluator(key)) continue
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH || value.includes("\0")) continue
    if (!isAbsolutePath(value, platform)) continue
    const name = baseName(value, platform)
    if (!isToolName(key, name)) continue
    if (platform === "win32" && !/\.(exe|com)$/i.test(name)) continue
    chosen[key] = value
  }
  return chosen
}

/** The file's text for these choices: version 1, the languages in the menu's order, two-space JSON and a newline. */
export function writeLanguageSettings(tools: Partial<Record<Evaluator, string>>): string {
  const ordered: Partial<Record<Evaluator, string>> = {}
  for (const evaluator of EVALUATORS) {
    const file = tools[evaluator]
    if (typeof file === "string") ordered[evaluator] = file
  }
  return `${JSON.stringify({ version: 1, tools: ordered }, null, 2)}\n`
}

// MARK: - Setting a language up

/** What the Windows setup can be asked to do (main/toolSetup.ts runs the installer's own installer-tools.ps1). */
export type SetupAction = "python" | "wolfram" | "activate"
export const SETUP_ACTIONS: readonly SetupAction[] = ["python", "wolfram", "activate"]
export const isSetupAction = (value: unknown): value is SetupAction =>
  typeof value === "string" && (SETUP_ACTIONS as readonly string[]).includes(value)

/** The pages the screen opens, by name: the page names a link and never a URL, so it can open nothing else. */
export type LinkId = "python" | "wolframEngine" | "wolframTerms"
export const LINKS: Record<LinkId, string> = {
  python: "https://www.python.org/downloads/",
  wolframEngine: "https://www.wolfram.com/engine/",
  wolframTerms: "https://www.wolfram.com/legal/terms/wolfram-engine.html",
}
export const isLinkId = (value: unknown): value is LinkId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(LINKS, value)

/** What the screen shows: read off the file system, never by starting anything. */
export interface LanguageReport {
  tools: ToolReport
  /** Other copies found automatically: no WindowsApps entries, not the one in use (by realPath), at most 5. */
  others: Record<Evaluator, string[]>
  /** A mathpass where activation leaves one; null when no wolframscript is in use. */
  licence: boolean | null
  setup: { running: SetupAction | null; last: { action: SetupAction; said: string } | null }
}

/** Choose… / Use: saved (with how the program described itself), refused with the reason, or nothing picked. */
export type ChooseAnswer =
  | { kind: "chosen"; report: LanguageReport; said: string | null }
  | { kind: "refused"; problem: string; command?: string }
  | { kind: "cancelled" }

/** Install… / Activate…: its window opened, or why not. */
export type SetupAnswer = { kind: "started" } | { kind: "refused"; problem: string }

/** Electron's OpenDialogOptions, the parts the picker uses (this file cannot import Electron). */
export interface PickerOptions {
  title: string
  message: string
  buttonLabel: string
  defaultPath?: string
  properties: string[]
  filters?: { name: string; extensions: string[] }[]
}

/** What the picker says it is for: the program, by what it is called there. */
function pickerText(evaluator: Evaluator, platform: string): string {
  switch (evaluator) {
    case "wolfram": return "Choose the wolframscript Wolfram cells run with"
    case "python":
      if (platform === "win32") return "Choose the python.exe Python cells run with (in a virtual environment it is in Scripts)"
      if (platform === "darwin") return "Choose the Python program Python cells run with, or a virtual environment's folder"
      return "Choose the Python program Python cells run with (in a virtual environment it is bin/python3)"
    case "c": return "Choose the C compiler C cells build with (gcc, clang or cl)"
    case "cpp": return "Choose the C++ compiler C++ cells build with (g++, clang++ or cl)"
    case "rust": return "Choose the rustc Rust cells build with"
  }
}

/**
 * THE PICKER, per platform. Every one takes a pasted path (⇧⌘G on a Mac, the name box on Windows, the location bar
 * on Linux), so there is no Type a Path… beside it. A MAC picks a folder too (a venv), shows the hidden `.venv`, and
 * hands back a link AS THE LINK (`noResolveAliases`): a venv's `bin/python3` is a link to the base interpreter, and
 * resolved it would choose the Python without the venv's packages. It never treats a package as a folder, so the
 * Wolfram Engine is picked as its `.app` whole. WINDOWS lists programs only. It opens in the folder of the program in
 * use.
 */
export function pickerOptions(evaluator: Evaluator, platform: string, current: string | null): PickerOptions {
  const text = pickerText(evaluator, platform)
  const folder = current ? folderOf(current, platform) : null
  const common = { title: text, message: text, buttonLabel: "Use", ...(folder ? { defaultPath: folder } : {}) }
  if (platform === "darwin") return { ...common, properties: ["openFile", "openDirectory", "showHiddenFiles", "noResolveAliases"] }
  if (platform === "win32") return { ...common, properties: ["openFile"], filters: [{ name: "Programs", extensions: ["exe", "com"] }] }
  return { ...common, properties: ["openFile", "showHiddenFiles"] }
}

/**
 * The installer script's answer, `[result]` of the INI it writes with `-Result` (UTF-16 with a BOM, which
 * main/toolSetup.ts decodes): `python=installed`, `activate=opened`, … Anything outside that section is not read.
 */
export function readSetupResult(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  let inside = false
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    const section = /^\[(.*)\]$/.exec(line)
    if (section) { inside = section[1]!.trim().toLowerCase() === "result"; continue }
    const at = line.indexOf("=")
    if (!inside || at <= 0) continue
    result[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return result
}

/** "Python" or "Wolfram Engine": what an install installs. */
const installs = (action: "python" | "wolfram"): string => (action === "python" ? "Python" : "Wolfram Engine")

/**
 * WHAT A SETUP WINDOW DID, in one sentence for the row that asked (the script's own words for each outcome are in
 * packaging/installer-tools.ps1 `WingetInstall` and its Activate step). `result` is null when the window closed
 * without writing one; `foundAfter` is whether WriteMind finds the program (or, for Activate, the licence) now.
 */
export function setupSentence(action: SetupAction, result: Record<string, string> | null, foundAfter: boolean, log: string): string {
  if (!result) return `The setup window closed before it finished. The details are in ${log}.`
  const value = (result[action] ?? "").trim()
  if (value.startsWith("dry run")) return "Dry run: nothing was installed."
  if (action === "activate") {
    if (value === "opened") return "Sign in with your Wolfram ID in the window that opened. WriteMind looks again when you come back."
    if (value === "already activated") return "The Wolfram Engine is already activated."
    if (value === "failed: wolframscript.exe not found") {
      return "There is no wolframscript to activate yet: install the Wolfram Engine first, or choose its wolframscript."
    }
    return `The Wolfram Engine could not be activated from here (${value || "no answer"}). The details are in ${log}.`
  }
  const name = installs(action)
  let sentence: string
  if (value === "installed (restart needed)") sentence = `${name} installed; Windows wants a restart to finish.`
  else if (value === "installed") sentence = foundAfter ? `${name} installed.` : `${name} is installed, but not where WriteMind looks. Use Choose… to point at it.`
  else if (value === "already installed") sentence = `${name} was already installed.`
  else if (value === "failed: winget is missing") sentence = `winget is not on this computer, so ${name} could not be installed from here. Use Get ${name}… instead.`
  else if (value.startsWith("failed: winget exit code ")) {
    sentence = `winget stopped (exit code ${value.slice("failed: winget exit code ".length)}). Nothing was installed; the window said why, and the details are in ${log}.`
  } else sentence = `${name} could not be installed (${value || "no answer"}). The details are in ${log}.`
  // Install Wolfram Engine… activates too (`-Wolfram -Activate`): its sign-in window is the next thing to do.
  if (action === "wolfram" && result.activate === "opened") sentence += " Then sign in with your Wolfram ID in the window that opened."
  return sentence
}

// MARK: - Across the page / shell boundary

export const LANGUAGE_CHANNELS = {
  report: "languages:report",
  choose: "languages:choose",
  use: "languages:use",
  automatic: "languages:automatic",
  test: "languages:test",
  cancel: "languages:cancel",
  setup: "languages:setup",
  open: "languages:open",
  changed: "languages:changed",
} as const

/** window.wm.languages (preload.ts). Every answer is the main process's; the page names languages, never programs to run. */
export interface LanguagesApi {
  /** What is in use, what else is there, the licence — the file system only, nothing started. */
  report(): Promise<LanguageReport>
  /** The picker (shown by the main process), then the checks, then the version probe, then saved. */
  choose(evaluator: Evaluator): Promise<ChooseAnswer>
  /** One of the copies "Also on this computer" lists (it must be one `foundTools` finds): checked and saved as Choose… is. */
  use(evaluator: Evaluator, file: string): Promise<ChooseAnswer>
  /** Find Automatically: the choice is forgotten, and the language finds its program by itself again. */
  automatic(evaluator: Evaluator): Promise<LanguageReport>
  /** Run the language's fixed test program with the program in use. */
  test(evaluator: Evaluator): Promise<TestAnswer>
  /** Stop that row's check or test. */
  cancel(evaluator: Evaluator): Promise<void>
  /** Windows: the installer's script in a window of its own. */
  setup(action: SetupAction): Promise<SetupAnswer>
  /** A download or licence page, in the browser. */
  open(link: LinkId): Promise<void>
  /** The report, pushed whenever what is in use (or a setup) changed. */
  onChanged(listener: (report: LanguageReport) => void): () => void
}
