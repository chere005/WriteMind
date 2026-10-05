/**
 * main/sheets.ts - userData/sheets.json: the tablet's sheets (tabs), their ink and paper, and the open one
 * (renderer/tabletSheets.ts makes the text, renderer/sheetSet.ts reads it back tolerantly).
 *
 * Kept here and not in localStorage because ink can be large. Written as pen-state.json is: the latest text is held,
 * written after a quiet moment, whole or not at all (a temp file beside it, renamed over it), and written at once
 * when the app quits. A file that cannot be read (or is not JSON) is no sheets (the page starts with one empty sheet),
 * and is copied aside before the first write replaces it; beyond "is it JSON" this file never judges the contents.
 * A page reloaded before the held text was written reads that text.
 */

import fs from "node:fs"
import path from "node:path"
import { app, type IpcMain } from "electron"

export const SHEETS_CHANNELS = { load: "sheets:load", save: "sheets:save" } as const

/** Far beyond any sheet set written by hand; refused rather than written. */
const MAX_BYTES = 64 * 1024 * 1024

export interface SheetsFile {
  read(): string | null
  /** Hold `text` and write it after `debounceMs` of quiet. */
  hold(text: string): void
  flushSync(): void
}

export function sheetsFile(file: string, options: { debounceMs?: number; log?: (line: string) => void } = {}): SheetsFile {
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * The file was there but could not be read (locked, or not JSON): the page starts empty and its first write would
   * replace it, so that file is copied aside first (`sheets.unreadable-<time>.json`), never lost.
   */
  let keepAside = false
  const write = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    if (pending === null) return
    const text = pending
    pending = null
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      if (keepAside) {
        keepAside = false
        try {
          fs.copyFileSync(file, path.join(path.dirname(file), `sheets.unreadable-${Date.now()}.json`))
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") { keepAside = true; throw error }
        }
      }
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, text, "utf8")
      try {
        fs.renameSync(tmp, file)
      } catch (error) {
        // Held for a moment by a scanner or a sync client: once more, then let the next change try again.
        const code = String((error as NodeJS.ErrnoException)?.code ?? "")
        if (code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") throw error
        fs.renameSync(tmp, file)
      }
    } catch (error) {
      if (pending === null) pending = text
      options.log?.(`could not write sheets.json: ${(error as Error)?.message}`)
    }
  }
  return {
    read() {
      // A page reloaded within the quiet moment reads what the last one held, not the older file.
      if (pending !== null) return pending
      for (let attempt = 0; ; attempt++) {
        try {
          const text = fs.readFileSync(file, "utf8")
          try { JSON.parse(text) } catch { keepAside = true }
          return text
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null
          // Held for a moment by a scanner or a sync client: a few tries, then the page starts empty (the file is kept).
          if (attempt >= 3) {
            keepAside = true
            options.log?.(`could not read sheets.json: ${(error as Error)?.message}`)
            return null
          }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40)
        }
      }
    },
    hold(text) {
      if (typeof text !== "string") return
      if (text.length > MAX_BYTES) { options.log?.(`sheets.json not written: ${text.length} characters is too much`); return }
      pending = text
      if (timer) clearTimeout(timer)
      timer = setTimeout(write, options.debounceMs ?? 300)
      timer.unref?.()
    },
    flushSync: write,
  }
}

/** The IPC pair (`sheets:load` answers the text or null; `sheets:save` hands the latest text) and the write at quit. */
export function registerSheets(ipcMain: IpcMain, file = path.join(app.getPath("userData"), "sheets.json")): SheetsFile {
  const store = sheetsFile(file, { log: (line) => console.warn(`WriteMind: ${line}`) })
  ipcMain.handle(SHEETS_CHANNELS.load, () => store.read())
  ipcMain.on(SHEETS_CHANNELS.save, (_event, text: unknown) => { if (typeof text === "string") store.hold(text) })
  app.on("will-quit", () => store.flushSync())
  return store
}
