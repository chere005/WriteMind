/**
 * The programs the app did not write, and whether this machine has them.
 *
 * ONE RULE, three platforms: a capability is a FILE BEING THERE (or a probe
 * that works). macOS has `wm-vision`, the small Vision binary
 * `tools/build-vision.sh` compiles beside the app — nothing else reads
 * handwriting as well. WINDOWS has its own OCR engine (`Windows.Media.Ocr`),
 * reached through `helpers/wm-ocr.ps1`: it needs nothing installed for the
 * languages in the user's profile, and Japanese comes with an optional
 * Windows capability (docs/OCR-WINDOWS.md). Everywhere else (and on a Mac
 * with no helper built) the app looks for `tesseract` on the PATH, which
 * Arch calls `tesseract` and `tesseract-data-eng`.
 *
 * None is a dependency: with none installed the app runs exactly as it does
 * now and simply does not offer to read a picture. Order of preference:
 * Vision, then Windows' engine, then tesseract.
 */

import { execFile } from "node:child_process"
import { accessSync, constants, existsSync, lstatSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { OcrEngine } from "@writemind/core"

const run = promisify(execFile)

export interface ReadLine {
  text: string
  confidence: number
  /** The line's box as FRACTIONS of the picture, y down — when the reader says. */
  x?: number
  y?: number
  width?: number
  height?: number
  /** Its words, boxed the same way — Windows' engine gives them. */
  words?: { text: string; x: number; y: number; width: number; height: number }[]
}

/** What a reader gave back for one picture. */
export interface Words {
  lines: ReadLine[]
  /** Which reader read it. */
  engine?: OcrEngine
  /** The language it read in (BCP-47), where the reader says. */
  language?: string | null
  /** Every language the reader has here, and whether Japanese is among them. */
  installed?: string[]
  japanese?: boolean
}

export interface ReadOptions {
  /**
   * BCP-47 tags to read in, in order. Without them: Japanese first when
   * installed, kept when it found any, else the profile's languages.
   */
  languages?: string[]
  signal?: AbortSignal
}

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * A file that ships with the app. Inside a packaged build the code is read
 * out of `app.asar`, and NOTHING INSIDE AN ARCHIVE CAN BE EXECUTED — so
 * `electron-builder.yml` unpacks the helpers beside it and the path is
 * rewritten to match.
 */
export const shipped = (here: string, ...parts: string[]): string =>
  path.join(here, ...parts).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

/** The Vision helper, built beside the app on macOS. */
export function visionHelper(here: string): string | null {
  if (process.platform !== "darwin") return null
  const where = shipped(here, "../helpers/wm-vision")
  return isExecutable(where) ? where : null
}

/** The tablet helper (tools/pen/wm-pen.swift), built beside the app on macOS. */
export function penHelper(here: string): string | null {
  if (process.platform !== "darwin") return null
  const where = shipped(here, "../helpers/wm-pen")
  return isExecutable(where) ? where : null
}

/** `tesseract`, if the machine has one. */
export function tesseract(): string | null {
  const paths = (process.env.PATH ?? "").split(path.delimiter)
  const names = process.platform === "win32" ? ["tesseract.exe"] : ["tesseract"]
  for (const folder of paths) {
    for (const name of names) {
      const where = path.join(folder, name)
      if (isExecutable(where)) return where
    }
  }
  return null
}

// MARK: - Windows' own OCR engine

/** What a spawned program answers with. Injectable so the error paths are testable without PowerShell. */
export type Runner = (file: string, args: string[], options: {
  signal?: AbortSignal
  timeout?: number
}) => Promise<{ stdout: string }>

const spawnRunner: Runner = async (file, args, options) => {
  const out = await run(file, args, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {}),
    windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: "utf8",
  })
  return { stdout: out.stdout }
}

/** The script that asks `Windows.Media.Ocr`, beside the other shipped helpers. */
export function windowsOcrScript(here: string): string | null {
  if (process.platform !== "win32") return null
  const where = shipped(here, "../helpers/wm-ocr.ps1")
  return existsSync(where) ? where : null
}

// MARK: - File ▸ Language Setup…'s Install and Activate (main/toolSetup.ts)

/**
 * The Windows installer's own optional-tools script, copied beside the app by scripts/build.mjs: Language Setup's
 * Install Python…, Install Wolfram Engine… and Activate… run it (`-FromApp`), so the app and the installer install
 * the same way. Windows only, and only when the file is there — a Mac or Linux build offers the download pages.
 */
export function toolsScript(here: string, platform: string = process.platform,
  exists: (file: string) => boolean = existsSync): string | null {
  if (platform !== "win32") return null
  const where = shipped(here, "../helpers/installer-tools.ps1")
  return exists(where) ? where : null
}

/** A file and not a folder, asked without following a link: the Store's app execution aliases are reparse points. */
const plainFile = (file: string): boolean => {
  try { return existsSync(file) && !lstatSync(file).isDirectory() } catch { return false }
}

/**
 * winget (App Installer), which is what installs: on the PATH, else the Store's alias in `%LOCALAPPDATA%\Microsoft\
 * WindowsApps` (an app started before App Installer arrived may not have that folder on its PATH) — the places
 * installer-tools.ps1's `FindWinget` looks, kept in step. Windows only.
 */
export function winget(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env,
  isFile: (file: string) => boolean = plainFile): string | null {
  if (platform !== "win32") return null
  const folders = (env.PATH ?? env.Path ?? "").split(";").map((dir) => dir.trim().replace(/^"|"$/g, "")).filter((dir) => dir.length > 0)
  for (const folder of folders) {
    const where = path.win32.join(folder, "winget.exe")
    if (isFile(where)) return where
  }
  const alias = env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "winget.exe") : null
  return alias && isFile(alias) ? alias : null
}

/** Windows PowerShell 5.1, which every Windows 10 and 11 has; the full path so a bad PATH cannot hide it. */
export function powershell(): string {
  const root = process.env.SystemRoot ?? "C:\\Windows"
  const where = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  return existsSync(where) ? where : "powershell.exe"
}

/** How the Japanese reader is added — what a user with no Japanese OCR is told. */
export const ADD_JAPANESE_OCR =
  "Add-WindowsCapability -Online -Name Language.OCR~~~ja-JP~0.0.1.0   (an elevated PowerShell), "
  + "or Settings > Time & Language > Language > Japanese > Language options > Optical character recognition"

export interface OcrProbe {
  /** An engine exists and has at least one language. */
  ok: boolean
  /** Every language it can read, BCP-47. */
  installed: string[]
  /** The language the user's profile would read in. */
  profile: string | null
  japanese: boolean
  addJapanese: string
  /** Why not, when it is not ok. */
  reason?: string
}

const failedProbe = (reason: string): OcrProbe =>
  ({ ok: false, installed: [], profile: null, japanese: false, addJapanese: ADD_JAPANESE_OCR, reason })

const scriptArgs = (script: string, rest: string[]): string[] =>
  ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...rest]

/** The error a script reports as JSON, wherever node put the output. */
function scriptError(error: unknown): Error {
  const stdout = (error as { stdout?: unknown }).stdout
  if (typeof stdout === "string") {
    try {
      const said = JSON.parse(stdout) as { error?: unknown }
      if (typeof said.error === "string") return new Error(said.error)
    } catch { /* not JSON: fall through */ }
  }
  if ((error as { name?: string }).name === "AbortError" || (error as { code?: string }).code === "ABORT_ERR") {
    return Object.assign(new Error("cancelled"), { name: "AbortError" })
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** Ask the engine what it has. Never throws: a machine without one is a probe that says so. */
export async function probeWindowsOcr(here: string, runner: Runner = spawnRunner): Promise<OcrProbe> {
  const script = windowsOcrScript(here)
  if (!script) return failedProbe("no wm-ocr.ps1 beside the app, or not Windows")
  try {
    const { stdout } = await runner(powershell(), scriptArgs(script, ["probe"]), { timeout: 20000 })
    const said = JSON.parse(stdout) as Partial<OcrProbe> & { error?: string }
    if (typeof said.error === "string") return failedProbe(said.error)
    const installed = Array.isArray(said.installed)
      ? said.installed.filter((tag): tag is string => typeof tag === "string") : []
    return {
      ok: installed.length > 0, installed,
      profile: typeof said.profile === "string" ? said.profile : null,
      japanese: said.japanese === true,
      addJapanese: ADD_JAPANESE_OCR,
      ...(installed.length === 0 ? { reason: "Windows has no OCR language for this user" } : {}),
    }
  } catch (error) {
    return failedProbe(scriptError(error).message)
  }
}

/** One picture through `Windows.Media.Ocr`. Throws what the engine said. */
export async function readWithWindowsOcr(here: string, file: string, options: ReadOptions = {},
  runner: Runner = spawnRunner): Promise<Words> {
  const script = windowsOcrScript(here)
  if (!script) throw new Error("no wm-ocr.ps1 beside the app, or not Windows")
  const rest = ["read", file,
    ...(options.languages && options.languages.length > 0 ? ["-Languages", options.languages.join(",")] : [])]
  let stdout: string
  try {
    ;({ stdout } = await runner(powershell(), scriptArgs(script, rest),
      { ...(options.signal ? { signal: options.signal } : {}), timeout: 60000 }))
  } catch (error) {
    throw scriptError(error)
  }
  const said = JSON.parse(stdout) as Words & { error?: string }
  if (typeof said.error === "string") throw new Error(said.error)
  return { ...said, engine: "windows" }
}

/** The probe, asked once per run of the app. */
let probed: Promise<OcrProbe> | null = null
export const windowsOcr = (here: string): Promise<OcrProbe> => (probed ??= probeWindowsOcr(here))
/** Forget the answer (a test, or the user added a language and asked again). */
export const forgetOcrProbe = (): void => { probed = null }

// MARK: - Whichever reader there is

/** Whether anything on this machine could read a picture's words, without asking (a file being there). */
export const canRead = (here: string): boolean =>
  visionHelper(here) !== null || windowsOcrScript(here) !== null || tesseract() !== null

/** Which reader will be used, and what it can do: the answer `capabilitiesFor` is given. */
export async function readerFor(here: string):
Promise<{ ocr: boolean; engine: OcrEngine | null; japanese: boolean }> {
  if (visionHelper(here)) return { ocr: true, engine: "vision", japanese: true }
  if (windowsOcrScript(here)) {
    const probe = await windowsOcr(here)
    if (probe.ok) return { ocr: true, engine: "windows", japanese: probe.japanese }
  }
  if (tesseract()) return { ocr: true, engine: "tesseract", japanese: false }
  return { ocr: false, engine: null, japanese: false }
}

/**
 * The words in a picture, by whichever reader this machine has. Vision gives
 * a confidence per line and is the better reader by a distance; Windows'
 * engine gives lines AND words, all boxed; tesseract gives text, so every
 * line it finds counts as read.
 */
export async function readWords(here: string, file: string, options: ReadOptions = {}): Promise<Words> {
  const vision = visionHelper(here)
  if (vision) {
    const { stdout } = await run(vision, ["text", file], {
      ...(options.signal ? { signal: options.signal } : {}), maxBuffer: 32 * 1024 * 1024,
    })
    return { ...(JSON.parse(stdout) as Words), engine: "vision" }
  }
  if (windowsOcrScript(here) && (await windowsOcr(here)).ok) {
    return readWithWindowsOcr(here, file, options)
  }
  const other = tesseract()
  if (!other) return { lines: [] }
  // `--psm 6` reads a block of text rather than hunting for a layout,
  // which is what a captured chunk of writing is.
  const { stdout } = await run(other, [file, "stdout", "--psm", "6"],
    options.signal ? { signal: options.signal } : {})
  return {
    engine: "tesseract",
    lines: stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
      .map((text) => ({ text, confidence: 1 })),
  }
}

/** The page's four corners, on the one platform that can find them. */
export async function findPage(here: string, file: string): Promise<unknown> {
  const vision = visionHelper(here)
  if (!vision) return { quad: null }
  const { stdout } = await run(vision, ["page", file])
  return JSON.parse(stdout) as unknown
}
