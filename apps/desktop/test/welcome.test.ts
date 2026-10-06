// The quick reference a new install opens on (Sean, 2026-10-05: "have the brief summary of feature and keystrokes be
// the first thing that open on a new install"). Port-only: the Mac has no first-run note. The keys table is made from
// the command table, so it is held here to that table (every row a command, a chord on Windows) and to the parser
// (it is one table cell); the first-run rule (once per notes folder, never into a folder with notes) is run against
// real temp folders.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { blocks } from "@writemind/core"
import { COMMANDS } from "../src/shared/commands"
import { WELCOME_FEATURES, WELCOME_FILE, WELCOME_GROUPS, WELCOME_KEYS, chordFor, groupTitleCell, welcomeKeys, welcomeNote } from "../src/shared/welcome"
import { welcomeMarker, welcomeOnce, welcomeWanted } from "../src/main/welcome"

const ROOT = path.resolve(__dirname, "../../..")
const row = (what: string) => WELCOME_KEYS.find((one) => one.what === what)!

describe("the quick reference's keys come from the command table", () => {
  it("every row names commands that exist, and each has a chord on Windows", () => {
    const known = new Set(COMMANDS.map((one) => one.id))
    for (const one of WELCOME_KEYS) {
      expect(one.ids?.length || one.editorKey, one.what).toBeTruthy()
      for (const id of one.ids ?? []) expect(known.has(id), `${one.what}: ${id}`).toBe(true)
      const windows = welcomeKeys(one, false)
      expect(windows, one.what).not.toBe("—")
      expect(windows.trim().length, one.what).toBeGreaterThan(0)
      expect(welcomeKeys(one, true).trim().length, one.what).toBeGreaterThan(0)
    }
    expect(new Set(WELCOME_KEYS.map((one) => one.what)).size).toBe(WELCOME_KEYS.length)
  })

  it("a key no menu shows is one the editor's keymap binds (Shift+Enter runs the cell)", () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name)
        if (statSync(file).isDirectory()) walk(file)
        else if (file.endsWith(".ts")) files.push(file)
      }
    }
    walk(path.join(ROOT, "packages/editor/src"))
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n")
    for (const one of WELCOME_KEYS.filter((k) => k.editorKey)) {
      expect(source.includes(`key: "${one.editorKey}"`), `${one.what}: ${one.editorKey} is bound nowhere`).toBe(true)
    }
  })

  it("reads as Sean's approved note does, on both platforms", () => {
    const both = (what: string) => [welcomeKeys(row(what), false), welcomeKeys(row(what), true)]
    expect(both("New note")).toEqual(["Ctrl+N", "⌘N"])
    expect(both("Undo / Redo")).toEqual(["Ctrl+Z / Ctrl+Y", "⌘Z / ⇧⌘Z"])
    expect(both("Find / Replace")).toEqual(["Ctrl+F / Ctrl+H", "⌘F / ⌥⌘F"])
    expect(both("Show / hide video")).toEqual(["Ctrl+Shift+Y", "⌘Y"])
    expect(both("Pen down / up")).toEqual(["Ctrl+P", "⌘P"])
    expect(both("1 Title")).toEqual(["Ctrl+1", "⌘1"])
    expect(both("3 Author")).toEqual(["Ctrl+3", "⌘3"])
    // docs/PLAN-text-cells.md (Sean, 2026-10-05 / 06): 7 Text, Shift+7 Markdown, 8 Code block, Shift+8 Runnable code,
    // 9 Maths, 0 Drawing.
    expect(both("7 Text")).toEqual(["Ctrl+7", "⌘7"])
    expect(both("Shift+7 Markdown")).toEqual(["Ctrl+Shift+7", "⇧⌘7"])
    expect(both("8 Code block")).toEqual(["Ctrl+8", "⌘8"])
    expect(both("Shift+8 Runnable code")).toEqual(["Ctrl+Shift+8", "⇧⌘8"])
    expect(both("Bold / Italic / Underline")).toEqual(["Ctrl+B / I / U", "⌘B / I / U"])
    expect(both("Indent / Outdent")).toEqual(["Ctrl+] / Ctrl+[", "⌘] / ⌘["])
    expect(both("Split / Merge cell")).toEqual(["Ctrl+D / Ctrl+M", "⌃D / ⌃M"])
    expect(both("Move cell up / down")).toEqual(["Ctrl+Shift+↑ / ↓", "⌃⇧↑ / ↓"])
    expect(both("Move section up / down")).toEqual(["Ctrl+↑ / ↓", "⌃⌘↑ / ↓"])
    expect(both("Run the cell")).toEqual(["Shift+Enter", "⇧↩"])
    expect(both("9 Maths cell")).toEqual(["Ctrl+9", "⌘9"])
    expect(both("0 Drawing cell")).toEqual(["Ctrl+0", "⌘0"])
    expect(both("Fold / unfold all sections")).toEqual(["Ctrl+Alt+Shift+← / →", "⌥⇧⌘← / →"])
    expect(both("Every key")).toEqual(["F1", "⇧⌘/"])
  })

  it("spells a chord the way each platform does", () => {
    expect(chordFor("CmdOrCtrl+Alt+Shift+Z", false)).toEqual({ mods: "Ctrl+Alt+Shift+", key: "Z" })
    expect(chordFor("Alt+Shift+Cmd+Left", true)).toEqual({ mods: "⌥⇧⌘", key: "←" })
    expect(chordFor("Shift+Cmd+/", true)).toEqual({ mods: "⇧⌘", key: "/" })
    expect(chordFor("CmdOrCtrl+Alt+PageDown", false)).toEqual({ mods: "Ctrl+Alt+", key: "PageDown" })
    expect(chordFor("Shift-Enter", false)).toEqual({ mods: "Shift+", key: "Enter" })
  })

  it("the note's keys are ONE markdown table (What | Windows | Mac): a title row per group, then a row per key", () => {
    const tables = blocks(welcomeNote()).filter((one) => one.kind === "table")
    expect(tables.length).toBe(1)
    const table = tables[0] as Extract<ReturnType<typeof blocks>[number], { kind: "table" }>
    expect(table.header).toEqual(["What", "Windows", "Mac"])
    const expected = WELCOME_GROUPS.flatMap((group) => [
      [groupTitleCell(group.title), "", ""],
      ...group.keys.map((one) => [one.what, welcomeKeys(one, false), welcomeKeys(one, true)]),
    ])
    expect(table.rows.length).toBe(WELCOME_KEYS.length + WELCOME_GROUPS.length)
    expect(table.rows.map((cells) => [cells[0], cells[1] ?? "", cells[2] ?? ""])).toEqual(expected)
  })
  it("the number keys come first, as one group, each digit's Shift chord after it (Sean: group the ctrl/cmd + 1-0 keystrokes)", () => {
    const first = WELCOME_GROUPS[0]!
    expect(first.keys.map((one) => welcomeKeys(one, false))).toEqual(
      ["Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4", "Ctrl+5", "Ctrl+6", "Ctrl+7", "Ctrl+Shift+7", "Ctrl+8", "Ctrl+Shift+8", "Ctrl+9", "Ctrl+0"])
    expect(WELCOME_GROUPS.slice(1).map((group) => group.title)).toEqual(["Notes", "View", "Editing", "Help"])
  })

  it("the feature list names what is built, the pen buttons as Sean set them", () => {
    const text = welcomeNote()
    expect(text.startsWith("# WriteMind Quick Reference\n")).toBe(true)
    for (const name of ["Cells", "Maths cells", "Drawing", "Runnable cells", "Video pane", "Wacom pen buttons"]) {
      expect(WELCOME_FEATURES.some((one) => one.startsWith(`**${name}`)), name).toBe(true)
    }
    expect(text).toContain("First button (Middle Click): hold to erase strokes, double-tap to undo.")
    expect(text).toContain("Second button (Right Click): hold to select, double-tap to redo.")
    expect(text).toContain("Set the first button to Middle Click in Wacom Tablet Properties")
    // Sean: "way way more brief": one line per feature
    for (const one of WELCOME_FEATURES.filter((f) => !f.includes("\n"))) expect(one.length).toBeLessThan(140)
  })
})

describe("a new install, once (main/welcome.ts)", () => {
  const made: string[] = []
  const temp = () => { const dir = mkdtempSync(path.join(os.tmpdir(), "wm-welcome-")); made.push(dir); return dir }
  afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  it("an empty notes folder gets the note and the marker; a second launch does not write it again", async () => {
    const root = path.join(temp(), "WriteMind") // not made yet, as on a first launch
    const note = await welcomeOnce(root, [root])
    expect(note).toBe(path.join(root, WELCOME_FILE))
    expect(await fs.readFile(note!, "utf8")).toBe(welcomeNote())
    expect((await fs.stat(welcomeMarker(root))).isFile()).toBe(true)
    await fs.writeFile(note!, "# Mine now\n")
    expect(await welcomeOnce(root, [root])).toBeNull()
    expect(await fs.readFile(note!, "utf8")).toBe("# Mine now\n")
  })

  it("deleting it does not bring it back", async () => {
    const root = temp()
    const note = await welcomeOnce(root, [root])
    await fs.rm(note!)
    expect(await welcomeOnce(root, [root])).toBeNull()
    expect(await fs.readdir(root)).toEqual([".writemind"])
  })

  it("a folder that already has notes (at the top, or in a section) gets nothing, and is never asked again", async () => {
    const top = temp()
    await fs.writeFile(path.join(top, "Old.md"), "# Old\n")
    expect(await welcomeOnce(top, [top])).toBeNull()
    expect((await fs.readdir(top)).sort()).toEqual([".writemind", "Old.md"])
    await fs.rm(path.join(top, "Old.md"))
    expect(await welcomeOnce(top, [top])).toBeNull()

    const nested = temp()
    await fs.mkdir(path.join(nested, "Work", "Deep"), { recursive: true })
    await fs.writeFile(path.join(nested, "Work", "Deep", "plan.txt"), "plan\n")
    expect(await welcomeOnce(nested, [nested])).toBeNull()
    expect(await fs.readdir(nested)).not.toContain(WELCOME_FILE)
  })

  it("a project folder elsewhere with notes counts; the app's own hidden folder does not", async () => {
    const root = temp()
    const other = temp()
    await fs.writeFile(path.join(other, "Elsewhere.md"), "x\n")
    expect(await welcomeOnce(root, [root, other])).toBeNull()

    const hidden = temp()
    await fs.mkdir(path.join(hidden, ".writemind"), { recursive: true })
    await fs.writeFile(path.join(hidden, ".writemind", "scratch.md"), "x\n")
    await fs.writeFile(path.join(hidden, "picture.png"), "")
    expect(await welcomeOnce(hidden, [hidden])).toBe(path.join(hidden, WELCOME_FILE))
  })

  it("test instances are left alone unless they ask", () => {
    expect(welcomeWanted({})).toBe(true)
    expect(welcomeWanted({ WRITEMIND_E2E: "1" })).toBe(false)
    expect(welcomeWanted({ WRITEMIND_OFFSCREEN: "1" })).toBe(false)
    expect(welcomeWanted({ WRITEMIND_E2E: "1", WRITEMIND_OFFSCREEN: "1", WRITEMIND_WELCOME: "1" })).toBe(true)
    expect(welcomeWanted({ WRITEMIND_WELCOME: "0" })).toBe(false)
  })
})
