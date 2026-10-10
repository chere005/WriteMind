import type { Capabilities, Note } from "@writemind/core"

export interface Section {
  path: string
  name: string
  depth: number
  notes: Note[]
  sections: Section[]
}

/** The open project, as the main process describes it (projectCommands.ts). */
export interface ProjectInfo {
  name: string
  file: string | null
  edited: boolean
  folders: { path: string; name: string; exists: boolean }[]
  excluded: { path: string; name: string; exists: boolean }[]
}

export interface Platform extends Capabilities {
  platform: string
  root: string
}

declare global {
  interface Window {
    wm: {
      capabilities(): Promise<Platform>
      tree(): Promise<Section>
      /** The sidebar's search (main/notesSearch.ts): every note of the project, best first; `id` names it for `cancelSearch`. */
      searchNotes(id: number, query: string): Promise<import("../shared/search").SearchOutcome>
      cancelSearch(id: number): Promise<void>
      readNote(file: string): Promise<string>
      /** The file's words and drawing as they are now, WITHOUT the app taking that state as its own (the watcher's look); `adoptNote` takes it. */
      peekNote(file: string): Promise<{ text: string; drawing: string | null; token: string }>
      adoptNote(file: string, token: string): Promise<boolean>
      noteInfo(file: string): Promise<{ readOnly: boolean; version: number; newer: boolean; why: string | null }>
      writeNote(file: string, text: string): Promise<{ written: boolean; onDisk: string | null }>
      createNote(folder: string): Promise<string>
      renameNote(file: string, title: string): Promise<string>
      trashNote(file: string): Promise<void>
      /** File ▸ Clean Up Unused Files… (main/housekeeping.ts): what is unused, and the bin for what was said yes to. */
      findUnused(held: import("../shared/housekeeping").Held): Promise<import("../shared/housekeeping").UnusedScan>
      trashUnused(paths: string[], held: import("../shared/housekeeping").Held): Promise<import("../shared/housekeeping").TrashResult>
      rescue(file: string, text: string, kind?: "note" | "drawing"): Promise<string>
      createSection(parent: string): Promise<string>
      /** False: the folder is a project folder (or not in the project), nothing was put in the bin. */
      trashSection(folder: string): Promise<boolean>
      renameSection(folder: string, name: string): Promise<string | null>
      setOrder(folder: string, names: string[]): Promise<void>
      placeNote(file: string, folder: string, before: string | null): Promise<string>
      moveSection(folder: string, target: string): Promise<string | null>
      readSession(projectFile: string | null): Promise<string | null>
      writeSession(projectFile: string | null, json: string): Promise<void>
      project(): Promise<ProjectInfo>
      onProject(listener: (kind: "switch" | "folders" | "saved", info: ProjectInfo) => void): () => void
      reveal(target: string): Promise<void>
      existing(files: string[]): Promise<string[]>
      readDrawing(note: string): Promise<string | null>
      writeDrawing(note: string, json: string): Promise<void>
      revealNotes(): Promise<string>
      saveMedia(bytes: Uint8Array, extension: string, note?: string | null): Promise<{ file: string }>
      /** An ink cell's snapshot `ink-<id>.svg` (docs\PLAN-docking-ink-cells.md (f)); `onlyIfMissing` keeps one that is there. */
      writeInkSnapshot(note: string, id: string, svg: string, onlyIfMissing?: boolean): Promise<{ file: string }>
      choosePicture(): Promise<{ bytes: Uint8Array; extension: string } | null>
      readPicture(file: string): Promise<import("@writemind/core").OcrReading>
      ocrRead(request: { id: string; file?: string; bytes?: Uint8Array; languages?: string[] }): Promise<import("@writemind/core").OcrReading>
      ocrCancel(id: string): Promise<void>
      ocrStatus(): Promise<{
        ocr: boolean; engine: "vision" | "windows" | "tesseract" | null; japanese: boolean
        probe: { ok: boolean; installed: string[]; profile: string | null; japanese: boolean; addJapanese: string; reason?: string }
        addJapanese: string; busy: number; reads: number
      }>
      askForCamera(): Promise<boolean>
      exportPDF(request: {
        noteFile: string; title: string; markdown: string; drawing: string | null
        pane: { width: number; height: number }
      }): Promise<string | null>
      exportFile(request: {
        noteFile: string; title: string; markdown: string; drawing: string | null
        pane: { width: number; height: number }
        /** The drawings as the page measured them, for a Wolfram notebook (wolframMedia.ts). */
        wolfram?: import("@writemind/core").WolframMedia
      } | null): Promise<{ format: import("@writemind/core").ExportFormat; file: string } | null>
      /** Held cells with a drawing cell among them were copied (main/wolfram/clipboard.ts); absent in an old preload. */
      wolframCopy?(copy: {
        plain: string; markdown: string; media: import("@writemind/core").WolframMedia; noteFile: string | null
        /** Copy Cell: the one drawing is also an SVG file for the other apps (and no PNG). */
        cell?: boolean
      }): void
      duplicateNote(file: string): Promise<string>
      setMenuState(state: import("../shared/commands").MenuState): Promise<void>
      runMain(id: string): Promise<void>
      editNative(command: "cut" | "copy" | "paste"): Promise<void>
      onMenuCommand(listener: (id: string) => void): () => void
      e2eMenu?(): Promise<unknown>
      e2eMenuClick?(id: string): Promise<boolean>
      e2ePick?(answer: string): Promise<void>
      e2eWindow?(): Promise<unknown>
      e2eSetBounds?(bounds: unknown): Promise<void>
      e2eTold?(): Promise<{ message: string; detail: string }[]>
      e2eClipboard?(command: "read" | "save" | "restore"): Promise<Record<string, string> | boolean>
      /** The tablet pen's native feed (shared/pen.ts PenApi); present on every platform, `available: false` off Windows. */
      pen: import("../shared/pen").PenApi
      /** Where the Quick Reference is (or will be) in the notes root (main/welcome.ts); absent in an old preload. */
      quickReferencePath?(): Promise<string>
      /** Help ▸ Quick Reference: written if missing, rewritten if out of date; its path (main/welcome.ts); absent in an old preload. */
      quickReference?(): Promise<string>
      /** The "your notes stay in WriteMindCross" notice, once, else null (main/notesFolderMove.ts); absent in an old preload. */
      notesFolderNotice?(): Promise<string | null>
      /** What the conversion of the old .md notes did at this launch, once (main/convert.ts); null when it did nothing. */
      conversionNotice?(): Promise<string | null>
      takeOpenFiles?(): Promise<string[]>
      onOpenPending?(listener: () => void): () => void
      openFile?(file: string): Promise<void>
      pathOfFile?(file: File): string
      onConversionNotice?(listener: (text: string) => void): () => void
      /** The tablet's sheets (tabs), as text (renderer/sheetSet.ts), kept in userData/sheets.json; absent in an old preload. */
      sheets?: { load(): Promise<string | null>; save(text: string): void }
      /** The document camera's scanned pages (renderer/scanSet.ts), kept in userData/scans.json and scans/<id>.jpg; absent in an old preload. */
      scans?: {
        load(): Promise<string | null>; save(text: string): void
        put(id: string, bytes: Uint8Array): Promise<boolean>; get(id: string): Promise<Uint8Array | null>
        drop(id: string): void; sweep(keep: string[]): void
      }
      /** Evaluation cells (shared/eval.ts): run one cell on Shift+Enter, take a run back, where the tools are. */
      evaluate: import("../shared/eval").EvalApi
      /** Updates (shared/update.ts): the "Updates available" dialog (UpdateDialog.tsx); absent in an old preload. */
      update?: import("../shared/update").UpdateApi
      /** File ▸ Language Setup… (shared/languages.ts, LanguageSetupDialog.tsx); absent in an old preload. */
      languages?: import("../shared/languages").LanguagesApi
      /** Help ▸ About WriteMind (shared/about.ts, AboutDialog.tsx); absent in an old preload. */
      about?: import("../shared/about").AboutApi
      /** The undo journal of file steps (main/undoJournal.ts, docs/PLAN-undo.md). */
      undo: {
        state(): Promise<import("../shared/undo").UndoState>
        run(which: "undo" | "redo"): Promise<import("../shared/undo").UndoOutcome>
        cutRedo(): Promise<void>
        onChanged(listener: (state: import("../shared/undo").UndoState) => void): () => void
      }
      onNotesChanged(listener: () => void): () => void
      onFlushRequest(listener: () => Promise<void> | void): () => void
      onEdit(listener: (which: "undo" | "redo") => void): () => void
    }
  }
}
