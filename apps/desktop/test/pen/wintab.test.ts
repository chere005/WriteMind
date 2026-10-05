// Wintab, pure half (main/pen/wintab.ts). Ported from the Wintab spike's wintab.test.ts (C:\CLAUDIO\spikes\wintab-spike\wintab.test.ts):
// the decoder, LOGCONTEXTW, the normaliser, the clock; the frame inference moved to frame.ts (test/pen/frame.test.ts). New in the repo:
// the adaptive proximity polarity, the plausibility watch and the mask ladder, pushBatch. Synthetic buffers only; nothing here has seen a
// real packet.
import { describe, expect, it } from "vitest"
import { applyFrame } from "../../src/shared/pen"
import { tabletToSheet } from "../../src/shared/orientation"
import { defaultFrame } from "../../src/main/pen/frame"
import {
  BTN, ClockAligner, CXO, LOGCONTEXT_SIZE, MASK_FULL, MASK_LADDER, MASK_MIN, MASK_TINY, PK, PlausibilityWatch, ProximityPolarity, TPS, WT_DEFBASE, WT_MSG,
  WintabNormaliser, decodeWintabPackets, encodeWintabPackets, isEraserCursor, maskIsDecodable, maskIsUsable, normaliserConfigFor, normalisePacket,
  packetSize, parseAxis, parseLogContext, parseProximityMessage, plausible, tiltFromOrientation, writeLogContext,
  type NormaliserConfig, type RawPacket, type WintabDevice,
} from "../../src/main/pen/wintab"

const cfg = (over: Partial<NormaliserConfig> = {}): NormaliserConfig => ({
  inOrg: [0, 0], inExt: [9500, 15200], pressureMax: 32767, hasTilt: false, eraserCursors: new Set([2, 5]), backend: "wintab", ...over,
})
const blank = (): RawPacket => decodeWintabPackets(encodeWintabPackets([{}], MASK_FULL), MASK_FULL)[0]!

describe("packet layout", () => {
  it("sizes the app's mask: 10 four-byte fields + a 12-byte orientation", () => {
    expect(packetSize(MASK_FULL)).toBe(48)
    expect(packetSize(MASK_MIN)).toBe(24)
    expect(packetSize(MASK_TINY)).toBe(12)
    expect(packetSize(PK.X | PK.Y)).toBe(8)
    expect(packetSize(PK.STATUS | PK.TIME | PK.CHANGED | PK.SERIAL_NUMBER | PK.CURSOR | PK.BUTTONS | PK.X | PK.Y | PK.Z | PK.NORMAL_PRESSURE | PK.TANGENT_PRESSURE)).toBe(44)
    expect(packetSize(PK.CONTEXT | PK.X)).toBe(12)
  })
  it("the ladder goes from the fullest mask to the tiniest and every rung is usable", () => {
    expect(MASK_LADDER).toEqual([MASK_FULL, MASK_MIN, MASK_TINY])
    for (const m of MASK_LADDER) expect(maskIsUsable(m)).toBe(true)
    const sizes = MASK_LADDER.map(packetSize)
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes)
  })
  it("refuses a mask with PK_CONTEXT (the one 8-byte field) or without a position", () => {
    expect(maskIsDecodable(MASK_FULL)).toBe(true)
    expect(maskIsDecodable(PK.CONTEXT | PK.X)).toBe(false)
    expect(maskIsUsable(PK.STATUS | PK.TIME)).toBe(false)
    expect(maskIsUsable(0x8000)).toBe(false)
    expect(() => decodeWintabPackets(new Uint8Array(64), PK.CONTEXT | PK.X)).toThrow()
    expect(() => encodeWintabPackets([{}], PK.CONTEXT | PK.X)).toThrow()
  })
  it("decodes fields in the wintab.h order, little endian, from a hand-built buffer", () => {
    const mask = PK.STATUS | PK.TIME | PK.BUTTONS | PK.X | PK.Y | PK.NORMAL_PRESSURE
    const b = new Uint8Array(24)
    const dv = new DataView(b.buffer)
    dv.setUint32(0, 0x10, true); dv.setUint32(4, 123456, true); dv.setUint32(8, 0x00050003, true)
    dv.setInt32(12, 4000, true); dv.setInt32(16, -17, true); dv.setUint32(20, 32767, true)
    const [p] = decodeWintabPackets(b, mask)
    expect(p).toMatchObject({ status: 0x10, time: 123456, buttons: 0x00050003, x: 4000, y: -17, pressure: 32767, cursor: 0 })
  })
  it("decodes many packets and a count smaller than the buffer", () => {
    const pk = (i: number): Partial<RawPacket> => ({ status: 0, time: 1000 + i * 10, cursor: 1, buttons: i % 2, x: 100 * i, y: 9000 - i, pressure: i * 100, azimuth: 450, altitude: 700, twist: 0 })
    const buf = encodeWintabPackets([0, 1, 2, 3, 4].map(pk), MASK_FULL)
    expect(buf.byteLength).toBe(5 * 48)
    const all = decodeWintabPackets(buf, MASK_FULL)
    expect(all).toHaveLength(5)
    expect(all[3]).toMatchObject({ time: 1030, x: 300, y: 8997, pressure: 300, buttons: 1, azimuth: 450, altitude: 700, cursor: 1 })
    expect(decodeWintabPackets(buf, MASK_FULL, 2)).toHaveLength(2)
  })
  it("ignores a trailing partial packet and a count beyond the buffer", () => {
    const buf = encodeWintabPackets([{ x: 1 }, { x: 2 }], PK.X | PK.Y)
    expect(decodeWintabPackets(buf.subarray(0, 12), PK.X | PK.Y)).toHaveLength(1)
    expect(decodeWintabPackets(buf, PK.X | PK.Y, 99)).toHaveLength(2)
  })
  it("decodes from a subarray with a non-zero byteOffset", () => {
    const buf = encodeWintabPackets([{ x: 11, y: 22 }, { x: 33, y: 44 }], PK.X | PK.Y)
    const padded = new Uint8Array(buf.length + 5)
    padded.set(buf, 5)
    expect(decodeWintabPackets(padded.subarray(5), PK.X | PK.Y).map((p) => [p.x, p.y])).toEqual([[11, 22], [33, 44]])
  })
  it("round-trips all 4-byte fields incl. rotation", () => {
    const mask = PK.STATUS | PK.TIME | PK.CHANGED | PK.SERIAL_NUMBER | PK.CURSOR | PK.BUTTONS | PK.X | PK.Y | PK.Z | PK.NORMAL_PRESSURE | PK.TANGENT_PRESSURE | PK.ORIENTATION | PK.ROTATION
    const src: Partial<RawPacket> = { status: 1, time: 2, changed: 3, serial: 4, cursor: 5, buttons: 6, x: -7, y: 8, z: -9, pressure: 10, tangentPressure: 11, azimuth: 12, altitude: -13, twist: 14, pitch: 15, roll: -16, yaw: 17 }
    const [p] = decodeWintabPackets(encodeWintabPackets([src], mask), mask)
    expect(p).toMatchObject(src)
  })
  it("the same packet decodes the same through every rung of the ladder (the fields they share)", () => {
    const src: Partial<RawPacket> = { status: 0, time: 777, buttons: BTN.TIP, x: 1234, y: 4321, pressure: 999 }
    for (const mask of [MASK_FULL, MASK_MIN]) {
      const [p] = decodeWintabPackets(encodeWintabPackets([src], mask), mask)
      expect(p).toMatchObject({ time: 777, buttons: BTN.TIP, x: 1234, y: 4321, pressure: 999 })
    }
    const [t] = decodeWintabPackets(encodeWintabPackets([src], MASK_TINY), MASK_TINY)
    expect(t).toMatchObject({ x: 1234, y: 4321, pressure: 999, time: 0, buttons: 0 })
  })
})

describe("LOGCONTEXTW", () => {
  it("is 212 bytes and survives a round trip incl. FIX32 and negative extents", () => {
    const c = parseLogContext(new Uint8Array(LOGCONTEXT_SIZE))
    c.name = "WriteMind pen 1234"
    Object.assign(c, { options: CXO.MESSAGES | CXO.SYSTEM, status: 4, msgBase: WT_DEFBASE, device: 0, pktRate: 100, pktData: MASK_FULL, moveMask: MASK_FULL, btnDnMask: 0xffffffff, btnUpMask: 0xffffffff })
    c.inExt = [9500, 15200, 0]; c.outExt = [9500, -15200, 0]; c.outOrg = [0, 15200, 0]; c.sens = [1, 1.5, 1]; c.sysOrg = [1280, 0]; c.sysExt = [640, 1200]; c.sysSens = [1, 1]
    const back = parseLogContext(writeLogContext(c))
    expect(back).toEqual(c)
    expect(writeLogContext(c).byteLength).toBe(LOGCONTEXT_SIZE)
  })
  it("puts fields where the driver's own dump had them (offsets measured on the Wacom driver)", () => {
    const b = new Uint8Array(LOGCONTEXT_SIZE)
    const dv = new DataView(b.buffer)
    dv.setUint32(80, 0x8010, true); dv.setUint32(92, 0x7ff0, true); dv.setUint32(100, 100, true); dv.setUint32(104, 0x1c0, true)
    dv.setInt32(136, 9500, true); dv.setInt32(140, 15200, true); dv.setInt32(160, 15200, true); dv.setInt32(164, 9500, true)
    dv.setInt32(196, 1920, true); dv.setInt32(200, 1200, true)
    expect(parseLogContext(b)).toMatchObject({ options: 0x8010, msgBase: 0x7ff0, pktRate: 100, pktData: 0x1c0, inExt: [9500, 15200, 0], outExt: [15200, 9500, 0], sysExt: [1920, 1200] })
  })
  it("truncates a long name and rejects a short buffer", () => {
    const c = parseLogContext(new Uint8Array(LOGCONTEXT_SIZE))
    c.name = "x".repeat(60)
    expect(parseLogContext(writeLogContext(c)).name).toHaveLength(39)
    expect(() => parseLogContext(new Uint8Array(100))).toThrow()
  })
  it("writes into a given buffer without moving it", () => {
    const into = new Uint8Array(LOGCONTEXT_SIZE)
    const c = parseLogContext(into)
    c.name = "WriteMind pen 1"
    expect(writeLogContext(c, into)).toBe(into)
    expect(parseLogContext(into).name).toBe("WriteMind pen 1")
  })
})

describe("WTInfo structures", () => {
  it("reads an AXIS and a row of three (the values this Wacom reported)", () => {
    const b = new Uint8Array(48)
    const dv = new DataView(b.buffer)
    dv.setInt32(16, -900, true); dv.setInt32(20, 900, true); dv.setUint32(24, 3, true); dv.setInt32(28, 3600 * 65536, true)
    expect(parseAxis(b, 1)).toEqual({ min: -900, max: 900, units: 3, resolution: 3600 })
    expect(parseAxis(b, 0)).toEqual({ min: 0, max: 0, units: 0, resolution: 0 })
  })
  it("spots an eraser by name, by CRC_INVERT or by physical type", () => {
    expect(isEraserCursor({ name: "Eraser  ", capabilities: 5, type: 0xc000 })).toBe(true)
    expect(isEraserCursor({ name: "Pressure Stylus", capabilities: 1, type: 0x4000 })).toBe(false)
    expect(isEraserCursor({ name: "Pen", capabilities: 4, type: 0x4000 })).toBe(true)
    expect(isEraserCursor({ name: "Puck", capabilities: 0, type: 0x8000 })).toBe(false)
  })
  it("normaliserConfigFor builds the config from a device, the stored context and the mask", () => {
    const dev: WintabDevice = {
      name: "WACOM Tablet", x: { min: 0, max: 9499, units: 0, resolution: 0 }, y: { min: 0, max: 15199, units: 0, resolution: 0 },
      pressure: { min: 0, max: 32767, units: 0, resolution: 0 },
      orientation: [{ min: 0, max: 0, units: 0, resolution: 0 }, { min: 0, max: 0, units: 0, resolution: 0 }, { min: 0, max: 0, units: 0, resolution: 0 }],
      pktRate: 100, pktData: MASK_FULL,
      cursors: [
        { index: 1, name: "Pressure Stylus", buttons: 3, capabilities: 1, type: 0x4000, isEraser: false },
        { index: 2, name: "Eraser", buttons: 1, capabilities: 5, type: 0xc000, isEraser: true },
      ],
    }
    const ctx = parseLogContext(new Uint8Array(LOGCONTEXT_SIZE))
    ctx.inExt = [9500, 15200, 0]
    const c = normaliserConfigFor(dev, ctx, "wintab", MASK_MIN)
    expect(c).toMatchObject({ inOrg: [0, 0], inExt: [9500, 15200], pressureMax: 32767, hasTilt: false, hasTime: true, backend: "wintab" })
    expect([...c.eraserCursors]).toEqual([2])
    expect(normaliserConfigFor(dev, ctx, "wintab", MASK_TINY).hasTime).toBe(false)
  })
})

describe("normalising (device frame: y is NOT flipped, nothing is rotated)", () => {
  it("scales pressure and reads the three pen buttons (tip, right click = lower, middle click = upper)", () => {
    const s = normalisePacket({ ...blank(), pressure: 16383, buttons: BTN.TIP | BTN.UPPER, x: 4750, y: 7600 }, cfg(), 5)
    expect(s.p).toBeCloseTo(0.5, 3)
    expect(s).toMatchObject({ tip: true, lower: false, upper: true, eraser: false, inRange: true, backend: "wintab", t: 5, x: 0.5, y: 0.5 })
    expect(normalisePacket({ ...blank(), buttons: BTN.LOWER }, cfg(), 0)).toMatchObject({ tip: false, lower: true, upper: false, p: 0 })
    // Sean's CTL-472: the lower switch (Right Click) arrives as 0x4, a Middle Click switch as 0x2
    expect(normalisePacket({ ...blank(), buttons: 0x4 }, cfg(), 0)).toMatchObject({ lower: true, upper: false })
    expect(normalisePacket({ ...blank(), buttons: 0x2 }, cfg(), 0)).toMatchObject({ lower: false, upper: true })
  })
  it("pressure with no tip bit still counts as a tip; a threshold can demand more", () => {
    expect(normalisePacket({ ...blank(), pressure: 5 }, cfg(), 0).tip).toBe(true)
    expect(normalisePacket({ ...blank(), pressure: 5 }, cfg({ pressureTipThreshold: 0.01 }), 0).tip).toBe(false)
    expect(normalisePacket({ ...blank(), pressure: 5, buttons: BTN.TIP }, cfg({ pressureTipThreshold: 0.01 }), 0).tip).toBe(true)
  })
  it("ignores the high word of PK_BUTTONS (button-change code)", () => {
    expect(normalisePacket({ ...blank(), buttons: 0x00020000 }, cfg(), 0)).toMatchObject({ tip: false, lower: false, upper: false })
  })
  it("flags the eraser by cursor index or by TPS_INVERT", () => {
    expect(normalisePacket({ ...blank(), cursor: 2 }, cfg(), 0).eraser).toBe(true)
    expect(normalisePacket({ ...blank(), cursor: 1 }, cfg(), 0).eraser).toBe(false)
    expect(normalisePacket({ ...blank(), cursor: 1, status: TPS.INVERT }, cfg(), 0).eraser).toBe(true)
  })
  it("Sean's pen has no eraser end: its cursors (1 and 4) never set eraser", () => {
    for (const cursor of [1, 4]) expect(normalisePacket({ ...blank(), cursor, pressure: 100 }, cfg(), 0).eraser).toBe(false)
  })
  it("the spec's proximity polarity: TPS_PROXIMITY set = out of range", () => {
    expect(normalisePacket({ ...blank(), status: TPS.PROXIMITY }, cfg(), 0, true).inRange).toBe(false)
    expect(normalisePacket({ ...blank(), status: 0 }, cfg(), 0, true).inRange).toBe(true)
  })
  it("a flipped polarity reads the same bit the other way; undecided counts every packet as in range", () => {
    expect(normalisePacket({ ...blank(), status: TPS.PROXIMITY }, cfg(), 0, false).inRange).toBe(true)
    expect(normalisePacket({ ...blank(), status: 0 }, cfg(), 0, false).inRange).toBe(false)
    expect(normalisePacket({ ...blank(), status: TPS.PROXIMITY }, cfg(), 0, null).inRange).toBe(true)
    expect(normalisePacket({ ...blank(), status: 0 }, cfg(), 0, null).inRange).toBe(true)
  })
  it("a landscape raw frame: corners keep their raw orientation (y up stays y up), the frame transform does the rest", () => {
    const c = cfg({ inExt: [15200, 9500] })
    expect(normalisePacket({ ...blank(), x: 0, y: 9500 }, c, 0)).toMatchObject({ x: 0, y: 1 })
    expect(normalisePacket({ ...blank(), x: 15200, y: 0 }, c, 0)).toMatchObject({ x: 1, y: 0 })
    expect(normalisePacket({ ...blank(), x: 7600, y: 4750 }, c, 0)).toMatchObject({ x: 0.5, y: 0.5 })
    // with the default landscape guess (flipY) the y-up corners land top-left / bottom-right
    const f = defaultFrame(15200, 9500)
    expect(f).toEqual({ turn: 0, flipY: true })
    expect(applyFrame(0, 1, f)).toEqual([0, 0])
    expect(applyFrame(1, 0, f)).toEqual([1, 1])
  })
  it("a portrait raw frame (what this driver reports) is turned to landscape {turn 1, flipY}", () => {
    const f = defaultFrame(9499, 15199)
    expect(f).toEqual({ turn: 1, flipY: true })
    const corners = [[0, 0], [9500, 0], [0, 15200], [9500, 15200]].map(([x, y]) => {
      const s = normalisePacket({ ...blank(), x: x!, y: y! }, cfg(), 0)
      return applyFrame(s.x, s.y, f)
    })
    expect(new Set(corners.map((c) => c.join(","))).size).toBe(4)
    for (const [x, y] of corners) { expect(x === 0 || x === 1).toBe(true); expect(y === 0 || y === 1).toBe(true) }
  })
  it("Sean's Intuos S in Portrait (flipped): 1 2 / 3 4 written in the tablet's corners land in the sheet's corners, NOT mirrored", () => {
    // 2026-10-05, the tablet turned with its LED at the bottom and Portrait (flipped) picked: the device (y as delivered, up) of each corner
    // as the tablet then lay. Under the frame that morning ({turn 1}, no flipY) the four came out mirrored top-to-bottom.
    const f = defaultFrame(9499, 15199)
    const corner = (x: number, y: number) => {
      const [u, v] = applyFrame(x, y, f)
      const p = tabletToSheet({ x: u, y: v }, 3)
      return [Math.round(p.x), Math.round(p.y)]
    }
    expect(corner(0, 1)).toEqual([0, 0]) // 1, top-left
    expect(corner(1, 1)).toEqual([1, 0]) // 2, top-right
    expect(corner(0, 0)).toEqual([0, 1]) // 3, bottom-left
    expect(corner(1, 0)).toEqual([1, 1]) // 4, bottom-right
    // and that morning's two corner touches (top-left, bottom-right), made in the same position, agree
    expect(corner(0.069, 0.97)).toEqual([0, 0])
    expect(corner(0.993, 0)).toEqual([1, 1])
  })
  it("clamps outside the active area and survives a zero extent", () => {
    const s = normalisePacket({ ...blank(), x: -50, y: 99999 }, cfg({ inExt: [15200, 9500] }), 0)
    expect(s.x).toBe(0); expect(s.y).toBe(1)
    expect(Number.isFinite(normalisePacket({ ...blank(), x: 5, y: 5 }, cfg({ inExt: [0, 0] }), 0).x)).toBe(true)
  })
  it("an inverted (negative) extent flips the axis", () => {
    const c = cfg({ inOrg: [15200, 0], inExt: [-15200, 9500] })
    expect(normalisePacket({ ...blank(), x: 15200, y: 0 }, c, 0)).toMatchObject({ x: 0, y: 0 })
    expect(normalisePacket({ ...blank(), x: 0, y: 9500 }, c, 0)).toMatchObject({ x: 1, y: 1 })
  })
  it("tilt only when the device reports it", () => {
    expect(normalisePacket({ ...blank(), azimuth: 0, altitude: 900 }, cfg(), 0).tiltX).toBeUndefined()
    const t = normalisePacket({ ...blank(), azimuth: 0, altitude: 450 }, cfg({ hasTilt: true }), 0)
    expect(t.tiltX).toBeCloseTo(45, 0)
    expect(t.tiltY).toBeCloseTo(0, 0)
  })
  it("tilt maths: upright is 0, leaning toward +y at 45 deg is tiltY 45, a negative altitude (inverted pen) the same", () => {
    expect(tiltFromOrientation(0, 900)).toEqual({ tiltX: 0, tiltY: 0 })
    const t = tiltFromOrientation(900, 450)
    expect(t.tiltY).toBeCloseTo(45, 0)
    expect(Math.abs(t.tiltX)).toBeLessThan(0.5)
    expect(tiltFromOrientation(900, -450).tiltY).toBeCloseTo(45, 0)
  })
})

describe("the proximity bit's polarity is decided from the data", () => {
  const packet = (status: number, contact: boolean): RawPacket => ({ ...blank(), status, buttons: contact ? BTN.TIP : 0, pressure: contact ? 1000 : 0 })

  it("starts undecided, and stays so until it has seen 20 packets", () => {
    const p = new ProximityPolarity()
    expect(p.bitMeansOut).toBeNull()
    for (let i = 0; i < 19; i++) expect(p.observe(packet(0, true))).toBeNull()
    expect(p.decided).toBe(false)
    expect(p.observe(packet(0, true))).toBe("spec")
    expect(p.decided).toBe(true)
  })
  it("a driver that follows the spec (the bit is rarely set while the pen touches) keeps the spec polarity", () => {
    const p = new ProximityPolarity()
    let outcome = null
    for (let i = 0; i < 20; i++) outcome = p.observe(packet(i === 5 ? TPS.PROXIMITY : 0, i > 2))
    expect(outcome).toBe("spec")
    expect(p.bitMeansOut).toBe(true)
    expect(p.flipped).toBe(false)
  })
  it("a driver that sets the bit while the pen is IN the context flips the polarity", () => {
    const p = new ProximityPolarity()
    let outcome = null
    for (let i = 0; i < 20; i++) outcome = p.observe(packet(TPS.PROXIMITY, true))
    expect(outcome).toBe("flipped")
    expect(p.bitMeansOut).toBe(false)
    expect(p.flipped).toBe(true)
  })
  it("with fewer than 3 contact packets it judges all packets (a hovering pen sets the bit on most of them if it means 'in')", () => {
    const flip = new ProximityPolarity()
    let a = null
    for (let i = 0; i < 20; i++) a = flip.observe(packet(i < 12 ? TPS.PROXIMITY : 0, false))
    expect(a).toBe("flipped")
    const keep = new ProximityPolarity()
    let b = null
    for (let i = 0; i < 20; i++) b = keep.observe(packet(i < 2 ? TPS.PROXIMITY : 0, false))
    expect(b).toBe("spec")
  })
  it("decides once: later packets change nothing", () => {
    const p = new ProximityPolarity()
    for (let i = 0; i < 20; i++) p.observe(packet(0, true))
    expect(p.observe(packet(TPS.PROXIMITY, true))).toBeNull()
    expect(p.bitMeansOut).toBe(true)
  })
})

describe("plausibility and the mask ladder", () => {
  const pc = { inOrg: [0, 0] as [number, number], inExt: [9500, 15200] as [number, number], pressureMax: 32767 }
  const good = (i = 0): RawPacket => ({ ...blank(), time: 1000 + i * 10, x: 4000 + i, y: 8000 - i, pressure: 1000 })

  it("accepts a packet inside the context's input rectangle", () => {
    expect(plausible(good(), pc)).toBe(true)
    expect(plausible({ ...good(), x: 9500, y: 15200 }, pc)).toBe(true)
    expect(plausible({ ...good(), x: -50, y: 15250 }, pc)).toBe(true) // within 1%
  })
  it("rejects a position far outside, a pressure above the axis, a time running backwards by over a second, and unknown status bits", () => {
    expect(plausible({ ...good(), x: 50000 }, pc)).toBe(false)
    expect(plausible({ ...good(), y: -4000 }, pc)).toBe(false)
    expect(plausible({ ...good(), pressure: 40000 }, pc)).toBe(false)
    expect(plausible({ ...good(), time: 100 }, pc, 5000)).toBe(false)
    expect(plausible({ ...good(), time: 4500 }, pc, 5000)).toBe(true)
    expect(plausible({ ...good(), status: 0x4000 }, pc)).toBe(false)
  })
  it("a stream of good packets passes after 20; settled exactly once", () => {
    const w = new PlausibilityWatch(pc)
    let verdict = null
    for (let i = 0; i < 19; i++) expect(w.observe(good(i))).toBeNull()
    verdict = w.observe(good(19))
    expect(verdict).toBe("ok")
    expect(w.settled).toBe(true)
    expect(w.observe(good(20))).toBeNull()
  })
  it("scrambled fields (a layout that does not fit the driver's) trigger the fallback: over 30% implausible", () => {
    // what MASK_FULL bytes look like when read as MASK_MIN: time lands in x, etc.
    const w = new PlausibilityWatch(pc)
    let verdict: string | null = null
    for (let i = 0; i < 20; i++) verdict = w.observe({ ...good(i), x: 1_000_000 + i, pressure: 4_000_000_000 }) ?? verdict
    expect(verdict).toBe("fallback")
    expect(w.badCount).toBe(20)
  })
  it("a few bad packets are tolerated (at most 30% of the first 20)", () => {
    const w = new PlausibilityWatch(pc)
    let verdict: string | null = null
    for (let i = 0; i < 20; i++) verdict = w.observe(i % 5 === 0 ? { ...good(i), x: 99999 } : good(i)) ?? verdict
    expect(w.badCount).toBe(4)
    expect(verdict).toBe("ok")
  })
  it("without PK_TIME in the mask the time test is skipped", () => {
    const w = new PlausibilityWatch(pc, 20, 0.3, false)
    let verdict: string | null = null
    for (let i = 0; i < 20; i++) verdict = w.observe({ ...good(i), time: 5000 - i * 5000 }) ?? verdict
    expect(verdict).toBe("ok")
  })
})

describe("clock alignment and batches", () => {
  it("maps the driver clock onto ours with the least-delay offset and never runs backwards", () => {
    const c = new ClockAligner()
    expect(c.align(1000, 51_000)).toBe(51_000)
    expect(c.align(1010, 51_040)).toBe(51_010) // queued 30 ms: must not push the clock forward
    expect(c.align(1020, 51_015)).toBe(51_015) // a better offset is adopted once
    expect(c.align(1030, 51_050)).toBe(51_025)
    c.reset()
    expect(c.align(5, 100)).toBe(100)
  })
  it("a batch that arrives together keeps its 10 ms spacing (the newest packet sets the offset)", () => {
    const n = new WintabNormaliser(cfg())
    const raws = [0, 1, 2].map((i) => ({ ...blank(), time: 1000 + i * 10, x: 100 + i, y: 100 }))
    const out = n.pushBatch(raws, 51_050)
    expect(out.map((s) => s.t)).toEqual([51_030, 51_040, 51_050])
  })
  it("without PK_TIME the arrival time is the sample time", () => {
    const n = new WintabNormaliser(cfg({ hasTime: false }))
    const out = n.pushBatch([{ ...blank(), x: 1 }, { ...blank(), x: 2 }], 777)
    expect(out.map((s) => s.t)).toEqual([777, 777])
  })
  it("the normaliser learns the polarity as the packets pass and tells the caller once", () => {
    const n = new WintabNormaliser(cfg())
    const seen: string[] = []
    const raws = Array.from({ length: 20 }, (_, i) => ({ ...blank(), time: i, buttons: BTN.TIP, pressure: 500, status: TPS.PROXIMITY }))
    const out = n.pushBatch(raws, 100, (o) => seen.push(o))
    expect(seen).toEqual(["flipped"])
    expect(out[0]!.inRange).toBe(true) // undecided: the bit is no evidence
    expect(n.polarity.bitMeansOut).toBe(false)
    const after = n.pushBatch([{ ...blank(), time: 30, status: TPS.PROXIMITY, buttons: BTN.TIP, pressure: 500 }, { ...blank(), time: 40, status: 0 }], 200)
    expect(after.map((s) => s.inRange)).toEqual([true, false]) // flipped: the bit set means IN
  })
})

describe("WT_PROXIMITY message", () => {
  it("LOWORD = entering the context, HIWORD = entering hardware proximity", () => {
    expect(parseProximityMessage(0x0001_0001)).toEqual({ enteredContext: true, enteredHardware: true })
    expect(parseProximityMessage(0x0000_0000)).toEqual({ enteredContext: false, enteredHardware: false })
    expect(parseProximityMessage(0x0001_0000)).toEqual({ enteredContext: false, enteredHardware: true })
  })
  it("takes a bigint lParam (a koffi callback hands over 64 bits) and ignores the upper half", () => {
    expect(parseProximityMessage(0xffff_ffff_0000_0001n)).toEqual({ enteredContext: true, enteredHardware: false })
  })
  it("the message numbers are offsets from the default base 0x7ff0", () => {
    expect(WT_DEFBASE).toBe(0x7ff0)
    expect(WT_MSG).toMatchObject({ PACKET: 0, CTXCLOSE: 2, PROXIMITY: 5, INFOCHANGE: 6 })
  })
})
