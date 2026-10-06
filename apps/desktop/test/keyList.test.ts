// Transcribed from WriteMindTests/ShortcutTests.swift (Mac e8b3266): the keys, and the promise that no two
// commands want the same one. Sean, 2026-09-21, asking for ⌘S, ⌘P, ⌘E, ⌘T and ⌘Y: "unless there's conflicts
// with those?" — this is the answer, in a form that goes on answering. The Mac's README table is docs/KEYS.md
// here, and the port adds Help ▸ Keyboard Shortcuts (shared/keyList.ts), held to the menu bar below.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { MenuItemConstructorOptions } from "electron"
import { HEADING_LADDER } from "@writemind/core"
import {
  COMMANDS, HEADING_COMMANDS, acceleratorFor, commandForKey, initialMenuState, shown,
} from "../src/shared/commands"
import { KEY_MENUS, keyList } from "../src/shared/keyList"
import { buildMenu } from "../src/main/menu"

const ROOT = path.resolve(__dirname, "../../..")

/** "CmdOrCtrl+Alt+Shift+Z", "Ctrl-Mod-ArrowUp", "Shift-Mod-x" → "ctrl+alt+shift+z" / "ctrl+up" / "ctrl+shift+x". */
function normal(chord: string, separator: "+" | "-"): string {
  const parts = chord.split(separator)
  const key = parts.pop()!.toLowerCase().replace(/^arrow/, "")
  const mods = new Set(parts.map((part) => part.toLowerCase()))
  const ctrl = mods.has("ctrl") || mods.has("control") || mods.has("mod") || mods.has("cmdorctrl")
  return [ctrl ? "ctrl" : "", mods.has("alt") ? "alt" : "", mods.has("shift") ? "shift" : "", key]
    .filter(Boolean).join("+")
}

const press = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key, ctrlKey: mods.ctrl === true, shiftKey: mods.shift === true, altKey: mods.alt === true, metaKey: false,
})

describe("ShortcutTests", () => {
  it("no two commands want the same key (on a PC, and on a Mac build)", () => {
    for (const platform of ["win32", "darwin"]) {
      const taken = new Map<string, string>()
      for (const command of COMMANDS) {
        const key = acceleratorFor(command.id, platform)
        if (!key) continue
        const signature = shown(command.id, platform).toLowerCase()
        expect(taken.get(signature), `${platform}: ${command.id} and ${taken.get(signature)} both want ${key}`).toBeUndefined()
        taken.set(signature, command.id)
      }
    }
  })

  // The ones Sean named, spelled out so that moving one is a decision somebody makes rather than a rename
  // nobody notices. ⌘Y is Ctrl+Shift+Y on a PC, where Ctrl+Y is Redo (docs/KEYS.md says so).
  it("the keys he asked for are the keys he gets", () => {
    const wanted: [string, string, string][] = [
      ["save", "Ctrl+S", "Cmd+S"],
      ["togglePen", "Ctrl+P", "Cmd+P"],
      ["export", "Ctrl+E", "Cmd+E"],
      ["toggleMode", "Ctrl+T", "Cmd+T"],
      ["toggleCamera", "Ctrl+Shift+Y", "Cmd+Y"],
      ["toggleSidebar", "Ctrl+K", "Cmd+K"],
      ["collapseSubsections", "Ctrl+;", "Cmd+;"],
    ]
    for (const [id, pc, mac] of wanted) {
      expect(shown(id, "win32"), id).toBe(pc)
      expect(shown(id, "darwin"), id).toBe(mac)
    }
    // And the page hears them (one press, one command).
    expect(commandForKey(press("s", { ctrl: true }), "win32")?.id).toBe("save")
    expect(commandForKey(press("e", { ctrl: true }), "win32")?.id).toBe("export")
    expect(commandForKey(press("p", { ctrl: true }), "win32")?.id).toBe("togglePen")
    expect(commandForKey(press("t", { ctrl: true }), "win32")?.id).toBe("toggleMode")
    expect(commandForKey(press("Y", { ctrl: true, shift: true }), "win32")?.id).toBe("toggleCamera")
    expect(commandForKey(press("k", { ctrl: true }), "win32")?.id).toBe("toggleSidebar")
    expect(commandForKey(press(";", { ctrl: true }), "win32")?.id).toBe("collapseSubsections")
    expect(commandForKey(press("F1"), "win32")?.id).toBe("keyList")
    // A digit is its physical key: Ctrl+Shift+7 types "&" and is still the 7 key. Ctrl+0 makes a drawing cell (the
    // page's); Ctrl+9 is the maths cell, which the editor's keymap hears, so the page leaves it alone (Sean, 2026-10-06).
    expect(commandForKey({ ...press("0", { ctrl: true }), code: "Digit0" }, "win32")?.id).toBe("insertInkCell")
    expect(commandForKey({ ...press("9", { ctrl: true }), code: "Digit9" }, "win32")).toBeNull()
    expect(shown("mathsCell", "win32")).toBe("Ctrl+9")
    expect(shown("mathsCell", "darwin")).toBe("Cmd+9")
    expect(shown("insertInkCell", "darwin")).toBe("Cmd+0")
    // Ctrl+Y stays Redo, which is useUndo's and not the page's.
    expect(commandForKey(press("y", { ctrl: true }), "win32")).toBeNull()
  })

  it("gone, on his word: the notes pane, the markers, Delete Cell and the caret's own fold keys have no key", () => {
    for (const id of ["toggleEditorPane", "toggleMarkers", "deleteCell", "useSelectionForFind"]) {
      expect(shown(id, "win32"), id).toBe("")
    }
    expect(COMMANDS.find((command) => command.id === "foldSection")).toBeUndefined()
    expect(COMMANDS.find((command) => command.id === "unfoldSection")).toBeUndefined()
    expect(commandForKey(press("e", { ctrl: true, alt: true }), "win32")).toBeNull()
    expect(commandForKey(press("m", { ctrl: true, alt: true }), "win32")).toBeNull()
    expect(commandForKey(press("ArrowLeft", { ctrl: true, alt: true }), "win32")).toBeNull()
  })

  it("every rung of the heading ladder has its own number", () => {
    const keys = HEADING_LADDER.map((level) => shown(HEADING_COMMANDS.find((h) => h.level === level)!.id, "win32"))
    expect(keys).toEqual(["Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4", "Ctrl+5", "Ctrl+6", "Ctrl+7"])
    expect(new Set(keys).size).toBe(keys.length)
  })

  // The one that was broken on the Mac. Both still exist; they no longer collide — and the sidebar has moved
  // off that chord altogether.
  it("saving the note and saving the project are different keys", () => {
    expect(shown("save", "win32")).not.toBe(shown("saveProject", "win32"))
    expect(shown("saveProject", "win32")).not.toBe(shown("toggleSidebar", "win32"))
    expect(shown("toggleSidebar", "win32")).toBe("Ctrl+K")
  })

  // THE KEY LIST IS THE LIST, so it cannot go stale (Sean, 2026-09-21: "document the keystrokes in the
  // readme"). Every chord the app binds is in docs/KEYS.md's table, under its menu and name, and the table
  // names no chord the app does not bind.
  it("docs/KEYS.md lists every key and no others", () => {
    const text = readFileSync(path.join(ROOT, "docs/KEYS.md"), "utf8").replace(/\r/g, "")
    const start = text.indexOf("## Every key")
    expect(start, "no '## Every key' section in docs/KEYS.md").toBeGreaterThanOrEqual(0)
    const next = text.indexOf("\n## ", start + 1)
    const section = text.slice(start, next < 0 ? undefined : next)
    const written = section.split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Menu |"))
      .map((line) => line.split("|").slice(1, 4).map((cell) => cell.trim()).join(" | "))
    expect(written.length, "no key table found").toBeGreaterThan(0)
    const bound = keyList("win32").flatMap((group) => group.rows.map((row) => `${group.menu} | ${row.name} | ${row.keys}`))
    expect(bound.filter((one) => !written.includes(one)), "bound but not in docs/KEYS.md").toEqual([])
    expect(written.filter((one) => !bound.includes(one)), "in docs/KEYS.md, which nothing binds").toEqual([])
    expect(written).toEqual(bound)
  })

  // A key bound outside the table is a key the clash test never sees. The editor's keymaps
  // (packages/editor/src) are the port's other place a chord is bound: each chord there with Ctrl or Alt in it
  // is a command's key in the table, and each editor-owned command's key is bound there.
  it("nothing binds a chord outside the table", () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name)
        if (statSync(file).isDirectory()) walk(file)
        else if (file.endsWith(".ts")) files.push(file)
      }
    }
    walk(path.join(ROOT, "packages/editor/src"))
    expect(files.length).toBeGreaterThan(0)
    const bound = new Map<string, string>()
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bkey: "([^"]+)"/g)) {
        if (!/(Mod|Ctrl|Alt|Meta|Cmd)-/.test(match[1]!)) continue
        bound.set(normal(match[1]!, "-"), `${path.basename(file)}: ${match[1]}`)
      }
    }
    const table = new Set(COMMANDS.filter((one) => one.key).map((one) => normal(one.key!, "+")))
    // Backspace over held cells takes them; with Ctrl it does the same (the key, not a menu chord).
    const allowed = new Set(["ctrl+backspace"])
    for (const [chord, where] of bound) {
      expect(table.has(chord) || allowed.has(chord), `${where} binds a chord outside shared/commands.ts`).toBe(true)
    }
    for (const command of COMMANDS.filter((one) => one.owner === "editor" && one.key)) {
      expect(bound.has(normal(command.key!, "+")), `${command.id}'s ${command.key} is shown but no editor keymap hears it`).toBe(true)
    }
  })
})

describe("Help ▸ Keyboard Shortcuts (shared/keyList.ts)", () => {
  const every = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    items.flatMap((one) => [one, ...every((one.submenu ?? []) as MenuItemConstructorOptions[])])

  it("lists every command that has a key, once", () => {
    const listed = keyList("win32").flatMap((group) => group.rows.map((row) => row.id))
    expect(new Set(listed).size).toBe(listed.length)
    const keyed = COMMANDS.filter((one) => shown(one.id, "win32")).map((one) => one.id)
    expect([...listed].sort()).toEqual([...keyed].sort())
    // And names nothing the table does not have.
    const known = new Set(COMMANDS.map((one) => one.id))
    for (const { ids } of KEY_MENUS) for (const id of ids) expect(known.has(id), id).toBe(true)
  })

  it("groups them as the menu bar does, in its order", () => {
    const bar = buildMenu({
      platform: "win32", state: initialMenuState, run: () => {},
      project: { name: "P", edited: false, folders: [{ path: "/a", name: "a" }] },
    })
    const fromMenu = bar
      .map((menu) => ({
        menu: menu.label ?? (menu.role === "help" ? "Help" : String(menu.role)),
        ids: every((menu.submenu ?? []) as MenuItemConstructorOptions[])
          .filter((one) => one.accelerator && one.id).map((one) => one.id!),
      }))
      .filter((group) => group.ids.length > 0)
    expect(keyList("win32").map((group) => ({ menu: group.menu, ids: group.rows.map((row) => row.id) }))).toEqual(fromMenu)
  })

  it("names the toggles for both their states and the headings by their rung", () => {
    const rows = keyList("win32").flatMap((group) => group.rows)
    const name = (id: string) => rows.find((row) => row.id === id)?.name
    expect(name("toggleSidebar")).toBe("Show / Hide Notes Sidebar")
    expect(name("togglePen")).toBe("Draw / Stop Drawing")
    expect(name("heading:1")).toBe("Title")
    // Ctrl+7 is a plain-text cell now (docs/PLAN-text-cells.md: "Text (was Body Text)").
    expect(name("heading:0")).toBe("Text")
    expect(name("markdownCell")).toBe("Markdown")
    expect(name("keyList")).toBe("Keyboard Shortcuts")
  })
})
