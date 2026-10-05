// main/pen/batcher.ts: SampleBatcher (at most 8 ms, ordered, never empty), VisitTracker (one leave per visit; hovering / contact timeouts;
// authoritative signals), RateMeter (rate, gap p95). Fake schedulers: no real time passes.
import { describe, expect, it } from "vitest"
import { LIVENESS, type PenSample } from "../../src/shared/pen"
import { RateMeter, SampleBatcher, VisitTracker, leaveSample } from "../../src/main/pen/batcher"

const s = (t: number, over: Partial<PenSample> = {}): PenSample => ({
  t, x: 0.5, y: 0.5, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "test", ...over,
})

/** A manual clock: schedule() queues, advance() runs what is due. */
function clock() {
  let now = 0
  let id = 0
  const jobs = new Map<number, { at: number; fn: () => void }>()
  return {
    schedule: (fn: () => void, ms: number): unknown => { const k = ++id; jobs.set(k, { at: now + ms, fn }); return k },
    cancel: (h: unknown): void => { jobs.delete(h as number) },
    advance(ms: number): void {
      const end = now + ms
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at
        jobs.delete(due[0])
        due[1].fn()
      }
      now = end
    },
    pending: () => jobs.size,
  }
}

describe("SampleBatcher", () => {
  it("hands samples over at most BATCH_MS after the first one, in order, in one batch", () => {
    const c = clock()
    const out: PenSample[][] = []
    const b = new SampleBatcher((x) => out.push(x), LIVENESS.BATCH_MS, c.schedule, c.cancel)
    b.push(s(1)); c.advance(3); b.push(s(2)); c.advance(3); b.push(s(3))
    expect(out).toHaveLength(0)
    c.advance(2) // 8 ms after the first
    expect(out).toHaveLength(1)
    expect(out[0]!.map((x) => x.t)).toEqual([1, 2, 3])
  })
  it("never emits an empty batch", () => {
    const c = clock()
    const out: PenSample[][] = []
    const b = new SampleBatcher((x) => out.push(x), 8, c.schedule, c.cancel)
    b.flush()
    c.advance(100)
    expect(out).toHaveLength(0)
  })
  it("a second batch starts with the next sample after a flush", () => {
    const c = clock()
    const out: PenSample[][] = []
    const b = new SampleBatcher((x) => out.push(x), 8, c.schedule, c.cancel)
    b.push(s(1)); c.advance(8)
    b.push(s(2)); b.push(s(3)); c.advance(8)
    expect(out.map((x) => x.length)).toEqual([1, 2])
  })
  it("flush hands over at once and cancels the timer; pushAll keeps order", () => {
    const c = clock()
    const out: PenSample[][] = []
    const b = new SampleBatcher((x) => out.push(x), 8, c.schedule, c.cancel)
    b.pushAll([s(1), s(2)])
    expect(b.size).toBe(2)
    b.flush()
    expect(out).toHaveLength(1)
    expect(c.pending()).toBe(0)
    expect(b.size).toBe(0)
  })
  it("dispose drops what is pending, refuses more, and reopen takes samples again", () => {
    const c = clock()
    const out: PenSample[][] = []
    const b = new SampleBatcher((x) => out.push(x), 8, c.schedule, c.cancel)
    b.push(s(1))
    b.dispose()
    c.advance(50)
    b.push(s(2))
    c.advance(50)
    expect(out).toHaveLength(0)
    b.reopen()
    b.push(s(3)); c.advance(8)
    expect(out.map((x) => x[0]!.t)).toEqual([3])
  })
  it("a listener that throws does not lose the next batch", () => {
    const c = clock()
    let calls = 0
    const b = new SampleBatcher(() => { calls++; if (calls === 1) throw new Error("boom") }, 8, c.schedule, c.cancel)
    b.push(s(1))
    expect(() => c.advance(8)).toThrow()
    b.push(s(2)); c.advance(8)
    expect(calls).toBe(2)
  })
  it("with the default scheduler the timer is unref'ed (it cannot keep the process alive)", async () => {
    const out: PenSample[][] = []
    const b = new SampleBatcher((x) => out.push(x))
    b.push(s(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(out).toHaveLength(1)
  })
})

describe("leaveSample", () => {
  it("is the last position with nothing pressed and not in range", () => {
    const last = s(10, { x: 0.3, y: 0.7, p: 0.8, tip: true, lower: true, upper: true, eraser: true, tiltX: 12, tiltY: -3 })
    expect(leaveSample(last, 20)).toEqual({ ...last, t: 20, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: false })
  })
  it("has no tilt keys when the pen had none", () => {
    expect(Object.keys(leaveSample(s(1), 2))).not.toContain("tiltX")
  })
})

describe("VisitTracker", () => {
  it("opens a visit on the first in-range sample and passes it on", () => {
    const v = new VisitTracker()
    expect(v.inRange).toBe(false)
    const a = s(0)
    expect(v.observe(a, 0)).toBe(a)
    expect(v.inRange).toBe(true)
    expect(v.visits).toBe(1)
    expect(v.lastSample).toBe(a)
  })
  it("drops an out-of-range sample when no visit is open, passes the first one that closes a visit, drops the second", () => {
    const v = new VisitTracker()
    expect(v.observe(s(0, { inRange: false }), 0)).toBeNull()
    v.observe(s(1), 1)
    const out = s(2, { inRange: false })
    expect(v.observe(out, 2)).toBe(out)
    expect(v.inRange).toBe(false)
    expect(v.observe(s(3, { inRange: false }), 3)).toBeNull() // exactly ONE leave per visit
  })
  it("counts visits", () => {
    const v = new VisitTracker()
    for (let i = 0; i < 3; i++) { v.observe(s(i * 10), i * 10); v.observe(s(i * 10 + 1, { inRange: false }), i * 10 + 1) }
    expect(v.visits).toBe(3)
  })
  it("a still pen hovering for less than LEAVE_HOVER_MS is NOT lifted (the spike's fixed 120 ms would have)", () => {
    const v = new VisitTracker()
    v.observe(s(0), 0)
    expect(v.tick(LIVENESS.LEAVE_HOVER_MS - 1)).toBeNull()
    expect(v.inRange).toBe(true)
    const leave = v.tick(LIVENESS.LEAVE_HOVER_MS)
    expect(leave).toMatchObject({ inRange: false, t: LIVENESS.LEAVE_HOVER_MS })
    expect(v.inRange).toBe(false)
    expect(v.tick(LIVENESS.LEAVE_HOVER_MS + 10_000)).toBeNull() // once
  })
  it("a still pen in CONTACT is held for LEAVE_CONTACT_MS (a stroke must not be cut by a pause)", () => {
    const v = new VisitTracker()
    v.observe(s(0, { tip: true, p: 0.4 }), 0)
    expect(v.tick(LIVENESS.LEAVE_HOVER_MS + 100)).toBeNull()
    expect(v.tick(LIVENESS.LEAVE_CONTACT_MS - 1)).toBeNull()
    const leave = v.tick(LIVENESS.LEAVE_CONTACT_MS)!
    expect(leave).toMatchObject({ inRange: false, tip: false, p: 0, x: 0.5 })
  })
  it("each sample restarts the silence", () => {
    const v = new VisitTracker()
    v.observe(s(0), 0)
    v.observe(s(500), 500)
    expect(v.tick(LIVENESS.LEAVE_HOVER_MS + 400)).toBeNull()
    expect(v.tick(500 + LIVENESS.LEAVE_HOVER_MS)).not.toBeNull()
  })
  it("the driver's proximity signal: 'in' replaces the timeouts by the long safety net, 'out' ends the visit now with the last position", () => {
    const v = new VisitTracker()
    v.observe(s(0, { x: 0.2 }), 0)
    expect(v.proximity(true, 1)).toBeNull()
    expect(v.authoritative).toBe(true)
    expect(v.tick(LIVENESS.LEAVE_HOVER_MS * 5)).toBeNull() // ordinary timeouts are off
    expect(v.tick(14_999)).toBeNull()
    expect(v.tick(15_000)).not.toBeNull() // the safety net: a signal that never says 'left' cannot keep a pen in range forever
  })
  it("authoritative out: the leave sample at the last place, then nothing more", () => {
    const v = new VisitTracker()
    v.observe(s(0, { x: 0.2, tip: true, p: 0.5 }), 0)
    v.proximity(true, 1)
    const leave = v.proximity(false, 50)
    expect(leave).toMatchObject({ x: 0.2, inRange: false, tip: false, t: 50 })
    expect(v.proximity(false, 60)).toBeNull()
    expect(v.authoritative).toBe(false)
  })
  it("the safety net in contact is 60 s", () => {
    const v = new VisitTracker()
    v.observe(s(0, { tip: true }), 0)
    v.proximity(true, 0)
    expect(v.tick(59_999)).toBeNull()
    expect(v.tick(60_000)).not.toBeNull()
  })
  it("options replace the numbers", () => {
    const v = new VisitTracker({ hoverMs: 50, contactMs: 100, authoritativeHoverMs: 200, authoritativeContactMs: 400 })
    v.observe(s(0), 0)
    expect(v.tick(50)).not.toBeNull()
    v.observe(s(1000, { tip: true }), 1000)
    expect(v.tick(1099)).toBeNull()
    expect(v.tick(1100)).not.toBeNull()
    v.observe(s(2000), 2000); v.proximity(true, 2000)
    expect(v.tick(2199)).toBeNull()
    expect(v.tick(2200)).not.toBeNull()
  })
  it("end() closes an open visit (the source is going away) and is quiet when none is open", () => {
    const v = new VisitTracker()
    expect(v.end(5)).toBeNull()
    v.observe(s(0), 0)
    expect(v.end(5)).toMatchObject({ inRange: false, t: 5 })
    expect(v.end(6)).toBeNull()
  })
  it("nextDeadline says when tick could end the visit", () => {
    const v = new VisitTracker()
    expect(v.nextDeadline(0)).toBeNull()
    v.observe(s(100), 100)
    expect(v.nextDeadline(100)).toBe(LIVENESS.LEAVE_HOVER_MS)
    expect(v.nextDeadline(100 + LIVENESS.LEAVE_HOVER_MS + 50)).toBe(0)
    v.observe(s(200, { tip: true }), 200)
    expect(v.nextDeadline(200)).toBe(LIVENESS.LEAVE_CONTACT_MS)
  })
  it("reset forgets the visit without producing a sample", () => {
    const v = new VisitTracker()
    v.observe(s(0), 0)
    v.reset()
    expect(v.inRange).toBe(false)
    expect(v.tick(100_000)).toBeNull()
  })
})

describe("RateMeter", () => {
  it("measures the rate over the last 2 s of flow", () => {
    const m = new RateMeter()
    for (let i = 0; i <= 100; i++) m.push(1000 + i * 10) // 100 Hz for 1 s
    expect(m.rateHz(2000)).toBe(100)
  })
  it("is null when idle (nothing for 1.5 s) or with fewer than two samples", () => {
    const m = new RateMeter()
    expect(m.rateHz(0)).toBeNull()
    m.push(0)
    expect(m.rateHz(10)).toBeNull()
    m.push(10)
    expect(m.rateHz(20)).not.toBeNull()
    expect(m.rateHz(2000)).toBeNull()
  })
  it("forgets samples older than the window", () => {
    const m = new RateMeter(2000)
    for (let i = 0; i < 100; i++) m.push(i * 100) // 10 Hz for 10 s
    expect(m.rateHz(9900)).toBe(10)
  })
  it("p95 of the gaps needs ten gaps, and a pause is not a gap of the flow", () => {
    const m = new RateMeter()
    for (let i = 0; i < 8; i++) m.push(i * 10)
    expect(m.gapP95Ms()).toBeNull()
    for (let i = 8; i < 60; i++) m.push(i * 10)
    expect(m.gapP95Ms()).toBe(10)
    m.push(60 * 10 + 5000) // the pen stopped for 5 s: not part of the flow
    expect(m.gapP95Ms()).toBe(10)
  })
  it("the 95th percentile follows the slow tail", () => {
    const m = new RateMeter()
    let t = 0
    for (let i = 0; i < 100; i++) { t += i % 10 === 0 ? 40 : 10; m.push(t) }
    expect(m.gapP95Ms()).toBe(40)
  })
  it("reset clears everything", () => {
    const m = new RateMeter()
    for (let i = 0; i < 30; i++) m.push(i * 10)
    m.reset()
    expect(m.rateHz(300)).toBeNull()
    expect(m.gapP95Ms()).toBeNull()
  })
})
