/**
 * main/pen/check.ts - the Tablet setup check engine (docs/spikes/DESIGN-pen-capture.md section 9). Owner: IMPL-B (wimpl-b-webhid).
 *
 * PURE: time and samples are inputs (CheckDeps.now(), CheckEngine.feed()), so a unit test replays a scripted person. No Electron, no
 * Node API, no timers of its own: the manager calls `tick()` about 4 times a second and pushes the snapshot to the renderer.
 *
 * PROTOCOL (what the manager / UI do):
 *   begin()                      zero everything, running = true
 *   start("env")                 marks the environment step done at once (the env itself comes from deps.env())
 *   start("hover") ...           begins a countdown. tick() AUTO-ADVANCES to the next non-optional step when the time is up, so the UI
 *                                only needs start() for the first step and for the optional "away" step; start(id) also serves "Skip"
 *                                (jumps ahead) and "run again" (a step that is started again starts its numbers afresh).
 *   feed(backend, samples)       EVERY backend's samples (active or not), tagged with its name
 *   witness(w)                   evidence from outside the backends that a pen is near (DOM pen event, pointer-range, ...)
 *   finish()                     ends the check and returns the CheckReport (also kept in snapshot().report)
 *
 * SAMPLES ARE EXPECTED BEFORE THE BUTTON SWAP. The design lists the swap (5.5 step 4) before check.feed (step 9); the engine wants the
 * backend's own lower / upper so that `learned.swapButtons` is the ABSOLUTE setting that would have been right. If the manager feeds the
 * swapped stream it must say so through the optional dep `swapApplied()` and the engine un-swaps (see CheckDepsX). Both are in the
 * Decisions section of the design.
 *
 * Optional extra deps (CheckDepsX extends CheckDeps; a plain CheckDeps works, the advice just assumes "not contained"):
 *   swapApplied()   true when the fed samples were already button-swapped by settings.swapButtons
 *   contained()     a containment mechanism is armed or proven here
 *   pointerMode()   "pen" | "mouse" | null, as measured
 *   sinkPassed()    the overlay (sink) test passed
 */
import { BACKEND_ORDER, CHECK_STEPS, clamp01 } from "../../shared/pen"
import type {
  BackendName, BackendStatus, CheckReport, CheckRow, CheckSnapshot, CheckStepId, EnvSummary, FrameRecord, PenSample, Verdict, Witness,
} from "../../shared/pen"
import type { CheckDeps, CheckEngine } from "./types"

export interface CheckDepsX extends CheckDeps {
  swapApplied?(): boolean
  contained?(): boolean
  pointerMode?(): "pen" | "mouse" | null
  sinkPassed?(): boolean
}

export const CHECK_THRESHOLDS = {
  /** `works` needs at least this many in-range samples in the measured steps. */
  minSamples: 40,
  minRateHz: 30,
  /** Share of the tablet's extent the sweep must reach, per axis. */
  minCoverage: 0.6,
  /** Presses of one side button (rising edges in its step) that count as evidence, and as "none of the other". */
  buttonPresses: 3,
  /** Samples further apart than this are not one flow (rate is measured inside flows). */
  flowGapMs: 100,
  /** A sample counts as moved when x or y differs by this much, or the pressure by movedP. */
  movedXY: 1e-4,
  movedP: 0.002,
} as const

export const BACKEND_LABEL: Readonly<Record<BackendName, string>> = {
  inject: "Test",
  "wintab-system": "Wintab (mapped)",
  "wintab-data": "Wintab",
  rawinput: "Raw HID",
  webhid: "WebHID",
  dom: "Window pen",
  overlay: "Overlay",
}

const MEASURED: readonly CheckStepId[] = ["hover", "tap", "lower", "upper", "sweep"]
const TIMES_CAP = 6000

interface StepAcc {
  inRange: number
  all: number
  tipDowns: number
  lowerRises: number
  upperRises: number
  lowerSeen: boolean
  upperSeen: boolean
  pmax: number
  pressures: Set<number>
  moved: boolean
  reachX: [number, number] | null
  reachY: [number, number] | null
  times: number[]
}

const newStep = (): StepAcc => ({
  inRange: 0, all: 0, tipDowns: 0, lowerRises: 0, upperRises: 0, lowerSeen: false, upperSeen: false, pmax: 0,
  pressures: new Set(), moved: false, reachX: null, reachY: null, times: [],
})

interface BackendAcc {
  steps: Map<CheckStepId, StepAcc>
  prev: { x: number; y: number; p: number; tip: boolean; lower: boolean; upper: boolean } | null
  away: number
}

interface WitnessAcc { dom: number; pointerRange: number; cursor: number; wizard: number }
const newWitness = (): WitnessAcc => ({ dom: 0, pointerRange: 0, cursor: 0, wizard: 0 })

const isScreenFrame = (b: BackendName): boolean => b === "overlay" || b === "inject"
const pct = (v: number): string => `${Math.round(v * 100)}%`

function mergeSteps(accs: StepAcc[]): StepAcc {
  const out = newStep()
  for (const a of accs) {
    out.inRange += a.inRange
    out.all += a.all
    out.tipDowns += a.tipDowns
    out.lowerRises += a.lowerRises
    out.upperRises += a.upperRises
    out.lowerSeen ||= a.lowerSeen
    out.upperSeen ||= a.upperSeen
    out.pmax = Math.max(out.pmax, a.pmax)
    for (const p of a.pressures) out.pressures.add(p)
    out.moved ||= a.moved
    if (a.reachX) out.reachX = out.reachX ? [Math.min(out.reachX[0], a.reachX[0]), Math.max(out.reachX[1], a.reachX[1])] : [...a.reachX]
    if (a.reachY) out.reachY = out.reachY ? [Math.min(out.reachY[0], a.reachY[0]), Math.max(out.reachY[1], a.reachY[1])] : [...a.reachY]
    out.times.push(...a.times)
  }
  out.times.sort((x, y) => x - y)
  return out
}

/** Samples per second inside flows (gaps up to flowGapMs); null with fewer than two close samples. */
export function flowRateHz(times: readonly number[]): number | null {
  let sum = 0
  let n = 0
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!
    if (gap > 0 && gap <= CHECK_THRESHOLDS.flowGapMs) { sum += gap; n++ }
  }
  if (n < 1 || sum <= 0) return null
  return 1000 / (sum / n)
}

export function createCheckEngine(deps: CheckDepsX): CheckEngine {
  let running = false
  let current: CheckStepId | null = null
  let startedAt = 0
  let done: CheckStepId[] = []
  let report: CheckReport | null = null
  let accs = new Map<BackendName, BackendAcc>()
  let witnesses = new Map<CheckStepId, WitnessAcc>()
  let ranSteps = new Set<CheckStepId>()

  const spec = (id: CheckStepId) => CHECK_STEPS.find((s) => s.id === id)!
  const accFor = (b: BackendName): BackendAcc => {
    let a = accs.get(b)
    if (!a) { a = { steps: new Map(), prev: null, away: 0 }; accs.set(b, a) }
    return a
  }
  const stepAcc = (b: BackendName, id: CheckStepId): StepAcc => {
    const a = accFor(b)
    let s = a.steps.get(id)
    if (!s) { s = newStep(); a.steps.set(id, s) }
    return s
  }
  const witnessFor = (id: CheckStepId): WitnessAcc => {
    let w = witnesses.get(id)
    if (!w) { w = newWitness(); witnesses.set(id, w) }
    return w
  }

  function reset(): void {
    current = null
    startedAt = 0
    done = []
    report = null
    accs = new Map()
    witnesses = new Map()
    ranSteps = new Set()
  }

  function completeCurrent(): void {
    if (current && !done.includes(current)) done = [...done, current]
    current = null
  }

  function secondsLeft(): number {
    if (!current) return 0
    const total = spec(current).seconds * 1000
    return Math.max(0, Math.ceil((total - (deps.now() - startedAt)) / 1000))
  }

  function beginStep(id: CheckStepId): void {
    completeCurrent()
    if (id === "env") {
      done = done.includes("env") ? done : [...done, "env"]
      ranSteps.add("env")
      return
    }
    // running a step again starts its numbers afresh
    for (const a of accs.values()) a.steps.delete(id)
    witnesses.delete(id)
    done = done.filter((d) => d !== id)
    if (id === "away") for (const a of accs.values()) a.away = 0
    current = id
    startedAt = deps.now()
    ranSteps.add(id)
  }

  // ---------------------------------------------------------------- measurement

  function feed(backend: BackendName, samples: PenSample[]): void {
    if (!running || !current) return
    const id = current
    const measured = MEASURED.includes(id)
    if (!measured && id !== "away") return
    const acc = accFor(backend)
    const swap = deps.swapApplied?.() === true
    if (id === "away") {
      if (!deps.windowFocused()) for (const s of samples) if (s.inRange) acc.away++
      return
    }
    const st = stepAcc(backend, id)
    for (const s of samples) {
      st.all++
      const lower = swap ? s.upper : s.lower
      const upper = swap ? s.lower : s.upper
      const prev = acc.prev
      if (s.inRange) {
        st.inRange++
        if (st.times.length < TIMES_CAP) st.times.push(s.t)
        const x = clamp01(s.x)
        const y = clamp01(s.y)
        st.reachX = st.reachX ? [Math.min(st.reachX[0], x), Math.max(st.reachX[1], x)] : [x, x]
        st.reachY = st.reachY ? [Math.min(st.reachY[0], y), Math.max(st.reachY[1], y)] : [y, y]
        if (s.p > st.pmax) st.pmax = s.p
        if (s.p > 0) st.pressures.add(Math.round(clamp01(s.p) * 65535))
        if (s.tip && !(prev?.tip)) st.tipDowns++
        if (lower) { st.lowerSeen = true; if (!prev?.lower) st.lowerRises++ }
        if (upper) { st.upperSeen = true; if (!prev?.upper) st.upperRises++ }
        if (prev && (Math.abs(x - prev.x) >= CHECK_THRESHOLDS.movedXY || Math.abs(y - prev.y) >= CHECK_THRESHOLDS.movedXY || Math.abs(s.p - prev.p) >= CHECK_THRESHOLDS.movedP)) st.moved = true
        acc.prev = { x, y, p: s.p, tip: s.tip, lower, upper }
      } else {
        acc.prev = null // a visit ended: the next in-range sample is a new one
      }
    }
  }

  function witness(w: Witness): void {
    if (!running || !current) return
    const id = current
    if (!MEASURED.includes(id) && id !== "away") return
    if (!w.inRange) return
    const acc = witnessFor(id)
    if (w.source === "dom") acc.dom++
    else if (w.source === "pointer-range") acc.pointerRange++
    else if (w.source === "cursor") acc.cursor++
    else acc.wizard++
  }

  // ---------------------------------------------------------------- rows and the report

  function witnessTotals(): { dom: number; pointerRange: number; cursor: number; seen: number } {
    let dom = 0, pointerRange = 0, cursor = 0
    for (const id of MEASURED) {
      const w = witnesses.get(id)
      if (!w) continue
      dom += w.dom
      pointerRange += w.pointerRange
      cursor += w.cursor
    }
    return { dom, pointerRange, cursor, seen: dom + pointerRange + cursor }
  }

  function backendNames(statuses: BackendStatus[]): BackendName[] {
    const present = new Set<BackendName>(statuses.map((s) => s.name))
    for (const [b, a] of accs) if ([...a.steps.values()].some((s) => s.all > 0)) present.add(b)
    return BACKEND_ORDER.filter((n) => {
      if (!present.has(n)) return false
      if (n === "inject") return (accs.get(n) && [...accs.get(n)!.steps.values()].some((s) => s.all > 0)) === true
      return true
    })
  }

  function stepsOf(b: BackendName, ids: readonly CheckStepId[]): StepAcc {
    const a = accs.get(b)
    return mergeSteps(ids.map((id) => a?.steps.get(id)).filter((s): s is StepAcc => !!s))
  }

  function buildRow(name: BackendName, status: BackendStatus | undefined): CheckRow {
    const a = accs.get(name)
    const m = stepsOf(name, MEASURED)
    const sweep = a?.steps.get("sweep")
    const reachSrc = sweep && sweep.inRange > 0 ? sweep : m
    const coverage = reachSrc.reachX && reachSrc.reachY
      ? { x: reachSrc.reachX[1] - reachSrc.reachX[0], y: reachSrc.reachY[1] - reachSrc.reachY[0] }
      : null
    const rateHz = flowRateHz(m.times) ?? (m.inRange >= 2 ? status?.rateHz ?? null : null)
    const frame: FrameRecord | null = deps.currentFrame(name)
    const wt = witnessTotals()
    const away = ranSteps.has("away") ? a?.away ?? 0 : null
    const reasons: string[] = []
    const base = {
      backend: name, samples: m.inRange, rateHz: rateHz === null ? null : Math.round(rateHz * 10) / 10, pressureMaxSeen: m.pmax,
      pressureLevels: m.pressures.size, lower: m.lowerSeen, upper: m.upperSeen, coverage, frame, samplesAway: away,
    }
    const finish = (verdict: Verdict, headline: string): CheckRow => ({ ...base, verdict, headline, reasons })

    const state = status?.state
    const statusReason = status?.reason ?? null
    if (state === "unavailable") {
      reasons.push(statusReason ?? "Not available on this machine.")
      return finish("unavailable", "Not available")
    }
    if (name === "overlay" && m.all === 0) {
      reasons.push("The overlay is an optional test (Test overlay), not part of the 20 seconds.")
      return finish("skipped", "Optional test")
    }
    if (m.inRange < 4 && state === "failed") {
      reasons.push(statusReason ?? "The backend failed to start.")
      return finish("failed", "Failed to start")
    }
    if (m.inRange === 0) {
      if (state === "idle" && !statusReason && m.all === 0 && !ranSteps.has("hover")) {
        reasons.push("The check ended before this backend ran.")
        return finish("skipped", "Not run")
      }
      if (state === "idle" && m.all === 0 && !statusReason) {
        reasons.push("Switched off in settings, or never started.")
        return finish("skipped", "Not started")
      }
      if (statusReason) reasons.push(statusReason)
      if (wt.seen > 0) reasons.push(`No data while Windows saw the pen ${wt.seen} time${wt.seen === 1 ? "" : "s"}.`)
      else reasons.push("No data, and Windows saw no pen either: was the pen near the tablet? Run the step again.")
      return finish("silent", "No data")
    }

    // some data: works or partial
    const partial: string[] = []
    if (!m.moved) partial.push("Every sample was identical: the position never changed.")
    if (rateHz !== null && rateHz < CHECK_THRESHOLDS.minRateHz) partial.push(`Only ${Math.round(rateHz)} samples per second (30 or more needed).`)
    if (rateHz === null) partial.push("Too few samples to measure the rate.")
    if (m.inRange < CHECK_THRESHOLDS.minSamples) partial.push(`Only ${m.inRange} samples in the whole check (${CHECK_THRESHOLDS.minSamples} needed).`)
    if (!coverage || coverage.x < CHECK_THRESHOLDS.minCoverage || coverage.y < CHECK_THRESHOLDS.minCoverage) {
      partial.push(coverage
        ? `Reached only ${pct(coverage.x)} across and ${pct(coverage.y)} down the tablet (60% each needed).`
        : "The position never covered any of the tablet.")
    }
    if (!(m.pmax > 0)) partial.push("Pressure never rose above 0.")
    if (!isScreenFrame(name) && frame === null) partial.push("Which way the tablet is turned could not be worked out.")
    if (state === "failed" && statusReason) partial.push(`It then failed: ${statusReason}`)
    const info: string[] = []
    if (!m.lowerSeen && !m.upperSeen) info.push("No side button was seen.")
    else if (!m.lowerSeen) info.push("Only the upper side button was reported.")
    else if (!m.upperSeen) info.push("Only the lower side button was reported.")

    const buttons = m.lowerSeen && m.upperSeen ? "both side buttons" : m.lowerSeen ? "lower side button only" : m.upperSeen ? "upper side button only" : "no side buttons"
    const cov = coverage
      ? (coverage.x >= 0.9 && coverage.y >= 0.9 ? "whole tablet reached" : `${pct(coverage.x)} x ${pct(coverage.y)} of the tablet reached`)
      : "no coverage"
    const headline = `${rateHz === null ? "? Hz" : `${Math.round(rateHz)} Hz`}, ${m.pressures.size ? `${m.pressures.size} pressure levels` : "no pressure"}, ${buttons}, ${cov}.`
    if (partial.length) {
      reasons.push(...partial, ...info)
      return finish("partial", headline)
    }
    reasons.push(...info)
    return finish("works", headline)
  }

  function buildRows(): CheckRow[] {
    const statuses = deps.statuses()
    const byName = new Map<BackendName, BackendStatus>(statuses.map((s) => [s.name, s]))
    return backendNames(statuses).map((n) => buildRow(n, byName.get(n)))
  }

  function buttonEvidence(backend: BackendName): boolean | null {
    const lowerStep = accs.get(backend)?.steps.get("lower")
    const upperStep = accs.get(backend)?.steps.get("upper")
    if (!lowerStep || !upperStep) return null
    const n = CHECK_THRESHOLDS.buttonPresses
    // "lower" asks for the button NEAREST THE TIP; "upper" for the one farthest from it
    if (lowerStep.upperRises >= n && lowerStep.lowerRises === 0 && upperStep.lowerRises >= n && upperStep.upperRises === 0) return true
    if (lowerStep.lowerRises >= n && lowerStep.upperRises === 0 && upperStep.upperRises >= n && upperStep.lowerRises === 0) return false
    return null
  }

  function advise(rows: CheckRow[], winnerRow: CheckRow | null, env: EnvSummary | null, swap: boolean | null): string[] {
    const advice: string[] = []
    const statuses = deps.statuses()
    const tablet = env?.tablet
    if (tablet && tablet.present && tablet.problem) {
      advice.push(`Windows says the tablet is not working (${tablet.problem}). Unplug it and plug it back in, or restart the PC; if it stays, reinstall the Wacom driver. This is not WriteMind.`)
    } else if (env && env.platform === "win32" && tablet === null) {
      advice.push("Windows does not list a Wacom tablet. Check the cable.")
    }
    const natives = rows.filter((r) => r.backend !== "overlay" && r.backend !== "inject" && r.verdict !== "unavailable" && r.verdict !== "skipped")
    const anyUsable = rows.some((r) => r.verdict === "works" || r.verdict === "partial")
    const wt = witnessTotals()
    if (natives.length && !anyUsable) {
      if (natives.some((r) => r.verdict === "silent") && wt.seen > 0) {
        advice.push("Windows sees the pen but no backend can read it. Restart the 'Wacom Professional Service' (Services app), run the check again, and use Copy diagnostics.")
      }
      if (natives.every((r) => r.verdict === "failed" || r.verdict === "silent")) {
        advice.push(deps.sinkPassed?.() === true
          ? "The tablet cannot be read directly here, so the overlay is used: everything under the pen is covered while the pen is near."
          : "No native backend can read this tablet. The overlay can still capture the pen: [Test overlay].")
      }
    }
    if (winnerRow && winnerRow.verdict === "works" && winnerRow.frame && winnerRow.frame.source === "default") {
      advice.push("Direction is a guess. Draw the two lines so the ink goes the way you write.")
    }
    if (winnerRow && (winnerRow.verdict === "works" || winnerRow.verdict === "partial") && !(winnerRow.lower && winnerRow.upper)) {
      advice.push("Only one side button is reported. In Wacom Tablet Properties another action may be set on the other one.")
    }
    for (const r of rows) {
      if ((r.backend === "rawinput" || r.backend === "webhid") && (r.verdict === "works" || r.verdict === "partial")) {
        if (statuses.find((s) => s.name === r.backend)?.facts.looksDriverMapped === true) {
          advice.push("Raw HID looks already mapped to the screen by the driver; it works but cannot do better than the pointer.")
          break
        }
      }
    }
    if (deps.pointerMode?.() === "mouse") {
      advice.push("The driver is in Mouse mode. Switch to Pen mode (Wacom Tablet Properties, Mapping) for absolute positions.")
    }
    if (swap === true) {
      advice.push("The two side buttons are the other way round from what the tablet reports; WriteMind will swap them (undo it on this page if that is wrong).")
    }
    if (winnerRow && winnerRow.verdict === "works" && deps.contained?.() !== true) {
      advice.push("The pen works. Taps outside the sheet still reach other windows. Test containment: [Test driver mapping] [Test overlay].")
    }
    return advice
  }

  function buildReport(): CheckReport {
    const rows = buildRows()
    const env = deps.env()
    const order = (b: BackendName): number => BACKEND_ORDER.indexOf(b)
    const works = rows.filter((r) => r.verdict === "works").sort((a, b) => order(a.backend) - order(b.backend))
    const partials = rows.filter((r) => r.verdict === "partial").sort((a, b) => b.samples - a.samples || order(a.backend) - order(b.backend))
    const winnerRow = works[0] ?? partials[0] ?? null
    const overall: CheckReport["overall"] = works.length ? "ok" : partials.length ? "partial" : "none"
    const swap = winnerRow ? buttonEvidence(winnerRow.backend) : null
    const frames: Record<string, FrameRecord> = {}
    for (const r of rows) if (r.frame && !isScreenFrame(r.backend) && r.samples > 0) frames[r.backend] = r.frame
    let summary: string
    if (winnerRow && overall === "ok") summary = `${BACKEND_LABEL[winnerRow.backend]} works: ${winnerRow.headline}`
    else if (winnerRow) summary = `${BACKEND_LABEL[winnerRow.backend]} works only partly: ${winnerRow.reasons[0] ?? winnerRow.headline}`
    else summary = rows.some((r) => r.verdict === "silent")
      ? "No backend could read the pen: every one that started stayed silent."
      : "No backend could read the pen."
    return {
      at: new Date(deps.now()).toISOString(), overall, winner: winnerRow ? winnerRow.backend : null, summary, rows,
      learned: { frames, pointerMode: deps.pointerMode?.() ?? null, swapButtons: swap },
      advice: advise(rows, winnerRow, env, swap),
    }
  }

  // ---------------------------------------------------------------- the CheckEngine

  function snapshot(): CheckSnapshot {
    return { running, step: current, secondsLeft: secondsLeft(), done: [...done], rows: running || report ? buildRows() : [], env: deps.env(), report }
  }

  return {
    begin() {
      reset()
      running = true
      return snapshot()
    },
    feed,
    witness,
    start(step) {
      if (!running) { reset(); running = true }
      beginStep(step)
      return snapshot()
    },
    tick() {
      if (running && current) {
        const total = spec(current).seconds * 1000
        if (deps.now() - startedAt >= total) {
          const idx = CHECK_STEPS.findIndex((s) => s.id === current)
          completeCurrent()
          const next = CHECK_STEPS[idx + 1]
          if (next && !next.optional) beginStep(next.id)
        }
      }
      return snapshot()
    },
    cancel() {
      running = false
      current = null
      return snapshot()
    },
    finish() {
      completeCurrent()
      report = buildReport()
      running = false
      return report
    },
    snapshot,
  }
}
