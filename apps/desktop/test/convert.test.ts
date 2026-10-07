// The conversion of 2.15.0's notes (main/convert.ts, docs/SPEC-WM.md section 5): vectors 10 and 11, the backup rules, the
// guards. Every test works on a copy of a small legacy folder (test/fixtures/legacy) or on one it builds, under the system's
// temp folder: nothing here can see a real notes folder.
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { textFingerprint } from "@writemind/core"
import { conversionNotice, convertFolders, rewriteExactPaths, uuidV5, type ConvertOptions } from "../src/main/convert"
import { conversionRefusal } from "../src/main/convertGuard"
import { drawingPath, olderDrawingPath } from "../src/main/legacyLayout"
import { readWm, writeWm } from "./wmFiles"

const FIXTURE = path.join(__dirname, "fixtures", "legacy")
const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-convert-"))
const sha1 = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 12)
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex")
const put = (file: string, text: string | Buffer): string => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file }
const INK = "3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90"
/** Whether the temp folder tells `a` from `A` (macOS and Windows do not). */
const caseSensitive = (): boolean => {
  const dir = scratch()
  writeFileSync(path.join(dir, "a"), "")
  return !existsSync(path.join(dir, "A"))
}

/** A copy of the legacy fixture folder as `<scratch>/Notes` (a name of its own: the backup is `Notes legacy backup …` beside it). */
function folderOfFixture(): { home: string; notes: string; userData: string } {
  const home = scratch()
  const notes = path.join(home, "Notes")
  cpSync(FIXTURE, notes, { recursive: true })
  return { home, notes, userData: path.join(home, "profile") }
}

const run = (folders: string[], more: Partial<ConvertOptions> & { root?: string } = {}) =>
  convertFolders(folders, { root: more.root ?? folders[0]!, appVersion: "2.16.0", now: new Date(2026, 9, 8, 9, 14, 3), ...more })

const tree = (folder: string): string[] => {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(folder, full).replace(/\\/g, "/"))
    }
  }
  walk(folder)
  return out.sort()
}

describe("vector 10: a legacy folder becomes .wm files and the originals go to the backup", () => {
  it("makes A.wm and Sec/B.wm with the pictures, snapshot and drawing inside, the text rewritten as the spec says, and nothing else touched", async () => {
    const { notes } = folderOfFixture()
    const aBytes = readFileSync(path.join(notes, "A.md"))
    const report = await run([notes])
    expect(report.failed).toEqual([])
    expect(report.skipped).toEqual([])
    expect(report.converted.map((one) => path.relative(notes, one.to).replace(/\\/g, "/")).sort()).toEqual(["A.wm", "Sec/B.wm"])

    const a = readWm(path.join(notes, "A.wm"))
    expect(a.text).toBe(readFileSync(path.join(FIXTURE, "A.md"), "utf8")
      .replace("[B](B.md#wm-12ab34cd)", "[B](B.wm#wm-12ab34cd)")
      .replace("![](.drawings/media/3f9c2a7e5b1d4c80.png)", "![](media/3f9c2a7e5b1d4c80.png)")
      .replace(`![ink](.drawings/media/ink-${INK}.svg)`, `![ink](snapshots/ink-${INK}.svg)`))
    // (the inline code span and the fence keep every character: `[inline](B.md)`, the fence's `.drawings/media/x.png` and `[B](B.md)`)
    expect(a.text).toContain("`[inline](B.md)`")
    expect(a.text).toContain("```\n.drawings/media/x.png\n[B](B.md)\n```")
    expect(a.entries["media/3f9c2a7e5b1d4c80.png"]).toEqual(readFileSync(path.join(FIXTURE, ".drawings", "media", "3f9c2a7e5b1d4c80.png")))
    expect(a.entries[`snapshots/ink-${INK}.svg`]!.toString()).toBe(readFileSync(path.join(FIXTURE, ".drawings", "media", `ink-${INK}.svg`), "utf8"))
    const drawing = JSON.parse(a.drawing!)
    expect(drawing.items.map((item: { kind: string }) => item.kind)).toEqual(["image", "cell"])
    expect(drawing.items[0].file).toBe("3f9c2a7e5b1d4c80.png")
    expect(a.manifest.legacy).toMatchObject({ source: "A.md", sha256: sha256(aBytes), sidecar: `.drawings/A-${sha1("A.md")}.json` })
    expect((a.manifest.legacy as { missing?: string[] }).missing).toBeUndefined()
    expect(a.names).toEqual(["mimetype", "manifest.json", "note.wmdm", "drawing.json", `snapshots/ink-${INK}.svg`, "media/3f9c2a7e5b1d4c80.png"])

    const b = readWm(path.join(notes, "Sec", "B.wm"))
    expect(b.text).toBe("# Bravo\n\n<a id=\"wm-12ab34cd\"></a>The anchored paragraph.\n\nBack to [Alpha](../A.wm).\n")
    expect(b.drawing).toBeNull()
    expect(b.manifest.legacy).toMatchObject({ source: "Sec/B.md", sidecar: null })

    // The backup folder is beside the folder, mirrors it, and holds the originals byte for byte.
    const backup = report.backups[0]!
    expect(path.dirname(backup)).toBe(path.dirname(notes))
    expect(path.basename(backup)).toBe("Notes legacy backup 20261008-091403")
    expect(readFileSync(path.join(backup, "A.md"))).toEqual(aBytes)
    expect(readFileSync(path.join(backup, "Sec", "B.md"), "utf8")).toBe(readFileSync(path.join(FIXTURE, "Sec", "B.md"), "utf8"))
    for (const name of ["A-6114958182d7.json", "media/3f9c2a7e5b1d4c80.png", `media/ink-${INK}.svg`]) {
      expect(readFileSync(path.join(backup, ".drawings", name))).toEqual(readFileSync(path.join(FIXTURE, ".drawings", name)))
    }
    // The folder has no .md, no .drawings, and its order names the new files; the old order is in the backup.
    expect(tree(notes).filter((name) => /\.(md|markdown)$/.test(name))).toEqual([])
    expect(existsSync(path.join(notes, ".drawings"))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(notes, ".writemind", "order.json"), "utf8")).folders).toEqual({ "": ["A.wm", "Sec"], Sec: ["B.wm"] })
    expect(readFileSync(path.join(backup, ".writemind", "order.json"), "utf8")).toBe(readFileSync(path.join(FIXTURE, ".writemind", "order.json"), "utf8"))
    expect(readFileSync(path.join(backup, "WriteMind conversion.txt"), "utf8")).toContain("A.wm")

    // A second run changes nothing and makes no backup folder.
    const before = tree(path.dirname(notes))
    const second = await run([notes], { now: new Date(2026, 9, 9, 10, 0, 0) })
    expect(second.converted).toEqual([])
    expect(second.backups).toEqual([])
    expect(tree(path.dirname(notes))).toEqual(before)
  })

  it("the id is a version 5 UUID of the note's bytes and place: the same note converted twice, or on two machines, has the same id", async () => {
    const one = folderOfFixture()
    const two = folderOfFixture()
    await run([one.notes])
    await run([two.notes], { now: new Date(2027, 0, 1) })
    const a = readWm(path.join(one.notes, "A.wm"))
    expect(a.manifest.id).toBe(readWm(path.join(two.notes, "A.wm")).manifest.id)
    expect(a.manifest.id).toBe(uuidV5(`${sha256(readFileSync(path.join(FIXTURE, "A.md")))}:A.md`))
    expect(a.manifest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(uuidV5("x")).not.toBe(uuidV5("y"))
    expect(a.manifest.created).toMatch(/Z$/)
    expect(a.manifest.modified).toBe(new Date(statSync(path.join(path.dirname(one.notes), readdirSync(path.dirname(one.notes)).find((n) => n.includes("backup"))!, "A.md")).mtimeMs).toISOString().replace(/\.\d{3}Z$/, "Z"))
    // RFC 4122's own example: the DNS namespace and python.org.
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d")
  })

  it("a note's unsaved edits in a remembered session follow it: paths are rewritten, a buffer that is still an edit of the file is re-keyed", async () => {
    const { notes, userData } = folderOfFixture()
    const a = path.join(notes, "A.md")
    const text = readFileSync(a, "utf8")
    const sessions = path.join(userData, "Sessions", "default.json")
    put(sessions, JSON.stringify({
      root: notes, open: [{ path: a, caret: 3, collapsed: [] }, { path: path.join(notes, "Sec", "B.md"), caret: 0, collapsed: [] }], active: a,
      unsavedBuffers: {
        [a]: { text: `${text}\nmore ![](.drawings/media/3f9c2a7e5b1d4c80.png)`, base: textFingerprint(text) },
        [path.join(notes, "Sec", "B.md")]: { text: "typed over a file that changed since", base: "some-other-fingerprint" },
      },
    }))
    put(path.join(userData, "sheets.json"), JSON.stringify({ bound: [{ note: a, cell: INK }], other: "text" }))
    put(path.join(userData, "project.json"), JSON.stringify({ file: null, folders: [notes], excluded: [] }))
    const report = await run([notes], { userData })
    expect(report.failed).toEqual([])
    const session = JSON.parse(readFileSync(sessions, "utf8"))
    expect(session.open.map((one: { path: string }) => one.path)).toEqual([path.join(notes, "A.wm"), path.join(notes, "Sec", "B.wm")])
    expect(session.active).toBe(path.join(notes, "A.wm"))
    // The buffer that was an edit of the legacy text is re-keyed: its words are rewritten, and its base is the new file's text.
    const buffer = session.unsavedBuffers[path.join(notes, "A.wm")]
    expect(buffer.text).toContain("![](media/3f9c2a7e5b1d4c80.png)")
    expect(buffer.base).toBe(textFingerprint(readWm(path.join(notes, "A.wm")).text))
    // The one over a changed file is kept in the backup, never discarded, and is out of the session.
    expect(Object.keys(session.unsavedBuffers)).toEqual([path.join(notes, "A.wm")])
    expect(readFileSync(path.join(report.backups[0]!, "unsaved", "B.md.unsaved.txt"), "utf8")).toBe("typed over a file that changed since")
    expect(JSON.parse(readFileSync(path.join(userData, "sheets.json"), "utf8")).bound[0].note).toBe(path.join(notes, "A.wm"))
    expect(JSON.parse(readFileSync(path.join(userData, "project.json"), "utf8")).folders).toEqual([notes])
  })

  it("rewrites exact path strings and leaves the rest of the JSON as it is", () => {
    const mapping = new Map([["/n/a.md", "/n/a.wm"]])
    expect(rewriteExactPaths('{"x":"/n/a.md","y":"/n/a.md.bak","/n/a.md":1}', mapping)).toBe('{"x":"/n/a.wm","y":"/n/a.md.bak","/n/a.wm":1}')
    expect(rewriteExactPaths('{"x":"/n/b.md"}', mapping)).toBeNull()
    expect(rewriteExactPaths("not json", mapping)).toBeNull()
  })
})

describe("vector 11: edge cases", () => {
  it("(a) A.md and A.markdown become A.wm and A 2.wm, and a link to A.markdown follows it to `A%202.wm`", async () => {
    const root = scratch()
    put(path.join(root, "A.md"), "# One\n")
    put(path.join(root, "A.markdown"), "# Two\n")
    put(path.join(root, "Links.md"), "[first](A.md) and [second](A.markdown#x) and [plain](A)\n")
    const report = await run([root])
    expect(report.failed).toEqual([])
    expect(readWm(path.join(root, "A.wm")).text).toBe("# One\n")
    expect(readWm(path.join(root, "A 2.wm")).text).toBe("# Two\n")
    expect(readWm(path.join(root, "Links.wm")).text).toBe("[first](A.wm) and [second](A%202.wm#x) and [plain](A)\n")
  })

  it("an existing .wm of the name that is not this note's conversion is never overwritten: the note becomes `Name 2.wm`", async () => {
    const root = scratch()
    writeWm(path.join(root, "Plan.wm"), "# Somebody's other note\n")
    put(path.join(root, "Plan.md"), "# Plan\n")
    await run([root])
    expect(readWm(path.join(root, "Plan.wm")).text).toBe("# Somebody's other note\n")
    expect(readWm(path.join(root, "Plan 2.wm")).text).toBe("# Plan\n")
  })

  it("(b) media X.png and x.png in one note: the second met is media/x-2.png and its references follow", async () => {
    const root = scratch()
    put(path.join(root, "N.md"), "![](.drawings/media/X.png)\n\n![](.drawings/media/x.png)\n")
    put(path.join(root, ".drawings", "media", "X.png"), "UPPER")
    put(path.join(root, ".drawings", "media", "x.png"), "lower")
    await run([root])
    const n = readWm(path.join(root, "N.wm"))
    expect(n.text).toBe("![](media/X.png)\n\n![](media/x-2.png)\n")
    expect(Object.keys(n.entries).filter((name) => name.startsWith("media/")).sort()).toEqual(["media/X.png", "media/x-2.png"])
    // (On a file system that does not tell X.png from x.png there is one file to read, and both names have its bytes.)
    if (caseSensitive()) {
      expect(n.entries["media/X.png"]!.toString()).toBe("UPPER")
      expect(n.entries["media/x-2.png"]!.toString()).toBe("lower")
    }
  })

  it("(b) ...in the order met: the drawing's pictures come before the text's, so a name the drawing has keeps its spelling", async () => {
    const root = scratch()
    put(path.join(root, "N.md"), "![](.drawings/media/X.png)\n\n![](.drawings/media/x.png)\n")
    put(path.join(root, ".drawings", "media", "X.png"), "UPPER")
    put(path.join(root, ".drawings", "media", "x.png"), "lower")
    put(drawingPath(root, path.join(root, "N.md")), JSON.stringify({ items: [{ kind: "image", id: "i", file: "x.png", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 1 }] }))
    await run([root])
    const n = readWm(path.join(root, "N.wm"))
    expect(n.text).toBe("![](media/X-2.png)\n\n![](media/x.png)\n")
    expect(Object.keys(n.entries).filter((name) => name.startsWith("media/")).sort()).toEqual(["media/X-2.png", "media/x.png"])
    if (caseSensitive()) expect(n.entries["media/X-2.png"]!.toString()).toBe("UPPER")
    expect(JSON.parse(n.drawing!).items[0].file).toBe("x.png")
  })

  it("(c) a reference to a picture that is nowhere stays as written, is listed in legacy.missing, and the conversion succeeds", async () => {
    const root = scratch()
    put(path.join(root, "N.md"), "![](.drawings/media/gone.png)\n\n![](.drawings/media/here.png)\n")
    put(path.join(root, ".drawings", "media", "here.png"), "here")
    const report = await run([root])
    expect(report.failed).toEqual([])
    const n = readWm(path.join(root, "N.wm"))
    expect(n.text).toBe("![](.drawings/media/gone.png)\n\n![](media/here.png)\n")
    expect((n.manifest.legacy as { missing: string[] }).missing).toEqual(["gone.png"])
  })

  it("(c) a drawing cell whose snapshot is nowhere gets one drawn again from the cell", async () => {
    const root = scratch()
    put(path.join(root, "N.md"), `![ink](.drawings/media/ink-${INK}.svg)\n`)
    put(drawingPath(root, path.join(root, "N.md")), readFileSync(path.join(FIXTURE, ".drawings", "A-6114958182d7.json")))
    await run([root])
    const snapshot = readWm(path.join(root, "N.wm")).entries[`snapshots/ink-${INK}.svg`]!.toString()
    expect(snapshot).toMatch(/^<svg/)
    expect(snapshot).toContain("writemind-ink")
    // (the fixture's drawing also names a picture that is not in this folder: that one is listed, the snapshot is not)
    expect((readWm(path.join(root, "N.wm")).manifest.legacy as { missing?: string[] }).missing).toEqual(["3f9c2a7e5b1d4c80.png"])
  })

  it("(d) a note that is not UTF-8 is skipped, untouched, reported; the others are converted", async () => {
    const root = scratch()
    const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])
    put(path.join(root, "Latin.md"), latin)
    put(path.join(root, "Fine.md"), "# Fine\n")
    const report = await run([root])
    expect(report.skipped.map((one) => path.basename(one.note))).toEqual(["Latin.md"])
    expect(readFileSync(path.join(root, "Latin.md"))).toEqual(latin)
    expect(existsSync(path.join(root, "Latin.wm"))).toBe(false)
    expect(readWm(path.join(root, "Fine.wm")).text).toBe("# Fine\n")
    expect(conversionNotice(report)).toMatch(/Latin\.md/)
    // .drawings stays where it is (not every note was converted), and the backup holds a copy.
    put(path.join(root, ".drawings", "media", "m.png"), "m")
    const again = await run([root])
    expect(again.skipped).toHaveLength(1)
  })

  it("(e) a damaged sidecar converts the readable items, and legacy/sidecar.json holds the original bytes", async () => {
    const root = scratch()
    put(path.join(root, "N.md"), "# N\n")
    const damaged = JSON.stringify({ items: [{ kind: "stroke", id: "ok", points: [{ x: 0, y: 0 }] }, null, { kind: "sticker" }] })
    put(drawingPath(root, path.join(root, "N.md")), damaged)
    await run([root])
    const n = readWm(path.join(root, "N.wm"))
    expect(JSON.parse(n.drawing!).items.map((item: { id: string }) => item.id)).toEqual(["ok"])
    expect(n.entries["legacy/sidecar.json"]!.toString()).toBe(damaged)
    const broken = path.join(root, "M.md")
    put(broken, "# M\n")
    put(drawingPath(root, broken), "{ not json at all")
    await run([root], { now: new Date(2026, 9, 9) })
    expect(readWm(path.join(root, "M.wm")).entries["legacy/sidecar.json"]!.toString()).toBe("{ not json at all")
  })

  it("(f) a Mac-spelling sidecar (<stem>.json, points as [x, y]) is converted to the flat spelling, and the original is kept", async () => {
    const root = scratch()
    put(path.join(root, "N.md"), "# N\n")
    const mac = JSON.stringify({ items: [{ kind: "stroke", stroke: { colorHex: "#2FBF71", width: 2, points: [[0.1, 0.1], [0.2, 0.2]] } }] })
    put(path.join(root, ".drawings", "N.json"), mac)
    await run([root])
    const n = readWm(path.join(root, "N.wm"))
    const stroke = JSON.parse(n.drawing!).items[0]
    expect(stroke).toMatchObject({ kind: "stroke", colorHex: "#2FBF71", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] })
    expect(n.entries["legacy/sidecar.json"]!.toString()).toBe(mac)
    expect(n.manifest.legacy).toMatchObject({ sidecar: ".drawings/N.json" })
  })

  it("(g) A.md edited after A.wm was made: `A 2.wm` is made, A.wm is untouched, and the old note is not converted twice", async () => {
    const root = scratch()
    put(path.join(root, "A.md"), "# First\n")
    await run([root])
    // Another program puts a note of the same name back, different words.
    put(path.join(root, "A.md"), "# Edited elsewhere\n")
    const second = await run([root], { now: new Date(2026, 9, 10) })
    expect(second.converted).toHaveLength(1)
    expect(readWm(path.join(root, "A.wm")).text).toBe("# First\n")
    expect(readWm(path.join(root, "A 2.wm")).text).toBe("# Edited elsewhere\n")
    // The same bytes again (a copy of the very file the first run converted) is recognised as converted: no third note.
    put(path.join(root, "A.md"), "# First\n")
    const third = await run([root], { now: new Date(2026, 9, 11) })
    expect(third.converted).toEqual([])
    expect(third.already).toBe(1)
    expect(existsSync(path.join(root, "A 3.wm"))).toBe(false)
    expect(existsSync(path.join(root, "A.md"))).toBe(false)
  })

  it("links across folders and to a note in another section resolve by the name, as the app follows them; a link with no extension or to nothing is left alone", async () => {
    const root = scratch()
    put(path.join(root, "Top.md"), "[a](Deep.md) [b](Sec/Deep.md#h) [c](Nope.md) [d](https://example.com/Deep.md) [e](Deep) [f](<Deep.md>) [g](#top)\n")
    put(path.join(root, "Sec", "Deep.md"), "# Deep\n")
    await run([root])
    expect(readWm(path.join(root, "Top.wm")).text)
      .toBe("[a](Deep.wm) [b](Sec/Deep.wm#h) [c](Nope.md) [d](https://example.com/Deep.md) [e](Deep) [f](<Deep.wm>) [g](#top)\n")
  })

  it("a text cell's words are as typed: an escaped bracket there is not a link, and nothing in it changes", async () => {
    const root = scratch()
    put(path.join(root, "T.md"), "typed \\[x](B.md) and .drawings/media/a.png\n\n<!-- markdown -->\nsee [x](B.md)\n")
    put(path.join(root, "B.md"), "b\n")
    await run([root])
    expect(readWm(path.join(root, "T.wm")).text).toBe("typed \\[x](B.md) and .drawings/media/a.png\n\n<!-- markdown -->\nsee [x](B.wm)\n")
  })
})

describe("the backup", () => {
  it("a .drawings folder is moved whole only when every note under the folder was converted; else it stays, and the backup has a copy", async () => {
    const root = scratch()
    put(path.join(root, "Good.md"), "# Good\n")
    put(path.join(root, "Bad.md"), Buffer.from([0xff, 0xfe, 0xfd]))
    put(drawingPath(root, path.join(root, "Good.md")), JSON.stringify({ items: [] }))
    put(path.join(root, ".drawings", "media", "m.png"), "m")
    const report = await run([root])
    expect(existsSync(path.join(root, ".drawings", "media", "m.png"))).toBe(true)
    // (the converted note's own sidecar went with it)
    expect(existsSync(drawingPath(root, path.join(root, "Good.md")))).toBe(false)
    expect(readFileSync(path.join(report.backups[0]!, ".drawings", "media", "m.png"), "utf8")).toBe("m")
    expect(existsSync(path.join(report.backups[0]!, ".drawings", path.basename(drawingPath(root, path.join(root, "Good.md")))))).toBe(true)
  })

  it("moves across disks by a verified copy: the original goes only after a byte-identical copy exists", async () => {
    const { notes } = folderOfFixture()
    const aBytes = readFileSync(path.join(notes, "A.md"))
    const seen: string[] = []
    const report = await run([notes], {
      rename: async (from, to) => {
        seen.push(path.relative(notes, from))
        throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" })
      },
    })
    expect(report.failed).toEqual([])
    expect(seen).toContain("A.md")
    expect(readFileSync(path.join(report.backups[0]!, "A.md"))).toEqual(aBytes)
    expect(existsSync(path.join(notes, "A.md"))).toBe(false)
    expect(readFileSync(path.join(report.backups[0]!, ".drawings", "media", "3f9c2a7e5b1d4c80.png")))
      .toEqual(readFileSync(path.join(FIXTURE, ".drawings", "media", "3f9c2a7e5b1d4c80.png")))
    expect(existsSync(path.join(notes, ".drawings"))).toBe(false)
  })

  it("a move that fails keeps the original, says so, and the next run finishes it without making the note again", async () => {
    const root = scratch()
    put(path.join(root, "A.md"), "# A\n")
    const failing = await run([root], { rename: async () => { throw Object.assign(new Error("EBUSY: file in use"), { code: "EBUSY" }) } })
    expect(failing.failed.map((one) => path.basename(one.note))).toEqual(["A.md"])
    expect(readFileSync(path.join(root, "A.md"), "utf8")).toBe("# A\n")
    expect(readWm(path.join(root, "A.wm")).text).toBe("# A\n")
    const later = await run([root], { now: new Date(2026, 9, 9) })
    expect(later.already).toBe(1)
    expect(existsSync(path.join(root, "A.md"))).toBe(false)
    expect(readdirSync(root).filter((name) => /^A( \d+)?\.wm$/.test(name))).toEqual(["A.wm"])
  })

  it("the notes of a folder kept out of the project are not converted", async () => {
    const root = scratch()
    put(path.join(root, "In.md"), "# In\n")
    put(path.join(root, "Hidden", "Out.md"), "# Out\n")
    await run([root], { excluded: [path.join(root, "Hidden")] })
    expect(existsSync(path.join(root, "In.wm"))).toBe(true)
    expect(existsSync(path.join(root, "Hidden", "Out.md"))).toBe(true)
    expect(existsSync(path.join(root, "Hidden", "Out.wm"))).toBe(false)
  })

  it("a folder with no old notes does nothing and writes nothing (no backup folder); .txt files are left alone and counted", async () => {
    const root = scratch()
    writeWm(path.join(root, "Already.wm"), "# Already\n")
    put(path.join(root, "plain.txt"), "plain\n")
    const before = tree(root)
    const report = await run([root])
    expect(report.converted).toEqual([])
    expect(report.backups).toEqual([])
    expect(report.txt).toBe(1)
    expect(tree(root)).toEqual(before)
    expect(readdirSync(path.dirname(root)).filter((name) => name.startsWith(path.basename(root)))).toEqual([path.basename(root)])
    expect(conversionNotice(report)).toBeNull()
  })

  it("converts a folder next to the original when the parent cannot be written: the backup goes inside .writemind/legacy", async () => {
    const parent = scratch()
    const folder = path.join(parent, "N")
    put(path.join(folder, "A.md"), "# A\n")
    // A file where the backup folder would go makes the folder beside it impossible.
    const now = new Date(2026, 9, 8, 9, 14, 3)
    put(path.join(parent, "N legacy backup 20261008-091403"), "in the way")
    const report = await run([folder], { now })
    expect(report.backups[0]).toBe(path.join(folder, ".writemind", "legacy", "20261008-091403"))
    expect(readFileSync(path.join(report.backups[0]!, "A.md"), "utf8")).toBe("# A\n")
  })

  it("two project folders: a picture one note uses may be kept in the other folder's .drawings", async () => {
    const one = scratch()
    const two = scratch()
    put(path.join(one, "N.md"), "![](.drawings/media/shared.png)\n")
    put(path.join(two, ".drawings", "media", "shared.png"), "shared")
    put(path.join(two, "Other.md"), "# Other\n")
    await run([one, two], { root: one })
    expect(readWm(path.join(one, "N.wm")).entries["media/shared.png"]!.toString()).toBe("shared")
    expect(readWm(path.join(two, "Other.wm")).text).toBe("# Other\n")
  })

  it("the oldest drawing place (the notes root's, hashed by the absolute path) is read, and copied rather than moved", async () => {
    const root = scratch()
    const folder = path.join(root, "Project")
    put(path.join(folder, "N.md"), "# N\n")
    const older = olderDrawingPath(root, path.join(folder, "N.md"))
    put(older, JSON.stringify({ items: [{ kind: "stroke", id: "old", points: [{ x: 0, y: 0 }] }] }))
    const report = await run([folder], { root })
    expect(JSON.parse(readWm(path.join(folder, "N.wm")).drawing!).items[0].id).toBe("old")
    expect(existsSync(older)).toBe(true)
    expect(existsSync(path.join(report.backups[0]!, ".drawings-root", path.basename(older)))).toBe(true)
    expect((readWm(path.join(folder, "N.wm")).manifest.legacy as { sidecar: string }).sidecar).toBe(`.drawings/${path.basename(older)}`)
    rmSync(root, { recursive: true, force: true })
  })
})

describe("the guards: what the conversion never touches", () => {
  // (a scratch "Documents": the paths are only ever compared, but nothing here may look at a real one)
  const documents = path.join(scratch(), "Documents")
  const env = {} as NodeJS.ProcessEnv

  it("the Swift Mac app's folder, ~/Documents/WriteMind, unless this app is known to have made it its own", async () => {
    const swift = path.join(documents, "WriteMind")
    expect(await conversionRefusal(swift, { documents, env, platform: "darwin" })).toMatch(/Swift WriteMind/)
    expect(await conversionRefusal(path.join(swift, "Sub"), { documents, env, platform: "darwin" })).toMatch(/Swift WriteMind/)
    // The old folder, a folder of the person's choosing, and the same folder on another platform are fine.
    expect(await conversionRefusal(path.join(documents, "WriteMindCross"), { documents, env, platform: "darwin" })).toBeNull()
    expect(await conversionRefusal(path.join(path.dirname(documents), "Elsewhere"), { documents, env, platform: "darwin" })).toBeNull()
    expect(await conversionRefusal(swift, { documents, env, platform: "win32" })).toBeNull()
    expect(await conversionRefusal(swift, { documents, env, platform: "linux" })).toBeNull()
    // Known to be this app's: it moved WriteMindCross there, or recorded a move to it, or WRITEMIND_NOTES says so.
    expect(await conversionRefusal(swift, { documents, env, platform: "darwin", movedTo: swift })).toBeNull()
    expect(await conversionRefusal(swift, { documents, env: { WRITEMIND_NOTES: swift }, platform: "darwin" })).toBeNull()
    expect(await conversionRefusal(swift, { documents, env, platform: "darwin", settled: { root: swift, outcome: "moved", notice: null, takeNotice: async () => null } })).toBeNull()
  })

  it("a Mac folder that holds this app's own marks (its welcome marker, its hashed drawings) is this app's", async () => {
    const home = scratch()
    const documentsHere = path.join(home, "Documents")
    const swift = path.join(documentsHere, "WriteMind")
    mkdirSync(path.join(swift, ".writemind"), { recursive: true })
    expect(await conversionRefusal(swift, { documents: documentsHere, env, platform: "darwin" })).toMatch(/Swift/)
    put(path.join(swift, ".drawings", "Note.json"), "{}")
    expect(await conversionRefusal(swift, { documents: documentsHere, env, platform: "darwin" })).toMatch(/Swift/)
    put(path.join(swift, ".drawings", "Note-0123456789ab.json"), "{}")
    expect(await conversionRefusal(swift, { documents: documentsHere, env, platform: "darwin" })).toBeNull()
  })

  it("a test instance converts only the scratch folders it was given, and WRITEMIND_NO_CONVERT turns it off", async () => {
    const scratchFolder = scratch()
    const test = { WRITEMIND_E2E: "1", WRITEMIND_OFFSCREEN: "1", WRITEMIND_NOTES: scratchFolder } as NodeJS.ProcessEnv
    expect(await conversionRefusal(path.join(scratchFolder, "Sub"), { documents, env: test })).toBeNull()
    expect(await conversionRefusal(path.join(documents, "WriteMindCross"), { documents, env: test })).toMatch(/test instance/)
    expect(await conversionRefusal(path.join(documents, "WriteMindCross"), { documents, env: { WRITEMIND_OFFSCREEN: "1" } as NodeJS.ProcessEnv })).toMatch(/test instance/)
    expect(await conversionRefusal(scratchFolder, { documents, env: { ...test, WRITEMIND_NO_CONVERT: "1" } as NodeJS.ProcessEnv })).toMatch(/turned off/)
    expect(await conversionRefusal(scratchFolder, { documents, env: { WRITEMIND_DOCUMENTS: scratchFolder, WRITEMIND_E2E: "1" } as NodeJS.ProcessEnv })).toBeNull()
  })

  it("a refused folder is left exactly as it is, and is said to be", async () => {
    const root = scratch()
    put(path.join(root, "A.md"), "# A\n")
    const before = tree(root)
    const report = await run([root], { refuse: async () => "not here" })
    expect(report.refused).toEqual([{ folder: root, reason: "not here" }])
    expect(report.converted).toEqual([])
    expect(tree(root)).toEqual(before)
  })
})

describe("what the person is told", () => {
  it("says how many were converted and where the originals are", async () => {
    const { notes } = folderOfFixture()
    const report = await run([notes])
    const said = conversionNotice(report)!
    expect(said).toContain("2 notes were converted")
    expect(said).toContain(report.backups[0]!)
    expect(said).toContain("unchanged")
  })
})
