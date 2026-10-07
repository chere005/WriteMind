/**
 * The only bridge between the page and the machine. Everything the renderer
 * can do to a file is named here, once — no `nodeIntegration`, no `require`
 * in the page.
 */

import { contextBridge, ipcRenderer } from "electron"
import { PEN_CHANNELS, type PenApi } from "../shared/pen"
import { EVAL_CHANNELS, type EvalApi } from "../shared/eval"
import { UPDATE_CHANNELS, type UpdateApi } from "../shared/update"
import { LANGUAGE_CHANNELS, type LanguagesApi } from "../shared/languages"
import { ABOUT_CHANNELS, type AboutApi } from "../shared/about"

/** window.wm.pen: the tablet pen's feed (shared/pen.ts PenApi; every channel name is spelled once there). The E2E hooks exist only under WRITEMIND_E2E. */
const listen = <T>(channel: string, listener: (payload: T) => void): (() => void) => {
  const wrapped = (_event: unknown, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => { ipcRenderer.removeListener(channel, wrapped) }
}
const pen: PenApi = {
  open: () => ipcRenderer.invoke(PEN_CHANNELS.open),
  close: (reason) => ipcRenderer.invoke(PEN_CHANNELS.close, reason),
  status: () => ipcRenderer.invoke(PEN_CHANNELS.status),
  settings: () => ipcRenderer.invoke(PEN_CHANNELS.settings),
  setSettings: (patch) => ipcRenderer.invoke(PEN_CHANNELS.setSettings, patch),
  panic: (reason) => ipcRenderer.send(PEN_CHANNELS.panic, reason),
  sheet: (report) => ipcRenderer.send(PEN_CHANNELS.sheet, report),
  retryMapping: () => ipcRenderer.invoke(PEN_CHANNELS.mappingRetry),
  onSamples: (listener) => listen(PEN_CHANNELS.samples, listener),
  onStatus: (listener) => listen(PEN_CHANNELS.statusPush, listener),
  onEvent: (listener) => listen(PEN_CHANNELS.event, listener),
  ...(process.env.WRITEMIND_E2E ? {
    e2e: {
      inject: (samples, backend) => ipcRenderer.invoke(PEN_CHANNELS.e2eInject, { samples, backend }),
      state: () => ipcRenderer.invoke(PEN_CHANNELS.e2eState),
      config: (c) => ipcRenderer.invoke(PEN_CHANNELS.e2eConfig, c),
    },
  } : {}),
}

/** window.wm.update: the "Updates available" dialog's state and answers (shared/update.ts, main/updater.ts). */
const update: UpdateApi = {
  status: () => ipcRenderer.invoke(UPDATE_CHANNELS.status),
  view: () => ipcRenderer.invoke(UPDATE_CHANNELS.view),
  answer: (choice) => ipcRenderer.invoke(UPDATE_CHANNELS.answer, choice),
  setCheckOnStartup: (on) => ipcRenderer.invoke(UPDATE_CHANNELS.setCheckOnStartup, on),
  onView: (listener) => listen(UPDATE_CHANNELS.viewPush, listener),
}

const api = {
  update,
  capabilities: () => ipcRenderer.invoke("app:capabilities"),
  tree: () => ipcRenderer.invoke("notes:tree"),
  readNote: (file: string) => ipcRenderer.invoke("note:read", file),
  writeNote: (file: string, text: string) => ipcRenderer.invoke("note:write", file, text),
  createNote: (folder: string) => ipcRenderer.invoke("note:create", folder),
  renameNote: (file: string, title: string) => ipcRenderer.invoke("note:rename", file, title),
  trashNote: (file: string) => ipcRenderer.invoke("note:trash", file),
  /** File ▸ Clean Up Unused Files… (main/housekeeping.ts). */
  findUnused: (held: unknown) => ipcRenderer.invoke("housekeeping:scan", held),
  trashUnused: (paths: string[], held: unknown) => ipcRenderer.invoke("housekeeping:trash", paths, held),
  /** Text that could not be written, put where it can be come back to; resolves to the file. */
  rescue: (file: string, text: string, kind: "note" | "drawing" = "note"): Promise<string> =>
    ipcRenderer.invoke("note:rescue", file, text, kind),
  createSection: (parent: string) => ipcRenderer.invoke("section:create", parent),
  trashSection: (folder: string) => ipcRenderer.invoke("section:trash", folder),
  renameSection: (folder: string, name: string) => ipcRenderer.invoke("section:rename", folder, name),
  setOrder: (folder: string, names: string[]) => ipcRenderer.invoke("order:set", folder, names),
  placeNote: (file: string, folder: string, before: string | null) =>
    ipcRenderer.invoke("note:place", file, folder, before),
  moveSection: (folder: string, target: string) => ipcRenderer.invoke("section:move", folder, target),
  readSession: (projectFile: string | null) => ipcRenderer.invoke("session:read", projectFile),
  writeSession: (projectFile: string | null, json: string) => ipcRenderer.invoke("session:write", projectFile, json),
  /** The open project (name, file, folders, hidden folders) and the word that it changed. */
  project: () => ipcRenderer.invoke("project:info"),
  onProject: (listener: (kind: "switch" | "folders" | "saved", info: unknown) => void) => {
    const wrapped = (_event: unknown, kind: "switch" | "folders" | "saved", info: unknown) => listener(kind, info)
    ipcRenderer.on("project:changed", wrapped)
    return () => ipcRenderer.removeListener("project:changed", wrapped)
  },
  /** Show a file or folder in Explorer / Finder. */
  reveal: (target: string) => ipcRenderer.invoke("path:reveal", target),
  existing: (files: string[]) => ipcRenderer.invoke("files:existing", files),
  readDrawing:(note: string) => ipcRenderer.invoke("drawing:read", note),
  writeDrawing: (note: string, json: string) => ipcRenderer.invoke("drawing:write", note, json),
  revealNotes: () => ipcRenderer.invoke("notes:reveal"),
  /** The picture goes in the project folder of `note` (else of the note in front). */
  saveMedia: (bytes: Uint8Array, extension: string, note?: string | null) =>
    ipcRenderer.invoke("media:save", bytes, extension, note ?? null),
  /** An ink cell's snapshot `ink-<id>.svg`, in the media folder of `note`'s project folder (written over in place). */
  writeInkSnapshot: (note: string, id: string, svg: string, onlyIfMissing?: boolean) =>
    ipcRenderer.invoke("media:inkSnapshot", note, id, svg, onlyIfMissing === true),
  choosePicture: () => ipcRenderer.invoke("media:choose"),
  readPicture: (file: string) => ipcRenderer.invoke("vision:read", file),
  /** The words in a picture (a note's file by name, or the bytes of one), boxed and cached; `ocrCancel(id)` takes the request back. */
  ocrRead: (request: { id: string; file?: string; bytes?: Uint8Array; languages?: string[] }) =>
    ipcRenderer.invoke("ocr:read", request),
  ocrCancel: (id: string) => ipcRenderer.invoke("ocr:cancel", id),
  ocrStatus: () => ipcRenderer.invoke("ocr:status"),
  askForCamera: () => ipcRenderer.invoke("camera:ask"),
  exportPDF: (request: unknown) => ipcRenderer.invoke("export:pdf", request),
  /** File ▸ Export…: one save panel, PDF, Wolfram Notebook or Project chosen in it; null when no note is open (project only). */
  exportFile: (request: unknown) => ipcRenderer.invoke("export:file", request),
  /**
   * Held cells with a drawing cell among them were copied: the shell writes the clipboard again for Mathematica, in
   * the background (main/wolfram/clipboard.ts). Nothing comes back.
   */
  wolframCopy: (copy: unknown) => ipcRenderer.send("wolfram:copy", copy),
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
  /** The tablet pen's native feed (main/pen/*): see PenApi in shared/pen.ts. */
  pen,
  /** The quick reference written at this launch (a new install), once; null otherwise (main/welcome.ts). */
  welcomed: (): Promise<string | null> => ipcRenderer.invoke("welcome:take"),
  /** "Your notes stay in Documents\WriteMindCross…" once, when both notes folders are there; else null (main/notesFolderMove.ts). */
  notesFolderNotice: (): Promise<string | null> => ipcRenderer.invoke("notesFolder:notice"),
  /** The tablet's sheets (tabs) and their ink, kept in userData/sheets.json (main/sheets.ts). */
  sheets: {
    load: (): Promise<string | null> => ipcRenderer.invoke("sheets:load"),
    save: (text: string): void => ipcRenderer.send("sheets:save", text),
  },
  /** The document camera's scanned pages (tabs), kept in userData/scans.json and userData/scans/<id>.jpg (main/scans.ts). */
  scans: {
    load: (): Promise<string | null> => ipcRenderer.invoke("scans:load"),
    save: (text: string): void => ipcRenderer.send("scans:save", text),
    put: (id: string, bytes: Uint8Array): Promise<boolean> => ipcRenderer.invoke("scans:put", id, bytes),
    get: (id: string): Promise<Uint8Array | null> => ipcRenderer.invoke("scans:get", id),
    drop: (id: string): void => ipcRenderer.send("scans:drop", id),
    sweep: (keep: string[]): void => ipcRenderer.send("scans:sweep", keep),
  },
  /** Evaluation cells (shared/eval.ts): run ONE cell, on Shift+Enter in it, and nothing else. */
  evaluate: {
    run: (request) => ipcRenderer.invoke(EVAL_CHANNELS.run, request),
    cancel: (id) => ipcRenderer.invoke(EVAL_CHANNELS.cancel, id),
    tools: () => ipcRenderer.invoke(EVAL_CHANNELS.tools),
  } satisfies EvalApi,
  /**
   * File ▸ Language Setup… (shared/languages.ts): what each language runs with, and choosing it. The page names a
   * language, never a program to start: the picker, the checks and the probe are all the main process's.
   */
  languages: {
    report: () => ipcRenderer.invoke(LANGUAGE_CHANNELS.report),
    choose: (evaluator) => ipcRenderer.invoke(LANGUAGE_CHANNELS.choose, evaluator),
    use: (evaluator, file) => ipcRenderer.invoke(LANGUAGE_CHANNELS.use, evaluator, file),
    automatic: (evaluator) => ipcRenderer.invoke(LANGUAGE_CHANNELS.automatic, evaluator),
    test: (evaluator) => ipcRenderer.invoke(LANGUAGE_CHANNELS.test, evaluator),
    cancel: (evaluator) => ipcRenderer.invoke(LANGUAGE_CHANNELS.cancel, evaluator),
    setup: (action) => ipcRenderer.invoke(LANGUAGE_CHANNELS.setup, action),
    open: (link) => ipcRenderer.invoke(LANGUAGE_CHANNELS.open, link),
    onChanged: (listener) => listen(LANGUAGE_CHANNELS.changed, listener),
  } satisfies LanguagesApi,
  /** Help ▸ About WriteMind (shared/about.ts): the licence, the Wolfram statement and each library's licence; the project page. */
  about: {
    info: () => ipcRenderer.invoke(ABOUT_CHANNELS.info),
    openProject: () => ipcRenderer.invoke(ABOUT_CHANNELS.openProject),
  } satisfies AboutApi,
  /** End-to-end scripts only (WRITEMIND_E2E): read the menu bar and press an item. */
  ...(process.env.WRITEMIND_E2E ? {
    e2eMenu: () => ipcRenderer.invoke("e2e:menu"),
    e2eMenuClick: (id: string) => ipcRenderer.invoke("e2e:menuClick", id),
    e2ePick: (answer: string) => ipcRenderer.invoke("e2e:pick", answer),
    e2eWindow: () => ipcRenderer.invoke("e2e:window"),
    e2ePerf: (command: string, arg?: unknown) => ipcRenderer.invoke("e2e:perf", command, arg),
    e2eSetBounds: (bounds: unknown) => ipcRenderer.invoke("e2e:setBounds", bounds),
    e2eTold: () => ipcRenderer.invoke("e2e:told"),
    e2eClipboard: (command: "read" | "save" | "restore") => ipcRenderer.invoke("e2e:clipboard", command),
  } : {}),
  /** Edit ▸ Undo / Redo in the app's own menu. */
  onEdit: (listener: (which: "undo" | "redo") => void) => {
    const wrapped = (_event: unknown, which: "undo" | "redo") => listener(which)
    ipcRenderer.on("edit:history", wrapped)
    return () => ipcRenderer.removeListener("edit:history", wrapped)
  },
  /**
   * The window is closing and wants what the page is holding written first (the quit handshake, main.ts): the
   * listener's promise is waited for, then the shell is told.
   */
  onFlushRequest: (listener: () => Promise<void> | void) => {
    const wrapped = async () => {
      try { await listener() } finally { ipcRenderer.send("app:flushed") }
    }
    ipcRenderer.on("app:flush", wrapped)
    return () => ipcRenderer.removeListener("app:flush", wrapped)
  },
  onNotesChanged: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on("notes:changed", wrapped)
    return () => ipcRenderer.removeListener("notes:changed", wrapped)
  },
}

contextBridge.exposeInMainWorld("wm", api)

export type WriteMindAPI = typeof api
