/**
 * WHICH FOLDERS THE CONVERSION MAY TOUCH (convert.ts). It moves the person's notes, so it is guarded twice, as the rename
 * of the notes folder is (notesFolderMove.ts):
 *
 * - A TEST INSTANCE (`WRITEMIND_E2E` or `WRITEMIND_OFFSCREEN`) converts only what is under the scratch folder it was given
 *   (`WRITEMIND_NOTES`, or `WRITEMIND_DOCUMENTS`): an offscreen copy of the app started with no folder of its own must
 *   never move the real notes of the person who runs it. `WRITEMIND_NO_CONVERT=1` turns the conversion off anywhere.
 * - ON A MAC `~/Documents/WriteMind` is the Swift WriteMind's notes unless this app is known to have made it its own (it
 *   moved `WriteMindCross` there, welcomed a NEW install into it — the marker names the quick reference it wrote, which a
 *   folder that already held notes never gets — or kept its drawings there under this app's names): two apps in one
 *   folder is the bug that cost two cells on 2026-09-20, and a converted folder is one the Swift app cannot open. Such a
 *   folder is left exactly as it is. `WriteMindCross` and any folder the person picked are this app's.
 *
 * Folders are compared by where they REALLY are (symlinks followed, the case of a name ignored where the volume ignores
 * it, the same device and inode), and the run asks again of every folder it walks into, so a project folder that is the
 * PARENT of the Swift folder (`~/Documents`) cannot carry it in.
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

const caseless = (platform: string): boolean => platform === "win32" || platform === "darwin"
const fold = (value: string, platform: string): string => (caseless(platform) ? value.toLowerCase() : value)

/** Where a folder really is: symlinks followed as far as the path exists (a part that is not there yet is kept as written). */
export async function realPlace(folder: string): Promise<string> {
  const full = path.resolve(folder)
  try { return await fs.realpath(full) } catch {
    const parent = path.dirname(full)
    if (parent === full) return full
    return path.join(await realPlace(parent), path.basename(full))
  }
}

/**
 * Whether `folder` is `base` or lies under it, however it is spelled: a symlink is followed, the case of a name is
 * ignored where the volume does not tell it (a Mac's, a Windows'), and a folder that IS `base` by identity (the same
 * device and inode) counts. A path compared as it was typed is how `~/documents/writemind` and a symlink to the Swift
 * folder got past the guard.
 */
export async function isWithin(folder: string, base: string, platform: string): Promise<boolean> {
  const place = await realPlace(folder)
  const root = fold(await realPlace(base), platform).replace(/[\\/]+$/, "")
  const here = fold(place, platform)
  if (here === root || here.startsWith(root + path.sep)) return true
  const identity = await fs.stat(base).catch(() => null)
  if (!identity || identity.ino === 0) return false
  for (let at = place; ; at = path.dirname(at)) {
    const one = await fs.stat(at).catch(() => null)
    if (one && one.ino === identity.ino && one.dev === identity.dev) return true
    if (path.dirname(at) === at) return false
  }
}

/**
 * Whether the welcome marker (`.writemind/welcomed`, welcome.ts) says THIS APP made the folder. The marker is written in
 * every folder the app ever looked at, and only a new install's has the quick reference's name after its date
 * (`2026-10-01T00:00:00.000Z WriteMind Quick Reference.wm`; 2.x wrote `.md`): a folder that already held notes when the
 * app first looked (the Swift app's) gets the date alone. So a marker proves only that the app looked, and a named one
 * that the app made the folder.
 */
export async function welcomedAsNew(folder: string): Promise<boolean> {
  const text = await fs.readFile(path.join(folder, ".writemind", "welcomed"), "utf8").catch(() => null)
  return text !== null && /^\S+[ \t]+WriteMind Quick Reference\.(?:wm|md)[ \t]*$/i.test(text.split(/\r?\n/)[0] ?? "")
}

/** Whether this folder holds anything only THIS app writes. */
export async function madeByThisApp(folder: string): Promise<boolean> {
  const top = await fs.readdir(folder).catch(() => [] as string[])
  // A new install's marker, with a note of this app's own in the folder (the quick reference, or any `.wm`).
  if (await welcomedAsNew(folder) && top.some((name) => /\.wm$/i.test(name) || /^WriteMind Quick Reference\.md$/i.test(name))) return true
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
    let inside = false
    for (const one of scratch) if (await isWithin(folder, one, platform)) { inside = true; break }
    if (!inside) return "a test instance does not touch folders of its own that it was not given"
  }
  if (platform === "darwin") {
    const swift = path.join(documents, NOTES_FOLDER)
    if (await isWithin(folder, swift, "darwin") && !(env.WRITEMIND_NOTES && await isWithin(folder, env.WRITEMIND_NOTES, "darwin"))) {
      const ours = context.settled?.outcome === "moved"
        || (context.movedTo ? await isWithin(folder, context.movedTo, "darwin") : false)
        || await madeByThisApp(swift)
      if (!ours) return "this looks like the Swift WriteMind's notes folder, which this app does not convert"
    }
  }
  return null
}
