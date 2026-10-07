// The conversion's safety rules, found by three adversarial reviews of the first cut (main/convert.ts, convertGuard.ts,
// convertConsent.ts, welcome.ts): every test here was seen to FAIL against the code it was written for. Everything works in
// scratch folders under the system's temp folder; nothing can see a real notes folder.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { textFingerprint } from "@writemind/core"
import { plannedBackup, conversionNotice, convertFolders, emptyReport, importMarkdownNote, type ConvertOptions } from "../src/main/convert"
import { consentFor } from "../src/main/convertConsent"
import { conversionRefusal } from "../src/main/convertGuard"
import { drawingPath } from "../src/main/legacyLayout"
import { welcomeMarker, welcomeOnce } from "../src/main/welcome"
import { readWm, writeWm } from "./wmFiles"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-safety-"))
const put = (file: string, text: string | Buffer): string => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file }
const run = (folders: string[], more: Partial<ConvertOptions> = {}) =>
  convertFolders(folders, { root: more.root ?? folders[0]!, appVersion: "3.0.0", now: new Date(2026, 9, 8, 9, 14, 3), ...more })
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
const env = {} as NodeJS.ProcessEnv
const isRoot = typeof process.getuid === "function" && process.getuid() === 0

describe("1. the Swift app's folder is never converted, however many times the app is launched", () => {
  /** What a launch does, in main.ts's order: the conversion (guarded), then the welcome. */
  async function launch(swift: string, documents: string) {
    const report = await run([swift], { root: swift, refuse: (folder) => conversionRefusal(folder, { documents, env, platform: "darwin" }) })
    await welcomeOnce(swift, [swift])
    return report
  }

  it("launch 1 refuses, the welcome marks the folder with the date alone, launch 2 and 3 refuse again, and not a Swift file moves", async () => {
    const home = scratch()
    const documents = path.join(home, "Documents")
    const swift = path.join(documents, "WriteMind")
    put(path.join(swift, "Note.md"), "# A Swift note\n")
    put(path.join(swift, "Section", "Deep.md"), "# Deep\n")
    put(path.join(swift, ".drawings", "Note.json"), JSON.stringify({ items: [] }))
    put(path.join(swift, ".drawings", "media", "p.png"), "png")
    const before = tree(swift)
    for (const which of [1, 2, 3]) {
      const report = await launch(swift, documents)
      expect(report.converted, `launch ${which}`).toEqual([])
      expect(report.refused.map((one) => one.reason).join(), `launch ${which}`).toMatch(/Swift WriteMind/)
      expect(tree(swift).filter((name) => !name.startsWith(".writemind/")), `launch ${which}`).toEqual(before)
    }
    // The marker is there (the question is asked once) and says nothing but the date: it is no proof of anything.
    expect(readFileSync(welcomeMarker(swift), "utf8")).toMatch(/^\S+\n$/)
    expect(existsSync(path.join(swift, "WriteMind Quick Reference.wm"))).toBe(false)
    expect(readdirSync(path.dirname(swift)).filter((name) => name.includes("backup"))).toEqual([])
  })

  it("a NEW install on the Mac (an empty folder the app welcomed, with its own .wm) is this app's, and converts what it holds", async () => {
    const home = scratch()
    const documents = path.join(home, "Documents")
    const mine = path.join(documents, "WriteMind")
    await welcomeOnce(mine, [mine])
    expect(readFileSync(welcomeMarker(mine), "utf8")).toMatch(/^\S+ WriteMind Quick Reference\.wm\n$/)
    expect(await conversionRefusal(mine, { documents, env, platform: "darwin" })).toBeNull()
    put(path.join(mine, "Old.md"), "# Old\n")
    const report = await launch(mine, documents)
    expect(report.failed).toEqual([])
    expect(readWm(path.join(mine, "Old.wm")).text).toBe("# Old\n")
  })

  it("a marker with the quick reference's name but no .wm of this app's in the folder is not proof; one with the older .md name and that file is", async () => {
    const home = scratch()
    const documents = path.join(home, "Documents")
    const swift = path.join(documents, "WriteMind")
    put(path.join(swift, ".writemind", "welcomed"), "2026-10-01T00:00:00.000Z WriteMind Quick Reference.wm\n")
    put(path.join(swift, "Note.md"), "# Swift\n")
    expect(await conversionRefusal(swift, { documents, env, platform: "darwin" })).toMatch(/Swift/)
    put(path.join(swift, "WriteMind Quick Reference.md"), "# The 2.x quick reference\n")
    put(path.join(swift, ".writemind", "welcomed"), "2026-10-01T00:00:00.000Z WriteMind Quick Reference.md\n")
    expect(await conversionRefusal(swift, { documents, env, platform: "darwin" })).toBeNull()
    // The marker of an install that held notes (the date alone, which every 2.x wrote in such a folder) is never proof.
    put(path.join(swift, ".writemind", "welcomed"), "2026-10-01T00:00:00.000Z\n")
    expect(await conversionRefusal(swift, { documents, env, platform: "darwin" })).toMatch(/Swift/)
  })
})

describe("7. the guard sees where a folder really is, and every folder the walk enters", () => {
  it("a project folder that is the PARENT of the Swift folder converts what is beside it and not what is in it", async () => {
    const home = scratch()
    const documents = path.join(home, "Documents")
    const swift = path.join(documents, "WriteMind")
    put(path.join(swift, "Note.md"), "# Swift\n")
    put(path.join(documents, "Other", "Mine.md"), "# Mine\n")
    put(path.join(documents, "Top.md"), "# Top\n")
    const report = await run([documents], { root: documents, refuse: (folder) => conversionRefusal(folder, { documents, env, platform: "darwin" }) })
    expect(existsSync(path.join(swift, "Note.md"))).toBe(true)
    expect(existsSync(path.join(swift, "Note.wm"))).toBe(false)
    expect(readWm(path.join(documents, "Other", "Mine.wm")).text).toBe("# Mine\n")
    expect(readWm(path.join(documents, "Top.wm")).text).toBe("# Top\n")
    expect(report.refused.map((one) => one.folder)).toEqual([swift])
    // ...and its `.drawings`-less folder was not "all converted": nothing of the Swift folder moved with the rest.
    expect(tree(swift)).toEqual(["Note.md"])
  })

  it("another spelling of the folder (a name in another case, a symlink to it) is the folder", async () => {
    const home = scratch()
    const documents = path.join(home, "Documents")
    const swift = path.join(documents, "WriteMind")
    put(path.join(swift, "Note.md"), "# Swift\n")
    symlinkSync(swift, path.join(home, "shortcut"))
    const guard = { documents, env, platform: "darwin" }
    expect(await conversionRefusal(path.join(documents, "writemind"), guard)).toMatch(/Swift/)
    expect(await conversionRefusal(path.join(documents, "WRITEMIND", "Section"), guard)).toMatch(/Swift/)
    expect(await conversionRefusal(path.join(home, "shortcut"), guard)).toMatch(/Swift/)
    expect(await conversionRefusal(path.join(home, "shortcut", "Section"), guard)).toMatch(/Swift/)
    const report = await run([path.join(home, "shortcut")], { refuse: (folder) => conversionRefusal(folder, guard) })
    expect(report.converted).toEqual([])
    expect(existsSync(path.join(swift, "Note.md"))).toBe(true)
  })

  it("a .md in the Swift folder opened from outside gets no .wm beside it", async () => {
    const home = scratch()
    const documents = path.join(home, "Documents")
    const swift = path.join(documents, "WriteMind")
    const note = put(path.join(swift, "Note.md"), "# Swift\n")
    await expect(importMarkdownNote(note, { appVersion: "3.0.0", refuse: (folder) => conversionRefusal(folder, { documents, env, platform: "darwin" }) }))
      .rejects.toThrow(/Swift WriteMind/)
    expect(tree(swift)).toEqual(["Note.md"])
    // (anywhere else it is imported as before)
    const elsewhere = put(path.join(home, "Elsewhere", "Note.md"), "# Elsewhere\n")
    const made = await importMarkdownNote(elsewhere, { appVersion: "3.0.0", refuse: (folder) => conversionRefusal(folder, { documents, env, platform: "darwin" }) })
    expect(readWm(made).text).toBe("# Elsewhere\n")
  })
})

describe("8. folders that are not the app's own notes", () => {
  it("a git working tree and node_modules are not walked: their markdown is not this app's, and the notice says which folder was left", async () => {
    const root = scratch()
    put(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
    put(path.join(root, "README.md"), "# A repository\n")
    put(path.join(root, "docs", "Guide.md"), "# Guide\n")
    const before = tree(root)
    const report = await run([root])
    expect(report.converted).toEqual([])
    expect(tree(root)).toEqual(before)
    expect(report.refused).toHaveLength(1)
    expect(report.refused[0]!.reason).toMatch(/git working tree/)
    expect(conversionNotice(report)).toMatch(/not converted.*git working tree/)

    // A repository with nothing to convert is not worth a word.
    const quiet = scratch()
    put(path.join(quiet, ".git", "HEAD"), "ref\n")
    put(path.join(quiet, "main.c"), "int main;\n")
    expect((await run([quiet])).refused).toEqual([])

    const notes = scratch()
    put(path.join(notes, "A.md"), "# A\n")
    put(path.join(notes, "node_modules", "pkg", "README.md"), "# a package\n")
    put(path.join(notes, "Sec", "node_modules", "README.md"), "# another\n")
    await run([notes])
    expect(existsSync(path.join(notes, "A.wm"))).toBe(true)
    expect(existsSync(path.join(notes, "node_modules", "pkg", "README.md"))).toBe(true)
    expect(existsSync(path.join(notes, "Sec", "node_modules", "README.md"))).toBe(true)
    expect(tree(notes).filter((name) => name.endsWith(".wm"))).toEqual(["A.wm"])
  })

  it("a folder that is not the notes root is converted only when the person says yes; a no leaves it alone and says nothing of it", async () => {
    const root = scratch()
    const vault = scratch()
    put(path.join(root, "Own.md"), "# Own\n")
    put(path.join(root, "Section", "Inner.md"), "# Inner\n")
    put(path.join(vault, "Vault.md"), "# Somebody's vault\n")
    put(path.join(vault, "More.md"), "# More\n")
    const asked: { folder: string; count: number; backup: string }[] = []
    const report = await run([root, vault], {
      root,
      confirm: async (folder, count, backup) => { asked.push({ folder, count, backup }); return false },
    })
    // The root (and what is under it) converts without a question; the vault is asked about once, with its count and where the originals would go.
    expect(asked).toEqual([{ folder: vault, count: 2, backup: plannedBackup(vault, new Date(2026, 9, 8, 9, 14, 3)) }])
    expect(existsSync(path.join(root, "Own.wm"))).toBe(true)
    expect(existsSync(path.join(root, "Section", "Inner.wm"))).toBe(true)
    expect(tree(vault)).toEqual(["More.md", "Vault.md"])
    expect(report.refused).toEqual([])
    expect(conversionNotice(report)).not.toMatch(/vault/i)

    const yes = await run([root, vault], { root, confirm: async () => true, now: new Date(2026, 9, 9) })
    expect(yes.converted.map((one) => path.basename(one.from)).sort()).toEqual(["More.md", "Vault.md"])
    expect(readWm(path.join(vault, "Vault.wm")).text).toBe("# Somebody's vault\n")
  })

  it("the answer is remembered per folder, in the user-data folder: asked once, a no stays a no", async () => {
    const userData = scratch()
    const one = scratch()
    const two = scratch()
    let asked = 0
    const ask = (answer: boolean) => async () => { asked++; return answer }
    expect(await consentFor(userData, one, ask(true))).toBe(true)
    expect(await consentFor(userData, one, ask(false))).toBe(true)
    expect(await consentFor(userData, two, ask(false))).toBe(false)
    expect(await consentFor(userData, two, ask(true))).toBe(false)
    expect(asked).toBe(2)
    // (a symlink or another spelling of a folder is the folder)
    const link = path.join(scratch(), "link")
    symlinkSync(one, link)
    expect(await consentFor(userData, link, ask(false))).toBe(true)
    expect(asked).toBe(2)
  })
})

describe("3. an original changed after it was read is not archived as 'exactly as it was'", () => {
  it("is left where it is and reported; the next launch converts it as a note of its own, with its new words", async () => {
    const root = scratch()
    const a = put(path.join(root, "A.md"), "# First words\n")
    const report = await run([root], {
      // (the first note's conversion is logged the moment it is done: the person types into the original right then)
      log: (line) => { if (line.startsWith("converted ")) writeFileSync(a, "# First words\n\nand a paragraph typed a moment later\n") },
    })
    expect(report.converted).toEqual([])
    expect(report.failed.map((one) => path.basename(one.note))).toEqual(["A.md"])
    expect(report.failed[0]!.reason).toMatch(/changed while it was being converted/)
    expect(readFileSync(a, "utf8")).toContain("typed a moment later")
    expect(readWm(path.join(root, "A.wm")).text).toBe("# First words\n")
    expect(report.backups.flatMap((backup) => readdirSync(backup)).includes("A.md")).toBe(false)

    const later = await run([root], { now: new Date(2026, 9, 9) })
    expect(later.failed).toEqual([])
    expect(readWm(path.join(root, "A 2.wm")).text).toContain("typed a moment later")
    expect(existsSync(a)).toBe(false)
    expect(readFileSync(path.join(later.backups[0]!, "A.md"), "utf8")).toContain("typed a moment later")
  })
})

describe("6. only 'not there' means not there", () => {
  it("a drawing that cannot be read (here: a folder where the file should be) leaves its note alone instead of converting it without the drawing", async () => {
    const root = scratch()
    const note = put(path.join(root, "N.md"), "# N\n")
    mkdirSync(drawingPath(root, note), { recursive: true })
    put(path.join(drawingPath(root, note), "inside"), "x")
    put(path.join(root, "Fine.md"), "# Fine\n")
    const report = await run([root])
    expect(report.failed.map((one) => path.basename(one.note))).toEqual(["N.md"])
    expect(existsSync(note)).toBe(true)
    expect(existsSync(path.join(root, "N.wm"))).toBe(false)
    expect(readWm(path.join(root, "Fine.wm")).text).toBe("# Fine\n")
    // ...and the `.drawings` folder stays: not every note was converted.
    expect(existsSync(path.join(root, ".drawings"))).toBe(true)
  })

  it("a picture that cannot be read is no missing picture: the note is left alone", async () => {
    const root = scratch()
    const note = put(path.join(root, "N.md"), "![](.drawings/media/p.png)\n")
    mkdirSync(path.join(root, ".drawings", "media", "p.png"), { recursive: true })
    const report = await run([root])
    expect(report.failed.map((one) => path.basename(one.note))).toEqual(["N.md"])
    expect(existsSync(note)).toBe(true)
    expect(existsSync(path.join(root, "N.wm"))).toBe(false)
  })

  it.skipIf(isRoot || process.platform === "win32")("a folder that cannot be listed is reported, its notes are not looked at, and .drawings is not moved whole", async () => {
    const root = scratch()
    const note = put(path.join(root, "N.md"), "# N\n")
    put(path.join(root, "Locked", "Hidden.md"), "# Hidden, with a drawing\n")
    put(drawingPath(root, path.join(root, "Locked", "Hidden.md")), JSON.stringify({ items: [{ kind: "stroke", id: "s", points: [{ x: 0, y: 0 }] }] }))
    chmodSync(path.join(root, "Locked"), 0o000)
    try {
      const report = await run([root])
      expect(report.converted.map((one) => one.from)).toEqual([note])
      expect(report.failed.map((one) => path.basename(one.note))).toContain("Locked")
      // The drawing of the note nobody could see is still where it was.
      expect(existsSync(drawingPath(root, path.join(root, "Locked", "Hidden.md")))).toBe(true)
    } finally { chmodSync(path.join(root, "Locked"), 0o755) }
    const later = await run([root], { now: new Date(2026, 9, 9) })
    expect(JSON.parse(readWm(path.join(root, "Locked", "Hidden.wm")).drawing!).items[0].id).toBe("s")
    expect(later.failed).toEqual([])
  })
})

describe("10. sessions, times and names", () => {
  const sessionWith = (userData: string, notes: Record<string, { text: string; base: string | null }>, open: string[]) => {
    const file = path.join(userData, "Sessions", "default.json")
    put(file, JSON.stringify({ root: "", open: open.map((one) => ({ path: one, caret: 0, collapsed: [] })), active: open[0], unsavedBuffers: notes }))
    return file
  }

  it("a CRLF note's unsaved text is still re-keyed when the session's base is the page's own LF text, and what is set aside is SAID", async () => {
    const root = scratch()
    const userData = scratch()
    const crlf = put(path.join(root, "Crlf.md"), "# Crlf\r\nsecond line\r\n")
    const other = put(path.join(root, "Other.md"), "# Other\n")
    const file = sessionWith(userData, {
      [crlf]: { text: "# Crlf\nsecond line\nmore, typed\n", base: textFingerprint("# Crlf\nsecond line\n") },
      [other]: { text: "typed over something else", base: "not-the-fingerprint" },
    }, [crlf, other])
    const report = await run([root], { userData })
    const session = JSON.parse(readFileSync(file, "utf8"))
    expect(Object.keys(session.unsavedBuffers)).toEqual([path.join(root, "Crlf.wm")])
    expect(session.unsavedBuffers[path.join(root, "Crlf.wm")].text).toBe("# Crlf\nsecond line\nmore, typed\n")
    expect(report.setAside.map((one) => path.basename(one.note))).toEqual(["Other.md"])
    expect(readFileSync(report.setAside[0]!.file, "utf8")).toBe("typed over something else")
    const said = conversionNotice(report)!
    expect(said).toMatch(/Other\.md/)
    expect(said).toMatch(/kept apart/)
    expect(said).toContain(path.dirname(report.setAside[0]!.file))
  })

  it("two unsaved texts of notes with the same file name are both kept, not one over the other", async () => {
    const root = scratch()
    const userData = scratch()
    const top = put(path.join(root, "Same.md"), "# top\n")
    const deep = put(path.join(root, "Sec", "Same.md"), "# deep\n")
    sessionWith(userData, { [top]: { text: "top's text", base: "x" }, [deep]: { text: "deep's text", base: "y" } }, [top, deep])
    const report = await run([root], { userData })
    expect(report.setAside).toHaveLength(2)
    expect(report.setAside.map((one) => readFileSync(one.file, "utf8")).sort()).toEqual(["deep's text", "top's text"])
  })

  it("the converted note keeps the original's modified time (newest-first and sync clients see no change)", async () => {
    const root = scratch()
    const note = put(path.join(root, "Old.md"), "# Old\n")
    const when = new Date(2024, 2, 5, 12, 0, 0)
    utimesSync(note, when, when)
    await run([root])
    expect(Math.abs(statSync(path.join(root, "Old.wm")).mtimeMs - when.getTime())).toBeLessThan(1500)
  })

  it("the sessions follow BEFORE the first original moves: a run cut short there leaves sessions that name notes that exist", async () => {
    const root = scratch()
    const userData = scratch()
    const note = put(path.join(root, "A.md"), "# A\n")
    const file = sessionWith(userData, {}, [note])
    let atFirstMove: string | null = null
    await run([root], {
      userData,
      rename: async () => {
        atFirstMove ??= readFileSync(file, "utf8")
        throw Object.assign(new Error("killed here"), { code: "EBUSY" })
      },
    })
    expect(JSON.parse(atFirstMove!).open[0].path).toBe(path.join(root, "A.wm"))
  })

  it("two project folders that hold the same relative path keep their own earlier names (A.wm here, A 2.wm there)", async () => {
    const one = scratch()
    const two = scratch()
    const userData = scratch()
    put(path.join(one, "A.md"), "# One\n")
    put(path.join(two, "A.md"), "# Two\n")
    writeWm(path.join(two, "A.wm"), "# Somebody's other A\n")
    const busy = async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }) }
    // The first run makes the notes and cannot move the originals (so they are "already converted" at the second).
    await run([one, two], { root: one, rename: busy })
    expect(readWm(path.join(one, "A.wm")).text).toBe("# One\n")
    expect(readWm(path.join(two, "A 2.wm")).text).toBe("# Two\n")
    const file = sessionWith(userData, {}, [path.join(one, "A.md"), path.join(two, "A.md")])
    const second = await run([one, two], { root: one, userData, now: new Date(2026, 9, 9) })
    expect(second.already).toBe(2)
    expect(JSON.parse(readFileSync(file, "utf8")).open.map((entry: { path: string }) => entry.path))
      .toEqual([path.join(one, "A.wm"), path.join(two, "A 2.wm")])
    expect(readdirSync(one).filter((name) => name.endsWith(".wm"))).toEqual(["A.wm"])
    expect(readdirSync(two).filter((name) => name.endsWith(".wm")).sort()).toEqual(["A 2.wm", "A.wm"])
  })
})

describe("11. a drawing or a picture is not lost with the folder it was in", () => {
  it("a note in a folder kept out of the project keeps its drawing: .drawings is not moved whole while it is waiting", async () => {
    const root = scratch()
    put(path.join(root, "In.md"), "# In\n")
    const hidden = put(path.join(root, "Hidden", "Out.md"), "# Out\n")
    put(drawingPath(root, hidden), JSON.stringify({ items: [{ kind: "stroke", id: "kept", points: [{ x: 0, y: 0 }] }] }))
    put(path.join(root, "Hidden", "Pic.md"), "![](../.drawings/media/pic.png)\n")
    put(path.join(root, ".drawings", "media", "pic.png"), "picture")
    const first = await run([root], { excluded: [path.join(root, "Hidden")] })
    expect(first.failed).toEqual([])
    expect(existsSync(path.join(root, "In.wm"))).toBe(true)
    expect(existsSync(drawingPath(root, hidden))).toBe(true)
    expect(existsSync(path.join(root, ".drawings", "media", "pic.png"))).toBe(true)
    // The folder comes back: its notes are converted, with their drawing and picture.
    const second = await run([root], { now: new Date(2026, 9, 9) })
    expect(second.failed).toEqual([])
    expect(JSON.parse(readWm(path.join(root, "Hidden", "Out.wm")).drawing!).items[0].id).toBe("kept")
    expect(readWm(path.join(root, "Hidden", "Pic.wm")).entries["media/pic.png"]!.toString()).toBe("picture")
  })

  it("a folder added later finds a picture in the backup an earlier run made of the folder that held it", async () => {
    const one = scratch()
    const two = scratch()
    put(path.join(one, "N1.md"), "![](.drawings/media/shared.png)\n")
    put(path.join(one, ".drawings", "media", "shared.png"), "shared picture")
    const first = await run([one])
    expect(first.failed).toEqual([])
    expect(existsSync(path.join(one, ".drawings"))).toBe(false)
    put(path.join(two, "N2.md"), "![](.drawings/media/shared.png)\n")
    const second = await run([one, two], { root: one, now: new Date(2026, 9, 9, 10, 0, 0) })
    expect(second.failed).toEqual([])
    const n2 = readWm(path.join(two, "N2.wm"))
    expect(n2.entries["media/shared.png"]!.toString()).toBe("shared picture")
    expect(n2.text).toBe("![](media/shared.png)\n")
    expect((n2.manifest.legacy as { missing?: string[] }).missing).toBeUndefined()
  })
})

describe("12. what the person is told, and when", () => {
  it("names the folders that were not converted and why, whatever else happened, and counts the .txt files then too", () => {
    const report = emptyReport()
    report.refused.push({ folder: "/Users/s/Documents/WriteMind", reason: "this looks like the Swift WriteMind's notes folder, which this app does not convert" })
    report.txt = 3
    const said = conversionNotice(report)!
    expect(said).toMatch(/A folder was not converted: WriteMind \(this looks like the Swift WriteMind's notes folder/)
    expect(said).toMatch(/3 plain \.txt files were left alone/)
    // (a test instance's refusals and a switched-off conversion are nobody's business)
    const quiet = emptyReport()
    quiet.refused.push({ folder: "/x", reason: "conversion is turned off" }, { folder: "/y", reason: "a test instance does not touch folders of its own that it was not given" })
    expect(conversionNotice(quiet)).toBeNull()
    // (.txt files alone are not worth a notice at every launch)
    const alone = emptyReport()
    alone.txt = 2
    expect(conversionNotice(alone)).toBeNull()
  })

  it("reports its progress: 0 of N, then each note", async () => {
    const root = scratch()
    put(path.join(root, "A.md"), "a\n")
    put(path.join(root, "B.md"), "b\n")
    const seen: string[] = []
    await run([root], { progress: (done, total) => seen.push(`${done}/${total}`) })
    expect(seen).toEqual(["0/2", "1/2", "2/2"])
  })
})
