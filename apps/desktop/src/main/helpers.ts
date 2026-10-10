/**
 * The programs the app did not write, and whether this machine has them.
 *
 * ONE RULE, three platforms: a capability is a FILE BEING THERE. READING A
 * PICTURE is the bundled reader (main/bundledOcr.ts, docs/OCR-BUNDLED.md:
 * PP-OCRv5 on onnxruntime's WebAssembly build, shipped inside the app), and
 * it is the ONLY reader - the same engine on macOS, Windows and Linux (Sean,
 * 2026-10-10: "OCR should use the exact same technology cross platform"). It
 * was measured against Apple Vision, Windows.Media.Ocr and tesseract and they
 * were removed; nothing here asks the platform. When the reader's files are
 * not beside the app (a dev build made offline with no model cache) there is
 * no reader: `canRead` says so, and the app shows nothing for it (no Aa on a
 * picture, no Text in the camera's box) - there is no fallback.
 *
 * What else is a file being there: the tablet helper on macOS (`penHelper`),
 * the installer's tools script on Windows (`toolsScript`) and winget.
 */

import { accessSync, constants, existsSync, lstatSync } from "node:fs"
import path from "node:path"
import { bundledOcrFolder, readWithBundledOcr } from "./bundledOcr"

export interface ReadLine {
  text: string
  confidence: number
  /** The line's box as FRACTIONS of the picture, y down — when the reader says. */
  x?: number
  y?: number
  width?: number
  height?: number
  /** Its words, boxed the same way. */
  words?: { text: string; x: number; y: number; width: number; height: number }[]
}

/** What a reader gave back for one picture. */
export interface Words {
  lines: ReadLine[]
}

export interface ReadOptions {
  /**
   * BCP-47 tags to read in. Without them the reader reads English and Japanese in the one pass; tags that leave
   * Japanese out skip its recogniser (main/bundledOcr.ts `wantsJapanese`).
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

/** The tablet helper (tools/pen/wm-pen.swift), built beside the app on macOS. */
export function penHelper(here: string): string | null {
  if (process.platform !== "darwin") return null
  const where = shipped(here, "../helpers/wm-pen")
  return isExecutable(where) ? where : null
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

// MARK: - The reader

/** Whether this machine has a reader (the bundled one's files being beside the app), asked without starting anything. */
export const canRead = (here: string): boolean => bundledOcrFolder(here) !== null

/**
 * The words in a picture, by the bundled reader. Throws what the reader said when it fails (the page says the reader
 * failed, which is not the same as reading nothing) and an AbortError when the read was taken back. With no reader
 * on the machine there is nothing to ask: no words (the app never offers to read then; see `canRead`).
 */
export async function readWords(here: string, file: string, options: ReadOptions = {}): Promise<Words> {
  if (!canRead(here)) return { lines: [] }
  return readWithBundledOcr(here, file, options)
}
