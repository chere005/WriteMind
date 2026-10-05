/**
 * webhid/webhidBackend.ts - the WebHID pen backend (docs/spikes/DESIGN-pen-capture.md 4.4). Owner: IMPL-B (wimpl-b-webhid).
 *
 * The same HID reports as Raw Input, through a different door: a hidden helper window on its own session ("pen-hid") runs
 * `navigator.hid` (webhid/hostPage.ts, bundled to out/helpers/pen-hid.js), opens the Wacom (ONE HIDDevice with several collections), decodes
 * the primary pen report with the shared decoder and sends the samples to this class over private IPC (webhid/protocol.ts). This class
 * owns the window's life, runs the visit logic for devices without an In Range field, and feeds BackendCore like every other backend.
 *
 *   rank 4 of 7 in the ladder; started last of the native three (manager stage 1, after Wintab and Raw Input have had STAGE_WEBHID_MS).
 *   frameKind "device": x / y are 0..1 over the report's logical range in the device's own orientation; the manager applies the
 *   calibrated FrameTransform. DeviceInfo.aspect comes from the PHYSICAL extents (15200 x 9500 on the real tablet).
 *
 * start() (never throws; settles inside START_BUDGET_MS, which is under the manager's START_TIMEOUT_MS):
 *   1. permissions on the helper's session (VID 056A, "hid" only) and the window (load, then a handshake: the page answered);
 *   2. "start" -> the page lists the permitted devices and opens the pen ones; nothing listed -> one requestDevice with a user gesture;
 *   3. a device open -> {ok:true}; every pen device refused -> {ok:false, "open() refused: ...", retry:"later"}; none present -> armed with the
 *      reason (a hot-plug re-adopts it, and the `device` event tells the manager).
 * stop() is synchronous and idempotent: it destroys the window (which closes every HID handle), puts the session back and cancels timers.
 *
 * Reason strings are the words the chip, the check and the diagnostics show verbatim.
 *
 * Unverified (needs a moving pen): that report 213 streams while Windows Ink reads the same node; real rates; which barrel switch is lower.
 */

import fs from "node:fs"
import type { BackendContext, BackendEvent, BackendStart, BackendStatus, PenBackend, PenSample } from "../../../shared/pen"
import { BackendCore } from "../backendCore"
import { defaultCancel, defaultSchedule, VisitTracker, type Cancel, type Schedule } from "../batcher"
import type { CreateWebHidBackend, WebHidDeps } from "../types"
import { createElectronHost, type WebHidHost, type WebHidHostFactory } from "./electronHost"
import { installHidPermissions, type HidSessionLike } from "./permissions"
import { WACOM_VENDOR_ID, parseHostStatus, parseRaw, parseSamples, type HidHostStatus } from "./protocol"

export const LOAD_BUDGET_MS = 2500
export const HANDSHAKE_BUDGET_MS = 1500
export const START_BUDGET_MS = 3500
/** After a requestDevice, how long to wait for the device to show up. */
export const REQUEST_WAIT_MS = 1000

export interface WebHidBackendOptions {
  hostFactory?: WebHidHostFactory
  /** Install the permission hooks on deps.session; returns the undo. Default: permissions.ts on the real session. */
  installPermissions?: (deps: WebHidDeps, vendorIds: readonly number[]) => () => void
  /** fs.existsSync. */
  exists?: (path: string) => boolean
  vendorIds?: readonly number[]
  schedule?: Schedule
  cancel?: Cancel
  /** Epoch ms, same clock as PenSample.t. Replaced by the context's clock once started. */
  now?: () => number
  loadBudgetMs?: number
  handshakeBudgetMs?: number
  startBudgetMs?: number
  requestWaitMs?: number
  /** Test harnesses only: a script run in the helper page before "start" (plants a pretend navigator.hid). */
  testScript?: string
}

const defaultNow = (): number => performance.timeOrigin + performance.now()

export function describeNoDevice(vendorIds: readonly number[]): string {
  const v = vendorIds.map((id) => id.toString(16).padStart(4, "0")).join(", ")
  return `WebHID lists no device from vendor ${v} (the tablet is not connected, Windows reports it as not working, or the driver does not expose it to Chromium)`
}

type Waiter = { test: (s: HidHostStatus) => boolean; done: (ok: boolean) => void }

export function createWebHidBackendWith(deps: WebHidDeps, options: WebHidBackendOptions = {}): PenBackend {
  const vendorIds = options.vendorIds ?? [WACOM_VENDOR_ID]
  const hostFactory = options.hostFactory ?? createElectronHost
  const exists = options.exists ?? ((p: string) => fs.existsSync(p))
  const schedule = options.schedule ?? defaultSchedule
  const cancel = options.cancel ?? defaultCancel
  const installPermissions =
    options.installPermissions ??
    ((d: WebHidDeps, ids: readonly number[]) => installHidPermissions(d.session as unknown as HidSessionLike, { vendorIds: ids, log: d.log }))

  let nowFn = options.now ?? defaultNow
  const core = new BackendCore("webhid", { now: () => nowFn(), schedule, cancel })
  const tracker = new VisitTracker()

  let host: WebHidHost | null = null
  let undoPermissions: (() => void) | null = null
  let unsubscribe: (() => void)[] = []
  /** Between the beginning of start() and stop(). */
  let running = false
  let gen = 0
  let starting: Promise<BackendStart> | null = null
  let startResult: BackendStart | null = null
  let latest: HidHostStatus | null = null
  let goneWhy: string | null = null
  let waiters: Waiter[] = []
  let tickHandle: unknown = null
  let authoritative = false
  let trace: (name: string, data?: Record<string, unknown>) => void = () => undefined
  let traceRaw: (t: number, hex: string, note: string) => void = () => undefined
  const seenReports = new Map<string, number>()
  const seenDropped = new Map<string, number>()
  const deviceSig = new Map<string, string>()
  let reportedLayout = false

  // ---- waiting for the page -------------------------------------------------------------------

  /** Resolves true when `test(latest status)` holds, false after `ms` or when the backend is stopped / the helper is gone. */
  function waitFor(test: (s: HidHostStatus) => boolean, ms: number): Promise<boolean> {
    if (goneWhy !== null) return Promise.resolve(false)
    if (latest && test(latest)) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let handle: unknown = null
      const entry: Waiter = {
        test,
        done: (ok) => { if (handle !== null) { cancel(handle); handle = null } resolve(ok) },
      }
      waiters.push(entry)
      handle = schedule(() => { handle = null; waiters = waiters.filter((w) => w !== entry); resolve(false) }, Math.max(1, ms))
    })
  }

  function notifyWaiters(): void {
    if (!latest) return
    const cur = latest
    const rest: Waiter[] = []
    for (const w of waiters) { if (w.test(cur)) w.done(true); else rest.push(w) }
    waiters = rest
  }

  function failWaiters(): void {
    const all = waiters
    waiters = []
    for (const w of all) w.done(false)
  }

  /** Race a promise against the clock; the loser's timer is cancelled. */
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ value: T } | { timeout: true } | { error: string }> {
    return new Promise((resolve) => {
      let finished = false
      const handle = schedule(() => { if (!finished) { finished = true; resolve({ timeout: true }) } }, ms)
      p.then(
        (value) => { if (!finished) { finished = true; cancel(handle); resolve({ value }) } },
        (error: unknown) => { if (!finished) { finished = true; cancel(handle); resolve({ error: (error as Error)?.message ?? String(error) }) } },
      )
    })
  }

  // ---- messages from the page -----------------------------------------------------------------

  function armTick(): void {
    if (tickHandle !== null || !running) return
    const d = tracker.nextDeadline(nowFn())
    if (d === null) return
    tickHandle = schedule(() => {
      tickHandle = null
      if (!running) return
      const leave = tracker.tick(nowFn())
      if (leave) core.emit(leave)
      armTick()
    }, Math.max(20, d))
  }

  function onSamples(raw: unknown): void {
    if (!running) return
    for (const s of parseSamples(raw)) {
      const out = tracker.observe(s, nowFn())
      if (s.inRange && authoritative) tracker.proximity(true, nowFn())
      if (out) core.emit(out)
    }
    armTick()
  }

  function onRaw(value: unknown): void {
    if (!running) return
    for (const r of parseRaw(value)) traceRaw(r.t, r.hex, `${r.key} id${r.reportId}`)
  }

  function onStatus(value: unknown): void {
    const s = parseHostStatus(value)
    if (!s) { core.dropped(); return }
    latest = s
    if (running) applyStatus(s)
    notifyWaiters()
  }

  function applyStatus(s: HidHostStatus): void {
    const open = s.devices.filter((d) => d.state === "open")
    authoritative = open.some((d) => d.hasInRange)
    // The page counts reports; main turns the growth into the raw / dropped counters.
    for (const d of s.devices) {
      const before = seenReports.get(d.key) ?? 0
      if (d.reports > before) core.raw(d.reports - before)
      seenReports.set(d.key, d.reports)
      const beforeDrop = seenDropped.get(d.key) ?? 0
      if (d.dropped > beforeDrop) core.dropped(d.dropped - beforeDrop)
      seenDropped.set(d.key, d.dropped)
      const sig = `${d.state}|${d.error ?? ""}|${d.fallbackActive}`
      if (deviceSig.get(d.key) !== sig) {
        deviceSig.set(d.key, sig)
        trace("device", { key: d.key, product: d.productName, vid: d.vendorId, pid: d.productId, state: d.state, error: d.error, primary: d.primary, fallbackActive: d.fallbackActive })
      }
    }
    if (!reportedLayout && s.collections !== undefined) {
      const first = s.devices.find((d) => d.layout)
      reportedLayout = true
      trace("layout", { dev: first?.productName || "HID pen", layout: first?.layout ?? null, collections: first?.collections ?? null, descriptor: s.collections })
    }
    setFacts(s)
    const state = core.getState()
    const primary = open.find((d) => d.info) ?? null
    const current = core.getDevice()
    if (primary?.info && (!current || JSON.stringify(current) !== JSON.stringify(primary.info))) {
      core.setDevice(primary.info)
    }
    if (state === "armed" || state === "live") {
      if (open.length) core.setReason(null)
      else if (s.phase === "started") core.setReason(s.devices.length ? "the WebHID device was closed or has no pen report" : describeNoDevice(vendorIds))
    }
  }

  function setFacts(s: HidHostStatus): void {
    const open = s.devices.filter((d) => d.state === "open")
    const first = open[0] ?? s.devices[0]
    core.fact("helper", running ? "running" : "stopped")
    core.fact("hid", s.hidAvailable)
    core.fact("devices", s.devices.length)
    core.fact("open", open.length)
    core.fact("product", first?.productName || null)
    core.fact("collections", first?.collections ?? null)
    core.fact("primary", first?.primary ?? null)
    core.fact("layout", first?.layout ?? null)
    core.fact("hasInRange", first?.hasInRange ?? null)
    core.fact("vendorFallback", first?.fallback ?? null)
    core.fact("vendorFallbackActive", open.some((d) => d.fallbackActive))
    for (const [id, n] of Object.entries(first?.reportCounts ?? {})) core.fact(`reports.${id}`, n)
    core.fact("error", first?.error ?? null)
    core.fact("note", s.note ?? null)
  }

  // ---- teardown -------------------------------------------------------------------------------

  function teardown(): void {
    if (tickHandle !== null) { cancel(tickHandle); tickHandle = null }
    for (const u of unsubscribe) { try { u() } catch { /* ignore */ } }
    unsubscribe = []
    const h = host
    host = null
    if (h) { try { h.close() } catch { /* ignore */ } }
    const undo = undoPermissions
    undoPermissions = null
    if (undo) { try { undo() } catch { /* ignore */ } }
    failWaiters()
  }

  const last = (): HidHostStatus | null => latest
  const stopped = (): BackendStart => ({ ok: false, reason: "stopped while starting", retry: "later" })

  function failStart(reason: string, retry: "never" | "later" | "after-replug", g: number): BackendStart {
    if (g === gen) {
      running = false
      teardown()
      core.discard()
      core.setState("failed", reason)
    }
    trace("start-failed", { reason, retry })
    return { ok: false, reason, retry }
  }

  // ---- start ----------------------------------------------------------------------------------

  async function doStart(ctx: BackendContext): Promise<BackendStart> {
    const g = ++gen
    nowFn = ctx.now
    trace = (name, data) => ctx.trace.event("webhid", name, data)
    traceRaw = (t, hex, note) => ctx.trace.raw("webhid", t, hex, note)
    core.resetObservations()
    core.setState("starting", null)
    tracker.reset()
    latest = null
    goneWhy = null
    seenReports.clear()
    seenDropped.clear()
    deviceSig.clear()
    reportedLayout = false
    authoritative = false
    const budget = options.startBudgetMs ?? START_BUDGET_MS
    const t0 = Date.now()
    const left = (): number => Math.max(1, budget - (Date.now() - t0))
    const goneNow = (): BackendStart | null => (goneWhy !== null ? failStart(goneWhy, "later", g) : null)
    try {
      running = true
      undoPermissions = installPermissions(deps, vendorIds)
      const h = hostFactory(deps)
      host = h
      unsubscribe.push(h.onMessage({ samples: onSamples, raw: onRaw, status: onStatus }))
      unsubscribe.push(h.onGone((why) => {
        if (g !== gen || !running) return
        goneWhy = why
        if (starting) { failWaiters(); return }
        running = false
        core.setState("failed", why)
        core.error(why, true)
        teardown() // the window is dead or useless: let go of it and the session now, the manager's stop() finds nothing left to do
        core.discard()
      }))

      const loaded = await withTimeout(h.load(), Math.min(left(), options.loadBudgetMs ?? LOAD_BUDGET_MS))
      if (g !== gen) return stopped()
      if ("timeout" in loaded) return failStart("the WebHID helper window did not load in time", "later", g)
      if ("error" in loaded) return failStart(`the WebHID helper window failed to load: ${loaded.error}`, "later", g)

      // Handshake: the page's own first status says the page, the preload bridge and the script are alive.
      const answered = await waitFor(() => true, Math.min(left(), options.handshakeBudgetMs ?? HANDSHAKE_BUDGET_MS))
      if (g !== gen) return stopped()
      if (!answered) return goneNow() ?? failStart("the WebHID helper page did not answer (its script or preload failed to run)", "later", g)

      if (options.testScript) await h.evaluate(options.testScript)
      h.send({ cmd: "start", vendorIds: [...vendorIds] })
      const listed = await waitFor((s) => s.phase === "started", left())
      if (g !== gen) return stopped()
      if (!listed) return goneNow() ?? failStart("WebHID did not finish listing and opening devices in time (getDevices() or open() hung)", "later", g)
      const afterStart = last()
      if (afterStart && !afterStart.hidAvailable) return failStart(afterStart.note ?? "navigator.hid is not available in this Chromium", "never", g)

      if (last()?.devices.length === 0) {
        // Nothing listed: ask once, with a user gesture (the select-hid-device handler picks the Wacom).
        try { await h.requestDevice() } catch (error) { trace("request-device-failed", { message: (error as Error)?.message ?? String(error) }) }
        await waitFor((s) => s.devices.length > 0 && s.devices.every((d) => d.state !== "opening"), Math.min(left(), options.requestWaitMs ?? REQUEST_WAIT_MS))
        if (g !== gen) return stopped()
      }
      const gone = goneNow()
      if (gone) return gone

      const s = last()
      if (!s) return failStart("the WebHID helper page sent no status", "later", g)
      applyStatus(s)
      const open = s.devices.filter((d) => d.state === "open")
      let result: BackendStart
      if (open.length) {
        core.setState("armed", null)
        result = { ok: true, device: open.find((d) => d.info)?.info ?? null }
      } else if (s.devices.some((d) => d.state === "failed")) {
        return failStart(s.devices.find((d) => d.state === "failed")?.error ?? "open() refused", "later", g)
      } else if (s.devices.length) {
        const why = s.devices.map((d) => `${d.productName || "device"}: ${d.error ?? d.state}`).join("; ")
        core.setState("armed", `WebHID found ${s.devices.length === 1 ? "a device" : `${s.devices.length} devices`} but none with a pen report (${why})`)
        result = { ok: true, device: null }
      } else {
        core.setState("armed", describeNoDevice(vendorIds))
        result = { ok: true, device: null }
      }
      trace("armed", { devices: s.devices.length, open: open.length, reason: core.getReason() })
      return result
    } catch (error) {
      return failStart(`WebHID start threw: ${(error as Error)?.message ?? String(error)}`, "later", g)
    }
  }

  // ---- the backend ----------------------------------------------------------------------------

  const backend: PenBackend = {
    name: "webhid",
    frameKind: "device",

    available() {
      if (!exists(deps.page)) return { ok: false, reason: "the WebHID helper page is missing (out/helpers/pen-hid.html): rebuild the app" }
      if (!exists(deps.preload)) return { ok: false, reason: "the WebHID helper preload is missing (out/preload/pen-hid.cjs): rebuild the app" }
      return { ok: true }
    },

    async start(ctx) {
      if (starting) return starting
      if (running && startResult) return startResult
      const a = backend.available()
      if (!a.ok) {
        core.setState("unavailable", a.reason)
        return { ok: false, reason: a.reason, retry: "never" }
      }
      startResult = null
      const p = doStart(ctx).then((r) => { if (r.ok) startResult = r; return r })
      starting = p
      void p.finally(() => { if (starting === p) starting = null }).catch(() => undefined)
      return p
    },

    stop() {
      gen++ // an unfinished start() notices and lets go
      running = false
      startResult = null
      teardown()
      core.discard()
      tracker.reset()
      authoritative = false
      const st = core.getState()
      if (st !== "failed" && st !== "unavailable") core.setState("idle", null)
    },

    onSample: (listener: (batch: PenSample[]) => void) => core.onSample(listener),
    onEvent: (listener: (event: BackendEvent) => void) => core.onEvent(listener),
    status: (): BackendStatus => core.status(),
  }
  return backend
}

export const createWebHidBackend: CreateWebHidBackend = (deps) => createWebHidBackendWith(deps)
