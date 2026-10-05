/**
 * Shared helpers of the WebHID tests (not a test file): the REAL collection metadata of Sean's tablet, read through navigator.hid on
 * 2026-10-03 (test/fixtures/pen/wacom-ctl472-real.json: Wacom One by Wacom S "CTL-472", VID 056A PID 037A, WacHidRouterPro 4.0.0.4), a
 * small model pen, a fake `navigator.hid`, and packers that write SYNTHETIC reports with the layout's own offsets (nobody has moved the
 * real pen yet: the only real report on file is the 5 s vendor heartbeat, report 220).
 */
import { readFileSync } from "node:fs"
import { layoutFromWebHid, type HidCollectionInfoLike, type HidReportItemLike } from "../../src/main/pen/hid/fromWebHid"
import { writeBits, type HidRole, type HidReport } from "../../src/main/pen/hid/layout"
import type { HidDeviceLike, HidInputReportEventLike, HidLike } from "../../src/main/pen/webhid/hidSource"

export interface RealWacom {
  vendorId: number
  productId: number
  productName: string
  heartbeat: { reportId: number; hex: string }
  collections: HidCollectionInfoLike[]
}

export const realWacom = JSON.parse(readFileSync(new URL("../fixtures/pen/wacom-ctl472-real.json", import.meta.url), "utf8")) as RealWacom

export const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)))
export const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** The report 213 of the real descriptor (Digitizer collection). */
export function realReport(id: number): HidReport {
  const layout = layoutFromWebHid(realWacom.collections)
  const r = layout.reports.find((x) => x.reportId === id)
  if (!r) throw new Error(`no report ${id}`)
  return r
}

/** Write role values into a report of `bytes` bytes (data only, no id byte). */
export function pack(report: HidReport, values: Partial<Record<HidRole, number>>, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes)
  for (const f of report.fields) {
    if (!f.role) continue
    const v = values[f.role]
    if (v !== undefined) writeBits(out, f.bitOffset, f.bitSize, v)
  }
  return out
}

/** A real-shaped report 213: in range by default. */
export function report213(values: Partial<Record<HidRole, number>>): Uint8Array {
  return pack(realReport(213), { inRange: 1, ...values }, 37)
}

const U = (page: number, usage: number): number => (page << 16) | usage
export const item = (usage: number, max: number, size: number, extra: Partial<HidReportItemLike> = {}): HidReportItemLike => ({
  logicalMinimum: 0, logicalMaximum: max, reportSize: size, reportCount: 1, usages: [usage], isConstant: false, isArray: false, ...extra,
})

/** A model pen with NO In Range field: report 7 = x(16) y(16) pressure(8) tip(1) + 7 pad bits. */
export const modelCollection = (): HidCollectionInfoLike => ({
  usagePage: 0x0d, usage: 0x02, inputReports: [{
    reportId: 7, items: [
      item(U(1, 0x30), 1000, 16), item(U(1, 0x31), 500, 16), item(U(0x0d, 0x30), 255, 8), item(U(0x0d, 0x42), 1, 1),
      { logicalMinimum: 0, logicalMaximum: 0, reportSize: 7, reportCount: 1, isConstant: true, isArray: true, usages: [] },
    ],
  }],
})
export const modelReport = (x: number, y: number, p: number, tip: number): Uint8Array => {
  const b = new Uint8Array(6)
  b[0] = x & 255; b[1] = x >> 8; b[2] = y & 255; b[3] = y >> 8; b[4] = p; b[5] = tip
  return b
}

// ---- a fake navigator.hid ----------------------------------------------------------------------

export class FakeDevice implements HidDeviceLike {
  opened = false
  openError: Error | null = null
  openCalls = 0
  closeCalls = 0
  listeners = new Set<(e: HidInputReportEventLike) => void>()
  constructor(public vendorId: number, public productId: number, public productName: string, public collections: readonly HidCollectionInfoLike[]) {}
  async open(): Promise<void> { this.openCalls++; if (this.openError) throw this.openError; this.opened = true }
  async close(): Promise<void> { this.opened = false; this.closeCalls++ }
  addEventListener(_t: "inputreport", l: (e: HidInputReportEventLike) => void): void { this.listeners.add(l) }
  removeEventListener(_t: "inputreport", l: (e: HidInputReportEventLike) => void): void { this.listeners.delete(l) }
  emit(reportId: number, data: Uint8Array, timeStamp: number): void {
    for (const l of [...this.listeners]) l({ reportId, data: viewOf(data), timeStamp })
  }
}

export class FakeHid implements HidLike {
  devices: FakeDevice[] = []
  /** What requestDevice() will add to the list. */
  grantOnRequest: FakeDevice[] = []
  handlers: Record<"connect" | "disconnect", Set<(e: { device: HidDeviceLike }) => void>> = { connect: new Set(), disconnect: new Set() }
  async getDevices(): Promise<readonly HidDeviceLike[]> { return this.devices }
  async requestDevice(): Promise<readonly HidDeviceLike[]> { this.devices.push(...this.grantOnRequest); this.grantOnRequest = []; return this.devices }
  addEventListener(t: "connect" | "disconnect", l: (e: { device: HidDeviceLike }) => void): void { this.handlers[t].add(l) }
  removeEventListener(t: "connect" | "disconnect", l: (e: { device: HidDeviceLike }) => void): void { this.handlers[t].delete(l) }
  fire(t: "connect" | "disconnect", d: FakeDevice): void { for (const h of [...this.handlers[t]]) h({ device: d }) }
}

export const realDevice = (): FakeDevice => new FakeDevice(realWacom.vendorId, realWacom.productId, realWacom.productName, realWacom.collections)
