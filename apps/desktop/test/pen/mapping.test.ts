// main/pen/mapping.ts over a FAKE native layer and a FAKE cursor. Nothing here moves a real pen or a real pointer: the real system context
// (Wintab CXO_SYSTEM on the physical tablet) cannot be tested without a moving pen. What IS proven: when the context opens, how it is verified,
// and that it is closed (stop() called, synchronously) on every way out.
import { describe, expect, it } from "vitest"
import { createMappingController, type MapHandle, type MappingDeps } from "../../src/main/pen/mapping"
import type { Box, SheetReport } from "../../src/shared/pen"

const SHEET: SheetReport = { rect: { x: 100, y: 50, width: 640, height: 400 }, turns: 0 }
const KEY = "wintab:WACOM Tablet:9499x15199"

function rig(over: { scale?: number; available?: boolean; openFails?: boolean; async?: boolean } = {}) {
  let t = 1_000
  let avail = over.available ?? true
  const memory: Record<string, "honoured" | "refused"> = {}
  const log: string[] = []
  const opened: Box[] = []
  const handles: { stops: number; rects: Box[] }[] = []
  let cursor: { x: number; y: number } | null = { x: 0, y: 0 }
  let release: (() => void) | null = null
  const scale = over.scale ?? 1
  const physical = (s: SheetReport): Box => ({ x: s.rect.x * scale, y: s.rect.y * scale, width: s.rect.width * scale, height: s.rect.height * scale })
  const makeHandle = (): MapHandle => {
    const h = { stops: 0, rects: [] as Box[] }
    handles.push(h)
    return { setRect: (r) => { h.rects.push(r) }, stop: () => { h.stops++ } }
  }
  const deps: MappingDeps = {
    available: () => avail,
    open: (rect) => {
      opened.push(rect)
      if (over.openFails) return null
      if (over.async) return new Promise<MapHandle>((resolve) => { release = () => resolve(makeHandle()) })
      return makeHandle()
    },
    cursor: () => cursor,
    physical,
    now: () => t,
    recall: (k) => memory[k] ?? null,
    remember: (k, v) => { if (v) memory[k] = v; else delete memory[k] },
    trace: (name) => { log.push(name) },
  }
  const c = createMappingController(deps)
  let changes = 0
  c.onChange(() => { changes++ })
  const rectNow = (): Box => physical(SHEET)
  /** The pen glides across the sheet; the driver (when `honour`) puts the cursor where the pen is, inside the rectangle. */
  const glide = (n = 60, honour: (u: number, v: number) => { x: number; y: number } | null = (u, v) => ({ x: rectNow().x + u * rectNow().width, y: rectNow().y + v * rectNow().height })): void => {
    for (let i = 0; i < n; i++) {
      t += 8
      const u = 0.1 + (0.8 * i) / n, v = 0.2 + (0.5 * i) / n
      cursor = honour(u, v)
      c.observe(u, v)
    }
  }
  const ready = (): void => { c.setDevice(KEY); c.setSheet(SHEET); c.setWanted(true) }
  return {
    c, deps, memory, log, opened, handles, glide, ready,
    advance: (ms: number) => { t += ms },
    setCursor: (p: { x: number; y: number } | null) => { cursor = p },
    setAvailable: (a: boolean) => { avail = a },
    release: () => release?.(),
    changes: () => changes,
    openStops: () => handles.filter((h) => h.stops === 0).length,
  }
}

describe("when the context opens", () => {
  it("nothing until the device, the sheet, wanted AND the pen in range are all there", () => {
    const r = rig()
    r.c.setSheet(SHEET)
    r.c.setWanted(true)
    r.c.pen(true)
    expect(r.opened).toHaveLength(0) // no device key yet
    r.c.setDevice(KEY)
    r.c.pen(false); r.c.pen(true)
    expect(r.opened).toHaveLength(1)
  })

  it("is opened over the sheet in PHYSICAL pixels (DPI scale applied by the caller's `physical`)", () => {
    const r = rig({ scale: 1.5 })
    r.ready(); r.c.pen(true)
    expect(r.opened).toEqual([{ x: 150, y: 75, width: 960, height: 600 }])
  })

  it("a sheet that is turned is never mapped (the driver cannot turn it)", () => {
    const r = rig()
    r.c.setDevice(KEY); r.c.setWanted(true); r.c.setSheet({ ...SHEET, turns: 1 }); r.c.pen(true)
    expect(r.opened).toHaveLength(0)
  })

  it("no Wintab / koffi: the whole thing is a no-op and says unavailable", () => {
    const r = rig({ available: false })
    r.ready(); r.c.pen(true); r.glide(30)
    expect(r.opened).toHaveLength(0)
    expect(r.c.state()).toBe("unavailable")
  })

  it("a context that cannot be opened is not an error and nothing is remembered", () => {
    const r = rig({ openFails: true })
    r.ready(); r.c.pen(true)
    expect(r.c.state()).toBe("off")
    expect(r.memory).toEqual({})
  })
})

describe("verification: honoured", () => {
  it("a cursor that tracks the pen inside the rectangle is honoured: remembered, kept open, state mapped", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    expect(r.c.state()).toBe("trying")
    r.glide()
    expect(r.memory[KEY]).toBe("honoured")
    expect(r.c.state()).toBe("mapped")
    expect(r.openStops()).toBe(1)
    expect(r.log).toContain("map-honoured")
  })

  it("the second visit trusts the verdict: no trying state, still watched", () => {
    const r = rig()
    r.ready(); r.c.pen(true); r.glide(); r.c.pen(false)
    r.c.pen(true)
    expect(r.opened).toHaveLength(2)
    expect(r.c.state()).toBe("mapped")
  })
})

describe("verification: not honoured", () => {
  it("a cursor that does not follow the pen is refused: closed at once, remembered, not retried on the next visit", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    r.glide(60, () => ({ x: 20, y: 20 })) // the driver ignored the rectangle; the pointer sits elsewhere
    expect(r.memory[KEY]).toBe("refused")
    expect(r.c.state()).toBe("refused")
    expect(r.handles[0]!.stops).toBe(1)
    r.c.pen(false); r.c.pen(true); r.glide(30)
    expect(r.opened).toHaveLength(1) // never retried
  })

  it("a cursor that leaves the rectangle even once is refused", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    r.glide(60, (u, v) => (u > 0.5 ? { x: 2000, y: 900 } : { x: SHEET.rect.x + u * SHEET.rect.width, y: SHEET.rect.y + v * SHEET.rect.height }))
    expect(r.c.state()).toBe("refused")
    expect(r.handles[0]!.stops).toBe(1)
  })

  it("a cursor that cannot be read while verifying is refused (fail closed)", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    r.glide(60, () => null)
    expect(r.c.state()).toBe("refused")
  })

  it("a cursor stuck in one place inside the rectangle does not pass (it must TRACK the pen)", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    r.glide(60, () => ({ x: 400, y: 250 }))
    expect(r.memory[KEY]).not.toBe("honoured")
  })

  it("Retry forgets the verdict and tries again on the next sample", () => {
    const r = rig()
    r.ready(); r.c.pen(true); r.glide(60, () => ({ x: 20, y: 20 }))
    expect(r.c.state()).toBe("refused")
    r.c.retry()
    expect(r.memory[KEY]).toBeUndefined()
    expect(r.opened).toHaveLength(2) // the pen is still in range: it reopens at once
    r.glide()
    expect(r.c.state()).toBe("mapped")
  })

  it("fast strokes give no verdict: after the window the context is closed and nothing is remembered", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    // jumps of 0.5 per sample: every check is skipped (the cursor lags a packet), the pen keeps moving for over 2 s
    for (let i = 0; i < 300; i++) { r.advance(10); r.c.observe(i % 2 ? 0.1 : 0.9, 0.5) }
    expect(r.memory[KEY]).toBeUndefined()
    expect(r.handles[0]!.stops).toBe(1)
    expect(r.log).toContain("map-undecided")
  })
})

describe("watching a mapping that was honoured", () => {
  it("two slow samples in a row with the cursor outside the sheet close it and remember a refusal", () => {
    const r = rig()
    r.ready(); r.c.pen(true); r.glide()
    expect(r.c.state()).toBe("mapped")
    r.glide(60, () => ({ x: 3000, y: 1500 }))
    expect(r.c.state()).toBe("refused")
    expect(r.handles[0]!.stops).toBe(1)
  })

  it("one stray reading is forgiven", () => {
    const r = rig()
    r.ready(); r.c.pen(true); r.glide()
    let n = 0
    r.glide(40, (u, v) => (++n === 5 ? { x: 3000, y: 1500 } : { x: SHEET.rect.x + u * SHEET.rect.width, y: SHEET.rect.y + v * SHEET.rect.height }))
    expect(r.c.state()).toBe("mapped")
  })
})

describe("closed on every way out (stop() is called, synchronously)", () => {
  const open = () => { const r = rig(); r.ready(); r.c.pen(true); return r }
  it("the pen leaving range", () => { const r = open(); r.c.pen(false); expect(r.handles[0]!.stops).toBe(1) })
  it("the window losing focus / the feed not wanted", () => { const r = open(); r.c.setWanted(false); expect(r.handles[0]!.stops).toBe(1) })
  it("the sheet closing", () => { const r = open(); r.c.setSheet(null); expect(r.handles[0]!.stops).toBe(1) })
  it("the sheet being turned", () => { const r = open(); r.c.setSheet({ ...SHEET, turns: 2 }); expect(r.handles[0]!.stops).toBe(1) })
  it("an explicit stop (quit, error, panic)", () => { const r = open(); r.c.stop("quit"); expect(r.handles[0]!.stops).toBe(1) })
  it("the device changing", () => { const r = open(); r.c.setDevice(null); expect(r.handles[0]!.stops).toBe(1) })
  it("stop is idempotent and a later pen visit does not reopen until wanted again", () => {
    const r = open(); r.c.stop("quit"); r.c.stop("quit")
    expect(r.handles[0]!.stops).toBe(1)
    r.c.pen(false); r.c.pen(true)
    expect(r.opened).toHaveLength(1)
    r.c.setWanted(true)
    expect(r.opened).toHaveLength(2) // wanted again: the pen is in range, so it opens
  })
  it("a setRect that throws refuses and closes", () => {
    const r = rig()
    r.deps.open = () => ({ setRect: () => { throw new Error("boom") }, stop: () => { r.handles.push({ stops: 1, rects: [] }) } })
    const c = createMappingController(r.deps)
    c.setDevice(KEY); c.setWanted(true); c.setSheet(SHEET); c.pen(true)
    c.setSheet({ ...SHEET, rect: { ...SHEET.rect, x: 400 } })
    expect(c.state()).toBe("refused")
  })
  it("a context that arrives after the pen has left is closed at once", async () => {
    const r = rig({ async: true })
    r.ready(); r.c.pen(true)
    r.c.pen(false)
    r.release()
    await Promise.resolve(); await Promise.resolve()
    expect(r.handles).toHaveLength(1)
    expect(r.handles[0]!.stops).toBe(1)
  })
})

describe("the sheet moves", () => {
  it("a new rectangle goes to the open context", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    r.c.setSheet({ ...SHEET, rect: { ...SHEET.rect, x: 300 } })
    expect(r.handles[0]!.rects).toEqual([{ x: 300, y: 50, width: 640, height: 400 }])
  })
  it("a change under a pixel is ignored", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    r.c.setSheet({ ...SHEET, rect: { ...SHEET.rect, x: 100.4 } })
    expect(r.handles[0]!.rects).toEqual([])
  })
})

describe("a driver that gives packets only to the topmost context (the overlap rule)", () => {
  it("packets reach the system context but the data feed goes silent: closed at once, remembered as refused, not retried", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    expect(r.handles).toHaveLength(1)
    for (let i = 0; i < 40 && r.c.state() !== "refused"; i++) { r.advance(8); r.c.systemPacket() } // no dataSeen: the data context is starved
    expect(r.c.state()).toBe("refused")
    expect(r.handles[0]!.stops).toBe(1)
    expect(r.memory[KEY]).toBe("refused")
    expect(r.log).toContain("map-refused")
    r.c.pen(false); r.c.pen(true)
    expect(r.opened).toHaveLength(1) // not on every pen visit
  })

  it("a healthy driver (the data feed keeps delivering) is never refused for it, honoured or still being judged", () => {
    for (const honoured of [false, true]) {
      const r = rig()
      if (honoured) r.memory[KEY] = "honoured"
      r.ready(); r.c.pen(true)
      for (let i = 0; i < 100; i++) { r.advance(8); r.c.dataSeen(); r.c.systemPacket() }
      expect(r.handles[0]!.stops).toBe(0)
      expect(r.c.state()).not.toBe("refused")
    }
  })

  it("a still pen sends no packets, so nothing is judged", () => {
    const r = rig()
    r.ready(); r.c.pen(true)
    r.advance(5000)
    expect(r.handles[0]!.stops).toBe(0)
  })
})

describe("pen.log stays quiet", () => {
  it("a remembered, honoured mapping reopens on every pen visit without a line", () => {
    const r = rig()
    r.memory[KEY] = "honoured"
    r.ready()
    for (let i = 0; i < 20; i++) { r.c.pen(true); r.c.pen(false) }
    expect(r.opened).toHaveLength(20)
    expect(r.log).toEqual([])
  })
  it("a mapping still being judged logs one short open and one close per visit", () => {
    const r = rig()
    r.ready(); r.c.pen(true); r.c.pen(false)
    expect(r.log).toEqual(["map-open", "map-closed"])
  })
})
