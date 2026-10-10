// The note store's fixes after three adversarial reviews (main/wmStore.ts, main/notes.ts, renderer/diskReload.ts): a note
// that is gone is not made again by a save, a look at the file is not a take-over, a picture copied between notes comes with
// the note it lands in, an ink snapshot is never given a twin that differs by case, a duplicate is of the file as it is.
// Every test was seen to fail against the code it was written for.
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { reloadFromDisk, type DiskReloadHost } from "../src/renderer/diskReload"
import { duplicateNote, saveMedia } from "../src/main/notes"
import {
  adoptNote, commit, createFile, frontNote, loadNote, mediaBytes, movedNote, newNoteFile, noteState, peekNote, readDrawingText, readText,
  setFront, writeDrawingText, writeMedia, writeSnapshot, writeText,
} from "../src/main/wmStore"
import { readWm, writeWm } from "./wmFiles"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-fixes-"))
const PNG = "0123456789abcdef.png"
const UPPER = "3F2B8C1E-0A4D-4E6F-9B1A-7C5D2E8F1A90"
const image = (file: string, id = "i1") => ({ kind: "image", id, file, center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 1, transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, hidden: false, group: null })

describe("4. a note that is gone is not made again by a save of what the page still holds", () => {
  it("an open note trashed or renamed outside, then read by the watcher: the autosave is refused as gone and writes nothing", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "mine", { drawing: JSON.stringify({ items: [] }), entries: { "media/a.png": "x" } })
    await readText(file)
    renameSync(file, path.join(dir, "Renamed elsewhere.wm"))
    // (the folder watcher says something moved: the page reads the open note again)
    await expect(readText(file)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await writeText(file, "typed since")).toMatchObject({ written: false, refused: "gone" })
    await expect(writeDrawingText(file, JSON.stringify({ items: [image("a.png")] }))).rejects.toThrow(/not there any more/)
    expect(readdirSync(dir)).toEqual(["Renamed elsewhere.wm"])
    // A NEW note at that name (the sidebar's gesture) is what makes it writable again.
    await createFile(file, newNoteFile("fresh"))
    expect((await writeText(file, "fresh and typed")).written).toBe(true)
    expect(readWm(file).text).toBe("fresh and typed")
  })

  it("the name a note was moved away from (renameNote, a drag in the sidebar) is a tombstone too", async () => {
    const dir = scratch()
    const from = writeWm(path.join(dir, "Old.wm"), "words")
    const to = path.join(dir, "New.wm")
    await readText(from)
    renameSync(from, to)
    movedNote(from, to)
    expect(await writeText(from, "a save the page still had in flight")).toMatchObject({ written: false, refused: "gone" })
    expect(readdirSync(dir)).toEqual(["New.wm"])
    expect((await writeText(to, "words, edited")).written).toBe(true)
    expect(readWm(to).text).toBe("words, edited")
  })
})

describe("5. looking at a changed file is not taking it over", () => {
  it("a peek leaves the app owning the OLD bytes: a save typed meanwhile is refused and the other program's edit survives", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "original words")
    await readText(file)
    writeWm(file, "theirs, from another program")
    const seen = await peekNote(file)
    expect(seen.text).toBe("theirs, from another program")
    // The person kept typing while the page decided what to do with it: an edit of the OLD words.
    expect(await writeText(file, "original words, and more typed")).toMatchObject({ written: false, refused: "changed" })
    expect(readWm(file).text).toBe("theirs, from another program")
    // Once the page has put it on screen, the app owns that state, and the typing that follows is written.
    expect(await adoptNote(file, seen.token)).toBe(true)
    expect((await writeText(file, "theirs, from another program, and more typed")).written).toBe(true)
  })

  it("adopting names the bytes it saw: a file that moved again since is not taken", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "one")
    await readText(file)
    writeWm(file, "two")
    const seen = await peekNote(file)
    writeWm(file, "three")
    expect(await adoptNote(file, seen.token)).toBe(false)
    expect(await writeText(file, "mine")).toMatchObject({ written: false, refused: "changed" })
    expect(readWm(file).text).toBe("three")
  })

  it("the reload adopts only after the words and drawing are on the page, and not at all when it stops for an edit in hand", async () => {
    const adopted: string[] = []
    const page = { text: "old", wordsDirty: false, drawingDirty: false, drawing: "old ink" as string | null }
    const host = (): DiskReloadHost<string> => ({
      open: () => "a.wm", text: () => page.text, wordsDirty: () => page.wordsDirty, drawingDirty: () => page.drawingDirty,
      readNote: async () => "new", readDrawing: async () => "new ink",
      setDocument: (text) => { page.text = text }, setDrawing: (sidecar) => { page.drawing = sidecar },
      adopt: async (file) => { adopted.push(file) },
    })
    await reloadFromDisk(host())
    expect(adopted).toEqual(["a.wm"])
    expect(page).toMatchObject({ text: "new", drawing: "new ink" })
    adopted.length = 0
    page.wordsDirty = true
    await reloadFromDisk(host())
    expect(adopted).toEqual([])
    page.wordsDirty = false
    page.drawingDirty = true
    await reloadFromDisk(host())
    expect(adopted).toEqual([])
    // A file that could not be read is neither shown nor taken.
    page.drawingDirty = false
    page.text = "kept"
    await reloadFromDisk({ ...host(), readNote: async () => null })
    expect(adopted).toEqual([])
    expect(page.text).toBe("kept")
  })
})

describe("13. a picture copied from one note into another is an entry of the note it lands in", () => {
  it("the drawing's pictures and snapshots the note lacks are copied from the notes the app has read, and are there after a restart", async () => {
    const dir = scratch()
    const a = writeWm(path.join(dir, "A.wm"), "a", { entries: { [`media/${PNG}`]: "picture bytes", [`snapshots/ink-${UPPER.toLowerCase()}.svg`]: "<svg>cell</svg>" } })
    const b = writeWm(path.join(dir, "B.wm"), "b")
    await readText(a)
    await readText(b)
    const cell = { kind: "cell", id: UPPER.toLowerCase(), aspect: 1, items: [] }
    await writeDrawingText(b, JSON.stringify({ items: [image(PNG), cell] }))
    const after = readWm(b)
    expect(after.entries[`media/${PNG}`]?.toString()).toBe("picture bytes")
    expect(after.entries[`snapshots/ink-${UPPER.toLowerCase()}.svg`]?.toString()).toBe("<svg>cell</svg>")
    // A is untouched, and a name nobody holds is simply not there (the writer invents nothing).
    expect(readWm(a).names).toContain(`media/${PNG}`)
    await writeDrawingText(b, JSON.stringify({ items: [image(PNG), image("ffffffffffffffff.png", "i2"), cell] }))
    expect(Object.keys(readWm(b).entries).filter((name) => name.startsWith("media/"))).toEqual([`media/${PNG}`])
  })

  it("a picture line pasted as text brings its entry too", async () => {
    const dir = scratch()
    const a = writeWm(path.join(dir, "A.wm"), "a", { entries: { [`media/${PNG}`]: "picture bytes" } })
    const b = writeWm(path.join(dir, "B.wm"), "b")
    await readText(a)
    await readText(b)
    await writeText(b, `b\n\n![](media/${PNG})\n`)
    expect(readWm(b).entries[`media/${PNG}`]?.toString()).toBe("picture bytes")
  })
})

describe("14. a duplicate is of the file as it is, not of what the app happened to hold", () => {
  it("an external replace after the app read the note is what is copied, and the note's state is the file's", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "what the app read")
    await readText(file)
    writeWm(file, "replaced from outside")
    const copy = await duplicateNote(dir, file)
    expect(readWm(copy).text).toBe("replaced from outside")
    // ...and what the page is told of a note (may it be written?) is the file's, not what was cached when it was read.
    writeWm(file, "replaced by a newer WriteMind", { manifest: { version: 2 } })
    expect(await noteState(file)).toMatchObject({ readOnly: true, version: 2 })
  })
})

describe("15. a picture made in one note does not land in the note a tablet sheet is looking at", () => {
  it("reading another note is no opening: the note in front stays the one the page opened, and a save with no note named goes there", async () => {
    const dir = scratch()
    const a = writeWm(path.join(dir, "A.wm"), "a")
    const x = writeWm(path.join(dir, "X.wm"), "x")
    await readText(a)
    await readDrawingText(a)
    expect(frontNote()).toBe(a)
    // (the sheet's check of its bound note, every five seconds)
    await readText(x)
    await readText(x)
    expect(frontNote()).toBe(a)
    const saved = await saveMedia(dir, new Uint8Array([9, 9, 9]), ".png")
    expect(readWm(a).entries[`media/${saved.file}`]).toBeDefined()
    expect(readWm(x).names).not.toContain(`media/${saved.file}`)
    // Opening X (its drawing is asked for) is what brings it to the front.
    await readDrawingText(x)
    expect(frontNote()).toBe(x)
    setFront(null)
  })
})

describe("17. an ink snapshot is never given a twin that differs only by case, and one queued change cannot fail the others", () => {
  it("a converted note's upper-case snapshot is the snapshot: the text save, the snapshot and the drawing all land", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "Converted.wm"), "old", { entries: { [`snapshots/ink-${UPPER}.svg`]: "<svg>converted</svg>" } })
    await readText(file)
    const cell = { kind: "cell", id: UPPER.toLowerCase(), aspect: 1, items: [] }
    const results = await Promise.allSettled([
      writeText(file, "new words"),
      writeSnapshot(file, UPPER.toLowerCase(), "<svg>again</svg>", true),
      writeDrawingText(file, JSON.stringify({ items: [cell] })),
    ])
    expect(results.map((one) => one.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"])
    const after = readWm(file)
    expect(after.text).toBe("new words")
    expect(after.names.filter((name) => name.startsWith("snapshots/"))).toEqual([`snapshots/ink-${UPPER}.svg`])
    expect(after.entries[`snapshots/ink-${UPPER}.svg`]?.toString()).toBe("<svg>converted</svg>")
    // Written over (not onlyIfMissing): the existing spelling is the one written, and what is answered is that name.
    expect(await writeSnapshot(file, UPPER.toLowerCase(), "<svg>redrawn</svg>")).toEqual({ file: `ink-${UPPER}.svg` })
    expect(readWm(file).entries[`snapshots/ink-${UPPER}.svg`]?.toString()).toBe("<svg>redrawn</svg>")
    // The text's spelling finds the picture either way.
    expect(mediaBytes(`ink-${UPPER.toLowerCase()}.svg`, file)).not.toBeNull()
  })

  it("a change that the file format would refuse (two names that fold together) fails alone", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "words", { entries: { "media/Pic.png": "upper" } })
    await loadNote(file)
    const results = await Promise.allSettled([
      writeText(file, "typed"),
      commit(file, (wm) => ({ ...wm, entries: [...wm.entries, { name: "media/pic.png", data: new Uint8Array([1]) }] })),
      writeMedia(file, new Uint8Array([5]), ".png"),
    ])
    expect(results.map((one) => one.status)).toEqual(["fulfilled", "rejected", "fulfilled"])
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/differ only by case/)
    const after = readWm(file)
    expect(after.text).toBe("typed")
    expect(after.names.filter((name) => name.startsWith("media/")).length).toBe(2)
    expect(readFileSync(file).length).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })
})

void writeFileSync
