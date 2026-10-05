// The helper-page side of WebHID: the private message validation (protocol.ts), the session permissions (permissions.ts) and the page's
// command loop (hostPage.ts wireHost) over a fake bridge and a fake navigator.hid. Design 4.4.
import { describe, expect, it, vi } from "vitest"
import { wireHost, type HostEnv, type PenHidBridge } from "../../src/main/pen/webhid/hostPage"
import {
  HID_CHANNELS, MAX_RAW_PER_MESSAGE, MAX_SAMPLES_PER_MESSAGE, WACOM_VENDOR_ID, parseHostStatus, parseRaw, parseSamples,
  type HidCommand, type HidHostStatus, type HidRawRecord,
} from "../../src/main/pen/webhid/protocol"
import { installHidPermissions, type HidChooserDetails, type HidSessionLike, type SelectHidDevice } from "../../src/main/pen/webhid/permissions"
import type { PenSample } from "../../src/shared/pen"
import { FakeDevice, FakeHid, modelCollection, modelReport, realDevice, report213 } from "./webhidFixtures"

describe("protocol: channels", () => {
  it("are the pen:hid-* names, spelled once", () => {
    expect(HID_CHANNELS).toEqual({ samples: "pen:hid-samples", raw: "pen:hid-raw", status: "pen:hid-status", command: "pen:hid-command" })
    expect(WACOM_VENDOR_ID).toBe(0x056a)
  })
})

describe("protocol: parseSamples", () => {
  it("keeps good samples, clamps them and forces the label", () => {
    const [s] = parseSamples([{ t: 5, x: 1.5, y: -1, p: 2, tip: true, lower: true, tiltX: 120, tiltY: -0.5, backend: "x" }])
    expect(s).toEqual({ t: 5, x: 1, y: 0, p: 1, tip: true, lower: true, upper: false, eraser: false, inRange: true, backend: "webhid", tiltX: 90, tiltY: -0.5 })
  })
  it("drops what is not a sample, and non-finite numbers", () => {
    expect(parseSamples(null)).toEqual([])
    expect(parseSamples({})).toEqual([])
    expect(parseSamples([1, "a", null, [], { t: 1 }, { t: 1, x: Infinity, y: 0, p: 0 }, { t: Number.NaN, x: 0, y: 0, p: 0 }])).toEqual([])
  })
  it("inRange is true unless the page says false; flags need === true", () => {
    const [a, b] = parseSamples([{ t: 1, x: 0, y: 0, p: 0, inRange: false, tip: 1 }, { t: 2, x: 0, y: 0, p: 0 }])
    expect(a).toMatchObject({ inRange: false, tip: false })
    expect(b).toMatchObject({ inRange: true })
  })
  it("takes at most MAX_SAMPLES_PER_MESSAGE", () => {
    const many = Array.from({ length: MAX_SAMPLES_PER_MESSAGE + 50 }, (_, i) => ({ t: i, x: 0, y: 0, p: 0 }))
    expect(parseSamples(many)).toHaveLength(MAX_SAMPLES_PER_MESSAGE)
  })
  it("leaves tilt absent when the page sent none", () => {
    const [s] = parseSamples([{ t: 1, x: 0, y: 0, p: 0 }])
    expect("tiltX" in s!).toBe(false)
  })
})

describe("protocol: parseRaw / parseHostStatus", () => {
  it("raw records must be hex", () => {
    expect(parseRaw([{ key: "d0", reportId: 213, t: 3, hex: "00ff", note: "n" }, { hex: "xyz" }, { hex: 5 }, 7])).toEqual([{ key: "d0", reportId: 213, t: 3, hex: "00ff", note: "n" }])
    expect(parseRaw("no")).toEqual([])
    expect(parseRaw(Array.from({ length: MAX_RAW_PER_MESSAGE + 5 }, () => ({ hex: "00" })))).toHaveLength(MAX_RAW_PER_MESSAGE)
  })

  const device = {
    key: "d0", vendorId: 0x056a, productId: 0x037a, productName: "CTL-472", state: "open", error: null, reports: 3, dropped: 1,
    reportCounts: { "213": 2, "220": 1 }, primary: "d:1 #213", fallback: "ff00:a #220", fallbackActive: false, collections: "1:1 ff00:a d:1",
    layout: "webhid d:1 id213[...]", hasInRange: true,
    info: { name: "CTL-472", vendorId: 1386, productId: 890, aspect: 1.6, rawX: [0, 32767], rawY: [0, 32767], pressureMax: 2047, claims: { pressure: true, tilt: true, lower: true, upper: true, eraser: true } },
  }

  it("a good status round-trips", () => {
    const s = parseHostStatus({ phase: "started", hidAvailable: true, devices: [device], note: "hi", collections: [{ usagePage: 1 }] })!
    expect(s.phase).toBe("started")
    expect(s.hidAvailable).toBe(true)
    expect(s.devices[0]).toEqual(device)
    expect(s.note).toBe("hi")
    expect(s.collections).toEqual([{ usagePage: 1 }])
  })

  it("a bad phase or a non-object is null; bad devices are skipped", () => {
    expect(parseHostStatus(null)).toBeNull()
    expect(parseHostStatus({ phase: "x" })).toBeNull()
    expect(parseHostStatus([])).toBeNull()
    const s = parseHostStatus({ phase: "loaded", devices: [{ state: "bogus" }, 5, device] })!
    expect(s.hidAvailable).toBe(false)
    expect(s.devices).toHaveLength(1)
  })

  it("device info is sanitised", () => {
    const s = parseHostStatus({ phase: "started", devices: [{ ...device, info: { name: 5, aspect: -3, rawX: [1], claims: { pressure: 1 } } }] })!
    expect(s.devices[0]!.info).toEqual({
      name: "HID pen", vendorId: null, productId: null, aspect: null, rawX: null, rawY: null, pressureMax: null,
      claims: { pressure: false, tilt: false, lower: false, upper: false, eraser: false },
    })
  })
})

// ---------------------------------------------------------------------------------------------

class FakeSession implements HidSessionLike {
  device: ((d: { deviceType: string; device: { vendorId: number } }) => boolean) | null = null
  check: ((c: unknown, p: string) => boolean) | null = null
  request: ((c: unknown, p: string, cb: (g: boolean) => void) => void) | null = null
  listeners = new Set<SelectHidDevice>()
  setDevicePermissionHandler(h: typeof this.device): void { this.device = h }
  setPermissionCheckHandler(h: typeof this.check): void { this.check = h }
  setPermissionRequestHandler(h: typeof this.request): void { this.request = h }
  on(_e: "select-hid-device", l: SelectHidDevice): void { this.listeners.add(l) }
  removeListener(_e: "select-hid-device", l: SelectHidDevice): void { this.listeners.delete(l) }
  choose(details: HidChooserDetails): { prevented: boolean; picked: string | null } {
    let prevented = false
    let picked: string | null = null
    for (const l of [...this.listeners]) l({ preventDefault: () => { prevented = true } }, details, (id) => { picked = id })
    return { prevented, picked }
  }
}

describe("permissions", () => {
  it("lets the page see HID devices of the allowed vendor and nothing else", () => {
    const s = new FakeSession()
    installHidPermissions(s, { vendorIds: [0x056a] })
    expect(s.device!({ deviceType: "hid", device: { vendorId: 0x056a } })).toBe(true)
    expect(s.device!({ deviceType: "hid", device: { vendorId: 0x046d } })).toBe(false)
    expect(s.device!({ deviceType: "usb", device: { vendorId: 0x056a } })).toBe(false)
    expect(s.device!({ deviceType: "serial", device: { vendorId: 0x056a } })).toBe(false)
  })

  it("grants the hid permission and no other", () => {
    const s = new FakeSession()
    installHidPermissions(s, { vendorIds: [0x056a] })
    expect(s.check!(null, "hid")).toBe(true)
    for (const p of ["media", "geolocation", "notifications", "clipboard-read", "usb"]) expect(s.check!(null, p)).toBe(false)
    const answers: boolean[] = []
    s.request!(null, "hid", (g) => answers.push(g))
    s.request!(null, "media", (g) => answers.push(g))
    expect(answers).toEqual([true, false])
  })

  it("answers the requestDevice chooser by picking the first allowed device, never a stranger", () => {
    const s = new FakeSession()
    installHidPermissions(s, { vendorIds: [0x056a] })
    expect(s.choose({ deviceList: [{ deviceId: "a", vendorId: 0x046d }, { deviceId: "b", vendorId: 0x056a }, { deviceId: "c", vendorId: 0x056a }] })).toEqual({ prevented: true, picked: "b" })
    expect(s.choose({ deviceList: [{ deviceId: "a", vendorId: 0x046d }] })).toEqual({ prevented: true, picked: "" })
    expect(s.choose({ deviceList: [] })).toEqual({ prevented: true, picked: "" })
  })

  it("the undo puts the session back, once", () => {
    const s = new FakeSession()
    const undo = installHidPermissions(s, { vendorIds: [0x056a] })
    expect(s.listeners.size).toBe(1)
    undo()
    expect(s.listeners.size).toBe(0)
    expect(s.device).toBeNull()
    expect(s.check).toBeNull()
    expect(s.request).toBeNull()
    s.device = () => true
    undo() // idempotent: does not clobber a later handler
    expect(s.device).not.toBeNull()
  })

  it("logs its decisions", () => {
    const s = new FakeSession()
    const lines: string[] = []
    installHidPermissions(s, { vendorIds: [0x056a], log: (l) => lines.push(l) })
    s.device!({ deviceType: "hid", device: { vendorId: 0x056a } })
    s.choose({ deviceList: [{ deviceId: "x", vendorId: 0x056a }] })
    expect(lines.join("\n")).toMatch(/devicePermission hid vid=56a -> allow/)
    expect(lines.join("\n")).toMatch(/select-hid-device 1 listed -> x/)
  })

  it("tolerates a session that throws on the way out", () => {
    const s = new FakeSession()
    s.removeListener = () => { throw new Error("destroyed") }
    const undo = installHidPermissions(s, { vendorIds: [0x056a] })
    expect(() => undo()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------------------------

function pageRig(hid: FakeHid | undefined, over: Partial<HostEnv> = {}) {
  const samples: PenSample[][] = []
  const raws: HidRawRecord[][] = []
  const statuses: HidHostStatus[] = []
  let command: ((c: HidCommand) => void) | null = null
  const bridge: PenHidBridge = {
    samples: (b) => samples.push(b),
    raw: (r) => raws.push(r),
    status: (s) => statuses.push(s),
    onCommand: (cb) => { command = cb },
  }
  let t = 1_000_000
  const env: HostEnv = {
    hid,
    requestDevice: async () => { await hid?.requestDevice() },
    now: () => t,
    timeOrigin: 0,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    ...over,
  }
  const host = wireHost(bridge, env)
  return { host, samples, raws, statuses, send: (c: HidCommand) => command!(c), tick: (ms: number) => { t += ms } }
}

describe("hostPage: the page's command loop", () => {
  it("announces itself as soon as it is wired (the handshake)", () => {
    const { statuses } = pageRig(new FakeHid())
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({ phase: "loaded", hidAvailable: true, devices: [] })
  })

  it("start lists and opens the pen, reports 'started' with the devices and the descriptor once", async () => {
    const hid = new FakeHid()
    const pen = realDevice()
    hid.devices = [pen]
    const { host, statuses } = pageRig(hid)
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    const last = statuses.at(-1)!
    expect(last.phase).toBe("started")
    expect(last.devices[0]).toMatchObject({ state: "open", productName: "CTL-472" })
    expect(pen.opened).toBe(true)
    expect(statuses.filter((s) => s.collections !== undefined)).toHaveLength(1)
    expect(statuses.filter((s) => s.phase === "started").length).toBeGreaterThanOrEqual(1)
    // while starting, the intermediate statuses said "loaded", never "started"
    const firstStarted = statuses.findIndex((s) => s.phase === "started")
    expect(statuses.slice(1, firstStarted).every((s) => s.phase === "loaded")).toBe(true)
  })

  it("samples and raw reports reach the bridge", async () => {
    vi.useFakeTimers()
    try {
      const hid = new FakeHid()
      const pen = realDevice()
      hid.devices = [pen]
      const { host, samples, raws } = pageRig(hid)
      await host.handle({ cmd: "start", vendorIds: [0x056a] })
      pen.emit(213, report213({ tip: 1, x: 100, y: 100 }), 1)
      await vi.advanceTimersByTimeAsync(100)
      expect(samples.flat()).toHaveLength(1)
      expect(raws.flat()).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })

  it("stop closes devices and reports 'stopped'; commands run in order", async () => {
    const hid = new FakeHid()
    const pen = realDevice()
    hid.devices = [pen]
    const { host, statuses, send } = pageRig(hid)
    send({ cmd: "start", vendorIds: [0x056a] })
    send({ cmd: "stop", vendorIds: [] })
    await host.handle({ cmd: "stop", vendorIds: [] })
    expect(pen.closeCalls).toBeGreaterThanOrEqual(1)
    expect(pen.listeners.size).toBe(0)
    expect(statuses.at(-1)!.phase).toBe("stopped")
    expect(statuses.some((s) => s.phase === "started")).toBe(true)
  })

  it("a second start replaces the first source", async () => {
    const hid = new FakeHid()
    const pen = realDevice()
    hid.devices = [pen]
    const { host } = pageRig(hid)
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    const first = host.source()
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    expect(host.source()).not.toBe(first)
    expect(first!.running).toBe(false)
    expect(pen.listeners.size).toBe(1)
  })

  it("request calls requestDevice then adopts what was granted", async () => {
    const hid = new FakeHid()
    hid.grantOnRequest = [realDevice()]
    const { host, statuses } = pageRig(hid)
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    expect(statuses.at(-1)!.devices).toHaveLength(0)
    await host.handle({ cmd: "request", vendorIds: [0x056a] })
    expect(statuses.at(-1)!.devices).toHaveLength(1)
    expect(statuses.at(-1)!.devices[0]!.state).toBe("open")
  })

  it("a refused requestDevice is a note, not a crash", async () => {
    const hid = new FakeHid()
    const { host, statuses } = pageRig(hid, { requestDevice: async () => { throw new Error("NotAllowedError: Must be handling a user gesture") } })
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    await host.handle({ cmd: "request", vendorIds: [0x056a] })
    expect(statuses.at(-1)!.note).toMatch(/requestDevice failed: NotAllowedError/)
  })

  it("request before start, or without requestDevice, says so", async () => {
    const a = pageRig(new FakeHid())
    await a.host.handle({ cmd: "request", vendorIds: [] })
    expect(a.statuses.at(-1)!.note).toMatch(/not available/)
  })

  it("no navigator.hid: 'started' with hidAvailable false and a note", async () => {
    const { host, statuses } = pageRig(undefined)
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    expect(statuses.at(-1)).toMatchObject({ phase: "started", hidAvailable: false, devices: [] })
    expect(statuses.at(-1)!.note).toMatch(/navigator\.hid is not available/)
  })

  it("a getDevices() that throws is reported, and the next command still runs", async () => {
    const hid = new FakeHid()
    hid.getDevices = async () => { throw new Error("boom") }
    const { host, statuses } = pageRig(hid)
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    expect(statuses.at(-1)!.note).toBe("start failed: boom")
    await host.handle({ cmd: "stop", vendorIds: [] })
    expect(statuses.at(-1)!.phase).toBe("stopped")
  })

  it("devices of other vendors are not opened", async () => {
    const hid = new FakeHid()
    const stranger = new FakeDevice(0x046d, 1, "mouse", [modelCollection()])
    hid.devices = [stranger]
    const { host } = pageRig(hid)
    await host.handle({ cmd: "start", vendorIds: [0x056a] })
    expect(stranger.opened).toBe(false)
    expect(modelReport(1, 1, 1, 1).length).toBe(6)
  })
})
