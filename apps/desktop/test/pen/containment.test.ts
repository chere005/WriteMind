// The containment POLICY (main/pen/containment.ts) against a fake clock, a fake lease/guard, a fake sink and a fake driver.
// No OS, no processes, no Electron. Every way out of "something holds the pen" is a test (design 7.4), every arm condition is a
// test, every clause (a)-(f) of the sink's `on` rule is a test (7.6), and the fail-closed rules (7.2) are tests.
import { describe, expect, it } from "vitest"
// The display-covering sink is opt-in in the app (it looked like a dead full-screen mode); these tests are about the sink.
process.env.WRITEMIND_PEN_SINK = "1"
import { DEFAULT_SETTINGS, type BackendName, type Box, type CapabilityRecord, type ContainmentStatus, type PenFeedSettings, type PenSample } from "../../src/shared/pen"
import { CONTAIN, configOfNote, makeContainment, noteWithConfig, plainNote, type ContainmentHooks, type ContainmentUpdate } from "../../src/main/pen/containment"
import type { PenLease } from "../../src/main/pen/lease"
import type { SinkExtras } from "../../src/main/pen/overlay"
import type { Sink, SystemMapped } from "../../src/main/pen/types"
import { FakeBackend } from "../../src/main/pen/fake"

const SHEET: Box = { x: 1100, y: 200, width: 700, height: 700 }
const SHEET2: Box = { x: 1000, y: 150, width: 700, height: 700 }
const CFG = "1920x1200@1"

// ---------------------------------------------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------------------------------------------

class FakeLease {
  st: "none" | "starting" | "ready" | "lost" = "ready"
  armCalls: { rect: Box; leaseMs: number }[] = []
  freeCalls = 0
  startCalls = 0
  armOk = true
  armThrows = false
  clip: Box = { x: 0, y: 0, width: 1920, height: 1200 }
  armed: Box | null = null
  private lost = new Set<(why: "lease" | "guard-lost") => void>()
  private panicKey = new Set<() => void>()
  private refused = new Set<(why: string) => void>()
  ready() { return this.st === "ready" }
  state() { return this.st }
  pid() { return this.st === "ready" ? 777 : null }
  pendingStart: (() => void) | null = null
  start() { this.startCalls++; this.st = "starting"; return new Promise<boolean>((res) => { this.pendingStart = () => { this.st = "ready"; res(true) } }) }
  armClip(rect: Box, leaseMs: number) {
    if (this.armThrows) throw new Error("boom")
    this.armCalls.push({ rect, leaseMs })
    if (!this.armOk || !this.ready()) return false
    this.armed = rect
    this.clip = rect
    return true
  }
  freeClip() { this.freeCalls++; if (this.armed) { this.armed = null; this.clip = { x: 0, y: 0, width: 1920, height: 1200 } } }
  currentClip() { return this.clip }
  held() { return { clip: this.armed ? { left: this.armed.x, top: this.armed.y, right: this.armed.x + this.armed.width, bottom: this.armed.y + this.armed.height } : null, wintab: [] as string[] } }
  holdWintab() { return true }
  dropWintab() { /* none */ }
  beat() { /* none */ }
  dispose() { /* none */ }
  onLost(l: (why: "lease" | "guard-lost") => void) { this.lost.add(l); return () => { this.lost.delete(l) } }
  onPanicKey(l: () => void) { this.panicKey.add(l); return () => { this.panicKey.delete(l) } }
  onRefused(l: (why: string) => void) { this.refused.add(l); return () => { this.refused.delete(l) } }
  emitLost(why: "lease" | "guard-lost") { this.armed = null; this.clip = { x: 0, y: 0, width: 1920, height: 1200 }; for (const l of [...this.lost]) l(why) }
  emitPanicKey() { for (const l of [...this.panicKey]) l() }
  emitRefused(why: string) { for (const l of [...this.refused]) l(why) }
}

class FakeSink implements Sink, SinkExtras {
  shown = false
  on = false
  stuckOn = false // a window that ignores the off order
  setOnCalls: boolean[] = []
  setShownCalls: boolean[] = []
  pen = 0
  mouse = 0
  beatAge: number | null = 1
  throwOnSetOn = false
  private penL = new Set<(b: PenSample[]) => void>()
  private mouseL = new Set<() => void>()
  setShown(s: boolean) { this.setShownCalls.push(s); this.shown = s; if (!s && !this.stuckOn) this.on = false }
  setOn(o: boolean) {
    if (this.throwOnSetOn) throw new Error("window gone")
    this.setOnCalls.push(o)
    if (o && !this.shown) return
    if (!o && this.stuckOn) return
    this.on = o
  }
  state() { return { shown: this.shown, on: this.on, bounds: null } }
  penEvents() { return this.pen }
  mouseEvents() { return this.mouse }
  onPenSamples(l: (b: PenSample[]) => void) { this.penL.add(l); return () => { this.penL.delete(l) } }
  onMouse(l: () => void) { this.mouseL.add(l); return () => { this.mouseL.delete(l) } }
  beatAgeMs() { return this.beatAge }
  dispose() { /* none */ }
  emitPen(samples: PenSample[]) { this.pen += samples.length; for (const l of [...this.penL]) l(samples) }
  emitMouse() { this.mouse++; for (const l of [...this.mouseL]) l() }
}

class FakeSystem extends FakeBackend implements SystemMapped {
  mapped: (Box | null)[] = []
  setSheetPhysical(r: Box | null) { this.mapped.push(r) }
}

const sample = (t: number, over: Partial<PenSample> = {}): PenSample => ({ t, x: 0.5, y: 0.5, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "wintab", ...over })

const freshCaps = (): ContainmentStatus["capabilities"] => ({
  driver: { state: "untested", at: null, note: null },
  sink: { state: "untested", at: null, note: null },
  clip: { state: "untested", at: null, note: null },
})

interface RigOptions { plainSink?: boolean; windowCheck?: ContainmentHooks["windowCheck"]; lease?: Partial<FakeLease>; pointerMode?: "pen" | "mouse" | null; caps?: Partial<ContainmentStatus["capabilities"]> }

function rig(opts: RigOptions = {}) {
  let t = 100_000
  const timers: { ms: number; fn: () => void; live: boolean; at: number }[] = []
  const lease = Object.assign(new FakeLease(), opts.lease)
  const sink = new FakeSink()
  // A sink with only the contract surface (no onMouse / beatAgeMs): the policy must fall back to polling its counters.
  const sinkForPolicy: Sink = opts.plainSink
    ? { setShown: (v) => sink.setShown(v), setOn: (v) => sink.setOn(v), state: () => sink.state(), penEvents: () => sink.penEvents(), mouseEvents: () => sink.mouseEvents(), onPenSamples: (l) => sink.onPenSamples(l), dispose: () => undefined }
    : sink
  const store = { ...freshCaps(), ...opts.caps }
  const saved: { name: string; state: string; note: string | null }[] = []
  const logs: string[] = []
  const traces: { name: string; data?: Record<string, unknown> }[] = []
  let cursor = { x: 1400, y: 500 }
  let metrics: () => void = () => undefined
  const power = new Map<string, () => void>()
  const probeL = new Set<(b: PenSample[]) => void>()
  const system = new FakeSystem("wintab-system")
  const systems: SystemMapped[] = []
  const panics: string[] = []
  let pointerMode = opts.pointerMode ?? "pen"
  const hooks: ContainmentHooks = {
    every: (ms, fn) => { const h = { ms, fn, live: true, at: t }; timers.push(h); return () => { h.live = false } },
    displayKey: () => CFG,
    windowCheck: opts.windowCheck,
    systemBackends: () => systems,
    power: { on: (ev, l) => { power.set(ev, l); return () => { power.delete(ev) } } },
    onPanic: (r) => panics.push(r),
  }
  const c = makeContainment({
    lease: lease as unknown as PenLease,
    paths: { userData: "u", state: "s", trace: "t", wintabJournal: "w", leases: "l" },
    trace: { event: (_s, name, data) => { traces.push({ name, data }) }, raw: () => undefined },
    now: () => t,
    window: () => null,
    display: { metricsChanged: (l) => { metrics = l; return () => { metrics = () => undefined } } },
    probe: {
      makeSystemBackend: () => system,
      cursor: () => cursor,
      onSamples: (l) => { probeL.add(l); return () => { probeL.delete(l) } },
    },
    loadCapabilities: () => ({ ...store }),
    saveCapability: (name, rec) => {
      saved.push({ name, state: rec.state, note: rec.note })
      store[name] = { state: rec.state as CapabilityRecord["state"], at: "now", note: rec.note }
    },
    pointerMode: () => pointerMode,
    sink: sinkForPolicy,
    log: (l) => logs.push(l),
    ...hooks,
  })
  const advance = (ms: number, step = 50) => {
    const end = t + ms
    while (t < end) {
      t = Math.min(end, t + step)
      for (const h of [...timers]) if (h.live && (t - h.at) % h.ms === 0) h.fn()
    }
  }
  const base = (over: Partial<ContainmentUpdate> = {}): ContainmentUpdate => ({
    sheet: { rect: { x: 10, y: 10, width: 700, height: 700 }, turns: 0, aspect: 1 },
    sheetPhysical: SHEET,
    window: { focused: true, visible: true, minimized: false },
    penInRange: false,
    lastPenAt: null,
    settings: { ...DEFAULT_SETTINGS, backends: { ...DEFAULT_SETTINGS.backends } },
    active: null,
    ...over,
  })
  const settings = (over: Partial<PenFeedSettings>): PenFeedSettings => ({ ...DEFAULT_SETTINGS, backends: { ...DEFAULT_SETTINGS.backends }, ...over })
  const emitNative = (n: number, over: Partial<PenSample> = {}) => {
    for (let i = 0; i < n; i++) for (const l of [...probeL]) l([sample(t, over)])
  }
  return {
    c, lease, sink, store, saved, logs, traces, system, panics, power, advance, base, settings, emitNative,
    set cursor(v: { x: number; y: number }) { cursor = v },
    set pointerMode(v: "pen" | "mouse" | null) { pointerMode = v },
    metrics: () => metrics(),
    useSystem: () => { systems.push(system) },
    get now() { return t },
    liveTimers: () => timers.filter((h) => h.live).length,
    traced: (name: string) => traces.filter((x) => x.name === name),
  }
}
type Rig = ReturnType<typeof rig>

/** A clip rig with the pen in range and the clip armed. */
function clipArmed(opts: RigOptions = {}) {
  const r = rig(opts)
  r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true, lastPenAt: r.now }))
  expect(r.c.status().mode).toBe("clip")
  return r
}

/** A sink rig with a live native backend and the sink ON (validation recorded or not). */
function sinkOn(opts: RigOptions = {}) {
  const r = rig(opts)
  r.c.update(r.base({ penInRange: true, lastPenAt: r.now, active: "wintab-data" }))
  r.emitNative(1)
  r.advance(100)
  expect(r.sink.on).toBe(true)
  return r
}

const lastReason = (r: Rig): string | undefined => r.c.status().lastRelease?.reason

// ---------------------------------------------------------------------------------------------------------------

describe("capability notes carry the display configuration", () => {
  it("round-trips", () => {
    const n = noteWithConfig("the sink saw 40 events", CFG)
    expect(configOfNote(n)).toBe(CFG)
    expect(plainNote(n)).toBe("the sink saw 40 events")
    expect(noteWithConfig(n, "other")).toBe("the sink saw 40 events {cfg:other}")
    expect(configOfNote(null)).toBeNull()
    expect(configOfNote("no config")).toBeNull()
  })
})

describe("release triggers: every way out (design 7.4)", () => {
  const cases: { name: string; why: string; patch: (r: Rig) => Partial<ContainmentUpdate> }[] = [
    { name: "blur", why: "blur", patch: () => ({ window: { focused: false, visible: true, minimized: false } }) },
    { name: "hidden", why: "hidden", patch: () => ({ window: { focused: true, visible: false, minimized: false } }) },
    { name: "minimized", why: "minimized", patch: () => ({ window: { focused: false, visible: true, minimized: true } }) },
    { name: "sheet gone (no sheet)", why: "sheet-gone", patch: () => ({ sheet: null, sheetPhysical: null }) },
    { name: "sheet gone (too small)", why: "sheet-gone", patch: () => ({ sheetPhysical: { x: 0, y: 0, width: 100, height: 100 } }) },
    { name: "capture off", why: "disabled", patch: (r) => ({ settings: r.settings({ enabled: false, contain: "clip" }) }) },
    { name: "containment none", why: "settings", patch: (r) => ({ settings: r.settings({ contain: "none" }) }) },
  ]

  for (const k of cases) {
    it(`${k.name} frees the clip at once`, () => {
      const r = clipArmed()
      r.c.update(r.base({ ...k.patch(r), penInRange: true, settings: (k.patch(r).settings ?? r.settings({ contain: "clip" })) }))
      expect(r.c.status().armed).toBe(false)
      expect(r.c.status().mode).toBe("none")
      expect(r.lease.armed).toBeNull()
      expect(r.lease.clip.width).toBe(1920) // the lease let go
      expect(lastReason(r)).toBe(k.why)
    })

    it(`${k.name} turns the sink off and hides it at once`, () => {
      const r = sinkOn()
      const patch = k.patch(r)
      r.c.update(r.base({ ...patch, penInRange: true, active: "wintab-data", settings: patch.settings ?? r.settings({}) }))
      expect(r.sink.on).toBe(false)
      expect(r.sink.shown).toBe(false)
      expect(r.c.status().armed).toBe(false)
      expect(lastReason(r)).toBe(k.why)
    })
  }

  it("never re-arms the clip while the blocker holds, and does again once it is gone", () => {
    const r = clipArmed()
    const away = r.base({ window: { focused: false, visible: true, minimized: false }, penInRange: true, settings: r.settings({ contain: "clip" }) })
    r.c.update(away)
    r.advance(1000)
    expect(r.lease.armed).toBeNull()
    const armsBefore = r.lease.armCalls.length
    r.c.update(r.base({ penInRange: true, settings: r.settings({ contain: "clip" }) }))
    expect(r.lease.armCalls.length).toBe(armsBefore + 1)
    expect(r.c.status().mode).toBe("clip")
  })

  it("pen out of range frees the clip after SINK_PEN_OUT_MS and re-arms when the pen returns", () => {
    const r = clipArmed()
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: false, lastPenAt: r.now }))
    r.advance(CONTAIN.SINK_PEN_OUT_MS + 150)
    expect(r.lease.armed).toBeNull()
    expect(lastReason(r)).toBe("pen-out")
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true, lastPenAt: r.now }))
    expect(r.lease.armed).toEqual(SHEET)
  })

  it("a pen state that nobody refreshes expires after SINK_SIGNAL_MS (the manager only reports changes)", () => {
    const r = clipArmed()
    r.advance(CONTAIN.SINK_SIGNAL_MS - 200)
    expect(r.c.status().mode).toBe("clip")
    r.advance(400)
    expect(r.c.status().mode).toBe("none")
    expect(lastReason(r)).toBe("pen-out")
  })

  it("the display changing frees everything and keeps it free until a fresh update brings the new rectangle", () => {
    const r = clipArmed()
    r.metrics()
    expect(r.lease.armed).toBeNull()
    expect(lastReason(r)).toBe("display-changed")
    r.advance(500)
    expect(r.lease.armCalls.length).toBe(1) // not re-armed on the stale rectangle
    r.c.update(r.base({ sheetPhysical: SHEET2, settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.armed).toEqual(SHEET2)
  })

  it("lock screen and suspend free everything; unlock and resume re-evaluate", () => {
    for (const [ev, back, why] of [["lock-screen", "unlock-screen", "lock"], ["suspend", "resume", "suspend"]] as const) {
      const r = clipArmed()
      r.power.get(ev)!()
      expect(r.lease.armed).toBeNull()
      expect(lastReason(r)).toBe(why)
      r.advance(300)
      expect(r.lease.armed).toBeNull() // locked: nothing re-arms
      r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
      expect(r.lease.armed).toBeNull()
      r.power.get(back)!()
      expect(r.lease.armed).toEqual(SHEET)
    }
  })

  it("the guard losing the lease frees the clip and it is not re-armed on a dead guard", () => {
    const r = clipArmed()
    r.lease.st = "lost"
    r.lease.emitLost("guard-lost")
    expect(r.c.status().armed).toBe(false)
    expect(lastReason(r)).toBe("guard-lost")
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    r.advance(500)
    expect(r.lease.armed).toBeNull()
    expect(r.c.status().guard.state).toBe("lost")
  })

  it("an expired lease is a release too", () => {
    const r = clipArmed()
    r.lease.emitLost("lease")
    expect(lastReason(r)).toBe("lease")
    expect(r.c.status().mode).toBe("none")
  })

  it("a foreign clip refuses the arm and leaves the other program's clip alone", () => {
    const r = rig()
    r.lease.armOk = false
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.c.status().armed).toBe(false)
    expect(r.traced("clip-refused").length).toBe(1)
    expect(r.lease.freeCalls).toBe(0) // never frees a clip it did not set
  })

  it("the guard reporting a refused arm after the fact releases", () => {
    const r = clipArmed()
    r.lease.emitRefused("foreign-clip")
    expect(r.c.status().armed).toBe(false)
    expect(lastReason(r)).toBe("foreign-clip")
  })

  it("idle: no pen activity of any kind for IDLE_RELEASE_MS lets go of the driver mapping, and fresh activity re-arms", () => {
    const caps = { driver: { state: "honored" as const, at: "x", note: noteWithConfig("proved", CFG) } }
    const r = rig({ caps })
    r.useSystem()
    r.c.update(r.base({ penInRange: true, lastPenAt: r.now, active: "wintab-system" }))
    expect(r.c.status().mode).toBe("driver")
    r.c.update(r.base({ penInRange: false, lastPenAt: r.now, active: "wintab-system" }))
    r.advance(CONTAIN.IDLE_RELEASE_MS - 2000)
    expect(r.c.status().armed).toBe(true)
    r.advance(3000)
    expect(r.c.status().armed).toBe(false)
    expect(lastReason(r)).toBe("idle")
    expect(r.system.mapped.at(-1)).toBeNull()
    r.c.update(r.base({ penInRange: true, lastPenAt: r.now, active: "wintab-system" }))
    expect(r.c.status().mode).toBe("driver")
  })

  it("quit (dispose) frees everything and stops all timers", () => {
    const r = clipArmed()
    expect(r.liveTimers()).toBeGreaterThan(0)
    r.c.dispose()
    expect(r.lease.armed).toBeNull()
    expect(r.sink.shown).toBe(false)
    expect(r.liveTimers()).toBe(0)
    const arms = r.lease.armCalls.length
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.armCalls.length).toBe(arms)
  })
})

describe("defence in depth: the window is checked independently of the manager's feed", () => {
  it("a window that is really not in front releases even if the feed still says it is", () => {
    const state = { focused: true, visible: true, minimized: false }
    const r = rig({ windowCheck: () => state })
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.c.status().mode).toBe("clip")
    state.focused = false // the manager missed the blur
    r.advance(150)
    expect(r.lease.armed).toBeNull()
    expect(lastReason(r)).toBe("blur")
    state.focused = true
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.armed).toEqual(SHEET)
  })

  it("minimised and hidden are caught the same way, and a check that throws or has no opinion changes nothing", () => {
    const state = { focused: true, visible: true, minimized: true }
    const r = rig({ windowCheck: () => state })
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.armed).toBeNull()
    expect(lastReason(r) ?? "none").toBe("none")
    const t = rig({ windowCheck: () => { throw new Error("x") } })
    t.c.update(t.base({ settings: t.settings({ contain: "clip" }), penInRange: true }))
    expect(t.lease.armed).toEqual(SHEET)
    const u = rig({ windowCheck: () => null })
    u.c.update(u.base({ settings: u.settings({ contain: "clip" }), penInRange: true }))
    expect(u.lease.armed).toEqual(SHEET)
  })
})

describe("panic (Esc, Ctrl+Alt+G, the chip): lets go of everything and stays off", () => {
  it("frees the clip, hides the sink and unmaps the driver at once", () => {
    const r = clipArmed()
    r.useSystem()
    r.c.panic("esc")
    expect(r.lease.armed).toBeNull()
    expect(r.sink.shown).toBe(false)
    expect(r.system.mapped.at(-1)).toBeNull()
    expect(lastReason(r)).toBe("esc")
    expect(r.c.status().armed).toBe(false)
  })

  it("is safe with nothing armed, twice, and still frees the clip call (a stale belief is the dangerous direction)", () => {
    const r = rig()
    const before = r.lease.freeCalls
    r.c.panic("panic")
    r.c.panic("panic")
    expect(r.lease.freeCalls).toBeGreaterThan(before)
  })

  it("does not re-arm on the next update; the window leaving and re-entering clears it", () => {
    const r = clipArmed()
    r.c.panic("esc")
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    r.advance(500)
    expect(r.lease.armed).toBeNull()
    r.c.update(r.base({ window: { focused: false, visible: true, minimized: false }, settings: r.settings({ contain: "clip" }), penInRange: true }))
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.armed).toEqual(SHEET)
  })

  it("capture turned off and on again clears it", () => {
    const r = clipArmed()
    r.c.panic("panic")
    r.c.update(r.base({ settings: r.settings({ contain: "clip", enabled: false }), penInRange: true }))
    r.c.update(r.base({ settings: r.settings({ contain: "clip", enabled: true }), penInRange: true }))
    expect(r.lease.armed).toEqual(SHEET)
  })

  it("the sheet reopening clears it", () => {
    const r = clipArmed()
    r.c.panic("panic")
    r.c.update(r.base({ sheet: null, sheetPhysical: null, settings: r.settings({ contain: "clip" }) }))
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.armed).toEqual(SHEET)
  })

  it("the guard seeing the panic chord is a panic of the whole app", () => {
    const r = clipArmed()
    r.lease.emitPanicKey()
    expect(r.panics).toEqual(["panic-key"])
    expect(lastReason(r)).toBe("panic-key")
    r.advance(500)
    expect(r.lease.armed).toBeNull()
  })

  it("a panic during a pending sink test cancels the test's forced sink", async () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    const p = r.c.test("sink")
    expect(r.sink.on).toBe(true)
    r.c.panic("esc")
    expect(r.sink.on).toBe(false)
    r.advance(6000)
    await p
    expect(r.sink.on).toBe(false)
    expect(r.sink.shown).toBe(false)
  })
})

describe("no guard, no clip; the guard is spawned lazily; nothing earned is armed blind (design 7.2, 14.1 #6 and #18)", () => {
  it("a clip without a ready guard is never even attempted (the guard is still starting)", () => {
    const r = rig({ lease: { st: "none" } })
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.state()).toBe("starting")
    expect(r.lease.armCalls.length).toBe(0)
    expect(r.c.status().armed).toBe(false)
    r.advance(500)
    expect(r.lease.armCalls.length).toBe(0)
    r.lease.pendingStart?.() // the guard says ready: now it may arm
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.lease.armed).toEqual(SHEET)
  })

  it("starts the guard lazily when a mechanism that needs it could be wanted, and not otherwise", () => {
    const a = rig({ lease: { st: "none" } })
    a.c.update(a.base({ settings: a.settings({ contain: "clip" }), penInRange: true }))
    expect(a.lease.startCalls).toBe(1)
    const b = rig({ lease: { st: "none" } })
    b.c.update(b.base({ penInRange: true }))
    expect(b.lease.startCalls).toBe(0) // auto + pen mode + driver untested: only the sink, which needs no guard
    const c = rig({ lease: { st: "none" }, pointerMode: "mouse" })
    c.c.update(c.base({ penInRange: true }))
    expect(c.lease.startCalls).toBe(1)
  })

  it("armClip throwing or refusing leaves nothing armed", () => {
    const r = rig()
    r.lease.armThrows = true
    r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true }))
    expect(r.c.status().armed).toBe(false)
    expect(r.c.status().mode).toBe("none")
  })

  it("contain: auto never arms a clip on a Pen-mode tablet (a Windows-Ink pen ignores ClipCursor)", () => {
    const r = rig({ pointerMode: "pen" })
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    r.emitNative(1)
    r.advance(500)
    expect(r.lease.armCalls.length).toBe(0)
  })

  it("contain: auto arms a clip, and not the sink, when the tablet was measured to be in Mouse mode", () => {
    const r = rig({ pointerMode: "mouse" })
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    expect(r.c.status().mode).toBe("clip")
    expect(r.sink.shown).toBe(false)
    expect(r.sink.on).toBe(false)
  })

  it("contain: auto never starts the driver mapping or wants it until it was proven on this display (rule 18)", () => {
    const r = rig()
    r.useSystem()
    r.c.update(r.base({ penInRange: true, active: "wintab-system" }))
    r.advance(500)
    expect(r.c.driverMappingWanted()).toBe(false)
    expect(r.c.status().mode).not.toBe("driver")
    expect(r.lease.armCalls.length).toBe(0)
  })

  it("a driver proof made at another display configuration counts as untested", () => {
    const r = rig({ caps: { driver: { state: "honored", at: "x", note: noteWithConfig("proved", "3840x2160@2") } } })
    r.c.update(r.base())
    expect(r.c.driverMappingWanted()).toBe(false)
  })

  it("a proven driver mapping is wanted only with a ready guard", () => {
    const caps = { driver: { state: "honored" as const, at: "x", note: noteWithConfig("proved", CFG) } }
    const r = rig({ caps })
    r.c.update(r.base())
    expect(r.c.driverMappingWanted()).toBe(true)
    r.lease.st = "lost"
    expect(r.c.driverMappingWanted()).toBe(false)
  })

  it("contain: driver forces the mapping (with a guard) and nothing else", () => {
    const r = rig()
    r.c.update(r.base({ settings: r.settings({ contain: "driver" }) }))
    expect(r.c.driverMappingWanted()).toBe(true)
    expect(r.c.sinkWanted()).toBe(false)
  })

  it("a driver marked unsafe is never wanted again, whatever the setting", () => {
    const r = rig({ caps: { driver: { state: "unsafe", at: "x", note: "boom" } } })
    r.c.update(r.base({ settings: r.settings({ contain: "driver" }) }))
    expect(r.c.driverMappingWanted()).toBe(false)
  })
})

describe("the driver mapping", () => {
  const honored = { driver: { state: "honored" as const, at: "x", note: noteWithConfig("proved", CFG) } }

  it("arms while wintab-system is the active backend and reports the sheet rectangle", () => {
    const r = rig({ caps: honored })
    r.useSystem()
    r.c.update(r.base({ penInRange: true, active: "wintab-system" }))
    expect(r.c.status()).toMatchObject({ mode: "driver", armed: true, rect: SHEET })
    expect(r.sink.shown).toBe(false) // driver > sink: one mechanism at a time
  })

  it("is not armed when another backend is active", () => {
    const r = rig({ caps: honored })
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    expect(r.c.status().mode).not.toBe("driver")
  })

  it("blur unmaps the driver at once", () => {
    const r = rig({ caps: honored })
    r.useSystem()
    r.c.update(r.base({ penInRange: true, active: "wintab-system" }))
    r.c.update(r.base({ penInRange: true, active: "wintab-system", window: { focused: false, visible: true, minimized: false } }))
    expect(r.system.mapped.at(-1)).toBeNull()
    expect(lastReason(r)).toBe("blur")
  })

  it("a cursor that leaves the rectangle for three heartbeats while the pen is in range marks the driver unsafe and releases", () => {
    const r = rig({ caps: honored })
    r.useSystem()
    r.c.update(r.base({ penInRange: true, active: "wintab-system" }))
    r.cursor = { x: 50, y: 50 }
    for (let i = 0; i < 40; i++) { r.emitNative(1); r.advance(100) }
    expect(r.c.status().mode).not.toBe("driver") // the pen sink, which dies with the process, takes over; the driver mapping is done with
    expect(r.store.driver.state).toBe("unsafe")
    expect(r.traced("unsafe")[0]?.data).toMatchObject({ mechanism: "driver" })
    expect(r.system.mapped.at(-1)).toBeNull()
    expect(r.c.driverMappingWanted()).toBe(false)
  })

  it("a cursor that stays inside is fine, and the outside count resets", () => {
    const r = rig({ caps: honored })
    r.useSystem()
    r.c.update(r.base({ penInRange: true, active: "wintab-system" }))
    const run = (ms: number) => { for (let i = 0; i < ms / 100; i++) { r.emitNative(1); r.advance(100) } }
    r.cursor = { x: 50, y: 50 }
    run(2200)
    r.cursor = { x: 1400, y: 500 }
    run(1100)
    r.cursor = { x: 50, y: 50 }
    run(2200)
    expect(r.c.status().armed).toBe(true)
    expect(r.store.driver.state).toBe("honored")
  })

  it("a mouse that wanders outside while the pen is away proves nothing", () => {
    const r = rig({ caps: honored })
    r.useSystem()
    r.c.update(r.base({ penInRange: true, active: "wintab-system" }))
    r.c.update(r.base({ penInRange: false, lastPenAt: r.now, active: "wintab-system" }))
    r.cursor = { x: 50, y: 50 }
    r.advance(8000)
    expect(r.store.driver.state).toBe("honored")
  })
})

describe("the sink: `on` needs ALL of (a)-(f) (design 7.6)", () => {
  it("turns on with a fresh pen signal, a consumer, nothing in the way", () => {
    const r = sinkOn()
    expect(r.sink.shown).toBe(true)
    expect(r.c.status()).toMatchObject({ mode: "sink", armed: true })
  })

  it("(a) not without a fresh pen signal; shown but click-through meanwhile", () => {
    const r = rig()
    r.c.update(r.base({ active: "wintab-data" }))
    r.advance(1000)
    expect(r.sink.shown).toBe(true)
    expect(r.sink.on).toBe(false)
  })

  it("(a) a pen STATE alone (the pointer-range witness) is a signal for SINK_SIGNAL_MS", () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    r.advance(100)
    expect(r.sink.on).toBe(true)
  })

  it("(b) not with a tip down: hit-testing never flips under a stroke, in either direction", () => {
    const r = rig()
    r.c.update(r.base({ active: "wintab-data" }))
    r.emitNative(1, { tip: true, p: 0.4 })
    r.advance(100)
    expect(r.sink.on).toBe(false)
    r.emitNative(1, { tip: false })
    r.advance(100)
    expect(r.sink.on).toBe(true)
    // now a stroke: the signal lapses mid-stroke (a still pen sends nothing) and the sink stays on
    r.emitNative(1, { tip: true, p: 0.4 })
    r.advance(CONTAIN.SINK_PEN_OUT_MS + 300)
    expect(r.sink.on).toBe(true)
  })

  it("(b) a pen-up that never arrives does not hold the sink on for ever", () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    r.emitNative(1)
    r.advance(100)
    r.emitNative(1, { tip: true, p: 0.4 })
    r.c.update(r.base({ penInRange: false, lastPenAt: r.now, active: "wintab-data" }))
    r.advance(3000)
    expect(r.sink.on).toBe(false)
  })

  it("(c) not while mouse-locked", () => {
    const r = sinkOn()
    r.sink.emitMouse() // a real mouse event, long after any pen tip
    expect(r.sink.on).toBe(false)
    r.emitNative(1)
    r.advance(300)
    expect(r.sink.on).toBe(false)
  })

  it("(d) not when the capability is ineffective or unsafe for this display", () => {
    for (const state of ["ineffective", "unsafe"] as const) {
      const r = rig({ caps: { sink: { state, at: "x", note: noteWithConfig("measured", CFG) } } })
      r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
      r.emitNative(1); r.advance(300)
      expect(r.sink.on).toBe(false)
      expect(r.sink.shown).toBe(false)
      expect(r.c.sinkWanted()).toBe(false)
    }
  })

  it("(d) an ineffective record from another display configuration counts as untested, an unsafe one never does", () => {
    const a = rig({ caps: { sink: { state: "ineffective", at: "x", note: noteWithConfig("measured", "other") } } })
    expect(a.c.sinkWanted()).toBe(false) // before the first update there is no setting to allow it
    a.c.update(a.base())
    expect(a.c.sinkWanted()).toBe(true)
    const b = rig({ caps: { sink: { state: "unsafe", at: "x", note: noteWithConfig("boom", "other") } } })
    b.c.update(b.base())
    expect(b.c.sinkWanted()).toBe(false)
  })

  it("(e) not unless capture is on, containment is auto or sink, and the overlay backend is switched on", () => {
    const cases: Partial<PenFeedSettings>[] = [
      { enabled: false }, { contain: "none" }, { contain: "driver" },
      { backends: { ...DEFAULT_SETTINGS.backends, overlay: false } },
    ]
    for (const over of cases) {
      const r = rig()
      r.c.update(r.base({ settings: r.settings(over), penInRange: true, active: "wintab-data" }))
      r.emitNative(1); r.advance(300)
      expect(r.sink.on).toBe(false)
      expect(r.c.sinkWanted()).toBe(false)
    }
    const ok = rig()
    ok.c.update(ok.base({ settings: ok.settings({ contain: "sink" }) }))
    expect(ok.c.sinkWanted()).toBe(true)
  })

  it("(f) not without a consumer: only a live native backend, or the overlay backend, counts what the sink swallows", () => {
    for (const active of [null, "dom"] as (BackendName | null)[]) {
      const r = rig()
      r.c.update(r.base({ penInRange: true, active }))
      r.emitNative(1); r.advance(300)
      expect(r.sink.on).toBe(false)
    }
    for (const active of ["overlay", "rawinput", "webhid", "wintab-data"] as BackendName[]) {
      const r = rig()
      r.c.update(r.base({ penInRange: true, active }))
      r.emitNative(1); r.advance(300)
      expect(r.sink.on).toBe(true)
    }
  })

  it("(f) the consumer going stale turns it off", () => {
    const r = sinkOn()
    r.c.update(r.base({ penInRange: true, active: null }))
    expect(r.sink.on).toBe(false)
    expect(lastReason(r)).toBe("no-consumer")
  })

  it("goes click-through SINK_PEN_OUT_MS after the last pen event once the state says the pen left", () => {
    const r = sinkOn()
    r.c.update(r.base({ penInRange: false, lastPenAt: r.now, active: "wintab-data" }))
    expect(r.sink.on).toBe(true)
    r.advance(CONTAIN.SINK_PEN_OUT_MS - 100)
    expect(r.sink.on).toBe(true)
    r.advance(300)
    expect(r.sink.on).toBe(false)
    expect(lastReason(r)).toBe("pen-out")
  })

  it("is not on while the setup check runs (the check measures the window's own pen events)", () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "wintab-data", checkRunning: true }))
    r.emitNative(1); r.advance(300)
    expect(r.sink.on).toBe(false)
    expect(r.sink.shown).toBe(false)
    r.c.update(r.base({ penInRange: true, active: "wintab-data", checkRunning: false }))
    r.emitNative(1); r.advance(300)
    expect(r.sink.on).toBe(true)
  })
})

describe("the sink: a real mouse always wins (design 7.6)", () => {
  it("a mouse event turns it off at once and locks it off until no pen signal for MOUSE_LOCK_CLEAR_MS", () => {
    const r = sinkOn()
    r.advance(1000) // well past any tip
    r.sink.emitMouse()
    expect(r.sink.on).toBe(false)
    expect(lastReason(r)).toBe("mouse")
    // pen signals keep arriving: still locked
    for (let i = 0; i < 20; i++) { r.emitNative(1); r.advance(100) }
    expect(r.sink.on).toBe(false)
    // quiet for long enough: the lock clears, the next pen signal turns it on again
    r.advance(CONTAIN.MOUSE_LOCK_CLEAR_MS + 200)
    r.emitNative(1)
    r.advance(100)
    expect(r.sink.on).toBe(true)
  })

  it("a mouse event right after a pen tip is the pen's echo and is ignored", () => {
    const r = sinkOn()
    r.emitNative(1, { tip: true, p: 0.5 })
    r.advance(50)
    r.sink.emitMouse()
    expect(r.sink.on).toBe(true)
    expect(r.traced("sink-mouse-wins").length).toBe(0)
  })

  it("with a tip down the mouse event waits for the pen-up (never mid-stroke)", () => {
    const r = sinkOn()
    r.advance(CONTAIN.ECHO_MS + 100)
    r.emitNative(1, { tip: true, p: 0.5 })
    r.advance(CONTAIN.ECHO_MS + 100) // the echo window has passed but the tip is still down
    r.sink.emitMouse()
    expect(r.sink.on).toBe(true)
    r.emitNative(1, { tip: false })
    expect(r.sink.on).toBe(false)
    expect(lastReason(r)).toBe("mouse")
  })

  it("a sink without an event channel is polled through its mouse counter", () => {
    const r = rig({ plainSink: true })
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    r.emitNative(1); r.advance(300)
    expect(r.sink.on).toBe(true)
    r.sink.mouse++
    r.advance(150)
    expect(r.sink.on).toBe(false)
    expect(lastReason(r)).toBe("mouse")
  })

  it("three quick mouse arrivals on three visits while a native backend sees the pen: the pen arrives as mouse input, ineffective", () => {
    const r = rig()
    for (let visit = 0; visit < 3; visit++) {
      r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
      r.emitNative(1)
      r.advance(100)
      expect(r.sink.on).toBe(true)
      r.sink.emitMouse() // within PEN_AS_MOUSE_MS of turning on, and no tip: not an echo
      if (visit < 2) {
        r.c.update(r.base({ penInRange: false, active: "wintab-data" }))
        r.advance(CONTAIN.SINK_PEN_OUT_MS + CONTAIN.MOUSE_LOCK_CLEAR_MS + 600)
      }
    }
    expect(r.store.sink.state).toBe("ineffective")
    expect(plainNote(r.store.sink.note)).toContain("mouse input")
    expect(r.sink.on).toBe(false)
  })
})

describe("the sink: passive validation (design 7.6)", () => {
  /** n sink pen events at time t, in the screen frame. */
  const sinkEvents = (r: Rig, n: number) => r.sink.emitPen(Array.from({ length: n }, (_, i) => sample(r.now + i, { backend: "overlay", x: 0.3, y: 0.3 })))

  it("effective: enough native samples and a ratio of at least 10%", () => {
    const r = sinkOn()
    r.emitNative(40)
    sinkEvents(r, 10)
    r.advance(200)
    expect(r.store.sink.state).toBe("effective")
    expect(plainNote(r.store.sink.note)).toContain("10 pen events")
    expect(configOfNote(r.store.sink.note)).toBe(CFG)
    expect(r.sink.on).toBe(true) // stays on
    expect(r.saved.length).toBe(1)
    // no more measuring once effective
    r.emitNative(100)
    r.advance(2000)
    expect(r.saved.length).toBe(1)
  })

  it("ineffective: a ratio below 10% after SINK_VALIDATE_MS releases and records, and is not retried", () => {
    const r = sinkOn()
    r.emitNative(40)
    sinkEvents(r, 1)
    r.advance(CONTAIN.SINK_VALIDATE_MS + 200)
    expect(r.store.sink.state).toBe("ineffective")
    expect(r.sink.on).toBe(false)
    expect(r.sink.shown).toBe(false)
    expect(lastReason(r)).toBe("ineffective")
    expect(r.c.sinkWanted()).toBe(false)
    r.emitNative(1)
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    r.advance(500)
    expect(r.sink.on).toBe(false)
  })

  it("nothing is decided before SINK_MIN_NATIVE native samples have been counted", () => {
    const r = sinkOn()
    r.emitNative(10)
    r.advance(CONTAIN.SINK_VALIDATE_MS + 300)
    expect(r.saved.length).toBe(0)
  })

  it("no native backend: at least 10 sink events within 1500 ms is effective", () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "overlay" }))
    r.advance(100)
    expect(r.sink.on).toBe(true)
    sinkEvents(r, 12)
    r.advance(200)
    expect(r.store.sink.state).toBe("effective")
  })

  it("no native backend: none while the earlier signal holds is ineffective", () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "overlay" }))
    r.advance(100)
    expect(r.sink.on).toBe(true)
    for (let i = 0; i < 20; i++) { r.c.update(r.base({ penInRange: true, active: "overlay" })); r.advance(100) }
    expect(r.store.sink.state).toBe("ineffective")
    expect(r.sink.on).toBe(false)
  })

  it("no native backend: the pen simply leaving is ambiguous, so it turns off WITHOUT recording anything", () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "overlay" }))
    r.advance(100)
    expect(r.sink.on).toBe(true)
    r.c.update(r.base({ penInRange: false, active: "overlay" }))
    r.advance(CONTAIN.SINK_VALIDATE_MS + 500)
    expect(r.sink.on).toBe(false)
    expect(r.saved.length).toBe(0)
    expect(r.c.sinkWanted()).toBe(true)
  })
})

describe("the sink: unsafe (never retried automatically)", () => {
  it("still hit-testing 3 s after the off order is unsafe", () => {
    const r = sinkOn()
    r.sink.stuckOn = true
    r.c.update(r.base({ penInRange: false, active: "wintab-data" }))
    r.advance(CONTAIN.SINK_PEN_OUT_MS + 200)
    expect(r.sink.state().on).toBe(true) // the window ignored the order
    r.advance(CONTAIN.SINK_OFF_GRACE_MS + 500)
    expect(r.store.sink.state).toBe("unsafe")
    expect(lastReason(r)).toBe("unsafe")
    expect(r.c.sinkWanted()).toBe(false)
  })

  it("the sink page stopping its heartbeat while it is on is unsafe", () => {
    const r = sinkOn()
    r.sink.beatAge = CONTAIN.HEARTBEAT_TIMEOUT_MS + 1
    r.advance(200)
    expect(r.store.sink.state).toBe("unsafe")
    expect(r.sink.on).toBe(false)
  })

  it("a sink window that throws when told to stop releases everything (fail closed)", () => {
    const r = sinkOn()
    r.sink.throwOnSetOn = true
    r.c.update(r.base({ penInRange: true, active: "wintab-data", window: { focused: false, visible: true, minimized: false } }))
    expect(r.c.status().armed).toBe(false)
    expect(r.sink.shown).toBe(false)
  })
})

describe("fail closed", () => {
  it("an evaluation that throws releases everything and says why", () => {
    const r = clipArmed()
    // a corrupt settings object makes the next evaluation throw
    expect(() => r.c.update({ ...r.base({ penInRange: true }), settings: null as unknown as PenFeedSettings })).not.toThrow()
    expect(r.c.status().armed).toBe(false)
    expect(r.lease.armed).toBeNull()
    expect(lastReason(r)).toBe("error")
  })

  it("a lease whose armClip throws, and a sink whose setShown throws, never escape", () => {
    const r = rig()
    r.lease.armThrows = true
    r.sink.setShown = () => { throw new Error("window gone") }
    expect(() => { r.c.update(r.base({ settings: r.settings({ contain: "clip" }), penInRange: true })); r.advance(500) }).not.toThrow()
    expect(r.c.status().armed).toBe(false)
  })

  it("status() never throws and tells the truth about the guard", () => {
    const r = rig({ lease: { st: "starting" } })
    expect(r.c.status().guard).toEqual({ state: "starting", pid: null })
    r.lease.st = "ready"
    expect(r.c.status().guard).toEqual({ state: "ready", pid: 777 })
  })
})

describe("the check's tests (design 9.6)", () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

  it("test('sink'): effective when the sink caught the pen, and the sink is released afterwards", async () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    const p = r.c.test("sink")
    expect(r.sink.on).toBe(true)
    r.emitNative(100)
    r.sink.emitPen(Array.from({ length: 30 }, (_, i) => sample(r.now + i, { backend: "overlay" })))
    r.advance(CONTAIN.TEST_MS + 200)
    const res = await p
    expect(res).toMatchObject({ mechanism: "sink", state: "effective" })
    expect(r.store.sink.state).toBe("effective")
    expect(r.sink.on).toBe(false) // forced mode ended; normal policy resumes
  })

  it("test('sink'): ineffective when the pen was seen but the sink caught nothing; it also retries an earlier ineffective record", async () => {
    const r = rig({ caps: { sink: { state: "ineffective", at: "x", note: noteWithConfig("before", CFG) } } })
    r.c.update(r.base({ penInRange: true, active: "wintab-data" }))
    const p = r.c.test("sink")
    expect(r.sink.on).toBe(true)
    r.emitNative(100)
    r.advance(CONTAIN.TEST_MS + 200)
    expect((await p).state).toBe("ineffective")
    expect(r.sink.on).toBe(false)
  })

  it("test('sink'): no pen seen is 'untested', recorded as nothing", async () => {
    const r = rig()
    r.c.update(r.base())
    const p = r.c.test("sink")
    r.advance(CONTAIN.TEST_MS + 200)
    const res = await p
    expect(res.state).toBe("untested")
    expect(r.saved.length).toBe(0)
  })

  it("test('sink') refuses when the window is not in front", async () => {
    const r = rig()
    r.c.update(r.base({ window: { focused: false, visible: true, minimized: false } }))
    expect((await r.c.test("sink")).state).toBe("untested")
    expect(r.sink.on).toBe(false)
  })

  it("test('driver'): honored when the pointer stayed inside while the pen swept the tablet; the mapping is undone afterwards", async () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true }))
    const p = r.c.test("driver")
    await flush()
    for (let i = 0; i < 30; i++) {
      r.emitNative(1, { x: i / 29, y: (29 - i) / 29 })
      r.advance(100)
    }
    r.advance(CONTAIN.TEST_MS)
    const res = await p
    expect(res).toMatchObject({ mechanism: "driver", state: "honored" })
    expect(r.store.driver.state).toBe("honored")
    expect(r.system.mapped[0]).toEqual(SHEET)
    expect(r.system.mapped.at(-1)).toBeNull()
    expect(r.system.stopCalls).toBeGreaterThan(0)
    expect(r.c.driverMappingWanted()).toBe(true)
  })

  it("test('driver'): ignored when the pointer left the rectangle", async () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true }))
    const p = r.c.test("driver")
    await flush()
    r.cursor = { x: 20, y: 20 }
    for (let i = 0; i < 30; i++) { r.emitNative(1, { x: i / 29, y: 0.5 }); r.advance(100) }
    r.advance(CONTAIN.TEST_MS)
    expect((await p).state).toBe("ignored")
    expect(r.store.driver.state).toBe("ignored")
    expect(r.system.mapped.at(-1)).toBeNull()
  })

  it("test('driver'): not moving the pen is untested, and the mapping is still undone", async () => {
    const r = rig()
    r.c.update(r.base({ penInRange: true }))
    const p = r.c.test("driver")
    await flush()
    r.advance(CONTAIN.TEST_MS + 200)
    expect((await p).state).toBe("untested")
    expect(r.system.mapped.at(-1)).toBeNull()
    expect(r.saved.length).toBe(0)
  })

  it("test('driver') without a guard never starts a system context", async () => {
    const r = rig({ lease: { st: "none" } })
    r.c.update(r.base({ penInRange: true }))
    const res = await r.c.test("driver")
    expect(res.state).toBe("untested")
    expect(r.system.startCalls).toBe(0)
  })
})

describe("status", () => {
  it("reports the mechanism, the rectangle, the last release and the capabilities", () => {
    const r = clipArmed()
    expect(r.c.status()).toMatchObject({ mode: "clip", armed: true, rect: SHEET, lastRelease: null, pointerMode: "pen", guard: { state: "ready", pid: 777 } })
    r.c.update(r.base({ window: { focused: false, visible: true, minimized: false }, settings: r.settings({ contain: "clip" }) }))
    expect(r.c.status().lastRelease).toMatchObject({ reason: "blur" })
    expect(r.c.status().capabilities.clip.state).toBe("untested")
  })
})
