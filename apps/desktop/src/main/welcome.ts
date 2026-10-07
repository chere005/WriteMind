/**
 * THE QUICK REFERENCE (Sean, 2026-10-05: a new install opens on it; 2026-10-07: it ships rendered and correct). It is
 * app-owned reference material: `WriteMind Quick Reference.wm` in the notes root, a Note like any other whose text is
 * `welcomeNote()` (`shared/welcome.ts`).
 *
 * TWO WAYS IT GETS WRITTEN, both through the `.wm` store (wmStore.ts: `createFile`, and `writeText` under the store's one
 * serialised writer and its guard, so nothing is written over bytes the app did not read):
 *  - AT A NEW INSTALL, before the window reads the notes tree: an empty notes folder that the app has never welcomed
 *    gets the note and the marker `.writemind/welcomed`; being the only note, it is the first and front tab (the session's
 *    rule for a project with no session: open its first note). Never again after that: the marker stays when the note is
 *    deleted, and a folder that already holds notes is marked and gets nothing. An existing install is NOT given the file
 *    here.
 *  - FROM HELP ▸ QUICK REFERENCE (`ensureQuickReference`): the file is written when it is missing, and REWRITTEN with
 *    the current app's text when its text differs from `welcomeNote()`, so an upgraded install gets the updated reference.
 *    That overwrites any edit made to it: it is not the person's note, and they should keep their own words elsewhere (the
 *    page says so). Nothing else ever touches it, and nothing writes it unasked into an install that has the marker.
 *
 * Test instances (offscreen or `WRITEMIND_E2E`) are left alone at launch unless `WRITEMIND_WELCOME=1` asks for it, so
 * every other end-to-end script still starts from an empty folder; `WRITEMIND_WELCOME=0` turns the launch write off
 * anywhere. The menu item is a deliberate act and works in them, always in the notes root the process was given
 * (`WRITEMIND_NOTES` is a scratch folder in every test), never anywhere else.
 *
 * It opens on the RENDERED page every time it is in front (renderer/welcomeView.ts), whatever mode the other notes are in.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { textOfFile } from "@writemind/core"
import { WELCOME_FILE, welcomeNote } from "../shared/welcome"
import { LEGACY_EXTENSIONS } from "./legacyLayout"
import { createFile, loadNote, newNoteFile, refusedMessage, writeText } from "./wmStore"

/** The marker, in the notes root's own bookkeeping folder (beside `order.json`; the sidebar never shows it). */
export const welcomeMarker = (root: string): string => path.join(root, ".writemind", "welcomed")

/** Where the Quick Reference is (or will be): the notes root's top level. */
export const quickReferencePath = (root: string): string => path.join(root, WELCOME_FILE)

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
  if (entries.some((one) => one.isFile() && [...LEGACY_EXTENSIONS, ".txt", ".wm"].includes(path.extname(one.name).toLowerCase()))) return "yes"
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
 * way, so the question is asked once per notes folder. WHAT IT SAYS MATTERS: a new install's marker names the quick
 * reference that was written (`<date> WriteMind Quick Reference.wm`), a folder that already held notes gets the date
 * alone — and `convertGuard.ts` takes ONLY the named one as proof that this app made the folder (the Swift app's folder
 * got the date alone at the first launch and was converted at the second, when any marker counted).
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
  return fresh ? note : null
}

/** What `ensureQuickReference` did: wrote it new, rewrote an out-of-date copy, or found it already current. */
export type QuickReferenceChange = "created" | "updated" | "current"

/** Text as the editor holds it: its lines end in "\n" whatever the file had. */
const lines = (text: string): string => text.replace(/\r\n?/g, "\n")

/**
 * Help ▸ Quick Reference: make sure `root` holds the Quick Reference with the CURRENT app's text, and say where it is.
 * Missing: created (never over a file that is there: `createFile` links). Different from `text` (an older app's, or
 * edited by the person): rewritten, whole, through the store's one writer, so the edit is replaced (see the top). The
 * same: left alone. A file the store refuses (not a note, a newer WriteMind's, changed under us) throws with the words
 * the page shows.
 */
export async function ensureQuickReference(root: string, text: string = welcomeNote()): Promise<{ file: string; change: QuickReferenceChange }> {
  const file = quickReferencePath(root)
  // (Twice: a file that appears between the read that found none and the create is read, not written over.)
  for (let attempt = 0; attempt < 2; attempt++) {
    let have: string | null = null
    try {
      have = textOfFile(await loadNote(file))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    if (have === null) {
      try {
        await createFile(file, newNoteFile(text))
        return { file, change: "created" }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
        throw error
      }
    }
    if (lines(have) === lines(text)) return { file, change: "current" }
    const out = await writeText(file, text)
    if (!out.written) throw new Error(refusedMessage(file, out.refused))
    return { file, change: "updated" }
  }
  throw new Error(`${WELCOME_FILE} could not be written: it keeps changing`)
}
