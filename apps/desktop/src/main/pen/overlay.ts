/**
 * overlay.ts - the PEN SINK window and the overlay backend (docs/spikes/DESIGN-pen-capture.md 4.5, 7.6, IMPL-C).
 *
 * The sink is the demoted Grab overlay: a transparent, frameless, topmost, NON-ACTIVATING tool window over the notes window's
 * display (never the monitor's exact rectangle, `overlayBounds`), hit-testable ONLY while `containment.ts` says so. It
 * dies with the process and any real mouse event turns it off, which is why it can be tried automatically while the
 * driver mapping and the clip (OS state that outlives the process) need a proof first.
 *
 *   hidden  -> shown (visible, click-through: `setIgnoreMouseEvents(true)`; invisible and free) -> on (hit-testable: the pen
 *   is swallowed here and reported to main). Only `on` can touch the mouse.
 *
 * This file is the SHELL: it owns the window, the three private IPC channels (PEN_SINK_CHANNELS, sender-checked) and the
 * page's heartbeat, and converts the page's reports into screen-frame PenSamples. All the policy (when it is `on`, when
 * it is `unsafe`) is containment.ts.
 *
 * It is also the last line of defence on its own: whatever containment believes, the window hides itself when the notes
 * window is not in front (outside E2E), is destroyed when its page dies / stops answering / closes, and `dispose()` (every
 * exit path) destroys it. Electron is loaded lazily so vitest can import this file.
 */

import { createRequire } from "node:module"
import {
  PEN_SINK_CHANNELS, clamp01,
  type BackendStart, type BackendStatus, type Box, type DomPenReport, type PenBackend, type PenSample,
} from "../../shared/pen"
import { overlayBounds } from "../../shared/grab"
import { SINK_STATE_CHANNEL } from "../../shared/penSink"
import { BackendCore } from "./backendCore"
import { VisitTracker, type Cancel, type Schedule } from "./batcher"
import type { CreateOverlayBackend, CreateSink, OverlayDeps, Sink, SinkDeps } from "./types"

/** What containment looks for on the sink with a feature test (the Sink interface is the contract; these are extras). */
export interface SinkExtras {
  /** The first real mouse event (not the pen's echo, as far as the page can tell) reached the sink while it was on. */
  onMouse(listener: () => void): () => void
  /** Milliseconds since the sink page last beat, or null while there is no page. */
  beatAgeMs(): number | null
}
export type PenSink = Sink & SinkExtras

/** The window as the sink needs it (Electron's BrowserWindow is adapted to it; tests fake it). */
export interface SinkWindow {
  setBounds(b: Box): void
  getBounds(): Box
  /** showInactive + topmost. */
  show(): void
  hide(): void
  /** true = hit-testable (swallows pen and mouse), false = click-through. */
  setHitTest(on: boolean): void
  /** What the window itself reports (a belt for containment's "still hit-testing after an off order" check). */
  hitTesting(): boolean
  /** Tell the page its state again (the page paints itself transparent if it has not heard for SINK_DEAD_MAN_MS). */
  keepAlive?(): void
  destroy(): void
  isDestroyed(): boolean
}

export interface SinkChannels {
  pen(reports: DomPenReport[]): void
  mouse(): void
  beat(): void
  /** The window or its page is gone (closed, crashed, unresponsive). */
  gone(): void
}

export interface SinkHooks {
  now?: () => number
  every?: (ms: number, fn: () => void) => () => void
  /** Create the window and wire its private channels. Default: the Electron one. null = it could not be made. */
  makeWindow?: (deps: SinkDeps, channels: SinkChannels, bounds: Box) => SinkWindow | null
  /** DIP bounds of the display the notes window is on, or null (default: Electron's screen). */
  displayBounds?: () => Box | null
  /** The notes window is in front (default: from deps.window()). */
  notesInFront?: () => boolean
}

const defaultEvery = (ms: number, fn: () => void): (() => void) => {
  const t = setInterval(fn, ms)
  t.unref()
  return () => clearInterval(t)
}

/** A page that does not beat for this long is deaf; the window is destroyed. */
export const SINK_BEAT_TIMEOUT_MS = 6000
/** After a destroyed sink, no new window for this long (a page that dies on load must not loop). */
export const SINK_RETRY_MS = 30_000
export const SINK_POLL_MS = 250

// ---------------------------------------------------------------------------------------------
// Pure: the page's reports -> samples in the screen frame
// ---------------------------------------------------------------------------------------------

/**
 * One DomPenReport per pointer event (coalesced events included). `display` is the DIP rectangle of the display the point is on:
 * the screen frame is fractions of the DISPLAY (the sink is 2 DIP shorter than it, which moves nothing).
 */
export function reportsToSamples(reports: readonly DomPenReport[], display: Box): PenSample[] {
  const out: PenSample[] = []
  for (const r of reports) {
    if (![r.t, r.sx, r.sy, r.p, r.buttons].every((v) => typeof v === "number" && Number.isFinite(v))) continue
    const s: PenSample = {
      t: r.t,
      x: clamp01((r.sx - display.x) / Math.max(1, display.width)),
      y: clamp01((r.sy - display.y) / Math.max(1, display.height)),
      p: r.inRange ? clamp01(r.p) : 0,
      tip: r.inRange && (r.buttons & 1) !== 0,
      lower: r.inRange && (r.buttons & 2) !== 0,
      upper: r.inRange && (r.buttons & 4) !== 0,
      eraser: r.inRange && (r.buttons & 32) !== 0,
      inRange: r.inRange === true,
      backend: "overlay",
    }
    if (typeof r.tiltX === "number" && Number.isFinite(r.tiltX)) s.tiltX = r.tiltX
    if (typeof r.tiltY === "number" && Number.isFinite(r.tiltY)) s.tiltY = r.tiltY
    out.push(s)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The sink
// ---------------------------------------------------------------------------------------------

export function makeSink(deps: SinkDeps & SinkHooks): PenSink {
  const now = deps.now ?? Date.now
  const every = deps.every ?? defaultEvery
  const log = (s: string): void => { try { deps.log(`sink: ${s}`) } catch { /* logging never throws */ } }

  let win: SinkWindow | null = null
  let shown = false
  let on = false
  let disposed = false
  let lastBeat = 0
  let brokenUntil = 0
  let pen = 0
  let mouse = 0
  let display: Box | null = null
  const penListeners = new Set<(batch: PenSample[]) => void>()
  const mouseListeners = new Set<() => void>()
  let stopPoll: (() => void) | null = null

  const front = (): boolean => {
    if (deps.e2e) return true
    if (deps.notesInFront) return deps.notesInFront()
    try { const w = deps.window(); return !!w && !w.isDestroyed() && w.isFocused() && w.isVisible() && !w.isMinimized() } catch { return false }
  }

  function destroy(why: string): void {
    const w = win
    win = null
    on = false
    if (stopPoll) { stopPoll(); stopPoll = null }
    if (w && !w.isDestroyed()) { try { w.destroy() } catch { /* gone */ } }
    if (w) log(`window destroyed (${why})`)
    shown = false
  }

  const channels: SinkChannels = {
    pen(reports) {
      if (!Array.isArray(reports) || reports.length === 0 || reports.length > 512) return
      lastBeat = now()
      const d = display ?? { x: 0, y: 0, width: 1920, height: 1200 }
      const samples = reportsToSamples(reports, d)
      if (!samples.length) return
      pen += samples.length
      for (const l of [...penListeners]) { try { l(samples) } catch { /* a listener must not break the channel */ } }
    },
    mouse() {
      lastBeat = now()
      mouse++
      for (const l of [...mouseListeners]) { try { l() } catch { /* ditto */ } }
    },
    beat() { lastBeat = now() },
    gone() { destroy("its page went away") },
  }

  function currentDisplay(): Box | null {
    try {
      if (deps.displayBounds) return deps.displayBounds()
      const electron = createRequire(import.meta.url)("electron") as typeof import("electron")
      const w = deps.window()
      if (!w || w.isDestroyed()) return null
      const b = electron.screen.getDisplayMatching(w.getBounds()).bounds
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch { return null }
  }

  function placeOnDisplay(): void {
    if (!win || win.isDestroyed()) return
    const d = currentDisplay()
    if (!d) return
    const b = overlayBounds(d)
    const cur = win.getBounds()
    display = d
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
      win.setBounds(b)
      win.setBounds(b) // a display of another scale can land the bounds a pixel off: say it twice
    }
  }

  function poll(): void {
    if (disposed) return
    try {
      if (!win || win.isDestroyed()) { if (win) destroy("window lost"); return }
      if (shown && !front()) { // defence in depth: whatever containment believes, the sink is never over a window that is not in front
        win.setHitTest(false)
        on = false
        win.hide()
        shown = false
        return
      }
      if (shown) {
        win.keepAlive?.()
        placeOnDisplay()
        if (now() - lastBeat > SINK_BEAT_TIMEOUT_MS) { destroy("its page stopped answering"); brokenUntil = now() + SINK_RETRY_MS }
      }
    } catch (e) { log(`poll threw: ${(e as Error).message}`); destroy("error") }
  }

  function ensureWindow(): boolean {
    if (win && !win.isDestroyed()) return true
    if (disposed || now() < brokenUntil) return false
    const d = currentDisplay() ?? { x: 0, y: 0, width: 1920, height: 1200 }
    display = d
    const maker = deps.makeWindow ?? electronWindow
    let w: SinkWindow | null = null
    try { w = maker(deps, channels, overlayBounds(d)) } catch (e) { log(`could not create the window: ${(e as Error).message}`) }
    if (!w) { brokenUntil = now() + SINK_RETRY_MS; return false }
    win = w
    lastBeat = now()
    try { w.setHitTest(false) } catch { /* new window */ }
    stopPoll = every(SINK_POLL_MS, poll)
    return true
  }

  const api: PenSink = {
    setShown(want) {
      if (disposed) return
      try {
        if (!want) {
          if (on && win && !win.isDestroyed()) win.setHitTest(false)
          on = false
          if (shown && win && !win.isDestroyed()) win.hide()
          shown = false
          return
        }
        if (!front()) return // never over a window that is not in front
        if (!ensureWindow() || !win) return
        if (!shown) {
          placeOnDisplay()
          win.setHitTest(false)
          win.show()
          shown = true
        }
      } catch (e) { log(`setShown threw: ${(e as Error).message}`); destroy("error") }
    },
    setOn(want) {
      if (disposed) return
      try {
        if (!want) {
          if (win && !win.isDestroyed()) win.setHitTest(false)
          on = false
          return
        }
        if (!win || win.isDestroyed() || !shown) return // only a shown window can be turned on
        win.setHitTest(true)
        on = true
      } catch (e) { log(`setOn threw: ${(e as Error).message}`); destroy("error") }
    },
    state() {
      let hit = on
      try { if (win && !win.isDestroyed()) hit = win.hitTesting() } catch { /* the belief stands */ }
      return { shown, on: hit, bounds: win && !win.isDestroyed() ? win.getBounds() : null }
    },
    penEvents: () => pen,
    mouseEvents: () => mouse,
    onPenSamples(listener) { penListeners.add(listener); return () => { penListeners.delete(listener) } },
    onMouse(listener) { mouseListeners.add(listener); return () => { mouseListeners.delete(listener) } },
    beatAgeMs: () => (win && !win.isDestroyed() ? Math.max(0, now() - lastBeat) : null),
    dispose() {
      if (disposed) return
      disposed = true
      destroy("dispose")
      penListeners.clear()
      mouseListeners.clear()
    },
  }
  return api
}

export const createSink: CreateSink = (deps): Sink => makeSink(deps as SinkDeps & SinkHooks)

// ---------------------------------------------------------------------------------------------
// The Electron window (loaded lazily)
// ---------------------------------------------------------------------------------------------

function electronWindow(deps: SinkDeps, channels: SinkChannels, bounds: Box): SinkWindow | null {
  const electron = createRequire(import.meta.url)("electron") as typeof import("electron")
  const { BrowserWindow, ipcMain } = electron
  const overlay = new BrowserWindow({
    ...bounds,
    // NEVER FULL-SCREEN-LOOKING (shared/grab.ts overlayBounds): not the monitor's exact rectangle, a tool window
    // (WS_EX_TOOLWINDOW: no taskbar button, never the "rude" window that hides the taskbar), not activatable
    // (focusable:false = WS_EX_NOACTIVATE, so it never takes the foreground), and no OS full-screen of its own.
    type: "toolbar",
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    focusable: false, show: false, thickFrame: false, backgroundColor: "#00000000",
    webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  })
  overlay.setBounds(bounds)
  overlay.setAlwaysOnTop(true, "floating")
  overlay.setIgnoreMouseEvents(true)
  let hit = false
  const fromMe = (e: Electron.IpcMainEvent): boolean => !overlay.isDestroyed() && e.sender === overlay.webContents
  const onPen = (e: Electron.IpcMainEvent, reports: DomPenReport[]): void => { if (fromMe(e)) channels.pen(reports) }
  const onMouse = (e: Electron.IpcMainEvent): void => { if (fromMe(e)) channels.mouse() }
  const onBeat = (e: Electron.IpcMainEvent): void => { if (fromMe(e)) channels.beat() }
  ipcMain.on(PEN_SINK_CHANNELS.pen, onPen)
  ipcMain.on(PEN_SINK_CHANNELS.mouse, onMouse)
  ipcMain.on(PEN_SINK_CHANNELS.beat, onBeat)
  const unhook = (): void => {
    ipcMain.removeListener(PEN_SINK_CHANNELS.pen, onPen)
    ipcMain.removeListener(PEN_SINK_CHANNELS.mouse, onMouse)
    ipcMain.removeListener(PEN_SINK_CHANNELS.beat, onBeat)
  }
  // The overlay dying or going deaf ends it; it never lingers over the screen.
  overlay.on("closed", () => { unhook(); channels.gone() })
  overlay.webContents.on("render-process-gone", () => channels.gone())
  overlay.on("unresponsive", () => channels.gone())
  void deps.load(overlay).catch(() => channels.gone())
  // The page paints itself solid only while it is told "on" (and transparent otherwise): two switches, window-level and page-level.
  const tell = (): void => { try { if (!overlay.isDestroyed()) overlay.webContents.send(SINK_STATE_CHANNEL, { on: hit }) } catch { /* the page is gone */ } }
  overlay.webContents.on("did-finish-load", tell)
  return {
    setBounds: (b) => { if (!overlay.isDestroyed()) overlay.setBounds(b) },
    getBounds: () => { const b = overlay.getBounds(); return { x: b.x, y: b.y, width: b.width, height: b.height } },
    show: () => { if (overlay.isDestroyed()) return; overlay.showInactive(); overlay.setAlwaysOnTop(true, "floating") },
    hide: () => { if (!overlay.isDestroyed()) overlay.hide() },
    setHitTest: (on) => { if (overlay.isDestroyed()) return; hit = on; overlay.setIgnoreMouseEvents(!on); tell() },
    hitTesting: () => hit,
    keepAlive: () => tell(),
    destroy: () => { unhook(); if (!overlay.isDestroyed()) overlay.destroy() },
    isDestroyed: () => overlay.isDestroyed(),
  }
}

// ---------------------------------------------------------------------------------------------
// The overlay backend: a view on the sink (it is not another door; design 4.5)
// ---------------------------------------------------------------------------------------------

export interface OverlayHooks {
  now?: () => number
  every?: (ms: number, fn: () => void) => () => void
  /** Platform check override (tests). */
  platform?: string
  /** The batcher's timers (tests drive them by hand). */
  schedule?: Schedule
  cancel?: Cancel
}

export function makeOverlayBackend(deps: OverlayDeps & OverlayHooks): PenBackend {
  const now = deps.now ?? Date.now
  const every = deps.every ?? defaultEvery
  const core = new BackendCore("overlay", { now, schedule: deps.schedule, cancel: deps.cancel })
  const visits = new VisitTracker()
  let off: (() => void) | null = null
  let stopTick: (() => void) | null = null
  let started = false

  function accept(batch: PenSample[]): void {
    for (const s of batch) {
      core.raw()
      const out = visits.observe(s, now())
      if (out) core.emit(out)
    }
  }
  function tick(): void {
    const leave = visits.tick(now())
    if (leave) core.emit(leave)
  }
  function stop(): void {
    started = false
    if (off) { off(); off = null }
    if (stopTick) { stopTick(); stopTick = null }
    const leave = visits.end(now())
    if (leave) core.emit(leave)
    core.flush()
    core.discard()
    visits.reset()
    core.setState("idle", null)
  }

  const available = (): { ok: true } | { ok: false; reason: string } => {
    if ((deps.platform ?? process.platform) !== "win32") return { ok: false, reason: "the pen sink is Windows only" }
    return deps.allowed() ? { ok: true } : { ok: false, reason: "the pen sink is switched off or was measured not to work here" }
  }

  return {
    name: "overlay",
    frameKind: "screen",
    available,
    async start(): Promise<BackendStart> {
      if (started) return { ok: true, device: null }
      const a = available()
      if (!a.ok) { core.setState("unavailable", a.reason); return { ok: false, reason: a.reason, retry: "later" } }
      core.resetObservations()
      started = true
      core.setState("armed", null)
      core.fact("source", "pen sink")
      off = deps.sink.onPenSamples(accept)
      stopTick = every(100, tick)
      return { ok: true, device: null }
    },
    stop,
    onSample: (l) => core.onSample(l),
    onEvent: (l) => core.onEvent(l),
    status(): BackendStatus { return core.status() },
  }
}

export const createOverlayBackend: CreateOverlayBackend = (deps) => makeOverlayBackend(deps as OverlayDeps & OverlayHooks)

