import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { canRead, readWords, shipped, tesseract, toolsScript, winget } from "../src/main/helpers"

/**
 * The reader that Linux and Windows use. A capability is a FILE BEING
 * THERE, so the test puts one there — a stand-in that answers the way
 * tesseract does — and takes it away again.
 */
const was = process.env.PATH

afterEach(() => { process.env.PATH = was })

function withFakeTesseract(lines: string[]): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), "wm-bin-"))
  const file = path.join(folder, "tesseract")
  // `echo` is the shell's own, so the stub works with nothing else on the
  // PATH — which is the point of putting the folder FIRST rather than
  // instead of what was there.
  writeFileSync(file, `#!/bin/sh\n${lines.map((line) => `echo "${line}"`).join("\n")}\n`)
  chmodSync(file, 0o755)
  process.env.PATH = `${folder}${path.delimiter}${was ?? ""}`
  return folder
}

describe("the reader this machine has", () => {
  // The stand-in is a shell script; on Windows tesseract must be a real .exe.
  it.skipIf(process.platform === "win32")("finds tesseract on the PATH and reads a picture with it", async () => {
    withFakeTesseract(["first line", "", "second line"])
    expect(tesseract()).not.toBeNull()
    expect(canRead("/nowhere")).toBe(true)
    const out = await readWords("/nowhere", "/tmp/whatever.png")
    expect(out.lines.map((line) => line.text)).toEqual(["first line", "second line"])
    // Tesseract gives no confidence, so every line it found counts as read.
    expect(out.lines.every((line) => line.confidence === 1)).toBe(true)
  })

  it("says it cannot read when there is no reader at all", async () => {
    process.env.PATH = mkdtempSync(path.join(os.tmpdir(), "wm-empty-"))
    expect(tesseract()).toBeNull()
    expect(canRead("/nowhere")).toBe(false)
    expect(await readWords("/nowhere", "/tmp/whatever.png")).toEqual({ lines: [] })
  })

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
    expect(shipped(inside, "../helpers/wm-vision"))
      .toContain(`app.asar.unpacked${path.sep}out${path.sep}helpers`)
    expect(shipped("/src/out/main", "../helpers/wm-vision"))
      .toBe(path.join("/src/out/helpers/wm-vision"))
  })
})
