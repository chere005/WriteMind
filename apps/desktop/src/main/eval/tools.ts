/**
 * WHERE EACH ENVIRONMENT'S TOOL IS on this machine — the Windows half of the Mac's `Evaluator.candidates` / `tool()`
 * (`WriteMind/Eval/Evaluator.swift`).
 *
 * The Mac lists absolute paths because a GUI app there inherits launchd's PATH, which has no Homebrew in it. A
 * Windows app inherits the person's own PATH, so the tools are looked for BY NAME on it (`toolNames` in the core),
 * plus the one or two places a language's own installer puts them that a PATH may not reach — rustup's
 * `~\.cargo\bin`, WolframScript's folder under Program Files, the Wolfram Engine's version folder. Nothing here
 * starts anything: finding is reading the file system.
 *
 * Only `.exe` / `.com` count on Windows. A `.cmd` or `.bat` shim cannot be started without a shell, and a cell is
 * never run through a shell.
 */

import { existsSync, lstatSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { EVALUATORS, toolNames, type CompilerFlavor, type Evaluator, type ToolReport } from "@writemind/core"

export interface ToolPlaces {
  platform: string
  /** The PATH as the app was started with it. */
  pathVariable: string
  home: string
  /** Program Files folders, for the installers that put a tool there. */
  programFiles: string[]
  isFile(file: string): boolean
  /** The folders directly inside `dir` (none when it is not there), for an installer that puts a version folder in. */
  folders?(dir: string): string[]
}

export function placesFromProcess(): ToolPlaces {
  const env = process.env
  return {
    platform: process.platform,
    pathVariable: env.PATH ?? env.Path ?? "",
    home: env.USERPROFILE ?? env.HOME ?? "",
    programFiles: [...new Set([env.ProgramFiles, env.ProgramW6432, env["ProgramFiles(x86)"]]
      .filter((dir): dir is string => typeof dir === "string" && dir.length > 0))],
    isFile: (file) => {
      try { return existsSync(file) && !lstatSync(file).isDirectory() } catch { return false }
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
    case "wolfram": return windows
      ? places.programFiles.flatMap((dir) => {
        const research = p.join(dir, "Wolfram Research")
        const engines = p.join(research, "Wolfram Engine")
        return [
          p.join(research, "WolframScript", "wolframscript.exe"),
          ...newestFirst(places.folders?.(engines) ?? []).map((version) => p.join(engines, version, "wolframscript.exe")),
        ]
      })
      : ["/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript"]
    default: return []
  }
}

/** What a person is told was looked for: the names on the PATH, and the extra places. */
export function lookedFor(evaluator: Evaluator, places: ToolPlaces): string[] {
  const onPath = `${toolNames(evaluator).join(", ")} on the PATH`
  // The Program Files folders are said once, as the places they are, not as three paths each.
  if (evaluator === "wolfram" && places.platform === "win32") {
    return [onPath, "Program Files\\Wolfram Research\\WolframScript", "Program Files\\Wolfram Research\\Wolfram Engine\\<version>"]
  }
  return [onPath, ...extraPlaces(evaluator, places)]
}

/** The first candidate that is there. */
export function findTool(evaluator: Evaluator, places: ToolPlaces): string | null {
  return toolCandidates(evaluator, places).find((file) => places.isFile(file)) ?? null
}

export function toolReport(places: ToolPlaces): ToolReport {
  const report = {} as ToolReport
  for (const evaluator of EVALUATORS) {
    report[evaluator] = { path: findTool(evaluator, places), looked: lookedFor(evaluator, places) }
  }
  return report
}

/** Microsoft's `cl` takes its own flags; everything else found here takes gcc's. */
export function flavorOf(tool: string): CompilerFlavor {
  return /^cl(\.exe)?$/i.test(path.win32.basename(tool)) ? "msvc" : "gnu"
}

/** The `py` launcher is told to pick a Python 3, whatever a cell's first line says. */
export function interpreterArguments(tool: string): string[] {
  return /^py(\.exe)?$/i.test(path.win32.basename(tool)) ? ["-3"] : []
}
