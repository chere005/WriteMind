// shared/chord.ts: the key list draws a chord as caps, in Apple's order (⌃⌥⇧⌘) on a Mac (docs/PLAN-bars-2026-10.md P6).
import { describe, expect, it } from "vitest"
import { chordCaps, chordParts, modChord } from "../src/shared/chord"
import { COMMANDS, shown } from "../src/shared/commands"

describe("a chord as caps", () => {
  it("a Mac prints the modifiers in Apple's order, as symbols, whatever order the table wrote them in", () => {
    expect(chordCaps("Shift+Cmd+G", "darwin")).toEqual(["⇧", "⌘", "G"])
    expect(chordCaps("Cmd+Shift+G", "darwin")).toEqual(["⇧", "⌘", "G"])
    expect(chordCaps("Alt+Cmd+F", "darwin")).toEqual(["⌥", "⌘", "F"])
    expect(chordCaps("Cmd+Alt+Ctrl+Shift+X", "darwin")).toEqual(["⌃", "⌥", "⇧", "⌘", "X"])
    expect(chordCaps("Ctrl+Cmd+Up", "darwin")).toEqual(["⌃", "⌘", "↑"])
  })

  it("a PC prints its words, Ctrl then Alt then Shift then the key", () => {
    expect(chordCaps("Ctrl+Shift+Y", "win32")).toEqual(["Ctrl", "Shift", "Y"])
    expect(chordCaps("Shift+Alt+Ctrl+Up", "win32")).toEqual(["Ctrl", "Alt", "Shift", "Up"])
    expect(chordCaps("F3", "win32")).toEqual(["F3"])
  })

  it("a key alone, a plus key and a named key survive the split", () => {
    expect(chordParts("Ctrl++")).toEqual({ modifiers: ["Ctrl"], key: "+" })
    expect(chordCaps("F1", "darwin")).toEqual(["F1"])
    expect(chordCaps("Cmd+Enter", "darwin")).toEqual(["⌘", "↩"])
  })

  it("every chord the table has gives a cap per part and never loses the key, on both platforms", () => {
    for (const platform of ["win32", "darwin"]) {
      for (const command of COMMANDS) {
        const keys = shown(command.id, platform)
        if (!keys) continue
        const caps = chordCaps(keys, platform)
        expect(caps.length, `${platform} ${command.id}: ${keys}`).toBe(chordParts(keys).modifiers.length + 1)
        expect(caps.every((cap) => cap.length > 0), `${platform} ${command.id}`).toBe(true)
        // A Mac never prints a modifier as a word.
        if (platform === "darwin") for (const cap of caps.slice(0, -1)) expect(["⌃", "⌥", "⇧", "⌘"]).toContain(cap)
      }
    }
  })
})

describe("the command key's word", () => {
  it("is Cmd on a Mac and Ctrl everywhere else, so no label types Ctrl by hand", () => {
    expect(modChord("darwin", "X")).toBe("Cmd+X")
    expect(modChord("win32", "X")).toBe("Ctrl+X")
    expect(modChord("linux", "V")).toBe("Ctrl+V")
    // It is exactly what shown() prints for a CmdOrCtrl command.
    expect(modChord("darwin", "S")).toBe(shown("save", "darwin"))
    expect(modChord("win32", "S")).toBe(shown("save", "win32"))
  })
})
