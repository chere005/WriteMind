import { describe, expect, it } from "vitest"
import { BACKEND_LABEL, CHECK_THRESHOLDS, createCheckEngine, flowRateHz } from "../../src/main/pen/check"
import type { CheckDepsX } from "../../src/main/pen/check"
import { emptyStatus } from "../../src/main/pen/fake"
import { CHECK_STEPS } from "../../src/shared/pen"
import type { BackendName, BackendState, BackendStatus, CheckStepId, EnvSummary, FrameRecord, PenSample, Witness } from "../../src/shared/pen"

// ---------------------------------------------------------------------------------------------
// A scripted person: time and samples are inputs, so the check is deterministic.
// ---------------------------------------------------------------------------------------------

const frame = (source: FrameRecord["source"]): FrameRecord => ({ frame: { turn: 0, flipY: false }, source, rms: null, margin: null, at: "2026-10-03T00:00:00Z" })
const env = (over: Partial<EnvSummary> = {}): EnvSummary => ({
  platform: "win32", os: "10", electron: "44", appVersion: "0.2.0", koffi: true, wintabDll: true,
  tablet: { present: true, status: "OK", problem: null, name: "Wacom Tablet", instanceId: "USB\\VID_056A", note: null },
  wacomDriver: "6.4.14-1", wacomService: "Running", displays: [], rawDevices: [], wintab: null, ...over,
})

interface Rig {
  engine: ReturnType<typeof createCheckEngine>
  clock: { t: number }
  statuses: Map<BackendName, BackendStatus>
  frames: Map<BackendName, FrameRecord | null>
  focus: { value: boolean }
  setState(name: BackendName, state: BackendState, reason?: string | null, facts?: BackendStatus["facts"]): void
  /** Run one step: sample generator output is fed at 133 Hz-ish spacing while the clock advances to the end of the step. */
  run(step: CheckStepId, make: (i: number, t: number) => Record<string, Partial<PenSample> | null>, opts?: { hz?: number; seconds?: number }): void
  dep: CheckDepsX
}

function rig(backends: BackendName[], extra: Partial<CheckDepsX> = {}, environment: EnvSummary | null = env()): Rig {
  const clock = { t: 1_000_000 }
  const statuses = new Map<BackendName, BackendStatus>()
  const frames = new Map<BackendName, FrameRecord | null>()
  const focus = { value: true }
  for (const b of backends) {
    statuses.set(b, emptyStatus(b, "live"))
    frames.set(b, b === "overlay" || b === "inject" ? null : frame("dom"))
  }
  const dep: CheckDepsX = {
    now: () => clock.t, windowFocused: () => focus.value, env: () => environment,
    statuses: () => [...statuses.values()], currentFrame: (b) => frames.get(b) ?? null, ...extra,
  }
  const engine = createCheckEngine(dep)
  const r: Rig = {
    engine, clock, statuses, frames, focus, dep,
    setState(name, state, reason = null, facts = {}) {
      const s = statuses.get(name) ?? emptyStatus(name)
      statuses.set(name, { ...s, state, reason, facts: { ...s.facts, ...facts } })
    },
    run(step, make, opts = {}) {
      const spec = CHECK_STEPS.find((s) => s.id === step)!
      const seconds = opts.seconds ?? spec.seconds
      const hz = opts.hz ?? 133
      engine.start(step)
      const n = Math.max(1, Math.floor(seconds * hz))
      const dt = 1000 / hz
      for (let i = 0; i < n; i++) {
        clock.t += dt
        const per = make(i, clock.t)
        for (const [b, partial] of Object.entries(per)) {
          if (!partial) continue
          engine.feed(b as BackendName, [{
            t: clock.t, x: 0.5, y: 0.5, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: b, ...partial,
          }])
        }
      }
      clock.t += Math.max(0, seconds * 1000 - n * dt) + 1
    },
  }
  return r
}

const wave = (i: number, n = 530): { x: number; y: number } => ({ x: 0.5 + 0.45 * Math.sin(i / 17), y: 0.5 + 0.45 * Math.cos(i / 29 + n * 0) })
/** A full, well-behaved person for one backend. `lowerBit`/`upperBit` say which sample field the physical buttons arrive on. */
function goodPerson(r: Rig, b: BackendName, opts: { lowerBit?: "lower" | "upper"; upperBit?: "lower" | "upper"; hz?: number } = {}): void {
  const hz = opts.hz ?? 133
  const lowerBit = opts.lowerBit ?? "lower"
  const upperBit = opts.upperBit ?? "upper"
  r.engine.begin()
  r.engine.start("env")
  r.run("hover", (i) => ({ [b]: wave(i) }), { hz })
  r.run("tap", (i) => ({ [b]: { ...wave(i), tip: i % 40 > 10, p: i % 40 > 10 ? ((i % 40) - 10) / 30 : 0 } }), { hz })
  // five presses of the button nearest the tip, 20 samples each
  r.run("lower", (i) => ({ [b]: { ...wave(i), [lowerBit]: i % 40 < 20 } }), { hz })
  r.run("upper", (i) => ({ [b]: { ...wave(i), [upperBit]: i % 40 < 20 } }), { hz })
  // rectangle round the edge, then the cross through the middle
  r.run("sweep", (i) => {
    const k = i / (5 * hz)
    const side = Math.floor(k * 4)
    const f = (k * 4) % 1
    const pts = [{ x: f, y: 0 }, { x: 1, y: f }, { x: 1 - f, y: 1 }, { x: 0, y: 1 - f }]
    return { [b]: { ...(pts[Math.min(3, side)]!), tip: true, p: 0.4 } }
  }, { hz })
}

describe("check engine: protocol", () => {
  it("counts down, auto-advances to the next required step, and leaves the optional away step to the person", () => {
    const r = rig(["wintab-data"])
    expect(r.engine.begin()).toMatchObject({ running: true, step: null, done: [] })
    expect(r.engine.start("env")).toMatchObject({ step: null, done: ["env"] })
    expect(r.engine.start("hover")).toMatchObject({ step: "hover", secondsLeft: 4 })
    r.clock.t += 1500
    expect(r.engine.tick()).toMatchObject({ step: "hover", secondsLeft: 3 })
    r.clock.t += 2600
    expect(r.engine.tick()).toMatchObject({ step: "tap", secondsLeft: 3, done: ["env", "hover"] })
    for (const id of ["tap", "lower", "upper", "sweep"] as const) {
      r.clock.t += CHECK_STEPS.find((s) => s.id === id)!.seconds * 1000
      r.engine.tick()
    }
    const s = r.engine.snapshot()
    expect(s.step).toBeNull() // away is optional: not started by itself
    expect(s.done).toEqual(["env", "hover", "tap", "lower", "upper", "sweep"])
    expect(s.running).toBe(true)
  })

  it("start() of a later step is Skip; of the same step again restarts its numbers", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.run("hover", (i) => ({ "wintab-data": wave(i) }))
    expect(r.engine.snapshot().rows[0]!.samples).toBeGreaterThan(100)
    r.engine.start("hover")
    expect(r.engine.snapshot().rows[0]?.samples ?? 0).toBe(0)
    r.engine.start("sweep")
    expect(r.engine.snapshot()).toMatchObject({ step: "sweep" })
  })

  it("start() without begin() begins; cancel() stops and keeps no report; finish() keeps the report on the snapshot", () => {
    const r = rig(["wintab-data"])
    expect(r.engine.start("hover").running).toBe(true)
    expect(r.engine.cancel()).toMatchObject({ running: false, step: null, report: null })
    r.engine.begin()
    const rep = r.engine.finish()
    expect(r.engine.snapshot()).toMatchObject({ running: false, report: rep })
  })

  it("ignores samples and witnesses between steps and before begin()", () => {
    const r = rig(["wintab-data"])
    r.engine.feed("wintab-data", [{ t: 1, x: 0.1, y: 0.1, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "x" }])
    r.engine.begin()
    r.engine.feed("wintab-data", [{ t: 1, x: 0.1, y: 0.1, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "x" }])
    r.engine.witness({ source: "dom", inRange: true, at: 1 })
    r.engine.start("hover")
    expect(r.engine.snapshot().rows.every((x) => x.samples === 0)).toBe(true)
  })
})

describe("check engine: verdicts", () => {
  it("a good person on a good backend: works, with a plain headline, frame, winner and advice", () => {
    const r = rig(["wintab-data", "rawinput", "webhid"])
    r.setState("rawinput", "armed", "no digitizer-page device with a pen layout is listed")
    r.setState("webhid", "unavailable", "WebHID is switched off")
    goodPerson(r, "wintab-data")
    r.frames.set("wintab-data", frame("default"))
    const rep = r.engine.finish()
    const w = rep.rows.find((x) => x.backend === "wintab-data")!
    expect(w.verdict).toBe("works")
    expect(w.samples).toBeGreaterThan(CHECK_THRESHOLDS.minSamples)
    expect(w.rateHz).toBeGreaterThan(120)
    expect(w.rateHz).toBeLessThan(145)
    expect(w.pressureLevels).toBeGreaterThan(10)
    expect(w.lower && w.upper).toBe(true)
    expect(w.coverage!.x).toBeGreaterThan(0.9)
    expect(w.headline).toMatch(/^13\d Hz, \d+ pressure levels, both side buttons, whole tablet reached\.$/)
    expect(rep.overall).toBe("ok")
    expect(rep.winner).toBe("wintab-data")
    expect(rep.summary).toContain("Wintab works")
    expect(rep.rows.find((x) => x.backend === "rawinput")!.verdict).toBe("silent")
    expect(rep.rows.find((x) => x.backend === "webhid")).toMatchObject({ verdict: "unavailable", reasons: ["WebHID is switched off"] })
    expect(rep.learned.frames["wintab-data"]!.source).toBe("default")
    expect(rep.learned.swapButtons).toBe(false)
    expect(rep.advice).toContain("Direction is a guess. Draw the two lines so the ink goes the way you write.")
    expect(rep.advice.some((a) => a.startsWith("The pen works. Taps outside the sheet"))).toBe(true)
    expect(rep.advice.some((a) => a.includes("Windows says the tablet is not working"))).toBe(false)
  })

  it("the highest-priority working backend wins; the others stay listed as works", () => {
    const r = rig(["wintab-data", "rawinput", "webhid"])
    r.engine.begin()
    r.engine.start("env")
    const both = (i: number) => ({ "wintab-data": wave(i), rawinput: wave(i), webhid: wave(i) })
    r.run("hover", both)
    r.run("tap", (i) => Object.fromEntries(Object.keys(both(i)).map((k) => [k, { ...wave(i), tip: true, p: 0.2 + (i % 50) / 100 }])))
    r.run("sweep", (i) => Object.fromEntries(Object.keys(both(i)).map((k) => [k, { x: (i % 40) / 39, y: ((i * 7) % 40) / 39, tip: true, p: 0.5 }])))
    const rep = r.engine.finish()
    expect(rep.rows.filter((x) => x.verdict === "works").map((x) => x.backend)).toEqual(["wintab-data", "rawinput", "webhid"])
    expect(rep.winner).toBe("wintab-data")
    // the same with the first one broken: rawinput takes over
    const r2 = rig(["wintab-data", "rawinput", "webhid"])
    r2.setState("wintab-data", "failed", "WTInfo reports 0 devices (the tablet is not working or the Wacom service is down)")
    r2.engine.begin()
    r2.run("hover", (i) => ({ rawinput: wave(i), webhid: wave(i) }))
    r2.run("tap", (i) => ({ rawinput: { ...wave(i), tip: true, p: 0.5 }, webhid: { ...wave(i), tip: true, p: 0.5 } }))
    r2.run("sweep", (i) => ({ rawinput: { x: (i % 40) / 39, y: ((i * 7) % 40) / 39 }, webhid: { x: (i % 40) / 39, y: ((i * 7) % 40) / 39 } }))
    const rep2 = r2.engine.finish()
    expect(rep2.rows.find((x) => x.backend === "wintab-data")).toMatchObject({ verdict: "failed", reasons: [expect.stringContaining("WTInfo reports 0 devices")] })
    expect(rep2.winner).toBe("rawinput")
  })

  it("silent while Windows saw the pen: says so, with the count, and advises restarting the Wacom service", () => {
    const r = rig(["wintab-data", "rawinput"])
    r.setState("wintab-data", "armed")
    r.setState("rawinput", "armed", "opened, 0 packets in 8 s")
    r.engine.begin()
    r.engine.start("hover")
    for (let i = 0; i < 51; i++) r.engine.witness({ source: "dom", inRange: true, at: r.clock.t + i })
    r.engine.witness({ source: "wizard", inRange: true, at: 1 }) // not evidence
    r.engine.witness({ source: "dom", inRange: false, at: 1 }) // not in range
    r.clock.t += 4000
    r.engine.tick()
    const rep = r.engine.finish()
    expect(rep.rows.every((x) => x.verdict === "silent")).toBe(true)
    expect(rep.rows[0]!.reasons).toContain("No data while Windows saw the pen 51 times.")
    expect(rep.rows[1]!.reasons[0]).toBe("opened, 0 packets in 8 s")
    expect(rep.overall).toBe("none")
    expect(rep.winner).toBeNull()
    expect(rep.advice.some((a) => a.includes("Restart the 'Wacom Professional Service'"))).toBe(true)
    expect(rep.advice.some((a) => a.includes("[Test overlay]"))).toBe(true)
  })

  it("silent with no witness at all: asks whether the pen was near", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.engine.start("hover")
    r.clock.t += 4000
    const rep = r.engine.finish()
    expect(rep.rows[0]).toMatchObject({ verdict: "silent" })
    expect(rep.rows[0]!.reasons.join(" ")).toContain("Windows saw no pen either")
    expect(rep.advice.some((a) => a.includes("Restart the 'Wacom Professional Service'"))).toBe(false)
  })

  it("every native backend failed, the sink passed: the overlay advice", () => {
    const r = rig(["wintab-data", "rawinput"], { sinkPassed: () => true })
    r.setState("wintab-data", "failed", "no dll")
    r.setState("rawinput", "failed", "no device")
    r.engine.begin()
    r.engine.start("hover")
    const rep = r.engine.finish()
    expect(rep.rows.map((x) => x.verdict)).toEqual(["failed", "failed"])
    expect(rep.advice).toContain("The tablet cannot be read directly here, so the overlay is used: everything under the pen is covered while the pen is near.")
  })

  it("partial: slow, narrow, frozen or without pressure are each named", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.run("hover", () => ({ "wintab-data": { x: 0.5, y: 0.5 } }), { hz: 15 })
    r.run("sweep", () => ({ "wintab-data": { x: 0.5, y: 0.5 } }), { hz: 15 })
    const rep = r.engine.finish()
    const row = rep.rows[0]!
    expect(row.verdict).toBe("partial")
    expect(row.reasons.join("\n")).toContain("Every sample was identical")
    expect(row.reasons.join("\n")).toMatch(/Only 15 samples per second/)
    expect(row.reasons.join("\n")).toContain("Pressure never rose above 0.")
    expect(row.reasons.join("\n")).toMatch(/Reached only 0% across and 0% down/)
    expect(rep.overall).toBe("partial")
    expect(rep.winner).toBe("wintab-data")
    expect(rep.summary).toContain("works only partly")
  })

  it("partial when the sweep reaches under 60% on an axis", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.run("hover", (i) => ({ "wintab-data": { x: 0.3 + (i % 50) / 100, y: 0.2 + (i % 70) / 100 } }))
    r.run("tap", (i) => ({ "wintab-data": { x: 0.3 + (i % 50) / 100, y: 0.2 + (i % 70) / 100, tip: true, p: 0.3 + (i % 5) / 10 } }))
    r.run("sweep", (i) => ({ "wintab-data": { x: 0.3 + (i % 50) / 100, y: 0.1 + (i % 90) / 100, tip: true, p: 0.5 } }))
    const row = r.engine.finish().rows[0]!
    expect(row.verdict).toBe("partial")
    expect(row.coverage!.x).toBeLessThan(0.6)
    expect(row.reasons[0]).toMatch(/Reached only \d+% across and \d+% down the tablet/)
  })

  it("a device-frame backend with no resolved frame is partial; a screen-frame one is not asked", () => {
    const r = rig(["wintab-data", "inject"])
    r.frames.set("wintab-data", null)
    r.engine.begin()
    const both = (i: number) => ({ "wintab-data": { ...wave(i), tip: true, p: 0.5 }, inject: { ...wave(i), tip: true, p: 0.5 } })
    r.run("hover", both)
    r.run("sweep", (i) => ({ "wintab-data": { x: (i % 40) / 39, y: ((i * 7) % 40) / 39, tip: true, p: 0.5 }, inject: { x: (i % 40) / 39, y: ((i * 7) % 40) / 39, tip: true, p: 0.5 } }))
    const rep = r.engine.finish()
    expect(rep.rows.find((x) => x.backend === "wintab-data")).toMatchObject({ verdict: "partial" })
    expect(rep.rows.find((x) => x.backend === "wintab-data")!.reasons.join(" ")).toContain("could not be worked out")
    expect(rep.rows.find((x) => x.backend === "inject")).toMatchObject({ verdict: "works" })
    expect(rep.winner).toBe("inject")
  })

  it("the overlay is an optional test (skipped) unless it delivered samples; inject is hidden unless it delivered", () => {
    const r = rig(["wintab-data", "overlay", "inject"])
    goodPerson(r, "wintab-data")
    const rep = r.engine.finish()
    expect(rep.rows.map((x) => x.backend)).toEqual(["wintab-data", "overlay"])
    expect(rep.rows[1]).toMatchObject({ verdict: "skipped", headline: "Optional test" })
  })

  it("unavailable and not-started backends are not blamed", () => {
    const r = rig(["wintab-data", "webhid", "rawinput"])
    r.setState("webhid", "idle")
    r.setState("rawinput", "unavailable", "native pen backends are off under E2E")
    r.engine.begin()
    r.run("hover", () => ({}))
    const rep = r.engine.finish()
    expect(rep.rows.find((x) => x.backend === "webhid")).toMatchObject({ verdict: "skipped" })
    expect(rep.rows.find((x) => x.backend === "rawinput")).toMatchObject({ verdict: "unavailable" })
  })

  it("a backend that delivered and then failed keeps its data but names the failure", () => {
    const r = rig(["wintab-data"])
    goodPerson(r, "wintab-data")
    r.setState("wintab-data", "failed", "the driver closed our context (WT_CTXCLOSE)")
    const row = r.engine.finish().rows[0]!
    expect(row.verdict).toBe("partial")
    expect(row.reasons.join(" ")).toContain("WT_CTXCLOSE")
  })

  it("snapshot rows update live while the check runs", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.engine.start("hover")
    expect(r.engine.snapshot().rows[0]).toMatchObject({ backend: "wintab-data", verdict: "silent", samples: 0 })
    for (let i = 0; i < 100; i++) { r.clock.t += 7; r.engine.feed("wintab-data", [{ t: r.clock.t, ...wave(i), p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "x" }]) }
    expect(r.engine.snapshot().rows[0]!.samples).toBe(100)
    expect(r.engine.snapshot().env).not.toBeNull()
  })

  it("samples that are out of range are not counted, and a new visit counts its presses again", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.engine.start("tap")
    const s = (over: Partial<PenSample>): PenSample => ({ t: r.clock.t += 7, x: 0.5, y: 0.5, p: 0.5, tip: true, lower: false, upper: false, eraser: false, inRange: true, backend: "x", ...over })
    r.engine.feed("wintab-data", [s({}), s({}), s({ inRange: false, tip: false, p: 0 }), s({}), s({})])
    const row = r.engine.snapshot().rows[0]!
    expect(row.samples).toBe(4)
  })
})

describe("check engine: buttons", () => {
  it("swapped buttons are detected from the two steps and learned as swapButtons = true", () => {
    const r = rig(["wintab-data"])
    goodPerson(r, "wintab-data", { lowerBit: "upper", upperBit: "lower" })
    const rep = r.engine.finish()
    expect(rep.learned.swapButtons).toBe(true)
    expect(rep.advice.some((a) => a.includes("other way round"))).toBe(true)
  })

  it("correct buttons are learned as swapButtons = false", () => {
    const r = rig(["wintab-data"])
    goodPerson(r, "wintab-data")
    expect(r.engine.finish().learned.swapButtons).toBe(false)
  })

  it("a stream that was already swapped by settings is un-swapped when the manager says so (swapApplied)", () => {
    // settings.swapButtons is already on: the fed stream shows the nearest-tip press as `lower`, so the RAW stream had it as `upper`.
    // learned.swapButtons is the absolute setting that is right for the raw stream: true.
    const r = rig(["wintab-data"], { swapApplied: () => true })
    goodPerson(r, "wintab-data") // fed (post-swap) shows lower/upper as expected; raw therefore was swapped
    expect(r.engine.finish().learned.swapButtons).toBe(true)
  })

  it("ambiguous evidence (both buttons on both steps, or too few presses) learns nothing", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.run("hover", (i) => ({ "wintab-data": wave(i) }))
    r.run("lower", (i) => ({ "wintab-data": { ...wave(i), lower: i % 40 < 20, upper: i % 40 < 20 } }))
    r.run("upper", (i) => ({ "wintab-data": { ...wave(i), lower: i % 40 < 20, upper: i % 40 < 20 } }))
    expect(r.engine.finish().learned.swapButtons).toBeNull()
    const r2 = rig(["wintab-data"])
    r2.engine.begin()
    r2.run("lower", (i) => ({ "wintab-data": { ...wave(i), lower: i < 30 } }), { seconds: 3 })
    r2.run("upper", (i) => ({ "wintab-data": { ...wave(i), upper: i < 30 } }), { seconds: 3 })
    expect(r2.engine.finish().learned.swapButtons).toBeNull() // one press each is not evidence
  })

  it("only one side button reported: the advice and an info reason, not a downgrade", () => {
    const r = rig(["wintab-data"])
    r.engine.begin()
    r.run("hover", (i) => ({ "wintab-data": wave(i) }))
    r.run("tap", (i) => ({ "wintab-data": { ...wave(i), tip: true, p: 0.1 + (i % 9) / 10 } }))
    r.run("lower", (i) => ({ "wintab-data": { ...wave(i), lower: i % 40 < 20 } }))
    r.run("sweep", (i) => ({ "wintab-data": { x: (i % 40) / 39, y: ((i * 7) % 40) / 39, tip: true, p: 0.5 } }))
    const rep = r.engine.finish()
    expect(rep.rows[0]!.verdict).toBe("works")
    expect(rep.rows[0]!.reasons).toContain("Only the lower side button was reported.")
    expect(rep.advice.some((a) => a.startsWith("Only one side button is reported"))).toBe(true)
  })
})

describe("check engine: environment, away, advice", () => {
  it("a tablet in a problem state heads the advice", () => {
    const e = env({ tablet: { present: true, status: "Error", problem: "CM_PROB_FAILED_START (problem 10)", name: "Wacom Tablet", instanceId: "x", note: null } })
    const r = rig(["wintab-data"], {}, e)
    r.setState("wintab-data", "failed", "WTInfo reports 0 devices")
    r.engine.begin()
    r.engine.start("hover")
    const rep = r.engine.finish()
    expect(rep.advice[0]).toContain("Windows says the tablet is not working (CM_PROB_FAILED_START (problem 10)).")
    expect(rep.advice[0]).toContain("This is not WriteMind.")
  })

  it("no Wacom device on Windows: check the cable; an env that was skipped (note) says nothing", () => {
    const none = rig(["wintab-data"], {}, env({ tablet: null }))
    none.engine.begin()
    expect(none.engine.finish().advice).toContain("Windows does not list a Wacom tablet. Check the cable.")
    const skipped = rig(["wintab-data"], {}, env({ tablet: { present: false, status: null, problem: null, name: null, instanceId: null, note: "skipped under E2E" } }))
    skipped.engine.begin()
    expect(skipped.engine.finish().advice.some((a) => a.includes("Check the cable"))).toBe(false)
    const noEnv = rig(["wintab-data"], {}, null)
    noEnv.engine.begin()
    expect(() => noEnv.engine.finish()).not.toThrow()
  })

  it("away step: counts samples only while WriteMind is not in front; null when never run", () => {
    const r = rig(["wintab-data"])
    goodPerson(r, "wintab-data")
    r.focus.value = false
    r.run("away", (i) => ({ "wintab-data": wave(i) }), { seconds: 1 })
    expect(r.engine.snapshot().rows[0]!.samplesAway).toBe(133)
    const r2 = rig(["wintab-data"])
    goodPerson(r2, "wintab-data")
    r2.run("away", (i) => ({ "wintab-data": wave(i) }), { seconds: 1 }) // still in front: nothing counted
    expect(r2.engine.finish().rows[0]!.samplesAway).toBe(0)
    const r3 = rig(["wintab-data"])
    goodPerson(r3, "wintab-data")
    expect(r3.engine.finish().rows[0]!.samplesAway).toBeNull()
    // and the away samples never change the verdict numbers
    expect(r.engine.finish().rows[0]!.samples).toBe(r3.engine.finish().rows[0]!.samples)
  })

  it("HID reports a driver-mapped surface: advice only when that backend is in use", () => {
    const r = rig(["rawinput"])
    r.setState("rawinput", "live", null, { looksDriverMapped: true })
    goodPerson(r, "rawinput")
    expect(r.engine.finish().advice).toContain("Raw HID looks already mapped to the screen by the driver; it works but cannot do better than the pointer.")
    const r2 = rig(["rawinput"])
    r2.setState("rawinput", "armed", null, { looksDriverMapped: true })
    r2.engine.begin()
    r2.engine.start("hover")
    expect(r2.engine.finish().advice.some((a) => a.includes("already mapped"))).toBe(false)
  })

  it("mouse mode and containment advice come from the optional deps", () => {
    const r = rig(["wintab-data"], { pointerMode: () => "mouse", contained: () => true })
    goodPerson(r, "wintab-data")
    const rep = r.engine.finish()
    expect(rep.learned.pointerMode).toBe("mouse")
    expect(rep.advice.some((a) => a.includes("Mouse mode. Switch to Pen mode"))).toBe(true)
    expect(rep.advice.some((a) => a.includes("Taps outside the sheet"))).toBe(false)
  })

  it("learned.frames lists device-frame backends that delivered, never the screen-frame ones", () => {
    const r = rig(["wintab-data", "inject"])
    r.engine.begin()
    r.run("hover", (i) => ({ "wintab-data": wave(i), inject: wave(i) }))
    const rep = r.engine.finish()
    expect(Object.keys(rep.learned.frames)).toEqual(["wintab-data"])
  })
})

describe("helpers", () => {
  it("flowRateHz measures inside flows and ignores long gaps", () => {
    const t: number[] = []
    for (let i = 0; i < 100; i++) t.push(i * 10) // 100 Hz
    t.push(5000, 5010, 5020) // a later flow
    expect(flowRateHz(t)).toBeCloseTo(100, 0)
    expect(flowRateHz([1])).toBeNull()
    expect(flowRateHz([0, 500, 1000])).toBeNull()
  })

  it("every backend has a display label", () => {
    expect(Object.keys(BACKEND_LABEL).sort()).toEqual(["dom", "inject", "overlay", "rawinput", "webhid", "wintab-data", "wintab-system"])
  })
})
