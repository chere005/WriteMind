/**
 * A program chosen in File ▸ Language Setup… (tools.ts `toolEntry`, `resolveChoice`, `choiceProblem`), against FAKE
 * places: no file is read and nothing is started. Port-only — the Mac's `evalTool.<name>` falls through to its
 * candidates when the file it names has gone; here a choice is the only one its language uses, and a gone one is said.
 */
import { describe, expect, it } from "vitest"
import type { Evaluator } from "@writemind/core"
import {
  APPLE_PYTHON, choiceProblem, findTool, flavorOf, foundTools, identifyArguments, interpreterArguments, lookedFor,
  MAC_COMMAND_LINE_TOOLS_PYTHON, MAC_ENGINE_WOLFRAMSCRIPT, pythonStandIn, resolveChoice, toolEntry, toolIdentity, toolReport,
  wolframLicence, type ToolPlaces,
} from "../src/main/eval/tools"

interface Fake {
  files?: string[]
  /** Files that are there but cannot be started (not executable; a folder's own name is in `dirs`). */
  notPrograms?: string[]
  dirs?: string[]
  links?: Record<string, string>
  chosen?: Partial<Record<Evaluator, string>>
  /** The folders inside a folder (`ToolPlaces.folders`), for the install folders with a version in their name. */
  inside?: Record<string, string[]>
  pathVariable?: string
}

const mac = (fake: Fake = {}): ToolPlaces => ({
  platform: "darwin", pathVariable: fake.pathVariable ?? "/usr/bin:/bin:/usr/sbin:/sbin", home: "/Users/s", programFiles: [],
  chosen: fake.chosen ?? {},
  isFile: (file) => (fake.files ?? []).includes(file) || (fake.notPrograms ?? []).includes(file),
  isProgram: (file) => (fake.files ?? []).includes(file),
  isDirectory: (file) => (fake.dirs ?? []).includes(file),
  realPath: (file) => fake.links?.[file] ?? file,
  folders: (dir) => fake.inside?.[dir] ?? [],
})
const linux = (fake: Fake = {}): ToolPlaces => ({ ...mac(fake), platform: "linux", pathVariable: fake.pathVariable ?? "/usr/local/bin:/usr/bin" })
const windows = (fake: Fake = {}): ToolPlaces => ({
  platform: "win32", pathVariable: fake.pathVariable ?? "C:\\Windows;C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps", home: "C:\\Users\\S",
  programFiles: ["C:\\Program Files"], localAppData: "C:\\Users\\S\\AppData\\Local",
  appData: "C:\\Users\\S\\AppData\\Roaming", programData: "C:\\ProgramData",
  chosen: fake.chosen ?? {},
  isFile: (file) => (fake.files ?? []).includes(file) || (fake.notPrograms ?? []).includes(file),
  isProgram: (file) => (fake.files ?? []).includes(file) && /\.(exe|com)$/i.test(file),
  isDirectory: (file) => (fake.dirs ?? []).includes(file),
  realPath: (file) => fake.links?.[file] ?? file,
  folders: (dir) => fake.inside?.[dir] ?? [],
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

  // BREAK-IT: watched failing against a toolEntry that read an unreadable file as "no choices" and ran the copy found.
  it("refuses every language, naming the file, when Language Setup's file is there and nothing could be read from it", () => {
    const places = { ...mac({ files: ["/usr/bin/python3", "/opt/homebrew/bin/wolframscript"] }), unreadable: "/u/languages.json" }
    for (const evaluator of ["python", "wolfram", "c"] as const) {
      expect(toolEntry(evaluator, places), evaluator).toEqual({
        path: null, looked: ["/u/languages.json (Language Setup's choices)"], chosen: { path: "/u/languages.json", problem: "unreadable" },
      })
    }
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

  // BREAK-IT: watched failing against the fully resolved file as the only identity: the venv and Homebrew's Python
  // came out as one copy, and the venv's base disappeared from "Also on this computer".
  it("keeps a venv apart from the Python it was made from, though its link leads to the same file (measured)", () => {
    const cellar = "/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14"
    const venv = "/Users/s/proj/.venv/bin/python3"
    const links = { "/opt/homebrew/bin/python3": cellar, [venv]: cellar, "/Users/s/proj/.venv/bin/python": cellar }
    const files = ["/opt/homebrew/bin/python3", venv, "/Users/s/proj/.venv/bin/python", "/Users/s/proj/.venv/pyvenv.cfg"]
    const places = mac({ files, links, pathVariable: "/Users/s/proj/.venv/bin:/usr/bin:/bin" })
    expect(toolIdentity("python", venv, places)).not.toBe(toolIdentity("python", "/opt/homebrew/bin/python3", places))
    // One venv, two spellings: one copy. Homebrew's is still its own.
    expect(foundTools("python", places)).toEqual([venv, "/opt/homebrew/bin/python3"])
    // Linux, started from a shell with the venv activated: the system's Python is still found, so it can be Used.
    const usr = { "/usr/bin/python3": "/usr/bin/python3.12", "/home/s/venv/bin/python3": "/usr/bin/python3.12" }
    const shell = linux({ files: ["/home/s/venv/bin/python3", "/home/s/venv/pyvenv.cfg", "/usr/bin/python3"], links: usr,
      pathVariable: "/home/s/venv/bin:/usr/bin" })
    expect(foundTools("python", shell)).toEqual(["/home/s/venv/bin/python3", "/usr/bin/python3"])
    // Windows keeps pyvenv.cfg beside Scripts, and case does not matter.
    const win = windows({ files: ["C:\\v\\Scripts\\python.exe", "C:\\v\\pyvenv.cfg"], links: { "C:\\v\\Scripts\\python.exe": "C:\\P\\python.exe" } })
    expect(toolIdentity("python", "C:\\v\\Scripts\\python.exe", win)).toBe("venv:c:\\v")
    // Not a Python: a link and its file are one program, as before.
    expect(toolIdentity("wolfram", "/opt/homebrew/bin/wolframscript", mac({ links: { "/opt/homebrew/bin/wolframscript": MAC_ENGINE_WOLFRAMSCRIPT } })))
      .toBe(MAC_ENGINE_WOLFRAMSCRIPT)
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

describe("a Python found by itself that is only a stand-in (pythonStandIn), read and never run", () => {
  const STORE = "C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe"

  it("Windows: the Store's shortcut always; a py launcher only with no Python 3 for it to start", () => {
    expect(pythonStandIn(STORE, windows({ files: [STORE] }))).toBe("storeAlias")
    expect(pythonStandIn("C:\\Windows\\py.exe", windows({ files: ["C:\\Windows\\py.exe", STORE] }))).toBe("pyLauncher")
    // A python.org install behind it, per user or for everyone: a real one.
    const local = "C:\\Users\\S\\AppData\\Local\\Programs\\Python"
    expect(pythonStandIn("C:\\Windows\\py.exe", windows({ files: ["C:\\Windows\\py.exe", `${local}\\Python314\\python.exe`],
      inside: { [local]: ["Launcher", "Python314"] } }))).toBeNull()
    expect(pythonStandIn("C:\\Windows\\py.exe", windows({ files: ["C:\\Windows\\py.exe", "C:\\Program Files\\Python313\\python.exe"],
      inside: { "C:\\Program Files": ["Python313"] } }))).toBeNull()
    // An empty Python314 folder left behind is not a Python.
    expect(pythonStandIn("C:\\Windows\\py.exe", windows({ files: ["C:\\Windows\\py.exe"], inside: { [local]: ["Python314"] } }))).toBe("pyLauncher")
    // Another python.exe on the PATH: the launcher has something to start.
    expect(pythonStandIn("C:\\Windows\\py.exe", windows({ files: ["C:\\Windows\\py.exe", "C:\\Python312\\python.exe"],
      pathVariable: "C:\\Windows;C:\\Python312" }))).toBeNull()
    expect(pythonStandIn("C:\\Python312\\python.exe", windows({ files: ["C:\\Python312\\python.exe"] }))).toBeNull()
  })

  it("a Mac: Apple's /usr/bin/python3 is a stand-in until the Command Line Tools' or an Xcode's python3 is there", () => {
    expect(pythonStandIn(APPLE_PYTHON, mac({ files: [APPLE_PYTHON] }))).toBe("appleStandIn")
    expect(MAC_COMMAND_LINE_TOOLS_PYTHON).toBe("/Library/Developer/CommandLineTools/usr/bin/python3")
    expect(pythonStandIn(APPLE_PYTHON, mac({ files: [APPLE_PYTHON, MAC_COMMAND_LINE_TOOLS_PYTHON] }))).toBe("apple")
    // Measured on this Mac, 2026-10-06: Xcode's own python3.
    expect(pythonStandIn(APPLE_PYTHON, mac({ files: [APPLE_PYTHON, "/Applications/Xcode.app/Contents/Developer/usr/bin/python3"] }))).toBe("apple")
    expect(pythonStandIn(APPLE_PYTHON, mac({ files: [APPLE_PYTHON, "/Applications/Xcode-beta.app/Contents/Developer/usr/bin/python3"],
      inside: { "/Applications": ["Xcode-beta.app", "Safari.app"] } }))).toBe("apple")
    expect(pythonStandIn("/opt/homebrew/bin/python3", mac({ files: ["/opt/homebrew/bin/python3"] }))).toBeNull()
    // Linux's /usr/bin/python3 is a Python.
    expect(pythonStandIn(APPLE_PYTHON, linux({ files: [APPLE_PYTHON] }))).toBeNull()
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
