/**
 * containment.ts - the POLICY STATE MACHINE of pen containment (docs/spikes/DESIGN-pen-capture.md 7.2 - 7.7, IMPL-C).
 *
 * It decides WHEN the pen is held to the sheet, by WHICH mechanism, and lets go. It owns no OS call: the clip is
 * armed through the lease/guard (lease.ts), the driver mapping through the Wintab backend (`setSheetPhysical`), the
 * sink through the transparent window (overlay.ts). Everything it needs from the world is injected, so every
 * rule below is a unit test with a fake clock and fake mechanisms (test/pen/containment.test.ts).
 *
 * THE ONE RULE THAT MATTERS: THE APP MUST NEVER LEAVE SEAN'S CURSOR CONFINED. Nothing here is a mechanism that outlives
 * the process on its own (the guard process and the startup sweep cover process death); what this file adds is that
 * every way a person or the OS can say "stop" is a release:
 *
 *   blur / hidden / minimized     update() says the window is not in front          -> let go at once
 *   sheet-gone / disabled         the Tablet sheet closed, "Pen capture" turned off -> let go at once
 *   esc / panic                   containment.panic(reason): the manager, Ctrl+Alt+G, the chip -> let go, and stay
 *                                 off until the window is left and re-entered or capture is turned on again
 *   pen-out                       no pen signal for SINK_PEN_OUT_MS: the sink goes click-through, the clip is freed
 *   idle                          no pen activity of any kind for IDLE_RELEASE_MS
 *   display-changed               the display metrics changed (a stale rectangle is a wrong rectangle)
 *   lock / suspend                the session locks or the machine sleeps; re-evaluated on unlock / resume
 *   lease / guard-lost            the guard says the app stopped beating / the guard died
 *   foreign-clip                  another program's clip is active
 *   no-consumer / ineffective / unsafe / mouse    the sink's own rules (7.6)
 *   quit                          dispose(), which every exit path calls
 *
 * FAIL CLOSED. Any exception inside an evaluation releases everything (a stale belief that something is armed is the
 * dangerous direction), and an evaluation that throws twice in a row marks nothing, it just stays released. No guard,
 * no system context and no clip. A mechanism that misbehaves is marked `unsafe` and is never retried on its own.
 *
 * No Electron import at load time (vitest imports this); the one place that wants Electron (`displayKey`) loads it lazily.
 */

import { createRequire } from "node:module"
import { LIVENESS, type BackendName, type Box, type CapabilityRecord, type CapabilityState, type ContainmentStatus, type ContainmentTestResult, type PenSample } from "../../shared/pen"
import { DEFAULT_LEASE_MS, MIN_CLIP_H, MIN_CLIP_W } from "./clip"
import type { PenLease } from "./lease"
import type { SinkExtras } from "./overlay"
import type { Containment, ContainmentDeps, ContainmentInput, CreateContainment, SystemMapped } from "./types"

/** Every number of design 7.6 / 7.4, in one place. Tests import them; nobody inlines them. */
export const CONTAIN = {
  /** A pen STATE ("a visit is open", "the pointer-range witness says in range") counts as a fresh signal for this long after it was last asserted. */
  SINK_SIGNAL_MS: 1500,
  /** A pen EVENT (a sample, a sink pen event) counts as a fresh signal for this long; the sink goes click-through when neither holds. */
  SINK_PEN_OUT_MS: 400,
  /** After a real mouse event the sink stays off until no pen signal has been seen for this long. */
  MOUSE_LOCK_CLEAR_MS: 1500,
  /** A mouse event this soon after a pen TIP sample (from any source) is the pen's own echo, not a mouse. */
  ECHO_MS: 300,
  SINK_VALIDATE_MS: 1500,
  SINK_VALIDATE_MAX_MS: 5000,
  SINK_MIN_NATIVE: 30,
  SINK_EFFECTIVE_RATIO: 0.1,
  /** Without validation evidence: this many sink pen events within SINK_VALIDATE_MS of turning on, while the earlier signal holds. */
  SINK_MIN_EVENTS: 10,
  /** The sink `on` this long with no pen signal at all is `unsafe`. */
  SINK_MAX_ON_MS: 60_000,
  /** Hit-testing still on this long after an off order is `unsafe`. */
  SINK_OFF_GRACE_MS: 3000,
  /** A mouse event within this long of the sink turning on, on three visits in a row, means the pen arrives as mouse input. */
  PEN_AS_MOUSE_MS: 300,
  IDLE_RELEASE_MS: 20_000,
  HEARTBEAT_MS: 1000,
  HEARTBEAT_TIMEOUT_MS: 6000,
  /** The evaluation tick (re-evaluated on every update as well). */
  TICK_MS: 100,
  /** A system context while the OS cursor is outside the rectangle for this many heartbeats is `unsafe`. */
  DRIVER_OUTSIDE_BEATS: 3,
  /** A clip that is not the armed rectangle for this long is `unsafe` (two lease beats). */
  CLIP_VERIFY_MS: 500,
  /** The check's containment tests. */
  TEST_MS: 5000,
} as const

export type DisarmReason =
  | "blur" | "hidden" | "minimized" | "sheet-gone" | "disabled" | "esc" | "panic" | "pen-out" | "mouse" | "idle" | "display-changed"
  | "lock" | "suspend" | "lease" | "guard-lost" | "foreign-clip" | "no-consumer" | "ineffective" | "unsafe" | "quit" | "check" | "settings" | "error"

/** Optional extras (tests inject fakes; main.ts passes the real ones or nothing). */
export interface ContainmentHooks {
  /** Repeating tick; returns a cancel function. Default: an unref'd setInterval. */
  every?: (ms: number, fn: () => void) => () => void
  /** A string that changes when the display configuration does (bounds + scale of the display the notes window is on). */
  displayKey?: () => string
  /** The Wintab system backends the manager has running, so the driver mapping can be undone at once (idempotent). */
  systemBackends?: () => SystemMapped[]
  /**
   * The notes window's real state, read independently of the manager's feed (defence in depth: a missed window event must not leave anything armed).
   * null = no opinion. Default: BrowserWindow.isFocused / isVisible / isMinimized of `deps.window()`, none under WRITEMIND_E2E (an offscreen window is never focused).
   */
  windowCheck?: () => { focused: boolean; visible: boolean; minimized: boolean } | null
  /** Electron's powerMonitor, narrowed. Default: the real one, loaded lazily. */
  power?: { on(event: "lock-screen" | "suspend" | "unlock-screen" | "resume", listener: () => void): () => void }
  /** The guard saw the panic chord, or the global shortcut fired: tell the manager (`manager.panic(reason)`). */
  onPanic?: (reason: string) => void
  /** The pen as the sink reports it, in addition to `sink.onPenSamples` (not needed; kept for the real sink). */
  sinkExtras?: () => SinkExtras | null
}

/** ContainmentInput plus what the policy needs and the contract does not carry (all optional, so older callers still compile). */
export type ContainmentUpdate = ContainmentInput & {
  /** The setup check is running: the check measures the window's own pen events, so the sink must not absorb them (7.4). */
  checkRunning?: boolean
}

const defaultEvery = (ms: number, fn: () => void): (() => void) => {
  const t = setInterval(fn, ms)
  t.unref()
  return () => clearInterval(t)
}

const NATIVE_LABELS = new Set(["wintab", "rawinput-hid", "rawinput-synth", "webhid"])
const isNativeSample = (s: PenSample): boolean => NATIVE_LABELS.has(s.backend)
const NATIVE_BACKENDS: ReadonlySet<BackendName> = new Set<BackendName>(["wintab-system", "wintab-data", "rawinput", "webhid"])

const CFG_RE = /\s*\{cfg:([^}]*)\}\s*$/
/** The display configuration a capability record was made at rides in its note, so the contract needs no new field. */
export const noteWithConfig = (note: string | null, cfg: string): string => `${(note ?? "").replace(CFG_RE, "").trim()} {cfg:${cfg}}`.trim()
export const configOfNote = (note: string | null): string | null => (note ? CFG_RE.exec(note)?.[1] ?? null : null)
export const plainNote = (note: string | null): string | null => (note ? note.replace(CFG_RE, "").trim() || null : null)

function lazyDisplayKey(deps: ContainmentDeps): string {
  try {
    const electron = createRequire(import.meta.url)("electron") as typeof import("electron")
    const win = deps.window()
    if (!win || win.isDestroyed()) return "unknown"
    const d = electron.screen.getDisplayMatching(win.getBounds())
    return `${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}`
  } catch { return "unknown" }
}

function lazyPower(): ContainmentHooks["power"] | null {
  try {
    const { powerMonitor } = createRequire(import.meta.url)("electron") as typeof import("electron")
    if (!powerMonitor || typeof powerMonitor.on !== "function") return null
    return { on: (ev, l) => { powerMonitor.on(ev as "suspend", l); return () => { powerMonitor.removeListener(ev as "suspend", l) } } }
  } catch { return null }
}

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

const saneSheet = (b: Box | null): b is Box => !!b && b.width >= MIN_CLIP_W && b.height >= MIN_CLIP_H

export const createContainment: CreateContainment = (deps0): Containment => makeContainment(deps0 as ContainmentDeps & ContainmentHooks)

export function makeContainment(deps: ContainmentDeps & ContainmentHooks): Containment & { update(input: ContainmentUpdate): void; evaluate(): void } {
  const every = deps.every ?? defaultEvery
  const log = (s: string): void => { try { deps.log(`containment: ${s}`) } catch { /* logging never throws */ } }
  const tr = (name: string, data?: Record<string, unknown>): void => { try { deps.trace.event("containment", name, data) } catch { /* ditto */ } }
  const e2e = (): boolean => { const v = process.env.WRITEMIND_E2E; return !!v && v !== "0" }
  const windowCheck = (): { focused: boolean; visible: boolean; minimized: boolean } | null => {
    try {
      if (deps.windowCheck) return deps.windowCheck()
      if (e2e()) return null
      const w = deps.window()
      if (!w) return null
      if (w.isDestroyed()) return { focused: false, visible: false, minimized: false }
      return { focused: w.isFocused(), visible: w.isVisible(), minimized: w.isMinimized() }
    } catch { return null }
  }
  const displayKey = (): string => { try { return deps.displayKey ? deps.displayKey() : lazyDisplayKey(deps) } catch { return "unknown" } }

  let input: ContainmentUpdate | null = null
  let disposed = false
  let suspended = false           // after a panic: off until the window is left and re-entered, capture is turned on again, or the sheet is reopened
  let sawBlurSincePanic = false
  let locked = false              // lock screen / suspend
  let needFreshUpdate = false     // after a display change: the old sheet rectangle is not to be trusted
  let idleLatched = false
  let forceSink = false           // the check's explicit sink test
  let errorStreak = 0

  // ---- what is armed (the policy's belief; the mechanisms are told to let go unconditionally)
  let mode: ContainmentStatus["mode"] = "none"
  let armed = false
  let rect: Box | null = null
  let lastRelease: { reason: string; at: number } | null = null
  let armedAt = 0

  // ---- pen signals
  let lastStateAt = -Infinity    // input.penInRange was true at this time (a STATE: the visit is open)
  let lastEventAt = -Infinity    // a sample / sink pen event / in-range update (an EVENT)
  let lastActivityAt = -Infinity // any pen activity at all (idle release)
  let lastTipAt = -Infinity      // the last pen TIP sample from any source (echo rule)
  let tipDown = false
  let nativeInRange = 0          // in-range native samples ever (differenced at validation start)
  let sinkPenCount = 0           // the sink's own pen events ever

  // ---- sink
  let sinkOn = false
  let sinkOnAt = 0
  let sinkOffOrderedAt: number | null = null
  let mouseLocked = false
  let pendingMouse = false
  let quickMouseVisits = 0
  let sinkVisitCounted = false
  let lastMouseCount = 0
  let val: { at: number; native0: number; sink0: number; hadNative: boolean; refSignal: boolean; decided: boolean } | null = null

  // ---- driver / clip bookkeeping
  let outsideBeats = 0
  let lastHeartbeatAt = 0
  let clipBadSince: number | null = null

  const caps = (): ContainmentStatus["capabilities"] => deps.loadCapabilities()
  const cfgNow = (): string => displayKey()

  /** The state of a capability record, with "made at another display configuration" counting as untested for the earned states. */
  function capState(name: "driver" | "sink" | "clip"): CapabilityState {
    const rec: CapabilityRecord = caps()[name]
    const state = rec.state
    if (state === "unsafe") return "unsafe" // never retried automatically, at any configuration
    const cfg = configOfNote(rec.note)
    if (state === "honored" || state === "effective") return cfg !== null && cfg === cfgNow() ? state : "untested"
    if (state === "ineffective" || state === "ignored") return cfg === null || cfg === cfgNow() ? state : "untested"
    return state
  }
  function saveCap(name: "driver" | "sink" | "clip", state: CapabilityState, note: string | null): void {
    try { deps.saveCapability(name, { state, note: noteWithConfig(note, cfgNow()) }) } catch (e) { log(`saving the ${name} record failed: ${(e as Error).message}`) }
  }

  const sink = deps.sink
  const extras = (): SinkExtras | null => { try { return deps.sinkExtras ? deps.sinkExtras() : ((sink as Partial<SinkExtras> & typeof sink).onMouse ? (sink as unknown as SinkExtras) : null) } catch { return null } }
  const lease: PenLease = deps.lease as PenLease

  const settings = (): ContainmentInput["settings"] | null => input?.settings ?? null

  // =============================================================================================================
  // Letting go
  // =============================================================================================================

  function unmapDriver(): void {
    try { for (const b of deps.systemBackends?.() ?? []) { try { b.setSheetPhysical(null) } catch { /* the backend may be stopping */ } } } catch { /* ignore */ }
  }

  /** Let go of EVERY mechanism, unconditionally (a stale belief that something is armed is the dangerous direction). Never throws. */
  function releaseAll(reason: DisarmReason | string, opts: { keepSinkShown?: boolean } = {}): void {
    const now = deps.now()
    const wasHolding = armed || sinkOn || mode !== "none"
    try { sink.setOn(false) } catch (e) { log(`sink.setOn(false) threw: ${(e as Error).message}`) }
    if (sinkOn) sinkOffOrderedAt = now
    sinkOn = false
    if (!opts.keepSinkShown) { try { sink.setShown(false) } catch { /* ignore */ } }
    try { lease.freeClip() } catch (e) { log(`freeClip threw: ${(e as Error).message}`) }
    unmapDriver()
    val = null
    outsideBeats = 0
    clipBadSince = null
    if (wasHolding) {
      lastRelease = { reason, at: now }
      tr("release", { reason, mode })
      log(`released (${reason})`)
    }
    armed = false
    mode = "none"
    rect = null
  }

  function markUnsafe(name: "driver" | "sink" | "clip", why: string): void {
    saveCap(name, "unsafe", why)
    tr("unsafe", { mechanism: name, why })
    log(`${name} marked unsafe: ${why}`)
    releaseAll("unsafe")
  }

  // =============================================================================================================
  // Pen signals
  // =============================================================================================================

  function noteSignal(event: boolean, tip: boolean, now: number): void {
    lastActivityAt = Math.max(lastActivityAt, now)
    if (event) lastEventAt = now
    else lastStateAt = now
    if (tip) { lastTipAt = now }
  }

  const eventFresh = (now: number): boolean => now - lastEventAt <= CONTAIN.SINK_PEN_OUT_MS
  const stateFresh = (now: number): boolean => now - lastStateAt <= CONTAIN.SINK_SIGNAL_MS
  /** (a) a fresh pen signal. */
  const penSignal = (now: number): boolean => eventFresh(now) || stateFresh(now)

  const offSamples = deps.probe.onSamples((batch) => {
    if (disposed) return
    const now = deps.now()
    for (const s of batch) {
      if (!s.inRange) { tipDown = false; continue }
      if (isNativeSample(s)) nativeInRange++
      if (s.tip) { tipDown = true; lastTipAt = now } else tipDown = false
      noteSignal(true, s.tip, now)
    }
    // A pen visit's end may be the moment a deferred mouse event takes effect.
    if (!tipDown) applyPendingMouse()
  })

  const offSinkSamples = sink.onPenSamples((batch) => {
    if (disposed) return
    const now = deps.now()
    for (const s of batch) {
      sinkPenCount++
      if (!s.inRange) { tipDown = false; continue }
      tipDown = s.tip
      if (s.tip) lastTipAt = now
      noteSignal(true, s.tip, now)
    }
    if (!tipDown) applyPendingMouse()
  })

  /** A real mouse event reached the sink. Echo excluded; mouse always wins (7.6). */
  function onSinkMouse(): void {
    if (disposed || !sinkOn) return
    const now = deps.now()
    if (now - lastTipAt < CONTAIN.ECHO_MS) return // the pen's own echo
    tr("sink-mouse-wins", { sinceOnMs: Math.round(now - sinkOnAt), tipDown })
    if (now - sinkOnAt <= CONTAIN.PEN_AS_MOUSE_MS && !sinkVisitCounted) {
      sinkVisitCounted = true
      quickMouseVisits++
      if (quickMouseVisits >= 3 && nativeSignalIsLive()) {
        saveCap("sink", "ineffective", "the pen reaches this window as mouse input")
        tr("sink-pen-as-mouse", {})
        releaseAll("ineffective")
        return
      }
    }
    if (tipDown) { pendingMouse = true; return } // not in the middle of a stroke: at the pen-up
    mouseLocked = true
    turnSinkOff("mouse")
  }
  const offMouse = extras()?.onMouse(onSinkMouse) ?? null

  function applyPendingMouse(): void {
    if (!pendingMouse || tipDown) return
    pendingMouse = false
    if (sinkOn) { mouseLocked = true; turnSinkOff("mouse") }
  }

  /** A tip that was last seen down more than a contact-visit ago is not trusted: a lost pen-up must not hold the sink on. */
  const tipIsDown = (now: number): boolean => tipDown && now - lastTipAt < LIVENESS.LEAVE_CONTACT_MS

  const nativeSignalIsLive = (): boolean => !!input && !!input.active && NATIVE_BACKENDS.has(input.active)

  // =============================================================================================================
  // The sink
  // =============================================================================================================

  function sinkAllowed(): boolean {
    // The sink is an invisible window over the whole display that swallows the mouse. It never worked on Sean's
    // hardware and, left on, it looked like a dead full-screen mode he could not get out of: opt-in only.
    if (process.env.WRITEMIND_PEN_SINK !== "1") return false
    const s = settings()
    if (!s || !s.enabled) return false
    if (s.contain !== "auto" && s.contain !== "sink") return false
    if (!s.backends.overlay) return false
    const c = capState("sink")
    return c !== "ineffective" && c !== "unsafe"
  }

  /** (f) something counts what the sink swallows: a live native backend, or the overlay backend is the active one (it counts the sink's events). */
  function consumerExists(): boolean {
    const a = input?.active ?? null
    return a === "overlay" || a === "inject" || (a !== null && NATIVE_BACKENDS.has(a))
  }

  function turnSinkOn(now: number): void {
    try { sink.setOn(true) } catch (e) { log(`sink.setOn(true) threw: ${(e as Error).message}`); return }
    sinkOn = true
    sinkOnAt = now
    sinkOffOrderedAt = null
    sinkVisitCounted = false
    armed = true
    mode = "sink"
    rect = null
    armedAt = now
    // Passive validation: what to compare against.
    const hadNative = nativeSignalIsLive()
    val = capState("sink") === "effective" ? null : { at: now, native0: nativeInRange, sink0: sinkPenCount, hadNative, refSignal: penSignal(now), decided: false }
    tr("sink-on", { validating: val !== null, native: hadNative })
  }

  function turnSinkOff(reason: DisarmReason): void {
    if (!sinkOn) return
    try { sink.setOn(false) } catch (e) { log(`sink.setOn(false) threw: ${(e as Error).message}`) }
    sinkOn = false
    sinkOffOrderedAt = deps.now()
    pendingMouse = false
    val = null
    armed = false
    lastRelease = { reason, at: deps.now() }
    tr("sink-off", { reason })
    if (mode === "sink") mode = "sink" // chosen but click-through: the sink stays the mechanism, `armed` says it is not hit-testing now
  }

  /** Passive validation (7.6): decide effective / ineffective from what the sink and the native backend count. */
  function validate(now: number): void {
    const v = val
    if (!v || v.decided || !sinkOn) return
    const age = now - v.at
    const sinkEvents = sinkPenCount - v.sink0
    const nativeSamples = nativeInRange - v.native0
    if (v.hadNative) {
      if (nativeSamples >= CONTAIN.SINK_MIN_NATIVE) {
        const ratio = sinkEvents / nativeSamples
        if (ratio >= CONTAIN.SINK_EFFECTIVE_RATIO) return decide("effective", `the sink saw ${sinkEvents} pen events for ${nativeSamples} tablet samples`)
        if (age >= CONTAIN.SINK_VALIDATE_MS) return decide("ineffective", `the sink saw ${sinkEvents} pen events for ${nativeSamples} tablet samples (needs at least ${Math.round(CONTAIN.SINK_EFFECTIVE_RATIO * 100)}%)`)
      } else if (age >= CONTAIN.SINK_VALIDATE_MAX_MS) {
        // not enough native samples to judge in 5 s: nothing was learned, nothing is recorded
        val = null
      }
      return
    }
    // No native backend live: the signal from before the sink turned on is the reference.
    if (sinkEvents >= CONTAIN.SINK_MIN_EVENTS && age <= CONTAIN.SINK_VALIDATE_MS) return decide("effective", `the sink saw ${sinkEvents} pen events in ${Math.round(age)} ms`)
    if (age > CONTAIN.SINK_VALIDATE_MS) {
      if (sinkEvents < CONTAIN.SINK_MIN_EVENTS && v.refSignal && stateFresh(now)) return decide("ineffective", `the pen is near but the sink saw only ${sinkEvents} pen events`)
      // The pen left, or there was no earlier signal to compare with: ambiguous. Turn off, record nothing, try again on the next visit.
      val = null
      tr("sink-validate-abort", { sinkEvents })
      turnSinkOff("pen-out")
    }
  }

  function decide(state: "effective" | "ineffective", note: string): void {
    if (val) val.decided = true
    saveCap("sink", state, note)
    tr("sink-validated", { state, note })
    log(`sink ${state}: ${note}`)
    if (state === "ineffective") { releaseAll("ineffective") } else val = null
  }

  /** The sink's own state machine, one step. `allowedNow` = all outer conditions (window, sheet, check, suspended ...) hold. */
  function stepSink(now: number, allowedNow: boolean): void {
    const allowed = allowedNow && (sinkAllowed() || forceSink)
    if (!allowed) {
      if (sinkOn) turnSinkOff(!consumerExists() ? "no-consumer" : "settings")
      try { sink.setShown(false) } catch { /* ignore */ }
      mouseLocked = false
      if (mode === "sink") mode = "none"
      return
    }
    mode = "sink"
    try { sink.setShown(true) } catch { /* ignore */ }

    // Unsafe checks first: they do not depend on the pen.
    if (sinkOn) {
      const beatAge = extras()?.beatAgeMs?.() ?? null
      if (beatAge !== null && beatAge > CONTAIN.HEARTBEAT_TIMEOUT_MS) return markUnsafe("sink", "the sink page stopped answering while it was hit-testing")
      if (now - Math.max(sinkOnAt, lastEventAt, lastStateAt) > CONTAIN.SINK_MAX_ON_MS) return markUnsafe("sink", "hit-testing for 60 s with no pen signal at all")
    } else {
      // We believe it is click-through. If the window says otherwise, say it again, and give up on it after 3 s.
      let hitTesting = false
      try { hitTesting = sink.state().on } catch { hitTesting = false }
      if (hitTesting) {
        if (sinkOffOrderedAt === null) sinkOffOrderedAt = now
        try { sink.setOn(false) } catch { /* ignore */ }
        if (now - sinkOffOrderedAt > CONTAIN.SINK_OFF_GRACE_MS) return markUnsafe("sink", "still hit-testing 3 s after it was told to stop")
      } else sinkOffOrderedAt = null
    }

    // Mouse lock: cleared once no pen signal has been seen for MOUSE_LOCK_CLEAR_MS.
    if (mouseLocked && now - Math.max(lastEventAt, lastStateAt) > CONTAIN.MOUSE_LOCK_CLEAR_MS) mouseLocked = false

    const signal = penSignal(now)
    const tip = tipIsDown(now)
    if (sinkOn) {
      if (!forceSink) validate(now)
      if (!sinkOn) return
      if (forceSink) return
      // (b): hit-testing never flips under a stroke, in either direction.
      if (!tip) {
        if (!signal) return turnSinkOff("pen-out")
        if (!consumerExists()) return turnSinkOff("no-consumer")
      }
    } else if (forceSink || (signal && !tip && !mouseLocked && consumerExists())) {
      turnSinkOn(now)
    }
  }

  // =============================================================================================================
  // The driver mapping and the clip
  // =============================================================================================================

  function driverWanted(): boolean {
    const s = settings()
    if (!s || !s.enabled || suspended || locked) return false
    if (s.contain === "driver") return capState("driver") !== "unsafe" && lease.ready()
    if (s.contain !== "auto") return false
    return capState("driver") === "honored" && lease.ready()
  }

  function stepDriver(now: number, sheet: Box): void {
    const active = input?.active ?? null
    const live = active === "wintab-system"
    if (!live) {
      if (mode === "driver") releaseAll("no-consumer")
      return
    }
    if (mode !== "driver") {
      // the sink is released: one mechanism at a time (driver > sink > clip)
      if (sinkOn) turnSinkOff("settings")
      try { sink.setShown(false) } catch { /* ignore */ }
      mode = "driver"
      armed = true
      rect = sheet
      armedAt = now
      outsideBeats = 0
      lastHeartbeatAt = now
      tr("arm", { mode: "driver", rect: sheet })
    }
    if (!sameBox(rect, sheet)) rect = sheet
    // Verify the mapping works: the OS cursor must stay inside the rectangle while the pen is in range.
    if (now - lastHeartbeatAt >= CONTAIN.HEARTBEAT_MS) {
      lastHeartbeatAt = now
      if (penSignal(now)) {
        let p: { x: number; y: number } | null = null
        try { p = deps.probe.cursor() } catch { p = null }
        if (p && rect && (p.x < rect.x - 2 || p.y < rect.y - 2 || p.x > rect.x + rect.width + 2 || p.y > rect.y + rect.height + 2)) outsideBeats++
        else outsideBeats = 0
        if (outsideBeats >= CONTAIN.DRIVER_OUTSIDE_BEATS) markUnsafe("driver", "the cursor left the mapped rectangle while the pen was in range")
      }
    }
  }

  function clipWanted(): boolean {
    const s = settings()
    if (!s || !s.enabled || suspended || locked) return false
    if (s.contain === "clip") return capState("clip") !== "unsafe"
    if (s.contain !== "auto") return false
    return deps.pointerMode() === "mouse" && capState("clip") !== "unsafe" && capState("clip") !== "ignored"
  }

  function stepClip(now: number, sheet: Box): void {
    const inRange = penSignal(now)
    if (!inRange) {
      if (mode === "clip") { releaseAll("pen-out") }
      return
    }
    if (!lease.ready()) { if (mode === "clip") releaseAll("guard-lost"); return }
    if (mode !== "clip" || !sameBox(rect, sheet)) {
      let ok = false
      try { ok = lease.armClip(sheet, DEFAULT_LEASE_MS) } catch (e) { log(`armClip threw: ${(e as Error).message}`); ok = false }
      if (!ok) { tr("clip-refused", { rect: sheet }); mode = "none"; armed = false; rect = null; return }
      mode = "clip"
      armed = true
      rect = sheet
      armedAt = now
      clipBadSince = null
      tr("arm", { mode: "clip", rect: sheet })
      return
    }
    // Verify that the OS clip is the one we armed (a foreign program may have replaced it).
    let cur: Box | null = null
    try { cur = lease.currentClip() } catch { cur = null }
    // The guard validated (clamped) the rectangle: compare against what the lease holds.
    const held = (lease as Partial<{ held(): { clip: { left: number; top: number; right: number; bottom: number } | null } }>).held?.().clip ?? null
    const expected = held ? { x: held.left, y: held.top, width: held.right - held.left, height: held.bottom - held.top } : sheet
    if (cur && !sameBox(cur, expected)) {
      if (clipBadSince === null) clipBadSince = now
      else if (now - clipBadSince >= CONTAIN.CLIP_VERIFY_MS) markUnsafe("clip", "the OS clip is not the armed rectangle")
    } else clipBadSince = null
  }

  // =============================================================================================================
  // One evaluation
  // =============================================================================================================

  function blocker(i: ContainmentUpdate, now: number): DisarmReason | null {
    if (suspended) return "panic"
    if (locked) return "lock"
    if (needFreshUpdate) return "display-changed"
    if (!i.settings.enabled) return "disabled"
    const real = windowCheck()
    if (i.window.minimized || real?.minimized) return "minimized"
    if (!i.window.visible || (real && !real.visible)) return "hidden"
    if (!i.window.focused || (real && !real.focused)) return "blur"
    if (!i.sheet || !saneSheet(i.sheetPhysical)) return "sheet-gone"
    if (i.settings.contain === "none") return "settings"
    if (i.checkRunning && !forceSink) return "check"
    void now
    return null
  }

  /** The guard is spawned lazily: only when a mechanism that needs it could be wanted (a clip, or a driver mapping that was proven). */
  function ensureGuard(i: ContainmentUpdate): void {
    const s = i.settings
    const need = s.contain === "driver" || s.contain === "clip" || (s.contain === "auto" && (capState("driver") === "honored" || deps.pointerMode() === "mouse"))
    if (!need || !s.enabled || lease.state() !== "none") return
    try { void lease.start().catch(() => undefined) } catch { /* fail closed: no guard, no clip */ }
  }

  function step(): void {
    const i = input
    if (!i || disposed) return
    const now = deps.now()
    // Idle release (any mechanism that is armed lets go; re-arming needs fresh activity).
    if (lastActivityAt > -Infinity && armed && now - Math.max(lastActivityAt, armedAt) > CONTAIN.IDLE_RELEASE_MS) {
      idleLatched = true
      releaseAll("idle", { keepSinkShown: true })
    }
    if (idleLatched && lastActivityAt > (lastRelease?.at ?? -Infinity)) idleLatched = false

    const why = blocker(i, now)
    if (why) {
      if (armed || sinkOn || mode !== "none") releaseAll(why)
      else { try { sink.setShown(false) } catch { /* ignore */ } try { lease.freeClip() } catch { /* ignore */ } }
      if (suspended) sink.setShown(false)
      return
    }
    const sheet = i.sheetPhysical as Box
    ensureGuard(i)

    // One mechanism at a time: driver > sink > clip.
    if (driverWanted() && !idleLatched) {
      stepDriver(now, sheet)
      if (mode === "driver") return
    } else if (mode === "driver") releaseAll("settings")

    const s = i.settings
    const penAsMouse = deps.pointerMode() === "mouse"
    if (s.contain === "clip" || (s.contain === "auto" && penAsMouse && clipWanted())) {
      if (sinkOn) turnSinkOff("settings")
      try { sink.setShown(false) } catch { /* ignore */ }
      if (!idleLatched) stepClip(now, sheet)
      return
    }
    if (mode === "clip") releaseAll("settings")
    if (idleLatched) { try { sink.setShown(false) } catch { /* ignore */ } return }
    stepSink(now, true)
  }

  function evaluate(): void {
    if (disposed) return
    try {
      step()
      errorStreak = 0
    } catch (e) {
      errorStreak++
      log(`evaluation threw: ${(e as Error).message}`)
      tr("error", { message: (e as Error).message })
      try { releaseAll("error") } catch { /* nothing more to do */ }
    }
  }

  // =============================================================================================================
  // Wiring: ticks, display, power, the lease's loss events
  // =============================================================================================================

  const cancelTick = every(CONTAIN.TICK_MS, () => {
    // The sink's mouse counter is polled too, for a sink without an event channel.
    try {
      const n = sink.mouseEvents()
      if (n !== lastMouseCount) { const fresh = n > lastMouseCount; lastMouseCount = n; if (fresh && !extras()) onSinkMouse() }
    } catch { /* ignore */ }
    evaluate()
  })

  const offDisplay = deps.display.metricsChanged(() => {
    if (disposed) return
    needFreshUpdate = true
    releaseAll("display-changed")
  })

  const offPower: (() => void)[] = []
  const power = deps.power ?? lazyPower()
  if (power) {
    offPower.push(power.on("lock-screen", () => { locked = true; releaseAll("lock") }))
    offPower.push(power.on("suspend", () => { locked = true; releaseAll("suspend") }))
    offPower.push(power.on("unlock-screen", () => { locked = false; evaluate() }))
    offPower.push(power.on("resume", () => { locked = false; evaluate() }))
  }

  const offLost = lease.onLost((why) => {
    if (disposed) return
    releaseAll(why)
  })
  const offPanicKey = (lease as Partial<{ onPanicKey(l: () => void): () => void }>).onPanicKey?.(() => {
    // The guard saw Ctrl+Alt+G and already let go of the clip and the contexts; the rest of the app follows.
    api.panic("panic-key")
    try { deps.onPanic?.("panic-key") } catch { /* ignore */ }
  }) ?? null
  const offRefused = (lease as Partial<{ onRefused(l: (why: string) => void): () => void }>).onRefused?.((why) => {
    if (disposed) return
    if (why === "foreign-clip") { tr("clip-refused", { why }); if (mode === "clip") releaseAll("foreign-clip") }
  }) ?? null

  // =============================================================================================================
  // The public surface
  // =============================================================================================================

  const api: Containment & { update(input: ContainmentUpdate): void; evaluate(): void } = {
    update(next) {
      if (disposed) return
      const prev = input
      input = next
      const now = deps.now()
      needFreshUpdate = false
      // A pen STATE: asserted now, or withdrawn (the visit ended). Events (samples) keep their own, shorter freshness.
      if (next.penInRange) noteSignal(false, false, now)
      else lastStateAt = -Infinity
      if (next.lastPenAt !== null) lastActivityAt = Math.max(lastActivityAt, next.lastPenAt)
      // Leaving a panic: the window left and re-entered, capture turned on again, or the sheet reopened.
      if (suspended) {
        if (!next.window.focused || !next.window.visible || next.window.minimized) sawBlurSincePanic = true
        const reenabled = prev && !prev.settings.enabled && next.settings.enabled
        const reopened = prev && !prev.sheet && !!next.sheet
        if ((sawBlurSincePanic && next.window.focused && next.window.visible && !next.window.minimized) || reenabled || reopened) {
          suspended = false
          sawBlurSincePanic = false
          tr("panic-cleared", {})
        }
      }
      evaluate()
    },
    evaluate,
    status() {
      const guardState = lease.state()
      return {
        mode, armed, rect, lastRelease, capabilities: caps(), pointerMode: deps.pointerMode(),
        guard: { state: guardState, pid: lease.pid() },
      }
    },
    driverMappingWanted() { try { return !disposed && driverWanted() } catch { return false } },
    sinkWanted() { try { return !disposed && !suspended && sinkAllowed() } catch { return false } },

    async test(mechanism): Promise<ContainmentTestResult> {
      return mechanism === "driver" ? testDriver() : testSink()
    },

    panic(reason) {
      if (disposed) return
      suspended = true
      sawBlurSincePanic = false
      releaseAll(reason === "esc" ? "esc" : reason || "panic")
      // A pending test must not keep anything on.
      forceSink = false
      try { sink.setShown(false) } catch { /* ignore */ }
      try { lease.freeClip() } catch { /* ignore */ }
      tr("panic", { reason })
    },

    dispose() {
      if (disposed) return
      releaseAll("quit")
      disposed = true
      cancelTick()
      for (const off of [offSamples, offSinkSamples, offDisplay, offLost, offPanicKey, offRefused, offMouse, ...offPower]) { try { off?.() } catch { /* ignore */ } }
      try { sink.setShown(false) } catch { /* ignore */ }
    },
  }

  // ---- the check's optional tests (9.6): explicit, short, always followed by a release ----------------------------

  /** Resolves after `ms` of the injected clock, polled on the same ticker the policy uses (so a fake clock drives it). */
  function waitFor(ms: number, done: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const start = deps.now()
      const cancel = every(CONTAIN.TICK_MS, () => {
        if (done() || deps.now() - start >= ms) { cancel(); resolve() }
      })
    })
  }

  async function testSink(): Promise<ContainmentTestResult> {
    const i = input
    if (!i || !i.sheet || !saneSheet(i.sheetPhysical) || !i.window.focused) {
      return { mechanism: "sink", state: "untested", detail: "WriteMind must be in front with the Tablet sheet showing for this test." }
    }
    if (!lease) return { mechanism: "sink", state: "untested", detail: "Containment is not available." }
    const sink0 = sinkPenCount
    const native0 = nativeInRange
    const hadNative = nativeSignalIsLive()
    const refBefore = penSignal(deps.now())
    forceSink = true
    evaluate() // turns it on at once, with a validation that this test replaces
    val = null
    try {
      await waitFor(CONTAIN.TEST_MS, () => false)
    } finally {
      forceSink = false
      releaseAll("check", { keepSinkShown: false })
      evaluate()
    }
    const events = sinkPenCount - sink0
    const native = nativeInRange - native0
    let state: CapabilityState
    let detail: string
    if (events >= CONTAIN.SINK_MIN_EVENTS && (!hadNative || native === 0 || events / Math.max(1, native) >= CONTAIN.SINK_EFFECTIVE_RATIO)) {
      state = "effective"; detail = `The sink caught ${events} pen events. The pen is held to WriteMind's sheet while it is near.`
    } else if (events === 0 && native === 0 && !refBefore) {
      state = "untested"; detail = "No pen was seen. Hold the pen over the tablet and move it during the 5 seconds, then try again."
    } else {
      state = "ineffective"; detail = `The pen was seen (${native} tablet samples) but the sink caught only ${events} pen events, so Windows is not handing it the pen.`
    }
    if (state !== "untested") saveCap("sink", state, detail)
    tr("sink-test", { state, events, native })
    return { mechanism: "sink", state, detail }
  }

  async function testDriver(): Promise<ContainmentTestResult> {
    const i = input
    if (!i || !saneSheet(i.sheetPhysical) || !i.window.focused) {
      return { mechanism: "driver", state: "untested", detail: "WriteMind must be in front with the Tablet sheet showing for this test." }
    }
    if (!lease.ready()) return { mechanism: "driver", state: "untested", detail: "The safety helper (the guard process) is not running, so the driver mapping is not tried." }
    const target = i.sheetPhysical as Box
    const backend = deps.probe.makeSystemBackend()
    const positions: { x: number; y: number }[] = []
    let spread = { minX: 1, maxX: 0, minY: 1, maxY: 0 }
    let samples = 0
    const off = deps.probe.onSamples((batch) => {
      for (const s of batch) {
        if (!s.inRange) continue
        samples++
        spread = { minX: Math.min(spread.minX, s.x), maxX: Math.max(spread.maxX, s.x), minY: Math.min(spread.minY, s.y), maxY: Math.max(spread.maxY, s.y) }
        try { positions.push(deps.probe.cursor()) } catch { /* ignore */ }
      }
    })
    let started = false
    try {
      const result = await backend.start({
        sheetPhysical: target, trace: deps.trace, lease, now: () => Date.now(), settings: i.settings,
      })
      if (!result.ok) return { mechanism: "driver", state: "untested", detail: `The Wintab mapping could not start: ${result.reason}` }
      started = true
      backend.setSheetPhysical(target)
      await waitFor(CONTAIN.TEST_MS, () => false)
    } finally {
      off()
      try { backend.setSheetPhysical(null) } catch { /* ignore */ }
      if (started) { try { backend.stop() } catch { /* ignore */ } } else { try { backend.stop() } catch { /* ignore */ } }
    }
    const moved = samples >= 10 && (spread.maxX - spread.minX > 0.5 || spread.maxY - spread.minY > 0.5)
    if (!moved) return { mechanism: "driver", state: "untested", detail: "The pen was not moved across the tablet during the 5 seconds. Sweep it over the whole tablet and try again." }
    const tol = 3
    const outside = positions.filter((p) => p.x < target.x - tol || p.y < target.y - tol || p.x > target.x + target.width + tol || p.y > target.y + target.height + tol).length
    if (positions.length > 0 && outside === 0) {
      const detail = "With the driver mapping on, the pointer stayed inside the sheet while the pen swept the whole tablet."
      saveCap("driver", "honored", detail)
      return { mechanism: "driver", state: "honored", detail }
    }
    const detail = `The pointer left the sheet ${outside} of ${positions.length} times: this driver does not honour the mapping here.`
    saveCap("driver", "ignored", detail)
    return { mechanism: "driver", state: "ignored", detail }
  }

  return api
}
