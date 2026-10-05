/**
 * main/pen/domBackend.ts - the WINDOW PEN backend, `dom` (docs/spikes/DESIGN-pen-capture.md 4.7), owned by IMPL-D.
 *
 * The pen events Chromium delivers to the notes window (`pointerType === "pen"`) are taken by the renderer's gate (renderer/penGate.ts),
 * reported to main on `pen:dom` as `DomPenReport`s (DIP position on the virtual desktop, pressure, buttons), and turned here into
 * `PenSample`s in the SCREEN frame: where the pen is on the display, as fractions. Nothing native: no koffi, no helper window, no OS state
 * to release. It is the floor under every native backend: it needs only that Windows Ink hands Chromium real pen events, so a wrong guess
 * about Wintab / Raw Input / WebHID costs precision (it reaches only the part of the tablet that maps onto the window), never the pen.
 *
 * CONVERSION. With b = the DIP bounds of the display that contains the point:  x = clamp01((sx - b.x) / (b.width - 1)), y alike: the first
 * and last pixel are the tablet's edges (the same rule as shared/orientation.ts `displayFraction`). tip = buttons & 1, lower = buttons & 2
 * (Windows exposes ONE barrel button), upper = buttons & 4 (only when the driver maps a second button to the middle slot), eraser = buttons & 32.
 * The renderer does no display arithmetic of its own, so multi-display and scale handling live in one place that has Electron's `screen`.
 *
 * STATE. It follows the pen's visits (the manager marks it live after the ordinary four moving samples and armed again when a visit ends).
 * It is never stale or failed. A report with `inRange: false` ends a visit; a VisitTracker also ends one after LEAVE_HOVER_MS / LEAVE_CONTACT_MS
 * of silence (a perfectly still pen sends nothing).
 *
 * REACH. `status().facts` carry `coverage.x` / `coverage.y` (the share of the display the window's content covers) and the rectangle itself
 * as fractions of the display: `cover.x0..y1`, plus the display's work area (without the taskbar) as `work.x0..y1`. The chip, the check and
 * the reach hint (design 7.7) read them.
 */

import { clamp01, type BackendStart, type BackendStatus, type Box, type DomPenReport, type PenBackend, type PenSample } from "../../shared/pen"
import { BackendCore } from "./backendCore"
import { VisitTracker } from "./batcher"
import type { CreateDomBackend, DomDeps, DomIngest } from "./types"

/** At most this many reports are taken from one `pen:dom` message. */
export const DOM_MAX_REPORTS = 512
const TICK_MS = 100

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

export interface DomOptions {
  /** Epoch ms; tests pass their own clock. */
  now?: () => number
}

/** One report to a sample, or null when it cannot be placed (a non-finite number, or a point on no display). Pure apart from `displayAt`. */
export function sampleFromReport(report: DomPenReport, displayAt: DomDeps["displayAt"]): PenSample | null {
  if (!report || !finite(report.t) || !finite(report.sx) || !finite(report.sy) || !finite(report.p) || !finite(report.buttons)) return null
  if (report.tiltX !== undefined && !finite(report.tiltX)) return null
  if (report.tiltY !== undefined && !finite(report.tiltY)) return null
  let b: Box | null
  try { b = displayAt({ x: report.sx, y: report.sy }) } catch { return null }
  if (!b || !(b.width > 0) || !(b.height > 0)) return null
  const buttons = report.buttons | 0
  const inRange = report.inRange !== false
  const tip = inRange && (buttons & 1) !== 0
  const sample: PenSample = {
    t: report.t,
    x: clamp01((report.sx - b.x) / Math.max(1, b.width - 1)),
    y: clamp01((report.sy - b.y) / Math.max(1, b.height - 1)),
    p: inRange ? clamp01(report.p) : 0,
    tip,
    lower: inRange && (buttons & 2) !== 0,
    upper: inRange && (buttons & 4) !== 0,
    eraser: inRange && (buttons & 32) !== 0,
    inRange,
    backend: "dom",
  }
  if (inRange && report.tiltX !== undefined) sample.tiltX = Math.max(-90, Math.min(90, report.tiltX))
  if (inRange && report.tiltY !== undefined) sample.tiltY = Math.max(-90, Math.min(90, report.tiltY))
  return sample
}

/** The window's reach as facts (design 4.7): the share of the display the content covers, and the rectangles as fractions of the display. */
export function reachFacts(window: Box | null, display: Box | null, work: Box | null): Record<string, number> {
  const out: Record<string, number> = {}
  if (!window || !display || !(display.width > 0) || !(display.height > 0)) return out
  const x0 = clamp01((window.x - display.x) / display.width), y0 = clamp01((window.y - display.y) / display.height)
  const x1 = clamp01((window.x + window.width - display.x) / display.width), y1 = clamp01((window.y + window.height - display.y) / display.height)
  out["coverage.x"] = round(Math.max(0, x1 - x0))
  out["coverage.y"] = round(Math.max(0, y1 - y0))
  out["cover.x0"] = round(x0); out["cover.y0"] = round(y0); out["cover.x1"] = round(x1); out["cover.y1"] = round(y1)
  if (work) {
    out["work.x0"] = round(clamp01((work.x - display.x) / display.width))
    out["work.y0"] = round(clamp01((work.y - display.y) / display.height))
    out["work.x1"] = round(clamp01((work.x + work.width - display.x) / display.width))
    out["work.y1"] = round(clamp01((work.y + work.height - display.y) / display.height))
  }
  return out
}
const round = (v: number): number => Math.round(v * 1000) / 1000

export const createDomBackend: CreateDomBackend = (deps: DomDeps, options: DomOptions = {}): PenBackend & DomIngest => {
  const now = options.now ?? (() => Date.now())
  const core = new BackendCore("dom", { now })
  const tracker = new VisitTracker()
  let running = false
  let timer: ReturnType<typeof setInterval> | null = null

  const emitChecked = (s: PenSample): void => {
    const out = tracker.observe(s, now())
    if (out) core.emit(out)
  }

  const tick = (): void => {
    if (!running) return
    const leave = tracker.tick(now())
    if (leave) { core.emit(leave); core.flush() }
  }

  return {
    name: "dom",
    frameKind: "screen",
    available: () => ({ ok: true }),
    async start(): Promise<BackendStart> {
      core.resetObservations()
      tracker.reset()
      running = true
      core.setState("armed", null)
      if (timer) clearInterval(timer)
      timer = setInterval(tick, TICK_MS)
      timer.unref?.()
      return { ok: true, device: null }
    },
    stop(): void {
      running = false
      if (timer) { clearInterval(timer); timer = null }
      core.discard()
      tracker.reset()
      core.setState("idle", null)
    },
    ingest(reports: DomPenReport[]): void {
      // Reports that arrive while the feed is closed are dropped (design 15.2 #25).
      if (!running || !Array.isArray(reports)) return
      const take = reports.length > DOM_MAX_REPORTS ? DOM_MAX_REPORTS : reports.length
      core.raw(take)
      let last: PenSample | null = null
      for (let i = 0; i < take; i++) {
        const sample = sampleFromReport(reports[i]!, deps.displayAt)
        if (!sample) { core.dropped(); continue }
        // A leave report carries the position of the last event, but a pen that left the window with no position at all still ends the visit.
        emitChecked(sample)
        last = sample
      }
      if (last) core.fact("lastDisplayRaw", `${last.x.toFixed(3)},${last.y.toFixed(3)}`)
      core.flush()
    },
    onSample: (l) => core.onSample(l),
    onEvent: (l) => core.onEvent(l),
    status(): BackendStatus {
      const s = core.status()
      let win: Box | null = null
      try { win = deps.windowBounds() } catch { win = null }
      let display: Box | null = null
      let work: Box | null = null
      if (win) {
        const centre = { x: win.x + win.width / 2, y: win.y + win.height / 2 }
        try { display = deps.displayAt(centre) } catch { display = null }
        try { work = deps.workAreaAt?.(centre) ?? null } catch { work = null }
      }
      return { ...s, facts: { ...s.facts, ...reachFacts(win, display, work) } }
    },
  }
}
