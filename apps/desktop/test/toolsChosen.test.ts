/**
 * A program chosen in File ▸ Language Setup… (tools.ts `toolEntry`, `resolveChoice`, `choiceProblem`), against FAKE
 * places: no file is read and nothing is started. Port-only — the Mac's `evalTool.<name>` falls through to its
 * candidates when the file it names has gone; here a choice is the only one its language uses, and a gone one is said.
 */
import { describe, expect, it } from "vitest"
import type { Evaluator } from "@writemind/core"
import {
  choiceProblem, findTool, flavorOf, foundTools, identifyArguments, interpreterArguments, lookedFor, MAC_ENGINE_WOLFRAMSCRIPT,
  resolveChoice, toolEntry, toolReport, wolframLicence, type ToolPlaces,
} from "../src/main/eval/tools"

interface Fake {
  files?: string[]
  /** Files that are there but cannot be started (not executable; a folder's own name is in `dirs`). */
  notPrograms?: string[]
  dirs?: string[]
  links?: Record<string, string>
  chosen?: Partial<Record<Evaluator, string>>
}

const mac = (fake: Fake = {}): ToolPlaces => ({
  platform: "darwin", pathVariable: "/usr/bin:/bin:/usr/sbin:/sbin", home: "/Users/s", programFiles: [],
  chosen: fake.chosen ?? {},
  isFile: (file) => (fake.files ?? []).includes(file) || (fake.notPrograms ?? []).includes(file),
  isProgram: (file) => (fake.files ?? []).includes(file),
  isDirectory: (file) => (fake.dirs ?? []).includes(file),
  realPath: (file) => fake.links?.[file] ?? file,
})
const linux = (fake: Fake = {}): ToolPlaces => ({ ...mac(fake), platform: "linux", pathVariable: "/usr/local/bin:/usr/bin" })
const windows = (fake: Fake = {}): ToolPlaces => ({
  platform: "win32", pathVariable: "C:\\Windows;C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps", home: "C:\\Users\\S",
  programFiles: ["C:\\Program Files"], localAppData: "C:\\Users\\S\\AppData\\Local",
  appData: "C:\\Users\\S\\AppData\\Roaming", programData: "C:\\ProgramData",
  chosen: fake.chosen ?? {},
  isFile: (file) => (fake.files ?? []).includes(file) || (fake.notPrograms ?? []).includes(file),
  isProgram: (file) => (fake.files ?? []).includes(file) && /\.(exe|com)$/i.test(file),
  isDirectory: (file) => (fake.dirs ?? []).includes(file),
  realPath: (file) => fake.links?.[file] ?? file,
})

describe("a chosen program is the only one its language uses", () => {
  it("beats the copy a PATH search would find, on every platform", () => {
    const venv = "/Users/s/venv/bin/python3"
    expect(toolEntry("python", mac({ files: ["/usr/bin/python3", venv], chosen: { python: venv } })).path).toBe(venv)
    expect(toolEntry("python", linux({ files: ["/usr/bin/python3", venv], chosen: { python: venv } })).path).toBe(venv)
    const win = "C:\\Users\\S\\venv\\Scripts\\python.exe"
    expect(toolEntry("python", windows({ files: ["C:\\Windows\\py.exe", win], chosen: { python: win } })).path).toBe(win)
  })

  // BREAK-IT: watched failing against a toolEntry that fell back to findTool when the choice had gone.
  it("refuses, and does NOT fall back, when the chosen program has gone and another copy is right there", () => {
    const entry = toolEntry("python", mac({ files: ["/usr/bin/python3"], chosen: { python: "/Users/s/venv/bin/python3" } }))
    expect(entry.path).toBeNull()
    expect(entry.chosen).toEqual({ path: "/Users/s/venv/bin/python3", problem: "gone" })
    expect(entry.looked).toEqual(["/Users/s/venv/bin/python3 (chosen in Language Setup)"])
  })

  it("calls a folder, a file that is not executable, or a Windows .txt 'not a program'", () => {
    expect(toolEntry("python", mac({ dirs: ["/Users/s/venv"], chosen: { python: "/Users/s/venv" } })).chosen)
      .toEqual({ path: "/Users/s/venv", problem: "notAProgram" })
    expect(toolEntry("python", mac({ notPrograms: ["/Users/s/python3"], chosen: { python: "/Users/s/python3" } })).chosen)
      .toEqual({ path: "/Users/s/python3", problem: "notAProgram" })
    expect(toolEntry("python", windows({ notPrograms: ["C:\\x\\python.txt"], chosen: { python: "C:\\x\\python.txt" } })).chosen)
      .toEqual({ path: "C:\\x\\python.txt", problem: "notAProgram" })
    // A fake with no isProgram: a file that is there is a program.
    const bare: ToolPlaces = { ...mac({ files: ["/v/python3"], chosen: { python: "/v/python3" } }), isProgram: undefined }
    expect(toolEntry("python", bare).chosen).toEqual({ path: "/v/python3", problem: null })
  })

  it("leaves the other languages alone, and the report says a choice only where there is one", () => {
    const places = mac({ files: ["/v/bin/python3", "/opt/homebrew/bin/wolframscript"], chosen: { python: "/v/bin/python3" } })
    expect(toolEntry("wolfram", places)).toEqual({ path: "/opt/homebrew/bin/wolframscript", looked: lookedFor("wolfram", places) })
    const report = toolReport(places)
    expect(report.python).toEqual({ path: "/v/bin/python3", looked: ["/v/bin/python3 (chosen in Language Setup)"], chosen: { path: "/v/bin/python3", problem: null } })
    for (const evaluator of ["wolfram", "c", "cpp", "rust"] as const) expect("chosen" in report[evaluator], evaluator).toBe(false)
    // "Where WriteMind looks by itself" still never reads the choice.
    expect(findTool("python", places)).toBeNull()
  })

  it("takes a chosen py.exe with -3 and a chosen cl.exe with its own flags, as the PATH's would be", () => {
    expect(interpreterArguments("D:\\Tools\\py.exe")).toEqual(["-3"])
    expect(flavorOf("D:\\VS\\VC\\Tools\\MSVC\\14.40\\bin\\Hostx64\\x64\\cl.exe")).toBe("msvc")
  })
})

describe("the other copies found by themselves (foundTools)", () => {
  it("lists every copy that is there, in the order a run tries them, a link and its file once", () => {
    const places = mac({
      files: ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/opt/homebrew/Cellar/python@3.13/3.13.1/bin/python3", "/usr/local/bin/python3"],
      links: { "/opt/homebrew/bin/python3": "/opt/homebrew/Cellar/python@3.13/3.13.1/bin/python3" },
    })
    expect(foundTools("python", places)).toEqual(["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"])
    // Homebrew's wolframscript is a link to the engine app's: one copy, under the name a run would use.
    const engine = mac({
      files: ["/opt/homebrew/bin/wolframscript", MAC_ENGINE_WOLFRAMSCRIPT],
      links: { "/opt/homebrew/bin/wolframscript": MAC_ENGINE_WOLFRAMSCRIPT },
    })
    expect(foundTools("wolfram", engine)).toEqual(["/opt/homebrew/bin/wolframscript"])
    // Windows' spellings differ in case only: one copy.
    const win = windows({
      files: ["C:\\Windows\\py.exe", "C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe"],
      links: { "C:\\Windows\\py.exe": "C:\\WINDOWS\\py.exe" },
    })
    expect(foundTools("python", win)).toEqual(["C:\\Windows\\py.exe", "C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe"])
    expect(foundTools("rust", mac())).toEqual([])
  })

  it("finds the Wolfram Engine the DMG installed, from a Finder-launched app's PATH, with no Homebrew", () => {
    const places = mac({ files: [MAC_ENGINE_WOLFRAMSCRIPT] })
    expect(findTool("wolfram", places)).toBe(MAC_ENGINE_WOLFRAMSCRIPT)
    expect(MAC_ENGINE_WOLFRAMSCRIPT).toBe("/Applications/Wolfram Engine.app/Contents/Resources/Wolfram Player.app/Contents/MacOS/wolframscript")
    // Said as the app, not as the path five folders down inside it.
    expect(lookedFor("wolfram", places)).toEqual(["wolframscript on the PATH", "/opt/homebrew/bin/wolframscript",
      "/usr/local/bin/wolframscript", "/Applications/Wolfram Engine.app"])
    // Linux has no such app.
    expect(lookedFor("wolfram", linux())).toEqual(["wolframscript on the PATH", "/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript"])
  })
})

describe("what a picked folder means (resolveChoice)", () => {
  it("a venv: bin/python3 before bin/python; on Windows Scripts\\python.exe, and a conda root's python.exe", () => {
    expect(resolveChoice("python", "/v", mac({ dirs: ["/v"], files: ["/v/bin/python", "/v/bin/python3"] }))).toEqual({ file: "/v/bin/python3" })
    expect(resolveChoice("python", "/v", mac({ dirs: ["/v"], files: ["/v/bin/python"] }))).toEqual({ file: "/v/bin/python" })
    expect(resolveChoice("python", "C:\\v", windows({ dirs: ["C:\\v"], files: ["C:\\v\\Scripts\\python.exe"] }))).toEqual({ file: "C:\\v\\Scripts\\python.exe" })
    expect(resolveChoice("python", "C:\\conda", windows({ dirs: ["C:\\conda"], files: ["C:\\conda\\python.exe"] }))).toEqual({ file: "C:\\conda\\python.exe" })
    // A file is itself.
    expect(resolveChoice("python", "/v/bin/python3", mac({ files: ["/v/bin/python3"] }))).toEqual({ file: "/v/bin/python3" })
  })

  it("the Wolfram Engine's .app: the wolframscript the DMG puts inside it (measured), then Contents/MacOS", () => {
    const app = "/Applications/Wolfram Engine.app"
    expect(resolveChoice("wolfram", app, mac({ dirs: [app], files: [MAC_ENGINE_WOLFRAMSCRIPT, `${app}/Contents/MacOS/wolframscript`] })))
      .toEqual({ file: MAC_ENGINE_WOLFRAMSCRIPT })
    expect(resolveChoice("wolfram", app, mac({ dirs: [app], files: [`${app}/Contents/MacOS/wolframscript`] })))
      .toEqual({ file: `${app}/Contents/MacOS/wolframscript` })
    expect(resolveChoice("wolfram", "C:\\WS", windows({ dirs: ["C:\\WS"], files: ["C:\\WS\\wolframscript.exe"] }))).toEqual({ file: "C:\\WS\\wolframscript.exe" })
    expect(resolveChoice("c", "/opt/gcc", mac({ dirs: ["/opt/gcc"], files: ["/opt/gcc/bin/clang", "/opt/gcc/gcc"] }))).toEqual({ file: "/opt/gcc/gcc" })
    expect(resolveChoice("c", "C:\\mingw64", windows({ dirs: ["C:\\mingw64"], files: ["C:\\mingw64\\bin\\gcc.exe"] }))).toEqual({ file: "C:\\mingw64\\bin\\gcc.exe" })
  })

  it("says what it looked for when there is nothing inside", () => {
    expect(resolveChoice("python", "/e", mac({ dirs: ["/e"] }))).toEqual({ problem: "There is no Python in that folder (WriteMind looked for bin/python3 and bin/python)." })
    expect(resolveChoice("python", "C:\\e", windows({ dirs: ["C:\\e"] }))).toEqual({ problem: "There is no Python in that folder (WriteMind looked for Scripts\\python.exe and python.exe)." })
    expect(resolveChoice("wolfram", "/Applications/Mathematica.app", mac({ dirs: ["/Applications/Mathematica.app"] })))
      .toEqual({ problem: "WriteMind found no wolframscript inside “Mathematica.app”." })
    expect(resolveChoice("wolfram", "/e", mac({ dirs: ["/e"] }))).toEqual({ problem: "There is no wolframscript in that folder." })
    expect(resolveChoice("c", "/e", mac({ dirs: ["/e"] }))).toEqual({ problem: "There is no gcc, clang or cl in that folder." })
    expect(resolveChoice("cpp", "/e", mac({ dirs: ["/e"] }))).toEqual({ problem: "There is no g++, clang++ or cl in that folder." })
    expect(resolveChoice("rust", "/e", mac({ dirs: ["/e"] }))).toEqual({ problem: "There is no rustc in that folder." })
  })
})

describe("why a file cannot be chosen (choiceProblem), in order", () => {
  it("each sentence, the first that fails", () => {
    expect(choiceProblem("python", "venv/bin/python3", mac())).toBe("“venv/bin/python3” is not a full path.")
    expect(choiceProblem("python", "C:python.exe", windows())).toBe("“C:python.exe” is not a full path.")
    expect(choiceProblem("python", "/gone/python3", mac())).toBe("“python3” is not there.")
    expect(choiceProblem("python", "C:\\x\\python.cmd", windows({ notPrograms: ["C:\\x\\python.cmd"] })))
      .toBe("“python.cmd” is a script, and WriteMind never starts anything through a shell. Choose the .exe it runs.")
    for (const shim of ["run.bat", "run.ps1", "Python.lnk"]) {
      expect(choiceProblem("python", `C:\\x\\${shim}`, windows({ notPrograms: [`C:\\x\\${shim}`] }))).toContain("is a script")
    }
    expect(choiceProblem("python", "C:\\x\\python.txt", windows({ notPrograms: ["C:\\x\\python.txt"] })))
      .toBe("WriteMind starts only .exe and .com programs on Windows.")
    expect(choiceProblem("wolfram", "/x/WolframKernel", mac({ files: ["/x/WolframKernel"] }))).toBe("That is not wolframscript. Wolfram cells run through wolframscript.")
    expect(choiceProblem("python", "/bin/rm", mac({ files: ["/bin/rm"] }))).toBe("That is not a Python: WriteMind runs a program called python, python3, python3.N or py.")
    expect(choiceProblem("python", "C:\\P\\pythonw.exe", windows({ files: ["C:\\P\\pythonw.exe"] }))).toBe("That is not a Python: WriteMind runs a program called python, python3, python3.N or py.")
    expect(choiceProblem("c", "/usr/bin/g++", mac({ files: ["/usr/bin/g++"] }))).toBe("That is not a C compiler (gcc, clang or cl).")
    expect(choiceProblem("cpp", "/usr/bin/gcc", mac({ files: ["/usr/bin/gcc"] }))).toBe("That is not a C++ compiler (g++, clang++ or cl).")
    expect(choiceProblem("rust", "/usr/bin/cargo", mac({ files: ["/usr/bin/cargo"] }))).toBe("That is not rustc.")
    expect(choiceProblem("python", "/v/bin/python3", mac({ notPrograms: ["/v/bin/python3"] }))).toBe("“python3” is not marked as a program (it needs chmod +x).")
  })

  it("lets a real program through, a UNC share's included", () => {
    expect(choiceProblem("python", "/v/bin/python3", mac({ files: ["/v/bin/python3"] }))).toBeNull()
    expect(choiceProblem("python", "\\\\server\\tools\\python.exe", windows({ files: ["\\\\server\\tools\\python.exe"] }))).toBeNull()
    expect(choiceProblem("cpp", "C:\\VS\\cl.exe", windows({ files: ["C:\\VS\\cl.exe"] }))).toBeNull()
    expect(choiceProblem("wolfram", MAC_ENGINE_WOLFRAMSCRIPT, mac({ files: [MAC_ENGINE_WOLFRAMSCRIPT] }))).toBeNull()
  })
})

describe("asking a picked program what it is (identifyArguments)", () => {
  it("its version, py told to pick a Python 3, and nothing asked of cl", () => {
    expect(identifyArguments("wolfram", "/x/wolframscript")).toEqual(["-version"])
    expect(identifyArguments("python", "C:\\Windows\\py.exe")?.slice(0, 2)).toEqual(["-3", "-c"])
    expect(identifyArguments("python", "/v/bin/python3")?.[0]).toBe("-c")
    expect(identifyArguments("c", "C:\\VS\\cl.exe")).toBeNull()
    expect(identifyArguments("cpp", "C:\\VS\\cl.exe")).toBeNull()
    expect(identifyArguments("c", "/usr/bin/gcc")).toEqual(["--version"])
    expect(identifyArguments("rust", "/Users/s/.cargo/bin/rustc")).toEqual(["--version"])
  })
})

describe("whether the Wolfram Engine is activated (wolframLicence)", () => {
  it("a mathpass where each platform's activation leaves one", () => {
    expect(wolframLicence(windows())).toBe(false)
    expect(wolframLicence(windows({ files: ["C:\\Users\\S\\AppData\\Roaming\\WolframEngine\\Licensing\\mathpass"] }))).toBe(true)
    expect(wolframLicence(windows({ files: ["C:\\ProgramData\\Mathematica\\Licensing\\mathpass"] }))).toBe(true)
    expect(wolframLicence(mac())).toBe(false)
    // Measured on this Mac, 2026-10-06.
    expect(wolframLicence(mac({ files: ["/Users/s/Library/WolframEngine/Licensing/mathpass"] }))).toBe(true)
    expect(wolframLicence(mac({ files: ["/Library/Mathematica/Licensing/mathpass"] }))).toBe(true)
    expect(wolframLicence(linux({ files: ["/Users/s/.WolframEngine/Licensing/mathpass"] }))).toBe(true)
    expect(wolframLicence(linux({ files: ["/Users/s/Library/WolframEngine/Licensing/mathpass"] }))).toBe(false)
  })
})
