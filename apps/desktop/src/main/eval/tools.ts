/**
 * WHERE EACH ENVIRONMENT'S TOOL IS on this machine — the Windows half of the Mac's `Evaluator.candidates` / `tool()`
 * (`WriteMind/Eval/Evaluator.swift`).
 *
 * The Mac lists absolute paths because a GUI app there inherits launchd's PATH, which has no Homebrew in it. A
 * Windows app inherits the person's own PATH, so the tools are looked for BY NAME on it (`toolNames` in the core),
 * plus the one or two places a language's own installer puts them that a PATH may not reach — rustup's
 * `~\.cargo\bin`, WolframScript's folder under Program Files, the Wolfram Engine's version folder, python.org's
 * per-user and all-users folders (where the WriteMind installer's "Install Python" puts it). Nothing here
 * starts anything: finding is reading the file system.
 *
 * Only `.exe` / `.com` count on Windows. A `.cmd` or `.bat` shim cannot be started without a shell, and a cell is
 * never run through a shell.
 *
 * A PROGRAM CHOSEN IN FILE ▸ LANGUAGE SETUP… IS THE ONLY ONE ITS LANGUAGE USES (`toolEntry`). The Mac's
 * `evalTool.<name>` falls through to the candidates when the file it names is not runnable; the port refuses
 * instead, with a sentence naming the path (`missingToolRefusal`), because the person chose it for a reason — a venv
 * with the packages a cell imports, a newer engine — and a cell that quietly ran on another program would answer as
 * if nothing were wrong. `findTool`, `toolCandidates` and `lookedFor` still mean "where WriteMind looks BY ITSELF":
 * they never read the choice. Checking a choice is reading the file system too (`resolveChoice`, `choiceProblem`);
 * asking the program what it is (`identifyArguments`) is the runner's, and only ever on a press.
 */

import { accessSync, constants, existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs"
import * as path from "node:path"
import {
  EVALUATORS, IDENTIFY_PYTHON, isToolName, toolNames, type CompilerFlavor, type Evaluator, type ToolEntry,
  type ToolReport,
} from "@writemind/core"
import { isAbsolutePath } from "../../shared/languages"

export interface ToolPlaces {
  platform: string
  /** The PATH as the app was started with it. */
  pathVariable: string
  home: string
  /** Program Files folders, for the installers that put a tool there. */
  programFiles: string[]
  /** `%LOCALAPPDATA%`, where a per-user Python goes (python.org's installer, and winget's `--scope user`). */
  localAppData?: string
  /** `%APPDATA%` and `%ProgramData%`: where activating the Wolfram Engine leaves its licence on Windows. */
  appData?: string
  programData?: string
  /** What was chosen in File ▸ Language Setup… (main/eval/languages.ts): for those languages, the only candidate. */
  chosen?: Partial<Record<Evaluator, string>>
  isFile(file: string): boolean
  /**
   * Whether a file is one this app may start as a chosen program: a file (a link followed) marked executable off
   * Windows; on Windows an `.exe` or `.com`, asked with the same `lstat` as `isFile` — the Store's app execution
   * aliases are reparse points that a `stat` cannot follow. Absent (a test's fake) is `isFile`.
   */
  isProgram?(file: string): boolean
  /** Whether it is a folder (a link followed): a venv, a conda environment, a `.app` picked whole. */
  isDirectory?(file: string): boolean
  /** The file a link leads to (the file itself when it is not one, or cannot be read): two spellings of one program. */
  realPath?(file: string): string
  /** The folders directly inside `dir` (none when it is not there), for an installer that puts a version folder in. */
  folders?(dir: string): string[]
}

/** This machine's places, with Language Setup's choices. Made afresh for every run, so a choice applies at once. */
export function placesFromProcess(chosen: Partial<Record<Evaluator, string>> = {}): ToolPlaces {
  const env = process.env
  const windows = process.platform === "win32"
  const isFile = (file: string): boolean => {
    try { return existsSync(file) && !lstatSync(file).isDirectory() } catch { return false }
  }
  return {
    platform: process.platform,
    pathVariable: env.PATH ?? env.Path ?? "",
    home: env.USERPROFILE ?? env.HOME ?? "",
    programFiles: [...new Set([env.ProgramFiles, env.ProgramW6432, env["ProgramFiles(x86)"]]
      .filter((dir): dir is string => typeof dir === "string" && dir.length > 0))],
    localAppData: env.LOCALAPPDATA ?? "",
    appData: env.APPDATA ?? "",
    programData: env.ProgramData ?? "",
    chosen,
    isFile,
    isProgram: windows
      ? (file) => isFile(file) && /\.(exe|com)$/i.test(file)
      : (file) => {
        try {
          if (!statSync(file).isFile()) return false
          accessSync(file, constants.X_OK)
          return true
        } catch { return false }
      },
    isDirectory: (file) => {
      try { return statSync(file).isDirectory() } catch { return false }
    },
    realPath: (file) => {
      try { return realpathSync.native(file) } catch { return file }
    },
    folders: (dir) => {
      try { return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) } catch { return [] }
    },
  }
}

/** Version folders, newest first: `14.10` after `14.9`, and anything that is not a version after every one that is. */
export function newestFirst(names: string[]): string[] {
  const parts = (name: string) => /^\d+(\.\d+)*$/.test(name) ? name.split(".").map(Number) : null
  return [...names].sort((a, b) => {
    const x = parts(a), y = parts(b)
    if (!x || !y) return x ? -1 : y ? 1 : a.localeCompare(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (y[i] ?? 0) - (x[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  })
}

/** Where Homebrew puts its tools, which a GUI app's PATH on the Mac does not reach. */
export const MAC_TOOL_FOLDERS = ["/opt/homebrew/bin", "/usr/local/bin"]

/**
 * The wolframscript inside the Wolfram Engine's own app, as its DMG installs it. Measured on 2026-10-06: Homebrew's
 * `/opt/homebrew/bin/wolframscript` is a link to exactly this file, and without Homebrew nothing else points at it.
 */
export const MAC_ENGINE_APP = "/Applications/Wolfram Engine.app"
export const MAC_ENGINE_WOLFRAMSCRIPT = `${MAC_ENGINE_APP}/Contents/Resources/Wolfram Player.app/Contents/MacOS/wolframscript`

const joiner = (platform: string) => (platform === "win32" ? path.win32 : path.posix)

/**
 * Every place the tool might be, in the order they are tried. On Windows the Microsoft Store's `python.exe`
 * placeholder (an app execution alias under `...\Microsoft\WindowsApps`) goes LAST: on a machine without the Store's
 * Python it only prints "Python was not found" and exits 9009, and `py.exe` is the real thing when both are there.
 */
export function toolCandidates(evaluator: Evaluator, places: ToolPlaces): string[] {
  const windows = places.platform === "win32"
  const p = joiner(places.platform)
  const dirs = places.pathVariable.split(windows ? ";" : ":").map((dir) => dir.trim().replace(/^"|"$/g, ""))
    .filter((dir) => dir.length > 0)
  // A Finder-launched Mac app inherits launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), which has no Homebrew in it:
  // look in Homebrew's folders (Apple silicon, then Intel) after whatever PATH it did get.
  if (places.platform === "darwin") dirs.push(...MAC_TOOL_FOLDERS)
  const extensions = windows ? [".exe", ".com"] : [""]
  const found: string[] = []
  for (const name of toolNames(evaluator)) {
    for (const dir of dirs) for (const extension of extensions) found.push(p.join(dir, name + extension))
  }
  const extra = extraPlaces(evaluator, places)
  const all = [...found, ...extra]
  const store = (file: string) => /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(file)
  const unique = [...new Set(all)]
  return [...unique.filter((file) => !store(file)), ...unique.filter(store)]
}

/** Where a language's own installer puts its tool, which a PATH may not reach. */
function extraPlaces(evaluator: Evaluator, places: ToolPlaces): string[] {
  const windows = places.platform === "win32"
  const p = joiner(places.platform)
  const exe = windows ? ".exe" : ""
  switch (evaluator) {
    // rustup puts rustc in the home directory and nowhere else.
    case "rust": return places.home ? [p.join(places.home, ".cargo", "bin", "rustc" + exe)] : []
    // WolframScript's own installer puts it in a folder of its own; the Wolfram Engine's puts a copy in the engine's
    // version folder (`Wolfram Engine\14.1\wolframscript.exe`), which no PATH reaches. The newest engine first.
    // On a Mac the engine's DMG puts it inside the app, which Homebrew links to and nothing else does.
    case "wolfram": return windows
      ? places.programFiles.flatMap((dir) => {
        const research = p.join(dir, "Wolfram Research")
        const engines = p.join(research, "Wolfram Engine")
        return [
          p.join(research, "WolframScript", "wolframscript.exe"),
          ...newestFirst(places.folders?.(engines) ?? []).map((version) => p.join(engines, version, "wolframscript.exe")),
        ]
      })
      : ["/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript",
        ...(places.platform === "darwin" ? [MAC_ENGINE_WOLFRAMSCRIPT] : [])]
    // python.org's installer (and winget, which runs it) does not put Python on the PATH unless asked, and a PATH it
    // does change reaches only programs started AFTER it: WriteMind open while the Windows installer added Python
    // still has the old one. So its own folders: the per-user launcher, then `Python3NN` under
    // `%LOCALAPPDATA%\Programs\Python` (per-user) and under Program Files (all users), the newest version first.
    case "python": {
      if (!windows) return []
      const local = places.localAppData ? p.join(places.localAppData, "Programs", "Python") : ""
      return [
        ...(local ? [p.join(local, "Launcher", "py.exe")] : []),
        ...[...(local ? [local] : []), ...places.programFiles]
          .flatMap((dir) => pythonFolders(places.folders?.(dir) ?? []).map((name) => p.join(dir, name, "python.exe"))),
      ]
    }
    default: return []
  }
}

/** `Python314`, `Python313`, `Python314-32`…: Python 3 install folders, the newest first, a 64-bit one before a 32-bit. */
export function pythonFolders(names: string[]): string[] {
  const parse = (name: string) => /^Python3(\d+)(-32|-arm64)?$/i.exec(name)
  return names.filter((name) => parse(name) !== null).sort((a, b) => {
    const x = parse(a)!, y = parse(b)!
    return Number(y[1]) - Number(x[1]) || (x[2] ? 1 : 0) - (y[2] ? 1 : 0) || a.localeCompare(b)
  })
}

/** What a person is told was looked for: the names on the PATH, and the extra places. */
export function lookedFor(evaluator: Evaluator, places: ToolPlaces): string[] {
  const onPath = `${toolNames(evaluator).join(", ")} on the PATH`
  // The Program Files folders are said once, as the places they are, not as three paths each.
  if (evaluator === "wolfram" && places.platform === "win32") {
    return [onPath, "Program Files\\Wolfram Research\\WolframScript", "Program Files\\Wolfram Research\\Wolfram Engine\\<version>"]
  }
  if (evaluator === "python" && places.platform === "win32") {
    return [onPath, "%LOCALAPPDATA%\\Programs\\Python (Launcher, Python3<version>)", "Program Files\\Python3<version>"]
  }
  // The engine's app is said as the app, not as the five folders down inside it its wolframscript is.
  if (evaluator === "wolfram" && places.platform === "darwin") {
    return [onPath, ...extraPlaces(evaluator, places).filter((file) => file !== MAC_ENGINE_WOLFRAMSCRIPT), MAC_ENGINE_APP]
  }
  return [onPath, ...extraPlaces(evaluator, places)]
}

/** The first candidate that is there. */
export function findTool(evaluator: Evaluator, places: ToolPlaces): string | null {
  return toolCandidates(evaluator, places).find((file) => places.isFile(file)) ?? null
}

/**
 * WHAT ONE LANGUAGE RUNS WITH: the program chosen in Language Setup when there is one — and then ONLY that one, gone
 * or not — else the first candidate found by itself, exactly as before there was a choice.
 */
export function toolEntry(evaluator: Evaluator, places: ToolPlaces): ToolEntry {
  const chosen = places.chosen?.[evaluator]
  if (chosen === undefined) return { path: findTool(evaluator, places), looked: lookedFor(evaluator, places) }
  const isProgram = places.isProgram ?? places.isFile
  const isFile = places.isFile(chosen)
  // "Gone" is nothing there at all; a folder, or a file that cannot be started, is there and is not a program.
  const there = isFile || (places.isDirectory?.(chosen) ?? false)
  const problem = !there ? "gone" : !isFile || !isProgram(chosen) ? "notAProgram" : null
  return {
    path: problem === null ? chosen : null,
    looked: [`${chosen} (chosen in Language Setup)`],
    chosen: { path: chosen, problem },
  }
}

export function toolReport(places: ToolPlaces): ToolReport {
  const report = {} as ToolReport
  for (const evaluator of EVALUATORS) report[evaluator] = toolEntry(evaluator, places)
  return report
}

/**
 * EVERY COPY FOUND BY ITSELF, in the order a run would try them, for Language Setup's "Also on this computer": the
 * easy way to point at another program is to be shown it. Two spellings of one file — Homebrew's link and the file
 * it leads to — are one copy, under the first spelling (the one a run would use).
 */
export function foundTools(evaluator: Evaluator, places: ToolPlaces): string[] {
  const real = places.realPath ?? ((file: string) => file)
  const seen = new Set<string>()
  const found: string[] = []
  for (const file of toolCandidates(evaluator, places)) {
    if (!places.isFile(file)) continue
    const key = places.platform === "win32" ? real(file).toLowerCase() : real(file)
    if (seen.has(key)) continue
    seen.add(key)
    found.push(file)
  }
  return found
}

/** "gcc, clang or cl": a language's program names, as a sentence lists them. */
const orList = (names: string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`

/**
 * WHAT A PICKED FOLDER MEANS. A venv or a conda environment is picked whole as often as its program is (the Mac's
 * picker takes a folder; Explorer's does not, but a pasted path can name one), and the Wolfram Engine is picked as
 * its `.app`: each is looked inside, in this order, and the first file there wins. A file is itself.
 */
export function resolveChoice(evaluator: Evaluator, picked: string, places: ToolPlaces): { file: string } | { problem: string } {
  if (!(places.isDirectory?.(picked) ?? false)) return { file: picked }
  const windows = places.platform === "win32"
  const p = joiner(places.platform)
  const exe = windows ? ".exe" : ""
  let inside: string[]
  let none: string
  switch (evaluator) {
    case "python":
      // A venv keeps its program in Scripts on Windows and bin elsewhere; a conda environment at its root on Windows.
      inside = windows ? [p.join(picked, "Scripts", "python.exe"), p.join(picked, "python.exe")]
        : [p.join(picked, "bin", "python3"), p.join(picked, "bin", "python")]
      none = `There is no Python in that folder (WriteMind looked for ${windows ? "Scripts\\python.exe and python.exe" : "bin/python3 and bin/python"}).`
      break
    case "wolfram":
      if (/\.app$/i.test(picked)) {
        inside = [p.join(picked, "Contents", "Resources", "Wolfram Player.app", "Contents", "MacOS", "wolframscript"),
          p.join(picked, "Contents", "MacOS", "wolframscript")]
        none = `WriteMind found no wolframscript inside “${p.basename(picked)}”.`
      } else {
        inside = [p.join(picked, "wolframscript" + exe)]
        none = "There is no wolframscript in that folder."
      }
      break
    case "c": case "cpp": case "rust":
      inside = toolNames(evaluator).flatMap((name) => [p.join(picked, "bin", name + exe), p.join(picked, name + exe)])
      none = `There is no ${orList(toolNames(evaluator))} in that folder.`
      break
  }
  const file = inside.find((one) => places.isFile(one))
  return file ? { file } : { problem: none }
}

/**
 * WHY A FILE CANNOT BE THIS LANGUAGE'S PROGRAM, or null when it can — asked when it is chosen, before anything is
 * started or saved, in this order (the first that fails is the one said): a full path, a file that is there, never a
 * script on Windows (nothing is started through a shell), only `.exe` / `.com` there, a name this language's program
 * has (`isToolName`), and marked executable off Windows.
 */
export function choiceProblem(evaluator: Evaluator, file: string, places: ToolPlaces): string | null {
  const windows = places.platform === "win32"
  const p = joiner(places.platform)
  const name = p.basename(file)
  if (!isAbsolutePath(file, places.platform)) return `“${file}” is not a full path.`
  if (!places.isFile(file)) return `“${name}” is not there.`
  if (windows && /\.(cmd|bat|ps1|lnk)$/i.test(name)) {
    return `“${name}” is a script, and WriteMind never starts anything through a shell. Choose the .exe it runs.`
  }
  if (windows && !/\.(exe|com)$/i.test(name)) return "WriteMind starts only .exe and .com programs on Windows."
  if (!isToolName(evaluator, name)) {
    switch (evaluator) {
      case "wolfram": return "That is not wolframscript. Wolfram cells run through wolframscript."
      case "python": return "That is not a Python: WriteMind runs a program called python, python3, python3.N or py."
      case "c": return "That is not a C compiler (gcc, clang or cl)."
      case "cpp": return "That is not a C++ compiler (g++, clang++ or cl)."
      case "rust": return "That is not rustc."
    }
  }
  if (!windows && !(places.isProgram ?? places.isFile)(file)) return `“${name}” is not marked as a program (it needs chmod +x).`
  return null
}

/**
 * WHAT A PICKED PROGRAM IS ASKED to say what it is (`Runner.identify`, from Choose… and Use only): its version. Null
 * for Microsoft's `cl`, which has no version flag (it prints a banner and complains), so it is taken on its name.
 */
export function identifyArguments(evaluator: Evaluator, file: string): string[] | null {
  switch (evaluator) {
    case "wolfram": return ["-version"]
    case "python": return [...interpreterArguments(file), "-c", IDENTIFY_PYTHON]
    case "c": case "cpp": return flavorOf(file) === "msvc" ? null : ["--version"]
    case "rust": return ["--version"]
  }
}

/**
 * WHETHER THE WOLFRAM ENGINE HAS BEEN ACTIVATED, as far as a file can say: activation leaves a `mathpass` licence
 * file, the engine's own or Mathematica's, per user or for the whole machine. On Windows these are the places
 * packaging/installer-tools.ps1's `IsActivated` looks — keep the two in step. The Mac's was measured on 2026-10-06
 * (`~/Library/WolframEngine/Licensing/mathpass`); the Linux one is Wolfram's documented place, not yet measured on Arch.
 */
export function wolframLicence(places: ToolPlaces): boolean {
  const p = joiner(places.platform)
  const products = ["WolframEngine", "Mathematica"]
  const bases = places.platform === "win32"
    ? [places.appData, places.programData].filter((dir): dir is string => typeof dir === "string" && dir.length > 0)
      .flatMap((dir) => products.map((product) => p.join(dir, product)))
    : places.platform === "darwin"
      ? [...(places.home ? [p.join(places.home, "Library")] : []), "/Library"].flatMap((dir) => products.map((product) => p.join(dir, product)))
      : places.home ? products.map((product) => p.join(places.home, `.${product}`)) : []
  return bases.some((dir) => places.isFile(p.join(dir, "Licensing", "mathpass")))
}

/** Microsoft's `cl` takes its own flags; everything else found here takes gcc's. */
export function flavorOf(tool: string): CompilerFlavor {
  return /^cl(\.exe)?$/i.test(path.win32.basename(tool)) ? "msvc" : "gnu"
}

/** The `py` launcher is told to pick a Python 3, whatever a cell's first line says. */
export function interpreterArguments(tool: string): string[] {
  return /^py(\.exe)?$/i.test(path.win32.basename(tool)) ? ["-3"] : []
}
