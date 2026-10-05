/**
 * The FeedManager against FakeBackends and a fake clock (docs/spikes/DESIGN-pen-capture.md 15.2). No Electron, no OS, no pen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFeedManager, headlineFor, type FeedManagerEx, type ManagerDeps } from "../src/main/pen/manager"
import { FakeBackend, InjectBackend, sample } from "../src/main/pen/fake"
import { defaultState, type PenState, type StateStore } from "../src/main/pen/state"
import type { CheckEngine, Containment } from "../src/main/pen/types"
import {
  LIVENESS, type BackendName, type CheckSnapshot, type DeviceInfo, type FeedEvent, type PenBatch, type PenSample, type SheetGeometry, type TraceSink, type Witness,
} from "../src/shared/pen"

const SHEET: SheetGeometry = { rect: { x: 100, y: 100, width: 800, height: 500 }, turns: 0, aspect: 1.6 }
const DEVICE = (name = "WACOM Tablet", w = 9500, h = 15200): DeviceInfo => ({
  name, vendorId: 0x56a, productId: 0x37a, aspect: null, rawX: [0, w], rawY: [0, h], pressureMax: 32767,
  claims: { pressure: true, tilt: false, lower: true, upper: true, eraser: false },
})

/** The call order of the store and the backends, for the breadcrumb test (design 15.2 #27). */
const order: string[] = []

function memStore(initial: PenState = defaultState()): StateStore & { writes: number; syncs: number } {
  const state = initial
  const store = {
    writes: 0, syncs: 0,
    get: () => state,
    update(change: (s: PenState) => void) { change(state); store.writes++ },
    flush: async () => {},
    flushSync: () => { store.syncs++; order.push("flushSync:" + Object.keys(state.inFlight).join(",")) },
    dispose: () => {},
  }
  return store
}

function fakeContainment(): Containment & { inputs: unknown[]; panics: string[]; wantDriver: boolean; wantSink: boolean } {
  const c = {
    inputs: [] as unknown[], panics: [] as string[], wantDriver: false, wantSink: false,
    update: (i: unknown) => { c.inputs.push(i) },
    status: () => ({ mode: "none" as const, armed: false, rect: null, lastRelease: null, capabilities: defaultState().capabilities, pointerMode: null, guard: { state: "none" as const, pid: null } }),
    driverMappingWanted: () => c.wantDriver,
    sinkWanted: () => c.wantSink,
    test: async () => ({ mechanism: "driver" as const, state: "untested" as const, detail: "" }),
    panic: (r: string) => { c.panics.push(r) },
    dispose: () => {},
  }
  return c
}

function fakeCheck(): CheckEngine & { fed: Record<string, number>; begun: number } {
  let snap: CheckSnapshot = { running: false, step: null, secondsLeft: 0, done: [], rows: [], env: null, report: null }
  const e = {
    fed: {} as Record<string, number>, begun: 0,
    begin: () => { e.begun++; return (snap = { ...snap, running: true }) },
    feed: (b: string, s: PenSample[]) => { e.fed[b] = (e.fed[b] ?? 0) + s.length },
    witness: () => {},
    start: (step: CheckSnapshot["step"]) => (snap = { ...snap, step }),
    tick: () => snap,
    cancel: () => (snap = { ...snap, running: false }),
    finish: () => ({ at: "", overall: "none" as const, winner: null, summary: "", rows: [], learned: { frames: {}, pointerMode: null, swapButtons: null }, advice: [] }),
    snapshot: () => snap,
  }
  return e
}

interface Rig {
  m: FeedManagerEx
  backends: Map<BackendName, FakeBackend>
  store: ReturnType<typeof memStore>
  containment: ReturnType<typeof fakeContainment>
  check: ReturnType<typeof fakeCheck>
  batches: PenBatch[]
  events: FeedEvent[]
  trace: { events: string[] }
  deps: ManagerDeps
}

interface RigOptions {
  e2e?: boolean
  native?: boolean
  store?: PenState
  fakes?: Partial<Record<BackendName, ConstructorParameters<typeof FakeBackend>[1]>>
  displayFraction?: ManagerDeps["displayFraction"]
}

function rig(o: RigOptions = {}): Rig {
  const backends = new Map<BackendName, FakeBackend>()
  const store = memStore(o.store)
  const containment = fakeContainment()
  const check = fakeCheck()
  const trace = { events: [] as string[] }
  const sink: TraceSink = { event: (_s, name) => { trace.events.push(name) }, raw: () => {} }
  const deps: ManagerDeps = {
    available: true,
    makeBackend: (name) => {
      let b = backends.get(name)
      if (!b) {
        b = name === "inject" ? new InjectBackend() : new FakeBackend(name, { frameKind: name === "overlay" || name === "dom" ? "screen" : "device", device: name === "dom" ? null : DEVICE(), ...o.fakes?.[name] })
        const started = b.start.bind(b)
        b.start = async (ctx) => { order.push("start:" + name); return started(ctx) }
        backends.set(name, b)
      }
      return b
    },
    store, trace: sink, lease: { ready: () => true, holdWintab: () => true, dropWintab: () => {} }, containment,
    now: () => Date.now(), e2e: o.e2e ?? false, native: o.native ?? false, check,
    env: () => null, sheetToPhysical: (s) => s.rect, displayFraction: o.displayFraction ?? (() => null), cursorFraction: () => null,
    displayInfo: () => null, log: () => {},
  }
  const m = createFeedManager(deps)
  const batches: PenBatch[] = []
  const events: FeedEvent[] = []
  m.onSamples((b) => batches.push(b))
  m.onEvent((e) => events.push(e))
  return { m, backends, store, containment, check, batches, events, trace, deps }
}

/** n in-range samples moving across the tablet, 8 ms apart on the sample clock. */
const move = (n: number, from = 0, over: Partial<PenSample> = {}): PenSample[] =>
  Array.from({ length: n }, (_, i) => sample({ t: from + i * 8, x: 0.1 + (i % 50) * 0.01, y: 0.5, backend: "test", ...over }))
const pen = (b: FakeBackend | undefined, samples: PenSample[]): void => { b!.emit(samples) }
const domWitness = (x = 0.5, y = 0.5): Witness => ({ source: "dom", inRange: true, at: Date.now(), screenDip: { x: 1000 * x, y: 1000 * y }, pointerType: "pen", buttons: 0 })
const advance = (ms: number): Promise<void> => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); order.length = 0 })
afterEach(() => { vi.useRealTimers() })

describe("first run: the ladder (15.2 #1-#3)", () => {
  it("starts wintab-data and rawinput together; the first to go live is active; the other keeps counting", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(1)
    expect(r.backends.get("rawinput")?.startCalls).toBe(1)
    expect(r.backends.get("webhid")?.startCalls ?? 0).toBe(0)
    pen(r.backends.get("rawinput"), move(6))
    pen(r.backends.get("wintab-data"), move(6))
    // the higher-priority one is NOT active yet: rawinput went live first and the active is sticky (design 5.4) ...
    expect(r.m.status().active).toBe("rawinput")
    const s = r.m.status()
    expect(s.backends.find((b) => b.name === "rawinput")?.state).toBe("live")
    expect(s.backends.find((b) => b.name === "wintab-data")?.state).toBe("live")
    // ... until it has been live for UPGRADE_AFTER_LIVE_MS with the pen up
    await advance(LIVENESS.UPGRADE_AFTER_LIVE_MS + 100)
    pen(r.backends.get("rawinput"), move(1, 200))
    pen(r.backends.get("wintab-data"), move(2, 200))
    expect(r.m.status().active).toBe("wintab-data")
  })

  it("the first live backend takes the sheet, and only the active one's samples are emitted", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    pen(r.backends.get("rawinput"), move(6))
    expect(r.m.status().active).toBe("rawinput")
    const before = r.batches.length
    pen(r.backends.get("wintab-data"), move(3))   // not live yet, not active
    expect(r.batches.length).toBe(before)
    expect(r.batches.every((b) => b.source === "rawinput")).toBe(true)
  })

  it("the four samples that prove liveness are not lost: they reach the sheet when the backend goes live", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    pen(r.backends.get("wintab-data"), move(2))
    expect(r.batches.length).toBe(0)
    pen(r.backends.get("wintab-data"), move(3, 16))
    const all = r.batches.flatMap((b) => b.samples)
    expect(all.length).toBe(5)
  })

  it("the winner is stored after 3 s and 30 samples, and a stored winner starts alone", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    pen(r.backends.get("wintab-data"), move(8))
    for (let i = 0; i < 40; i++) { pen(r.backends.get("wintab-data"), move(1, 100 + i * 8)); await advance(100) }
    expect(r.store.get().winner?.backend).toBe("wintab-data")
    // a new session with that state
    const r2 = rig({ native: true, store: r.store.get() })
    await r2.m.open(SHEET)
    await advance(10)
    expect(r2.backends.get("wintab-data")?.startCalls).toBe(1)
    expect(r2.backends.get("rawinput")?.startCalls ?? 0).toBe(0)
  })

  it("a stored winner that stays silent while a witness is present: the others start 3 s after the first witness", async () => {
    const state = defaultState()
    state.winner = { backend: "wintab-data", at: "2026-10-01T00:00:00Z" }
    const r = rig({ native: true, store: state })
    await r.m.open(SHEET)
    await advance(10)
    r.m.witness(domWitness())
    await advance(1000)
    expect(r.backends.get("rawinput")?.startCalls ?? 0).toBe(0)
    for (let i = 0; i < 35; i++) { r.m.witness(domWitness(0.5 + i * 0.001)); await advance(100) }
    expect(r.backends.get("rawinput")?.startCalls).toBe(1)
  })
})

describe("failover, stale, stages (15.2 #4-#7)", () => {
  async function liveRig(): Promise<Rig> {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    pen(r.backends.get("wintab-data"), move(6))
    pen(r.backends.get("rawinput"), move(6))
    return r
  }

  it("the active goes stale: failover to the other live one, a leave sample is synthesised, FeedEvent failover", async () => {
    const r = await liveRig()
    expect(r.m.status().active).toBe("wintab-data")
    // wintab-data goes silent while a witness keeps seeing the pen; rawinput keeps flowing
    for (let i = 0; i < 12; i++) {
      r.m.witness(domWitness(0.2 + i * 0.01))
      pen(r.backends.get("rawinput"), move(2, 1000 + i * 100))
      await advance(100)
    }
    const s = r.m.status()
    expect(s.backends.find((b) => b.name === "wintab-data")?.state).toBe("stale")
    expect(s.active).toBe("rawinput")
    expect(r.events.some((e) => e.kind === "failover" && e.from === "wintab-data" && e.to === "rawinput")).toBe(true)
    const leave = r.batches.find((b) => b.source === "wintab-data" && b.samples.some((x) => !x.inRange))
    expect(leave).toBeTruthy()
  })

  it("#5 no native backend live, the window pen carries the pen: dom is active (chip 'window pointer'), webhid still starts at STAGE_WEBHID_MS (the stage guard is liveNative), the overlay is a stage-0 candidate only when the sink may arm", async () => {
    const r = rig({ native: true })
    r.containment.wantSink = true
    await r.m.open(SHEET)
    await advance(10)
    expect(r.backends.get("dom")?.startCalls).toBe(1)           // not staged: it starts with open()
    expect(r.backends.get("overlay")?.startCalls).toBe(1)       // stage 0 because the sink may arm
    for (let i = 0; i < 8; i++) { r.m.witness(domWitness()); await advance(100) }
    expect(r.m.status().active).toBeNull()
    expect(r.m.status().headline).toBe("Pen: ready - touch the tablet")
    pen(r.backends.get("dom"), move(6, 0, { backend: "dom" }))
    expect(r.m.status().active).toBe("dom")
    expect(r.m.status().headline).toBe("Pen: window pointer - 125 Hz")
    expect(r.m.status().severity).toBe("warn")
    expect(r.backends.get("webhid")?.startCalls ?? 0).toBe(0)
    for (let t = 0; t < LIVENESS.STAGE_WEBHID_MS; t += 100) { r.m.witness(domWitness()); await advance(100) }
    expect(r.backends.get("webhid")?.startCalls).toBe(1)
    // the overlay is active only when nothing above it is live: dom outranks it
    pen(r.backends.get("overlay"), move(6, 0, { backend: "overlay" }))
    expect(r.m.status().active).toBe("dom")
  })

  it("#5b without the sink the overlay never starts (sinkWanted false), whatever the witnesses say", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    for (let i = 0; i < 80; i++) { r.m.witness(domWitness()); await advance(100) }
    expect(r.backends.get("overlay")?.startCalls ?? 0).toBe(0)
  })

  it("no witnesses: nothing is marked stale and no later stage starts", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    pen(r.backends.get("wintab-data"), move(6))
    await advance(30000)
    expect(r.m.status().backends.find((b) => b.name === "wintab-data")?.state).toBe("live")
    expect(r.backends.get("overlay")?.startCalls ?? 0).toBe(0)
    const idle = rig({ native: true, store: { ...defaultState(), winner: { backend: "wintab-data", at: "x" } } })
    await idle.m.open(SHEET)
    await advance(30000)
    expect(idle.backends.get("overlay")?.startCalls ?? 0).toBe(0)
    expect(idle.backends.get("webhid")?.startCalls ?? 0).toBe(0)
  })

  it("a higher-priority backend takes over only after UPGRADE_AFTER_LIVE_MS and with the pen up", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    pen(r.backends.get("rawinput"), move(6))
    expect(r.m.status().active).toBe("rawinput")
    pen(r.backends.get("wintab-data"), move(6))
    expect(r.m.status().active).toBe("rawinput")
    await advance(LIVENESS.UPGRADE_AFTER_LIVE_MS - 100)
    pen(r.backends.get("wintab-data"), move(2, 200))
    expect(r.m.status().active).toBe("rawinput")
    await advance(300)
    // pen down on the active one: no takeover mid-stroke
    pen(r.backends.get("rawinput"), [sample({ t: 400, x: 0.3, tip: true, p: 0.5 })])
    pen(r.backends.get("wintab-data"), move(1, 410))
    expect(r.m.status().active).toBe("rawinput")
    pen(r.backends.get("rawinput"), [sample({ t: 420, x: 0.31 })])
    pen(r.backends.get("wintab-data"), move(1, 430))
    expect(r.m.status().active).toBe("wintab-data")
  })
})

describe("start failures and backoff (#8, #9, #17)", () => {
  it("start() timing out is failed with a reason; backoff 5/15/45 s; demoted after the third witnessed failure; a re-plug clears it", async () => {
    const r = rig({ native: true, fakes: { "wintab-data": { startHangs: true }, rawinput: { unavailable: "no hid.dll" } } })
    // A failure counts as WITNESSED only if a witness is active at the moment it happens (design 5.2), so the pen is "seen" through each timeout.
    const throughTimeout = async (): Promise<void> => {
      for (let t = 0; t < LIVENESS.START_TIMEOUT_MS + 50; t += 100) { r.m.witness(domWitness()); await advance(100) }
    }
    await r.m.open(SHEET)
    await throughTimeout()
    let b = r.m.status().backends.find((x) => x.name === "wintab-data")!
    expect(b.state).toBe("failed")
    expect(b.reason).toBe("start timed out")
    r.m.witness(domWitness())
    await advance(1000)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(1)
    // 5 s backoff
    for (let i = 0; i < 50; i++) { r.m.witness(domWitness()); await advance(100) }
    expect(r.backends.get("wintab-data")?.startCalls).toBe(2)
    await throughTimeout()
    for (let i = 0; i < 160; i++) { r.m.witness(domWitness()); await advance(100) }
    expect(r.backends.get("wintab-data")?.startCalls).toBe(3)
    await throughTimeout()
    b = r.m.status().backends.find((x) => x.name === "wintab-data")!
    expect(b.state).toBe("failed")
    expect(r.store.get().demoted["wintab-data"]).toBeTruthy()
    r.m.deviceChanged("test replug")
    expect(r.store.get().demoted["wintab-data"]).toBeUndefined()
    await advance(10)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(4)
  })

  it("start() resolving not-ok with retry never is unavailable, with the reason", async () => {
    const r = rig({ native: true, fakes: { "wintab-data": { startFails: { reason: "wintab32.dll not found", retry: "never" } } } })
    await r.m.open(SHEET)
    await advance(10)
    const b = r.m.status().backends.find((x) => x.name === "wintab-data")!
    expect(b.state).toBe("unavailable")
    expect(b.reason).toBe("wintab32.dll not found")
  })

  it("start() throwing is failed, not a crash", async () => {
    const r = rig({ native: true, fakes: { "wintab-data": { startThrows: "boom" } } })
    await r.m.open(SHEET)
    await advance(10)
    const b = r.m.status().backends.find((x) => x.name === "wintab-data")!
    expect(b.state).toBe("failed")
    expect(b.reason).toContain("boom")
  })

  it("a fatal backend error fails it; a non-fatal one is counted", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    const fake = r.backends.get("rawinput")!
    fake.emitEvent({ kind: "error", message: "hiccup", fatal: false })
    expect(r.m.status().backends.find((x) => x.name === "rawinput")?.counters.errors).toBe(1)
    expect(r.m.status().backends.find((x) => x.name === "rawinput")?.state).toBe("armed")
    fake.emitEvent({ kind: "error", message: "the driver closed our context", fatal: true })
    const b = r.m.status().backends.find((x) => x.name === "rawinput")!
    expect(b.state).toBe("failed")
    expect(b.reason).toBe("the driver closed our context")
  })
})

describe("blur, panic, focus, settings (#10, #11, #14)", () => {
  it("blur stops the backends after BLUR_GRACE_MS; focus restarts them", async () => {
    const r = rig({ native: true })
    r.m.setWindowState({ focused: true, visible: true, minimized: false })
    await r.m.open(SHEET)
    await advance(10)
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    await advance(LIVENESS.BLUR_GRACE_MS - 100)
    expect(r.backends.get("wintab-data")?.stopCalls).toBe(0)
    await advance(200)
    expect(r.backends.get("wintab-data")?.stopCalls).toBeGreaterThan(0)
    expect(r.m.status().released).toBe("window not in front")
    expect(r.m.status().headline).toBe("Pen: released - click the window")
    r.m.setWindowState({ focused: true, visible: true, minimized: false })
    await advance(10)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(2)
    expect(r.m.status().released).toBeNull()
  })

  it("a blip of blur shorter than the grace changes nothing", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    await advance(500)
    r.m.setWindowState({ focused: true, visible: true, minimized: false })
    await advance(3000)
    expect(r.backends.get("wintab-data")?.stopCalls).toBe(0)
  })

  it("a running check holds the blur release", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    r.m.checkStart()
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    await advance(5000)
    expect(r.backends.get("wintab-data")?.stopCalls).toBe(0)
    expect(r.check.begun).toBe(1)
  })

  it("panic stops everything and stays stopped until the window is focused again or capture is turned on", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    pen(r.backends.get("wintab-data"), move(6))
    r.m.panic("esc")
    expect(r.containment.panics).toEqual(["esc"])
    expect(r.backends.get("wintab-data")?.stopCalls).toBeGreaterThan(0)
    expect(r.m.status().active).toBeNull()
    expect(r.m.status().released).toContain("panic")
    await advance(5000)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(1)
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    r.m.setWindowState({ focused: true, visible: true, minimized: false })
    await advance(10)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(2)
  })

  it("turning capture off stops everything; on starts again", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    r.m.update({ enabled: false })
    expect(r.backends.get("wintab-data")?.stopCalls).toBeGreaterThan(0)
    expect(r.m.status().headline).toBe("Pen: capture off")
    r.m.update({ enabled: true })
    await advance(10)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(2)
  })

  it("prefer narrows to one backend; a disabled backend never starts", async () => {
    const r = rig({ native: true })
    r.m.update({ prefer: "rawinput", backends: { "wintab-data": false } as never })
    await r.m.open(SHEET)
    await advance(10)
    expect(r.backends.get("rawinput")?.startCalls).toBe(1)
    expect(r.backends.get("wintab-data")?.startCalls ?? 0).toBe(0)
    expect(r.m.status().backends.find((b) => b.name === "wintab-data")?.reason).toBe("switched off in the settings")
    expect(r.store.get().settings.prefer).toBe("rawinput")
  })
})

describe("what happens to every batch (#13, #12)", () => {
  async function activeRig(frameKind: "device" | "screen" = "device"): Promise<Rig> {
    const r = rig({ native: true, fakes: { "wintab-data": { frameKind } } })
    await r.m.open(SHEET)
    await advance(10)
    return r
  }
  const out = (r: Rig): PenSample[] => r.batches.flatMap((b) => b.samples)

  it("swapButtons exchanges lower and upper once, after the frame", async () => {
    const r = await activeRig("screen")
    r.m.update({ swapButtons: true })
    pen(r.backends.get("wintab-data"), move(6, 0, { lower: true }))
    expect(out(r).every((s) => s.upper && !s.lower)).toBe(true)
  })

  it("a device-frame backend gets its default frame applied (wintab portrait: turn 1, flipY), a screen-frame backend none", async () => {
    const r = await activeRig("device")
    pen(r.backends.get("wintab-data"), [0, 1, 2, 3].map((i) => sample({ t: i * 8, x: 0.2 + i * 0.1, y: 0.25 })))
    const s = out(r)
    // default for a portrait Wintab extent {turn:1, flipY:true}: v = 1-y = 0.75; x' = 1 - v = 0.25; y' = x
    expect(s[0]!.x).toBeCloseTo(0.25, 5)
    expect(s[0]!.y).toBeCloseTo(0.2, 5)
    expect(r.m.status().frame?.source).toBe("default")
    const r2 = await activeRig("screen")
    pen(r2.backends.get("wintab-data"), [0, 1, 2, 3].map((i) => sample({ t: i * 8, x: 0.2 + i * 0.1, y: 0.25 })))
    expect(out(r2)[0]!.x).toBeCloseTo(0.2, 5)
    expect(out(r2)[0]!.y).toBeCloseTo(0.25, 5)
  })

  it("coordinates are clamped and NaN never gets out", async () => {
    const r = await activeRig("screen")
    pen(r.backends.get("wintab-data"), move(6).map((s, i) => ({ ...s, x: i === 0 ? 1.7 : s.x, y: i === 1 ? Number.NaN : -3 })))
    for (const s of out(r)) { expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x).toBeLessThanOrEqual(1); expect(Number.isNaN(s.y)).toBe(false); expect(s.y).toBe(0) }
  })

  it("calibration: pairs of (device sample, display fraction) are fitted, applied, persisted and labelled", async () => {
    const r = await activeRig("device")
    // The tablet is mapped with a quarter turn: screen = applyFrame(raw, {turn:3, flipY:false}) (the opposite of the default guess).
    const fake = r.backends.get("wintab-data")!
    const lens = (i: number): [number, number] => [0.1 + ((i * 37) % 80) / 100, 0.1 + ((i * 53) % 80) / 100]
    for (let i = 0; i < 100; i++) {
      const [rx, ry] = lens(i)
      pen(fake, [sample({ t: i * 16, x: rx, y: ry })])
      pen(fake, [sample({ t: i * 16 + 8, x: rx + 0.004, y: ry + 0.004 })])
      // turn 3: [v, 1 - x] with v = y
      r.m.witness({ source: "dom", inRange: true, at: Date.now(), screenDip: { x: 1, y: 1 }, screen: { x: ry + 0.004, y: 1 - (rx + 0.004) }, pointerType: "pen" })
      await advance(16)
    }
    const f = r.m.status().frame
    expect(f?.source).toBe("dom")
    expect(f?.frame).toEqual({ turn: 3, flipY: false })
    expect(Object.values(r.store.get().frames).some((x) => x.source === "dom")).toBe(true)
  })

  it("pairs within 200 ms of a DOM mouse event are dropped", async () => {
    const r = await activeRig("device")
    const fake = r.backends.get("wintab-data")!
    for (let i = 0; i < 60; i++) {
      pen(fake, [sample({ t: i * 16, x: 0.1 + (i % 40) * 0.02, y: 0.3 })])
      r.m.witness({ source: "dom", inRange: false, at: Date.now(), pointerType: "mouse" })
      r.m.witness({ source: "dom", inRange: true, at: Date.now(), screenDip: { x: 1, y: 1 }, screen: { x: 0.1 + (i % 40) * 0.02, y: 0.3 }, pointerType: "pen" })
      await advance(16)
    }
    expect(r.m.status().frame?.source).toBe("default")
  })

  it("pen:frame-set overrides (manual) and null returns to automatic", async () => {
    const r = await activeRig("device")
    pen(r.backends.get("wintab-data"), move(6))
    const s = r.m.setFrame({ turn: 2, flipY: true })
    expect(s.frame).toMatchObject({ source: "manual", frame: { turn: 2, flipY: true } })
    const back = r.m.setFrame(null)
    expect(back.frame?.source).toBe("default")
  })
})

describe("the E2E hook (#15)", () => {
  it("native backends are unavailable with the stated reason, inject works end to end", async () => {
    const r = rig({ e2e: true })
    await r.m.open(SHEET)
    await advance(10)
    const s = r.m.status()
    expect(s.backends.find((b) => b.name === "wintab-data")?.reason).toBe("native pen backends are off under E2E")
    expect(r.backends.get("wintab-data")?.startCalls ?? 0).toBe(0)
    r.m.inject(move(6, 0, { backend: "inject" }))
    expect(r.m.status().active).toBe("inject")
    expect(r.m.status().headline).toMatch(/^Pen: Test/)
    expect(r.batches.flatMap((b) => b.samples).length).toBe(6)
  })

  it("inject is ignored outside E2E, and nothing is emitted before the feed is live", async () => {
    const r = rig({ e2e: false })
    await r.m.open(SHEET)
    r.m.inject(move(6))
    expect(r.batches.length).toBe(0)
  })

  it("e2eConfig focused:false releases, true restores; the window counts as in front under E2E", async () => {
    const r = rig({ e2e: true })
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    await r.m.open(SHEET)
    await advance(10)
    expect(r.backends.get("inject")?.startCalls).toBe(1)
    r.m.e2eConfig({ focused: false })
    expect(r.m.status().released).toBe("window not in front")
    r.m.e2eConfig({ focused: true })
    await advance(10)
    expect(r.m.status().released).toBeNull()
    expect(r.backends.get("inject")?.startCalls).toBe(2)
  })
})

describe("persistence, check mode, containment feed (#16, #18, #20)", () => {
  it("status pushes: a state change goes out at once, counters at most 4 a second", async () => {
    const r = rig({ e2e: true })
    const pushes: string[] = []
    r.m.onStatus((s) => pushes.push(s.headline))
    await r.m.open(SHEET)
    await advance(10)
    const base = pushes.length
    r.m.inject(move(4))
    const live = pushes.length
    expect(live).toBeGreaterThan(base)
    for (let i = 0; i < 40; i++) { r.m.inject(move(1, 100 + i * 8)); await advance(10) }
    expect(pushes.length - live).toBeLessThanOrEqual(4)
  })

  it("the check starts every native candidate at once, ignoring demotion, and forwards every backend's samples to the engine", async () => {
    const state = defaultState()
    state.demoted["rawinput"] = new Date(2_000_000 + 24 * 3600 * 1000).toISOString()
    const r = rig({ native: true, store: state })
    await r.m.open(SHEET)
    await advance(10)
    expect(r.backends.get("rawinput")?.startCalls ?? 0).toBe(0)
    r.m.checkStart()
    await advance(10)
    expect(r.backends.get("rawinput")?.startCalls).toBe(1)
    expect(r.backends.get("wintab-data")?.startCalls).toBe(1)
    expect(r.backends.get("webhid")?.startCalls).toBe(1)
    expect(r.backends.get("wintab-system")?.startCalls ?? 0).toBe(0)
    expect(r.backends.get("overlay")?.startCalls ?? 0).toBe(0)
    pen(r.backends.get("rawinput"), move(5))
    pen(r.backends.get("wintab-data"), move(5))
    expect(r.check.fed["rawinput"]).toBe(5)
    expect(r.check.fed["wintab-data"]).toBe(5)
  })

  it("wintab-system is a candidate only when containment wants the driver mapping", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    expect(r.backends.get("wintab-system")?.startCalls ?? 0).toBe(0)
    r.containment.wantDriver = true
    await advance(200)
    expect(r.backends.get("wintab-system")?.startCalls).toBe(1)
  })

  it("containment hears the sheet, the window and the pen", async () => {
    const r = rig({ e2e: true })
    await r.m.open(SHEET)
    await advance(300)
    expect(r.containment.inputs.length).toBeGreaterThan(0)
    const last = r.containment.inputs.at(-1) as { sheetPhysical: unknown; active: unknown }
    expect(last.sheetPhysical).toEqual(SHEET.rect)
    r.m.close("test")
    expect(r.m.status().open).toBe(false)
  })

  it("dispose stops every backend, once", async () => {
    const r = rig({ native: true })
    await r.m.open(SHEET)
    await advance(10)
    r.m.dispose()
    expect(r.backends.get("wintab-data")?.stopCalls).toBeGreaterThan(0)
    r.m.dispose()
  })
})

describe("the chip text (design 8.7)", () => {
  const base = { available: true, enabled: true, released: null, active: null, rateHz: null, contained: null, backends: [], witnessRecent: false, env: null, opened: true }
  it("renders nothing off Windows", () => expect(headlineFor({ ...base, available: false }).headline).toBe(""))
  it("capture off", () => expect(headlineFor({ ...base, enabled: false })).toEqual({ headline: "Pen: capture off", severity: "off" }))
  it("released", () => expect(headlineFor({ ...base, released: "x" }).severity).toBe("wait"))
  it("active with rate and containment", () =>
    expect(headlineFor({ ...base, active: "wintab-data", rateHz: 133.4, contained: "driver" })).toEqual({ headline: "Pen: Wintab - 133 Hz - contained: driver", severity: "ok" }))
  it("the tablet is broken", () =>
    expect(headlineFor({ ...base, env: { tablet: { present: true, status: "Error", problem: "10", name: null, instanceId: null, note: null } } as never }).headline).toBe("Pen: no tablet (Windows: problem 10)"))
  it("no native feed when nothing can start (the window pen waits for the first stroke)", () =>
    expect(headlineFor({ ...base, backends: [{ name: "wintab-data", state: "unavailable", reason: "x" }, { name: "dom", state: "armed", reason: null }] }))
      .toEqual({ headline: "Pen: no native feed - touch the tablet", severity: "warn" }))
  it("there is no 'pointer only' row any more: a witness changes nothing, nothing seen is ready", () => {
    expect(headlineFor({ ...base, backends: [{ name: "wintab-data", state: "armed", reason: null }], witnessRecent: true }).headline).toBe("Pen: ready - touch the tablet")
    expect(headlineFor({ ...base, backends: [{ name: "wintab-data", state: "armed", reason: null }] })).toEqual({ headline: "Pen: ready - touch the tablet", severity: "wait" })
  })
  it("a stale backend is silent", () =>
    expect(headlineFor({ ...base, backends: [{ name: "rawinput", state: "stale", reason: null }] }).headline).toBe("Pen: Raw HID is silent"))
  it("the window pen reads 'window pointer' with its reach below 90%, with its rate otherwise, always amber", () => {
    const dom = (x: number, y: number) => [{ name: "dom" as const, state: "live" as const, reason: null, facts: { "coverage.x": x, "coverage.y": y } }]
    expect(headlineFor({ ...base, active: "dom", rateHz: 61, backends: dom(0.667, 0.62) })).toEqual({ headline: "Pen: window pointer - reaches 62% of the tablet", severity: "warn" })
    expect(headlineFor({ ...base, active: "dom", rateHz: 61, backends: dom(1, 0.975) })).toEqual({ headline: "Pen: window pointer - 61 Hz", severity: "warn" })
    expect(headlineFor({ ...base, active: "dom", rateHz: 61, contained: "overlay", backends: dom(1, 1) }).headline).toBe("Pen: window pointer - 61 Hz - contained: overlay")
  })
  it("a native backend that was live and is silent: the window pen still carries the pen, the chip says which door is silent", () =>
    expect(headlineFor({ ...base, active: "dom", rateHz: 60, backends: [{ name: "wintab-data", state: "stale", reason: null }, { name: "dom", state: "live", reason: null }] }))
      .toEqual({ headline: "Pen: Wintab is silent", severity: "warn" }))
  it("a guessed direction is said", () =>
    expect(headlineFor({ ...base, active: "rawinput", rateHz: 133, guessed: true, contained: "overlay" }).headline).toBe("Pen: Raw HID - 133 Hz - contained: overlay - direction guessed"))
  it("a backend switched off by the crash breadcrumb is named while no native backend is live", () => {
    expect(headlineFor({ ...base, backends: [{ name: "wintab-data", state: "unavailable", reason: "x" }], faults: ["wintab-data"] }))
      .toEqual({ headline: "Pen: no native feed - touch the tablet - Wintab is off after a crash", severity: "warn" })
    expect(headlineFor({ ...base, active: "dom", rateHz: 60, faults: ["wintab-data"], backends: [] }).headline).toBe("Pen: window pointer - 60 Hz - Wintab is off after a crash")
  })
})
