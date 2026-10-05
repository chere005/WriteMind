/**
 * webhid/protocol.ts - the PRIVATE message set between the WebHID helper page (hostPage.ts, in a hidden window of its own session) and the
 * main process (webhidBackend.ts). docs/spikes/DESIGN-pen-capture.md 4.4. Owner: IMPL-B.
 *
 *   page -> main (through the preload bridge `window.penHid`, `ipcRenderer.send`; main listens on the helper's own `webContents.ipc`,
 *   so no other window can speak these channels):
 *     pen:hid-samples   PenSample[]       decoded pen samples in the DEVICE frame (the manager applies the calibrated frame), <= 512 a message
 *     pen:hid-raw       HidRawRecord[]    raw input reports as hex, for pen-trace.jsonl (the trace sink applies its own caps)
 *     pen:hid-status    HidHostStatus     devices, their state, counters, the layout; at most every 250 ms while reports flow
 *   main -> page:
 *     pen:hid-command   HidCommand        start / stop / request
 *
 * Everything crossing the boundary is validated here (`parse*`): the page is ours, but main never trusts a message it did not shape.
 *
 * Pure: no Electron, no Node, no DOM (the preload and the helper page import it).
 */

import type { DeviceInfo, PenSample } from "../../../shared/pen"

export const HID_CHANNELS = {
  samples: "pen:hid-samples",
  raw: "pen:hid-raw",
  status: "pen:hid-status",
  command: "pen:hid-command",
} as const

/** The Wacom vendor id. The helper's session grants this vendor and no other (permissions.ts). */
export const WACOM_VENDOR_ID = 0x056a

export interface HidCommand {
  /** start: list the permitted devices and open the pen ones. stop: close them. request: `navigator.hid.requestDevice` (main sends it with a user gesture), then adopt. */
  cmd: "start" | "stop" | "request"
  vendorIds: number[]
}

export interface HidRawRecord {
  /** Device key inside the helper ("d0"). */
  key: string
  reportId: number
  /** Epoch ms (same clock as PenSample.t). */
  t: number
  hex: string
  note?: string
}

export type HidDevState = "ignored" | "opening" | "open" | "failed" | "gone"

export interface HidDeviceStatus {
  key: string
  vendorId: number
  productId: number
  productName: string
  state: HidDevState
  /** Why `failed` / `ignored`, in plain words. */
  error: string | null
  /** Input reports received / reports the decoder could not use. */
  reports: number
  dropped: number
  /** Reports per report id, as strings ("213": 1200). */
  reportCounts: Record<string, number>
  /** "d:1 #213" - the report the pen is read from; null when the device has no pen report. */
  primary: string | null
  /** The vendor-page report that was decoded as a last resort (4.3), or null. */
  fallback: string | null
  fallbackActive: boolean
  /** Top-level collections as "page:usage" ("1:1 ff00:a d:1"). */
  collections: string
  /** summarizeLayout of the primary report. */
  layout: string | null
  /** The primary report carries an In Range field: main need not time visits out. */
  hasInRange: boolean
  info: DeviceInfo | null
}

export interface HidHostStatus {
  phase: "loaded" | "started" | "stopped"
  /** navigator.hid exists in the helper page. */
  hidAvailable: boolean
  devices: HidDeviceStatus[]
  /** Free text for the trace / reason (an error the page caught). */
  note?: string
  /** describeCollections of the first pen-capable device, sent once per start for the trace. */
  collections?: unknown
}

// ---------------------------------------------------------------------------------------------
// Validation (main side)
// ---------------------------------------------------------------------------------------------

export const MAX_SAMPLES_PER_MESSAGE = 512
export const MAX_RAW_PER_MESSAGE = 256
const MAX_HEX = 4096

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = "", max = 400): string => (typeof v === "string" ? v.slice(0, max) : fallback)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Samples from the page: anything with a non-finite number is dropped, the label is forced, at most MAX_SAMPLES_PER_MESSAGE. */
export function parseSamples(value: unknown): PenSample[] {
  if (!Array.isArray(value)) return []
  const out: PenSample[] = []
  for (const item of value.slice(0, MAX_SAMPLES_PER_MESSAGE)) {
    if (!isRecord(item)) continue
    const { t, x, y, p } = item
    if (typeof t !== "number" || typeof x !== "number" || typeof y !== "number" || typeof p !== "number") continue
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p)) continue
    const s: PenSample = {
      t, x: clamp01(x), y: clamp01(y), p: clamp01(p),
      tip: item.tip === true, lower: item.lower === true, upper: item.upper === true, eraser: item.eraser === true,
      inRange: item.inRange !== false,
      backend: "webhid",
    }
    if (typeof item.tiltX === "number" && Number.isFinite(item.tiltX)) s.tiltX = Math.max(-90, Math.min(90, item.tiltX))
    if (typeof item.tiltY === "number" && Number.isFinite(item.tiltY)) s.tiltY = Math.max(-90, Math.min(90, item.tiltY))
    out.push(s)
  }
  return out
}

export function parseRaw(value: unknown): HidRawRecord[] {
  if (!Array.isArray(value)) return []
  const out: HidRawRecord[] = []
  for (const item of value.slice(0, MAX_RAW_PER_MESSAGE)) {
    if (!isRecord(item) || typeof item.hex !== "string" || !/^[0-9a-f]*$/i.test(item.hex)) continue
    const rec: HidRawRecord = { key: str(item.key, "d?", 16), reportId: num(item.reportId, 0), t: num(item.t, 0), hex: item.hex.slice(0, MAX_HEX) }
    if (typeof item.note === "string") rec.note = item.note.slice(0, 80)
    out.push(rec)
  }
  return out
}

function parseInfo(value: unknown): DeviceInfo | null {
  if (!isRecord(value)) return null
  const pair = (v: unknown): [number, number] | null =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null
  const claims = isRecord(value.claims) ? value.claims : {}
  const aspect = typeof value.aspect === "number" && Number.isFinite(value.aspect) && value.aspect > 0 ? value.aspect : null
  return {
    name: str(value.name, "HID pen", 120),
    vendorId: typeof value.vendorId === "number" ? value.vendorId : null,
    productId: typeof value.productId === "number" ? value.productId : null,
    aspect,
    rawX: pair(value.rawX),
    rawY: pair(value.rawY),
    pressureMax: typeof value.pressureMax === "number" && Number.isFinite(value.pressureMax) ? value.pressureMax : null,
    claims: {
      pressure: claims.pressure === true, tilt: claims.tilt === true, lower: claims.lower === true, upper: claims.upper === true, eraser: claims.eraser === true,
    },
  }
}

const STATES: readonly HidDevState[] = ["ignored", "opening", "open", "failed", "gone"]

function parseDevice(value: unknown): HidDeviceStatus | null {
  if (!isRecord(value)) return null
  const state = STATES.find((s) => s === value.state)
  if (!state) return null
  const counts: Record<string, number> = {}
  if (isRecord(value.reportCounts)) {
    for (const [k, v] of Object.entries(value.reportCounts).slice(0, 32)) if (typeof v === "number" && Number.isFinite(v)) counts[k.slice(0, 8)] = v
  }
  return {
    key: str(value.key, "d?", 16),
    vendorId: num(value.vendorId, 0),
    productId: num(value.productId, 0),
    productName: str(value.productName, "", 120),
    state,
    error: typeof value.error === "string" ? value.error.slice(0, 300) : null,
    reports: Math.max(0, num(value.reports, 0)),
    dropped: Math.max(0, num(value.dropped, 0)),
    reportCounts: counts,
    primary: typeof value.primary === "string" ? value.primary.slice(0, 40) : null,
    fallback: typeof value.fallback === "string" ? value.fallback.slice(0, 40) : null,
    fallbackActive: value.fallbackActive === true,
    collections: str(value.collections, "", 200),
    layout: typeof value.layout === "string" ? value.layout.slice(0, 600) : null,
    hasInRange: value.hasInRange === true,
    info: parseInfo(value.info),
  }
}

export function parseHostStatus(value: unknown): HidHostStatus | null {
  if (!isRecord(value)) return null
  const phase = value.phase === "loaded" || value.phase === "started" || value.phase === "stopped" ? value.phase : null
  if (!phase) return null
  const devices: HidDeviceStatus[] = []
  if (Array.isArray(value.devices)) for (const d of value.devices.slice(0, 16)) { const p = parseDevice(d); if (p) devices.push(p) }
  const out: HidHostStatus = { phase, hidAvailable: value.hidAvailable === true, devices }
  if (typeof value.note === "string") out.note = value.note.slice(0, 400)
  if (value.collections !== undefined) out.collections = value.collections
  return out
}
