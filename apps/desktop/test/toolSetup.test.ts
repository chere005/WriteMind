/**
 * File ▸ Language Setup…'s Windows setup window (src/main/toolSetup.ts): the installer's own installer-tools.ps1,
 * run with -FromApp. The process layer is FAKED — nothing here starts PowerShell, an installer or anything else.
 * Port-only.
 */
import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import {
  createToolSetup, launcherArguments, launcherScript, SETUP_SPAWN_OPTIONS, setupArguments, windowsArgument, type ToolSetupDeps,
} from "../src/main/toolSetup"

/**
 * A command line read back into arguments the way Windows' C runtime (and so powershell.exe) reads it: whitespace
 * outside quotes splits, `"` toggles quoting, and backslashes are literal except in front of a quote — 2n of them and
 * a quote are n and a toggle, 2n+1 are n and a literal quote.
 */
function readBack(line: string): string[] {
  const args: string[] = []
  let i = 0
  while (i < line.length) {
    while (line[i] === " " || line[i] === "\t") i++
    if (i >= line.length) break
    let arg = ""
    let quoted = false
    while (i < line.length && (quoted || (line[i] !== " " && line[i] !== "\t"))) {
      let slashes = 0
      while (line[i] === "\\") { slashes++; i++ }
      if (line[i] === "\"") {
        arg += "\\".repeat(Math.floor(slashes / 2))
        if (slashes % 2 === 1) arg += "\""
        else quoted = !quoted
        i++
      } else {
        arg += "\\".repeat(slashes)
        if (i < line.length && (quoted || (line[i] !== " " && line[i] !== "\t"))) arg += line[i++]
      }
    }
    args.push(arg)
  }
  return args
}

/** The PowerShell single-quoted literal after `name` in a script, with its doubled quotes undone. */
const literalAfter = (script: string, name: string): string =>
  /'((?:[^']|'')*)'/.exec(script.slice(script.indexOf(name) + name.length))![1]!.replace(/''/g, "'")

const options = { script: "C:\\App\\resources\\app.asar.unpacked\\out\\helpers\\installer-tools.ps1",
  log: "C:\\Users\\S\\AppData\\Roaming\\WriteMind\\tools-setup.log", result: "C:\\Temp\\wm-setup-1.ini" }
const head = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", options.script, "-FromApp"]
const tail = ["-Log", options.log, "-Result", options.result]

describe("what the script is told", () => {
  it("one switch set per action, -WolframScript only for Activate, a dry run that waits for nobody under e2e", () => {
    const ws = "C:\\Program Files\\Wolfram Research\\Wolfram Engine\\15.0\\wolframscript.exe"
    expect(setupArguments("python", { ...options, wolframscript: ws, e2e: false })).toEqual([...head, "-Python", ...tail])
    expect(setupArguments("wolfram", { ...options, wolframscript: ws, e2e: false })).toEqual([...head, "-Wolfram", "-Activate", ...tail])
    expect(setupArguments("activate", { ...options, wolframscript: ws, e2e: false })).toEqual([...head, "-Activate", "-WolframScript", ws, ...tail])
    expect(setupArguments("activate", { ...options, wolframscript: null, e2e: false })).toEqual([...head, "-Activate", ...tail])
    expect(setupArguments("python", { ...options, wolframscript: null, e2e: true })).toEqual([...head, "-Python", "-DryRun", "-NoWait", ...tail])
    // Never -NonInteractive: the window is the person's to read and answer.
    for (const action of ["python", "wolfram", "activate"] as const) {
      expect(setupArguments(action, { ...options, wolframscript: ws, e2e: false })).not.toContain("-NonInteractive")
    }
  })
})

class FakeChild extends EventEmitter {}

function harness(extra: Partial<ToolSetupDeps> = {}) {
  const spawned: { command: string; args: string[]; options: unknown }[] = []
  const removed: string[] = []
  const files = new Map<string, Buffer>()
  let child: FakeChild | null = null
  const deps: ToolSetupDeps = {
    script: options.script, userData: "C:\\Users\\S\\AppData\\Roaming\\WriteMind", e2e: false,
    spawn: (command, args, spawnOptions) => {
      spawned.push({ command, args, options: spawnOptions })
      child = new FakeChild()
      return child
    },
    tmpdir: () => "C:\\Temp",
    readFile: async (file) => {
      const bytes = files.get(file)
      if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      return bytes
    },
    remove: async (file) => { removed.push(file); files.delete(file) },
    isTestHost: () => false,
    powershell: () => "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ...extra,
  }
  return { deps, spawned, removed, files, child: () => child! }
}

describe("how the window is made", () => {
  it("an argument reaches the script whole: spaces, quotes, an apostrophe, a trailing backslash, nothing at all", () => {
    const args = ["-File", "C:\\Program Files\\WriteMind\\resources\\app.asar.unpacked\\out\\helpers\\installer-tools.ps1",
      "C:\\Users\\O'Brien\\AppData\\Roaming\\@writemind\\desktop\\tools-setup.log", "", "say \"hi\"", "C:\\dir with space\\",
      "C:\\a\\\\\"b", "-Python"]
    expect(readBack(args.map(windowsArgument).join(" "))).toEqual(args)
    // Bare when it can be.
    expect(windowsArgument("-NoProfile")).toBe("-NoProfile")
    expect(windowsArgument("C:\\Temp\\wm-setup-1.ini")).toBe("C:\\Temp\\wm-setup-1.ini")
    expect(windowsArgument("C:\\Program Files\\x")).toBe("\"C:\\Program Files\\x\"")
  })

  // BREAK-IT: watched failing against the spawn this replaced (powershell.exe -File … `detached`): a console program
  // started DETACHED from the windowless main process has no console, so no window ever opened.
  it("a hidden PowerShell opens the script with Start-Process, in a window of its own, and waits for that one process", () => {
    const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    const args = setupArguments("activate", { ...options, script: "C:\\Program Files\\WriteMind\\installer-tools.ps1",
      wolframscript: "C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe", e2e: false })
    const launcher = launcherArguments(ps, args)
    expect(launcher.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"])
    const script = Buffer.from(launcher[3]!, "base64").toString("utf16le")
    expect(script).toBe(launcherScript(ps, args))
    expect(script).toMatch(/^\$p = Start-Process -FilePath '[^']+' -ArgumentList '(?:[^']|'')*' -PassThru$/m)
    expect(literalAfter(script, "-FilePath")).toBe(ps)
    // The script's own arguments, read back as powershell.exe will read them: exactly what it is told.
    expect(readBack(literalAfter(script, "-ArgumentList"))).toEqual(args)
    // That one process, not -Wait (Windows PowerShell's waits for the sign-in window the script leaves open too).
    expect(script).toContain("$p.WaitForExit()")
    expect(script).not.toMatch(/-Wait\b/)
    expect(script.split("\n").at(-1)).toBe("exit $p.ExitCode")
    // Hidden, NOT detached, no shell.
    expect(SETUP_SPAWN_OPTIONS).toEqual({ windowsHide: true, stdio: "ignore", shell: false })
    expect("detached" in SETUP_SPAWN_OPTIONS).toBe(false)
  })
})

describe("the setup window", () => {
  it("is PowerShell started hidden, which opens the script's own window; its answer is read when it ends", async () => {
    const h = harness()
    const pending = createToolSetup(h.deps).start("python", null)
    expect(h.spawned.length).toBe(1)
    expect(h.spawned[0]!.command).toMatch(/powershell\.exe$/)
    expect(h.spawned[0]!.options).toEqual({ windowsHide: true, stdio: "ignore", shell: false })
    // What the hidden one hands the window: the script's arguments.
    const script = Buffer.from(h.spawned[0]!.args[h.spawned[0]!.args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le")
    const told = readBack(literalAfter(script, "-ArgumentList"))
    expect(literalAfter(script, "-FilePath")).toBe(h.spawned[0]!.command)
    expect(told.slice(0, 7)).toEqual([...head, "-Python"])
    const result = told[told.indexOf("-Result") + 1]!
    expect(result.startsWith("C:\\Temp")).toBe(true)
    expect(told[told.indexOf("-Log") + 1]).toBe("C:\\Users\\S\\AppData\\Roaming\\WriteMind\\tools-setup.log")
    // The script writes its answer as UTF-16 with a BOM, then ends.
    h.files.set(result, Buffer.from("\uFEFF[result]\r\npython=installed\r\nwolfram=not asked\r\nactivate=not asked\r\nwinget=C:\\w.exe\r\n", "utf16le"))
    h.child().emit("exit", 0)
    expect(await pending).toEqual({ python: "installed", wolfram: "not asked", activate: "not asked", winget: "C:\\w.exe" })
    // The answer is read, then removed.
    expect(h.removed).toEqual([result])
    expect(h.files.has(result)).toBe(false)
  })

  it("answers null when the window closed without an answer, or would not start", async () => {
    const h = harness()
    const closed = createToolSetup(h.deps).start("wolfram", null)
    h.child().emit("exit", 1)
    expect(await closed).toBeNull()
    const failed = createToolSetup(h.deps).start("activate", "C:\\x\\wolframscript.exe")
    h.child().emit("error", new Error("spawn ENOENT"))
    expect(await failed).toBeNull()
    const script = Buffer.from(h.spawned[1]!.args.at(-1)!, "base64").toString("utf16le")
    expect(readBack(literalAfter(script, "-ArgumentList"))).toContain("-WolframScript")
  })

  it("starts nothing on a test host, the real one included", async () => {
    const h = harness({ isTestHost: () => true })
    expect(await createToolSetup(h.deps).start("python", null)).toBeNull()
    expect(h.spawned).toEqual([])
    expect(process.env.VITEST).toBeDefined()
    expect(await createToolSetup({ script: "C:\\nowhere.ps1", userData: "C:\\nowhere", e2e: false }).start("python", null)).toBeNull()
  })
})
