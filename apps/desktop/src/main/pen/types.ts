/**
 * main/pen/types.ts - the MAIN-PROCESS-ONLY half of the contract (docs/spikes/DESIGN-pen-capture.md section 3.2).
 * Everything here may import Electron and Node; nothing here may be imported by the renderer.
 * IMPL-D creates it first; the factory signatures at the bottom are what the stubs and `registry.ts` compile against.
 */

import type { BrowserWindow, Session } from "electron"
import type {
  BackendName, Box, CheckReport, DomPenReport, LeaseApi, CheckSnapshot, CheckStepId, ContainmentStatus, ContainmentTestResult, EnvSummary, FeedStatus,
  FrameRecord, FrameTransform, PenBackend, PenFeedSettings, PenSample, PointerDeviceSummary, SheetGeometry, TraceSink, Turn, WindowState, Witness,
} from "../../shared/pen"

// ---------------------------------------------------------------------------------------------
// Paths (all under app.getPath("userData"); built once in main.ts and handed to everyone)
// ---------------------------------------------------------------------------------------------

export interface PenPaths {
  userData: string
  /** pen-state.json: settings, winner, frames, capabilities. Small. */
  state: string
  /** pen-trace.jsonl (+ .1, .2 rotations). */
  trace: string
  /** wintab.journal.json: the handles this process opened, for recovery after a hard kill. */
  wintabJournal: string
  /** pen-leases.json: what the guard holds right now (clip rectangle, Wintab handles), for the next launch's sweep. */
  leases: string
}

// ---------------------------------------------------------------------------------------------
// Optional capabilities a backend may add to PenBackend
// ---------------------------------------------------------------------------------------------

/** Implemented by the wintab-system backend: the manager tells it where the sheet is (physical pixels, or null to give the pointer back). */
export interface SystemMapped {
  setSheetPhysical(rect: Box | null): void
}
export const isSystemMapped = (b: PenBackend): b is PenBackend & SystemMapped =>
  typeof (b as Partial<SystemMapped>).setSheetPhysical === "function"

/** Implemented by the `dom` backend (design 4.7): ipc.ts hands it what the renderer's gate reported on `pen:dom`. */
export interface DomIngest {
  ingest(reports: DomPenReport[]): void
}
export const isDomIngest = (b: PenBackend): b is PenBackend & DomIngest =>
  typeof (b as Partial<DomIngest>).ingest === "function"

// ---------------------------------------------------------------------------------------------
// The guard / lease (IMPL-C). A detached helper process that undoes OS state if the app dies or hangs.
// ---------------------------------------------------------------------------------------------

export interface Lease extends LeaseApi {
  /** Start the guard (detached). Resolves when it said "ready", or false after 3 s. */
  start(): Promise<boolean>
  /** ClipCursor leases: arm / beat / free as in the containment spike (clip.ts). */
  armClip(rect: Box, leaseMs: number): boolean
  beat(): void
  freeClip(): void
  currentClip(): Box
  onLost(listener: (why: "lease" | "guard-lost") => void): () => void
  state(): "none" | "starting" | "ready" | "lost"
  pid(): number | null
  dispose(): void
}

export interface LeaseOptions { paths: PenPaths; execPath: string; guardScript: string; log: (line: string) => void }

// ---------------------------------------------------------------------------------------------
// Containment (IMPL-C): decides when the pen is held to the sheet, by which mechanism, and lets go.
// ---------------------------------------------------------------------------------------------

export interface ContainmentInput {
  sheet: SheetGeometry | null
  /** The sheet in physical screen pixels (main computed it with screen.dipToScreenRect), or null. */
  sheetPhysical: Box | null
  window: WindowState
  /** A pen is near the tablet right now (backend inRange, or a witness). */
  penInRange: boolean
  /** Epoch ms of the last pen activity of any kind (idle release). */
  lastPenAt: number | null
  settings: PenFeedSettings
  active: BackendName | null
}

export interface DriverProbe {
  /** A fresh wintab-system backend for the probe (not the manager's). */
  makeSystemBackend(): PenBackend & SystemMapped
  cursor(): { x: number; y: number }
  /** Samples of ANY live backend, so the probe can tell the pen moved. */
  onSamples(listener: (batch: PenSample[]) => void): () => void
}

export interface ContainmentDeps {
  lease: Lease
  paths: PenPaths
  trace: TraceSink
  now(): number
  window(): BrowserWindow | null
  /** Electron's screen module, narrowed (tests fake it). */
  display: { metricsChanged(listener: () => void): () => void }
  probe: DriverProbe
  /** Persistence of capability records goes through the manager's state module. */
  loadCapabilities(): ContainmentStatus["capabilities"]
  saveCapability(name: "driver" | "sink" | "clip", record: { state: string; note: string | null }): void
  pointerMode(): "pen" | "mouse" | null
  /** The overlay sink, created by overlay.ts. */
  sink: Sink
  log: (line: string) => void
}

export interface Containment {
  update(input: ContainmentInput): void
  status(): ContainmentStatus
  /** The manager asks this before it picks wintab-system over wintab-data. */
  driverMappingWanted(): boolean
  /** The pen sink may arm (design 7.6 (d)(e)): the setting allows it and no `ineffective` / `unsafe` record stops it. The manager starts the overlay backend when this is true. */
  sinkWanted(): boolean
  /** The check's optional containment tests. */
  test(mechanism: "driver" | "sink"): Promise<ContainmentTestResult>
  /** Let go of every mechanism now, whatever state it is in. Synchronous. */
  panic(reason: string): void
  dispose(): void
}

export interface SinkDeps {
  window(): BrowserWindow | null
  load(overlay: BrowserWindow): Promise<void>
  preload: string
  /** WRITEMIND_E2E: do not hide the sink when the notes window is not in front. */
  e2e: boolean
  log: (line: string) => void
}

/** The transparent pen-sink window (the demoted Grab overlay). It never takes the keyboard and is hit-testable ONLY while `on`. */
export interface Sink {
  /** Show / hide the window over the display the notes window is on. */
  setShown(shown: boolean): void
  /** Hit-testable (swallows the pen) or click-through (the mouse works). */
  setOn(on: boolean): void
  state(): { shown: boolean; on: boolean; bounds: Box | null }
  /** DOM pen events the sink page has seen (validation, 7.6, and the sink test count them). */
  penEvents(): number
  mouseEvents(): number
  onPenSamples(listener: (batch: PenSample[]) => void): () => void
  dispose(): void
}

// ---------------------------------------------------------------------------------------------
// Environment, trace, check (IMPL-B)
// ---------------------------------------------------------------------------------------------

export interface EnvDeps {
  appVersion: string
  /** Wintab / Raw Input facts come from IMPL-A's modules, passed in so env.ts stays free of koffi. */
  wintabFacts(): Record<string, string | number | boolean | null> | null
  rawDevices(): EnvSummary["rawDevices"]
  /** Windows' pointer devices (IMPL-B's pointerRange.ts `listPointerDevices`); optional so older callers and tests still compile. Added in revision 2. */
  pointerDevices?(): PointerDeviceSummary[] | null
  koffiLoaded(): boolean
  displays(): EnvSummary["displays"]
  /** Runs powershell.exe with a timeout and returns stdout, or null on failure (tests fake it). */
  powershell(script: string, timeoutMs: number): Promise<string | null>
}

export interface TraceFile extends TraceSink {
  readonly path: string
  /** The last n trace lines (for Copy diagnostics). */
  tail(n: number): string[]
  /** The first n raw hex records per backend of this session. */
  firstRaw(n: number): Record<string, string[]>
  flush(): Promise<void>
  close(): void
}

export interface CheckDeps {
  now(): number
  windowFocused(): boolean
  env(): EnvSummary | null
  statuses(): import("../../shared/pen").BackendStatus[]
  /** Frames the check may propose (it never persists; the manager does, from `report.learned`). */
  currentFrame(backend: BackendName): FrameRecord | null
}

export interface CheckEngine {
  begin(): CheckSnapshot
  /** EVERY backend's samples while the check runs, tagged with its name (the manager forwards them, active or not). */
  feed(backend: BackendName, samples: PenSample[]): void
  witness(w: Witness): void
  /** Pairs for frame calibration come from the manager; the engine only reads the result via CheckDeps.currentFrame. */
  start(step: CheckStepId): CheckSnapshot
  tick(): CheckSnapshot
  cancel(): CheckSnapshot
  /** Ends the check and builds the report. */
  finish(): CheckReport
  snapshot(): CheckSnapshot
}

// ---------------------------------------------------------------------------------------------
// WebHID host and overlay deps (IMPL-B / IMPL-C)
// ---------------------------------------------------------------------------------------------

export interface WebHidDeps {
  /** A dedicated session (partition "pen-hid"): its permission handlers allow VID 0x056A and nothing else. */
  session: Session
  preload: string
  page: string
  log: (line: string) => void
}

export interface OverlayDeps extends SinkDeps {
  sink: Sink
  /** `containment.sinkWanted()`: when false the overlay backend is unavailable (no sink, so no overlay). */
  allowed(): boolean
}

/** The `dom` backend (IMPL-D, design 4.7): no OS resource, so its deps are only geometry. */
export interface DomDeps {
  /** DIP bounds of the display that contains a point on the virtual desktop, or null when it is on no display. Under E2E: the notes window's content bounds (an offscreen test window sits at -32000,-32000), so screen fractions equal client fractions. */
  displayAt(dip: { x: number; y: number }): Box | null
  /** The notes window's content bounds in DIP, or null; for the `coverage` fact. */
  windowBounds(): Box | null
  /** DIP work area (the display without the taskbar) of the display that contains a point; for the `work.*` facts of the reach hint. Optional so that tests compile without it. */
  workAreaAt?(dip: { x: number; y: number }): Box | null
}

// ---------------------------------------------------------------------------------------------
// The factories every implementer exports with EXACTLY these names (registry.ts imports them from minute 0)
// ---------------------------------------------------------------------------------------------

export type CreateWintabBackend = (mode: "data" | "system", paths: PenPaths) => PenBackend
export type CreateRawInputBackend = () => PenBackend
export type CreateWebHidBackend = (deps: WebHidDeps) => PenBackend
export type CreateOverlayBackend = (deps: OverlayDeps) => PenBackend
export type CreateDomBackend = (deps: DomDeps) => PenBackend & DomIngest
export type CreateSink = (deps: SinkDeps) => Sink
export type CreateLease = (options: LeaseOptions) => Lease
export type CreateContainment = (deps: ContainmentDeps) => Containment
export type CreateTrace = (paths: PenPaths, enabled: () => boolean) => TraceFile
export type CreateCheckEngine = (deps: CheckDeps) => CheckEngine
export type CollectEnv = (deps: EnvDeps) => Promise<EnvSummary>
export type CreatePointerRangeWitness = (onWitness: (w: Witness) => void) => { start(): boolean; stop(): void }

// FeedStatus / FrameTransform / Turn are re-exported for convenience of the main-process modules.
export type { FeedStatus, FrameTransform, Turn }
