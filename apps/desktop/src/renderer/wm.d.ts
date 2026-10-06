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
      readNote(file: string): Promise<string>
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
        ocr: boolean; engine: import("@writemind/core").OcrEngine | null; japanese: boolean
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
      } | null): Promise<{ format: import("@writemind/core").ExportFormat; file: string } | null>
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
      /** The tablet pen's native feed (shared/pen.ts PenApi); present on every platform, `available: false` off Windows. */
      pen: import("../shared/pen").PenApi
      /** The quick reference written at this launch (a new install), once, else null (main/welcome.ts); absent in an old preload. */
      welcomed?(): Promise<string | null>
      /** The "your notes stay in WriteMindCross" notice, once, else null (main/notesFolderMove.ts); absent in an old preload. */
      notesFolderNotice?(): Promise<string | null>
      /** The tablet's sheets (tabs), as text (renderer/sheetSet.ts), kept in userData/sheets.json; absent in an old preload. */
      sheets?: { load(): Promise<string | null>; save(text: string): void }
      /** Evaluation cells (shared/eval.ts): run one cell on Shift+Enter, take a run back, where the tools are. */
      evaluate: import("../shared/eval").EvalApi
      /** Updates (shared/update.ts): the "Updates available" dialog (UpdateDialog.tsx); absent in an old preload. */
      update?: import("../shared/update").UpdateApi
      onNotesChanged(listener: () => void): () => void
      onFlushRequest(listener: () => Promise<void> | void): () => void
      onEdit(listener: (which: "undo" | "redo") => void): () => void
    }
  }
}
