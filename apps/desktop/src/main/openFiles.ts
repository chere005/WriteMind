/**
 * NOTES OPENED FROM OUTSIDE THE APP: a double click on a `.wm` in Finder or Explorer (`open-file` on a Mac, the command
 * line on Windows and Linux, the same again for a second launch), a `.wm` or `.md` dropped on the window, and a plain
 * markdown file the person opens. A `.wm` opens as a tab (it need not be in a project folder); a `.md` is IMPORTED — made
 * into a new `.wm` beside it, converted the way the old notes are, and the original left exactly as it was — and the new
 * note opens.
 *
 * What is asked for is queued here and the page takes it (`take`) when it is ready (after the session is back, so the
 * note opened from Finder comes to the front over the ones that were open), and again whenever it is told there is more.
 * No Electron in this file: main.ts hands in the pieces.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { isMdwmName, isWmName, legacyOrder } from "@writemind/core"

/** The extensions that can be opened from outside: a note, and the markdown it is imported from. */
export const isOpenable = (file: string): boolean => isWmName(file) || isMdwmName(file) || legacyOrder(file) >= 0

/**
 * The files named on a command line: arguments that are not switches, resolved against `cwd`, that look like something
 * this app opens. (`argv` is `process.argv` as is: a development run starts with the electron binary and the app's folder.)
 */
export function candidates(argv: readonly string[], cwd: string, packaged: boolean): string[] {
  const out: string[] = []
  for (const argument of argv.slice(packaged ? 1 : 2)) {
    if (argument.startsWith("-") || argument === "." || !isOpenable(argument)) continue
    const full = path.resolve(cwd, argument)
    if (!out.includes(full)) out.push(full)
  }
  return out
}

export type Admitted = { file: string; imported: boolean; from?: string } | { error: string; file: string }

/** A file asked for: a `.wm` as it is, a `.md` imported (`importMarkdown` makes the `.wm` beside it and says where). */
export async function admit(file: string, importMarkdown: (file: string) => Promise<string>,
  importMdwm: (file: string) => Promise<string> = importMarkdown): Promise<Admitted> {
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) return { file, error: `${path.basename(file)} is not there` }
  if (isWmName(file)) return { file, imported: false }
  if (legacyOrder(file) >= 0 || isMdwmName(file)) {
    try { return { file: await (isMdwmName(file) ? importMdwm : importMarkdown)(file), imported: true, from: file } } catch (error) {
      return { file, error: `${path.basename(file)} could not be opened as a note: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { file, error: `${path.basename(file)} is not a WriteMind note` }
}

/** Files waiting for the page. */
export class OpenQueue {
  private waiting: string[] = []
  push(file: string): void { if (!this.waiting.includes(file)) this.waiting.push(file) }
  /** Everything waiting, once. */
  take(): string[] { return this.waiting.splice(0) }
  get size(): number { return this.waiting.length }
}
