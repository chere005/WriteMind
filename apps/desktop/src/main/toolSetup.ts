/**
 * File ▸ Language Setup…'s Install Python…, Install Wolfram Engine… and Activate… on Windows: the installer's OWN
 * script (packaging/installer-tools.ps1, shipped beside the app by scripts/build.mjs, found by helpers.ts
 * `toolsScript`) run with `-FromApp`, so the app installs exactly as the installer's optional-tools page does — winget
 * per user for Python, the Wolfram Engine with Windows' own elevation prompt, and the engine's own sign-in window
 * for activation (the Wolfram ID is typed there, never anywhere WriteMind sees it).
 *
 * WHY THIS IS NOT IN main/eval: what is started here is the app's own script, not a person's tool, and it is started
 * as a person would start it — IN A WINDOW OF ITS OWN, with no timeout, because an install takes as long as it takes
 * and the window says what it is doing. When it ends, the `[result]` INI it wrote says what happened
 * (shared/languages.ts `readSetupResult`, `setupSentence`).
 *
 * HOW THE WINDOW IS MADE: NOT by spawning the script `detached`. libuv turns that into DETACHED_PROCESS, and a
 * console program started that way gets NO console at all — from the windowless main process, no window would open,
 * the script's own words (the 3 GB warning, Wolfram's licence notice, the summary) would go nowhere, and its "Press
 * Enter to close this window" after a failure would wait for ever with "Another setup window is still open." for the
 * rest of the session. So a HIDDEN PowerShell (`windowsHide`: a console with no window, which PowerShell is content
 * with — the OCR helper is run the same way) opens the script with `Start-Process`, which gives it a real console
 * window of its own, and waits for that one process (`WaitForExit`, not `-Wait`, which in Windows PowerShell waits
 * for the sign-in window the script leaves open too). The hidden one is the app's child and goes if the app quits;
 * the window is not (libuv's job object lets a child's own children break away) and finishes what it was doing.
 *
 * A TEST HOST STARTS NOTHING: the guard is the first line of `start`, as it is the first line of a cell's run.
 */

import { spawn as nodeSpawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { readSetupResult, type SetupAction } from "../shared/languages"
import type { ToolSetup } from "./eval/languages"
import { powershell } from "./helpers"

/** What the script is told, in the order it is told it. */
export function setupArguments(action: SetupAction, options: {
  script: string; log: string; result: string; wolframscript: string | null; e2e: boolean
}): string[] {
  const switches = action === "python" ? ["-Python"] : action === "wolfram" ? ["-Wolfram", "-Activate"] : ["-Activate"]
  return [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", options.script, "-FromApp", ...switches,
    // Activate… activates the wolframscript the cells use, not whichever the script would find first.
    ...(action === "activate" && options.wolframscript ? ["-WolframScript", options.wolframscript] : []),
    // An end-to-end run installs nothing and waits for nobody.
    ...(options.e2e ? ["-DryRun", "-NoWait"] : []),
    "-Log", options.log, "-Result", options.result,
  ]
}

/**
 * One argument as Windows' C runtime reads a command line back into arguments (which is how powershell.exe reads
 * the one `Start-Process` hands it): bare when it has no space, tab or quote; else in quotes, a quote inside as \",
 * and the backslashes before a quote — or before the closing one — doubled. `C:\Program Files\…` therefore arrives
 * whole, where `-ArgumentList` given an array would split it at the space (Windows PowerShell 5.1 joins the array
 * with spaces and quotes nothing).
 */
export function windowsArgument(arg: string): string {
  if (arg.length > 0 && !/[\s"]/.test(arg)) return arg
  let quoted = "\""
  let slashes = 0
  for (const character of arg) {
    if (character === "\\") { slashes++; continue }
    if (character === "\"") quoted += "\\".repeat(slashes * 2 + 1) + "\""
    else quoted += "\\".repeat(slashes) + character
    slashes = 0
  }
  return `${quoted}${"\\".repeat(slashes * 2)}"`
}

/** A PowerShell string literal: single quotes, a quote inside doubled. Nothing in it is expanded. */
const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`

/**
 * WHAT THE HIDDEN POWERSHELL RUNS: the script in a console window of its own, waited for, and its exit code passed
 * on. `$p.Handle` is read first so the exit code is still there to read once the process has gone.
 */
export function launcherScript(powershellExe: string, args: string[]): string {
  return [
    `$p = Start-Process -FilePath ${literal(powershellExe)} -ArgumentList ${literal(args.map(windowsArgument).join(" "))} -PassThru`,
    "$null = $p.Handle",
    "$p.WaitForExit()",
    "exit $p.ExitCode",
  ].join("\n")
}

/** The hidden PowerShell's own arguments: the launcher as -EncodedCommand (UTF-16, base64), so nothing is quoted twice. */
export function launcherArguments(powershellExe: string, args: string[]): string[] {
  const encoded = Buffer.from(launcherScript(powershellExe, args), "utf16le").toString("base64")
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]
}

/** All that is asked of the started script: that it says when it has ended (or could not start). */
export interface SetupChild {
  on(event: "exit", listener: (code: number | null) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
}

/**
 * The spawn options for the hidden PowerShell: a console with no window (`windowsHide`, with nothing inherited),
 * NOT detached (a detached console program has no console at all), and no shell.
 */
export const SETUP_SPAWN_OPTIONS = { windowsHide: true, stdio: "ignore", shell: false } as const

export interface ToolSetupDeps {
  /** installer-tools.ps1 beside the app. */
  script: string
  /** The user-data folder: the log goes there (`tools-setup.log`). */
  userData: string
  /** WRITEMIND_E2E: a dry run. */
  e2e: boolean
  spawn?: (command: string, args: string[], options: typeof SETUP_SPAWN_OPTIONS) => SetupChild
  /** Where the result INI goes (the system's temp folder). */
  tmpdir?: () => string
  readFile?: (file: string) => Promise<Buffer>
  remove?: (file: string) => Promise<void>
  /** A test host never starts the script (vitest's own variable, as the runner's guard reads it). */
  isTestHost?: () => boolean
  powershell?: () => string
}

let runs = 0

export function createToolSetup(deps: ToolSetupDeps): ToolSetup {
  const spawn: NonNullable<ToolSetupDeps["spawn"]> = deps.spawn
    ?? ((command, args, options): SetupChild => nodeSpawn(command, args, { ...options }))
  const tmpdir = deps.tmpdir ?? (() => os.tmpdir())
  const readFile = deps.readFile ?? ((file) => fs.readFile(file))
  const remove = deps.remove ?? ((file) => fs.rm(file, { force: true }))
  const isTestHost = deps.isTestHost ?? (() => process.env.VITEST !== undefined)
  const shell = deps.powershell ?? powershell
  return {
    start(action, wolframscript) {
      // A CHECK THAT CAN REACH THE REAL THING IS NOT A CHECK: a test host never opens an installer.
      if (isTestHost()) return Promise.resolve(null)
      // Windows' paths whatever the host (this is Windows' setup; a test of it runs anywhere).
      const result = path.win32.join(tmpdir(), `wm-setup-${process.pid}-${++runs}.ini`)
      const args = setupArguments(action, {
        script: deps.script, log: path.win32.join(deps.userData, "tools-setup.log"), result, wolframscript, e2e: deps.e2e,
      })
      return new Promise((resolve) => {
        let settled = false
        const finish = async (): Promise<void> => {
          if (settled) return
          settled = true
          // UTF-16 with a BOM: what the script writes for the installer's ReadINIStr, read the same way here.
          const text = await readFile(result).then((bytes) => bytes.toString("utf16le"), () => null)
          await remove(result).catch(() => undefined)
          resolve(text === null ? null : readSetupResult(text))
        }
        try {
          const exe = shell()
          const child = spawn(exe, launcherArguments(exe, args), SETUP_SPAWN_OPTIONS)
          child.on("exit", () => { void finish() })
          child.on("error", () => { void finish() })
        } catch {
          void finish()
        }
      })
    },
  }
}
