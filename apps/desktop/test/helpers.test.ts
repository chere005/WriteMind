import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { shipped, toolsScript, winget } from "../src/main/helpers"

/**
 * What the shell finds beside the app. A capability is a FILE BEING THERE (the reader's own rules: oneReader.test.ts).
 */
describe("the helpers this machine has", () => {
  it("finds the installer's own tools script beside a Windows app, outside the asar, and nowhere else", () => {
    const inside = path.join("C:", "Users", "S", "AppData", "Local", "Programs", "WriteMind", "resources", "app.asar", "out", "main")
    const seen: string[] = []
    const there = toolsScript(inside, "win32", (file) => { seen.push(file); return true })
    expect(there).toContain(`app.asar.unpacked${path.sep}out${path.sep}helpers${path.sep}installer-tools.ps1`)
    expect(seen).toEqual([there])
    expect(toolsScript(inside, "win32", () => false)).toBeNull()
    expect(toolsScript(inside, "darwin", () => true)).toBeNull()
    expect(toolsScript(inside, "linux", () => true)).toBeNull()
  })

  it("finds winget on the PATH, else the Store's alias, and only on Windows", () => {
    const env = { Path: "C:\\Windows;C:\\Tools", LOCALAPPDATA: "C:\\Users\\S\\AppData\\Local" }
    expect(winget("win32", env, (file) => file === "C:\\Tools\\winget.exe")).toBe("C:\\Tools\\winget.exe")
    expect(winget("win32", env, (file) => file === "C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe"))
      .toBe("C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe")
    expect(winget("win32", env, () => false)).toBeNull()
    expect(winget("darwin", env, () => true)).toBeNull()
  })

  it("ships the installer's script for Language Setup: copied by the build, ASCII, -FromApp only from the app", () => {
    const root = path.resolve(__dirname, "../../..")
    const build = readFileSync(path.join(root, "apps/desktop/scripts/build.mjs"), "utf8")
    expect(build).toMatch(/copyFileSync\("\.\.\/\.\.\/packaging\/installer-tools\.ps1", "out\/helpers\/installer-tools\.ps1"\)/)
    const script = readFileSync(path.join(root, "packaging/installer-tools.ps1"))
    // Windows PowerShell 5.1 reads a script without a BOM in the ANSI code page: one byte past ASCII breaks it.
    expect([...script].every((byte) => byte < 0x80)).toBe(true)
    const text = script.toString("utf8")
    expect(text).toMatch(/\[switch\]\$FromApp/)
    expect(text).toMatch(/\[string\]\$WolframScript = ""/)
    expect(text).toContain("WriteMind - Language Setup")
    // The installer runs it as it always has: never with the app's switches.
    const nsis = readFileSync(path.join(root, "packaging/installer.nsh"), "utf8")
    expect(nsis).not.toMatch(/-FromApp|-WolframScript/)
  })

  it("looks for a shipped helper OUTSIDE the asar, where it can be run", () => {
    // Nothing inside an archive can be executed, so electron-builder
    // unpacks the helpers beside it and the path has to follow.
    const inside = path.join("/Applications/WriteMind.app/Contents/Resources/app.asar",
      "out", "main")
    expect(shipped(inside, "../helpers/bundled-ocr"))
      .toContain(`app.asar.unpacked${path.sep}out${path.sep}helpers`)
    expect(shipped("/src/out/main", "../helpers/bundled-ocr"))
      .toBe(path.join("/src/out/helpers/bundled-ocr"))
  })
})
