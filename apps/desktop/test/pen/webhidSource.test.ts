// WebHidSource (design 4.4) over a fake navigator.hid. Cases ported from the webhid spike's webhidPen.test.ts and wacomReal.test.ts,
// plus the repo's rules: the primary report, the vendor fallback, thinned raw tracing, timestamps, status messages.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PenSample } from "../../src/shared/pen"
import { FALLBACK_SILENCE_MS, RAW_EVERY, RAW_FIRST, WebHidSource, type WebHidSourceOptions } from "../../src/main/pen/webhid/hidSource"
import type { HidDeviceStatus, HidRawRecord } from "../../src/main/pen/webhid/protocol"
import { FakeDevice, FakeHid, hexToBytes, modelCollection, modelReport, realDevice, realWacom, report213 } from "./webhidFixtures"

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function setup(extra: Partial<WebHidSourceOptions> = {}) {
  const hid = new FakeHid()
  const batches: PenSample[][] = []
  const raws: HidRawRecord[] = []
  const statuses: HidDeviceStatus[][] = []
  const src = new WebHidSource({
    hid, onSamples: (b) => batches.push(b), onRaw: (r) => raws.push(r), onStatus: (d) => statuses.push(d),
    now: () => 1_000_000, timeOrigin: 999_000, ...extra,
  })
  return { hid, batches, raws, statuses, src, all: () => batches.flat() }
}
const modelPen = (): FakeDevice => new FakeDevice(0x056a, 0x037a, "model pen", [modelCollection()])

describe("opening devices", () => {
  it("opens permitted Wacom pen devices, ignores other vendors and devices with no pen report", async () => {
    const { hid, src } = setup()
    const pen = modelPen()
    const vendorBlob = new FakeDevice(0x056a, 0x037a, "vendor", [{ usagePage: 0xff00, usage: 1, inputReports: [] }])
    const other = new FakeDevice(0x2dc8, 1, "pad", [modelCollection()])
    hid.devices = [pen, vendorBlob, other]
    await src.start()
    expect(pen.opened).toBe(true)
    expect(vendorBlob.opened).toBe(false)
    expect(other.opened).toBe(false)
    const d = src.devices()
    expect(d.map((x) => x.state)).toEqual(["open", "ignored"])
    expect(d[1]!.error).toMatch(/no collection with a pen report/)
  })

  it("the real Wacom is ONE device: opened, primary 213, vendor 220 as the fallback, In Range present", async () => {
    const { hid, src } = setup()
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    expect(pen.opened).toBe(true)
    const [d] = src.devices()
    expect(d).toMatchObject({ state: "open", primary: "d:1 #213", fallback: "ff00:a #220", hasInRange: true, collections: "1:1 ff00:a d:1", productName: "CTL-472" })
    expect(d!.layout).toMatch(/id213\[.*inRange@5\+1/)
    expect(d!.info?.aspect).toBeCloseTo(1.6, 6)
  })

  it("a vendor filter of [] opens every permitted device; the default is Wacom only", async () => {
    const hid = new FakeHid()
    const other = new FakeDevice(0x2dc8, 1, "pad", [modelCollection()])
    hid.devices = [other]
    const a = new WebHidSource({ hid, onSamples: () => undefined })
    await a.start()
    expect(other.opened).toBe(false)
    const b = new WebHidSource({ hid, onSamples: () => undefined, vendorIds: [] })
    await b.start()
    expect(other.opened).toBe(true)
  })

  it("survives an open() that is refused, saying why, and leaves no listener behind", async () => {
    const { hid, src } = setup()
    const pen = modelPen()
    pen.openError = new Error("NotAllowedError: Failed to open the device")
    hid.devices = [pen]
    await src.start()
    const [d] = src.devices()
    expect(d!.state).toBe("failed")
    expect(d!.error).toBe("open() refused: NotAllowedError: Failed to open the device")
    expect(pen.listeners.size).toBe(0)
  })

  it("an already-open device is not opened again", async () => {
    const { hid, src } = setup()
    const pen = modelPen()
    pen.opened = true
    hid.devices = [pen]
    await src.start()
    expect(pen.openCalls).toBe(0)
    expect(src.devices()[0]!.state).toBe("open")
  })

  it("adopts a device plugged in later and drops one that leaves, ending its visit with an out-of-range sample", async () => {
    const { hid, src, all } = setup()
    await src.start()
    expect(src.devices()).toHaveLength(0)
    const pen = modelPen()
    hid.fire("connect", pen)
    await vi.advanceTimersByTimeAsync(1)
    expect(pen.opened).toBe(true)
    pen.emit(7, modelReport(100, 100, 50, 1), 5)
    hid.fire("disconnect", pen)
    vi.advanceTimersByTime(8)
    const last = all().at(-1)!
    expect(last).toMatchObject({ inRange: false, tip: false, p: 0 })
    expect(pen.closeCalls).toBe(1)
    expect(pen.listeners.size).toBe(0)
    expect(src.devices()).toHaveLength(0)
  })

  it("stop() closes devices, removes listeners, flushes what is queued and goes quiet", async () => {
    const { hid, src, all } = setup()
    const pen = modelPen()
    hid.devices = [pen]
    await src.start()
    pen.emit(7, modelReport(100, 100, 50, 1), 5)
    src.stop()
    expect(all().length).toBeGreaterThanOrEqual(1)
    expect(pen.closeCalls).toBe(1)
    expect(hid.handlers.connect.size).toBe(0)
    expect(hid.handlers.disconnect.size).toBe(0)
    expect(pen.listeners.size).toBe(0)
    const n = all().length
    pen.emit(7, modelReport(1, 1, 1, 1), 6)
    vi.advanceTimersByTime(50)
    expect(all().length).toBe(n)
    src.stop() // idempotent
  })

  it("is inert without navigator.hid", async () => {
    const src = new WebHidSource({ hid: undefined, onSamples: () => undefined })
    // (a Node with a global navigator has no .hid either)
    expect(src.available).toBe(false)
    await src.start()
    expect(src.devices()).toEqual([])
  })

  it("refresh() adopts devices requestDevice() granted afterwards", async () => {
    const { hid, src } = setup()
    await src.start()
    hid.grantOnRequest = [realDevice()]
    await hid.requestDevice()
    await src.refresh()
    expect(src.devices()).toHaveLength(1)
    expect(src.devices()[0]!.state).toBe("open")
  })
})

describe("decoding", () => {
  it("batches samples at most batchMs after the first and times them on the epoch clock", async () => {
    const { hid, src, batches, all } = setup({ batchMs: 4 })
    const pen = modelPen()
    hid.devices = [pen]
    await src.start()
    pen.emit(7, modelReport(500, 250, 128, 1), 1100)
    pen.emit(7, modelReport(510, 250, 130, 1), 1101)
    expect(batches).toHaveLength(0)
    vi.advanceTimersByTime(3)
    expect(batches).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(batches).toHaveLength(1)
    const [a, b] = all()
    expect(a).toMatchObject({ x: 0.5, y: 0.5, tip: true, inRange: true, backend: "webhid", t: 999_000 + 1100 })
    expect(a!.p).toBeCloseTo(128 / 255, 6)
    expect(b!.x).toBeCloseTo(0.51, 6)
  })

  it("an implausible timestamp (0, NaN, far from now) falls back to the arrival time", async () => {
    const { hid, src, all } = setup({ batchMs: 0 })
    const pen = modelPen()
    hid.devices = [pen]
    await src.start()
    pen.emit(7, modelReport(1, 1, 1, 1), Number.NaN)
    pen.emit(7, modelReport(2, 2, 1, 1), -9e9)
    vi.advanceTimersByTime(1)
    expect(all().map((s) => s.t)).toEqual([1_000_000, 1_000_000])
  })

  it("the real device: the heartbeat on report 220 produces nothing, the pen on 213 produces samples", async () => {
    const { hid, src, all } = setup()
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    pen.emit(220, hexToBytes(realWacom.heartbeat.hex), 1000)
    vi.advanceTimersByTime(10)
    expect(all()).toHaveLength(0)
    pen.emit(213, report213({ tip: 1, x: 1000, y: 2000, pressure: 500 }), 1010)
    pen.emit(213, report213({ tip: 1, x: 1100, y: 2100, pressure: 600 }), 1011)
    vi.advanceTimersByTime(10)
    expect(all()).toHaveLength(2)
    expect(all()[1]).toMatchObject({ tip: true, inRange: true })
    const d = src.devices()[0]!
    expect(d.reportCounts).toEqual({ "220": 1, "213": 2 })
    expect(d.reports).toBe(3)
  })

  it("counts primary reports that could not be decoded as dropped", async () => {
    const { hid, src } = setup()
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    pen.emit(213, new Uint8Array(5), 1000)
    expect(src.devices()[0]!.dropped).toBe(1)
  })

  it("a stop() after a visit ends it for the device that has In Range too", async () => {
    const { hid, src, all } = setup()
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    pen.emit(213, report213({ x: 10, y: 10 }), 1000)
    src.stop()
    expect(all().at(-1)).toMatchObject({ inRange: false })
  })
})

describe("the vendor-report fallback (design 4.3)", () => {
  const vendorReport = (x: number, y: number, p: number): Uint8Array => {
    const b = new Uint8Array(10)
    b[0] = x & 255; b[1] = x >> 8; b[2] = y & 255; b[3] = y >> 8; b[4] = p & 255; b[5] = p >> 8
    return b
  }

  it("is NOT used for the idle heartbeat: one report every 5 s", async () => {
    let t = 1_000_000
    const { hid, src, all } = setup({ now: () => t })
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    for (let i = 0; i < 6; i++) { t += 5050; pen.emit(220, hexToBytes(realWacom.heartbeat.hex), t - 999_000) }
    vi.advanceTimersByTime(10)
    expect(all()).toHaveLength(0)
    expect(src.devices()[0]!.fallbackActive).toBe(false)
  })

  it("takes over when the vendor report streams (more than 3 in 2 s) and the primary has been silent, and gives back when 213 speaks", async () => {
    let t = 1_000_000
    const { hid, src, all } = setup({ now: () => t })
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    t += FALLBACK_SILENCE_MS + 100
    for (let i = 0; i < 5; i++) { t += 10; pen.emit(220, vendorReport(7600 + i, 4750, 1000), t - 999_000) }
    vi.advanceTimersByTime(10)
    expect(src.devices()[0]!.fallbackActive).toBe(true)
    const got = all()
    expect(got.length).toBeGreaterThanOrEqual(1)
    expect(got[0]!.x).toBeCloseTo(7600 / 15200, 3)
    expect(got[0]!.y).toBeCloseTo(0.5, 3)
    expect(got[0]!.p).toBeCloseTo(1000 / 2047, 3)
    expect(got[0]!.tip).toBe(true)
    // the primary speaks again: the fallback is off
    t += 10
    pen.emit(213, report213({ x: 100, y: 100 }), t - 999_000)
    expect(src.devices()[0]!.fallbackActive).toBe(false)
    const n = all().length
    t += 10
    pen.emit(220, vendorReport(1, 1, 1), t - 999_000)
    vi.advanceTimersByTime(10)
    expect(all().length).toBe(n + 1) // only the 213 sample was added by the line above this one; the vendor report is ignored again
  })

  it("does not take over while the primary is talking", async () => {
    let t = 1_000_000
    const { hid, src } = setup({ now: () => t })
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    for (let i = 0; i < 8; i++) {
      t += 10
      pen.emit(213, report213({ x: i * 10, y: 5 }), t - 999_000)
      pen.emit(220, vendorReport(i, i, 1), t - 999_000)
    }
    expect(src.devices()[0]!.fallbackActive).toBe(false)
  })
})

describe("raw tracing and status", () => {
  it("sends the first RAW_FIRST raw reports as hex, then every RAW_EVERY-th", async () => {
    const { hid, src, raws } = setup()
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    const total = RAW_FIRST + RAW_EVERY * 5
    for (let i = 0; i < total; i++) pen.emit(213, report213({ x: i, y: 1 }), 1000 + i)
    expect(raws.length).toBe(RAW_FIRST + 5)
    expect(raws[0]).toMatchObject({ key: "d0", reportId: 213 })
    expect(raws[0]!.hex).toMatch(/^[0-9a-f]{74}$/)
    expect(raws[0]!.t).toBe(999_000 + 1000)
  })

  it("a raw record is traced for report ids the decoder does not read too (the vendor heartbeat)", async () => {
    const { hid, src, raws } = setup()
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    pen.emit(220, hexToBytes(realWacom.heartbeat.hex), 1000)
    expect(raws[0]).toMatchObject({ reportId: 220, hex: realWacom.heartbeat.hex })
  })

  it("status is sent at once on a state change and at most every statusMs while reports flow", async () => {
    const { hid, src, statuses } = setup({ statusMs: 250 })
    const pen = realDevice()
    hid.devices = [pen]
    await src.start()
    const base = statuses.length
    expect(base).toBeGreaterThanOrEqual(2) // opening, open
    for (let i = 0; i < 100; i++) pen.emit(213, report213({ x: i, y: 1 }), 1000 + i)
    expect(statuses.length).toBe(base)
    vi.advanceTimersByTime(250)
    expect(statuses.length).toBe(base + 1)
    expect(statuses.at(-1)![0]!.reports).toBe(100)
  })

  it("takeCollections() hands the descriptor over once", async () => {
    const { hid, src } = setup()
    hid.devices = [realDevice()]
    expect(src.takeCollections()).toBeUndefined()
    await src.start()
    const json = src.takeCollections() as { usagePage: number }[]
    expect(json.map((c) => c.usagePage)).toEqual([1, 0xff00, 0x0d])
    expect(src.takeCollections()).toBeUndefined()
    expect(() => JSON.stringify(json)).not.toThrow()
  })
})
