/**
 * File ▸ Language Setup…'s Windows setup window (src/main/toolSetup.ts): the installer's own installer-tools.ps1,
 * run with -FromApp. The process layer is FAKED — nothing here starts PowerShell, an installer or anything else.
 * Port-only.
 */
import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { createToolSetup, SETUP_SPAWN_OPTIONS, setupArguments, type ToolSetupDeps } from "../src/main/toolSetup"

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

describe("the setup window", () => {
  it("is PowerShell in a console of its own: detached, shown, no shell", async () => {
    const h = harness()
    const pending = createToolSetup(h.deps).start("python", null)
    expect(h.spawned.length).toBe(1)
    expect(h.spawned[0]!.command).toMatch(/powershell\.exe$/)
    expect(h.spawned[0]!.options).toEqual({ detached: true, windowsHide: false, stdio: "ignore", shell: false })
    expect(SETUP_SPAWN_OPTIONS.windowsHide).toBe(false)
    const result = h.spawned[0]!.args[h.spawned[0]!.args.indexOf("-Result") + 1]!
    expect(result.startsWith("C:\\Temp")).toBe(true)
    expect(h.spawned[0]!.args[h.spawned[0]!.args.indexOf("-Log") + 1]).toBe("C:\\Users\\S\\AppData\\Roaming\\WriteMind\\tools-setup.log")
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
    expect(h.spawned[1]!.args).toContain("-WolframScript")
  })

  it("starts nothing on a test host, the real one included", async () => {
    const h = harness({ isTestHost: () => true })
    expect(await createToolSetup(h.deps).start("python", null)).toBeNull()
    expect(h.spawned).toEqual([])
    expect(process.env.VITEST).toBeDefined()
    expect(await createToolSetup({ script: "C:\\nowhere.ps1", userData: "C:\\nowhere", e2e: false }).start("python", null)).toBeNull()
  })
})
