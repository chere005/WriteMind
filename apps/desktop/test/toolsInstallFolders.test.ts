/**
 * The folders the Windows installer's "Install Python" / "Install Wolfram Engine" put a tool in, found by tools.ts
 * WITHOUT the PATH: a WriteMind that was already open (or started by the installer) still has the PATH it was born
 * with, and python.org's installer does not add Python to it unless asked.
 */
import { describe, expect, it } from "vitest"
import { findTool, lookedFor, pythonFolders, toolCandidates, type ToolPlaces } from "../src/main/eval/tools"

const LOCAL = "C:\\Users\\S\\AppData\\Local"
const PF = "C:\\Program Files"
const PF86 = "C:\\Program Files (x86)"

const places = (present: string[], tree: Record<string, string[]> = {}): ToolPlaces => ({
  platform: "win32",
  pathVariable: "C:\\Windows\\system32;C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps",
  home: "C:\\Users\\S",
  programFiles: [PF, PF86],
  localAppData: LOCAL,
  isFile: (file) => present.includes(file),
  folders: (dir) => tree[dir] ?? [],
})

describe("Python where its installer put it (tools.ts)", () => {
  it("orders Python3NN folders newest first, 64-bit before 32-bit, and ignores the rest", () => {
    expect(pythonFolders(["Python39", "Python314-32", "Launcher", "Python313", "Python314", "Python27", "python312-arm64"]))
      .toEqual(["Python314", "Python314-32", "Python313", "python312-arm64", "Python39"])
  })

  it("finds a per-user winget Python that is not on the PATH", () => {
    const exe = `${LOCAL}\\Programs\\Python\\Python314\\python.exe`
    const tree = { [`${LOCAL}\\Programs\\Python`]: ["Launcher", "Python313", "Python314"] }
    expect(findTool("python", places([exe], tree))).toBe(exe)
    // The per-user launcher wins when it is there, as `py` on the PATH would.
    const launcher = `${LOCAL}\\Programs\\Python\\Launcher\\py.exe`
    expect(findTool("python", places([exe, launcher], tree))).toBe(launcher)
  })

  it("finds an all-users Python under Program Files (x86 included), after the PATH and before the Store's placeholder", () => {
    const exe = `${PF86}\\Python314-32\\python.exe`
    const all = toolCandidates("python", places([], { [PF86]: ["Python314-32", "Common Files"] }))
    expect(all).toContain(exe)
    expect(all.indexOf("C:\\Windows\\system32\\py.exe")).toBeLessThan(all.indexOf(exe))
    const store = all.findIndex((file) => /WindowsApps/.test(file))
    expect(all.indexOf(exe)).toBeLessThan(store)
    expect(findTool("python", places([exe, "C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe"],
      { [PF86]: ["Python314-32"] }))).toBe(exe)
  })

  it("says where it looked in words, and makes nothing up off Windows or without the folders", () => {
    expect(lookedFor("python", places([]))[0]).toBe("py, python3, python on the PATH")
    expect(lookedFor("python", places([])).join(" ")).toMatch(/Programs\\Python.*Program Files\\Python3/)
    expect(toolCandidates("python", { ...places([]), platform: "linux", pathVariable: "/usr/bin" }))
      .toEqual(["/usr/bin/py", "/usr/bin/python3", "/usr/bin/python"])
    expect(toolCandidates("python", { ...places([]), localAppData: "", folders: undefined })
      .some((file) => /Programs\\Python|Python3\d/.test(file))).toBe(false)
  })

  it("finds the winget Wolfram Engine's wolframscript in its version folder", () => {
    const engines = `${PF}\\Wolfram Research\\Wolfram Engine`
    const exe = `${engines}\\15.0\\wolframscript.exe`
    expect(findTool("wolfram", places([exe], { [engines]: ["14.3", "15.0"] }))).toBe(exe)
  })
})

describe("Homebrew on a Finder-launched Mac app (tools.ts)", () => {
  const mac = (installed: string[]): ToolPlaces => ({
    platform: "darwin", pathVariable: "/usr/bin:/bin:/usr/sbin:/sbin", home: "/Users/a", programFiles: [],
    isFile: (file) => installed.includes(file),
  })
  it("finds a tool in Homebrew's folders when the PATH has none", () => {
    expect(findTool("python", mac(["/opt/homebrew/bin/python3"]))).toBe("/opt/homebrew/bin/python3")
    expect(findTool("python", mac(["/usr/local/bin/python3"]))).toBe("/usr/local/bin/python3")
  })
  it("prefers the PATH's own copy", () => {
    expect(findTool("python", mac(["/usr/bin/python3", "/opt/homebrew/bin/python3"]))).toBe("/usr/bin/python3")
  })
})
