// main/pen/frame.ts: defaults, the pair-based frame fit (appendix A.1's 33 cases), the agreement score, the two guided strokes.
// Synthetic and deterministic (a seeded generator); nothing here has seen a real pen.
import { describe, expect, it } from "vitest"
import { applyFrame, type DeviceInfo, type FrameTransform } from "../../src/shared/pen"
import {
  FRAME_CANDIDATES, corr, defaultFrame, deviceExtents, frameKey, inferFrameFromPairs, inferFrameFromStrokes, scoreFrame,
  type FramePair, type RawStroke,
} from "../../src/main/pen/frame"

/** mulberry32: a small seeded generator so no test is flaky. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type P = { x: number; y: number }

/** The pen sweeps the rectangle's edge, then a cross through the middle. Points are in the DEVICE frame. */
function rectangleAndCross(n = 60): P[] {
  const pts: P[] = []
  const edge = (a: P, b: P, k: number): void => { for (let i = 0; i < k; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / k, y: a.y + ((b.y - a.y) * i) / k }) }
  edge({ x: 0.08, y: 0.1 }, { x: 0.92, y: 0.1 }, n / 6)
  edge({ x: 0.92, y: 0.1 }, { x: 0.92, y: 0.9 }, n / 6)
  edge({ x: 0.92, y: 0.9 }, { x: 0.08, y: 0.9 }, n / 6)
  edge({ x: 0.08, y: 0.9 }, { x: 0.08, y: 0.1 }, n / 6)
  edge({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, n / 6)
  edge({ x: 0.5, y: 0.12 }, { x: 0.5, y: 0.88 }, n / 6)
  return pts
}

/** A waving hover: a Lissajous figure, smooth like a hand. */
function waving(n = 80, seed = 3): P[] {
  const r = rng(seed)
  const ph = r() * 6
  return Array.from({ length: n }, (_, i) => ({ x: 0.5 + 0.42 * Math.sin(i * 0.31 + ph), y: 0.5 + 0.42 * Math.sin(i * 0.47 + ph * 2) }))
}

const pairsFor = (pts: P[], f: FrameTransform, map: (s: P) => P = (s) => s): FramePair[] =>
  pts.map((raw) => { const [sx, sy] = applyFrame(raw.x, raw.y, f); return { raw, screen: map({ x: sx, y: sy }) } })

/** A driver "portion of screen" mapping: the tablet covers a 60% x 70% part of the display. */
const portion = (s: P): P => ({ x: 0.2 + 0.6 * s.x, y: 0.1 + 0.7 * s.y })

const sameFrame = (a: FrameTransform | null, b: FrameTransform): boolean => a !== null && a.turn === b.turn && a.flipY === b.flipY

describe("the candidates", () => {
  it("are the 8 transforms, all different", () => {
    expect(FRAME_CANDIDATES).toHaveLength(8)
    expect(new Set(FRAME_CANDIDATES.map((f) => `${f.turn}${f.flipY}`)).size).toBe(8)
  })
  it("applyFrame: turning four times is the identity, and flipY mirrors y before the turn", () => {
    let p: [number, number] = [0.2, 0.7]
    for (let i = 0; i < 4; i++) p = applyFrame(p[0], p[1], { turn: 1, flipY: false })
    expect(p[0]).toBeCloseTo(0.2, 9)
    expect(p[1]).toBeCloseTo(0.7, 9)
    expect(applyFrame(0.2, 0.7, { turn: 0, flipY: true })).toEqual([0.2, 1 - 0.7])
  })
})

describe("inferFrameFromPairs: every transform from the pairs", () => {
  for (const f of FRAME_CANDIDATES) {
    const name = `turn ${f.turn}${f.flipY ? ", flipY" : ""}`
    it(`${name}: a rectangle and a cross sweep`, () => {
      const fit = inferFrameFromPairs(pairsFor(rectangleAndCross(), f))
      expect(sameFrame(fit.frame, f)).toBe(true)
      expect("score" in fit && fit.score).toBeGreaterThan(0.99)
      expect("margin" in fit && fit.margin).toBeGreaterThan(0.3)
    })
    it(`${name}: with a driver 'portion of screen' mapping (scale and offset do not matter)`, () => {
      expect(sameFrame(inferFrameFromPairs(pairsFor(rectangleAndCross(), f, portion)).frame, f)).toBe(true)
    })
    it(`${name}: a waving hover`, () => {
      expect(sameFrame(inferFrameFromPairs(pairsFor(waving(), f)).frame, f)).toBe(true)
    })
  }
})

describe("inferFrameFromPairs: pairs spoiled by a moving mouse or a late cursor read", () => {
  for (const share of [0.1, 0.15, 0.18]) {
    it(`${Math.round(share * 100)}% of the pairs are junk and the fit still lands`, () => {
      const f: FrameTransform = { turn: 1, flipY: true }
      const r = rng(11)
      const pairs = pairsFor(rectangleAndCross(120), f).map((p) => (r() < share ? { raw: p.raw, screen: { x: r(), y: r() } } : p))
      expect(sameFrame(inferFrameFromPairs(pairs).frame, f)).toBe(true)
    })
  }
  it("small jitter of the cursor (margins, forced proportions) is tolerated", () => {
    const f: FrameTransform = { turn: 3, flipY: false }
    const r = rng(5)
    const pairs = pairsFor(rectangleAndCross(120), f).map((p) => ({ raw: p.raw, screen: { x: p.screen.x + (r() - 0.5) * 0.04, y: p.screen.y + (r() - 0.5) * 0.04 } }))
    expect(sameFrame(inferFrameFromPairs(pairs).frame, f)).toBe(true)
  })
})

describe("inferFrameFromPairs: refusals say why", () => {
  it("ten pairs are too few", () => {
    const fit = inferFrameFromPairs(pairsFor(rectangleAndCross().slice(0, 10), { turn: 0, flipY: false }))
    expect(fit).toEqual({ frame: null, reason: "too few pairs" })
  })
  it("a straight line has no spread on one axis", () => {
    const line = Array.from({ length: 40 }, (_, i) => ({ x: i / 39, y: 0.5 }))
    expect(inferFrameFromPairs(pairsFor(line, { turn: 0, flipY: false }))).toEqual({ frame: null, reason: "raw spread too small" })
  })
  it("a diagonal scribble cannot tell a transpose from the identity", () => {
    const diag = Array.from({ length: 40 }, (_, i) => ({ x: i / 39, y: i / 39 }))
    expect(inferFrameFromPairs(pairsFor(diag, { turn: 0, flipY: false }))).toEqual({ frame: null, reason: "ambiguous: x and y move together" })
  })
  it("pure noise fits nothing", () => {
    const r = rng(99)
    const noise = Array.from({ length: 80 }, () => ({ raw: { x: r(), y: r() }, screen: { x: r(), y: r() } }))
    const fit = inferFrameFromPairs(noise)
    expect(fit.frame).toBeNull()
  })
  it("a screen position that does not move is not evidence", () => {
    const f: FrameTransform = { turn: 0, flipY: false }
    const pairs = pairsFor(rectangleAndCross(), f, () => ({ x: 0.5, y: 0.5 }))
    expect(inferFrameFromPairs(pairs).frame).toBeNull()
  })
  it("thresholds are options (stricter accept refuses a fit the default takes)", () => {
    const f: FrameTransform = { turn: 2, flipY: true }
    const r = rng(2)
    const pairs = pairsFor(rectangleAndCross(120), f).map((p) => ({ raw: p.raw, screen: { x: p.screen.x + (r() - 0.5) * 0.3, y: p.screen.y + (r() - 0.5) * 0.3 } }))
    expect(inferFrameFromPairs(pairs, { accept: 0.999 }).frame).toBeNull()
  })
})

describe("scoreFrame: the agreement monitor", () => {
  const f: FrameTransform = { turn: 1, flipY: true }
  const pairs = pairsFor(rectangleAndCross(), f)
  it("is ~1 for the frame in force and low for the wrong one", () => {
    expect(scoreFrame(pairs, f)).toBeGreaterThan(0.99)
    expect(scoreFrame(pairs, { turn: 0, flipY: false })).toBeLessThan(0.6)
  })
  it("is 0 with fewer than 2 pairs", () => {
    expect(scoreFrame(pairs.slice(0, 1), f)).toBe(0)
  })
  it("corr is Pearson and 0 for a constant side", () => {
    expect(corr([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 9)
    expect(corr([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 9)
    expect(corr([1, 1, 1], [1, 2, 3])).toBe(0)
  })
})

describe("defaults (design 6.2)", () => {
  it("wintab: a portrait raw frame (measured on this machine: 9499 x 15199) is turned 90 cw with y mirrored; landscape only mirrors y", () => {
    expect(defaultFrame("wintab", 9499, 15199)).toEqual({ turn: 1, flipY: true })
    expect(defaultFrame("wintab", 15200, 9500)).toEqual({ turn: 0, flipY: true })
  })
  it("hid: y is already down; portrait turns 90 cw, landscape is as is", () => {
    expect(defaultFrame("hid", 15200, 9500)).toEqual({ turn: 0, flipY: false })
    expect(defaultFrame("hid", 9500, 15200)).toEqual({ turn: 1, flipY: false })
  })
  it("screen backends are the identity; unknown extents take the landscape guess", () => {
    expect(defaultFrame("screen", null, null)).toEqual({ turn: 0, flipY: false })
    expect(defaultFrame("hid", null, null)).toEqual({ turn: 0, flipY: false })
    expect(defaultFrame("wintab", null, null)).toEqual({ turn: 0, flipY: true })
  })
  it("frameKey names family, device and extents", () => {
    expect(frameKey("wintab", "WACOM Tablet", 9499, 15199)).toBe("wintab:WACOM Tablet:9499x15199")
    expect(frameKey("hid", "HID VID_056A&PID_037A", null, null)).toBe("hid:HID VID_056A&PID_037A:?x?")
  })
  const info = (over: Partial<DeviceInfo>): DeviceInfo => ({
    name: "t", vendorId: null, productId: null, aspect: null, rawX: null, rawY: null, pressureMax: null,
    claims: { pressure: true, tilt: false, lower: true, upper: true, eraser: false }, ...over,
  })
  it("deviceExtents: Wintab hands the raw ranges over, HID with equal logical ranges takes the physical aspect (landscape)", () => {
    expect(deviceExtents("wintab", info({ rawX: [0, 9499], rawY: [0, 15199] }))).toEqual({ width: 9499, height: 15199 })
    const hid = deviceExtents("hid", info({ rawX: [0, 32767], rawY: [0, 32767], aspect: 1.6 }))
    expect(hid.width! / hid.height!).toBeCloseTo(1.6, 3)
    expect(deviceExtents("hid", info({ rawX: [0, 100], rawY: [0, 200], aspect: 2 }))).toEqual({ width: 100, height: 200 })
    expect(deviceExtents("screen", info({}))).toEqual({ width: null, height: null })
    expect(deviceExtents("hid", null)).toEqual({ width: null, height: null })
  })
})

describe("the two guided strokes (hover is enough)", () => {
  /** A device-frame stroke that reads from screen point a to screen point b under the transform f. */
  const stroke = (f: FrameTransform, a: P, b: P): RawStroke => {
    // brute force the inverse: the device point that f maps onto the screen point
    const back = (s: P): P => {
      let best: P = { x: 0, y: 0 }
      let d = Infinity
      for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
        const q = { x: i / 20, y: j / 20 }
        const [sx, sy] = applyFrame(q.x, q.y, f)
        const e = (sx - s.x) ** 2 + (sy - s.y) ** 2
        if (e < d) { d = e; best = q }
      }
      return best
    }
    return { from: back(a), to: back(b) }
  }
  for (const f of FRAME_CANDIDATES) {
    it(`finds turn ${f.turn}${f.flipY ? ", flipY" : ""} from left-to-right then top-to-bottom`, () => {
      const lr = stroke(f, { x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 })
      const tb = stroke(f, { x: 0.5, y: 0.05 }, { x: 0.5, y: 0.95 })
      expect(sameFrame(inferFrameFromStrokes(lr, tb), f)).toBe(true)
    })
  }
  it("two strokes on the same device axis, or strokes that are too short, give no answer", () => {
    const along: RawStroke = { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } }
    expect(inferFrameFromStrokes(along, along)).toBeNull()
    expect(inferFrameFromStrokes({ from: { x: 0.5, y: 0.5 }, to: { x: 0.6, y: 0.5 } }, { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.6 } })).toBeNull()
  })
  it("a sloppy pair of strokes (a little off-axis) is still read; a diagonal one is not", () => {
    const lr: RawStroke = { from: { x: 0.05, y: 0.45 }, to: { x: 0.95, y: 0.55 } }
    const tb: RawStroke = { from: { x: 0.45, y: 0.05 }, to: { x: 0.55, y: 0.95 } }
    expect(inferFrameFromStrokes(lr, tb)).toEqual({ turn: 0, flipY: false })
    expect(inferFrameFromStrokes({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, tb)).toBeNull()
  })
})
