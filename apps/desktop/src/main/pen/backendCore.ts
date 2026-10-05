/**
 * backendCore.ts - the bookkeeping every native backend shares (docs/spikes/DESIGN-pen-capture.md 3.1 BackendStatus).
 *
 * A backend owns one BackendCore. It reports its lifecycle (`setState`), pushes every sample it produces through
 * `emit` (which updates the counters, `seen`, `reach`, the rate meter, the local liveness judgement and batches the
 * samples at BATCH_MS for the listeners) and reads `status()` for the manager. Listener exceptions are swallowed and
 * counted: a bug in the renderer feed must never kill a native poll loop.
 *
 * The state words: the backend itself sets idle / starting / armed / failed / unavailable. It also reports `live` while
 * the LIVENESS rule holds locally (>= LIVE_MIN_SAMPLES in-range samples inside LIVE_WINDOW_MS, one of which moved) and
 * drops back to `armed` when the visit ends. `stale` needs a witness (something other than this backend saying the pen is
 * here), so only the FeedManager ever decides it.
 */

import {
  LIVENESS,
  type BackendEvent, type BackendName, type BackendState, type BackendStatus, type Counters, type DeviceInfo, type PenSample,
} from "../../shared/pen"
import { RateMeter, SampleBatcher, type Cancel, type Schedule } from "./batcher"

export interface CoreOptions {
  /** Epoch ms with sub-millisecond precision, the same clock as PenSample.t. */
  now: () => number
  schedule?: Schedule
  cancel?: Cancel
}

const MOVE_EPS = 1e-4
const PRESSURE_EPS = 0.002

export const emptyCounters = (): Counters => ({ samples: 0, inRange: 0, raw: 0, tipDowns: 0, visits: 0, errors: 0, dropped: 0 })

export class BackendCore {
  readonly counters: Counters = emptyCounters()
  private state: BackendState = "idle"
  private reason: string | null = null
  private device: DeviceInfo | null = null
  private lastSampleAt: number | null = null
  private lastInRangeAt: number | null = null
  private readonly rate = new RateMeter()
  private seen = { pressure: false, lower: false, upper: false, eraser: false, tilt: false, moved: false }
  private reach: { x: [number, number]; y: [number, number] } | null = null
  private pressureMaxSeen = 0
  private readonly facts: Record<string, string | number | boolean | null> = {}
  private readonly sampleListeners = new Set<(batch: PenSample[]) => void>()
  private readonly eventListeners = new Set<(event: BackendEvent) => void>()
  private readonly batcher: SampleBatcher
  private prevIn = false
  private prevTip = false
  private prev: PenSample | null = null
  private liveWindow: { t: number; moved: boolean }[] = []

  constructor(readonly name: BackendName, private readonly o: CoreOptions) {
    this.batcher = new SampleBatcher((b) => this.deliver(b), LIVENESS.BATCH_MS, o.schedule, o.cancel)
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  setState(state: BackendState, reason: string | null = this.reason): void {
    this.state = state
    this.reason = reason
  }
  getState(): BackendState { return this.state }
  setReason(reason: string | null): void { this.reason = reason }
  getReason(): string | null { return this.reason }

  setDevice(info: DeviceInfo | null): void {
    this.device = info
    this.event({ kind: "device", info })
  }
  getDevice(): DeviceInfo | null { return this.device }

  fact(key: string, value: string | number | boolean | null): void { this.facts[key] = value }

  /** Forget everything observed (a new start). Listeners stay. */
  resetObservations(): void {
    Object.assign(this.counters, emptyCounters())
    this.lastSampleAt = null
    this.lastInRangeAt = null
    this.rate.reset()
    this.seen = { pressure: false, lower: false, upper: false, eraser: false, tilt: false, moved: false }
    this.reach = null
    this.pressureMaxSeen = 0
    this.prevIn = false
    this.prevTip = false
    this.prev = null
    this.liveWindow = []
    this.batcher.reopen()
  }

  // ---- counting -------------------------------------------------------------------------------

  raw(n = 1): void { this.counters.raw += n }
  dropped(n = 1): void { this.counters.dropped += n }
  error(message: string, fatal = false): void {
    this.counters.errors++
    this.event({ kind: "error", message, fatal })
  }

  // ---- samples --------------------------------------------------------------------------------

  /** One sample that has been decoded (and passed the visit tracker). */
  emit(s: PenSample): void {
    this.account(s)
    this.batcher.push(s)
  }

  emitAll(list: readonly PenSample[]): void {
    for (const s of list) this.emit(s)
  }

  /** Hand over what is batched now (tests; stop()). */
  flush(): void { this.batcher.flush() }
  /** Drop what is batched and stop batching (stop()). */
  discard(): void { this.batcher.dispose() }

  private account(s: PenSample): void {
    const c = this.counters
    c.samples++
    this.lastSampleAt = s.t
    if (s.inRange) {
      c.inRange++
      this.lastInRangeAt = s.t
      this.rate.push(s.t)
      if (s.p > this.pressureMaxSeen) this.pressureMaxSeen = s.p
      if (s.p > 0) this.seen.pressure = true
      if (s.lower) this.seen.lower = true
      if (s.upper) this.seen.upper = true
      if (s.eraser) this.seen.eraser = true
      if (s.tiltX !== undefined || s.tiltY !== undefined) this.seen.tilt = true
      const r = this.reach
      if (!r) this.reach = { x: [s.x, s.x], y: [s.y, s.y] }
      else {
        if (s.x < r.x[0]) r.x[0] = s.x
        if (s.x > r.x[1]) r.x[1] = s.x
        if (s.y < r.y[0]) r.y[0] = s.y
        if (s.y > r.y[1]) r.y[1] = s.y
      }
    }
    if (s.inRange && !this.prevIn) c.visits++
    if (s.tip && !this.prevTip) c.tipDowns++
    this.prevIn = s.inRange
    this.prevTip = s.tip
    // moved: a sample that differs from the in-range sample before it
    let moved = false
    if (s.inRange && this.prev && this.prev.inRange) {
      moved = Math.abs(s.x - this.prev.x) >= MOVE_EPS || Math.abs(s.y - this.prev.y) >= MOVE_EPS || Math.abs(s.p - this.prev.p) >= PRESSURE_EPS
      if (moved) this.seen.moved = true
    }
    this.prev = s
    this.judgeLiveness(s, moved)
  }

  private judgeLiveness(s: PenSample, moved: boolean): void {
    if (!s.inRange) {
      this.liveWindow = []
      if (this.state === "live") this.state = "armed"
      return
    }
    this.liveWindow.push({ t: s.t, moved })
    const cut = s.t - LIVENESS.LIVE_WINDOW_MS
    while (this.liveWindow.length && this.liveWindow[0]!.t < cut) this.liveWindow.shift()
    if (this.state === "armed" && this.liveWindow.length >= LIVENESS.LIVE_MIN_SAMPLES && this.liveWindow.some((e) => e.moved)) this.state = "live"
  }

  // ---- listeners ------------------------------------------------------------------------------

  onSample(listener: (batch: PenSample[]) => void): () => void {
    this.sampleListeners.add(listener)
    return () => { this.sampleListeners.delete(listener) }
  }

  onEvent(listener: (event: BackendEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  event(e: BackendEvent): void {
    for (const l of [...this.eventListeners]) {
      try { l(e) } catch { this.counters.errors++ }
    }
  }

  private deliver(batch: PenSample[]): void {
    for (const l of [...this.sampleListeners]) {
      try { l(batch) } catch { this.counters.errors++ }
    }
  }

  // ---- status ---------------------------------------------------------------------------------

  status(): BackendStatus {
    const now = this.o.now()
    return {
      name: this.name,
      state: this.state,
      reason: this.reason,
      counters: { ...this.counters },
      lastSampleAt: this.lastSampleAt,
      lastInRangeAt: this.lastInRangeAt,
      rateHz: this.rate.rateHz(now),
      gapP95Ms: this.rate.gapP95Ms(),
      device: this.device ? { ...this.device, claims: { ...this.device.claims } } : null,
      seen: { ...this.seen },
      reach: this.reach ? { x: [...this.reach.x], y: [...this.reach.y] } as { x: [number, number]; y: [number, number] } : null,
      pressureMaxSeen: this.pressureMaxSeen,
      facts: { ...this.facts },
    }
  }
}
