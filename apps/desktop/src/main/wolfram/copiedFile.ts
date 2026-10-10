/**
 * The SVG FILE a Copy Cell puts on the clipboard for the other apps (main/wolfram/clipboard.ts `saveSvg`): `Drawing.svg` in a
 * folder of its own under one root in the temp folder. The file has to outlive the copy (an app reads it when it is PASTED),
 * so nothing removes it at once: the NEXT Copy Cell sweeps the earlier copies away, and so does the start of the app for
 * anything older than a day.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { COPIED_SVG_NAME } from "@writemind/core"

/** What the start of the app sweeps away: a copy this old can have been pasted by now. */
export const COPIED_KEEP_MS = 24 * 60 * 60 * 1000

/** Write `svg` to a new folder under `root` (the earlier copies' folders removed), and return the file's path. */
export async function saveCopiedSvg(root: string, svg: string): Promise<string> {
  await fs.mkdir(root, { recursive: true })
  const before = await fs.readdir(root).catch(() => [] as string[])
  const folder = await fs.mkdtemp(path.join(root, "copy-"))
  const file = path.join(folder, COPIED_SVG_NAME)
  await fs.writeFile(file, svg, "utf8")
  for (const name of before) await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined)
  return file
}

/** Remove the copies under `root` older than `keepMs` (none: nothing there). Never throws. */
export async function sweepCopiedSvgs(root: string, now: number, keepMs = COPIED_KEEP_MS): Promise<number> {
  let swept = 0
  for (const name of await fs.readdir(root).catch(() => [] as string[])) {
    const folder = path.join(root, name)
    const stat = await fs.stat(folder).catch(() => null)
    if (!stat || now - stat.mtimeMs < keepMs) continue
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined)
    swept++
  }
  return swept
}
