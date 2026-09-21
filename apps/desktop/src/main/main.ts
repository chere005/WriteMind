/**
 * The desktop shell: one window, the file work, and nothing about the
 * notebook itself — that is all in `@writemind/core` and `@writemind/editor`,
 * which know nothing about Electron.
 *
 * WHICH FOLDER. The Mac app keeps its notes in `~/Documents/WriteMind`.
 * This one keeps its own in `~/Documents/WriteMindCross` until it is told
 * otherwise (`WRITEMIND_NOTES`), because two apps writing one folder is the
 * exact shape of the bug that cost two cells on 2026-09-20 — and because a
 * port is not something to point at somebody's real notes on its first run.
 */

import {
  app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, systemPreferences,
} from "electron"
import { watch, type FSWatcher } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { capabilitiesFor } from "@writemind/core"
import {
  createNote, createSection, mediaPath, readDrawing, readNote, renameNote, reorder, saveMedia,
  tree, writeDrawing, writeNote,
} from "./notes"
import { canRead, readWords } from "./helpers"

const here = path.dirname(fileURLToPath(import.meta.url))

// The pictures are served over a scheme of the app's own rather than read
// into the page as base64: a capture is a megabyte or two, and the note
// that holds six of them should not carry them in its markup.
protocol.registerSchemesAsPrivileged([
  { scheme: "wm", privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// WAYLAND. Arch is as likely to be Wayland as X11, and Electron defaults to
// X11 through Xwayland — which works, but blurs the window on a scaled
// display and drops fractional scaling. The hint takes Wayland when the
// session is Wayland and changes nothing anywhere else.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto")
}
const DEV = process.env.WRITEMIND_DEV === "1"

/**
 * Where the notes live. `app.getPath("documents")` rather than
 * `~/Documents`: on Linux that reads the XDG user directory, so a machine
 * whose documents folder is called something else — or is somewhere else
 * entirely — is respected rather than corrected.
 */
const notesRoot = (): string =>
  process.env.WRITEMIND_NOTES ?? path.join(app.getPath("documents"), "WriteMindCross")

let window: BrowserWindow | null = null
let watcher: FSWatcher | null = null

function watchNotes(root: string): void {
  watcher?.close()
  try {
    watcher = watch(root, { recursive: true }, () => {
      window?.webContents.send("notes:changed")
    })
  } catch {
    watcher = null
  }
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: "WriteMind",
    backgroundColor: "#1e1f22",
    // The Mac gets its inset traffic lights; Windows keeps its own frame,
    // because a window that does not look like the system's is the first
    // thing that says "this was ported".
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Linux window managers take the icon from the window itself; macOS
    // and Windows take it from the bundle.
    ...(process.platform === "linux"
      ? { icon: path.join(here, "../renderer/icon.png") }
      : {}),
    webPreferences: {
      preload: path.join(here, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // THE RENDERER'S CONSOLE GOES TO THE APP'S LOG. A desktop app has no
  // console anybody has open, and a message nobody sees is a bug nobody
  // finds — this is how the two that cost an hour today were caught.
  window.webContents.on("console-message", (_event, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`)
  })

  if (DEV) await window.loadURL("http://localhost:5173")
  else await window.loadFile(path.join(here, "../renderer/index.html"))

  const root = notesRoot()
  await fs.mkdir(root, { recursive: true })
  watchNotes(root)
}

app.whenReady().then(async () => {
  protocol.handle("wm", (request) => {
    const url = new URL(request.url)
    if (url.hostname !== "media") return new Response("not found", { status: 404 })
    const file = mediaPath(notesRoot(), decodeURIComponent(url.pathname.replace(/^\//, "")))
    return net.fetch(`file://${file}`)
  })

  // THE CAMERA IS ASKED FOR, ONCE, AND ONLY WHEN THE PANE OPENS. macOS
  // will not hand a page a camera until the APP has been granted one, and
  // a page asking with no grant behind it simply gets nothing — a black
  // rectangle with no explanation, which is exactly the failure this
  // handler exists to avoid. Nothing but the camera is ever allowed.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "media")
  })
  ipcMain.handle("camera:ask", async () => {
    if (process.platform !== "darwin") return true
    if (systemPreferences.getMediaAccessStatus("camera") === "granted") return true
    return systemPreferences.askForMediaAccess("camera")
  })

  ipcMain.handle("app:capabilities", () => {
    return {
      // A CAPABILITY IS A FILE BEING THERE: `wm-vision` on macOS,
      // `tesseract` anywhere. Neither is a dependency — with neither
      // installed the app runs the same and simply does not offer to
      // read a picture.
      ...capabilitiesFor(process.platform, { ocr: canRead(here) }),
      platform: process.platform,
      root: notesRoot(),
    }
  })
  ipcMain.handle("notes:tree", () => tree(notesRoot()))
  ipcMain.handle("note:read", (_event, file: string) => readNote(file))
  ipcMain.handle("note:write", (_event, file: string, text: string) => writeNote(file, text))
  ipcMain.handle("note:create", (_event, folder: string) => createNote(folder))
  ipcMain.handle("note:rename", (_event, file: string, title: string) => renameNote(file, title))
  ipcMain.handle("note:trash", async (_event, file: string) => { await shell.trashItem(file) })
  ipcMain.handle("section:create", (_event, parent: string) => createSection(parent))
  ipcMain.handle("section:trash", async (_event, folder: string) => { await shell.trashItem(folder) })
  ipcMain.handle("order:set", (_event, folder: string, names: string[]) =>
    reorder(notesRoot(), folder, names))
  ipcMain.handle("drawing:read", (_event, note: string) => readDrawing(notesRoot(), note))
  ipcMain.handle("drawing:write", (_event, note: string, json: string) =>
    writeDrawing(notesRoot(), note, json))
  ipcMain.handle("notes:reveal", () => shell.openPath(notesRoot()))
  ipcMain.handle("media:save", (_event, bytes: Uint8Array, extension: string) =>
    saveMedia(notesRoot(), bytes, extension))
  /** The words in a picture, by whichever reader this machine has. */
  ipcMain.handle("vision:read", (_event, file: string) =>
    readWords(here, mediaPath(notesRoot(), file)))

  ipcMain.handle("media:choose", async () => {
    if (!window) return null
    const chosen = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "gif", "webp", "heic"] }],
    })
    if (chosen.canceled || chosen.filePaths.length === 0) return null
    const file = chosen.filePaths[0]!
    return { bytes: await fs.readFile(file), extension: path.extname(file) }
  })

  // Export ▸ PDF, which both platforms have because Chromium prints the
  // page — the one thing the port gets for free that the Mac had to build.
  ipcMain.handle("export:pdf", async (_event, suggested: string) => {
    if (!window) return null
    const where = await dialog.showSaveDialog(window, {
      defaultPath: `${suggested}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    })
    if (where.canceled || !where.filePath) return null
    const pdf = await window.webContents.printToPDF({ printBackground: true })
    await fs.writeFile(where.filePath, pdf)
    return where.filePath
  })

  await createWindow()

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on("window-all-closed", () => {
  watcher?.close()
  if (process.platform !== "darwin") app.quit()
})
