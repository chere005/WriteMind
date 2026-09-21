/**
 * The programs the app did not write, and whether this machine has them.
 *
 * ONE RULE, three platforms: a capability is a FILE BEING THERE. macOS has
 * `wm-vision`, the small Vision binary `tools/build-vision.sh` compiles
 * beside the app — nothing else reads handwriting as well. Everywhere else
 * (and on a Mac with no helper built) the app looks for `tesseract` on the
 * PATH, which Arch calls `tesseract` and `tesseract-data-eng`.
 *
 * Neither is a dependency: with neither installed the app runs exactly as
 * it does now and simply does not offer to read a picture.
 */

import { execFile } from "node:child_process"
import { accessSync, constants } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

export interface ReadLine {
  text: string
  confidence: number
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

/** Whether anything on this machine can read a picture's words. */
export const canRead = (here: string): boolean =>
  visionHelper(here) !== null || tesseract() !== null

/**
 * The words in a picture, by whichever reader this machine has. Vision
 * gives a confidence per line and is the better reader by a distance;
 * tesseract gives text, so every line it finds counts as read.
 */
export async function readWords(here: string, file: string): Promise<{ lines: ReadLine[] }> {
  const vision = visionHelper(here)
  if (vision) {
    const { stdout } = await run(vision, ["text", file])
    return JSON.parse(stdout) as { lines: ReadLine[] }
  }
  const other = tesseract()
  if (!other) return { lines: [] }
  // `--psm 6` reads a block of text rather than hunting for a layout,
  // which is what a captured chunk of writing is.
  const { stdout } = await run(other, [file, "stdout", "--psm", "6"])
  return {
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
