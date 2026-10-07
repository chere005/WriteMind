// Housekeeping (main/housekeeping.ts, docs\TODO.md "Housekeeping"): a deleted note takes everything with it to the bin
// (its drawing and pictures are inside it), and File ▸ Clean Up Unused Files… offers the pictures and snapshots inside the
// notes that nothing names. All on scratch folder trees; the "bin" is a folder of the test's own, so a file that went
// anywhere else (or nowhere) shows.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, utimesSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { setExcluded, setProjectFolders } from "../src/main/notes"
import { entryPath, findUnused, trashNote, trashSection, trashUnused } from "../src/main/housekeeping"
import { cleanUpTitle, formatBytes, namesIn } from "../src/shared/housekeeping"
import { EditorState } from "@codemirror/state"
import { history, isolateHistory } from "@codemirror/commands"
import { heldBy } from "../src/renderer/cleanUp"
import { historyOf, keepOnly as keepHistory } from "../src/renderer/noteHistory"
import { readWm, writeWm, type WmExtras } from "./wmFiles"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-house-"))
const HOUR_AGO = Date.now() / 1000 - 3600
const INK = "0b0c0d0e-1111-4222-8333-444455556666"

/** A note, an hour old unless `fresh` (Clean Up never offers from one changed in the last ten minutes). */
const note = (file: string, text: string, extras: WmExtras = {}, fresh = false): string => {
  writeWm(file, text, extras)
  if (!fresh) utimesSync(file, HOUR_AGO, HOUR_AGO)
  return file
}
const stroke = { kind: "stroke", id: "s1", colorHex: "#000000", width: 3, points: [{ x: 0.1, y: 0.1 }], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null }
const image = (file: string) => ({
  kind: "image", id: `i-${file}`, file, center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 1,
  transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, hidden: false, group: null,
})
const drawingOf = (...items: unknown[]): string => JSON.stringify({ items })

/** A bin of the test's own: what is trashed is moved there (and listed), never deleted. */
function makeBin() {
  const folder = scratch()
  const moved: string[] = []
  let count = 0
  const trash = async (file: string) => {
    renameSync(file, path.join(folder, `${count++}-${path.basename(file)}`))
    moved.push(file)
  }
  return { folder, moved, trash }
}
const same = (a: string[], b: string[]) => expect([...a].map((one) => path.resolve(one)).sort()).toEqual([...b].map((one) => path.resolve(one)).sort())

afterEach(() => { setProjectFolders([]); setExcluded([]) })

describe("deleting a note takes everything in it to the bin", () => {
  it("the note goes whole (drawing and pictures inside it); other notes keep theirs", async () => {
    const root = scratch()
    setProjectFolders([root])
    const gone = note(path.join(root, "Gone.wm"), "# gone\n", { drawing: drawingOf(stroke), entries: { "media/a.png": "PNG" } })
    const stays = note(path.join(root, "Stays.wm"), "# stays\n", { drawing: drawingOf(stroke) })
    const bin = makeBin()
    await trashNote(gone, bin.trash)
    same(bin.moved, [gone])
    expect(existsSync(stays)).toBe(true)
    // What went to the bin is the note as it was: put back, it has its drawing and its picture.
    const back = readWm(path.join(bin.folder, readdirSync(bin.folder)[0]!))
    expect(JSON.parse(back.drawing!).items).toHaveLength(1)
    expect(back.entries["media/a.png"]!.toString()).toBe("PNG")
  })

  it("a note that will not go stays whole", async () => {
    const root = scratch()
    setProjectFolders([root])
    const stuck = note(path.join(root, "Stuck.wm"), "words\n", { drawing: drawingOf(stroke) })
    await expect(trashNote(stuck, async () => { throw new Error("in use") })).rejects.toThrow("in use")
    expect(readWm(stuck).text).toBe("words\n")
  })

  it("a section in the bin takes every note in it, with what is inside each", async () => {
    const root = scratch()
    setProjectFolders([root])
    const a = note(path.join(root, "Sec", "A.wm"), "a\n", { drawing: drawingOf(stroke) })
    note(path.join(root, "Sec", "Deep", "B.wm"), "b\n", { drawing: drawingOf(stroke) })
    const out = note(path.join(root, "Out.wm"), "out\n", { drawing: drawingOf(stroke) })
    const bin = makeBin()
    await trashSection(path.join(root, "Sec"), bin.trash)
    same(bin.moved, [path.join(root, "Sec")])
    expect(existsSync(a)).toBe(false)
    expect(existsSync(out)).toBe(true)
  })
})

describe("Clean Up Unused Files…", () => {
  it("finds the pictures and snapshots inside a note that neither its words nor its drawing name; keeps what they use", async () => {
    const root = scratch()
    setProjectFolders([root])
    const kept = note(path.join(root, "Sec", "Kept.wm"),
      "# kept\n\n![](media/docked.png)\n\nInline ![x](media/inline%20one.png) here.\n\n![ink](snapshots/ink-" + INK + ".svg)\n", {
        drawing: drawingOf(image("floating.png"), { kind: "cell", id: INK, aspect: 0.5, items: [image("in-cell.png")] }),
        entries: {
          "media/docked.png": "d", "media/inline one.png": "i", "media/floating.png": "f", "media/in-cell.png": "c",
          [`snapshots/ink-${INK}.svg`]: "<svg/>", "media/nobody.png": "n",
          "snapshots/ink-99999999-1111-4222-8333-444455556666.svg": "<svg/>", "legacy/sidecar.json": "{}", "extra/unknown.bin": "u",
        },
      })
    const scan = await findUnused(root, [root])
    expect(scan.problem).toBeNull()
    same(scan.files.map((one) => one.path), [entryPath(kept, "media/nobody.png"), entryPath(kept, "snapshots/ink-99999999-1111-4222-8333-444455556666.svg")])
    expect(scan.files.every((one) => one.kind === "media")).toBe(true)
    expect(scan.files.find((one) => one.path.endsWith("nobody.png"))!.relative).toBe("Sec/Kept.wm/media/nobody.png")
    expect(scan.bytes).toBe(scan.files.reduce((sum, one) => sum + one.size, 0))
  })

  it("never offers from a note changed in the last ten minutes", async () => {
    const root = scratch()
    setProjectFolders([root])
    note(path.join(root, "Fresh.wm"), "words\n", { entries: { "media/just-pasted.png": "x" } }, true)
    const old = note(path.join(root, "Old.wm"), "words\n", { entries: { "media/old.png": "x" } })
    const scan = await findUnused(root, [root])
    same(scan.files.map((one) => one.path), [entryPath(old, "media/old.png")])
    expect(scan.recent).toBe(1)
  })

  it("looks in the notes of folders kept out of the sidebar, and of every folder of the project", async () => {
    const a = scratch()
    const b = scratch()
    setProjectFolders([a, b])
    setExcluded([path.join(a, "Hidden")])
    const hidden = note(path.join(a, "Hidden", "Kept out.wm"), "words\n", { drawing: drawingOf(image("hidden-pic.png")), entries: { "media/hidden-pic.png": "h", "media/loose.png": "l" } })
    const other = note(path.join(b, "Other.wm"), "words\n", { entries: { "media/other-loose.png": "o" } })
    const scan = await findUnused(a, [a, b])
    expect(scan.problem).toBeNull()
    same(scan.files.map((one) => one.path), [entryPath(hidden, "media/loose.png"), entryPath(other, "media/other-loose.png")])
  })

  it("never offers what the window holds: a picture in its unsaved words or its Undo", async () => {
    const root = scratch()
    setProjectFolders([root])
    const open = note(path.join(root, "Open.wm"), "words\n", { entries: { "media/in-undo.png": "u", "media/loose.png": "l" } })
    const scan = await findUnused(root, [root], { openNotes: [open], held: ["in-undo.png"] })
    same(scan.files.map((one) => one.path), [entryPath(open, "media/loose.png")])
  })

  it("never offers anything from a note of a newer format (it is read-only here)", async () => {
    const root = scratch()
    setProjectFolders([root])
    note(path.join(root, "Future.wm"), "words\n", { manifest: { version: 2 }, entries: { "media/loose.png": "l" } })
    expect((await findUnused(root, [root])).files).toEqual([])
  })

  it("offers nothing when a folder of the project is not there, or a note cannot be read", async () => {
    const root = scratch()
    setProjectFolders([root])
    note(path.join(root, "A.wm"), "words\n", { entries: { "media/loose.png": "l" } })
    const missing = await findUnused(root, [root, path.join(root, "..", "not-there-at-all")])
    expect(missing.files).toEqual([])
    expect(missing.problem).toMatch(/not there/)
    mkdirSync(path.join(root, "B"))
    renameSync(path.join(root, "A.wm"), path.join(root, "B", "A.wm"))
    const junk = path.join(root, "Broken.wm")
    note(junk, "x")
    const fs = await import("node:fs")
    fs.writeFileSync(junk, "this is not an archive")
    const unreadable = await findUnused(root, [root])
    expect(unreadable.files).toEqual([])
    expect(unreadable.problem).toMatch(/could not be read/)
  })

  it("the bin takes only what was said yes to and is still unused; each picture goes as a file, and out of its note", async () => {
    const root = scratch()
    setProjectFolders([root])
    const target = note(path.join(root, "N.wm"), "words\n", { entries: { "media/gone.png": "GONE", "media/later.png": "later", "media/not-asked.png": "na" } })
    const scan = await findUnused(root, [root])
    same(scan.files.map((one) => one.path), [entryPath(target, "media/gone.png"), entryPath(target, "media/later.png"), entryPath(target, "media/not-asked.png")])
    // Between the dialog and the click the note starts using one: a second look sees it.
    const fs = await import("node:fs")
    const { loadNote, writeText } = await import("../src/main/wmStore")
    await loadNote(target)
    expect((await writeText(target, "words\n\n![](media/later.png)\n")).written).toBe(true)
    fs.utimesSync(target, HOUR_AGO, HOUR_AGO)
    const bin = makeBin()
    const result = await trashUnused(root, [root], [entryPath(target, "media/gone.png"), entryPath(target, "media/later.png")],
      { openNotes: [], held: [] }, bin.trash)
    expect(result.problem).toBeNull()
    same(result.moved, [entryPath(target, "media/gone.png")])
    // What went to the bin is a file of the picture, and the note no longer holds it.
    expect(readFileSync(path.join(bin.folder, readdirSync(bin.folder)[0]!), "utf8")).toBe("GONE")
    const after = readWm(target)
    expect(Object.keys(after.entries).filter((name) => name.startsWith("media/")).sort()).toEqual(["media/later.png", "media/not-asked.png"])
    expect(after.text).toContain("later.png")
  })

  it("a picture that will not go to the bin stays in its note", async () => {
    const root = scratch()
    setProjectFolders([root])
    const target = note(path.join(root, "N.wm"), "words\n", { entries: { "media/stuck.png": "S" } })
    const result = await trashUnused(root, [root], [entryPath(target, "media/stuck.png")], { openNotes: [], held: [] },
      async () => { throw new Error("in use") })
    same(result.failed, [entryPath(target, "media/stuck.png")])
    expect(result.moved).toEqual([])
    expect(readWm(target).entries["media/stuck.png"]!.toString()).toBe("S")
  })
})

describe("what the window holds (renderer/cleanUp.ts)", () => {
  it("names a picture that is only in a note's Undo — its words' history and its drawing's", () => {
    const line = "\n![](media/only-in-undo.png)\n"
    let state = EditorState.create({ doc: "# Note\n", extensions: [history()] })
    state = state.update({ changes: { from: state.doc.length, insert: line }, annotations: isolateHistory.of("full") }).state
    const at = state.doc.toString().indexOf(line)
    state = state.update({ changes: { from: at, to: at + line.length }, annotations: isolateHistory.of("full") }).state
    expect(state.doc.toString()).not.toContain("only-in-undo.png")
    const note = path.join(os.tmpdir(), "held-test", "Open.md")
    // (The drawing as the page holds it: an image item carries its picture under `image`.)
    historyOf(note).drawing.record({ items: [{ kind: "image", image: { file: "drawing-undo.png" } } as never] })
    const held = heldBy({ state, text: state.doc.toString(), drawings: [null], open: [note] })
    expect(held.held).toEqual(expect.arrayContaining(["only-in-undo.png", "drawing-undo.png"]))
    expect(held.openNotes).toEqual([note])
    keepHistory([])
  })
})

describe("the words and names", () => {
  it("names a text could point at a media file with", () => {
    const names = namesIn(`{"file":"ab12.png"} ![](../.drawings/media/with%20space.jpg) "id":"0B0C0D0E-1111-4222-8333-444455556666"`)
    expect(names).toEqual(expect.arrayContaining(["ab12.png", "with%20space.jpg", "with space.jpg", "ink-0b0c0d0e-1111-4222-8333-444455556666.svg"]))
  })
  it("the dialog's title", () => {
    expect(formatBytes(812)).toBe("812 bytes")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(3 * 1024 * 1024)).toBe("3 MB")
    expect(cleanUpTitle(3, 1536, "Recycle Bin")).toBe("3 unused files (1.5 KB) will go to the Recycle Bin")
    expect(cleanUpTitle(1, 10, "Trash")).toBe("1 unused file (10 bytes) will go to the Trash")
  })
})
