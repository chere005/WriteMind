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
  app, BrowserWindow, nativeTheme, dialog, ipcMain, Menu, net, powerMonitor, protocol, screen, session, shell, systemPreferences,
} from "electron"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { capabilitiesFor, mediaFiles } from "@writemind/core"
import {
  createNote, createSection, duplicateNote, existing, findMedia, isProjectFolder, mediaPath, moveSection,
  placeNote, projectTree, readDrawing, readNote, renameNote, renameSection, reorder, saveInkSnapshot, saveMedia,
  fileChanged, forgetTrust, setExcluded, setProjectFolders, setWatched, wroteRecently, writeDrawing, writeNote,
} from "./notes"
import { pictureFiles } from "./macDrawing"
import { rescueUnsaved } from "./rescue"
import { ADD_JAPANESE_OCR, readerFor, windowsOcr } from "./helpers"
import { ocrFor } from "./ocr"
import { buildMenu } from "./menu"
import { initialMenuState, type MenuState } from "../shared/commands"
import { isForeignPath, ProjectStore, readProjectSession, writeProjectSession } from "./project"
import { followFolders, nodePorts } from "./watcher"
import { isPdfPicture, readPdfPicture, svgDataUrl } from "./pdfPicture"
import { PROJECT_COMMANDS, projectInfo, runProjectCommand, type ProjectChange } from "./projectCommands"
import { startPenSubsystem, type PenSubsystem } from "./pen/subsystem"
import { exportNotePdf, writeNotePdf, type ExportRequest } from "./exportPdf"
import { exportFile } from "./exportFile"
import { rememberWindow, windowPlacement } from "./windowMemory"
import { installPerfProbe } from "./perfProbe"
import { registerEval } from "./eval/ipc"
import { registerSheets } from "./sheets"
import { takeWelcomed, welcomeOnce, welcomeWanted } from "./welcome"
import type { Runner as EvalRunner } from "./eval/runner"
import { MIN_WINDOW } from "../shared/layout"

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

// CLOSING THE WINDOW IS A HANDSHAKE. The page holds the last half second of typing (and of drawing) in memory
// until its debounced save fires; a window closed with the X, Alt+F4 or Quit used to take the page with it and
// the process quit before the page's own fire-and-forget write had reached the disk (0 of 4 attempts kept the
// text when the close came straight after a keystroke). So the first close is held, the page is asked to write
// what it has and to say when it has, and only then does the window close — never waiting more than a couple
// of seconds for a page that has stopped answering.
let closeApproved = false
let askedToFlush = false
function askPageToFlush(win: BrowserWindow, wait = 2500): Promise<void> {
  const contents = win.webContents
  if (contents.isDestroyed() || contents.isCrashed() || contents.isLoading()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); ipcMain.removeListener("app:flushed", heard); resolve() }
    const heard = (event: Electron.IpcMainEvent) => { if (event.sender === contents) done() }
    const timer = setTimeout(done, wait)
    ipcMain.on("app:flushed", heard)
    contents.send("app:flush")
  })
}
let pending: ReturnType<typeof setTimeout> | null = null

/** The open project: its folders, and the file they are saved in (if any). */
let project: ProjectStore
const projectStateFile = (): string => path.join(app.getPath("userData"), "project.json")
let menuState: MenuState = initialMenuState
let lastMenu = ""

/**
 * The project's folders, watched (watcher.ts). One event per burst, and none for our own writes: a save used to
 * come back as a watcher event that re-read the tree, the note and the sidecar again, each of which wrote nothing
 * and cost a lot. A folder that is deleted underneath the app, or is not there at launch, is noticed (a watcher on
 * a deleted folder floods; one on a folder not yet plugged in never starts): see watcher.ts.
 */
const folderWatch = followFolders(nodePorts, {
  event: (root, name) => {
    // (what the tree knows of a file is kept until the watcher says it moved: see "Trusting the watcher" in notes.ts)
    if (name) fileChanged(path.join(root, name)); else forgetTrust()
    if (name && wroteRecently(path.join(root, name))) return
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      window?.webContents.send("notes:changed")
    }, 200)
  },
  covered: (folders) => setWatched(folders),
  // A folder went away or came back: the page's sidebar must say so (the "folder is not there" panel, the footer's
  // counts) and read the tree again.
  presence: () => { void tellFolders() },
})

function watchNotes(folders: string[]): void {
  // (a path from the other kind of machine is not a folder here: it is never watched, or `/Users/x` would be `C:\Users\x`)
  folderWatch.set(folders.filter((one) => !isForeignPath(one)))
}

/** The project's folders changed under the app: tell the page what is there now, and have it read the tree. */
async function tellFolders(): Promise<void> {
  forgetTrust()
  const info = await projectInfo(project)
  window?.webContents.send("project:changed", "folders", info)
  window?.webContents.send("notes:changed")
}

// MARK: - The pen (the tablet read by the app itself: main/pen/*). No window of its own, nothing hooked or clipped.

/** The pen subsystem: the manager over Wintab and the window pen. Built once, inside a try/catch (subsystem.ts). */
let pen: PenSubsystem | null = null
/** Evaluation cells' runner (main/eval): every child it started is killed on quit and when the window closes. */
let evalRunner: EvalRunner | null = null

// MARK: - The application menu

/** Commands that are the main process's own: dialogs and the project file. */
const MAIN_OWNED = new RegExp(`^(about|${PROJECT_COMMANDS.source.slice(2, -2)})$`)

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
  if (id === "about") {
    await dialog.showMessageBox(window!, {
      type: "info", title: "About WriteMind", message: "WriteMind", detail: `Version ${app.getVersion()}`,
    })
    return
  }
  await runProjectCommand(id, {
    project, window: () => window, home: notesRoot, documents: () => app.getPath("documents"),
    askOpen, askSave, changed: projectChanged,
  })
}

/**
 * The project changed (projectCommands.ts says how): the excluded folders are
 * handed to the tree reader, the watchers follow the folders, the state is
 * remembered, the menu is rebuilt, and the page is told — with what kind of
 * change it was, because another project means another session.
 */
async function projectChanged(kind: ProjectChange): Promise<void> {
  setExcluded(project.excluded)
  setProjectFolders(project.folders)
  watchNotes(project.folders)
  await project.remember(projectStateFile())
  rebuildMenu()
  window?.webContents.send("project:changed", kind, await projectInfo(project))
  if (kind !== "saved") window?.webContents.send("notes:changed")
}

/** The menu is rebuilt when its state changes, never on a timer. */
function rebuildMenu(): void {
  const template = buildMenu({
    platform: process.platform,
    state: menuState,
    project: {
      name: project.name,
      // The Mac says "edited" for an untitled project that has changed, too.
      edited: project.dirty,
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
  // The Mac's size (1280 x 800, never under 900 x 560) and the last place the window was.
  const placed = await windowPlacement()
  window = new BrowserWindow({
    width: placed.width,
    height: placed.height,
    ...(placed.x !== undefined && placed.y !== undefined ? { x: placed.x, y: placed.y } : {}),
    // WRITEMIND_OFFSCREEN: test instances open far outside the visible
    // desktop and never take focus, so a run of end-to-end scripts does not
    // flash over whatever the person is doing.
    ...(process.env.WRITEMIND_OFFSCREEN ? { x: -32000, y: -32000, focusable: true } : {}),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    // Sean never asked for a full-screen mode and does not want one: no chord,
    // no title-bar button and no menu item can put this window there.
    fullscreenable: false,
    title: "WriteMind",
    // The page's own background in whichever appearance the system is in, so
    // there is no dark flash before the first frame of a light desktop.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1f22" : "#ffffff",
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

  if (placed.maximized && !process.env.WRITEMIND_OFFSCREEN) window.maximize()
  rememberWindow(window)
  // A window that comes forward looks at the project's folders at once (a stick plugged in, a share back): the
  // timer would notice within a couple of seconds, this is for the person who is already looking.
  window.on("focus", () => { void folderWatch.look() })

  window.once("ready-to-show", () => {
    if (process.env.WRITEMIND_OFFSCREEN) window?.showInactive()
    else window?.show()
  })

  // NOTHING IN THIS APP GOES FULL SCREEN (fullscreenable: false above stops the
  // window and the OS's own chords; the page's Fullscreen API is refused by the
  // permission handler). Were a window ever to get there anyway, it is put back.
  window.on("enter-full-screen", () => { window?.setFullScreen(false) })
  closeApproved = false
  askedToFlush = false
  window.on("close", (event) => {
    if (closeApproved || !window || window.isDestroyed()) return
    event.preventDefault()
    if (askedToFlush) return
    askedToFlush = true
    const closing = window
    void askPageToFlush(closing).finally(() => {
      closeApproved = true
      askedToFlush = false
      if (!closing.isDestroyed()) closing.close()
    })
  })
  // The pen subsystem hears the window's own focus / visibility, and lets go when the window closes, its page dies or reloads.
  pen?.attachWindow()

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

// ONE WINDOW PER PROFILE. A second launch (a double-click on a shortcut that is already running) brings the
// first one forward instead of opening a second window on the same notes — two writers on one folder is the
// bug `mayWrite` exists for. The lock is per user-data folder, so a test instance never meets the real app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (process.env.WRITEMIND_OFFSCREEN) return
    // The process outlived its window (a helper window kept it): a second launch makes a new one instead of doing nothing.
    if (!window || window.isDestroyed()) { if (app.isReady()) void createWindow(); return }
    if (window.isMinimized()) window.restore()
    window.focus()
  })
}

app.whenReady().then(async () => {
  if (!gotLock) return
  // THE PROJECT first: the window's watcher and the sidebar's tree both read it.
  project = new ProjectStore(notesRoot())
  // The remembered project file is given three seconds: one on a share that is not reachable would hold the
  // window back for as long as the share takes to say so (half a minute), and the folders it was cached with
  // are there to start from.
  await project.restore(projectStateFile())
  setExcluded(project.excluded)
  setProjectFolders(project.folders)

  protocol.handle("wm", async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== "media") return new Response("not found", { status: 404 })
    const file = await findMedia(notesRoot(), decodeURIComponent(url.pathname.replace(/^\//, "")))
    // A Mac notebook's traced capture is a one-page PDF, which an <img> cannot draw: it goes out as the SVG of its paths.
    if (isPdfPicture(file)) {
      const picture = await readPdfPicture(file).catch(() => null)
      if (!picture) return new Response("not a picture this app can draw", { status: 415 })
      return new Response(picture.svg, { headers: { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" } })
    }
    const served = await net.fetch(pathToFileURL(file).href)
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

  // The OCR engine is asked about NOW, in the background, so that the first
  // `app:capabilities` does not wait for a PowerShell to start.
  void windowsOcr(here)
  ipcMain.handle("app:capabilities", async () => {
    const reader = await readerFor(here)
    return {
      // A CAPABILITY IS A FILE BEING THERE (or a probe that works):
      // `wm-vision` on macOS, Windows' own OCR engine on Windows,
      // `tesseract` anywhere. None is a dependency — with none
      // installed the app runs the same and simply does not offer to
      // read a picture.
      ...capabilitiesFor(process.platform, { ocr: reader.ocr, engine: reader.engine, japanese: reader.japanese }),
      platform: process.platform,
      root: notesRoot(),
    }
  })
  ipcMain.handle("notes:tree", () => projectTree(project.folders, notesRoot(), project.name))
  ipcMain.handle("note:duplicate", (_event, file: string) => duplicateNote(notesRoot(), file))
  ipcMain.handle("note:read", (_event, file: string) => readNote(file))
  ipcMain.handle("note:write", (_event, file: string, text: string) => writeNote(file, text))
  ipcMain.handle("note:create", (_event, folder: string) => createNote(folder))
  ipcMain.handle("note:rename", (_event, file: string, title: string) => renameNote(notesRoot(), file, title))
  ipcMain.handle("note:trash", async (_event, file: string) => { await shell.trashItem(file) })
  // Text that could not be written, kept where it can be come back to (rescue.ts).
  ipcMain.handle("note:rescue", (_event, file: string, text: string, kind?: "note" | "drawing") =>
    rescueUnsaved(app.getPath("userData"), file, text, kind === "drawing" ? "drawing" : "note"))
  ipcMain.handle("section:create", (_event, parent: string) => createSection(parent))
  ipcMain.handle("section:rename", (_event, folder: string, name: string) => renameSection(notesRoot(), folder, name))
  // A project folder is never put in the bin from the sidebar (the Mac offers it on nested sections only; the
  // right-click menu here already leaves it out), and nothing outside the project is the sidebar's to bin.
  // False says no and changes nothing.
  ipcMain.handle("section:trash", async (_event, folder: string): Promise<boolean> => {
    const here = path.resolve(folder).toLowerCase()
    const inside = project.folders.some((one) => here.startsWith(path.resolve(one).toLowerCase() + path.sep))
    if (isProjectFolder(folder, notesRoot()) || !inside) return false
    await shell.trashItem(folder)
    return true
  })
  ipcMain.handle("order:set", (_event, folder: string, names: string[]) =>
    reorder(notesRoot(), folder, names))
  ipcMain.handle("note:place", (_event, file: string, folder: string, before: string | null) =>
    placeNote(notesRoot(), file, folder, before))
  ipcMain.handle("section:move", (_event, folder: string, target: string) =>
    moveSection(notesRoot(), folder, target))
  // THE SESSION lives in the app's user-data folder, never beside the notes.
  // ONE SESSION PER PROJECT (ProjectSession): keyed by the project's file — null is
  // the untitled project — which the page names, so the last write of a project
  // that has just been left still lands in that project's file.
  ipcMain.handle("session:read", (_event, projectFile: string | null) =>
    readProjectSession(app.getPath("userData"), projectFile ?? null, notesRoot()))
  ipcMain.handle("session:write", (_event, projectFile: string | null, json: string) =>
    writeProjectSession(app.getPath("userData"), projectFile ?? null, json))
  ipcMain.handle("project:info", () => projectInfo(project))
  ipcMain.handle("path:reveal", (_event, target: string) => { shell.showItemInFolder(target) })
  ipcMain.handle("files:existing", (_event, files: string[]) => existing(files))
  ipcMain.handle("drawing:read",(_event, note: string) => readDrawing(notesRoot(), note))
  ipcMain.handle("drawing:write", (_event, note: string, json: string) =>
    writeDrawing(notesRoot(), note, json))
  // Open Notes Folder opens the project's PRIMARY folder (the Mac reveals `store.directory`), not always the app's own.
  ipcMain.handle("notes:reveal", () => shell.openPath(project.folders[0] ?? notesRoot()))
  ipcMain.handle("media:save", (_event, bytes: Uint8Array, extension: string, note?: string | null) =>
    saveMedia(notesRoot(), bytes, extension, note ?? null))
  // An ink cell's snapshot, `ink-<id>.svg` beside the note's other media (docs\PLAN-docking-ink-cells.md (f)).
  ipcMain.handle("media:inkSnapshot", (_event, note: string, id: string, svg: string, onlyIfMissing?: boolean) =>
    saveInkSnapshot(notesRoot(), note, id, svg, onlyIfMissing === true))
  /** The words in a picture, by whichever reader this machine has. */
  const ocr = ocrFor(here)
  ipcMain.handle("vision:read", async (_event, file: string) =>
    ocr.request({ id: `vision:${file}`, source: { file: await findMedia(notesRoot(), file) } }))
  // The picture reader as the capture paths use it: a note's picture by name
  // or the bytes of one that has not been saved (a capture's cut, the
  // tablet's sheet), cached by what is in it and taken back by `ocr:cancel`.
  ipcMain.handle("ocr:read", async (_event, request: {
    id: string; file?: string; bytes?: Uint8Array; languages?: string[]
  }) => {
    const languages = (request.languages ?? []).filter((tag) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag))
    const source = request.bytes
      ? { bytes: new Uint8Array(request.bytes) }
      : { file: await findMedia(notesRoot(), String(request.file ?? "")) }
    return ocr.request({ id: String(request.id), source, ...(languages.length > 0 ? { languages } : {}) })
  })
  ipcMain.handle("ocr:cancel", (_event, id: string) => { ocr.cancel(String(id)) })
  // Evaluation cells: run ONE cell on a press, take a run back, say where the tools are (main/eval).
  evalRunner = registerEval(ipcMain)
  // The tablet's sheets (tabs) and their ink: userData/sheets.json.
  registerSheets(ipcMain)
  /** What the reader is, what it can read, and how to add Japanese - for the diagnostics. */
  ipcMain.handle("ocr:status", async () => ({
    ...(await readerFor(here)), probe: await windowsOcr(here), addJapanese: ADD_JAPANESE_OCR, busy: ocr.busy, reads: ocr.started,
  }))

  ipcMain.handle("media:choose", async () => {
    if (!window) return null
    // askOpen: an end-to-end script names its answer ahead of time (WRITEMIND_E2E).
    const chosen = await askOpen(window, {
      properties: ["openFile"],
      filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "gif", "webp", "heic"] }],
    })
    if (chosen.canceled || chosen.filePaths.length === 0) return null
    const file = chosen.filePaths[0]!
    return { bytes: await fs.readFile(file), extension: path.extname(file) }
  })

  // The note on US Letter, the way the Mac prints it (exportPdf.ts).
  const printedPictures = async (request: ExportRequest) => {
    // The pictures are looked for in every project folder first (the printer asks for them synchronously).
    // (a Mac notebook's traced capture is a PDF: it is printed as the SVG of its paths, read here because the
    // printer asks for a picture's address synchronously)
    const drawn = new Map<string, string>()
    // The markdown's own pictures too (picture cells, ink cells' snapshots, inline pictures): found now, so the
    // printer's synchronous `mediaFile` knows where they are and a missing one prints as its one-line placeholder.
    // A docked traced capture (a .pdf picture cell) is drawn as its SVG too, as it is while floating and on screen.
    const names = new Set([...mediaFiles(request.markdown), ...(request.drawing ? pictureFiles(request.drawing) : [])])
    for (const name of names) {
      const file = await findMedia(notesRoot(), name)
      if (!isPdfPicture(file) || drawn.has(name)) continue
      const picture = await readPdfPicture(file).catch(() => null)
      if (picture) drawn.set(name, svgDataUrl(picture.svg))
    }
    return {
      mediaFile: (name: string) => mediaPath(notesRoot(), name),
      pictureUrl: (name: string) => drawn.get(name) ?? null,
    }
  }
  ipcMain.handle("export:pdf", async (_event, request: ExportRequest) =>
    exportNotePdf(request, { window, askSave, ...(await printedPictures(request)) }))
  // File ▸ Export… (exportFile.ts): one panel, PDF or Project chosen in it; null when no note is open.
  ipcMain.handle("export:file", async (_event, request: ExportRequest | null) =>
    exportFile(request, {
      window, askSave, documents: app.getPath("documents"),
      project: () => ({ name: project.name, project: project.project }),
      writePdf: async (file, note) => {
        const pictures = await printedPictures(note)
        await writeNotePdf(file, note, pictures.mediaFile, pictures.pictureUrl)
      },
      report: async (parent, message, detail) => { await dialog.showMessageBox(parent, { type: "warning", message, detail }) },
    }))

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
  // THE PEN: the tablet read by the app itself, only while the Tablet sheet is open and this window is in front.
  pen = startPenSubsystem({
    app, screen, ipc: ipcMain, powerMonitor, window: () => window, e2e: !!process.env.WRITEMIND_E2E,
    env: process.env, platform: process.platform,
    log: (line) => console.log(line),
  })
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
    // The shell's own cost: IPC counts and times, and a sampling profile (docs/PERF.md).
    installPerfProbe(ipcMain)
    // The window's OS-level facts, checked from outside: not the page's.
    ipcMain.handle("e2e:window", () => {
      const win = window!
      return {
        fullScreen: win.isFullScreen(), fullScreenable: win.isFullScreenable(), maximized: win.isMaximized(), bounds: win.getBounds(),
        content: win.getContentBounds(), menuBarVisible: win.isMenuBarVisible(),
        autoHideMenuBar: win.autoHideMenuBar,
        display: screen.getDisplayMatching(win.getBounds()).bounds,
        scale: screen.getDisplayMatching(win.getBounds()).scaleFactor,
      }
    })
    ipcMain.handle("e2e:setBounds", (_event, bounds: Electron.Rectangle) => { window?.setBounds(bounds); window?.moveTop() })
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

  // A NEW INSTALL opens on the quick reference (main/welcome.ts): written once, before the page reads the tree.
  if (welcomeWanted()) {
    await welcomeOnce(notesRoot(), project.folders).catch((error) => console.error("WriteMind: no quick reference", error))
  }
  // ...and its first open is on the rendered page: the page asks once which note was written now.
  ipcMain.handle("welcome:take", () => takeWelcomed())

  await createWindow()

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on("before-quit", () => { pen?.dispose(); evalRunner?.cancelAll(); void project?.remember(projectStateFile()) })
app.on("will-quit", () => { pen?.dispose(); evalRunner?.cancelAll() })

app.on("window-all-closed", () => {
  folderWatch.stop()
  evalRunner?.cancelAll()
  if (process.platform !== "darwin") app.quit()
})
