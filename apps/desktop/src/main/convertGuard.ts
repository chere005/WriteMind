/**
 * WHICH FOLDERS THE CONVERSION MAY TOUCH (convert.ts). It moves the person's notes, so it is guarded twice, as the rename
 * of the notes folder is (notesFolderMove.ts):
 *
 * - A TEST INSTANCE (`WRITEMIND_E2E` or `WRITEMIND_OFFSCREEN`) converts only what is under the scratch folder it was given
 *   (`WRITEMIND_NOTES`, or `WRITEMIND_DOCUMENTS`): an offscreen copy of the app started with no folder of its own must
 *   never move the real notes of the person who runs it. `WRITEMIND_NO_CONVERT=1` turns the conversion off anywhere.
 * - ON A MAC `~/Documents/WriteMind` is the Swift WriteMind's notes unless this app is known to have made it its own (it
 *   moved `WriteMindCross` there, welcomed a new install into it, or kept its drawings there under this app's names): two
 *   apps in one folder is the bug that cost two cells on 2026-09-20, and a converted folder is one the Swift app cannot
 *   open. Such a folder is left exactly as it is. `WriteMindCross` and any folder the person picked are this app's.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { NOTES_FOLDER, type Settled } from "./notesFolderMove"

export interface GuardContext {
  /** The person's Documents folder. */
  documents: string
  env: NodeJS.ProcessEnv
  platform?: string
  /** How the notes folder was settled at this launch (null: not known). */
  settled?: Settled | null
  /** The notes folder moves this app has made (notes-folder.json's `moved.to`), if any. */
  movedTo?: string | null
}

const fold = (value: string, platform: string): string => (platform === "win32" ? value.toLowerCase() : value)
const within = (folder: string, base: string, platform: string): boolean => {
  const a = fold(path.resolve(folder), platform)
  const b = fold(path.resolve(base), platform).replace(/[\\/]+$/, "")
  return a === b || a.startsWith(b + path.sep)
}

/** Whether this folder holds anything only THIS app writes. */
export async function madeByThisApp(folder: string): Promise<boolean> {
  if (await fs.access(path.join(folder, ".writemind", "welcomed")).then(() => true, () => false)) return true
  // A drawing under this app's own names: `<stem>-<12 hex>.json` (the Mac's is `<stem>.json`).
  const names = await fs.readdir(path.join(folder, ".drawings")).catch(() => [] as string[])
  return names.some((name) => /-[0-9a-f]{12}\.json$/i.test(name))
}

/** Nothing: the folder may be converted. Else why not. */
export async function conversionRefusal(folder: string, context: GuardContext): Promise<string | null> {
  const { env, documents } = context
  const platform = context.platform ?? process.platform
  if (env.WRITEMIND_NO_CONVERT === "1") return "conversion is turned off"
  if (env.WRITEMIND_E2E || env.WRITEMIND_OFFSCREEN) {
    const scratch = [env.WRITEMIND_NOTES, env.WRITEMIND_DOCUMENTS].filter((one): one is string => !!one)
    if (!scratch.some((one) => within(folder, one, platform))) return "a test instance does not touch folders of its own that it was not given"
  }
  if (platform === "darwin") {
    const swift = path.join(documents, NOTES_FOLDER)
    if (within(folder, swift, "darwin") && !(env.WRITEMIND_NOTES && within(folder, env.WRITEMIND_NOTES, "darwin"))) {
      const ours = context.settled?.outcome === "moved"
        || (context.movedTo ? within(folder, context.movedTo, "darwin") : false)
        || await madeByThisApp(swift)
      if (!ours) return "this looks like the Swift WriteMind's notes folder, which this app does not convert"
    }
  }
  return null
}
