// The WebHID backend (design 4.4) driven by a fake helper host. Two kinds of host:
//   - WiredHost runs the REAL helper-page logic (wireHost + WebHidSource) over a fake navigator.hid and hands every message through a JSON
//     round trip, like IPC does - everything but Electron's window;
//   - ScriptedHost says exactly what the test tells it to (the failure paths: no answer, a hang, a crash).
// Time is a manual scheduler, so budgets and leave timeouts are exact.
import { beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS, LIVENESS, type BackendContext, type BackendEvent, type BackendStart, type PenSample } from "../../src/shared/pen"
import type { WebHidDeps } from "../../src/main/pen/types"
import type { HostMessageSink, WebHidHost } from "../../src/main/pen/webhid/electronHost"
import { wireHost, type HostHandle } from "../../src/main/pen/webhid/hostPage"
import type { HidCommand, HidHostStatus } from "../../src/main/pen/webhid/protocol"
import { START_BUDGET_MS, createWebHidBackendWith, type WebHidBackendOptions } from "../../src/main/pen/webhid/webhidBackend"
import { FakeDevice, FakeHid, hexToBytes, modelCollection, modelReport, realDevice, realWacom, report213 } from "./webhidFixtures"

class Sched {
  t = 1_000_000
  private q: { id: number; at: number; fn: () => void }[] = []
  private n = 0
  schedule = (fn: () => void, ms: number): unknown => { const id = ++this.n; this.q.push({ id, at: this.t + ms, fn }); return id }
  cancel = (h: unknown): void => { this.q = this.q.filter((e) => e.id !== h) }
  now = (): number => this.t
  pending = (): number => this.q.length
  advance(ms: number): void {
    const end = this.t + ms
    for (;;) {
      const next = this.q.filter((e) => e.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!next) break
      this.q = this.q.filter((e) => e !== next)
      this.t = Math.max(this.t, next.at)
      next.fn()
    }
    this.t = end
  }
}
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)) }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

class WiredHost implements WebHidHost {
  sink: HostMessageSink | null = null
  goneL = new Set<(why: string) => void>()
  commands: HidCommand[] = []
  closed = false
  loadError: string | null = null
  loadHangs = false
  scripts: string[] = []
  requested = 0
  handle: HostHandle | null = null
  private command: ((c: HidCommand) => void) | null = null
  constructor(public hid: FakeHid | undefined, private sched: Sched) {}
  async load(): Promise<void> {
    if (this.loadHangs) return new Promise<void>(() => undefined)
    if (this.loadError) throw new Error(this.loadError)
    this.handle = wireHost(
      {
        samples: (b) => this.sink?.samples(clone(b)),
        raw: (r) => this.sink?.raw(clone(r)),
        status: (s) => this.sink?.status(clone(s)),
        onCommand: (cb) => { this.command = cb },
      },
      {
        hid: this.hid,
        requestDevice: async () => { this.requested++; await this.hid?.requestDevice() },
        now: this.sched.now,
        timeOrigin: 0,
        setTimer: this.sched.schedule,
        clearTimer: this.sched.cancel,
      },
    )
  }
  send(c: HidCommand): void { this.commands.push(c); this.command?.(c) }
  async requestDevice(): Promise<void> { await this.handle?.handle({ cmd: "request", vendorIds: [0x056a] }) }
  async evaluate(script: string): Promise<void> { this.scripts.push(script) }
  onMessage(s: HostMessageSink): () => void { this.sink = s; return () => { this.sink = null } }
  onGone(l: (why: string) => void): () => void { this.goneL.add(l); return () => { this.goneL.delete(l) } }
  close(): void { this.closed = true; this.handle?.source()?.stop() }
  fireGone(why: string): void { for (const l of [...this.goneL]) l(why) }
}

class ScriptedHost implements WebHidHost {
  sink: HostMessageSink | null = null
  goneL = new Set<(why: string) => void>()
  commands: HidCommand[] = []
  closed = false
  onLoad: (h: ScriptedHost) => void = () => undefined
  onStart: (h: ScriptedHost) => void = () => undefined
  async load(): Promise<void> { this.onLoad(this) }
  send(c: HidCommand): void { this.commands.push(c); if (c.cmd === "start") this.onStart(this) }
  async requestDevice(): Promise<void> { /* nothing */ }
  async evaluate(): Promise<void> { /* nothing */ }
  onMessage(s: HostMessageSink): () => void { this.sink = s; return () => { this.sink = null } }
  onGone(l: (why: string) => void): () => void { this.goneL.add(l); return () => { this.goneL.delete(l) } }
  close(): void { this.closed = true }
  status(partial: Partial<HidHostStatus>): void { this.sink?.status({ phase: "loaded", hidAvailable: true, devices: [], ...partial }) }
}

interface Rig {
  sched: Sched
  hid: FakeHid
  hosts: (WiredHost | ScriptedHost)[]
  perms: { installs: number; undos: number; vendorIds: readonly number[][] }
  ctx: BackendContext
  trace: { events: { name: string; data?: Record<string, unknown> }[]; raw: { t: number; hex: string; note?: string }[] }
  samples: PenSample[][]
  events: BackendEvent[]
  backend: ReturnType<typeof createWebHidBackendWith>
}

function rig(opts: { host?: "wired" | "scripted"; hid?: FakeHid | null; options?: Partial<WebHidBackendOptions>; scripted?: (h: ScriptedHost) => void; wired?: (h: WiredHost) => void } = {}): Rig {
  const sched = new Sched()
  const hid = opts.hid ?? new FakeHid()
  const hosts: Rig["hosts"] = []
  const perms = { installs: 0, undos: 0, vendorIds: [] as readonly number[][] }
  const trace: Rig["trace"] = { events: [], raw: [] }
  const deps: WebHidDeps = { session: {} as WebHidDeps["session"], preload: "pen-hid.cjs", page: "pen-hid.html", log: () => undefined }
  const backend = createWebHidBackendWith(deps, {
    hostFactory: () => {
      const h = opts.host === "scripted" ? new ScriptedHost() : new WiredHost(opts.hid === null ? undefined : hid, sched)
      if (h instanceof ScriptedHost) opts.scripted?.(h)
      else opts.wired?.(h)
      hosts.push(h)
      return h
    },
    installPermissions: (_d, ids) => { perms.installs++; perms.vendorIds.push(ids); return () => { perms.undos++ } },
    exists: () => true,
    schedule: sched.schedule,
    cancel: sched.cancel,
    now: sched.now,
    ...opts.options,
  })
  const ctx: BackendContext = {
    sheetPhysical: null,
    trace: {
      event: (_s, name, data) => { trace.events.push({ name, data }) },
      raw: (_b, t, hex, note) => { trace.raw.push({ t, hex, note }) },
    },
    lease: { ready: () => false, holdWintab: () => false, dropWintab: () => undefined },
    now: sched.now,
    settings: DEFAULT_SETTINGS,
  }
  const out: Rig = { sched, hid, hosts, perms, ctx, trace, samples: [], events: [], backend }
  backend.onSample((b) => out.samples.push(b))
  backend.onEvent((e) => out.events.push(e))
  return out
}

const wiredOf = (r: Rig): WiredHost => r.hosts[r.hosts.length - 1] as WiredHost
const flat = (r: Rig): PenSample[] => r.samples.flat()

/** `waitMs`: time the start is allowed to spend waiting (a requestDevice that finds nothing waits for the whole REQUEST_WAIT_MS). */
async function startOk(r: Rig, waitMs = 0): Promise<Extract<BackendStart, { ok: true }>> {
  const p = r.backend.start(r.ctx)
  await settle()
  if (waitMs) { r.sched.advance(waitMs); await settle() }
  const res = await p
  if (!res.ok) throw new Error(`start failed: ${res.reason}`)
  return res
}

describe("available()", () => {
  it("says what is missing, in words", () => {
    const deps: WebHidDeps = { session: {} as WebHidDeps["session"], preload: "P", page: "H", log: () => undefined }
    expect(createWebHidBackendWith(deps, { exists: (p) => p !== "H" }).available()).toMatchObject({ ok: false, reason: expect.stringMatching(/helper page is missing/) })
    expect(createWebHidBackendWith(deps, { exists: (p) => p !== "P" }).available()).toMatchObject({ ok: false, reason: expect.stringMatching(/preload is missing/) })
    expect(createWebHidBackendWith(deps, { exists: () => true }).available()).toEqual({ ok: true })
  })

  it("start() on a missing helper is unavailable, never retried", async () => {
    const deps: WebHidDeps = { session: {} as WebHidDeps["session"], preload: "P", page: "H", log: () => undefined }
    const b = createWebHidBackendWith(deps, { exists: () => false })
    const res = await b.start({ ...rig().ctx })
    expect(res).toMatchObject({ ok: false, retry: "never" })
    expect(b.status().state).toBe("unavailable")
  })

  it("is a device-frame backend called webhid; its start budget is inside the manager's", () => {
    const r = rig()
    expect(r.backend.name).toBe("webhid")
    expect(r.backend.frameKind).toBe("device")
    expect(START_BUDGET_MS).toBeLessThan(LIVENESS.START_TIMEOUT_MS)
  })
})

describe("the real Wacom, helper logic wired in", () => {
  let r: Rig
  let pen: FakeDevice
  beforeEach(() => {
    r = rig()
    pen = realDevice()
    r.hid.devices = [pen]
  })

  it("start() installs the Wacom-only permissions, starts the page, opens the pen and reports the device", async () => {
    const res = await startOk(r)
    expect(r.perms.vendorIds).toEqual([[0x056a]])
    expect(res.device).toMatchObject({ name: "CTL-472", vendorId: 0x056a, productId: 0x037a, rawX: [0, 32767], pressureMax: 2047 })
    expect(res.device!.aspect).toBeCloseTo(15200 / 9500, 6)
    expect(wiredOf(r).commands).toEqual([{ cmd: "start", vendorIds: [0x056a] }])
    expect(pen.opened).toBe(true)
    const st = r.backend.status()
    expect(st.state).toBe("armed")
    expect(st.reason).toBeNull()
    expect(st.device?.name).toBe("CTL-472")
    expect(st.facts).toMatchObject({ hid: true, devices: 1, open: 1, product: "CTL-472", primary: "d:1 #213", collections: "1:1 ff00:a d:1", hasInRange: true })
    expect(r.events.some((e) => e.kind === "device" && e.info?.name === "CTL-472")).toBe(true)
    expect(r.trace.events.map((e) => e.name)).toEqual(expect.arrayContaining(["layout", "armed", "device"]))
    const layout = r.trace.events.find((e) => e.name === "layout")!.data!
    expect(layout.dev).toBe("CTL-472")
    expect(Array.isArray(layout.descriptor)).toBe(true)
  })

  it("start() is idempotent: a second call returns the same result without a second window", async () => {
    const a = r.backend.start(r.ctx)
    const b = r.backend.start(r.ctx)
    await settle()
    expect(await a).toEqual(await b)
    const c = await r.backend.start(r.ctx)
    expect(c.ok).toBe(true)
    expect(r.hosts).toHaveLength(1)
  })

  it("pen reports become device-frame samples labelled webhid, and the backend turns live", async () => {
    await startOk(r)
    const h = wiredOf(r)
    for (let i = 0; i < 6; i++) {
      pen.emit(213, report213({ tip: 1, x: 1000 + i * 500, y: 8000, pressure: 800 + i * 10 }), r.sched.now())
      r.sched.advance(5)
    }
    r.sched.advance(20)
    const got = flat(r)
    expect(got).toHaveLength(6)
    expect(got[0]).toMatchObject({ backend: "webhid", tip: true, inRange: true })
    expect(got[0]!.x).toBeCloseTo(1000 / 32767, 6)
    expect(got[5]!.x).toBeCloseTo(3500 / 32767, 6)
    expect(r.backend.status().state).toBe("live")
    expect(r.backend.status().counters).toMatchObject({ samples: 6, inRange: 6, tipDowns: 1, visits: 1 })
    expect(h.closed).toBe(false)
  })

  it("the page's report counts reach the counters and the facts", async () => {
    await startOk(r)
    pen.emit(220, hexToBytes(realWacom.heartbeat.hex), r.sched.now())
    for (let i = 0; i < 5; i++) pen.emit(213, report213({ x: 100 + i * 400, y: 5 }), r.sched.now())
    r.sched.advance(300) // the page's status timer
    const st = r.backend.status()
    expect(st.counters.raw).toBe(6)
    expect(st.facts["reports.213"]).toBe(5)
    expect(st.facts["reports.220"]).toBe(1)
    expect(st.seen).toMatchObject({ moved: true })
  })

  it("raw reports go to the trace as hex with their device and id", async () => {
    await startOk(r)
    pen.emit(220, hexToBytes(realWacom.heartbeat.hex), r.sched.now())
    pen.emit(213, report213({ x: 1, y: 1 }), r.sched.now())
    r.sched.advance(60) // the page's raw flush
    expect(r.trace.raw).toHaveLength(2)
    expect(r.trace.raw[0]).toMatchObject({ hex: realWacom.heartbeat.hex, note: "d0 id220" })
    expect(r.trace.raw[1]!.hex).toHaveLength(74)
    expect(r.trace.raw[1]!.note).toBe("d0 id213")
  })

  it("a device with an In Range field is not timed out: the visit ends only when the pen says so", async () => {
    await startOk(r)
    pen.emit(213, report213({ x: 5000, y: 5000 }), r.sched.now())
    pen.emit(213, report213({ x: 5100, y: 5000 }), r.sched.now())
    r.sched.advance(20)
    r.sched.advance(10_000)
    expect(flat(r).every((s) => s.inRange)).toBe(true)
    pen.emit(213, report213({ inRange: 0, x: 5100, y: 5000 }), r.sched.now())
    r.sched.advance(20)
    expect(flat(r).at(-1)).toMatchObject({ inRange: false })
    expect(flat(r).filter((s) => !s.inRange)).toHaveLength(1)
  })

  it("stop() destroys the window, puts the permissions back, goes quiet and can be called again", async () => {
    await startOk(r)
    const h = wiredOf(r)
    r.backend.stop()
    expect(h.closed).toBe(true)
    expect(r.perms.undos).toBe(1)
    expect(r.backend.status().state).toBe("idle")
    expect(pen.listeners.size).toBe(0)
    const n = flat(r).length
    h.sink?.samples([{ t: 1, x: 0.5, y: 0.5, p: 0, tip: false }]) // a late message: no sink any more
    r.sched.advance(100)
    expect(flat(r).length).toBe(n)
    r.backend.stop()
    expect(r.perms.undos).toBe(1)
  })

  it("can be started again after stop(): a fresh window, fresh counters", async () => {
    await startOk(r)
    pen.emit(213, report213({ x: 5, y: 5 }), r.sched.now())
    r.sched.advance(20)
    r.backend.stop()
    await startOk(r)
    expect(r.hosts).toHaveLength(2)
    expect(r.perms.installs).toBe(2)
    expect(r.backend.status().counters.samples).toBe(0)
    expect(r.backend.status().state).toBe("armed")
  })

  it("a helper that goes away after start fails the backend with a fatal error", async () => {
    await startOk(r)
    wiredOf(r).fireGone("the WebHID helper page stopped (crashed)")
    const st = r.backend.status()
    expect(st.state).toBe("failed")
    expect(st.reason).toBe("the WebHID helper page stopped (crashed)")
    expect(r.events.some((e) => e.kind === "error" && e.fatal && /crashed/.test(e.message))).toBe(true)
  })

  it("a hot-unplugged tablet leaves the backend armed with the reason; plugging it back re-adopts it and the manager hears of it", async () => {
    await startOk(r)
    pen.emit(213, report213({ x: 10, y: 10 }), r.sched.now())
    r.hid.fire("disconnect", pen)
    await settle()
    r.sched.advance(20)
    expect(flat(r).at(-1)).toMatchObject({ inRange: false })
    expect(r.backend.status().reason).toMatch(/closed|no pen report|lists no device/)
    const events = r.events.length
    const again = realDevice()
    r.hid.devices = [again]
    r.hid.fire("connect", again)
    await settle()
    expect(again.opened).toBe(true)
    expect(r.backend.status().reason).toBeNull()
    expect(r.events.length).toBeGreaterThanOrEqual(events)
  })
})

describe("a pen without an In Range field", () => {
  it("the visit ends after the hover / contact timeouts, exactly once", async () => {
    const r = rig()
    const pen = new FakeDevice(0x056a, 0x037a, "model pen", [modelCollection()])
    r.hid.devices = [pen]
    await startOk(r)
    pen.emit(7, modelReport(100, 100, 0, 0), r.sched.now())
    pen.emit(7, modelReport(110, 100, 0, 0), r.sched.now())
    r.sched.advance(20)
    expect(flat(r)).toHaveLength(2)
    r.sched.advance(LIVENESS.LEAVE_HOVER_MS - 50)
    expect(flat(r)).toHaveLength(2)
    r.sched.advance(100)
    expect(flat(r)).toHaveLength(3)
    expect(flat(r).at(-1)).toMatchObject({ inRange: false, tip: false })
    r.sched.advance(10_000)
    expect(flat(r)).toHaveLength(3)
  })

  it("a still pen in contact gets the longer contact timeout", async () => {
    const r = rig()
    const pen = new FakeDevice(0x056a, 0x037a, "model pen", [modelCollection()])
    r.hid.devices = [pen]
    await startOk(r)
    pen.emit(7, modelReport(100, 100, 200, 1), r.sched.now())
    r.sched.advance(LIVENESS.LEAVE_HOVER_MS + 200)
    expect(flat(r).every((s) => s.inRange)).toBe(true)
    r.sched.advance(LIVENESS.LEAVE_CONTACT_MS)
    expect(flat(r).at(-1)).toMatchObject({ inRange: false })
  })
})

describe("no device, or one that refuses", () => {
  it("nothing listed: asks once with a gesture, then arms with the reason and no device", async () => {
    const r = rig()
    const res = await startOk(r, 1000)
    expect(res.device).toBeNull()
    expect(wiredOf(r).requested).toBe(1)
    const st = r.backend.status()
    expect(st.state).toBe("armed")
    expect(st.reason).toMatch(/lists no device from vendor 056a/)
  })

  it("requestDevice finds the tablet", async () => {
    const r = rig()
    r.hid.grantOnRequest = [realDevice()]
    const res = await startOk(r)
    expect(res.device?.name).toBe("CTL-472")
    expect(r.backend.status().reason).toBeNull()
  })

  it("a tablet plugged in after start is adopted and announced as a device event", async () => {
    const r = rig()
    await startOk(r, 1000)
    expect(r.events.some((e) => e.kind === "device" && e.info)).toBe(false)
    const pen = realDevice()
    r.hid.fire("connect", pen)
    await settle()
    expect(r.events.some((e) => e.kind === "device" && e.info?.name === "CTL-472")).toBe(true)
    expect(r.backend.status().reason).toBeNull()
    expect(r.backend.status().device?.name).toBe("CTL-472")
  })

  it("open() refused: start fails with the reason, retries later, and lets go of everything", async () => {
    const r = rig()
    const pen = realDevice()
    pen.openError = new Error("NotAllowedError: Failed to open the device")
    r.hid.devices = [pen]
    const p = r.backend.start(r.ctx)
    await settle()
    const res = await p
    expect(res).toEqual({ ok: false, reason: "open() refused: NotAllowedError: Failed to open the device", retry: "later" })
    expect(r.backend.status()).toMatchObject({ state: "failed", reason: "open() refused: NotAllowedError: Failed to open the device" })
    expect(wiredOf(r).closed).toBe(true)
    expect(r.perms.undos).toBe(1)
  })

  it("a vendor device with no pen report arms with a reason naming it", async () => {
    const r = rig()
    r.hid.devices = [new FakeDevice(0x056a, 0x1234, "Wacom Pad", [{ usagePage: 0xff00, usage: 1, inputReports: [] }])]
    const res = await startOk(r)
    expect(res.device).toBeNull()
    expect(r.backend.status().reason).toMatch(/none with a pen report \(Wacom Pad: no collection with a pen report/)
  })

  it("navigator.hid missing is final: retry never", async () => {
    const r = rig({ hid: null })
    const p = r.backend.start(r.ctx)
    await settle()
    expect(await p).toMatchObject({ ok: false, retry: "never", reason: expect.stringMatching(/navigator\.hid is not available/) })
    expect(r.backend.status().state).toBe("failed")
  })
})

describe("failure paths of the window", () => {
  it("a real page that cannot load is a failed start", async () => {
    const r = rig({ wired: (h) => { h.loadError = "ERR_FILE_NOT_FOUND" } })
    const p = r.backend.start(r.ctx)
    await settle()
    expect(await p).toMatchObject({ ok: false, retry: "later", reason: expect.stringMatching(/ERR_FILE_NOT_FOUND/) })
  })

  it("a load that throws", async () => {
    const r = rig({ host: "scripted", scripted: (h) => { h.onLoad = () => { throw new Error("ERR_FILE_NOT_FOUND") } } })
    const p = r.backend.start(r.ctx)
    await settle()
    expect(await p).toEqual({ ok: false, reason: "the WebHID helper window failed to load: ERR_FILE_NOT_FOUND", retry: "later" })
    expect(r.hosts[0]!.closed).toBe(true)
  })

  it("a load that never finishes: gives up after the load budget", async () => {
    const r = rig({ host: "scripted", scripted: (h) => { h.load = () => new Promise<void>(() => undefined) } })
    const p = r.backend.start(r.ctx)
    await settle()
    r.sched.advance(2500)
    expect(await p).toMatchObject({ ok: false, retry: "later", reason: "the WebHID helper window did not load in time" })
    expect(r.hosts[0]!.closed).toBe(true)
  })

  it("a page that loads but never answers (script or preload failed)", async () => {
    const r = rig({ host: "scripted" })
    const p = r.backend.start(r.ctx)
    await settle()
    r.sched.advance(1500)
    expect(await p).toMatchObject({ ok: false, retry: "later", reason: expect.stringMatching(/did not answer/) })
  })

  it("a page that answers but hangs while listing / opening devices", async () => {
    const r = rig({ host: "scripted", scripted: (h) => { h.onLoad = () => h.status({ phase: "loaded" }) } })
    const p = r.backend.start(r.ctx)
    await settle()
    r.sched.advance(START_BUDGET_MS)
    expect(await p).toMatchObject({ ok: false, retry: "later", reason: expect.stringMatching(/getDevices\(\) or open\(\) hung/) })
  })

  it("a renderer that dies while starting fails the start with its own reason", async () => {
    const r = rig({
      host: "scripted",
      scripted: (h) => { h.onLoad = () => h.status({ phase: "loaded" }); h.onStart = () => { for (const l of [...h.goneL]) l("the WebHID helper page stopped (crashed)") } },
    })
    const p = r.backend.start(r.ctx)
    await settle()
    expect(await p).toEqual({ ok: false, reason: "the WebHID helper page stopped (crashed)", retry: "later" })
  })

  it("stop() while starting lets go and the start says so", async () => {
    const r = rig({ host: "scripted", scripted: (h) => { h.onLoad = () => h.status({ phase: "loaded" }) } })
    const p = r.backend.start(r.ctx)
    await settle()
    r.backend.stop()
    expect(await p).toMatchObject({ ok: false, reason: "stopped while starting" })
    expect(r.hosts[0]!.closed).toBe(true)
    expect(r.perms.undos).toBe(1)
    expect(r.backend.status().state).toBe("idle")
  })

  it("a factory that throws is a failed start, not an exception", async () => {
    const deps: WebHidDeps = { session: {} as WebHidDeps["session"], preload: "P", page: "H", log: () => undefined }
    const sched = new Sched()
    const b = createWebHidBackendWith(deps, {
      hostFactory: () => { throw new Error("no window for you") }, installPermissions: () => () => undefined, exists: () => true,
      schedule: sched.schedule, cancel: sched.cancel, now: sched.now,
    })
    const res = await b.start(rig().ctx)
    expect(res).toMatchObject({ ok: false, retry: "later", reason: "WebHID start threw: no window for you" })
  })
})

describe("what the page says is not trusted", () => {
  it("malformed samples, raw records and statuses are dropped without a throw", async () => {
    const r = rig()
    r.hid.devices = [realDevice()]
    await startOk(r)
    const sink = wiredOf(r).sink!
    sink.samples("garbage")
    sink.samples([null, 3, { t: "x" }, { t: 1, x: Number.NaN, y: 0, p: 0 }, { t: 2, x: 0.5, y: 0.5, p: 0, tip: false }])
    sink.raw([{ hex: "zz" }, { hex: "0a0b", key: "d0", reportId: 3, t: 5 }])
    sink.status({ phase: "wat" })
    sink.status(42)
    r.sched.advance(20)
    expect(flat(r)).toHaveLength(1)
    expect(flat(r)[0]).toMatchObject({ backend: "webhid", inRange: true })
    expect(r.trace.raw).toEqual([{ t: 5, hex: "0a0b", note: "d0 id3" }])
    expect(r.backend.status().counters.dropped).toBeGreaterThanOrEqual(2)
  })

  it("coordinates are clamped to 0..1 and the label is forced", async () => {
    const r = rig()
    r.hid.devices = [realDevice()]
    await startOk(r)
    wiredOf(r).sink!.samples([{ t: 3, x: 7, y: -2, p: 9, tip: true, inRange: true, backend: "evil" }])
    r.sched.advance(20)
    expect(flat(r)[0]).toMatchObject({ x: 1, y: 0, p: 1, backend: "webhid" })
  })
})
