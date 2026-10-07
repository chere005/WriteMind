// Notes opened from outside the app (main/openFiles.ts): the command line, a .wm as it is, a .md imported beside itself with
// the original untouched, and the queue the page takes from. (Finder's `open-file` and Windows' file association are the
// shell's, and cannot be run here: docs/TESTING.md says what was and was not checked on a real desktop.)
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { importMarkdownNote } from "../src/main/convert"
import { OpenQueue, admit, candidates, isOpenable } from "../src/main/openFiles"
import { readWm, writeWm } from "./wmFiles"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-open-"))
const put = (file: string, text: string | Buffer): string => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file }
const imported = (md: string) => importMarkdownNote(md, { appVersion: "2.16.0" })

describe("what is on a command line", () => {
  it("takes the notes it names, resolved against the working folder, and not the switches", () => {
    const cwd = path.resolve("/work")
    expect(candidates(["/app/WriteMind.exe", "--flag", "Notes/a.wm", "b.md", "c.txt", "d.markdown", "--x=y.wm", "Notes/a.wm"], cwd, true))
      .toEqual([path.join(cwd, "Notes", "a.wm"), path.join(cwd, "b.md"), path.join(cwd, "d.markdown")])
    // A development run starts with the electron binary and the app's folder.
    expect(candidates(["/x/electron", ".", "--remote-debugging-port=9333", "/tmp/n.wm"], cwd, false)).toEqual([path.resolve("/tmp/n.wm")])
    expect(isOpenable("A.WM")).toBe(true)
    expect(isOpenable("A.md")).toBe(true)
    expect(isOpenable("A.txt")).toBe(false)
    expect(isOpenable("A.pdf")).toBe(false)
  })
})

describe("admitting a file", () => {
  it("a .wm opens as it is; a file that is not there, or is not a note, is said so", async () => {
    const dir = scratch()
    const note = writeWm(path.join(dir, "N.wm"), "# N\n")
    const never = async () => { throw new Error("nothing is imported") }
    expect(await admit(note, never)).toEqual({ file: note, imported: false })
    expect(await admit(path.join(dir, "gone.wm"), never)).toMatchObject({ error: expect.stringMatching(/not there/) })
    expect(await admit(put(path.join(dir, "x.pdf"), "x"), never)).toMatchObject({ error: expect.stringMatching(/not a WriteMind note/) })
  })

  it("a .md is imported into a new .wm beside it, and the original is not touched", async () => {
    const dir = scratch()
    const md = put(path.join(dir, "Plain.md"), "# Plain\n\nSee [x](Other.md) and ![](.drawings/media/a.png)\n")
    put(path.join(dir, ".drawings", "media", "a.png"), "PNG")
    const before = readFileSync(md)
    const out = await admit(md, imported)
    expect(out).toMatchObject({ file: path.join(dir, "Plain.wm"), imported: true, from: md })
    const made = readWm(path.join(dir, "Plain.wm"))
    expect(made.text).toContain("![](media/a.png)")
    expect(made.entries["media/a.png"]!.toString()).toBe("PNG")
    expect(readFileSync(md)).toEqual(before)
    expect(readdirSync(dir).sort()).toEqual([".drawings", "Plain.md", "Plain.wm"])
    expect(readdirSync(path.join(dir, ".drawings", "media"))).toEqual(["a.png"])
    // The same file opened again opens the same note; changed, it is another one (never over the first).
    expect(await admit(md, imported)).toMatchObject({ file: path.join(dir, "Plain.wm") })
    expect(readdirSync(dir).filter((name) => name.endsWith(".wm"))).toEqual(["Plain.wm"])
    writeFileSync(md, "# Plain, edited\n")
    expect(await admit(md, imported)).toMatchObject({ file: path.join(dir, "Plain 2.wm") })
    expect(readWm(path.join(dir, "Plain.wm")).text).toContain("See [x]")
  })

  it("a .md that is not UTF-8 text is refused, and nothing is made", async () => {
    const dir = scratch()
    const md = put(path.join(dir, "Latin.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    const out = await admit(md, imported)
    expect(out).toMatchObject({ error: expect.stringMatching(/UTF-8/) })
    expect(readdirSync(dir)).toEqual(["Latin.md"])
  })

  it("the new note's manifest says where it came from, and its id is the conversion's", async () => {
    const dir = scratch()
    const md = put(path.join(dir, "Plan.md"), "# Plan\n")
    await imported(md)
    const made = readWm(path.join(dir, "Plan.wm"))
    expect(made.manifest.legacy).toMatchObject({ source: "Plan.md", sha256: createHash("sha256").update(readFileSync(md)).digest("hex") })
    expect(made.manifest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/)
  })
})

describe("the queue the page takes from", () => {
  it("holds each file once and gives everything up once", () => {
    const queue = new OpenQueue()
    queue.push("/a/one.wm")
    queue.push("/a/two.wm")
    queue.push("/a/one.wm")
    expect(queue.size).toBe(2)
    expect(queue.take()).toEqual(["/a/one.wm", "/a/two.wm"])
    expect(queue.take()).toEqual([])
  })
})
