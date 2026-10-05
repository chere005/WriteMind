// The pen sink's SHELL (main/pen/overlay.ts) against a fake window, and the overlay backend that counts what the sink swallows.
import { describe, expect, it } from "vitest"
import type { Box, DomPenReport, PenSample } from "../../src/shared/pen"
import { overlayBounds } from "../../src/shared/grab"
import {
  makeOverlayBackend, makeSink, reportsToSamples, SINK_BEAT_TIMEOUT_MS, SINK_POLL_MS, SINK_RETRY_MS,
  type SinkChannels, type SinkHooks, type SinkWindow,
} from "../../src/main/pen/overlay"
import type { Sink, SinkDeps } from "../../src/main/pen/types"

const DISPLAY: Box = { x: 0, y: 0, width: 1920, height: 1200 }

class FakeWin implements SinkWindow {
  bounds: Box
  visible = false
  hit = false
  destroyed = false
  hits: boolean[] = []
  keepAlives = 0
  boundsCalls = 0
  constructor(b: Box) { this.bounds = b }
  setBounds(b: Box) { this.boundsCalls++; this.bounds = b }
  getBounds() { return this.bounds }
  show() { this.visible = true }
  hide() { this.visible = false }
  setHitTest(on: boolean) { this.hit = on; this.hits.push(on) }
  hitTesting() { return this.hit }
  keepAlive() { this.keepAlives++ }
  destroy() { this.destroyed = true; this.visible = false; this.hit = false }
  isDestroyed() { return this.destroyed }
}

function rig(opts: { e2e?: boolean; makeNull?: boolean; makeThrows?: boolean } = {}) {
  let t = 5_000
  let front = true
  let display: Box | null = DISPLAY
  const timers: { ms: number; fn: () => void; live: boolean; at: number }[] = []
  const wins: FakeWin[] = []
  const chans: SinkChannels[] = []
  const logs: string[] = []
  const hooks: SinkHooks = {
    now: () => t,
    every: (ms, fn) => { const h = { ms, fn, live: true, at: t }; timers.push(h); return () => { h.live = false } },
    displayBounds: () => display,
    notesInFront: () => front,
    makeWindow: (_d, ch, b) => {
      if (opts.makeThrows) throw new Error("no gpu")
      if (opts.makeNull) return null
      const w = new FakeWin(b)
      wins.push(w)
      chans.push(ch)
      return w
    },
  }
  const deps: SinkDeps & SinkHooks = {
    window: () => null, load: async () => undefined, preload: "p.cjs", e2e: opts.e2e ?? false, log: (l) => logs.push(l), ...hooks,
  }
  const sink = makeSink(deps)
  const advance = (ms: number, step = 50) => {
    const end = t + ms
    while (t < end) {
      t = Math.min(end, t + step)
      for (const h of [...timers]) if (h.live && (t - h.at) % h.ms === 0) h.fn()
    }
  }
  return {
    sink, wins, chans, logs, advance,
    get win() { return wins.at(-1)! },
    get ch() { return chans.at(-1)! },
    setFront: (v: boolean) => { front = v },
    setDisplay: (d: Box | null) => { display = d },
    get now() { return t },
  }
}

const report = (over: Partial<DomPenReport> = {}): DomPenReport => ({ t: 1000, sx: 960, sy: 600, p: 0.5, buttons: 1, inRange: true, ...over })

describe("reportsToSamples", () => {
  it("maps DIP positions to fractions of the display and the button bits to the sample", () => {
    const [s] = reportsToSamples([report({ sx: 480, sy: 300, p: 0.25, buttons: 1 | 2 })], DISPLAY)
    expect(s).toMatchObject({ t: 1000, x: 0.25, y: 0.25, p: 0.25, tip: true, lower: true, upper: false, eraser: false, inRange: true, backend: "overlay" })
  })
  it("uses the display the pen is on, not the window's", () => {
    const [s] = reportsToSamples([report({ sx: 2400, sy: 100 })], { x: 1920, y: 0, width: 1920, height: 1080 })
    expect(s!.x).toBeCloseTo(0.25)
    expect(s!.y).toBeCloseTo(100 / 1080)
  })
  it("barrel 2, eraser and tilt", () => {
    const [s] = reportsToSamples([report({ buttons: 4 | 32, tiltX: 10, tiltY: -20 })], DISPLAY)
    expect(s).toMatchObject({ upper: true, eraser: true, tiltX: 10, tiltY: -20 })
  })
  it("a leave report is not in range and carries no pressure or buttons", () => {
    const [s] = reportsToSamples([report({ inRange: false, p: 0.9, buttons: 1 })], DISPLAY)
    expect(s).toMatchObject({ inRange: false, p: 0, tip: false })
  })
  it("clamps out-of-display points and drops reports with NaN", () => {
    const out = reportsToSamples([report({ sx: -50, sy: 99_999 }), report({ sx: Number.NaN }), report({ p: Number.POSITIVE_INFINITY })], DISPLAY)
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({ x: 0, y: 1 })
  })
  it("keeps order and has no tilt keys when there is no tilt", () => {
    const out = reportsToSamples([report({ t: 1 }), report({ t: 2 })], DISPLAY)
    expect(out.map((s) => s.t)).toEqual([1, 2])
    expect("tiltX" in out[0]!).toBe(false)
  })
})

describe("the sink window", () => {
  it("is not created until it is shown, and then sits at overlayBounds (never the monitor's exact rectangle), click-through", () => {
    const r = rig()
    expect(r.wins.length).toBe(0)
    r.sink.setShown(true)
    expect(r.wins.length).toBe(1)
    expect(r.win.bounds).toEqual(overlayBounds(DISPLAY))
    expect(r.win.bounds.height).toBe(DISPLAY.height - 2)
    expect(r.win.visible).toBe(true)
    expect(r.win.hit).toBe(false)
    expect(r.sink.state()).toMatchObject({ shown: true, on: false })
  })

  it("only a shown window can be turned on, and turning it off is always honoured", () => {
    const r = rig()
    r.sink.setOn(true) // nothing there yet
    expect(r.wins.length).toBe(0)
    r.sink.setShown(true)
    r.sink.setOn(true)
    expect(r.win.hit).toBe(true)
    expect(r.sink.state().on).toBe(true)
    r.sink.setOn(false)
    expect(r.win.hit).toBe(false)
    expect(r.sink.state().on).toBe(false)
  })

  it("hiding turns hit-testing off first", () => {
    const r = rig()
    r.sink.setShown(true)
    r.sink.setOn(true)
    r.sink.setShown(false)
    expect(r.win.hit).toBe(false)
    expect(r.win.visible).toBe(false)
    expect(r.sink.state()).toMatchObject({ shown: false, on: false })
  })

  it("never shows over a window that is not in front", () => {
    const r = rig()
    r.setFront(false)
    r.sink.setShown(true)
    expect(r.wins.length).toBe(0)
    expect(r.sink.state().shown).toBe(false)
  })

  it("under E2E it does not care whether the notes window is in front", () => {
    const r = rig({ e2e: true })
    r.setFront(false)
    r.sink.setShown(true)
    expect(r.win.visible).toBe(true)
    r.advance(1000)
    r.ch.beat()
    expect(r.win.visible).toBe(true)
  })

  it("defence in depth: its own poll hides it and stops hit-testing the moment the notes window is not in front", () => {
    const r = rig()
    r.sink.setShown(true)
    r.sink.setOn(true)
    r.setFront(false)
    r.advance(SINK_POLL_MS + 50)
    expect(r.win.hit).toBe(false)
    expect(r.win.visible).toBe(false)
    expect(r.sink.state()).toMatchObject({ shown: false, on: false })
  })

  it("follows the notes window to another display", () => {
    const r = rig()
    r.sink.setShown(true)
    const second: Box = { x: 1920, y: 0, width: 2560, height: 1440 }
    r.setDisplay(second)
    r.advance(SINK_POLL_MS + 50)
    expect(r.win.bounds).toEqual(overlayBounds(second))
    r.ch.pen([report({ sx: 1920 + 1280, sy: 720 })])
  })

  it("keeps telling the page its state while shown (the page's dead man)", () => {
    const r = rig()
    r.sink.setShown(true)
    const before = r.win.keepAlives
    r.advance(1000)
    expect(r.win.keepAlives).toBeGreaterThanOrEqual(before + 3)
  })

  it("a page that stops beating is destroyed (even while on), and no window is made again for SINK_RETRY_MS", () => {
    const r = rig()
    r.sink.setShown(true)
    r.sink.setOn(true)
    r.advance(SINK_BEAT_TIMEOUT_MS + 500)
    expect(r.win.destroyed).toBe(true)
    expect(r.win.hit).toBe(false)
    expect(r.sink.state()).toMatchObject({ shown: false, on: false, bounds: null })
    r.sink.setShown(true)
    expect(r.wins.length).toBe(1)
    r.advance(SINK_RETRY_MS)
    r.sink.setShown(true)
    expect(r.wins.length).toBe(2)
  })

  it("beats keep it alive, and pen reports count as a beat", () => {
    const r = rig()
    r.sink.setShown(true)
    for (let i = 0; i < 20; i++) { r.advance(1000); if (i % 2) r.ch.beat(); else r.ch.pen([report()]) }
    expect(r.win.destroyed).toBe(false)
  })

  it("the window or its page going away destroys it and leaves nothing on", () => {
    const r = rig()
    r.sink.setShown(true)
    r.sink.setOn(true)
    r.ch.gone()
    expect(r.win.destroyed).toBe(true)
    expect(r.sink.state()).toMatchObject({ shown: false, on: false })
    r.sink.setOn(true)
    expect(r.win.hit).toBe(false)
  })

  it("a window that cannot be made leaves the sink off, quietly, and is retried later", () => {
    for (const o of [{ makeNull: true }, { makeThrows: true }]) {
      const r = rig(o)
      r.sink.setShown(true)
      expect(r.sink.state()).toMatchObject({ shown: false, on: false })
      r.sink.setOn(true)
      expect(r.sink.state().on).toBe(false)
    }
  })

  it("dispose destroys the window, drops the listeners and refuses everything afterwards", () => {
    const r = rig()
    r.sink.setShown(true)
    r.sink.setOn(true)
    const heard: PenSample[][] = []
    r.sink.onPenSamples((b) => heard.push(b))
    const win = r.win
    r.sink.dispose()
    expect(win.destroyed).toBe(true)
    r.sink.setShown(true)
    expect(r.wins.length).toBe(1)
    r.ch.pen([report()])
    expect(heard.length).toBe(0)
    r.sink.dispose() // idempotent
  })
})

describe("what the sink page reports", () => {
  it("pen reports become screen-frame samples for the listeners and are counted", () => {
    const r = rig()
    r.sink.setShown(true)
    const heard: PenSample[][] = []
    const off = r.sink.onPenSamples((b) => heard.push(b))
    r.ch.pen([report({ sx: 960, sy: 300 }), report({ sx: 961, sy: 301 })])
    expect(heard.length).toBe(1)
    expect(heard[0]!.length).toBe(2)
    expect(heard[0]![0]).toMatchObject({ x: 0.5, y: 0.25, backend: "overlay" })
    expect(r.sink.penEvents()).toBe(2)
    off()
    r.ch.pen([report()])
    expect(heard.length).toBe(1)
    expect(r.sink.penEvents()).toBe(3)
  })

  it("rejects absurd payloads", () => {
    const r = rig()
    r.sink.setShown(true)
    r.ch.pen([])
    r.ch.pen("nope" as unknown as DomPenReport[])
    r.ch.pen(Array.from({ length: 1000 }, () => report()))
    expect(r.sink.penEvents()).toBe(0)
  })

  it("a listener that throws does not break the channel", () => {
    const r = rig()
    r.sink.setShown(true)
    r.sink.onPenSamples(() => { throw new Error("bad listener") })
    const ok: number[] = []
    r.sink.onPenSamples((b) => ok.push(b.length))
    r.ch.pen([report()])
    expect(ok).toEqual([1])
  })

  it("real mouse events are counted and announced; the beat age tracks the page", () => {
    const r = rig()
    r.sink.setShown(true)
    let heard = 0
    r.sink.onMouse(() => heard++)
    r.ch.mouse()
    expect(heard).toBe(1)
    expect(r.sink.mouseEvents()).toBe(1)
    r.advance(1500)
    expect(r.sink.beatAgeMs()).toBeGreaterThanOrEqual(1500)
    r.ch.beat()
    expect(r.sink.beatAgeMs()).toBe(0)
  })

  it("beatAgeMs is null with no window", () => {
    expect(rig().sink.beatAgeMs()).toBeNull()
  })
})

describe("the overlay backend", () => {
  function backendRig(allowed = true, platform = "win32") {
    let t = 10_000
    const l = new Set<(b: PenSample[]) => void>()
    const timers: { ms: number; fn: () => void; live: boolean; at: number }[] = []
    const sink = { onPenSamples: (f: (b: PenSample[]) => void) => { l.add(f); return () => { l.delete(f) } } } as unknown as Sink
    const due: { at: number; fn: () => void; live: boolean }[] = []
    const b = makeOverlayBackend({
      schedule: (fn, ms) => { const h = { at: t + ms, fn, live: true }; due.push(h); return h },
      cancel: (h) => { (h as { live: boolean }).live = false },
      sink, allowed: () => allowed, window: () => null, load: async () => undefined, preload: "", e2e: false, log: () => undefined,
      now: () => t, every: (ms, fn) => { const h = { ms, fn, live: true, at: t }; timers.push(h); return () => { h.live = false } }, platform,
    })
    const emit = (s: PenSample[]) => { for (const f of [...l]) f(s) }
    const advance = (ms: number) => {
      const end = t + ms
      while (t < end) {
        t = Math.min(end, t + 2)
        for (const h of timers) if (h.live && (t - h.at) % h.ms === 0) h.fn()
        for (const h of [...due]) if (h.live && h.at <= t) { h.live = false; h.fn() }
      }
    }
    return { b, emit, advance, listeners: () => l.size, get now() { return t } }
  }
  const s = (t: number, over: Partial<PenSample> = {}): PenSample => ({ t, x: 0.5, y: 0.5, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "overlay", ...over })

  it("is a screen-frame backend named overlay, available only when the sink is allowed, on Windows", () => {
    expect(backendRig().b).toMatchObject({ name: "overlay", frameKind: "screen" })
    expect(backendRig(true).b.available()).toEqual({ ok: true })
    expect(backendRig(false).b.available()).toMatchObject({ ok: false })
    expect(backendRig(true, "linux").b.available()).toMatchObject({ ok: false, reason: expect.stringContaining("Windows") })
  })

  it("start refuses when the sink is not allowed, and subscribes to nothing", async () => {
    const r = backendRig(false)
    expect(await r.b.start({} as never)).toMatchObject({ ok: false, retry: "later" })
    expect(r.listeners()).toBe(0)
    expect(r.b.status().state).toBe("unavailable")
  })

  it("counts the sink's samples and goes live; stop() ends the visit, unsubscribes and goes idle", async () => {
    const r = backendRig()
    const heard: PenSample[] = []
    r.b.onSample((b) => heard.push(...b))
    expect(await r.b.start({} as never)).toEqual({ ok: true, device: null })
    expect(r.b.status().state).toBe("armed")
    for (let i = 0; i < 10; i++) r.emit([s(r.now + i, { x: 0.1 + i * 0.05 })])
    r.advance(50)
    expect(r.b.status().state).toBe("live")
    expect(r.b.status().counters.inRange).toBe(10)
    expect(heard.length).toBeGreaterThanOrEqual(10)
    r.b.stop()
    expect(r.listeners()).toBe(0)
    expect(r.b.status().state).toBe("idle")
    expect(heard.at(-1)?.inRange).toBe(false) // exactly one leave sample
    r.b.stop() // idempotent
  })

  it("a hovering pen that stops reporting ends its visit after LEAVE_HOVER_MS", async () => {
    const r = backendRig()
    const heard: PenSample[] = []
    r.b.onSample((b) => heard.push(...b))
    await r.b.start({} as never)
    r.emit([s(r.now)])
    r.advance(1000)
    expect(heard.filter((x) => !x.inRange).length).toBe(1)
  })
})
