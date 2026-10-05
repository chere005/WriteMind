/**
 * main/pen/fake.ts - owned by IMPL-D. Test doubles and the small status helpers every stub shares.
 *
 *  - emptyCounters / emptyStatus: build a BackendStatus (so a stub or a fake need not spell all of it).
 *  - inertBackend: a backend that is never available (what the M0 stubs return until the real class lands).
 *  - FakeBackend: a scripted pretend backend for the manager tests (start delay / failure, samples on demand).
 *  - InjectBackend: the E2E backend; samples come from `pen:e2e-inject` and are already in the screen frame.
 *
 * No Electron, no Node-only API: importable from vitest.
 */
import type {
  BackendContext, BackendEvent, BackendName, BackendStart, BackendState, BackendStatus, Counters, DeviceInfo, PenBackend, PenSample,
} from "../../shared/pen"

export const emptyCounters = (): Counters => ({ samples: 0, inRange: 0, raw: 0, tipDowns: 0, visits: 0, errors: 0, dropped: 0 })

export function emptyStatus(name: BackendName, state: BackendState = "idle", reason: string | null = null): BackendStatus {
  return {
    name, state, reason, counters: emptyCounters(), lastSampleAt: null, lastInRangeAt: null, rateHz: null, gapP95Ms: null, device: null,
    seen: { pressure: false, lower: false, upper: false, eraser: false, tilt: false, moved: false },
    reach: null, pressureMaxSeen: 0, facts: {},
  }
}

/** A backend that can never run: `available()` says why, `start()` refuses. */
export function inertBackend(name: BackendName, frameKind: "screen" | "device", reason: string): PenBackend {
  return {
    name,
    frameKind,
    available: () => ({ ok: false, reason }),
    start: async (): Promise<BackendStart> => ({ ok: false, reason, retry: "never" }),
    stop: () => {},
    onSample: () => () => {},
    onEvent: () => () => {},
    status: () => emptyStatus(name, "unavailable", reason),
  }
}

export interface FakeBackendOptions {
  frameKind?: "screen" | "device"
  /** available() result; default ok. */
  unavailable?: string
  /** start() resolves after this many ms (setTimeout); default 0 = next microtask. */
  startDelayMs?: number
  /** start() never resolves (the manager's START_TIMEOUT_MS must rescue it). */
  startHangs?: boolean
  /** start() resolves {ok:false}. */
  startFails?: { reason: string; retry: "never" | "later" | "after-replug" }
  /** start() throws. */
  startThrows?: string
  device?: DeviceInfo | null
}

/** A scripted backend: tests call emit() to deliver samples exactly as a real backend would. */
export class FakeBackend implements PenBackend {
  readonly name: BackendName
  readonly frameKind: "screen" | "device"
  startCalls = 0
  stopCalls = 0
  ctx: BackendContext | null = null
  running = false
  private sampleListeners = new Set<(b: PenSample[]) => void>()
  private eventListeners = new Set<(e: BackendEvent) => void>()
  private readonly opts: FakeBackendOptions
  private state: BackendState = "idle"
  private reason: string | null = null

  constructor(name: BackendName, opts: FakeBackendOptions = {}) {
    this.name = name
    this.frameKind = opts.frameKind ?? "device"
    this.opts = opts
  }

  available(): { ok: true } | { ok: false; reason: string } {
    return this.opts.unavailable ? { ok: false, reason: this.opts.unavailable } : { ok: true }
  }

  async start(ctx: BackendContext): Promise<BackendStart> {
    this.startCalls++
    this.ctx = ctx
    this.state = "starting"
    if (this.opts.startThrows) throw new Error(this.opts.startThrows)
    if (this.opts.startHangs) return new Promise<BackendStart>(() => {})
    if (this.opts.startDelayMs) await new Promise<void>((r) => setTimeout(r, this.opts.startDelayMs))
    if (this.opts.startFails) {
      this.state = "failed"
      this.reason = this.opts.startFails.reason
      return { ok: false, ...this.opts.startFails }
    }
    this.running = true
    this.state = "armed"
    return { ok: true, device: this.opts.device ?? null }
  }

  stop(): void {
    this.stopCalls++
    this.running = false
    this.state = "idle"
  }

  onSample(listener: (b: PenSample[]) => void): () => void {
    this.sampleListeners.add(listener)
    return () => this.sampleListeners.delete(listener)
  }

  onEvent(listener: (e: BackendEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  status(): BackendStatus {
    const s = emptyStatus(this.name, this.state, this.reason)
    s.device = this.opts.device ?? null
    return s
  }

  /** Deliver a batch as a real backend would. Ignored (like a stopped backend) when not running. */
  emit(samples: PenSample[]): void {
    if (!this.running || samples.length === 0) return
    for (const l of [...this.sampleListeners]) l(samples)
  }

  emitEvent(e: BackendEvent): void {
    for (const l of [...this.eventListeners]) l(e)
  }
}

/**
 * The E2E backend. Always "available", frame kind screen, no OS resources. `push` is what pen:e2e-inject calls; the samples enter the
 * manager exactly where a real backend's samples enter.
 */
export class InjectBackend extends FakeBackend {
  constructor() {
    super("inject", { frameKind: "screen" })
  }

  push(samples: PenSample[]): void {
    this.emit(samples)
  }
}

/** A PenSample with sensible defaults, for tests and the E2E helpers: a hovering pen in the middle of the tablet. */
export function sample(over: Partial<PenSample> & { t: number }): PenSample {
  return {
    x: 0.5, y: 0.5, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "inject",
    ...over,
  }
}
