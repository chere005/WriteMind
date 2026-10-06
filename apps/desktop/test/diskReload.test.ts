import { describe, expect, it } from "vitest"
import { reloadFromDisk, type DiskReloadHost } from "../src/renderer/diskReload"

/**
 * The open note read again after the folder watcher fired (App.tsx's onNotesChanged): an edit in hand is never
 * replaced by the copy on disk, including one made WHILE the read runs (CI on 1b9010a: words typed, or a stroke
 * drawn, during the await were lost), and a note opened meanwhile is not given the old note's words or drawing.
 */

interface Page {
  open: string | null
  text: string
  wordsDirty: boolean
  drawingDirty: boolean
  drawing: string | null
  /** Run while a read is in flight (the person typing, drawing, opening another note). */
  duringNote?: () => void
  duringDrawing?: () => void
}

function hostOf(page: Page, disk: { note: string; drawing: string }, set?: { documents: number }): DiskReloadHost<string> {
  return {
    open: () => page.open,
    text: () => page.text,
    wordsDirty: () => page.wordsDirty,
    drawingDirty: () => page.drawingDirty,
    readNote: async () => { page.duringNote?.(); return disk.note },
    readDrawing: async () => { page.duringDrawing?.(); return disk.drawing },
    setDocument: (text) => { page.text = text; if (set) set.documents++ },
    setDrawing: (sidecar) => { page.drawing = sidecar },
  }
}

const clean = (): Page => ({ open: "a.md", text: "old", wordsDirty: false, drawingDirty: false, drawing: "old ink" })
const disk = { note: "from disk", drawing: "disk ink" }

describe("reading the open note again after a change on disk", () => {
  it("a clean note takes the file's words and drawing", async () => {
    const page = clean()
    await reloadFromDisk(hostOf(page, disk))
    expect(page).toMatchObject({ text: "from disk", drawing: "disk ink" })
  })

  it("an edit already in hand keeps both", async () => {
    const page = { ...clean(), wordsDirty: true }
    await reloadFromDisk(hostOf(page, disk))
    expect(page).toMatchObject({ text: "old", drawing: "old ink" })
    const drawn = { ...clean(), drawingDirty: true }
    await reloadFromDisk(hostOf(drawn, disk))
    expect(drawn).toMatchObject({ text: "from disk", drawing: "old ink" })
  })

  it("words typed while the note is read are kept", async () => {
    const page = clean()
    page.duringNote = () => { page.text = "old and new"; page.wordsDirty = true }
    await reloadFromDisk(hostOf(page, disk))
    expect(page.text).toBe("old and new")
    expect(page.drawing).toBe("old ink")
  })

  it("a stroke drawn while the sidecar is read is kept", async () => {
    const page = clean()
    page.duringDrawing = () => { page.drawing = "old ink + stroke"; page.drawingDirty = true }
    await reloadFromDisk(hostOf(page, disk))
    expect(page).toMatchObject({ text: "from disk", drawing: "old ink + stroke" })
  })

  it("a note opened while a read runs is not given the old note's words or drawing", async () => {
    const page = clean()
    page.duringNote = () => { page.open = "b.md"; page.text = "b words"; page.drawing = "b ink" }
    await reloadFromDisk(hostOf(page, disk))
    expect(page).toMatchObject({ text: "b words", drawing: "b ink" })
    // ...and while the sidecar is read (openNote names the new note before its words go on the page)
    const early = clean()
    early.duringDrawing = () => { early.open = "b.md"; early.text = "b words"; early.drawing = "b ink" }
    await reloadFromDisk(hostOf(early, disk))
    expect(early).toMatchObject({ open: "b.md", text: "b words", drawing: "b ink" })
  })

  it("a note opened meanwhile with the SAME words as the old one is not given the old one's words or drawing", async () => {
    // (The words alone cannot tell the two apart: only the open note can.)
    const words = clean()
    words.duringNote = () => { words.open = "b.md"; words.drawing = "b ink" }
    const set = { documents: 0 }
    await reloadFromDisk(hostOf(words, disk, set))
    expect(words).toMatchObject({ open: "b.md", text: "old", drawing: "b ink" })
    expect(set.documents).toBe(0)
    const ink = clean()
    ink.duringDrawing = () => { ink.open = "b.md"; ink.drawing = "b ink" }
    await reloadFromDisk(hostOf(ink, disk))
    expect(ink).toMatchObject({ open: "b.md", text: "from disk", drawing: "b ink" })
  })

  it("a CRLF note takes a new sidecar, and its unchanged words are not put on the page again", async () => {
    // The file has "\r\n", the editor gives its words back with "\n": the same words, not an edit.
    const page = { ...clean(), text: "line one\nline two" }
    const set = { documents: 0 }
    await reloadFromDisk(hostOf(page, { note: "line one\r\nline two", drawing: "new ink" }, set))
    expect(page).toMatchObject({ text: "line one\nline two", drawing: "new ink" })
    expect(set.documents).toBe(0)
    // ...and the same while the read runs: the page's words turning from "\r\n" to "\n" is not typing.
    const turning = { ...clean(), text: "line one\r\nline two" }
    turning.duringNote = () => { turning.text = "line one\nline two" }
    turning.duringDrawing = () => { turning.text = "line one\nline two\nline three" }
    await reloadFromDisk(hostOf(turning, { note: "line one\r\nline two\r\nline three", drawing: "new ink" }))
    expect(turning).toMatchObject({ text: "line one\nline two\nline three", drawing: "new ink" })
  })
})
