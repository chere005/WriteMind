/**
 * shared/pen.ts - THE CONTRACT of native pen capture (docs/spikes/DESIGN-pen-capture.md section 3).
 *
 * Pure: types, constants and four tiny helpers. No Electron, no DOM, no Node, no koffi. main/pen/*, the
 * preload, the renderer and the tests all import this one file, so it is the only place a name is spelled.
 * IMPL-D creates it first (copy this block verbatim); nobody else edits it without telling IMPL-D.
 */

// ---------------------------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------------------------

/**
 * One pen reading, as every backend produces it (the shape the spikes agreed on).
 *
 * FRAME. A backend delivers x / y in the DEVICE frame (its best static guess at "natural landscape, origin
 * top-left, y down") unless `PenBackend.frameKind` is "screen". The FeedManager applies the calibrated
 * FrameTransform, so everything that leaves the manager (`PenBatch`) is in the SCREEN frame: where the
 * driver would put the cursor if the whole tablet were mapped to the whole display. The renderer then
 * applies the person's Orientation (shared/orientation.ts `tabletToSheet`) and lands the point on the sheet.
 */
export interface PenSample {
  /** Epoch ms, fractional: performance.timeOrigin + performance.now(). Comparable across processes. ARRIVAL ORDER orders samples, never t. */
  t: number
  /** 0..1 over the tablet's active area, clamped, never NaN. */
  x: number
  y: number
  /** Pressure 0..1; 0 while hovering. */
  p: number
  /** Contact. */
  tip: boolean
  /** Side button nearer the tip (the setting `swapButtons` flips lower / upper). */
  lower: boolean
  upper: boolean
  /** The eraser end (Sean's pen has none; stays false). */
  eraser: boolean
  /** False on the single "pen left" sample that ends a visit, and while the backend says out of range. */
  inRange: boolean
  /** Degrees -90..90 like PointerEvent.tiltX / tiltY; ABSENT when the device has no tilt. */
  tiltX?: number
  tiltY?: number
  /** Free-form label of the decoder that made it: "wintab", "rawinput-hid", "rawinput-synth", "webhid", "dom", "overlay", "inject". */
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
  /** default = a guess from the extents; cursor / dom = fitted against pairs; strokes = two guided strokes; manual = the person chose; screen = the backend already delivers the screen frame. */
  source: "default" | "cursor" | "dom" | "strokes" | "manual" | "screen"
  /** Root-mean-square error of the fit (unit square) and how clearly it beat the runner-up (x). Null for default / manual / screen. */
  rms: number | null
  margin: number | null
  /** ISO time. */
  at: string
}

// ---------------------------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------------------------

/**
 * Priority order when several are live: first wins. `inject` exists for the end-to-end tests only. `dom` is the notes window's own pen
 * events (design 4.7): the baseline that needs no driver, so it ranks below every tablet-native backend and above the overlay.
 */
export const BACKEND_ORDER = ["inject", "wintab-system", "wintab-data", "rawinput", "webhid", "dom", "overlay"] as const
export type BackendName = (typeof BACKEND_ORDER)[number]
export type NativeBackendName = Exclude<BackendName, "inject">

export type BackendState =
  | "idle"         // not started
  | "starting"     // start() in flight
  | "armed"        // started, no pen data yet (nothing to say the pen is here)
  | "live"         // delivering samples that move
  | "stale"        // was live, silent while a witness says the pen is here
  | "failed"       // start failed or stayed stale: restarted with backoff, or given up (see reason)
  | "unavailable"  // can never work here (not Windows, no dll, switched off): never started

export interface DeviceInfo {
  name: string
  vendorId: number | null
  productId: number | null
  /** Active-area width / height in natural landscape when known (physical units), else null. */
  aspect: number | null
  /** Raw axis extents as the backend sees them, for the trace and the check. */
  rawX: [number, number] | null
  rawY: [number, number] | null
  pressureMax: number | null
  /** What the driver / descriptor CLAIMS. `BackendStatus.seen` is what was OBSERVED; the check compares the two. */
  claims: { pressure: boolean; tilt: boolean; lower: boolean; upper: boolean; eraser: boolean }
}

export interface Counters {
  /** PenSamples emitted. */
  samples: number
  /** ... of which inRange. */
  inRange: number
  /** Raw packets / reports received (before decoding). */
  raw: number
  tipDowns: number
  /** out -> in transitions. */
  visits: number
  errors: number
  /** Raw records the decoder threw away (implausible, too short, unknown report id). */
  dropped: number
}

export interface BackendStatus {
  name: BackendName
  state: BackendState
  /** Plain words, specific: "WTInfo reports 0 devices (the tablet is not working or the Wacom service is down)". Null when all is well. */
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
  /** Extents reached by x / y (0..1, in the frame the backend delivered): the check's coverage test. Null before any sample. */
  reach: { x: [number, number]; y: [number, number] } | null
  pressureMaxSeen: number
  /** Backend-specific facts for the diagnostics: strings, numbers, booleans only. */
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

/** What backends see of the guard process (IMPL-C implements it; carried in BackendContext). */
export interface LeaseApi {
  /** True when the guard process is up and answering. */
  ready(): boolean
  /** Register a Wintab context handle (decimal string) the guard must close if the app dies or stops beating. false = the guard is down or refused: a SYSTEM context must then be closed again at once (fail closed). */
  holdWintab(handle: string, mode: "data" | "system"): boolean
  dropWintab(handle: string): void
}

/** What the manager gives a backend when it starts it. */
export interface BackendContext {
  /** The sheet in physical screen pixels; only the wintab-system backend (and the sink) look at it. */
  sheetPhysical: Box | null
  trace: TraceSink
  lease: LeaseApi
  /** Same clock as PenSample.t. */
  now(): number
  settings: PenFeedSettings
}

export interface PenBackend {
  readonly name: BackendName
  /** "screen": x / y already in the screen frame (inject, overlay). "device": the manager applies the calibrated FrameTransform. */
  readonly frameKind: "screen" | "device"
  /** Cheap, side-effect free: can this ever work here (platform, dll present, not switched off)? */
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

/** Where backends write the raw packets / reports and the transitions that go into pen-trace.jsonl. The sink applies every cap. */
export interface TraceSink {
  event(source: BackendName | "manager" | "renderer" | "containment" | "check", name: string, data?: Record<string, unknown>): void
  /** One raw packet / report as hex (the sink keeps the first N per backend per session, then a sparse sample). */
  raw(backend: BackendName, t: number, hex: string, note?: string): void
  /**
   * OPTIONAL (added by IMPL-D in round 1, adopted in revision 2): the sampled record kinds of the trace (`smp`, `dom`, `cur`, `st`, section 10),
   * which the manager decimates and caps itself. A sink without it receives the same data as `event(...)` calls named like the kind.
   */
  record?(kind: "smp" | "dom" | "cur" | "st", data: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------------------------
// Settings (main keeps them in userData/pen-state.json; the renderer reads and writes them over IPC)
// ---------------------------------------------------------------------------------------------

/**
 * auto = the pen sink on auto-trial (design 7.2, 7.6) and, only if the check proved it here, the driver mapping; clip only if the tablet was measured to be in
 * Mouse mode. sink / driver / clip force that one mechanism. none = no mechanism and no overlay backend.
 */
export type ContainSetting = "auto" | "driver" | "sink" | "clip" | "none"

export interface PenFeedSettings {
  /** "Pen capture": read the tablet pen natively while the Tablet sheet shows and the window is in front. */
  enabled: boolean
  /** Per-backend switches: a backend that misbehaves can be turned off for good. */
  backends: Record<NativeBackendName, boolean>
  /** Force one backend (null = automatic, by liveness). Useful to compare; the check ignores it. */
  prefer: BackendName | null
  /** See ContainSetting. */
  contain: ContainSetting
  /** The physical lower / upper side buttons are the other way round. */
  swapButtons: boolean
  /** Write pen-trace.jsonl. */
  trace: boolean
}

export const DEFAULT_SETTINGS: PenFeedSettings = {
  enabled: true,
  backends: { "wintab-system": true, "wintab-data": true, rawinput: true, webhid: true, dom: true, overlay: true },
  prefer: null,
  contain: "auto",
  swapButtons: false,
  trace: true,
}

// ---------------------------------------------------------------------------------------------
// Geometry and the window
// ---------------------------------------------------------------------------------------------

export interface Box { x: number; y: number; width: number; height: number }

/** The sheet as the renderer sees it. Main turns it into physical screen pixels (screen.dipToScreenRect). */
export interface SheetGeometry {
  /** getBoundingClientRect of [data-tablet="surface"], CSS pixels of the notes window's page. */
  rect: Box
  /** The person's Orientation in quarter turns (the sheet is portrait for 1 and 3). */
  turns: Turn
  /** Width / height as shown. */
  aspect: number
}

export interface WindowState { focused: boolean; visible: boolean; minimized: boolean }

/** Evidence that a pen is (or is not) near the tablet, from somewhere other than the backend being judged. */
export interface Witness {
  /** "dom" = a pen event Windows delivered to one of our own pages: the notes window (the gate, design 8.4) or the pen sink (design 7.6). */
  source: "dom" | "pointer-range" | "wizard" | "cursor"
  inRange: boolean
  /** Epoch ms. */
  at: number
  /** DOM only: the renderer sets this from PointerEvent.screenX / screenY (DIP, virtual desktop). */
  screenDip?: { x: number; y: number }
  /** Main fills this from `screenDip` (or from the OS cursor): where the pen is, as fractions of the display that contains the point (0..1, y down). Pairs with a device sample for frame calibration. */
  screen?: { x: number; y: number }
  /** DOM only: the event's buttons mask and pointer type, for the echo rule. */
  buttons?: number
  pointerType?: string
}

/**
 * What the renderer's gate reports for ONE pen pointer event, coalesced events included (each is its own report), on `pen:dom`, at most one
 * message per animation frame. Main turns it into a `PenSample` in the screen frame (main/pen/domBackend.ts, design 4.7); the renderer does
 * no display arithmetic of its own, so multi-display and scale handling live in one place that has Electron's `screen`.
 */
export interface DomPenReport {
  /** Epoch ms (performance.timeOrigin + event.timeStamp). */
  t: number
  /** PointerEvent.screenX / screenY: DIP on the virtual desktop. (The app has no page zoom today; if a zoom feature is ever added, check that Chromium does not scale them by the zoom factor and divide it out before sending.) */
  sx: number
  sy: number
  /** PointerEvent.pressure, 0..1 (0 while hovering). */
  p: number
  /** PointerEvent.buttons: tip 1, barrel 2, 4 only when the driver maps a second button, eraser 32. */
  buttons: number
  /** False on the one report that ends a visit (the pen leaves the document, or pointercancel). */
  inRange: boolean
  tiltX?: number
  tiltY?: number
}

// ---------------------------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------------------------

export type ContainMechanism = "driver" | "sink" | "clip"

/** untested = never tried here; honored / effective = observed to work on this machine; ignored / ineffective = observed NOT to; unsafe = it misbehaved (never retried automatically). */
export type CapabilityState = "untested" | "honored" | "ignored" | "effective" | "ineffective" | "unsafe"

export interface CapabilityRecord { state: CapabilityState; at: string | null; note: string | null }

export interface ContainmentStatus {
  mode: "none" | ContainMechanism
  armed: boolean
  /** The rectangle in physical screen pixels while armed. */
  rect: Box | null
  lastRelease: { reason: string; at: number } | null
  capabilities: { driver: CapabilityRecord; sink: CapabilityRecord; clip: CapabilityRecord }
  /** "pen" = the driver moves the cursor to where the pen is (Pen mode); "mouse" = relative (Mouse mode); null = not measured. */
  pointerMode: "pen" | "mouse" | null
  guard: { state: "none" | "starting" | "ready" | "lost"; pid: number | null }
}

export interface ContainmentTestResult {
  mechanism: "driver" | "sink"
  state: CapabilityState
  /** Plain words for the person: what was measured. */
  detail: string
}

// ---------------------------------------------------------------------------------------------
// Status the HUD, the check and the diagnostics read
// ---------------------------------------------------------------------------------------------

/** One entry of Windows' pointer-device list (GetPointerDevices + GetPointerDeviceRects). Read-only facts for the check and the diagnostics (design 7.6). */
export interface PointerDeviceSummary {
  /** productString: "CTL-472" for the Wacom, "\??\Microsoft HID RID\000D_0002\1" for a synthetic pen. */
  product: string
  /** INTEGRATED_PEN, EXTERNAL_PEN, TOUCH, TOUCH_PAD, or the number. */
  kind: string
  cursorId: number
  /** himetric (0.01 mm): the tablet's physical size for a real pen (15201 x 9501 for the CTL-472); null when Windows would not say. */
  deviceRect: Box | null
  /** Pixels: the part of the desktop the device is mapped to (the whole display by default). */
  displayRect: Box | null
  /** True for `Microsoft HID RID` devices: a pen injected by some program, never the tablet. */
  synthetic: boolean
}

export interface EnvSummary {
  platform: string
  os: string
  electron: string
  appVersion: string
  koffi: boolean
  wintabDll: boolean
  /** Windows' own view of the tablet (Get-PnpDevice, VID_056A). Null when there is no such device or the query failed (see note). */
  tablet: { present: boolean; status: string | null; problem: string | null; name: string | null; instanceId: string | null; note: string | null } | null
  wacomDriver: string | null
  wacomService: string | null
  displays: { bounds: Box; scale: number; primary: boolean }[]
  /** Raw Input devices on the digitizer page or from Wacom (name, vid, pid, usage page / usage, kind). */
  rawDevices: { name: string; vid: number; pid: number; usagePage: number; usage: number; kind: string }[]
  /** Windows' pointer devices (the pen stack's own view); null when the query failed, absent in older records. Added in revision 2. */
  pointerDevices?: PointerDeviceSummary[] | null
  /** Wintab interface facts (spec / implementation versions, device count, extents) or null when it is not there. */
  wintab: Record<string, string | number | boolean | null> | null
}

export type FeedSeverity = "ok" | "wait" | "warn" | "error" | "off"

export interface FeedStatus {
  /** False on platforms with no native feed at all: the UI shows nothing. */
  available: boolean
  open: boolean
  /** Capture released because the window is not in front / minimised / hidden. */
  released: string | null
  /** The backend feeding the sheet right now, or null (the pen then works as a plain pointer). */
  active: BackendName | null
  backends: BackendStatus[]
  /** The frame in force for the active backend (screen frame once applied). */
  frame: FrameRecord | null
  containment: ContainmentStatus
  /** Epoch ms of the last witness (DOM pen event, pointer-device in-range). */
  witnessAt: number | null
  env: EnvSummary | null
  settings: PenFeedSettings
  /** The one line for the chip, e.g. "Pen: Wintab - 133 Hz", and how to colour it. */
  headline: string
  severity: FeedSeverity
  /** The persisted winner from earlier runs, if any. */
  winner: { backend: BackendName; at: string } | null
}

export type FeedEvent =
  | { kind: "live"; backend: BackendName }
  | { kind: "lost"; backend: BackendName; reason: string }
  | { kind: "failover"; from: BackendName | null; to: BackendName }
  | { kind: "released"; reason: string }
  | { kind: "needs-you"; message: string }

// ---------------------------------------------------------------------------------------------
// The setup check (a 20-second guided check; engine in main/pen/check.ts, pure)
// ---------------------------------------------------------------------------------------------

export type CheckStepId = "env" | "hover" | "tap" | "lower" | "upper" | "sweep" | "away"

export interface CheckStepSpec { id: CheckStepId; seconds: number; title: string; prompt: string; optional: boolean }

export const CHECK_STEPS: readonly CheckStepSpec[] = [
  { id: "env", seconds: 0, title: "Looking at the machine", prompt: "Reading what Windows says about the tablet.", optional: false },
  { id: "hover", seconds: 4, title: "Hover", prompt: "Hold the pen a finger's width above the tablet and slowly wave it around. Do not touch.", optional: false },
  { id: "tap", seconds: 3, title: "Tap and press", prompt: "Tap the tip on the MIDDLE of the tablet a few times, then press harder and softer.", optional: false },
  { id: "lower", seconds: 3, title: "Lower side button", prompt: "Hover over the MIDDLE of the tablet and press the side button NEAREST THE TIP, again and again.", optional: false },
  { id: "upper", seconds: 3, title: "Upper side button", prompt: "Hover over the MIDDLE of the tablet and press the side button FARTHEST FROM THE TIP, again and again.", optional: false },
  { id: "sweep", seconds: 5, title: "Round the edge", prompt: "Keep the pen just ABOVE the tablet, not touching, and move it round the very edge, then across the middle in a cross.", optional: false },
  { id: "away", seconds: 4, title: "Another window in front", prompt: "Click another program with the MOUSE so it is in front, then wave the pen over the tablet. Click WriteMind to come back.", optional: true },
]

export type Verdict = "works" | "partial" | "silent" | "failed" | "unavailable" | "skipped"

export interface CheckRow {
  backend: BackendName
  verdict: Verdict
  /** One line: "133 Hz, 2048 levels, both side buttons, whole tablet reached." */
  headline: string
  /** Why not (or what to watch), plain words, most important first. */
  reasons: string[]
  samples: number
  rateHz: number | null
  pressureMaxSeen: number
  pressureLevels: number
  lower: boolean
  upper: boolean
  /** Coverage of the tablet reached in the sweep: 0..1 for x and y. */
  coverage: { x: number; y: number } | null
  frame: FrameRecord | null
  /** Samples that arrived while WriteMind was not the foreground window (the "away" step), or null if not run. */
  samplesAway: number | null
}

export interface CheckReport {
  at: string
  overall: "ok" | "partial" | "none"
  winner: BackendName | null
  summary: string
  rows: CheckRow[]
  /** What the check learned about the machine, ready to persist. */
  learned: { frames: Record<string, FrameRecord>; pointerMode: "pen" | "mouse" | null; swapButtons: boolean | null }
  /** Next steps in plain words, for the person. */
  advice: string[]
}

export interface CheckSnapshot {
  running: boolean
  step: CheckStepId | null
  secondsLeft: number
  done: CheckStepId[]
  /** Live per-backend counters while the check runs (the table on screen). */
  rows: CheckRow[]
  env: EnvSummary | null
  report: CheckReport | null
}

// ---------------------------------------------------------------------------------------------
// IPC (names are spelled ONCE, here; preload, main/pen/ipc.ts and the tests use PEN_CHANNELS)
// ---------------------------------------------------------------------------------------------

export const PEN_CHANNELS = {
  // renderer -> main, invoke (reply in brackets)
  open: "pen:open", // (SheetGeometry) -> FeedStatus
  close: "pen:close", // (reason: string) -> void
  status: "pen:status", // () -> FeedStatus
  settings: "pen:settings", // () -> PenFeedSettings
  setSettings: "pen:settings-set", // (Partial<PenFeedSettings>) -> PenFeedSettings
  checkStart: "pen:check-start", // () -> CheckSnapshot
  checkStep: "pen:check-step", // (CheckStepId) -> CheckSnapshot
  checkCancel: "pen:check-cancel", // () -> CheckSnapshot
  checkCopy: "pen:check-copy", // () -> string  (the diagnostics text)
  containTest: "pen:contain-test", // ("driver" | "sink") -> ContainmentTestResult
  frameSet: "pen:frame-set", // (FrameTransform | null)  null = back to automatic -> FeedStatus
  revealTrace: "pen:reveal-trace", // () -> void
  // renderer -> main, fire and forget
  sheet: "pen:sheet", // (SheetGeometry | null)
  witness: "pen:witness", // (Witness), at most 30 a second
  dom: "pen:dom", // (DomPenReport[]), at most one message per animation frame: what the gate swallowed, for the `dom` backend
  panic: "pen:panic", // (reason: string)
  // main -> renderer
  samples: "pen:samples", // PenBatch (the active backend only, screen frame)
  statusPush: "pen:status-push", // FeedStatus (changes at once, counters at most 4 a second)
  event: "pen:event", // FeedEvent
  check: "pen:check", // CheckSnapshot
  // WRITEMIND_E2E only
  e2eInject: "pen:inject", // ({ samples: PenSample[]; backend?: BackendName }) -> void
  e2eState: "pen:e2e-state", // () -> FeedStatus
  e2eConfig: "pen:e2e-config", // ({ native?: boolean; backends?: BackendName[]; focused?: boolean; capture?: boolean }) -> FeedStatus  (focused overrides the E2E "always in front"; capture turns pen capture on, it starts OFF under E2E)
} as const
export type PenChannel = (typeof PEN_CHANNELS)[keyof typeof PEN_CHANNELS]

/** window.wm.pen, as the preload exposes it (preload.ts builds it from PEN_CHANNELS; wm.d.ts types it with this). */
export interface PenApi {
  open(sheet: SheetGeometry): Promise<FeedStatus>
  close(reason: string): Promise<void>
  status(): Promise<FeedStatus>
  settings(): Promise<PenFeedSettings>
  setSettings(patch: Partial<PenFeedSettings>): Promise<PenFeedSettings>
  sheet(geometry: SheetGeometry | null): void
  witness(w: Witness): void
  /** The gate's reports for the `dom` backend. */
  dom(reports: DomPenReport[]): void
  panic(reason: string): void
  check: {
    start(): Promise<CheckSnapshot>
    step(id: CheckStepId): Promise<CheckSnapshot>
    cancel(): Promise<CheckSnapshot>
    copy(): Promise<string>
    test(mechanism: "driver" | "sink"): Promise<ContainmentTestResult>
  }
  setFrame(frame: FrameTransform | null): Promise<FeedStatus>
  revealTrace(): Promise<void>
  onSamples(listener: (batch: PenBatch) => void): () => void
  onStatus(listener: (status: FeedStatus) => void): () => void
  onEvent(listener: (event: FeedEvent) => void): () => void
  onCheck(listener: (snapshot: CheckSnapshot) => void): () => void
  /** Present only under WRITEMIND_E2E. */
  e2e?: {
    inject(samples: PenSample[], backend?: BackendName): Promise<void>
    state(): Promise<FeedStatus>
    config(c: { native?: boolean; backends?: BackendName[]; focused?: boolean; capture?: boolean }): Promise<FeedStatus>
  }
}

// ---------------------------------------------------------------------------------------------
// The pen sink's private bridge (renderer/PenSink.tsx <-> main/pen/overlay.ts; design 7.6)
// ---------------------------------------------------------------------------------------------

export const PEN_SINK_CHANNELS = {
  pen: "pen:sink-pen", // renderer -> main, send: (DomPenReport[]), at most one message per animation frame
  mouse: "pen:sink-mouse", // renderer -> main, send: () a real mouse event (not the pen's echo) reached the sink while it was on
  beat: "pen:sink-beat", // renderer -> main, send: () every second; main destroys the sink after 6 s of silence
} as const

/** window.wm.penSink: exposed by the one preload; main verifies that the sender of each message is the sink window. */
export interface PenSinkApi {
  pen(reports: DomPenReport[]): void
  mouse(): void
  beat(): void
}

// ---------------------------------------------------------------------------------------------
// The FeedManager (main/pen/manager.ts, IMPL-D)
// ---------------------------------------------------------------------------------------------

export interface FeedManager {
  /** The Tablet sheet is showing: start reading. Idempotent. Resolves with the first status (backends may still be starting). */
  open(sheet: SheetGeometry | null): Promise<FeedStatus>
  close(reason: string): void
  setSheet(sheet: SheetGeometry | null): void
  setWindowState(state: WindowState): void
  witness(w: Witness): void
  /** The ACTIVE backend's samples only, screen frame. */
  onSamples(listener: (batch: PenBatch) => void): () => void
  onStatus(listener: (status: FeedStatus) => void): () => void
  onEvent(listener: (event: FeedEvent) => void): () => void
  status(): FeedStatus
  settings(): PenFeedSettings
  update(patch: Partial<PenFeedSettings>): PenFeedSettings
  /** Let go of everything now (Esc, Ctrl+Alt+G, the pen-free key, quit). The feed stays closed until the window is focused again or the person turns capture on. */
  panic(reason: string): void
  /** E2E and tests: samples from a pretend backend. */
  inject(samples: PenSample[], backend?: BackendName): void
  dispose(): void
}

// ---------------------------------------------------------------------------------------------
// Liveness: every number the selector uses, in one place (tests import them; nobody inlines them)
// ---------------------------------------------------------------------------------------------

export const LIVENESS = {
  /** A backend is LIVE after this many in-range samples within LIVE_WINDOW_MS, at least one of which differs from the one before in x, y or p. */
  LIVE_MIN_SAMPLES: 4,
  LIVE_WINDOW_MS: 1000,
  /** LIVE -> STALE: no sample for this long while a witness says the pen is here. */
  STALE_AFTER_MS: 800,
  /** STALE -> FAILED: still silent this long after going stale, witness continuing. */
  FAIL_AFTER_MS: 6000,
  /** start() must resolve within this, else failed("start timed out"). */
  START_TIMEOUT_MS: 4000,
  /** A witness counts as "the pen is here" for this long after it was seen. */
  WITNESS_HOLD_MS: 500,
  // There is no gate hold time: the renderer's gate is closed whenever capture is on (design 8.4).
  /** A higher-priority backend must stay live this long (pen up) before it takes over from the active one. */
  UPGRADE_AFTER_LIVE_MS: 1500,
  /** A visit with no packets ends after this long hovering, or this long in contact (a still pen sends nothing); the driver's own proximity signal wins over both. */
  LEAVE_HOVER_MS: 600,
  LEAVE_CONTACT_MS: 2000,
  /** Batches leave a backend at most this long after their first sample. */
  BATCH_MS: 8,
  /** Staged starts, measured from open() (or from the first witness on a first run). The overlay is not staged: it starts with the sink (design 4.5, 5.3). */
  STAGE_WEBHID_MS: 2500,
  /** A device-frame backend whose frame is still a guess waits this long (live, pen up) behind a live screen-frame backend before it may take over (design 5.4). */
  FRAME_SETTLE_MS: 6000,
  /** A native backend that has run this long since start() resolved is considered safe: the crash breadcrumb is cleared (design 5.8). */
  NATIVE_SAFE_MS: 30_000,
  /** Restart backoff after a failure: 5 s, 15 s, 45 s, then give up for the session (a re-plug or a settings change resets it). */
  BACKOFF_MS: [5000, 15000, 45000],
  /** A backend that failed 3 times in a row while a witness was active is left alone for 24 h. */
  DEMOTE_MS: 24 * 3600 * 1000,
  /** Released window grace: backends are stopped this long after the window stops being in front. */
  BLUR_GRACE_MS: 1500,
} as const

/** The tablet-normalised bits the trace stores per sample: tip=1, lower=2, upper=4, eraser=8, inRange=16. */
export const sampleFlags = (s: PenSample): number =>
  (s.tip ? 1 : 0) | (s.lower ? 2 : 0) | (s.upper ? 4 : 0) | (s.eraser ? 8 : 0) | (s.inRange ? 16 : 0)

export const clamp01 = (v: number): number => (v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v)

/** True for the backends that read the tablet itself (everything but the overlay and the test injector). */
export const isTabletNative = (name: BackendName): boolean =>
  name === "wintab-system" || name === "wintab-data" || name === "rawinput" || name === "webhid"
