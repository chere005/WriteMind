// The ONE shared HID decoder (main/pen/hid/{layout,decoder,fromHidP,fromWebHid}.ts). Merges the Raw Input spike's tests (C:\CLAUDIO\spikes\
// rawinput-spike\test\{decoder,wacom}.test.ts) and the WebHID spike's (webhid-spike\test\{hidPen,wacomReal}.test.ts): the REAL descriptors of
// Sean's Wacom (all four nodes, as Windows' own HID parser reported them and as navigator.hid reported them), Windows' synthesised pen, a real
// gamepad, and model pens (aligned and awkward). Only the REPORTS are synthetic: nobody has moved the real pen yet.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { layoutFromProbe, type ProbeLayout } from "../../src/main/pen/hid/fromHidP"
import { layoutFromWebHid, penScoreOfCollections, splitUsage, type HidCollectionInfoLike } from "../../src/main/pen/hid/fromWebHid"
import {
  PAGE_BUTTON, PAGE_DIGITIZER, PAGE_GENERIC_DESKTOP, defaultReportIds, encodeReport, fieldFor, fixRange, isPenLayout, isSyntheticDevicePath, isVendorPage,
  layoutRoles, looksDriverMapped, penScore, physicalExtent, portraitNative, primaryReportId, readBits, reportOf, reportScore, roleOf, splitReport,
  summarizeLayout, writeBits, type HidField, type HidLayout, type HidReport, type HidRole,
} from "../../src/main/pen/hid/layout"
import { PenDecoder, PrimaryPicker, VendorFallback, decodeFields, decodeReport, describeDevice, tiltDegrees } from "../../src/main/pen/hid/decoder"

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../fixtures/pen/${name}`, import.meta.url), "utf8")) as T

interface RawInputFixture { col03: { name: string; layout: ProbeLayout }; col04: { name: string; layout: ProbeLayout }; col02: { name: string; layout: ProbeLayout } }
interface SynthFixture { device: { name: string; vid: number; pid: number }; layout: ProbeLayout }
interface WebHidFixture { vendorId: number; productId: number; collections: HidCollectionInfoLike[]; heartbeat: { reportId: number; hex: string } }
interface GamepadFixture { collections: HidCollectionInfoLike[] }

const wacom = fixture<RawInputFixture>("wacom-ctl472.json")
const synth = fixture<SynthFixture>("ms-synth-pen.json")
const webhid = fixture<WebHidFixture>("wacom-ctl472-real.json")
const gamepad = fixture<GamepadFixture>("gamepad-real.json")

const pen = layoutFromProbe(wacom.col03.layout) // Col03, usage 0D/02, report 209
const digi = layoutFromProbe(wacom.col04.layout) // Col04, usage 0D/01, report 213
const vendor = layoutFromProbe(wacom.col02.layout) // Col02, page FF00, report 220

const full = { x: 32767, y: 32767 }
const inRange = { inRange: 1 }
const hexOf = (b: Uint8Array): string => Buffer.from(b).toString("hex")
const hexBytes = (h: string): Uint8Array => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))

describe("bit reading", () => {
  it("reads little-endian fields of any size at any offset, signed or not", () => {
    const b = Uint8Array.from([0b1010_0101, 0b0000_1111, 0xff, 0x7f])
    expect(readBits(b, 0, 4)).toBe(0b0101)
    expect(readBits(b, 4, 8)).toBe(0b1111_1010)
    expect(readBits(b, 0, 16)).toBe(0x0fa5)
    expect(readBits(b, 16, 16)).toBe(0x7fff)
    expect(readBits(b, 16, 16, true)).toBe(0x7fff)
    expect(readBits(Uint8Array.from([0xff, 0xff]), 0, 16, true)).toBe(-1)
    expect(readBits(Uint8Array.from([0x00, 0x80]), 0, 16, true)).toBe(-32768)
    expect(readBits(Uint8Array.from([0x1f]), 0, 5, true)).toBe(-1)
  })
  it("answers undefined for a report that is too short, a silly size or a negative offset", () => {
    expect(readBits(new Uint8Array(2), 8, 16)).toBeUndefined()
    expect(readBits(new Uint8Array(8), 0, 0)).toBeUndefined()
    expect(readBits(new Uint8Array(8), 0, 53)).toBeUndefined()
    expect(readBits(new Uint8Array(8), -1, 4)).toBeUndefined()
  })
  it("reads 32-bit fields without sign trouble and up to 52 bits exactly", () => {
    expect(readBits(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 0, 32)).toBe(0xffffffff)
    expect(readBits(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f]), 0, 52)).toBe(2 ** 52 - 1)
  })
  it("writeBits is the inverse (and clips at the end of the buffer)", () => {
    const b = new Uint8Array(4)
    writeBits(b, 3, 10, 0x2a5)
    expect(readBits(b, 3, 10)).toBe(0x2a5)
    writeBits(b, 20, 8, -5)
    expect(readBits(b, 20, 8, true)).toBe(-5)
    writeBits(b, 3, 10, 0)
    expect(readBits(b, 3, 10)).toBe(0)
    expect(() => writeBits(new Uint8Array(1), 4, 16, 0xffff)).not.toThrow()
  })
  it("fixRange reads Windows' -1 maximum as an unsigned wrap in the field's own width", () => {
    expect(fixRange(0, -1, 16)).toEqual([0, 65535])
    expect(fixRange(0, 255, 8)).toEqual([0, 255])
    expect(fixRange(-9000, 9000, 16)).toEqual([-9000, 9000])
    expect(fixRange(0, -1, 8)).toEqual([0, 255])
  })
  it("roleOf names the pen usages and nothing else", () => {
    expect(roleOf(PAGE_GENERIC_DESKTOP, 0x30)).toBe("x")
    expect(roleOf(PAGE_DIGITIZER, 0x30)).toBe("pressure")
    expect(roleOf(PAGE_DIGITIZER, 0x44)).toBe("barrel")
    expect(roleOf(PAGE_DIGITIZER, 0x5a)).toBe("secondary")
    expect(roleOf(PAGE_BUTTON, 2)).toBe("button2")
    expect(roleOf(0xff00, 1)).toBeNull()
    expect(isVendorPage(0xff00)).toBe(true)
    expect(isVendorPage(0x0d)).toBe(false)
  })
})

describe("the REAL Wacom pen collection (Col03, usage 0D/02, report 209)", () => {
  it("has the layout HidP reported: report 209, X/Y 0..32767 over 15200 x 9500, pressure 0..2047, tilt -9000..9000, id byte first", () => {
    expect(pen.hasReportIds).toBe(true)
    expect(pen.reports.map((r) => r.reportId)).toEqual([209])
    const f = (role: HidRole): HidField => fieldFor(pen, role)!
    expect([f("x").bitOffset, f("x").min, f("x").max, f("x").physMax]).toEqual([8, 0, 32767, 15200]) // 16 in the probe, minus the id byte
    expect([f("y").bitOffset, f("y").max, f("y").physMax]).toEqual([24, 32767, 9500])
    expect([f("pressure").bitOffset, f("pressure").max]).toEqual([56, 2047])
    expect([f("tiltX").min, f("tiltX").max, f("tiltX").signed]).toEqual([-9000, 9000, true])
    expect(f("x").hasNull).toBe(true)
    const bit = (role: HidRole): number => f(role).bitOffset
    expect([bit("tip"), bit("barrel"), bit("invert"), bit("eraser"), bit("secondary"), bit("inRange")]).toEqual([0, 1, 2, 3, 4, 5])
    expect(isPenLayout(pen)).toBe(true)
    expect(isPenLayout(digi)).toBe(true)
  })
  it("maps the corners of the tablet to 0 / 1 in the DEVICE frame (no rotation, no flip)", () => {
    const d = new PenDecoder(pen)
    const at = (x: number, y: number) => d.decode(encodeReport(pen, 209, { x, y, ...inRange }), 0)!
    expect(at(0, 0)).toMatchObject({ x: 0, y: 0 })
    expect(at(32767, 32767)).toMatchObject({ x: 1, y: 1 })
    expect(at(32767, 0)).toMatchObject({ x: 1, y: 0 })
    const mid = at(16383, 8191)
    expect(mid.x).toBeCloseTo(0.5, 3)
    expect(mid.y).toBeCloseTo(0.25, 3)
  })
  it("decodes contact, pressure, both barrel switches, the eraser and signed tilt in hundredths of a degree", () => {
    const d = new PenDecoder(pen)
    const rep = encodeReport(pen, 209, { ...full, pressure: 1023, tiltX: -4500, tiltY: 9000, tip: 1, inRange: 1, barrel: 1 })
    const s = d.decode(rep, 5)!
    expect(s).toMatchObject({ t: 5, tip: true, inRange: true, lower: true, upper: false, eraser: false, backend: "rawinput-hid" })
    expect(s.p).toBeCloseTo(1023 / 2047, 4)
    expect(s.tiltX).toBeCloseTo(-45, 6)
    expect(s.tiltY).toBeCloseTo(90, 6)
    const s2 = d.decode(encodeReport(pen, 209, { ...full, inRange: 1, secondary: 1, invert: 1 }), 6)!
    expect(s2).toMatchObject({ tip: false, p: 0, lower: false, upper: true, eraser: true })
  })
  it("pressure is 11 bit: 0, 1 and 2047 land at 0, ~0.0005 and 1", () => {
    const d = new PenDecoder(pen)
    const p = (v: number) => d.decode(encodeReport(pen, 209, { ...full, tip: 1, inRange: 1, pressure: v }), 0)!.p
    expect(p(0)).toBe(0)
    expect(p(1)).toBeCloseTo(1 / 2047, 6)
    expect(p(2047)).toBe(1)
  })
  it("hover (in range, no tip, no pressure) and out of range are distinguished", () => {
    const d = new PenDecoder(pen)
    expect(d.decode(encodeReport(pen, 209, { ...full, inRange: 1 }), 0)).toMatchObject({ inRange: true, tip: false, p: 0 })
    expect(d.decode(encodeReport(pen, 209, { ...full }), 0)).toMatchObject({ inRange: false })
    expect(d.hasInRange).toBe(true)
  })
  it("pressure with the tip switch up reads as 0 (the pen is hovering)", () => {
    const d = new PenDecoder(pen)
    expect(d.decode(encodeReport(pen, 209, { ...full, inRange: 1, pressure: 500 }), 0)).toMatchObject({ tip: false, p: 0 })
  })
  it("X / Y have a Null state: an out-of-range value yields no wrong position (the state keeps the last good one)", () => {
    const d = new PenDecoder(pen)
    expect(d.decode(encodeReport(pen, 209, { x: 65535, y: 10, ...inRange }), 0)).toBeNull() // nothing known yet
    d.decode(encodeReport(pen, 209, { x: 1000, y: 2000, ...inRange }), 1)
    const s = d.decode(encodeReport(pen, 209, { x: 65535, y: 65535, inRange: 0 }), 2)! // leaving: Null position, in range cleared
    expect(s.inRange).toBe(false)
    expect(s.x).toBeCloseTo(1000 / 32767, 6)
    expect(s.y).toBeCloseTo(2000 / 32767, 6)
    const fields = decodeFields(reportOf(pen, 209)!, encodeReport(pen, 209, { x: 65535, y: 10 }, false))
    expect(fields.x).toBeUndefined()
    expect(fields.y).toBe(10)
  })
  it("a report that is too short, or has another id, is not decoded", () => {
    const d = new PenDecoder(pen)
    const ok = encodeReport(pen, 209, { ...full, ...inRange })
    expect(d.decode(ok.subarray(0, 10), 0)).toBeNull()
    expect(d.decode(Uint8Array.from([7, ...ok.subarray(1)]), 0)).toBeNull()
    expect(decodeReport(pen, ok.subarray(0, 10))).toBeNull()
    expect(decodeReport(pen, ok)?.values.x).toBe(32767)
  })
  it("physical extents say landscape (15200 x 9500) although both logical ranges are 32767; DeviceInfo carries both", () => {
    expect(physicalExtent(pen)).toEqual({ x: 15200, y: 9500 })
    expect(portraitNative(pen)).toBe(false)
    const info = describeDevice(pen, "HID VID_056A&PID_037A", 0x056a, 0x037a)
    expect(info).toMatchObject({
      name: "HID VID_056A&PID_037A", vendorId: 0x056a, productId: 0x037a, rawX: [0, 32767], rawY: [0, 32767], pressureMax: 2047,
      claims: { pressure: true, tilt: true, lower: true, upper: true, eraser: true },
    })
    expect(info.aspect).toBeCloseTo(1.6, 3)
  })
  it("Windows reports the same fields for the digitizer node under report 213", () => {
    expect(digi.reports.map((r) => r.reportId)).toEqual([213])
    expect(digi.reports[0]!.fields.filter((f) => f.role).map((f) => f.role)).toEqual(pen.reports[0]!.fields.filter((f) => f.role).map((f) => f.role))
    const s = new PenDecoder(digi).decode(encodeReport(digi, 213, { ...full, pressure: 2047, tip: 1, inRange: 1 }), 0)!
    expect(s).toMatchObject({ x: 1, y: 1, p: 1, tip: true })
  })
  it("a report of the digitizer node fed to the pen node's layout is ignored (another id)", () => {
    expect(new PenDecoder(pen).decode(encodeReport(digi, 213, { ...full }), 0)).toBeNull()
  })
  it("summarizeLayout is a one-line description for the trace", () => {
    expect(summarizeLayout(pen)).toMatch(/^hidp d:2 id209\[tip@0\+1,barrel@1\+1,.*x@8\+16,y@24\+16,pressure@56\+16/)
  })
})

describe("the REAL Wacom vendor collection (Col02, page 0xFF00, report 220)", () => {
  it("is the raw-count source: X 0..15200, Y 0..9500, pressure 0..2047, no tip switch, no In Range; 11 bytes", () => {
    expect(vendor.usagePage).toBe(0xff00)
    expect(vendor.reports[0]!.reportId).toBe(220)
    expect([fieldFor(vendor, "x")!.max, fieldFor(vendor, "y")!.max, fieldFor(vendor, "pressure")!.max]).toEqual([15200, 9500, 2047])
    expect(layoutRoles(vendor).has("tip")).toBe(false)
    expect(layoutRoles(vendor).has("inRange")).toBe(false)
  })
  it("decodes the idle heartbeat (dc c0 00 ...) as a pen at x = 192: that is why it is never turned into samples by default", () => {
    const hb = hexBytes("dcc0000000000000000001")
    const d = decodeReport(vendor, hb)!
    expect(d.values.x).toBe(192)
    expect(d.values.y).toBe(0)
    expect(d.values.pressure).toBe(0)
    // a decoder over it WOULD make a sample, with no In Range field: the backend must not let it through (VendorFallback)
    expect(new PenDecoder(vendor).decode(hb, 0)).toMatchObject({ inRange: true, tip: false })
  })
  it("with real contact the vendor stream is the same pen in raw tablet counts, tip = pressure > 0", () => {
    const d = new PenDecoder(vendor)
    const s = d.decode(encodeReport(vendor, 220, { x: 7600, y: 4750, pressure: 1000 }), 0)!
    expect(s.x).toBeCloseTo(0.5, 6)
    expect(s.y).toBeCloseTo(0.5, 6)
    expect(s).toMatchObject({ tip: true, inRange: true })
    expect(s.p).toBeCloseTo(1000 / 2047, 5)
  })
})

describe("one position stream per device: the primary report rule", () => {
  const merged: HidLayout = { source: "hidp", usagePage: 0x0d, usage: 0x02, hasReportIds: true, reports: [...pen.reports, ...digi.reports, ...vendor.reports] }

  it("scores reports by Tip Switch 4, In Range 3, pressure 1, barrel 1, tilt 1 and picks the best; a tie goes to descriptor order", () => {
    const [r209, r213, r220] = merged.reports as [HidReport, HidReport, HidReport]
    expect(reportScore(r209)).toBe(1 + 4 + 3 + 1 + 1 + 1)
    expect(reportScore(r213)).toBe(reportScore(r209))
    expect(reportScore(r220)).toBe(1 + 1) // x, y and pressure only
    expect(primaryReportId(merged)).toBe(209)
    expect(primaryReportId({ ...merged, reports: [r213, r209, r220] })).toBe(213)
    expect(defaultReportIds(merged)).toEqual([209]) // 213 and 220 carry a position too: not read
  })
  it("a report without a position never wins but is read (tilt or buttons in a report of their own)", () => {
    const tiltOnly: HidReport = { reportId: 9, bitLength: 16, fields: [{ page: PAGE_DIGITIZER, usage: 0x3d, role: "tiltX", bitOffset: 0, bitSize: 16, signed: true, min: -9000, max: 9000, physMin: -9000, physMax: 9000, hasNull: false }] }
    const l: HidLayout = { ...merged, reports: [...merged.reports, tiltOnly] }
    expect(primaryReportId(l)).toBe(209)
    expect(defaultReportIds(l)).toEqual([209, 9])
  })
  it("a decoder over a layout with three position reports reads ONLY the primary one: the heartbeat and the sibling are ignored", () => {
    const d = new PenDecoder(merged)
    expect(d.handles(209)).toBe(true)
    expect(d.handles(213)).toBe(false)
    expect(d.handles(220)).toBe(false)
    expect(d.decode(hexBytes("dcc0000000000000000001"), 0)).toBeNull()
    expect(d.decode(encodeReport(merged, 213, { ...full, ...inRange }), 0)).toBeNull()
    expect(d.decode(encodeReport(merged, 209, { x: 16383, y: 16383, ...inRange }), 0)!.x).toBeCloseTo(0.5, 3)
  })
  it("reportIds: 'all' or a list is the override for tests and the analyser", () => {
    const all = new PenDecoder(merged, { reportIds: "all" })
    expect(all.handles(220)).toBe(true)
    expect(all.decode(hexBytes("dcc0000000000000000001"), 0)).not.toBeNull()
    const some = new PenDecoder(merged, { reportIds: [213] })
    expect(some.decode(encodeReport(merged, 213, { ...full, ...inRange }), 0)).not.toBeNull()
    expect(some.decode(encodeReport(merged, 209, { ...full, ...inRange }), 0)).toBeNull()
  })
  it("two coordinate scales never merge: a vendor report between pen reports does not move the pen", () => {
    const d = new PenDecoder(merged)
    const a = d.decode(encodeReport(merged, 209, { x: 16383, y: 16383, ...inRange }), 0)!
    d.decode(encodeReport(merged, 220, { x: 7600, y: 4750, pressure: 0 }), 1)
    const b = d.decode(encodeReport(merged, 209, { x: 16383, y: 16383, ...inRange }), 2)!
    expect([b.x, b.y]).toEqual([a.x, a.y])
  })
})

describe("one pen, several collections (PrimaryPicker)", () => {
  it("the first collection to speak owns the stream until it has been silent for the hold time", () => {
    const p = new PrimaryPicker(250)
    expect(p.accept("1386:890", 3n, 0)).toBe(true) // Col03 speaks first
    expect(p.accept("1386:890", 4n, 1)).toBe(false) // Col04 duplicate dropped
    expect(p.accept("1386:890", 3n, 100)).toBe(true)
    expect(p.accept("1386:890", 4n, 200)).toBe(false)
    expect(p.ownerOf("1386:890", 200)).toBe(3n)
    expect(p.accept("1386:890", 4n, 400)).toBe(true) // owner last spoke at 100, hold ended at 350
    expect(p.ownerOf("1386:890", 1000)).toBeNull()
  })
  it("hands over after silence, keeps groups independent, forgets removed devices and can be cleared", () => {
    const p = new PrimaryPicker(250)
    expect(p.accept("a", 3n, 0)).toBe(true)
    expect(p.accept("a", 4n, 300)).toBe(true) // owner silent for > 250 ms
    expect(p.accept("a", 3n, 301)).toBe(false)
    expect(p.accept("b", 9n, 301)).toBe(true)
    p.forget(4n)
    expect(p.accept("a", 3n, 302)).toBe(true)
    p.clear()
    expect(p.accept("a", 5n, 303)).toBe(true)
  })
})

describe("the vendor page is a last resort (VendorFallback)", () => {
  it("a heartbeat every 5 s never switches it on", () => {
    const f = new VendorFallback()
    for (let t = 0; t < 60_000; t += 5000) f.noteVendor("g", t)
    expect(f.active("g")).toBe(false)
  })
  it("more than 3 vendor reports in 2 s while the digitizer collections are silent does", () => {
    const f = new VendorFallback()
    f.noteVendor("g", 0); f.noteVendor("g", 100); f.noteVendor("g", 200)
    expect(f.active("g")).toBe(false)
    f.noteVendor("g", 300)
    expect(f.active("g")).toBe(true)
  })
  it("not while a digitizer collection spoke in the last 2 s; and a digitizer report switches it off again", () => {
    const f = new VendorFallback()
    f.noteDigitizer("g", 0)
    for (let t = 100; t <= 1000; t += 100) f.noteVendor("g", t)
    expect(f.active("g")).toBe(false)
    for (let t = 2500; t <= 3000; t += 100) f.noteVendor("g", t)
    expect(f.active("g")).toBe(true)
    f.noteDigitizer("g", 3100)
    expect(f.active("g")).toBe(false)
  })
  it("groups are independent and reset clears everything", () => {
    const f = new VendorFallback()
    for (let t = 0; t < 500; t += 100) f.noteVendor("a", t)
    expect(f.active("a")).toBe(true)
    expect(f.active("b")).toBe(false)
    f.reset()
    expect(f.active("a")).toBe(false)
  })
})

describe("Windows' synthesised pen (Microsoft HID RID): SCREEN pixels, never decoded unless asked", () => {
  const sl = layoutFromProbe(synth.layout)

  it("is recognised by its device path alone, and so is 'looks mapped by the driver'", () => {
    expect(isSyntheticDevicePath(synth.device.name)).toBe(true)
    expect(looksDriverMapped(synth.device.name)).toBe(true)
    expect(isSyntheticDevicePath(wacom.col03.name)).toBe(false)
    expect(looksDriverMapped(wacom.col03.name)).toBe(false) // revision 1's range heuristic would have said true: the Wacom is 0..32767
    expect(looksDriverMapped(wacom.col02.name)).toBe(false)
  })
  it("its descriptor says 0..32000 but it reports screen pixels: xyExtent normalises by the screen", () => {
    const d = new PenDecoder(sl, { backend: "rawinput-synth", xyExtent: { x: 1920, y: 1200 } })
    const s = d.decode(encodeReport(sl, 1, { x: 960, y: 300, pressure: 512, tip: 1, inRange: 1 }), 0)!
    expect(s.x).toBeCloseTo(0.5, 6)
    expect(s.y).toBeCloseTo(0.25, 6)
    expect(s.backend).toBe("rawinput-synth")
    expect(s.p).toBeCloseTo(0.5, 6)
    expect(s.tip).toBe(true)
  })
  it("signed tilt of a 8 bit -90..90 field is degrees as is", () => {
    const d = new PenDecoder(sl)
    const s = d.decode(encodeReport(sl, 1, { x: 100, y: 100, tiltX: -45, tiltY: 90, inRange: 1 }), 0)!
    expect(s.tiltX).toBe(-45)
    expect(s.tiltY).toBe(90)
  })
  it("clamps a position beyond the extent", () => {
    const d = new PenDecoder(sl, { xyExtent: { x: 1920, y: 1200 } })
    const s = d.decode(encodeReport(sl, 1, { x: 5000, y: 5000, inRange: 1 }), 0)!
    expect([s.x, s.y]).toEqual([1, 1])
  })
})

describe("tilt scaling", () => {
  const field = (min: number, max: number, physMin = min, physMax = max): HidField => ({
    page: PAGE_DIGITIZER, usage: 0x3d, role: "tiltX", bitOffset: 0, bitSize: 16, signed: min < 0, min, max, physMin, physMax, hasNull: false,
  })
  it("a +-90 field is degrees; a +-9000 field is hundredths of a degree; a +-18000 one scales onto +-90", () => {
    expect(tiltDegrees(45, field(-90, 90))).toBe(45)
    expect(tiltDegrees(-4500, field(-9000, 9000))).toBe(-45)
    expect(tiltDegrees(9000, field(-18000, 18000))).toBe(45)
  })
  it("a physical range different from the logical one is applied first", () => {
    expect(tiltDegrees(255, field(0, 255, -90, 90))).toBe(90)
    expect(tiltDegrees(0, field(0, 255, -90, 90))).toBe(-90)
  })
  it("never leaves +-90 and rounds to a tenth", () => {
    expect(tiltDegrees(500, field(-90, 90))).toBe(90)
    expect(tiltDegrees(1234, field(-9000, 9000))).toBe(12.3)
    expect(tiltDegrees(7, undefined)).toBe(7)
  })
})

describe("model pens: aligned and awkward layouts", () => {
  const field = (role: HidRole, usage: number, page: number, bitOffset: number, bitSize: number, min: number, max: number, extra: Partial<HidField> = {}): HidField => ({
    page, usage, role, bitOffset, bitSize, signed: min < 0, min, max, physMin: min, physMax: max, hasNull: false, ...extra,
  })
  /** x(16) y(16) pressure(8) tip(1) barrel(1) pad(6), report id 7, no In Range. */
  const aligned: HidLayout = {
    source: "model", usagePage: PAGE_DIGITIZER, usage: 0x02, hasReportIds: true,
    reports: [{
      reportId: 7, bitLength: 42, fields: [
        field("x", 0x30, PAGE_GENERIC_DESKTOP, 0, 16, 0, 1000), field("y", 0x31, PAGE_GENERIC_DESKTOP, 16, 16, 0, 500),
        field("pressure", 0x30, PAGE_DIGITIZER, 32, 8, 0, 255), field("tip", 0x42, PAGE_DIGITIZER, 40, 1, 0, 1), field("barrel", 0x44, PAGE_DIGITIZER, 41, 1, 0, 1),
      ],
    }],
  }
  /** Awkward: 12 bit pressure straddling a byte, signed tilt with a Null state, two report ids (position in 1, tilt+buttons in 2), no tip switch. */
  const awkward: HidLayout = {
    source: "model", usagePage: PAGE_DIGITIZER, usage: 0x02, hasReportIds: true,
    reports: [
      { reportId: 1, bitLength: 44, fields: [
        field("x", 0x30, PAGE_GENERIC_DESKTOP, 0, 16, 0, 20000, { hasNull: true }), field("y", 0x31, PAGE_GENERIC_DESKTOP, 16, 16, 0, 12000, { hasNull: true }),
        field("pressure", 0x30, PAGE_DIGITIZER, 32, 12, 0, 4095),
      ] },
      { reportId: 2, bitLength: 34, fields: [
        field("tiltX", 0x3d, PAGE_DIGITIZER, 0, 8, -60, 60, { hasNull: true }), field("tiltY", 0x3e, PAGE_DIGITIZER, 8, 8, -60, 60, { hasNull: true }),
        field("button1", 1, PAGE_BUTTON, 16, 1, 0, 1), field("button2", 2, PAGE_BUTTON, 17, 1, 0, 1), field("inRange", 0x32, PAGE_DIGITIZER, 18, 1, 0, 1),
      ] },
    ],
  }

  it("an aligned pen decodes x / y / pressure / tip / barrel and has no In Range field", () => {
    const d = new PenDecoder(aligned)
    expect(d.hasInRange).toBe(false)
    const s = d.decode(encodeReport(aligned, 7, { x: 500, y: 250, pressure: 255, tip: 1, barrel: 1 }), 3)!
    expect(s).toMatchObject({ x: 0.5, y: 0.5, p: 1, tip: true, lower: true, upper: false, inRange: true, t: 3 })
  })
  it("without a Tip Switch the contact threshold decides (default: any pressure)", () => {
    const noTip: HidLayout = { ...awkward, reports: [awkward.reports[0]!] }
    const d = new PenDecoder(noTip)
    expect(d.decode(encodeReport(noTip, 1, { x: 10, y: 10, pressure: 1 }), 0)).toMatchObject({ tip: true })
    expect(d.decode(encodeReport(noTip, 1, { x: 10, y: 10, pressure: 0 }), 0)).toMatchObject({ tip: false, p: 0 })
    const strict = new PenDecoder(noTip, { contactThreshold: 0.05 })
    expect(strict.decode(encodeReport(noTip, 1, { x: 10, y: 10, pressure: 100 }), 0)).toMatchObject({ tip: false })
    expect(strict.decode(encodeReport(noTip, 1, { x: 10, y: 10, pressure: 1000 }), 0)).toMatchObject({ tip: true })
  })
  it("merges state across reports: position in one, tilt and buttons in the other", () => {
    const d = new PenDecoder(awkward)
    expect(d.hasInRange).toBe(true)
    expect(d.decode(encodeReport(awkward, 2, { tiltX: -30, tiltY: 60, button2: 1, inRange: 1 }), 0)).toBeNull() // no position yet
    const s = d.decode(encodeReport(awkward, 1, { x: 10000, y: 6000, pressure: 2048 }), 1)!
    expect(s).toMatchObject({ x: 0.5, y: 0.5, inRange: true, upper: true, lower: false })
    expect(s.tiltX).toBe(-30)
    expect(s.tiltY).toBe(60)
    expect(s.p).toBeCloseTo(2048 / 4095, 6)
  })
  it("a 12 bit field straddling a byte round-trips every value", () => {
    for (const v of [0, 1, 0x7ff, 0x800, 0xabc, 4095]) {
      const r = encodeReport(awkward, 1, { x: 1, y: 1, pressure: v })
      expect(decodeReport(awkward, r)!.values.pressure).toBe(v)
    }
  })
  it("signed tilt with a Null state: -128 (outside -60..60) is 'no data', the previous tilt stays", () => {
    const d = new PenDecoder(awkward)
    d.decode(encodeReport(awkward, 1, { x: 10, y: 10, pressure: 0 }), 0)
    d.decode(encodeReport(awkward, 2, { tiltX: 20, tiltY: -20, inRange: 1 }), 1)
    const s = d.decode(encodeReport(awkward, 2, { tiltX: -128, tiltY: -25, inRange: 1 }), 2)!
    expect(s.tiltX).toBe(20)
    expect(s.tiltY).toBe(-25)
  })
  it("gone() ends the visit at the last place the pen was, once", () => {
    const d = new PenDecoder(aligned)
    expect(d.gone(0)).toBeNull()
    d.decode(encodeReport(aligned, 7, { x: 100, y: 200, pressure: 100, tip: 1 }), 1)
    expect(d.gone(2)).toMatchObject({ x: 0.1, y: 0.4, inRange: false, tip: false, p: 0 })
    expect(d.gone(3)).toBeNull()
  })
  it("a layout without report ids has report id 0 and no id byte", () => {
    const bare: HidLayout = { ...aligned, hasReportIds: false, reports: [{ ...aligned.reports[0]!, reportId: 0 }] }
    const bytes = encodeReport(bare, 0, { x: 1000, y: 0, pressure: 0 })
    expect(splitReport(bare, bytes)).toEqual({ reportId: 0, data: bytes })
    expect(new PenDecoder(bare).decode(bytes, 0)).toMatchObject({ x: 1 })
  })
  it("decodeData takes WebHID's shape (id and data apart)", () => {
    const d = new PenDecoder(aligned)
    const withId = encodeReport(aligned, 7, { x: 500, y: 250, tip: 1 })
    expect(d.decodeData(7, withId.subarray(1), 0)).toMatchObject({ x: 0.5, y: 0.5, tip: true })
  })
})

describe("the REAL WebHID metadata of the Wacom (one HIDDevice, three collections)", () => {
  const wl = layoutFromWebHid(webhid.collections)

  it("splitUsage puts a bare usage on the collection's page and a long one on its own", () => {
    expect(splitUsage(0x30, 1)).toEqual({ page: 1, usage: 0x30 })
    expect(splitUsage(0x1_0030, 0x0d)).toEqual({ page: 1, usage: 0x30 })
  })
  it("compiles reports 213 (digitizer) and 220 (vendor); the pointer collection has none", () => {
    expect(wl.reports.map((r) => r.reportId).sort()).toEqual([213, 220])
    expect(wl.hasReportIds).toBe(true)
  })
  it("picks 213 as the primary report and ignores the vendor report 220 and its heartbeat", () => {
    expect(primaryReportId(wl)).toBe(213)
    const d = new PenDecoder(wl, { backend: "webhid" })
    const hb = hexBytes(webhid.heartbeat.hex)
    expect(d.decodeData(webhid.heartbeat.reportId, hb, 0)).toBeNull()
    expect(d.handles(220)).toBe(false)
  })
  it("decodes a synthetic 213 with the descriptor's own offsets (X/Y 32767 over 15200 x 9500, pressure 2047, tilt hundredths of a degree)", () => {
    const d = new PenDecoder(wl, { backend: "webhid" })
    const data = encodeReport(wl, 213, { x: 32767, y: 16383, pressure: 2047, tip: 1, inRange: 1, barrel: 1, tiltX: 4500, tiltY: -9000 }, false)
    const s = d.decodeData(213, data, 4)!
    expect(s).toMatchObject({ x: 1, p: 1, tip: true, lower: true, inRange: true, backend: "webhid" })
    expect(s.y).toBeCloseTo(0.5, 3)
    expect(s.tiltX).toBe(45)
    expect(s.tiltY).toBe(-90)
  })
  it("the physical size says landscape and the aspect is 1.6", () => {
    expect(physicalExtent(wl)).toEqual({ x: 15200, y: 9500 })
    expect(portraitNative(wl)).toBe(false)
    expect(describeDevice(wl, "CTL-472", webhid.vendorId, webhid.productId).aspect).toBeCloseTo(1.6, 3)
  })
  it("scores the digitizer collection as a pen and the vendor one lower", () => {
    const best = penScoreOfCollections(webhid.collections)
    expect(best).toBeGreaterThan(0)
    expect(penScore(layoutFromWebHid([webhid.collections.find((c) => c.usagePage === 0xff00)!]))).toBeLessThan(best)
    expect(penScore(layoutFromWebHid([webhid.collections.find((c) => c.usagePage === 1)!]))).toBe(0) // the pointer collection has no reports
  })
})

describe("a real gamepad is not a pen (and its -1 maximum is an unsigned wrap)", () => {
  const gl = layoutFromWebHid(gamepad.collections)
  it("is not a pen layout and scores 0", () => {
    expect(isPenLayout(gl)).toBe(false)
    expect(penScoreOfCollections(gamepad.collections)).toBe(0)
  })
  it("has no contact field, so no backend would ever pick it (X / Y alone are not a pen)", () => {
    expect(layoutRoles(gl).has("tip")).toBe(false)
    expect(layoutRoles(gl).has("pressure")).toBe(false)
    expect(penScore(gl)).toBe(0)
  })
  it("reads its 16 bit axes as 0..65535, not 0..-1 (Windows hands the maximum over as a signed -1)", () => {
    const axis = gl.reports[0]!.fields.find((f) => f.role === "x")!
    expect([axis.min, axis.max]).toEqual([0, 65535])
  })
})

describe("encodeReport and the layout helpers", () => {
  it("encodeReport / decodeFields round-trip every role of the real pen", () => {
    const v = { x: 12345, y: 6789, pressure: 1500, tip: 1, barrel: 1, secondary: 0, invert: 0, eraser: 0, inRange: 1, tiltX: -123, tiltY: 4567 } as const
    const got = decodeFields(reportOf(pen, 209)!, encodeReport(pen, 209, v, false))
    expect(got).toMatchObject(v)
  })
  it("encodeReport refuses an unknown report", () => {
    expect(() => encodeReport(pen, 5, {})).toThrow()
  })
  it("reportScore of a report without a position is 0, and layoutRoles lists every role", () => {
    expect(reportScore({ reportId: 1, bitLength: 8, fields: [] })).toBe(0)
    expect([...layoutRoles(pen)].sort()).toEqual(["barrel", "eraser", "inRange", "invert", "pressure", "secondary", "tiltX", "tiltY", "tip", "x", "y"].sort())
  })
  it("round-trips through hex (what the trace stores) without loss", () => {
    const r = encodeReport(pen, 209, { x: 4321, y: 1234, pressure: 77, tip: 1, inRange: 1 })
    expect(new PenDecoder(pen).decode(hexBytes(hexOf(r)), 0)).toEqual(new PenDecoder(pen).decode(r, 0))
  })
})
