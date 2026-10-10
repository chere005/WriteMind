// The note store (main/wmStore.ts) against real .wm files in scratch folders: docs/SPEC-WM.md vectors 3, 4 and 6, and the
// one serialised writer per note (text, drawing, snapshots and pictures land together, whole or not at all).
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { utf8 } from "@writemind/core"
import {
  commit, createFile, loadNote, newNoteFile, noteState, readDrawingText, readText, writeDrawingText, writeMedia, writeSnapshot, writeText,
} from "../src/main/wmStore"
import { readWm, wmBytes, writeWm } from "./wmFiles"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-store-"))
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
const stroke = (id: string, extra: object = {}) => ({ kind: "stroke", id, colorHex: "#111111", width: 3, points: [{ x: 0.1, y: 0.1 }], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null, ...extra })

describe("vector 3: unknown things survive a session of typing and drawing", () => {
  it("keeps an unknown entry, a manifest key, a drawing key, an unknown item between two strokes and a field on a stroke; changes modified, not id", async () => {
    const dir = scratch()
    const file = path.join(dir, "Future.wm")
    const drawing = JSON.stringify({ zzz: 1, items: [stroke("a", { tag: "hi" }), { kind: "sticker", id: "q" }, stroke("b")] })
    writeWm(file, "# T\n", {
      drawing, entries: { "extra/x.bin": new Uint8Array([1, 2, 3]) },
      manifest: { "x-future": { a: [1, 2] }, id: "0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10", created: "2026-10-08T09:14:03Z", modified: "2026-10-08T09:14:03Z" },
    })
    await readText(file)
    // The page: types a character, and saves the drawing as the model writes it (it knows a and b only).
    expect((await writeText(file, "# T\nx")).written).toBe(true)
    await writeDrawingText(file, JSON.stringify({ items: [stroke("a"), stroke("b")] }, null, 1))
    const after = readWm(file)
    expect(after.text).toBe("# T\nx")
    expect(after.entries["extra/x.bin"]).toEqual(Buffer.from([1, 2, 3]))
    expect(after.manifest["x-future"]).toEqual({ a: [1, 2] })
    expect(after.manifest.id).toBe("0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10")
    expect(after.manifest.created).toBe("2026-10-08T09:14:03Z")
    expect(after.manifest.modified).not.toBe("2026-10-08T09:14:03Z")
    const kept = JSON.parse(after.drawing!)
    expect(kept.zzz).toBe(1)
    expect(kept.items.map((item: { id: string }) => item.id)).toEqual(["a", "q", "b"])
    expect(kept.items[0].tag).toBe("hi")
    expect(after.names).toEqual(["mimetype", "manifest.json", "note.mdwm", "drawing.json", "extra/x.bin"])
  })

  it("a save that changes nothing writes nothing: the file is the same bytes, and `modified` stays", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "Same.wm"), "# T\n")
    const before = sha(file)
    await readText(file)
    expect((await writeText(file, "# T\n")).written).toBe(true)
    expect(sha(file)).toBe(before)
    // (a page that has "\n" for a file's "\r\n" is the same words: nothing is rewritten)
    const crlf = writeWm(path.join(dir, "Crlf.wm"), "a\r\nb\r\n")
    const was = sha(crlf)
    await readText(crlf)
    await writeText(crlf, "a\nb\n")
    expect(sha(crlf)).toBe(was)
    await writeText(crlf, "a\nb\nc\n")
    expect(readWm(crlf).text).toBe("a\nb\nc\n")
  })
})

describe("vector 4: a note of a newer version is read-only", () => {
  it("opens, is marked read-only, and nothing a session does changes its bytes", async () => {
    const dir = scratch()
    const file = path.join(dir, "Newer.wm")
    writeFileSync(file, wmBytes("# From the future\n", { manifest: { version: 2 }, entries: { "future/thing.bin": new Uint8Array([7]) } }))
    const before = sha(file)
    expect(await readText(file)).toBe("# From the future\n")
    expect(await noteState(file)).toMatchObject({ readOnly: true, version: 2 })
    const out = await writeText(file, "typed anyway")
    expect(out).toMatchObject({ written: false, refused: "newer" })
    await expect(writeDrawingText(file, JSON.stringify({ items: [stroke("a")] }))).rejects.toThrow(/newer WriteMind/)
    await expect(writeMedia(file, new Uint8Array([1]), ".png")).rejects.toThrow(/newer WriteMind/)
    await expect(writeSnapshot(file, "0f8fad5b-d9cb-469f-a165-70867728950e", "<svg></svg>")).rejects.toThrow(/newer WriteMind/)
    expect(sha(file)).toBe(before)
    expect(readdirSync(dir)).toEqual(["Newer.wm"])
  })
})

describe("vector 6: the guard", () => {
  it("(b) a file changed on disk between opening and saving: nothing written, the buffer is the caller's, it is reported", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "mine")
    await readText(file)
    writeWm(file, "theirs (another program)")
    const out = await writeText(file, "mine, edited")
    expect(out).toMatchObject({ written: false, refused: "changed", onDisk: "theirs (another program)" })
    expect(readWm(file).text).toBe("theirs (another program)")
    await expect(writeDrawingText(file, JSON.stringify({ items: [stroke("a")] }))).rejects.toThrow(/changed on disk/)
    expect(readWm(file).drawing).toBeNull()
    // The newer file is brought in the way the app does it, by reading again; then it may be written.
    expect(await readText(file)).toBe("theirs (another program)")
    expect((await writeText(file, "now mine")).written).toBe(true)
  })

  it("(c) a file deleted, then saved: nothing is written (a trash or a move is not undone by an autosave)", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "mine")
    await readText(file)
    const { rmSync } = await import("node:fs")
    rmSync(file)
    expect(await writeText(file, "typed since")).toMatchObject({ written: false, refused: "gone", onDisk: null })
    await expect(writeMedia(file, new Uint8Array([1, 2]), ".png")).rejects.toThrow(/not there any more/)
    expect(readdirSync(dir)).toEqual([])
  })

  it("never writes a file it has not read: whatever is there is not ours", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "Unread.wm"), "theirs")
    const out = await writeText(file, "ours")
    expect(out).toMatchObject({ written: false, refused: "unread" })
    expect(readWm(file).text).toBe("theirs")
    // A file that is no note leaves the note unknown, so nothing writes over it.
    const junk = path.join(dir, "Junk.wm")
    writeFileSync(junk, "# a markdown file that was renamed\n")
    await expect(readText(junk)).rejects.toThrow(/cannot be opened as a WriteMind note/)
    expect((await writeText(junk, "x")).written).toBe(false)
    expect(readFileSync(junk, "utf8")).toBe("# a markdown file that was renamed\n")
  })

  it("a new note saves itself the first time (nothing on disk, nothing known), and a hostile archive is refused untouched", async () => {
    const dir = scratch()
    const fresh = path.join(dir, "Fresh.wm")
    expect((await writeText(fresh, "# first\n")).written).toBe(true)
    expect(readWm(fresh).text).toBe("# first\n")
    expect(readWm(fresh).manifest.format).toBe("writemind-note")
    const evil = path.join(dir, "Evil.wm")
    const { zipBytes } = await import("../src/main/zip")
    const { entriesToWrite, newWmFile } = await import("@writemind/core")
    writeFileSync(evil, zipBytes([...entriesToWrite(newWmFile(new Date(), { name: "t", version: "1" }, "x"), null).entries, { name: "../x", data: utf8("1") }]))
    const before = sha(evil)
    await expect(readText(evil)).rejects.toThrow(/cannot be opened/)
    expect((await writeText(evil, "y")).written).toBe(false)
    expect(sha(evil)).toBe(before)
    expect(readdirSync(dir).sort()).toEqual(["Evil.wm", "Fresh.wm"])
  })
})

describe("one writer per note: text, drawing, snapshots and pictures land together", () => {
  it("every change asked for at once is in the file when the last one answers, and each answered after its own change was written", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "# N\n")
    await readText(file)
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e"
    const results = await Promise.all([
      writeText(file, "# N\n\nwords\n"),
      writeDrawingText(file, JSON.stringify({ items: [stroke("a")] })),
      writeSnapshot(file, id, "<svg>cell</svg>"),
      writeMedia(file, new Uint8Array([1, 2, 3]), ".png"),
      writeText(file, "# N\n\nmore words\n"),
    ])
    expect((results[0] as { written: boolean }).written).toBe(true)
    const after = readWm(file)
    expect(after.text).toBe("# N\n\nmore words\n")
    expect(JSON.parse(after.drawing!).items).toHaveLength(1)
    expect(after.entries[`snapshots/ink-${id}.svg`]!.toString()).toBe("<svg>cell</svg>")
    expect(after.names.filter((name) => name.startsWith("media/"))).toHaveLength(1)
    expect(readdirSync(dir)).toEqual(["N.wm"])
  })

  it("a save of the text carries the drawing it has, and a save of the drawing carries the text it has", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "# N\n")
    await readText(file)
    await writeDrawingText(file, JSON.stringify({ items: [stroke("a")] }))
    await writeText(file, "# N\nafter\n")
    expect(JSON.parse(readWm(file).drawing!).items).toHaveLength(1)
    await writeDrawingText(file, JSON.stringify({ items: [stroke("a"), stroke("b")] }))
    expect(readWm(file).text).toBe("# N\nafter\n")
    expect(await readDrawingText(file)).toContain('"b"')
  })

  it("a change that throws fails alone; the others around it are written", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "# N\n")
    await readText(file)
    const [one, two, three] = await Promise.allSettled([
      writeText(file, "# one\n"),
      commit(file, () => { throw new Error("that change was wrong") }),
      writeText(file, "# three\n"),
    ])
    expect(one!.status).toBe("fulfilled")
    expect(two!.status).toBe("rejected")
    expect(three!.status).toBe("fulfilled")
    expect(readWm(file).text).toBe("# three\n")
  })

  it("a failed write (the disk said no) leaves the old note whole, says so, and the next one goes through", async () => {
    const dir = scratch()
    const file = writeWm(path.join(dir, "N.wm"), "old")
    await readText(file)
    chmodSync(file, 0o444)
    await expect(writeText(file, "new")).rejects.toMatchObject({ code: expect.stringMatching(/EPERM|EACCES/) })
    chmodSync(file, 0o644)
    expect(readWm(file).text).toBe("old")
    expect(readdirSync(dir)).toEqual(["N.wm"])
    expect((await writeText(file, "new")).written).toBe(true)
    expect(readWm(file).text).toBe("new")
  })

  it("a name is made once: the same picture saved twice is one entry, and a new note is whole at once", async () => {
    const dir = scratch()
    const file = path.join(dir, "Made.wm")
    await createFile(file, newNoteFile("hello"))
    expect(readWm(file).names).toEqual(["mimetype", "manifest.json", "note.mdwm"])
    const one = await writeMedia(file, new Uint8Array([5, 6]), "PNG")
    const two = await writeMedia(file, new Uint8Array([5, 6]), ".png")
    expect(one).toEqual(two)
    expect(one.file).toBe(`${createHash("sha1").update(new Uint8Array([5, 6])).digest("hex").slice(0, 16)}.png`)
    await expect(createFile(file, newNoteFile("other"))).rejects.toMatchObject({ code: "EEXIST" })
    expect(readWm(file).text).toBe("hello")
    // The picture's extension cannot carry a path.
    const odd = await writeMedia(file, new Uint8Array([7]), "../../x")
    expect(odd.file).toMatch(/^[0-9a-f]{16}\.x$/)
  })
})
