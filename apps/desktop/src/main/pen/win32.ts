/**
 * win32.ts - the one koffi loader of the native pen stack (docs/spikes/DESIGN-pen-capture.md 12.1, IMPL-A).
 *
 * koffi may fail to load (a missing prebuilt, a packaged build without it, not Windows, 32-bit): `loadWin32()` then
 * returns `{ error }` and every caller turns that into a clean "unavailable" status. Nothing in this file throws
 * into the main loop.
 *
 * koffi types are PROCESS-GLOBAL: declaring `koffi.struct("X", ...)` twice throws. Every named struct / proto this
 * stack declares is prefixed `WMP_` and declared exactly once per process (here and in winmsg.ts, behind a cache).
 *
 * Release registry. Anything that leaves OS state behind (a Wintab context, a Raw Input registration, a message
 * window, `timeBeginPeriod`) registers a releaser with `registerRelease`; `releaseAllNative()` runs them all and is wired
 * to the process exit paths (exit, SIGINT / SIGTERM / SIGBREAK, uncaughtExceptionMonitor) the first time anything registers,
 * and is also meant for the app's before-quit / will-quit / window-all-closed handlers.
 */

import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import type * as KoffiNS from "koffi"

export type Koffi = typeof KoffiNS
export type KoffiLib = KoffiNS.LibraryHandle

/** Why the native pen stack cannot run at all here, or null. Cheap, side-effect free. */
export function nativeBlockedReason(): string | null {
  if (process.platform !== "win32") return "not Windows"
  if (process.arch !== "x64") return `needs 64-bit Windows (this process is ${process.arch})`
  const e2e = process.env.WRITEMIND_E2E
  if (e2e && e2e !== "0" && process.env.WRITEMIND_PEN_NATIVE !== "1") return "native pen backends are off under E2E"
  return null
}

export function systemFile(name: string): string {
  return `${process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows"}\\System32\\${name}`
}
export const systemFileExists = (name: string): boolean => {
  try { return existsSync(systemFile(name)) } catch { return false }
}

/** Declare a typed function from a C definition. koffi's own `func` returns `(...args: any[]) => any`; this is the only cast. */
export function bind<F extends (...args: never[]) => unknown>(lib: KoffiLib, definition: string): F {
  return lib.func(definition) as unknown as F
}

export interface Win32 {
  koffi: Koffi
  user32: KoffiLib
  kernel32: KoffiLib
  getCursorPos(): { x: number; y: number }
  /** Process id of the window that has the keyboard focus right now, or 0. */
  foregroundPid(): number
  /** Ask Windows for a 1 ms timer tick (timeBeginPeriod) or give it back. Reference counted; the process ending also gives it back. */
  highResTimer(on: boolean): void
  highResTimerRefs(): number
  lastError(): number
  screenSize(): { width: number; height: number }
}

let cached: Win32 | { error: string } | null = null

export function loadWin32(): Win32 | { error: string } {
  if (cached) return cached
  const blocked = process.platform !== "win32" ? "not Windows" : process.arch !== "x64" ? `needs 64-bit Windows (this process is ${process.arch})` : null
  if (blocked) return (cached = { error: blocked })
  try {
    const koffi = createRequire(import.meta.url)("koffi") as Koffi
    const user32 = koffi.load("user32.dll")
    const kernel32 = koffi.load("kernel32.dll")
    const winmm = koffi.load("winmm.dll")
    const GetCursorPos = bind<(p: Buffer) => number>(user32, "int GetCursorPos(void *p)")
    const GetForegroundWindow = bind<() => number | bigint>(user32, "uintptr_t GetForegroundWindow()")
    const GetWindowThreadProcessId = bind<(hwnd: number | bigint, pid: number[]) => number>(user32, "uint32 GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32 *pid)")
    const GetSystemMetrics = bind<(i: number) => number>(user32, "int GetSystemMetrics(int index)")
    const GetLastError = bind<() => number>(kernel32, "uint32 GetLastError()")
    const timeBeginPeriod = bind<(ms: number) => number>(winmm, "uint32 timeBeginPeriod(uint32 ms)")
    const timeEndPeriod = bind<(ms: number) => number>(winmm, "uint32 timeEndPeriod(uint32 ms)")
    let timerRefs = 0
    const api: Win32 = {
      koffi, user32, kernel32,
      getCursorPos() {
        const c = canaryBuffer(8)
        GetCursorPos(c.buf)
        c.check("GetCursorPos")
        return { x: c.buf.readInt32LE(0), y: c.buf.readInt32LE(4) }
      },
      foregroundPid() {
        const w = GetForegroundWindow()
        if (!w) return 0
        const out = [0]
        GetWindowThreadProcessId(w, out)
        return out[0] ?? 0
      },
      highResTimer(on) {
        if (on) { if (timerRefs++ === 0) timeBeginPeriod(1) } else if (timerRefs > 0 && --timerRefs === 0) timeEndPeriod(1)
      },
      highResTimerRefs: () => timerRefs,
      lastError: () => GetLastError(),
      screenSize: () => ({ width: GetSystemMetrics(0), height: GetSystemMetrics(1) }),
    }
    registerRelease(() => { while (timerRefs > 0) api.highResTimer(false) })
    return (cached = api)
  } catch (e) {
    return (cached = { error: `koffi did not load: ${e instanceof Error ? e.message : String(e)}` })
  }
}

export const isWin32 = (v: Win32 | { error: string }): v is Win32 => !("error" in v)

// ---- FFI safety: canary buffers (design 4.2 "FFI safety", 14.1 #15) -----------------------------

export const CANARY_BYTE = 0xa5
export const CANARY_LEN = 8

/** A native call wrote past the size the code computed. Fatal for the backend that made the call. */
export class FfiOverrun extends Error {
  constructor(readonly what: string, readonly expected: number, readonly wroteAtLeast: number) {
    super(`buffer overrun in ${what}: expected ${expected} bytes, the driver wrote at least ${wroteAtLeast}`)
    this.name = "FfiOverrun"
  }
}

/**
 * A buffer a native call writes into. ALLOCATED AT TWICE the computed size (and at least 256 bytes), zero-filled, with an 8-byte
 * canary right after the computed end: a call that writes more than the arithmetic said lands in the slack (the heap of the whole
 * Electron main process is not touched) and breaks the canary, which `check` turns into a FfiOverrun. EVERY buffer that native
 * code writes into must come from here (static scan in test/pen/safety.test.ts); pass `buf` to koffi and tell the call `size`.
 */
export interface CanaryBuffer {
  /** The whole allocation (2x). Hand THIS to the native call. */
  readonly buf: Buffer
  /** The size the code computed: what the native call is told it may write. */
  readonly size: number
  /** The computed part only (a view, no copy). */
  view(): Buffer
  intact(): boolean
  /** Bytes the native side wrote beyond `size` (0 = none), judged from the canary and the slack. */
  overrun(): number
  /** Throws FfiOverrun when the canary is broken. */
  check(what: string): void
  /** Zero the computed part and restore the canary (for a reused scratch buffer). */
  reset(): void
}

export function canaryBuffer(size: number): CanaryBuffer {
  const n = Math.max(0, Math.floor(size))
  const total = Math.max(256, n * 2 + CANARY_LEN)
  const buf = Buffer.alloc(total)
  buf.fill(CANARY_BYTE, n, n + CANARY_LEN)
  const overrun = (): number => {
    for (let i = buf.length - 1; i >= n; i--) {
      const expected = i < n + CANARY_LEN ? CANARY_BYTE : 0
      if (buf[i] !== expected) return i + 1 - n
    }
    return 0
  }
  return {
    buf, size: n,
    view: () => buf.subarray(0, n),
    intact: () => overrun() === 0,
    overrun,
    check(what) {
      const extra = overrun()
      if (extra > 0) throw new FfiOverrun(what, n, n + extra)
    },
    reset() {
      buf.fill(0, 0, n)
      buf.fill(CANARY_BYTE, n, n + CANARY_LEN)
      buf.fill(0, n + CANARY_LEN)
    },
  }
}

/** Run one native step and report it when it took longer than `slowMs` (design 4.2 step 4: `slow-native-call`). */
export function timedStep<T>(name: string, fn: () => T, onSlow: (name: string, ms: number) => void, slowMs = 750): T {
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    const ms = performance.now() - t0
    if (ms > slowMs) { try { onSlow(name, Math.round(ms)) } catch { /* a reporter that throws must not hide the result */ } }
  }
}

/** Let the event loop breathe between native steps so a slow one cannot starve everything for the whole start budget. */
export const breathe = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

// ---- the release registry -----------------------------------------------------------------------

const releasers = new Set<() => void>()
let hooked = false

function hookProcess(): void {
  if (hooked) return
  hooked = true
  process.on("exit", () => releaseAllNative())
  // uncaughtExceptionMonitor observes without taking over: Electron's own error dialog and exit still happen.
  process.on("uncaughtExceptionMonitor", () => releaseAllNative())
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(sig, () => {
      releaseAllNative()
      // If somebody else listens for this signal too they decide; if we are the only listener the default (exit) would have happened.
      if (process.listenerCount(sig) <= 1) process.exit(0)
    })
  }
}

/** Register something to be undone on every exit path. Returns the unregister function. */
export function registerRelease(fn: () => void): () => void {
  releasers.add(fn)
  hookProcess()
  return () => { releasers.delete(fn) }
}

/** Run every releaser, whatever happens in one of them. Idempotent: releasers stay registered for the next use. */
export function releaseAllNative(): void {
  for (const fn of [...releasers]) {
    try { fn() } catch { /* a releaser that throws must not stop the others */ }
  }
}

export const releaserCount = (): number => releasers.size
