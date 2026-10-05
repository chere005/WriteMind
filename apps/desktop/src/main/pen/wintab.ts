/**
 * wintab.ts - Wintab as pure data (no koffi, no Electron, no Windows): constants, the LOGCONTEXTW byte layout, the packet
 * decoder, the mask ladder with its plausibility check, the adaptive proximity polarity, and the normaliser that turns a raw
 * Wintab packet into the app's PenSample (docs/spikes/DESIGN-pen-capture.md 4.2).
 *
 * Everything here is checked with synthetic buffers (test/pen/wintab.test.ts); NOTHING here has ever seen a real packet.
 * That is why the packet mask is a ladder (a layout that does not decode plausibly is dropped for a smaller one) and why the
 * proximity bit's polarity is decided from the data, not trusted.
 *
 * PACKET LAYOUT. We only ever ask for 4-byte fields (never PK_CONTEXT, an HCTX, which is 8 bytes on x64 and would bring
 * padding into it), so a packet is the present fields in the fixed order of wintab.h, tightly packed:
 *
 *   PK_STATUS(UINT) PK_TIME(DWORD) PK_CHANGED(WTPKT=DWORD) PK_SERIAL_NUMBER(UINT)
 *   PK_CURSOR(UINT) PK_BUTTONS(DWORD) PK_X PK_Y PK_Z (LONG) PK_NORMAL_PRESSURE(UINT)
 *   PK_TANGENT_PRESSURE(UINT) PK_ORIENTATION(ORIENTATION = 3 x int) PK_ROTATION(ROTATION = 3 x int)
 *
 * FRAME. Samples leave here in the DEVICE frame: x / y are the packet's position over the context's input rectangle,
 * clamped to 0..1, and y is NOT flipped (Wintab's y points up; the manager's FrameTransform absorbs that, its default guess
 * for Wintab has flipY: true, frame.ts). Buttons are not swapped anywhere: which button does what is the renderer's penSettings.
 */

import { clamp01, type PenSample } from "../../shared/pen"

// ---- constants (wintab.h) ---------------------------------------------------

export const PK = {
  CONTEXT: 0x0001, STATUS: 0x0002, TIME: 0x0004, CHANGED: 0x0008, SERIAL_NUMBER: 0x0010,
  CURSOR: 0x0020, BUTTONS: 0x0040, X: 0x0080, Y: 0x0100, Z: 0x0200,
  NORMAL_PRESSURE: 0x0400, TANGENT_PRESSURE: 0x0800, ORIENTATION: 0x1000, ROTATION: 0x2000,
} as const

/** The packet fields the app asks for first. No PK_CONTEXT, no PK_Z, no PK_TANGENT_PRESSURE, no PK_ROTATION. */
export const MASK_FULL =
  PK.STATUS | PK.TIME | PK.CHANGED | PK.SERIAL_NUMBER | PK.CURSOR | PK.BUTTONS | PK.X | PK.Y | PK.NORMAL_PRESSURE | PK.ORIENTATION
export const MASK_MIN = PK.STATUS | PK.TIME | PK.BUTTONS | PK.X | PK.Y | PK.NORMAL_PRESSURE
export const MASK_TINY = PK.X | PK.Y | PK.NORMAL_PRESSURE
/** The ladder: when the first mask's packets do not decode plausibly the context is reopened with the next one. */
export const MASK_LADDER: readonly number[] = [MASK_FULL, MASK_MIN, MASK_TINY]
export const WM_PACKET_MASK = MASK_FULL

/** pkStatus bits. TPS_PROXIMITY is "the cursor is OUT of the context" per the spec; the real driver decides (ProximityPolarity). */
export const TPS = { PROXIMITY: 0x1, QUEUE_ERR: 0x2, MARGIN: 0x4, GRAB: 0x8, INVERT: 0x10 } as const

/** lcOptions. */
export const CXO = { SYSTEM: 0x1, PEN: 0x2, MESSAGES: 0x4, CSRMESSAGES: 0x8, MGNINSIDE: 0x4000, MARGIN: 0x8000 } as const
/** lcStatus. */
export const CXS = { DISABLED: 0x1, OBSCURED: 0x2, ONTOP: 0x4 } as const
/** WTInfo categories. */
export const WTI = { INTERFACE: 1, STATUS: 2, DEFCONTEXT: 3, DEFSYSCTX: 4, DEVICES: 100, CURSORS: 200, EXTENSIONS: 300, DDCTXS: 400, DSCTXS: 500 } as const
/** Window messages posted to the context's window when CXO_MESSAGES is set (lcMsgBase 0x7ff0 by default), as offsets from the base. */
export const WT_MSG = { PACKET: 0, CTXOPEN: 1, CTXCLOSE: 2, CTXUPDATE: 3, CTXOVERLAP: 4, PROXIMITY: 5, INFOCHANGE: 6, CSRCHANGE: 7 } as const
export const WT_DEFBASE = 0x7ff0

/**
 * Pen buttons by logical number (bit n of the low word of PK_BUTTONS). The Wacom driver reports the CLICK a switch is set to, not
 * which switch it is: left = button 0, middle = button 1, right = button 2. So "lower" is the right-click button (DOM button 2, the
 * same as a Windows Ink barrel press on the page) and "upper" the middle-click one, on the sheet and on the page alike. Measured on
 * Sean's CTL-472, 2026-10-05: the button he calls his SECOND, on the driver's Right Click, arrives as 0x4; his FIRST, on Pan/Scroll,
 * arrives as nothing at all (the driver keeps it) until it is set to Middle Click in Wacom Tablet Properties. Which jobs they do is
 * renderer/penButtons.ts DEFAULT_BUTTONS.
 */
export const BTN = { TIP: 0x1, LOWER: 0x4, UPPER: 0x2 } as const

// ---- packet decoding ---------------------------------------------------------

export interface RawPacket {
  status: number
  /** The driver's clock, ms. */
  time: number
  changed: number
  serial: number
  /** Index of the cursor (transducer) in WTI_CURSORS, absolute. */
  cursor: number
  /** Low word: button states by logical number. High word: button-change code (unused here). */
  buttons: number
  x: number
  y: number
  z: number
  /** 0..axis max (32767 on this driver). */
  pressure: number
  tangentPressure: number
  /** Tenths of a degree. azimuth 0..3599, altitude -900..900 (900 = pen upright), twist 0..3599. */
  azimuth: number
  altitude: number
  twist: number
  pitch: number
  roll: number
  yaw: number
}

const FIELDS: ReadonlyArray<readonly [number, number]> = [
  [PK.CONTEXT, 8], [PK.STATUS, 4], [PK.TIME, 4], [PK.CHANGED, 4], [PK.SERIAL_NUMBER, 4], [PK.CURSOR, 4], [PK.BUTTONS, 4],
  [PK.X, 4], [PK.Y, 4], [PK.Z, 4], [PK.NORMAL_PRESSURE, 4], [PK.TANGENT_PRESSURE, 4], [PK.ORIENTATION, 12], [PK.ROTATION, 12],
]

/** Bytes in one packet for this lcPktData mask. */
export function packetSize(mask: number): number {
  let n = 0
  for (const [bit, size] of FIELDS) if (mask & bit) n += size
  return n
}

/** True when the mask has only 4-byte-field members this decoder can place without padding questions. */
export const maskIsDecodable = (mask: number): boolean => (mask & PK.CONTEXT) === 0 && (mask & ~0x3fff) === 0

/** A mask is usable when it is decodable and carries at least a position. */
export const maskIsUsable = (mask: number): boolean => maskIsDecodable(mask) && (mask & PK.X) !== 0 && (mask & PK.Y) !== 0

export function emptyPacket(): RawPacket {
  return { status: 0, time: 0, changed: 0, serial: 0, cursor: 0, buttons: 0, x: 0, y: 0, z: 0, pressure: 0, tangentPressure: 0, azimuth: 0, altitude: 0, twist: 0, pitch: 0, roll: 0, yaw: 0 }
}

/**
 * `buf` holds `count` packets back to back (as WTPacketsGet fills it); count defaults to as many whole packets as the
 * buffer holds. Fields not in `mask` are 0.
 */
export function decodeWintabPackets(buf: Uint8Array, mask: number, count?: number): RawPacket[] {
  if (!maskIsDecodable(mask)) throw new Error(`Wintab packet mask 0x${mask.toString(16)} has a field this decoder does not place (PK_CONTEXT or unknown)`)
  const size = packetSize(mask)
  if (size === 0) return []
  const whole = Math.floor(buf.byteLength / size)
  const n = Math.min(count ?? whole, whole)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: RawPacket[] = []
  for (let i = 0; i < n; i++) {
    let o = i * size
    const p = emptyPacket()
    const u32 = (): number => { const v = dv.getUint32(o, true); o += 4; return v }
    const i32 = (): number => { const v = dv.getInt32(o, true); o += 4; return v }
    if (mask & PK.STATUS) p.status = u32()
    if (mask & PK.TIME) p.time = u32()
    if (mask & PK.CHANGED) p.changed = u32()
    if (mask & PK.SERIAL_NUMBER) p.serial = u32()
    if (mask & PK.CURSOR) p.cursor = u32()
    if (mask & PK.BUTTONS) p.buttons = u32()
    if (mask & PK.X) p.x = i32()
    if (mask & PK.Y) p.y = i32()
    if (mask & PK.Z) p.z = i32()
    if (mask & PK.NORMAL_PRESSURE) p.pressure = u32()
    if (mask & PK.TANGENT_PRESSURE) p.tangentPressure = u32()
    if (mask & PK.ORIENTATION) { p.azimuth = i32(); p.altitude = i32(); p.twist = i32() }
    if (mask & PK.ROTATION) { p.pitch = i32(); p.roll = i32(); p.yaw = i32() }
    out.push(p)
  }
  return out
}

/** Inverse of the decoder, for tests and for building trace fixtures. */
export function encodeWintabPackets(packets: ReadonlyArray<Partial<RawPacket>>, mask: number): Uint8Array {
  if (!maskIsDecodable(mask)) throw new Error("mask not encodable")
  const size = packetSize(mask)
  const out = new Uint8Array(size * packets.length)
  const dv = new DataView(out.buffer)
  packets.forEach((q, i) => {
    const p = { ...emptyPacket(), ...q }
    let o = i * size
    const u32 = (v: number): void => { dv.setUint32(o, v >>> 0, true); o += 4 }
    const i32 = (v: number): void => { dv.setInt32(o, v | 0, true); o += 4 }
    if (mask & PK.STATUS) u32(p.status)
    if (mask & PK.TIME) u32(p.time)
    if (mask & PK.CHANGED) u32(p.changed)
    if (mask & PK.SERIAL_NUMBER) u32(p.serial)
    if (mask & PK.CURSOR) u32(p.cursor)
    if (mask & PK.BUTTONS) u32(p.buttons)
    if (mask & PK.X) i32(p.x)
    if (mask & PK.Y) i32(p.y)
    if (mask & PK.Z) i32(p.z)
    if (mask & PK.NORMAL_PRESSURE) u32(p.pressure)
    if (mask & PK.TANGENT_PRESSURE) u32(p.tangentPressure)
    if (mask & PK.ORIENTATION) { i32(p.azimuth); i32(p.altitude); i32(p.twist) }
    if (mask & PK.ROTATION) { i32(p.pitch); i32(p.roll); i32(p.yaw) }
  })
  return out
}

// ---- LOGCONTEXTW (212 bytes on 32 and 64 bit alike: no pointers, no padding) --

export const LOGCONTEXT_SIZE = 212

export interface LogContext {
  name: string
  options: number
  status: number
  locks: number
  msgBase: number
  device: number
  pktRate: number
  pktData: number
  pktMode: number
  moveMask: number
  btnDnMask: number
  btnUpMask: number
  inOrg: [number, number, number]
  inExt: [number, number, number]
  outOrg: [number, number, number]
  outExt: [number, number, number]
  sens: [number, number, number]
  sysMode: number
  sysOrg: [number, number]
  sysExt: [number, number]
  sysSens: [number, number]
}

const NAME_CHARS = 40

export function parseLogContext(buf: Uint8Array): LogContext {
  if (buf.byteLength < LOGCONTEXT_SIZE) throw new Error(`LOGCONTEXTW needs ${LOGCONTEXT_SIZE} bytes, got ${buf.byteLength}`)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let name = ""
  for (let i = 0; i < NAME_CHARS; i++) {
    const c = dv.getUint16(i * 2, true)
    if (c === 0) break
    name += String.fromCharCode(c)
  }
  const u = (o: number): number => dv.getUint32(o, true)
  const s = (o: number): number => dv.getInt32(o, true)
  const fix = (o: number): number => dv.getInt32(o, true) / 65536
  return {
    name, options: u(80), status: u(84), locks: u(88), msgBase: u(92), device: u(96), pktRate: u(100),
    pktData: u(104), pktMode: u(108), moveMask: u(112), btnDnMask: u(116), btnUpMask: u(120),
    inOrg: [s(124), s(128), s(132)], inExt: [s(136), s(140), s(144)],
    outOrg: [s(148), s(152), s(156)], outExt: [s(160), s(164), s(168)],
    sens: [fix(172), fix(176), fix(180)], sysMode: s(184),
    sysOrg: [s(188), s(192)], sysExt: [s(196), s(200)], sysSens: [fix(204), fix(208)],
  }
}

export function writeLogContext(c: LogContext, into: Uint8Array = new Uint8Array(LOGCONTEXT_SIZE)): Uint8Array {
  const dv = new DataView(into.buffer, into.byteOffset, into.byteLength)
  for (let i = 0; i < NAME_CHARS; i++) dv.setUint16(i * 2, i < c.name.length && i < NAME_CHARS - 1 ? c.name.charCodeAt(i) : 0, true)
  const u = (o: number, v: number): void => dv.setUint32(o, v >>> 0, true)
  const s = (o: number, v: number): void => dv.setInt32(o, v | 0, true)
  const fix = (o: number, v: number): void => dv.setInt32(o, Math.round(v * 65536), true)
  u(80, c.options); u(84, c.status); u(88, c.locks); u(92, c.msgBase); u(96, c.device); u(100, c.pktRate)
  u(104, c.pktData); u(108, c.pktMode); u(112, c.moveMask); u(116, c.btnDnMask); u(120, c.btnUpMask)
  c.inOrg.forEach((v, i) => s(124 + 4 * i, v)); c.inExt.forEach((v, i) => s(136 + 4 * i, v))
  c.outOrg.forEach((v, i) => s(148 + 4 * i, v)); c.outExt.forEach((v, i) => s(160 + 4 * i, v))
  c.sens.forEach((v, i) => fix(172 + 4 * i, v)); s(184, c.sysMode)
  s(188, c.sysOrg[0]); s(192, c.sysOrg[1]); s(196, c.sysExt[0]); s(200, c.sysExt[1])
  fix(204, c.sysSens[0]); fix(208, c.sysSens[1])
  return into
}

// ---- WTInfo structures -------------------------------------------------------

export interface WintabAxis { min: number; max: number; units: number; resolution: number }

/** AXIS = { LONG axMin, axMax; UINT axUnits; FIX32 axResolution } (16 bytes); `index` axes in a row. */
export function parseAxis(buf: Uint8Array, index = 0): WintabAxis {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const o = index * 16
  return { min: dv.getInt32(o, true), max: dv.getInt32(o + 4, true), units: dv.getUint32(o + 8, true), resolution: dv.getInt32(o + 12, true) / 65536 }
}

export interface WintabCursor {
  index: number
  name: string
  buttons: number
  /** CSR_CAPABILITIES: 1 multimode, 2 aggregate, 4 invert (an eraser end). */
  capabilities: number
  /** CSR_TYPE: the physical id type (0x4000 stylus, 0xc000 eraser, 0x8000 puck on this driver). */
  type: number
  /** Identified from its name, its CRC_INVERT capability or its physical type. */
  isEraser: boolean
}

export const CRC_INVERT = 0x4

export function isEraserCursor(c: { name: string; capabilities: number; type: number }): boolean {
  return /eras/i.test(c.name) || (c.capabilities & CRC_INVERT) !== 0 || (c.type & 0xc000) === 0xc000
}

export interface WintabDevice {
  name: string
  /** Wintab's own X / Y / pressure / orientation extents, as the DRIVER reports them (a portrait frame on this machine's cached description). */
  x: WintabAxis
  y: WintabAxis
  pressure: WintabAxis
  orientation: [WintabAxis, WintabAxis, WintabAxis]
  pktRate: number
  pktData: number
  cursors: WintabCursor[]
}

// ---- tilt --------------------------------------------------------------------

/** Tilt in degrees from Wintab's azimuth / altitude (tenths of a degree; altitude 900 = upright). */
export function tiltFromOrientation(azimuth: number, altitude: number): { tiltX: number; tiltY: number } {
  const az = (azimuth / 10) * Math.PI / 180
  const fromVertical = (90 - Math.min(90, Math.abs(altitude / 10))) * Math.PI / 180
  if (fromVertical <= 0) return { tiltX: 0, tiltY: 0 }
  const tanT = Math.tan(Math.min(fromVertical, Math.PI / 2 - 1e-6))
  const deg = (r: number): number => Math.round((r * 180 / Math.PI) * 10) / 10
  // azimuth 0 = the pen leans toward the +x edge (3 o'clock); 90 deg = toward the +y (down the page).
  return { tiltX: deg(Math.atan(tanT * Math.cos(az))), tiltY: deg(Math.atan(tanT * Math.sin(az))) }
}

// ---- normalising --------------------------------------------------------------

export interface NormaliserConfig {
  /** The context's input rectangle (lcInOrg / lcInExt, x and y). */
  inOrg: [number, number]
  inExt: [number, number]
  /** Pressure axis max (WTI_DEVICES DVC_NPRESSURE axMax). */
  pressureMax: number
  /** Orientation axes from the device; both maxima 0 means "no tilt". */
  hasTilt: boolean
  /** Cursor indices whose transducer is an eraser end (from WTI_CURSORS). */
  eraserCursors: ReadonlySet<number>
  backend?: string
  /** The mask carries PK_TIME. Without it the arrival time is the sample time. */
  hasTime?: boolean
  /** Pressure fraction above which a packet with no tip button still counts as contact (default 0: any pressure). */
  pressureTipThreshold?: number
}

export function normaliserConfigFor(device: WintabDevice, ctx: LogContext, backend = "wintab", mask = ctx.pktData): NormaliserConfig {
  return {
    inOrg: [ctx.inOrg[0], ctx.inOrg[1]],
    inExt: [ctx.inExt[0], ctx.inExt[1]],
    pressureMax: device.pressure.max || 32767,
    hasTilt: device.orientation[0].max !== 0 || device.orientation[1].max !== 0,
    eraserCursors: new Set(device.cursors.filter((c) => c.isEraser).map((c) => c.index)),
    backend,
    hasTime: (mask & PK.TIME) !== 0,
  }
}

/**
 * Raw packet -> PenSample in the DEVICE frame (see the header). Pure; the stateful parts (the clock, the proximity polarity)
 * are in WintabNormaliser. `bitMeansOut` is the proximity polarity: true is the spec (TPS_PROXIMITY set = out of the context).
 */
export function normalisePacket(raw: RawPacket, cfg: NormaliserConfig, tMs: number, bitMeansOut: boolean | null = true): PenSample {
  const ex = cfg.inExt[0] || 1
  const ey = cfg.inExt[1] || 1
  // Wintab extents can be negative (an inverted axis); the ratio handles it.
  // `+ 0` turns a -0 (an inverted axis at its origin) into 0
  const x = clamp01((raw.x - cfg.inOrg[0]) / ex) + 0
  const y = clamp01((raw.y - cfg.inOrg[1]) / ey) + 0
  const buttons = raw.buttons & 0xffff
  const p = clamp01(raw.pressure / (cfg.pressureMax || 32767))
  const eraser = (raw.status & TPS.INVERT) !== 0 || cfg.eraserCursors.has(raw.cursor)
  const bit = (raw.status & TPS.PROXIMITY) !== 0
  // bitMeansOut === null: polarity not decided yet; the bit is no evidence either way and the packet counts as in range.
  const inRange = bitMeansOut === null ? true : bitMeansOut ? !bit : bit
  const tip = (buttons & BTN.TIP) !== 0 || p > (cfg.pressureTipThreshold ?? 0)
  const sample: PenSample = {
    t: tMs, x, y, p,
    tip,
    lower: (buttons & BTN.LOWER) !== 0,
    upper: (buttons & BTN.UPPER) !== 0,
    eraser,
    inRange,
    backend: cfg.backend ?? "wintab",
  }
  if (cfg.hasTilt) {
    const t = tiltFromOrientation(raw.azimuth, raw.altitude)
    sample.tiltX = t.tiltX
    sample.tiltY = t.tiltY
  }
  return sample
}

// ---- proximity polarity (decided from the data) --------------------------------

/**
 * The spec says TPS_PROXIMITY in pkStatus means the cursor is OUT of the context. Nobody has checked the real driver, so the
 * first `window` (20) packets decide: if more than 30% of the CONTACT packets (or, with fewer than 3 of those, of all
 * packets) carry the bit, the bit must mean "in" and the polarity flips. While undecided the bit is no evidence and every
 * packet counts as in range (packets only flow while the pen is near).
 */
export class ProximityPolarity {
  private seen = 0
  private contact = 0
  private contactWithBit = 0
  private anyWithBit = 0
  private state: boolean | null = null
  private wasFlipped = false

  constructor(private readonly window = 20, private readonly threshold = 0.3) {}

  /** true = the spec (bit set means out), false = flipped (bit set means in), null = not decided yet. */
  get bitMeansOut(): boolean | null { return this.state }
  get flipped(): boolean { return this.wasFlipped }
  get decided(): boolean { return this.state !== null }

  /** Count one packet; returns "flipped" on the packet that makes it flip, "spec" when it settles on the spec, else null. */
  observe(raw: RawPacket): "flipped" | "spec" | null {
    if (this.state !== null) return null
    this.seen++
    const bit = (raw.status & TPS.PROXIMITY) !== 0
    const contact = (raw.buttons & BTN.TIP) !== 0 || raw.pressure > 0
    if (bit) this.anyWithBit++
    if (contact) { this.contact++; if (bit) this.contactWithBit++ }
    if (this.seen < this.window) return null
    const ratio = this.contact >= 3 ? this.contactWithBit / this.contact : this.anyWithBit / this.seen
    if (ratio > this.threshold) { this.state = false; this.wasFlipped = true; return "flipped" }
    this.state = true
    return "spec"
  }
}

// ---- plausibility (the mask ladder's judge) ------------------------------------

export interface PlausibilityConfig {
  inOrg: [number, number]
  inExt: [number, number]
  pressureMax: number
}

/**
 * Could this packet be real? x / y more than 1% outside the context's input rectangle, a pressure above the axis maximum, a
 * time that runs backwards by more than a second, or status bits above 0x1f all say "we are decoding the wrong layout".
 */
export function plausible(raw: RawPacket, cfg: PlausibilityConfig, prevTime: number | null = null): boolean {
  const ex = cfg.inExt[0] || 1
  const ey = cfg.inExt[1] || 1
  const u = (raw.x - cfg.inOrg[0]) / ex
  const v = (raw.y - cfg.inOrg[1]) / ey
  if (!(u >= -0.01 && u <= 1.01) || !(v >= -0.01 && v <= 1.01)) return false
  if (raw.pressure > (cfg.pressureMax || 32767)) return false
  if (prevTime !== null && raw.time < prevTime - 1000) return false
  if ((raw.status & ~0x1f) !== 0) return false
  return true
}

/** Counts implausible packets among the first `window` (20) of a context; above 30% says reopen with the next mask. */
export class PlausibilityWatch {
  private seen = 0
  private bad = 0
  private prevTime: number | null = null
  private done = false

  constructor(private readonly cfg: PlausibilityConfig, private readonly window = 20, private readonly threshold = 0.3, private readonly hasTime = true) {}

  get settled(): boolean { return this.done }
  get seenCount(): number { return this.seen }
  get badCount(): number { return this.bad }

  /** "fallback" once, on the packet that completes the window with too many implausible ones; "ok" once when it passes. */
  observe(raw: RawPacket): "fallback" | "ok" | null {
    if (this.done) return null
    this.seen++
    if (!plausible(raw, this.cfg, this.hasTime ? this.prevTime : null)) this.bad++
    if (this.hasTime) this.prevTime = raw.time
    if (this.seen < this.window) return null
    this.done = true
    return this.bad / this.seen > this.threshold ? "fallback" : "ok"
  }
}

// ---- the clock ---------------------------------------------------------------

/**
 * PK_TIME is the driver's millisecond clock (its zero is not ours). Keep the smallest (arrival - PK_TIME) seen: that is the
 * offset with the least queueing delay in it, and it never goes backwards by more than jitter. The result is in the epoch
 * clock of PenSample.t.
 */
export class ClockAligner {
  private offset = Number.POSITIVE_INFINITY
  align(pkTime: number, arrivedAtMs: number): number {
    const o = arrivedAtMs - pkTime
    if (o < this.offset) this.offset = o
    return pkTime + this.offset
  }
  /** Fold in an arrival without producing a time (the newest packet of a batch has the least queueing in it). */
  observe(pkTime: number, arrivedAtMs: number): void {
    const o = arrivedAtMs - pkTime
    if (o < this.offset) this.offset = o
  }
  reset(): void { this.offset = Number.POSITIVE_INFINITY }
}

/** WT_PROXIMITY: LOWORD(lParam) non-zero = the cursor entered the context, HIWORD = entered hardware proximity. */
export function parseProximityMessage(lParam: number | bigint): { enteredContext: boolean; enteredHardware: boolean } {
  const v = Number(BigInt.asUintN(32, BigInt(lParam)))
  return { enteredContext: (v & 0xffff) !== 0, enteredHardware: ((v >>> 16) & 0xffff) !== 0 }
}

/**
 * Stateful wrapper: aligns the clock, learns the proximity polarity, and turns packets into samples. It does NOT decide when
 * a visit ends (that is the VisitTracker's job, batcher.ts).
 */
/** Contact starts at this pressure (fraction of the context's real pressure axis) or with the tip button, and lasts while it stays above the lower one: a debounce, not a delay. */
export const TIP_DOWN_PRESSURE = 0.01
export const TIP_UP_PRESSURE = 0.004

export class WintabNormaliser {
  private readonly clock = new ClockAligner()
  readonly polarity: ProximityPolarity
  private contact = false

  constructor(private cfg: NormaliserConfig, polarity: ProximityPolarity = new ProximityPolarity()) {
    this.polarity = polarity
  }

  setConfig(cfg: NormaliserConfig): void { this.cfg = cfg }

  /**
   * Packets that arrived together in one poll: the NEWEST one has waited least, so it sets the clock offset first and the older
   * ones keep their true spacing (pushing them one by one would squash a 10 ms gap to 0). `onPolarity` hears a flip.
   */
  pushBatch(raws: readonly RawPacket[], arrivedAtMs: number, onPolarity?: (outcome: "flipped" | "spec") => void): PenSample[] {
    const hasTime = this.cfg.hasTime !== false
    const newest = raws[raws.length - 1]
    if (newest && hasTime) this.clock.observe(newest.time, arrivedAtMs)
    const out: PenSample[] = []
    for (const r of raws) {
      const outcome = this.polarity.observe(r)
      if (outcome && onPolarity) onPolarity(outcome)
      const s = normalisePacket(r, this.cfg, hasTime ? this.clock.align(r.time, arrivedAtMs) : arrivedAtMs, this.polarity.bitMeansOut)
      // Tip: the button, or pressure with a little hysteresis, so a hovering pen's noise never flickers the contact.
      const button = (r.buttons & BTN.TIP) !== 0
      this.contact = button || (this.contact ? s.p >= TIP_UP_PRESSURE : s.p >= TIP_DOWN_PRESSURE)
      s.tip = this.contact
      out.push(s)
    }
    return out
  }
}
