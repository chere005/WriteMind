/**
 * webhid/primary.ts - which report of a WebHID device is "the pen" (docs/spikes/DESIGN-pen-capture.md 4.3, 4.4).
 *
 * The real Wacom CTL-472 has TWO reports with a position (measured through navigator.hid, wacom-webhid.md):
 *   - 213, in the Digitizer collection (0xd:0x1): the standard pen report. Tip, barrel, invert, eraser, secondary barrel, In Range,
 *     X / Y 0..32767 over a physical 15200 x 9500, pressure 0..2047, tilt -9000..9000.
 *   - 220, in the vendor collection (0xff00:0xa): X 0..15200, Y 0..9500, pressure 0..2047, no In Range, and an idle heartbeat
 *     `c0 00 .. 01` every 5 s that, decoded as a pen, would be "in range at x = 0.013".
 * Decoding both would merge two coordinate scales. So ONE report is primary - the best penScore among the NON-vendor collections, ties to
 * descriptor order - and the vendor page is traced but not decoded, except as a last resort (hidSource.ts: the primary stayed silent while
 * the vendor report streamed).
 *
 * Pure: no DOM, no Electron. The helper page, the tests and the analyser use it.
 */

import type { DeviceInfo } from "../../../shared/pen"
import { fieldFor, isPenLayout, penScore, summarizeLayout, type HidLayout, type HidReport } from "../hid/layout"
import { layoutFromWebHid, type HidCollectionInfoLike } from "../hid/fromWebHid"

export const VENDOR_PAGE_MIN = 0xff00

export interface ReportChoice {
  /** Index of the top-level collection. */
  collection: number
  reportId: number
  /** penScore of the report inside its collection (0 never appears here). */
  score: number
  /** The collection is on a vendor-defined usage page. */
  vendor: boolean
  /** A layout holding exactly this report (the collection's usage page / usage are kept for the score). */
  layout: HidLayout
}

export interface DevicePlan {
  /** The standard pen report, or null when the device has none. */
  primary: ReportChoice | null
  /** The best vendor-page report with a position, the decoder's last resort. */
  vendor: ReportChoice | null
  /** "1:1 ff00:a d:1": every top-level collection, for the status and the trace. */
  collections: string
  /** Every report id that has any input report at all, whatever it carries. */
  reportIds: number[]
}

const hex = (n: number): string => n.toString(16)

export function collectionsLabel(collections: readonly HidCollectionInfoLike[]): string {
  return collections.map((c) => `${hex(c.usagePage)}:${hex(c.usage)}`).join(" ")
}

/** "d:1 #213": where a report lives. */
export function choiceLabel(c: ReportChoice): string {
  return `${hex(c.layout.usagePage)}:${hex(c.layout.usage)} #${c.reportId}`
}

function allReportIds(collections: readonly HidCollectionInfoLike[]): number[] {
  const ids = new Set<number>()
  const walk = (c: HidCollectionInfoLike): void => {
    for (const r of c.inputReports ?? []) ids.add(r.reportId)
    for (const child of c.children ?? []) walk(child)
  }
  for (const c of collections) walk(c)
  return [...ids].sort((a, b) => a - b)
}

export function planDevice(collections: readonly HidCollectionInfoLike[]): DevicePlan {
  let primary: ReportChoice | null = null
  let vendor: ReportChoice | null = null
  collections.forEach((collection, index) => {
    const full = layoutFromWebHid([collection])
    const isVendor = collection.usagePage >= VENDOR_PAGE_MIN
    for (const report of full.reports) {
      const layout: HidLayout = { ...full, hasReportIds: report.reportId !== 0, reports: [report as HidReport] }
      if (!isPenLayout(layout)) continue
      const choice: ReportChoice = { collection: index, reportId: report.reportId, score: penScore(layout), vendor: isVendor, layout }
      if (isVendor) { if (!vendor || choice.score > vendor.score) vendor = choice }
      else if (!primary || choice.score > primary.score) primary = choice
    }
  })
  return { primary, vendor, collections: collectionsLabel(collections), reportIds: allReportIds(collections) }
}

const extent = (lo: number, hi: number): number => Math.abs(hi - lo)

/**
 * The DeviceInfo of a planned report. The orientation guess (`aspect`) uses the PHYSICAL extents: the real Wacom's logical X and Y are both
 * 0..32767, only the physical 15200 x 9500 says it is landscape. `rawX` / `rawY` stay the logical extents.
 */
export function deviceInfoFor(
  device: { vendorId: number; productId: number; productName?: string },
  choice: ReportChoice,
): DeviceInfo {
  const x = fieldFor(choice.layout, "x")
  const y = fieldFor(choice.layout, "y")
  const pressure = fieldFor(choice.layout, "pressure")
  const roles = new Set<string>()
  for (const r of choice.layout.reports) for (const f of r.fields) if (f.role) roles.add(f.role)
  let aspect: number | null = null
  if (x && y) {
    const w = extent(x.physMin, x.physMax)
    const h = extent(y.physMin, y.physMax)
    aspect = w > 0 && h > 0 ? w / h : null
  }
  const name = (device.productName ?? "").trim()
  return {
    name: name || `HID pen ${hex(device.vendorId)}:${hex(device.productId)}`,
    vendorId: device.vendorId,
    productId: device.productId,
    aspect,
    rawX: x ? [x.min, x.max] : null,
    rawY: y ? [y.min, y.max] : null,
    pressureMax: pressure ? pressure.max : null,
    claims: {
      pressure: roles.has("pressure"),
      tilt: roles.has("tiltX") || roles.has("tiltY"),
      lower: roles.has("barrel") || roles.has("button1"),
      upper: roles.has("secondary") || roles.has("button2"),
      eraser: roles.has("eraser") || roles.has("invert"),
    },
  }
}

export const layoutLabel = (choice: ReportChoice): string => summarizeLayout(choice.layout)
