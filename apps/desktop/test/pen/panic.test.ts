// The panic hotkey and the safety net (main/pen/panic.ts): fake shortcuts, fake app, fake window, fake process.
import { describe, expect, it } from "vitest"
import { installPanic, installSafetyNet, PANIC_ACCELERATOR, PANIC_POLL_MS, type EmitterLike, type ShortcutPort, type WindowLike } from "../../src/main/pen/panic"

class Emitter implements EmitterLike {
  listeners = new Map<string, Set<(...a: unknown[]) => void>>()
  on(ev: string, l: (...a: unknown[]) => void) { (this.listeners.get(ev) ?? this.listeners.set(ev, new Set()).get(ev)!).add(l); return this }
  removeListener(ev: string, l: (...a: unknown[]) => void) { this.listeners.get(ev)?.delete(l); return this }
  emit(ev: string, ...a: unknown[]) { for (const l of [...(this.listeners.get(ev) ?? [])]) l(...a) }
  count(ev: string) { return this.listeners.get(ev)?.size ?? 0 }
  total() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n }
}

describe("the global panic shortcut", () => {
  function rig(opts: { taken?: boolean } = {}) {
    const registered = new Map<string, () => void>()
    const calls: string[] = []
    const shortcuts: ShortcutPort = {
      register: (a, cb) => { calls.push(`register ${a}`); if (opts.taken) return false; registered.set(a, cb); return true },
      unregister: (a) => { calls.push(`unregister ${a}`); registered.delete(a) },
    }
    let armed = false
    const timers: { fn: () => void; live: boolean }[] = []
    const panics: string[] = []
    const logs: string[] = []
    const h = installPanic({ onPanic: (r) => panics.push(r), armed: () => armed }, {
      shortcuts, every: (_ms, fn) => { const t = { fn, live: true }; timers.push(t); return () => { t.live = false } }, log: (l) => logs.push(l),
    })
    return { h, registered, calls, panics, logs, setArmed: (v: boolean) => { armed = v }, poll: () => timers.filter((t) => t.live).forEach((t) => t.fn()), live: () => timers.filter((t) => t.live).length }
  }

  it("uses Ctrl+Alt+G (Command on a Mac)", () => {
    expect(PANIC_ACCELERATOR).toBe("CommandOrControl+Alt+G")
    expect(PANIC_POLL_MS).toBeGreaterThan(0)
  })

  it("registers the chord only while something is armed, and gives it back the moment nothing is", () => {
    const r = rig()
    expect(r.h.registered()).toBe(false)
    r.setArmed(true); r.poll()
    expect(r.h.registered()).toBe(true)
    expect(r.registered.has(PANIC_ACCELERATOR)).toBe(true)
    r.poll(); r.poll()
    expect(r.calls.filter((c) => c.startsWith("register")).length).toBe(1) // not re-registered on every poll
    r.setArmed(false); r.poll()
    expect(r.h.registered()).toBe(false)
    expect(r.registered.size).toBe(0)
  })

  it("pressing it panics", () => {
    const r = rig()
    r.setArmed(true); r.poll()
    r.registered.get(PANIC_ACCELERATOR)!()
    expect(r.panics).toEqual(["panic"])
  })

  it("a throwing panic handler does not escape into Electron", () => {
    const registered = new Map<string, () => void>()
    const h = installPanic({ onPanic: () => { throw new Error("x") }, armed: () => true }, {
      shortcuts: { register: (a, cb) => { registered.set(a, cb); return true }, unregister: () => undefined }, every: () => () => undefined,
    })
    expect(() => registered.get(PANIC_ACCELERATOR)!()).not.toThrow()
    h.dispose()
  })

  it("another program holding the chord is logged, not fatal, and retried", () => {
    const r = rig({ taken: true })
    r.setArmed(true); r.poll(); r.poll()
    expect(r.h.registered()).toBe(false)
    expect(r.logs.join(" ")).toContain("another program")
    expect(r.calls.filter((c) => c.startsWith("register")).length).toBe(2) // once per poll while armed
  })

  it("sync() follows armed() at once", () => {
    const r = rig()
    r.setArmed(true)
    r.h.sync()
    expect(r.h.registered()).toBe(true)
  })

  it("dispose unregisters and stops the poll, and is idempotent", () => {
    const r = rig()
    r.setArmed(true); r.poll()
    r.h.dispose()
    expect(r.registered.size).toBe(0)
    expect(r.live()).toBe(0)
    r.h.dispose()
    r.setArmed(true); r.h.sync()
    expect(r.h.registered()).toBe(false)
  })

  it("an armed() that throws counts as not armed (the chord is given back)", () => {
    const registered = new Map<string, () => void>()
    let throwNow = false
    const timers: (() => void)[] = []
    const h = installPanic({ onPanic: () => undefined, armed: () => { if (throwNow) throw new Error("x"); return true } }, {
      shortcuts: { register: (a, cb) => { registered.set(a, cb); return true }, unregister: (a) => { registered.delete(a) } }, every: (_m, fn) => { timers.push(fn); return () => undefined },
    })
    expect(h.registered()).toBe(true)
    throwNow = true
    timers.forEach((f) => f())
    expect(h.registered()).toBe(false)
  })

  it("without an Electron shortcut module it does nothing and does not throw", () => {
    const h = installPanic({ onPanic: () => undefined, armed: () => true }, { shortcuts: undefined, every: () => () => undefined })
    h.dispose()
  })
})

describe("the safety net: every way the app can stop is a release", () => {
  function rig() {
    const app = new Emitter()
    const proc = new Emitter() as Emitter & { exit: (c?: number) => never }
    const exits: (number | undefined)[] = []
    proc.exit = ((c?: number) => { exits.push(c) }) as never
    const wc = new Emitter()
    const win = new Emitter() as Emitter & WindowLike
    let destroyed = false
    ;(win as unknown as { isDestroyed(): boolean }).isDestroyed = () => destroyed
    ;(win as unknown as { webContents: EmitterLike }).webContents = wc
    let current: WindowLike | null = win
    const released: string[] = []
    const later: (() => void)[] = []
    const net = installSafetyNet({ release: (w) => released.push(w), app, proc, window: () => current, later: (fn) => later.push(fn) })
    return { net, app, proc, win, wc, released, exits, later, destroy: () => { destroyed = true }, setWindow: (w: WindowLike | null) => { current = w } }
  }

  it.each(["before-quit", "will-quit", "window-all-closed"])("app %s releases", (ev) => {
    const r = rig()
    r.app.emit(ev)
    expect(r.released).toEqual([ev])
  })

  it.each(["exit", "uncaughtExceptionMonitor"])("process %s releases (the uncaught exception is observed, not swallowed)", (ev) => {
    const r = rig()
    r.proc.emit(ev)
    expect(r.released).toEqual([`process ${ev}`])
    expect(r.exits).toEqual([])
  })

  it.each(["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"])("%s releases and then ends the process a moment later", (sig) => {
    const r = rig()
    r.proc.emit(sig)
    expect(r.released).toEqual([`process ${sig}`])
    expect(r.exits).toEqual([])
    r.later.forEach((f) => f())
    expect(r.exits).toEqual([0])
  })

  it("the notes window closing, hanging, crashing or reloading releases", () => {
    const r = rig()
    r.win.emit("closed")
    r.win.emit("unresponsive")
    r.wc.emit("render-process-gone", {}, { reason: "crashed" })
    r.wc.emit("did-start-loading")
    r.wc.emit("destroyed")
    expect(r.released).toEqual(["window closed", "window unresponsive", "renderer render-process-gone", "renderer did-start-loading", "renderer destroyed"])
  })

  it("a throwing release never escapes", () => {
    const app = new Emitter()
    const net = installSafetyNet({ release: () => { throw new Error("boom") }, app, proc: new Emitter(), window: () => null })
    expect(() => app.emit("before-quit")).not.toThrow()
    net.dispose()
  })

  it("attachWindow moves the listeners to a new window and leaves none on the old one", () => {
    const r = rig()
    const wc2 = new Emitter()
    const win2 = new Emitter() as Emitter & WindowLike
    ;(win2 as unknown as { isDestroyed(): boolean }).isDestroyed = () => false
    ;(win2 as unknown as { webContents: EmitterLike }).webContents = wc2
    r.setWindow(win2)
    r.net.attachWindow()
    expect(r.win.total()).toBe(0)
    expect(r.wc.total()).toBe(0)
    wc2.emit("render-process-gone")
    expect(r.released).toEqual(["renderer render-process-gone"])
  })

  it("no window yet is fine, and a destroyed one is skipped", () => {
    const app = new Emitter()
    const net = installSafetyNet({ release: () => undefined, app, proc: new Emitter(), window: () => null })
    net.attachWindow()
    net.dispose()
  })

  it("dispose removes every listener it added (app, process, window)", () => {
    const r = rig()
    r.net.dispose()
    expect(r.app.total()).toBe(0)
    expect(r.proc.total()).toBe(0)
    expect(r.win.total()).toBe(0)
    expect(r.wc.total()).toBe(0)
    r.net.dispose()
  })
})
