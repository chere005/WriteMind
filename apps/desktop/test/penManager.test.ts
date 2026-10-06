/**
 * The small FeedManager (main/pen/manager.ts) over fake backends, a fake clock and a fake mapping port: Wintab runs only while the sheet is open
 * and the window is in front, nothing is held when it is not wanted, the frame comes from the device alone (nothing is calibrated), the
 * system mapping is driven only for the real tablet, and the one status string says what drives the sheet.
 */
import { describe, expect, it } from "vitest"
import { createFeedManager, statusText, type FeedManagerEx, type ManagerDeps } from "../src/main/pen/manager"
import { FakeBackend, InjectBackend, sample } from "../src/main/pen/fake"
import type { MappingController } from "../src/main/pen/mapping"
import { defaultState, parseState, type PenState, type StateStore } from "../src/main/pen/state"
import type { DeviceInfo, MappingState, PenBatch, PenSample, SheetReport, TraceSink } from "../src/shared/pen"

const device: DeviceInfo = { name: "WACOM Tablet", vendorId: null, productId: null, aspect: 1.6, rawX: [0, 9499], rawY: [0, 15199], pressureMax: 32767, claims: { pressure: true, tilt: false, lower: true, upper: true, eraser: false } }
const KEY = "wintab:WACOM Tablet:9499x15199"

class FakeMapping implements MappingController {
  calls: string[] = []
  st: MappingState = "off"
  wanted = false
  key: string | null = null
  sheet: SheetReport | null = null
  inRange = false
  last: { u: number; v: number } | null = null
  listeners = new Set<() => void>()
  state() { return this.st }
  setDevice(k: string | null) { this.key = k }
  setSheet(r: SheetReport | null) { this.sheet = r; this.calls.push("sheet") }
  setWanted(on: boolean) { if (on !== this.wanted) this.calls.push(on ? "wanted" : "unwanted"); this.wanted = on }
  pen(i: boolean) { this.inRange = i; this.calls.push(i ? "pen-in" : "pen-out") }
  observe(u: number, v: number) { this.last = { u, v } }
  dataSeen() { this.calls.push("data") }
  systemPacket() { /* nothing */ }
  refresh() { /* nothing */ }
  retry() { this.calls.push("retry"); this.st = "off" }
  stop(reason: string) { this.calls.push(`stop:${reason}`); this.wanted = false; this.inRange = false }
  onChange(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  set(st: MappingState) { this.st = st; for (const l of this.listeners) l() }
}

function rig(over: Partial<ManagerDeps> = {}, opts: { wintab?: FakeBackend | null } = {}) {
  const state: PenState = defaultState()
  const store: StateStore = { get: () => state, update: (change) => { change(state) }, flushSync() {}, dispose() {} }
  const events: { name: string; data?: Record<string, unknown> }[] = []
  const trace: TraceSink = { event: (_s, name, data) => { events.push({ name, data }) }, raw() {} }
  const wintab = opts.wintab === undefined ? new FakeBackend("wintab-data", { frameKind: "device", device }) : opts.wintab
  const inject = new InjectBackend()
  const injectTablet = new InjectBackend("inject-tablet")
  injectTablet.setDevice(device)
  const mapping = new FakeMapping()
  let clock = 1_000_000
  const timers: { at: number; fn: () => void }[] = []
  const deps: ManagerDeps = {
    available: true, wintab, inject, injectTablet, mapping, store, trace, now: () => clock, e2e: false, native: false, log: () => {},
    setTimer: (fn, ms) => { const t = { at: clock + ms, fn }; timers.push(t); return t },
    clearTimer: (h) => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1) },
    ...over,
  }
  const m: FeedManagerEx = createFeedManager(deps)
  const batches: PenBatch[] = []
  m.onSamples((b) => batches.push(b))
  const advance = (ms: number): void => {
    clock += ms
    for (const t of [...timers].filter((x) => x.at <= clock)) { timers.splice(timers.indexOf(t), 1); t.fn() }
  }
  const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }
  return { m, wintab, inject, injectTablet, mapping, state, events, batches, advance, flush, tick: (ms = 8) => { clock += ms }, names: () => events.map((e) => e.name) }
}

const hover = (t: number, x = 0.2, y = 0.8, o: Partial<PenSample> = {}): PenSample => sample({ t, x, y, backend: "wintab", ...o })
const down = (t: number, x: number, y: number): PenSample => hover(t, x, y, { tip: true, p: 0.4 })

describe("what runs, and when", () => {
  it("starts nothing until the sheet is open", () => {
    const r = rig()
    expect(r.wintab!.startCalls).toBe(0)
  })

  it("opening the sheet starts Wintab; closing it stops it and the mapping at once", async () => {
    const r = rig()
    const status = await r.m.open()
    await r.flush()
    expect(r.wintab!.running).toBe(true)
    expect(status.open).toBe(true)
    r.m.close("sheet gone")
    expect(r.wintab!.running).toBe(false)
    expect(r.mapping.calls).toContain("stop:feed stopped")
    expect(r.mapping.sheet).toBeNull()
  })

  it("a window that is not in front releases after a short grace (the mapping lets go AT ONCE), and coming back starts it again", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    expect(r.m.status().released).toBe("the window is not in front")
    expect(r.m.status().text).toBe("Pen: none")
    expect(r.mapping.calls).toContain("stop:window not in front")
    expect(r.wintab!.running).toBe(true) // still inside the grace
    r.advance(2000)
    expect(r.wintab!.running).toBe(false)
    r.m.setWindowState({ focused: true, visible: true, minimized: false })
    await r.flush()
    expect(r.wintab!.running).toBe(true)
    expect(r.m.status().released).toBeNull()
  })

  it("capture switched off runs nothing; switched on again starts it", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.m.update({ enabled: false })
    expect(r.wintab!.running).toBe(false)
    expect(r.m.status().text).toBe("Pen: window pointer")
    r.m.update({ enabled: true })
    await r.flush()
    expect(r.wintab!.running).toBe(true)
  })

  it("a panic lets go at once and stays released until the window is focused again", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.m.panic("esc")
    expect(r.wintab!.running).toBe(false)
    expect(r.m.status().released).toBe("esc")
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    r.m.setWindowState({ focused: true, visible: true, minimized: false })
    await r.flush()
    expect(r.m.status().released).toBeNull()
    expect(r.wintab!.running).toBe(true)
  })

  it("not available (not Windows): nothing exists, nothing starts", async () => {
    const r = rig({ available: false })
    const status = await r.m.open()
    expect(status.available).toBe(false)
    expect(r.wintab!.startCalls).toBe(0)
    expect(status.text).toBe("")
  })

  it("dispose stops everything and the mapping", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.m.dispose()
    expect(r.wintab!.running).toBe(false)
    expect(r.mapping.calls.some((c) => c.startsWith("stop:"))).toBe(true)
  })
})

describe("no Wintab: the window pen is untouched and the sheet says nothing", () => {
  it("no Wintab at all (another brand, no driver)", async () => {
    const r = rig({}, { wintab: null })
    const s = await r.m.open()
    expect(s.tablet).toBeNull()
    expect(s.text).toBe("Pen: window pointer")
    expect(s.note).toBe("Wintab is not available here")
    expect(r.batches).toHaveLength(0) // nothing is ever sent: the DOM pen reaches the sheet as it always did
  })

  it("Wintab that fails to open costs nothing and keeps the reason", async () => {
    const wintab = new FakeBackend("wintab-data", { frameKind: "device", startFails: { reason: "Wintab reports 0 tablets", retry: "after-replug" } })
    const r = rig({}, { wintab })
    await r.m.open(); await r.flush()
    expect(r.m.status().note).toBe("Wintab reports 0 tablets")
    expect(r.m.status().text).toBe("Pen: window pointer")
    expect(r.m.status().tablet).toBeNull()
  })

  it("a failed Wintab start is tried again after 5 s, then 15 s, then 45 s, and then left alone", async () => {
    const wintab = new FakeBackend("wintab-data", { frameKind: "device", startFails: { reason: "busy", retry: "later" } })
    const r = rig({}, { wintab })
    await r.m.open(); await r.flush()
    expect(wintab.startCalls).toBe(1)
    r.advance(5000); await r.flush()
    expect(wintab.startCalls).toBe(2)
    r.advance(15000); await r.flush()
    expect(wintab.startCalls).toBe(3)
    r.advance(45000); await r.flush()
    expect(wintab.startCalls).toBe(4)
    r.advance(200000); await r.flush()
    expect(wintab.startCalls).toBe(4)
  })
})

describe("the frame: from the device alone, nothing to calibrate", () => {
  it("a tablet inks from its first touch, nothing is asked", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    const s = r.m.status()
    expect(s.tablet).toMatchObject({ name: "WACOM Tablet", pressureMax: 32767 })
    expect(s.tablet!.aspect).toBeCloseTo(1.6, 2)
    expect(s.frame).toMatchObject({ frame: { turn: 1, flipY: true }, source: "default" })
    r.wintab!.emit([hover(1, 0.3, 0.4), down(2, 0.3, 0.4), hover(3, 0.5, 0.5, { lower: true })])
    const out = r.batches.flatMap((b) => b.samples)
    expect(out).toHaveLength(3)
    expect(out[1]!.tip).toBe(true)
    expect(out[1]!.p).toBeCloseTo(0.4)
    expect(out[2]!.lower).toBe(true)
  })

  it("the sheet is LANDSCAPE: the long device axis is the sheet's width, the four corners land on the sheet's corners", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    // turn 1 with y read up: (x, y) -> (y, x); the device's short axis (x) becomes the sheet's HEIGHT
    r.wintab!.emit([hover(1, 0, 0), hover(2, 1, 0), hover(3, 0, 1), hover(4, 1, 1)])
    const c = r.batches.flatMap((b) => b.samples).map((p) => [p.x, p.y])
    expect(c).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]])
  })
})

describe("the system mapping is driven only for the real tablet", () => {
  it("wanted only once Wintab is active; told the sheet, the visit and the position (sheet frame)", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.m.update({ mapSheet: true }) // the system mapping (on by default)
    r.m.setSheet({ rect: { x: 10, y: 20, width: 300, height: 190 }, turns: 0 })
    expect(r.mapping.sheet).toMatchObject({ turns: 0 })
    expect(r.mapping.wanted).toBe(false) // no pen seen yet: Wintab is not the active feed
    r.wintab!.emit([hover(1, 0.25, 0.75)])
    expect(r.mapping.wanted).toBe(true)
    expect(r.mapping.key).toBe(KEY)
    expect(r.mapping.inRange).toBe(true)
    // turn 1, y read up: (0.25, 0.75) -> (0.75, 0.25)
    expect(r.mapping.last!.u).toBeCloseTo(0.75); expect(r.mapping.last!.v).toBeCloseTo(0.25)
    r.wintab!.emit([hover(2, 0.25, 0.75, { inRange: false })])
    expect(r.mapping.inRange).toBe(false)
  })

  it("the mapping is on by default, and off once switched off, even with the pen in range", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.m.update({ mapSheet: false })
    r.m.setSheet({ rect: { x: 10, y: 20, width: 300, height: 190 }, turns: 0 })
    r.wintab!.emit([hover(1, 0.25, 0.75)])
    expect(r.mapping.wanted).toBe(false)
  })

  it("every data batch tells the mapping the data feed is alive (its watchdog against a starved data context)", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.wintab!.emit([hover(1)])
    expect(r.mapping.calls).toContain("data")
  })

  it("a blur closes it at once and the pen's next visit reopens it when the window is back", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.wintab!.emit([hover(1)])
    expect(r.mapping.inRange).toBe(true)
    r.m.setWindowState({ focused: false, visible: true, minimized: false })
    expect(r.mapping.inRange).toBe(false)
    expect(r.mapping.wanted).toBe(false)
    r.m.setWindowState({ focused: true, visible: true, minimized: false })
    await r.flush()
    r.wintab!.emit([hover(5)])
    expect(r.mapping.inRange).toBe(true)
  })

  it("the status string says mapped only when the mapping is mapped", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    expect(r.m.status().text).toBe("Pen: tablet")
    r.mapping.set("mapped")
    expect(r.m.status().text).toBe("Pen: tablet, mapped to sheet")
    expect(r.m.status().mapping).toBe("mapped")
    // one pen.log line per transition
    expect(r.events.filter((e) => e.name === "status").map((e) => e.data!.text)).toEqual(["Pen: window pointer", "Pen: tablet", "Pen: tablet, mapped to sheet"])
  })

  it("retry goes through", async () => {
    const r = rig()
    await r.m.open(); await r.flush()
    r.m.retryMapping()
    expect(r.mapping.calls).toContain("retry")
  })

  it("the E2E fake tablet never drives the mapping", async () => {
    const r = rig({ e2e: true })
    await r.m.open()
    r.m.e2eConfig({ capture: true, tablet: true }); await r.flush()
    r.m.inject([hover(1)], "inject-tablet")
    expect(r.mapping.wanted).toBe(false)
  })
})

describe("one backend feeds the sheet", () => {
  it("never changes source in the middle of a stroke; the better backend takes over after", async () => {
    const r = rig({ e2e: true })
    await r.m.open()
    r.m.e2eConfig({ capture: true, native: true }); await r.flush()
    r.wintab!.emit([hover(1), down(2, 0.3, 0.3)])
    expect(r.m.status().active).toBe("wintab-data")
    r.m.inject([hover(3)])
    expect(r.m.status().active).toBe("wintab-data") // wintab is in contact
    r.wintab!.emit([hover(4, 0.3, 0.3)])
    r.m.inject([hover(5)])
    expect(r.m.status().active).toBe("inject")
  })

  it("an active backend that goes quiet hands over to one that is delivering", async () => {
    const r = rig({ e2e: true })
    await r.m.open()
    r.m.e2eConfig({ capture: true, native: true }); await r.flush()
    r.m.inject([hover(1)])
    expect(r.m.status().active).toBe("inject")
    r.wintab!.emit([hover(2)])
    expect(r.m.status().active).toBe("inject")
    r.tick(3000)
    r.wintab!.emit([hover(3)])
    expect(r.m.status().active).toBe("wintab-data")
  })
})

describe("the status string", () => {
  const base = { available: true, open: true, enabled: true, released: false, tablet: false, mapped: false }
  it("is quiet and short", () => {
    expect(statusText({ ...base, tablet: true, mapped: true })).toBe("Pen: tablet, mapped to sheet")
    expect(statusText({ ...base, tablet: true })).toBe("Pen: tablet")
    expect(statusText(base)).toBe("Pen: window pointer")
    expect(statusText({ ...base, released: true })).toBe("Pen: none")
    expect(statusText({ ...base, open: false })).toBe("")
    expect(statusText({ ...base, available: false })).toBe("")
    expect(statusText({ ...base, tablet: true, enabled: false })).toBe("Pen: window pointer")
  })
})

describe("E2E hooks", () => {
  it("capture starts off under E2E, injected samples feed the sheet once it is on, and Wintab is not opened", async () => {
    const r = rig({ e2e: true })
    await r.m.open(); await r.flush()
    expect(r.m.status().text).toBe("Pen: window pointer")
    expect(r.wintab!.startCalls).toBe(0)
    r.m.e2eConfig({ capture: true }); await r.flush()
    expect(r.wintab!.startCalls).toBe(0)
    r.m.inject([hover(1, 0.1, 0.9)])
    expect(r.batches).toHaveLength(1)
    expect(r.batches[0]!.samples[0]!.x).toBeCloseTo(0.1)
    expect(r.m.status().active).toBe("inject")
  })

  it("the fake tablet goes through the same frame as a real one", async () => {
    const r = rig({ e2e: true })
    await r.m.open()
    r.m.e2eConfig({ capture: true, tablet: true }); await r.flush()
    expect(r.m.status().tablet).toMatchObject({ name: "WACOM Tablet" })
    r.m.inject([hover(30, 0, 1), hover(31, 1, 0)], "inject-tablet")
    const p = r.batches.flatMap((b) => b.samples)
    expect([p[0]!.x, p[0]!.y]).toEqual([1, 0])
    expect([p[1]!.x, p[1]!.y]).toEqual([0, 1])
  })
})

describe("pen-state.json", () => {
  it("is read tolerantly", () => {
    expect(parseState("not json").settings.enabled).toBe(true)
    const s = parseState(JSON.stringify({
      settings: { enabled: false, junk: 1 },
      frames: { k: { frame: { turn: 2, flipY: true } }, c: { frame: { turn: 1, flipY: false }, source: "calibrated" }, bad: { frame: { turn: 9 } } },
      mapping: { a: "honoured", b: "refused", c: "maybe" },
    }))
    expect("frames" in s).toBe(false) // an old file's stored calibrations are ignored
    expect(s.mapping).toEqual({ a: "honoured", b: "refused" })
  })
})

describe("the pen state file", () => {
  it("maps the tablet by default, and ignores an old (version 2) file's off, which was the old default", async () => {
    const { parseState } = await import("../src/main/pen/state")
    expect(parseState(null).settings.mapSheet).toBe(true)
    expect(parseState(JSON.stringify({ version: 2, settings: { mapSheet: false } })).settings.mapSheet).toBe(true)
    expect(parseState(JSON.stringify({ version: 3, settings: { mapSheet: false } })).settings.mapSheet).toBe(false)
  })
})
