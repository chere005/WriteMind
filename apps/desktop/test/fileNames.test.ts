import { describe, expect, it } from "vitest"
import { MAX_STEM, safeName } from "../src/main/fileNames"

// Renaming a note or a section to "What now?" reached the disk as typed and came back as
// `ENOENT: no such file or directory, rename …` (verifier t13/rename.mjs). The names that failed are here.
describe("a name fit for the disk", () => {
  const win = (typed: string, extra = {}) => safeName(typed, { platform: "win32", ...extra })

  it("takes out the characters Windows will not store, and keeps the rest of what was typed", () => {
    expect(win("What now?")).toBe("What now")
    expect(win("a*b")).toBe("ab")
    expect(win('say "hi"')).toBe("say 'hi'")
    expect(win("x|y")).toBe("x-y")
    expect(win("<draft>")).toBe("draft")
    expect(win("2026/10/03: notes")).toBe("2026-10-03- notes")
    expect(win("a\\b")).toBe("a-b")
    expect(win("tab\tand\u0007bell")).toBe("tabandbell")
  })

  it("leaves a name the Mac would take alone on the Mac, except what the Mac cannot take either", () => {
    expect(safeName("What now?", { platform: "darwin" })).toBe("What now?")
    expect(safeName("a:b/c", { platform: "darwin" })).toBe("a-b-c")
    expect(safeName("x|y*", { platform: "linux" })).toBe("x|y*")
  })

  it("drops the trailing dots and spaces Windows would drop on its own, and leading ones that would hide the note", () => {
    expect(win("Ideas.")).toBe("Ideas")
    expect(win("Ideas . . ")).toBe("Ideas")
    expect(win("  padded  ")).toBe("padded")
    expect(win(".hidden")).toBe("hidden")
    expect(win("...")).toBe("")
    expect(win("???")).toBe("")
  })

  it("does not take the names Windows keeps for devices, with or without an extension", () => {
    for (const reserved of ["CON", "con", "NUL", "aux", "PRN", "COM1", "lpt9"]) {
      expect(win(reserved)).toBe(`${reserved}-`)
    }
    expect(win("console")).toBe("console")
    expect(win("COM10")).toBe("COM10")
    expect(safeName("CON", { platform: "darwin" })).toBe("CON")
  })

  it("keeps a long name inside what the disk takes, leaving room for the folder it sits in", () => {
    const long = "x".repeat(300)
    expect(win(long).length).toBe(MAX_STEM)
    const deep = "C:\\" + "folder\\".repeat(25)
    const room = win(long, { folder: deep, extension: ".md" })
    expect(deep.length + room.length + ".md".length + 1).toBeLessThanOrEqual(260)
    expect(room.length).toBeGreaterThanOrEqual(12)
  })

  it("does not cut a letter in half", () => {
    const name = win("a".repeat(MAX_STEM - 1) + "😀😀")
    expect(name.endsWith("\ud83d")).toBe(false)
    expect(Array.from(name).every((char) => char.length > 0)).toBe(true)
  })

  it("is empty when nothing of the name is left, for the caller to decide", () => {
    expect(win("")).toBe("")
    expect(win("   ")).toBe("")
    expect(win("<>")).toBe("")
  })
})
