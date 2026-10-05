/**
 * hid/layout.ts - ONE neutral description of an HID input-report layout, produced by two sources (WebHID metadata:
 * fromWebHid.ts; Windows' own HidP parser through Raw Input: fromHidP.ts) and decoded by ONE decoder (decoder.ts).
 * docs/spikes/DESIGN-pen-capture.md 4.3.
 *
 * Plain JSON on purpose: it is written into the trace next to the recorded reports so a recording can be replayed offline.
 * Pure: no Node, no Electron, no koffi (the WebHID helper page bundles this for the browser).
 *
 * BIT OFFSETS are relative to the start of the report DATA, i.e. AFTER the report-id byte when the device uses report ids
 * (WebHID's `event.data` has no id byte). Raw Input hands over the id byte first; `splitReport` removes it.
 */

export const PAGE_GENERIC_DESKTOP = 0x01
export const PAGE_BUTTON = 0x09
export const PAGE_DIGITIZER = 0x0d

export type HidRole =
  | "x" | "y" | "pressure" | "tip" | "barrel" | "secondary" | "invert" | "eraser"
  | "inRange" | "tiltX" | "tiltY" | "button1" | "button2" | "button3"

const usageKey = (page: number, usage: number): number => page * 0x10000 + usage

const ROLE_BY_USAGE: ReadonlyMap<number, HidRole> = new Map<number, HidRole>([
  [usageKey(PAGE_GENERIC_DESKTOP, 0x30), "x"],
  [usageKey(PAGE_GENERIC_DESKTOP, 0x31), "y"],
  [usageKey(PAGE_DIGITIZER, 0x30), "pressure"], // Tip Pressure
  [usageKey(PAGE_DIGITIZER, 0x42), "tip"], // Tip Switch
  [usageKey(PAGE_DIGITIZER, 0x44), "barrel"], // Barrel Switch
  [usageKey(PAGE_DIGITIZER, 0x5a), "secondary"], // Secondary Barrel Switch
  [usageKey(PAGE_DIGITIZER, 0x3c), "invert"], // Invert (the eraser end is near)
  [usageKey(PAGE_DIGITIZER, 0x45), "eraser"], // Eraser (the eraser end is touching)
  [usageKey(PAGE_DIGITIZER, 0x32), "inRange"], // In Range
  [usageKey(PAGE_DIGITIZER, 0x3d), "tiltX"], // X Tilt
  [usageKey(PAGE_DIGITIZER, 0x3e), "tiltY"], // Y Tilt
  [usageKey(PAGE_BUTTON, 1), "button1"],
  [usageKey(PAGE_BUTTON, 2), "button2"],
  [usageKey(PAGE_BUTTON, 3), "button3"],
])

export const roleOf = (page: number, usage: number): HidRole | null => ROLE_BY_USAGE.get(usageKey(page, usage)) ?? null

export interface HidField {
  page: number
  usage: number
  role: HidRole | null
  bitOffset: number
  bitSize: number
  signed: boolean
  min: number
  max: number
  physMin: number
  physMax: number
  /** The field has a Null state: a value outside [min, max] means "no data". */
  hasNull: boolean
}

export interface HidReport {
  /** 0 when the device uses no report ids. */
  reportId: number
  /** Bits of data the described fields reach (padding after the last field is not counted). */
  bitLength: number
  fields: HidField[]
}

export interface HidLayout {
  /** Where it came from, for the trace. */
  source: "webhid" | "hidp" | "model"
  usagePage: number
  usage: number
  /** True when the device's reports start with an id byte (Raw Input) / carry a non-zero reportId (WebHID). */
  hasReportIds: boolean
  reports: HidReport[]
}

/**
 * Windows hands HID descriptors over as signed LONGs: an unsigned 16-bit field with a Logical Maximum of 0xFFFF arrives
 * as -1 (seen on a real gamepad's axes). A maximum below a non-negative minimum is that wrap: read it as unsigned in the
 * field's own width.
 */
export function fixRange(min: number, max: number, bits: number): [number, number] {
  if (min >= 0 && max < min && bits < 53) return [min, max + 2 ** bits]
  return [min, max]
}

/** Little-endian bit field of `bitSize` bits at `bitOffset`; undefined when the bytes are too short or the size is silly. */
export function readBits(bytes: Uint8Array, bitOffset: number, bitSize: number, signed = false): number | undefined {
  if (bitSize <= 0 || bitSize > 52 || bitOffset < 0) return undefined
  if (bitOffset + bitSize > bytes.length * 8) return undefined
  let value = 0
  let scale = 1
  let got = 0
  while (got < bitSize) {
    const at = bitOffset + got
    const bitIn = at & 7
    const take = Math.min(8 - bitIn, bitSize - got)
    const bits = ((bytes[at >> 3] ?? 0) >> bitIn) & ((1 << take) - 1)
    value += bits * scale
    scale *= 2 ** take
    got += take
  }
  if (signed && value >= 2 ** (bitSize - 1)) value -= 2 ** bitSize
  return value
}

/** The inverse of readBits (tests and synthetic reports). Negative values are written as two's complement of the field width. */
export function writeBits(bytes: Uint8Array, bitOffset: number, bitSize: number, value: number): void {
  let v = value < 0 ? value + 2 ** bitSize : value
  for (let i = 0; i < bitSize; i++) {
    const bit = bitOffset + i
    const idx = bit >> 3
    const on = v % 2 >= 1
    v = Math.floor(v / 2)
    if (idx >= bytes.length) return
    const mask = 1 << (bit & 7)
    bytes[idx] = on ? (bytes[idx]! | mask) & 0xff : bytes[idx]! & ~mask & 0xff
  }
}

export function reportOf(layout: HidLayout, reportId: number): HidReport | undefined {
  return layout.reports.find((r) => r.reportId === reportId)
}

/** Split one Raw Input / recorded report into its id and its data. Reports of a layout without ids have id 0 and no id byte. */
export function splitReport(layout: HidLayout, bytes: Uint8Array, includesReportId = layout.hasReportIds): { reportId: number; data: Uint8Array } {
  if (includesReportId && layout.hasReportIds) return { reportId: bytes[0] ?? 0, data: bytes.subarray(1) }
  return { reportId: 0, data: bytes }
}

/** Roles of the layout; with `reportIds` only those of the given reports (a decoder reads the primary report, not all three the Wacom describes). */
export function layoutRoles(layout: HidLayout, reportIds?: ReadonlySet<number>): Set<HidRole> {
  const roles = new Set<HidRole>()
  for (const r of layout.reports) {
    if (reportIds && !reportIds.has(r.reportId)) continue
    for (const f of r.fields) if (f.role) roles.add(f.role)
  }
  return roles
}

/** X, Y and something that says contact (a tip switch or a pressure axis). */
export function isPenLayout(layout: HidLayout): boolean {
  const roles = layoutRoles(layout)
  return roles.has("x") && roles.has("y") && (roles.has("tip") || roles.has("pressure"))
}

/** How pen-like a layout is: 0 = not usable. A Digitizer-page Pen collection with pressure, range and a barrel switch scores highest. */
export function penScore(layout: HidLayout): number {
  if (!isPenLayout(layout)) return 0
  const roles = layoutRoles(layout)
  let s = 1
  if (layout.usagePage === PAGE_DIGITIZER && layout.usage === 0x02) s += 4
  else if (layout.usagePage === PAGE_DIGITIZER) s += 2
  if (roles.has("pressure")) s += 1
  if (roles.has("inRange")) s += 1
  if (roles.has("barrel")) s += 1
  return s
}

/** The first field with this role (across reports, or only in `reportIds`), or undefined. */
export function fieldFor(layout: HidLayout, role: HidRole, reportIds?: ReadonlySet<number>): HidField | undefined {
  for (const r of layout.reports) {
    if (reportIds && !reportIds.has(r.reportId)) continue
    for (const f of r.fields) if (f.role === role) return f
  }
  return undefined
}

/** A few lines for the trace and the status facts. */
export function summarizeLayout(layout: HidLayout): string {
  const parts: string[] = []
  for (const r of layout.reports) {
    const roles = r.fields.filter((f) => f.role).map((f) => `${f.role}@${f.bitOffset}+${f.bitSize}`)
    parts.push(`id${r.reportId}[${roles.join(",")}]`)
  }
  return `${layout.source} ${layout.usagePage.toString(16)}:${layout.usage.toString(16)} ${parts.join(" ")}`
}

/** `\\?\Microsoft HID RID\000D_0002\1` is the pen Windows itself synthesises from the pointer stack: SCREEN pixels, not tablet counts. */
export const isSyntheticDevicePath = (devicePath: string): boolean => /Microsoft HID RID/i.test(devicePath)

/**
 * Looks mapped to the screen by the driver already? Decided by the DEVICE PATH only (design 4.3, revision 2): the range heuristic
 * of revision 1 ("X / Y logical maximum is 32000 / 32767 / 65535") would have flagged the real Wacom, whose pen collection is
 * 0..32767 over a PHYSICAL 15200 x 9500. A tablet collection is native; only the observed reach and the frame fit say anything
 * about a mapping (a partial Wacom Mapping shows up as partial coverage in the check).
 */
export function looksDriverMapped(devicePath: string): boolean {
  return isSyntheticDevicePath(devicePath)
}

/** The vendor-defined usage pages (0xFF00-0xFFFF): the Wacom's raw-count stream `Col02` and its heartbeat live there. */
export const isVendorPage = (usagePage: number): boolean => usagePage >= 0xff00 && usagePage <= 0xffff

// ---- the primary report (design 4.3 "one position stream per device") ------------------------------

const hasXY = (r: HidReport): boolean => r.fields.some((f) => f.role === "x") && r.fields.some((f) => f.role === "y")

/**
 * How pen-like ONE report is: Tip Switch 4, In Range 3, pressure 1, barrel 1, tilt 1 (the WebHID spike's weights). 0 when the report
 * has no position. Ties are broken by descriptor order in `primaryReportId`.
 */
export function reportScore(report: HidReport): number {
  if (!hasXY(report)) return 0
  const have = new Set(report.fields.map((f) => f.role))
  return 1 + (have.has("tip") ? 4 : 0) + (have.has("inRange") ? 3 : 0) + (have.has("pressure") ? 1 : 0) + (have.has("barrel") ? 1 : 0) + (have.has("tiltX") ? 1 : 0)
}

/**
 * The ONE report that carries the pen position: the best score, the first in descriptor order on a tie. A device that describes the
 * same pen twice (the Wacom's 209 / 213 / 220) must not have every report decoded: that would merge two coordinate scales.
 */
export function primaryReportId(layout: HidLayout): number | null {
  let best = 0
  let id: number | null = null
  for (const r of layout.reports) {
    const s = reportScore(r)
    if (s > best) { best = s; id = r.reportId }
  }
  return id
}

/** The report ids a decoder reads by default: the primary position report plus every report WITHOUT a position (tilt, buttons...). */
export function defaultReportIds(layout: HidLayout): number[] {
  const primary = primaryReportId(layout)
  return layout.reports.filter((r) => r.reportId === primary || !hasXY(r)).map((r) => r.reportId)
}

/** Physical extent of the primary report's X and Y (units the descriptor gives, 15200 x 9500 on the Wacom), or the logical range when it gives none. */
export function physicalExtent(layout: HidLayout): { x: number; y: number } | null {
  const id = primaryReportId(layout)
  const report = id === null ? undefined : reportOf(layout, id)
  const fx = report?.fields.find((f) => f.role === "x")
  const fy = report?.fields.find((f) => f.role === "y")
  if (!fx || !fy) return null
  const span = (f: HidField): number => (f.physMax > f.physMin ? f.physMax - f.physMin : f.max - f.min)
  const x = span(fx)
  const y = span(fy)
  return x > 0 && y > 0 ? { x, y } : null
}

/** The surface reports in portrait: judged from the PHYSICAL extents (both logical ranges are 32767 on the Wacom). */
export function portraitNative(layout: HidLayout): boolean {
  const e = physicalExtent(layout)
  return e !== null && e.x < e.y
}

/** Build one report for tests, fixtures and replay tools: the inverse of decodeFields. `values` are raw field values by role (button roles 0 / 1). */
export function encodeReport(layout: HidLayout, reportId: number, values: Partial<Record<HidRole, number>>, includeReportId = layout.hasReportIds): Uint8Array {
  const report = reportOf(layout, reportId)
  if (!report) throw new Error(`layout has no report ${reportId}`)
  const bits = report.fields.reduce((m, f) => Math.max(m, f.bitOffset + f.bitSize), report.bitLength)
  const data = new Uint8Array(Math.ceil(bits / 8))
  for (const f of report.fields) {
    const v = f.role ? values[f.role] : undefined
    if (v !== undefined) writeBits(data, f.bitOffset, f.bitSize, v)
  }
  if (!includeReportId || !layout.hasReportIds) return data
  const out = new Uint8Array(data.length + 1)
  out[0] = reportId
  out.set(data, 1)
  return out
}
