/**
 * main/pen/frame.ts - frame defaults and calibration (docs/spikes/DESIGN-pen-capture.md 6.2, 6.3, appendix A.1; owner IMPL-A).
 * Pure: no Node, no Electron, no koffi.
 *
 *  - `defaultFrame(family, rawX, rawY)`: the guess before anything is measured (labelled `default` by the manager).
 *  - `inferFrameFromPairs(pairs)`: which of the 8 transforms takes the device frame to the screen frame, from (device sample, where the
 *    pointer stack says the pen is) pairs. Pearson correlation per axis, so scale, offset, a driver "portion of screen" mapping and
 *    partial coverage do not matter; the worst 20% of pairs are tolerated (a moving mouse, a late cursor read); refusals say why.
 *  - `scoreFrame(pairs, frame)`: the agreement monitor's score of the frame in force.
 *  - `inferFrameFromStrokes(leftToRight, topToBottom)`: the check's two guided strokes (hover is enough).
 *  - `deviceExtents(family, device)`: the width / height the manager should hand `defaultFrame` (physical for HID, raw for Wintab).
 *
 * The manager owns pair buffering and cadence; this file owns the arithmetic and the thresholds.
 */
import { applyFrame, type DeviceInfo, type FrameTransform } from "../../shared/pen"

export interface FramePair { raw: { x: number; y: number }; screen: { x: number; y: number } }
export interface FrameFit { frame: FrameTransform; score: number; margin: number }
export type FrameRefusal = { frame: null; reason: string }

export const FRAME_CANDIDATES: FrameTransform[] = ([0, 1, 2, 3] as const).flatMap((turn) => [false, true].map((flipY) => ({ turn, flipY })))

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
const sd = (a: number[], m = mean(a)): number => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)

export function corr(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b), sa = sd(a, ma), sb = sd(b, mb)
  if (sa < 1e-9 || sb < 1e-9) return 0
  let c = 0
  for (let i = 0; i < a.length; i++) c += (a[i]! - ma) * (b[i]! - mb)
  return c / a.length / (sa * sb)
}

function trimmedScore(t: [number, number][], sx: number[], sy: number[], trim: number): number {
  const line = (a: number[], b: number[]): number[] => {
    const ma = mean(a), mb = mean(b)
    let n = 0, d = 0
    for (let i = 0; i < a.length; i++) { n += (a[i]! - ma) * (b[i]! - mb); d += (a[i]! - ma) ** 2 }
    const k = d ? n / d : 0
    return a.map((v) => mb + k * (v - ma))
  }
  const tx = t.map((q) => q[0]), ty = t.map((q) => q[1])
  const fx = line(tx, sx), fy = line(ty, sy)
  const worst = tx.map((_, i) => Math.max(Math.abs(fx[i]! - sx[i]!), Math.abs(fy[i]! - sy[i]!)))
  const keep = worst.map((r, i) => [r, i] as const).sort((a, b) => a[0] - b[0])
    .slice(0, Math.max(8, Math.floor(worst.length * (1 - trim)))).map((q) => q[1])
  const pick = (a: number[]): number[] => keep.map((i) => a[i]!)
  return Math.min(corr(pick(tx), pick(sx)), corr(pick(ty), pick(sy)))
}

export interface InferOptions { minPairs?: number; minSd?: number; maxCross?: number; accept?: number; runnerUp?: number; trim?: number }

export function inferFrameFromPairs(pairs: FramePair[], o: InferOptions = {}): FrameFit | FrameRefusal {
  const minPairs = o.minPairs ?? 24, minSd = o.minSd ?? 0.08, maxCross = o.maxCross ?? 0.8
  const accept = o.accept ?? 0.9, runnerUp = o.runnerUp ?? 0.6, trim = o.trim ?? 0.2
  if (pairs.length < minPairs) return { frame: null, reason: "too few pairs" }
  const rx = pairs.map((p) => p.raw.x), ry = pairs.map((p) => p.raw.y)
  const sx = pairs.map((p) => p.screen.x), sy = pairs.map((p) => p.screen.y)
  if (sd(rx) < minSd || sd(ry) < minSd) return { frame: null, reason: "raw spread too small" }
  if (Math.abs(corr(rx, ry)) >= maxCross) return { frame: null, reason: "ambiguous: x and y move together" }
  const scored = FRAME_CANDIDATES.map((frame) => {
    const t = pairs.map((p) => applyFrame(p.raw.x, p.raw.y, frame))
    const plain = Math.min(corr(t.map((q) => q[0]), sx), corr(t.map((q) => q[1]), sy))
    return { frame, score: plain >= accept ? plain : trimmedScore(t, sx, sy, trim) }
  }).sort((a, b) => b.score - a.score)
  const best = scored[0]!, second = scored[1]!
  if (best.score < accept) return { frame: null, reason: "no good fit" }
  if (second.score > runnerUp) return { frame: null, reason: "runner-up too close" }
  return { frame: best.frame, score: best.score, margin: best.score - second.score }
}

/** Score of a GIVEN frame against pairs (the agreement monitor). */
export function scoreFrame(pairs: FramePair[], frame: FrameTransform): number {
  if (pairs.length < 2) return 0
  const t = pairs.map((p) => applyFrame(p.raw.x, p.raw.y, frame))
  return Math.min(corr(t.map((q) => q[0]), pairs.map((p) => p.screen.x)), corr(t.map((q) => q[1]), pairs.map((p) => p.screen.y)))
}

/** The guess before anything is measured (design 6.2). */
export function defaultFrame(family: "wintab" | "hid" | "screen", rawX: number | null, rawY: number | null): FrameTransform {
  if (family === "screen") return { turn: 0, flipY: false }
  const portrait = rawX !== null && rawY !== null && rawX < rawY
  if (family === "wintab") return portrait ? { turn: 1, flipY: true } : { turn: 0, flipY: true }
  return portrait ? { turn: 1, flipY: false } : { turn: 0, flipY: false }
}

/** The persistence key of a frame: family:deviceName:rawXxrawY. */
export function frameKey(family: string, name: string, rawX: number | null, rawY: number | null): string {
  return family + ":" + name + ":" + (rawX ?? "?") + "x" + (rawY ?? "?")
}

/**
 * The extents to hand `defaultFrame`. Wintab: the raw axis ranges (portrait on this driver: 9500 x 15200). HID: BOTH logical ranges are 32767
 * on the Wacom, so the shape comes from the PHYSICAL size, which `DeviceInfo.aspect` carries as long side / short side; the logical
 * ranges decide only when the aspect is unknown. Returns null width / height when nothing is known.
 */
export function deviceExtents(family: "wintab" | "hid" | "screen", device: DeviceInfo | null): { width: number | null; height: number | null } {
  if (!device || family === "screen") return { width: null, height: null }
  const w = device.rawX ? device.rawX[1] - device.rawX[0] : null
  const h = device.rawY ? device.rawY[1] - device.rawY[0] : null
  if (family === "wintab") return { width: w, height: h }
  if (device.aspect !== null && device.aspect > 0 && w !== null && h !== null && w === h) {
    // equal logical ranges: the physical aspect says nothing about WHICH axis is long here (it is not recorded), so a landscape guess
    return { width: Math.round(device.aspect * 1000), height: 1000 }
  }
  return { width: w, height: h }
}

// ---------------------------------------------------------------------------------------------
// The two guided strokes
// ---------------------------------------------------------------------------------------------

/** A stroke in the DEVICE frame as unit coordinates (first and last in-contact or hovering sample). */
export interface RawStroke { from: { x: number; y: number }; to: { x: number; y: number } }

/**
 * The person moves the pen along the long edge from the LEFT end to the RIGHT end, then across the short side from the TOP to the BOTTOM,
 * as the tablet lies in front of them. Returns the transform under which those strokes read left-to-right / top-to-bottom in the
 * screen frame, or null when the strokes are too short (under `minFraction` of the tablet) or ambiguous (both on the same axis).
 */
export function inferFrameFromStrokes(leftToRight: RawStroke, topToBottom: RawStroke, minFraction = 0.3): FrameTransform | null {
  const d = (q: RawStroke): { dx: number; dy: number } => ({ dx: q.to.x - q.from.x, dy: q.to.y - q.from.y })
  const a = d(leftToRight)
  const b = d(topToBottom)
  const mag = (q: { dx: number; dy: number }): number => Math.max(Math.abs(q.dx), Math.abs(q.dy))
  if (!(mag(a) >= minFraction) || !(mag(b) >= minFraction)) return null
  // the two strokes must lie on different device axes
  if ((Math.abs(a.dx) > Math.abs(a.dy)) === (Math.abs(b.dx) > Math.abs(b.dy))) return null
  const through = (q: { dx: number; dy: number }, f: FrameTransform): [number, number] => {
    const o = applyFrame(0.5 + q.dx / 2, 0.5 + q.dy / 2, f)
    return [(o[0] - 0.5) * 2, (o[1] - 0.5) * 2]
  }
  for (const f of FRAME_CANDIDATES) {
    const ra = through(a, f)
    const rb = through(b, f)
    if (ra[0] > 0.2 && Math.abs(ra[1]) < 0.35 * Math.abs(ra[0]) && rb[1] > 0.2 && Math.abs(rb[0]) < 0.35 * Math.abs(rb[1])) return f
  }
  return null
}
