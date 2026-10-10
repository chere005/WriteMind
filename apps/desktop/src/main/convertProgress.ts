/**
 * "CONVERTING YOUR NOTES (n of N)…" — the one thing on screen while the first launch of 3.0 turns a person's notes into
 * `.wm` files before the window can read them. A folder of thousands of notes takes many seconds, and an app that shows
 * nothing for that long looks hung (and gets quit). If the run is over about a second old, a small window of its own says
 * how far it has got; a run that is quicker never shows it. It is never made in a test instance. Closing it (by hand or by
 * the run being done) is not "the last window closed": `closedByRun` tells main's `window-all-closed` so the app does not
 * quit while the main window is still to be made.
 */

import { BrowserWindow, nativeTheme } from "electron"

const PAGE = (text: string): string => `<!doctype html><meta charset="utf-8"><title>WriteMind</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px;
    font: 14px -apple-system, "Segoe UI", system-ui, sans-serif; background: Canvas; color: CanvasText; user-select: none; }
  #bar { width: 260px; height: 4px; border-radius: 2px; background: color-mix(in srgb, CanvasText 15%, transparent); overflow: hidden; }
  #fill { height: 100%; width: 0; background: #3b6fd1; transition: width 0.2s; }
  small { opacity: 0.6; }
</style>
<div id="t">${text}</div><div id="bar"><div id="fill"></div></div><small>Your originals are kept in a backup folder.</small>`

/** Set while the run closes the window itself (main's `window-all-closed` ignores that one). */
let closedByRun = false
export const closingByRun = (): boolean => closedByRun

export interface Progress { update(done: number, total: number): void; close(): void }

export function conversionProgress(options: { after?: number; show?: boolean } = {}): Progress {
  const after = options.after ?? 1000
  const wanted = options.show ?? !(process.env.WRITEMIND_E2E || process.env.WRITEMIND_OFFSCREEN)
  let window: BrowserWindow | null = null
  let latest = { done: 0, total: 0 }
  let finished = false
  const words = (): string => `Converting your notes (${latest.done} of ${latest.total})…`
  const timer = wanted ? setTimeout(() => {
    if (finished) return
    try {
      window = new BrowserWindow({
        width: 360, height: 130, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        title: "WriteMind", show: true, backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1f22" : "#ffffff",
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      window.setMenuBarVisibility(false)
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE(words()))}`)
      window.on("closed", () => { window = null })
    } catch { window = null }
  }, after) : null
  const paint = (): void => {
    if (!window || window.isDestroyed()) return
    const percent = latest.total > 0 ? Math.round((latest.done / latest.total) * 100) : 0
    void window.webContents.executeJavaScript(
      `document.getElementById("t").textContent=${JSON.stringify(words())};document.getElementById("fill").style.width="${percent}%"`,
    ).catch(() => undefined)
  }
  return {
    update(done, total) { latest = { done, total }; paint() },
    close() {
      finished = true
      if (timer) clearTimeout(timer)
      if (window && !window.isDestroyed()) {
        closedByRun = true
        window.destroy()
        // (the event for it arrives at once; the flag is dropped after it has been looked at)
        setTimeout(() => { closedByRun = false }, 500)
      }
      window = null
    },
  }
}
