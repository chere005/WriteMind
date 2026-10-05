/**
 * hid/hidNative.ts - Windows-only FFI (koffi): enumerate Raw Input devices, fetch a device's preparsed data, read its HID
 * capabilities, and PROBE a bit layout from Windows' own parser (hid.dll). Everything here runs once per device at open
 * time; the per-sample decode is the pure code in decoder.ts.
 *
 * All structs are handled as Buffers with explicit x64 offsets (the app only ships 64-bit Windows; `loadWin32()` refuses
 * anything else) so there is no koffi struct state to leak and every offset is visible in this one place.
 *
 *   HIDP_CAPS               64 bytes     HIDP_VALUE_CAPS / HIDP_BUTTON_CAPS   72 bytes     HIDP_LINK_COLLECTION_NODE   24 bytes
 *   RAWINPUTDEVICELIST      16 bytes     RID_DEVICE_INFO                     32 bytes (we read the HID member)
 */

import { bind, canaryBuffer, isWin32, loadWin32, type CanaryBuffer } from "../win32"
import type { ProbeButtonField, ProbeLayout, ProbeReport, ProbeValueField } from "./fromHidP"

export const RIM_TYPEMOUSE = 0
export const RIM_TYPEKEYBOARD = 1
export const RIM_TYPEHID = 2
export const RIDI_PREPARSEDDATA = 0x20000005
export const RIDI_DEVICENAME = 0x20000007
export const RIDI_DEVICEINFO = 0x2000000b
export const HIDP_STATUS_SUCCESS = 0x110000

export interface RawDevice {
  handle: bigint
  type: 0 | 1 | 2
  name: string
  vendorId: number
  productId: number
  usagePage: number
  usage: number
}

export interface ValueCap {
  page: number
  reportId: number
  link: number
  linkUsage: number
  linkPage: number
  isRange: boolean
  isAbsolute: boolean
  hasNull: boolean
  bitSize: number
  reportCount: number
  unitsExp: number
  units: number
  logicalMin: number
  logicalMax: number
  physicalMin: number
  physicalMax: number
  usageMin: number
  usageMax: number
}

export interface ButtonCap {
  page: number
  reportId: number
  link: number
  isRange: boolean
  isAbsolute: boolean
  usageMin: number
  usageMax: number
}

export interface DeviceCaps {
  usage: number
  usagePage: number
  inputReportByteLength: number
  outputReportByteLength: number
  featureReportByteLength: number
  numberLinkCollectionNodes: number
  numberInputButtonCaps: number
  numberInputValueCaps: number
  valueCaps: ValueCap[]
  buttonCaps: ButtonCap[]
  nodes: { index: number; usage: number; page: number; parent: number; children: number; type: number }[]
}

interface HidApi {
  GetRawInputDeviceList: (list: Buffer | null, num: number[], cb: number) => number
  GetRawInputDeviceInfoW: (h: bigint, cmd: number, data: Buffer | null, cb: number[]) => number
  HidP_GetCaps: (pp: Buffer, caps: Buffer) => number
  HidP_GetValueCaps: (type: number, caps: Buffer, len: number[], pp: Buffer) => number
  HidP_GetButtonCaps: (type: number, caps: Buffer, len: number[], pp: Buffer) => number
  HidP_GetLinkCollectionNodes: (nodes: Buffer, len: number[], pp: Buffer) => number
  HidP_InitializeReportForID: (type: number, id: number, pp: Buffer, report: Buffer, len: number) => number
  HidP_SetUsageValue: (type: number, page: number, link: number, usage: number, value: number, pp: Buffer, report: Buffer, len: number) => number
  HidP_SetUsages: (type: number, page: number, link: number, usages: number[], n: number[], pp: Buffer, report: Buffer, len: number) => number
  HidP_GetUsageValue: (type: number, page: number, link: number, usage: number, out: number[], pp: Buffer, report: Buffer, len: number) => number
  HidP_GetUsages: (type: number, page: number, link: number, usages: number[], n: number[], pp: Buffer, report: Buffer, len: number) => number
}

let api: HidApi | { error: string } | null = null

function load(): HidApi {
  if (api && !("error" in api)) return api
  if (api) throw new Error(api.error)
  const w = loadWin32()
  if (!isWin32(w)) { api = { error: w.error }; throw new Error(w.error) }
  try {
    const hid = w.koffi.load("hid.dll")
    const loaded: HidApi = {
      GetRawInputDeviceList: bind(w.user32, "uint32 GetRawInputDeviceList(void *list, _Inout_ uint32 *num, uint32 cb)"),
      GetRawInputDeviceInfoW: bind(w.user32, "int32 GetRawInputDeviceInfoW(uintptr_t h, uint32 cmd, void *data, _Inout_ uint32 *cb)"),
      HidP_GetCaps: bind(hid, "int32 HidP_GetCaps(void *pp, void *caps)"),
      HidP_GetValueCaps: bind(hid, "int32 HidP_GetValueCaps(int32 type, void *caps, _Inout_ uint16 *len, void *pp)"),
      HidP_GetButtonCaps: bind(hid, "int32 HidP_GetButtonCaps(int32 type, void *caps, _Inout_ uint16 *len, void *pp)"),
      HidP_GetLinkCollectionNodes: bind(hid, "int32 HidP_GetLinkCollectionNodes(void *nodes, _Inout_ uint32 *len, void *pp)"),
      HidP_InitializeReportForID: bind(hid, "int32 HidP_InitializeReportForID(int32 type, uint8 id, void *pp, void *report, uint32 len)"),
      HidP_SetUsageValue: bind(hid, "int32 HidP_SetUsageValue(int32 type, uint16 page, uint16 link, uint16 usage, uint32 value, void *pp, void *report, uint32 len)"),
      HidP_SetUsages: bind(hid, "int32 HidP_SetUsages(int32 type, uint16 page, uint16 link, uint16 *usages, _Inout_ uint32 *n, void *pp, void *report, uint32 len)"),
      HidP_GetUsageValue: bind(hid, "int32 HidP_GetUsageValue(int32 type, uint16 page, uint16 link, uint16 usage, _Out_ uint32 *value, void *pp, void *report, uint32 len)"),
      HidP_GetUsages: bind(hid, "int32 HidP_GetUsages(int32 type, uint16 page, uint16 link, _Out_ uint16 *usages, _Inout_ uint32 *n, void *pp, void *report, uint32 len)"),
    }
    return (api = loaded)
  } catch (e) {
    const msg = `hid.dll did not load: ${e instanceof Error ? e.message : String(e)}`
    api = { error: msg }
    throw new Error(msg)
  }
}

export function nativeAvailable(): { ok: boolean; error: string | null } {
  try { load(); return { ok: true, error: null } } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

// ---------------------------------------------------------------------------
// Raw Input device enumeration

export function listRawDevices(): RawDevice[] {
  const { GetRawInputDeviceList } = load()
  const n = [0]
  GetRawInputDeviceList(null, n, 16)
  if (!n[0]) return []
  const room = n[0] + 8
  const c = canaryBuffer(16 * room)
  const cnt = [room]
  const got = GetRawInputDeviceList(c.buf, cnt, 16)
  c.check("GetRawInputDeviceList")
  if (got === 0xffffffff) return []
  const out: RawDevice[] = []
  for (let i = 0; i < Math.min(got, room); i++) {
    const handle = c.buf.readBigUInt64LE(i * 16)
    const type = c.buf.readUInt32LE(i * 16 + 8) as 0 | 1 | 2
    out.push(describeRawDevice(handle, type))
  }
  return out
}

export function describeRawDevice(handle: bigint, type: 0 | 1 | 2): RawDevice {
  const { GetRawInputDeviceInfoW } = load()
  let name = ""
  const c = [0]
  GetRawInputDeviceInfoW(handle, RIDI_DEVICENAME, null, c)
  if ((c[0] ?? 0) > 0 && (c[0] ?? 0) < 32768) {
    // cbSize for RIDI_DEVICENAME counts characters
    const nb = canaryBuffer((c[0] ?? 0) * 2 + 2)
    GetRawInputDeviceInfoW(handle, RIDI_DEVICENAME, nb.buf, [c[0] ?? 0])
    nb.check("GetRawInputDeviceInfoW(name)")
    name = nb.buf.subarray(0, nb.size).toString("utf16le").replace(/\0[\s\S]*$/, "")
  }
  const info = canaryBuffer(32)
  info.buf.writeUInt32LE(32, 0)
  const r = GetRawInputDeviceInfoW(handle, RIDI_DEVICEINFO, info.buf, [32])
  info.check("GetRawInputDeviceInfoW(info)")
  const dev: RawDevice = { handle, type, name, vendorId: 0, productId: 0, usagePage: 0, usage: 0 }
  if (r > 0 && info.buf.readUInt32LE(4) === RIM_TYPEHID) {
    dev.vendorId = info.buf.readUInt32LE(8)
    dev.productId = info.buf.readUInt32LE(12)
    dev.usagePage = info.buf.readUInt16LE(20)
    dev.usage = info.buf.readUInt16LE(22)
  }
  return dev
}

/** The device's preparsed data (what every HidP_ call needs), or null. */
export function getPreparsed(handle: bigint): Buffer | null {
  const { GetRawInputDeviceInfoW } = load()
  const c = [0]
  GetRawInputDeviceInfoW(handle, RIDI_PREPARSEDDATA, null, c)
  if (!c[0] || c[0] > 1 << 20) return null
  // the size comes from the call's own answer; the canary proves it was right
  const b = canaryBuffer(c[0])
  const r = GetRawInputDeviceInfoW(handle, RIDI_PREPARSEDDATA, b.buf, [c[0]])
  b.check("GetRawInputDeviceInfoW(preparsed)")
  return r > 0 ? b.buf : null
}

// ---------------------------------------------------------------------------
// Capabilities

export function readCaps(pp: Buffer): DeviceCaps {
  const A = load()
  const cc = canaryBuffer(64)
  const caps = cc.buf
  const st = A.HidP_GetCaps(pp, caps) >>> 0
  cc.check("HidP_GetCaps")
  if (st !== HIDP_STATUS_SUCCESS) throw new Error(`HidP_GetCaps 0x${st.toString(16)}`)
  const out: DeviceCaps = {
    usage: caps.readUInt16LE(0),
    usagePage: caps.readUInt16LE(2),
    inputReportByteLength: caps.readUInt16LE(4),
    outputReportByteLength: caps.readUInt16LE(6),
    featureReportByteLength: caps.readUInt16LE(8),
    numberLinkCollectionNodes: caps.readUInt16LE(44),
    numberInputButtonCaps: caps.readUInt16LE(46),
    numberInputValueCaps: caps.readUInt16LE(48),
    valueCaps: [], buttonCaps: [], nodes: [],
  }
  if (out.numberInputValueCaps) {
    const len = [out.numberInputValueCaps]
    const vc = canaryBuffer(72 * len[0]!)
    const vb = vc.buf
    const s = A.HidP_GetValueCaps(0, vb, len, pp) >>> 0
    vc.check("HidP_GetValueCaps")
    if (s !== HIDP_STATUS_SUCCESS) throw new Error(`HidP_GetValueCaps 0x${s.toString(16)}`)
    for (let k = 0; k < (len[0] ?? 0); k++) {
      const o = k * 72
      const range = vb[o + 12] !== 0
      out.valueCaps.push({
        page: vb.readUInt16LE(o), reportId: vb[o + 2]!, link: vb.readUInt16LE(o + 6),
        linkUsage: vb.readUInt16LE(o + 8), linkPage: vb.readUInt16LE(o + 10),
        isRange: range, isAbsolute: vb[o + 15] !== 0, hasNull: vb[o + 16] !== 0,
        bitSize: vb.readUInt16LE(o + 18), reportCount: vb.readUInt16LE(o + 20),
        unitsExp: vb.readInt32LE(o + 32), units: vb.readUInt32LE(o + 36),
        logicalMin: vb.readInt32LE(o + 40), logicalMax: vb.readInt32LE(o + 44),
        physicalMin: vb.readInt32LE(o + 48), physicalMax: vb.readInt32LE(o + 52),
        usageMin: vb.readUInt16LE(o + 56), usageMax: range ? vb.readUInt16LE(o + 58) : vb.readUInt16LE(o + 56),
      })
    }
  }
  if (out.numberInputButtonCaps) {
    const len = [out.numberInputButtonCaps]
    const bc = canaryBuffer(72 * len[0]!)
    const bb = bc.buf
    const s = A.HidP_GetButtonCaps(0, bb, len, pp) >>> 0
    bc.check("HidP_GetButtonCaps")
    if (s !== HIDP_STATUS_SUCCESS) throw new Error(`HidP_GetButtonCaps 0x${s.toString(16)}`)
    for (let k = 0; k < (len[0] ?? 0); k++) {
      const o = k * 72
      const range = bb[o + 12] !== 0
      out.buttonCaps.push({
        page: bb.readUInt16LE(o), reportId: bb[o + 2]!, link: bb.readUInt16LE(o + 6),
        isRange: range, isAbsolute: bb[o + 15] !== 0,
        usageMin: bb.readUInt16LE(o + 56), usageMax: range ? bb.readUInt16LE(o + 58) : bb.readUInt16LE(o + 56),
      })
    }
  }
  if (out.numberLinkCollectionNodes) {
    const len = [out.numberLinkCollectionNodes]
    const nc = canaryBuffer(24 * len[0]!)
    const nb = nc.buf
    const s = A.HidP_GetLinkCollectionNodes(nb, len, pp) >>> 0
    nc.check("HidP_GetLinkCollectionNodes")
    if (s === HIDP_STATUS_SUCCESS) {
      for (let k = 0; k < (len[0] ?? 0); k++) {
        const o = k * 24
        out.nodes.push({
          index: k, usage: nb.readUInt16LE(o), page: nb.readUInt16LE(o + 2),
          parent: nb.readUInt16LE(o + 4), children: nb.readUInt16LE(o + 6),
          type: nb.readUInt32LE(o + 12) & 0xff,
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Layout probing

const usagesOf = (c: { usageMin: number; usageMax: number }): number[] => {
  const r: number[] = []
  for (let u = c.usageMin; u <= c.usageMax && r.length < 256; u++) r.push(u)
  return r
}

function diffBits(a: CanaryBuffer, b: CanaryBuffer): number[] {
  const bits: number[] = []
  for (let i = 0; i < a.size; i++) {
    const x = (a.buf[i] ?? 0) ^ (b.buf[i] ?? 0)
    if (!x) continue
    for (let k = 0; k < 8; k++) if ((x >> k) & 1) bits.push(i * 8 + k)
  }
  return bits
}

function copyOf(c: CanaryBuffer): CanaryBuffer {
  const out = canaryBuffer(c.size)
  c.buf.copy(out.buf, 0, 0, c.size)
  return out
}

const ctz = (n: number): number => { let k = 0; while (n && !(n & 1)) { n >>>= 1; k++ } return k }
const bitLength = (n: number): number => (n === 0 ? 0 : 32 - Math.clz32(n >>> 0))

export interface ProbeNote { usage: string; note: string }

/**
 * Derive the input-report bit layout from Windows' own HID parser. For each value field: write its logical minimum and then
 * its logical maximum into a freshly initialised report with HidP_SetUsageValue and diff; the lowest / highest differing
 * bits of (min XOR max) give the field's absolute bit offset, and the two ends must agree. For each button usage:
 * HidP_SetUsages and diff (exactly one bit expected). Offsets include the report-id byte (fromHidP.ts removes it).
 */
export function probeLayout(pp: Buffer, caps: DeviceCaps = readCaps(pp), notes: ProbeNote[] = []): ProbeLayout {
  const A = load()
  const len = caps.inputReportByteLength
  const ids = new Set<number>()
  for (const v of caps.valueCaps) ids.add(v.reportId)
  for (const b of caps.buttonCaps) ids.add(b.reportId)
  const hasReportIds = !(ids.size === 1 && ids.has(0))
  const reports: ProbeReport[] = []

  for (const id of [...ids].sort((a, b) => a - b)) {
    const base = canaryBuffer(len)
    const ini = A.HidP_InitializeReportForID(0, id, pp, base.buf, len) >>> 0
    base.check("HidP_InitializeReportForID")
    if (ini !== HIDP_STATUS_SUCCESS) { notes.push({ usage: `report ${id}`, note: `InitializeReportForID 0x${ini.toString(16)}` }); continue }
    const entry: ProbeReport = { reportId: id, byteLength: len, values: [], buttons: [] }

    for (const c of caps.valueCaps.filter((v) => v.reportId === id)) {
      if (c.reportCount > 1 && !c.isRange) { notes.push({ usage: `${c.page}:${c.usageMin}`, note: `array field (count ${c.reportCount}) not decoded` }); continue }
      const mask = c.bitSize >= 32 ? 0xffffffff : (2 ** c.bitSize) - 1
      const lo = (c.logicalMin >>> 0) & mask
      const hi = (c.logicalMax >>> 0) & mask
      for (const usage of usagesOf(c)) {
        const setTo = (v: number): CanaryBuffer | null => {
          const r = copyOf(base)
          // negative logical minimum: pass the sign-extended 32-bit pattern, as HidP expects
          const arg = c.logicalMin < 0 && v === lo ? (c.logicalMin >>> 0) : v
          const s = A.HidP_SetUsageValue(0, c.page, c.link, usage, arg >>> 0, pp, r.buf, len) >>> 0
          r.check("HidP_SetUsageValue")
          return s === HIDP_STATUS_SUCCESS ? r : null
        }
        const a = setTo(lo)
        const b = setTo(hi)
        if (!a || !b) { notes.push({ usage: `${c.page}:${usage}`, note: "HidP_SetUsageValue refused min/max" }); continue }
        const d = diffBits(a, b)
        const x = (lo ^ hi) >>> 0
        if (!d.length || !x) { notes.push({ usage: `${c.page}:${usage}`, note: "min == max, cannot locate" }); continue }
        const offLow = d[0]! - ctz(x)
        const offHigh = d[d.length - 1]! - (bitLength(x) - 1)
        if (offLow !== offHigh) { notes.push({ usage: `${c.page}:${usage}`, note: `layout probe disagrees ${offLow} vs ${offHigh}` }); continue }
        const f: ProbeValueField = {
          page: c.page, usage, link: c.link, bitOffset: offLow, bitSize: c.bitSize,
          signed: c.logicalMin < 0, logicalMin: c.logicalMin, logicalMax: c.logicalMax,
          physicalMin: c.physicalMin, physicalMax: c.physicalMax, units: c.units, unitsExp: c.unitsExp, hasNull: c.hasNull,
        }
        entry.values.push(f)
      }
    }

    for (const c of caps.buttonCaps.filter((b) => b.reportId === id)) {
      for (const usage of usagesOf(c)) {
        const r = copyOf(base)
        const s = A.HidP_SetUsages(0, c.page, c.link, [usage], [1], pp, r.buf, len) >>> 0
        r.check("HidP_SetUsages")
        if (s !== HIDP_STATUS_SUCCESS) { notes.push({ usage: `${c.page}:${usage}`, note: `HidP_SetUsages 0x${s.toString(16)}` }); continue }
        const d = diffBits(base, r)
        if (d.length !== 1) { notes.push({ usage: `${c.page}:${usage}`, note: `button changed ${d.length} bits` }); continue }
        const b: ProbeButtonField = { page: c.page, usage, link: c.link, bitOffset: d[0]! }
        entry.buttons.push(b)
      }
    }
    entry.values.sort((p, q) => p.bitOffset - q.bitOffset)
    entry.buttons.sort((p, q) => p.bitOffset - q.bitOffset)
    reports.push(entry)
  }
  return { usagePage: caps.usagePage, usage: caps.usage, hasReportIds, reports }
}

/**
 * Decode one report with WINDOWS' parser (HidP_GetUsageValue / GetUsages). Used to prove the pure decoder against the
 * operating system in the real-OS test, never on the hot path. `report` includes the id byte, as Raw Input delivers it.
 */
export function decodeWithHidP(pp: Buffer, layout: ProbeLayout, report: Buffer): { values: Map<string, number>; down: Set<string> } {
  const A = load()
  const id = layout.hasReportIds ? report[0] ?? 0 : 0
  const entry = layout.reports.find((r) => r.reportId === id)
  const values = new Map<string, number>()
  const down = new Set<string>()
  if (!entry) return { values, down }
  for (const f of entry.values) {
    const out = [0]
    const s = A.HidP_GetUsageValue(0, f.page, f.link ?? 0, f.usage, out, pp, report, report.length) >>> 0
    if (s === HIDP_STATUS_SUCCESS) {
      let v = (out[0] ?? 0) >>> 0
      if (f.signed) { const m = f.bitSize >= 32 ? 2 ** 32 : 2 ** f.bitSize; if (v >= m / 2) v -= m }
      values.set(`${f.page}:${f.usage}`, v)
    }
  }
  const pages = new Set(entry.buttons.map((b) => `${b.page}/${b.link ?? 0}`))
  for (const pl of pages) {
    const [page, link] = pl.split("/").map(Number) as [number, number]
    const list = new Array<number>(32).fill(0)
    const n = [32]
    const s = A.HidP_GetUsages(0, page, link, list, n, pp, report, report.length) >>> 0
    if (s === HIDP_STATUS_SUCCESS) for (let i = 0; i < (n[0] ?? 0); i++) down.add(`${page}:${list[i]}`)
  }
  return { values, down }
}

/** Build a report with WINDOWS' parser (HidP_SetUsageValue / SetUsages): the other half of the real-OS proof. */
export function encodeWithHidP(
  pp: Buffer, layout: ProbeLayout, reportId: number, values: Record<string, number>, down: string[],
): Buffer {
  const A = load()
  const entry = layout.reports.find((r) => r.reportId === reportId)
  if (!entry) throw new Error("no such report")
  const rc = canaryBuffer(entry.byteLength)
  const r = rc.buf
  A.HidP_InitializeReportForID(0, reportId, pp, r, entry.byteLength)
  rc.check("HidP_InitializeReportForID")
  for (const f of entry.values) {
    const v = values[`${f.page}:${f.usage}`]
    if (v === undefined) continue
    const s = A.HidP_SetUsageValue(0, f.page, f.link ?? 0, f.usage, v >>> 0, pp, r, entry.byteLength) >>> 0
    if (s !== HIDP_STATUS_SUCCESS) throw new Error(`HidP_SetUsageValue ${f.page}:${f.usage}=${v} -> 0x${s.toString(16)}`)
  }
  for (const b of entry.buttons) {
    if (!down.includes(`${b.page}:${b.usage}`)) continue
    const s = A.HidP_SetUsages(0, b.page, b.link ?? 0, [b.usage], [1], pp, r, entry.byteLength) >>> 0
    if (s !== HIDP_STATUS_SUCCESS) throw new Error(`HidP_SetUsages ${b.page}:${b.usage} -> 0x${s.toString(16)}`)
  }
  rc.check("encodeWithHidP")
  return Buffer.from(r.subarray(0, entry.byteLength))
}
