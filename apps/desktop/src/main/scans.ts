/**
 * main/scans.ts - the document camera's SCANNED PAGES, kept as the tablet's sheets are (main/sheets.ts), in userData:
 *
 *   scans.json      the list: each page's name, size, turn, box, corners, learned shape and reading
 *                   (renderer/scanSet.ts makes the text and reads it back). The very writer `sheets.json` has: held,
 *                   written after a quiet moment whole or not at all, written at once at quit, an unreadable file
 *                   copied aside before the first write replaces it.
 *   scans/<id>.jpg  each page's picture, as the camera gave it (a whole frame: too big for the list). Written whole or
 *                   not at all (atomic.ts) BEFORE the page is added to the list, so a list never names a missing file.
 *
 * The page asks by id and never by path: an id is `[\w-]{1,64}` or it is refused. A picture no page names any more (a
 * crash between the file and the list, a page closed while the app quit) is swept after the list is read, but only if
 * it is older than a minute, so a picture that is still on its way into the list is never taken.
 */

import fs from "node:fs"
import path from "node:path"
import { app, type IpcMain } from "electron"
import { writeFileAtomic } from "./atomic"
import { sheetsFile, type SheetsFile } from "./sheets"

export const SCANS_CHANNELS = {
  load: "scans:load", save: "scans:save", put: "scans:put", get: "scans:get", drop: "scans:drop", sweep: "scans:sweep",
} as const

/** A camera frame as a JPEG is under 2 MB; beyond this it is not one. */
const MAX_PICTURE = 64 * 1024 * 1024
const GOOD_ID = /^[\w-]{1,64}$/
/** How old a picture no page names must be before it goes. */
const SWEEP_AFTER_MS = 60_000

export interface ScanPictures {
  /** The picture kept, whole or not at all; false when it could not be (the page is then not added). */
  put(id: unknown, bytes: unknown): Promise<boolean>
  /** The picture's bytes, or null (no such page, or the file is gone). */
  get(id: unknown): Buffer | null
  drop(id: unknown): void
  /** Take away every picture whose id is not in `keep` and that has lain a minute. Returns how many went. */
  sweep(keep: unknown): number
}

export function scanPictures(dir: string, options: { log?: (line: string) => void; now?: () => number } = {}): ScanPictures {
  const fileOf = (id: unknown): string | null => (typeof id === "string" && GOOD_ID.test(id) ? path.join(dir, `${id}.jpg`) : null)
  return {
    async put(id, bytes) {
      const file = fileOf(id)
      if (!file || !(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_PICTURE) return false
      try {
        await fs.promises.mkdir(dir, { recursive: true })
        await writeFileAtomic(file, bytes)
        return true
      } catch (error) {
        options.log?.(`could not keep a scanned page: ${(error as Error)?.message}`)
        return false
      }
    },
    get(id) {
      const file = fileOf(id)
      if (!file) return null
      try { return fs.readFileSync(file) } catch { return null }
    },
    drop(id) {
      const file = fileOf(id)
      if (!file) return
      try { fs.rmSync(file, { force: true }) } catch (error) { options.log?.(`could not remove a scanned page: ${(error as Error)?.message}`) }
    },
    sweep(keep) {
      if (!Array.isArray(keep)) return 0
      const wanted = new Set(keep.filter((one): one is string => typeof one === "string"))
      const now = (options.now ?? Date.now)()
      let gone = 0
      let names: string[] = []
      try { names = fs.readdirSync(dir) } catch { return 0 }
      for (const name of names) {
        const id = /^([\w-]{1,64})\.jpg$/.exec(name)?.[1]
        if (!id || wanted.has(id)) continue
        try {
          const file = path.join(dir, name)
          if (now - fs.statSync(file).mtimeMs < SWEEP_AFTER_MS) continue
          fs.rmSync(file, { force: true })
          gone++
        } catch { /* in use, or already gone: the next launch tries again */ }
      }
      return gone
    },
  }
}

/** The IPC (the list's load / save, and a picture put / get / drop, and the sweep), and the write at quit. */
export function registerScans(
  ipcMain: IpcMain, userData = app.getPath("userData"),
): { list: SheetsFile; pictures: ScanPictures } {
  const log = (line: string): void => console.warn(`WriteMind: ${line}`)
  const list = sheetsFile(path.join(userData, "scans.json"), { log })
  const pictures = scanPictures(path.join(userData, "scans"), { log })
  ipcMain.handle(SCANS_CHANNELS.load, () => list.read())
  ipcMain.on(SCANS_CHANNELS.save, (_event, text: unknown) => { if (typeof text === "string") list.hold(text) })
  ipcMain.handle(SCANS_CHANNELS.put, (_event, id: unknown, bytes: unknown) => pictures.put(id, bytes))
  ipcMain.handle(SCANS_CHANNELS.get, (_event, id: unknown) => pictures.get(id))
  ipcMain.on(SCANS_CHANNELS.drop, (_event, id: unknown) => pictures.drop(id))
  ipcMain.on(SCANS_CHANNELS.sweep, (_event, keep: unknown) => { pictures.sweep(keep) })
  app.on("will-quit", () => list.flushSync())
  return { list, pictures }
}
