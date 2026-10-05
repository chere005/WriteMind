/**
 * The runner of evaluation cells (`src/main/eval`), with its process layer FAKED: no child is ever started here.
 * Transcribed from the runner half of `WriteMindTests/EvaluationCellTests.swift` (`EvaluationSpawnTests`, the
 * Wolfram cases) and grown for what the Windows runner adds — a PATH search, a tree kill, `cl`, the scratch folder.
 */

import { EventEmitter } from "node:events"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { PassThrough } from "node:stream"
import { describe, expect, it } from "vitest"
import { outBody, type RunOutcome } from "@writemind/core"
import {
  childEnvironment, createProcessRunner, createRunner, type ChildLike, type RunnerDeps, type SpawnOptions,
} from "../src/main/eval/runner"
import {
  findTool, flavorOf, interpreterArguments, lookedFor, newestFirst, toolCandidates, type ToolPlaces,
} from "../src/main/eval/tools"
import { validRequest } from "../src/main/eval/ipc"

const ROOT = path.resolve(__dirname, "../../..")

interface Script {
  stdout?: string; stderr?: string; code?: number | null; hang?: boolean; error?: string; flood?: number
  /** The child exits but something it started keeps both pipes open (Node's `close` waits for the pipes). */
  orphan?: boolean
}

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  constructor(script: Script) {
    super()
    setTimeout(() => {
      if (script.error) { this.emit("error", new Error(script.error)); return }
      if (script.flood) this.stdout.write(Buffer.alloc(script.flood, 0x61))
      if (script.stdout) this.stdout.write(script.stdout)
      if (script.stderr) this.stderr.write(script.stderr)
      if (script.orphan) {
        // As Node does: `close` comes once the child has exited AND both pipes have closed.
        let open = 2
        const one = () => { if (--open === 0) this.emit("close", script.code ?? 0) }
        this.stdout.on("close", one)
        this.stderr.on("close", one)
        this.emit("exit", script.code ?? 0)
        return
      }
      if (!script.hang) this.end(script.code ?? 0)
    }, 1)
  }
  end(code: number | null): void {
    this.stdout.end()
    this.stderr.end()
    setTimeout(() => this.emit("close", code), 1)
  }
  kill(): boolean { this.killed = true; this.end(null); return true }
}

interface Harness {
  deps: RunnerDeps
  spawned: { command: string; args: string[]; options: SpawnOptions }[]
  written: Map<string, string>
  removed: string[]
  killed: ChildLike[]
}

const WIN_PLACES = (present: string[]): ToolPlaces => ({
  platform: "win32",
  pathVariable: "C:\\Windows;C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps;C:\\mingw\\bin",
  home: "C:\\Users\\S",
  programFiles: ["C:\\Program Files"],
  isFile: (file) => present.includes(file),
})

function harness(present: string[], script: (command: string, args: string[]) => Script, extra: Partial<RunnerDeps> = {}): Harness {
  const spawned: Harness["spawned"] = []
  const written = new Map<string, string>()
  const removed: string[] = []
  const killed: ChildLike[] = []
  let dirs = 0
  const deps: RunnerDeps = {
    platform: "win32",
    spawn: (command, args, options) => {
      spawned.push({ command, args, options })
      return new FakeChild(script(command, args))
    },
    killTree: (child) => { killed.push(child); child.kill() },
    places: () => WIN_PLACES(present),
    scratch: {
      make: async () => `C:\\Temp\\WriteMind-eval-${++dirs}`,
      write: async (file, text) => { written.set(file, text) },
      remove: async (dir) => { removed.push(dir) },
    },
    environment: () => ({ PATH: "C:\\Windows", SystemRoot: "C:\\Windows" }),
    isTestHost: () => false,
    ...extra,
  }
  return { deps, spawned, written, removed, killed }
}

const ran = (outcome: RunOutcome) => {
  expect(outcome.kind).toBe("ran")
  if (outcome.kind !== "ran") throw new Error(outcome.kind)
  return outcome.result
}

describe("finding the tools (tools.ts)", () => {
  it("looks for Python's launcher first and puts the Store's placeholder last", () => {
    const all = toolCandidates("python", WIN_PLACES([]))
    expect(all[0]).toBe("C:\\Windows\\py.exe")
    const store = all.findIndex((file) => /WindowsApps/.test(file))
    expect(all.slice(store).every((file) => /WindowsApps/.test(file))).toBe(true)
    expect(all.every((file) => /\.(exe|com)$/.test(file))).toBe(true)
    // Both are there: the launcher wins.
    expect(findTool("python", WIN_PLACES(["C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe", "C:\\Windows\\py.exe"])))
      .toBe("C:\\Windows\\py.exe")
  })

  it("finds rustc in rustup's own folder and wolframscript under Program Files, which a PATH may not reach", () => {
    expect(toolCandidates("rust", WIN_PLACES([]))).toContain("C:\\Users\\S\\.cargo\\bin\\rustc.exe")
    expect(toolCandidates("wolfram", WIN_PLACES([])))
      .toContain("C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe")
    expect(lookedFor("rust", WIN_PLACES([]))).toEqual(["rustc on the PATH", "C:\\Users\\S\\.cargo\\bin\\rustc.exe"])
    expect(lookedFor("wolfram", WIN_PLACES([]))).toEqual([
      "wolframscript on the PATH", "Program Files\\Wolfram Research\\WolframScript",
      "Program Files\\Wolfram Research\\Wolfram Engine\\<version>",
    ])
  })

  it("finds the wolframscript the Wolfram Engine puts in its version folder, the newest engine first", () => {
    const engines = "C:\\Program Files\\Wolfram Research\\Wolfram Engine"
    const places = (present: string[]): ToolPlaces => ({
      ...WIN_PLACES(present),
      folders: (dir) => (dir === engines ? ["13.3", "14.1", "14.10", "Documentation", "14.9"] : []),
    })
    const all = toolCandidates("wolfram", places([]))
    const inEngines = all.filter((file) => file.startsWith(engines))
    expect(inEngines).toEqual(["14.10", "14.9", "14.1", "13.3", "Documentation"].map((v) => `${engines}\\${v}\\wolframscript.exe`))
    // WolframScript's own folder is tried before the engine's copy, and the PATH before both.
    expect(all.indexOf("C:\\Windows\\wolframscript.exe")).toBeLessThan(all.indexOf("C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe"))
    expect(all.indexOf("C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe")).toBeLessThan(all.indexOf(inEngines[0]!))
    // Only the engine is there: it is found.
    expect(findTool("wolfram", places([`${engines}\\14.1\\wolframscript.exe`]))).toBe(`${engines}\\14.1\\wolframscript.exe`)
    expect(findTool("wolfram", places([`${engines}\\14.1\\wolframscript.exe`, `${engines}\\13.3\\wolframscript.exe`])))
      .toBe(`${engines}\\14.1\\wolframscript.exe`)
    // No engine folder at all (no `folders`, or nothing in it): nothing is made up.
    expect(toolCandidates("wolfram", WIN_PLACES([])).some((file) => file.includes("Wolfram Engine"))).toBe(false)
    expect(findTool("wolfram", WIN_PLACES([]))).toBeNull()
    expect(newestFirst(["2", "10", "1.5", "x"])).toEqual(["10", "2", "1.5", "x"])
  })

  it("tries gcc, then clang, then cl for C, and knows cl takes its own flags", () => {
    const c = toolCandidates("c", WIN_PLACES([]))
    expect(c.indexOf("C:\\mingw\\bin\\gcc.exe")).toBeLessThan(c.indexOf("C:\\mingw\\bin\\clang.exe"))
    expect(c.indexOf("C:\\mingw\\bin\\clang.exe")).toBeLessThan(c.indexOf("C:\\mingw\\bin\\cl.exe"))
    expect(flavorOf("C:\\VS\\bin\\cl.exe")).toBe("msvc")
    expect(flavorOf("C:\\mingw\\bin\\gcc.exe")).toBe("gnu")
    expect(interpreterArguments("C:\\Windows\\py.exe")).toEqual(["-3"])
    expect(interpreterArguments("C:\\Python\\python.exe")).toEqual([])
  })
})

describe("the child's environment is replaced, not inherited", () => {
  it("keeps what a tool needs and nothing of the app's own", () => {
    const env = childEnvironment("python", {
      Path: "C:\\Windows;C:\\mingw\\bin", SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\S", TEMP: "C:\\Temp",
      WRITEMIND_NOTES: "C:\\notes", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "--inspect", WRITEMIND_E2E: "1",
    }, "win32")
    expect(env.PATH).toBe("C:\\Windows;C:\\mingw\\bin")
    expect(env.SystemRoot).toBe("C:\\Windows")
    expect(env.HOME).toBe("C:\\Users\\S")
    expect(env.PYTHONUTF8).toBe("1")
    for (const gone of ["WRITEMIND_NOTES", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "WRITEMIND_E2E"]) expect(env[gone]).toBeUndefined()
    expect(childEnvironment("c", { Path: "x" }, "win32").PYTHONUTF8).toBeUndefined()
  })
})

describe("running a cell (runner.ts, process layer faked)", () => {
  it("refuses a missing tool by name and starts nothing", async () => {
    const h = harness([], () => ({}))
    const outcome = await createRunner(h.deps).run({ id: "a", evaluator: "c", source: "int main(){}" })
    expect(outcome).toEqual({ kind: "refused", refusal: { kind: "missingTool", evaluator: "c", looked: ["gcc, clang, cl on the PATH"] } })
    expect(h.spawned).toEqual([])
  })

  it("runs Python as one child: the source in a scratch file, no shell, stdin closed, and the folder removed", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ stdout: "4\r\n" }))
    const result = ran(await createRunner(h.deps).run({ id: "a", evaluator: "python", source: "print(2 + 2)" }))
    expect(h.spawned.length).toBe(1)
    const [call] = h.spawned
    expect(call!.command).toBe("C:\\Windows\\py.exe")
    expect(call!.args).toEqual(["-3", "C:\\Temp\\WriteMind-eval-1\\cell.py"])
    expect(call!.options).toMatchObject({ cwd: "C:\\Temp\\WriteMind-eval-1", shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], detached: false })
    expect(h.written.get("C:\\Temp\\WriteMind-eval-1\\cell.py")).toBe("print(2 + 2)")
    expect(h.removed).toEqual(["C:\\Temp\\WriteMind-eval-1"])
    expect(result.status).toBe(0)
    expect(outBody(result)).toBe("4")
  })

  it("hands Wolfram its source with -code, drops the trailing Null, and says when it is not activated", async () => {
    const tool = "C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe"
    const h = harness([tool], () => ({ stdout: "hello\nNull\n" }))
    const result = ran(await createRunner(h.deps).run({ id: "w", evaluator: "wolfram", source: "Print[\"hello\"]" }))
    expect(h.spawned[0]!.args).toEqual(["-code", "Print[\"hello\"]"])
    expect(h.written.size).toBe(0)
    expect(outBody(result)).toBe("hello")
    const locked = harness([tool], () => ({ stderr: "The Wolfram Engine requires one-time activation on this computer.", code: 255 }))
    const refused = ran(await createRunner(locked.deps).run({ id: "w", evaluator: "wolfram", source: "1+1" }))
    // The command names the wolframscript that was found: the Engine's installer does not put it on the PATH.
    expect(outBody(refused)).toContain(`"${tool}" -activate`)
    expect(outBody(refused)).toContain("[exit 255]")
  })

  it("compiles C with the standard named, runs what it built, and keeps the compiler's warnings", async () => {
    const h = harness(["C:\\mingw\\bin\\gcc.exe"], (command) =>
      command.endsWith("gcc.exe") ? { stderr: "cell.c:1: warning: unused\n" } : { stdout: "hello from C\n" })
    const result = ran(await createRunner(h.deps).run({ id: "c", evaluator: "c", source: "int main(){}" }))
    expect(h.spawned.map((s) => s.command)).toEqual(["C:\\mingw\\bin\\gcc.exe", "C:\\Temp\\WriteMind-eval-1\\cell.exe"])
    expect(h.spawned[0]!.args).toEqual(["-std=c17", "-o", "C:\\Temp\\WriteMind-eval-1\\cell.exe", "C:\\Temp\\WriteMind-eval-1\\cell.c"])
    expect(outBody(result)).toBe("hello from C\n[stderr]\ncell.c:1: warning: unused")
    expect(h.removed).toEqual(["C:\\Temp\\WriteMind-eval-1"])
  })

  it("answers with the diagnostics, and runs nothing, when it does not compile", async () => {
    const h = harness(["C:\\mingw\\bin\\g++.exe"], () => ({ stderr: "cell.cpp:1: error: expected ';'\n", code: 1 }))
    const result = ran(await createRunner(h.deps).run({ id: "x", evaluator: "cpp", source: "int main(){ x }" }))
    expect(h.spawned.length).toBe(1)
    expect(h.spawned[0]!.args[0]).toBe("-std=c++20")
    expect(outBody(result)).toBe("[stderr]\ncell.cpp:1: error: expected ';'\n[it did not compile]\n[exit 1]")
  })

  it("hands Microsoft's cl its own flags", async () => {
    const h = harness(["C:\\mingw\\bin\\cl.exe"], () => ({ stdout: "ok" }))
    await createRunner(h.deps).run({ id: "m", evaluator: "c", source: "int main(){}" })
    expect(h.spawned[0]!.args).toEqual(["/nologo", "/std:c17", "/EHsc", "/Fe:C:\\Temp\\WriteMind-eval-1\\cell.exe",
      "C:\\Temp\\WriteMind-eval-1\\cell.c"])
  })

  it("kills a cell that runs past the timeout, child and children, and says so", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ stdout: "tick\n", hang: true }), { timeoutMs: 30 })
    const result = ran(await createRunner(h.deps).run({ id: "t", evaluator: "python", source: "while True: pass" }))
    expect(h.killed.length).toBe(1)
    expect(result.timedOut).toBe(true)
    expect(result.status).toBeNull()
    expect(outBody(result)).toBe("tick\n[timed out]")
    expect(h.removed.length).toBe(1)
  })

  it("lets go of a child that exited while a grandchild still holds its pipes, and kills no stale PID", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ stdout: "started\n", orphan: true }),
      { pipeGraceMs: 20, timeoutMs: 5000 })
    const runner = createRunner(h.deps)
    const began = Date.now()
    const result = ran(await runner.run({ id: "o", evaluator: "python", source: "import os; os.system('start /b ping -t 127.0.0.1')" }))
    expect(Date.now() - began).toBeLessThan(2000)
    expect(result.stdout).toBe("started\n")
    expect(result.timedOut).toBe(false)
    expect(h.killed.length).toBe(0)
    expect(h.removed.length).toBe(1)
    expect(runner.inFlight()).toBe(0)
  })

  it("stops a cell that prints past the cap and keeps what fits", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ flood: 5000, hang: true }), { byteLimit: 1000 })
    const result = ran(await createRunner(h.deps).run({ id: "f", evaluator: "python", source: "while True: print('a')" }))
    expect(h.killed.length).toBe(1)
    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBe(1000)
  })

  it("takes a run back on cancel: the child is killed, nothing is answered, the folder goes", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ hang: true }))
    const runner = createRunner(h.deps)
    const pending = runner.run({ id: "k", evaluator: "python", source: "input()" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(runner.inFlight()).toBe(1)
    runner.cancel("k")
    expect(await pending).toEqual({ kind: "cancelled" })
    expect(h.killed.length).toBe(1)
    expect(h.removed.length).toBe(1)
    expect(runner.inFlight()).toBe(0)
  })

  it("takes every run back when the app quits", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ hang: true }))
    const runner = createRunner(h.deps)
    const one = runner.run({ id: "1", evaluator: "python", source: "x" })
    const two = runner.run({ id: "2", evaluator: "python", source: "y" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    runner.cancelAll()
    expect(await one).toEqual({ kind: "cancelled" })
    expect(await two).toEqual({ kind: "cancelled" })
    expect(h.killed.length).toBe(2)
  })

  it("writes 'could not start' when the tool would not start", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ error: "spawn EACCES" }))
    expect(await createRunner(h.deps).run({ id: "e", evaluator: "python", source: "1" }))
      .toEqual({ kind: "couldNotStart", why: "spawn EACCES" })
  })

  /** The guard is at the SPAWN, not at the menu (the Mac's testATestHostRunsNothing). */
  it("runs nothing in a test host, the real runner included", async () => {
    const h = harness(["C:\\Windows\\py.exe"], () => ({ stdout: "no" }), { isTestHost: () => true })
    expect(await createRunner(h.deps).run({ id: "h", evaluator: "python", source: "print('no')" })).toEqual({ kind: "cancelled" })
    expect(h.spawned).toEqual([])
    expect(process.env.VITEST).toBeDefined()
    expect(await createProcessRunner().run({ id: "h", evaluator: "python", source: "print('no')" })).toEqual({ kind: "cancelled" })
  })

  it("takes only a well-formed request across the boundary", () => {
    expect(validRequest({ id: "a", evaluator: "python", source: "1" })).toEqual({ id: "a", evaluator: "python", source: "1" })
    expect(validRequest({ id: "a", evaluator: "bash", source: "rm -rf /" })).toBeNull()
    expect(validRequest({ id: "a", evaluator: "python", source: 3 })).toBeNull()
    expect(validRequest({ id: "", evaluator: "python", source: "1" })).toBeNull()
    expect(validRequest(null)).toBeNull()
  })
})

/** The promises that only a press starts a child, and only one file starts it — kept by reading the sources. */
describe("only a press starts a child (EvaluationSpawnTests)", () => {
  const sources = (dir: string): string[] => {
    const out: string[] = []
    const walk = (at: string) => {
      for (const name of readdirSync(at)) {
        const file = path.join(at, name)
        if (statSync(file).isDirectory()) walk(file)
        else if (/\.(ts|tsx)$/.test(file)) out.push(file)
      }
    }
    walk(path.join(ROOT, dir))
    return out
  }
  const holding = (dir: string, needle: RegExp) =>
    sources(dir).filter((file) => needle.test(readFileSync(file, "utf8"))).map((file) => path.relative(ROOT, file).replace(/\\/g, "/"))

  it("ONE file of the eval code starts processes", () => {
    expect(holding("apps/desktop/src/main/eval", /child_process|\bexecFile\(|\bspawnSync\(/)).toEqual(["apps/desktop/src/main/eval/runner.ts"])
    for (const dir of ["packages/core/src", "packages/editor/src", "apps/desktop/src/renderer"]) {
      expect(holding(dir, /child_process/), dir).toEqual([])
    }
  })

  it("the run channel is the preload's and the eval IPC's alone, and the page reaches it from one file", () => {
    expect(holding("apps/desktop/src", /EVAL_CHANNELS\.run\b/).sort())
      .toEqual(["apps/desktop/src/main/eval/ipc.ts", "apps/desktop/src/preload/preload.ts"])
    expect(holding("apps/desktop/src/renderer", /evaluate\.run\(/)).toEqual(["apps/desktop/src/renderer/evalHost.ts"])
  })

  it("nothing but Shift+Enter in the cell asks for a run — not opening, saving or loading a note", () => {
    expect(holding("packages/editor/src", /\bhost\.run\(/)).toEqual(["packages/editor/src/eval/index.ts"])
    // Line endings as checked out: CI's Windows runner hands Git's files over with \r\n.
    const editor = readFileSync(path.join(ROOT, "packages/editor/src/eval/index.ts"), "utf8").replace(/\r\n/g, "\n")
    // runCellAt is called from runCell only, and runCell is bound to Shift-Enter only.
    expect(editor.match(/runCellAt\(/g)?.length).toBe(2)
    expect(editor).toMatch(/const runCell: Command = \(view\) => \{\n\s+const plugin = view\.plugin\(evalPlugin\)\n\s+return plugin \? runCellAt\(view, plugin\) : false/)
    expect(editor.match(/\brun: runCell\b/g)?.length).toBe(1)
    expect(editor).toMatch(/\{ key: "Shift-Enter", run: runCell \}/)
    for (const file of sources("packages/editor/src").concat(sources("apps/desktop/src/renderer"))) {
      if (file.endsWith(path.join("eval", "index.ts")) || file.endsWith("index.ts") && file.includes(path.join("editor", "src"))) continue
      expect(readFileSync(file, "utf8"), path.basename(file)).not.toMatch(/\brunCell\b(?!s)/)
    }
  })
})
