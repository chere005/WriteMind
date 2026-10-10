/**
 * THE UNDO JOURNAL (main/undoJournal.ts, main/undoOps.ts, docs/PLAN-undo.md): every file operation taken back and done
 * again, the backups' whole life (made first, kept, deleted at the third step back, on a new step, at quit and at the next
 * launch), the name that was taken, an undo that fails half way, a note someone else changed.
 *
 * No Swift original: the Mac app has no file-step undo (the Finder's Trash is the Mac's). Port-only, said in docs/PLAN-undo.md.
 *
 * The "file system" is a scratch folder under the OS temp directory with the real `node:fs` on it, and the bin is a
 * stand-in that moves the item into a folder of its own; faults are injected by spying on `fs.promises`, which is what the
 * journal calls.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setExcluded, setProjectFolders, setWatched, readNote, writeNote } from "../src/main/notes"
import { entryPath } from "../src/main/housekeeping"
import { UndoJournal, invert } from "../src/main/undoJournal"
import { createUndoOps } from "../src/main/undoOps"
import { NOTHING_HELD } from "../src/shared/housekeeping"
import { takenNotice } from "../src/shared/undo"
import { readWm, writeWm } from "./wmFiles"

const made: string[] = []
afterEach(() => {
  setProjectFolders([]); setExcluded([]); setWatched([])
  vi.restoreAllMocks()
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A notes folder, a bin, an app-data folder, a journal and the operations over it. */
function world(depth?: number) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wm-undo-"))
  made.push(base)
  const root = path.join(base, "notes")
  mkdirSync(root)
  setProjectFolders([root])
  const binned: string[] = []
  const binDir = path.join(base, "bin")
  const bin = async (one: string) => {
    mkdirSync(binDir, { recursive: true })
    renameSync(one, path.join(binDir, `${binned.length}-${path.basename(one)}`))
    binned.push(one)
  }
  const backups = path.join(base, "data", "undo")
  const states: number[] = []
  const journal = new UndoJournal({ backups, bin, changed: (state) => { states.push(state.undoCount) }, ...(depth ? { depth } : {}) })
  const ops = createUndoOps(journal, () => root)
  const note = (name: string, text = `# ${name}\n`) => writeWm(path.join(root, name), text)
  /** The step folders the journal holds backups in right now. */
  const stepDirs = (): string[] => {
    if (!existsSync(backups)) return []
    return readdirSync(backups).flatMap((run) => readdirSync(path.join(backups, run)))
  }
  const tree = (folder = root): string[] => {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = path.join(dir, entry.name)
        out.push(path.relative(folder, full).replace(/\\/g, "/") + (entry.isDirectory() ? "/" : ""))
        if (entry.isDirectory()) walk(full)
      }
    }
    walk(folder)
    return out
  }
  return { base, root, binDir, backups, binned, journal, ops, bin, note, stepDirs, tree, states }
}

const orderOf = (root: string, key = ""): string[] | undefined =>
  (JSON.parse(readFileSync(path.join(root, ".writemind", "order.json"), "utf8")) as { folders: Record<string, string[]> }).folders[key]

describe("a New Note is a step", () => {
  it("is taken away by Undo with what was typed in it kept, and brought back by Redo", async () => {
    const w = world()
    const file = await w.ops.createNote(w.root)
    expect(path.basename(file)).toBe("Untitled.wm")
    expect(await writeNote(file, "hello there")).toMatchObject({ written: true })
    expect(w.journal.state().undo?.label).toBe("New Note")

    const gone = await w.journal.undo()
    expect(gone).toMatchObject({ ok: true, which: "undo", label: "New Note" })
    expect(existsSync(file)).toBe(false)
    expect(gone.ok && gone.effects.removed).toEqual([file])
    expect(w.journal.state()).toMatchObject({ undo: null, redo: { label: "New Note" } })

    const back = await w.journal.redo()
    expect(back.ok && back.effects.restored).toEqual([file])
    expect(readWm(file).text).toBe("hello there")
    // The app owns it again: the next save is accepted.
    expect(await writeNote(file, "and more")).toMatchObject({ written: true })
  })

  it("is not removed when another program has changed it: the step says so and is dropped, the file stays", async () => {
    const w = world()
    const file = await w.ops.createNote(w.root)
    writeWm(file, "someone else's words")
    const out = await w.journal.undo()
    expect(out).toMatchObject({ ok: false, dropped: true })
    expect(out.ok === false && out.why).toMatch(/changed by another program/)
    expect(readWm(file).text).toBe("someone else's words")
    expect(w.journal.state().undoCount).toBe(0)
  })

  it("a name taken meanwhile gets a number on Redo, and the person is told", async () => {
    const w = world()
    const file = await w.ops.createNote(w.root)
    await w.journal.undo()
    w.note("Untitled.wm", "# somebody's\n")
    const back = await w.journal.redo()
    expect(back.ok && back.effects.restored).toEqual([path.join(w.root, "Untitled 2.wm")])
    expect(back.ok && back.effects.notices).toEqual([takenNotice("Untitled", "Untitled 2")])
    expect(readWm(file).text).toBe("# somebody's\n")
  })
})

describe("Duplicate, Rename, Move and Reorder", () => {
  it("Duplicate: the copy goes on Undo and its place in the order with it", async () => {
    const w = world()
    const a = w.note("a.wm")
    const copy = await w.ops.duplicateNote(a)
    expect(path.basename(copy)).toBe("a copy.wm")
    expect(orderOf(w.root)).toContain("a copy.wm")
    await w.journal.undo()
    expect(existsSync(copy)).toBe(false)
    expect(existsSync(a)).toBe(true)
    expect(readdirSync(w.root).filter((name) => name.endsWith(".wm"))).toEqual(["a.wm"])
    expect(orderOf(w.root)).toBeUndefined()
    await w.journal.redo()
    expect(existsSync(copy)).toBe(true)
    expect(orderOf(w.root)).toContain("a copy.wm")
  })

  it("Rename keeps its place in the order, and Undo gives name and place back", async () => {
    const w = world()
    const a = w.note("a.wm")
    w.note("b.wm")
    mkdirSync(path.join(w.root, ".writemind"))
    writeFileSync(path.join(w.root, ".writemind", "order.json"), JSON.stringify({ folders: { "": ["a.wm", "b.wm"] } }))
    const next = await w.ops.renameNote(a, "Alpha")
    expect(path.basename(next)).toBe("Alpha.wm")
    expect(orderOf(w.root)).toEqual(["Alpha.wm", "b.wm"])
    const back = await w.journal.undo()
    expect(back.ok && back.effects.moved).toEqual([{ from: next, to: a }])
    expect(existsSync(a)).toBe(true)
    expect(existsSync(next)).toBe(false)
    expect(orderOf(w.root)).toEqual(["a.wm", "b.wm"])
    await w.journal.redo()
    expect(existsSync(next)).toBe(true)
    expect(orderOf(w.root)).toEqual(["Alpha.wm", "b.wm"])
  })

  it("a rename that changes nothing is not a step", async () => {
    const w = world()
    const a = w.note("a.wm")
    await w.ops.renameNote(a, "a")
    expect(w.journal.state().undoCount).toBe(0)
  })

  it("a note that was open and saved keeps being the app's through a rename and its Undo (saves are accepted)", async () => {
    const w = world()
    const a = w.note("a.wm", "one")
    await readNote(a)
    const next = await w.ops.renameNote(a, "Alpha")
    await w.journal.undo()
    expect(await writeNote(a, "two")).toMatchObject({ written: true })
    expect(readWm(a).text).toBe("two")
    // ...and the name it left is refused, not remade (a late save of the old name)
    await w.journal.redo()
    expect(await writeNote(next, "three")).toMatchObject({ written: true })
    expect(await writeNote(a, "late")).toMatchObject({ written: false })
    expect(existsSync(a)).toBe(false)
  })

  it("Move into a section: the file, the two orders, then back", async () => {
    const w = world()
    const a = w.note("a.wm")
    w.note("b.wm")
    mkdirSync(path.join(w.root, "S"))
    const inS = w.note("S/x.wm")
    mkdirSync(path.join(w.root, ".writemind"))
    writeFileSync(path.join(w.root, ".writemind", "order.json"), JSON.stringify({ folders: { "": ["a.wm", "b.wm", "S"], S: ["x.wm"] } }))
    const landed = await w.ops.placeNote(a, path.join(w.root, "S"), "x.wm")
    expect(landed).toBe(path.join(w.root, "S", "a.wm"))
    expect(w.journal.state().undo?.label).toBe("Move Note")
    expect(orderOf(w.root, "S")).toEqual(["a.wm", "x.wm"])
    await w.journal.undo()
    expect(existsSync(a)).toBe(true)
    expect(existsSync(landed)).toBe(false)
    expect(existsSync(inS)).toBe(true)
    expect(orderOf(w.root)).toEqual(["a.wm", "b.wm", "S"])
    expect(orderOf(w.root, "S")).toEqual(["x.wm"])
    await w.journal.redo()
    expect(existsSync(landed)).toBe(true)
    expect(orderOf(w.root, "S")).toEqual(["a.wm", "x.wm"])
  })

  it("a drag inside one folder is a Reorder: only the list changes", async () => {
    const w = world()
    const a = w.note("a.wm")
    w.note("b.wm")
    w.note("c.wm")
    mkdirSync(path.join(w.root, ".writemind"))
    writeFileSync(path.join(w.root, ".writemind", "order.json"), JSON.stringify({ folders: { "": ["a.wm", "b.wm", "c.wm"] } }))
    await w.ops.placeNote(a, w.root, null)
    expect(orderOf(w.root)).toEqual(["b.wm", "c.wm", "a.wm"])
    expect(w.journal.state().undo?.label).toBe("Reorder")
    await w.journal.undo()
    expect(orderOf(w.root)).toEqual(["a.wm", "b.wm", "c.wm"])
    await w.journal.redo()
    expect(orderOf(w.root)).toEqual(["b.wm", "c.wm", "a.wm"])
  })

  it("an order file another program changed meanwhile is not overwritten: the step takes out and puts back only its own names", async () => {
    const w = world()
    const a = w.note("a.wm")
    w.note("b.wm")
    mkdirSync(path.join(w.root, ".writemind"))
    writeFileSync(path.join(w.root, ".writemind", "order.json"), JSON.stringify({ folders: { "": ["a.wm", "b.wm"] } }))
    const next = await w.ops.renameNote(a, "Alpha")
    // somebody adds a row to the list
    writeFileSync(path.join(w.root, ".writemind", "order.json"), JSON.stringify({ folders: { "": ["Alpha.wm", "b.wm", "zzz.wm"] } }))
    await w.journal.undo()
    expect(existsSync(a)).toBe(true)
    expect(existsSync(next)).toBe(false)
    expect(orderOf(w.root)).toEqual(["a.wm", "b.wm", "zzz.wm"])
  })
})

describe("the bin: Move to Trash is kept until it is out of scope", () => {
  it("a note is copied first, Undo puts the copy back (the bin keeps its item), Redo bins it again", async () => {
    const w = world()
    const a = w.note("a.wm", "precious")
    await readNote(a)
    await w.ops.trashNote(a, w.bin)
    expect(existsSync(a)).toBe(false)
    expect(w.binned).toEqual([a])
    expect(w.stepDirs()).toHaveLength(1)

    const back = await w.journal.undo()
    expect(back).toMatchObject({ ok: true, label: "Move to Trash" })
    expect(back.ok && back.effects.restored).toEqual([a])
    expect(readWm(a).text).toBe("precious")
    expect(readdirSync(w.binDir)).toHaveLength(1)
    // the restored note is the app's: it saves
    expect(await writeNote(a, "edited")).toMatchObject({ written: true })

    // Redo bins what is there now... but a step is redone only while nothing new has happened: it has not
    const again = await w.journal.redo()
    expect(again.ok && again.effects.removed).toEqual([a])
    expect(existsSync(a)).toBe(false)
    expect(readdirSync(w.binDir)).toHaveLength(2)
    // and the same backup brings it back a second time
    await w.journal.undo()
    expect(existsSync(a)).toBe(true)
  })

  it("if the name is taken the note is put back beside it with a number, and the person is told", async () => {
    const w = world()
    const a = w.note("a.wm", "the first")
    await w.ops.trashNote(a, w.bin)
    w.note("a.wm", "a new one")
    const back = await w.journal.undo()
    const second = path.join(w.root, "a 2.wm")
    expect(back.ok && back.effects.restored).toEqual([second])
    expect(back.ok && back.effects.notices).toEqual([takenNotice("a", "a 2")])
    expect(readWm(second).text).toBe("the first")
    expect(readWm(a).text).toBe("a new one")
    // Redo bins the one that was put back, not the other
    await w.journal.redo()
    expect(existsSync(second)).toBe(false)
    expect(readWm(a).text).toBe("a new one")
  })

  it("a section goes with everything in it: notes, nested sections, hidden files; Undo puts the whole folder back", async () => {
    const w = world()
    mkdirSync(path.join(w.root, "S", "Deep"), { recursive: true })
    w.note("S/one.wm", "1")
    w.note("S/Deep/two.wm", "2")
    mkdirSync(path.join(w.root, "S", ".writemind"))
    writeFileSync(path.join(w.root, "S", ".writemind", "order.json"), JSON.stringify({ folders: { "": ["two.wm"] } }))
    const before = w.tree()
    await w.ops.trashSection(path.join(w.root, "S"), w.bin)
    expect(w.tree()).toEqual([])
    const back = await w.journal.undo()
    expect(back.ok && back.effects.restored).toEqual([path.join(w.root, "S")])
    expect(w.tree()).toEqual(before)
    expect(readWm(path.join(w.root, "S", "Deep", "two.wm")).text).toBe("2")
    await w.journal.redo()
    expect(w.tree()).toEqual([])
  })

  it("when the copy cannot be made the note does NOT go: nothing is changed, no step, no backup left", async () => {
    const w = world()
    const a = w.note("a.wm")
    vi.spyOn(fsp, "copyFile").mockRejectedValueOnce(Object.assign(new Error("no room"), { code: "ENOSPC" }))
    await expect(w.ops.trashNote(a, w.bin)).rejects.toThrow(/nothing was changed/)
    expect(existsSync(a)).toBe(true)
    expect(w.binned).toEqual([])
    expect(w.journal.state().undoCount).toBe(0)
    expect(w.stepDirs()).toEqual([])
  })

  it("when the bin refuses, the backup goes and nothing is a step", async () => {
    const w = world()
    const a = w.note("a.wm")
    await expect(w.ops.trashNote(a, async () => { throw new Error("the bin is full") })).rejects.toThrow(/bin is full/)
    expect(existsSync(a)).toBe(true)
    expect(w.journal.state().undoCount).toBe(0)
    expect(w.stepDirs()).toEqual([])
  })
})

describe("sections", () => {
  it("New Section: an empty folder goes on Undo; one with things in it is left, and says so", async () => {
    const w = world()
    const folder = await w.ops.createSection(w.root)
    expect(path.basename(folder)).toBe("New Section")
    await w.journal.undo()
    expect(existsSync(folder)).toBe(false)
    await w.journal.redo()
    expect(existsSync(folder)).toBe(true)
    writeFileSync(path.join(folder, "x.txt"), "x")
    const out = await w.journal.undo()
    expect(out).toMatchObject({ ok: false, dropped: true })
    expect(existsSync(path.join(folder, "x.txt"))).toBe(true)
  })

  it("Rename Section: the notes inside follow in both directions, and still save", async () => {
    const w = world()
    mkdirSync(path.join(w.root, "S"))
    const inside = w.note("S/x.wm", "x")
    await readNote(inside)
    const next = await w.ops.renameSection(path.join(w.root, "S"), "T")
    expect(next).toBe(path.join(w.root, "T"))
    await w.journal.undo()
    expect(existsSync(inside)).toBe(true)
    expect(await writeNote(inside, "x2")).toMatchObject({ written: true })
    await w.journal.redo()
    expect(existsSync(path.join(w.root, "T", "x.wm"))).toBe(true)
  })

  it("Move Section: into another section and back, with the orders", async () => {
    const w = world()
    mkdirSync(path.join(w.root, "S"))
    mkdirSync(path.join(w.root, "T"))
    w.note("S/x.wm")
    const landed = await w.ops.moveSection(path.join(w.root, "S"), path.join(w.root, "T"))
    expect(landed).toBe(path.join(w.root, "T", "S"))
    expect(w.journal.state().undo?.label).toBe("Move Section")
    await w.journal.undo()
    expect(existsSync(path.join(w.root, "S", "x.wm"))).toBe(true)
    expect(existsSync(path.join(w.root, "T", "S"))).toBe(false)
    await w.journal.redo()
    expect(existsSync(path.join(w.root, "T", "S", "x.wm"))).toBe(true)
  })

  it("an operation that refuses (a section into itself) is not a step", async () => {
    const w = world()
    mkdirSync(path.join(w.root, "S"))
    expect(await w.ops.moveSection(path.join(w.root, "S"), path.join(w.root, "S"))).toBeNull()
    expect(w.journal.state().undoCount).toBe(0)
  })
})

describe("Clean Up Unused Files", () => {
  it("the pictures it took out of a note are put back by Undo, byte for byte, and taken out again by Redo", async () => {
    const w = world()
    const png = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4])
    const file = writeWm(path.join(w.root, "n.wm"), "no pictures named here", { entries: { "media/ab12cd34ef56ab78.png": png } })
    utimesSync(file, Date.now() / 1000 - 3600, Date.now() / 1000 - 3600)
    const result = await w.ops.trashUnused([w.root], [entryPath(file, "media/ab12cd34ef56ab78.png")], NOTHING_HELD, w.bin)
    expect(result.moved).toHaveLength(1)
    expect(Object.keys(readWm(file).entries)).not.toContain("media/ab12cd34ef56ab78.png")
    expect(w.journal.state().undo?.label).toBe("Clean Up Unused Files")
    const back = await w.journal.undo()
    expect(back.ok).toBe(true)
    expect(readWm(file).entries["media/ab12cd34ef56ab78.png"]).toEqual(png)
    await w.journal.redo()
    expect(Object.keys(readWm(file).entries)).not.toContain("media/ab12cd34ef56ab78.png")
  })

  it("a clean-up that finds nothing is not a step", async () => {
    const w = world()
    writeWm(path.join(w.root, "n.wm"), "x")
    const result = await w.ops.trashUnused([w.root], [], NOTHING_HELD, w.bin)
    expect(result.moved).toEqual([])
    expect(w.journal.state().undoCount).toBe(0)
    expect(w.stepDirs()).toEqual([])
  })
})

describe("Import", () => {
  it("a note the import made is a step; one it found already made is not", async () => {
    const w = world()
    const made = await w.ops.importNote(w.root, async () => w.note("Imported.wm", "from markdown"))
    expect(made).toBe(path.join(w.root, "Imported.wm"))
    expect(w.journal.state().undo?.label).toBe("Import Note")
    const again = await w.ops.importNote(w.root, async () => made)
    expect(again).toBe(made)
    expect(w.journal.state().undoCount).toBe(1)
  })
})

describe("how far back, and what a new step does", () => {
  it("keeps the last three: a fourth puts the first out of scope and deletes its backup", async () => {
    const w = world()
    const files = [1, 2, 3, 4, 5, 6].map((n) => w.note(`n${n}.wm`, `note ${n}`))
    for (const file of files) await w.ops.trashNote(file, w.bin)
    expect(w.journal.state().undoCount).toBe(3)
    expect(w.stepDirs()).toHaveLength(3)
    for (const n of [6, 5, 4]) {
      const out = await w.journal.undo()
      expect(out.ok).toBe(true)
      expect(readWm(files[n - 1]!).text).toBe(`note ${n}`)
    }
    expect(await w.journal.undo()).toMatchObject({ ok: null })
    for (const n of [1, 2, 3]) expect(existsSync(files[n - 1]!)).toBe(false)
  })

  it("a new step after an Undo ends the redo path and deletes the undone step's backup", async () => {
    const w = world()
    const a = w.note("a.wm")
    await w.ops.trashNote(a, w.bin)
    await w.journal.undo()
    expect(w.journal.state().redo?.label).toBe("Move to Trash")
    expect(w.stepDirs()).toHaveLength(1)
    await w.ops.createNote(w.root)
    expect(w.journal.state()).toMatchObject({ redo: null, redoCount: 0, undoCount: 1 })
    expect(w.stepDirs()).toHaveLength(0)
    expect(await w.journal.redo()).toMatchObject({ ok: null })
  })

  it("an edit on the page (cutRedo) ends the redo path the same way", async () => {
    const w = world()
    const a = w.note("a.wm")
    await w.ops.trashNote(a, w.bin)
    await w.journal.undo()
    await w.journal.cutRedo()
    expect(w.journal.state().redoCount).toBe(0)
    expect(w.stepDirs()).toHaveLength(0)
    expect(existsSync(a)).toBe(true)
  })

  it("steps are in the order they were asked for, even asked in one breath", async () => {
    const w = world()
    const a = w.note("a.wm")
    const results = await Promise.all([w.ops.createNote(w.root), w.ops.renameNote(a, "Alpha"), w.ops.createSection(w.root)])
    expect(results.map((one) => path.basename(one))).toEqual(["Untitled.wm", "Alpha.wm", "New Section"])
    const labels: string[] = []
    for (let i = 0; i < 3; i++) { const out = await w.journal.undo(); if (out.ok) labels.push(out.label) }
    expect(labels).toEqual(["New Section", "Rename Note", "New Note"])
  })

  it("a step's time is later than the one before it (the page orders text steps by it)", async () => {
    const w = world()
    await w.ops.createNote(w.root)
    const first = w.journal.state().undo!.at
    await w.ops.createNote(w.root)
    expect(w.journal.state().undo!.at).toBeGreaterThan(first)
    expect(w.journal.state().newestAt).toBe(w.journal.state().undo!.at)
  })
})

describe("a failed undo changes nothing", () => {
  it("a rename whose move-back fails after the order was restored: the order is put back, the step stays, and a retry works", async () => {
    const w = world()
    const a = w.note("a.wm")
    w.note("b.wm")
    mkdirSync(path.join(w.root, ".writemind"))
    writeFileSync(path.join(w.root, ".writemind", "order.json"), JSON.stringify({ folders: { "": ["a.wm", "b.wm"] } }))
    const next = await w.ops.renameNote(a, "Alpha")
    const real = fsp.rename.bind(fsp)
    const spy = vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (String(from) === next) throw Object.assign(new Error("in use"), { code: "EBUSY" })
      return real(from, to)
    })
    const before = { names: readdirSync(w.root).sort(), order: orderOf(w.root) }
    const out = await w.journal.undo()
    expect(out).toMatchObject({ ok: false, dropped: false })
    expect(out.ok === false && out.why).toMatch(/open in another program/)
    expect({ names: readdirSync(w.root).sort(), order: orderOf(w.root) }).toEqual(before)
    expect(w.journal.state().undo?.label).toBe("Rename Note")
    spy.mockRestore()
    const retry = await w.journal.undo()
    expect(retry.ok).toBe(true)
    expect(existsSync(a)).toBe(true)
    expect(orderOf(w.root)).toEqual(["a.wm", "b.wm"])
  })

  it("an undo of a trash whose copy-back fails leaves nothing half put back, and the step stays", async () => {
    const w = world()
    mkdirSync(path.join(w.root, "S"))
    w.note("S/one.wm")
    w.note("S/two.wm")
    await w.ops.trashSection(path.join(w.root, "S"), w.bin)
    const spy = vi.spyOn(fsp, "cp").mockImplementation(async (_from, to) => {
      mkdirSync(String(to))
      writeFileSync(path.join(String(to), "one.wm"), "half")
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
    })
    const out = await w.journal.undo()
    expect(out).toMatchObject({ ok: false, dropped: false })
    expect(existsSync(path.join(w.root, "S"))).toBe(false)
    expect(w.journal.state().undo?.label).toBe("Move Section to Trash")
    spy.mockRestore()
    expect((await w.journal.undo()).ok).toBe(true)
    expect(readdirSync(path.join(w.root, "S")).sort()).toEqual(["one.wm", "two.wm"])
  })

  it("a step whose note another program removed is dropped, and the step behind it is not blocked", async () => {
    const w = world()
    const made = await w.ops.createNote(w.root)
    const a = w.note("a.wm")
    const next = await w.ops.renameNote(a, "Alpha")
    rmSync(next)
    const out = await w.journal.undo()
    expect(out).toMatchObject({ ok: false, dropped: true })
    expect(w.journal.state().undo?.label).toBe("New Note")
    expect((await w.journal.undo()).ok).toBe(true)
    expect(existsSync(made)).toBe(false)
  })

  it("a name taken when a rename is taken back: it goes back as 'a 2' and says so", async () => {
    const w = world()
    const a = w.note("a.wm", "mine")
    await w.ops.renameNote(a, "Alpha")
    w.note("a.wm", "another")
    const out = await w.journal.undo()
    expect(out.ok && out.effects.notices).toEqual([takenNotice("a", "a 2")])
    expect(readWm(path.join(w.root, "a 2.wm")).text).toBe("mine")
    expect(readWm(a).text).toBe("another")
    // redo moves it from where it landed
    await w.journal.redo()
    expect(existsSync(path.join(w.root, "Alpha.wm"))).toBe(true)
    expect(existsSync(path.join(w.root, "a 2.wm"))).toBe(false)
  })

  it("nothing to undo or redo is not an error", async () => {
    const w = world()
    expect(await w.journal.undo()).toEqual({ ok: null, which: "undo" })
    expect(await w.journal.redo()).toEqual({ ok: null, which: "redo" })
  })
})

describe("the backups' end", () => {
  it("quit deletes them, synchronously", async () => {
    const w = world()
    await w.ops.trashNote(w.note("a.wm"), w.bin)
    expect(w.stepDirs()).toHaveLength(1)
    w.journal.disposeSync()
    expect(existsSync(w.backups)).toBe(false)
  })

  it("the next launch removes what a crash left", async () => {
    const w = world()
    mkdirSync(path.join(w.backups, "9999-old", "s1"), { recursive: true })
    writeFileSync(path.join(w.backups, "9999-old", "s1", "1-a.wm"), "stale")
    await w.journal.sweepStale()
    expect(existsSync(w.backups)).toBe(false)
  })

  it("clearing the journal (a window closed, a project left) deletes the backups and forgets the steps", async () => {
    const w = world()
    await w.ops.trashNote(w.note("a.wm"), w.bin)
    await w.journal.clear()
    expect(w.journal.state()).toMatchObject({ undo: null, redo: null, newestAt: 0 })
    expect(w.stepDirs()).toEqual([])
  })

  it("never touches anything outside its own folder: a journal needs a folder called undo", () => {
    expect(() => new UndoJournal({ backups: path.join(os.tmpdir(), "not-mine"), bin: async () => undefined })).toThrow(/called “undo”/)
  })

  it("the notes folder is untouched by the backups: they are under the app's data folder", async () => {
    const w = world()
    await w.ops.trashSection(await w.ops.createSection(w.root), w.bin)
    expect(w.backups.startsWith(w.root)).toBe(false)
    expect(w.tree()).toEqual([])
  })
})

describe("the row order, when it is not what the step left", () => {
  it("takes out the names the step added and puts back the ones it removed, leaving the rest", () => {
    // the step: a.wm -> Alpha.wm in [a, b]; now somebody added zzz
    expect(invert(["Alpha.wm", "b.wm", "zzz.wm"], ["Alpha.wm", "b.wm"], ["a.wm", "b.wm"])).toEqual(["a.wm", "b.wm", "zzz.wm"])
    // a list that was not there before: the step's names go, nothing else
    expect(invert(["x", "y", "mine"], ["x", "y"], null)).toEqual(["mine"])
    // a list the step created, and somebody emptied: its names come back where they were
    expect(invert([], null, ["x", "y"])).toEqual(["x", "y"])
  })
})
