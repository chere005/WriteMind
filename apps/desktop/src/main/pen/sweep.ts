/**
 * sweep.ts - the startup sweep (docs/spikes/DESIGN-pen-capture.md 7.5). Run once at launch, BEFORE anything arms.
 *
 * The residual trap the guard cannot cover is "app and guard both killed" (Task Manager "End task" on the tree): the
 * OS keeps the clip, and the Wintab driver keeps the context. The guard journals what it holds (pen-leases.json) and
 * deletes the journal when it lets go, so a journal that is still there at launch with both owners dead is exactly that
 * trap. This sweep undoes it, and only it:
 *   - a clip is released only if the OS still reports the exact rectangle the journal recorded (never somebody else's);
 *   - a Wintab handle is closed only if its name is "WriteMind pen <pid of the dead app>" (never a guessed handle).
 * It runs as the guard script's one-shot `--sweep` mode, so a wedged Wacom service cannot freeze the main process on
 * the driver call, and if the guard script is not there it falls back to releasing a stale clip in-process.
 *
 * `sweepAtStart(paths, log)` returns a promise, and `lease.start()` waits for it: the guard never arms before the sweep ends.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseJournal, win32Clip } from "./clip"
import { sweepJournal, type SweepReport, type WintabPort } from "./guardCore"
import type { PenPaths } from "./types"

export interface SweepHooks {
  execPath?: string
  guardScript?: string
  timeoutMs?: number
  /** Replaces the child process (tests). Resolves with the stdout text, or null if it could not run. */
  run?: (execPath: string, args: string[], timeoutMs: number) => Promise<string | null>
  /** The in-process fallback's OS access (tests). */
  clip?: ReturnType<typeof win32Clip> | null
  pidAlive?: (pid: number) => boolean
}

export type SweepResult = SweepReport | { error: string }

/** Where the guard bundle sits: beside main.mjs; inside a packaged app the real file is in app.asar.unpacked. */
export function defaultGuardScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, "pen-guard.mjs").replace(/app\.asar([\\/])/, "app.asar.unpacked$1")
}

const isPidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" } }

function runGuard(execPath: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ""
    let done = false
    const finish = (v: string | null): void => { if (!done) { done = true; clearTimeout(timer); resolve(v) } }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(execPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
    } catch { resolve(null); return }
    const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } finish(null) }, timeoutMs)
    timer.unref()
    child.stdout?.on("data", (d: Buffer) => { out += d.toString("utf8") })
    child.on("error", () => finish(null))
    child.on("exit", () => finish(out))
  })
}

let pending: Promise<SweepResult> | null = null
/** The sweep still running, or null. `lease.start()` awaits it. */
export const sweepPending = (): Promise<SweepResult> | null => pending

const noWintab: WintabPort = { name: () => null, close: () => false }

export function sweepAtStart(paths: PenPaths, log: (line: string) => void, hooks: SweepHooks = {}): Promise<SweepResult> {
  const say = (s: string): void => { try { log(`sweep: ${s}`) } catch { /* logging never throws */ } }
  let text: string | null = null
  try { text = fs.readFileSync(paths.leases, "utf8") } catch { text = null }
  if (text === null) return Promise.resolve({ journal: "none", clip: "none", wintabClosed: [], wintabSkipped: [] })

  const task = (async (): Promise<SweepResult> => {
    say("a lease journal from an earlier run is still here; checking whether it left anything behind")
    const script = hooks.guardScript ?? defaultGuardScript()
    const exec = hooks.execPath ?? process.execPath
    const run = hooks.run ?? runGuard
    if (fs.existsSync(script) || hooks.run) {
      const stdout = await run(exec, [script, "--sweep", paths.leases], hooks.timeoutMs ?? 6000)
      const line = stdout?.split(/\r?\n/).find((l) => l.startsWith("{"))
      if (line) {
        try {
          const r = (JSON.parse(line) as { sweep: SweepResult }).sweep
          say(JSON.stringify(r))
          return r
        } catch { /* fall through to the in-process path */ }
      }
      say("the guard's sweep gave no answer; releasing a stale clip in-process")
    } else say("pen-guard.mjs is missing; releasing a stale clip in-process")
    // Fallback: the clip only (no Wintab access from here), through clip.ts, the one module allowed to hold the OS clip call.
    try {
      const clip = hooks.clip === undefined ? win32Clip() : hooks.clip
      if (!clip) return { error: "no clip access" }
      const report = sweepJournal(parseJournal(text), { clip, wintab: noWintab, pidAlive: hooks.pidAlive ?? isPidAlive }, process.pid)
      const journal = parseJournal(text)
      if (report.journal === "swept" || journal === null) { try { fs.unlinkSync(paths.leases) } catch { /* gone */ } } // a torn file is litter, not evidence
      say(JSON.stringify(report))
      return report
    } catch (e) {
      say(`failed: ${(e as Error).message}`)
      return { error: (e as Error).message }
    }
  })()
  pending = task
  void task.finally(() => { if (pending === task) pending = null })
  return task
}
