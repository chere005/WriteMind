/**
 * THE ONLY PLACE AN EVALUATION CELL'S CODE IS STARTED. Ported from `WriteMind/Eval/CellRunner.swift` (Mac commits
 * 0bf52b5, 765195a, 859aa6c); a test (`apps/desktop/test/evalRunner.test.ts`) fails if anything else in the eval
 * code reaches for `child_process`, or if anything but Shift+Enter asks for a run.
 *
 * A child runs with Sean's own privileges, so:
 *
 * - A RUN ONLY EVER STARTS FROM A PRESS — Shift+Enter in that cell. Never on opening a note, on a save, on a reload.
 * - The guard against a test host is HERE, on the first line of `run`, not at the menu: a vitest run that reached
 *   the real spawn would start a compiler.
 * - The child never touches the note. The answer comes back in memory and the page writes it through the editor,
 *   so Ctrl+Z takes it out.
 * - No shell, ever: the tool and its arguments are an array, and a `.cmd` shim is not a tool. A shell cell is not an
 *   environment at all — the text of a fence is not evidence the owner typed it.
 * - stdin is the null device, so a cell that asks for input (or Wolfram asking for a licence) gets EOF instead of
 *   hanging on a terminal that is not there.
 * - A timeout, an output cap, and a kill — of the child AND its children (`taskkill /T` here; the Mac could not reach
 *   a grandchild) — on a timeout, on the cap, on cancel, when the note closes and when the app quits. The scratch
 *   folder goes in every case.
 */

import { spawn as nodeSpawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Readable } from "node:stream"
import {
  compileArguments, evalResult, isCompiled, OUTPUT_BYTE_LIMIT, sourceFile, withoutTrailingNull, wolframNote,
  type EvalResult, type Evaluator, type RunOutcome, type RunRequest, type ToolReport,
} from "@writemind/core"
import { findTool, flavorOf, interpreterArguments, lookedFor, placesFromProcess, toolReport, type ToolPlaces } from "./tools"

/** Long enough for a C++ compile with <iostream> in it, short enough that `while True: print()` is over quickly. */
export const EVAL_TIMEOUT_MS = 20_000

export interface ChildLike {
  pid?: number
  stdout: Readable | null
  stderr: Readable | null
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "exit", listener: (code: number | null) => void): unknown
  on(event: "close", listener: (code: number | null) => void): unknown
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface SpawnOptions {
  cwd: string
  env: Record<string, string>
  stdio: ["ignore", "pipe", "pipe"]
  windowsHide: true
  shell: false
  detached: boolean
}

export interface RunnerDeps {
  platform: string
  spawn(command: string, args: string[], options: SpawnOptions): ChildLike
  /** Kill a child and everything it started. */
  killTree(child: ChildLike): void
  places(): ToolPlaces
  scratch: {
    make(): Promise<string>
    write(file: string, text: string): Promise<void>
    remove(dir: string): Promise<void>
  }
  /** What a child's environment is: replaced, not inherited (see `childEnvironment`). */
  environment(evaluator: Evaluator): Record<string, string>
  /** A test host never reaches a real child (the Mac's `TestHost.isActive`). */
  isTestHost(): boolean
  timeoutMs?: number
  byteLimit?: number
  /** How long the pipes may stay open after the child itself has exited (a grandchild holding them). */
  pipeGraceMs?: number
}

/** A child has exited; anything still writing into its pipes after this long is a grandchild it left behind. */
export const PIPE_GRACE_MS = 750

interface Job { cancelled: boolean; children: Set<ChildLike> }

/** One child's run, before the app has anything to say about it. */
interface Ran { stdout: string; stderr: string; status: number | null; timedOut: boolean; truncated: boolean }

class Cancelled extends Error {}
class CouldNotStart extends Error {}

export interface Runner {
  run(request: RunRequest): Promise<RunOutcome>
  cancel(id: string): void
  cancelAll(): void
  tools(): ToolReport
  /** How many runs are in flight (for the tests, and for the quit path to know there is something to kill). */
  inFlight(): number
}

export function createRunner(deps: RunnerDeps): Runner {
  const jobs = new Map<string, Job>()
  const timeoutMs = deps.timeoutMs ?? EVAL_TIMEOUT_MS
  const limit = deps.byteLimit ?? OUTPUT_BYTE_LIMIT
  const pipeGraceMs = deps.pipeGraceMs ?? PIPE_GRACE_MS
  const exe = deps.platform === "win32" ? ".exe" : ".out"

  /**
   * Start it, drain BOTH pipes while it runs (a pipe that fills blocks the writer: waiting before reading is a hang
   * the moment a cell prints more than a pipe holds), and answer only once the process has ended AND both pipes are
   * closed — Node's `close` is exactly that.
   */
  function spawnOne(job: Job, tool: string, args: string[], cwd: string, env: Record<string, string>): Promise<Ran> {
    if (job.cancelled) return Promise.reject(new Cancelled())
    return new Promise<Ran>((resolve, reject) => {
      let child: ChildLike
      try {
        child = deps.spawn(tool, args, {
          cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false,
          // Its own process group off Windows, so the kill reaches what it starts (taskkill /T does that here).
          detached: deps.platform !== "win32",
        })
      } catch (error) {
        reject(new CouldNotStart(error instanceof Error ? error.message : String(error)))
        return
      }
      job.children.add(child)
      const out: Buffer[] = []
      const errors: Buffer[] = []
      let bytes = 0
      let truncated = false
      let timedOut = false
      let settled = false
      let exited = false
      let grace: ReturnType<typeof setTimeout> | null = null
      // The pipes closed from this end: Node then reports `close`, and the run settles with what came.
      const closePipes = () => { child.stdout?.destroy(); child.stderr?.destroy() }
      // A CHILD THAT HAS EXITED IS NEVER KILLED BY ITS PID: it is not there to kill, and Windows may have given the
      // number to another process. What is still holding its pipes is a grandchild it left behind; the run lets go.
      const stop = () => { if (exited) closePipes(); else deps.killTree(child) }
      const take = (into: Buffer[]) => (chunk: Buffer) => {
        if (truncated) return
        into.push(chunk)
        bytes += chunk.length
        if (bytes > limit) { truncated = true; stop() }
      }
      child.stdout?.on("data", take(out))
      child.stderr?.on("data", take(errors))
      const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (grace) clearTimeout(grace)
        job.children.delete(child)
        fn()
      }
      // A path that is not there, or not a program, fails here — not as a status.
      child.on("error", (error) => finish(() => reject(new CouldNotStart(error.message))))
      // THE CHILD ITSELF HAS ENDED. Its pipes normally close a moment later; if something it started in the
      // background still holds them (`start /b`, a daemon), the run would wait for that — so they get a short grace
      // and are then closed from here. Cancel no longer reaches for this PID either.
      child.on("exit", () => {
        exited = true
        job.children.delete(child)
        if (!settled) grace = setTimeout(closePipes, pipeGraceMs)
      })
      child.on("close", (code) => finish(() => {
        if (job.cancelled) { reject(new Cancelled()); return }
        // Lenient on purpose: a child's bytes are arbitrary, and one bad byte must not lose the whole answer.
        const text = (parts: Buffer[]) => Buffer.concat(parts).subarray(0, limit).toString("utf8")
        resolve({
          stdout: text(out), stderr: text(errors),
          // A run the app cut short never finished: no exit status to report.
          status: timedOut || truncated ? null : code,
          timedOut, truncated,
        })
      }))
    })
  }

  async function interpret(job: Job, evaluator: Evaluator, tool: string, source: string): Promise<EvalResult> {
    const dir = await deps.scratch.make()
    try {
      // WOLFRAM TAKES ITS SOURCE AS AN ARGUMENT, and the flag matters: `-code` shows the value of the last
      // expression, which is what an Out cell is for (`<path>` opens an interactive session; `-file` shows nothing).
      let args: string[]
      const name = sourceFile(evaluator)
      if (name) {
        const file = path.join(dir, name)
        await deps.scratch.write(file, source)
        args = [...interpreterArguments(tool), file]
      } else {
        args = ["-code", source]
      }
      const ran = await spawnOne(job, tool, args, dir, deps.environment(evaluator))
      const result = evalResult(ran)
      if (evaluator === "wolfram") result.stdout = withoutTrailingNull(result.stdout)
      result.note = wolframNote(result, evaluator, tool)
      return result
    } finally {
      await deps.scratch.remove(dir)
    }
  }

  /**
   * C, C++ and Rust are two processes, two exit codes and two stderrs. A compile that fails IS the answer — there is
   * nothing to run and the diagnostics are the output.
   */
  async function compileAndRun(job: Job, evaluator: Evaluator, tool: string, source: string): Promise<EvalResult> {
    const dir = await deps.scratch.make()
    try {
      const file = path.join(dir, sourceFile(evaluator) ?? "cell.txt")
      const binary = path.join(dir, "cell" + exe)
      await deps.scratch.write(file, source)
      const env = deps.environment(evaluator)
      const build = await spawnOne(job, tool, compileArguments(evaluator, file, binary, flavorOf(tool)), dir, env)
      if (build.status !== 0 || build.timedOut) {
        // The build's own output is the answer (Microsoft's cl writes its diagnostics to stdout, the others to stderr).
        return evalResult({ ...build, note: build.timedOut ? "the compiler timed out" : "it did not compile" })
      }
      const ran = await spawnOne(job, binary, [], dir, env)
      const result = evalResult(ran)
      // The compiler's warnings belong to the run too — a clean compile with a warning in it is the commonest thing.
      if (build.stderr.replace(/[\r\n]+$/, "").length > 0) {
        result.stderr = build.stderr + (result.stderr.length === 0 ? "" : "\n" + result.stderr)
      }
      return result
    } finally {
      await deps.scratch.remove(dir)
    }
  }

  async function run(request: RunRequest): Promise<RunOutcome> {
    // A CHECK THAT CAN REACH THE REAL THING IS NOT A CHECK, and a test host that can start a compiler is worse.
    if (deps.isTestHost()) return { kind: "cancelled" }
    const places = deps.places()
    const tool = findTool(request.evaluator, places)
    if (!tool) {
      return { kind: "refused", refusal: { kind: "missingTool", evaluator: request.evaluator, looked: lookedFor(request.evaluator, places) } }
    }
    // A second run under the same id takes the first back.
    cancel(request.id)
    const job: Job = { cancelled: false, children: new Set() }
    jobs.set(request.id, job)
    try {
      const result = isCompiled(request.evaluator)
        ? await compileAndRun(job, request.evaluator, tool, request.source)
        : await interpret(job, request.evaluator, tool, request.source)
      if (job.cancelled) return { kind: "cancelled" }
      return { kind: "ran", result }
    } catch (error) {
      if (error instanceof Cancelled || job.cancelled) return { kind: "cancelled" }
      return { kind: "couldNotStart", why: error instanceof Error ? error.message : String(error) }
    } finally {
      if (jobs.get(request.id) === job) jobs.delete(request.id)
    }
  }

  function cancel(id: string): void {
    const job = jobs.get(id)
    if (!job) return
    job.cancelled = true
    jobs.delete(id)
    for (const child of job.children) deps.killTree(child)
  }

  function cancelAll(): void {
    for (const id of [...jobs.keys()]) cancel(id)
  }

  return { run, cancel, cancelAll, tools: () => toolReport(deps.places()), inFlight: () => jobs.size }
}

// MARK: - The real thing

/**
 * REPLACED, not inherited — but not empty either. Only what a tool needs to find itself, its libraries and its
 * licence comes through: Windows' own folders, the home and app-data folders (wolframscript reads its licence from
 * there, and under a bare environment prints NOTHING and exits 0 on the Mac), TEMP, the PATH the tool was found on
 * (a MinGW gcc finds cc1 and as through it), and a Visual Studio prompt's INCLUDE / LIB when the app was started
 * from one. Nothing of WriteMind's own (`WRITEMIND_*`, `ELECTRON_*`, `NODE_*`) reaches a cell.
 */
export function childEnvironment(evaluator: Evaluator, source: NodeJS.ProcessEnv = process.env,
  platform = process.platform): Record<string, string> {
  const keep = platform === "win32"
    ? ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE",
      "HOMEPATH", "USERNAME", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
      "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "NUMBER_OF_PROCESSORS",
      "PROCESSOR_ARCHITECTURE", "OS", "INCLUDE", "LIB", "LIBPATH", "RUSTUP_HOME", "CARGO_HOME", "RUSTUP_TOOLCHAIN",
      "WolframKernel"]
    : ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "RUSTUP_HOME", "CARGO_HOME", "RUSTUP_TOOLCHAIN", "WolframKernel"]
  const env: Record<string, string> = {}
  for (const name of keep) {
    const value = source[name]
    if (typeof value === "string") env[name] = value
  }
  const pathValue = source.PATH ?? source.Path
  if (typeof pathValue === "string") env.PATH = pathValue
  const home = source.USERPROFILE ?? source.HOME
  if (typeof home === "string") env.HOME = home
  if (evaluator === "python") {
    // A Windows Python writes to a pipe in the ANSI code page; the note is UTF-8.
    env.PYTHONIOENCODING = "utf-8"
    env.PYTHONUTF8 = "1"
  }
  return env
}

function killTreeReal(child: ChildLike): void {
  if (child.pid === undefined) return
  try {
    if (process.platform === "win32") {
      // The child and everything it started (gcc's cc1, wolframscript's kernel).
      const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe")
      const killer = nodeSpawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false })
      killer.on("error", () => { try { child.kill() } catch { /* already gone */ } })
    } else {
      process.kill(-child.pid, "SIGKILL")
    }
  } catch {
    try { child.kill("SIGKILL") } catch { /* already gone */ }
  }
}

/** The runner the app uses: the real spawn, the real file system, this machine's PATH. */
export function createProcessRunner(): Runner {
  return createRunner({
    platform: process.platform,
    spawn: (command, args, options) => nodeSpawn(command, args, options),
    killTree: killTreeReal,
    places: placesFromProcess,
    scratch: {
      make: () => mkdtemp(path.join(os.tmpdir(), "WriteMind-eval-")),
      write: (file, text) => writeFile(file, text, "utf8"),
      // A child killed a moment ago can still hold its files on Windows: try again a few times.
      remove: (dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }).catch(() => undefined),
    },
    environment: (evaluator) => childEnvironment(evaluator),
    isTestHost: () => process.env.VITEST !== undefined,
  })
}
