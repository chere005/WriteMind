/**
 * The Windows installer's optional tools: packaging/installer.nsh's page, and packaging/installer-tools.ps1, which it
 * packs into the installer and runs (docs/INSTALL-WINDOWS.md, "Optional tools: Python and Wolfram").
 *
 * Everywhere: how electron-builder finds the two (by name, in the build resources folder), what the helper promises
 * (ASCII; the winget ids and switches the docs print), and ONE set of folders that tools.ts and the helper must pick
 * the same one from (fixtures/installer-tool-folders.json) - the helper's "already installed" is only true if it
 * looks where WriteMind looks, in the order WriteMind looks.
 *
 * On Windows, the helper itself, under Windows PowerShell 5.1 (the installer's own): it parses; -Detect on a bare
 * machine, on the fixture's folders, past a Store placeholder, and past a probe that waits on its stdin; dry runs;
 * and real runs against a stand-in winget.exe compiled here, which prints lines, records its arguments and exits with
 * a chosen code. Every dry run before this file returned before the line that runs winget, and that line was the
 * bug: winget's output became the helper's result. NOTHING HERE CAN REACH A REAL WINGET: the helper's PATH holds
 * only the stand-ins, and %LOCALAPPDATA% (where the real winget's alias lives), Program Files, %APPDATA% and
 * %ProgramData% are scratch folders.
 */
import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { load } from "js-yaml"
import { findTool, newestFirst, pythonFolders, type ToolPlaces } from "../src/main/eval/tools"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../../..")
const text = (rel: string): string => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const builder: any = load(text("apps/desktop/electron-builder.yml"))
const ps1 = text("packaging/installer-tools.ps1")
const nsh = text("packaging/installer.nsh")
const docs = text("docs/INSTALL-WINDOWS.md")

interface Case { folders: string[]; pick: string }
const fixture: { python: Case[]; wolfram: Case[] } = JSON.parse(readFileSync(path.join(here, "fixtures/installer-tool-folders.json"), "utf8"))

/** A value the helper sets at its top: `$Name = "value"`. */
const setting = (name: string): string => {
  const found = new RegExp(`^\\$${name} = "([^"]+)"$`, "m").exec(ps1)
  if (!found) throw new Error(`installer-tools.ps1 sets no $${name}`)
  return found[1]
}
const PYTHON_ID = setting("PythonId")
const PYTHON_SWITCHES = setting("PythonSwitches")
const WOLFRAM_ID = setting("WolframId")
const AGREEMENTS = ["--accept-package-agreements", "--accept-source-agreements"]

describe("electron-builder finds the page and the helper", () => {
  it("packaging/ is the build resources folder, and holds installer.nsh and installer-tools.ps1", () => {
    const resources = path.resolve(root, "apps/desktop", builder.directories.buildResources)
    expect(resources).toBe(path.join(root, "packaging"))
    expect(existsSync(path.join(resources, "installer.nsh"))).toBe(true)
    expect(existsSync(path.join(resources, "installer-tools.ps1"))).toBe(true)
  })

  it("nothing replaces installer.nsh by name (no nsis.include, no nsis.script), and the installer is the assisted one", () => {
    expect(builder.nsis.include).toBeUndefined()
    expect(builder.nsis.script).toBeUndefined()
    // customPageAfterChangeDir is inserted by the assisted installer only.
    expect(builder.nsis.oneClick).toBe(false)
    expect(nsh).toContain("!macro customPageAfterChangeDir")
    expect(nsh).toMatch(/!macro customInstall\n\s+Call wmRunTools\n!macroend/)
  })

  it("packs the helper into the installer from the build resources folder", () => {
    expect(nsh).toContain('File "/oname=$PLUGINSDIR\\wm-tools.ps1" "${BUILD_RESOURCES_DIR}\\installer-tools.ps1"')
  })
})

describe("installer.nsh", () => {
  it("gives the detection a time limit, so Next to the page cannot freeze on it", () => {
    expect(nsh).toMatch(/nsExec::Exec \/TIMEOUT=\d+ '"\$wmPowerShell"[^\n]*-Detect -Out/)
  })

  it("says the tools step did not finish when it wrote no result, instead of blank values", () => {
    const reads = nsh.indexOf('ReadINIStr $2 "$PLUGINSDIR\\wm-result.ini" result python')
    expect(reads).toBeGreaterThan(0)
    const after = nsh.slice(reads)
    expect(after.indexOf("${If} ${Errors}")).toBeGreaterThan(0)
    expect(after.indexOf("${If} ${Errors}")).toBeLessThan(after.indexOf("MessageBox"))
    expect(after).toMatch(/did not finish \(exit \$0\)/)
    // ...and the ClearErrors that makes ${Errors} mean the reads, not ExecWait.
    expect(nsh.slice(0, reads)).toMatch(/ClearErrors\n\s*$/)
  })
})

describe("installer-tools.ps1", () => {
  it("is ASCII only (Windows PowerShell 5.1 reads a script without a BOM in the ANSI code page)", () => {
    const bytes = readFileSync(path.join(root, "packaging/installer-tools.ps1"))
    const at = bytes.findIndex((b) => b > 0x7f)
    expect(at === -1 ? "" : bytes.subarray(Math.max(0, at - 40), at + 10).toString("latin1")).toBe("")
  })

  it("installs Python for this user only, the py launcher included, as the page promises", () => {
    expect(PYTHON_ID).toBe("Python.Python.3.14")
    expect(nsh).toContain("for this Windows user only (no administrator needed)")
    // InstallLauncherAllUsers defaults to 1, which asks for an administrator: the switches are given whole.
    expect(PYTHON_SWITCHES.split(" ")).toEqual(expect.arrayContaining(["InstallAllUsers=0", "InstallLauncherAllUsers=0", "PrependPath=1"]))
    expect(ps1).toContain('WingetInstall "Python" $PythonId @("--scope", "user", "--override", $PythonSwitches)')
    expect(ps1).toContain('WingetInstall "Wolfram Engine" $WolframId @()')
    expect(ps1).toContain(`@("${AGREEMENTS.join('", "')}")`)
  })

  it("runs the commands docs/INSTALL-WINDOWS.md prints (the page's table and the by-hand lines)", () => {
    expect(WOLFRAM_ID).toBe("WolframResearch.WolframEngine")
    expect(docs).toContain(`\`winget install --id ${PYTHON_ID} --exact --source winget --scope user --override "${PYTHON_SWITCHES}"\``)
    expect(docs).toContain(`\`winget install --id ${WOLFRAM_ID} --exact --source winget\``)
    expect(docs).toContain(`winget install --id ${PYTHON_ID} -e --scope user --override "${PYTHON_SWITCHES}"\n`)
    expect(docs).toContain(`winget install --id ${WOLFRAM_ID} -e\n`)
    expect(docs).toContain(AGREEMENTS.join(" "))
  })

  it("never runs winget so that its output becomes the result (& inside a function whose result is assigned)", () => {
    expect(ps1).not.toMatch(/^\s*& \$winget\b/m)
    expect(ps1).toMatch(/try \{ \$code = RunInConsole \$winget \$arguments \}/)
  })

  // winget's own list for a burn installer (GetDefaultKnownReturnCodes, src/AppInstallerCommonCore/Manifest/
  // ManifestCommon.cpp in microsoft/winget-cli) turns only 1602, the installer's own Cancel, into its "cancelled"
  // 0x8A15010C. A burn bundle whose prompt to allow it is declined quits with 1223 (ERROR_CANCELLED), which is not on
  // that list, and the Wolfram Engine's manifest (a zip holding a burn installer that elevates itself) adds nothing to
  // it: winget reports its generic 0x8A150006, so that is where the words for a declined prompt have to be. Read off
  // the helper's text, so it is checked here and not only by the Windows run below.
  it("says a declined prompt under winget's 0x8A150006, and keeps 0x8A15010C for the installer's own Cancel", () => {
    const said = new Map([...ps1.matchAll(/^\s*"(0x[0-9A-F]{8})" \{ return "([^"]*)" \}$/gm)].map((m) => [m[1], m[2]]))
    expect(said.get("0x8A150006")).toMatch(/^failed: .*prompt to allow it was declined.* \(\$hex\)$/)
    expect(said.get("0x8A15010C")).toMatch(/^failed: cancelled, .* \(\$hex\)$/)
    expect(said.get("0x8A15010C")).not.toMatch(/prompt/)
    expect(docs).toMatch(/prompt\s+to\s+allow\s+it\s+was\s+declined[^.]*0x8A150006/)
    expect(docs).not.toMatch(/cancelled\s+\(the\s+prompt/)
  })
})

/** Windows paths for tools.ts's own lookup, as the installed app would see them. */
const LOCAL = "C:\\Users\\S\\AppData\\Local"
const PF = "C:\\Program Files"
const winPlaces = (present: string[], tree: Record<string, string[]>): ToolPlaces => ({
  platform: "win32",
  pathVariable: "C:\\Windows\\system32",
  home: "C:\\Users\\S",
  programFiles: [PF],
  localAppData: LOCAL,
  isFile: (file) => present.includes(file),
  folders: (dir) => tree[dir] ?? [],
})

describe("one set of folders, one pick: tools.ts (the helper is held to the same file on Windows, below)", () => {
  for (const { folders, pick } of fixture.python) {
    it(`Python: ${folders.join(", ")} -> ${pick}`, () => {
      expect(pythonFolders(folders)[0]).toBe(pick)
      const dir = `${LOCAL}\\Programs\\Python`
      const present = folders.map((name) => `${dir}\\${name}\\python.exe`)
      expect(findTool("python", winPlaces(present, { [dir]: folders }))).toBe(`${dir}\\${pick}\\python.exe`)
    })
  }
  for (const { folders, pick } of fixture.wolfram) {
    it(`Wolfram Engine: ${folders.join(", ")} -> ${pick}`, () => {
      expect(newestFirst(folders)[0]).toBe(pick)
      const engines = `${PF}\\Wolfram Research\\Wolfram Engine`
      const present = folders.map((name) => `${engines}\\${name}\\wolframscript.exe`)
      expect(findTool("wolfram", winPlaces(present, { [engines]: folders }))).toBe(`${engines}\\${pick}\\wolframscript.exe`)
    })
  }
})

// --- On Windows: the helper itself ---------------------------------------------------------------------------------

const windows = process.platform === "win32"
const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
const helper = path.join(root, "packaging", "installer-tools.ps1")

/**
 * The stand-ins the helper starts, told apart by the name each copy has:
 *   winget.exe  prints two lines (as winget does), records its arguments in %FAKE_WINGET_ARGS%, one a line, and exits
 *               with %FAKE_WINGET_EXIT%;
 *   py.exe      reads its stdin TO THE END before it answers "Python 3.14.0": a program that asks a question waits on
 *               its stdin like this, and the stdin nsExec gives the helper is never closed;
 *   python.exe  the Microsoft Store's placeholder: "Python was not found", exit 9009.
 */
const STAND_IN = `
using System;
using System.IO;
using System.Reflection;

public static class StandIn {
  public static int Main(string[] args) {
    string name = Path.GetFileNameWithoutExtension(Assembly.GetEntryAssembly().Location).ToLowerInvariant();
    if (name == "py") {
      Console.In.ReadToEnd();
      Console.WriteLine("Python 3.14.0");
      return 0;
    }
    if (name == "python") {
      Console.Error.WriteLine("Python was not found; run without arguments to install from the Microsoft Store.");
      return 9009;
    }
    Console.WriteLine("Found Python 3.14 [Python.Python.3.14] Version 3.14.7");
    Console.WriteLine("FAKE-WINGET-OUTPUT");
    string record = Environment.GetEnvironmentVariable("FAKE_WINGET_ARGS");
    if (!string.IsNullOrEmpty(record)) File.WriteAllText(record, string.Join("\\n", args));
    string code = Environment.GetEnvironmentVariable("FAKE_WINGET_EXIT");
    return string.IsNullOrEmpty(code) ? 0 : int.Parse(code);
  }
}
`

interface Machine {
  base: string
  local: string
  pf: string
  pf86: string
  appData: string
  programData: string
  /** The PATH the helper gets, and nothing else. */
  pathDirs: string[]
}

/** The folders the stand-ins are copied into; each is on a scratch machine's PATH only when a test puts it there. */
const bins = { winget: "", py: "", store: "" }

/** A scratch Windows: its own %LOCALAPPDATA%, Program Files, %APPDATA% and %ProgramData%, and only `pathDirs` as PATH. */
function machine(pathDirs: string[] = []): Machine {
  const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "wm-tools-")))
  const m: Machine = {
    base,
    local: path.join(base, "Local"),
    pf: path.join(base, "Program Files"),
    pf86: path.join(base, "Program Files (x86)"),
    appData: path.join(base, "Roaming"),
    programData: path.join(base, "ProgramData"),
    pathDirs,
  }
  for (const dir of [m.local, m.pf, m.pf86, m.appData, m.programData]) mkdirSync(dir, { recursive: true })
  return m
}

const REPLACED = /^(path|localappdata|programfiles|programw6432|programfiles\(x86\)|appdata|programdata|writemind_tools_pretend|fake_winget_args|fake_winget_exit)$/i

/** The environment the helper runs with on a scratch machine (Windows' own variables, SystemRoot and the rest, kept). */
function environment(m: Machine, more: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !REPLACED.test(key)) env[key] = value
  return {
    ...env,
    PATH: m.pathDirs.join(";"),
    LOCALAPPDATA: m.local,
    ProgramFiles: m.pf,
    ProgramW6432: m.pf,
    "ProgramFiles(x86)": m.pf86,
    APPDATA: m.appData,
    ProgramData: m.programData,
    ...more,
  }
}

const helperArguments = (args: string[]): string[] => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper, ...args]

/** The helper, run to the end. (Not windowsHide: that starts PowerShell with no console, and winget shares its console.) */
function run(m: Machine, args: string[], more: Record<string, string> = {}): { code: number | null; out: string } {
  const r = spawnSync(powershell, helperArguments(args), { env: environment(m, more), encoding: "utf8", timeout: 90_000 })
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** An INI the helper wrote (UTF-16 with a BOM, for the installer's ReadINIStr). */
function ini(file: string): Record<string, string> {
  const lines = readFileSync(file, "utf16le").replace(/^\uFEFF/, "").split(/\r\n/)
  return Object.fromEntries(lines.filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
}

const put = (file: string, body = ""): string => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, body)
  return file
}

describe.skipIf(!windows)("installer-tools.ps1 under Windows PowerShell 5.1", () => {
  beforeAll(() => {
    const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "wm-tools-bin-")))
    const source = put(path.join(dir, "StandIn.cs"), STAND_IN)
    const exe = path.join(dir, "StandIn.exe")
    const built = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
      "Add-Type -Path $env:WM_STAND_IN_SOURCE -OutputType ConsoleApplication -OutputAssembly $env:WM_STAND_IN_EXE"],
    { env: { ...process.env, WM_STAND_IN_SOURCE: source, WM_STAND_IN_EXE: exe }, encoding: "utf8", timeout: 120_000 })
    if (!existsSync(exe)) throw new Error(`the stand-in did not compile: ${built.stdout}${built.stderr}`)
    bins.winget = path.join(dir, "winget")
    bins.py = path.join(dir, "py")
    bins.store = path.join(dir, "Microsoft", "WindowsApps")
    for (const [folder, name] of [[bins.winget, "winget.exe"], [bins.py, "py.exe"], [bins.store, "python.exe"]]) {
      mkdirSync(folder, { recursive: true })
      copyFileSync(exe, path.join(folder, name))
    }
  }, 180_000)

  it("parses with no errors", () => {
    const r = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
      "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:WM_HELPER, [ref]$null, [ref]$e); " +
      "\"errors=$($e.Count)\"; $e | ForEach-Object { $_.Extent.StartLineNumber.ToString() + ': ' + $_.Message }"],
    { env: { ...process.env, WM_HELPER: helper }, encoding: "utf8", timeout: 60_000 })
    expect(r.stdout.trim()).toBe("errors=0")
  }, 90_000)

  it("-Detect on a bare machine (WRITEMIND_TOOLS_PRETEND=missing) finds nothing", () => {
    const m = machine([bins.winget])
    const out = path.join(m.base, "detect.ini")
    expect(run(m, ["-Detect", "-Out", out], { WRITEMIND_TOOLS_PRETEND: "missing" }).code).toBe(0)
    expect(ini(out)).toMatchObject({ python: "", wolfram: "", activated: "0" })
  }, 120_000)

  for (const { folders, pick } of fixture.python) {
    it(`-Detect picks the Python tools.ts picks: ${folders.join(", ")} -> ${pick}`, () => {
      const m = machine()
      const dir = path.join(m.local, "Programs", "Python")
      for (const name of folders) put(path.join(dir, name, "python.exe"))
      const out = path.join(m.base, "detect.ini")
      expect(run(m, ["-Detect", "-Out", out]).code).toBe(0)
      expect(ini(out).python).toBe(path.join(dir, pick, "python.exe"))
    }, 120_000)
  }

  for (const { folders, pick } of fixture.wolfram) {
    it(`-Detect picks the Wolfram Engine tools.ts picks: ${folders.join(", ")} -> ${pick}`, () => {
      const m = machine()
      const engines = path.join(m.pf, "Wolfram Research", "Wolfram Engine")
      for (const name of folders) put(path.join(engines, name, "wolframscript.exe"))
      const out = path.join(m.base, "detect.ini")
      expect(run(m, ["-Detect", "-Out", out]).code).toBe(0)
      expect(ini(out).wolfram).toBe(path.join(engines, pick, "wolframscript.exe"))
    }, 120_000)
  }

  it("-Detect looks past a Store placeholder at the front of the PATH to a real python.exe behind it", () => {
    const real = path.join(realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "wm-tools-real-"))), "Python314")
    put(path.join(real, "python.exe"))
    const m = machine([bins.store, real])
    const out = path.join(m.base, "detect.ini")
    expect(run(m, ["-Detect", "-Out", out]).code).toBe(0)
    expect(ini(out).python).toBe(path.join(real, "python.exe"))
  }, 120_000)

  it("-Detect is not held up by a probe that waits on its stdin, with the stdin left open as nsExec leaves it", async () => {
    const m = machine([bins.py])
    const out = path.join(m.base, "detect.ini")
    const child = spawn(powershell, helperArguments(["-Detect", "-Out", out]), { env: environment(m), stdio: ["pipe", "pipe", "pipe"] })
    child.stdout.resume()
    child.stderr.resume()
    const code = await new Promise<number | string | null>((resolve) => {
      const late = setTimeout(() => { child.kill(); resolve("still running after 60 s") }, 60_000)
      child.on("exit", (exit) => { clearTimeout(late); resolve(exit) })
    })
    child.stdin.end()
    expect(code).toBe(0)
    expect(ini(out).python).toBe(path.join(bins.py, "py.exe"))
  }, 120_000)

  it("a dry run names the documented commands, runs nothing and exits 0", () => {
    const m = machine([bins.winget])
    const result = path.join(m.base, "result.ini")
    const log = path.join(m.base, "tools-setup.log")
    const recorded = path.join(m.base, "args.txt")
    const r = run(m, ["-Python", "-Wolfram", "-Activate", "-DryRun", "-NoWait", "-Log", log, "-Result", result],
      { WRITEMIND_TOOLS_PRETEND: "missing", FAKE_WINGET_ARGS: recorded })
    expect(r.code).toBe(0)
    expect(ini(result)).toMatchObject({ python: "dry run", wolfram: "dry run", activate: "dry run" })
    const said = readFileSync(log, "utf8")
    expect(said).toContain(`winget install --id ${PYTHON_ID} --exact --source winget --scope user --override "${PYTHON_SWITCHES}" ${AGREEMENTS.join(" ")}`)
    expect(said).toContain(`winget install --id ${WOLFRAM_ID} --exact --source winget ${AGREEMENTS.join(" ")}`)
    expect(said).toContain("-activate")
    expect(existsSync(recorded)).toBe(false)
  }, 120_000)

  it("a dry run fails nothing: Activate with no engine and none ticked, and no winget, still exit 0", () => {
    const m = machine()
    const result = path.join(m.base, "result.ini")
    const r = run(m, ["-Python", "-Activate", "-DryRun", "-NoWait", "-Result", result], { WRITEMIND_TOOLS_PRETEND: "missing" })
    expect(r.code).toBe(0)
    expect(ini(result)).toMatchObject({ python: "dry run (winget missing)", activate: "dry run (wolframscript.exe not found)" })
  }, 120_000)

  // winget's exit codes (doc/windows/package-manager/winget/returnCodes.md in microsoft/winget-cli), as int32s.
  const outcomes: Array<{ exit: number; python: string | RegExp; code: number }> = [
    { exit: 0, python: "installed", code: 0 },
    { exit: 3010, python: "installed (restart needed)", code: 0 },
    { exit: -1978334967, python: "installed (restart needed)", code: 0 }, // 0x8A150109 restart to finish
    { exit: -1978335135, python: "already installed", code: 0 }, // 0x8A150061
    { exit: -1978335189, python: "already installed", code: 0 }, // 0x8A15002B no applicable upgrade
    { exit: -1978335226, python: /^failed: the installer stopped or its prompt to allow it was declined, .* \(0x8A150006\)$/, code: 1 },
    { exit: -1978334964, python: /^failed: cancelled, .* own window \(0x8A15010C\)$/, code: 1 },
    { exit: -1978335225, python: /^failed: winget is too old, update App Installer .* \(0x8A150007\)$/, code: 1 },
    { exit: -1978335216, python: "failed: not available for this PC (0x8A150010)", code: 1 },
    { exit: -2147012889, python: /^failed: the download did not finish, .* \(0x80072EE7\)$/, code: 1 },
    { exit: 1, python: "failed: winget exit code 0x00000001", code: 1 },
  ]
  for (const { exit, python, code } of outcomes) {
    it(`winget exits ${exit}: the console shows winget's lines, the result says only "${python}"`, () => {
      const m = machine([bins.winget])
      const result = path.join(m.base, "result.ini")
      const log = path.join(m.base, "tools-setup.log")
      const recorded = path.join(m.base, "args.txt")
      const r = run(m, ["-Python", "-NoWait", "-Log", log, "-Result", result],
        { FAKE_WINGET_EXIT: String(exit), FAKE_WINGET_ARGS: recorded })
      expect(r.code).toBe(code)
      // winget's own output reaches the console (here, the pipe the console's handles are)...
      expect(r.out).toContain("FAKE-WINGET-OUTPUT")
      // ...and never the result: one short status, which the installer's last message shows as it is.
      const values = ini(result)
      if (typeof python === "string") expect(values.python).toBe(python)
      else expect(values.python).toMatch(python)
      expect(readFileSync(result, "utf16le")).not.toContain("FAKE-WINGET-OUTPUT")
      expect(readFileSync(log, "utf8")).not.toContain("System.Object[]")
      // The documented command, the Python switches as ONE argument.
      expect(readFileSync(recorded, "utf8").split("\n")).toEqual(
        ["install", "--id", PYTHON_ID, "--exact", "--source", "winget", "--scope", "user", "--override", PYTHON_SWITCHES, ...AGREEMENTS])
    }, 120_000)
  }

  it("installs the Wolfram Engine with no scope and no switches of its own", () => {
    const m = machine([bins.winget])
    const result = path.join(m.base, "result.ini")
    const recorded = path.join(m.base, "args.txt")
    const r = run(m, ["-Wolfram", "-NoWait", "-Result", result], { FAKE_WINGET_EXIT: "0", FAKE_WINGET_ARGS: recorded })
    expect(r.code).toBe(0)
    expect(ini(result).wolfram).toBe("installed")
    expect(readFileSync(recorded, "utf8").split("\n")).toEqual(["install", "--id", WOLFRAM_ID, "--exact", "--source", "winget", ...AGREEMENTS])
  }, 120_000)

  it("with no winget at all: failed, said so, exit 1", () => {
    const m = machine()
    const result = path.join(m.base, "result.ini")
    const r = run(m, ["-Python", "-NoWait", "-Result", result])
    expect(r.code).toBe(1)
    expect(ini(result)).toMatchObject({ python: "failed: winget is missing", winget: "missing" })
  }, 120_000)
})
