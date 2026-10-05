// REAL-API PROOF that WriteMind can never leave the cursor confined (docs/spikes/DESIGN-pen-capture.md 7.5, 14).
//
//   node apps/desktop/scripts/pen-guard-proof.mjs [--quick] [--only <substring>]
//
// This script is the SECOND PROCESS: it only reads GetClipCursor (its own four lines of koffi, deliberately not clip.ts) and watches how long
// a real ClipCursor rectangle survives the death, hang, crash or release of the "app" it runs. The app is a separate process
// (scripts/penProofApp.ts, bundled here with esbuild) that uses the REAL lease.ts, sweep.ts and containment.ts and spawns the REAL
// guard process (src/main/pen/guard.ts). No tablet, no Electron window. It moves nothing and injects nothing; it does clip the
// real mouse to a 400 x 300 rectangle for well under a second per scenario, and ends by releasing any clip (a final
// ClipCursor(NULL) from this process if, and only if, the clip is still one of ours), then checks with GetClipCursor and
// with an independent PowerShell process.
//
// Prints PASS / FAIL / INFO lines; exit code 0 = every scenario passed.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = path.dirname(fileURLToPath(import.meta.url))
const desktop = path.resolve(here, "..")
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null
const quick = args.includes("--quick")

if (process.platform !== "win32") { console.log("SKIP not Windows"); process.exit(0) }

// ---------------------------------------------------------------------------------------------------------------
// The independent observer (this process): GetClipCursor / ClipCursor / GetSystemMetrics, nothing from the app's code.
// ---------------------------------------------------------------------------------------------------------------
const koffi = require("koffi")
const user32 = koffi.load("user32.dll")
try { user32.func("bool __stdcall SetProcessDpiAwarenessContext(intptr_t v)")(-4) } catch { /* already aware */ }
koffi.struct("WMPROOF_RECT", { left: "int32", top: "int32", right: "int32", bottom: "int32" })
const clipCursor = user32.func("bool __stdcall ClipCursor(WMPROOF_RECT *r)")
const getClipCursor = user32.func("bool __stdcall GetClipCursor(_Out_ WMPROOF_RECT *r)")
const metric = user32.func("int __stdcall GetSystemMetrics(int i)")
const getClip = () => { const r = {}; getClipCursor(r); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
const SCREEN = (() => { const x = metric(76), y = metric(77); return { left: x, top: y, right: x + metric(78), bottom: y + metric(79) } })()
const same = (a, b) => !!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
const RECT = { left: 500, top: 300, right: 900, bottom: 600 }
const free = () => same(getClip(), SCREEN)
const armed = () => same(getClip(), RECT)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitUntil(fn, ms, step = 5) { const t = performance.now(); while (performance.now() - t < ms) { if (fn()) return Math.round(performance.now() - t); await sleep(step) } return -1 }

let fails = 0
let passes = 0
const pass = (name, ok, extra = "") => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`) }
const info = (s) => console.log(`INFO ${s}`)

// ---------------------------------------------------------------------------------------------------------------
// Build the app and the guard from the repo's own sources
// ---------------------------------------------------------------------------------------------------------------
const outDir = path.join(desktop, "out", "pen-proof")
fs.mkdirSync(outDir, { recursive: true })
const common = { bundle: true, platform: "node", target: "node20", format: "esm", logLevel: "warning", external: ["electron", "koffi"], sourcemap: false }
await build({ ...common, entryPoints: [path.join(desktop, "scripts", "penProofApp.ts")], outfile: path.join(outDir, "app.mjs") })
await build({ ...common, entryPoints: [path.join(desktop, "src", "main", "pen", "guard.ts")], outfile: path.join(outDir, "pen-guard.mjs") })
const APP = path.join(outDir, "app.mjs")
const GUARD = path.join(outDir, "pen-guard.mjs")
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-pen-proof-"))

const spawned = new Set()
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" } }
const kill = (pid) => { try { process.kill(pid) } catch { /* gone */ } } // Windows: TerminateProcess == kill -9

/** Start the stand-in app. Returns helpers; every pid it learns about is remembered so that cleanup can end exactly those. */
function startApp(mode, extra = [], opts = {}) {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(workDir, "run-"))
  const p = spawn(process.execPath, [APP, mode, "--guard", GUARD, "--dir", dir, ...extra], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
  spawned.add(p.pid)
  const lines = []
  readline.createInterface({ input: p.stdout }).on("line", (l) => { lines.push(l); const m = /^GUARDPID (\d+)/.exec(l); if (m) spawned.add(Number(m[1])) })
  const find = (re) => { for (const l of lines) { const m = re.exec(l); if (m) return m } return null }
  const send = (o) => { try { p.stdin.write(typeof o === "string" ? o + "\n" : JSON.stringify(o) + "\n") } catch { /* gone */ } }
  return { p, dir, lines, find, send, guardPid: () => Number((find(/^GUARDPID (\d+)/) ?? [])[1] ?? 0), journal: path.join(dir, "pen-leases.json") }
}

async function cleanup(...apps) {
  for (const h of apps) { if (!h) continue; kill(h.p.pid); const g = h.guardPid(); if (g) kill(g) }
  await sleep(60)
  if (!free()) { const c = getClip(); if (same(c, RECT)) clipCursor(null) } // ours (the exact proof rectangle) and nothing else
}

/** Wait for the app's clip to appear, and say so: a scenario that never armed proves nothing. */
async function armedFirst(label, h, ms = 6000) {
  const t = await waitUntil(armed, ms)
  pass(`${label}: the app armed a real clip first`, t >= 0, t >= 0 ? `${t} ms` : `never; app said: ${h.lines.slice(-5).join(" | ")}`)
  return t >= 0
}

class NotArmed extends Error {}
/** One scenario: a failure (or a scenario that could not even arm) is reported and the next scenario still runs. */
async function guarded(fn) {
  try { await fn() } catch (e) { if (!(e instanceof NotArmed)) { fails++; console.log(`FAIL a scenario threw: ${e && e.stack ? e.stack.split(String.fromCharCode(10)).slice(0, 3).join(" | ") : e}`) } }
}

const want = (name) => !only || name.toLowerCase().includes(only.toLowerCase())

try {
  if (!free()) {
    console.log(`SKIP the cursor is already clipped to ${JSON.stringify(getClip())} by something else; this proof only runs from a free cursor`)
    process.exit(0)
  }
  console.log(`INFO screen ${JSON.stringify(SCREEN)}, node ${process.version}, observer pid ${process.pid}`)

  // K0 the guard as the app really runs it: electron.exe in node mode ----------------------------------------------------
  if (want("K0")) await guarded(async () => {
    const electron = path.resolve(desktop, "..", "..", "node_modules", "electron", "dist", "electron.exe")
    if (!fs.existsSync(electron)) info("K0 skipped: no electron.exe in node_modules")
    else {
      const g = spawn(electron, [GUARD, "--journal", path.join(workDir, "k0.json"), "--app-pid", String(process.pid)], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
      spawned.add(g.pid)
      const out = []
      readline.createInterface({ input: g.stdout }).on("line", (l) => out.push(l))
      const ready = await waitUntil(() => out.includes("ready"), 6000)
      pass("K0 the guard runs as electron.exe with ELECTRON_RUN_AS_NODE=1 and says ready", ready >= 0, `${ready} ms`)
      await waitUntil(() => out.some((l) => l.startsWith("keyapi")), 1000)
      pass("K0 the guard's panic-chord poll (GetAsyncKeyState) answers on this machine", out.includes("keyapi ok"), out.join(" | "))
      g.stdin.write("arm 500 300 900 600 800\n")
      const a = await waitUntil(armed, 3000)
      pass("K0 it arms the real clip", a >= 0, `${a} ms`)
      kill(g.pid) // kill -9 the guard itself: the clip would persist (the residual trap), so release it from here
      await sleep(100)
      info(`K0 after the guard itself was killed the clip is ${free() ? "released" : "STILL SET (the known residual: the app notices, see K5)"}`)
      clipCursor(null)
      pass("K0 clean", free())
    }
  })

  // K1 steady state: the heartbeat keeps a clip alive for several leases, `free` releases it -------------------------------------
  if (want("K1")) await guarded(async () => {
    const h = startApp("arm")
    try {
      if (!(await armedFirst("K1", h))) throw new NotArmed()
      await sleep(quick ? 1700 : 2600)
      pass("K1 still armed after 3 lease periods (the heartbeat renews it)", armed())
      pass("K1 the journal names the clip, the app and the guard", (() => { try { const j = JSON.parse(fs.readFileSync(h.journal, "utf8")); return j.appPid === h.p.pid && j.guardPid === h.guardPid() && j.clip?.left === 500 } catch { return false } })())
      h.send("free")
      const f = await waitUntil(free, 2000)
      pass("K1 freeClip releases it", f >= 0, `${f} ms`)
      await sleep(150)
      pass("K1 the journal is gone once nothing is held", !fs.existsSync(h.journal))
    } finally { await cleanup(h) }
  })

  // K2 kill -9 of the app ---------------------------------------------------------------------------------------------------
  if (want("K2")) await guarded(async () => {
    for (let i = 0; i < (quick ? 1 : 3); i++) {
      const h = startApp("arm")
      try {
        if (!(await armedFirst(`K2.${i + 1}`, h))) continue
        const g = h.guardPid()
        const t0 = performance.now()
        kill(h.p.pid)
        const ms = await waitUntil(free, 5000)
        pass(`K2.${i + 1} app killed (TerminateProcess): the cursor is free`, ms >= 0, `${ms} ms after the kill, GetClipCursor from a second process now ${JSON.stringify(getClip())}`)
        await sleep(300)
        pass(`K2.${i + 1} the guard noticed the EOF and exited too`, !alive(g))
        void t0
      } finally { await cleanup(h) }
    }
  })

  // K3 the app is HUNG (event loop blocked for ever): the lease expires ----------------------------------------------------------
  if (want("K3")) await guarded(async () => {
    const h = startApp("hang")
    try {
      if (!(await armedFirst("K3", h))) throw new NotArmed()
      const ms = await waitUntil(free, 6000)
      pass("K3 a hung app: the lease expires and the cursor is free", ms >= 0 && ms < 2500, `released ${ms} ms after it was seen armed (lease 800 ms, app armed ~400 ms before it hung)`)
      pass("K3 the guard is still there, idle", alive(h.guardPid()))
    } finally { await cleanup(h) }
  })

  // K4 the app is alive but never renews the lease --------------------------------------------------------------------------
  if (want("K4")) await guarded(async () => {
    const h = startApp("silent")
    try {
      if (!(await armedFirst("K4", h))) throw new NotArmed()
      const ms = await waitUntil(free, 4000)
      pass("K4 no heartbeat: the lease expires", ms >= 0 && ms < 1800, `${ms} ms`)
    } finally { await cleanup(h) }
  })

  // K5 the GUARD dies while the app lives: the app releases the clip itself, at once ----------------------------------------------
  if (want("K5")) await guarded(async () => {
    const h = startApp("arm")
    try {
      if (!(await armedFirst("K5", h))) throw new NotArmed()
      kill(h.guardPid())
      const ms = await waitUntil(free, 3000)
      pass("K5 guard killed: the app releases the clip itself", ms >= 0 && ms < 1000, `${ms} ms`)
      await sleep(200)
      pass("K5 the app logged it", h.lines.some((l) => /guard gone/.test(l)))
    } finally { await cleanup(h) }
  })

  // K6 uncaught exception, K7 process.exit ------------------------------------------------------------------------------------
  for (const [name, mode] of [["K6", "throw"], ["K7", "exit"]]) {
    if (!want(name)) continue
    await guarded(async () => {
      const h = startApp(mode)
      try {
        if (!(await armedFirst(name, h))) throw new NotArmed()
        const ms = await waitUntil(free, 4000)
        pass(`${name} ${mode === "throw" ? "an uncaught exception that kills the app" : "the app exiting"}: the cursor is free`, ms >= 0, `${ms} ms after armed`)
      } finally { await cleanup(h) }
    })
  }

  // K8 BOTH die: what survives, and the startup sweep ---------------------------------------------------------------------------
  if (want("K8")) await guarded(async () => {
    // natural attempt: end the app and its guard with one command, then let the REAL sweep (a new launch) deal with what is left
    const h = startApp("arm")
    try {
      if (!(await armedFirst("K8", h))) throw new NotArmed()
      const g = h.guardPid()
      spawnSync("taskkill", ["/F", "/PID", String(h.p.pid), "/PID", String(g)], { windowsHide: true })
      await sleep(400)
      const persisted = !free()
      info(`K8 app and guard ended together by one taskkill: the clip ${persisted ? "PERSISTED (the trap)" : "was released anyway (the guard won the race)"}`)
      const journalLeft = fs.existsSync(h.journal)
      if (persisted) {
        pass("K8 the guard's journal survived to say what was left behind", journalLeft)
        const s0 = startApp("sweep", [], { dir: h.dir })
        const done0 = await waitUntil(() => s0.find(/^DONE/), 8000, 20)
        pass("K8 the next launch's sweep, from the guard's own journal, frees the cursor", done0 >= 0 && free(), `${done0} ms; ${s0.find(/^SWEEP (.*)/)?.[1] ?? "no result"}`)
        await cleanup(s0)
      } else pass("K8 nothing was left behind", free())
    } finally { await cleanup(h) }

    // deterministic version of the trap: a persisted clip and a journal naming two dead pids
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" })
    const deadPid = Number(dead.stdout)
    const dir = fs.mkdtempSync(path.join(workDir, "trap-"))
    const journal = path.join(dir, "pen-leases.json")
    fs.writeFileSync(journal, JSON.stringify({ guardPid: deadPid, appPid: deadPid, clip: RECT, wintab: [], at: Date.now() }))
    clipCursor(RECT)
    pass("K8 the trap is set: the clip persists with its owners dead", armed())
    const s = startApp("sweep", [], { dir })
    const done = await waitUntil(() => s.find(/^DONE/), 8000, 20)
    pass("K8 the startup sweep releases the clip it left behind", done >= 0 && free(), `${done} ms; ${s.find(/^SWEEP (.*)/)?.[1] ?? "no result"}`)
    pass("K8 and deletes the journal", !fs.existsSync(journal))
    await cleanup(s)

    // a FOREIGN clip (a game) must be left alone by the sweep
    const foreign = { left: 100, top: 100, right: 700, bottom: 500 }
    fs.writeFileSync(journal, JSON.stringify({ guardPid: deadPid, appPid: deadPid, clip: RECT, wintab: [], at: Date.now() }))
    clipCursor(foreign)
    const s2 = startApp("sweep", [], { dir })
    await waitUntil(() => s2.find(/^DONE/), 8000, 20)
    pass("K8 a clip that is NOT the journalled rectangle (a game's) is left alone", same(getClip(), foreign), JSON.stringify(getClip()))
    clipCursor(null)
    await cleanup(s2)
    fs.rmSync(journal, { force: true })

    // a LIVE owner's journal is not the sweep's to undo
    fs.writeFileSync(journal, JSON.stringify({ guardPid: process.pid, appPid: process.pid, clip: RECT, wintab: [], at: Date.now() }))
    clipCursor(RECT)
    const s3 = startApp("sweep", [], { dir })
    await waitUntil(() => s3.find(/^DONE/), 8000, 20)
    pass("K8 a journal whose owner is still alive is not touched", armed())
    clipCursor(null)
    await cleanup(s3)
    fs.rmSync(journal, { force: true })
  })

  // K9 a foreign clip: the app does not fight it ------------------------------------------------------------------------------------
  if (want("K9")) await guarded(async () => {
    const foreign = { left: 100, top: 100, right: 700, bottom: 500 }
    clipCursor(foreign)
    const h = startApp("arm")
    try {
      await waitUntil(() => h.find(/^(ARMED|REFUSED)/), 6000, 20)
      pass("K9 the app refuses to arm over another program's clip", !!h.find(/^REFUSED/) && same(getClip(), foreign), JSON.stringify(getClip()))
      await sleep(300)
      pass("K9 and leaves it alone", same(getClip(), foreign))
    } finally { clipCursor(null); await cleanup(h) }
  })

  // K10 the policy on the real lease: every release trigger frees the real clip -----------------------------------------------------
  const triggers = [
    ["blur (another window in front)", { op: "update", patch: { window: { focused: false, visible: true, minimized: false } } }],
    ["minimised", { op: "update", patch: { window: { focused: false, visible: true, minimized: true } } }],
    ["hidden", { op: "update", patch: { window: { focused: true, visible: false, minimized: false } } }],
    ["Grab / capture turned off", { op: "update", patch: { settings: { enabled: false } } }],
    ["containment set to none", { op: "update", patch: { settings: { contain: "none" } } }],
    ["pen out of range", { op: "update", patch: { penInRange: false } }],
    ["the Tablet sheet closed", { op: "update", patch: { sheet: null, sheetPhysical: null } }],
    ["display changed", { op: "metrics" }],
    ["Esc (panic)", { op: "panic", reason: "esc" }],
    ["Ctrl+Alt+G (panic)", { op: "panic", reason: "panic" }],
    ["quit (dispose)", { op: "dispose" }],
  ]
  for (const [label, cmd] of triggers) {
    if (!want("K10")) break
    await guarded(async () => {
      const h = startApp("contain")
      try {
        if (!(await armedFirst(`K10 ${label}`, h))) throw new NotArmed()
        h.send(cmd)
        const ms = await waitUntil(free, 3000)
        pass(`K10 ${label}: the policy frees the real clip`, ms >= 0 && ms < 1500, `${ms} ms`)
        await sleep(250)
        pass(`K10 ${label}: and does not re-arm`, free())
      } finally { await cleanup(h) }
    })
  }

  // K11 the policy's app killed while armed --------------------------------------------------------------------------------------------
  if (want("K11")) await guarded(async () => {
    const h = startApp("contain")
    try {
      if (!(await armedFirst("K11", h))) throw new NotArmed()
      kill(h.p.pid)
      const ms = await waitUntil(free, 3000)
      pass("K11 the policy armed, the app killed -9: the cursor is free", ms >= 0, `${ms} ms`)
    } finally { await cleanup(h) }
  })

} finally {
  if (!free()) { const c = getClip(); if (same(c, RECT)) clipCursor(null) }
  for (const pid of spawned) if (alive(pid)) kill(pid)
  await sleep(150)
  const freeNow = free()
  // an independent third process
  let ps = "?"
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class C{[StructLayout(LayoutKind.Sequential)]public struct R{public int l,t,r,b;}[DllImport(\"user32.dll\")]public static extern bool GetClipCursor(out R r);}'; $r=New-Object C+R; [void][C]::GetClipCursor([ref]$r); \"$($r.l),$($r.t),$($r.r),$($r.b)\""], { encoding: "utf8", windowsHide: true })
    ps = r.stdout.trim()
  } catch { /* optional */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* temp */ }
  const psFree = ps === `${SCREEN.left},${SCREEN.top},${SCREEN.right},${SCREEN.bottom}`
  console.log(`FINAL cursor free (koffi): ${freeNow}; (independent PowerShell process): ${psFree} [${ps}]; leftover processes: ${[...spawned].filter(alive).length}; passes ${passes}, failures ${fails}`)
  process.exitCode = !freeNow || !psFree || fails ? 1 : 0
}
