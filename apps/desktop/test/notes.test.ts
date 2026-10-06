import { createHash } from "node:crypto"
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs"
import fs, { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readDrawing as parseDrawing } from "@writemind/core"
import {
  createNote, drawingPath, duplicateNote, fileChanged, findMedia, forgetTrust, isProjectFolder, mediaPath, moveSection,
  ownerOf, placeNote, projectTree, readDrawing, readNote, readTree, renameNote, renameSection, reorder, saveMedia,
  setExcluded, setProjectFolders, setWatched, wroteRecently, writeDrawing, writeNote,
} from "../src/main/notes"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-notes-"))
const note = (folder: string, name: string, text = `# ${name}\n`) => {
  mkdirSync(folder, { recursive: true })
  const file = path.join(folder, name)
  writeFileSync(file, text)
  return file
}
const drawing = (colour: string) => JSON.stringify({ items: [{ kind: "stroke", id: `s-${colour}`, colorHex: colour, width: 3, points: [{ x: 0.1, y: 0.1 }], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null }] })
const names = (folder: string) => readdirSync(folder).sort()

afterEach(() => { setProjectFolders([]); setExcluded([]); setWatched([]); vi.restoreAllMocks() })

describe("which project folder a note belongs to", () => {
  it("is the first folder that holds it; a folder owns itself; a stray path goes to the root or the first folder", () => {
    const a = scratch()
    const b = scratch()
    const outside = scratch()
    setProjectFolders([a, b])
    expect(ownerOf(path.join(b, "sub", "x.md"), a)).toBe(path.resolve(b))
    expect(ownerOf(path.join(a, "x.md"), a)).toBe(path.resolve(a))
    expect(ownerOf(b, a)).toBe(path.resolve(b))
    expect(ownerOf(path.join(outside, "x.md"), a)).toBe(path.resolve(a))
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
    expect(ownerOf(path.join(lookalike, "x.md"), a)).toBe(path.resolve(a))
    setProjectFolders([a, lookalike])
    expect(ownerOf(path.join(lookalike, "x.md"), a)).toBe(path.resolve(lookalike))
  })
})

describe("each project folder keeps its own order, the Mac's file (.writemind/order.json)", () => {
  it("writes a dragged order into the folder it is in, with keys relative to that folder, and nowhere else", async () => {
    const home = scratch()
    const other = scratch()
    note(path.join(other, "sub"), "one.md")
    note(path.join(other, "sub"), "two.md")
    setProjectFolders([home, other])
    await reorder(home, path.join(other, "sub"), ["two.md", "one.md"])
    const file = path.join(other, ".writemind", "order.json")
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ folders: { sub: ["two.md", "one.md"] } })
    expect(existsSync(path.join(home, ".writemind"))).toBe(false)
    const tree = await projectTree([home, other], home, "P")
    expect(tree.sections[1]!.sections[0]!.notes.map((n) => path.basename(n.path))).toEqual(["two.md", "one.md"])
  })

  it("travels with the folder: the same order shows wherever the folder is", async () => {
    const home = scratch()
    const original = scratch()
    note(original, "a.md")
    note(original, "b.md")
    note(original, "c.md")
    setProjectFolders([original])
    await reorder(home, original, ["c.md", "a.md", "b.md"])
    const moved = path.join(scratch(), "moved")
    cpSync(original, moved, { recursive: true })
    setProjectFolders([moved])
    const tree = await projectTree([moved], home, "P")
    expect(tree.notes.map((n) => path.basename(n.path))).toEqual(["c.md", "a.md", "b.md"])
  })

  it("still reads the order a folder had in the notes root's file before folders carried their own", async () => {
    const home = scratch()
    const other = scratch()
    note(other, "x.md")
    note(other, "y.md")
    note(path.join(other, "deep"), "p.md")
    note(path.join(other, "deep"), "q.md")
    const key = (p: string) => p.replace(/\\/g, "/")
    mkdirSync(path.join(home, ".writemind"))
    writeFileSync(path.join(home, ".writemind", "order.json"), JSON.stringify({
      folders: { [key(other)]: ["y.md", "x.md"], [`${key(other)}/deep`]: ["q.md", "p.md"] },
    }))
    const tree = await projectTree([other], home, "P")
    expect(tree.notes.map((n) => path.basename(n.path))).toEqual(["y.md", "x.md"])
    expect(tree.sections[0]!.notes.map((n) => path.basename(n.path))).toEqual(["q.md", "p.md"])
  })

  it("moving a note to another project folder forgets its place in the first and takes one in the second", async () => {
    const home = scratch()
    const other = scratch()
    const a = note(home, "a.md")
    note(home, "z.md")
    note(other, "m.md")
    setProjectFolders([home, other])
    await reorder(home, home, ["a.md", "z.md"])
    const landed = await placeNote(home, a, other, "m.md")
    expect(path.dirname(landed)).toBe(other)
    expect(JSON.parse(readFileSync(path.join(home, ".writemind", "order.json"), "utf8")).folders[""]).toEqual(["z.md"])
    expect(JSON.parse(readFileSync(path.join(other, ".writemind", "order.json"), "utf8")).folders[""]).toEqual(["a.md", "m.md"])
  })
})

describe("a note's drawing is kept in the project folder it is under", () => {
  it("is .drawings/<stem>-<hash of the path from the folder>.json in that folder, and in no other place", async () => {
    const home = scratch()
    const other = scratch()
    const file = note(path.join(other, "sec"), "page.md")
    setProjectFolders([home, other])
    await writeDrawing(home, file, drawing("#111111"))
    const where = drawingPath(home, file)
    const hash = createHash("sha1").update("sec/page.md").digest("hex").slice(0, 12)
    expect(where).toBe(path.join(other, ".drawings", `page-${hash}.json`))
    expect(readFileSync(where, "utf8")).toBe(drawing("#111111"))
    expect(existsSync(path.join(home, ".drawings"))).toBe(false)
    expect(await readDrawing(home, file)).toBe(drawing("#111111"))
  })

  it("travels: the folder copied elsewhere (another drive, another machine, Documents moved to OneDrive) still has it", async () => {
    const home = scratch()
    const original = scratch()
    const file = note(path.join(original, "sec"), "page.md")
    setProjectFolders([original])
    await writeDrawing(home, file, drawing("#222222"))
    const copy = path.join(scratch(), "a different place", "notebook")
    cpSync(original, copy, { recursive: true })
    setProjectFolders([copy])
    expect(await readDrawing(home, path.join(copy, "sec", "page.md"))).toBe(drawing("#222222"))
  })

  it("keeps two notes of one name in two sections apart (the Mac shares one file between them)", async () => {
    const home = scratch()
    const a = note(path.join(home, "one"), "Untitled.md")
    const b = note(path.join(home, "two"), "Untitled.md")
    setProjectFolders([home])
    await writeDrawing(home, a, drawing("#aa0000"))
    await writeDrawing(home, b, drawing("#00bb00"))
    expect(await readDrawing(home, a)).toBe(drawing("#aa0000"))
    expect(await readDrawing(home, b)).toBe(drawing("#00bb00"))
    expect(readdirSync(path.join(home, ".drawings")).filter((n) => n.endsWith(".json"))).toHaveLength(2)
  })

  it("has none for a note nobody drew on", async () => {
    const home = scratch()
    const file = note(home, "blank.md")
    setProjectFolders([home])
    expect(await readDrawing(home, file)).toBeNull()
    expect(existsSync(path.join(home, ".drawings"))).toBe(false)
  })

  it("reads the place drawings were kept before (the notes root, hashed by the absolute path), and moves them on the next save", async () => {
    const home = scratch()
    const file = note(home, "old.md")
    setProjectFolders([home])
    mkdirSync(path.join(home, ".drawings"))
    const older = path.join(home, ".drawings", `old-${createHash("sha1").update(file).digest("hex").slice(0, 12)}.json`)
    writeFileSync(older, drawing("#333333"))
    expect(await readDrawing(home, file)).toBe(drawing("#333333"))
    await writeDrawing(home, file, drawing("#444444"))
    expect(existsSync(older)).toBe(false)
    expect(existsSync(drawingPath(home, file))).toBe(true)
    expect(await readDrawing(home, file)).toBe(drawing("#444444"))
  })

  it("reads a folder's pictures-and-drawings from the notes root for a note in another folder, as before", async () => {
    const home = scratch()
    const other = scratch()
    const file = note(other, "foreign.md")
    setProjectFolders([home, other])
    mkdirSync(path.join(home, ".drawings"))
    const older = path.join(home, ".drawings", `foreign-${createHash("sha1").update(file).digest("hex").slice(0, 12)}.json`)
    writeFileSync(older, drawing("#555555"))
    expect(await readDrawing(home, file)).toBe(drawing("#555555"))
    await writeDrawing(home, file, drawing("#666666"))
    expect(existsSync(older)).toBe(false)
    expect(existsSync(path.join(other, ".drawings"))).toBe(true)
  })
})

describe("a Mac notebook's drawings", () => {
  const MAC = JSON.stringify({ items: [
    { kind: "stroke", stroke: { id: "A1B2C3D4-0000-4000-8000-000000000001", colorHex: "#2FBF71", width: 2, points: [[0.1, 0.1], [0.2, 0.2]] } },
    { kind: "image", image: { file: "pic.png", width: 0.3, aspect: 1 } },
  ] })

  it("show up (converted) for notes that have no drawing of their own yet", async () => {
    const home = scratch()
    const file = note(home, "FromMac.md")
    setProjectFolders([home])
    mkdirSync(path.join(home, ".drawings"))
    writeFileSync(path.join(home, ".drawings", "FromMac.json"), MAC)
    const shown = parseDrawing(await readDrawing(home, file))
    expect(shown.items.map((item) => item.kind)).toEqual(["stroke", "image"])
    expect(shown.items[0]).toMatchObject({ stroke: { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] } })
  })

  it("are NEVER written: an edit here makes this app's own file and leaves the Mac's untouched", async () => {
    const home = scratch()
    const file = note(home, "FromMac.md")
    setProjectFolders([home])
    mkdirSync(path.join(home, ".drawings"))
    const macFile = path.join(home, ".drawings", "FromMac.json")
    writeFileSync(macFile, MAC)
    await writeDrawing(home, file, drawing("#777777"))
    expect(readFileSync(macFile, "utf8")).toBe(MAC)
    expect(await readDrawing(home, file)).toBe(drawing("#777777"))
    // Rubbing everything out here does not bring the Mac's drawing back.
    await writeDrawing(home, file, JSON.stringify({ items: [] }))
    expect(parseDrawing(await readDrawing(home, file)).items).toEqual([])
  })

  it("follow a note that is renamed, as a drawing of its own", async () => {
    const home = scratch()
    const file = note(home, "FromMac.md")
    setProjectFolders([home])
    mkdirSync(path.join(home, ".drawings"))
    const macFile = path.join(home, ".drawings", "FromMac.json")
    writeFileSync(macFile, MAC)
    const next = await renameNote(home, file, "Renamed")
    expect(parseDrawing(await readDrawing(home, next)).items).toHaveLength(2)
    expect(readFileSync(macFile, "utf8")).toBe(MAC)
  })
})

describe("pictures", () => {
  it("go to the media folder of the project folder the note is in", async () => {
    const home = scratch()
    const other = scratch()
    const file = note(other, "pics.md")
    setProjectFolders([home, other])
    const { file: stored } = await saveMedia(home, new Uint8Array([1, 2, 3, 4]), ".png", file)
    expect(existsSync(path.join(other, ".drawings", "media", stored))).toBe(true)
    expect(existsSync(path.join(home, ".drawings"))).toBe(false)
    expect(await findMedia(home, stored)).toBe(path.join(other, ".drawings", "media", stored))
    expect(mediaPath(home, stored)).toBe(path.join(other, ".drawings", "media", stored))
  })

  it("go to the folder of the note in front when the page does not say", async () => {
    const home = scratch()
    const other = scratch()
    const file = note(other, "front.md")
    setProjectFolders([home, other])
    await readDrawing(home, file)
    const { file: stored } = await saveMedia(home, new Uint8Array([9, 9, 9]), "png")
    expect(existsSync(path.join(other, ".drawings", "media", stored))).toBe(true)
  })

  it("are found wherever a project folder keeps them: the Mac's, a Mac notebook's, the notes root's", async () => {
    const home = scratch()
    const other = scratch()
    setProjectFolders([home, other])
    mkdirSync(path.join(other, ".drawings", "media"), { recursive: true })
    writeFileSync(path.join(other, ".drawings", "media", "MAC-UUID.png"), "x")
    mkdirSync(path.join(home, ".drawings", "media"), { recursive: true })
    writeFileSync(path.join(home, ".drawings", "media", "legacy.png"), "y")
    expect(await findMedia(home, "MAC-UUID.png")).toBe(path.join(other, ".drawings", "media", "MAC-UUID.png"))
    expect(await findMedia(home, "legacy.png")).toBe(path.join(home, ".drawings", "media", "legacy.png"))
    expect(await findMedia(home, "nowhere.png")).toBe(path.join(home, ".drawings", "media", "nowhere.png"))
  })

  it("travel with a drawing that moves to another project folder", async () => {
    const home = scratch()
    const other = scratch()
    const file = note(home, "pic.md")
    setProjectFolders([home, other])
    const { file: stored } = await saveMedia(home, new Uint8Array([5, 6, 7]), ".png", file)
    await writeDrawing(home, file, JSON.stringify({ items: [{ kind: "image", id: "i1", file: stored, center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 1, hidden: false }] }))
    const landed = await placeNote(home, file, other, null)
    expect(existsSync(path.join(other, ".drawings", "media", stored))).toBe(true)
    expect(parseDrawing(await readDrawing(home, landed)).items).toHaveLength(1)
    expect(existsSync(drawingPath(home, file))).toBe(false)
  })
})

describe("renaming and moving keep the drawing and the place", () => {
  it("a renamed note keeps its drawing and its place in the order (the Mac's rename)", async () => {
    const home = scratch()
    const a = note(home, "a.md")
    const b = note(home, "b.md")
    note(home, "c.md")
    setProjectFolders([home])
    await reorder(home, home, ["a.md", "b.md", "c.md"])
    await writeDrawing(home, b, drawing("#888888"))
    const beta = await renameNote(home, b, "Beta")
    expect(path.basename(beta)).toBe("Beta.md")
    expect(await readDrawing(home, beta)).toBe(drawing("#888888"))
    expect(existsSync(drawingPath(home, b))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(home, ".writemind", "order.json"), "utf8")).folders[""]).toEqual(["a.md", "Beta.md", "c.md"])
    expect(a).toBeTruthy()
  })

  it("a name with characters Windows refuses is made fit, not thrown at the disk", async () => {
    const home = scratch()
    setProjectFolders([home])
    // typed, what it becomes on Windows, what it becomes elsewhere
    const cases: Array<[string, string, string]> = [
      ["What now?", "What now.md", "What now?.md"], ["a*b", "ab.md", "a*b.md"], ['say "hi"', "say 'hi'.md", 'say "hi".md'],
      ["x|y", "x-y.md", "x|y.md"], ["<draft>", "draft.md", "<draft>.md"], ["Ideas.", "Ideas.md", "Ideas.md"],
      ["a:b/c", "a-b-c.md", "a-b-c.md"], ["CON", "CON-.md", "CON.md"], ["", "Untitled.md", "Untitled.md"],
    ]
    let index = 0
    for (const [typed, onWindows, elsewhere] of cases) {
      const file = note(home, `src-${index++}.md`)
      const next = await renameNote(home, file, typed)
      expect(path.basename(next)).toBe(process.platform === "win32" ? onWindows : elsewhere)
      expect(existsSync(next)).toBe(true)
      expect(existsSync(file)).toBe(false)
    }
    // 300 characters is cut, not refused.
    const long = note(home, "long.md")
    const next = await renameNote(home, long, "q".repeat(300))
    expect(existsSync(next)).toBe(true)
    expect(path.basename(next).length).toBeLessThanOrEqual(104)
  })

  it("a renamed section keeps every drawing inside it, is never renamed to nothing, and a project folder is not renamed", async () => {
    const home = scratch()
    const inside = note(path.join(home, "Old"), "n.md")
    setProjectFolders([home])
    await writeDrawing(home, inside, drawing("#999999"))
    // "..." leaves nothing anywhere (a leading dot is never kept); "???" leaves nothing only on Windows, which
    // stores none of those — on a Mac it is a fine folder name (fileNames.test.ts has both sides of safeName).
    expect(await renameSection(home, path.join(home, "Old"), "...")).toBeNull()
    if (process.platform === "win32") expect(await renameSection(home, path.join(home, "Old"), "???")).toBeNull()
    expect(await renameSection(home, home, "Other")).toBeNull()
    const renamed = await renameSection(home, path.join(home, "Old"), "What now?")
    expect(renamed && path.basename(renamed)).toBe(process.platform === "win32" ? "What now" : "What now?")
    expect(await readDrawing(home, path.join(renamed!, "n.md"))).toBe(drawing("#999999"))
  })

  it("a section moved into another keeps its drawings and its place; a project folder cannot be moved", async () => {
    const home = scratch()
    const inside = note(path.join(home, "Src"), "n.md")
    mkdirSync(path.join(home, "Dst"))
    setProjectFolders([home])
    await writeDrawing(home, inside, drawing("#abcdef"))
    expect(await moveSection(home, home, path.join(home, "Dst"))).toBeNull()
    const landed = await moveSection(home, path.join(home, "Src"), path.join(home, "Dst"))
    expect(landed).toBe(path.join(home, "Dst", "Src"))
    expect(await readDrawing(home, path.join(landed!, "n.md"))).toBe(drawing("#abcdef"))
  })

  it("a duplicate gets a copy of the drawing and sits right after the original", async () => {
    const home = scratch()
    const a = note(home, "a.md")
    const b = note(home, "b.md")
    // The list is newest first: a is the newer one by a clear margin, not by the clock ticking between two writes.
    fs.utimesSync(b, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
    fs.utimesSync(a, new Date(), new Date())
    setProjectFolders([home])
    await writeDrawing(home, a, drawing("#010101"))
    const copy = await duplicateNote(home, a)
    expect(await readDrawing(home, copy)).toBe(drawing("#010101"))
    expect((await projectTree([home], home, "P")).notes.map((n) => path.basename(n.path)).slice(0, 2)).toEqual(["a.md", "a copy.md"])
  })
})

describe("the notes themselves", () => {
  it("are saved whole and leave nothing beside them", async () => {
    const home = scratch()
    const file = note(home, "n.md", "first")
    await readNote(file)
    const out = await writeNote(file, "second")
    expect(out.written).toBe(true)
    expect(readFileSync(file, "utf8")).toBe("second")
    expect(names(home)).toEqual(["n.md"])
  })

  it("say so, in the system's words, when the file is read-only — and are not changed", async () => {
    const home = scratch()
    const file = note(home, "locked.md", "as it was")
    await readNote(file)
    chmodSync(file, 0o444)
    try {
      await expect(writeNote(file, "typed since")).rejects.toMatchObject({ code: expect.stringMatching(/EPERM|EACCES/) })
      expect(readFileSync(file, "utf8")).toBe("as it was")
      expect(names(home)).toEqual(["locked.md"])
    } finally { chmodSync(file, 0o644) }
  })

  it("refuse to overwrite a file somebody else changed, as before", async () => {
    const home = scratch()
    const file = note(home, "shared.md", "mine")
    await readNote(file)
    writeFileSync(file, "theirs")
    const out = await writeNote(file, "mine again")
    expect(out.written).toBe(false)
    expect(readFileSync(file, "utf8")).toBe("theirs")
  })

  it("are never made over a file that appeared since the name was looked for", async () => {
    const home = scratch()
    const made = await Promise.all(Array.from({ length: 8 }, () => createNote(home)))
    expect(new Set(made).size).toBe(8)
    expect(names(home)).toHaveLength(8)
  })
})

describe("a big folder", () => {
  it("is read with every note's own heading, however many there are", async () => {
    const home = scratch()
    for (let n = 0; n < 700; n++) writeFileSync(path.join(home, `note-${n}.md`), `# Heading ${n}\n\nbody\n`)
    const tree = await readTree(home, home, { folders: {} })
    expect(tree.notes).toHaveLength(700)
    expect(tree.notes.every((row) => row.title === `Heading ${path.basename(row.path).replace(/\D/g, "")}`)).toBe(true)
  })

  it("does not remember a row it could not read as if it were the note (EMFILE gave file names for titles that stuck)", async () => {
    const home = scratch()
    const file = note(home, "real.md", "# The Real Heading\n")
    note(home, "other.md", "# Other\n")
    const open = fsp.open.bind(fsp)
    let failing = true
    vi.spyOn(fsp, "open").mockImplementation(async (target, ...rest) => {
      if (failing && String(target).endsWith("real.md")) throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" })
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
    const a = note(home, "a.md", "# First\n")
    note(home, "b.md", "# Second\n")
    setWatched([home])
    expect(titles(await projectTree([home], home, "P"))).toEqual(["First", "Second"])       // the full look
    // changed behind its back: the cache stands (the watcher has not said a word)
    writeFileSync(a, "# Changed behind the watcher\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["First", "Second"])
    // the watcher says so: looked at again
    fileChanged(a)
    expect(titles(await projectTree([home], home, "P"))).toEqual(["Changed behind the watcher", "Second"])
  })

  it("sees a new file, a removed file and a rename at once: the listing is always read", async () => {
    const home = scratch()
    const a = note(home, "a.md", "# A\n")
    setWatched([home])
    await projectTree([home], home, "P")
    note(home, "c.md", "# C\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["A", "C"])
    await fsp.rm(a)
    expect(titles(await projectTree([home], home, "P"))).toEqual(["C"])
  })

  it("trusts nothing without a watcher, and nothing after the watcher failed", async () => {
    const home = scratch()
    const a = note(home, "a.md", "# One\n")
    await projectTree([home], home, "P")
    // The size differs, so the stat tells even inside one tick of the file clock (no watcher on: every look is a full
    // one). ("# Two\n" was as long as "# One\n": the test then hung on the file time changing, and failed now and then.)
    writeFileSync(a, "# Two words\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["Two words"])
    setWatched([home])
    await projectTree([home], home, "P")
    writeFileSync(a, "# Three\n")
    forgetTrust()
    expect(titles(await projectTree([home], home, "P"))).toEqual(["Three"])
  })

  it("our own saves are looked at again (a save is a write the watcher also hears, but not before the next look)", async () => {
    const home = scratch()
    const a = note(home, "a.md", "# Before\n")
    setWatched([home])
    await readNote(a)
    await projectTree([home], home, "P")
    await writeNote(a, "# After the save\n")
    expect(titles(await projectTree([home], home, "P"))).toEqual(["After the save"])
  })

  it("a write inside a folder is an echo for the folder too", async () => {
    const home = scratch()
    const inner = path.join(home, "Section")
    const a = note(inner, "a.md", "# A\n")
    await readNote(a)
    await writeNote(a, "# A2\n")
    expect(wroteRecently(a)).toBe(true)
    expect(wroteRecently(inner)).toBe(true)
    expect(wroteRecently(path.join(home, "Other"))).toBe(false)
    expect(wroteRecently(home)).toBe(true)
  })
})
