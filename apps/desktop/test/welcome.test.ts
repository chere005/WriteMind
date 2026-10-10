// The Quick Reference (Sean, 2026-10-05: "have the brief summary of feature and keystrokes be the first thing that
// open on a new install"; 2026-10-07: "make sure the features md file that ships is rendered by default and correct").
// Port-only: the Mac has no first-run note. The keys table is made from the command table, so it is held here to that
// table (every row a command, a chord on Windows) and to the parser (it is one table cell); EVERY LINE OF THE FEATURE
// LIST is held to the source it names (a key to a command, a menu item to the menu, a button to its pane, a language to
// the evaluators, a file name to the format), so a claim that stops being true fails here; the first-run rule (once per
// notes folder, never into a folder with notes) and Help ▸ Quick Reference (written if missing, rewritten if out of
// date) are run against real temp folders.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { blocks } from "@writemind/core"
import { EVALUATORS, WM_TEXT, evaluatorTitle, formatExtension, formatTitle, offeredFormats } from "@writemind/core"
import { COMMANDS, shown } from "../src/shared/commands"
import {
  WELCOME_FEATURES, WELCOME_FILE, WELCOME_GROUPS, WELCOME_INTRO, WELCOME_KEYS, chordFor, groupTitleCell, welcomeKeys, welcomeNote,
} from "../src/shared/welcome"
import { ensureQuickReference, quickReferencePath, welcomeMarker, welcomeOnce, welcomeWanted } from "../src/main/welcome"
import { PROJECT_EXTENSION } from "../src/main/project"
import { NOTE_EXTENSIONS } from "../src/main/notes"
import { readWm, writeWm } from "./wmFiles"

const ROOT = path.resolve(__dirname, "../../..")
const row = (what: string) => WELCOME_KEYS.find((one) => one.what === what)!
const mac = (platform: string) => platform === "darwin"

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

  // CHANGED 2026-10-10 (docs/PLAN-bars-2026-10.md, P6): the table was What | Windows | Mac; it is What | Keys, THIS computer's
  // keys, and the note is written for the machine that shows it (welcomeNote(platform)).
  for (const platform of ["win32", "darwin"]) {
    it(`on ${platform} the note's keys are ONE markdown table (What | Keys): a title row per group, then a row per key`, () => {
      const mac = platform === "darwin"
      const tables = blocks(welcomeNote(platform)).filter((one) => one.kind === "table")
      expect(tables.length).toBe(1)
      const table = tables[0] as Extract<ReturnType<typeof blocks>[number], { kind: "table" }>
      expect(table.header).toEqual(["What", "Keys"])
      const expected = WELCOME_GROUPS.flatMap((group) => [
        [groupTitleCell(group.title), ""],
        ...group.keys.map((one) => [one.what, welcomeKeys(one, mac)]),
      ])
      expect(table.rows.length).toBe(WELCOME_KEYS.length + WELCOME_GROUPS.length)
      expect(table.rows.map((cells) => [cells[0], cells[1] ?? ""])).toEqual(expected)
    })

    it(`on ${platform} no feature line types a key by hand: every chord it names is this machine's, from the command table`, () => {
      const text = welcomeNote(platform)
      if (mac(platform)) {
        // A Mac's note never says Ctrl or Windows' Shift+Enter: it is ⌘ and ⇧↩ all through.
        expect(text).not.toMatch(/Ctrl\+/)
        expect(text).toContain("⌘7 makes a text cell")
        expect(text).toContain("⇧⌘7 a markdown cell")
        expect(text).toContain("⇧↩ runs one")
      } else {
        expect(text).toContain("Ctrl+7 makes a text cell")
        expect(text).toContain("Ctrl+Shift+7 a markdown cell")
        expect(text).toContain("Shift+Enter runs one")
        expect(text).not.toMatch(/⌘[0-9A-Z]/)
      }
      // One column, this machine's: the other platform's chords are not in the table.
      expect(text).not.toContain("| Windows")
      expect(text).not.toContain("| Mac ")
    })
  }
  it("the number keys come first, as one group, each digit's Shift chord after it (Sean: group the ctrl/cmd + 1-0 keystrokes)", () => {
    const first = WELCOME_GROUPS[0]!
    expect(first.keys.map((one) => welcomeKeys(one, false))).toEqual(
      ["Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4", "Ctrl+5", "Ctrl+6", "Ctrl+7", "Ctrl+Shift+7", "Ctrl+8", "Ctrl+Shift+8", "Ctrl+9", "Ctrl+0"])
    expect(WELCOME_GROUPS.slice(1).map((group) => group.title)).toEqual(["Notes", "View", "Editing", "Help"])
  })

  it("the feature list names what is built, the pen buttons as Sean set them", () => {
    const text = welcomeNote(process.platform)
    expect(text.startsWith("# WriteMind Quick Reference\n")).toBe(true)
    for (const name of [
      "Cells", "Text and markdown cells", "Maths cells", "Tables", "Rendered page", "Drawing", "Runnable cells", "Language Setup", "Video pane",
      "Wacom tablet", "Mathematica", "Wacom pen buttons", "Notes are files", "Updates", "About",
    ]) {
      expect(WELCOME_FEATURES.some((one) => one.startsWith(`**${name}:**`)), name).toBe(true)
    }
    expect(text).toContain("First button (Middle Click): hold to erase strokes, double-tap to undo.")
    expect(text).toContain("Second button (Right Click): hold to select, double-tap to redo.")
    expect(text).toContain("set the first button to Middle Click in Wacom Tablet Properties")
    expect(text).toContain("On a Mac the Tablet sheet reads both buttons from the tablet itself")
    // Sean: "way way more brief": one or two lines per feature in the pane, a bold lead on each
    for (const one of WELCOME_FEATURES.filter((f) => !f.includes("\n"))) expect(one.length, one).toBeLessThan(170)
    for (const one of WELCOME_FEATURES) expect(one, one).toMatch(/^\*\*[^*]+:\*\*/)
    expect(new Set(WELCOME_FEATURES.map((one) => one.split(":**")[0])).size).toBe(WELCOME_FEATURES.length)
  })

  it("the intro is one plain line under the title (a text cell: nothing in it is markup), and says the page is the app's", () => {
    const parsed = blocks(welcomeNote(process.platform))
    expect(parsed[0]).toMatchObject({ kind: "heading" })
    expect(parsed[1]).toMatchObject({ kind: "paragraph" })
    expect(WELCOME_INTRO).not.toMatch(/[*_`\[\]<>|#]/)
    expect(WELCOME_INTRO).toContain("Help ▸ Quick Reference")
    expect(WELCOME_INTRO).toContain("brings it up to date")
  })

  it("the file is a Note (.wm), so the sidebar lists it and the app opens it like any note", () => {
    expect(WELCOME_FILE).toBe("WriteMind Quick Reference.wm")
    expect(NOTE_EXTENSIONS).toContain(path.extname(WELCOME_FILE))
  })
})

// EVERY CLAIM OF THE FEATURE LIST is held to the source (Sean, 2026-10-07: "correct"): the keys it names are the chords of
// the commands it means, the menu items and buttons are the ones the menu and the panes have, the languages are the
// evaluators, the file names are the format's. A line whose claim stops being true fails here.
describe("the feature list is true to the source", () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")
  const features = (lead: string) => WELCOME_FEATURES.find((one) => one.startsWith(`**${lead}:**`))!
  const menu = read("apps/desktop/src/main/menu.ts")
  const camera = read("apps/desktop/src/renderer/CameraHeader.tsx")
  const strip = read("apps/desktop/src/renderer/SheetStrip.tsx")
  const box = read("apps/desktop/src/renderer/BoxActions.tsx")

  it("every key it names is a chord of the command it means (or the editor's Shift+Enter)", () => {
    const chords = new Map<string, string>()
    for (const command of COMMANDS) { const key = shown(command.id, "win32"); if (key) chords.set(key, command.id) }
    const named = [...WELCOME_FEATURES.join("\n").matchAll(/Ctrl(?:\+(?:Shift|Alt))*\+[A-Za-z0-9;]+|Shift\+Enter/g)].map((match) => match[0])
    expect(named.length).toBeGreaterThan(5)
    for (const key of named) expect(key === "Shift+Enter" || chords.has(key), `${key} is no command's key`).toBe(true)
    const means: [string, string, string][] = [
      ["Text and markdown cells", "Ctrl+7", "heading:0"], ["Text and markdown cells", "Ctrl+Shift+7", "markdownCell"],
      ["Maths cells", "Ctrl+9", "mathsCell"], ["Maths cells", "Ctrl+Shift+M", "insertMath"], ["Rendered page", "Ctrl+T", "toggleMode"],
      ["Drawing", "Ctrl+0", "insertInkCell"],
    ]
    for (const [lead, key, id] of means) {
      expect(features(lead), `${lead} names ${key}`).toContain(key)
      expect(chords.get(key), `${key} is ${id}`).toBe(id)
    }
    expect(features("Runnable cells")).toContain("Shift+Enter")
  })

  it("the languages are the evaluators, each of them", () => {
    const line = features("Runnable cells")
    for (const evaluator of EVALUATORS) expect(line, evaluator).toContain(evaluatorTitle(evaluator))
    expect(EVALUATORS.length).toBe(5)
    expect(line).toContain("In[n] / Out[n]")
  })

  it("the menu items it names are in the menu bar, under the menus it names", () => {
    const items: [string, string][] = [
      ["Language Setup", "item(\"languageSetup\", \"Language Setup…\")"],
      ["Updates", "Check for Updates…"],
      ["About", "About WriteMind"],
      ["Wacom tablet", "label: \"Tablet\""],
    ]
    for (const [lead, source] of items) expect(menu, `${lead}: ${source}`).toContain(source)
    expect(features("Language Setup")).toContain("File ▸ Language Setup…")
    expect(features("Wacom tablet")).toContain("Input Devices ▸ Tablet")
    expect(features("Updates")).toContain("Help ▸ Check for Updates…")
    expect(features("About")).toContain("Help ▸ About WriteMind")
    expect(WELCOME_INTRO).toContain("Help ▸ Quick Reference")
    // Export's Wolfram Notebook type, in the panel the Export… item opens (core export/formats.ts, main/exportFile.ts).
    expect(menu).toContain("item(\"export\", \"Export…\"")
    expect(offeredFormats(true).map(formatTitle)).toContain("Wolfram Notebook")
    expect(features("Mathematica")).toContain(`File ▸ Export… ▸ ${formatTitle("wolfram")} writes a \`.${formatExtension("wolfram")}\``)
  })

  it("the buttons it names are on the panes it names them on", () => {
    // the video pane's header and box
    // (the segmented control's labels are data in CameraHeader.tsx, 2026-10-10: "Page" is renamed Image)
    for (const label of ["label: \"Writing\"", "label: \"Image\"", "label: \"Raw\""]) expect(camera, label).toContain(label)
    expect(features("Video pane")).toContain("Writing, Image and Raw")
    expect(strip).toContain("data-scan-add")
    // the tablet box's row
    expect(box).toContain("As drawing cell")
    expect(box).toContain("Copy")
    expect(features("Wacom tablet")).toContain("As drawing cell")
    // the dock control (2026-10-10: the ⤵ disc became the Dock button of the inspector over a picked object)
    expect(read("apps/desktop/src/renderer/Inspector.tsx")).toContain("Dock into the note")
    expect(features("Drawing")).toContain("Dock in a picked one")
  })

  it("the notes are what the format says: .wm holding note.mdwm; a project a small JSON file", () => {
    const line = features("Notes are files")
    expect(NOTE_EXTENSIONS).toEqual([".wm"])
    expect(WM_TEXT).toBe("note.mdwm")
    expect(line).toContain("`.wm`")
    expect(line).toContain(`\`${WM_TEXT}\``)
    expect(PROJECT_EXTENSION).toBe("writemind-project")
    expect(line).toContain("project is a small JSON file")
  })

  it("Tables, Mathematica and the rest name what the docs say is built", () => {
    // a pipe table is ONE cell (core `blocks`), and the line says what a table looks like as typed
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n"
    expect(blocks(table).filter((one) => one.kind === "table").length).toBe(1)
    expect(features("Tables")).toContain("`| a | b |`")
    expect(features("Mathematica")).toContain("`.nb`")
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
    expect(readWm(note!).text).toBe(welcomeNote(process.platform))
    expect((await fs.stat(welcomeMarker(root))).isFile()).toBe(true)
    writeWm(note!, "# Mine now\n")
    expect(await welcomeOnce(root, [root])).toBeNull()
    expect(readWm(note!).text).toBe("# Mine now\n")
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

  it("an existing install is never given the file at launch: the marker and its notes mean nothing is written", async () => {
    const root = temp()
    await fs.mkdir(path.join(root, ".writemind"), { recursive: true })
    await fs.writeFile(welcomeMarker(root), "2026-10-01T00:00:00.000Z\n")
    expect(await welcomeOnce(root, [root])).toBeNull()
    expect(await fs.readdir(root)).toEqual([".writemind"])
    // ...and Help ▸ Quick Reference is what brings it to such an install
    const out = await ensureQuickReference(root)
    expect(out.change).toBe("created")
    expect((await fs.readdir(root)).sort()).toEqual([".writemind", WELCOME_FILE])
  })

  it("Help ▸ Quick Reference: written when missing, left alone when current, rewritten when out of date", async () => {
    const root = temp()
    expect(quickReferencePath(root)).toBe(path.join(root, WELCOME_FILE))
    const first = await ensureQuickReference(root)
    expect(first).toEqual({ file: path.join(root, WELCOME_FILE), change: "created" })
    expect(readWm(first.file).text).toBe(welcomeNote(process.platform))
    expect(readWm(first.file).names).toContain("note.mdwm")
    // no marker, nothing else: only the file
    expect(await fs.readdir(root)).toEqual([WELCOME_FILE])
    const bytes = readFileSync(first.file)
    expect((await ensureQuickReference(root)).change).toBe("current")
    expect(readFileSync(first.file).equals(bytes)).toBe(true)
    // the same words in CRLF lines are the same words
    writeWm(first.file, welcomeNote(process.platform).replace(/\n/g, "\r\n"))
    expect((await ensureQuickReference(root)).change).toBe("current")
  })

  it("an out-of-date copy (an older app's, or the person's edits) is rewritten whole, keeping the note's identity and what else it holds", async () => {
    const root = temp()
    const file = writeWm(path.join(root, WELCOME_FILE), "# WriteMind Quick Reference\n\n- **Cells:** from an older app\n",
      { entries: { "media/0123456789abcdef.png": "picture" } })
    const before = readWm(file)
    const out = await ensureQuickReference(root)
    expect(out).toEqual({ file, change: "updated" })
    const after = readWm(file)
    expect(after.text).toBe(welcomeNote(process.platform))
    expect(after.manifest.id).toBe(before.manifest.id)
    expect(after.entries["media/0123456789abcdef.png"]?.toString()).toBe("picture")
    expect((await ensureQuickReference(root)).change).toBe("current")
    // edited by the person: overwritten, as the page says it will be
    writeWm(file, `${welcomeNote(process.platform)}\nMy own line.\n`)
    expect((await ensureQuickReference(root)).change).toBe("updated")
    expect(readWm(file).text).toBe(welcomeNote(process.platform))
    // and a text of another app version is written as given
    expect((await ensureQuickReference(root, "# Next version\n")).change).toBe("updated")
    expect(readWm(file).text).toBe("# Next version\n")
  })

  it("a file that is no note, or a newer WriteMind's, is refused in words and left as it is", async () => {
    const root = temp()
    const file = path.join(root, WELCOME_FILE)
    await fs.writeFile(file, "just words, not a zip\n")
    await expect(ensureQuickReference(root)).rejects.toThrow(/cannot be opened as a WriteMind note/)
    expect(await fs.readFile(file, "utf8")).toBe("just words, not a zip\n")
    await fs.rm(file)

    writeWm(file, "# From the future\n", { manifest: { version: 2 } })
    const bytes = readFileSync(file)
    await expect(ensureQuickReference(root)).rejects.toThrow(/newer WriteMind/)
    expect(readFileSync(file).equals(bytes)).toBe(true)
  })

  it("test instances are left alone unless they ask", () => {
    expect(welcomeWanted({})).toBe(true)
    expect(welcomeWanted({ WRITEMIND_E2E: "1" })).toBe(false)
    expect(welcomeWanted({ WRITEMIND_OFFSCREEN: "1" })).toBe(false)
    expect(welcomeWanted({ WRITEMIND_E2E: "1", WRITEMIND_OFFSCREEN: "1", WRITEMIND_WELCOME: "1" })).toBe(true)
    expect(welcomeWanted({ WRITEMIND_WELCOME: "0" })).toBe(false)
  })
})
