/**
 * main/pen/manager.ts - the FeedManager, small.
 *
 * WHAT IT DOES. While the Tablet sheet is open AND the window is in front AND capture is on, it runs the Wintab DATA backend (reads the
 * tablet, moves nothing). Otherwise nothing runs and nothing is held. Samples are batched by the backend (8 ms), put in the SHEET frame
 * here (the device's frame, frame.ts) and sent on. With no Wintab (other brands, no driver, a failed start) nothing is sent
 * and the window's own pen events drive the sheet exactly as they always did.
 *
 * THE FRAME comes from the device's extents alone (frame.ts defaultFrame) and always keeps the sheet landscape. Nothing is asked of the
 * person: the pen inks from the first touch, and the Orientation menu (a renderer matter) turns the sheet when the tablet lies another way.
 *
 * THE SYSTEM MAPPING (mapping.ts) is told when it is allowed (the real tablet feeds the sheet), where the sheet is, when the pen
 * is in range and where it is; it opens, verifies and closes its own Wintab system context. Everything it does is logged to pen.log.
 *
 * ONE short status string (FeedStatus.text) says what is driving the sheet; one line per CHANGE goes to pen.log.
 *
 * No Electron here (the subsystem builds the backends), so the whole file is a vitest. Timers are injectable.
 */

import {
  BACKEND_ORDER, IDENTITY_FRAME, LIVENESS, applyFrame, clamp01,
  type BackendContext, type BackendName, type DeviceInfo, type FeedEvent, type FeedStatus, type FrameRecord,
  type PenBackend, type PenBatch, type PenFeedSettings, type PenSample, type SheetReport, type TabletInfo, type TraceSink, type WindowState,
} from "../../shared/pen"
import { defaultFrame, deviceExtents, frameKey, tabletAspect } from "./frame"
import type { MappingController } from "./mapping"
import type { StateStore } from "./state"

export interface ManagerDeps {
  /** False when the pen subsystem cannot exist (not Windows, switched off): the renderer sees `available: false`. */
  available: boolean
  /** The Wintab data backend, or null when Wintab cannot be used here. */
  wintab: PenBackend | null
  /** The E2E injectors (exist always, started only under E2E): `inject` in the sheet frame, `injectTablet` a fake Wintab tablet in the DEVICE frame. */
  inject: PenBackend & { push(samples: PenSample[]): void }
  injectTablet: PenBackend & { push(samples: PenSample[]): void }
  /** The system mapping, or null (the sheet then simply has none). */
  mapping: MappingController | null
  store: StateStore
  trace: TraceSink
  now(): number
  e2e: boolean
  /** E2E only: really open Wintab (WRITEMIND_PEN_NATIVE=1). */
  native: boolean
  log(line: string): void
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
}

/** `tablet`: start the fake Wintab tablet (`inject-tablet`; its device is portrait like Sean's, 9499 x 15199) or stop it. */
export interface E2EConfig { native?: boolean; focused?: boolean; capture?: boolean; tablet?: boolean }

export interface FeedManagerEx {
  open(): Promise<FeedStatus>
  close(reason: string): void
  setWindowState(state: WindowState): void
  onSamples(listener: (batch: PenBatch) => void): () => void
  onStatus(listener: (status: FeedStatus) => void): () => void
  onEvent(listener: (event: FeedEvent) => void): () => void
  status(): FeedStatus
  settings(): PenFeedSettings
  update(patch: Partial<PenFeedSettings>): PenFeedSettings
  /** Where the sheet is (null: not showing); feeds the system mapping. */
  setSheet(report: SheetReport | null): void
  retryMapping(): FeedStatus
  panic(reason: string): void
  inject(samples: PenSample[], backend?: "inject" | "inject-tablet"): void
  e2eConfig(config: E2EConfig): FeedStatus
  /** Resume from sleep, unlock: the tablet may have been re-plugged, so Wintab is started again. */
  deviceChanged(reason: string): void
  dispose(): void
}

const rank = (name: BackendName): number => BACKEND_ORDER.indexOf(name)
const isDevice = (name: BackendName): boolean => name === "wintab-data" || name === "inject-tablet"

/** The one string, from what the manager knows. Pure (tests). */
export function statusText(s: { available: boolean; open: boolean; enabled: boolean; released: boolean; tablet: boolean; mapped: boolean }): string {
  if (!s.available || !s.open) return ""
  if (s.released) return "Pen: none"
  if (!s.enabled || !s.tablet) return "Pen: window pointer"
  return s.mapped ? "Pen: tablet, mapped to sheet" : "Pen: tablet"
}

export function createFeedManager(deps: ManagerDeps): FeedManagerEx {
  const { store, trace } = deps
  const setTimer = deps.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms) as unknown as { unref?: () => void }; h.unref?.(); return h })
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const mapping = deps.mapping

  const sampleListeners = new Set<(b: PenBatch) => void>()
  const statusListeners = new Set<(s: FeedStatus) => void>()
  const eventListeners = new Set<(e: FeedEvent) => void>()

  let opened = false
  let win: WindowState = { focused: true, visible: true, minimized: false }
  let panicked: string | null = null
  let e2eFocused: boolean | null = null
  let nativeOn = deps.native
  let fakeTablet = false
  let disposed = false
  // Capture starts OFF under E2E (a test turns it on); in memory only.
  if (deps.e2e) store.get().settings.enabled = false

  interface Run { backend: PenBackend; offs: (() => void)[]; gen: number }
  const running = new Map<BackendName, Run>()
  const lastAt = new Map<BackendName, number>()
  const devices = new Map<BackendName, DeviceInfo>()
  let active: BackendName | null = null
  let contact = false
  let visit = false
  let seq = 0
  let generation = 0
  let wintabNote: string | null = null
  let retries = 0
  let retryTimer: unknown = null
  let blurTimer: unknown = null
  let lastPushed = ""
  let lastText = ""

  const effectiveFocused = (): boolean => (e2eFocused !== null ? e2eFocused : deps.e2e ? true : win.focused && win.visible && !win.minimized)
  const releasedReason = (): string | null => {
    if (panicked !== null) return panicked
    if (!effectiveFocused()) return win.minimized ? "minimised" : !win.visible ? "hidden" : "the window is not in front"
    return null
  }
  const wanted = (): boolean => deps.available && opened && store.get().settings.enabled && releasedReason() === null

  // ---- the device and its frame ---------------------------------------------------------------

  const keyOf = (d: DeviceInfo | undefined): string | null => {
    if (!d) return null
    const ext = deviceExtents(d)
    return frameKey("wintab", d.name, ext.width, ext.height)
  }
  /** The backend whose device decides the status: the active one, else the running device backend. */
  const deviceBackend = (): BackendName | null => {
    if (active && isDevice(active) && devices.has(active)) return active
    for (const name of ["inject-tablet", "wintab-data"] as const) if (running.has(name) && devices.has(name)) return name
    return null
  }

  // ---- status -------------------------------------------------------------------------------

  const tabletInfo = (): TabletInfo | null => {
    const name = deviceBackend()
    const d = name ? devices.get(name) : undefined
    if (!d) return null
    const ext = deviceExtents(d)
    return { name: d.name, aspect: tabletAspect(ext.width, ext.height), pressureMax: d.pressureMax }
  }

  const frameForStatus = (): FrameRecord | null => {
    if (active && !isDevice(active)) return { frame: IDENTITY_FRAME, source: "screen", at: "" }
    const name = deviceBackend()
    if (!name) return null
    const ext = deviceExtents(devices.get(name)!)
    return { frame: defaultFrame(ext.width, ext.height), source: "default", at: "" }
  }

  const status = (): FeedStatus => {
    const settings = { ...store.get().settings }
    const released = opened ? releasedReason() : null
    const live = running.size > 0 ? active : null
    const tablet = tabletInfo()
    const map = mapping ? mapping.state() : "unavailable"
    return {
      available: deps.available,
      open: opened,
      released,
      active: live,
      text: statusText({ available: deps.available, open: opened, enabled: settings.enabled, released: released !== null, tablet: tablet !== null, mapped: map === "mapped" }),
      tablet,
      mapping: map,
      note: tablet ? null : wintabNote,
      frame: frameForStatus(),
      settings,
    }
  }

  const push = (): void => {
    const s = status()
    if (s.text !== lastText) { lastText = s.text; if (s.text) trace.event("manager", "status", { text: s.text }) }
    const key = JSON.stringify([s.available, s.open, s.released, s.active, s.text, s.tablet, s.mapping, s.note, s.frame, s.settings])
    if (key === lastPushed) return
    lastPushed = key
    for (const l of [...statusListeners]) { try { l(s) } catch { /* a listener never breaks the feed */ } }
  }
  const emitEvent = (e: FeedEvent): void => { for (const l of [...eventListeners]) { try { l(e) } catch { /* ignore */ } } }

  /** Close the system context now and forget that a pen visit was open (the next in-range sample opens it again). */
  const stopMapping = (reason: string): void => {
    visit = false
    try { mapping?.stop(reason) } catch { /* the context is also closed by closeAllWintab */ }
  }

  /** The real tablet may be confined to the sheet (mapping.ts) only while it feeds the sheet. */
  const syncMapping = (): void => {
    if (!mapping) return
    const name = deviceBackend()
    mapping.setDevice(name === "wintab-data" ? keyOf(devices.get(name)) : null)
    mapping.setWanted(store.get().settings.mapSheet && wanted() && name === "wintab-data" && active === "wintab-data")
  }
  mapping?.onChange(() => { if (!disposed) push() })

  // ---- samples ------------------------------------------------------------------------------

  /** Device frame -> sheet frame. */
  const toSheet = (name: BackendName, backend: PenBackend, batch: PenSample[]): PenSample[] => {
    if (backend.frameKind !== "device") return batch.map((s) => ({ ...s }))
    const ext = deviceExtents(devices.get(name) ?? null)
    const frame = defaultFrame(ext.width, ext.height)
    return batch.map((s) => {
      const [x, y] = applyFrame(s.x, s.y, frame)
      return { ...s, x: clamp01(x), y: clamp01(y) }
    })
  }

  const setActive = (name: BackendName | null, why: string): void => {
    if (active === name) return
    const from = active
    active = name
    contact = false
    visit = false
    trace.event("manager", "active", { from, to: name, why })
    if (name) emitEvent(from ? { kind: "failover", from, to: name } : { kind: "live", backend: name })
    syncMapping()
    push()
  }

  const onBatch = (name: BackendName, raw: PenSample[]): void => {
    const run = running.get(name)
    if (!run || raw.length === 0) return
    const now = deps.now()
    lastAt.set(name, now)
    const anyIn = raw.some((s) => s.inRange)
    if (active === null) {
      if (!anyIn) return
      setActive(name, "first samples")
    } else if (active !== name) {
      const quiet = now - (lastAt.get(active) ?? 0)
      const better = rank(name) < rank(active)
      if (anyIn && ((better && !contact)
        || (!better && !contact && quiet > LIVENESS.SILENT_AFTER_MS)
        || (!better && quiet > LIVENESS.STUCK_AFTER_MS))) setActive(name, better ? "better backend" : "active went quiet")
    }
    if (active !== name) return
    if (name === "wintab-data") { try { mapping?.dataSeen() } catch { /* ignore */ } }
    const out = toSheet(name, run.backend, raw)
    const last = out[out.length - 1]!
    contact = last.inRange && last.tip
    seq++
    const batch: PenBatch = { source: name, seq, samples: out }
    for (const l of [...sampleListeners]) { try { l(batch) } catch { /* ignore */ } }
    if (mapping && name === "wintab-data") {
      const inRange = last.inRange
      if (inRange !== visit) { visit = inRange; mapping.pen(inRange) }
      if (inRange) mapping.observe(last.x, last.y)
    }
  }

  // ---- starting and stopping ----------------------------------------------------------------

  const context = (): BackendContext => ({
    sheetPhysical: null,
    trace,
    // No lease: there is no guard process (the contexts are closed in-process on every exit path and recovered from the journal; see LeaseApi).
    now: deps.now,
    settings: { ...store.get().settings },
  })

  const hook = (name: BackendName, backend: PenBackend, gen: number): Run => {
    const run: Run = {
      backend, gen,
      offs: [
        backend.onSample((b) => onBatch(name, b)),
        backend.onEvent((e) => { if (e.kind === "error") trace.event(name, "error", { message: e.message, fatal: e.fatal }) }),
      ],
    }
    running.set(name, run)
    return run
  }

  const stopOne = (name: BackendName): void => {
    const run = running.get(name)
    if (!run) return
    running.delete(name)
    for (const off of run.offs) { try { off() } catch { /* ignore */ } }
    try { run.backend.stop() } catch (error) { trace.event(name, "stop-error", { message: (error as Error)?.message }) }
    lastAt.delete(name)
    if (isDevice(name)) devices.delete(name)
    if (active === name) {
      // Hand the sheet to whoever else is running at the next batch; end any stroke now.
      active = null
      contact = false
      visit = false
    }
  }

  const stopAll = (): void => {
    generation++
    stopMapping("feed stopped")
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null }
    if (blurTimer !== null) { clearTimer(blurTimer); blurTimer = null }
    for (const name of [...running.keys()]) stopOne(name)
    active = null
    contact = false
    visit = false
  }

  /** Start a device backend (the real Wintab, or the E2E fake tablet) and learn its device. */
  const startDevice = async (name: "wintab-data" | "inject-tablet", backend: PenBackend): Promise<void> => {
    if (running.has(name)) return
    const gen = generation
    hook(name, backend, gen)
    let timer: unknown = null
    const result = await Promise.race([
      backend.start(context()).catch((e: unknown) => ({ ok: false as const, reason: `Wintab start failed: ${(e as Error)?.message ?? String(e)}`, retry: "later" as const })),
      new Promise<{ ok: false; reason: string; retry: "later" }>((resolve) => { timer = setTimer(() => resolve({ ok: false, reason: "Wintab did not start within 4 s", retry: "later" }), LIVENESS.START_TIMEOUT_MS) }),
    ])
    if (timer !== null) clearTimer(timer)
    if (gen !== generation || disposed) { try { backend.stop() } catch { /* ignore */ } return }
    if (result.ok) {
      wintabNote = null
      retries = 0
      if (result.device) devices.set(name, result.device)
      const k = keyOf(result.device ?? undefined)
      trace.event(name, "started", { device: result.device?.name ?? null, key: k, pressureMax: result.device?.pressureMax ?? null })
      syncMapping()
      push()
      return
    }
    // Failed: nothing is held (the backend released what it opened); the window pen carries on, Wintab is tried again later.
    stopOne(name)
    wintabNote = result.reason
    trace.event(name, "start-failed", { reason: result.reason, retry: result.retry })
    push()
    if (name === "wintab-data" && result.retry !== "never" && retries < LIVENESS.BACKOFF_MS.length && wanted()) {
      const wait = LIVENESS.BACKOFF_MS[retries++]!
      retryTimer = setTimer(() => { retryTimer = null; if (wanted() && gen === generation) void startWintab() }, wait)
    }
  }

  const startWintab = async (): Promise<void> => {
    const backend = deps.wintab
    if (!backend || (deps.e2e && !nativeOn)) { wintabNote = backend ? "Wintab is not opened under test" : "Wintab is not available here"; return }
    const avail = backend.available()
    if (!avail.ok) { wintabNote = avail.reason; trace.event("wintab-data", "unavailable", { reason: avail.reason }); return }
    await startDevice("wintab-data", backend)
  }

  const startAll = (): void => {
    if (running.size > 0) return
    trace.event("manager", "start", {})
    const gen = generation
    if (deps.e2e) {
      void deps.inject.start(context()).then(() => undefined, () => undefined)
      hook("inject", deps.inject, gen)
      if (fakeTablet) void startDevice("inject-tablet", deps.injectTablet)
    }
    retries = 0
    void startWintab()
  }

  /** Bring what runs in line with what is wanted. Cheap, idempotent. */
  const reconcile = (): void => {
    if (disposed) return
    if (wanted()) {
      if (blurTimer !== null) { clearTimer(blurTimer); blurTimer = null }
      startAll()
    } else if (running.size > 0) {
      // The mapping lets go at once (the pen is the OS's again); the reading itself keeps a short grace for a window that merely blinked.
      stopMapping("window not in front")
      if (opened && store.get().settings.enabled && panicked === null && deps.available) {
        if (blurTimer === null) blurTimer = setTimer(() => { blurTimer = null; if (!wanted()) { stopAll(); trace.event("manager", "stop", { why: "window not in front" }); push() } }, LIVENESS.BLUR_GRACE_MS)
      } else {
        stopAll()
        trace.event("manager", "stop", { why: opened ? "capture off" : "sheet closed" })
      }
    }
    syncMapping()
    push()
  }

  // ---- the API ------------------------------------------------------------------------------

  const manager: FeedManagerEx = {
    async open() {
      if (!deps.available) return status()
      if (!opened) { opened = true; trace.event("manager", "open", {}) }
      reconcile()
      return status()
    },
    close(reason) {
      if (opened) trace.event("manager", "close", { reason })
      opened = false
      try { mapping?.setSheet(null) } catch { /* ignore */ }
      stopAll()
      push()
    },
    setWindowState(state) {
      const was = effectiveFocused()
      win = { ...state }
      // Coming back to the window ends a panic.
      if (!was && effectiveFocused() && panicked !== null) panicked = null
      reconcile()
    },
    onSamples(l) { sampleListeners.add(l); return () => { sampleListeners.delete(l) } },
    onStatus(l) { statusListeners.add(l); return () => { statusListeners.delete(l) } },
    onEvent(l) { eventListeners.add(l); return () => { eventListeners.delete(l) } },
    status,
    settings: () => ({ ...store.get().settings }),
    update(patch) {
      const before = store.get().settings
      const turnedOn = patch.enabled === true && !before.enabled
      store.update((s) => {
        if (typeof patch.enabled === "boolean") s.settings.enabled = patch.enabled
        if (typeof patch.mapSheet === "boolean") s.settings.mapSheet = patch.mapSheet
      })
      if (turnedOn) panicked = null
      reconcile()
      return { ...store.get().settings }
    },
    setSheet(report) {
      try { mapping?.setSheet(report) } catch (error) { trace.event("manager", "mapping-error", { message: (error as Error)?.message }) }
      push()
    },
    retryMapping() {
      try { mapping?.retry() } catch (error) { trace.event("manager", "mapping-error", { message: (error as Error)?.message }) }
      push()
      return status()
    },
    panic(reason) {
      if (!opened) return
      trace.event("manager", "panic", { reason })
      panicked = reason
      stopAll()
      emitEvent({ kind: "released", reason })
      push()
    },
    inject(samples, backend = "inject") {
      if (!deps.e2e) return
      if (backend === "inject-tablet") deps.injectTablet.push(samples)
      else if (backend === "inject") deps.inject.push(samples)
    },
    e2eConfig(config) {
      if (!deps.e2e) return status()
      if (typeof config.native === "boolean") nativeOn = config.native
      if (typeof config.focused === "boolean") e2eFocused = config.focused
      if (typeof config.tablet === "boolean" && config.tablet !== fakeTablet) {
        fakeTablet = config.tablet
        if (!fakeTablet) stopOne("inject-tablet")
        else if (running.size > 0 && wanted()) void startDevice("inject-tablet", deps.injectTablet)
      }
      if (typeof config.capture === "boolean") {
        store.get().settings.enabled = config.capture
        if (config.capture) panicked = null
      }
      reconcile()
      return status()
    },
    deviceChanged(reason) {
      if (!running.has("wintab-data") && !wanted()) return
      trace.event("manager", "device-changed", { reason })
      stopMapping("device changed")
      stopOne("wintab-data")
      retries = 0
      if (wanted()) void startWintab()
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopAll()
      sampleListeners.clear(); statusListeners.clear(); eventListeners.clear()
    },
  }
  return manager
}
