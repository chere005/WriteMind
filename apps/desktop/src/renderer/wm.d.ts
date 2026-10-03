import type { Capabilities, Note } from "@writemind/core"

export interface Section {
  path: string
  name: string
  depth: number
  notes: Note[]
  sections: Section[]
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
      createSection(parent: string): Promise<string>
      trashSection(folder: string): Promise<void>
      setOrder(folder: string, names: string[]): Promise<void>
      placeNote(file: string, folder: string, before: string | null): Promise<string>
      moveSection(folder: string, target: string): Promise<string | null>
      readSession(): Promise<string | null>
      writeSession(json: string): Promise<void>
      existing(files: string[]): Promise<string[]>
      readDrawing(note: string): Promise<string | null>
      writeDrawing(note: string, json: string): Promise<void>
      revealNotes(): Promise<string>
      saveMedia(bytes: Uint8Array, extension: string): Promise<{ file: string }>
      choosePicture(): Promise<{ bytes: Uint8Array; extension: string } | null>
      readPicture(file: string): Promise<{ lines: { text: string; confidence: number }[] }>
      askForCamera(): Promise<boolean>
      exportPDF(suggested: string): Promise<string | null>
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
      e2eLeaveFullScreen?(): Promise<void>
      padEnter(): Promise<boolean>
      padExit(): Promise<void>
      onPadState(listener: (active: boolean) => void): () => void
      windowInfo?(): Promise<import("./padGeometry").DisplayInfo | null>
      onNotesChanged(listener: () => void): () => void
      onEdit(listener: (which: "undo" | "redo") => void): () => void
    }
  }
}
