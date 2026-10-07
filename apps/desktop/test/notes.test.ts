import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createNote, duplicateNote, fileChanged, findMedia, forgetTrust, isProjectFolder, mediaPath, moveSection, ownerOf, placeNote,
  projectTree, readDrawing, readNote, readTree, renameNote, renameSection, reorder, saveInkSnapshot, saveMedia,
  setExcluded, setProjectFolders, setWatched, wroteRecently, writeDrawing, writeNote,
} from "../src/main/notes"
import { loadNote } from "../src/main/wmStore"
import { readWm, writeWm, type WmExtras } from "./wmFiles"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-notes-"))
/** A note: `name` is its file name (`one.wm`). */
const note = (folder: string, name: string, text = `# ${name}\n`, extras: WmExtras = {}) => writeWm(path.join(folder, name), text, extras)
const drawing = (colour: string) => JSON.stringify({ items: [{ kind: "stroke", id: `s-${colour}`, colorHex: colour, width: 3, points: [{ x: 0.1, y: 0.1 }], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null }] })
const names = (folder: string) => readdirSync(folder).sort()
const colours = (json: string | null) => (JSON.parse(json ?? '{"items":[]}').items as { colorHex: string }[]).map((item) => item.colorHex)

afterEach(() => { setProjectFolders([]); setExcluded([]); setWatched([]); vi.restoreAllMocks() })

describe("which project folder a note belongs to", () => {
  it("is the first folder that holds it; a folder owns itself; a stray path goes to the root or the first folder", () => {
    const a = scratch()
    const b = scratch()
    const outside = scratch()
    setProjectFolders([a, b])
    expect(ownerOf(path.join(b, "sub", "x.wm"), a)).toBe(path.resolve(b))
    expect(ownerOf(path.join(a, "x.wm"), a)).toBe(path.resolve(a))
    expect(ownerOf(b, a)).toBe(path.resolve(b))
    expect(ownerOf(path.join(outside, "x.wm"), a)).toBe(path.resolve(a))
    expect(isProjectFolder(b, a)).toBe(true)
    expect(isProjectFolder(path.join(b, "sub"), a)).toBe(false)
  })

  it("does not take a folder with the same start as another for being inside it", () => {
    const base = scratch()
    const a = path.join(base, "notes")
    const lookalike = path.join(base, "notes-old")
    mkdirSync(a)
    mkdirSync(lookalike)
    setProjectFolders([a])
    expect(ownerOf(path.join(lookalike, "x.wm"), a)).toBe(path.resolve(a))
    setProjectFolders([a, lookalike])
    expect(ownerOf(path.join(lookalike, "x.wm"), a)).toBe(path.resolve(lookalike))
  })
})

describe("each project folder keeps its own order, the Mac's file (.writemind/order.json)", () => {
  it("writes a dragged order into the folder it is in, with keys relative to that folder, and nowhere else", async () => {
    const home = scratch()
    const other = scratch()
    note(path.join(other, "sub"), "one.wm")
    note(path.join(other, "sub"), "two.wm")
    setProjectFolders([home, other])
    await reorder(home, path.join(other, "sub"), ["two.wm", "one.wm"])
    const file = path.join(other, ".writemind", "order.json")
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ folders: { sub: ["two.wm", "one.wm"] } })
    expect(existsSync(path.join(home, ".writemind"))).toBe(false)
    const tree = await projectTree([home, other], home, "P")
    expect(tree.sections[1]!.sections[0]!.notes.map((n) => path.basename(n.path))).toEqual(["two.wm", "one.wm"])
  })

  it("travels with the folder: the same order shows wherever the folder is", async () => {
    const home = scratch()
    const original = scratch()
    note(original, "a.wm")
    note(original, "b.wm")
    note(original, "c.wm")
    setProjectFolders([original])
    await reorder(home, original, ["c.wm", "a.wm", "b.wm"])
    const moved = path.join(scratch(), "moved")
    cpSync(original, moved, { recursive: true })
    setProjectFolders([moved])
    const tree = await projectTree([moved], home, "P")
    expect(tree.notes.map((n) => path.basename(n.path))).toEqual(["c.wm", "a.wm", "b.wm"])
  })

  it("still reads the order a folder had in the notes root's file before folders carried their own", async () => {
    const home = scratch()
    const other = scratch()
    note(other, "x.wm")
    note(other, "y.wm")
    note(path.join(other, "deep"), "p.wm")
    note(path.join(other, "deep"), "q.wm")
    const key = (p: string) => p.replace(/\\/g, "/")
    mkdirSync(path.join(home, ".writemind"))
    writeFileSync(path.join(home, ".writemind", "order.json"), JSON.stringify({
      folders: { [key(other)]: ["y.wm", "x.wm"], [`${key(other)}/deep`]: ["q.wm", "p.wm"] },
    }))
    const tree = await projectTree([other], home, "P")
    expect(tree.notes.map((n) => path.basename(n.path))).toEqual(["y.wm", "x.wm"])
    expect(tree.sections[0]!.notes.map((n) => path.basename(n.path))).toEqual(["q.wm", "p.wm"])
  })

  it("moving a note to another project folder forgets its place in the first and takes one in the second", async () => {
    const home = scratch()
    const other = scratch()
    const a = note(home, "a.wm")
    note(home, "z.wm")
    note(other, "m.wm")
    setProjectFolders([home, other])
    await reorder(home, home, ["a.wm", "z.wm"])
    const landed = await placeNote(home, a, other, "m.wm")
    expect(path.dirname(landed)).toBe(other)
    expect(JSON.parse(readFileSync(path.join(home, ".writemind", "order.json"), "utf8")).folders[""]).toEqual(["z.wm"])
    expect(JSON.parse(readFileSync(path.join(other, ".writemind", "order.json"), "utf8")).folders[""]).toEqual(["a.wm", "m.wm"])
  })
})

describe("a note's drawing, pictures and ink snapshots are INSIDE the .wm", () => {
  it("a drawing is written into drawing.json of the note, and nowhere else (no .drawings folder, no sidecar)", async () => {
    const home = scratch()
    setProjectFolders([home])
    const a = note(home, "a.wm", "# A\n")
    expect(await readNote(a)).toBe("# A\n")
    expect(await readDrawing(home, a)).toBeNull()
    await writeDrawing(home, a, drawing("#111111"))
    expect(colours(await readDrawing(home, a))).toEqual(["#111111"])
    expect(colours(readWm(a).drawing)).toEqual(["#111111"])
    expect(names(home)).toEqual(["a.wm"])
    // A later drawing replaces it, and the words come along untouched.
    await writeDrawing(home, a, drawing("#222222"))
    expect(colours(readWm(a).drawing)).toEqual(["#222222"])
    expect(readWm(a).text).toBe("# A\n")
  })

  it("a note nobody drew on has no drawing.json, and an empty drawing does not make one", async () => {
    const home = scratch()
    const a = note(home, "a.wm")
    await readNote(a)
    await writeDrawing(home, a, '{ "items": [] }')
    expect(readWm(a).names).toEqual(["mimetype", "manifest.json", "note.mdwm"])
    expect(await readDrawing(home, a)).toBeNull()
  })

  it("two notes of one name in two sections have a drawing each", async () => {
    const home = scratch()
    setProjectFolders([home])
    const one = note(path.join(home, "A"), "Notes.wm")
    const two = note(path.join(home, "B"), "Notes.wm")
    await readNote(one)
    await readNote(two)
    await writeDrawing(home, one, drawing("#aa0000"))
    await writeDrawing(home, two, drawing("#00aa00"))
    expect(colours(await readDrawing(home, one))).toEqual(["#aa0000"])
    expect(colours(await readDrawing(home, two))).toEqual(["#00aa00"])
  })

  it("keeps what the drawing had that the model does not carry (an unknown key and item), through the model's own save", async () => {
    const home = scratch()
    const a = note(home, "a.wm", "# A\n", { drawing: JSON.stringify({ zzz: 1, items: [{ kind: "sticker", id: "q" }] }) })
    await readNote(a)
    await writeDrawing(home, a, drawing("#333333"))
    const kept = JSON.parse(readWm(a).drawing!)
    expect(kept.zzz).toBe(1)
    expect(kept.items.map((item: { kind: string }) => item.kind)).toEqual(["sticker", "stroke"])
  })
})

describe("pictures", () => {
  it("go into media/<hash>.<ext> of the note, once however often they are saved, and make no folder beside the notes", async () => {
    const home = scratch()
    setProjectFolders([home])
    const a = note(home, "a.wm")
    await readNote(a)
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const first = await saveMedia(home, bytes, ".png", a)
    const again = await saveMedia(home, bytes, "png", a)
    expect(again.file).toBe(first.file)
    expect(first.file).toMatch(/^[0-9a-f]{16}\.png$/)
    expect(Object.keys(readWm(a).entries).filter((name) => name.startsWith("media/"))).toEqual([`media/${first.file}`])
    expect([...readWm(a).entries[`media/${first.file}`]!]).toEqual([...bytes])
    expect(names(home)).toEqual(["a.wm"])
  })

  it("go to the note in front when the page does not say, and a picture with no note open is refused", async () => {
    const home = scratch()
    const a = note(home, "a.wm")
    const b = note(home, "b.wm")
    await readNote(a)
    await readDrawing(home, b)                       // b is the note in front now
    const saved = await saveMedia(home, new Uint8Array([1, 2, 3, 4]), ".jpg")
    expect(readWm(b).entries[`media/${saved.file}`]).toBeDefined()
    expect(readWm(a).entries[`media/${saved.file}`]).toBeUndefined()
  })

  it("are found by name as files: the note's own, then another open note's; one that is nowhere is a path that is not there", async () => {
    const home = scratch()
    const a = note(home, "a.wm")
    const b = note(home, "b.wm")
    await readNote(a)
    const saved = await saveMedia(home, new Uint8Array([9, 8, 7, 6, 5]), ".png", a)
    await readNote(b)                                // b in front: a's picture is still found, by name
    const file = await findMedia(home, saved.file)
    expect([...readFileSync(file)]).toEqual([9, 8, 7, 6, 5])
    expect(mediaPath(home, saved.file)).toBe(file)
    expect(await findMedia(home, saved.file, a)).toBe(file)
    expect(existsSync(await findMedia(home, "nowhere.png"))).toBe(false)
    expect(existsSync(mediaPath(home, "nowhere.png"))).toBe(false)
  })

  it("the same picture asked for many times at once is written out once, and every ask gets its file (a page asks from several places in one breath)", async () => {
    const home = scratch()
    const a = note(home, "a.wm")
    await readNote(a)
    const saved = await saveMedia(home, new Uint8Array([4, 4, 4, 4, 4, 4]), ".png", a)
    const files = await Promise.all(Array.from({ length: 24 }, () => findMedia(home, saved.file, a)))
    expect(new Set(files).size).toBe(1)
    expect([...readFileSync(files[0]!)]).toEqual([4, 4, 4, 4, 4, 4])
    expect(readdirSync(path.dirname(files[0]!))).toEqual([saved.file])
  })

  it("an ink cell's snapshot goes into snapshots/ink-<id>.svg, is rewritten in place, and is left alone when it is there and the page says so", async () => {
    const home = scratch()
    const a = note(home, "a.wm")
    await readNote(a)
    const id = "0F8FAD5B-D9CB-469F-A165-70867728950E"
    const out = await saveInkSnapshot(home, a, id, "<svg>one</svg>")
    expect(out.file).toBe(`ink-${id.toLowerCase()}.svg`)
    expect(readWm(a).entries[`snapshots/${out.file}`]!.toString()).toBe("<svg>one</svg>")
    await saveInkSnapshot(home, a, id, "<svg>two</svg>", true)
    expect(readWm(a).entries[`snapshots/${out.file}`]!.toString()).toBe("<svg>one</svg>")
    await saveInkSnapshot(home, a, id, "<svg>three</svg>")
    expect(readWm(a).entries[`snapshots/${out.file}`]!.toString()).toBe("<svg>three</svg>")
    // Only a UUID can name one, and only an svg is one.
    await expect(saveInkSnapshot(home, a, "../../etc", "<svg/>")).rejects.toThrow(/not an ink cell id/)
    await expect(saveInkSnapshot(home, a, id, "not svg")).rejects.toThrow(/not an svg/)
    expect((await findMedia(home, out.file, a)).endsWith(out.file)).toBe(true)
  })
})

describe("renaming and moving keep the drawing, the pictures and the place", () => {
  it("a renamed note keeps its drawing (it is the same file) and its place in the order (the Mac's rename)", async () => {
    const home = scratch()
    const a = note(home, "a.wm")
    const b = note(home, "b.wm")
    note(home, "c.wm")
    setProjectFolders([home])
    await reorder(home, home, ["a.wm", "b.wm", "c.wm"])
    await readNote(b)
    await writeDrawing(home, b, drawing("#888888"))
    const beta = await renameNote(home, b, "Beta")
    expect(path.basename(beta)).toBe("Beta.wm")
    expect(colours(await readDrawing(home, beta))).toEqual(["#888888"])
    expect(existsSync(b)).toBe(false)
    expect(JSON.parse(readFileSync(path.join(home, ".writemind", "order.json"), "utf8")).folders[""]).toEqual(["a.wm", "Beta.wm", "c.wm"])
    expect(a).toBeTruthy()
    // The app still owns the renamed file: a save is accepted, not refused as somebody else's.
    expect((await writeNote(beta, "# Beta\n")).written).toBe(true)
  })

  it("a name with characters Windows refuses is made fit, not thrown at the disk", async () => {
    const home = scratch()
    setProjectFolders([home])
    // typed, what it becomes on Windows, what it becomes elsewhere
    const cases: Array<[string, string, string]> = [
      ["What now?", "What now.wm", "What now?.wm"], ["a*b", "ab.wm", "a*b.wm"], ['say "hi"', "say 'hi'.wm", 'say "hi".wm'],
      ["x|y", "x-y.wm", "x|y.wm"], ["<draft>", "draft.wm", "<draft>.wm"], ["Ideas.", "Ideas.wm", "Ideas.wm"],
      ["a:b/c", "a-b-c.wm", "a-b-c.wm"], ["CON", "CON-.wm", "CON.wm"], ["", "Untitled.wm", "Untitled.wm"],
    ]
    let index = 0
    for (const [typed, onWindows, elsewhere] of cases) {
      const file = note(home, `src-${index++}.wm`)
      const next = await renameNote(home, file, typed)
      expect(path.basename(next)).toBe(process.platform === "win32" ? onWindows : elsewhere)
      expect(existsSync(next)).toBe(true)
      expect(existsSync(file)).toBe(false)
    }
    // 300 characters is cut, not refused.
    const long = note(home, "long.wm")
    const next = await renameNote(home, long, "q".repeat(300))
    expect(existsSync(next)).toBe(true)
    expect(path.basename(next).length).toBeLessThanOrEqual(104)
  })

  it("a renamed section keeps every note inside it, is never renamed to nothing, and a project folder is not renamed", async () => {
    const home = scratch()
    const inside = note(path.join(home, "Old"), "n.wm")
    setProjectFolders([home])
    await readNote(inside)
    await writeDrawing(home, inside, drawing("#999999"))
    // "..." leaves nothing anywhere (a leading dot is never kept); "???" leaves nothing only on Windows, which
    // stores none of those — on a Mac it is a fine folder name (fileNames.test.ts has both sides of safeName).
    expect(await renameSection(home, path.join(home, "Old"), "...")).toBeNull()
    if (process.platform === "win32") expect(await renameSection(home, path.join(home, "Old"), "???")).toBeNull()
    expect(await renameSection(home, home, "Other")).toBeNull()
    const renamed = await renameSection(home, path.join(home, "Old"), "What now?")
    expect(renamed && path.basename(renamed)).toBe(process.platform === "win32" ? "What now" : "What now?")
    expect(colours(await readDrawing(home, path.join(renamed!, "n.wm")))).toEqual(["#999999"])
    expect((await writeNote(path.join(renamed!, "n.wm"), "# n\n")).written).toBe(true)
  })

  it("a section moved into another keeps its notes and their drawings and its place; a project folder cannot be moved", async () => {
    const home = scratch()
    const inside = note(path.join(home, "Src"), "n.wm")
    mkdirSync(path.join(home, "Dst"))
    setProjectFolders([home])
    await readNote(inside)
    await writeDrawing(home, inside, drawing("#abcdef"))
    expect(await moveSection(home, home, path.join(home, "Dst"))).toBeNull()
    const landed = await moveSection(home, path.join(home, "Src"), path.join(home, "Dst"))
    expect(landed).toBe(path.join(home, "Dst", "Src"))
    expect(colours(await readDrawing(home, path.join(landed!, "n.wm")))).toEqual(["#abcdef"])
  })

  it("a note dragged to another folder keeps being the app's to save", async () => {
    const home = scratch()
    const a = note(home, "a.wm")
    mkdirSync(path.join(home, "Sec"))
    setProjectFolders([home])
    await readNote(a)
    const landed = await placeNote(home, a, path.join(home, "Sec"), null)
    expect(landed).toBe(path.join(home, "Sec", "a.wm"))
    expect((await writeNote(landed, "# moved\n")).written).toBe(true)
    expect(readWm(landed).text).toBe("# moved\n")
  })

  it("a duplicate is another note (a new id) with the drawing and pictures, and sits right after the original", async () => {
    const home = scratch()
    const a = note(home, "a.wm", "# A\n", { entries: { "media/p.png": "P" } })
    const b = note(home, "b.wm")
    // The list is newest first: a is the newer one by a clear margin, not by the clock ticking between two writes.
    utimesSync(b, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
    utimesSync(a, new Date(), new Date())
    setProjectFolders([home])
    await readNote(a)
    await writeDrawing(home, a, drawing("#010101"))
    const copy = await duplicateNote(home, a)
    expect(colours(await readDrawing(home, copy))).toEqual(["#010101"])
    expect(readWm(copy).entries["media/p.png"]!.toString()).toBe("P")
    expect(readWm(copy).manifest.id).not.toBe(readWm(a).manifest.id)
    expect((await projectTree([home], home, "P")).notes.map((n) => path.basename(n.path)).slice(0, 2)).toEqual(["a.wm", "a copy.wm"])
  })
})

describe("the notes themselves", () => {
  it("are saved whole and leave nothing beside them", async () => {
    const home = scratch()
    const file = note(home, "n.wm", "first")
    await readNote(file)
    const out = await writeNote(file, "second")
    expect(out.written).toBe(true)
    expect(readWm(file).text).toBe("second")
    expect(names(home)).toEqual(["n.wm"])
  })

  it("say so, in the system's words, when the file is read-only — and are not changed", async () => {
    const home = scratch()
    const file = note(home, "locked.wm", "as it was")
    await readNote(file)
    chmodSync(file, 0o444)
    try {
      await expect(writeNote(file, "typed since")).rejects.toMatchObject({ code: expect.stringMatching(/EPERM|EACCES/) })
      expect(readWm(file).text).toBe("as it was")
      expect(names(home)).toEqual(["locked.wm"])
    } finally { chmodSync(file, 0o644) }
  })

  it("refuse to overwrite a file somebody else changed, as before", async () => {
    const home = scratch()
    const file = note(home, "shared.wm", "mine")
    await readNote(file)
    note(home, "shared.wm", "theirs")
    const out = await writeNote(file, "mine again")
    expect(out.written).toBe(false)
    expect(out.onDisk).toBe("theirs")
    expect(readWm(file).text).toBe("theirs")
  })

  it("are never made over a file that appeared since the name was looked for", async () => {
    const home = scratch()
    const made = await Promise.all(Array.from({ length: 8 }, () => createNote(home)))
    expect(new Set(made).size).toBe(8)
    expect(names(home)).toHaveLength(8)
    expect(made.every((file) => file.endsWith(".wm"))).toBe(true)
    // A new note is a whole .wm with empty text, and the app owns it at once.
    expect(readWm(made[0]!).text).toBe("")
    expect((await writeNote(made[0]!, "# first words\n")).written).toBe(true)
  })

  it("a new note's name is taken in turn: Untitled, Untitled 2 ...", async () => {
    const home = scratch()
    const one = await createNote(home)
    const two = await createNote(home)
    expect([path.basename(one), path.basename(two)]).toEqual(["Untitled.wm", "Untitled 2.wm"])
  })
})

describe("a big folder", () => {
  it("is read with every note's own heading, however many there are (the first 8 KiB of each note.mdwm, not the whole file)", async () => {
    const home = scratch()
    for (let n = 0; n < 700; n++) writeWm(path.join(home, `note-${n}.wm`), `# Heading ${n}\n\nbody\n`)
    const tree = await readTree(home, home, { folders: {} })
    expect(tree.notes).toHaveLength(700)
    expect(tree.notes.every((row) => row.title === `Heading ${path.basename(row.path).replace(/\D/g, "")}`)).toBe(true)
    // 700 files on a hosted Windows runner took 11 s once: the default 5 s made CI fail (and mail Sean) on speed alone.
  }, 60_000)

  it("lists the .wm files and nothing else: not a legacy .md, not a Name.wm.tmp left by a write that was cut short, not a hidden folder", async () => {
    const home = scratch()
    note(home, "real.wm", "# Real\n")
    writeFileSync(path.join(home, "Legacy.md"), "# Legacy\n")
    writeFileSync(path.join(home, "Cut.wm.tmp"), "half a file")
    mkdirSync(path.join(home, ".drawings"))
    note(path.join(home, ".drawings"), "hidden.wm")
    writeFileSync(path.join(home, "Note.TXT"), "x")
    note(home, "Upper.WM", "# Upper\n")
    const tree = await readTree(home, home, { folders: {} })
    expect(tree.notes.map((row) => row.title).sort()).toEqual(["Real", "Upper"])
  })

  it("shows a file called .wm that is not a note by its name, and does not remember that row as the note", async () => {
    const home = scratch()
    writeFileSync(path.join(home, "Broken.wm"), "# this was a markdown note renamed by hand\n")
    const tree = await readTree(home, home, { folders: {} })
    expect(tree.notes.map((row) => row.title)).toEqual(["Broken"])
  })

  it("does not remember a row it could not read as if it were the note (EMFILE gave file names for titles that stuck)", async () => {
    const home = scratch()
    const file = note(home, "real.wm", "# The Real Heading\n")
    note(home, "other.wm", "# Other\n")
    const open = fsp.open.bind(fsp)
    let failing = true
    vi.spyOn(fsp, "open").mockImplementation(async (target, ...rest) => {
      if (failing && String(target).endsWith("real.wm")) throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" })
      return open(target, ...(rest as [])) as never
    })
    const first = await readTree(home, home, { folders: {} })
    expect(first.notes.find((row) => row.path === file)!.title).not.toBe("The Real Heading")
    failing = false
    const second = await readTree(home, home, { folders: {} })
    expect(second.notes.find((row) => row.path === file)!.title).toBe("The Real Heading")
  })
})

// e3-editor-perf (2026-10-04): the tree is read after every save; with a watcher on, a note nobody said anything about is
// not looked at again (500 notes: 510 stat calls per save, 18 ms of CPU).
describe("trusting the watcher", () => {
  const titles = (tree: { notes: { title: string }[] }) => tree.notes.map((row) => row.title).sort()

  it("keeps a note it was not told about, and looks again at one it was", async () => {
    const home = scratch()
    const a = note(home, "a.wm", "# First\n")
    note(home, "b.wm", "# Second\n")
    setWatched([home])
    expect(titles(await projectTree([home], home, "P"))).toEqual(["First", "Second"])       // the full look
    // changed behind its back: the cache stands (the watcher has not said a word)
    note(home, "a.wm", "# Changed behind the watcher\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["First", "Second"])
    // the watcher says so: looked at again
    fileChanged(a)
    expect(titles(await projectTree([home], home, "P"))).toEqual(["Changed behind the watcher", "Second"])
  })

  it("sees a new file, a removed file and a rename at once: the listing is always read", async () => {
    const home = scratch()
    const a = note(home, "a.wm", "# A\n")
    setWatched([home])
    await projectTree([home], home, "P")
    note(home, "c.wm", "# C\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["A", "C"])
    await fsp.rm(a)
    expect(titles(await projectTree([home], home, "P"))).toEqual(["C"])
  })

  it("trusts nothing without a watcher, and nothing after the watcher failed", async () => {
    const home = scratch()
    note(home, "a.wm", "# One\n")
    await projectTree([home], home, "P")
    // The size differs, so the stat tells even inside one tick of the file clock (no watcher on: every look is a full
    // one). ("# Two\n" was as long as "# One\n": the test then hung on the file time changing, and failed now and then.)
    note(home, "a.wm", "# Two words\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["Two words"])
    setWatched([home])
    await projectTree([home], home, "P")
    note(home, "a.wm", "# Three\n")
    forgetTrust()
    expect(titles(await projectTree([home], home, "P"))).toEqual(["Three"])
  })

  it("our own saves are looked at again (a save is a write the watcher also hears, but not before the next look)", async () => {
    const home = scratch()
    const a = note(home, "a.wm", "# Before\n")
    setWatched([home])
    await readNote(a)
    await projectTree([home], home, "P")
    await writeNote(a, "# After the save\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["After the save"])
  })

  it("a write inside a folder is an echo for the folder too, and so is the .tmp the archive is written through", async () => {
    const home = scratch()
    const inner = path.join(home, "Section")
    const a = note(inner, "a.wm", "# A\n")
    await readNote(a)
    await writeNote(a, "# A2\n")
    expect(wroteRecently(a)).toBe(true)
    expect(wroteRecently(`${a}.tmp`)).toBe(true)
    expect(wroteRecently(inner)).toBe(true)
    expect(wroteRecently(path.join(home, "Other"))).toBe(false)
    expect(wroteRecently(home)).toBe(true)
  })
})

describe("a note is read afresh from its file, and what was read is what the app may write over", () => {
  it("loads the container once per read and keeps the unknown entries it had", async () => {
    const home = scratch()
    const a = note(home, "a.wm", "# A\n", { entries: { "extra/x.bin": new Uint8Array([1, 2, 3]) } })
    const wm = await loadNote(a)
    expect(wm.entries.map((entry) => entry.name)).toEqual(["note.mdwm", "extra/x.bin"])
    await writeNote(a, "# A changed\n")
    expect(readWm(a).entries["extra/x.bin"]).toEqual(Buffer.from([1, 2, 3]))
  })
})
