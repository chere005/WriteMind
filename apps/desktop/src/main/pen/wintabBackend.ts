/**
 * main/pen/wintabBackend.ts - the Wintab data / system backend (docs/spikes/DESIGN-pen-capture.md 4.2, owner IMPL-A).
 *
 * `wintab-data` and `wintab-system` are one class; only the context differs. The data context reads the tablet and moves nothing.
 * The system context additionally asks the driver to map the pen to the sheet (`setSheetPhysical`), so it is only ever opened when
 * a lease is READY, when the host gives one (the app does not: there is no guard process, see LeaseApi in shared/pen.ts for the residual risk).
 *
 * Start (a chain of small awaited steps, 4 s budget, each native step timed): recover stale contexts once per process, WTInfo
 * (0 tablets -> retry "after-replug" with the plain reason), read the device, create the owner window, open the context with the
 * FIRST mask of the ladder, poll. The packet mask is a LADDER (full -> min -> tiny): the layout has never met
 * a real packet, so the first 20 packets are judged for plausibility and an implausible stream, or a first packet bigger than the
 * computed size (a PacketSizeMismatch), moves the context to the next mask; nothing fits -> a fatal error naming both sizes.
 *
 * Polling is primary (4 ms while a pen is in range and for 2 s after, 33 ms idle; WT_PACKET messages only kick an immediate drain),
 * because whether the router driver delivers window messages to a koffi message-only window is unverified. The WNDPROC forwards
 * numbers to a queue and nothing else: no native call happens inside a koffi callback.
 *
 * In range: authoritative signals first (WT_PROXIMITY; TPS_PROXIMITY with an adaptive polarity, trusted as a live signal only after
 * it has been seen in BOTH states), otherwise the VisitTracker timeouts (600 ms hovering, 2000 ms in contact); exactly one leave
 * sample per visit. x / y leave in the DEVICE frame (y not flipped, no rotation): frame.ts and the manager own that.
 *
 * stop() is synchronous and idempotent: clears the timers, closes the context (WTClose), gives the 1 ms timer back,
 * destroys the window. closeAllWintab() (wintabNative.ts) does the same for every context on every exit path.
 */

import {
  LIVENESS,
  type BackendContext, type BackendEvent, type BackendStart, type BackendStatus, type Box, type DeviceInfo, type PenBackend, type PenSample,
} from "../../shared/pen"
import { BackendCore } from "./backendCore"
import { VisitTracker, type Cancel, type Schedule } from "./batcher"
import {
  MASK_LADDER, PlausibilityWatch, TPS, WT_DEFBASE, WT_MSG, WintabNormaliser, encodeWintabPackets, normaliserConfigFor, packetSize, parseProximityMessage,
  type LogContext, type RawPacket, type WintabDevice,
} from "./wintab"
import { PacketSizeMismatch, realWintabNative, type OpenOptions, type OpenResult, type WintabNative, type WintabSessionLike } from "./wintabNative"
import type { CreateWintabBackend, PenPaths, SystemMapped } from "./types"
import { FfiOverrun, timedStep } from "./win32"

export interface WintabBackendOptions {
  native?: WintabNative
  /** Poll periods (ms): while a pen is near and for `hotMs` after, and idle. */
  activeMs?: number
  idleMs?: number
  hotMs?: number
  /** A new sheet rectangle is applied after this long without another (system mode). */
  debounceMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  setImmediate?: (fn: () => void) => unknown
  /** Tests: the clock of the 8 ms sample batching. */
  schedule?: Schedule
  cancel?: Cancel
}

const START_BUDGET_MS = 3500
const SLOW_TICK_MS = 10
/** Process-wide memory so the stale-context recovery runs once per journal path. */
const recovered = new Set<string>()

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const hex = (n: number): string => "0x" + (n >>> 0).toString(16)

interface WtMessage { offset: number; lParam: bigint }

export class WintabBackend implements PenBackend {
  readonly name: "wintab-data" | "wintab-system"
  readonly frameKind = "device" as const

  protected readonly core: BackendCore
  protected readonly native: WintabNative
  protected ctx: BackendContext | null = null
  protected running = false
  protected session: WintabSessionLike | null = null
  protected sheetRect: Box | null = null
  private nowFn: () => number = () => performance.timeOrigin + performance.now()
  private win: { hwnd: bigint; destroy(): void } | null = null
  private device: WintabDevice | null = null
  private deviceInfo: DeviceInfo | null = null
  private norm: WintabNormaliser | null = null
  private plaus: PlausibilityWatch | null = null
  private tracker = new VisitTracker()
  private maskIdx = 0
  private timerHeld = false
  private pollTimer: unknown = null
  private immediatePending = false
  private startPromise: Promise<BackendStart> | null = null
  private generation = 0
  private messages: WtMessage[] = []
  private lastPacketAt = 0
  private rawTraced = 0
  private bitSet = false
  private bitClear = false
  private proxLive = false
  private activeMs: number
  private slowTicks = 0
  private lastSlowTraceAt = 0
  private stats = { packets: 0, polls: 0, messages: 0, handleMsMax: 0 }
  private ifaceText = ""

  constructor(readonly mode: "data" | "system", private readonly paths: PenPaths, protected readonly o: WintabBackendOptions = {}) {
    this.name = mode === "system" ? "wintab-system" : "wintab-data"
    this.native = o.native ?? realWintabNative()
    this.activeMs = o.activeMs ?? 4
    this.core = new BackendCore(this.name, { now: () => this.nowFn(), schedule: o.schedule, cancel: o.cancel })
  }

  // ---- PenBackend ---------------------------------------------------------------------------

  available(): { ok: true } | { ok: false; reason: string } {
    try { return this.native.available() } catch (e) { return { ok: false, reason: `Wintab could not be checked: ${msgOf(e)}` } }
  }

  start(ctx: BackendContext): Promise<BackendStart> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.doStart(ctx).catch((e: unknown): BackendStart => {
      this.release()
      const reason = `Wintab start failed: ${msgOf(e)}`
      this.core.setState("failed", reason)
      return { ok: false, reason, retry: "later" }
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
    this.core.fact("packets", this.stats.packets)
    this.core.fact("polls", this.stats.polls)
    this.core.fact("messages", this.stats.messages)
    this.core.fact("handleMsMax", Math.round(this.stats.handleMsMax * 100) / 100)
    this.core.fact("slowTicks", this.slowTicks)
    this.core.fact("polarity", this.norm ? (this.norm.polarity.flipped ? "flipped" : this.norm.polarity.decided ? "spec" : "undecided") : null)
    this.core.fact("proximityLive", this.proxLive)
    this.core.fact("context", this.session ? this.session.context.name : null)
    this.core.fact("pollMs", this.activeMs)
    return this.core.status()
  }

  // ---- start --------------------------------------------------------------------------------

  private async doStart(ctx: BackendContext): Promise<BackendStart> {
    const gen = ++this.generation
    const alive = (): boolean => gen === this.generation
    const a = this.available()
    if (!a.ok) {
      this.core.setState("unavailable", a.reason)
      return { ok: false, reason: a.reason, retry: "never" }
    }
    if (this.mode === "system" && ctx.lease && !ctx.lease.ready()) {
      const reason = "guard not ready: refusing a system context"
      this.core.setState("failed", reason)
      return { ok: false, reason, retry: "later" }
    }
    this.ctx = ctx
    this.nowFn = ctx.now
    this.sheetRect = ctx.sheetPhysical
    this.core.resetObservations()
    this.core.setState("starting", null)
    this.stats = { packets: 0, polls: 0, messages: 0, handleMsMax: 0 }
    this.rawTraced = 0
    this.maskIdx = 0
    this.bitSet = this.bitClear = this.proxLive = false
    this.tracker.reset()
    this.messages = []
    this.slowTicks = 0
    this.activeMs = this.o.activeMs ?? 4
    const t0 = performance.now()
    const slow = (name: string, ms: number): void => ctx.trace.event(this.name, "slow-native-call", { step: name, ms })
    const over = (step: string): BackendStart | null =>
      performance.now() - t0 > START_BUDGET_MS ? this.failStart(`Wintab start exceeded its ${START_BUDGET_MS} ms budget at "${step}"`, "later") : null
    const superseded = (): BackendStart => ({ ok: false, reason: "Wintab was stopped while it was starting", retry: "later" })

    // 1. stale contexts of a dead process (once per journal)
    if (!recovered.has(this.paths.wintabJournal)) {
      recovered.add(this.paths.wintabJournal)
      try {
        const n = timedStep("recoverStaleContexts", () => this.native.recoverStale(this.paths.wintabJournal), slow)
        if (n > 0) ctx.trace.event(this.name, "recovered-contexts", { closed: n })
      } catch (e) { ctx.trace.event(this.name, "recover-failed", { message: msgOf(e) }) }
    }
    await tick()
    if (!alive()) return superseded()

    // 2. what the driver says about itself
    let ifc
    try { ifc = timedStep("WTInfo interface", () => this.native.readInterface(), slow) } catch (e) {
      if (e instanceof FfiOverrun) return this.fatalStart(e)
      return this.failStart(`WTInfo failed: ${msgOf(e)}`, "later")
    }
    this.ifaceText = `${ifc.vendor || "Wintab"} spec ${ifc.specVersion} impl ${ifc.implVersion}`
    this.core.fact("interface", this.ifaceText)
    this.core.fact("devices", ifc.devices)
    this.core.fact("maxContexts", ifc.maxContexts)
    if (ifc.devices === 0) return this.failStart("Wintab reports 0 tablets: Windows or the Wacom service says the tablet is not working", "after-replug")
    await tick()
    if (!alive()) return superseded()
    let device: WintabDevice
    try { device = timedStep("read device", () => this.native.readDevice(0), slow) } catch (e) {
      if (e instanceof FfiOverrun) return this.fatalStart(e)
      return this.failStart(`reading the Wintab device failed: ${msgOf(e)}`, "later")
    }
    this.device = device
    this.deviceInfo = this.makeDeviceInfo(device)
    this.core.setDevice(this.deviceInfo)
    this.describeDevice(device)
    if (this.mode === "data" || firstOnce(ctx.trace, "layout")) ctx.trace.event(this.name, "layout", {
      dev: { name: device.name, x: device.x, y: device.y, pressure: device.pressure, orientation: device.orientation, pktRate: device.pktRate, pktData: hex(device.pktData), cursors: device.cursors },
      interface: ifc,
    })
    await tick()
    if (!alive()) return superseded()
    const late = over("device")
    if (late) return late

    // 3. the owner window
    try {
      this.win = timedStep("create window", () => this.native.createWindow((m, wp, lp) => this.onMessage(m, wp, lp)), slow)
    } catch (e) {
      return this.failStart(`could not create the Wintab message window: ${msgOf(e)}`, "later")
    }
    await tick()
    if (!alive()) return superseded()

    // 4. the context (a system context waits for the sheet rectangle: null means the pointer is the driver's)
    if (this.mode === "data" || this.sheetRect) {
      const r = this.openSession(this.sheetRect, 0)
      if (!r.ok) return this.failStart(r.reason, r.fatal ? "never" : "later", r.fatalError)
      await tick()
      if (!alive()) return superseded()
    } else {
      this.core.fact("contextState", "waiting for the sheet")
    }
    const late2 = over("context")
    if (late2) return late2

    // 5. polling
    this.running = true
    this.native.highResTimer(true)
    this.timerHeld = true
    this.schedulePoll(this.activeMs)
    this.core.setState("armed", null)
    return { ok: true, device: this.deviceInfo }
  }

  private failStart(reason: string, retry: "never" | "later" | "after-replug", fatalError?: FfiOverrun): BackendStart {
    this.release()
    if (fatalError) this.core.error(fatalError.message, true)
    this.core.setState("failed", reason)
    return { ok: false, reason, retry }
  }

  private fatalStart(e: FfiOverrun): BackendStart {
    return this.failStart(e.message, "never", e)
  }

  // ---- the context --------------------------------------------------------------------------

  /**
   * Open a context with MASK_LADDER[maskIdx], and make it the live session. The new context is opened
   * BEFORE the old one is closed (a rectangle change or a mask step), so the pointer is never without a context in between.
   */
  protected openSession(rect: Box | null, maskIdx: number): { ok: true } | { ok: false; reason: string; fatal: boolean; fatalError?: FfiOverrun } {
    const ctx = this.ctx
    const win = this.win
    if (!ctx || !win) return { ok: false, reason: "Wintab is not started", fatal: false }
    const opts: OpenOptions = {
      hwnd: win.hwnd, mode: this.mode, device: 0, journalPath: this.paths.wintabJournal, packetMask: MASK_LADDER[maskIdx]!,
      ...(this.mode === "system" && rect ? { sysRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : {}),
    }
    let result: OpenResult
    try { result = this.native.open(opts) } catch (e) {
      if (e instanceof FfiOverrun) return { ok: false, reason: e.message, fatal: true, fatalError: e }
      return { ok: false, reason: `WTOpen failed: ${msgOf(e)}`, fatal: false }
    }
    const session = result.session
    if (!session) return { ok: false, reason: result.error ?? "WTOpen failed", fatal: false }
    const handle = session.handle.toString()
    // No lease (the app has no guard process): the context is unguarded and is freed in-process / by the journal. With one, fail closed.
    let held = false
    try { held = ctx.lease ? ctx.lease.holdWintab(handle, this.mode) : false } catch { held = false }
    if (ctx.lease && !held && this.mode === "system") {
      session.close() // fail closed: a lease was given and refused
      return { ok: false, reason: "guard not ready: refusing a system context", fatal: false }
    }
    if (result.maskChanged) ctx.trace.event(this.name, "mask-changed", { asked: hex(result.maskChanged.asked), stored: hex(result.maskChanged.stored) })
    // from here on the new session is the live one; the old one goes
    const old = this.session
    this.session = session
    this.maskIdx = maskIdx
    if (old) this.closeSession(old)
    this.setupDecoding(session)
    // The system context is opened on every pen visit: its layout and stored context are logged once per session, later visits log nothing here.
    if (this.mode === "data" || firstOnce(ctx.trace, "context-opened")) {
      ctx.trace.event(this.name, "context-opened", {
        mode: this.mode, handle, mask: hex(session.mask), packetSize: packetSize(session.mask), ladder: maskIdx, ...(ctx.lease ? { leaseHeld: held } : {}),
        stored: dumpContext(session.context),
      })
    }
    this.core.fact("mask", hex(session.mask))
    this.core.fact("packetSize", packetSize(session.mask))
    this.core.fact("ladder", maskIdx)
    this.core.fact("inRect", `${session.context.inOrg[0]}+${session.context.inExt[0]} x ${session.context.inOrg[1]}+${session.context.inExt[1]}`)
    this.core.fact("contextState", held ? "open (guarded)" : "open (in-process cleanup + journal; no guard process)")
    if (this.mode === "system") this.core.fact("sysRect", rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : null)
    return { ok: true }
  }

  private setupDecoding(session: WintabSessionLike): void {
    const dev = this.device
    if (!dev) return
    const cfg = normaliserConfigFor(dev, session.context, "wintab", session.mask)
    if (this.norm) this.norm.setConfig(cfg)
    else this.norm = new WintabNormaliser(cfg)
    this.plaus = new PlausibilityWatch(
      { inOrg: [session.context.inOrg[0], session.context.inOrg[1]], inExt: [session.context.inExt[0], session.context.inExt[1]], pressureMax: dev.pressure.max || 32767 },
      20, 0.3, cfg.hasTime !== false,
    )
  }

  /** Close one session (and tell the lease, when there is one). Never throws. */
  private closeSession(s: WintabSessionLike): void {
    const handle = s.handle.toString()
    try { s.close() } catch { /* WTClose cannot be retried */ }
    try { this.ctx?.lease?.dropWintab(handle) } catch { /* nothing to tell */ }
  }

  // ---- the sheet rectangle (system mode; see WintabSystemBackend) ---------------------------

  protected applyRect(rect: Box | null): void {
    if (!this.running || !this.ctx) { this.sheetRect = rect; return }
    this.sheetRect = rect
    if (rect === null) {
      const s = this.session
      this.session = null
      if (s) { this.closeSession(s); this.core.fact("contextState", "closed (the pointer is the driver's)"); this.core.fact("sysRect", null) }
      return
    }
    const cur = this.session?.context
    if (cur && Math.abs(cur.sysOrg[0] - rect.x) < 2 && Math.abs(cur.sysOrg[1] - rect.y) < 2 && Math.abs(cur.sysExt[0] - rect.width) < 2 && Math.abs(cur.sysExt[1] - rect.height) < 2) return
    const r = this.openSession(rect, this.maskIdx)
    if (!r.ok) {
      this.ctx.trace.event(this.name, "rect-failed", { reason: r.reason })
      if (r.fatal && r.fatalError) this.fatal(r.fatalError)
    }
  }

  // ---- window messages (forward numbers, nothing else) -------------------------------------

  private onMessage(msgId: number, _wp: bigint, lp: bigint): void {
    if (msgId < WT_DEFBASE || msgId > WT_DEFBASE + 7) return
    this.messages.push({ offset: msgId - WT_DEFBASE, lParam: lp })
    if (this.messages.length > 256) this.messages.shift()
    this.kick()
  }

  private kick(): void {
    if (this.immediatePending || !this.running) return
    this.immediatePending = true
    const run = this.o.setImmediate ?? ((fn: () => void) => setImmediate(fn))
    run(() => { this.immediatePending = false; this.pollTick(false) })
  }

  // ---- polling ------------------------------------------------------------------------------

  private schedulePoll(ms: number): void {
    if (!this.running) return
    if (this.pollTimer !== null) (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.pollTimer)
    const set = this.o.setTimer ?? ((fn: () => void, d: number) => {
      const h = setTimeout(fn, d) as unknown as { unref?: () => void }
      h.unref?.()
      return h
    })
    this.pollTimer = set(() => { this.pollTimer = null; this.pollTick(true) }, ms)
  }

  /** One drain. Public for the tests (they call it with a fake native layer). Never throws. */
  pollTick(reschedule = true): void {
    if (!this.running) return
    const t0 = performance.now()
    try {
      this.drain()
    } catch (e) {
      if (e instanceof FfiOverrun) { this.fatal(e); return }
      this.core.error(`Wintab poll failed: ${msgOf(e)}`)
    }
    const dt = performance.now() - t0
    if (dt > this.stats.handleMsMax) this.stats.handleMsMax = dt
    if (dt > SLOW_TICK_MS) {
      this.slowTicks++
      this.activeMs = Math.min(33, this.activeMs * 2)
      const now = this.nowFn()
      if (now - this.lastSlowTraceAt > 1000) { this.lastSlowTraceAt = now; this.ctx?.trace.event(this.name, "slow-tick", { ms: Math.round(dt), pollMs: this.activeMs }) }
    }
    if (reschedule && this.running) {
      const now = this.nowFn()
      const hot = this.tracker.inRange || now - this.lastPacketAt < (this.o.hotMs ?? 2000)
      this.schedulePoll(hot ? this.activeMs : this.o.idleMs ?? 33)
    }
  }

  private drain(): void {
    const session = this.session
    const norm = this.norm
    const arrived = this.nowFn()
    this.stats.polls++
    // window messages first (proximity is authoritative)
    const msgs = this.messages
    if (msgs.length) {
      this.messages = []
      this.stats.messages += msgs.length
      for (const m of msgs) this.handleMessage(m, arrived)
    }
    if (session && norm && session.isOpen) {
      const out: PenSample[] = []
      let fallback: string | null = null
      for (let guard = 0; guard < 8 && fallback === null; guard++) {
        let raws: RawPacket[]
        try { raws = session.poll() } catch (e) {
          if (e instanceof PacketSizeMismatch) { fallback = e.message; break }
          throw e
        }
        if (!raws.length) break
        this.stats.packets += raws.length
        this.lastPacketAt = arrived
        this.core.raw(raws.length)
        if (this.mode === "data") this.traceRaw(raws, session.mask, arrived)
        for (const r of raws) {
          if ((r.status & TPS.PROXIMITY) !== 0) this.bitSet = true
          else this.bitClear = true
        }
        if (this.bitSet && this.bitClear) this.proxLive = true
        const plaus = this.plaus
        if (plaus && !plaus.settled) {
          for (const r of raws) {
            const verdict = plaus.observe(r)
            if (verdict === "fallback") { fallback = `${plaus.badCount} of ${plaus.seenCount} packets are implausible for mask ${hex(session.mask)}`; break }
          }
          if (fallback !== null) break
        }
        const samples = norm.pushBatch(raws, arrived, (outcome) => {
          this.ctx?.trace.event(this.name, outcome === "flipped" ? "prox-polarity-flipped" : "prox-polarity-spec", {})
        })
        for (const s of samples) {
          const was = this.tracker.inRange
          const o = this.tracker.observe(s, arrived)
          if (!o) { this.core.dropped(); continue }
          if (this.proxLive && o.inRange) this.tracker.proximity(true, arrived)
          if (o.inRange !== was) this.core.event({ kind: "proximity", inRange: o.inRange })
          out.push(o)
        }
        if (raws.length < 32) break
      }
      if (fallback !== null) { this.ladderDown(fallback); return }
      for (const s of out) this.core.emit(s)
    }
    const leave = this.tracker.tick(arrived)
    if (leave) { this.core.event({ kind: "proximity", inRange: false }); this.core.emit(leave) }
  }

  private handleMessage(m: WtMessage, now: number): void {
    switch (m.offset) {
      case WT_MSG.PROXIMITY: {
        const entered = parseProximityMessage(m.lParam).enteredContext
        if (entered) { this.tracker.proximity(true, now); break }
        const leave = this.tracker.proximity(false, now)
        if (leave) { this.core.event({ kind: "proximity", inRange: false }); this.core.emit(leave) }
        break
      }
      case WT_MSG.CTXCLOSE:
        this.fatalMessage("the driver closed our context (WT_CTXCLOSE)")
        break
      case WT_MSG.INFOCHANGE:
        this.core.event({ kind: "note", text: "Wintab: the driver's information changed (WT_INFOCHANGE)" })
        break
      default:
        break // WT_PACKET only kicks the drain; the rest are not needed
    }
  }

  private fatalMessage(text: string): void {
    this.release()
    this.core.error(text, true)
    this.core.setState("failed", text)
  }

  private fatal(e: FfiOverrun): void {
    this.release()
    this.core.error(e.message, true)
    this.core.setState("failed", e.message)
  }

  /** The stream is implausible with this mask (or the first packet was bigger than computed): next mask, or give up. */
  private ladderDown(why: string): void {
    const ctx = this.ctx
    if (!ctx) return
    const next = this.maskIdx + 1
    ctx.trace.event(this.name, "mask-fallback", { from: hex(MASK_LADDER[this.maskIdx]!), to: next < MASK_LADDER.length ? hex(MASK_LADDER[next]!) : null, why })
    if (next >= MASK_LADDER.length) {
      this.fatalMessage(`no packet mask decodes: ${why}`)
      return
    }
    const r = this.openSession(this.mode === "system" ? this.sheetRect : null, next)
    if (!r.ok) {
      if (r.fatalError) this.fatal(r.fatalError)
      else this.fatalMessage(`reopening with the next packet mask failed: ${r.reason}`)
    }
    this.tracker.reset()
  }

  private traceRaw(raws: readonly RawPacket[], mask: number, t: number): void {
    const ctx = this.ctx
    if (!ctx) return
    for (const r of raws) {
      const n = ++this.rawTraced
      if (!(n <= 400 || (n % 25 === 0 && n <= 50_000))) continue
      try {
        const bytes = encodeWintabPackets([r], mask)
        ctx.trace.raw(this.name, t, Buffer.from(bytes).toString("hex"), `mask ${hex(mask)}`)
      } catch { /* the trace is a convenience */ }
    }
  }

  // ---- device info --------------------------------------------------------------------------

  private makeDeviceInfo(d: WintabDevice): DeviceInfo {
    const ex = Math.abs(d.x.max - d.x.min) + 1
    const ey = Math.abs(d.y.max - d.y.min) + 1
    const pens = d.cursors.filter((c) => !c.isEraser)
    return {
      name: d.name || "Wintab tablet", vendorId: null, productId: null,
      aspect: ex > 1 && ey > 1 ? Math.round((Math.max(ex, ey) / Math.min(ex, ey)) * 1000) / 1000 : null,
      rawX: [d.x.min, d.x.max], rawY: [d.y.min, d.y.max], pressureMax: d.pressure.max || null,
      claims: {
        pressure: d.pressure.max > 0,
        tilt: d.orientation[0].max !== 0 || d.orientation[1].max !== 0,
        lower: pens.some((c) => c.buttons >= 2),
        upper: pens.some((c) => c.buttons >= 3),
        eraser: d.cursors.some((c) => c.isEraser),
      },
    }
  }

  private describeDevice(d: WintabDevice): void {
    this.core.fact("device", d.name || null)
    this.core.fact("x", `${d.x.min}..${d.x.max}`)
    this.core.fact("y", `${d.y.min}..${d.y.max}`)
    this.core.fact("pressureMax", d.pressure.max)
    this.core.fact("pktRate", d.pktRate)
    this.core.fact("cursors", d.cursors.map((c) => `${c.index}:${c.name || "?"}${c.isEraser ? " (eraser)" : ""} b${c.buttons}`).join("; ") || null)
  }

  // ---- release ------------------------------------------------------------------------------

  /** Everything the OS gave us, in the order that never leaves the pointer in a worse state. Synchronous, idempotent. */
  protected release(): void {
    this.running = false
    if (this.pollTimer !== null) { (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.pollTimer); this.pollTimer = null }
    this.immediatePending = false
    const s = this.session
    this.session = null
    if (s) this.closeSession(s)
    if (this.timerHeld) { this.timerHeld = false; try { this.native.highResTimer(false) } catch { /* the process ending gives it back */ } }
    if (this.win) {
      try { this.win.destroy() } catch { /* already gone */ }
      this.win = null
    }
    this.messages = []
    this.tracker.reset()
    this.norm = null
    this.plaus = null
    this.core.discard()
  }
}

/** The `wintab-system` backend: the same class plus `SystemMapped`, so `isSystemMapped` tells them apart. */
export class WintabSystemBackend extends WintabBackend implements SystemMapped {
  private pending: Box | null | undefined = undefined
  private debounce: unknown = null

  constructor(paths: PenPaths, o: WintabBackendOptions = {}) { super("system", paths, o) }

  /** `null` closes the context (the pointer is the driver's again); a rectangle is applied after 150 ms of quiet, ignoring changes under 2 px. */
  setSheetPhysical(rect: Box | null): void {
    if (!this.running) { this.sheetRect = rect; return }
    if (rect === null) {
      this.clearDebounce()
      this.pending = undefined
      this.applyRect(null)
      return
    }
    const cur = this.sheetRect
    if (cur && Math.abs(cur.x - rect.x) < 2 && Math.abs(cur.y - rect.y) < 2 && Math.abs(cur.width - rect.width) < 2 && Math.abs(cur.height - rect.height) < 2 && this.session) return
    this.pending = rect
    this.clearDebounce()
    const set = this.o.setTimer ?? ((fn: () => void, d: number) => {
      const h = setTimeout(fn, d) as unknown as { unref?: () => void }
      h.unref?.()
      return h
    })
    this.debounce = set(() => {
      this.debounce = null
      const r = this.pending
      this.pending = undefined
      if (r) { try { this.applyRect(r) } catch (e) { this.core.error(`applying the sheet rectangle failed: ${msgOf(e)}`) } }
    }, this.o.debounceMs ?? 150)
  }

  private clearDebounce(): void {
    if (this.debounce !== null) { (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.debounce); this.debounce = null }
  }

  protected override release(): void {
    this.clearDebounce()
    this.pending = undefined
    super.release()
  }
}

/** True the first time for this (trace sink, name): the system backend is rebuilt every pen visit and must not repeat its big dumps. */
const onceSeen = new WeakMap<object, Set<string>>()
function firstOnce(sink: object, name: string): boolean {
  let s = onceSeen.get(sink)
  if (!s) { s = new Set(); onceSeen.set(sink, s) }
  if (s.has(name)) return false
  s.add(name)
  return true
}

const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

/** The stored context, for the trace (numbers and the name only). */
function dumpContext(c: LogContext): Record<string, unknown> {
  return {
    name: c.name, options: hex(c.options), status: hex(c.status), msgBase: hex(c.msgBase), device: c.device, pktRate: c.pktRate,
    pktData: hex(c.pktData), pktMode: c.pktMode, moveMask: hex(c.moveMask), inOrg: c.inOrg, inExt: c.inExt, outOrg: c.outOrg, outExt: c.outExt,
    sysMode: c.sysMode, sysOrg: c.sysOrg, sysExt: c.sysExt,
  }
}

export const createWintabBackend: CreateWintabBackend = (mode, paths) =>
  mode === "system" ? new WintabSystemBackend(paths) : new WintabBackend("data", paths)

/** Tests and tools: the backend over any native layer. */
export function createWintabBackendWith(mode: "data" | "system", paths: PenPaths, o: WintabBackendOptions = {}): WintabBackend {
  return mode === "system" ? new WintabSystemBackend(paths, o) : new WintabBackend("data", paths, o)
}

export const WINTAB_POLL = { activeMs: 4, idleMs: 33, hotMs: 2000, leaveHoverMs: LIVENESS.LEAVE_HOVER_MS, leaveContactMs: LIVENESS.LEAVE_CONTACT_MS } as const
