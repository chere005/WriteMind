/**
 * batcher.ts - the three small machines every pen backend shares (docs/spikes/DESIGN-pen-capture.md 4.2, 12.1):
 *
 *  - SampleBatcher: collects samples and hands them over in batches at most BATCH_MS (8 ms) after the first one, in order,
 *    never empty.
 *  - VisitTracker: the "pen is in range" logic. Authoritative signals first (the driver's proximity message, a HID In Range
 *    field); with none, a visit with no packets ends after LEAVE_HOVER_MS while hovering and LEAVE_CONTACT_MS in contact (a
 *    perfectly still pen sends nothing and must not be "lifted" mid-stroke). Exactly ONE leave sample per visit.
 *  - RateMeter: samples per second over the last 2 s of flow, and the 95th percentile gap between consecutive samples.
 *
 * Pure: no Node, no Electron, no koffi. Timers are injected.
 */

import { LIVENESS, type PenSample } from "../../shared/pen"

export type Schedule = (fn: () => void, ms: number) => unknown
export type Cancel = (handle: unknown) => void

export const defaultSchedule: Schedule = (fn, ms) => {
  const h = setTimeout(fn, ms) as unknown as { unref?: () => void }
  h.unref?.()
  return h
}
export const defaultCancel: Cancel = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)

// ---------------------------------------------------------------------------------------------
// SampleBatcher
// ---------------------------------------------------------------------------------------------

export class SampleBatcher {
  private pending: PenSample[] = []
  private timer: unknown = null
  private closed = false

  constructor(
    private readonly emit: (batch: PenSample[]) => void,
    private readonly maxDelayMs: number = LIVENESS.BATCH_MS,
    private readonly schedule: Schedule = defaultSchedule,
    private readonly cancel: Cancel = defaultCancel,
  ) {}

  push(s: PenSample): void {
    if (this.closed) return
    this.pending.push(s)
    if (this.timer === null) this.timer = this.schedule(() => { this.timer = null; this.flush() }, this.maxDelayMs)
  }

  pushAll(list: readonly PenSample[]): void {
    for (const s of list) this.push(s)
  }

  /** Hand over what is pending now (no-op when nothing is). A throwing listener never loses the next batch. */
  flush(): void {
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null }
    if (!this.pending.length) return
    const batch = this.pending
    this.pending = []
    this.emit(batch)
  }

  get size(): number { return this.pending.length }

  /** Discard what is pending and refuse more (stop()). */
  dispose(): void {
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null }
    this.pending = []
    this.closed = true
  }

  /** Re-arm after dispose (a backend started again). */
  reopen(): void { this.closed = false }
}

// ---------------------------------------------------------------------------------------------
// VisitTracker
// ---------------------------------------------------------------------------------------------

export interface VisitOptions {
  hoverMs?: number
  contactMs?: number
  /**
   * Safety net while the device's OWN proximity signal says the pen is near (an In Range field, WT_PROXIMITY): the ordinary timeouts are
   * off, but a signal that never says "left" (a lost message, a driver that only reports entering) must not keep a pen in range forever.
   * Long on purpose: a pen resting still above the tablet sends nothing for a long time. Defaults 15 s hovering, 60 s in contact.
   */
  authoritativeHoverMs?: number
  authoritativeContactMs?: number
}

/** The sample that ends a visit: the last position, nothing pressed, not in range. */
export function leaveSample(last: PenSample, t: number): PenSample {
  const { tiltX, tiltY } = last
  const out: PenSample = { ...last, t, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: false }
  if (tiltX === undefined) delete out.tiltX
  if (tiltY === undefined) delete out.tiltY
  return out
}

export class VisitTracker {
  private active = false
  private last: PenSample | null = null
  private lastAt = 0
  private authoritativeIn = false
  private visitCount = 0
  private readonly hoverMs: number
  private readonly contactMs: number
  private readonly authHoverMs: number
  private readonly authContactMs: number

  constructor(opts: VisitOptions = {}) {
    this.hoverMs = opts.hoverMs ?? LIVENESS.LEAVE_HOVER_MS
    this.contactMs = opts.contactMs ?? LIVENESS.LEAVE_CONTACT_MS
    this.authHoverMs = opts.authoritativeHoverMs ?? 15_000
    this.authContactMs = opts.authoritativeContactMs ?? 60_000
  }

  private limitFor(last: PenSample): number {
    if (this.authoritativeIn) return last.tip ? this.authContactMs : this.authHoverMs
    return last.tip ? this.contactMs : this.hoverMs
  }

  get inRange(): boolean { return this.active }
  /** Out -> in transitions seen. */
  get visits(): number { return this.visitCount }
  /** True while the driver's own proximity signal says the pen is near (the ordinary timeouts are then replaced by the long safety net). */
  get authoritative(): boolean { return this.authoritativeIn }
  get lastSample(): PenSample | null { return this.last }

  /**
   * A decoded sample arrived at `now` (epoch ms). Returns the sample to pass on, or null to DROP it: a second "out of range"
   * sample in a row would be a second leave in one visit.
   */
  observe(s: PenSample, now: number): PenSample | null {
    if (s.inRange) {
      if (!this.active) { this.active = true; this.visitCount++ }
      this.last = s
      this.lastAt = now
      return s
    }
    if (!this.active) return null
    this.active = false
    this.authoritativeIn = false
    this.last = null
    return s
  }

  /**
   * An authoritative proximity signal. `true` replaces the timeouts by the long safety net for this visit; `false` ends the visit now and
   * returns the leave sample (null when no visit was open).
   */
  proximity(inRange: boolean, now: number): PenSample | null {
    if (inRange) { this.authoritativeIn = true; return null }
    this.authoritativeIn = false
    return this.end(now)
  }

  /** Call regularly (even when nothing arrived). Returns the leave sample once, when the flow has stopped. */
  tick(now: number): PenSample | null {
    if (!this.active || !this.last) return null
    if (now - this.lastAt < this.limitFor(this.last)) return null
    return this.end(now)
  }

  /** The source is going away (unplugged, stopped): end the visit if one is open. */
  end(now: number): PenSample | null {
    if (!this.active || !this.last) { this.active = false; return null }
    const out = leaveSample(this.last, now)
    this.active = false
    this.authoritativeIn = false
    this.last = null
    return out
  }

  /** Milliseconds until `tick` could end the visit, or null when no visit is open. */
  nextDeadline(now: number): number | null {
    if (!this.active || !this.last) return null
    return Math.max(0, this.limitFor(this.last) - (now - this.lastAt))
  }

  reset(): void {
    this.active = false
    this.last = null
    this.authoritativeIn = false
  }
}

// ---------------------------------------------------------------------------------------------
// RateMeter
// ---------------------------------------------------------------------------------------------

/** A gap longer than this is a pause (the pen stopped), not the flow, and stays out of the percentile. */
const FLOW_GAP_MS = 500

export class RateMeter {
  private times: number[] = []
  private gaps: number[] = []
  private lastT: number | null = null

  constructor(private readonly windowMs = 2000, private readonly maxGaps = 256) {}

  /** `t` is the sample's own time (epoch ms). */
  push(t: number): void {
    if (this.lastT !== null) {
      const g = t - this.lastT
      if (g >= 0 && g <= FLOW_GAP_MS) {
        this.gaps.push(g)
        if (this.gaps.length > this.maxGaps) this.gaps.shift()
      }
    }
    this.lastT = t
    this.times.push(t)
    const cut = t - this.windowMs
    let i = 0
    while (i < this.times.length && this.times[i]! < cut) i++
    if (i > 0) this.times.splice(0, i)
  }

  /** Samples per second over the last window of flow; null when idle (nothing for 1.5 s `now`) or fewer than 2 samples. */
  rateHz(now: number): number | null {
    if (this.lastT === null || now - this.lastT > 1500 || this.times.length < 2) return null
    const span = this.times[this.times.length - 1]! - this.times[0]!
    if (span <= 0) return null
    return Math.round(((this.times.length - 1) / span) * 1000 * 10) / 10
  }

  /** 95th percentile of the gaps between consecutive samples (ms), null with fewer than 10 gaps. */
  gapP95Ms(): number | null {
    if (this.gaps.length < 10) return null
    const sorted = [...this.gaps].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
  }

  reset(): void { this.times = []; this.gaps = []; this.lastT = null }
}
