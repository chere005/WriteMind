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
  readDrawing: (note: string) => ipcRenderer.invoke("drawing:read", note),
  writeDrawing: (note: string, json: string) => ipcRenderer.invoke("drawing:write", note, json),
  revealNotes: () => ipcRenderer.invoke("notes:reveal"),
  saveMedia: (bytes: Uint8Array, extension: string) =>
    ipcRenderer.invoke("media:save", bytes, extension),
  choosePicture: () => ipcRenderer.invoke("media:choose"),
  readPicture: (file: string) => ipcRenderer.invoke("vision:read", file),
  askForCamera: () => ipcRenderer.invoke("camera:ask"),
  exportPDF: (suggested: string) => ipcRenderer.invoke("export:pdf", suggested),
  onNotesChanged: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on("notes:changed", wrapped)
    return () => ipcRenderer.removeListener("notes:changed", wrapped)
  },
}

contextBridge.exposeInMainWorld("wm", api)

export type WriteMindAPI = typeof api
