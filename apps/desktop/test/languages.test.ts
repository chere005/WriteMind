/**
 * File ▸ Language Setup…, the pure half (src/shared/languages.ts): the settings file, the picker per platform, and
 * what the Windows setup window's answer is said as. Port-only (the Mac keeps `evalTool.<name>` in its defaults).
 */
import { describe, expect, it } from "vitest"
import {
  isAbsolutePath, isLinkId, isSetupAction, LINKS, pickerOptions, readLanguageSettings, readSetupResult, setupSentence,
  writeLanguageSettings,
} from "../src/shared/languages"

const file = (tools: unknown, version: unknown = 1) => JSON.stringify({ version, tools })

describe("the settings file (languages.json)", () => {
  it("reads a choice per language, and nothing at all from what is not the file", () => {
    expect(readLanguageSettings(file({ python: "/Users/s/venv/bin/python3", wolfram: "/opt/homebrew/bin/wolframscript" }), "darwin"))
      .toEqual({ python: "/Users/s/venv/bin/python3", wolfram: "/opt/homebrew/bin/wolframscript" })
    for (const text of [null, "", "{", "[]", "3", "null", '"x"', file({ python: "/v/bin/python3" }, 2), file({ python: "/v/bin/python3" }, "1"),
      JSON.stringify({ tools: { python: "/v/bin/python3" } }), file([]), file("x"), file(null)]) {
      expect(readLanguageSettings(text, "darwin"), String(text)).toEqual({})
    }
    // A leading byte-order mark (Notepad's) is not a reason to drop the file.
    expect(readLanguageSettings(`\uFEFF${file({ rust: "/Users/s/.cargo/bin/rustc" })}`, "linux")).toEqual({ rust: "/Users/s/.cargo/bin/rustc" })
  })

  it("drops each entry it cannot use by itself, and keeps the rest", () => {
    const read = (tools: Record<string, unknown>, platform = "darwin") => readLanguageSettings(file({ ...tools, rust: "/r/rustc" }), platform)
    const kept = { rust: "/r/rustc" }
    expect(read({ bash: "/bin/bash" })).toEqual(kept)
    expect(read({ python: 3 })).toEqual(kept)
    expect(read({ python: "" })).toEqual(kept)
    expect(read({ python: `/${"a".repeat(4100)}/python3` })).toEqual(kept)
    expect(read({ python: "/v/bin/python3\0" })).toEqual(kept)
    expect(read({ python: "venv/bin/python3" })).toEqual(kept)
    expect(read({ python: "/bin/rm" })).toEqual(kept)
    expect(read({ wolfram: "/x/WolframKernel" })).toEqual(kept)
    // Windows: a full path to an .exe or .com, never a script, never "C:x".
    const win = (python: string) => readLanguageSettings(file({ python }), "win32")
    expect(win("C:\\Python314\\python.exe")).toEqual({ python: "C:\\Python314\\python.exe" })
    expect(win("\\\\server\\tools\\python.exe")).toEqual({ python: "\\\\server\\tools\\python.exe" })
    expect(win("C:\\Python314\\python.cmd")).toEqual({})
    expect(win("C:\\Python314\\python")).toEqual({})
    expect(win("C:python.exe")).toEqual({})
    expect(win("/usr/bin/python3")).toEqual({})
  })

  it("writes version 1, the menu's order, two-space JSON and a newline, and reads back what it wrote", () => {
    const tools = { rust: "/Users/s/.cargo/bin/rustc", python: "/Users/s/My Envs/ünï/bin/python3" }
    const text = writeLanguageSettings(tools)
    expect(text).toBe(`{\n  "version": 1,\n  "tools": {\n    "python": "/Users/s/My Envs/ünï/bin/python3",\n    "rust": "/Users/s/.cargo/bin/rustc"\n  }\n}\n`)
    expect(readLanguageSettings(text, "darwin")).toEqual(tools)
    expect(writeLanguageSettings({})).toBe(`{\n  "version": 1,\n  "tools": {}\n}\n`)
    const windows = { python: "C:\\Users\\Ünï\\venv\\Scripts\\python.exe" }
    expect(readLanguageSettings(writeLanguageSettings(windows), "win32")).toEqual(windows)
  })

  it("knows a full path: a drive and a separator or a UNC share on Windows, a leading slash elsewhere", () => {
    expect(isAbsolutePath("C:\\x\\py.exe", "win32")).toBe(true)
    expect(isAbsolutePath("c:/x/py.exe", "win32")).toBe(true)
    expect(isAbsolutePath("\\\\server\\share\\py.exe", "win32")).toBe(true)
    expect(isAbsolutePath("C:x\\py.exe", "win32")).toBe(false)
    expect(isAbsolutePath("\\x\\py.exe", "win32")).toBe(false)
    expect(isAbsolutePath("\\\\server", "win32")).toBe(false)
    expect(isAbsolutePath("/usr/bin/python3", "darwin")).toBe(true)
    expect(isAbsolutePath("usr/bin/python3", "linux")).toBe(false)
    expect(isAbsolutePath("C:\\x", "linux")).toBe(false)
  })
})

describe("the picker, per platform", () => {
  it("a Mac picks files and folders, shows .venv, keeps a venv's link as the link, and picks an .app whole", () => {
    const mac = pickerOptions("python", "darwin", "/Users/s/venv/bin/python3")
    expect(mac).toEqual({
      title: "Choose the Python program Python cells run with, or a virtual environment's folder",
      message: "Choose the Python program Python cells run with, or a virtual environment's folder",
      buttonLabel: "Use", defaultPath: "/Users/s/venv/bin",
      properties: ["openFile", "openDirectory", "showHiddenFiles", "noResolveAliases"],
    })
    for (const platform of ["darwin", "win32", "linux"]) {
      expect(pickerOptions("wolfram", platform, null).properties, platform).not.toContain("treatPackageAsDirectory")
    }
  })

  it("Windows picks programs only; Linux picks a file and shows hidden folders; neither resolves anything", () => {
    expect(pickerOptions("python", "win32", "C:\\Users\\S\\venv\\Scripts\\python.exe")).toEqual({
      title: "Choose the python.exe Python cells run with (in a virtual environment it is in Scripts)",
      message: "Choose the python.exe Python cells run with (in a virtual environment it is in Scripts)",
      buttonLabel: "Use", defaultPath: "C:\\Users\\S\\venv\\Scripts",
      properties: ["openFile"], filters: [{ name: "Programs", extensions: ["exe", "com"] }],
    })
    expect(pickerOptions("python", "linux", null)).toEqual({
      title: "Choose the Python program Python cells run with (in a virtual environment it is bin/python3)",
      message: "Choose the Python program Python cells run with (in a virtual environment it is bin/python3)",
      buttonLabel: "Use", properties: ["openFile", "showHiddenFiles"],
    })
    expect(pickerOptions("python", "win32", null).properties).not.toContain("noResolveAliases")
    expect(pickerOptions("python", "linux", null).properties).not.toContain("noResolveAliases")
  })

  it("says what each language's program is called", () => {
    expect(pickerOptions("wolfram", "darwin", null).title).toBe("Choose the wolframscript Wolfram cells run with")
    expect(pickerOptions("c", "linux", null).title).toBe("Choose the C compiler C cells build with (gcc, clang or cl)")
    expect(pickerOptions("cpp", "win32", null).title).toBe("Choose the C++ compiler C++ cells build with (g++, clang++ or cl)")
    expect(pickerOptions("rust", "darwin", null).title).toBe("Choose the rustc Rust cells build with")
    expect(pickerOptions("rust", "darwin", "/rustc").defaultPath).toBe("/")
  })
})

describe("the Windows setup window's answer", () => {
  it("reads the script's [result] INI, decoded from UTF-16 with its BOM", () => {
    const bytes = Buffer.from("\uFEFF[result]\r\npython=installed\r\nwolfram=not asked\r\nactivate=opened\r\nwinget=C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\r\n", "utf16le")
    expect(readSetupResult(bytes.toString("utf16le"))).toEqual({
      python: "installed", wolfram: "not asked", activate: "opened", winget: "C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe",
    })
    expect(readSetupResult("[tools]\npython=C:\\x\n")).toEqual({})
    expect(readSetupResult("")).toEqual({})
  })

  it("says each outcome in a sentence", () => {
    const log = "C:\\Users\\S\\AppData\\Roaming\\WriteMind\\tools-setup.log"
    const say = (action: "python" | "wolfram" | "activate", values: Record<string, string> | null, found = true) =>
      setupSentence(action, values, found, log)
    expect(say("python", { python: "installed" })).toBe("Python installed.")
    expect(say("python", { python: "installed (restart needed)" })).toBe("Python installed; Windows wants a restart to finish.")
    expect(say("wolfram", { wolfram: "already installed" })).toBe("Wolfram Engine was already installed.")
    expect(say("python", { python: "failed: winget is missing" }))
      .toBe("winget is not on this computer, so Python could not be installed from here. Use Get Python… instead.")
    expect(say("wolfram", { wolfram: "failed: winget exit code 0x8A150014" }))
      .toBe(`winget stopped (exit code 0x8A150014). Nothing was installed; the window said why, and the details are in ${log}.`)
    expect(say("python", { python: "dry run" })).toBe("Dry run: nothing was installed.")
    expect(say("python", { python: "dry run (winget missing)" })).toBe("Dry run: nothing was installed.")
    expect(say("activate", { activate: "dry run" })).toBe("Dry run: nothing was installed.")
    expect(say("python", { python: "installed" }, false)).toBe("Python is installed, but not where WriteMind looks. Use Choose… to point at it.")
    expect(say("activate", { activate: "opened" })).toBe("Sign in with your Wolfram ID in the window that opened. WriteMind looks again when you come back.")
    expect(say("activate", { activate: "already activated" })).toBe("The Wolfram Engine is already activated.")
    expect(say("activate", { activate: "failed: wolframscript.exe not found" }))
      .toBe("There is no wolframscript to activate yet: install the Wolfram Engine first, or choose its wolframscript.")
    expect(say("python", null)).toBe(`The setup window closed before it finished. The details are in ${log}.`)
    expect(say("wolfram", { wolfram: "installed", activate: "opened" }))
      .toBe("Wolfram Engine installed. Then sign in with your Wolfram ID in the window that opened.")
    expect(say("python", { python: "something new" })).toBe(`Python could not be installed (something new). The details are in ${log}.`)
  })

  it("takes only its own actions and links", () => {
    expect(["python", "wolfram", "activate"].every(isSetupAction)).toBe(true)
    expect(isSetupAction("rust")).toBe(false)
    expect(isSetupAction(undefined)).toBe(false)
    expect(Object.keys(LINKS).every(isLinkId)).toBe(true)
    expect(isLinkId("https://example.com")).toBe(false)
    expect(isLinkId("toString")).toBe(false)
    expect(Object.values(LINKS).every((url) => url.startsWith("https://www."))).toBe(true)
  })
})
