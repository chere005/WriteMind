/**
 * penProofApp.ts - a stand-in for WriteMind's main process, for scripts/pen-guard-proof.mjs (the real-API proof that the app can
 * never leave the cursor confined). The proof bundles this with esbuild and runs it as a separate process that it then
 * kills, hangs, starves or lets crash, while watching GetClipCursor from ANOTHER process.
 *
 * It uses the REAL lease.ts / sweep.ts / containment.ts and the REAL guard process; only the sink, the tablet backends and Electron are
 * stand-ins. Modes (argv[2]):
 *   arm        start the guard, arm a clip, keep running (the lease heartbeat is the real one)
 *   hang       arm, then block the event loop for ever (a frozen main process: only the guard's lease can save the cursor)
 *   silent     arm with a heartbeat so slow that it never beats (the app is alive but the lease is not renewed)
 *   throw      arm, then throw an uncaught exception 600 ms later
 *   exit       arm, then process.exit(0) 600 ms later
 *   sweep      run the startup sweep (the real sweepAtStart) and print the result, then exit
 *   contain    run the REAL containment policy on the REAL lease; commands arrive as JSON lines on stdin (see below)
 *
 * Output lines on stdout: GUARDPID n, APPPID n, ARMED, SWEEP {json}, STATE {json}, DONE.
 * `contain` commands (one JSON per line): {"op":"update","patch":{...ContainmentUpdate fields...}}, {"op":"panic","reason":"esc"},
 * {"op":"metrics"}, {"op":"status"}, {"op":"free"}, {"op":"dispose"}, {"op":"quit"}.
 */

import path from "node:path"
import readline from "node:readline"
import { DEFAULT_SETTINGS, type Box, type PenSample } from "../src/shared/pen"
import { createLease } from "../src/main/pen/lease"
import { sweepAtStart } from "../src/main/pen/sweep"
import { makeContainment, type ContainmentUpdate } from "../src/main/pen/containment"
import type { PenPaths, Sink } from "../src/main/pen/types"

const mode = process.argv[2] ?? "arm"
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null }
const guardScript = arg("--guard") ?? ""
const dir = arg("--dir") ?? "."
const rect: Box = (() => { const r = (arg("--rect") ?? "500,300,400,300").split(",").map(Number); return { x: r[0]!, y: r[1]!, width: r[2]!, height: r[3]! } })()

const paths: PenPaths = {
  userData: dir, state: path.join(dir, "pen-state.json"), trace: path.join(dir, "pen-trace.jsonl"),
  wintabJournal: path.join(dir, "wintab.journal.json"), leases: path.join(dir, "pen-leases.json"),
}
const say = (s: string): void => { process.stdout.write(`${s}\n`) }
const log = (l: string): void => { say(`LOG ${l}`) }

async function main(): Promise<void> {
  say(`APPPID ${process.pid}`)
  // Electron's own handles keep the real main process alive; a bare node process has only the guard (unref'd on purpose), so hold the loop open.
  setInterval(() => undefined, 1000)
  if (mode === "sweep") {
    const r = await sweepAtStart(paths, log, { execPath: process.execPath, guardScript })
    say(`SWEEP ${JSON.stringify(r)}`)
    say("DONE")
    process.exit(0)
  }

  const lease = createLease({ paths, execPath: process.execPath, guardScript, log, ...(mode === "silent" ? { beatMs: 3_600_000 } : {}) })
  const ok = await lease.start()
  say(`GUARDPID ${lease.pid() ?? 0}`)
  if (!ok) { say("NOGUARD"); process.exit(3) }

  if (mode === "contain") return containMode(lease)

  const armed = lease.armClip(rect, 800)
  say(armed ? "ARMED" : "REFUSED")
  if (mode === "hang") { setTimeout(() => { say("HANGING"); for (;;) { /* a frozen main process */ } }, 400); return }
  if (mode === "throw") { setTimeout(() => { throw new Error("proof: uncaught exception") }, 600); return }
  if (mode === "exit") { setTimeout(() => process.exit(0), 600); return }
  // arm / silent: stay alive; the proof drives us over stdin
  readline.createInterface({ input: process.stdin }).on("line", (l) => {
    const t = l.trim()
    if (t === "free") { lease.freeClip(); say("FREED") }
    if (t === "quit") { lease.dispose(); say("DONE"); setTimeout(() => process.exit(0), 100) }
  })
}

function containMode(lease: ReturnType<typeof createLease>): void {
  let metrics: () => void = () => undefined
  const sink: Sink = {
    setShown: () => undefined, setOn: () => undefined, state: () => ({ shown: false, on: false, bounds: null }),
    penEvents: () => 0, mouseEvents: () => 0, onPenSamples: () => () => undefined, dispose: () => undefined,
  }
  const caps = { driver: { state: "untested" as const, at: null, note: null }, sink: { state: "untested" as const, at: null, note: null }, clip: { state: "untested" as const, at: null, note: null } }
  const c = makeContainment({
    lease, paths, trace: { event: () => undefined, raw: () => undefined }, now: Date.now, window: () => null,
    display: { metricsChanged: (l) => { metrics = l; return () => undefined } },
    probe: { makeSystemBackend: () => { throw new Error("no tablet here") }, cursor: () => ({ x: 0, y: 0 }), onSamples: (_l: (b: PenSample[]) => void) => () => undefined },
    loadCapabilities: () => caps, saveCapability: () => undefined, pointerMode: () => "mouse", sink, log,
    displayKey: () => "proof",
  })
  let input: ContainmentUpdate = {
    sheet: { rect: { x: 10, y: 10, width: rect.width, height: rect.height }, turns: 0, aspect: rect.width / rect.height },
    sheetPhysical: rect, window: { focused: true, visible: true, minimized: false }, penInRange: true, lastPenAt: Date.now(),
    settings: { ...DEFAULT_SETTINGS, backends: { ...DEFAULT_SETTINGS.backends }, contain: "clip" }, active: null,
  }
  const status = (): void => { const s = c.status(); say(`STATE ${JSON.stringify({ mode: s.mode, armed: s.armed, last: s.lastRelease?.reason ?? null })}`) }
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    let cmd: { op?: string; patch?: Partial<ContainmentUpdate> & { settings?: Partial<ContainmentUpdate["settings"]> }; reason?: string }
    try { cmd = JSON.parse(line) } catch { return }
    switch (cmd.op) {
      case "update": {
        const { settings, ...rest } = cmd.patch ?? {}
        input = { ...input, ...rest, settings: { ...input.settings, ...(settings ?? {}) } as ContainmentUpdate["settings"], lastPenAt: Date.now() }
        c.update(input)
        status()
        break
      }
      case "panic": c.panic(cmd.reason ?? "panic"); status(); break
      case "metrics": metrics(); status(); break
      case "status": status(); break
      case "free": lease.freeClip(); say("FREED"); break
      case "dispose": c.dispose(); status(); break
      case "quit": c.dispose(); lease.dispose(); say("DONE"); setTimeout(() => process.exit(0), 100); break
    }
  })
  c.update(input)
  status()
}

void main().catch((e) => { say(`FATAL ${(e as Error).message}`); process.exit(2) })
