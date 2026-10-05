/**
 * The window's size and place, remembered between launches — the shell's half
 * of `windowState.ts` (which holds the rules and is tested). A window that
 * was maximised comes back maximised; one on a monitor that is gone comes
 * back on the primary display at its old size.
 */

import { app, screen, type BrowserWindow } from "electron"
import { promises as fs } from "node:fs"
import path from "node:path"
import { parseSaved, placeWindow, type Placement, type SavedWindow } from "./windowState"

const file = (): string => path.join(app.getPath("userData"), "window.json")

export async function windowPlacement(): Promise<Placement> {
  const saved = parseSaved(await fs.readFile(file(), "utf8").catch(() => null))
  const areas = [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter(
    (one) => one.id !== screen.getPrimaryDisplay().id)].map((one) => one.workArea)
  return placeWindow(saved, areas)
}

/** Writes the window's normal bounds as it is moved and resized, and once more as it closes. */
export function rememberWindow(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = () => {
    timer = null
    if (win.isDestroyed() || win.isMinimized()) return
    const state: SavedWindow = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    void fs.writeFile(file(), JSON.stringify(state), "utf8").catch(() => {})
  }
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(write, 400) }
  win.on("resize", soon)
  win.on("move", soon)
  win.on("maximize", soon)
  win.on("unmaximize", soon)
  win.on("close", () => { if (timer) clearTimeout(timer); write() })
}
