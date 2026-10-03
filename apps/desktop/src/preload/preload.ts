/**
 * The only bridge between the page and the machine. Everything the renderer
 * can do to a file is named here, once — no `nodeIntegration`, no `require`
 * in the page.
 */

import { contextBridge, ipcRenderer } from "electron"

const api = {
  capabilities: () => ipcRenderer.invoke("app:capabilities"),
  tree: () => ipcRenderer.invoke("notes:tree"),
  readNote: (file: string) => ipcRenderer.invoke("note:read", file),
  writeNote: (file: string, text: string) => ipcRenderer.invoke("note:write", file, text),
  createNote: (folder: string) => ipcRenderer.invoke("note:create", folder),
  renameNote: (file: string, title: string) => ipcRenderer.invoke("note:rename", file, title),
  trashNote: (file: string) => ipcRenderer.invoke("note:trash", file),
  createSection: (parent: string) => ipcRenderer.invoke("section:create", parent),
  trashSection: (folder: string) => ipcRenderer.invoke("section:trash", folder),
  setOrder: (folder: string, names: string[]) => ipcRenderer.invoke("order:set", folder, names),
  placeNote: (file: string, folder: string, before: string | null) =>
    ipcRenderer.invoke("note:place", file, folder, before),
  moveSection: (folder: string, target: string) => ipcRenderer.invoke("section:move", folder, target),
  readSession: () => ipcRenderer.invoke("session:read"),
  writeSession: (json: string) => ipcRenderer.invoke("session:write", json),
  existing: (files: string[]) => ipcRenderer.invoke("files:existing", files),
  readDrawing:(note: string) => ipcRenderer.invoke("drawing:read", note),
  writeDrawing: (note: string, json: string) => ipcRenderer.invoke("drawing:write", note, json),
  revealNotes: () => ipcRenderer.invoke("notes:reveal"),
  saveMedia: (bytes: Uint8Array, extension: string) =>
    ipcRenderer.invoke("media:save", bytes, extension),
  choosePicture: () => ipcRenderer.invoke("media:choose"),
  readPicture: (file: string) => ipcRenderer.invoke("vision:read", file),
  askForCamera: () => ipcRenderer.invoke("camera:ask"),
  exportPDF: (suggested: string) => ipcRenderer.invoke("export:pdf", suggested),
  duplicateNote: (file: string) => ipcRenderer.invoke("note:duplicate", file),
  /** What the application menu needs to know (a note open, the sidebar shown, ...). */
  setMenuState: (state: unknown) => ipcRenderer.invoke("menu:state", state),
  /** A key the page heard that the main process owns (a dialog, the project file). */
  runMain: (id: string) => ipcRenderer.invoke("menu:run", id),
  /** Cut, copy or paste through the shell (the page's right-click menu). */
  editNative: (command: "cut" | "copy" | "paste") => ipcRenderer.invoke("edit:native", command),
  /** A click on a menu item the page owns. */
  onMenuCommand: (listener: (id: string) => void) => {
    const wrapped = (_event: unknown, id: string) => listener(id)
    ipcRenderer.on("menu:command", wrapped)
    return () => ipcRenderer.removeListener("menu:command", wrapped)
  },
  /** Pad mode: full screen on the window's display, and back as it was. */
  padEnter: (): Promise<boolean> => ipcRenderer.invoke("pad:enter"),
  padExit: (): Promise<void> => ipcRenderer.invoke("pad:exit"),
  /** The shell's word that the pad began or ended (full screen can be lost without the pad's own Exit). */
  onPadState: (listener: (active: boolean) => void) => {
    const wrapped = (_event: unknown, active: boolean) => listener(active)
    ipcRenderer.on("pad:state", wrapped)
    return () => ipcRenderer.removeListener("pad:state", wrapped)
  },
  /** Where the window is on the desktop (content area, its display, the display's scale). */
  windowInfo: () => ipcRenderer.invoke("window:info"),
  /** End-to-end scripts only (WRITEMIND_E2E): read the menu bar and press an item. */
  ...(process.env.WRITEMIND_E2E ? {
    e2eMenu: () => ipcRenderer.invoke("e2e:menu"),
    e2eMenuClick: (id: string) => ipcRenderer.invoke("e2e:menuClick", id),
    e2ePick: (answer: string) => ipcRenderer.invoke("e2e:pick", answer),
    e2eWindow: () => ipcRenderer.invoke("e2e:window"),
    e2eSetBounds: (bounds: unknown) => ipcRenderer.invoke("e2e:setBounds", bounds),
    e2eLeaveFullScreen: () => ipcRenderer.invoke("e2e:leaveFullScreen"),
  } : {}),
  /** Edit ▸ Undo / Redo in the app's own menu. */
  onEdit: (listener: (which: "undo" | "redo") => void) => {
    const wrapped = (_event: unknown, which: "undo" | "redo") => listener(which)
    ipcRenderer.on("edit:history", wrapped)
    return () => ipcRenderer.removeListener("edit:history", wrapped)
  },
  onNotesChanged: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on("notes:changed", wrapped)
    return () => ipcRenderer.removeListener("notes:changed", wrapped)
  },
}

contextBridge.exposeInMainWorld("wm", api)

export type WriteMindAPI = typeof api
