// Start and stop ISOLATED, OFFSCREEN WriteMind instances for the end-to-end tests.
//
// An instance is: the real built app (apps/desktop, run by the repo's own electron), its own --user-data-dir,
// its own notes folder (WRITEMIND_NOTES), a window opened at -32000,-32000 that never takes focus
// (WRITEMIND_OFFSCREEN=1), the test hooks (WRITEMIND_E2E=1) and the flags that stop Chromium from freezing an
// occluded window. It never touches the person's own WriteMind or their notes: everything lives in a temp dir.
//
// Processes are only ever stopped BY PID (the one this module spawned, and its children) or, as a safety net, by
// the unique temp profile folder they were started with. Never by image name.

import { spawn, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { targetsOf, sleep } from "./cdp.mjs"

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
export const appDir = path.join(repoRoot, "apps", "desktop")

/**
 * Copy the built app (package.json + out/) to `dest`, a folder INSIDE the repo so that node_modules still resolves,
 * and return it. Used when other people are rebuilding apps/desktop/out while a run is under way: the run then
 * tests one build from start to end. Retries if the build changed while it was being copied.
 */
const await_ = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
export function snapshotApp(dest) {
  const stamp = () => {
    const files = []
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p + ":" + fs.statSync(p).mtimeMs + ":" + fs.statSync(p).size) } }
    walk(path.join(appDir, "out"))
    return files.join("|")
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    let before
    try { before = stamp() } catch { await_(1500); continue }     // a build is in the middle of replacing out/
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    fs.copyFileSync(path.join(appDir, "package.json"), path.join(dest, "package.json"))
    fs.cpSync(path.join(appDir, "out"), path.join(dest, "out"), { recursive: true })
    try { if (stamp() === before) return dest } catch { /* changed under us */ }
    await_(1500)
  }
  throw new Error("the build keeps changing; could not take a consistent snapshot")
}

/** The electron binary of THIS repo (node_modules/electron/dist/electron.exe on Windows). */
export function electronPath() {
  const require = createRequire(path.join(repoRoot, "package.json"))
  return require("electron")
}

/** A port nobody is listening on. `preferred` is tried first (and waited for a few seconds if it is busy). */
export async function freePort(preferred) {
  const tryPort = (port) => new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(null))
    server.listen(port, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)) })
  })
  if (preferred) {
    for (let i = 0; i < 20; i++) { const p = await tryPort(preferred); if (p) return p; await sleep(500) }
    throw new Error(`port ${preferred} stays busy`)
  }
  return (await tryPort(0)) ?? Promise.reject(new Error("no free port"))
}

/** Stop a process and everything it started. By PID only. */
export function killTree(pid) {
  if (!pid) return
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
  else { try { process.kill(-pid, "SIGKILL") } catch { try { process.kill(pid, "SIGKILL") } catch { /* gone */ } } }
}

/** Is a pid still alive? */
export function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * Safety net: electron processes whose command line mentions this exact profile folder (a unique temp dir).
 * Returns their pids; with kill = true also stops them. Windows only (elsewhere the pid tree is enough).
 */
export function sweep(profileDir, kill = false) {
  if (process.platform !== "win32" || !profileDir) return []
  const needle = profileDir.replace(/'/g, "''")
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*${needle}*' } | ForEach-Object { $_.ProcessId }`
  const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" })
  const pids = String(out.stdout || "").split(/\s+/).map(Number).filter(Boolean)
  if (kill) for (const pid of pids) killTree(pid)
  return pids
}

/**
 * Start an instance.
 * @param {object} o
 * @param {string} o.dir       a folder to keep the instance's profile, notes and logs in (created)
 * @param {number} [o.port]    remote debugging port (default: any free one)
 * @param {string} [o.video]   a .y4m file the fake capture device plays as the camera
 * @param {boolean} [o.e2e]    WRITEMIND_E2E=1 (default true)
 * @param {string[]} [o.args]  extra command line arguments
 * @param {object} [o.env]     extra environment variables
 * @param {boolean} [o.visible] open a normal visible window (default: offscreen)
 * @param {string} [o.appDir]  run this copy of the app instead of apps/desktop (see snapshotApp)
 */
export async function startInstance(o) {
  const dir = path.resolve(o.dir)
  const profile = path.join(dir, "profile")
  const notes = o.notes ? path.resolve(o.notes) : path.join(dir, "notes")
  fs.mkdirSync(profile, { recursive: true })
  fs.mkdirSync(notes, { recursive: true })
  const port = await freePort(o.port)
  const env = { ...process.env, ...o.env, WRITEMIND_NOTES: notes }
  delete env.ELECTRON_RUN_AS_NODE            // would turn electron into plain node
  delete env.WRITEMIND_DEV
  if (!o.visible) env.WRITEMIND_OFFSCREEN = "1"; else delete env.WRITEMIND_OFFSCREEN
  if (o.e2e !== false) env.WRITEMIND_E2E = "1"; else delete env.WRITEMIND_E2E
  const args = [
    o.appDir ? path.resolve(o.appDir) : appDir,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    // The occlusion flags: an offscreen window must keep painting, or CodeMirror's layers go stale.
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    ...(o.video ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${o.video}`] : []),
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ...(process.env.WM_E2E_ARGS ? process.env.WM_E2E_ARGS.split(/\s+/).filter(Boolean) : []),
    ...(o.args ?? []),
  ]
  const logFile = path.join(dir, "electron.log")
  const log = fs.openSync(logFile, "a")
  const child = spawn(electronPath(), args, { cwd: repoRoot, env, stdio: ["ignore", log, log], detached: process.platform !== "win32" })
  child.unref()
  fs.closeSync(log)
  const inst = { pid: child.pid, port, dir, profile, notes, logFile, appDir: o.appDir ?? null, video: o.video ?? null, e2e: o.e2e !== false, args: o.args ?? [], visible: !!o.visible, env: o.env ?? {} }
  fs.writeFileSync(path.join(dir, "instance.json"), JSON.stringify(inst, null, 2))
  let exited = null
  child.on("exit", (code) => { exited = code })
  // Ready = the debugging port lists a page whose app (window.wm) is loaded.
  const end = Date.now() + (o.timeoutMs ?? 40000)
  while (Date.now() < end) {
    if (exited !== null) throw new Error(`electron exited with ${exited} before it was ready; see ${logFile}`)
    try {
      const pages = (await targetsOf(port)).filter((t) => t.type === "page")
      if (pages.length) return inst
    } catch { /* not listening yet */ }
    await sleep(300)
  }
  killTree(child.pid)
  throw new Error(`instance did not come up on port ${port} in time; see ${logFile}`)
}

/** Stop an instance and make sure nothing of it is left. */
export async function stopInstance(inst) {
  if (!inst) return
  killTree(inst.pid)
  for (let i = 0; i < 20 && alive(inst.pid); i++) await sleep(150)
  sweep(inst.profile, true)
}

/** Read the instance a runner started for this script (the runner exports WM_INSTANCE_DIR). */
export function readInstance(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "instance.json"), "utf8"))
}

/** Restart the instance in `dir` with the SAME profile and notes (an app restart, as the person would do). */
export async function restartInstance(dir, overrides = {}) {
  const old = readInstance(dir)
  await stopInstance(old)
  await sleep(500)
  return startInstance({
    dir: old.dir, notes: old.notes, port: old.port, video: old.video, e2e: old.e2e, appDir: old.appDir ?? undefined, args: old.args, env: old.env, visible: old.visible, ...overrides,
  })
}

export function makeTempDir(prefix = "wm-e2e-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}
