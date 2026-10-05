/**
 * main/pen/subsystem.ts - the pen subsystem, assembled (docs/spikes/DESIGN-pen-capture.md 12.4 "surgical edits: main.ts"), owned by IMPL-D.
 *
 * main.ts calls `startPenSubsystem` ONCE and everything that touches the tablet lives behind it: the state file, the trace, the guard
 * process (lease), the containment engine, the pen sink, the environment probe, the check engine, the manager, the IPC, the panic key and
 * the safety net that lets go on every way the app can stop. It is all inside ONE try/catch (design 14.1 #19): an exception while the
 * subsystem is being built is logged and leaves the app exactly as it was before this feature (`available: false` for the renderer: no chip,
 * no gate, a plain pointer on the sheet). It never stops the app from starting.
 *
 * The kill switch (`WRITEMIND_PEN=off`, or a file named `pen-off` in userData; registry.ts `penDisabledReason`) is read FIRST, before any
 * native module is touched. Electron's modules arrive through `deps` as types only (nothing here imports Electron at load time), so a test can
 * build the subsystem with fakes.
 *
 * UNDER WRITEMIND_E2E: native backends are off (a backend a hard-killed test instance leaves behind would leak a Wintab context; design 14.1 #8),
 * pen capture starts OFF (a test turns it on with `wm.pen.e2e.config({ capture: true })`), the window counts as in front, and `dom` /
 * `inject` are the only backends that run. The display helpers use the notes window's content bounds instead of the real display (an
 * offscreen test window sits at -32000,-32000), so screen fractions equal client fractions.
 */

import fs from "node:fs"
import path from "node:path"
import type { App, BrowserWindow, IpcMain, PowerMonitor, Screen, Shell } from "electron"
import type { Box, CapabilityState, CheckSnapshot, EnvSummary, PenBackend, PenSample, SheetGeometry } from "../../shared/pen"
import { createCheckEngine } from "./check"
import { makeContainment, type ContainmentHooks } from "./containment"
import { collectEnv, runPowershell } from "./env"
import { installPenIpc, watchWindow, type IpcLike, type PenIpc, type WindowLike } from "./ipc"
import { createFeedManager, type FeedManagerEx } from "./manager"
import { createSink } from "./overlay"
import { installPanic, installSafetyNet, type PanicHandle, type SafetyHandle } from "./panic"
import { createPointerRangeWitness } from "./pointerRange"
import { rawDeviceList } from "./rawinputBackend"
import { createRegistry, penDisabledReason, type Registry } from "./registry"
import { createLease } from "./lease"
import { sweepAtStart } from "./sweep"
import { applyCrashBreadcrumbs, createStateStore, defaultState, type StateStore } from "./state"
import { createTrace } from "./trace"
import { closeAllWintab, installWintabExitCleanup, wintabFacts } from "./wintabNative"
import { createWintabBackend } from "./wintabBackend"
import type { Containment, DomDeps, PenPaths, Sink, SystemMapped } from "./types"

export interface PenSubsystemDeps {
  app: Pick<App, "getPath" | "getVersion" | "on" | "removeListener">
  screen: Screen
  shell: Pick<Shell, "showItemInFolder">
  ipc: IpcMain
  powerMonitor: PowerMonitor
  /** The notes window. */
  window(): BrowserWindow | null
  /** The folder of out/main (the bundled main.mjs): the guard script, the preloads and the helper pages are found from it. */
  here: string
  dev: boolean
  e2e: boolean
  env: NodeJS.ProcessEnv
  platform: string
  /** The page of the sink window (route `?pen-sink=1`). */
  loadSink(overlay: BrowserWindow): Promise<void>
  log(line: string): void
  /** Electron's session module, for the WebHID host (lazy). */
  session?: typeof import("electron").session
}

export interface PenSubsystem {
  /** False when the subsystem could not exist (kill switch, not Windows, a build failure): the renderer sees `available: false`. */
  available: boolean
  manager: FeedManagerEx | null
  /** Call after the notes window is (re)created: window events go to the manager. */
  attachWindow(): void
  /** Quit: let go of everything. Idempotent. */
  dispose(): void
}

const none = (): PenSubsystem => ({ available: false, manager: null, attachWindow: () => {}, dispose: () => {} })

const within = (b: Box, p: { x: number; y: number }): boolean => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height

export function startPenSubsystem(deps: PenSubsystemDeps): PenSubsystem {
  try {
    return build(deps)
  } catch (error) {
    deps.log(`pen subsystem could not start: ${(error as Error)?.stack ?? String(error)}`)
    return none()
  }
}

function build(deps: PenSubsystemDeps): PenSubsystem {
  const userData = deps.app.getPath("userData")
  const disabled = penDisabledReason({ platform: deps.platform, env: deps.env, userData, exists: (p) => fs.existsSync(p), join: path.join })
  const paths: PenPaths = {
    userData,
    state: path.join(userData, "pen-state.json"),
    trace: path.join(userData, "pen-trace.jsonl"),
    wintabJournal: path.join(userData, "wintab.journal.json"),
    leases: path.join(userData, "pen-leases.json"),
  }
  const log = (line: string): void => deps.log(`[pen] ${line}`)
  const now = (): number => performance.timeOrigin + performance.now()
  const native = deps.env.WRITEMIND_PEN_NATIVE === "1"
  const { screen } = deps

  // ---- the window and the display, as the pen sees them
  const content = (): Box | null => {
    const win = deps.window()
    if (!win || win.isDestroyed()) return null
    const b = win.getContentBounds()
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  }
  /** The DIP bounds of the display that holds a point; under E2E the notes window's content (so screen fractions equal client fractions). */
  const displayAt = (p: { x: number; y: number }): Box | null => {
    if (deps.e2e) return content()
    const hit = screen.getAllDisplays().find((d) => within(d.bounds, p))
    return hit ? { x: hit.bounds.x, y: hit.bounds.y, width: hit.bounds.width, height: hit.bounds.height } : null
  }
  const workAreaAt = (p: { x: number; y: number }): Box | null => {
    if (deps.e2e) return content()
    const hit = screen.getAllDisplays().find((d) => within(d.bounds, p))
    return hit ? { x: hit.workArea.x, y: hit.workArea.y, width: hit.workArea.width, height: hit.workArea.height } : null
  }
  const fractionOf = (p: { x: number; y: number }): { x: number; y: number } | null => {
    const b = displayAt(p)
    if (!b) return null
    const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
    return { x: clamp((p.x - b.x) / Math.max(1, b.width - 1)), y: clamp((p.y - b.y) / Math.max(1, b.height - 1)) }
  }
  const domDeps: DomDeps = { displayAt, windowBounds: content, workAreaAt }

  // ---- state, breadcrumbs, trace
  const store: StateStore = disabled ? memoryStore() : createStateStore(paths.state, { log })
  let crashSuspects: string[] = []
  if (!disabled) {
    let suspects: string[] = []
    store.update((s) => { suspects = applyCrashBreadcrumbs(s, new Date().toISOString()) })
    if (suspects.length > 0) { store.flushSync(); log(`crash-suspect: ${suspects.join(", ")} switched off (the app stopped within 30 s of starting them last time)`) }
    crashSuspects = suspects
  }
  // Capture starts OFF under E2E (design invariant 9): a test turns it on.
  if (deps.e2e) store.get().settings.enabled = false
  const trace = disabled ? nullTrace() : createTrace(paths, () => store.get().settings.trace)
  for (const name of crashSuspects) trace.event("manager", "crash-suspect", { backend: name })

  // ---- the registry (the only place that names concrete backends)
  let managerRef: FeedManagerEx | null = null
  let sink: Sink = inertSink()
  let lease: ReturnType<typeof createLease> | null = null
  let containment: Containment = inertContainment(store)
  const sinkDeps = {
    window: () => deps.window(),
    load: (overlay: BrowserWindow) => deps.loadSink(overlay),
    preload: path.join(deps.here, "../preload/pen-sink.cjs"),
    e2e: deps.e2e,
    log,
  }
  const registry: Registry = createRegistry({
    disabled,
    paths,
    dom: domDeps,
    webhid: () => (deps.session
      ? { session: deps.session.fromPartition("pen-hid"), preload: path.join(deps.here, "../preload/pen-hid.cjs"), page: path.join(deps.here, "../helpers/pen-hid.html"), log }
      : null),
    overlay: () => ({ ...sinkDeps, sink, allowed: () => containment.sinkWanted() }),
  })

  // ---- the guard, the sink, containment (only when the subsystem exists)
  let power: ContainmentHooks["power"]
  if (!disabled) {
    if (!deps.e2e) void sweepAtStart(paths, log).catch((error: unknown) => log(`sweep failed: ${(error as Error)?.message}`))
    lease = createLease({ paths, execPath: process.execPath, guardScript: path.join(deps.here, "pen-guard.mjs"), log })
    sink = createSink(sinkDeps)
    power = {
      on: (event, listener) => {
        deps.powerMonitor.on(event as never, listener)
        return () => { deps.powerMonitor.removeListener(event as never, listener) }
      },
    }
    containment = makeContainment({
      lease, paths, trace, now,
      window: () => deps.window(),
      display: {
        metricsChanged(listener) {
          const wrapped = (): void => listener()
          screen.on("display-metrics-changed", wrapped)
          screen.on("display-added", wrapped)
          screen.on("display-removed", wrapped)
          return () => {
            screen.removeListener("display-metrics-changed", wrapped)
            screen.removeListener("display-added", wrapped)
            screen.removeListener("display-removed", wrapped)
          }
        },
      },
      probe: {
        makeSystemBackend: () => createWintabBackend("system", paths) as PenBackend & SystemMapped,
        cursor: () => screen.getCursorScreenPoint(),
        onSamples: (listener) => (managerRef ? managerRef.onSamples((batch) => listener(batch.samples)) : () => {}),
      },
      loadCapabilities: () => store.get().capabilities,
      saveCapability: (name, record) => store.update((s) => {
        s.capabilities[name] = { state: record.state as CapabilityState, at: new Date().toISOString(), note: record.note }
      }),
      pointerMode: () => store.get().pointerMode,
      sink,
      log,
      power,
      onPanic: (reason: string) => managerRef?.panic(reason),
    })
  }

  // ---- the environment probe (cached; refreshed when the feed opens and when a check starts)
  let envSummary: EnvSummary | null = null
  const refreshEnv = (): void => {
    if (disabled) return
    void collectEnv({
      appVersion: deps.app.getVersion(),
      wintabFacts: () => (native || !deps.e2e ? wintabFacts() : null),
      rawDevices: () => (native || !deps.e2e ? rawDeviceList() : []),
      koffiLoaded: () => native || !deps.e2e,
      displays: () => screen.getAllDisplays().map((d) => ({
        bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id,
      })),
      powershell: (script, timeoutMs) => (deps.e2e && !native ? Promise.resolve(null) : runPowershell(script, timeoutMs)),
    }).then((summary) => { envSummary = summary }).catch((error: unknown) => log(`env probe failed: ${(error as Error)?.message}`))
  }

  // ---- the check engine (its dependencies read the manager through the reference, which exists before the first check)
  const check = disabled
    ? inertCheck()
    : createCheckEngine({
      now,
      windowFocused: () => deps.e2e || !!deps.window()?.isFocused(),
      env: () => envSummary,
      statuses: () => (managerRef ? managerRef.status().backends : []),
      currentFrame: (name) => managerRef?.frameOf(name) ?? null,
      swapApplied: () => managerRef?.settings().swapButtons ?? false,
      contained: () => containment.status().armed,
      pointerMode: () => store.get().pointerMode,
      sinkPassed: () => store.get().capabilities.sink.state === "effective",
    })

  // ---- the manager
  const manager = createFeedManager({
    available: !disabled,
    makeBackend: (name) => registry.makeBackend(name),
    store,
    trace,
    lease: lease ?? { ready: () => false, holdWintab: () => false, dropWintab: () => {} },
    containment,
    now,
    e2e: deps.e2e,
    native,
    check,
    env: () => envSummary,
    sheetToPhysical: (sheet: SheetGeometry): Box | null => {
      const win = deps.window()
      if (!win || win.isDestroyed()) return null
      const c = win.getContentBounds()
      const dip = { x: Math.round(c.x + sheet.rect.x), y: Math.round(c.y + sheet.rect.y), width: Math.round(sheet.rect.width), height: Math.round(sheet.rect.height) }
      try {
        const r = screen.dipToScreenRect(win, dip)
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      } catch { return dip }
    },
    displayFraction: fractionOf,
    cursorFraction: () => (deps.e2e ? null : fractionOf(screen.getCursorScreenPoint())),
    pointerRange: disabled || (deps.e2e && !native) ? undefined : (onWitness) => createPointerRangeWitness(onWitness),
    displayInfo: () => {
      const win = deps.window()
      if (!win || win.isDestroyed()) return null
      const d = screen.getDisplayMatching(win.getBounds())
      return { bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }, scale: d.scaleFactor }
    },
    log,
  })
  managerRef = manager

  // ---- the sink's pen events are witnesses too (design 7.6, R17): stale detection and calibration keep working while it absorbs the pen
  const offSink = sink.onPenSamples((batch: PenSample[]) => {
    const s = batch[batch.length - 1]
    if (!s) return
    manager.witness({ source: "dom", inRange: s.inRange, at: now(), screen: { x: s.x, y: s.y }, buttons: s.tip ? 1 : 0, pointerType: "pen" })
  })

  // ---- IPC
  const ipc: PenIpc = installPenIpc({
    ipc: deps.ipc as unknown as IpcLike,
    window: () => deps.window() as unknown as WindowLike | null,
    manager,
    trace,
    dom: () => registry.dom(),
    diagnostics: () => diagnosticsText({ manager, store, trace, deps, paths, env: envSummary }),
    revealTrace: () => { try { deps.shell.showItemInFolder(paths.trace) } catch { /* nothing to show */ } },
    e2e: deps.e2e,
    now,
  })

  // ---- the panic key (a global shortcut only while something is armed) and the safety net
  let panic: PanicHandle | null = null
  let safety: SafetyHandle | null = null
  let unwatch: (() => void) | null = null
  let disposed = false
  const releaseAll = (why: string): void => {
    try { containment.panic(why) } catch { /* ignore */ }
    try { manager.close(why) } catch { /* ignore */ }
    if (/^(before-quit|will-quit|window-all-closed|process )/.test(why)) dispose()
  }
  function dispose(): void {
    if (disposed) return
    disposed = true
    try { unwatch?.() } catch { /* ignore */ }
    try { offSink() } catch { /* ignore */ }
    try { panic?.dispose() } catch { /* ignore */ }
    try { ipc.dispose() } catch { /* ignore */ }
    try { manager.dispose() } catch { /* ignore */ }
    try { containment.dispose() } catch { /* ignore */ }
    try { sink.dispose() } catch { /* ignore */ }
    try { lease?.dispose() } catch { /* ignore */ }
    try { closeAllWintab() } catch { /* ignore */ }
    try { safety?.dispose() } catch { /* ignore */ }
    try { store.flushSync() } catch { /* ignore */ }
    try { trace.close() } catch { /* ignore */ }
  }
  if (!disabled) {
    try { installWintabExitCleanup() } catch { /* the driver is not there */ }
    panic = installPanic({ onPanic: (reason) => manager.panic(reason), armed: () => containment.status().armed })
    safety = installSafetyNet({
      release: releaseAll,
      app: deps.app as unknown as Parameters<typeof installSafetyNet>[0]["app"],
      window: () => deps.window() as unknown as ReturnType<Parameters<typeof installSafetyNet>[0]["window"]>,
      log,
    })
    // The probe starts once the page asks for the feed (pen:open); a first look now makes the first chip honest.
    refreshEnv()
    deps.powerMonitor.on("resume", () => manager.deviceChanged("resume"))
    deps.powerMonitor.on("unlock-screen", () => manager.deviceChanged("unlock"))
  }

  return {
    available: !disabled,
    manager,
    attachWindow() {
      try { unwatch?.() } catch { /* ignore */ }
      unwatch = null
      const win = deps.window()
      if (win && !win.isDestroyed()) unwatch = watchWindow(win as unknown as WindowLike, manager)
      try { safety?.attachWindow() } catch { /* ignore */ }
    },
    dispose,
  }
}

// ---------------------------------------------------------------------------------------------
// Inert pieces for the disabled subsystem (no file, no window, no OS call)
// ---------------------------------------------------------------------------------------------

function memoryStore(): StateStore {
  const state = defaultState()
  return { get: () => state, update: (change) => { change(state) }, flush: async () => {}, flushSync: () => {}, dispose: () => {} }
}

function nullTrace(): ReturnType<typeof createTrace> {
  const none = { event: () => {}, raw: () => {}, record: () => {} }
  return { ...none, path: "", tail: () => [], firstRaw: () => ({}), flush: async () => {}, close: () => {} } as unknown as ReturnType<typeof createTrace>
}

function inertSink(): Sink {
  return { setShown: () => {}, setOn: () => {}, state: () => ({ shown: false, on: false, bounds: null }), penEvents: () => 0, mouseEvents: () => 0, onPenSamples: () => () => {}, dispose: () => {} }
}

function inertContainment(store: StateStore): Containment {
  return {
    update: () => {},
    status: () => ({ mode: "none", armed: false, rect: null, lastRelease: null, capabilities: store.get().capabilities, pointerMode: null, guard: { state: "none", pid: null } }),
    driverMappingWanted: () => false,
    sinkWanted: () => false,
    test: async (mechanism) => ({ mechanism, state: "untested", detail: "the pen subsystem is off" }),
    panic: () => {},
    dispose: () => {},
  }
}

function inertCheck(): ReturnType<typeof createCheckEngine> {
  const snap = (): CheckSnapshot => ({ running: false, step: null, secondsLeft: 0, done: [], rows: [], env: null, report: null })
  return {
    begin: snap, feed: () => {}, witness: () => {}, start: snap, tick: snap, cancel: snap,
    finish: () => ({ at: new Date().toISOString(), overall: "none", winner: null, summary: "", rows: [], learned: { frames: {}, pointerMode: null, swapButtons: null }, advice: [] }),
    snapshot: snap,
  }
}

// ---------------------------------------------------------------------------------------------
// Copy diagnostics (design 9.7): one text block, no window titles, no note content, no file names from the notes
// ---------------------------------------------------------------------------------------------

function diagnosticsText(input: {
  manager: FeedManagerEx; store: StateStore; trace: ReturnType<typeof createTrace>; deps: PenSubsystemDeps; paths: PenPaths; env: EnvSummary | null
}): string {
  const { manager, store, trace, deps, paths } = input
  const state = store.get()
  const status = manager.status()
  const body = {
    app: deps.app.getVersion(), electron: process.versions.electron, os: process.getSystemVersion?.() ?? deps.platform, e2e: deps.e2e,
    settings: status.settings,
    persisted: { winner: state.winner, device: state.device, frames: state.frames, capabilities: state.capabilities, pointerMode: state.pointerMode, demoted: state.demoted, lastCheck: state.lastCheck, display: state.display, faults: state.faults, inFlight: state.inFlight },
    status: { ...status, env: undefined },
    env: input.env,
    lastCheck: manager.lastReport(),
    traceFile: paths.trace,
    traceTail: trace.tail(80),
    firstRaw: trace.firstRaw(12),
  }
  const text = JSON.stringify(body, null, 1)
  // Under 30 KB: the trace tail is what gives way first.
  if (text.length <= 30_000) return text
  return JSON.stringify({ ...body, traceTail: body.traceTail.slice(-20), firstRaw: {} }, null, 1).slice(0, 30_000)
}
