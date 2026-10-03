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
  app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, session, shell, systemPreferences,
} from "electron"
import { watch, type FSWatcher } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { capabilitiesFor } from "@writemind/core"
import {
  createNote, createSection, duplicateNote, existing, mediaPath, moveSection, placeNote, projectTree,
  readDrawing, readNote, readSessionText, renameNote, reorder, saveMedia, setExcluded,
  wroteRecently, writeDrawing, writeNote, writeSessionText,
} from "./notes"
import { canRead, readWords } from "./helpers"
import { buildMenu } from "./menu"
import { initialMenuState, type MenuState } from "../shared/commands"
import { PROJECT_EXTENSION, ProjectStore } from "./project"
import { planEnter, planExit, type WindowMemory } from "./pad"

const here = path.dirname(fileURLToPath(import.meta.url))

// The pictures are served over a scheme of the app's own rather than read
// into the page as base64: a capture is a megabyte or two, and the note
// that holds six of them should not carry them in its markup.
protocol.registerSchemesAsPrivileged([
  { scheme: "wm", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
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
let watchers: FSWatcher[] = []
let pending: ReturnType<typeof setTimeout> | null = null

/** The open project: its folders, and the file they are saved in (if any). */
let project: ProjectStore
const projectStateFile = (): string => path.join(app.getPath("userData"), "project.json")
let menuState: MenuState = initialMenuState
let lastMenu = ""

function watchNotes(folders: string[]): void {
  for (const one of watchers) one.close()
  watchers = []
  for (const root of folders) {
    try {
      // One event per burst, and none for our own writes: a save used to
      // come back as a watcher event that re-read the tree, the note and the
      // sidecar again, each of which wrote nothing and cost a lot.
      watchers.push(watch(root, { recursive: true }, (_event, name) => {
        if (name && wroteRecently(path.join(root, name.toString()))) return
        if (pending) return
        pending = setTimeout(() => {
          pending = null
          window?.webContents.send("notes:changed")
        }, 200)
      }))
    } catch { /* a folder that is not there is not watched */ }
  }
}

// MARK: - Pad mode (the window's half)

/**
 * The window goes full screen on the display it is on, and the page shows only
 * the sheet. The tablet driver maps the whole tablet to the whole screen, so
 * the whole tablet is then the sheet. What the window was is remembered and put
 * back (pad.ts decides how); losing full screen by any other road (Windows
 * key chords, View > Toggle Full Screen) ends the pad too.
 */
let padWas: WindowMemory | null = null

function tellPad(active: boolean): void {
  if (window && !window.isDestroyed()) window.webContents.send("pad:state", active)
}

function enterPad(): boolean {
  const win = window
  if (!win || win.isDestroyed()) return false
  if (padWas) return true
  padWas = {
    bounds: win.getBounds(), maximized: win.isMaximized(), fullScreen: win.isFullScreen(),
    autoHideMenuBar: win.autoHideMenuBar, menuBarVisible: win.isMenuBarVisible(),
  }
  for (const step of planEnter(padWas)) {
    if (step === "fullScreen") win.setFullScreen(true)
    else { win.setAutoHideMenuBar(true); win.setMenuBarVisibility(false) }
  }
  tellPad(true)
  return true
}

function leavePad(): void {
  const win = window
  const was = padWas
  if (!was || !win || win.isDestroyed()) { padWas = null; return }
  padWas = null
  // The accelerators are shown and never registered (shared/commands.ts), so
  // hiding and showing the menu bar cannot change which keys work.
  const steps = planExit(was, win.isFullScreen())
  const restore = () => {
    if (win.isDestroyed()) return
    for (const step of steps) {
      if (step.step === "maximize") { if (!win.isMaximized()) win.maximize() }
      else if (step.step === "bounds") win.setBounds(step.bounds)
      else if (step.step === "menuBar") { win.setAutoHideMenuBar(step.autoHide); win.setMenuBarVisibility(step.visible) }
    }
    tellPad(false)
    // Electron settles the menu bar itself a beat after full screen ends; the person's choice is put back after that.
    setTimeout(() => {
      if (win.isDestroyed() || padWas) return
      for (const step of steps) {
        if (step.step === "menuBar") { win.setAutoHideMenuBar(step.autoHide); win.setMenuBarVisibility(step.visible) }
      }
    }, 120)
  }
  // Bounds are put back once the window has actually left full screen.
  if (steps.some((step) => step.step === "leaveFullScreen")) {
    win.once("leave-full-screen", restore)
    win.setFullScreen(false)
  } else restore()
}

/** Where the window is on the desktop, for the tablet-area helper (physical pixels come from the scale). */
function windowInfo() {
  const win = window
  if (!win) return null
  const content = win.getContentBounds()
  const display = screen.getDisplayMatching(win.getBounds())
  return { content, display: display.bounds, scale: display.scaleFactor }
}

// MARK: - The application menu

/** Commands that are the main process's own: dialogs and the project file. */
const MAIN_OWNED = /^(addFolder|saveProject|saveProjectAs|openProject|newProject|about|removeFolder:.*)$/

/** End-to-end scripts cannot click a native dialog: they name the answer ahead of time. */
let e2ePick: string | null = null
const takePick = (): string | null => {
  if (!process.env.WRITEMIND_E2E || !e2ePick) return null
  const answer = e2ePick
  e2ePick = null
  return answer
}
const askOpen = async (parent: BrowserWindow, options: Electron.OpenDialogOptions) => {
  const answer = takePick()
  return answer ? { canceled: false, filePaths: [answer] } : dialog.showOpenDialog(parent, options)
}
const askSave = async (parent: BrowserWindow, options: Electron.SaveDialogOptions) => {
  const answer = takePick()
  return answer ? { canceled: false, filePath: answer } : dialog.showSaveDialog(parent, options)
}

async function runCommand(id: string): Promise<void> {
  // Undo and Redo go down the page's own channel: the words and the drawing
  // share one history, and the page decides which is taken back.
  if (id === "undo" || id === "redo") { window?.webContents.send("edit:history", id); return }
  if (!MAIN_OWNED.test(id)) { window?.webContents.send("menu:command", id); return }
  const parent = window ?? undefined
  const changed = async () => {
    setExcluded(project.excluded)
    watchNotes(project.folders)
    await project.remember(projectStateFile())
    window?.webContents.send("notes:changed")
    rebuildMenu()
  }
  if (id === "about") {
    await dialog.showMessageBox(parent!, {
      type: "info", title: "About WriteMind", message: "WriteMind", detail: `Version ${app.getVersion()}`,
    })
  } else if (id === "addFolder") {
    const chosen = await askOpen(parent!, {
      properties: ["openDirectory", "createDirectory"],
      title: `Add a folder of notes to “${project.name}”`,
      buttonLabel: "Add to Project",
    })
    if (!chosen.canceled && chosen.filePaths[0] && project.addFolder(chosen.filePaths[0])) await changed()
  } else if (id.startsWith("removeFolder:")) {
    if (project.removeFolder(id.slice("removeFolder:".length))) await changed()
  } else if (id === "saveProject") {
    if (!(await project.save())) await runCommand("saveProjectAs")
    else { await project.remember(projectStateFile()); rebuildMenu() }
  } else if (id === "saveProjectAs") {
    const where = await askSave(parent!, {
      defaultPath: `${project.name}.${PROJECT_EXTENSION}`,
      title: "Save this project's folders as a file you can reopen",
      filters: [{ name: "WriteMind project", extensions: [PROJECT_EXTENSION] }],
    })
    if (!where.canceled && where.filePath) {
      await project.saveAs(where.filePath)
      await project.remember(projectStateFile())
      rebuildMenu()
    }
  } else if (id === "openProject") {
    const chosen = await askOpen(parent!, {
      properties: ["openFile"],
      title: "Choose a WriteMind project",
      filters: [{ name: "WriteMind project", extensions: [PROJECT_EXTENSION] }, { name: "All files", extensions: ["*"] }],
    })
    if (!chosen.canceled && chosen.filePaths[0] && await project.open(chosen.filePaths[0])) await changed()
  } else if (id === "newProject") {
    project.newProject(notesRoot())
    await changed()
  }
}

/** The menu is rebuilt when its state changes, never on a timer. */
function rebuildMenu(): void {
  const template = buildMenu({
    platform: process.platform,
    state: menuState,
    project: {
      name: project.name,
      edited: project.file !== null && project.dirty,
      folders: project.folders.map((folder) => ({ path: folder, name: path.basename(folder) || folder })),
    },
    dev: DEV || process.env.WRITEMIND_E2E === "1",
    run: (id) => { void runCommand(id) },
  })
  const key = JSON.stringify(template, (_k, v) => (typeof v === "function" ? undefined : v))
  if (key === lastMenu) return
  lastMenu = key
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: "WriteMind",
    backgroundColor: "#1e1f22",
    // Shown when the first frame is ready, not as a blank rectangle that
    // then fills in.
    show: false,
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

  window.once("ready-to-show", () => window?.show())

  // Full screen ended some other way than the pad's own Exit: the pad ends with it.
  window.on("leave-full-screen", () => { if (padWas) leavePad() })
  // A page that reloads (or is replaced) has forgotten the pad: the window must not stay full screen behind it.
  window.webContents.on("did-start-loading", () => { if (padWas) leavePad() })

  // THE RENDERER'S CONSOLE GOES TO THE APP'S LOG. A desktop app has no
  // console anybody has open, and a message nobody sees is a bug nobody
  // finds — this is how the two that cost an hour today were caught.
  window.webContents.on("console-message", (_event, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`)
  })

  // The notes folder is made and watched while the page loads, not after.
  const root = notesRoot()
  const ready = fs.mkdir(root, { recursive: true }).then(() => watchNotes(project.folders))
  if (DEV) await window.loadURL("http://localhost:5173")
  else await window.loadFile(path.join(here, "../renderer/index.html"))
  await ready
}

app.whenReady().then(async () => {
  // THE PROJECT first: the window's watcher and the sidebar's tree both read it.
  project = new ProjectStore(notesRoot())
  await project.restore(projectStateFile())
  setExcluded(project.excluded)

  protocol.handle("wm", async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== "media") return new Response("not found", { status: 404 })
    const file = mediaPath(notesRoot(), decodeURIComponent(url.pathname.replace(/^\//, "")))
    const served = await net.fetch(`file://${file}`)
    // CORS, so that the page can read a picture's PIXELS (the crop and the
    // flow-chart reader draw it into a canvas) without tainting the canvas.
    const headers = new Headers(served.headers)
    headers.set("Access-Control-Allow-Origin", "*")
    return new Response(served.body, { status: served.status, headers })
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
  ipcMain.handle("notes:tree", () => projectTree(project.folders, notesRoot(), project.name))
  ipcMain.handle("note:duplicate", (_event, file: string) => duplicateNote(notesRoot(), file))
  ipcMain.handle("note:read", (_event, file: string) => readNote(file))
  ipcMain.handle("note:write", (_event, file: string, text: string) => writeNote(file, text))
  ipcMain.handle("note:create", (_event, folder: string) => createNote(folder))
  ipcMain.handle("note:rename", (_event, file: string, title: string) => renameNote(file, title))
  ipcMain.handle("note:trash", async (_event, file: string) => { await shell.trashItem(file) })
  ipcMain.handle("section:create", (_event, parent: string) => createSection(parent))
  ipcMain.handle("section:trash", async (_event, folder: string) => { await shell.trashItem(folder) })
  ipcMain.handle("order:set", (_event, folder: string, names: string[]) =>
    reorder(notesRoot(), folder, names))
  ipcMain.handle("note:place", (_event, file: string, folder: string, before: string | null) =>
    placeNote(notesRoot(), file, folder, before))
  ipcMain.handle("section:move", (_event, folder: string, target: string) =>
    moveSection(notesRoot(), folder, target))
  // THE SESSION lives in the app's user-data folder, never beside the notes.
  ipcMain.handle("session:read", () => readSessionText(app.getPath("userData"), notesRoot()))
  ipcMain.handle("session:write", (_event, json: string) =>
    writeSessionText(app.getPath("userData"), notesRoot(), json))
  ipcMain.handle("files:existing", (_event, files: string[]) => existing(files))
  ipcMain.handle("drawing:read",(_event, note: string) => readDrawing(notesRoot(), note))
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

  // THE APP'S OWN MENU (menu.ts). The page tells the shell what the menu
  // needs to know — a note open, the sidebar shown — and hears the clicks.
  // The shortcuts are shown but NOT registered: the page hears its keys
  // itself (shared/commands.ts says who), so one press is one action.
  ipcMain.handle("menu:state", (_event, state: MenuState) => { menuState = state; rebuildMenu() })
  // A key the page heard that is the shell's to do (a dialog, the project file).
  ipcMain.handle("menu:run", async (_event, id: string) => { if (MAIN_OWNED.test(id)) await runCommand(id) })
  // The page's own right-click menu: the browser will not paste on a page's
  // say-so, the shell can.
  ipcMain.handle("edit:native", (event, command: string) => {
    const contents = event.sender
    if (command === "cut") contents.cut()
    else if (command === "copy") contents.copy()
    else if (command === "paste") contents.paste()
  })
  ipcMain.handle("pad:enter", () => enterPad())
  ipcMain.handle("pad:exit", () => { leavePad() })
  ipcMain.handle("window:info", () => windowInfo())
  rebuildMenu()
  // Lets the end-to-end scripts press Edit > Undo without a pointer.
  if (process.env.WRITEMIND_E2E) (globalThis as Record<string, unknown>).__wmMenu = Menu
  // And read the menu bar, which a page screenshot does not show.
  if (process.env.WRITEMIND_E2E) {
    type Item = {
      label: string; accelerator?: string; enabled: boolean; checked?: boolean; type: string
      id?: string; submenu?: Item[]
    }
    const dump = (items: Electron.MenuItem[]): Item[] => items.map((one) => ({
      label: one.label, accelerator: one.accelerator ? String(one.accelerator) : undefined,
      enabled: one.enabled, checked: one.type === "checkbox" ? one.checked : undefined,
      type: one.type, id: one.id || undefined,
      submenu: one.submenu ? dump(one.submenu.items) : undefined,
    }))
    ipcMain.handle("e2e:pick", (_event, answer: string) => { e2ePick = answer })
    // The pad's window half is checked from outside: the OS-level facts, not the page's.
    ipcMain.handle("e2e:window", () => {
      const win = window!
      return {
        fullScreen: win.isFullScreen(), maximized: win.isMaximized(), bounds: win.getBounds(),
        content: win.getContentBounds(), menuBarVisible: win.isMenuBarVisible(),
        autoHideMenuBar: win.autoHideMenuBar, padActive: padWas !== null,
        display: screen.getDisplayMatching(win.getBounds()).bounds,
        scale: screen.getDisplayMatching(win.getBounds()).scaleFactor,
      }
    })
    ipcMain.handle("e2e:setBounds", (_event, bounds: Electron.Rectangle) => { window?.setBounds(bounds) })
    // Full screen lost behind the pad's back (a window-manager key, the View menu).
    ipcMain.handle("e2e:leaveFullScreen", () => { window?.setFullScreen(false) })
    ipcMain.handle("e2e:menu", () => dump(Menu.getApplicationMenu()?.items ?? []))
    ipcMain.handle("e2e:menuClick", (_event, id: string) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
        for (const one of items) {
          if (one.id === id) return one
          const inner = one.submenu ? find(one.submenu.items) : null
          if (inner) return inner
        }
        return null
      }
      const hit = find(Menu.getApplicationMenu()?.items ?? [])
      if (!hit || !hit.enabled) return false
      hit.click()
      return true
    })
  }

  await createWindow()

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on("before-quit", () => { void project?.remember(projectStateFile()) })

app.on("window-all-closed", () => {
  for (const one of watchers) one.close()
  if (process.platform !== "darwin") app.quit()
})
