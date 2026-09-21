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
      readDrawing(note: string): Promise<string | null>
      writeDrawing(note: string, json: string): Promise<void>
      revealNotes(): Promise<string>
      exportPDF(suggested: string): Promise<string | null>
      onNotesChanged(listener: () => void): () => void
    }
  }
}
