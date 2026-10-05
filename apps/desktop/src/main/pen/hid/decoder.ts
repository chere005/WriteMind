/**
 * hid/decoder.ts - the ONE decoder of HID pen / digitizer input reports, shared by Raw Input and WebHID
 * (docs/spikes/DESIGN-pen-capture.md 4.3).
 *
 * `PenDecoder(layout, opts)` merges state across reports (position in one report, tilt in another), honours the Null
 * state, takes `tip` from the Tip Switch when there is one and from pressure otherwise, `inRange` from the In Range field
 * (a layout without one leaves it to the caller's VisitTracker), `lower` = Barrel Switch (0D:44) or Button 1,
 * `upper` = Secondary Barrel Switch (0D:5A) or Button 2, `eraser` = Eraser (0D:45) or Invert (0D:3C), and scales tilt
 * through the physical range.
 *
 * NO rotation, NO flip, NO "auto landscape": x / y are 0..1 over the device's own logical range, in the DEVICE frame.
 * Turning that into the screen frame is frame.ts's job (and the manager's).
 *
 * Pure: no Node, no Electron, no koffi.
 */

import { clamp01, type DeviceInfo, type PenSample } from "../../../shared/pen"
import {
  defaultReportIds, fieldFor, isPenLayout, layoutRoles, penScore, physicalExtent, readBits, reportOf, splitReport,
  type HidField, type HidLayout, type HidReport, type HidRole,
} from "./layout"

export { penScore, isPenLayout }

export interface DecoderOptions {
  /** The `backend` label on every sample: "rawinput-hid", "rawinput-synth", "webhid". */
  backend?: string
  /** Without a Tip Switch, a pressure fraction at or below this counts as no contact. */
  contactThreshold?: number
  /**
   * Normalise X / Y over [0, extent] instead of the descriptor's logical range. Windows' synthesized pen device says
   * 0..32000 but reports SCREEN PIXELS (measured), so its decoder gets the screen size here.
   */
  xyExtent?: { x: number; y: number }
  /**
   * Which report ids to decode. Default: the PRIMARY position report plus every report without a position (design 4.3, revision 2:
   * the Wacom describes one pen as reports 209 / 213 / 220 and decoding all of them would merge two coordinate scales). "all" and an
   * explicit list are for tests and the analyser.
   */
  reportIds?: readonly number[] | "all"
}

type RoleValues = Partial<Record<HidRole, number>>

export interface DecodedFields {
  reportId: number
  values: RoleValues
}

/** Decode the role fields of one report's data. Fields that are Null-state or truncated are absent. */
export function decodeFields(report: HidReport, data: Uint8Array): RoleValues {
  const out: RoleValues = {}
  for (const f of report.fields) {
    if (!f.role) continue
    const v = readBits(data, f.bitOffset, f.bitSize, f.signed)
    if (v === undefined) continue
    if (f.hasNull && (v < f.min || v > f.max)) continue
    if (out[f.role] === undefined) out[f.role] = v
  }
  return out
}

/** Whole layout, whole report (as Raw Input or a recording hands it over) -> role values, or null for an unknown id / too short. */
export function decodeReport(layout: HidLayout, bytes: Uint8Array, includesReportId = layout.hasReportIds): DecodedFields | null {
  const { reportId, data } = splitReport(layout, bytes, includesReportId)
  const report = reportOf(layout, reportId)
  if (!report) return null
  if (data.length * 8 < report.bitLength) return null
  return { reportId, values: decodeFields(report, data) }
}

const unit = (v: number, lo: number, hi: number): number => (hi === lo ? 0 : clamp01((v - lo) / (hi - lo)))

/** Degrees -90..90. A physical range different from the logical one is applied; anything still wider than +-90 is scaled onto it. */
export function tiltDegrees(v: number, f: HidField | undefined): number {
  let deg = v
  let lim = 90
  if (f) {
    const hasPhys = f.physMax !== f.physMin && (f.physMax !== f.max || f.physMin !== f.min)
    if (hasPhys && f.max !== f.min) {
      deg = f.physMin + ((v - f.min) / (f.max - f.min)) * (f.physMax - f.physMin)
      lim = Math.max(Math.abs(f.physMin), Math.abs(f.physMax))
    } else {
      lim = Math.max(Math.abs(f.min), Math.abs(f.max))
    }
  }
  if (lim > 90) deg = (deg / lim) * 90
  return Math.max(-90, Math.min(90, Math.round(deg * 10) / 10))
}

export class PenDecoder {
  /** Last value of every role WITH the field it was read from: ranges differ between reports, so each value is scaled by its own. */
  private state = new Map<HidRole, { v: number; f: HidField }>()
  private readonly roles = new Set<HidRole>()
  private readonly backend: string
  private readonly threshold: number
  private lastT = 0
  private readonly accept: ReadonlySet<number>

  constructor(readonly layout: HidLayout, private readonly opts: DecoderOptions = {}) {
    this.backend = opts.backend ?? "rawinput-hid"
    this.threshold = opts.contactThreshold ?? 0
    this.accept = new Set(opts.reportIds === "all" ? layout.reports.map((r) => r.reportId) : opts.reportIds ?? defaultReportIds(layout))
    // roles come from the reports this decoder READS (the vendor report has no In Range field; the pen report has)
    for (const role of layoutRoles(layout, this.accept)) this.roles.add(role)
  }

  /** The device says by itself when the pen is near (the caller then needs no timeout logic). */
  get hasInRange(): boolean { return this.roles.has("inRange") }
  get lastReportAt(): number { return this.lastT }
  /** True for a report this decoder reads (the primary position report and the position-less ones); other reports are traced, not decoded. */
  handles(reportId: number): boolean { return this.accept.has(reportId) && reportOf(this.layout, reportId) !== undefined }

  /**
   * One input report -> one sample. `includesReportId`: the bytes start with the id byte (Raw Input; default from the layout).
   * Null when the report is not a pen report, is too short, or the position is not known yet.
   */
  decode(bytes: Uint8Array, t: number, includesReportId = this.layout.hasReportIds): PenSample | null {
    const { reportId, data } = splitReport(this.layout, bytes, includesReportId)
    return this.decodeData(reportId, data, t)
  }

  /** WebHID shape: the report id and the data without the id byte. */
  decodeData(reportId: number, data: Uint8Array, t: number): PenSample | null {
    const report = this.handles(reportId) ? reportOf(this.layout, reportId) : undefined
    if (!report) return null
    if (data.length * 8 < report.bitLength) return null
    const got = new Map<HidRole, { v: number; f: HidField }>()
    for (const f of report.fields) {
      if (!f.role || got.has(f.role)) continue
      const v = readBits(data, f.bitOffset, f.bitSize, f.signed)
      if (v === undefined) continue
      if (f.hasNull && (v < f.min || v > f.max)) continue // the "no data" state
      got.set(f.role, { v, f })
    }
    if (!got.size) return null
    for (const [role, entry] of got) this.state.set(role, entry)
    this.lastT = t
    return this.sample(t)
  }

  /** The pen is gone for certain (the device was unplugged / the source stopped): a final out-of-range sample at the last place it was. */
  gone(t: number): PenSample | null {
    if (!this.state.has("x") || !this.state.has("y")) return null
    const s = this.sample(t)
    this.state.clear()
    if (!s) return null
    return { ...s, inRange: false, tip: false, p: 0, lower: false, upper: false, eraser: false }
  }

  reset(): void { this.state.clear() }

  private sample(t: number): PenSample | null {
    const st = this.state
    const sx = st.get("x")
    const sy = st.get("y")
    if (!sx || !sy) return null
    const v = (role: HidRole): number | undefined => st.get(role)?.v
    const ext = this.opts.xyExtent
    const x = ext ? clamp01(sx.v / ext.x) : unit(sx.v, sx.f.min, sx.f.max)
    const y = ext ? clamp01(sy.v / ext.y) : unit(sy.v, sy.f.min, sy.f.max)
    const sp = st.get("pressure")
    const rawP = sp ? unit(sp.v, sp.f.min, sp.f.max) : 0
    const tip = this.roles.has("tip") ? !!v("tip") : sp !== undefined && rawP > this.threshold
    const p = tip ? rawP : 0
    const inRange = this.roles.has("inRange") ? v("inRange") === undefined || !!v("inRange") : true
    const out: PenSample = {
      t, x, y, p, tip,
      lower: !!(v("barrel") || v("button1")),
      upper: !!(v("secondary") || v("button2")),
      eraser: !!(v("eraser") || v("invert")),
      inRange,
      backend: this.backend,
    }
    const tx = st.get("tiltX")
    const ty = st.get("tiltY")
    if (tx) out.tiltX = tiltDegrees(tx.v, tx.f)
    if (ty) out.tiltY = tiltDegrees(ty.v, ty.f)
    return out
  }
}

// ---------------------------------------------------------------------------------------------
// One pen, several collections
// ---------------------------------------------------------------------------------------------

/**
 * One physical pen can appear as several HID collections (the Wacom: Col03 pen and Col04 digitizer, same fields). Per group (VID:PID)
 * the first collection that speaks owns the stream; a sibling is accepted again only after the owner has been silent for `holdMs`, so
 * the two never interleave into duplicate or zig-zag samples.
 */
export class PrimaryPicker {
  private readonly owner = new Map<string, { handle: bigint; until: number }>()
  constructor(private readonly holdMs = 250) {}

  accept(group: string, handle: bigint, t: number): boolean {
    const cur = this.owner.get(group)
    if (cur && cur.handle !== handle && t < cur.until) return false
    this.owner.set(group, { handle, until: t + this.holdMs })
    return true
  }

  /** Who owns the stream of this group right now (diagnostics), or null. */
  ownerOf(group: string, t: number): bigint | null {
    const cur = this.owner.get(group)
    return cur && t < cur.until ? cur.handle : null
  }

  forget(handle: bigint): void {
    for (const [g, o] of this.owner) if (o.handle === handle) this.owner.delete(g)
  }

  clear(): void { this.owner.clear() }
}

/**
 * The vendor page (0xFF00) of the Wacom carries X / Y / pressure in raw tablet counts and an idle heartbeat about every 5 s. It is
 * traced and NOT decoded, except as a last resort: when it delivered MORE THAN 3 reports in 2 s while the digitizer collections
 * delivered none (a heartbeat is one per 5 s, a pen is dozens per second). Once active it stays active until a digitizer-page
 * report arrives again.
 */
export class VendorFallback {
  private readonly vendor = new Map<string, number[]>()
  private readonly digitizerAt = new Map<string, number>()
  private readonly on = new Set<string>()

  constructor(private readonly windowMs = 2000, private readonly minReports = 4) {}

  noteVendor(group: string, t: number): void {
    const list = this.vendor.get(group) ?? []
    list.push(t)
    const cut = t - this.windowMs
    while (list.length && list[0]! < cut) list.shift()
    this.vendor.set(group, list)
    const last = this.digitizerAt.get(group)
    if (list.length >= this.minReports && (last === undefined || t - last > this.windowMs)) this.on.add(group)
  }

  noteDigitizer(group: string, t: number): void {
    this.digitizerAt.set(group, t)
    this.on.delete(group)
  }

  active(group: string): boolean { return this.on.has(group) }
  reset(): void { this.vendor.clear(); this.digitizerAt.clear(); this.on.clear() }
}

// ---------------------------------------------------------------------------------------------
// What a layout says about the device
// ---------------------------------------------------------------------------------------------

/** DeviceInfo from a layout. The aspect comes from the PHYSICAL extents (both logical ranges are 32767 on the Wacom), rawX / rawY stay the logical ones. */
export function describeDevice(layout: HidLayout, name: string, vendorId: number | null, productId: number | null): DeviceInfo {
  const ids = new Set(defaultReportIds(layout))
  const roles = layoutRoles(layout, ids)
  const fx = fieldFor(layout, "x", ids)
  const fy = fieldFor(layout, "y", ids)
  const fp = fieldFor(layout, "pressure", ids)
  const e = physicalExtent(layout)
  return {
    name, vendorId, productId,
    aspect: e ? Math.round((Math.max(e.x, e.y) / Math.min(e.x, e.y)) * 1000) / 1000 : null,
    rawX: fx ? [fx.min, fx.max] : null,
    rawY: fy ? [fy.min, fy.max] : null,
    pressureMax: fp ? fp.max : null,
    claims: {
      pressure: roles.has("pressure"),
      tilt: roles.has("tiltX") || roles.has("tiltY"),
      lower: roles.has("barrel") || roles.has("button1"),
      upper: roles.has("secondary") || roles.has("button2"),
      eraser: roles.has("eraser") || roles.has("invert"),
    },
  }
}
