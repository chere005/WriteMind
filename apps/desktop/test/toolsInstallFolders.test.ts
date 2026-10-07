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
  it("prefers Homebrew's copy to the system's, as a Terminal does", () => {
    expect(findTool("python", mac(["/usr/bin/python3", "/opt/homebrew/bin/python3"]))).toBe("/opt/homebrew/bin/python3")
  })
  it("keeps a PATH that already names Homebrew in its own order", () => {
    const places = { ...mac(["/usr/bin/python3", "/opt/homebrew/bin/python3"]), pathVariable: "/usr/bin:/opt/homebrew/bin" }
    expect(findTool("python", places)).toBe("/usr/bin/python3")
  })
})

// Port-only (the Wolfram notebook export and a drawing cell copied into Mathematica): a FULL Mathematica is found
// with nothing chosen in Language Setup — Sean has one on another machine.
describe("a full Mathematica where its installer put it (tools.ts)", () => {
  const research = `${PF}\\Wolfram Research`
  const mac = (installed: string[]): ToolPlaces => ({
    platform: "darwin", pathVariable: "/usr/bin:/bin", home: "/Users/a", programFiles: [], isFile: (file) => installed.includes(file),
  })

  it("on a Mac: the Engine's app first, then Wolfram.app, then Mathematica.app, after Homebrew's", () => {
    const engine = "/Applications/Wolfram Engine.app/Contents/Resources/Wolfram Player.app/Contents/MacOS/wolframscript"
    const wolfram = "/Applications/Wolfram.app/Contents/MacOS/wolframscript"
    const mathematica = "/Applications/Mathematica.app/Contents/MacOS/wolframscript"
    const order = toolCandidates("wolfram", mac([]))
    // (The PATH's own folders come in between: they are not the point here.)
    expect(order.filter((file) => !/^\/(usr\/)?bin\//.test(file))).toEqual([
      "/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript", engine, wolfram, mathematica,
    ])
    expect(findTool("wolfram", mac([mathematica]))).toBe(mathematica)
    expect(findTool("wolfram", mac([mathematica, wolfram]))).toBe(wolfram)
    expect(findTool("wolfram", mac([mathematica, wolfram, engine]))).toBe(engine)
  })

  it("on a Mac the apps are said as apps, not as the folders inside them", () => {
    expect(lookedFor("wolfram", mac([]))).toEqual(["wolframscript on the PATH", "/opt/homebrew/bin/wolframscript",
      "/usr/local/bin/wolframscript", "/Applications/Wolfram Engine.app", "/Applications/Wolfram.app", "/Applications/Mathematica.app"])
  })

  it("on Windows: Wolfram\\<version> and Mathematica\\<version>, newest first, after the Engine's folders", () => {
    const tree = {
      [`${research}\\Wolfram Engine`]: ["14.1"],
      [`${research}\\Wolfram`]: ["13.3", "14.3", "14.10"],
      [`${research}\\Mathematica`]: ["12.0", "14.0"],
    }
    const all = toolCandidates("wolfram", places([], tree))
    const mine = all.filter((file) => /wolframscript\.exe$/.test(file) && file.startsWith(research))
    expect(mine).toEqual([
      `${research}\\WolframScript\\wolframscript.exe`,
      `${research}\\Wolfram Engine\\14.1\\wolframscript.exe`,
      `${research}\\Wolfram\\14.10\\wolframscript.exe`, `${research}\\Wolfram\\14.3\\wolframscript.exe`, `${research}\\Wolfram\\13.3\\wolframscript.exe`,
      `${research}\\Mathematica\\14.0\\wolframscript.exe`, `${research}\\Mathematica\\12.0\\wolframscript.exe`,
    ])
    const exe = `${research}\\Wolfram\\14.3\\wolframscript.exe`
    expect(findTool("wolfram", places([exe], tree))).toBe(exe)
    const old = `${research}\\Mathematica\\14.0\\wolframscript.exe`
    expect(findTool("wolfram", places([old], tree))).toBe(old)
  })

  it("on Windows the folders are said once each, as the places they are", () => {
    expect(lookedFor("wolfram", places([]))).toEqual([
      "wolframscript on the PATH", "Program Files\\Wolfram Research\\WolframScript", "Program Files\\Wolfram Research\\Wolfram Engine\\<version>",
      "Program Files\\Wolfram Research\\Wolfram\\<version>", "Program Files\\Wolfram Research\\Mathematica\\<version>",
    ])
  })
})
