/**
 * macPenBackend.ts - the Mac's tablet reader: runs `wm-pen` (tools/pen/wm-pen.swift), which SEIZES the Wacom tablet's HID
 * device while the Tablet sheet is in front, and turns its pen reports into samples. It fills the manager's "wintab-data"
 * slot (the device-frame data feed), so the frame, the Orientation menu and the renderer are the Windows ones unchanged.
 *
 * On a Mac the Wacom driver cannot be told to let go of the pointer (the Swift app measured it, 2026-10-02), so the seize IS
 * "Map the whole tablet to the sheet": while it is held the whole tablet writes on the sheet and the pointer stays put;
 * ending the helper gives the pen back to the driver. `start` refuses while that setting is off, and the manager restarts
 * this backend when it changes.
 *
 * x / y leave in WINTAB'S convention — 0..1 over the active area, y pointing UP — although the tablet's own y points down,
 * so frame.ts's `defaultFrame` (which mirrors y for Wintab) reads both platforms the same way.
 */
import { spawn, type ChildProcess } from "node:child_process"
import type { BackendContext, BackendEvent, BackendStart, BackendStatus, DeviceInfo, PenBackend, PenSample } from "../../shared/pen"
import { BackendCore } from "./backendCore"

/** One line of the helper's output. */
export type HelperLine =
  | { k: "access"; v: "granted" | "denied" | "undecided" }
  | { k: "device"; name: string; pid: number; maxX: number; maxY: number; maxP: number }
  | { k: "opened" }
  | { k: "refused"; why: string }
  | { k: "p"; f: number; x: number; y: number; p: number }
  | { k: "raw"; hex: string }
  | { k: "log"; m: string }

export function parseHelperLine(line: string): HelperLine | null {
  try {
    const o = JSON.parse(line) as { k?: unknown }
    return o && typeof o === "object" && typeof o.k === "string" ? (o as HelperLine) : null
  } catch { return null }
}

export const INPUT_MONITORING =
  "WriteMind needs Input Monitoring to take the tablet from the Wacom driver: System Settings ▸ Privacy & Security ▸ Input Monitoring, switch WriteMind on, then reopen the Tablet sheet"

/**
 * One pen report in a sample, or null for a report with no position (the pen coming near). Flags: 0x80 in range, 0x40 x/y
 * good, 0x20 tip / switches / pressure good, 0x08 eraser, 0x04 upper switch, 0x02 lower switch, 0x01 tip.
 */
export function sampleOf(r: { f: number; x: number; y: number; p: number }, device: { maxX: number; maxY: number; maxP: number }, t: number): PenSample | null {
  const inRange = (r.f & 0x80) !== 0
  if (inRange && (r.f & 0x40) === 0) return null
  const ready = (r.f & 0x20) !== 0
  const clamp = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0)
  const tip = inRange && ready && (r.f & 0x01) !== 0
  return {
    t,
    x: clamp(r.x / device.maxX),
    y: clamp(1 - r.y / device.maxY),
    p: tip ? clamp(r.p / device.maxP) : 0,
    tip,
    lower: inRange && ready && (r.f & 0x02) !== 0,
    upper: inRange && ready && (r.f & 0x04) !== 0,
    eraser: inRange && (r.f & 0x08) !== 0,
    inRange,
    backend: "machid",
  }
}

export type Spawner = (file: string) => ChildProcess

export class MacPenBackend implements PenBackend {
  readonly name = "wintab-data" as const
  readonly frameKind = "device" as const
  private readonly core: BackendCore
  private child: ChildProcess | null = null
  private device: { maxX: number; maxY: number; maxP: number } | null = null
  private inRange = false
  private generation = 0

  constructor(private readonly helper: string | null, private readonly now: () => number,
              private readonly spawner: Spawner = (file) => spawn(file, [], { stdio: ["pipe", "pipe", "ignore"] })) {
    this.core = new BackendCore("wintab-data", { now })
  }

  available(): { ok: true } | { ok: false; reason: string } {
    return this.helper ? { ok: true } : { ok: false, reason: "the tablet helper (wm-pen) is not in this build" }
  }

  start(ctx: BackendContext): Promise<BackendStart> {
    this.stop()
    const a = this.available()
    if (!a.ok) { this.core.setState("unavailable", a.reason); return Promise.resolve({ ok: false, reason: a.reason, retry: "never" }) }
    if (!ctx.settings.mapSheet) {
      const reason = "Map the whole tablet to the sheet is off: the pen is the pointer"
      this.core.setState("idle", reason)
      return Promise.resolve({ ok: false, reason, retry: "never" })
    }
    const gen = ++this.generation
    this.core.resetObservations()
    this.core.setState("starting", null)
    let child: ChildProcess
    try { child = this.spawner(this.helper!) } catch (e) {
      return Promise.resolve(this.fail(`wm-pen could not start: ${(e as Error)?.message ?? String(e)}`, "later"))
    }
    this.child = child
    return new Promise<BackendStart>((resolve) => {
      let settled = false
      let info: DeviceInfo | null = null
      const settle = (result: BackendStart): void => { if (!settled) { settled = true; resolve(result) } }
      let buffered = ""
      child.stdout?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        if (gen !== this.generation) return
        buffered += chunk
        let nl: number
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = parseHelperLine(buffered.slice(0, nl))
          buffered = buffered.slice(nl + 1)
          if (!line) continue
          switch (line.k) {
            case "access":
              this.core.fact("inputMonitoring", line.v)
              if (line.v !== "granted") settle(this.fail(INPUT_MONITORING, "later"))
              break
            case "device":
              this.device = { maxX: line.maxX > 0 ? line.maxX : 1, maxY: line.maxY > 0 ? line.maxY : 1, maxP: line.maxP > 0 ? line.maxP : 2047 }
              info = {
                name: line.name, vendorId: 0x056a, productId: line.pid, aspect: line.maxY > 0 ? line.maxX / line.maxY : null,
                rawX: [0, line.maxX], rawY: [0, line.maxY], pressureMax: line.maxP,
                claims: { pressure: true, tilt: false, lower: true, upper: true, eraser: false },
              }
              this.core.setDevice(info)
              this.core.fact("device", line.name)
              break
            case "opened":
              this.core.setState("armed", null)
              this.core.fact("seized", true)
              ctx.trace.event(this.name, "seized", { device: info?.name ?? null })
              settle({ ok: true, device: info })
              break
            case "refused":
              ctx.trace.event(this.name, "refused", { why: line.why })
              if (!settled) settle(this.fail(line.why, /unplugged|no Wacom/.test(line.why) ? "after-replug" : "later"))
              else { this.core.error(line.why, true); this.core.setState("failed", line.why) }
              break
            case "p":
              this.report(line)
              break
            case "raw":
              this.core.raw()
              ctx.trace.raw(this.name, this.now(), line.hex, "not a pen report")
              break
            case "log":
              ctx.trace.event(this.name, "helper", { m: line.m })
              break
          }
        }
      })
      child.on("error", (e) => { if (gen === this.generation) settle(this.fail(`wm-pen: ${e.message}`, "later")) })
      child.on("exit", (code) => {
        if (gen !== this.generation) return
        this.child = null
        this.core.fact("seized", false)
        if (!settled) settle(this.fail(code === 3 ? INPUT_MONITORING : `wm-pen ended (${code ?? "signal"})`, code === 4 ? "after-replug" : "later"))
        else if (this.core.getState() !== "idle") this.core.setState("failed", `wm-pen ended (${code ?? "signal"})`)
      })
    })
  }

  private report(r: { f: number; x: number; y: number; p: number }): void {
    this.core.raw()
    if (!this.device) return
    const s = sampleOf(r, this.device, this.now())
    if (!s) return
    if (s.inRange !== this.inRange) this.core.event({ kind: "proximity", inRange: s.inRange })
    if (!s.inRange && !this.inRange) return
    this.inRange = s.inRange
    this.core.emit(s)
  }

  private fail(reason: string, retry: "never" | "later" | "after-replug"): BackendStart {
    this.kill()
    this.core.setState("failed", reason)
    return { ok: false, reason, retry }
  }

  private kill(): void {
    const child = this.child
    this.child = null
    if (!child) return
    // stdin closing is the helper's way out (it gives the tablet back); SIGTERM as well, for a helper stuck elsewhere.
    try { child.stdin?.end() } catch { /* ignore */ }
    try { child.kill("SIGTERM") } catch { /* ignore */ }
  }

  stop(): void {
    this.generation++
    this.kill()
    this.core.flush()
    this.inRange = false
    if (this.core.getState() !== "unavailable") this.core.setState("idle", null)
  }

  onSample(listener: (batch: PenSample[]) => void): () => void { return this.core.onSample(listener) }
  onEvent(listener: (event: BackendEvent) => void): () => void { return this.core.onEvent(listener) }
  status(): BackendStatus { return this.core.status() }
}
