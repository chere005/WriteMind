// Housekeeping (main/housekeeping.ts, docs\TODO.md "Housekeeping"): a deleted note takes its drawing to the bin, and
// File ▸ Clean Up Unused Files… offers the drawings and media nothing uses. All on scratch folder trees; the "bin" is
// a folder of the test's own, so a file that went anywhere else (or nowhere) shows.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { drawingPath, olderDrawingPath, setExcluded, setProjectFolders } from "../src/main/notes"
import {
  findUnused, SHARED_STORE_UNTIL, trashNoteAndDrawing, trashSectionAndDrawings, trashUnused,
} from "../src/main/housekeeping"
import { cleanUpTitle, formatBytes, namesIn } from "../src/shared/housekeeping"
import { EditorState } from "@codemirror/state"
import { history, isolateHistory } from "@codemirror/commands"
import { heldBy } from "../src/renderer/cleanUp"
import { historyOf, keepOnly as keepHistory } from "../src/renderer/noteHistory"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-house-"))
const HOUR_AGO = Date.now() / 1000 - 3600

/** A file, an hour old unless `fresh` (Clean Up never offers one changed in the last ten minutes). */
const put = (file: string, text: string, fresh = false): string => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  if (!fresh) utimesSync(file, HOUR_AGO, HOUR_AGO)
  return file
}
const picture = (folder: string, name: string, fresh = false) => put(path.join(folder, ".drawings", "media", name), "PNG", fresh)
const stroke = { kind: "stroke", id: "s1", colorHex: "#000000", width: 3, points: [{ x: 0.1, y: 0.1 }], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null }
const image = (file: string) => ({
  kind: "image", id: `i-${file}`, file, center: { x: 0.5, y: 0.5 }, size: { width: 0.2, height: 0.2 },
  transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null,
})
const sidecarOf = (root: string, note: string, items: unknown[] = [stroke], fresh = false) =>
  put(drawingPath(root, note), JSON.stringify({ items }), fresh)
/** The drawing a deleted note (`relative` to the root, not on disk) left behind, under its own real name. */
const leftBy = (root: string, relative: string, items: unknown[] = [stroke], fresh = false) =>
  sidecarOf(root, path.join(root, relative), items, fresh)

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

describe("deleting a note takes its drawing to the bin", () => {
  it("the note, then its sidecar, both to the bin; other notes keep theirs", async () => {
    const root = scratch()
    setProjectFolders([root])
    const gone = put(path.join(root, "Gone.md"), "# gone\n")
    const stays = put(path.join(root, "Stays.md"), "# stays\n")
    const goneDrawing = sidecarOf(root, gone)
    const staysDrawing = sidecarOf(root, stays)
    const bin = makeBin()
    const went = await trashNoteAndDrawing(root, gone, bin.trash)
    same(bin.moved, [gone, goneDrawing])
    same(went, [goneDrawing])
    expect(existsSync(staysDrawing)).toBe(true)
    expect(readdirSync(bin.folder)).toHaveLength(2)
  })

  it("a note with no drawing just goes; a note that will not go keeps its drawing too", async () => {
    const root = scratch()
    setProjectFolders([root])
    const plain = put(path.join(root, "Plain.md"), "words\n")
    const bin = makeBin()
    expect(await trashNoteAndDrawing(root, plain, bin.trash)).toEqual([])
    same(bin.moved, [plain])
    const stuck = put(path.join(root, "Stuck.md"), "words\n")
    const drawing = sidecarOf(root, stuck)
    await expect(trashNoteAndDrawing(root, stuck, async () => { throw new Error("in use") })).rejects.toThrow("in use")
    expect(existsSync(stuck) && existsSync(drawing)).toBe(true)
  })

  it("a sidecar shared by name (the Mac's <stem>.json, two notes of one name in two sections) never goes with one of them", async () => {
    const root = scratch()
    setProjectFolders([root])
    const one = put(path.join(root, "A", "Notes.md"), "one\n")
    const two = put(path.join(root, "B", "Notes.md"), "two\n")
    const mac = put(path.join(root, ".drawings", "Notes.json"), JSON.stringify({ items: [] }))
    const own = sidecarOf(root, two)
    const bin = makeBin()
    await trashNoteAndDrawing(root, two, bin.trash)
    same(bin.moved, [two, own])
    expect(existsSync(mac)).toBe(true)
    // The last note of that name takes the Mac's file with it.
    await trashNoteAndDrawing(root, one, bin.trash)
    expect(existsSync(mac)).toBe(false)
    expect(bin.moved.map((file) => path.basename(file))).toContain("Notes.json")
  })

  it("a section in the bin takes the drawings of every note in it (they live in the project folder's .drawings)", async () => {
    const root = scratch()
    setProjectFolders([root])
    const a = put(path.join(root, "Sec", "A.md"), "a\n")
    const b = put(path.join(root, "Sec", "Deep", "B.md"), "b\n")
    const out = put(path.join(root, "Out.md"), "out\n")
    const drawings = [sidecarOf(root, a), sidecarOf(root, b)]
    const outDrawing = sidecarOf(root, out)
    const bin = makeBin()
    await trashSectionAndDrawings(root, path.join(root, "Sec"), bin.trash)
    same(bin.moved, [path.join(root, "Sec"), ...drawings])
    expect(existsSync(outDrawing)).toBe(true)
  })
})

describe("Clean Up Unused Files…", () => {
  it("finds the drawings of deleted notes and the media nothing names; keeps what a note or a drawing uses", async () => {
    const root = scratch()
    setProjectFolders([root])
    const note = put(path.join(root, "Sec", "Kept.md"), "# kept\n\n![](../.drawings/media/docked.png)\n\nInline ![x](../.drawings/media/inline%20one.png) here.\n")
    sidecarOf(root, note, [image("floating.png"), { kind: "cell", id: "0b0c0d0e-1111-4222-8333-444455556666", aspect: 0.5, items: [image("in-cell.png")] }])
    for (const name of ["docked.png", "inline one.png", "floating.png", "in-cell.png", "ink-0b0c0d0e-1111-4222-8333-444455556666.svg"]) picture(root, name)
    // Sean's case: four notes deleted, their sidecars stayed.
    const orphans = ["One", "Two", "Three", "Four"].map((name) => leftBy(root, `${name}.md`))
    const loose = [picture(root, "nobody.png"), picture(root, "ink-99999999-1111-4222-8333-444455556666.svg")]
    const scan = await findUnused(root, [root])
    expect(scan.problem).toBeNull()
    same(scan.files.map((one) => one.path), [...orphans, ...loose])
    expect(scan.files.slice(0, 4).every((one) => one.kind === "drawing")).toBe(true)
    expect(scan.files.find((one) => one.path.endsWith("nobody.png"))!.relative).toBe(".drawings/media/nobody.png")
    expect(scan.bytes).toBe(scan.files.reduce((sum, one) => sum + one.size, 0))
  })

  it("never offers a file changed in the last ten minutes", async () => {
    const root = scratch()
    setProjectFolders([root])
    put(path.join(root, "Note.md"), "words\n")
    leftBy(root, "Gone.md", [], true)
    picture(root, "just-pasted.png", true)
    const old = picture(root, "old.png")
    const scan = await findUnused(root, [root])
    same(scan.files.map((one) => one.path), [old])
    expect(scan.recent).toBe(2)
  })

  it("keeps a picture one folder of the project names from another, and the drawings of notes in hidden-from-sidebar folders", async () => {
    const a = scratch()
    const b = scratch()
    setProjectFolders([a, b])
    setExcluded([path.join(a, "Hidden")])
    const shared = picture(a, "shared.png")
    put(path.join(b, "Uses.md"), "![](.drawings/media/shared.png)\n")
    const hidden = put(path.join(a, "Hidden", "Kept out.md"), "words\n")
    const hiddenDrawing = sidecarOf(a, hidden, [image("hidden-pic.png")])
    picture(a, "hidden-pic.png")
    const scan = await findUnused(a, [a, b])
    expect(scan.problem).toBeNull()
    expect(scan.files.map((one) => one.path)).not.toContain(shared)
    expect(scan.files.map((one) => one.path)).not.toContain(hiddenDrawing)
    expect(scan.files).toEqual([])
  })

  it("a drawing shared by name, or whose note's name is still in the project, is never offered", async () => {
    const root = scratch()
    setProjectFolders([root])
    put(path.join(root, "A", "Notes.md"), "a\n")
    put(path.join(root, "B", "Notes.md"), "b\n")
    const mac = put(path.join(root, ".drawings", "Notes.json"), "{\"items\":[]}")
    // A note moved in Explorer: its drawing's name (the old path's hash) answers to nothing, but its note is there.
    const moved = put(path.join(root, ".drawings", "Notes-0123456789ab.json"), "{\"items\":[]}")
    const scan = await findUnused(root, [root])
    expect(scan.files.map((one) => one.path)).not.toContain(mac)
    expect(scan.files.map((one) => one.path)).not.toContain(moved)
    expect(scan.files).toEqual([])
  })

  it("the notes root's .drawings is shared with every project: only what is provably this project's is offered", async () => {
    // Before 0.3 every note of every project kept its drawing in the root's .drawings, named by its absolute path.
    const root = scratch()
    const elsewhere = scratch()
    const lecture = put(path.join(elsewhere, "Lecture.md"), "# lecture\n")
    mkdirSync(path.join(root, "Sub"), { recursive: true })
    const theirs = put(olderDrawingPath(root, lecture), JSON.stringify({ items: [image("legacy-pic.png")] }))
    const theirPic = picture(root, "legacy-pic.png")
    // A picture of the shared store from before 0.3 that no drawing here names: it may be another project's.
    const oldStore = picture(root, "old-store.png")
    const before = SHARED_STORE_UNTIL / 1000 - 86400
    utimesSync(oldStore, before, before)
    // This project's own: an older-named drawing of a note that was in its Sub folder, and a stray picture of now.
    const ours = put(olderDrawingPath(root, path.join(root, "Sub", "Old.md")), JSON.stringify({ items: [stroke] }))
    const stray = picture(root, "stray.png")
    setProjectFolders([root])
    const scan = await findUnused(root, [root])
    expect(scan.problem).toBeNull()
    same(scan.files.map((one) => one.path), [ours, stray])
    expect(existsSync(theirs) && existsSync(theirPic) && existsSync(oldStore)).toBe(true)
    // The same old picture in a folder that is not the root is this project's alone, and is offered.
    const other = scratch()
    put(path.join(other, "Note.md"), "words\n")
    const oldThere = picture(other, "old-there.png")
    utimesSync(oldThere, before, before)
    setProjectFolders([other])
    same((await findUnused(root, [other])).files.map((one) => one.path), [oldThere])
  })

  it("never offers what the window holds: an open note's drawing, a picture in its unsaved words or its Undo", async () => {
    const root = scratch()
    setProjectFolders([root])
    const openGone = path.join(root, "Open but deleted.md")
    const drawing = sidecarOf(root, openGone)
    const inUndo = picture(root, "in-undo.png")
    const loose = picture(root, "loose.png")
    const scan = await findUnused(root, [root], { openNotes: [openGone], held: ["in-undo.png"] })
    same(scan.files.map((one) => one.path), [loose])
    expect(scan.files.map((one) => one.path)).not.toContain(drawing)
    expect(scan.files.map((one) => one.path)).not.toContain(inUndo)
  })

  it("offers nothing when a folder of the project is not there", async () => {
    const root = scratch()
    setProjectFolders([root])
    picture(root, "loose.png")
    const scan = await findUnused(root, [root, path.join(root, "..", "not-there-at-all")])
    expect(scan.files).toEqual([])
    expect(scan.problem).toMatch(/not there/)
  })

  it("the bin takes only what was said yes to and is still unused, drawings first, their pictures after them", async () => {
    const root = scratch()
    setProjectFolders([root])
    // A deleted note's drawing and the picture only it used: both offered, both go.
    const orphan = leftBy(root, "Deleted.md", [image("its-pic.png")])
    const itsPic = picture(root, "its-pic.png")
    const later = picture(root, "named-later.png")
    const notAsked = picture(root, "not-asked.png")
    const scan = await findUnused(root, [root])
    same(scan.files.map((one) => one.path), [orphan, itsPic, later, notAsked])
    // Between the dialog and the click a note starts using one.
    put(path.join(root, "New.md"), "![](.drawings/media/named-later.png)\n", true)
    const bin = makeBin()
    const result = await trashUnused(root, [root], [orphan, itsPic, later], { openNotes: [], held: [] }, bin.trash)
    expect(result.problem).toBeNull()
    same(result.moved, [orphan, itsPic])
    same(bin.moved, [orphan, itsPic])
    expect(existsSync(later) && existsSync(notAsked)).toBe(true)
    expect(bin.moved[0]).toBe(orphan)
  })

  it("a drawing that will not go keeps its pictures", async () => {
    const root = scratch()
    setProjectFolders([root])
    const orphan = leftBy(root, "Deleted.md", [image("its-pic.png")])
    const itsPic = picture(root, "its-pic.png")
    const trash = async (file: string) => { if (file === orphan) throw new Error("in use") }
    const result = await trashUnused(root, [root], [orphan, itsPic], { openNotes: [], held: [] }, trash)
    same(result.failed, [orphan])
    expect(result.moved).toEqual([])
    expect(existsSync(itsPic)).toBe(true)
  })
})

describe("what the window holds (renderer/cleanUp.ts)", () => {
  it("names a picture that is only in a note's Undo — its words' history and its drawing's", () => {
    const line = "\n![](.drawings/media/only-in-undo.png)\n"
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
