// main/pen/wintabBackend.ts over a FAKE Wintab (no dll, no tablet, no timers): the start sequence and its failure reasons, the lease and the
// fail-closed system context, the packet mask ladder, the packet-size mismatch and the canary break, proximity in range / out of range,
// button and eraser mapping, the system rectangle (open-new-then-close-old), and "every handle released in stop()".
import { describe, expect, it } from "vitest"
import { LIVENESS, type BackendContext, type Box } from "../../src/shared/pen"
import { isSystemMapped } from "../../src/main/pen/types"
import {
  BTN, LOGCONTEXT_SIZE, MASK_FULL, MASK_LADDER, MASK_MIN, MASK_TINY, PK, TPS, WT_DEFBASE, WT_MSG, emptyPacket, packetSize, parseLogContext,
  type LogContext, type RawPacket, type WintabDevice,
} from "../../src/main/pen/wintab"
import { PacketSizeMismatch, type OpenOptions, type OpenResult, type WintabNative, type WintabSessionLike } from "../../src/main/pen/wintabNative"
import { createWintabBackendWith, WintabBackend, WintabSystemBackend } from "../../src/main/pen/wintabBackend"
import { FfiOverrun } from "../../src/main/pen/win32"
import type { PenPaths } from "../../src/main/pen/types"
import { Collector, harness, type Harness } from "./backendKit"

let pathCounter = 0
const paths = (): PenPaths => {
  const n = ++pathCounter
  return { userData: "x", state: "x", trace: "x", wintabJournal: `journal-${n}.json`, leases: "x" }
}

const axis = (max: number) => ({ min: 0, max, units: 0, resolution: 0 })
const seanDevice = (): WintabDevice => ({
  name: "WACOM Tablet", x: axis(9499), y: axis(15199), pressure: axis(32767),
  orientation: [axis(0), axis(0), axis(0)], pktRate: 100, pktData: MASK_FULL,
  cursors: [
    { index: 1, name: "Pressure Stylus", buttons: 3, capabilities: 1, type: 0x4000, isEraser: false },
    { index: 2, name: "Eraser", buttons: 1, capabilities: 5, type: 0xc000, isEraser: true },
    { index: 4, name: "Pressure Stylus", buttons: 3, capabilities: 1, type: 0x4000, isEraser: false },
    { index: 5, name: "Eraser", buttons: 1, capabilities: 5, type: 0xc000, isEraser: true },
  ],
})

class FakeSession implements WintabSessionLike {
  isOpen = true
  closeCalls = 0
  /** Each poll() call takes the next entry: packets, or an Error to throw. */
  script: (RawPacket[] | Error)[] = []
  constructor(readonly handle: bigint, readonly mask: number, readonly context: LogContext, readonly options: OpenOptions) {}
  poll(): RawPacket[] {
    const next = this.script.shift()
    if (next instanceof Error) throw next
    return next ?? []
  }
  close(): void { this.closeCalls++; this.isOpen = false }
  push(...batches: (RawPacket[] | Error)[]): void { this.script.push(...batches) }
}

class FakeNative implements WintabNative {
  availability: { ok: true } | { ok: false; reason: string } = { ok: true }
  iface = { vendor: "WACOM", specVersion: "1.4", implVersion: "1.0", devices: 1, cursors: 6, maxContexts: 32 }
  device = seanDevice()
  sessions: FakeSession[] = []
  nextHandle = 100n
  openError: string | null = null
  openThrows: Error | null = null
  storedMask: ((asked: number) => number) | null = null
  recoverCalls: string[] = []
  highRes: boolean[] = []
  windows: { onMessage: (m: number, wp: bigint, lp: bigint) => void; destroyed: boolean }[] = []
  windowThrows = false
  order: string[] = []

  available() { return this.availability }
  readInterface() { return this.iface }
  readDevice() { return this.device }
  recoverStale(p: string): number { this.recoverCalls.push(p); return 0 }
  contextCounts() { return { contexts: this.sessions.filter((s) => s.isOpen).length, system: 0 } }
  highResTimer(on: boolean): void { this.highRes.push(on) }
  createWindow(onMessage: (m: number, wp: bigint, lp: bigint) => void) {
    if (this.windowThrows) throw new Error("CreateWindowExW failed (GetLastError 5)")
    const w = { onMessage, destroyed: false }
    this.windows.push(w)
    return { hwnd: 77n, destroy: () => { w.destroyed = true } }
  }
  open(o: OpenOptions): OpenResult {
    if (this.openThrows) throw this.openThrows
    if (this.openError) return { session: null, error: this.openError, context: null }
    const ctx = parseLogContext(new Uint8Array(LOGCONTEXT_SIZE))
    const asked = o.packetMask ?? MASK_FULL
    ctx.name = `WriteMind pen ${process.pid}`
    ctx.inOrg = [0, 0, 0]
    ctx.inExt = [9500, 15200, 0]
    ctx.pktData = this.storedMask ? this.storedMask(asked) : asked
    if (o.sysRect) { ctx.sysOrg = [Math.round(o.sysRect.x), Math.round(o.sysRect.y)]; ctx.sysExt = [Math.round(o.sysRect.width), Math.round(o.sysRect.height)] }
    const s = new FakeSession(this.nextHandle++, ctx.pktData, ctx, o)
    this.sessions.push(s)
    this.order.push(`open ${s.handle}`)
    const origClose = s.close.bind(s)
    s.close = () => { this.order.push(`close ${s.handle}`); origClose() }
    return { session: s, error: null, context: ctx, ...(ctx.pktData !== asked ? { maskChanged: { asked, stored: ctx.pktData } } : {}) }
  }
  get open_(): FakeSession[] { return this.sessions.filter((s) => s.isOpen) }
  wm(offset: number, lParam = 0n): void { for (const w of this.windows) if (!w.destroyed) w.onMessage(WT_DEFBASE + offset, 0n, lParam) }
}

/** A polling harness: no timers run by themselves; `tick()` is one poll and `settle()` runs the batching clock. */
interface Rig {
  h: Harness
  native: FakeNative
  b: WintabBackend
  out: Collector
  immediates: (() => void)[]
  timers: { ms: number; fn: () => void }[]
  start(over?: { sheetPhysical?: Box | null }): ReturnType<WintabBackend["start"]>
  tick(ms?: number): void
  flush(): void
}

function rig(mode: "data" | "system" = "data", setup?: (n: FakeNative) => void): Rig {
  const h = harness()
  const native = new FakeNative()
  setup?.(native)
  const immediates: (() => void)[] = []
  const timers: { ms: number; fn: () => void }[] = []
  const b = createWintabBackendWith(mode, paths(), {
    native,
    schedule: h.clock.schedule, cancel: h.clock.cancel,
    setTimer: (fn, ms) => { const t = { ms, fn }; timers.push(t); return t },
    clearTimer: (hd) => { const i = timers.indexOf(hd as { ms: number; fn: () => void }); if (i >= 0) timers.splice(i, 1) },
    setImmediate: (fn) => { immediates.push(fn) },
  })
  const out = new Collector(b)
  const r: Rig = {
    h, native, b, out, immediates, timers,
    start: (over) => b.start(h.ctx(over)),
    tick: (ms = 4) => { h.clock.advance(ms); b.pollTick(false) },
    flush: () => h.clock.advance(LIVENESS.BATCH_MS),
  }
  return r
}

const pk = (over: Partial<RawPacket>): RawPacket => ({ ...emptyPacket(), cursor: 1, ...over })
/** A hovering / touching packet for MASK_FULL at portrait raw coordinates. */
const move = (i: number, over: Partial<RawPacket> = {}): RawPacket => pk({ time: 1000 + i * 10, x: 1000 + i * 100, y: 2000 + i * 100, ...over })
const press = (i: number, p = 16000): RawPacket => move(i, { buttons: BTN.TIP, pressure: p })

describe("start: what it says when it cannot", () => {
  it("unavailable (no dll / not Windows / E2E) -> retry never, state unavailable, nothing opened", async () => {
    const r = rig("data", (n) => { n.availability = { ok: false, reason: "wintab32.dll not found: the Wacom driver is not installed" } })
    expect(r.b.available()).toEqual({ ok: false, reason: "wintab32.dll not found: the Wacom driver is not installed" })
    expect(await r.start()).toEqual({ ok: false, reason: "wintab32.dll not found: the Wacom driver is not installed", retry: "never" })
    expect(r.b.status().state).toBe("unavailable")
    expect(r.native.sessions).toHaveLength(0)
    expect(r.native.windows).toHaveLength(0)
  })
  it("WTInfo reporting 0 tablets -> retry after a re-plug, with the plain reason", async () => {
    const r = rig("data", (n) => { n.iface.devices = 0 })
    const res = await r.start()
    expect(res).toEqual({ ok: false, reason: "Wintab reports 0 tablets: Windows or the Wacom service says the tablet is not working", retry: "after-replug" })
    expect(r.b.status()).toMatchObject({ state: "failed", reason: res.ok ? null : res.reason })
    expect(r.native.sessions).toHaveLength(0)
  })
  it("WTOpen failing -> later, with the error, and the window is destroyed again", async () => {
    const r = rig("data", (n) => { n.openError = "WTOpenW failed (GetLastError 1400)" })
    expect(await r.start()).toEqual({ ok: false, reason: "WTOpenW failed (GetLastError 1400)", retry: "later" })
    expect(r.native.windows.every((w) => w.destroyed)).toBe(true)
    expect(r.native.highRes).toEqual([]) // never asked for the 1 ms timer
  })
  it("a native layer that THROWS during open is a failed start, not a crash", async () => {
    const r = rig("data", (n) => { n.openThrows = new Error("koffi: bad pointer") })
    const res = await r.start()
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toMatch(/WTOpen failed: koffi: bad pointer/)
    expect(r.native.windows.every((w) => w.destroyed)).toBe(true)
  })
  it("a window that cannot be created is a failed start (later)", async () => {
    const r = rig("data", (n) => { n.windowThrows = true })
    const res = await r.start()
    expect(res).toMatchObject({ ok: false, retry: "later" })
    expect(res.ok === false && res.reason).toMatch(/message window.*CreateWindowExW/)
  })
  it("a fault in the very first step is caught (recoverStale throws): start still proceeds", async () => {
    const r = rig("data", (n) => { n.recoverStale = () => { throw new Error("journal unreadable") } })
    expect((await r.start()).ok).toBe(true)
    expect(r.h.trace.named("recover-failed")).toHaveLength(1)
  })
})

describe("start: the data context", () => {
  it("opens ONE context with the first mask, registers it with the guard, asks for the 1 ms timer, reports the device", async () => {
    const r = rig()
    const res = await r.start()
    expect(res.ok).toBe(true)
    expect(r.native.sessions).toHaveLength(1)
    const s = r.native.sessions[0]!
    expect(s.options).toMatchObject({ hwnd: 77n, mode: "data", packetMask: MASK_FULL })
    expect(s.options.sysRect).toBeUndefined()
    expect(r.h.lease.held).toEqual([{ handle: s.handle.toString(), mode: "data" }])
    expect(r.native.highRes).toEqual([true])
    expect(r.b.status().state).toBe("armed")
    expect(r.b.name).toBe("wintab-data")
    expect(r.b.frameKind).toBe("device")
    expect(res.ok && res.device).toMatchObject({
      name: "WACOM Tablet", rawX: [0, 9499], rawY: [0, 15199], pressureMax: 32767,
      claims: { pressure: true, tilt: false, lower: true, upper: true, eraser: true },
    })
    expect((res.ok && res.device?.aspect) || 0).toBeCloseTo(1.6, 2)
  })
  it("stale-context recovery runs once per journal, not on every start", async () => {
    const p = paths()
    const h = harness()
    const n1 = new FakeNative()
    const a = createWintabBackendWith("data", p, { native: n1, schedule: h.clock.schedule, cancel: h.clock.cancel, setTimer: () => null, setImmediate: () => {} })
    await a.start(h.ctx())
    a.stop()
    const n2 = new FakeNative()
    const b = createWintabBackendWith("data", p, { native: n2, schedule: h.clock.schedule, cancel: h.clock.cancel, setTimer: () => null, setImmediate: () => {} })
    await b.start(h.ctx())
    b.stop()
    expect(n1.recoverCalls).toEqual([p.wintabJournal])
    expect(n2.recoverCalls).toEqual([])
  })
  it("a guard that refuses a DATA context is not fatal (the journal covers it)", async () => {
    const r = rig()
    r.h.lease.isReady = false
    expect((await r.start()).ok).toBe(true)
    expect(r.b.status().facts.contextState).toBe("open (journal only)")
  })
  it("traces the layout (device, interface) and the stored context", async () => {
    const r = rig()
    await r.start()
    expect(r.h.trace.named("layout")[0]!.data).toMatchObject({ dev: { name: "WACOM Tablet" }, interface: { devices: 1 } })
    expect(r.h.trace.named("context-opened")[0]!.data).toMatchObject({ mode: "data", mask: "0x" + MASK_FULL.toString(16), packetSize: 48, leaseHeld: true })
  })
  it("facts: interface, extents, cursors, mask, packet size", async () => {
    const r = rig()
    await r.start()
    const f = r.b.status().facts
    expect(f).toMatchObject({ interface: "WACOM spec 1.4 impl 1.0", devices: 1, x: "0..9499", y: "0..15199", pressureMax: 32767, packetSize: 48, ladder: 0 })
    expect(String(f.cursors)).toMatch(/1:Pressure Stylus b3/)
  })
  it("start is idempotent: a second call returns the same answer and opens nothing more", async () => {
    const r = rig()
    const a = r.start()
    const b = r.start()
    expect(await a).toEqual(await b)
    expect(r.native.sessions).toHaveLength(1)
  })
  it("the driver storing another (usable) mask is followed, with a trace note", async () => {
    const r = rig("data", (n) => { n.storedMask = () => MASK_MIN })
    await r.start()
    expect(r.native.sessions[0]!.mask).toBe(MASK_MIN)
    expect(r.h.trace.named("mask-changed")[0]!.data).toMatchObject({ asked: "0x" + MASK_FULL.toString(16), stored: "0x" + MASK_MIN.toString(16) })
    expect(r.b.status().facts.packetSize).toBe(packetSize(MASK_MIN))
  })
})

describe("samples: decoding, buttons, the eraser, the device frame", () => {
  it("hover then contact: normalised over the input rectangle, y NOT flipped, pressure scaled, the tip from the button", async () => {
    const r = rig()
    await r.start()
    const s = r.native.sessions[0]!
    s.push([move(0, { x: 4750, y: 7600 }), press(1, 16383)])
    r.tick(); r.flush()
    expect(r.out.samples).toHaveLength(2)
    expect(r.out.samples[0]).toMatchObject({ x: 0.5, y: 0.5, p: 0, tip: false, inRange: true, backend: "wintab" })
    expect(r.out.samples[1]!.p).toBeCloseTo(0.5, 3)
    expect(r.out.samples[1]).toMatchObject({ tip: true })
    expect(r.out.samples[1]!.y).toBeCloseTo(2100 / 15200, 6)
  })
  it("lower = the first side button, upper = the second, neither swapped here (swapButtons is the manager's)", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([move(0), move(1, { buttons: BTN.LOWER }), move(2, { buttons: BTN.UPPER }), move(3, { buttons: BTN.LOWER | BTN.UPPER })])
    r.tick(); r.flush()
    expect(r.out.samples.map((x) => [x.lower, x.upper])).toEqual([[false, false], [true, false], [false, true], [true, true]])
  })
  it("the eraser cursors (2 and 5) set eraser; Sean's pen (cursors 1 and 4) never does", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([move(0, { cursor: 1 }), move(1, { cursor: 4 }), move(2, { cursor: 2 }), move(3, { cursor: 5 })])
    r.tick(); r.flush()
    expect(r.out.samples.map((x) => x.eraser)).toEqual([false, false, true, true])
  })
  it("samples reach the listener in batches of at most BATCH_MS and never empty", async () => {
    const r = rig()
    await r.start()
    const s = r.native.sessions[0]!
    s.push([move(0)]); r.tick(2)
    s.push([move(1)]); r.tick(2)
    expect(r.out.batches).toHaveLength(0)
    r.flush()
    expect(r.out.batches.map((b) => b.length)).toEqual([2])
  })
  it("counters, rate and reach follow the packets; the first packets are traced as hex with the mask", async () => {
    const r = rig()
    await r.start()
    const s = r.native.sessions[0]!
    for (let i = 0; i < 10; i++) { s.push([move(i)]); r.tick(10) }
    r.flush()
    const st = r.b.status()
    expect(st.counters.raw).toBe(10)
    expect(st.counters.samples).toBe(10)
    expect(st.seen.moved).toBe(true)
    expect(st.reach).not.toBeNull()
    expect(r.h.trace.raws).toHaveLength(10)
    expect(r.h.trace.raws[0]).toMatchObject({ backend: "wintab-data", note: "mask 0x" + MASK_FULL.toString(16) })
    expect(r.h.trace.raws[0]!.hex).toHaveLength(48 * 2)
  })
  it("liveness becomes 'live' after 4 moving in-range samples (the local rule of BackendCore)", async () => {
    const r = rig()
    await r.start()
    const s = r.native.sessions[0]!
    s.push([0, 1, 2, 3, 4].map((i) => move(i)))
    r.tick(10)
    expect(r.b.status().state).toBe("live")
  })
  it("reports tilt only when the device has orientation axes", async () => {
    const tilt = rig("data", (n) => { n.device = { ...seanDevice(), orientation: [axis(3600), axis(900), axis(3600)] } })
    await tilt.start()
    tilt.native.sessions[0]!.push([move(0, { azimuth: 0, altitude: 450 })])
    tilt.tick(); tilt.flush()
    expect(tilt.out.samples[0]!.tiltX).toBeCloseTo(45, 0)
    const plain = rig()
    await plain.start()
    plain.native.sessions[0]!.push([move(0, { azimuth: 0, altitude: 450 })])
    plain.tick(); plain.flush()
    expect(plain.out.samples[0]!.tiltX).toBeUndefined()
  })
  it("the driver's clock is mapped onto ours: a batch keeps its spacing", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([move(0), move(1), move(2)])
    r.tick(); r.flush()
    const t = r.out.samples.map((x) => x.t)
    expect(t[1]! - t[0]!).toBe(10)
    expect(t[2]! - t[1]!).toBe(10)
  })
})

describe("in range and out of range", () => {
  it("one leave sample per visit, at the last place, after LEAVE_HOVER_MS of silence while hovering", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([move(0), move(1)])
    r.tick(); r.flush()
    expect(r.out.proximity()).toEqual([true])
    r.tick(LIVENESS.LEAVE_HOVER_MS - 10); r.flush()
    expect(r.out.samples).toHaveLength(2)
    r.tick(20); r.flush()
    const last = r.out.samples[r.out.samples.length - 1]!
    expect(last).toMatchObject({ inRange: false, tip: false, p: 0 })
    expect(last.x).toBeCloseTo(r.out.samples[1]!.x, 9)
    expect(r.out.samples.filter((x) => !x.inRange)).toHaveLength(1)
    expect(r.out.proximity()).toEqual([true, false])
    r.tick(5000); r.flush()
    expect(r.out.samples.filter((x) => !x.inRange)).toHaveLength(1) // not twice
  })
  it("a still pen in contact is held for LEAVE_CONTACT_MS", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([press(0), press(1)])
    r.tick(); r.flush()
    r.tick(LIVENESS.LEAVE_HOVER_MS + 100); r.flush()
    expect(r.out.samples.filter((x) => !x.inRange)).toHaveLength(0)
    r.tick(LIVENESS.LEAVE_CONTACT_MS); r.flush()
    expect(r.out.samples.filter((x) => !x.inRange)).toHaveLength(1)
  })
  it("WT_PROXIMITY out ends the visit at once; WT_PROXIMITY in switches the timeouts to the long safety net", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([move(0), move(1)])
    r.tick()
    r.native.wm(WT_MSG.PROXIMITY, 0x0001_0001n) // entered
    r.tick(LIVENESS.LEAVE_HOVER_MS + 400); r.flush()
    expect(r.out.samples.filter((x) => !x.inRange)).toHaveLength(0) // authoritative: not lifted by the ordinary timeout
    r.native.wm(WT_MSG.PROXIMITY, 0n) // left
    r.tick(1); r.flush()
    expect(r.out.samples.filter((x) => !x.inRange)).toHaveLength(1)
  })
  it("window messages only forward numbers: nothing is processed until the poll", async () => {
    const r = rig()
    await r.start()
    r.native.wm(WT_MSG.PACKET)
    r.native.wm(WT_MSG.PROXIMITY, 0n)
    expect(r.out.samples).toHaveLength(0)
    expect(r.immediates.length).toBeGreaterThan(0) // a kick was queued, not run
    r.tick()
    expect(r.b.status().facts.messages).toBe(2)
  })
  it("a message outside the Wintab range is ignored", async () => {
    const r = rig()
    await r.start()
    r.native.windows[0]!.onMessage(0x0100, 0n, 0n)
    r.tick()
    expect(r.b.status().facts.messages).toBe(0)
  })
  it("the polarity of TPS_PROXIMITY is learned from the data, and a flip is traced", async () => {
    const r = rig()
    await r.start()
    const s = r.native.sessions[0]!
    // a driver that sets the bit while the pen is IN: every contact packet carries it
    s.push(Array.from({ length: 20 }, (_, i) => ({ ...press(i, 1000), status: TPS.PROXIMITY })))
    r.tick(); r.flush()
    expect(r.h.trace.named("prox-polarity-flipped")).toHaveLength(1)
    expect(r.b.status().facts.polarity).toBe("flipped")
    expect(r.out.samples.every((x) => x.inRange)).toBe(true)
  })
  it("the bit seen in BOTH states makes the proximity signal live (authoritative)", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([move(0), move(1, { status: TPS.PROXIMITY })])
    r.tick(); r.flush()
    expect(r.b.status().facts.proximityLive).toBe(true)
  })
})

describe("the packet mask ladder (the layout has never met a real packet)", () => {
  /** Packets that look like a scrambled layout: positions far outside the rectangle. */
  const junk = (i: number): RawPacket => move(i, { x: 3_000_000 + i, pressure: 4_000_000_000 })

  it("an implausible first 20 packets reopen the context with the next mask; the old one is closed AFTER the new one is open", async () => {
    const r = rig()
    await r.start()
    const first = r.native.sessions[0]!
    first.push(Array.from({ length: 20 }, (_, i) => junk(i)))
    r.tick(); r.flush()
    expect(r.native.sessions).toHaveLength(2)
    expect(r.native.sessions[1]!.options.packetMask).toBe(MASK_MIN)
    expect(r.native.order).toEqual([`open 100`, `open 101`, `close 100`])
    expect(first.isOpen).toBe(false)
    expect(r.h.lease.dropped).toEqual(["100"])
    expect(r.h.lease.held.map((h) => h.handle)).toEqual(["100", "101"])
    expect(r.h.trace.named("mask-fallback")[0]!.data).toMatchObject({ from: "0x" + MASK_FULL.toString(16), to: "0x" + MASK_MIN.toString(16) })
    expect(r.out.samples).toHaveLength(0) // nothing implausible leaves
    expect(r.b.status().facts.ladder).toBe(1)
  })
  it("the new mask decodes: samples flow again", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push(Array.from({ length: 20 }, (_, i) => junk(i)))
    r.tick()
    r.native.sessions[1]!.push([move(0, { x: 4750, y: 7600 })])
    r.tick(10); r.flush()
    expect(r.out.samples[0]).toMatchObject({ x: 0.5, y: 0.5 })
  })
  it("a plausible stream stays on the first mask", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push(Array.from({ length: 25 }, (_, i) => move(i)))
    r.tick(); r.flush()
    expect(r.native.sessions).toHaveLength(1)
    expect(r.h.trace.named("mask-fallback")).toHaveLength(0)
  })
  it("nothing fits: a fatal error that says why, everything closed, state failed", async () => {
    const r = rig()
    await r.start()
    for (let step = 0; step < MASK_LADDER.length; step++) {
      r.native.sessions[step]?.push(Array.from({ length: 20 }, (_, i) => junk(i)))
      r.tick()
    }
    const err = r.out.errors().find((e) => e.fatal)
    expect(err?.message).toMatch(/no packet mask decodes: 20 of 20 packets are implausible for mask 0x/)
    expect(r.b.status().state).toBe("failed")
    expect(r.native.open_).toHaveLength(0)
    expect(r.native.windows.every((w) => w.destroyed)).toBe(true)
    expect(r.native.highRes).toEqual([true, false])
  })
  it("a first packet BIGGER than the computed size (PacketSizeMismatch) moves down the ladder too", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push(new PacketSizeMismatch(MASK_FULL, 48, 52))
    r.tick()
    expect(r.native.sessions).toHaveLength(2)
    expect(r.h.trace.named("mask-fallback")[0]!.data).toMatchObject({ why: expect.stringMatching(/expected 48 bytes a packet.*wrote at least 52/) })
  })
  it("a mismatch on every rung is fatal and names both sizes", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push(new PacketSizeMismatch(MASK_FULL, packetSize(MASK_FULL), packetSize(MASK_FULL) + 4))
    r.tick()
    r.native.sessions[1]!.push(new PacketSizeMismatch(MASK_MIN, packetSize(MASK_MIN), packetSize(MASK_MIN) + 4))
    r.tick()
    r.native.sessions[2]!.push(new PacketSizeMismatch(MASK_TINY, packetSize(MASK_TINY), packetSize(MASK_TINY) + 4))
    r.tick()
    const fatal = r.out.errors().find((e) => e.fatal)
    expect(fatal?.message).toMatch(/expected 12 bytes a packet \(mask 0x[0-9a-f]+\), the driver wrote at least 16/)
    expect(r.b.status().state).toBe("failed")
    expect(r.native.open_).toHaveLength(0)
  })
  it("a canary break in WTPacketsGet is fatal at once: no further ladder, everything released", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push(new FfiOverrun("WTPacketsGet", 12288, 12300))
    r.tick()
    const fatal = r.out.errors().find((e) => e.fatal)
    expect(fatal?.message).toBe("buffer overrun in WTPacketsGet: expected 12288 bytes, the driver wrote at least 12300")
    expect(r.native.sessions).toHaveLength(1)
    expect(r.native.open_).toHaveLength(0)
    expect(r.b.status()).toMatchObject({ state: "failed", reason: fatal?.message })
  })
})

describe("the system context: fail closed, mapped to the sheet", () => {
  const SHEET: Box = { x: 1100, y: 200, width: 700, height: 700 }

  it("is a SystemMapped backend; the data one is not (isSystemMapped tells them apart)", () => {
    expect(isSystemMapped(rig("system").b)).toBe(true)
    expect(isSystemMapped(rig("data").b)).toBe(false)
    expect(rig("system").b).toBeInstanceOf(WintabSystemBackend)
    expect(rig("system").b.name).toBe("wintab-system")
  })
  it("no ready guard -> refuses before opening anything", async () => {
    const r = rig("system")
    r.h.lease.isReady = false
    expect(await r.start({ sheetPhysical: SHEET })).toEqual({ ok: false, reason: "guard not ready: refusing a system context", retry: "later" })
    expect(r.native.sessions).toHaveLength(0)
    expect(r.native.windows).toHaveLength(0)
  })
  it("a guard that says ready but REFUSES the handle -> the context is closed again at once", async () => {
    const r = rig("system")
    r.h.lease.accept = false
    const res = await r.start({ sheetPhysical: SHEET })
    expect(res).toMatchObject({ ok: false, reason: "guard not ready: refusing a system context" })
    expect(r.native.sessions).toHaveLength(1)
    expect(r.native.sessions[0]!.isOpen).toBe(false)
    expect(r.native.windows.every((w) => w.destroyed)).toBe(true)
  })
  it("with the sheet known at start: opens a system context over the sheet rectangle, registered as 'system'", async () => {
    const r = rig("system")
    expect((await r.start({ sheetPhysical: SHEET })).ok).toBe(true)
    const s = r.native.sessions[0]!
    expect(s.options).toMatchObject({ mode: "system", sysRect: SHEET })
    expect(r.h.lease.held).toEqual([{ handle: "100", mode: "system" }])
    expect(r.b.status().facts.sysRect).toBe("1100,200 700x700")
  })
  it("with no sheet at start: armed with NO context (the pointer stays the driver's) until a rectangle arrives", async () => {
    const r = rig("system")
    expect((await r.start()).ok).toBe(true)
    expect(r.native.sessions).toHaveLength(0)
    expect(r.b.status().facts.contextState).toBe("waiting for the sheet")
    ;(r.b as WintabSystemBackend).setSheetPhysical(SHEET)
    expect(r.native.sessions).toHaveLength(0) // debounced 150 ms
    expect(r.timers.some((t) => t.ms === 150)).toBe(true)
    r.timers.find((t) => t.ms === 150)!.fn()
    expect(r.native.sessions).toHaveLength(1)
    expect(r.native.sessions[0]!.options.sysRect).toEqual(SHEET)
  })
  it("a new rectangle opens the NEW context first, then closes the old one", async () => {
    const r = rig("system")
    await r.start({ sheetPhysical: SHEET })
    const sys = r.b as WintabSystemBackend
    sys.setSheetPhysical({ x: 900, y: 100, width: 800, height: 800 })
    r.timers.find((t) => t.ms === 150)!.fn()
    expect(r.native.order).toEqual(["open 100", "open 101", "close 100"])
    expect(r.h.lease.dropped).toEqual(["100"])
    expect(r.native.open_.map((s) => s.handle)).toEqual([101n])
  })
  it("changes under 2 px are ignored; rapid changes collapse into the last one", async () => {
    const r = rig("system")
    await r.start({ sheetPhysical: SHEET })
    const sys = r.b as WintabSystemBackend
    sys.setSheetPhysical({ ...SHEET, x: SHEET.x + 1, width: SHEET.width + 1 })
    expect(r.timers.filter((t) => t.ms === 150)).toHaveLength(0)
    sys.setSheetPhysical({ x: 1000, y: 200, width: 700, height: 700 })
    sys.setSheetPhysical({ x: 1050, y: 200, width: 700, height: 700 })
    expect(r.timers.filter((t) => t.ms === 150)).toHaveLength(1)
    r.timers.find((t) => t.ms === 150)!.fn()
    expect(r.native.sessions).toHaveLength(2)
    expect(r.native.sessions[1]!.options.sysRect).toEqual({ x: 1050, y: 200, width: 700, height: 700 })
  })
  it("null closes the context (the pointer is the driver's again) and tells the guard", async () => {
    const r = rig("system")
    await r.start({ sheetPhysical: SHEET })
    ;(r.b as WintabSystemBackend).setSheetPhysical(null)
    expect(r.native.open_).toHaveLength(0)
    expect(r.h.lease.dropped).toEqual(["100"])
    expect(r.b.status().facts.contextState).toMatch(/closed/)
    expect(r.b.status().state).toBe("armed")
  })
  it("stop() cancels a pending rectangle and closes the context; setSheetPhysical after stop does nothing", async () => {
    const r = rig("system")
    await r.start({ sheetPhysical: SHEET })
    const sys = r.b as WintabSystemBackend
    sys.setSheetPhysical({ x: 5, y: 5, width: 800, height: 800 })
    r.b.stop()
    expect(r.timers.filter((t) => t.ms === 150)).toHaveLength(0)
    expect(r.native.open_).toHaveLength(0)
    sys.setSheetPhysical({ x: 9, y: 9, width: 500, height: 500 })
    expect(r.native.sessions).toHaveLength(1)
  })
})

describe("polling cadence", () => {
  it("4 ms while a pen is near and for 2 s after, 33 ms idle (the poll reschedules itself)", async () => {
    const r = rig()
    await r.start()
    expect(r.timers.map((t) => t.ms)).toEqual([4]) // armed: the first poll is scheduled hot
    r.native.sessions[0]!.push([move(0)])
    r.timers[0]!.fn()
    expect(r.timers.at(-1)!.ms).toBe(4)
    r.h.clock.advance(2500)
    r.timers.at(-1)!.fn()
    r.h.clock.advance(1)
    expect(r.timers.at(-1)!.ms).toBe(33)
  })
  it("a poll that throws is traced as an error and the loop goes on", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push(new Error("driver hiccup"))
    expect(() => r.tick()).not.toThrow()
    expect(r.b.status().counters.errors).toBe(1)
    expect(r.out.errors()[0]).toMatchObject({ fatal: false })
    expect(r.b.status().state).toBe("armed")
  })
  it("a sample listener that throws never kills the poll loop", async () => {
    const r = rig()
    await r.start()
    r.b.onSample(() => { throw new Error("renderer feed bug") })
    r.native.sessions[0]!.push([move(0)])
    r.tick()
    expect(() => r.flush()).not.toThrow()
    r.native.sessions[0]!.push([move(1)])
    expect(() => { r.tick(); r.flush() }).not.toThrow()
    expect(r.b.status().counters.samples).toBe(2)
  })
})

describe("every handle is released", () => {
  it("stop() closes the context, drops it at the guard, gives the 1 ms timer back, destroys the window, clears the poll timer", async () => {
    const r = rig()
    await r.start()
    r.b.stop()
    expect(r.native.open_).toHaveLength(0)
    expect(r.h.lease.dropped).toEqual(["100"])
    expect(r.native.highRes).toEqual([true, false])
    expect(r.native.windows.every((w) => w.destroyed)).toBe(true)
    expect(r.timers).toHaveLength(0)
    expect(r.b.status().state).toBe("idle")
  })
  it("stop() is idempotent, safe before start, and safe after a failed start", async () => {
    const r = rig()
    expect(() => { r.b.stop(); r.b.stop() }).not.toThrow()
    const f = rig("data", (n) => { n.iface.devices = 0 })
    await f.start()
    expect(() => { f.b.stop(); f.b.stop() }).not.toThrow()
    expect(f.native.highRes).toEqual([])
  })
  it("stop() while start() is in flight leaves nothing open", async () => {
    const r = rig()
    const p = r.start()
    r.b.stop()
    const res = await p
    expect(res.ok).toBe(false)
    expect(r.native.open_).toHaveLength(0)
    expect(r.native.windows.every((w) => w.destroyed)).toBe(true)
  })
  it("a start after a stop works again, from a clean slate (counters reset)", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([move(0)]); r.tick()
    r.b.stop()
    expect((await r.start()).ok).toBe(true)
    expect(r.native.sessions).toHaveLength(2)
    expect(r.b.status().counters.raw).toBe(0)
  })
  it("WT_CTXCLOSE (the driver closed our context) is fatal: released, failed, with the reason", async () => {
    const r = rig()
    await r.start()
    r.native.wm(WT_MSG.CTXCLOSE)
    r.tick()
    expect(r.out.errors().find((e) => e.fatal)?.message).toBe("the driver closed our context (WT_CTXCLOSE)")
    expect(r.native.open_).toHaveLength(0)
    expect(r.b.status().state).toBe("failed")
  })
  it("a pen visit open at stop() is not left half-way (the manager ends the stroke; the tracker is reset)", async () => {
    const r = rig()
    await r.start()
    r.native.sessions[0]!.push([press(0)]); r.tick(); r.flush()
    r.b.stop()
    await r.start()
    r.native.sessions[1]!.push([move(0)]); r.tick(); r.flush()
    expect(r.out.proximity()).toEqual([true, true])
  })
})

describe("a real koffi-free sanity check of the pure pieces it leans on", () => {
  it("MASK_FULL carries PK_TIME, which the clock needs", () => {
    expect(MASK_FULL & PK.TIME).toBeTruthy()
  })
})

// keep the BackendContext type in the import list honest for readers
void (null as unknown as BackendContext)
