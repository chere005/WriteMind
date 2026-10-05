import { describe, expect, it } from "vitest"
import { COMMANDS, commandForKey, shown } from "../src/shared/commands"

const press = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key, ctrlKey: mods.ctrl === true, shiftKey: mods.shift === true, altKey: mods.alt === true, metaKey: false,
})

// The Mac's text view has a find bar (usesFindBar): ⌘F, ⌘G / ⇧⌘G, ⌘E, ⌥⌘F, ⌘J. See docs/KEYS.md.
describe("the find keys", () => {
  it("Ctrl+F finds, Ctrl+H replaces, Ctrl+E takes the selection, Ctrl+J jumps to it", () => {
    expect(commandForKey(press("f", { ctrl: true }), "win32")?.id).toBe("find")
    expect(commandForKey(press("h", { ctrl: true }), "win32")?.id).toBe("findReplace")
    expect(commandForKey(press("e", { ctrl: true }), "win32")?.id).toBe("useSelectionForFind")
    expect(commandForKey(press("j", { ctrl: true }), "win32")?.id).toBe("jumpToSelection")
  })

  it("F3 / Shift+F3 are Find Next / Previous on a PC, the Mac's own keys on a Mac", () => {
    expect(commandForKey(press("F3"), "win32")?.id).toBe("findNext")
    expect(commandForKey(press("F3", { shift: true }), "win32")?.id).toBe("findPrevious")
    expect(shown("findNext", "win32")).toBe("F3")
    expect(shown("findNext", "darwin")).toBe("Cmd+G")
    expect(shown("findPrevious", "darwin")).toBe("Shift+Cmd+G")
    expect(shown("findReplace", "darwin")).toBe("Alt+Cmd+F")
  })

  it("Ctrl+G stays free: it is Group on the drawing layer (the Mac's ⌃G)", () => {
    expect(commandForKey(press("g", { ctrl: true }), "win32")).toBeNull()
    expect(commandForKey(press("g", { ctrl: true, shift: true }), "win32")).toBeNull()
  })

  it("no two commands share a chord on a PC", () => {
    const seen = new Map<string, string>()
    for (const command of COMMANDS) {
      const key = command.key
      if (!key) continue
      const clash = seen.get(key.toLowerCase())
      expect(clash, `${command.id} and ${clash} both use ${key}`).toBeUndefined()
      seen.set(key.toLowerCase(), command.id)
    }
  })
})
