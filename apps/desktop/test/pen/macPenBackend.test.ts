// The Mac's tablet reader (src/main/pen/macPenBackend.ts): wm-pen's lines, the report decoding, and the start / stop
// lifecycle against a fake helper process. Nothing here opens a tablet.
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcess } from "node:child_process"
import { describe, expect, it } from "vitest"
import { INPUT_MONITORING, MacPenBackend, parseHelperLine, sampleOf } from "../../src/main/pen/macPenBackend"
import { penDisabledReason } from "../../src/main/pen/subsystem"
import { defaultFrame, toSheet } from "../../src/main/pen/frame"
import { DEFAULT_SETTINGS, type BackendContext, type PenSample } from "../../src/shared/pen"

const DEVICE = { maxX: 15200, maxY: 9500, maxP: 2047 }

class FakeHelper extends EventEmitter {
  stdout = new PassThrough()
  stdin = new PassThrough()
  killed: string[] = []
  ended = false
  constructor() { super(); this.stdin.on("finish", () => { this.ended = true }) }
  kill(signal: string): boolean { this.killed.push(signal); return true }
  say(...lines: object[]): void { for (const l of lines) this.stdout.write(JSON.stringify(l) + "\n") }
}

const ctx = (mapSheet = true): BackendContext => ({
  sheetPhysical: null, now: () => 0, settings: { ...DEFAULT_SETTINGS, mapSheet },
  trace: { event: () => {}, raw: () => {} },
})

function rig() {
  const helpers: FakeHelper[] = []
  const backend = new MacPenBackend("/fake/wm-pen", () => 1000, () => {
    const h = new FakeHelper()
    helpers.push(h)
    return h as unknown as ChildProcess
  })
  return { backend, helpers }
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe("wm-pen's lines", () => {
  it("reads one JSON object per line and refuses anything else", () => {
    expect(parseHelperLine('{"k":"opened"}')).toEqual({ k: "opened" })
    expect(parseHelperLine("not json")).toBeNull()
    expect(parseHelperLine('{"x":1}')).toBeNull()
  })
})

describe("a pen report as a sample", () => {
  it("is 0..1 over the tablet with y pointing up (Wintab's way), pressure only with the tip down and ready", () => {
    const s = sampleOf({ f: 0x80 | 0x40 | 0x20 | 0x01, x: 7600, y: 2375, p: 1023 }, DEVICE, 5)!
    expect(s.x).toBeCloseTo(0.5)
    expect(s.y).toBeCloseTo(0.75)
    expect(s.p).toBeCloseTo(0.5, 2)
    expect(s.tip).toBe(true)
    expect(s.inRange).toBe(true)
    const hover = sampleOf({ f: 0x80 | 0x40 | 0x20, x: 0, y: 0, p: 900 }, DEVICE, 5)!
    expect(hover.tip).toBe(false)
    expect(hover.p).toBe(0)
  })

  it("reads the two side switches, and none of them before the tablet says they are ready", () => {
    expect(sampleOf({ f: 0xe2, x: 1, y: 1, p: 0 }, DEVICE, 0)).toMatchObject({ lower: true, upper: false })
    expect(sampleOf({ f: 0xe4, x: 1, y: 1, p: 0 }, DEVICE, 0)).toMatchObject({ lower: false, upper: true })
    expect(sampleOf({ f: 0xc6, x: 1, y: 1, p: 0 }, DEVICE, 0)).toMatchObject({ lower: false, upper: false, tip: false })
  })

  it("has no sample for a pen coming near without a position, and an out-of-range one for the pen leaving", () => {
    expect(sampleOf({ f: 0x80, x: 0, y: 0, p: 0 }, DEVICE, 0)).toBeNull()
    expect(sampleOf({ f: 0x00, x: 0, y: 0, p: 0 }, DEVICE, 0)).toMatchObject({ inRange: false, tip: false })
  })

  it("lands the tablet's top-left corner on the sheet's top-left under the default frame", () => {
    const corner = sampleOf({ f: 0xe0, x: 0, y: 0, p: 0 }, DEVICE, 0)!
    expect(toSheet(corner.x, corner.y, defaultFrame(15200, 9500))).toEqual([0, 0])
    const far = sampleOf({ f: 0xe0, x: 15200, y: 9500, p: 0 }, DEVICE, 0)!
    expect(toSheet(far.x, far.y, defaultFrame(15200, 9500))).toEqual([1, 1])
  })
})

describe("the backend over a fake wm-pen", () => {
  it("starts once the helper has the tablet, and its reports arrive as samples", async () => {
    const { backend, helpers } = rig()
    const got: PenSample[] = []
    backend.onSample((b) => got.push(...b))
    const started = backend.start(ctx())
    const h = helpers[0]!
    h.say({ k: "device", name: "Wacom Intuos S", pid: 0x37a, maxX: 15200, maxY: 9500, maxP: 2047 }, { k: "access", v: "granted" }, { k: "opened" })
    const result = await started
    expect(result).toMatchObject({ ok: true, device: { name: "Wacom Intuos S", rawX: [0, 15200], rawY: [0, 9500] } })
    h.say({ k: "p", f: 0xe1, x: 7600, y: 4750, p: 2047 }, { k: "p", f: 0x00, x: 0, y: 0, p: 0 })
    await tick()
    backend.stop()
    await tick()
    expect(got.map((s) => [s.inRange, s.tip])).toEqual([[true, true], [false, false]])
    expect(h.ended).toBe(true)
    expect(h.killed).toContain("SIGTERM")
  })

  it("says how to switch Input Monitoring on when macOS has not allowed it", async () => {
    const { backend, helpers } = rig()
    const started = backend.start(ctx())
    helpers[0]!.say({ k: "access", v: "denied" })
    expect(await started).toEqual({ ok: false, reason: INPUT_MONITORING, retry: "later" })
  })

  it("waits for a tablet to be plugged in when there is none", async () => {
    const { backend, helpers } = rig()
    const started = backend.start(ctx())
    helpers[0]!.say({ k: "refused", why: "no Wacom tablet is plugged in" })
    expect(await started).toMatchObject({ ok: false, retry: "after-replug" })
  })

  it("does not take the tablet while Map the whole tablet to the sheet is off", async () => {
    const { backend, helpers } = rig()
    expect(await backend.start(ctx(false))).toMatchObject({ ok: false, retry: "never" })
    expect(helpers).toHaveLength(0)
  })

  it("is unavailable without the helper", async () => {
    const backend = new MacPenBackend(null, () => 0)
    expect(backend.available().ok).toBe(false)
    expect(await backend.start(ctx())).toMatchObject({ ok: false, retry: "never" })
  })
})

describe("where the pen subsystem may run", () => {
  const base = { env: {}, userData: "/u", exists: () => false }
  it("runs on Windows and on the Mac, and nowhere else", () => {
    expect(penDisabledReason({ ...base, platform: "win32" })).toBeNull()
    expect(penDisabledReason({ ...base, platform: "darwin" })).toBeNull()
    expect(penDisabledReason({ ...base, platform: "linux" })).not.toBeNull()
  })
})
