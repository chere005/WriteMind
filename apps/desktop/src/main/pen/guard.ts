/**
 * guard.ts - the GUARD PROCESS (docs/spikes/DESIGN-pen-capture.md 7.5), bundled to out/main/pen-guard.mjs and run as
 * `process.execPath` with ELECTRON_RUN_AS_NODE=1, DETACHED (libuv puts a non-detached child in a job object that dies
 * with its parent; the guard has to outlive a killed app long enough to undo what the app left, and to see the EOF).
 *
 *   pen-guard.mjs --journal <file> --app-pid <pid>        serve stdin commands (clip.ts has the protocol)
 *   pen-guard.mjs --sweep <journal>                       one-shot: undo what a dead previous run left, print a JSON line, exit
 *
 * All the decisions are in guardCore.ts (tested with a fake OS); this file is the thin shell that gives the core the real
 * ClipCursor / Wintab / key state, and the exit handlers. It imports nothing from the app except the pure clip.ts and
 * guardCore.ts. It must never throw out of a handler: a guard that dies leaves the app alone with the state, and the app
 * then undoes it itself (lease.ts), so every path here ends in a release or a clean exit.
 *
 * NOTHING HERE injects input, hooks anything or moves the cursor (see test/pen/safety.test.ts). This process only reads
 * the Ctrl/Alt/G key state (GetAsyncKeyState) while it holds something, so the panic chord works without the app.
 */

import { createRequire } from "node:module"
import fs from "node:fs"
import readline from "node:readline"
import type * as KoffiNS from "koffi"
import { parseJournal, win32Clip, type LeaseJournal, type Win32Clip } from "./clip"
import { GuardCore, sweepJournal, type GuardPorts, type WintabPort } from "./guardCore"

type Koffi = typeof KoffiNS
type Fn = (...args: unknown[]) => unknown
const koffiPath = process.env.WM_PEN_KOFFI || "koffi"
const requireKoffi = (): Koffi => createRequire(import.meta.url)(koffiPath) as Koffi

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

const dbg = (s: string): void => {
  const f = process.env.WM_GUARD_LOG
  if (f) { try { fs.appendFileSync(f, `${Date.now()} ${s}\n`) } catch { /* the log is optional */ } }
}

function dpiAware(koffi: Koffi): void {
  // The guard must see the same physical pixels as the app: ClipCursor and GetSystemMetrics are virtualised for an
  // unaware process. Electron already is aware (manifest); plain node (the tests) is not. -4 = PER_MONITOR_AWARE_V2.
  try { (koffi.load("user32.dll").func("bool __stdcall SetProcessDpiAwarenessContext(intptr_t v)") as Fn)(-4) } catch { /* already set, or older Windows */ }
}

function makeWintab(koffi: Koffi): WintabPort {
  let WTGetW: ((h: bigint, ctx: Buffer) => number) | null = null
  let WTClose: ((h: bigint) => number) | null = null
  try {
    const wt = koffi.load("wintab32.dll")
    WTGetW = wt.func("int WTGetW(void *hctx, void *ctx)") as (h: bigint, ctx: Buffer) => number
    WTClose = wt.func("int WTClose(void *hctx)") as (h: bigint) => number
  } catch { WTGetW = null; WTClose = null }
  return {
    name(handle) {
      if (!WTGetW) return null
      const b = Buffer.alloc(212) // LOGCONTEXTW: lcName is the first 80 bytes (40 UTF-16 units)
      try { if (!WTGetW(BigInt(handle), b)) return null } catch { return null }
      const s = b.subarray(0, 80).toString("utf16le")
      const nul = s.indexOf("\u0000")
      return nul >= 0 ? s.slice(0, nul) : s
    },
    close(handle) {
      if (!WTClose) return false
      try { return WTClose(BigInt(handle)) !== 0 } catch { return false }
    },
  }
}

const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" } }

function makeClip(): Win32Clip { return win32Clip(koffiPath) }

// -------------------------------------------------------------------------------------------------------------
// One-shot sweep
// -------------------------------------------------------------------------------------------------------------
function sweepMode(journalPath: string): void {
  let text: string | null = null
  try { text = fs.readFileSync(journalPath, "utf8") } catch { text = null }
  const journal = text === null ? null : parseJournal(text)
  let line: string
  try {
    const koffi = requireKoffi()
    dpiAware(koffi)
    const report = sweepJournal(journal, { clip: makeClip(), wintab: makeWintab(koffi), pidAlive }, process.pid)
    if (report.journal === "swept" || (text !== null && journal === null)) { try { fs.unlinkSync(journalPath) } catch { /* gone */ } }
    line = JSON.stringify({ sweep: report })
  } catch (e) {
    line = JSON.stringify({ sweep: { error: (e as Error).message } })
  }
  process.stdout.write(`${line}\n`, () => process.exit(0))
}

// -------------------------------------------------------------------------------------------------------------
// The guard
// -------------------------------------------------------------------------------------------------------------
function serve(): void {
  const journalPath = flag("--journal")
  const appPid = Number(flag("--app-pid") ?? "0")
  const koffi = requireKoffi()
  dpiAware(koffi)
  const user32 = koffi.load("user32.dll")
  const getAsyncKeyState = user32.func("int16 __stdcall GetAsyncKeyState(int vk)") as (vk: number) => number
  const down = (vk: number): boolean => (getAsyncKeyState(vk) & 0x8000) !== 0
  // The panic chord is polled inside a try/catch (a failing poll must never stop a release), which would also hide a poll that never works:
  // prove once, at start, that the key API answers, and say so on stdout (the proof script reads it).
  let keyApiOk = false
  try { down(0x11); keyApiOk = true } catch { keyApiOk = false }

  const ports: GuardPorts = {
    clip: makeClip(),
    wintab: makeWintab(koffi),
    now: () => Date.now(),
    out: (line) => { try { process.stdout.write(`${line}\n`) } catch { /* the parent is gone */ } },
    journal: (j: LeaseJournal | null) => {
      if (!journalPath) return
      try {
        if (!j) { fs.unlinkSync(journalPath); return }
        const tmp = `${journalPath}.${process.pid}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(j))
        fs.renameSync(tmp, journalPath)
      } catch { /* ENOENT on delete, or a read-only profile: the journal is a convenience */ }
    },
    // Ctrl + Alt + G. (VK_CONTROL 0x11, VK_MENU 0x12, G 0x47.) Read only while the core holds something.
    panicChordDown: () => down(0x11) && down(0x12) && down(0x47),
    pidAlive,
    exit: (code) => setImmediate(() => process.exit(code)),
    log: dbg,
  }
  const core = new GuardCore(ports, process.pid, appPid)

  process.stdout.on("error", () => { /* EPIPE: the app is gone; the EOF handler does the work */ })
  process.on("exit", () => { core.lastGasp() })
  process.on("uncaughtException", (e) => { dbg(`uncaught ${e.message}`); ports.out(`err ${e.message}`); core.bye("crash") })
  process.on("unhandledRejection", (e) => { dbg(`unhandled ${String(e)}`); core.bye("crash") })
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) process.on(sig, () => core.bye(`signal-${sig}`))

  const timer = setInterval(() => { try { core.tick() } catch (e) { dbg(`tick threw ${(e as Error).message}`) } }, 50)
  const rl = readline.createInterface({ input: process.stdin })
  rl.on("line", (line) => { try { core.handleLine(line) } catch (e) { dbg(`line threw ${(e as Error).message}`); core.bye("crash") } })
  // The app is gone (killed, crashed, closed the pipe): undo everything and go.
  rl.on("close", () => { dbg("stdin close"); clearInterval(timer); core.eof() })
  ports.out("ready")
  ports.out(`keyapi ${keyApiOk ? "ok" : "FAILED"}`)
}

const sweepPath = flag("--sweep")
if (sweepPath) sweepMode(sweepPath)
else serve()
