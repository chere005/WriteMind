/**
 * THE ONLY PLACE AN EVALUATION CELL'S CODE IS STARTED. Ported from `WriteMind/Eval/CellRunner.swift` (Mac commits
 * 0bf52b5, 765195a, 859aa6c); a test (`apps/desktop/test/evalRunner.test.ts`) fails if anything else in the eval
 * code reaches for `child_process`, or if anything but Shift+Enter asks for a run.
 *
 * A child runs with Sean's own privileges, so:
 *
 * - A RUN ONLY EVER STARTS FROM A PRESS — Shift+Enter in that cell. Never on opening a note, on a save, on a reload.
 *   Or a press in File ▸ Language Setup…: Test runs a fixed program (`TEST_SOURCE`) and never a note's text; Choose…
 *   and Use ask the picked program its version (`identify`).
 *   Or a press of Export (Wolfram Notebook) or a Copy of a drawing cell (`wolframJob`): a fixed script
 *   (`WOLFRAM_KERNEL_SCRIPT`), never a note's text as code; drawings and pictures go in as files and are imported,
 *   maths is parsed held, nothing is evaluated.
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
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Readable } from "node:stream"
import {
  compileArguments, evalResult, isCompiled, KERNEL_INPUT, KERNEL_SCRIPT_FILE, missingToolRefusal, OUTPUT_BYTE_LIMIT,
  sourceFile, withoutTrailingNull, WOLFRAM_KERNEL_SCRIPT, wolframNote, type EvalResult, type Evaluator, type KernelJob,
  type ProbeOutcome, type RunOutcome, type RunRequest, type ToolReport, type WolframJobOutcome,
} from "@writemind/core"
import {
  flavorOf, identifyArguments, interpreterArguments, placesFromProcess, toolEntry, toolReport, type ToolPlaces,
} from "./tools"

/**
 * Long enough for a C++ compile with <iostream> in it, short enough that `while True: print()` is over quickly. The
 * core's Test sentences say "20 seconds" (`tested` in probe.ts); the runner's test keeps the two in step.
 */
export const EVAL_TIMEOUT_MS = 20_000
/** A version probe answers in a hundredth of a second; ten is a program that is not going to (`identified` says 10). */
export const PROBE_TIMEOUT_MS = 10_000
/** A version is a line or two; anything longer is not one. */
export const PROBE_BYTE_LIMIT = 4096

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
    /** The names in a scratch folder (the kernel's answers), and one file's bytes. */
    list(dir: string): Promise<string[]>
    read(file: string): Promise<Uint8Array>
  }
  /**
   * What a child's environment is: replaced, not inherited (see `childEnvironment`). `tool` is the program the run
   * uses, and whether it was chosen in Language Setup (then its own folder goes first on the PATH).
   */
  environment(evaluator: Evaluator, tool: { path: string; chosen: boolean }): Record<string, string>
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
  /**
   * Ask a program what it is (`identifyArguments`: its version), for Language Setup's Choose… and Use — the only
   * callers (main/eval/languages.ts; a test reads the sources to keep it so). A job like a run: `cancel(id)` and
   * `cancelAll` kill it, it runs in a scratch folder of its own, and a test host starts nothing.
   */
  identify(id: string, evaluator: Evaluator, file: string): Promise<ProbeOutcome>
  /**
   * The Wolfram export's and a copy's ONE kernel run (main/wolfram/kernel.ts is the only caller; a test reads the
   * sources to keep it so): the fixed script in a scratch folder with `inputs` beside it, `wolframscript -file`, and
   * every answer it wrote read back — finished or not. Wolfram's program as a cell finds it (Language Setup's choice
   * included); a job like a run: `cancel(id)` and `cancelAll` kill it, and a test host starts nothing.
   */
  wolframJob(id: string, inputs: readonly KernelJob[], timeoutMs: number): Promise<WolframJobOutcome>
  cancel(id: string): void
  cancelAll(): void
  tools(): ToolReport
  /** How many runs are in flight (for the tests, and for the quit path to know there is something to kill). */
  inFlight(): number
}

export function createRunner(deps: RunnerDeps): Runner {
  const jobs = new Map<string, Job>()
  const runTimeoutMs = deps.timeoutMs ?? EVAL_TIMEOUT_MS
  const runLimit = deps.byteLimit ?? OUTPUT_BYTE_LIMIT
  const pipeGraceMs = deps.pipeGraceMs ?? PIPE_GRACE_MS
  const exe = deps.platform === "win32" ? ".exe" : ".out"
  // The scratch paths follow `deps.platform` like the binary's extension does (and like tools.ts's `joiner`), not the
  // host's `path`: in the app they are the same thing; a test of the Windows runner on a Mac needs them to be.
  const p = deps.platform === "win32" ? path.win32 : path.posix

  /**
   * Start it, drain BOTH pipes while it runs (a pipe that fills blocks the writer: waiting before reading is a hang
   * the moment a cell prints more than a pipe holds), and answer only once the process has ended AND both pipes are
   * closed — Node's `close` is exactly that.
   */
  function spawnOne(job: Job, tool: string, args: string[], cwd: string, env: Record<string, string>,
    limits: { timeoutMs?: number; byteLimit?: number } = {}): Promise<Ran> {
    if (job.cancelled) return Promise.reject(new Cancelled())
    // A version probe is held to less than a cell: it is a line, at once, or it is not the program it says it is.
    const timeoutMs = limits.timeoutMs ?? runTimeoutMs
    const limit = limits.byteLimit ?? runLimit
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

  async function interpret(job: Job, evaluator: Evaluator, tool: string, source: string,
    env: Record<string, string>): Promise<EvalResult> {
    const dir = await deps.scratch.make()
    try {
      // WOLFRAM TAKES ITS SOURCE AS AN ARGUMENT, and the flag matters: `-code` shows the value of the last
      // expression, which is what an Out cell is for (`<path>` opens an interactive session; `-file` shows nothing).
      let args: string[]
      const name = sourceFile(evaluator)
      if (name) {
        const file = p.join(dir, name)
        await deps.scratch.write(file, source)
        args = [...interpreterArguments(tool), file]
      } else {
        args = ["-code", source]
      }
      const ran = await spawnOne(job, tool, args, dir, env)
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
  async function compileAndRun(job: Job, evaluator: Evaluator, tool: string, source: string,
    env: Record<string, string>): Promise<EvalResult> {
    const dir = await deps.scratch.make()
    try {
      const file = p.join(dir, sourceFile(evaluator) ?? "cell.txt")
      const binary = p.join(dir, "cell" + exe)
      await deps.scratch.write(file, source)
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
    // The places are read afresh for every run, Language Setup's choices with them: a choice applies to the next
    // run with no restart, and a chosen program that has gone since is refused here, before anything starts.
    const entry = toolEntry(request.evaluator, deps.places())
    const tool = entry.path
    if (!tool) return { kind: "refused", refusal: missingToolRefusal(request.evaluator, entry) }
    // ONE environment for the whole run: a compiled cell's build and its program see the same PATH.
    const env = deps.environment(request.evaluator, { path: tool, chosen: entry.chosen !== undefined })
    // A second run under the same id takes the first back.
    cancel(request.id)
    const job: Job = { cancelled: false, children: new Set() }
    jobs.set(request.id, job)
    try {
      const result = isCompiled(request.evaluator)
        ? await compileAndRun(job, request.evaluator, tool, request.source, env)
        : await interpret(job, request.evaluator, tool, request.source, env)
      if (job.cancelled) return { kind: "cancelled" }
      return { kind: "ran", result }
    } catch (error) {
      if (error instanceof Cancelled || job.cancelled) return { kind: "cancelled" }
      return { kind: "couldNotStart", why: error instanceof Error ? error.message : String(error) }
    } finally {
      if (jobs.get(request.id) === job) jobs.delete(request.id)
    }
  }

  async function identify(id: string, evaluator: Evaluator, file: string): Promise<ProbeOutcome> {
    // The same guard as a run, on the same first line: a test host never starts the program it was handed.
    if (deps.isTestHost()) return { kind: "cancelled" }
    const args = identifyArguments(evaluator, file)
    // Microsoft's cl has no version to ask for (Language Setup takes it on its name and never calls this for it):
    // nothing is started, and nothing comes back to read.
    if (!args) return { kind: "ran", result: evalResult({ status: 0 }) }
    cancel(id)
    const job: Job = { cancelled: false, children: new Set() }
    jobs.set(id, job)
    let dir: string | null = null
    try {
      dir = await deps.scratch.make()
      // The environment the program will run cells in once it is chosen: its own folder first on the PATH.
      const ran = await spawnOne(job, file, args, dir, deps.environment(evaluator, { path: file, chosen: true }),
        { timeoutMs: PROBE_TIMEOUT_MS, byteLimit: PROBE_BYTE_LIMIT })
      if (job.cancelled) return { kind: "cancelled" }
      return { kind: "ran", result: evalResult(ran) }
    } catch (error) {
      if (error instanceof Cancelled || job.cancelled) return { kind: "cancelled" }
      return { kind: "couldNotStart", why: error instanceof Error ? error.message : String(error) }
    } finally {
      if (dir !== null) await deps.scratch.remove(dir)
      if (jobs.get(id) === job) jobs.delete(id)
    }
  }

  async function wolframJob(id: string, inputs: readonly KernelJob[], timeoutMs: number): Promise<WolframJobOutcome> {
    // The same guard as a run, on the same first line.
    if (deps.isTestHost()) return { kind: "cancelled" }
    const entry = toolEntry("wolfram", deps.places())
    const tool = entry.path
    if (!tool) return { kind: "refused", refusal: missingToolRefusal("wolfram", entry) }
    // Only the files the plan makes go in the folder: a name that is not one of them is a bug, and nothing starts.
    for (const input of inputs) {
      if (!KERNEL_INPUT.test(input.name)) throw new Error(`“${input.name}” is not a file the Wolfram run takes`)
    }
    // A second run under the same id takes the first back (a newer copy).
    cancel(id)
    const job: Job = { cancelled: false, children: new Set() }
    jobs.set(id, job)
    let dir: string | null = null
    try {
      dir = await deps.scratch.make()
      const script = p.join(dir, KERNEL_SCRIPT_FILE)
      await deps.scratch.write(script, WOLFRAM_KERNEL_SCRIPT)
      for (const input of inputs) await deps.scratch.write(p.join(dir, input.name), input.text)
      const ran = await spawnOne(job, tool, ["-file", script, dir], dir,
        deps.environment("wolfram", { path: tool, chosen: entry.chosen !== undefined }),
        // What it prints is not read (its answers are files): the cap only keeps a chatty engine from filling memory.
        { timeoutMs, byteLimit: Math.max(runLimit, 1024 * 1024) })
      if (job.cancelled) return { kind: "cancelled" }
      // EVERY ANSWER IT FINISHED, done or not: each was renamed into place whole, so a run cut short still has them.
      const answers = new Map<string, Uint8Array>()
      let finished = false
      for (const name of await deps.scratch.list(dir).catch(() => [] as string[])) {
        if (name === "done") { finished = true; continue }
        if (!/\.(boxes|png)$/.test(name)) continue
        const bytes = await deps.scratch.read(p.join(dir, name)).catch(() => null)
        if (bytes) answers.set(name, bytes)
      }
      const result = evalResult(ran)
      result.note = wolframNote(result, "wolfram", tool)
      return { kind: "ran", finished, timedOut: ran.timedOut, result, answers }
    } catch (error) {
      if (error instanceof Cancelled || job.cancelled) return { kind: "cancelled" }
      return { kind: "couldNotStart", why: error instanceof Error ? error.message : String(error) }
    } finally {
      if (dir !== null) await deps.scratch.remove(dir)
      if (jobs.get(id) === job) jobs.delete(id)
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

  return { run, identify, wolframJob, cancel, cancelAll, tools: () => toolReport(deps.places()), inFlight: () => jobs.size }
}

// MARK: - The real thing

/**
 * REPLACED, not inherited — but not empty either. Only what a tool needs to find itself, its libraries and its
 * licence comes through: Windows' own folders, the home and app-data folders (wolframscript reads its licence from
 * there, and under a bare environment prints NOTHING and exits 0 on the Mac), TEMP, the PATH the tool was found on
 * (a MinGW gcc finds cc1 and as through it), and a Visual Studio prompt's INCLUDE / LIB when the app was started
 * from one. Nothing of WriteMind's own (`WRITEMIND_*`, `ELECTRON_*`, `NODE_*`) reaches a cell.
 *
 * A PROGRAM CHOSEN IN LANGUAGE SETUP brings its own folder to the FRONT of the PATH (`toolFolder`): a venv's `bin`
 * is what makes its `pip` and its other programs the ones a cell finds, and a MinGW compiler chosen from a folder no
 * PATH reaches builds programs that need its `libstdc++-6.dll` beside them. A tool found by itself leaves the PATH
 * exactly as it was: it was found on it, or in a place the PATH has never needed.
 */
export function childEnvironment(evaluator: Evaluator, source: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform, extra: { toolFolder?: string } = {}): Record<string, string> {
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
  if (extra.toolFolder) {
    const separator = platform === "win32" ? ";" : ":"
    env.PATH = env.PATH ? `${extra.toolFolder}${separator}${env.PATH}` : extra.toolFolder
  }
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

/**
 * The runner the app uses: the real spawn, the real file system, this machine's PATH — and Language Setup's
 * choices (`store`, main/eval/languages.ts), read again for every run.
 */
export function createProcessRunner(store?: { get(): Partial<Record<Evaluator, string>>; unreadable?(): string | null }): Runner {
  return createRunner({
    platform: process.platform,
    spawn: (command, args, options) => nodeSpawn(command, args, options),
    killTree: killTreeReal,
    // A settings file that could never be read refuses every language rather than guess (tools.ts `toolEntry`).
    places: () => placesFromProcess(store?.get() ?? {}, store?.unreadable?.() ?? null),
    scratch: {
      make: () => mkdtemp(path.join(os.tmpdir(), "WriteMind-eval-")),
      write: (file, text) => writeFile(file, text, "utf8"),
      // A child killed a moment ago can still hold its files on Windows: try again a few times.
      remove: (dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }).catch(() => undefined),
      list: (dir) => readdir(dir),
      read: async (file) => new Uint8Array(await readFile(file)),
    },
    environment: (evaluator, tool) => processEnvironment(evaluator, tool),
    isTestHost: () => process.env.VITEST !== undefined,
  })
}

/** The real runner's environment for a run: this process's, replaced, with a CHOSEN tool's folder first on the PATH. */
export function processEnvironment(evaluator: Evaluator, tool: { path: string; chosen: boolean },
  source: NodeJS.ProcessEnv = process.env, platform: string = process.platform): Record<string, string> {
  const p = platform === "win32" ? path.win32 : path.posix
  return childEnvironment(evaluator, source, platform, tool.chosen ? { toolFolder: p.dirname(tool.path) } : {})
}
