/**
 * Shared doubles of the native-backend tests (not a test file): a manual clock for the 8 ms batching and the poll loop, a trace that
 * records, a lease that records, and a BackendContext builder. No timers of the real kind: nothing in these tests waits.
 */
import type { BackendContext, BackendEvent, Box, LeaseApi, PenFeedSettings, PenSample, TraceSink } from "../../src/shared/pen"
import { DEFAULT_SETTINGS } from "../../src/shared/pen"

export class ManualClock {
  now = 1_700_000_000_000
  private id = 0
  private jobs = new Map<number, { at: number; fn: () => void }>()
  readonly schedule = (fn: () => void, ms: number): unknown => { const k = ++this.id; this.jobs.set(k, { at: this.now + ms, fn }); return k }
  readonly cancel = (h: unknown): void => { this.jobs.delete(h as number) }
  /** Run everything due within `ms`, in time order, moving the clock. */
  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      const due = [...this.jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.now = Math.max(this.now, due[1].at)
      this.jobs.delete(due[0])
      due[1].fn()
    }
    this.now = end
  }
  pending(): number { return this.jobs.size }
}

export class RecordingTrace implements TraceSink {
  events: { source: string; name: string; data?: Record<string, unknown> }[] = []
  raws: { backend: string; t: number; hex: string; note?: string }[] = []
  event(source: string, name: string, data?: Record<string, unknown>): void { this.events.push({ source, name, data }) }
  raw(backend: string, t: number, hex: string, note?: string): void { this.raws.push({ backend, t, hex, note }) }
  named(name: string): { source: string; name: string; data?: Record<string, unknown> }[] { return this.events.filter((e) => e.name === name) }
}

export class RecordingLease implements LeaseApi {
  isReady = true
  accept = true
  held: { handle: string; mode: string }[] = []
  dropped: string[] = []
  ready(): boolean { return this.isReady }
  holdWintab(handle: string, mode: "data" | "system"): boolean {
    this.held.push({ handle, mode })
    return this.isReady && this.accept
  }
  dropWintab(handle: string): void { this.dropped.push(handle) }
}

export interface Harness {
  clock: ManualClock
  trace: RecordingTrace
  lease: RecordingLease
  ctx(over?: { sheetPhysical?: Box | null; settings?: Partial<PenFeedSettings> }): BackendContext
}

export function harness(): Harness {
  const clock = new ManualClock()
  const trace = new RecordingTrace()
  const lease = new RecordingLease()
  return {
    clock, trace, lease,
    ctx: (over = {}) => ({
      sheetPhysical: over.sheetPhysical ?? null,
      trace, lease, now: () => clock.now,
      settings: { ...DEFAULT_SETTINGS, ...over.settings },
    }),
  }
}

/** Everything a backend emitted, flat, plus its events. */
export class Collector {
  samples: PenSample[] = []
  batches: PenSample[][] = []
  events: BackendEvent[] = []
  constructor(backend: { onSample(l: (b: PenSample[]) => void): () => void; onEvent(l: (e: BackendEvent) => void): () => void }) {
    backend.onSample((b) => { this.batches.push(b); this.samples.push(...b) })
    backend.onEvent((e) => this.events.push(e))
  }
  proximity(): boolean[] { return this.events.flatMap((e) => (e.kind === "proximity" ? [e.inRange] : [])) }
  errors(): Extract<BackendEvent, { kind: "error" }>[] { return this.events.filter((e): e is Extract<BackendEvent, { kind: "error" }> => e.kind === "error") }
}

export const hexOf = (b: Uint8Array): string => Buffer.from(b).toString("hex")
