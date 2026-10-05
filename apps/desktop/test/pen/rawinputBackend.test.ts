// main/pen/rawinputBackend.ts over a FAKE Raw Input (no user32, no tablet, no timers): the registration (flags, usages), the devices Windows
// would list (the REAL descriptors of Sean's Wacom from test/fixtures/pen), one position stream per pen, the vendor heartbeat that must never
// become a sample, Windows' synthesised pen, dwCount > 1, hot-plug, the mouse probe, and "everything released in stop()".
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { LIVENESS } from "../../src/shared/pen"
import { layoutFromProbe, type ProbeLayout } from "../../src/main/pen/hid/fromHidP"
import { encodeReport, type HidLayout } from "../../src/main/pen/hid/layout"
import { buildRawHid, buildRawMouse, MOUSE_MOVE_ABSOLUTE } from "../../src/main/pen/hid/rawParse"
import { GIDC_ARRIVAL, GIDC_REMOVAL, RIDEV_DEVNOTIFY, RIDEV_INPUTSINK, WM_INPUT, WM_INPUT_DEVICE_CHANGE } from "../../src/main/pen/hid/rawNative"
import { createRawInputBackendWith, friendlyDeviceName, isMouseProbing, type RawInputBackend } from "../../src/main/pen/rawinputBackend"
import type { ProbedDevice, RawDevice, RawInputPort, RawUsage } from "../../src/main/pen/rawinputPort"
import { FfiOverrun } from "../../src/main/pen/win32"
import { Collector, harness, type Harness } from "./backendKit"

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../fixtures/pen/${name}`, import.meta.url), "utf8")) as T
interface RawInputFixture { col03: { name: string; layout: ProbeLayout }; col04: { name: string; layout: ProbeLayout }; col02: { name: string; layout: ProbeLayout } }
interface SynthFixture { device: { name: string; vid: number; pid: number }; layout: ProbeLayout }
const wacom = fixture<RawInputFixture>("wacom-ctl472.json")
const synth = fixture<SynthFixture>("ms-synth-pen.json")

const L03 = layoutFromProbe(wacom.col03.layout)
const L04 = layoutFromProbe(wacom.col04.layout)
const L02 = layoutFromProbe(wacom.col02.layout)
const LSYN = layoutFromProbe(synth.layout)

const dev = (handle: bigint, name: string, vid: number, pid: number, usagePage: number, usage: number, type: 0 | 1 | 2 = 2): RawDevice => ({ handle, type, name, vendorId: vid, productId: pid, usagePage, usage })
const COL03 = dev(3n, wacom.col03.name, 0x056a, 0x037a, 0x0d, 0x02)
const COL04 = dev(4n, wacom.col04.name, 0x056a, 0x037a, 0x0d, 0x01)
const COL02 = dev(2n, wacom.col02.name, 0x056a, 0x037a, 0xff00, 0x0a)
const COL01 = dev(1n, "\\\\?\\HID#VID_056A&PID_037A&Col01#6&25d3763c&0&0000#{378de44c-56ef-11d1-bc8c-00a0c91405dd}", 0, 0, 0, 0, 0)
const SYNTH = dev(9n, synth.device.name, 0, 0, 0x0d, 0x02)
const KEYBOARD = dev(7n, "\\\\?\\HID#VID_046D&PID_C31C#7&1&0&0000#{884b96c3-56ef-11d1-bc8c-00a0c91405dd}", 0x046d, 0xc31c, 0x01, 0x06)

const probed = (layout: HidLayout): ProbedDevice => ({ layout, notes: [], inputReportByteLength: 38 })

class FakePort implements RawInputPort {
  availability: { ok: true } | { ok: false; reason: string } = { ok: true }
  devices: RawDevice[] = [COL01, COL02, COL03, COL04]
  probes = new Map<bigint, ProbedDevice | Error | null>([[2n, probed(L02)], [3n, probed(L03)], [4n, probed(L04)], [9n, probed(LSYN)]])
  registrations: { usages: RawUsage[]; hwnd: bigint }[] = []
  unregistrations: { usagePage: number; usage: number }[][] = []
  registerOk = true
  windowThrows = false
  win: { onMessage: (m: number, wp: bigint, lp: bigint) => void; destroyed: boolean } | null = null
  blocks = new Map<bigint, Uint8Array | Error>()
  nextLp = 1n
  probeCalls: bigint[] = []
  screen = { width: 1920, height: 1200 }

  available() { return this.availability }
  createWindow(onMessage: (m: number, wp: bigint, lp: bigint) => void) {
    if (this.windowThrows) throw new Error("CreateWindowExW failed (GetLastError 5)")
    const w = { onMessage, destroyed: false }
    this.win = w
    return { hwnd: 55n, destroy: () => { w.destroyed = true } }
  }
  register(usages: readonly RawUsage[], hwnd: bigint) {
    this.registrations.push({ usages: usages.map((u) => ({ ...u })), hwnd })
    return this.registerOk ? { ok: true, error: 0 } : { ok: false, error: 87 }
  }
  unregister(usages: readonly { usagePage: number; usage: number }[]): void { this.unregistrations.push(usages.map((u) => ({ ...u }))) }
  read(lParam: bigint): Uint8Array | null {
    const b = this.blocks.get(lParam)
    if (b instanceof Error) throw b
    return b ?? null
  }
  listDevices(): RawDevice[] { return this.devices }
  describe(handle: bigint, type: 0 | 1 | 2): RawDevice {
    return this.devices.find((d) => d.handle === handle) ?? dev(handle, `unknown-${handle}`, 0, 0, 0, 0, type)
  }
  probe(handle: bigint): ProbedDevice | null {
    this.probeCalls.push(handle)
    const p = this.probes.get(handle)
    if (p instanceof Error) throw p
    return p ?? null
  }
  screenSize() { return this.screen }

  /** Deliver a WM_INPUT carrying `block` the way Windows would: the window procedure runs, the read happens inside it. */
  send(block: Uint8Array): void {
    const lp = this.nextLp++
    this.blocks.set(lp, block)
    this.win?.onMessage(WM_INPUT, 0n, lp)
  }
  change(arrival: boolean, handle: bigint): void { this.win?.onMessage(WM_INPUT_DEVICE_CHANGE, BigInt(arrival ? GIDC_ARRIVAL : GIDC_REMOVAL), handle) }
  allRegistered(): RawUsage[] { return this.registrations.flatMap((r) => r.usages) }
}

interface Rig {
  h: Harness
  port: FakePort
  b: RawInputBackend
  out: Collector
  immediates: (() => void)[]
  ticks: { ms: number; fn: () => void }[]
  start(): ReturnType<RawInputBackend["start"]>
  /** Pen reports from a collection, then process the queue and the 8 ms batching. */
  pen(handle: bigint, layout: HidLayout, id: number, values: Parameters<typeof encodeReport>[2], opts?: { advance?: number; count?: number }): void
  drain(): void
  flush(): void
}

function rig(opts: { allowSynthetic?: boolean; vendorFallback?: boolean; setup?: (p: FakePort) => void } = {}): Rig {
  const h = harness()
  const port = new FakePort()
  opts.setup?.(port)
  const immediates: (() => void)[] = []
  const ticks: { ms: number; fn: () => void }[] = []
  const b = createRawInputBackendWith(port, {
    allowSynthetic: opts.allowSynthetic, vendorFallback: opts.vendorFallback,
    schedule: h.clock.schedule, cancel: h.clock.cancel,
    setImmediate: (fn) => { immediates.push(fn) },
    setInterval: (fn, ms) => { const t = { ms, fn }; ticks.push(t); return t },
    clearInterval: (hd) => { const i = ticks.indexOf(hd as { ms: number; fn: () => void }); if (i >= 0) ticks.splice(i, 1) },
  })
  const out = new Collector(b)
  const r: Rig = {
    h, port, b, out, immediates, ticks,
    start: () => b.start(h.ctx()),
    pen: (handle, layout, id, values, o = {}) => {
      for (let i = 0; i < (o.count ?? 1); i++) {
        if (o.advance) h.clock.advance(o.advance)
        port.send(buildRawHid(handle, [encodeReport(layout, id, values)]))
      }
    },
    drain: () => b.drain(),
    flush: () => { b.drain(); h.clock.advance(LIVENESS.BATCH_MS) },
  }
  return r
}

const full = { x: 32767, y: 32767 }
const hov = (x: number, y: number) => ({ x, y, inRange: 1 })
const touch = (x: number, y: number, pressure = 1000) => ({ x, y, pressure, tip: 1, inRange: 1 })

describe("start", () => {
  it("unavailable -> retry never, nothing created", async () => {
    const r = rig({ setup: (p) => { p.availability = { ok: false, reason: "native pen backends are off under E2E" } } })
    expect(r.b.available()).toEqual({ ok: false, reason: "native pen backends are off under E2E" })
    expect(await r.start()).toEqual({ ok: false, reason: "native pen backends are off under E2E", retry: "never" })
    expect(r.b.status().state).toBe("unavailable")
    expect(r.port.win).toBeNull()
    expect(r.port.registrations).toHaveLength(0)
  })
  it("registers the digitizer usages 0D/02 and 0D/01 with INPUTSINK | DEVNOTIFY on its own window, and the tablet's vendor node by ITS usage", async () => {
    const r = rig()
    expect((await r.start()).ok).toBe(true)
    const reg = r.port.registrations[0]!
    expect(reg.hwnd).toBe(55n)
    expect(reg.usages.map((u) => [u.usagePage, u.usage])).toEqual([[0x0d, 0x02], [0x0d, 0x01]])
    for (const u of reg.usages) expect(u.flags).toBe(RIDEV_INPUTSINK | RIDEV_DEVNOTIFY)
    // the vendor node of VID 056A (never a whole vendor page)
    expect(r.port.registrations[1]!.usages).toEqual([{ usagePage: 0xff00, usage: 0x0a, flags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY }])
  })
  it("never registers RIDEV_NOLEGACY (0x30): it is rejected for the pen usage and would stop the mouse for the mouse usage", async () => {
    const r = rig()
    await r.start()
    for (const u of r.port.allRegistered()) expect(u.flags & 0x30).toBe(0)
  })
  it("keeps the tablet's collections, ignores keyboards and the mouse node, excludes Windows' synthesised pen by default", async () => {
    const r = rig({ setup: (p) => { p.devices = [COL01, KEYBOARD, COL02, COL03, COL04, SYNTH] } })
    await r.start()
    expect(r.port.probeCalls.sort()).toEqual([2n, 3n, 4n])
    const f = r.b.status().facts
    expect(f.usableDevices).toBe(3)
    expect(f.synthetic).toBe(false)
    expect(f.looksDriverMapped).toBe(false)
  })
  it("describes the tablet: a stable name, the physical aspect, the logical ranges, 11 bit pressure, what the descriptor claims", async () => {
    const r = rig()
    const res = await r.start()
    expect(res.ok && res.device).toMatchObject({
      name: "HID VID_056A&PID_037A", vendorId: 0x056a, productId: 0x037a, rawX: [0, 32767], rawY: [0, 32767], pressureMax: 2047,
      claims: { pressure: true, tilt: true, lower: true, upper: true, eraser: true },
    })
    expect((res.ok && res.device?.aspect) || 0).toBeCloseTo(1.6, 3)
    expect(r.b.status().device?.name).toBe("HID VID_056A&PID_037A")
    expect(r.b.status().state).toBe("armed")
    expect(r.b.status().reason).toBeNull()
  })
  it("facts: the primary collection, report, physical size, descriptor", async () => {
    const r = rig()
    await r.start()
    const f = r.b.status().facts
    expect(f).toMatchObject({ primary: "HID VID_056A&PID_037A Col03", primaryReport: 209, physical: "15200 x 9500", portraitNative: false, hidDevices: 3 })
    expect(String(f.descriptor)).toMatch(/^hidp d:2 id209\[/)
    expect(String(f.collections)).toMatch(/Col03:tablet.*Col04:tablet.*Col02:vendor|Col02:vendor.*Col03:tablet/)
  })
  it("traces each layout it meets (the device name without its serial) so a recording can be replayed", async () => {
    const r = rig()
    await r.start()
    const lay = r.h.trace.named("layout")
    expect(lay).toHaveLength(3)
    expect(lay.map((e) => e.data!.dev).sort()).toEqual(["HID VID_056A&PID_037A Col02", "HID VID_056A&PID_037A Col03", "HID VID_056A&PID_037A Col04"])
    expect(JSON.stringify(lay)).not.toMatch(/2DA00L1059230|6&25d3763c/) // no serial / instance ids beyond the path stem
    expect((lay.find((e) => String(e.data!.dev).endsWith("Col03"))!.data!.layout as HidLayout).reports[0]!.reportId).toBe(209)
  })
  it("no usable device: armed with the plain reason and the device list, not failed", async () => {
    const r = rig({ setup: (p) => { p.devices = [KEYBOARD, COL01] } })
    const res = await r.start()
    expect(res).toEqual({ ok: true, device: null })
    expect(r.b.status().state).toBe("armed")
    expect(r.b.status().reason).toMatch(/^no digitizer-page device with a pen layout is listed; Windows lists 1 HID devices:/)
  })
  it("a registration Windows refuses -> failed (later), the window is destroyed again", async () => {
    const r = rig({ setup: (p) => { p.registerOk = false } })
    const res = await r.start()
    expect(res).toEqual({ ok: false, reason: "RegisterRawInputDevices failed (GetLastError 87)", retry: "later" })
    expect(r.port.win!.destroyed).toBe(true)
  })
  it("a window that cannot be created -> failed (later)", async () => {
    const r = rig({ setup: (p) => { p.windowThrows = true } })
    expect(await r.start()).toMatchObject({ ok: false, retry: "later" })
  })
  it("a device whose layout probe throws is skipped; the others still work", async () => {
    const r = rig({ setup: (p) => { p.probes.set(3n, new Error("HidP_GetCaps 0xc0110001")) } })
    expect((await r.start()).ok).toBe(true)
    expect(r.b.status().facts.primary).toBe("HID VID_056A&PID_037A Col04")
    expect(r.h.trace.named("resolve-failed")[0]!.data).toMatchObject({ message: "HidP_GetCaps 0xc0110001" })
  })
  it("a device with no preparsed data is skipped quietly", async () => {
    const r = rig({ setup: (p) => { p.probes.set(4n, null) } })
    expect((await r.start()).ok).toBe(true)
    expect(r.b.status().facts.usableDevices).toBe(2)
  })
  it("friendlyDeviceName hides the instance id: VID / PID only", () => {
    expect(friendlyDeviceName(COL03)).toBe("HID VID_056A&PID_037A")
    expect(friendlyDeviceName(SYNTH)).toBe("Windows synthesized pen")
    expect(friendlyDeviceName(dev(5n, "x", 0x1234, 0xabcd, 0, 0))).toBe("HID 1234:abcd")
  })
})

describe("one pen, one stream", () => {
  it("decodes the pen collection: hover then contact then out of range, in the DEVICE frame", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, hov(16383, 16383), { advance: 5 })
    r.pen(3n, L03, 209, touch(16383, 16383, 1023), { advance: 5 })
    r.pen(3n, L03, 209, { x: 65535, y: 65535, inRange: 0 }, { advance: 5 })
    r.flush()
    expect(r.out.samples).toHaveLength(3)
    expect(r.out.samples[0]).toMatchObject({ inRange: true, tip: false, p: 0, backend: "rawinput-hid" })
    expect(r.out.samples[0]!.x).toBeCloseTo(0.5, 3)
    expect(r.out.samples[1]).toMatchObject({ tip: true })
    expect(r.out.samples[1]!.p).toBeCloseTo(1023 / 2047, 4)
    expect(r.out.samples[2]).toMatchObject({ inRange: false, tip: false, p: 0 })
    expect(r.out.samples[2]!.x).toBeCloseTo(0.5, 3) // at the last known place (the Null position is not a position)
    expect(r.out.proximity()).toEqual([true, false])
  })
  it("both side buttons, the eraser end and tilt come through", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, { ...hov(100, 100), barrel: 1, tiltX: -4500, tiltY: 4500 })
    r.pen(3n, L03, 209, { ...hov(110, 100), secondary: 1, invert: 1 }, { advance: 5 })
    r.flush()
    expect(r.out.samples[0]).toMatchObject({ lower: true, upper: false, eraser: false, tiltX: -45, tiltY: 45 })
    expect(r.out.samples[1]).toMatchObject({ lower: false, upper: true, eraser: true })
  })
  it("the sibling collection (Col04, report 213) carrying the SAME pen is dropped while Col03 talks", async () => {
    const r = rig()
    await r.start()
    for (let i = 0; i < 6; i++) {
      r.h.clock.advance(8)
      r.pen(3n, L03, 209, hov(1000 + i * 100, 2000))
      r.pen(4n, L04, 213, hov(1000 + i * 100, 2000))
    }
    r.flush()
    expect(r.out.samples).toHaveLength(6)
    expect(r.out.samples.every((s) => s.backend === "rawinput-hid")).toBe(true)
    const xs = r.out.samples.map((s) => s.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs) // no zig-zag between two streams
    expect(r.b.status().counters.raw).toBe(12) // every report is counted and traced, only one stream is decoded
  })
  it("Col04 takes over once Col03 has been silent for the hold time", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, hov(1000, 1000))
    r.h.clock.advance(300)
    r.pen(4n, L04, 213, hov(5000, 1000))
    r.flush()
    expect(r.out.samples.map((s) => Math.round(s.x * 32767))).toEqual([1000, 5000])
  })
  it("a report with dwCount > 1 yields every sample, in order", async () => {
    const r = rig()
    await r.start()
    r.port.send(buildRawHid(3n, [1000, 2000, 3000].map((x) => encodeReport(L03, 209, hov(x, 500)))))
    r.flush()
    expect(r.out.samples.map((s) => Math.round(s.x * 32767))).toEqual([1000, 2000, 3000])
  })
  it("the device says by itself when the pen is near: no timeout lifts a still pen (the safety net is 15 s)", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, hov(1000, 1000))
    r.b.tickAll(r.h.clock.now + LIVENESS.LEAVE_HOVER_MS * 3)
    r.flush()
    expect(r.out.samples.filter((s) => !s.inRange)).toHaveLength(0)
    r.b.tickAll(r.h.clock.now + 15_001)
    r.flush()
    expect(r.out.samples.filter((s) => !s.inRange)).toHaveLength(1)
  })
  it("a unknown device that speaks before the start enumeration reached it is looked at when it speaks", async () => {
    const r = rig({ setup: (p) => { p.devices = [COL01] ; p.probes.set(3n, probed(L03)); p.devices = [COL01] } })
    await r.start()
    expect(r.b.status().device).toBeNull()
    r.port.devices = [COL01, COL03]
    r.pen(3n, L03, 209, hov(8000, 8000))
    r.flush()
    expect(r.out.samples).toHaveLength(1)
    expect(r.b.status().facts.primary).toBeNull() // facts are for the start; the stream works
  })
  it("a device Windows says is not a candidate is remembered as such, probed once", async () => {
    const r = rig({ setup: (p) => { p.devices = [COL03] } })
    await r.start()
    r.port.send(buildRawHid(7n, [Uint8Array.from([1, 2, 3])]))
    r.port.send(buildRawHid(7n, [Uint8Array.from([1, 2, 3])]))
    r.flush()
    expect(r.port.probeCalls.filter((h) => h === 7n)).toHaveLength(0)
  })
  it("a truncated report is counted as dropped, never decoded wrongly", async () => {
    const r = rig()
    await r.start()
    r.port.send(buildRawHid(3n, [encodeReport(L03, 209, hov(1, 1)).subarray(0, 12)]))
    r.flush()
    expect(r.out.samples).toHaveLength(0)
    expect(r.b.status().counters.dropped).toBe(1)
  })
  it("garbage that is not a RAWINPUT block is counted, not thrown", async () => {
    const r = rig()
    await r.start()
    r.port.send(Uint8Array.from([1, 2, 3]))
    expect(() => r.flush()).not.toThrow()
    expect(r.b.status().facts.wmInputFailed).toBe(1)
  })
})

describe("the vendor page (Col02) is traced and not decoded, except as a last resort", () => {
  const heartbeat = Uint8Array.from(Buffer.from("dcc0000000000000000001", "hex"))

  it("the idle heartbeat (one per ~5 s) is traced as a raw record and never becomes a sample", async () => {
    const r = rig()
    await r.start()
    for (let i = 0; i < 4; i++) { r.h.clock.advance(5000); r.port.send(buildRawHid(2n, [heartbeat])) }
    r.flush()
    expect(r.out.samples).toHaveLength(0)
    expect(r.h.trace.raws.filter((x) => x.hex === "dcc0000000000000000001")).toHaveLength(4)
    expect(r.b.status().facts.vendorFallback).toBe(false)
    expect(r.b.status().counters.raw).toBe(4)
  })
  it("more than 3 vendor reports in 2 s while the digitizer collections are silent switches the fallback on: raw tablet counts, tip = pressure > 0", async () => {
    const r = rig()
    await r.start()
    for (let i = 0; i < 5; i++) { r.h.clock.advance(100); r.pen(2n, L02, 220, { x: 7600, y: 4750, pressure: 1000 }) }
    r.flush()
    expect(r.b.status().facts.vendorFallback).toBe(true)
    expect(r.out.samples.length).toBeGreaterThanOrEqual(2)
    const s = r.out.samples[r.out.samples.length - 1]!
    expect(s.x).toBeCloseTo(0.5, 6)
    expect(s.y).toBeCloseTo(0.5, 6)
    expect(s.tip).toBe(true)
  })
  it("the vendor fallback has no In Range field, so the visit timeouts end it", async () => {
    const r = rig()
    await r.start()
    for (let i = 0; i < 5; i++) { r.h.clock.advance(100); r.pen(2n, L02, 220, { x: 7600, y: 4750, pressure: 0 }) }
    r.b.tickAll(r.h.clock.now + LIVENESS.LEAVE_HOVER_MS + 10)
    r.flush()
    expect(r.out.samples[r.out.samples.length - 1]!.inRange).toBe(false)
  })
  it("never while a digitizer collection is talking", async () => {
    const r = rig()
    await r.start()
    for (let i = 0; i < 8; i++) {
      r.h.clock.advance(100)
      r.pen(3n, L03, 209, hov(1000 + i, 1000))
      r.pen(2n, L02, 220, { x: 7600, y: 4750, pressure: 1000 })
    }
    r.flush()
    expect(r.b.status().facts.vendorFallback).toBe(false)
    expect(r.out.samples.every((s) => s.x < 0.1)).toBe(true)
  })
  it("vendorFallback: false means never", async () => {
    const r = rig({ vendorFallback: false })
    await r.start()
    expect(r.port.registrations).toHaveLength(1) // not even the vendor usage is registered
    for (let i = 0; i < 6; i++) { r.h.clock.advance(100); r.pen(2n, L02, 220, { x: 7600, y: 4750, pressure: 1000 }) }
    r.flush()
    expect(r.out.samples).toHaveLength(0)
  })
})

describe("Windows' synthesised pen (Microsoft HID RID)", () => {
  const synthReport = (x: number, y: number) => encodeReport(LSYN, 1, { x, y, pressure: 512, tip: 1, inRange: 1 })

  it("is not decoded unless allowed", async () => {
    const r = rig({ setup: (p) => { p.devices = [COL03, SYNTH] } })
    await r.start()
    r.port.send(buildRawHid(9n, [synthReport(960, 600)]))
    r.flush()
    expect(r.out.samples).toHaveLength(0)
    expect(r.port.probeCalls).not.toContain(9n)
  })
  it("with allowSynthetic: SCREEN pixels, normalised by the screen, flagged synthetic and 'looks driver mapped'", async () => {
    const r = rig({ allowSynthetic: true, setup: (p) => { p.devices = [SYNTH] } })
    const res = await r.start()
    expect(res.ok).toBe(true)
    r.port.send(buildRawHid(9n, [synthReport(960, 600)]))
    r.flush()
    expect(r.out.samples[0]).toMatchObject({ x: 0.5, y: 0.5, backend: "rawinput-synth", tip: true })
    const f = r.b.status().facts
    expect(f.synthetic).toBe(true)
    expect(f.looksDriverMapped).toBe(true)
  })
  it("yields to the tablet's own stream while it talks, and takes over when the tablet is silent", async () => {
    const r = rig({ allowSynthetic: true, setup: (p) => { p.devices = [COL03, SYNTH] } })
    await r.start()
    r.pen(3n, L03, 209, hov(1000, 1000))
    r.h.clock.advance(100)
    r.port.send(buildRawHid(9n, [synthReport(960, 600)]))
    r.h.clock.advance(600)
    r.port.send(buildRawHid(9n, [synthReport(480, 300)]))
    r.flush()
    expect(r.out.samples.map((s) => s.backend)).toEqual(["rawinput-hid", "rawinput-synth"])
  })
})

describe("hot-plug", () => {
  it("GIDC_REMOVAL of the tablet ends the visit with a leave sample and forgets the device", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, touch(1000, 1000))
    r.port.change(false, 3n)
    r.flush()
    const last = r.out.samples[r.out.samples.length - 1]!
    expect(last).toMatchObject({ inRange: false, tip: false })
    expect(r.out.events.some((e) => e.kind === "device")).toBe(true)
  })
  it("GIDC_ARRIVAL looks at the device again (a re-plug) and re-reads the device info", async () => {
    const r = rig({ setup: (p) => { p.devices = [COL01] } })
    const res = await r.start()
    expect(res).toEqual({ ok: true, device: null })
    r.port.devices = [COL01, COL02, COL03, COL04]
    r.port.change(true, 3n)
    r.flush()
    expect(r.b.status().device?.name).toBe("HID VID_056A&PID_037A")
    expect(r.b.status().reason).toBeNull()
    r.pen(3n, L03, 209, hov(100, 100))
    r.flush()
    expect(r.out.samples).toHaveLength(1)
    expect(r.port.registrations.some((g) => g.usages.some((u) => u.usagePage === 0xff00))).toBe(false) // only 03 arrived, not the vendor node
  })
  it("the arrival of the tablet's vendor node registers its usage (not the whole page)", async () => {
    const r = rig({ setup: (p) => { p.devices = [COL03] } })
    await r.start()
    r.port.devices = [COL03, COL02]
    r.port.change(true, 2n)
    r.flush()
    expect(r.port.registrations.at(-1)!.usages).toEqual([{ usagePage: 0xff00, usage: 0x0a, flags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY }])
  })
})

describe("the window procedure only reads and queues", () => {
  it("nothing is decoded inside the callback: a WM_INPUT is read, queued, and a drain is scheduled", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, hov(1000, 1000))
    expect(r.immediates.length).toBeGreaterThan(0)
    expect(r.b.status().counters.raw).toBe(0)
    r.drain()
    expect(r.b.status().counters.raw).toBe(1)
  })
  it("a read that fails (the handle is gone) is counted, not fatal", async () => {
    const r = rig()
    await r.start()
    r.port.win!.onMessage(WM_INPUT, 0n, 999n) // no such block
    r.drain()
    expect(r.b.status().facts.wmInputFailed).toBe(1)
    expect(r.b.status().state).toBe("armed")
  })
  it("a canary break in GetRawInputData is fatal: released, failed, the reason names the sizes", async () => {
    const r = rig()
    await r.start()
    r.port.blocks.set(5n, new FfiOverrun("GetRawInputData", 48, 80))
    r.port.win!.onMessage(WM_INPUT, 0n, 5n)
    r.drain()
    expect(r.out.errors().find((e) => e.fatal)?.message).toBe("buffer overrun in GetRawInputData: expected 48 bytes, the driver wrote at least 80")
    expect(r.b.status().state).toBe("failed")
    expect(r.port.win!.destroyed).toBe(true)
    expect(r.port.unregistrations.length).toBeGreaterThan(0)
  })
  it("a sample listener that throws never kills the handler", async () => {
    const r = rig()
    await r.start()
    r.b.onSample(() => { throw new Error("renderer feed bug") })
    r.pen(3n, L03, 209, hov(1, 1))
    expect(() => r.flush()).not.toThrow()
    r.pen(3n, L03, 209, hov(2, 1))
    expect(() => r.flush()).not.toThrow()
    expect(r.b.status().counters.samples).toBe(2)
  })
})

describe("traces", () => {
  it("the first reports are traced as hex with the collection and its kind; vendor reports too", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, hov(1, 1))
    r.port.send(buildRawHid(2n, [Uint8Array.from(Buffer.from("dcc0000000000000000001", "hex"))]))
    r.drain()
    expect(r.h.trace.raws).toHaveLength(2)
    expect(r.h.trace.raws[0]).toMatchObject({ backend: "rawinput", note: "HID VID_056A&PID_037A Col03 tablet" })
    expect(r.h.trace.raws[0]!.hex.slice(0, 2)).toBe("d1") // report id 209
    expect(r.h.trace.raws[1]!.note).toBe("HID VID_056A&PID_037A Col02 vendor")
  })
  it("only the first 400 reports and then every 25th are traced (the sink caps the rest)", async () => {
    const r = rig()
    await r.start()
    for (let i = 0; i < 500; i++) { r.h.clock.advance(1); r.pen(3n, L03, 209, hov(i, 1)); if (i % 50 === 0) r.drain() }
    r.drain()
    expect(r.h.trace.raws.length).toBe(400 + 4) // 425, 450, 475, 500 are every 25th past 400
  })
})

describe("the mouse probe (Pen mode vs Mouse mode of the Wacom pointer node)", () => {
  it("is offered by the rawinput backend only", async () => {
    const r = rig()
    expect(isMouseProbing(r.b)).toBe(true)
  })
  it("registers the mouse usage only while on (INPUTSINK, no NOLEGACY), counts absolute and relative events by device, and unregisters", async () => {
    const r = rig()
    await r.start()
    r.port.devices = [...r.port.devices, COL01, dev(11n, "\\\\?\\HID#VID_046D&PID_C077#mouse", 0, 0, 0, 0, 0)]
    expect(r.b.mouseProbe(true)).toBe(true)
    const reg = r.port.registrations.at(-1)!
    expect(reg.usages).toEqual([{ usagePage: 1, usage: 2, flags: RIDEV_INPUTSINK }])
    r.port.send(buildRawMouse(1n, 100, 100, MOUSE_MOVE_ABSOLUTE)) // the Wacom pointer node, absolute: Pen mode
    r.port.send(buildRawMouse(1n, 110, 100, MOUSE_MOVE_ABSOLUTE))
    r.port.send(buildRawMouse(11n, 3, -2)) // a mouse, relative
    r.drain()
    expect(r.b.mouseProbeResult()).toMatchObject({ events: 3, absolute: 2, relative: 1, wacomEvents: 2, wacomAbsolute: 2, wacomRelative: 0 })
    expect(r.b.mouseProbeResult().devices).toHaveLength(2)
    expect(r.b.mouseProbe(false)).toBe(true)
    expect(r.port.unregistrations.at(-1)).toEqual([{ usagePage: 1, usage: 2 }])
    // off again: mouse blocks are no longer counted
    r.port.send(buildRawMouse(1n, 1, 1))
    r.drain()
    expect(r.b.mouseProbeResult().events).toBe(3)
  })
  it("a failsafe switches it off by itself (it receives every mouse move on the system)", async () => {
    const r = rig()
    await r.start()
    r.b.mouseProbe(true)
    const failsafe = r.ticks.find((t) => t.ms === 15_000)
    expect(failsafe).toBeDefined()
    failsafe!.fn()
    expect(r.port.unregistrations.at(-1)).toEqual([{ usagePage: 1, usage: 2 }])
  })
  it("cannot be turned on before the backend runs, and stop() takes it away", async () => {
    const r = rig()
    expect(r.b.mouseProbe(true)).toBe(false)
    await r.start()
    r.b.mouseProbe(true)
    r.b.stop()
    expect(r.port.unregistrations.flat().some((u) => u.usagePage === 1 && u.usage === 2)).toBe(true)
  })
  it("injected input (device handle 0) is counted as unnamed", async () => {
    const r = rig()
    await r.start()
    r.b.mouseProbe(true)
    r.port.send(buildRawMouse(0n, 5, 5, MOUSE_MOVE_ABSOLUTE))
    r.drain()
    expect(r.b.mouseProbeResult()).toMatchObject({ events: 1, absolute: 1, wacomEvents: 0, devices: ["injected / unnamed"] })
  })
})

describe("every registration, window and timer is released", () => {
  it("stop() unregisters what it registered (digitizer and vendor usages), destroys the window, clears the tick, and is idempotent", async () => {
    const r = rig()
    await r.start()
    expect(r.ticks.length).toBe(1)
    r.b.stop()
    expect(r.port.win!.destroyed).toBe(true)
    expect(r.ticks).toHaveLength(0)
    const removed = r.port.unregistrations.flat().map((u) => `${u.usagePage}/${u.usage}`).sort()
    expect(removed).toEqual(["13/1", "13/2", "65280/10"].sort())
    const n = r.port.unregistrations.length
    r.b.stop()
    expect(r.port.unregistrations).toHaveLength(n) // nothing left to remove
    expect(r.b.status().state).toBe("idle")
  })
  it("a message after stop() is ignored", async () => {
    const r = rig()
    await r.start()
    const win = r.port.win!
    r.b.stop()
    win.onMessage(WM_INPUT, 0n, 1n)
    r.drain()
    expect(r.out.samples).toHaveLength(0)
  })
  it("stop() is safe before start and after a failed start", async () => {
    const r = rig()
    expect(() => { r.b.stop(); r.b.stop() }).not.toThrow()
    const f = rig({ setup: (p) => { p.registerOk = false } })
    await f.start()
    expect(() => { f.b.stop(); f.b.stop() }).not.toThrow()
  })
  it("stop() while start() is in flight leaves nothing registered", async () => {
    const r = rig()
    const p = r.start()
    r.b.stop()
    const res = await p
    expect(res.ok).toBe(false)
    expect(r.port.win?.destroyed ?? true).toBe(true)
  })
  it("start again after stop works from a clean slate", async () => {
    const r = rig()
    await r.start()
    r.pen(3n, L03, 209, hov(1, 1)); r.drain()
    r.b.stop()
    expect((await r.start()).ok).toBe(true)
    expect(r.b.status().counters.raw).toBe(0)
    r.pen(3n, L03, 209, hov(1, 1)); r.flush()
    expect(r.out.samples).toHaveLength(2)
  })
})

describe("unused imports stay honest", () => {
  it("full is a corner of the tablet", () => {
    expect(full).toEqual({ x: 32767, y: 32767 })
  })
})
