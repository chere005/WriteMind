/**
 * webhid/hidSource.ts - the pen source over WebHID (`navigator.hid`). docs/spikes/DESIGN-pen-capture.md 4.4. Owner: IMPL-B.
 * Ported from the webhid spike (`webhidPen.ts`) onto the repo's ONE decoder (`hid/decoder.ts`) and the primary-report rule (`primary.ts`).
 *
 * It runs in the helper page's own world (hostPage.ts), but everything the environment provides - `navigator.hid`, the clock, the timers -
 * is injected, so vitest drives it with a fake `hid` and synthetic reports.
 *
 *   const src = new WebHidSource({ onSamples, onStatus, onRaw })
 *   await src.start()   // lists the permitted devices, opens the pen ones, listens, follows hot-plug
 *   src.stop()          // closes them, ends any open visit with an out-of-range sample, flushes
 *
 * What it does per device (a Wacom is ONE HIDDevice with several collections):
 *   - plans the device (primary.ts): the pen is the primary report (213 on the real tablet); the vendor page is traced and not decoded;
 *   - last resort (4.3, "vendor fallback"): if the primary report stays silent while the vendor report streams (more than 3 reports in
 *     2 s; the Wacom's idle heartbeat is one per 5 s) the vendor report is decoded instead, until the primary speaks again;
 *   - every raw report goes to `onRaw` as hex for the trace (the first RAW_FIRST, then every RAW_EVERY-th: the trace sink caps again);
 *   - samples are in the DEVICE frame; main's VisitTracker ends visits for devices without an In Range field.
 *
 * Pure of Electron / Node. Safe to bundle for the browser.
 */

import type { PenSample } from "../../../shared/pen"
import { PenDecoder } from "../hid/decoder"
import type { HidCollectionInfoLike } from "../hid/fromWebHid"
import { describeCollections } from "../hid/fromWebHid"
import { choiceLabel, deviceInfoFor, layoutLabel, planDevice, type DevicePlan } from "./primary"
import { WACOM_VENDOR_ID, type HidDeviceStatus, type HidRawRecord } from "./protocol"

export interface HidInputReportEventLike {
  reportId: number
  data: DataView
  /** DOMHighResTimeStamp relative to the page's time origin. */
  timeStamp: number
}

export interface HidDeviceLike {
  vendorId: number
  productId: number
  productName?: string
  opened: boolean
  collections: readonly HidCollectionInfoLike[]
  open(): Promise<void>
  close(): Promise<void>
  addEventListener(type: "inputreport", listener: (e: HidInputReportEventLike) => void): void
  removeEventListener(type: "inputreport", listener: (e: HidInputReportEventLike) => void): void
}

export interface HidLike {
  getDevices(): Promise<readonly HidDeviceLike[]>
  addEventListener(type: "connect" | "disconnect", listener: (e: { device: HidDeviceLike }) => void): void
  removeEventListener(type: "connect" | "disconnect", listener: (e: { device: HidDeviceLike }) => void): void
}

export const RAW_FIRST = 400
export const RAW_EVERY = 10
export const FALLBACK_REPORTS = 3
export const FALLBACK_WINDOW_MS = 2000
export const FALLBACK_SILENCE_MS = 2000

export interface WebHidSourceOptions {
  hid?: HidLike
  /** Vendors whose devices are opened (default: Wacom). Empty = every permitted device. */
  vendorIds?: readonly number[]
  onSamples(batch: PenSample[]): void
  onStatus?(devices: HidDeviceStatus[]): void
  /** Every raw report, as hex, before decoding (thinned: the first RAW_FIRST, then every RAW_EVERY-th). */
  onRaw?(r: HidRawRecord): void
  /** Epoch ms. Default Date.now. */
  now?(): number
  /** performance.timeOrigin: report times are `timeOrigin + event.timeStamp`. Default 0 (then times fall back to `now`). */
  timeOrigin?: number
  /** Samples leave at most this long after they arrive. Default 2. */
  batchMs?: number
  /** Status messages while reports flow are at most this often. Default 250. */
  statusMs?: number
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(h: unknown): void
}

interface Live {
  key: string
  device: HidDeviceLike
  plan: DevicePlan
  decoder: PenDecoder | null
  vendorDecoder: PenDecoder | null
  listener: (e: HidInputReportEventLike) => void
  status: HidDeviceStatus
  rawSeen: number
  lastPrimaryAt: number
  vendorTimes: number[]
}

const bytesOf = (view: DataView): Uint8Array => new Uint8Array(view.buffer, view.byteOffset, view.byteLength)

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

export class WebHidSource {
  private readonly hid: HidLike | undefined
  private readonly live = new Map<HidDeviceLike, Live>()
  private queue: PenSample[] = []
  private flushTimer: unknown = null
  private statusTimer: unknown = null
  private started = false
  private nextKey = 0
  private collectionsSent = false

  private readonly onConnect = (e: { device: HidDeviceLike }): void => { void this.adopt(e.device) }
  private readonly onDisconnect = (e: { device: HidDeviceLike }): void => { this.drop(e.device) }

  constructor(private readonly o: WebHidSourceOptions) {
    this.hid = o.hid ?? (globalThis as { navigator?: { hid?: HidLike } }).navigator?.hid
  }

  /** navigator.hid exists. */
  get available(): boolean { return !!this.hid }
  get running(): boolean { return this.started }

  devices(): HidDeviceStatus[] {
    return [...this.live.values()].map((l) => ({ ...l.status, reportCounts: { ...l.status.reportCounts } }))
  }

  /** describeCollections of the first pen-capable device (the trace stores it once), or null. */
  collectionsJson(): unknown {
    for (const l of this.live.values()) if (l.plan.primary || l.plan.vendor) return describeCollections(l.device.collections)
    return null
  }

  /** True the first time it is asked after a pen-capable device appeared (the page sends the collections once per start). */
  takeCollections(): unknown {
    if (this.collectionsSent) return undefined
    const json = this.collectionsJson()
    if (json === null) return undefined
    this.collectionsSent = true
    return json
  }

  async start(): Promise<void> {
    if (this.started || !this.hid) return
    this.started = true
    this.collectionsSent = false
    this.hid.addEventListener("connect", this.onConnect)
    this.hid.addEventListener("disconnect", this.onDisconnect)
    await this.refresh()
  }

  /** List the permitted devices again and adopt the new ones (after requestDevice, or a missed connect event). */
  async refresh(): Promise<void> {
    if (!this.started || !this.hid) return
    const list = await this.hid.getDevices()
    for (const d of list) await this.adopt(d)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.hid?.removeEventListener("connect", this.onConnect)
    this.hid?.removeEventListener("disconnect", this.onDisconnect)
    for (const d of [...this.live.keys()]) this.drop(d)
    this.flush()
    if (this.statusTimer !== null) { this.untimer(this.statusTimer); this.statusTimer = null }
  }

  private wanted(d: HidDeviceLike): boolean {
    const v = this.o.vendorIds ?? [WACOM_VENDOR_ID]
    return v.length === 0 || v.includes(d.vendorId)
  }

  private async adopt(device: HidDeviceLike): Promise<void> {
    if (!this.started || !this.wanted(device) || this.live.has(device)) return
    const plan = planDevice(device.collections)
    const choice = plan.primary ?? plan.vendor
    const key = `d${this.nextKey++}`
    const status: HidDeviceStatus = {
      key, vendorId: device.vendorId, productId: device.productId, productName: device.productName ?? "",
      state: choice ? "opening" : "ignored",
      error: choice ? null : "no collection with a pen report (a position and a tip or pressure)",
      reports: 0, dropped: 0, reportCounts: {},
      primary: plan.primary ? choiceLabel(plan.primary) : null,
      fallback: plan.vendor ? choiceLabel(plan.vendor) : null,
      fallbackActive: false,
      collections: plan.collections,
      layout: choice ? layoutLabel(plan.primary ?? choice) : null,
      hasInRange: false,
      info: choice ? deviceInfoFor(device, choice) : null,
    }
    const entry: Live = {
      key, device, plan, decoder: null, vendorDecoder: null, listener: () => undefined, status, rawSeen: 0, lastPrimaryAt: 0, vendorTimes: [],
    }
    this.live.set(device, entry)
    if (!choice) { this.reportNow(); return }
    if (plan.primary) {
      entry.decoder = new PenDecoder(plan.primary.layout, { backend: "webhid" })
      status.hasInRange = entry.decoder.hasInRange
    }
    if (plan.vendor) entry.vendorDecoder = new PenDecoder(plan.vendor.layout, { backend: "webhid" })
    entry.listener = (e) => this.onReport(entry, e)
    device.addEventListener("inputreport", entry.listener)
    this.reportNow()
    try {
      if (!device.opened) await device.open()
      if (status.state === "opening") status.state = "open"
    } catch (error) {
      status.state = "failed"
      status.error = `open() refused: ${(error as Error)?.message || String(error)}`
      device.removeEventListener("inputreport", entry.listener)
    }
    this.reportNow()
  }

  private drop(device: HidDeviceLike): void {
    const entry = this.live.get(device)
    if (!entry) return
    this.live.delete(device)
    device.removeEventListener("inputreport", entry.listener)
    for (const d of [entry.decoder, entry.vendorDecoder]) {
      const gone = d?.gone(this.clock())
      if (gone) this.push(gone)
    }
    if (device.opened) void device.close().catch(() => undefined)
    entry.status.state = "gone"
    this.reportNow()
  }

  private clock(): number { return (this.o.now ?? Date.now)() }

  /** The report's time on the epoch clock; a timestamp that is not plausible (0, NaN, far off) is replaced by the arrival time. */
  private timeOf(e: HidInputReportEventLike): number {
    const now = this.clock()
    const t = (this.o.timeOrigin ?? 0) + e.timeStamp
    return Number.isFinite(t) && Math.abs(t - now) < 10_000 ? t : now
  }

  private onReport(entry: Live, e: HidInputReportEventLike): void {
    const st = entry.status
    const t = this.timeOf(e)
    const bytes = bytesOf(e.data)
    st.reports++
    const id = String(e.reportId)
    st.reportCounts[id] = (st.reportCounts[id] ?? 0) + 1
    if (this.o.onRaw && (entry.rawSeen < RAW_FIRST || entry.rawSeen % RAW_EVERY === 0)) {
      this.o.onRaw({ key: entry.key, reportId: e.reportId, t, hex: toHex(bytes) })
    }
    entry.rawSeen++

    const primary = entry.plan.primary
    const vendor = entry.plan.vendor
    if (primary && e.reportId === primary.reportId && entry.decoder) {
      entry.lastPrimaryAt = t
      if (st.fallbackActive) { st.fallbackActive = false; entry.vendorDecoder?.reset(); entry.vendorTimes = [] }
      const sample = entry.decoder.decodeData(e.reportId, bytes, t)
      if (sample) this.push(sample)
      else st.dropped++
    } else if (vendor && e.reportId === vendor.reportId && entry.vendorDecoder) {
      entry.vendorTimes.push(t)
      while (entry.vendorTimes.length && entry.vendorTimes[0]! < t - FALLBACK_WINDOW_MS) entry.vendorTimes.shift()
      if (!st.fallbackActive && entry.vendorTimes.length > FALLBACK_REPORTS && t - entry.lastPrimaryAt > FALLBACK_SILENCE_MS) {
        st.fallbackActive = true
        this.reportNow()
      }
      if (st.fallbackActive) {
        const sample = entry.vendorDecoder.decodeData(e.reportId, bytes, t)
        if (sample) this.push(sample)
        else st.dropped++
      }
    }
    this.armStatus()
  }

  // ---- batching / status ----------------------------------------------------------------------

  private push(s: PenSample): void {
    this.queue.push(s)
    if (this.flushTimer === null) this.flushTimer = this.timer(() => { this.flushTimer = null; this.flush() }, this.o.batchMs ?? 2)
  }

  private flush(): void {
    if (this.flushTimer !== null) { this.untimer(this.flushTimer); this.flushTimer = null }
    if (!this.queue.length) return
    const batch = this.queue
    this.queue = []
    this.o.onSamples(batch)
  }

  private armStatus(): void {
    if (this.statusTimer !== null || !this.o.onStatus) return
    this.statusTimer = this.timer(() => { this.statusTimer = null; this.o.onStatus?.(this.devices()) }, this.o.statusMs ?? 250)
  }

  private reportNow(): void {
    if (this.statusTimer !== null) { this.untimer(this.statusTimer); this.statusTimer = null }
    this.o.onStatus?.(this.devices())
  }

  private timer(fn: () => void, ms: number): unknown { return (this.o.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms) }
  private untimer(h: unknown): void { (this.o.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h) }
}
