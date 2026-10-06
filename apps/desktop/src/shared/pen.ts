/**
 * shared/pen.ts - the contract of the pen feed: samples, frames, backends, settings, status, IPC names.
 *
 * Pure: types, constants and a few tiny helpers. No Electron, no DOM, no Node, no koffi. main/pen/*, the preload, the renderer and the
 * tests all import this one file, so it is the only place a name is spelled.
 *
 * The feed is small on purpose: the Wintab DATA backend (reads the tablet, moves nothing) and the E2E injectors. When Wintab is not
 * there the window's own pen events drive the sheet exactly as they always did (no backend, no message). No grab, no clip,
 * no hook, no check wizard. The one extra Wintab context (system mapping, main/pen/mapping.ts) only ever confines the pen to the sheet.
 */

// ---------------------------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------------------------

/**
 * One pen reading, as every backend produces it.
 *
 * FRAME. A backend delivers x / y in the DEVICE frame (its best static guess at "natural landscape, origin top-left, y down") unless
 * `PenBackend.frameKind` is "screen". The manager applies the FrameTransform, so everything that leaves it (`PenBatch`) is in the SCREEN
 * frame: where the driver would put the cursor if the whole tablet were mapped to the whole display. The renderer then applies the
 * person's Orientation (shared/orientation.ts `tabletToSheet`) and lands the point on the sheet.
 */
export interface PenSample {
  /** Epoch ms, fractional: performance.timeOrigin + performance.now(). ARRIVAL ORDER orders samples, never t. */
  t: number
  /** 0..1 over the tablet's active area, clamped, never NaN. */
  x: number
  y: number
  /** Pressure 0..1; 0 while hovering. */
  p: number
  /** Contact. */
  tip: boolean
  /** Side button nearer the tip. */
  lower: boolean
  upper: boolean
  /** The eraser end (Sean's pen has none; stays false). */
  eraser: boolean
  /** False on the single "pen left" sample that ends a visit, and while the backend says out of range. */
  inRange: boolean
  /** Degrees -90..90 like PointerEvent.tiltX / tiltY; ABSENT when the device has no tilt. */
  tiltX?: number
  tiltY?: number
  /** Which decoder made it: "wintab", "inject". */
  backend: string
}

/** What the manager hands the renderer: one backend's samples, in the screen frame, in order. */
export interface PenBatch {
  source: BackendName
  /** 1, 2, 3 ... per open feed; a gap means a batch was lost. */
  seq: number
  samples: PenSample[]
}

// ---------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------

export type Turn = 0 | 1 | 2 | 3

/** Mirror y first (`flipY`), then turn `turn` quarter turns clockwise inside the unit square. 8 possible transforms. */
export interface FrameTransform { turn: Turn; flipY: boolean }

export const IDENTITY_FRAME: FrameTransform = { turn: 0, flipY: false }

export function applyFrame(x: number, y: number, f: FrameTransform): [number, number] {
  const v = f.flipY ? 1 - y : y
  switch (f.turn) {
    case 0: return [x, v]
    case 1: return [1 - v, x]
    case 2: return [1 - x, 1 - v]
    default: return [v, 1 - x]
  }
}

export interface FrameRecord {
  frame: FrameTransform
  /** default = from the device's extents (frame.ts defaultFrame; the person's Orientation turns it on top); screen = the backend already delivers the sheet frame. */
  source: "default" | "screen"
  /** ISO time. */
  at: string
}

// ---------------------------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------------------------

/**
 * Priority order when several are live: first wins. `inject` (screen frame) and `inject-tablet` (a fake Wintab tablet in the DEVICE frame,
 * so the device frame and mapping apply) exist for the end-to-end tests only. `wintab-system` is the Wintab context that maps the pen onto a
 * rectangle of the screen (main/pen/mapping.ts owns it); it never feeds the sheet.
 */
export const BACKEND_ORDER = ["inject", "inject-tablet", "wintab-system", "wintab-data"] as const
export type BackendName = (typeof BACKEND_ORDER)[number]

export type BackendState =
  | "idle"         // not started
  | "starting"     // start() in flight
  | "armed"        // started, no pen data yet
  | "live"         // delivering samples that move
  | "stale"        // was live, silent
  | "failed"       // start failed
  | "unavailable"  // can never work here (not Windows, no dll): never started

export interface DeviceInfo {
  name: string
  vendorId: number | null
  productId: number | null
  /** Active-area width / height in natural landscape when known, else null. */
  aspect: number | null
  /** Raw axis extents as the backend sees them. */
  rawX: [number, number] | null
  rawY: [number, number] | null
  pressureMax: number | null
  /** What the driver CLAIMS. */
  claims: { pressure: boolean; tilt: boolean; lower: boolean; upper: boolean; eraser: boolean }
}

export interface Counters {
  /** PenSamples emitted. */
  samples: number
  /** ... of which inRange. */
  inRange: number
  /** Raw packets received (before decoding). */
  raw: number
  tipDowns: number
  /** out -> in transitions. */
  visits: number
  errors: number
  /** Raw records the decoder threw away. */
  dropped: number
}

export interface BackendStatus {
  name: BackendName
  state: BackendState
  /** Plain words, specific: "Wintab reports 0 tablets". Null when all is well. */
  reason: string | null
  counters: Counters
  /** Epoch ms of the last sample / last in-range sample. */
  lastSampleAt: number | null
  lastInRangeAt: number | null
  /** Samples per second over the last 2 s of flow, null when idle. */
  rateHz: number | null
  /** 95th-percentile gap between consecutive samples while in range (ms). */
  gapP95Ms: number | null
  device: DeviceInfo | null
  /** What has actually been observed since start. */
  seen: { pressure: boolean; lower: boolean; upper: boolean; eraser: boolean; tilt: boolean; moved: boolean }
  /** Extents reached by x / y (0..1, in the frame the backend delivered). Null before any sample. */
  reach: { x: [number, number]; y: [number, number] } | null
  pressureMaxSeen: number
  /** Backend-specific facts: strings, numbers, booleans only. */
  facts: Record<string, string | number | boolean | null>
}

export type BackendEvent =
  | { kind: "proximity"; inRange: boolean }
  | { kind: "device"; info: DeviceInfo | null }
  | { kind: "error"; message: string; fatal: boolean }
  | { kind: "note"; text: string }

export type BackendStart =
  | { ok: true; device: DeviceInfo | null }
  | { ok: false; reason: string; retry: "never" | "later" | "after-replug" }

/**
 * An OPTIONAL hook for a watchdog that could free a context after a hard kill. The app has NO such process and passes none (`lease` is
 * undefined): contexts are closed in-process on every exit path (wintabNative closeAllWintab) and recovered from the journal at the next
 * start. RESIDUAL RISK: End task / Stop-Process -Force / a native crash while the system mapping is live leaves a CXO_SYSTEM context in the
 * driver until WriteMind is started again (journal recovery) or the Wacom service is restarted. When a lease IS given, a system context
 * is only opened while it is ready (fail closed; the tests use this).
 */
export interface LeaseApi {
  ready(): boolean
  holdWintab(handle: string, mode: "data" | "system"): boolean
  dropWintab(handle: string): void
}

/** What the manager gives a backend when it starts it. */
export interface BackendContext {
  /** The sheet in physical screen pixels; only a system-mapped Wintab context looks at it. */
  sheetPhysical: Box | null
  trace: TraceSink
  lease?: LeaseApi
  /** Same clock as PenSample.t. */
  now(): number
  settings: PenFeedSettings
}

export interface PenBackend {
  readonly name: BackendName
  /** "screen": x / y already in the screen frame (inject, dom). "device": the manager applies the FrameTransform. */
  readonly frameKind: "screen" | "device"
  /** Cheap, side-effect free: can this ever work here (platform, dll present)? */
  available(): { ok: true } | { ok: false; reason: string }
  /** Open the OS resources. Never throws, never hangs past 4 s without resolving; idempotent. */
  start(ctx: BackendContext): Promise<BackendStart>
  /** Release EVERYTHING. Synchronous, idempotent, safe after a failed start and from an exit handler. */
  stop(): void
  /** Batches are at most 8 ms apart and never empty; the listener must be cheap. */
  onSample(listener: (batch: PenSample[]) => void): () => void
  onEvent(listener: (event: BackendEvent) => void): () => void
  status(): BackendStatus
}

/** Where backends write transitions and the first raw packets (main/pen/log.ts writes pen.log). */
export interface TraceSink {
  event(source: BackendName | "manager", name: string, data?: Record<string, unknown>): void
  /** One raw packet as hex; the log keeps only the first few per session. */
  raw(backend: BackendName, t: number, hex: string, note?: string): void
}

// ---------------------------------------------------------------------------------------------
// Settings (main keeps them in userData/pen-state.json; the renderer reads and writes them over IPC)
// ---------------------------------------------------------------------------------------------

export interface PenFeedSettings {
  /** Read the tablet pen natively while the Tablet sheet shows and the window is in front. (Which button does what is the renderer's penSettings.) */
  enabled: boolean
  /**
   * Also open Wintab's system-cursor context over the sheet so the tablet drives the OS cursor only inside it. ON by default
   * (Sean, 2026-10-06: "mapping the tablet to the sheet should be the default, not experimental").
   */
  mapSheet: boolean
}

export const DEFAULT_SETTINGS: PenFeedSettings = { enabled: true, mapSheet: true }

// ---------------------------------------------------------------------------------------------
// Geometry and the window
// ---------------------------------------------------------------------------------------------

export interface Box { x: number; y: number; width: number; height: number }

export interface WindowState { focused: boolean; visible: boolean; minimized: boolean }

/**
 * Where the sheet is, as the renderer measures it (CSS pixels inside the window) and how the person turned it. Main turns the rectangle
 * into PHYSICAL screen pixels for the system mapping (main/pen/mapping.ts). Null: no sheet is showing.
 */
export interface SheetReport { rect: Box; turns: 0 | 1 | 2 | 3 }

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

/** The tablet Wintab found. `aspect` is long side over short side (>= 1): the sheet takes the tablet's own shape. */
export interface TabletInfo { name: string; aspect: number; pressureMax: number | null }

/**
 * The system mapping (Wintab CXO_SYSTEM over the sheet): off (not tried: no sheet, no pen in range, a turned sheet), trying (verifying),
 * mapped (verified and active), refused (the driver did not honour it on this device: not retried until Retry), unavailable (no Wintab).
 */
export type MappingState = "off" | "trying" | "mapped" | "refused" | "unavailable"

export interface FeedStatus {
  /** False on platforms with no native feed at all: the UI shows nothing. */
  available: boolean
  open: boolean
  /** Capture released because the window is not in front / minimised / hidden. */
  released: string | null
  /** The backend feeding the sheet right now, or null (the pen then works as a plain pointer). */
  active: BackendName | null
  /**
   * THE ONE quiet status string for the sheet header: "Pen: tablet, mapped to sheet", "Pen: tablet", "Pen: window pointer" or "Pen: none"
   * ("" while the sheet is not open or off Windows). The renderer shows it only when a tablet exists (penWord.ts): with no Wintab the sheet says nothing.
   */
  text: string
  /** The tablet Wintab found, or null (no Wintab: the window's own pen drives the sheet). */
  tablet: TabletInfo | null
  mapping: MappingState
  /** Why Wintab is not the source, in plain words, or null. For the log and the tooltip. */
  note: string | null
  /** The frame in force for the active backend (screen frame once applied). */
  frame: FrameRecord | null
  settings: PenFeedSettings
}

export type FeedEvent =
  | { kind: "live"; backend: BackendName }
  | { kind: "failover"; from: BackendName | null; to: BackendName }
  | { kind: "released"; reason: string }

// ---------------------------------------------------------------------------------------------
// IPC (names are spelled ONCE, here; preload, main/pen/ipc.ts and the tests use PEN_CHANNELS)
// ---------------------------------------------------------------------------------------------

export const PEN_CHANNELS = {
  // renderer -> main, invoke
  open: "pen:open", // () -> FeedStatus  (the Tablet sheet is showing)
  close: "pen:close", // (reason: string) -> void
  status: "pen:status", // () -> FeedStatus
  settings: "pen:settings", // () -> PenFeedSettings
  setSettings: "pen:settings-set", // (Partial<PenFeedSettings>) -> PenFeedSettings
  mappingRetry: "pen:mapping-retry", // () -> FeedStatus  forget "the driver did not honour the system mapping"
  // renderer -> main, fire and forget
  sheet: "pen:sheet", // (SheetReport | null): where the sheet is, for the system mapping
  panic: "pen:panic", // (reason: string)
  // main -> renderer
  samples: "pen:samples", // PenBatch (the active backend only, screen frame)
  statusPush: "pen:status-push", // FeedStatus (changes only)
  event: "pen:event", // FeedEvent
  // WRITEMIND_E2E only
  e2eInject: "pen:inject", // ({ samples: PenSample[]; backend?: "inject" | "inject-tablet" }) -> void
  e2eState: "pen:e2e-state", // () -> FeedStatus
  e2eConfig: "pen:e2e-config", // ({ native?: boolean; focused?: boolean; capture?: boolean }) -> FeedStatus  (focused overrides the E2E "always in front"; capture turns pen capture on, it starts OFF under E2E)
} as const
export type PenChannel = (typeof PEN_CHANNELS)[keyof typeof PEN_CHANNELS]

/** window.wm.pen, as the preload exposes it (preload.ts builds it from PEN_CHANNELS; wm.d.ts types it with this). */
export interface PenApi {
  open(): Promise<FeedStatus>
  close(reason: string): Promise<void>
  status(): Promise<FeedStatus>
  settings(): Promise<PenFeedSettings>
  setSettings(patch: Partial<PenFeedSettings>): Promise<PenFeedSettings>
  panic(reason: string): void
  /** Where the sheet is (null: not showing). Fire and forget. */
  sheet(report: SheetReport | null): void
  /** Try the system mapping again on this device. */
  retryMapping(): Promise<FeedStatus>
  onSamples(listener: (batch: PenBatch) => void): () => void
  onStatus(listener: (status: FeedStatus) => void): () => void
  onEvent(listener: (event: FeedEvent) => void): () => void
  /** Present only under WRITEMIND_E2E. */
  e2e?: {
    inject(samples: PenSample[], backend?: "inject" | "inject-tablet"): Promise<void>
    state(): Promise<FeedStatus>
    config(c: { native?: boolean; focused?: boolean; capture?: boolean }): Promise<FeedStatus>
  }
}

// ---------------------------------------------------------------------------------------------
// Liveness: every number the feed uses, in one place
// ---------------------------------------------------------------------------------------------

export const LIVENESS = {
  /** A backend is LIVE after this many in-range samples within LIVE_WINDOW_MS, at least one of which differs from the one before in x, y or p. */
  LIVE_MIN_SAMPLES: 4,
  LIVE_WINDOW_MS: 1000,
  /** start() must resolve within this, else failed("start timed out"). */
  START_TIMEOUT_MS: 4000,
  /** A visit with no packets ends after this long hovering, or this long in contact (a still pen sends nothing). */
  LEAVE_HOVER_MS: 600,
  LEAVE_CONTACT_MS: 2000,
  /** Batches leave a backend at most this long after their first sample. */
  BATCH_MS: 8,
  /** The active backend is silent this long while another delivers: the other takes over (never mid-stroke, unless the silence is STUCK_AFTER_MS). */
  SILENT_AFTER_MS: 800,
  STUCK_AFTER_MS: 2500,
  /** The system mapping: verified within this long of the pen MOVING (at least MAP_MIN_CHECKS checks), judged on MAP_TOLERANCE of the rectangle. */
  MAP_VERIFY_MS: 2000,
  MAP_MIN_CHECKS: 4,
  MAP_TOLERANCE: 0.08,
  /** Restart backoff after a failed Wintab start: 5 s, 15 s, 45 s, then give up until the sheet is opened again. */
  BACKOFF_MS: [5000, 15000, 45000],
  /** Backends are stopped this long after the window stops being in front. */
  BLUR_GRACE_MS: 1500,
} as const

/** The tablet-normalised bits the log stores per sample: tip=1, lower=2, upper=4, eraser=8, inRange=16. */
export const sampleFlags = (s: PenSample): number =>
  (s.tip ? 1 : 0) | (s.lower ? 2 : 0) | (s.upper ? 4 : 0) | (s.eraser ? 8 : 0) | (s.inRange ? 16 : 0)

export const clamp01 = (v: number): number => (v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v)
