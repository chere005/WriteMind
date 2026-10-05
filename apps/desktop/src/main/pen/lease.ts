/**
 * lease.ts - the app's side of the guard process (docs/spikes/DESIGN-pen-capture.md 7.5, 14.2).
 *
 * The guard (guard.ts, a DETACHED process) is the real owner of a ClipCursor rectangle and the safety net for Wintab
 * contexts. This file spawns it lazily (at the first pen:open, not at every app start), speaks its one-line protocol
 * (clip.ts), keeps the lease alive with a heartbeat while anything is held, and turns its event lines into callbacks.
 * Fail closed: no guard, no clip and no system context (the caller closes a system context that could not be held).
 *
 * What makes it impossible to leave the cursor confined from here:
 *   - the heartbeat runs on a timer of this module, so a HUNG main process stops beating and the guard lets go (800 ms);
 *   - a DEAD main process closes the pipe and the guard lets go (EOF, ~14 ms measured);
 *   - a dead GUARD while a clip is armed makes this module release the clip itself, at once, if it is still ours;
 *   - `dispose()` (every exit path calls it) frees the clip, tells the guard to quit, and a `process.on("exit")` belt
 *     frees a still-ours clip synchronously even if dispose never ran.
 * The only ClipCursor call in this file is the NULL one (release); arming a rectangle happens in the guard.
 */

import { spawn as nodeSpawn } from "node:child_process"
import readline from "node:readline"
import type { Box } from "../../shared/pen"
import {
  DEFAULT_BEAT_MS, encodeGuardCommand, parseGuardEvent, rectsEqual, toBox, toRect, validateClipRect, win32Clip,
  type GuardEvent, type Rect, type Win32Clip, type WintabMode,
} from "./clip"
import { sweepPending } from "./sweep"
import type { Lease, LeaseOptions } from "./types"

/** What the lease needs of the guard process (node's ChildProcess is adapted to it; tests fake it). */
export interface GuardChild {
  pid: number | undefined
  write(line: string): void
  onLine(fn: (line: string) => void): void
  onExit(fn: (code: number | null) => void): void
  kill(): void
}

export type SpawnGuard = (execPath: string, args: string[], env: NodeJS.ProcessEnv) => GuardChild

export type LostReason = "lease" | "guard-lost"

/** Extra, optional surface (the Lease interface is the contract; containment looks for these with a feature test). */
export interface LeaseExtras {
  /** The guard saw Ctrl+Alt+G and released everything by itself. */
  onPanicKey(listener: () => void): () => void
  /** The guard refused an arm (a foreign clip, a bad rectangle). */
  onRefused(listener: (why: string) => void): () => void
  /** The guard closed a Wintab handle we had registered (lease expiry, panic chord, ...). */
  onWintabClosed(listener: (handle: string, why: string) => void): () => void
  /** Held-state, for tests and diagnostics. */
  held(): { clip: Rect | null; wintab: string[] }
}

export interface LeaseHooks {
  spawn?: SpawnGuard
  /** The app-side ClipCursor belt. undefined = the real one on Windows; null = none. */
  clip?: Win32Clip | null
  now?: () => number
  /** Schedule a repeating tick; returns a cancel function. */
  every?: (ms: number, fn: () => void) => () => void
  readyTimeoutMs?: number
  beatMs?: number
  appPid?: number
  /** Register the process-exit belt (default true). Tests that make many leases turn it off. */
  exitBelt?: boolean
}

export type PenLease = Lease & LeaseExtras

const defaultEvery = (ms: number, fn: () => void): (() => void) => {
  const t = setInterval(fn, ms)
  t.unref()
  return () => clearInterval(t)
}

/** Adapts node's ChildProcess: detached, no console, stdout lines, and unref'd so the app can quit independently. */
export function realSpawn(execPath: string, args: string[], env: NodeJS.ProcessEnv): GuardChild {
  const child = nodeSpawn(execPath, args, {
    detached: true, // mandatory: a non-detached child is killed with its parent by libuv's job object (measured)
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
    env,
  })
  const lines: ((l: string) => void)[] = []
  const exits: ((c: number | null) => void)[] = []
  if (child.stdout) readline.createInterface({ input: child.stdout }).on("line", (l) => { for (const f of lines) f(l) })
  child.stdin?.on("error", () => { /* the guard is gone; the exit event says so */ })
  child.on("error", () => { for (const f of exits) f(null) })
  child.on("exit", (code) => { for (const f of exits) f(code) })
  child.unref()
  ;(child.stdin as unknown as { unref?: () => void } | null)?.unref?.()
  ;(child.stdout as unknown as { unref?: () => void } | null)?.unref?.()
  return {
    pid: child.pid,
    write: (l) => { if (child.stdin && !child.stdin.destroyed) child.stdin.write(l) },
    onLine: (f) => { lines.push(f) },
    onExit: (f) => { exits.push(f) },
    kill: () => { try { child.kill() } catch { /* gone */ } },
  }
}

export function createLease(options: LeaseOptions & LeaseHooks): PenLease {
  const now = options.now ?? Date.now
  const every = options.every ?? defaultEvery
  const spawn = options.spawn ?? realSpawn
  const beatMs = options.beatMs ?? DEFAULT_BEAT_MS
  const appPid = options.appPid ?? process.pid
  const log = (s: string): void => { try { options.log(`lease: ${s}`) } catch { /* logging never throws */ } }

  let state: "none" | "starting" | "ready" | "lost" = "none"
  let child: GuardChild | null = null
  let childDead = false
  let starting: Promise<boolean> | null = null
  let armed: Rect | null = null
  const wintab = new Map<string, WintabMode>()
  let stopBeat: (() => void) | null = null
  const lostListeners = new Set<(why: LostReason) => void>()
  const panicListeners = new Set<() => void>()
  const refusedListeners = new Set<(why: string) => void>()
  const closedListeners = new Set<(handle: string, why: string) => void>()
  let clipPort: Win32Clip | null | undefined = options.clip
  let clipLoadError: string | null = null
  let exitBelt: (() => void) | null = null
  let disposed = false

  function clipApi(): Win32Clip | null {
    if (clipPort !== undefined) return clipPort
    try { clipPort = win32Clip() } catch (e) { clipPort = null; clipLoadError = (e as Error).message }
    return clipPort
  }

  const emitLost = (why: LostReason): void => { for (const l of [...lostListeners]) { try { l(why) } catch (e) { log(`listener threw ${(e as Error).message}`) } } }
  const send = (c: Parameters<typeof encodeGuardCommand>[0]): boolean => {
    if (!child || childDead) return false
    try { child.write(encodeGuardCommand(c)); return true } catch (e) { log(`write failed: ${(e as Error).message}`); return false }
  }
  const anyHeld = (): boolean => armed !== null || wintab.size > 0

  function syncBeat(): void {
    if (anyHeld() && !stopBeat && state === "ready") stopBeat = every(beatMs, () => { if (!send({ cmd: "beat" })) syncBeat() })
    else if ((!anyHeld() || state !== "ready") && stopBeat) { stopBeat(); stopBeat = null }
  }

  /** Release the clip from THIS process, only if it is still the rectangle we armed. */
  function beltRelease(): boolean {
    const r = armed
    if (!r) return false
    armed = null
    const api = clipApi()
    try {
      if (api && rectsEqual(api.getClip(), r)) { api.setClip(null); return true }
    } catch (e) { log(`belt release failed: ${(e as Error).message}`) }
    return false
  }

  function onEvent(e: GuardEvent): void {
    switch (e.ev) {
      case "armed": break // confirmation; `armed` was set when the command was sent
      case "freed": case "foreign": if (e.ev === "foreign" && e.why.startsWith("arm")) { armed = null; syncBeat(); for (const l of [...refusedListeners]) l("foreign-clip") } break
      case "expired": armed = null; syncBeat(); emitLost("lease"); break
      case "panic-key": armed = null; for (const l of [...panicListeners]) { try { l() } catch { /* a listener must not break the guard channel */ } } break
      case "closed-wintab": {
        const had = wintab.delete(e.handle)
        syncBeat()
        if (had) for (const l of [...closedListeners]) { try { l(e.handle, e.why) } catch { /* ditto */ } }
        break
      }
      case "err":
        log(`guard error: ${e.message}`)
        if (e.message === "bad-rect" || e.message === "clip-failed") { armed = null; syncBeat(); for (const l of [...refusedListeners]) l(e.message) }
        break
      default: break
    }
  }

  function onChildGone(): void {
    if (childDead) return
    childDead = true
    const wasReady = state === "ready"
    const hadClip = armed !== null
    const released = beltRelease() // the OS keeps a clip when its owner dies: undo it ourselves, right now
    if (stopBeat) { stopBeat(); stopBeat = null }
    if (state !== "none") state = "lost"
    log(`guard gone (was ${wasReady ? "ready" : state}); clip ${hadClip ? (released ? "released by the app" : "was no longer ours") : "not held"}`)
    if (wasReady && !disposed) emitLost("guard-lost")
  }

  const installExitBelt = (): void => {
    if (exitBelt || options.exitBelt === false) return
    const h = (): void => { beltRelease() }
    process.on("exit", h)
    exitBelt = () => { process.removeListener("exit", h) }
  }

  const api: PenLease = {
    ready: () => state === "ready" && !childDead,
    state: () => state,
    pid: () => (child && !childDead ? child.pid ?? null : null),
    held: () => ({ clip: armed, wintab: [...wintab.keys()] }),

    start() {
      if (disposed) return Promise.resolve(false)
      if (state === "ready" && !childDead) return Promise.resolve(true)
      if (starting) return starting
      state = "starting"
      // The guard never arms before the startup sweep has finished undoing an earlier run's leftovers.
      const sweeping = sweepPending()
      const begin = (): Promise<boolean> => new Promise<boolean>((resolve) => {
        let settled = false
        const settle = (ok: boolean): void => { if (settled) return; settled = true; clearTimeout(timer); resolve(ok) }
        const timer = setTimeout(() => {
          log("guard did not say ready in time")
          if (child) child.kill()
          childDead = true
          state = "lost"
          settle(false)
        }, options.readyTimeoutMs ?? 3000)
        timer.unref()
        try {
          childDead = false
          child = spawn(options.execPath, [options.guardScript, "--journal", options.paths.leases, "--app-pid", String(appPid)], { ...process.env, ELECTRON_RUN_AS_NODE: "1" })
        } catch (e) {
          log(`could not start the guard: ${(e as Error).message}`)
          childDead = true
          state = "lost"
          settle(false)
          return
        }
        child.onLine((line) => {
          const ev = parseGuardEvent(line)
          if (!ev) return
          if (ev.ev === "ready" && state === "starting") { state = "ready"; installExitBelt(); syncBeat(); settle(true); return }
          onEvent(ev)
        })
        child.onExit(() => {
          if (state === "starting") { childDead = true; state = "lost"; log("guard exited before it was ready"); settle(false); return }
          onChildGone()
        })
      })
      // `settle()` can run synchronously (the spawn threw), so `starting` is assigned before the promise settles and cleared from the promise.
      const run = sweeping ? sweeping.then(() => begin(), () => begin()) : begin()
      starting = run
      void run.finally(() => { if (starting === run) starting = null })
      return run
    },

    // ---- LeaseApi: Wintab holds
    holdWintab(handle, mode) {
      if (!api.ready()) return false
      if (!send({ cmd: "hold-wintab", handle, appPid, mode })) return false
      wintab.set(handle, mode)
      syncBeat()
      return true
    },
    dropWintab(handle) {
      if (wintab.delete(handle)) send({ cmd: "drop-wintab", handle })
      syncBeat()
    },

    // ---- clip
    armClip(rect: Box, leaseMs) {
      if (!api.ready()) return false
      const os = clipApi()
      if (!os) { log(`no ClipCursor access${clipLoadError ? `: ${clipLoadError}` : ""}`); return false }
      let screen: Rect
      let cur: Rect
      try { screen = os.screen(); cur = os.getClip() } catch (e) { log(`cannot read the clip: ${(e as Error).message}`); return false }
      const v = validateClipRect(toRect(rect), screen)
      if (!v.ok) { log(`clip refused: ${v.reason}`); return false }
      // Never fight another program's clip: only arm over "no clip" or over our own previous rectangle.
      if (!rectsEqual(cur, screen) && !(armed && rectsEqual(cur, armed))) { log("clip refused: foreign-clip"); return false }
      if (!send({ cmd: "arm", rect: v.rect, leaseMs })) return false
      armed = v.rect
      syncBeat()
      return true
    },
    beat() { send({ cmd: "beat" }) },
    freeClip() {
      const r = armed
      if (r) send({ cmd: "free" })
      beltRelease() // idempotent; only if still ours
      armed = null
      syncBeat()
    },
    currentClip() {
      const os = clipApi()
      try { return os ? toBox(os.getClip()) : { x: 0, y: 0, width: 0, height: 0 } } catch { return { x: 0, y: 0, width: 0, height: 0 } }
    },

    onLost(listener) { lostListeners.add(listener); return () => { lostListeners.delete(listener) } },
    onPanicKey(listener) { panicListeners.add(listener); return () => { panicListeners.delete(listener) } },
    onRefused(listener) { refusedListeners.add(listener); return () => { refusedListeners.delete(listener) } },
    onWintabClosed(listener) { closedListeners.add(listener); return () => { closedListeners.delete(listener) } },

    dispose() {
      if (disposed) return
      disposed = true
      api.freeClip()
      if (stopBeat) { stopBeat(); stopBeat = null }
      if (child && !childDead) { send({ cmd: "quit" }); const c = child; setTimeout(() => c.kill(), 500).unref() }
      wintab.clear()
      state = "none"
      if (exitBelt) { exitBelt(); exitBelt = null }
    },
  }
  return api
}
