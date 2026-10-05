// Helpers for the native pen feed suites (docs/spikes/DESIGN-pen-capture.md 3.4, 15.4). Import after harness.mjs:
//
//   import { capture, injectStroke, waitLive, sheetStrokes, ... } from "../../lib/penfeed.mjs"
//
// SAMPLES ARE IN THE SCREEN FRAME (where the driver would put the cursor with the whole tablet mapped to the whole display):
// `sheetToScreen` turns a point on the SHEET (0..1, top-left origin) into the screen-frame point that the person's orientation
// maps onto it, so a test can say "a rectangle on the sheet" in all four orientations and read the stored strokes back.
//
// Everything goes through `wm.pen.e2e.inject` (pen:inject -> the manager's `inject` backend -> IPC -> the page's synthesiser), the
// path every real backend's samples take from the manager on. Capture starts OFF under WRITEMIND_E2E; `capture(true)` turns it on.

import { js, ok, sleep, until, setSelect } from "./harness.mjs"

/** Sheet point -> screen-frame point for `turns` quarter turns (the inverse of shared/orientation.ts screenToSheet). */
export function sheetToScreen(p, turns) {
  switch (turns) {
    case 0: return { x: p.x, y: p.y }
    case 1: return { x: p.y, y: 1 - p.x }
    case 2: return { x: 1 - p.x, y: 1 - p.y }
    default: return { x: 1 - p.y, y: p.x }
  }
}

/** Turn pen capture on or off (it starts OFF under E2E). Resolves with the feed status. */
export const capture = (on = true) => js(`window.wm.pen.e2e.config({ capture: ${on ? "true" : "false"} }).then(s => ({ open: s.open, enabled: s.settings.enabled, released: s.released }))`)
export const penState = () => js(`window.wm.pen.e2e.state()`)
export const gateState = () => js(`JSON.stringify(window.__wmPenFeed ? window.__wmPenFeed.gate() : null)`).then((s) => JSON.parse(s))
export const feedConfig = (c) => js(`window.wm.pen.e2e.config(${JSON.stringify(c)})`)

/** The sheet's stored strokes (fractions of the sheet), as the page keeps them for the checks. */
export const sheetStrokes = () => js(`JSON.stringify(window.__wmSheet.strokes)`).then((s) => JSON.parse(s))
export const clearSheet = () => js(`window.__wmSheet.strokes = []; window.__wmSheet.clear?.(); true`)

let clock = 0
/** One sample with defaults (a hovering pen at the middle). Times advance 8 ms a sample unless `t` is given. */
export function sample(over = {}) {
  clock += 8
  return { t: Date.now() + clock, x: 0.5, y: 0.5, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "inject", ...over }
}

/**
 * The samples of one stroke on the sheet: a hover at the first point, the tip down with pressure rising from p0 to p1, the move along
 * `points` (sheet fractions, `perSegment` samples between neighbours), the tip up, and the pen leaving range.
 * opts: turns (the orientation, default 0), p0, p1, perSegment, lower/upper/eraser (a button held through the stroke), hoverSamples, leave (default true).
 */
export function strokeSamples(points, opts = {}) {
  const turns = opts.turns ?? 0
  const per = opts.perSegment ?? 4
  const out = []
  const at = (u) => sheetToScreen(u, turns)
  const buttons = { lower: !!opts.lower, upper: !!opts.upper, eraser: !!opts.eraser }
  const hover = at(points[0])
  for (let i = 0; i < (opts.hoverSamples ?? 4); i++) out.push(sample({ x: hover.x + i * 1e-4, y: hover.y, ...(opts.hoverButtons ? buttons : {}) }))
  const path = [points[0]]
  for (let i = 1; i < points.length; i++) {
    for (let k = 1; k <= per; k++) path.push({ x: points[i - 1].x + (points[i].x - points[i - 1].x) * k / per, y: points[i - 1].y + (points[i].y - points[i - 1].y) * k / per })
  }
  const p0 = opts.p0 ?? 0.2, p1 = opts.p1 ?? 0.8
  path.forEach((u, i) => {
    const s = at(u)
    out.push(sample({ x: s.x, y: s.y, p: p0 + (p1 - p0) * (i / Math.max(1, path.length - 1)), tip: true, ...buttons }))
  })
  const last = at(path.at(-1))
  out.push(sample({ x: last.x, y: last.y, p: 0, tip: false, ...(opts.hoverButtons ? buttons : {}) }))
  if (opts.leave !== false) out.push(sample({ x: last.x, y: last.y, inRange: false }))
  return out
}

/** Hover samples at a sheet point (no contact). */
export function hoverSamples(point, opts = {}) {
  const s = sheetToScreen(point, opts.turns ?? 0)
  return Array.from({ length: opts.n ?? 6 }, (_, i) => sample({ x: s.x + i * 1e-4, y: s.y, ...(opts.lower ? { lower: true } : {}), ...(opts.upper ? { upper: true } : {}) }))
}

/** Hand samples to the manager (batches of at most `batch`, with `gapMs` between them: a real pen's flow). */
export async function inject(samples, { batch = 8, gapMs = 6 } = {}) {
  for (let i = 0; i < samples.length; i += batch) {
    await js(`window.wm.pen.e2e.inject(${JSON.stringify(samples.slice(i, i + batch))}).then(() => true)`)
    if (gapMs) await sleep(gapMs)
  }
}

/** Inject a whole stroke and wait for the page to have processed it. */
export async function injectStroke(points, opts = {}) {
  await inject(strokeSamples(points, opts), opts)
  await sleep(opts.settle ?? 120)
}

/** The feed is live: the inject backend is the active one. */
export const waitLive = async (backend = "inject", ms = 6000) => until(async () => (await penState()).active === backend, ms, 80)

/** Set the tablet orientation through the page's own dropdown (the sheet takes the new shape). */
export async function setTurns(turns) {
  await setSelect("[data-tablet=orientation]", String(turns))
  await sleep(350)
}

/** Reset the clock of generated samples (tests that compare timing). */
export const resetClock = () => { clock = 0 }

export { ok }
