/**
 * A NEW INSTALL OPENS ON THE QUICK REFERENCE (Sean, 2026-10-05). Before the window reads the notes tree, an empty
 * notes folder that the app has never welcomed gets `WriteMind Quick Reference.md` (`shared/welcome.ts`) and the
 * marker `.writemind/welcomed`; being the only note, it is the first and front tab (the session's rule for a
 * project with no session: open its first note). Never again after that: the marker stays when the note is deleted,
 * and a folder that already holds notes is marked and gets nothing.
 *
 * Test instances (offscreen or `WRITEMIND_E2E`) are left alone unless `WRITEMIND_WELCOME=1` asks for it, so every
 * other end-to-end script still starts from an empty folder; `WRITEMIND_WELCOME=0` turns it off anywhere.
 *
 * Its FIRST open is on the rendered page (Sean, 2026-10-05: "open on rendered page"): the page asks once
 * (`welcome:take`, `takeWelcomed`) which note was written at this launch and shows that note rendered then
 * (renderer/welcomeView.ts). An existing install, a later launch and every other note open as they always did.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { WELCOME_FILE, welcomeNote } from "../shared/welcome"
import { LEGACY_EXTENSIONS } from "./legacyLayout"
import { createFile, newNoteFile } from "./wmStore"

/** The marker, in the notes root's own bookkeeping folder (beside `order.json`; the sidebar never shows it). */
export const welcomeMarker = (root: string): string => path.join(root, ".writemind", "welcomed")

/** The quick reference written at this launch, until the page has asked for it once. */
let written: string | null = null
/** The note written at this launch (its first open is on the rendered page), once; null after that and otherwise. */
export function takeWelcomed(): string | null {
  const note = written
  written = null
  return note
}

/** Whether this launch may welcome at all (see the top). */
export function welcomeWanted(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WRITEMIND_WELCOME === "0") return false
  if (env.WRITEMIND_WELCOME === "1") return true
  return !env.WRITEMIND_E2E && !env.WRITEMIND_OFFSCREEN
}

/**
 * Whether `folder` holds a note anywhere under it: "yes", "no", or "unknown" (it could not be read, or it is too
 * big to look through), which counts as yes. Hidden folders (the app's `.writemind`) are not looked in.
 */
async function holdsNotes(folder: string, budget = { dirs: 400 }, depth = 0): Promise<"yes" | "no" | "unknown"> {
  if (--budget.dirs < 0 || depth > 8) return "unknown"
  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(folder, { withFileTypes: true })
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "no" : "unknown"
  }
  if (entries.some((one) => one.isFile() && [...LEGACY_EXTENSIONS, ".wm"].includes(path.extname(one.name).toLowerCase()))) return "yes"
  for (const one of entries) {
    if (!one.isDirectory() || one.name.startsWith(".")) continue
    const inner = await holdsNotes(path.join(folder, one.name), budget, depth + 1)
    if (inner !== "no") return inner
  }
  return "no"
}

/**
 * Write the quick reference into `root` if this is a new install: no marker and no note in `root` or in any of the
 * project's `folders`. Returns the note's path when it was written now, else null. The marker is written either
 * way, so the question is asked once per notes folder.
 */
export async function welcomeOnce(root: string, folders: string[] = []): Promise<string | null> {
  const marker = welcomeMarker(root)
  try {
    await fs.access(marker)
    return null
  } catch { /* never welcomed: look */ }
  let fresh = true
  for (const folder of [root, ...folders]) {
    if ((await holdsNotes(folder)) !== "no") { fresh = false; break }
  }
  const note = path.join(root, WELCOME_FILE)
  if (fresh) {
    await fs.mkdir(root, { recursive: true })
    // Never over a file of that name (the folder was empty of notes a moment ago, but not of everything): `createFile` links.
    await createFile(note, newNoteFile(welcomeNote())).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
      fresh = false
    })
  }
  await fs.mkdir(path.dirname(marker), { recursive: true })
  await fs.writeFile(marker, `${new Date().toISOString()}${fresh ? ` ${WELCOME_FILE}` : ""}\n`, "utf8")
  if (fresh) written = note
  return fresh ? note : null
}
