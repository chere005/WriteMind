/**
 * Help ▸ About WriteMind, the main process's half (shared/about.ts says what the page may ask; AboutDialog.tsx draws
 * it). Reads `out/notices.json`, which the build wrote (scripts/build.mjs, tools/gen-notices.mjs), and opens the
 * project page when the dialog's button is pressed. One About on every platform: the Mac's own panel is not used
 * (menu.ts has its own About item, and macIdentity.ts no longer sets the panel's options).
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import type { IpcMain } from "electron"
import { ABOUT_CHANNELS, ABOUT_FALLBACK, aboutFromNotices, aboutMissing, type AboutInfo } from "../shared/about"

/** Where the build puts the notices, from the main bundle's folder (out/main): out/notices.json. */
export const noticesFile = (here: string): string => path.join(here, "..", "notices.json")

/** The dialog's information: the file's, or a bare line when the build has none (or a damaged one). */
export function readAbout(file: string, version: string, read: (file: string) => string = (one) => readFileSync(one, "utf8")): AboutInfo {
  try {
    return aboutFromNotices(JSON.parse(read(file)), version) ?? aboutMissing(version)
  } catch {
    return aboutMissing(version)
  }
}

export interface AboutHost {
  /** The info, read afresh (the file is small and is read only when the dialog opens). */
  info(): AboutInfo
  /** Open a page in the browser: only ever called with the project page. */
  open(url: string): Promise<unknown> | unknown
}

/** The two channels. The page can ask for the information and for the project page; it names no file and no URL. */
export function registerAbout(ipc: Pick<IpcMain, "handle">, host: AboutHost): void {
  ipc.handle(ABOUT_CHANNELS.info, () => host.info())
  ipc.handle(ABOUT_CHANNELS.openProject, async () => {
    // The URL is the file's own (the generator's PROJECT_URL), and only a web page is opened.
    const url = host.info().url
    await host.open(/^https:\/\//.test(url) ? url : ABOUT_FALLBACK.url)
  })
}
