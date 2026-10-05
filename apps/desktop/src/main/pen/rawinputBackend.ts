/**
 * main/pen/rawinputBackend.ts - the Raw Input HID backend (docs/spikes/DESIGN-pen-capture.md 4.3, owner IMPL-A).
 *
 * WM_INPUT for the digitizer-page collections of the tablet (RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, never RIDEV_NOLEGACY), decoded with
 * the ONE shared HID decoder (hid/decoder.ts) from the layout Windows' own HID parser reports (hid.dll, hid/hidNative.ts probeLayout).
 *
 *  - ONE POSITION STREAM per VID:PID (revision 2): the Wacom exposes the same pen as Col03 (report 209) and Col04 (report 213) and a
 *    vendor Col02 (report 220, raw counts, no In Range, an idle heartbeat). A PrimaryPicker keeps the first digitizer collection to
 *    speak and keeps it until it has been silent for 250 ms; the vendor page is traced and NOT decoded, except as a last resort
 *    (VendorFallback: more than 3 vendor reports in 2 s while the digitizer collections deliver none).
 *  - Windows' own synthesised pen (`Microsoft HID RID`, SCREEN pixels) is excluded unless `allowSynthetic` (tests, the desktop suite,
 *    WRITEMIND_PEN_ALLOW_SYNTHETIC=1); `looksDriverMapped` is decided by that path alone.
 *  - frameKind is "device": x / y are 0..1 over the device's own logical range, no rotation, no flip (frame.ts / the manager).
 *  - The window procedure does the one thing that cannot wait (GetRawInputData, the handle is only valid until DefWindowProc) and
 *    queues the bytes; parsing, decoding and tracing run from a setImmediate drain, never inside the native callback.
 *  - stop() unregisters every usage it registered (RIDEV_REMOVE), destroys the message window and clears the timers; it is
 *    synchronous and idempotent, and `releaseAllNative()` (win32.ts) runs the same unregistration on every exit path.
 *  - Nothing throws into the main loop: every callback is wrapped, a canary break (FfiOverrun) fails the backend with a fatal event.
 *
 * Optional capability for the check: `mouseProbe(on)` registers the mouse usage (0x01/0x02) for a few seconds to learn whether the
 * Wacom pointer node reports ABSOLUTE (Pen mode) or RELATIVE (Mouse mode) positions. It receives every mouse move on the system, so
 * it is never on for long (a 15 s failsafe switches it off).
 */

import {
  LIVENESS,
  type BackendContext, type BackendEvent, type BackendStart, type BackendStatus, type DeviceInfo, type PenBackend, type PenSample,
} from "../../shared/pen"
import { BackendCore } from "./backendCore"
import { VisitTracker, type Cancel, type Schedule } from "./batcher"
import { describeDevice, PenDecoder, PrimaryPicker, VendorFallback } from "./hid/decoder"
import {
  isPenLayout, isSyntheticDevicePath, isVendorPage, looksDriverMapped, physicalExtent, portraitNative, primaryReportId, summarizeLayout,
  type HidLayout,
} from "./hid/layout"
import { MOUSE_MOVE_ABSOLUTE, parseRawInput } from "./hid/rawParse"
import {
  GIDC_ARRIVAL, GIDC_REMOVAL, RIDEV_DEVNOTIFY, RIDEV_INPUTSINK, WM_INPUT, WM_INPUT_DEVICE_CHANGE,
} from "./hid/rawNative"
import { realRawInputPort, type RawDevice, type RawInputPort, type RawUsage } from "./rawinputPort"
import { FfiOverrun, timedStep } from "./win32"
import type { CreateRawInputBackend } from "./types"

export { rawDeviceList } from "./rawinputPort"
export type { RawInputPort } from "./rawinputPort"

// ---------------------------------------------------------------------------------------------
// Optional capability: the mouse-node probe of the check (9.1 `tap` step needs to know Pen mode vs Mouse mode)
// ---------------------------------------------------------------------------------------------

export interface MouseProbeResult {
  /** Raw mouse events seen while the probe was on. */
  events: number
  absolute: number
  relative: number
  /** The same, only for devices whose name carries VID_056A (the Wacom pointer node). */
  wacomEvents: number
  wacomAbsolute: number
  wacomRelative: number
  /** Distinct device names that spoke (truncated). */
  devices: string[]
}

/** Implemented by the rawinput backend. The check turns it on for the tap step and off again (a failsafe turns it off after 15 s). */
export interface MouseProbing {
  mouseProbe(on: boolean): boolean
  mouseProbeResult(): MouseProbeResult
}
export const isMouseProbing = (b: PenBackend): b is PenBackend & MouseProbing =>
  typeof (b as Partial<MouseProbing>).mouseProbe === "function" && typeof (b as Partial<MouseProbing>).mouseProbeResult === "function"

// ---------------------------------------------------------------------------------------------
// The backend
// ---------------------------------------------------------------------------------------------

export interface RawInputOptions {
  /** Decode Windows' synthesised pen (`Microsoft HID RID`) too. Tests and the desktop suite only. */
  allowSynthetic?: boolean
  /** Allow the vendor-page last resort (default true). */
  vendorFallback?: boolean
  /** How long a digitizer collection owns the stream after its last report (default 250 ms). */
  holdMs?: number
  /** The timeout tick of the visit trackers (default 40 ms). */
  tickMs?: number
  /** Tests: timers. */
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (h: unknown) => void
  setImmediate?: (fn: () => void) => unknown
  /** Tests: the clock of the 8 ms sample batching. */
  schedule?: Schedule
  cancel?: Cancel
}

type Kind = "tablet" | "synthetic" | "vendor"

interface Dev {
  raw: RawDevice
  group: string
  kind: Kind
  layout: HidLayout
  decoder: PenDecoder
  label: string
  reports: number
  lastAt: number
}

type Queued =
  | { kind: "input"; bytes: Uint8Array; t: number }
  | { kind: "change"; arrival: boolean; handle: bigint; t: number }

const PEN_USAGES: readonly RawUsage[] = [
  { usagePage: 0x0d, usage: 0x02, flags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY },
  { usagePage: 0x0d, usage: 0x01, flags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY },
]
const TABLET_VID = 0x056a
const START_BUDGET_MS = 3500
const MOUSE_PROBE_FAILSAFE_MS = 15_000

/** `\\?\HID#VID_056A&PID_037A&Col03#...` -> "HID VID_056A&PID_037A": stable across reboots, no serial numbers. */
export function friendlyDeviceName(raw: RawDevice): string {
  const m = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i.exec(raw.name)
  if (m) return `HID VID_${m[1]!.toUpperCase()}&PID_${m[2]!.toUpperCase()}`
  if (isSyntheticDevicePath(raw.name)) return "Windows synthesized pen"
  return `HID ${raw.vendorId.toString(16).padStart(4, "0")}:${raw.productId.toString(16).padStart(4, "0")}`
}

const collectionOf = (name: string): string => /&(Col\d+)/i.exec(name)?.[1] ?? ""

export class RawInputBackend implements PenBackend, MouseProbing {
  readonly name = "rawinput" as const
  readonly frameKind = "device" as const

  private readonly core: BackendCore
  private nowFn: () => number = () => performance.timeOrigin + performance.now()
  private ctx: BackendContext | null = null
  private win: { hwnd: bigint; destroy(): void } | null = null
  private registered: RawUsage[] = []
  private readonly devs = new Map<bigint, Dev>()
  private readonly ignored = new Map<bigint, string>()
  private readonly trackers = new Map<string, VisitTracker>()
  private readonly picker: PrimaryPicker
  private readonly fallback = new VendorFallback()
  private tickTimer: unknown = null
  private startPromise: Promise<BackendStart> | null = null
  private running = false
  private generation = 0
  private nativeActiveUntil = 0
  private queue: Queued[] = []
  private drainScheduled = false
  private pendingOverrun: FfiOverrun | null = null
  private rawTraced = 0
  private hidDeviceCount = 0
  private stats = { wmInput: 0, wmInputFailed: 0, hidReports: 0, mouseEvents: 0, handleMsMax: 0, handleMsTotal: 0 }
  // mouse probe
  private mouseOn = false
  private mouseTimer: unknown = null
  private mouseNames = new Map<bigint, string>()
  private mouse: MouseProbeResult = emptyMouse()

  constructor(private readonly port: RawInputPort = realRawInputPort(), private readonly opts: RawInputOptions = {}) {
    this.core = new BackendCore("rawinput", { now: () => this.nowFn(), schedule: opts.schedule, cancel: opts.cancel })
    this.picker = new PrimaryPicker(opts.holdMs ?? 250)
  }

  // ---- PenBackend ---------------------------------------------------------------------------

  available(): { ok: true } | { ok: false; reason: string } {
    try { return this.port.available() } catch (e) { return { ok: false, reason: `Raw Input could not be checked: ${msg(e)}` } }
  }

  start(ctx: BackendContext): Promise<BackendStart> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.doStart(ctx).catch((e: unknown): BackendStart => {
      this.release()
      this.core.setState("failed", `Raw Input start failed: ${msg(e)}`)
      return { ok: false, reason: `Raw Input start failed: ${msg(e)}`, retry: "later" }
    })
    return this.startPromise
  }

  stop(): void {
    this.generation++
    this.release()
    this.startPromise = null
    this.ctx = null
    if (this.core.getState() !== "unavailable") this.core.setState("idle", null)
  }

  onSample(listener: (batch: PenSample[]) => void): () => void { return this.core.onSample(listener) }
  onEvent(listener: (event: BackendEvent) => void): () => void { return this.core.onEvent(listener) }

  status(): BackendStatus {
    this.core.fact("wmInput", this.stats.wmInput)
    this.core.fact("wmInputFailed", this.stats.wmInputFailed)
    this.core.fact("hidReports", this.stats.hidReports)
    this.core.fact("mouseEvents", this.stats.mouseEvents)
    this.core.fact("handleMsMax", Math.round(this.stats.handleMsMax * 100) / 100)
    this.core.fact("vendorFallback", this.vendorActive())
    return this.core.status()
  }

  // ---- start --------------------------------------------------------------------------------

  private async doStart(ctx: BackendContext): Promise<BackendStart> {
    const gen = ++this.generation
    const a = this.available()
    if (!a.ok) {
      this.core.setState("unavailable", a.reason)
      return { ok: false, reason: a.reason, retry: "never" }
    }
    this.ctx = ctx
    this.nowFn = ctx.now
    this.core.resetObservations()
    this.core.setState("starting", null)
    this.stats = { wmInput: 0, wmInputFailed: 0, hidReports: 0, mouseEvents: 0, handleMsMax: 0, handleMsTotal: 0 }
    this.rawTraced = 0
    this.pendingOverrun = null
    const t0 = performance.now()
    const slow = (name: string, ms: number): void => ctx.trace.event("rawinput", "slow-native-call", { step: name, ms })
    const alive = (): boolean => gen === this.generation

    // 1. the owner window
    try {
      this.win = timedStep("createWindow", () => this.port.createWindow((m, wp, lp) => this.onMessage(m, wp, lp)), slow)
    } catch (e) {
      const reason = `could not create the Raw Input message window: ${msg(e)}`
      this.core.setState("failed", reason)
      return { ok: false, reason, retry: "later" }
    }
    await tick()
    if (!alive()) return this.superseded()

    // 2. the registration (digitizer page; the vendor node of the tablet is added below once it is known)
    const reg = timedStep("RegisterRawInputDevices", () => this.port.register(PEN_USAGES, this.win!.hwnd), slow)
    if (!reg.ok) {
      this.release()
      const reason = `RegisterRawInputDevices failed (GetLastError ${reg.error})`
      this.core.setState("failed", reason)
      return { ok: false, reason, retry: "later" }
    }
    this.registered = PEN_USAGES.map((u) => ({ ...u }))
    await tick()
    if (!alive()) return this.superseded()

    // 3. the devices Windows lists
    let listed: RawDevice[] = []
    try { listed = timedStep("GetRawInputDeviceList", () => this.port.listDevices(), slow) } catch (e) {
      if (e instanceof FfiOverrun) return this.fatalStart(e)
      ctx.trace.event("rawinput", "list-failed", { message: msg(e) })
    }
    this.hidDeviceCount = listed.filter((d) => d.type === 2).length
    const candidates = listed.filter((d) => d.type === 2 && this.isCandidate(d))
    for (const d of candidates) {
      if (performance.now() - t0 > START_BUDGET_MS) { ctx.trace.event("rawinput", "start-budget", { resolved: this.devs.size, of: candidates.length }); break }
      try { this.resolve(d, slow) } catch (e) {
        if (e instanceof FfiOverrun) return this.fatalStart(e)
        this.ignored.set(d.handle, `layout probe failed: ${msg(e)}`)
        ctx.trace.event("rawinput", "resolve-failed", { device: friendlyDeviceName(d), message: msg(e) })
      }
      await tick()
      if (!alive()) return this.superseded()
    }
    this.registerVendorNodes()

    // 4. armed
    this.running = true
    this.startTick()
    const device = this.primaryDeviceInfo()
    this.core.setDevice(device)
    this.describeFacts(listed)
    if (!device) {
      this.core.setState("armed", `no digitizer-page device with a pen layout is listed; Windows lists ${this.hidDeviceCount} HID devices: ${this.deviceNames(listed)}`)
    } else {
      this.core.setState("armed", null)
    }
    return { ok: true, device }
  }

  private superseded(): BackendStart {
    return { ok: false, reason: "Raw Input was stopped while it was starting", retry: "later" }
  }

  private fatalStart(e: FfiOverrun): BackendStart {
    this.release()
    this.core.error(e.message, true)
    this.core.setState("failed", e.message)
    return { ok: false, reason: e.message, retry: "never" }
  }

  private isCandidate(d: RawDevice): boolean {
    if (isSyntheticDevicePath(d.name)) return this.opts.allowSynthetic === true
    return d.usagePage === 0x0d || d.vendorId === TABLET_VID
  }

  /** Describe + probe one device and keep it when it has a pen layout. Throws on a parser failure (FfiOverrun included). */
  private resolve(raw: RawDevice, slow: (name: string, ms: number) => void): Dev | null {
    const known = this.devs.get(raw.handle)
    if (known) return known
    if (this.ignored.has(raw.handle)) return null
    const probed = timedStep(`probe ${collectionOf(raw.name) || "device"}`, () => this.port.probe(raw.handle), slow)
    if (!probed) { this.ignored.set(raw.handle, "no preparsed data"); return null }
    const { layout } = probed
    const label = `${friendlyDeviceName(raw)}${collectionOf(raw.name) ? " " + collectionOf(raw.name) : ""}`
    this.ctx?.trace.event("rawinput", "layout", {
      dev: label, path: raw.name.replace(/#[^#]*#\{[^}]*\}$/, ""), vid: raw.vendorId, pid: raw.productId, usagePage: raw.usagePage, usage: raw.usage,
      summary: summarizeLayout(layout), notes: probed.notes.slice(0, 12), layout,
    })
    if (!isPenLayout(layout)) { this.ignored.set(raw.handle, "not a pen layout"); return null }
    const synthetic = isSyntheticDevicePath(raw.name)
    const kind: Kind | null = synthetic ? "synthetic" : isVendorPage(raw.usagePage) ? "vendor" : raw.usagePage === 0x0d ? "tablet" : null
    if (!kind) { this.ignored.set(raw.handle, "not a digitizer collection"); return null }
    const screen = synthetic ? this.port.screenSize() : null
    const decoder = new PenDecoder(layout, {
      backend: synthetic ? "rawinput-synth" : "rawinput-hid",
      // the synthesised device says 0..32000 but reports SCREEN PIXELS (measured)
      xyExtent: screen ? { x: screen.width, y: screen.height } : undefined,
    })
    const dev: Dev = { raw, group: `${raw.vendorId}:${raw.productId}`, kind, layout, decoder, label, reports: 0, lastAt: 0 }
    this.devs.set(raw.handle, dev)
    return dev
  }

  /** The vendor-page node of the tablet carries the last-resort stream: register ITS usage (never the whole vendor page). */
  private registerVendorNodes(): void {
    if (this.opts.vendorFallback === false || !this.win) return
    const extra: RawUsage[] = []
    for (const d of this.devs.values()) {
      if (d.kind !== "vendor" || d.raw.vendorId !== TABLET_VID) continue
      if (this.registered.some((u) => u.usagePage === d.raw.usagePage && u.usage === d.raw.usage)) continue
      if (extra.some((u) => u.usagePage === d.raw.usagePage && u.usage === d.raw.usage)) continue
      extra.push({ usagePage: d.raw.usagePage, usage: d.raw.usage, flags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY })
    }
    if (!extra.length) return
    const r = this.port.register(extra, this.win.hwnd)
    if (r.ok) this.registered.push(...extra)
    else this.ctx?.trace.event("rawinput", "vendor-register-failed", { error: r.error })
  }

  private primaryDeviceInfo(): DeviceInfo | null {
    let best: Dev | null = null
    for (const d of this.devs.values()) {
      if (d.kind === "vendor") continue
      if (!best || (d.kind === "tablet" && best.kind !== "tablet") || (d.kind === best.kind && d.raw.usage > best.raw.usage)) best = d
    }
    if (!best) {
      // a tablet whose only usable node is the vendor one still has a device to describe
      for (const d of this.devs.values()) if (d.kind === "vendor") { best = d; break }
    }
    return best ? describeDevice(best.layout, friendlyDeviceName(best.raw), best.raw.vendorId, best.raw.productId) : null
  }

  private describeFacts(listed: RawDevice[]): void {
    const primary = this.primaryDevice()
    this.core.fact("hidDevices", this.hidDeviceCount)
    this.core.fact("usableDevices", this.devs.size)
    this.core.fact("candidates", this.deviceNames(listed.filter((d) => d.type === 2 && this.isCandidate(d))))
    this.core.fact("synthetic", primary?.kind === "synthetic")
    this.core.fact("looksDriverMapped", primary ? looksDriverMapped(primary.raw.name) : false)
    this.core.fact("primary", primary?.label ?? null)
    if (primary) {
      const id = primaryReportId(primary.layout)
      const e = physicalExtent(primary.layout)
      this.core.fact("primaryReport", id)
      this.core.fact("descriptor", summarizeLayout(primary.layout).slice(0, 240))
      this.core.fact("physical", e ? `${e.x} x ${e.y}` : null)
      // both logical ranges are 32767 on the Wacom, so DeviceInfo.rawX / rawY cannot say which side is long: this fact does
      this.core.fact("portraitNative", portraitNative(primary.layout))
    }
    this.core.fact("collections", [...this.devs.values()].map((d) => `${d.label}:${d.kind}`).join(", ") || null)
  }

  private deviceNames(list: readonly RawDevice[]): string {
    const names = list.slice(0, 12).map((d) => `${friendlyDeviceName(d)}${collectionOf(d.name) ? " " + collectionOf(d.name) : ""} (${d.usagePage.toString(16)}:${d.usage.toString(16)})`)
    return names.join("; ") || "none"
  }

  private primaryDevice(): Dev | null {
    let best: Dev | null = null
    for (const d of this.devs.values()) {
      if (d.kind === "vendor") continue
      if (!best || (d.kind === "tablet" && best.kind !== "tablet")) best = d
    }
    return best
  }

  private vendorActive(): boolean {
    for (const d of this.devs.values()) if (d.kind === "vendor" && this.fallback.active(d.group)) return true
    return false
  }

  // ---- messages -----------------------------------------------------------------------------

  /** Runs inside the window procedure: only the read that cannot wait, then queue. Never throws. */
  private onMessage(msgId: number, wp: bigint, lp: bigint): void {
    try {
      if (!this.running && !this.win) return
      if (msgId === WM_INPUT) {
        this.stats.wmInput++
        const t = this.nowFn()
        const bytes = this.port.read(lp)
        if (!bytes) { this.stats.wmInputFailed++; return }
        this.queue.push({ kind: "input", bytes, t })
        this.scheduleDrain()
      } else if (msgId === WM_INPUT_DEVICE_CHANGE) {
        this.queue.push({ kind: "change", arrival: wp === BigInt(GIDC_ARRIVAL), handle: lp, t: this.nowFn() })
        this.scheduleDrain()
      }
    } catch (e) {
      if (e instanceof FfiOverrun) { this.pendingOverrun = e; this.scheduleDrain() }
      else this.core.error(`WM_INPUT read failed: ${msg(e)}`)
    }
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true
    const run = this.opts.setImmediate ?? ((fn: () => void) => setImmediate(fn))
    run(() => { this.drainScheduled = false; this.drain() })
  }

  /** Public for tests: process everything queued now. */
  drain(): void {
    if (this.pendingOverrun) { const e = this.pendingOverrun; this.pendingOverrun = null; this.fatal(e); return }
    const batch = this.queue
    if (!batch.length) return
    this.queue = []
    const t0 = performance.now()
    for (const q of batch) {
      try {
        if (q.kind === "input") this.handleInput(q.bytes, q.t)
        else this.handleChange(q.arrival, q.handle, q.t)
      } catch (e) {
        if (e instanceof FfiOverrun) { this.fatal(e); return }
        this.core.error(`Raw Input handler failed: ${msg(e)}`)
      }
    }
    const dt = performance.now() - t0
    this.stats.handleMsTotal += dt
    if (dt > this.stats.handleMsMax) this.stats.handleMsMax = dt
  }

  private handleChange(arrival: boolean, handle: bigint, t: number): void {
    if (!arrival) {
      const dev = this.devs.get(handle)
      this.devs.delete(handle)
      this.ignored.delete(handle)
      this.picker.forget(handle)
      this.mouseNames.delete(handle)
      if (dev) {
        const tr = this.trackers.get(dev.group)
        const gone = tr?.end(t)
        if (gone) this.core.emit(gone)
        this.ctx?.trace.event("rawinput", "device-removed", { device: dev.label })
        this.core.event({ kind: "device", info: this.primaryDeviceInfo() })
      }
      return
    }
    // arrival: forget what we thought of this handle and look again
    this.devs.delete(handle)
    this.ignored.delete(handle)
    let raw: RawDevice
    try { raw = this.port.describe(handle, 2) } catch { return }
    if (!this.isCandidate(raw)) return
    const slow = (name: string, ms: number): void => this.ctx?.trace.event("rawinput", "slow-native-call", { step: name, ms })
    try { this.resolve(raw, slow) } catch (e) {
      if (e instanceof FfiOverrun) throw e
      this.ignored.set(handle, `layout probe failed: ${msg(e)}`)
    }
    this.registerVendorNodes()
    const info = this.primaryDeviceInfo()
    if (info) {
      this.core.setDevice(info)
      if (this.core.getState() === "armed") this.core.setReason(null)
    }
    this.ctx?.trace.event("rawinput", "device-arrived", { device: friendlyDeviceName(raw), usable: this.devs.has(handle) })
  }

  private handleInput(bytes: Uint8Array, t: number): void {
    const raw = parseRawInput(bytes)
    if (!raw) { this.stats.wmInputFailed++; return }
    if (raw.type === 0) {
      this.stats.mouseEvents++
      if (this.mouseOn) this.countMouse(raw.device, (raw.mouse.flags & MOUSE_MOVE_ABSOLUTE) !== 0)
      return
    }
    if (raw.type !== 2) return
    let dev = this.devs.get(raw.device)
    if (!dev && !this.ignored.has(raw.device)) {
      // a device we have not met (it spoke before the start enumeration reached it, or it arrived without a notification)
      let desc: RawDevice | null = null
      try { desc = this.port.describe(raw.device, 2) } catch { desc = null }
      if (desc && this.isCandidate(desc)) {
        try { dev = this.resolve(desc, () => {}) ?? undefined } catch (e) {
          if (e instanceof FfiOverrun) throw e
          this.ignored.set(raw.device, `layout probe failed: ${msg(e)}`)
        }
        if (dev) this.registerVendorNodes()
      } else this.ignored.set(raw.device, "not a candidate")
    }
    if (!dev) return
    for (const rep of raw.reports) this.handleReport(dev, rep, t)
  }

  private handleReport(dev: Dev, rep: Uint8Array, t: number): void {
    dev.reports++
    dev.lastAt = t
    this.stats.hidReports++
    this.core.raw()
    this.traceRaw(dev, rep, t)
    const group = dev.group
    if (dev.kind === "vendor") {
      this.fallback.noteVendor(group, t)
      if (this.opts.vendorFallback === false || !this.fallback.active(group)) return
    } else if (dev.kind === "tablet") {
      this.fallback.noteDigitizer(group, t)
      if (!this.picker.accept(group, dev.raw.handle, t)) return // the sibling collection already carries this pen
      this.nativeActiveUntil = t + 500
    } else {
      if (!this.opts.allowSynthetic || t < this.nativeActiveUntil) return // the tablet's own stream wins while it talks
    }
    const sample = dev.decoder.decode(rep, t)
    if (!sample) { this.core.dropped(); return }
    this.pass(dev, sample, t)
  }

  private pass(dev: Dev, sample: PenSample, t: number): void {
    let tr = this.trackers.get(dev.group)
    if (!tr) this.trackers.set(dev.group, (tr = new VisitTracker()))
    const was = tr.inRange
    const out = tr.observe(sample, t)
    if (!out) { this.core.dropped(); return }
    if (dev.decoder.hasInRange && out.inRange) tr.proximity(true, t) // the device says by itself when the pen is near: no timeouts
    if (out.inRange !== was) this.core.event({ kind: "proximity", inRange: out.inRange })
    this.core.emit(out)
  }

  private traceRaw(dev: Dev, rep: Uint8Array, t: number): void {
    const n = ++this.rawTraced
    if (!this.ctx || !(n <= 400 || (n % 25 === 0 && n <= 50_000))) return
    try { this.ctx.trace.raw("rawinput", t, Buffer.from(rep).toString("hex"), `${dev.label} ${dev.kind}`) } catch { /* the trace is a convenience */ }
  }

  // ---- visit timeouts -----------------------------------------------------------------------

  private startTick(): void {
    if (this.tickTimer !== null) return
    const set = this.opts.setInterval ?? ((fn: () => void, ms: number) => {
      const h = setInterval(fn, ms) as unknown as { unref?: () => void }
      h.unref?.()
      return h
    })
    this.tickTimer = set(() => this.tickAll(), this.opts.tickMs ?? 40)
  }

  /** Public for tests: end visits that have been silent for LEAVE_HOVER_MS / LEAVE_CONTACT_MS. */
  tickAll(now: number = this.nowFn()): void {
    try {
      for (const tr of this.trackers.values()) {
        const leave = tr.tick(now)
        if (leave) { this.core.event({ kind: "proximity", inRange: false }); this.core.emit(leave) }
      }
    } catch (e) { this.core.error(`visit tick failed: ${msg(e)}`) }
  }

  // ---- the mouse probe ----------------------------------------------------------------------

  mouseProbe(on: boolean): boolean {
    if (on === this.mouseOn) return true
    if (!on) { this.mouseProbeOff(); return true }
    if (!this.win || !this.running) return false
    const r = this.port.register([{ usagePage: 1, usage: 2, flags: RIDEV_INPUTSINK }], this.win.hwnd)
    if (!r.ok) { this.ctx?.trace.event("rawinput", "mouse-probe-failed", { error: r.error }); return false }
    this.registered.push({ usagePage: 1, usage: 2, flags: RIDEV_INPUTSINK })
    this.mouseOn = true
    this.mouse = emptyMouse()
    this.mouseNames.clear()
    const set = this.opts.setInterval ?? ((fn: () => void, ms: number) => {
      const h = setTimeout(fn, ms) as unknown as { unref?: () => void }
      h.unref?.()
      return h
    })
    this.mouseTimer = set(() => this.mouseProbeOff(), MOUSE_PROBE_FAILSAFE_MS)
    return true
  }

  mouseProbeResult(): MouseProbeResult { return { ...this.mouse, devices: [...this.mouse.devices] } }

  private mouseProbeOff(): void {
    if (this.mouseTimer !== null) { (this.opts.clearInterval ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.mouseTimer); this.mouseTimer = null }
    if (!this.mouseOn) return
    this.mouseOn = false
    this.registered = this.registered.filter((u) => !(u.usagePage === 1 && u.usage === 2))
    try { this.port.unregister([{ usagePage: 1, usage: 2 }]) } catch { /* the OS drops it at exit */ }
  }

  private countMouse(handle: bigint, absolute: boolean): void {
    const m = this.mouse
    m.events++
    if (absolute) m.absolute++
    else m.relative++
    let name = this.mouseNames.get(handle)
    if (name === undefined) {
      try { name = handle === 0n ? "" : this.port.describe(handle, 0).name } catch { name = "" }
      this.mouseNames.set(handle, name)
      const short = name ? name.replace(/#[^#]*#\{[^}]*\}$/, "").slice(0, 80) : "injected / unnamed"
      if (m.devices.length < 8 && !m.devices.includes(short)) m.devices.push(short)
    }
    if (/VID_056A/i.test(name)) {
      m.wacomEvents++
      if (absolute) m.wacomAbsolute++
      else m.wacomRelative++
    }
  }

  // ---- stopping -----------------------------------------------------------------------------

  private fatal(e: FfiOverrun): void {
    this.release()
    this.core.error(e.message, true)
    this.core.setState("failed", e.message)
  }

  /** Release everything the OS gave us. Synchronous, idempotent, safe at any point of a start. */
  private release(): void {
    this.running = false
    if (this.tickTimer !== null) { (this.opts.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.tickTimer); this.tickTimer = null }
    if (this.mouseTimer !== null) { (this.opts.clearInterval ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.mouseTimer); this.mouseTimer = null }
    this.mouseOn = false
    if (this.registered.length) {
      try { this.port.unregister(this.registered.map((u) => ({ usagePage: u.usagePage, usage: u.usage }))) } catch { /* the OS drops it at exit */ }
      this.registered = []
    }
    if (this.win) {
      try { this.win.destroy() } catch { /* already gone */ }
      this.win = null
    }
    this.queue = []
    this.devs.clear()
    this.ignored.clear()
    this.trackers.clear()
    this.picker.clear()
    this.fallback.reset()
    this.mouseNames.clear()
    this.core.discard()
  }
}

const emptyMouse = (): MouseProbeResult => ({ events: 0, absolute: 0, relative: 0, wacomEvents: 0, wacomAbsolute: 0, wacomRelative: 0, devices: [] })
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

/** The real backend. `WRITEMIND_PEN_ALLOW_SYNTHETIC=1` lets the desktop suite decode Windows' synthesised pen. */
export const createRawInputBackend: CreateRawInputBackend = () =>
  new RawInputBackend(realRawInputPort(), { allowSynthetic: process.env.WRITEMIND_PEN_ALLOW_SYNTHETIC === "1" })

/** Tests and tools: the backend over any port. */
export const createRawInputBackendWith = (port: RawInputPort, opts: RawInputOptions = {}): RawInputBackend => new RawInputBackend(port, opts)

// keep the contract constant visible for the stale-visit tests
export const RAWINPUT_LEAVE = { hoverMs: LIVENESS.LEAVE_HOVER_MS, contactMs: LIVENESS.LEAVE_CONTACT_MS } as const
