/**
 * penSinkCore.ts - the logic of the pen-sink PAGE, pure and testable (docs/spikes/DESIGN-pen-capture.md 7.6; PenSink.tsx is the glue).
 *
 * What it does: turns the pen's pointer events (coalesced ones included) into `DomPenReport`s, batched one message per animation
 * frame; tells main about the first real mouse event; beats every second; and owns the page's own safety (shared/penSink.ts):
 *   - `solid` (the page paints rgba(0,0,0,0.01), so Windows hit-tests it) is true only while main said "on", no real mouse event
 *     has arrived since, and main has been heard from within SINK_DEAD_MAN_MS;
 *   - a real mouse event drops `solid` at once;
 *   - the page that has not heard from main goes transparent by itself.
 */

import type { DomPenReport } from "../shared/pen"
import { SINK_DEAD_MAN_MS } from "../shared/penSink"

/** The fields of a PointerEvent the page needs. */
export interface PtrEvt {
  type: string
  pointerType: string
  /** DIP on the virtual desktop. */
  screenX: number
  screenY: number
  pressure: number
  buttons: number
  /** event.timeStamp (ms since timeOrigin). */
  timeStamp: number
  tiltX?: number
  tiltY?: number
}

export interface SinkPageOptions {
  /** performance.timeOrigin */
  timeOrigin: number
  now(): number
  send: { pen(reports: DomPenReport[]): void; mouse(): void; beat(): void }
  /** The page's paint: true = rgba(0,0,0,0.01) (hit-testable), false = fully transparent (falls through). */
  paint(solid: boolean): void
}

/** A mouse event this soon after a pen event is the pen's own compatibility echo. */
export const ECHO_MS = 300
export const MOUSE_REPORT_GAP_MS = 100
export const BEAT_MS = 1000

export class SinkPageCore {
  private queue: DomPenReport[] = []
  private told = false
  private heardAt: number
  private mouseDropped = false
  private lastPenAt = -Infinity
  private lastMouseSentAt = -Infinity
  private lastBeatAt = -Infinity
  private solid = false
  /** Counters for the page's own diagnostics (window.__penSink in the E2E). */
  readonly counts = { pen: 0, mouse: 0, echo: 0, sentBatches: 0 }

  constructor(private readonly o: SinkPageOptions) {
    this.heardAt = o.now()
    this.apply()
  }

  private apply(): void {
    const next = this.told && !this.mouseDropped && this.o.now() - this.heardAt <= SINK_DEAD_MAN_MS
    if (next !== this.solid) {
      this.solid = next
      this.o.paint(next)
    }
  }

  get isSolid(): boolean { return this.solid }

  /** main said the sink is `on` (hit-testable) or not. Also the page's proof that main is alive. */
  onState(on: boolean): void {
    this.heardAt = this.o.now()
    if (!on) this.mouseDropped = false // main has turned it off: the next "on" starts clean
    this.told = on
    this.apply()
  }

  private report(e: PtrEvt, inRange: boolean): DomPenReport {
    const r: DomPenReport = {
      t: this.o.timeOrigin + e.timeStamp, sx: e.screenX, sy: e.screenY, p: inRange ? e.pressure : 0, buttons: inRange ? e.buttons : 0, inRange,
    }
    if (typeof e.tiltX === "number") r.tiltX = e.tiltX
    if (typeof e.tiltY === "number") r.tiltY = e.tiltY
    return r
  }

  /** One pointer event and its coalesced events (the last of which may be the event itself). Returns true when it was the pen's (to be swallowed). */
  onPointer(e: PtrEvt, coalesced: readonly PtrEvt[] = []): boolean {
    const now = this.o.now()
    if (e.pointerType === "pen") {
      this.lastPenAt = now
      this.counts.pen++
      const leaving = e.type === "pointerleave" || e.type === "pointercancel" || e.type === "pointerout"
      const list = !leaving && coalesced.length ? coalesced : [e]
      for (const c of list) this.queue.push(this.report(c, !leaving))
      if (this.queue.length > 512) this.queue.splice(0, this.queue.length - 512)
      return true
    }
    if (e.pointerType === "mouse") {
      if (now - this.lastPenAt < ECHO_MS) { this.counts.echo++; return false }
      this.counts.mouse++
      // The mouse wins before main has even been told.
      if (!this.mouseDropped) { this.mouseDropped = true; this.apply() }
      if (now - this.lastMouseSentAt >= MOUSE_REPORT_GAP_MS) { this.lastMouseSentAt = now; this.o.send.mouse() }
    }
    return false
  }

  /** Once per animation frame. */
  flush(): void {
    if (!this.queue.length) return
    const batch = this.queue
    this.queue = []
    this.counts.sentBatches++
    this.o.send.pen(batch)
  }

  /** Every 250 ms or so. */
  tick(): void {
    const now = this.o.now()
    if (now - this.lastBeatAt >= BEAT_MS) { this.lastBeatAt = now; this.o.send.beat() }
    this.apply() // the dead man
  }
}
