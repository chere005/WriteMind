/**
 * main/pen/manager.ts - the FeedManager (docs/spikes/DESIGN-pen-capture.md sections 5 and 6.3), owned by IMPL-D.
 *
 * ONE AUTHORITY. It owns which backend is running, whether each is alive, which one feeds the sheet, the frame that takes a
 * backend's samples to the screen frame, the persisted winner, the trace, the setup check and the feed to containment. The
 * renderer only consumes `pen:samples` / `pen:status-push` / `pen:event`.
 *
 * The manager is plain TypeScript over injected pieces (backends, clock, state store, trace, containment, check engine,
 * screen helpers) so every scenario of design 15.2 runs in vitest with fake timers and `FakeBackend`s and nothing here
 * touches Electron, the OS or the real tablet.
 *
 * LIVE means: at least LIVENESS.LIVE_MIN_SAMPLES in-range samples inside LIVE_WINDOW_MS, one of which moved. STALE needs a
 * witness (the pen demonstrably moving, seen from somewhere else). Silence with no witness only means the pen is not here.
 * The first samples of a backend that is not active yet are kept (`unsent`) and handed to the sheet when it becomes active,
 * so the four samples it takes to prove liveness are not the four samples missing from the stroke.
 */

import {
  BACKEND_ORDER, CHECK_STEPS, LIVENESS, applyFrame, clamp01, isTabletNative, sampleFlags,
  type BackendContext, type BackendName, type BackendState, type BackendStatus, type Box, type CheckReport, type CheckSnapshot,
  type CheckStepId, type ContainmentStatus, type ContainmentTestResult, type Counters, type DeviceInfo, type EnvSummary,
  type FeedEvent, type FeedManager, type FeedSeverity, type FeedStatus, type FrameRecord, type FrameTransform, type PenBackend,
  type PenBatch, type PenFeedSettings, type PenSample, type SheetGeometry, type TraceSink, type WindowState, type Witness,
} from "../../shared/pen"
import { defaultFrame, frameKey, inferFrameFromPairs, type FramePair } from "./frame"
import { clearFault, type StateStore } from "./state"
import { emptyCounters, emptyStatus } from "./fake"
import { isSystemMapped, type CheckEngine, type Containment, type ContainmentInput } from "./types"

// ---------------------------------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------------------------------

export interface ManagerDeps {
  /** False off Windows: the status says so and nothing starts. */
  available: boolean
  /** Create (once) the backend for a name. The registry decides which are inert (E2E, wrong platform). */
  makeBackend(name: BackendName): PenBackend
  store: StateStore
  trace: TraceSink
  lease: import("../../shared/pen").LeaseApi
  containment: Containment
  /** Epoch ms, fractional. */
  now(): number
  /** WRITEMIND_E2E: the window counts as in front, native backends are off unless `native`, `inject` exists. */
  e2e: boolean
  /** WRITEMIND_PEN_NATIVE=1 (or e2eConfig native:true). */
  native: boolean
  check: CheckEngine
  env(): EnvSummary | null
  /** The sheet in physical screen pixels (screen.dipToScreenRect), or null. */
  sheetToPhysical(sheet: SheetGeometry): Box | null
  /** A point in DIP on the virtual desktop as a fraction of the display that contains it. */
  displayFraction(dip: { x: number; y: number }): { x: number; y: number } | null
  /** The OS cursor as a display fraction (calibration pairs); null when unavailable. */
  cursorFraction(): { x: number; y: number } | null
  /** The pointer-device in/out of range witness (IMPL-B); started and stopped with the feed. */
  pointerRange?(onWitness: (w: Witness) => void): { start(): boolean; stop(): void }
  displayInfo(): { bounds: Box; scale: number } | null
  /** Called from the exit path of the app too. */
  log(line: string): void
}

/** The things the manager offers beyond `FeedManager`, used by ipc.ts and the tests. */
export interface FeedManagerEx extends FeedManager {
  /** Re-plug / resume / unlock: forget failures and demotion, restart what failed. */
  deviceChanged(reason: string): void
  setFrame(frame: FrameTransform | null): FeedStatus
  checkStart(): CheckSnapshot
  checkStep(id: CheckStepId): CheckSnapshot
  checkCancel(): CheckSnapshot
  checkSnapshot(): CheckSnapshot
  lastReport(): CheckReport | null
  onCheck(listener: (snapshot: CheckSnapshot) => void): () => void
  containTest(mechanism: "driver" | "sink"): Promise<ContainmentTestResult>
  /** E2E: pin the backends / native switch / focus; `capture` turns pen capture on or off (it starts OFF under E2E, design invariant 9). */
  e2eConfig(config: { native?: boolean; backends?: BackendName[]; focused?: boolean; capture?: boolean }): FeedStatus
  /** The backends that have been created (the diagnostics read their facts). */
  backendNames(): BackendName[]
  sheet(): SheetGeometry | null
  /** The frame in force for a backend (the check proposes frames against it), or null. */
  frameOf(name: BackendName): FrameRecord | null
  /** The setup check is running (the sink must not absorb the window's pen events while it measures them, design 7.4). */
  checking(): boolean
}

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers (pure; exported for the tests)
// ---------------------------------------------------------------------------------------------------------------------

export const BACKEND_LABEL: Record<BackendName, string> = {
  inject: "Test", "wintab-system": "Wintab (mapped)", "wintab-data": "Wintab", rawinput: "Raw HID", webhid: "WebHID", dom: "Window pen", overlay: "Overlay",
}

const priority = (name: BackendName): number => BACKEND_ORDER.indexOf(name)
/** `dom`, `overlay` and `inject` deliver the screen frame already ("screen"); the rest are device-frame families. */
const familyOf = (name: BackendName): "wintab" | "hid" | "screen" =>
  name === "wintab-system" || name === "wintab-data" ? "wintab" : name === "rawinput" || name === "webhid" ? "hid" : "screen"

/** The backends that make native calls or start a helper process: the crash breadcrumb (design 5.8) is for them and for no other. */
export const hasBreadcrumb = (name: BackendName): boolean => isTabletNative(name)

/** Pearson correlation; 0 when either side is constant. */
function pearson(a: number[], b: number[]): number {
  const n = a.length
  if (n < 2) return 0
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]!; mb += b[i]! }
  ma /= n; mb /= n
  let sa = 0, sb = 0, c = 0
  for (let i = 0; i < n; i++) { const da = a[i]! - ma, db = b[i]! - mb; sa += da * da; sb += db * db; c += da * db }
  return sa < 1e-12 || sb < 1e-12 ? 0 : c / Math.sqrt(sa * sb)
}

/** How well a FRAME explains pairs of (device sample, where the pointer stack says the pen is): the smaller axis correlation. */
export function frameScore(pairs: FramePair[], frame: FrameTransform): number {
  const t = pairs.map((p) => applyFrame(p.raw.x, p.raw.y, frame))
  return Math.min(pearson(t.map((q) => q[0]), pairs.map((p) => p.screen.x)), pearson(t.map((q) => q[1]), pairs.map((p) => p.screen.y)))
}

function p95(values: number[]): number | null {
  if (values.length < 5) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!
}

/** The headline for the chip (design 8.7), pure so the table is a test. */
export function headlineFor(input: {
  available: boolean; enabled: boolean; released: string | null; active: BackendName | null; rateHz: number | null
  contained: string | null; backends: (Pick<BackendStatus, "name" | "state" | "reason"> & { facts?: BackendStatus["facts"] })[]
  /** Kept for callers that still pass it; revision 2 has no "pointer only" row (a pen Windows delivers is always carried by `dom`). */
  witnessRecent?: boolean
  env: EnvSummary | null; opened: boolean
  /** The active device-frame backend still runs on a guessed frame (design 5.4, 6.2). */
  guessed?: boolean
  /** Backends the crash breadcrumb switched off (design 5.8). */
  faults?: BackendName[]
}): { headline: string; severity: FeedSeverity } {
  if (!input.available) return { headline: "", severity: "off" }
  if (!input.enabled) return { headline: "Pen: capture off", severity: "off" }
  if (input.released) return { headline: "Pen: released - click the window", severity: "wait" }
  const faults = input.faults ?? []
  const crash = faults.length > 0 ? ` - ${faults.map((n) => BACKEND_LABEL[n]).join(" / ")} is off after a crash` : ""
  const rate = input.rateHz !== null ? ` - ${Math.round(input.rateHz)} Hz` : ""
  const held = input.contained ? ` - contained: ${input.contained}` : ""
  const stale = input.backends.find((b) => b.state === "stale" && isTabletNative(b.name))
  if (input.active) {
    if (isTabletNative(input.active) || input.active === "inject") {
      const guess = input.guessed ? " - direction guessed" : ""
      return { headline: `Pen: ${BACKEND_LABEL[input.active]}${rate}${held}${guess}`, severity: "ok" }
    }
    // The pen is carried by `dom` or `overlay`, the floor under every native backend.
    if (stale) return { headline: `Pen: ${BACKEND_LABEL[stale.name]} is silent${crash}`, severity: "warn" }
    if (input.active === "dom") {
      const reach = reachOf(input.backends)
      const tail = reach !== null && reach < 0.9 ? ` - reaches ${Math.round(reach * 100)}% of the tablet` : rate
      return { headline: `Pen: window pointer${tail}${held}${crash}`, severity: "warn" }
    }
    return { headline: `Pen: ${BACKEND_LABEL[input.active]}${rate}${held}${crash}`, severity: "warn" }
  }
  const nothingLive = !input.backends.some((b) => b.state === "live")
  const tablet = input.env?.tablet
  if (nothingLive && tablet) {
    if (tablet.present && tablet.problem) {
      return { headline: `Pen: no tablet (Windows: ${/^\d+$/.test(tablet.problem) ? "problem " : ""}${tablet.problem})`, severity: "error" }
    }
    if (!tablet.present && !tablet.note) return { headline: "Pen: no tablet", severity: "error" }
  }
  if (stale) return { headline: `Pen: ${BACKEND_LABEL[stale.name]} is silent${crash}`, severity: "warn" }
  const usable = input.backends.filter((b) => isTabletNative(b.name)
    && (b.state === "armed" || b.state === "starting" || b.state === "live" || b.state === "idle"))
  if (input.opened && usable.length === 0) return { headline: `Pen: no native feed - touch the tablet${crash}`, severity: "warn" }
  return { headline: `Pen: ready - touch the tablet${crash}`, severity: crash ? "warn" : "wait" }
}

/** How much of the tablet the window pen reaches: the smaller of its two coverage facts (design 4.7), or null when it has none. */
function reachOf(backends: { name: BackendName; facts?: BackendStatus["facts"] }[]): number | null {
  const facts = backends.find((b) => b.name === "dom")?.facts
  const x = facts?.["coverage.x"], y = facts?.["coverage.y"]
  return typeof x === "number" && typeof y === "number" ? Math.min(x, y) : null
}

// ---------------------------------------------------------------------------------------------------------------------
// The runtime record of one backend
// ---------------------------------------------------------------------------------------------------------------------

interface Runtime {
  name: BackendName
  backend: PenBackend
  state: BackendState
  reason: string | null
  /** Bumped on every start and stop: a late start() result for an older generation is discarded. */
  gen: number
  unsub: (() => void)[]
  counters: Counters
  lastSampleAt: number | null
  lastInRangeAt: number | null
  /** Arrival times of in-range samples inside LIVE_WINDOW_MS and whether each moved. */
  recent: { at: number; moved: boolean }[]
  prev: PenSample | null
  /** Sample times (the samples' own clock) for the rate, and the gaps for p95. */
  times: number[]
  gaps: number[]
  seen: BackendStatus["seen"]
  reach: { x: [number, number]; y: [number, number] } | null
  pressureMaxSeen: number
  liveSince: number | null
  staleSince: number | null
  startedAt: number | null
  witnessesWhileArmed: number
  // failure bookkeeping
  failures: number
  witnessedFailures: number
  nextRetryAt: number | null
  retry: "never" | "later" | "after-replug" | null
  // frame
  device: DeviceInfo | null
  frame: FrameRecord | null
  frameKeyed: string | null
  pendingFrame: FrameRecord | null
  pairs: FramePair[]
  pairsSinceFit: number
  disagree: string | null
  lowAgreement: number
  agreement: number | null
  /** The last device-frame in-range samples with their arrival times, for pairing with witnesses. */
  rawRing: { at: number; x: number; y: number }[]
  lastPair: { raw: { x: number; y: number }; screen: { x: number; y: number } } | null
  // what has not reached the sheet yet (post-frame), and the last position that did
  unsent: { at: number; sample: PenSample }[]
  lastOut: PenSample | null
  tipDown: boolean
  visitOpen: boolean
  traced: { smp: number; seen: number }
  /** When start() last resolved ok: the crash breadcrumb is cleared NATIVE_SAFE_MS after this (design 5.8). */
  runningSince: number | null
}

const newRuntime = (name: BackendName, backend: PenBackend): Runtime => ({
  name, backend, state: "idle", reason: null, gen: 0, unsub: [], counters: emptyCounters(), lastSampleAt: null, lastInRangeAt: null,
  recent: [], prev: null, times: [], gaps: [], seen: { pressure: false, lower: false, upper: false, eraser: false, tilt: false, moved: false },
  reach: null, pressureMaxSeen: 0, liveSince: null, staleSince: null, startedAt: null, witnessesWhileArmed: 0,
  failures: 0, witnessedFailures: 0, nextRetryAt: null, retry: null, device: null, frame: null, frameKeyed: null, pendingFrame: null,
  pairs: [], pairsSinceFit: 0, disagree: null, lowAgreement: 0, agreement: null, rawRing: [], lastPair: null, unsent: [], lastOut: null,
  tipDown: false, visitOpen: false, traced: { smp: 0, seen: 0 }, runningSince: null,
})

const WINNER_AFTER_MS = 3000
const WINNER_MIN_SAMPLES = 30
const TICK_MS = 100
const PAIR_MAX = 400
const FIT_EVERY = 40
const PAIR_JOIN_MS = 40
const MOUSE_QUIET_MS = 200
const NO_WITNESS_STAGES_MS = 20000
const SETTLE_FIRST_MS = 3000
const CHECK_TICK_MS = 250
const STATUS_COUNTER_MS = 250
const UNSENT_MAX = 256

export function createFeedManager(deps: ManagerDeps): FeedManagerEx {
  const { store, trace, containment, check } = deps
  // The settings object is mutated in place: BackendContext.settings is a live view.
  const settings: PenFeedSettings = { ...store.get().settings, backends: { ...store.get().settings.backends } }
  const runtimes = new Map<BackendName, Runtime>()
  const sampleListeners = new Set<(b: PenBatch) => void>()
  const statusListeners = new Set<(s: FeedStatus) => void>()
  const eventListeners = new Set<(e: FeedEvent) => void>()
  const checkListeners = new Set<(s: CheckSnapshot) => void>()

  let disposed = false
  let wanted = false
  let suspended = false
  let released: string | null = null
  let sheet: SheetGeometry | null = null
  let sheetPhysical: Box | null = null
  let windowState: WindowState = { focused: true, visible: true, minimized: false }
  let focusedOverride: boolean | null = null
  let native = deps.native
  let pinned: BackendName[] | null = null
  let blurTimer: ReturnType<typeof setTimeout> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let openedAt = 0
  let firstWitnessAt: number | null = null
  let stageClock = 0
  let witnessSeen = false
  let lastWitnessAt: number | null = null
  let lastPenWitnessAt: number | null = null
  let lastMouseWitnessAt = -Infinity
  let pointerRangeIn = false
  let pointerRangeHandle: { start(): boolean; stop(): void } | null = null
  let active: BackendName | null = null
  let seq = 0
  let lastPenAt: number | null = null
  let lastSignature = ""
  let counterTimer: ReturnType<typeof setTimeout> | null = null
  let lastReport: CheckReport | null = null
  let checkRunning = false
  let checkTimer: ReturnType<typeof setInterval> | null = null
  let checkOrder: CheckStepId[] = []
  let winnerSince: { name: BackendName; at: number; samples: number } | null = null
  let lastSt = 0
  let domTraced = 0
  let domSeen = 0
  let curTraced = 0
  let lastCursorAt = 0
  let lastCursorPoll: { x: number; y: number } | null = null
  let overrun = false

  const iso = (): string => new Date(deps.now()).toISOString()
  const tr = (name: string, data?: Record<string, unknown>, source: Parameters<TraceSink["event"]>[0] = "manager"): void => {
    try { trace.event(source, name, data) } catch { /* a trace is never worth a crash */ }
  }
  const record = (kind: "smp" | "dom" | "cur" | "st", data: Record<string, unknown>): void => {
    try {
      if (trace.record) trace.record(kind, data)
      else trace.event("manager", kind, data)
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The crash breadcrumb (design 5.8): `inFlight` is set before a native backend starts and cleared when it is safe.
  // -------------------------------------------------------------------------------------------------------------------

  function markInFlight(name: BackendName): void {
    if (!hasBreadcrumb(name)) return
    try {
      store.update((s) => { s.inFlight[name] = iso() })
      store.flushSync()
    } catch { /* a breadcrumb that cannot be written is not worth a crash */ }
  }
  function clearInFlight(name: BackendName): void {
    if (!(name in store.get().inFlight)) return
    try {
      store.update((s) => { delete s.inFlight[name] })
      store.flushSync()
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Backends: creating, candidate lists, starting, failing, stopping
  // -------------------------------------------------------------------------------------------------------------------

  const runtimeOf = (name: BackendName): Runtime => {
    let rt = runtimes.get(name)
    if (!rt) {
      rt = newRuntime(name, deps.makeBackend(name))
      runtimes.set(name, rt)
    }
    return rt
  }

  /** `inject` and `dom` need no driver and no OS resource, so they run under E2E; everything else is off there unless asked for (design 4.6, invariant 9). */
  const nativeOff = (name: BackendName): string | null =>
    deps.e2e && !native && name !== "inject" && name !== "dom" ? "native pen backends are off under E2E" : null

  /** Can this backend ever run here, right now? (A reason when it cannot.) */
  function unavailableReason(name: BackendName): string | null {
    if (name === "inject") return deps.e2e ? null : "only under WRITEMIND_E2E"
    const off = nativeOff(name)
    if (off) return off
    if (settings.backends[name] === false) {
      const fault = store.get().faults[name]
      return fault ? "switched off after the app stopped while it was starting (turn it on again in the Pen menu to retry)" : "switched off in the settings"
    }
    try {
      const a = runtimeOf(name).backend.available()
      return a.ok ? null : a.reason
    } catch (error) { return `available() threw: ${(error as Error).message}` }
  }

  const demoted = (name: BackendName): boolean => {
    const until = store.get().demoted[name]
    return !!until && Date.parse(until) > deps.now()
  }

  /** The backends the ladder may start now (design 5.3.1). */
  function candidates(forCheck = false): BackendName[] {
    let list = BACKEND_ORDER.filter((n) => unavailableReason(n) === null)
    if (pinned) list = list.filter((n) => pinned!.includes(n))
    if (!forCheck) list = list.filter((n) => !demoted(n) || settings.prefer === n)
    // `prefer` narrows the NATIVE candidates to one; the window pen stays on beside it as the standby (unless it is the preferred one),
    // and the overlay stays when the sink may arm (it is a view on the sink, not another door: design 5.3.1, 4.5).
    if (!forCheck && settings.prefer) {
      list = list.filter((n) => n === settings.prefer || n === "inject" || n === "dom" || (n === "overlay" && containment.sinkWanted()))
    }
    // The system context is never part of the 20 s check (an opt-in test); the overlay backend only when the sink may arm.
    if (forCheck) list = list.filter((n) => n !== "wintab-system")
    else if (!containment.driverMappingWanted()) list = list.filter((n) => n !== "wintab-system")
    if (!containment.sinkWanted()) list = list.filter((n) => n !== "overlay")
    return list
  }

  const inFront = (): boolean => {
    if (focusedOverride !== null) return focusedOverride
    if (deps.e2e) return true
    return windowState.focused && windowState.visible && !windowState.minimized
  }

  const mayRun = (): boolean => deps.available && !disposed && wanted && settings.enabled && !suspended && (inFront() || checkRunning)

  function attach(rt: Runtime): void {
    rt.unsub.push(rt.backend.onSample((batch) => { try { onBatch(rt, batch) } catch (error) { tr("batch-error", { backend: rt.name, message: (error as Error).message }) } }))
    rt.unsub.push(rt.backend.onEvent((event) => { try { onBackendEvent(rt, event) } catch { /* ignore */ } }))
  }
  function detach(rt: Runtime): void {
    for (const u of rt.unsub) { try { u() } catch { /* ignore */ } }
    rt.unsub = []
  }

  function applyDevice(rt: Runtime, device: DeviceInfo | null): void {
    rt.device = device
    if (!device || rt.backend.frameKind === "screen") {
      rt.frame = { frame: { turn: 0, flipY: false }, source: "screen", rms: null, margin: null, at: iso() }
      return
    }
    const key = frameKey(familyOf(rt.name), device.name, device.rawX ? device.rawX[1] - device.rawX[0] : null, device.rawY ? device.rawY[1] - device.rawY[0] : null)
    if (key === rt.frameKeyed && rt.frame) return
    rt.frameKeyed = key
    const saved = store.get().frames[key]
    if (saved) rt.frame = saved
    else {
      const w = device.rawX ? device.rawX[1] - device.rawX[0] : null
      const h = device.rawY ? device.rawY[1] - device.rawY[0] : null
      rt.frame = { frame: defaultFrame(familyOf(rt.name), w, h), source: "default", rms: null, margin: null, at: iso() }
    }
    const prior = store.get().device
    if (!prior || prior.key !== key) {
      store.update((s) => {
        s.device = { key, name: device.name, seenAt: iso() }
        // A different tablet invalidates the stored winner (design 5.6).
        if (prior && prior.key !== key) s.winner = null
      })
    }
    tr("frame", { backend: rt.name, source: rt.frame.source, turn: rt.frame.frame.turn, flipY: rt.frame.frame.flipY, key }, "manager")
  }

  function ensureFrame(rt: Runtime): FrameRecord {
    if (!rt.frame) {
      if (rt.backend.frameKind === "screen") rt.frame = { frame: { turn: 0, flipY: false }, source: "screen", rms: null, margin: null, at: iso() }
      else applyDevice(rt, rt.device ?? rt.backend.status().device)
      if (!rt.frame) rt.frame = { frame: defaultFrame(familyOf(rt.name), null, null), source: "default", rms: null, margin: null, at: iso() }
    }
    return rt.frame
  }

  /** Fire and forget, guarded: nothing a backend does may escape as an unhandled rejection (design 14.1 #20). */
  function go(name: BackendName, why: string, ignoreDemotion = false): void {
    startBackend(name, why, ignoreDemotion).catch((error: unknown) => tr("start-error", { backend: name, message: (error as Error)?.message ?? String(error) }))
  }

  async function startBackend(name: BackendName, why: string, ignoreDemotion = false): Promise<void> {
    if (!ignoreDemotion && demoted(name) && settings.prefer !== name) return
    const rt = runtimeOf(name)
    if (rt.state === "starting" || rt.state === "armed" || rt.state === "live" || rt.state === "stale") return
    const reason = unavailableReason(name)
    if (reason) { rt.state = "unavailable"; rt.reason = reason; tr("unavailable", { backend: name, reason }); markDirty(true); return }
    const gen = ++rt.gen
    rt.state = "starting"
    rt.reason = null
    rt.startedAt = deps.now()
    rt.nextRetryAt = null
    rt.witnessesWhileArmed = 0
    detach(rt)
    attach(rt)
    tr("start", { backend: name, why })
    markDirty(true)
    const ctx: BackendContext = { sheetPhysical, trace, lease: deps.lease, now: deps.now, settings }
    // THE CRASH BREADCRUMB (design 5.8): written, synchronously, BEFORE a backend that makes native calls is started.
    markInFlight(name)
    let timer: ReturnType<typeof setTimeout> | null = null
    const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), LIVENESS.START_TIMEOUT_MS) })
    let result: Awaited<ReturnType<PenBackend["start"]>> | "timeout"
    try {
      result = await Promise.race([rt.backend.start(ctx), timedOut])
    } catch (error) {
      result = { ok: false, reason: `start() threw: ${(error as Error).message}`, retry: "later" }
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (rt.gen !== gen) {
      // Stopped (or restarted) while starting: let go of whatever it opened.
      try { rt.backend.stop() } catch { /* ignore */ }
      return
    }
    if (result === "timeout") {
      try { rt.backend.stop() } catch { /* ignore */ }
      fail(rt, "start timed out", "later")
      return
    }
    if (!result.ok) { fail(rt, result.reason, result.retry); return }
    rt.runningSince = deps.now()
    rt.state = "armed"
    applyDevice(rt, result.device ?? rt.backend.status().device)
    if (isSystemMapped(rt.backend)) rt.backend.setSheetPhysical(sheetPhysical)
    tr("armed", { backend: name, device: result.device?.name ?? null })
    markDirty(true)
  }

  function stopBackend(rt: Runtime, why: string, to: BackendState = "idle"): void {
    rt.gen++
    const was = rt.state
    detach(rt)
    try { rt.backend.stop() } catch (error) { tr("stop-error", { backend: rt.name, message: (error as Error).message }) }
    clearInFlight(rt.name)
    rt.runningSince = null
    if (rt.state !== "unavailable") rt.state = to
    rt.liveSince = null
    rt.staleSince = null
    rt.recent = []
    rt.unsent = []
    rt.tipDown = false
    rt.visitOpen = false
    rt.prev = null
    if (was !== "idle") tr("stop", { backend: rt.name, why })
    if (active === rt.name) reselect(why)
    markDirty(true)
  }

  function stopAll(why: string): void {
    for (const rt of runtimes.values()) if (rt.state !== "idle" && rt.state !== "unavailable") stopBackend(rt, why)
    if (active !== null) setActive(null, why)
  }

  function fail(rt: Runtime, reason: string, retry: "never" | "later" | "after-replug", keepBreadcrumb = false): void {
    rt.gen++
    detach(rt)
    try { rt.backend.stop() } catch { /* ignore */ }
    // A start that failed (not ok, threw, timed out) or a backend that went silent means the app survived: the breadcrumb goes. A FATAL error the
    // backend reported itself (a canary break, a wedged driver call) keeps it (design 15.2 #32), so the next launch is careful.
    if (!keepBreadcrumb) clearInFlight(rt.name)
    rt.runningSince = null
    rt.reason = reason
    rt.retry = retry
    rt.liveSince = null
    rt.staleSince = null
    rt.recent = []
    rt.unsent = []
    const witnessed = witnessActive()
    if (retry === "never") {
      rt.state = "unavailable"
      rt.nextRetryAt = null
    } else {
      rt.state = "failed"
      rt.failures++
      if (witnessed) rt.witnessedFailures++
      if (retry === "later") {
        const wait = LIVENESS.BACKOFF_MS[Math.min(rt.failures - 1, LIVENESS.BACKOFF_MS.length - 1)]
        rt.nextRetryAt = rt.failures > LIVENESS.BACKOFF_MS.length ? null : deps.now() + wait!
      } else rt.nextRetryAt = null
      if (rt.witnessedFailures >= 3 && !demoted(rt.name)) {
        const until = new Date(deps.now() + LIVENESS.DEMOTE_MS).toISOString()
        store.update((s) => { s.demoted[rt.name] = until })
        tr("demoted", { backend: rt.name, until })
        rt.nextRetryAt = null
      }
    }
    tr("start-failed", { backend: rt.name, reason, retry, failures: rt.failures })
    if (active === rt.name) reselect("failed")
    emit({ kind: "lost", backend: rt.name, reason })
    markDirty(true)
  }

  function onBackendEvent(rt: Runtime, event: import("../../shared/pen").BackendEvent): void {
    switch (event.kind) {
      case "error":
        rt.counters.errors++
        tr("error", { backend: rt.name, message: event.message, fatal: event.fatal })
        if (event.fatal) fail(rt, event.message, "later", true)
        break
      case "device":
        applyDevice(rt, event.info)
        if (event.info && (rt.state === "failed" || rt.state === "armed")) {
          // A device (re)arrived: forget the failures and try again.
          rt.failures = 0; rt.witnessedFailures = 0
          if (rt.state === "failed" && mayRun()) { rt.state = "idle"; go(rt.name, "device arrived") }
        }
        break
      case "proximity":
        tr("proximity", { backend: rt.name, inRange: event.inRange })
        break
      case "note":
        tr("note", { backend: rt.name, text: event.text })
        break
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Witnesses
  // -------------------------------------------------------------------------------------------------------------------

  function witnessActive(at = deps.now()): boolean {
    if (pointerRangeIn) return true
    return lastPenWitnessAt !== null && at - lastPenWitnessAt <= LIVENESS.WITNESS_HOLD_MS
  }

  function witness(w: Witness): void {
    const at = deps.now()
    lastWitnessAt = at
    if (w.source === "dom" && w.pointerType === "mouse") { lastMouseWitnessAt = at; return }
    if (w.source === "pointer-range") {
      pointerRangeIn = w.inRange
      tr("pointer-range", { inRange: w.inRange }, "manager")
    }
    if (w.inRange || w.source === "pointer-range") {
      if (w.inRange) lastPenWitnessAt = at
      if (w.inRange && !witnessSeen) { witnessSeen = true; firstWitnessAt = at; stageClock = at }
      if (w.inRange) { lastPenAt = at }
    }
    if (w.source === "dom") {
      domSeen++
      if (domSeen <= 100 || (domSeen % 10 === 0 && domTraced < 1500)) {
        domTraced++
        record("dom", { t: at, ty: w.inRange ? "pen" : "out", pt: w.pointerType ?? "pen", x: w.screenDip?.x ?? null, y: w.screenDip?.y ?? null, bu: w.buttons ?? 0 })
      }
    }
    if (w.inRange) for (const rt of runtimes.values()) if (rt.state === "armed") rt.witnessesWhileArmed++
    // A pair needs where the pen is on the display: from the page (screenDip, converted here) or already as a fraction (the pen sink's events).
    if (w.source === "dom" && w.inRange && (w.screenDip || w.screen)) {
      const screen = w.screen ?? (w.screenDip ? deps.displayFraction(w.screenDip) : null)
      if (screen) addPairs(screen, "dom", at)
    }
    if (checkRunning) check.witness({ ...w, at: w.at })
    touchContainment()
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Calibration (design 6.3)
  // -------------------------------------------------------------------------------------------------------------------

  function addPairs(screen: { x: number; y: number }, source: "dom" | "cursor", at: number): void {
    if (at - lastMouseWitnessAt < MOUSE_QUIET_MS) return
    for (const rt of runtimes.values()) {
      if (rt.backend.frameKind !== "device") continue
      if (rt.state !== "armed" && rt.state !== "live" && rt.state !== "stale") continue
      const near = rt.rawRing.filter((r) => Math.abs(r.at - at) <= PAIR_JOIN_MS)
      if (near.length === 0) continue
      const raw = near.reduce((best, r) => (Math.abs(r.at - at) < Math.abs(best.at - at) ? r : best))
      const last = rt.lastPair
      if (last && Math.hypot(raw.x - last.raw.x, raw.y - last.raw.y) < 1e-3) continue
      if (last && Math.hypot(screen.x - last.screen.x, screen.y - last.screen.y) < 1e-3) continue
      rt.lastPair = { raw: { x: raw.x, y: raw.y }, screen: { x: screen.x, y: screen.y } }
      rt.pairs.push({ raw: { x: raw.x, y: raw.y }, screen: { x: screen.x, y: screen.y } })
      if (rt.pairs.length > PAIR_MAX) rt.pairs.shift()
      rt.pairsSinceFit++
      if (rt.pairsSinceFit >= FIT_EVERY || (rt.pairs.length === 24 && rt.frame?.source === "default")) fitFrame(rt, source)
    }
  }

  function fitFrame(rt: Runtime, source: "dom" | "cursor"): void {
    rt.pairsSinceFit = 0
    const cur = ensureFrame(rt)
    const fit = inferFrameFromPairs(rt.pairs)
    if (fit.frame) {
      const better = cur.source === "default" || ((cur.source === "cursor" || cur.source === "dom") && (cur.margin ?? 0) < fit.margin)
      if (better && !(cur.source === "manual" || cur.source === "strokes")) {
        const rec: FrameRecord = { frame: fit.frame, source, rms: null, margin: fit.margin, at: iso() }
        const changed = cur.frame.turn !== fit.frame.turn || cur.frame.flipY !== fit.frame.flipY
        if (changed && rt.tipDown) rt.pendingFrame = rec
        else setFrameRecord(rt, rec, `fit score ${fit.score.toFixed(2)}`)
        rt.disagree = null
        rt.lowAgreement = 0
      }
      rt.agreement = fit.score
    }
    // The agreement monitor: a frame that came from measurements must keep explaining new pairs.
    if (cur.source === "cursor" || cur.source === "dom" || cur.source === "strokes") {
      if (rt.pairs.length >= 60) {
        const score = frameScore(rt.pairs.slice(-120), cur.frame)
        rt.agreement = score
        rt.lowAgreement = score < 0.6 ? rt.lowAgreement + 1 : 0
        if (rt.lowAgreement >= 2 && !rt.disagree) {
          rt.disagree = `disagrees with Windows' own pen position (score ${score.toFixed(2)})`
          tr("disagree", { backend: rt.name, score })
          if (rt.state === "live") goStale(rt, rt.disagree)
        }
      }
    }
  }

  function setFrameRecord(rt: Runtime, rec: FrameRecord, why: string): void {
    rt.frame = rec
    rt.pendingFrame = null
    const key = rt.frameKeyed
    if (key && rec.source !== "default" && rec.source !== "screen") store.update((s) => { s.frames[key] = rec })
    tr("frame", { backend: rt.name, source: rec.source, turn: rec.frame.turn, flipY: rec.frame.flipY, why }, "manager")
    markDirty(true)
  }

  function pollCursor(at: number): void {
    if (at - lastCursorAt < TICK_MS - 1) return
    const anyDevice = [...runtimes.values()].some((r) => r.backend.frameKind === "device" && (r.state === "live" || r.state === "armed") && r.visitOpen)
    if (!anyDevice) return
    lastCursorAt = at
    const f = deps.cursorFraction()
    if (!f) return
    if (lastCursorPoll && Math.hypot(f.x - lastCursorPoll.x, f.y - lastCursorPoll.y) < 1e-3) return
    lastCursorPoll = f
    if (curTraced < 400) { curTraced++; record("cur", { t: at, x: f.x, y: f.y }) }
    addPairs(f, "cursor", at)
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Samples
  // -------------------------------------------------------------------------------------------------------------------

  function onBatch(rt: Runtime, batch: PenSample[]): void {
    if (rt.state === "idle" || rt.state === "failed" || rt.state === "unavailable" || batch.length === 0) return
    const at = deps.now()
    const out: PenSample[] = []
    for (const raw of batch) {
      // 1. counters and the facts the check needs, on the sample as the backend made it
      const c = rt.counters
      c.samples++
      rt.lastSampleAt = at
      if (raw.inRange) {
        c.inRange++
        rt.lastInRangeAt = at
        if (!rt.visitOpen) c.visits++
      }
      if (raw.tip && !rt.tipDown) c.tipDowns++
      const moved = !!rt.prev && rt.prev.inRange && raw.inRange
        && (Math.abs(raw.x - rt.prev.x) >= 1e-4 || Math.abs(raw.y - rt.prev.y) >= 1e-4 || Math.abs(raw.p - rt.prev.p) >= 0.002)
      if (raw.inRange) {
        if (moved) rt.seen.moved = true
        if (raw.p > 0) rt.seen.pressure = true
        if (raw.p > rt.pressureMaxSeen) rt.pressureMaxSeen = raw.p
        if (raw.lower) rt.seen.lower = true
        if (raw.upper) rt.seen.upper = true
        if (raw.eraser) rt.seen.eraser = true
        if (raw.tiltX !== undefined || raw.tiltY !== undefined) rt.seen.tilt = true
        rt.reach = rt.reach
          ? { x: [Math.min(rt.reach.x[0], raw.x), Math.max(rt.reach.x[1], raw.x)], y: [Math.min(rt.reach.y[0], raw.y), Math.max(rt.reach.y[1], raw.y)] }
          : { x: [raw.x, raw.x], y: [raw.y, raw.y] }
        rt.recent.push({ at, moved })
        const last = rt.times[rt.times.length - 1]
        if (last !== undefined) {
          const gap = raw.t - last
          if (gap > 0 && gap < 500) { rt.gaps.push(gap); if (rt.gaps.length > 200) rt.gaps.shift() }
          if (gap > 500 || gap < 0) rt.times = []
        }
        rt.times.push(raw.t)
        if (rt.times.length > 256) rt.times.shift()
        rt.rawRing.push({ at, x: raw.x, y: raw.y })
        if (rt.rawRing.length > 16) rt.rawRing.shift()
      }
      rt.visitOpen = raw.inRange
      rt.tipDown = raw.inRange && raw.tip
      rt.prev = raw
      // 2. trace, before the frame so the frame can be re-fitted offline
      rt.traced.seen++
      if (rt.traced.seen % 10 === 1 && rt.traced.smp < 3000) {
        rt.traced.smp++
        record("smp", { t: raw.t, b: rt.name, x: raw.x, y: raw.y, p: raw.p, f: sampleFlags(raw) })
      }
      // 3. frame, 4. swap, 5. clamp
      if (rt.pendingFrame && !rt.tipDown) setFrameRecord(rt, rt.pendingFrame, "pen up")
      const [x0, y0] = rt.backend.frameKind === "device" ? applyFrame(raw.x, raw.y, ensureFrame(rt).frame) : [raw.x, raw.y]
      const swap = settings.swapButtons
      const sample: PenSample = {
        ...raw, x: clamp01(x0), y: clamp01(y0), p: clamp01(raw.p),
        lower: swap ? raw.upper : raw.lower, upper: swap ? raw.lower : raw.upper,
        backend: raw.backend || rt.name,
      }
      out.push(sample)
      if (raw.inRange) lastPenAt = at
    }
    // prune the window and look for liveness
    const cutoff = at - LIVENESS.LIVE_WINDOW_MS
    while (rt.recent.length > 0 && rt.recent[0]!.at < cutoff) rt.recent.shift()
    for (const s of out) rt.unsent.push({ at, sample: s })
    while (rt.unsent.length > UNSENT_MAX) rt.unsent.shift()
    evaluateLive(rt)
    if (active === rt.name) flush(rt)
    else {
      const old = at - 2 * LIVENESS.LIVE_WINDOW_MS
      while (rt.unsent.length > 0 && rt.unsent[0]!.at < old) rt.unsent.shift()
    }
    if (checkRunning) check.feed(rt.name, out)
    // The window pen follows the pen's VISITS (design 5.2): live while the pen is over the window, armed again when the visit ends. It is never
    // stale or failed (its only witness would be itself), and going armed lets a native backend that is live take the next visit.
    if (rt.name === "dom" && !batch[batch.length - 1]!.inRange && rt.state === "live") {
      rt.state = "armed"
      rt.liveSince = null
      rt.recent = []
      tr("visit-ended", { backend: rt.name })
      if (active === rt.name) reselect("visit ended")
      markDirty(true)
      return
    }
    markDirty(false)
  }

  function evaluateLive(rt: Runtime): void {
    const liveNow = rt.recent.length >= LIVENESS.LIVE_MIN_SAMPLES && rt.recent.some((r) => r.moved) && !rt.disagree
    if (liveNow && rt.state !== "live") {
      rt.state = "live"
      rt.reason = null
      rt.staleSince = null
      rt.liveSince = deps.now()
      rt.failures = 0
      rt.witnessedFailures = 0
      tr("live", { backend: rt.name })
      emit({ kind: "live", backend: rt.name })
      reselect("live")
      markDirty(true)
    } else if (liveNow && rt.state === "live") {
      reselect("sample")
    }
  }

  function goStale(rt: Runtime, reason: string): void {
    if (rt.state !== "live") return
    rt.state = "stale"
    rt.reason = reason
    rt.staleSince = deps.now()
    rt.liveSince = null
    tr("stale", { backend: rt.name, reason })
    emit({ kind: "lost", backend: rt.name, reason })
    if (active === rt.name) reselect("stale")
    markDirty(true)
  }

  /** Hand the sheet everything this (active) backend has not sent yet. */
  function flush(rt: Runtime): void {
    if (rt.unsent.length === 0) return
    const samples = rt.unsent.map((u) => u.sample)
    rt.unsent = []
    emitBatch(rt.name, samples)
    rt.lastOut = samples[samples.length - 1]!
  }

  function emitBatch(source: BackendName, samples: PenSample[]): void {
    if (samples.length === 0) return
    const batch: PenBatch = { source, seq: ++seq, samples }
    for (const l of [...sampleListeners]) { try { l(batch) } catch { /* a listener never breaks the feed */ } }
  }

  /** A synthetic "pen left" so the renderer closes any stroke (failover, close, panic). */
  function emitLeave(from: BackendName): void {
    const rt = runtimes.get(from)
    const last = rt?.lastOut
    if (!rt || !last || !last.inRange) return
    const leave: PenSample = { ...last, t: deps.now(), p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: false }
    emitBatch(from, [leave])
    rt.lastOut = leave
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Selection (design 5.4)
  // -------------------------------------------------------------------------------------------------------------------

  function setActive(next: BackendName | null, why: string): void {
    if (next === active) return
    const from = active
    if (from) emitLeave(from)
    active = next
    if (next) {
      const rt = runtimes.get(next)!
      // The first activation takes everything of this visit; a takeover from another backend takes only the latest sample.
      if (from !== null) rt.unsent = rt.unsent.slice(-1)
      flush(rt)
      winnerSince = { name: next, at: deps.now(), samples: rt.counters.samples }
      if (from) { tr("failover", { from, to: next, why }); emit({ kind: "failover", from, to: next }) }
    } else {
      winnerSince = null
    }
    tr("active", { backend: next, why })
    touchContainment()
    markDirty(true)
  }

  /** Design 5.4 (frame-settle): may `best` take over from `cur` as far as its direction is concerned? */
  function frameSettled(best: Runtime, cur: Runtime): boolean {
    if (best.backend.frameKind !== "device" || cur.backend.frameKind !== "screen") return true
    const f = ensureFrame(best)
    if (f.source !== "default") return true
    return best.liveSince !== null && deps.now() - best.liveSince >= LIVENESS.FRAME_SETTLE_MS
  }

  function reselect(why: string): void {
    const live = [...runtimes.values()].filter((r) => r.state === "live").sort((a, b) => priority(a.name) - priority(b.name))
    const cur = active ? runtimes.get(active) : undefined
    if (cur && cur.state === "live") {
      // A higher one takes over only after UPGRADE_AFTER_LIVE_MS of continuous liveness, never mid-stroke, and (design 5.4) a device-frame
      // backend on a GUESSED frame does not take over from a live screen-frame backend until the frame is fitted or FRAME_SETTLE_MS has passed.
      if (!cur.tipDown) {
        const best = live.find((b) => b !== cur && priority(b.name) < priority(cur.name)
          && b.liveSince !== null && deps.now() - b.liveSince >= LIVENESS.UPGRADE_AFTER_LIVE_MS && frameSettled(b, cur))
        if (best) setActive(best.name, "upgrade")
      }
      return
    }
    if (cur) {
      // The active went stale / failed / stopped.
      setActive(live[0]?.name ?? null, why)
      return
    }
    if (live[0]) setActive(live[0].name, why)
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The tick: liveness, stages, backoff, blur, winner, status
  // -------------------------------------------------------------------------------------------------------------------

  function tick(): void {
    try { tickInner() } catch (error) { tr("tick-error", { message: (error as Error).message }) }
  }

  function tickInner(): void {
    if (disposed) return
    const t0 = Date.now()
    const at = deps.now()
    const witnessed = witnessActive(at)
    for (const rt of runtimes.values()) {
      // The crash breadcrumb is cleared once a backend has run NATIVE_SAFE_MS (design 5.8).
      if (rt.runningSince !== null && at - rt.runningSince >= LIVENESS.NATIVE_SAFE_MS) clearInFlight(rt.name)
      // The window pen is never stale, failed or retried: its only witness would be itself (design 5.1, 5.2).
      if (rt.name === "dom") continue
      if (rt.state === "live" && rt.lastSampleAt !== null && at - rt.lastSampleAt >= LIVENESS.STALE_AFTER_MS && witnessed) {
        goStale(rt, "no samples while Windows sees the pen")
      } else if (rt.state === "stale" && rt.staleSince !== null && at - rt.staleSince >= LIVENESS.FAIL_AFTER_MS && witnessed) {
        fail(rt, rt.reason ?? "no samples while Windows sees the pen", "later")
      } else if (rt.state === "armed" && rt.startedAt !== null && at - rt.startedAt >= 8000 && rt.witnessesWhileArmed > 0 && rt.counters.inRange === 0
        && !rt.reason?.startsWith("opened")) {
        rt.reason = `opened, 0 samples in 8 s while Windows saw the pen ${rt.witnessesWhileArmed} times`
        tr("silent", { backend: rt.name, witnesses: rt.witnessesWhileArmed })
        markDirty(true)
      } else if (rt.state === "failed" && rt.nextRetryAt !== null && at >= rt.nextRetryAt && mayRun()) {
        rt.state = "idle"
        go(rt.name, "backoff elapsed")
      }
    }
    if (mayRun()) stageStarts(at)
    pollCursor(at)
    persistWinner(at)
    touchContainment()
    if (at - lastSt >= 5000 && wanted) {
      lastSt = at
      record("st", { t: at, a: active, b: Object.fromEntries([...runtimes.values()].map((r) => [r.name, r.state])) })
    }
    if (Date.now() - t0 > 10 && !overrun) { overrun = true; tr("tick-overrun", { ms: Date.now() - t0 }) }
  }

  /** The staged start policy (design 5.3). */
  function stageStarts(at: number): void {
    const cands = candidates(checkRunning)
    const liveNative = [...runtimes.values()].some((r) => r.state === "live" && isTabletNative(r.name))
    const state = (n: BackendName): BackendState => runtimes.get(n)?.state ?? "idle"
    const idle = (n: BackendName): boolean => {
      const s = state(n)
      return s === "idle"
    }
    const winner = store.get().winner?.backend ?? null
    const cheap = cands.filter((n) => n === "inject" || n === "wintab-data" || n === "rawinput" || n === "wintab-system")
    // stage 0: immediately. The window pen is not staged (design 5.3.0); the overlay starts whenever the sink may arm (5.3.4).
    if (cands.includes("inject") && idle("inject")) go("inject", "test backend")
    if (cands.includes("dom") && idle("dom")) go("dom", "window pen")
    if (cands.includes("overlay") && idle("overlay")) go("overlay", "the sink may arm")
    if (winner && cands.includes(winner) && winner !== "inject") {
      if (idle(winner)) go(winner, "stored winner")
      const winnerLive = state(winner) === "live"
      const settled = firstWitnessAt !== null && at - firstWitnessAt >= SETTLE_FIRST_MS
      if (!winnerLive && (settled || !isTabletNative(winner) || state(winner) === "failed")) {
        for (const n of cheap) if (n !== "inject" && idle(n)) go(n, "winner silent")
      }
    } else {
      for (const n of cheap) if (n !== "inject" && n !== "wintab-system" && idle(n)) go(n, "first run")
      if (cands.includes("wintab-system") && idle("wintab-system") && containment.driverMappingWanted()) go("wintab-system", "driver mapping wanted")
    }
    // The stage clock only runs once a witness has been seen (or twenty seconds have passed with none, then it waits).
    if (!witnessSeen && at - openedAt > NO_WITNESS_STAGES_MS) return
    const elapsed = at - (witnessSeen ? Math.min(stageClock, at) : openedAt)
    const firstRun = winner === null
    // `dom` going live does not stop this: it is the standby, not an answer (design 5.3.3).
    if (!liveNative && cands.includes("webhid") && idle("webhid") && elapsed >= LIVENESS.STAGE_WEBHID_MS && (witnessSeen || firstRun)) {
      go("webhid", "stage 1")
    }
    // A system context replaces the data context once it is live (never both open for long).
    const sys = runtimes.get("wintab-system")
    const data = runtimes.get("wintab-data")
    if (sys?.state === "live" && data && data.state !== "idle" && data.state !== "unavailable" && active === "wintab-system") stopBackend(data, "system context took over")
  }

  function persistWinner(at: number): void {
    if (!active || !winnerSince || winnerSince.name !== active) return
    const rt = runtimes.get(active)
    if (!rt || !isTabletNative(active)) return   // dom, overlay and inject are not answers to "which door works" (design 5.6)
    const stored = store.get().winner
    if (stored?.backend === active) return
    if (at - winnerSince.at >= WINNER_AFTER_MS && rt.counters.samples - winnerSince.samples >= WINNER_MIN_SAMPLES) {
      const record: { backend: BackendName; at: string } = { backend: active, at: iso() }
      store.update((s) => { s.winner = record })
      tr("winner", { backend: active })
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Containment feed
  // -------------------------------------------------------------------------------------------------------------------

  function touchContainment(): void {
    const rt = active ? runtimes.get(active) : undefined
    // (`checkRunning` is the one extra field containment.ts reads beyond the contract: the sink does not arm during the check, design 7.4.)
    const input: ContainmentInput & { checkRunning: boolean } = {
      sheet, sheetPhysical, window: { focused: inFront(), visible: windowState.visible, minimized: windowState.minimized },
      penInRange: !!rt?.visitOpen || witnessActive(), lastPenAt, settings, active, checkRunning,
    }
    try { containment.update(input) } catch (error) { tr("containment-error", { message: (error as Error).message }, "containment") }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------------------------------------------------

  function backendStatus(rt: Runtime): BackendStatus {
    const own = (() => { try { return rt.backend.status() } catch { return emptyStatus(rt.name, rt.state, rt.reason) } })()
    const times = rt.times
    let rateHz: number | null = null
    if (rt.state === "live" || rt.state === "armed") {
      if (times.length >= 2) {
        const last = times[times.length - 1]!
        const win = times.filter((t) => t >= last - 2000)
        const span = last - win[0]!
        rateHz = win.length >= 2 && span > 0 ? ((win.length - 1) * 1000) / span : null
      }
    }
    return {
      ...own,
      name: rt.name,
      state: rt.state,
      reason: rt.reason ?? own.reason ?? null,
      counters: { ...own.counters, samples: rt.counters.samples, inRange: rt.counters.inRange, tipDowns: rt.counters.tipDowns, visits: rt.counters.visits, errors: Math.max(rt.counters.errors, own.counters.errors) },
      lastSampleAt: rt.lastSampleAt, lastInRangeAt: rt.lastInRangeAt, rateHz, gapP95Ms: p95(rt.gaps),
      device: rt.device ?? own.device,
      seen: { ...rt.seen }, reach: rt.reach, pressureMaxSeen: rt.pressureMaxSeen,
      facts: { ...own.facts, ...(rt.agreement !== null ? { agreement: Number(rt.agreement.toFixed(3)) } : {}), failures: rt.failures },
    }
  }

  function status(): FeedStatus {
    const names = BACKEND_ORDER.filter((n) => n !== "inject" || deps.e2e)
    const backends = names.map((n): BackendStatus => {
      const rt = runtimes.get(n)
      if (rt) return backendStatus(rt)
      const reason = deps.available ? unavailableReason(n) : "not available on this platform"
      return emptyStatus(n, reason ? "unavailable" : "idle", reason)
    })
    const activeRt = active ? runtimes.get(active) : undefined
    const cs = containment.status()
    const env = deps.env()
    const activeStatus = backends.find((b) => b.name === active)
    const contained = cs.armed && cs.mode !== "none" ? (cs.mode === "sink" ? "overlay" : cs.mode) : null
    const guessed = !!activeRt && activeRt.backend.frameKind === "device" && activeRt.frame?.source === "default"
    const nativeLive = backends.some((b) => isTabletNative(b.name) && b.state === "live")
    const faults = nativeLive ? [] : (Object.keys(store.get().faults) as BackendName[]).filter((n) => settings.backends[n as keyof typeof settings.backends] === false)
    const { headline, severity } = headlineFor({
      available: deps.available, enabled: settings.enabled, released, active, rateHz: activeStatus?.rateHz ?? null, contained,
      backends, env, opened: wanted, guessed, faults,
    })
    return {
      available: deps.available,
      open: wanted && settings.enabled && !suspended && released === null,
      released,
      active,
      backends,
      frame: activeRt?.frame ?? null,
      containment: cs,
      witnessAt: lastWitnessAt,
      env,
      settings: { ...settings, backends: { ...settings.backends } },
      headline,
      severity,
      winner: store.get().winner,
    }
  }

  function statusSignature(s: FeedStatus): string {
    return JSON.stringify([s.open, s.released, s.active, s.headline.replace(/ - \d+ Hz/, ""), s.severity, s.backends.map((b) => [b.state, b.reason]),
      s.frame?.source, s.frame?.frame, s.containment.armed, s.containment.mode, s.settings, s.winner?.backend])
  }

  function flushStatus(force: boolean): void {
    if (statusListeners.size === 0) { lastSignature = ""; return }
    const s = status()
    const sig = statusSignature(s)
    if (!force && sig === lastSignature) return
    lastSignature = sig
    for (const l of [...statusListeners]) { try { l(s) } catch { /* ignore */ } }
  }

  /** `immediate`: a state change goes out now; counters ride the next 4/s slot. */
  function markDirty(immediate: boolean): void {
    if (statusListeners.size === 0) return
    if (immediate) {
      if (counterTimer) { clearTimeout(counterTimer); counterTimer = null }
      flushStatus(false)
      return
    }
    if (counterTimer) return
    counterTimer = setTimeout(() => { counterTimer = null; flushStatus(true) }, STATUS_COUNTER_MS)
    counterTimer.unref?.()
  }

  function emit(event: FeedEvent): void {
    for (const l of [...eventListeners]) { try { l(event) } catch { /* ignore */ } }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Window, open, close, panic, settings
  // -------------------------------------------------------------------------------------------------------------------

  function ensureTick(): void {
    if (tickTimer || disposed) return
    tickTimer = setInterval(tick, TICK_MS)
    tickTimer.unref?.()
  }

  function startPointerRange(): void {
    if (!deps.pointerRange || pointerRangeHandle) return
    try {
      pointerRangeHandle = deps.pointerRange((w) => witness(w))
      if (!pointerRangeHandle.start()) { tr("pointer-range-unavailable"); pointerRangeHandle = null }
    } catch (error) { tr("pointer-range-error", { message: (error as Error).message }); pointerRangeHandle = null }
  }
  function stopPointerRange(): void {
    try { pointerRangeHandle?.stop() } catch { /* ignore */ }
    pointerRangeHandle = null
    pointerRangeIn = false
  }

  function startCandidates(why: string): void {
    if (!mayRun()) return
    startPointerRange()
    const cands = candidates(checkRunning)
    // Stage 0 only; the rest follows from the tick.
    stageStarts(deps.now())
    for (const n of cands) {
      if (checkRunning && isTabletNative(n)) go(n, `check (${why})`, true)
    }
    ensureTick()
  }

  function releaseFor(reason: string): void {
    stopAll(reason)
    stopPointerRange()
    released = reason
    emit({ kind: "released", reason })
    containment.update({ sheet, sheetPhysical, window: { focused: false, visible: windowState.visible, minimized: windowState.minimized }, penInRange: false, lastPenAt, settings, active: null })
    markDirty(true)
  }

  function setWindowState(state: WindowState): void {
    const was = inFront()
    windowState = state
    const now = inFront()
    tr("window", { focused: state.focused, visible: state.visible, minimized: state.minimized })
    if (was === now) { touchContainment(); return }
    if (now) {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
      suspended = false
      if (released !== null) { released = null; markDirty(true) }
      if (wanted && settings.enabled) startCandidates("focus")
    } else if (wanted) {
      if (blurTimer) clearTimeout(blurTimer)
      if (!checkRunning) {
        blurTimer = setTimeout(() => { blurTimer = null; if (!inFront() && !checkRunning && wanted) releaseFor("window not in front") }, LIVENESS.BLUR_GRACE_MS)
        blurTimer.unref?.()
      }
    }
    touchContainment()
  }

  const manager: FeedManagerEx = {
    async open(next) {
      if (disposed) return status()
      wanted = true
      suspended = false
      released = null
      sheet = next
      sheetPhysical = next ? deps.sheetToPhysical(next) : null
      openedAt = deps.now()
      firstWitnessAt = null
      witnessSeen = false
      stageClock = openedAt
      tr("open", { sheet: next ? { w: Math.round(next.rect.width), h: Math.round(next.rect.height), turns: next.turns } : null })
      if (settings.enabled && inFront()) startCandidates("open")
      else ensureTick()
      touchContainment()
      markDirty(true)
      return status()
    },
    close(reason) {
      if (!wanted && active === null) return
      wanted = false
      tr("close", { reason })
      stopAll(reason)
      stopPointerRange()
      released = null
      sheet = null
      sheetPhysical = null
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
      containment.update({ sheet: null, sheetPhysical: null, window: windowState, penInRange: false, lastPenAt, settings, active: null })
      markDirty(true)
    },
    setSheet(next) {
      sheet = next
      sheetPhysical = next ? deps.sheetToPhysical(next) : null
      for (const rt of runtimes.values()) {
        if (isSystemMapped(rt.backend) && rt.state !== "idle") { try { rt.backend.setSheetPhysical(sheetPhysical) } catch { /* ignore */ } }
      }
      touchContainment()
    },
    sheet: () => sheet,
    setWindowState,
    witness,
    onSamples(listener) { sampleListeners.add(listener); return () => { sampleListeners.delete(listener) } },
    onStatus(listener) { statusListeners.add(listener); return () => { statusListeners.delete(listener) } },
    onEvent(listener) { eventListeners.add(listener); return () => { eventListeners.delete(listener) } },
    onCheck(listener) { checkListeners.add(listener); return () => { checkListeners.delete(listener) } },
    status,
    settings: () => ({ ...settings, backends: { ...settings.backends } }),
    update(patch) {
      const before = JSON.stringify(settings)
      if (patch.backends) {
        Object.assign(settings.backends, patch.backends)
        // Turning a switch back on forgets the crash fault that had turned it off (design 5.8).
        for (const [name, on] of Object.entries(patch.backends)) {
          if (on === true && name in store.get().faults) store.update((st) => { clearFault(st, name) })
        }
      }
      const { backends: _b, ...rest } = patch
      void _b
      Object.assign(settings, rest)
      if (JSON.stringify(settings) !== before) {
        store.update((s) => { s.settings = { ...settings, backends: { ...settings.backends } } })
        tr("settings", { ...patch })
        if (!settings.enabled) { stopAll("capture off"); stopPointerRange() }
        else {
          if (patch.enabled === true) { suspended = false; released = null }
          for (const rt of runtimes.values()) {
            const switchedOff = rt.name !== "inject" && settings.backends[rt.name] === false
            if (switchedOff && rt.state !== "idle" && rt.state !== "unavailable") stopBackend(rt, "switched off")
          }
          if (patch.prefer !== undefined) {
            for (const rt of runtimes.values()) {
              const keeps = rt.name === settings.prefer || rt.name === "inject" || rt.name === "dom" || rt.name === "overlay"
              if (rt.state !== "idle" && rt.state !== "unavailable" && settings.prefer && !keeps) stopBackend(rt, "prefer changed")
            }
          }
          if (wanted && inFront()) startCandidates("settings")
        }
        touchContainment()
        markDirty(true)
      }
      return manager.settings()
    },
    panic(reason) {
      tr("panic", { reason })
      try { containment.panic(reason) } catch (error) { tr("containment-error", { message: (error as Error).message }, "containment") }
      suspended = true
      releaseFor(`panic: ${reason}`)
    },
    inject(samples, backend = "inject") {
      if (!deps.e2e) return
      void backend
      const rt = runtimes.get("inject")
      if (!rt || (rt.state !== "armed" && rt.state !== "live" && rt.state !== "stale")) {
        // Not running yet (the sheet is not open, or the start is in flight): keep nothing, say so.
        tr("inject-dropped", { n: samples.length, state: rt?.state ?? "none" })
        return
      }
      const fake = rt.backend as unknown as { push?(s: PenSample[]): void }
      if (fake.push) fake.push(samples)
    },
    deviceChanged(reason) {
      tr("device-changed", { reason })
      store.update((s) => { s.demoted = {} })
      for (const rt of runtimes.values()) {
        rt.failures = 0; rt.witnessedFailures = 0; rt.nextRetryAt = null
        if (rt.state === "failed") rt.state = "idle"
      }
      if (mayRun()) startCandidates("device changed")
      markDirty(true)
    },
    setFrame(frame) {
      const target = (active ? runtimes.get(active) : undefined) ?? [...runtimes.values()].find((r) => r.backend.frameKind === "device" && r.state !== "idle" && r.state !== "unavailable")
      if (!target) return status()
      if (frame === null) {
        const w = target.device?.rawX ? target.device.rawX[1] - target.device.rawX[0] : null
        const h = target.device?.rawY ? target.device.rawY[1] - target.device.rawY[0] : null
        const key = target.frameKeyed
        if (key) store.update((s) => { delete s.frames[key] })
        target.frame = { frame: defaultFrame(familyOf(target.name), w, h), source: "default", rms: null, margin: null, at: iso() }
        target.pairs = []
        target.pairsSinceFit = 0
        target.disagree = null
        tr("frame", { backend: target.name, source: "default", reset: true })
      } else {
        const rec: FrameRecord = { frame, source: "manual", rms: null, margin: null, at: iso() }
        target.pairs = []
        target.disagree = null
        setFrameRecord(target, rec, "manual")
      }
      markDirty(true)
      return status()
    },
    checkStart() {
      checkRunning = true
      lastReport = null
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
      for (const rt of runtimes.values()) {
        rt.counters = emptyCounters(); rt.seen = { pressure: false, lower: false, upper: false, eraser: false, tilt: false, moved: false }
        rt.reach = null; rt.pressureMaxSeen = 0; rt.times = []; rt.gaps = []
      }
      tr("check-start", {}, "check")
      const snapshot = check.begin()
      if (wanted) startCandidates("check")
      else {
        // The check may run with the sheet closed (opened from the popover): it needs the backends, not the sheet.
        wanted = true
        startCandidates("check")
      }
      ensureCheckTimer()
      checkOrder = []
      markDirty(true)
      return snapshot
    },
    checkStep(id) {
      if (!checkRunning) manager.checkStart()
      tr("check-step", { id }, "check")
      const index = CHECK_STEPS.findIndex((s) => s.id === id)
      checkOrder = CHECK_STEPS.slice(index + 1).map((s) => s.id)
      const snapshot = check.start(id)
      pushCheck(snapshot)
      return snapshot
    },
    checkCancel() {
      const snapshot = check.cancel()
      endCheck(null)
      pushCheck(snapshot)
      return snapshot
    },
    checkSnapshot: () => check.snapshot(),
    lastReport: () => lastReport,
    containTest: (mechanism) => containment.test(mechanism),
    e2eConfig(config) {
      if (!deps.e2e) return status()
      if (config.capture !== undefined) manager.update({ enabled: config.capture })
      if (config.native !== undefined) native = config.native
      if (config.backends !== undefined) pinned = config.backends.length > 0 ? config.backends : null
      if (config.focused !== undefined) focusedOverride = config.focused
      tr("e2e-config", { ...config })
      if (config.focused === false) {
        if (!checkRunning) releaseFor("window not in front")
      } else if (config.focused === true || config.native !== undefined || config.backends !== undefined) {
        suspended = false
        released = null
        if (config.native !== undefined || config.backends !== undefined) {
          for (const rt of runtimes.values()) if (rt.state !== "idle") stopBackend(rt, "e2e config")
          if (active !== null) setActive(null, "e2e config")
        }
        if (wanted) startCandidates("e2e config")
      }
      markDirty(true)
      return status()
    },
    backendNames: () => [...runtimes.keys()],
    frameOf: (name) => runtimes.get(name)?.frame ?? null,
    checking: () => checkRunning,
    dispose() {
      if (disposed) return
      disposed = true
      if (tickTimer) clearInterval(tickTimer)
      if (checkTimer) clearInterval(checkTimer)
      if (blurTimer) clearTimeout(blurTimer)
      if (counterTimer) clearTimeout(counterTimer)
      tickTimer = checkTimer = blurTimer = counterTimer = null
      for (const rt of runtimes.values()) {
        detach(rt)
        try { rt.backend.stop() } catch { /* ignore */ }
        clearInFlight(rt.name)
      }
      stopPointerRange()
      try { containment.dispose() } catch { /* ignore */ }
      store.flushSync()
    },
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The setup check (design 9): the manager runs the clock, the engine counts
  // -------------------------------------------------------------------------------------------------------------------

  function pushCheck(snapshot: CheckSnapshot): void {
    for (const l of [...checkListeners]) { try { l(snapshot) } catch { /* ignore */ } }
  }

  function ensureCheckTimer(): void {
    if (checkTimer) return
    checkTimer = setInterval(() => {
      if (!checkRunning) return
      try { checkTick() } catch (error) { tr("check-error", { message: (error as Error).message }, "check") }
    }, CHECK_TICK_MS)
    checkTimer.unref?.()
  }

  function checkTick(): void {
    {
      let snapshot = check.tick()
      // A step that ended hands over to the next one; after the last, the report is built.
      if (snapshot.running && snapshot.step === null) {
        const next = checkOrder.shift()
        if (next) snapshot = check.start(next)
        else if (snapshot.done.length > 0) {
          const report = check.finish()
          endCheck(report)
          snapshot = check.snapshot()
        }
      }
      pushCheck(snapshot)
    }
  }

  function endCheck(report: CheckReport | null): void {
    checkRunning = false
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null }
    tr("check-end", { overall: report?.overall ?? "cancelled" }, "check")
    if (report) {
      lastReport = report
      store.update((s) => {
        for (const [backend, rec] of Object.entries(report.learned.frames)) {
          const rt = runtimes.get(backend as BackendName)
          if (rt?.frameKeyed) { s.frames[rt.frameKeyed] = rec; rt.frame = rec }
        }
        if (report.learned.pointerMode) s.pointerMode = report.learned.pointerMode
        if (report.learned.swapButtons !== null) { settings.swapButtons = report.learned.swapButtons; s.settings = { ...settings, backends: { ...settings.backends } } }
        // Only a tablet-native winner is stored (design 5.6): a check that ends with only `dom` working leaves the stored winner alone.
        if (report.winner && isTabletNative(report.winner)) s.winner = { backend: report.winner, at: iso() }
        s.lastCheck = { at: report.at, overall: report.overall, winner: report.winner, summary: report.summary }
      })
    }
    if (!inFront() && wanted) {
      blurTimer = setTimeout(() => { blurTimer = null; if (!inFront() && wanted) releaseFor("window not in front") }, LIVENESS.BLUR_GRACE_MS)
      blurTimer.unref?.()
    }
    markDirty(true)
  }

  void check
  void emptyStatus
  return manager
}
