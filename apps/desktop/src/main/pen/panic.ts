/**
 * panic.ts - the panic hotkey and the safety net around every way the app can stop (docs/spikes/DESIGN-pen-capture.md 7.4, 14.1 #3, IMPL-C).
 *
 * THE PANIC KEY, Ctrl+Alt+G. Three independent paths, so that one of them always works:
 *   1. the renderer's own key handler (Esc, and Ctrl+Alt+G in the window) -> `pen:panic` (IMPL-D);
 *   2. this module: an OS-wide `globalShortcut`, registered ONLY while something is armed (a clip, a driver mapping, the sink
 *      hit-testing), so WriteMind never holds the chord when it has no business with it; works whatever window has the focus;
 *   3. the GUARD process (guard.ts / guardCore.ts): it reads GetAsyncKeyState itself while it holds a clip or a Wintab context,
 *      so the chord works even when this process is frozen. That path needs nothing from the app.
 * (The sink also has a dead-man of its own: a page that is not told "on" for 3 s paints itself transparent, so a frozen main
 * process cannot leave a transparent window swallowing the mouse. See overlay.ts and renderer/PenSink.tsx.)
 *
 * THE SAFETY NET. `installSafetyNet` turns every way the app can stop into a release: app quit (before-quit, will-quit,
 * window-all-closed), process exit, an uncaught exception (observed with `uncaughtExceptionMonitor`: Electron's own dialog
 * and exit still happen; we only let go first), SIGINT / SIGTERM / SIGBREAK, the notes window closing, its renderer crashing
 * or hanging, and a reload of the page (the renderer's state is gone, so nothing may stay armed on its behalf).
 *
 * No Electron import at load time: both are written against small ports that main.ts / the tests fill in.
 */

import { createRequire } from "node:module"

/** The one chord. It is the same text as GRAB_EXIT_KEY, and `PANIC_KEY_LABEL` in clip.ts names it for the guard. */
export const PANIC_ACCELERATOR = "CommandOrControl+Alt+G"
export const PANIC_POLL_MS = 200

// ---------------------------------------------------------------------------------------------
// The global shortcut, registered only while something is armed
// ---------------------------------------------------------------------------------------------

export interface ShortcutPort {
  /** true = registered (false: another program owns the chord). */
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface PanicDeps {
  onPanic: (reason: string) => void
  /** True while any mechanism is armed. Polled; the shortcut follows it. */
  armed: () => boolean
}

export interface PanicHooks {
  shortcuts?: ShortcutPort
  every?: (ms: number, fn: () => void) => () => void
  log?: (line: string) => void
}

export interface PanicHandle {
  dispose(): void
  /** Whether the global shortcut is registered right now (diagnostics, tests). */
  registered(): boolean
  /** Re-check `armed()` now instead of waiting for the poll. */
  sync(): void
}

const defaultEvery = (ms: number, fn: () => void): (() => void) => {
  const t = setInterval(fn, ms)
  t.unref()
  return () => clearInterval(t)
}

function electronShortcuts(): ShortcutPort | null {
  try {
    const { globalShortcut } = createRequire(import.meta.url)("electron") as typeof import("electron")
    if (!globalShortcut) return null
    return { register: (a, cb) => globalShortcut.register(a, cb), unregister: (a) => globalShortcut.unregister(a) }
  } catch { return null }
}

export function installPanic(deps: PanicDeps, hooks: PanicHooks = {}): PanicHandle {
  const log = (s: string): void => { try { hooks.log?.(`panic: ${s}`) } catch { /* logging never throws */ } }
  const every = hooks.every ?? defaultEvery
  const ports = hooks.shortcuts ?? electronShortcuts()
  let on = false
  let disposed = false

  const fire = (): void => {
    // Never throw into Electron's shortcut dispatch.
    try { deps.onPanic("panic") } catch (e) { log(`onPanic threw: ${(e as Error).message}`) }
  }
  const add = (): void => {
    if (on || !ports) return
    let ok = false
    try { ok = ports.register(PANIC_ACCELERATOR, fire) } catch { ok = false }
    if (ok) on = true
    else log("another program holds the chord; the window key and the guard still work")
  }
  const remove = (): void => {
    if (!on || !ports) return
    try { ports.unregister(PANIC_ACCELERATOR) } catch { /* not registered */ }
    on = false
  }
  const sync = (): void => {
    if (disposed) return
    let armed = false
    try { armed = deps.armed() } catch { armed = false }
    if (armed) add()
    else remove()
  }

  const stop = every(PANIC_POLL_MS, sync)
  sync()
  return {
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      remove()
    },
    registered: () => on,
    sync,
  }
}

// ---------------------------------------------------------------------------------------------
// The safety net
// ---------------------------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void

/** The sliver of Electron's `app`, a window and `process` that the net needs. */
export interface EmitterLike {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
}
export interface WindowLike {
  isDestroyed(): boolean
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  webContents: EmitterLike
}

export type ProcLike = EmitterLike & { exit?: (code?: number) => never }

export interface SafetyDeps {
  /** Let go of everything NOW, synchronously: containment.panic + manager.dispose + lease.dispose, whatever main.ts wants. Must be idempotent. */
  release: (why: string) => void
  app: EmitterLike
  window: () => WindowLike | null
  /** The process object (tests pass a fake emitter). */
  proc?: ProcLike
  log?: (line: string) => void
  /** Run `fn` a moment later (default: an unref'd setTimeout of 250 ms). */
  later?: (fn: () => void) => void
}

export interface SafetyHandle {
  /** Attach to a (new) notes window; the previous one is detached. Call again if the window is recreated. */
  attachWindow(): void
  dispose(): void
}

const APP_EVENTS = ["before-quit", "will-quit", "window-all-closed"] as const
const PROC_EVENTS = ["exit", "uncaughtExceptionMonitor", "SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const
/** Window events that mean "the renderer's state is gone or untrustworthy". */
const WINDOW_EVENTS = ["closed", "unresponsive"] as const
const CONTENT_EVENTS = ["render-process-gone", "did-start-loading", "destroyed"] as const

export function installSafetyNet(deps: SafetyDeps): SafetyHandle {
  const proc: ProcLike = deps.proc ?? (process as unknown as ProcLike)
  const log = (s: string): void => { try { deps.log?.(`safety: ${s}`) } catch { /* logging never throws */ } }
  const later = deps.later ?? ((fn: () => void): void => { const t = setTimeout(fn, 250); t.unref() })
  const detach: (() => void)[] = []
  let windowDetach: (() => void)[] = []
  let disposed = false

  const release = (why: string): void => {
    try { deps.release(why) } catch (e) { log(`release(${why}) threw: ${(e as Error).message}`) }
  }

  for (const ev of APP_EVENTS) {
    const l: Listener = () => release(ev)
    deps.app.on(ev, l)
    detach.push(() => deps.app.removeListener(ev, l))
  }
  for (const ev of PROC_EVENTS) {
    const l: Listener = () => {
      release(`process ${ev}`)
      // Having a listener turns off a signal's default (exit), and win32.ts has one too, so neither of us can tell whether we are
      // "the only one". Everything is released by now: end the process a moment later, after the other listeners have had their turn.
      if (ev === "SIGINT" || ev === "SIGTERM" || ev === "SIGBREAK" || ev === "SIGHUP") later(() => { try { proc.exit?.(0) } catch { /* already exiting */ } })
    }
    proc.on(ev, l)
    detach.push(() => proc.removeListener(ev, l))
  }

  function attachWindow(): void {
    for (const d of windowDetach) { try { d() } catch { /* the window is gone */ } }
    windowDetach = []
    if (disposed) return
    let w: WindowLike | null = null
    try { w = deps.window() } catch { w = null }
    if (!w || w.isDestroyed()) return
    const win = w
    for (const ev of WINDOW_EVENTS) {
      const l: Listener = () => release(`window ${ev}`)
      win.on(ev, l)
      windowDetach.push(() => { if (!win.isDestroyed()) win.removeListener(ev, l) })
    }
    for (const ev of CONTENT_EVENTS) {
      const l: Listener = () => release(`renderer ${ev}`)
      try {
        win.webContents.on(ev, l)
        windowDetach.push(() => { if (!win.isDestroyed()) win.webContents.removeListener(ev, l) })
      } catch { /* a destroyed webContents */ }
    }
  }

  attachWindow()
  return {
    attachWindow,
    dispose() {
      if (disposed) return
      disposed = true
      for (const d of windowDetach) { try { d() } catch { /* gone */ } }
      windowDetach = []
      for (const d of detach) { try { d() } catch { /* gone */ } }
      detach.length = 0
    },
  }
}

