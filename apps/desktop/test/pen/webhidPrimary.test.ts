// WebHID: which report is the pen (design 4.3, 4.4), tested against the REAL CTL-472 collection metadata and synthetic reports.
// Source of the cases: the webhid spike's wacomReal.test.ts (46 tests), re-expressed on the repo's one decoder.
import { describe, expect, it } from "vitest"
import { PenDecoder } from "../../src/main/pen/hid/decoder"
import { layoutFromWebHid } from "../../src/main/pen/hid/fromWebHid"
import { choiceLabel, collectionsLabel, deviceInfoFor, planDevice } from "../../src/main/pen/webhid/primary"
import { hexToBytes, item, modelCollection, pack, realReport, realWacom, report213 } from "./webhidFixtures"

describe("the real CTL-472 metadata", () => {
  const plan = planDevice(realWacom.collections)

  it("is one device with the Pointer, a vendor and a Digitizer collection", () => {
    expect(collectionsLabel(realWacom.collections)).toBe("1:1 ff00:a d:1")
    expect([realWacom.vendorId, realWacom.productId]).toEqual([0x056a, 0x037a])
  })

  it("has two reports with a position; the standard digitizer report 213 is the primary one, the vendor 220 the last resort", () => {
    expect(plan.reportIds).toEqual([213, 220])
    expect(plan.primary?.reportId).toBe(213)
    expect(plan.primary?.vendor).toBe(false)
    expect(plan.vendor?.reportId).toBe(220)
    expect(plan.vendor?.vendor).toBe(true)
    expect(choiceLabel(plan.primary!)).toBe("d:1 #213")
    expect(plan.primary!.score).toBeGreaterThan(plan.vendor!.score)
  })

  it("places the fields of report 213 (37 bytes) where the descriptor says", () => {
    const r = realReport(213)
    const at = Object.fromEntries(r.fields.filter((f) => f.role).map((f) => [f.role, f.bitOffset]))
    expect(at).toMatchObject({ tip: 0, barrel: 1, invert: 2, eraser: 3, secondary: 4, inRange: 5, x: 8, y: 24, pressure: 56, tiltX: 216, tiltY: 232 })
  })

  it("DeviceInfo uses the PHYSICAL extents: landscape 15200 x 9500, logical 0..32767 on both axes", () => {
    const info = deviceInfoFor(realWacom, plan.primary!)
    expect(info.name).toBe("CTL-472")
    expect(info.aspect).toBeCloseTo(15200 / 9500, 6)
    expect(info.rawX).toEqual([0, 32767])
    expect(info.rawY).toEqual([0, 32767])
    expect(info.pressureMax).toBe(2047)
    expect(info.claims).toEqual({ pressure: true, tilt: true, lower: true, upper: true, eraser: true })
    expect([info.vendorId, info.productId]).toEqual([0x056a, 0x037a])
  })

  const dec = (): PenDecoder => new PenDecoder(plan.primary!.layout, { backend: "webhid" })

  it("decodes a pen stroke sample: position, pressure, buttons, tilt in degrees", () => {
    const s = dec().decodeData(213, report213({ tip: 1, barrel: 1, x: 16383, y: 8192, pressure: 1023, tiltX: 4500, tiltY: -2000 }), 100)!
    expect(s.x).toBeCloseTo(16383 / 32767, 6)
    expect(s.y).toBeCloseTo(8192 / 32767, 6)
    expect(s.p).toBeCloseTo(1023 / 2047, 6)
    expect(s).toMatchObject({ t: 100, tip: true, lower: true, upper: false, eraser: false, inRange: true, backend: "webhid" })
    expect(s.tiltX).toBeCloseTo(45, 1)
    expect(s.tiltY).toBeCloseTo(-20, 1)
  })

  it("corners map to 0 and 1 of the logical range", () => {
    const d = dec()
    expect(d.decodeData(213, report213({ x: 0, y: 0 }), 1)).toMatchObject({ x: 0, y: 0 })
    expect(d.decodeData(213, report213({ x: 32767, y: 32767 }), 2)).toMatchObject({ x: 1, y: 1 })
  })

  it("hover is in range with no contact; the In Range bit clearing ends the visit", () => {
    const d = dec()
    expect(d.hasInRange).toBe(true)
    expect(d.decodeData(213, report213({ x: 100, y: 100 }), 1)).toMatchObject({ inRange: true, tip: false, p: 0 })
    expect(d.decodeData(213, report213({ inRange: 0, x: 100, y: 100 }), 2)).toMatchObject({ inRange: false, tip: false })
  })

  it("the Null state (x / y outside 0..32767) keeps the last position instead of jumping", () => {
    const d = dec()
    d.decodeData(213, report213({ x: 20000, y: 10000 }), 1)
    const s = d.decodeData(213, report213({ x: 65535, y: 65535, tip: 1 }), 2)!
    expect(s.x).toBeCloseTo(20000 / 32767, 6)
    expect(s.y).toBeCloseTo(10000 / 32767, 6)
    expect(s.tip).toBe(true)
  })

  it("both side buttons", () => {
    const s = dec().decodeData(213, report213({ barrel: 1, secondary: 1, x: 1, y: 1 }), 1)!
    expect([s.lower, s.upper]).toEqual([true, true])
  })

  it("a report shorter than the descriptor is not decoded", () => {
    expect(dec().decodeData(213, new Uint8Array(10), 1)).toBeNull()
  })

  it("the 5 s vendor heartbeat (report 220, REAL bytes) is not a pen sample for the primary decoder", () => {
    const d = dec()
    expect(d.handles(220)).toBe(false)
    expect(d.decodeData(220, hexToBytes(realWacom.heartbeat.hex), 1)).toBeNull()
  })

  it("... while a decoder that did take report 220 would call it 'a pen in range at the left edge' (why 213 is chosen)", () => {
    const s = new PenDecoder(plan.vendor!.layout, { backend: "webhid" }).decodeData(220, hexToBytes(realWacom.heartbeat.hex), 1)!
    expect(s.inRange).toBe(true)
    expect(s.x).toBeCloseTo(0xc0 / 15200, 6)
  })
})

describe("planning other devices", () => {
  it("a model pen with one Pen collection: its report is primary, there is no vendor fallback", () => {
    const plan = planDevice([modelCollection()])
    expect(plan.primary?.reportId).toBe(7)
    expect(plan.vendor).toBeNull()
    const info = deviceInfoFor({ vendorId: 1, productId: 2 }, plan.primary!)
    expect(info.name).toBe("HID pen 1:2")
    expect(info.rawX).toEqual([0, 1000])
    expect(info.aspect).toBeCloseTo(2, 6)
    expect(info.claims).toMatchObject({ pressure: true, tilt: false, eraser: false })
    expect(new PenDecoder(plan.primary!.layout).hasInRange).toBe(false)
  })

  it("the best-scoring standard collection wins and ties go to descriptor order", () => {
    const a = modelCollection()
    const b = { ...modelCollection(), usagePage: 0x0d, usage: 0x01, inputReports: [{ ...modelCollection().inputReports![0]!, reportId: 9 }] }
    const plan = planDevice([a, b])
    // the Pen (0xd:0x2) collection scores higher than the Digitizer (0xd:0x1) one
    expect(plan.primary?.reportId).toBe(7)
    expect(planDevice([b, a]).primary?.reportId).toBe(7)
    const same = planDevice([{ ...a, usage: 1 }, b])
    expect(same.primary?.reportId).toBe(7)
  })

  it("a device with only a mouse-like pointer collection has no pen report", () => {
    const mouse = { usagePage: 1, usage: 2, inputReports: [{ reportId: 0, items: [item((1 << 16) | 0x30, 255, 8), item((1 << 16) | 0x31, 255, 8)] }] }
    const plan = planDevice([mouse])
    expect(plan.primary).toBeNull()
    expect(plan.vendor).toBeNull()
  })

  it("a vendor-only digitizer is the fallback and never the primary", () => {
    const vendorOnly = { ...modelCollection(), usagePage: 0xff00, usage: 0x0a }
    const plan = planDevice([vendorOnly])
    expect(plan.primary).toBeNull()
    expect(plan.vendor?.reportId).toBe(7)
  })

  it("the layout of the primary choice holds exactly one report", () => {
    const plan = planDevice(realWacom.collections)
    expect(plan.primary!.layout.reports.map((r) => r.reportId)).toEqual([213])
    expect(layoutFromWebHid(realWacom.collections).reports.map((r) => r.reportId).sort()).toEqual([213, 220])
    expect(pack(realReport(213), { x: 5 }, 37).length).toBe(37)
  })
})
