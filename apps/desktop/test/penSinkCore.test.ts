// The pen-sink PAGE's logic (renderer/penSinkCore.ts): reports, the real-mouse rule, and the dead man.
import { describe, expect, it } from "vitest"
import type { DomPenReport } from "../src/shared/pen"
import { SINK_DEAD_MAN_MS } from "../src/shared/penSink"
import { BEAT_MS, ECHO_MS, MOUSE_REPORT_GAP_MS, SinkPageCore, type PtrEvt } from "../src/renderer/penSinkCore"

function rig() {
  let t = 1000
  const pen: DomPenReport[][] = []
  const mouse: number[] = []
  const beats: number[] = []
  const paints: boolean[] = []
  const core = new SinkPageCore({
    timeOrigin: 1_700_000_000_000, now: () => t,
    send: { pen: (r) => pen.push(r), mouse: () => mouse.push(t), beat: () => beats.push(t) },
    paint: (s) => paints.push(s),
  })
  return { core, pen, mouse, beats, paints, advance: (ms: number) => { t += ms }, get now() { return t } }
}
const ev = (over: Partial<PtrEvt> = {}): PtrEvt => ({ type: "pointermove", pointerType: "pen", screenX: 100, screenY: 200, pressure: 0.5, buttons: 1, timeStamp: 50, ...over })

describe("pen events become reports", () => {
  it("one report per event, with the page's clock turned into epoch ms, flushed as one batch", () => {
    const r = rig()
    expect(r.core.onPointer(ev({ timeStamp: 10 }))).toBe(true) // swallowed
    r.core.onPointer(ev({ timeStamp: 20, screenX: 101 }))
    r.core.flush()
    expect(r.pen.length).toBe(1)
    expect(r.pen[0]).toEqual([
      { t: 1_700_000_000_010, sx: 100, sy: 200, p: 0.5, buttons: 1, inRange: true },
      { t: 1_700_000_000_020, sx: 101, sy: 200, p: 0.5, buttons: 1, inRange: true },
    ])
    r.core.flush()
    expect(r.pen.length).toBe(1) // nothing pending: no empty message
  })

  it("coalesced events are each their own report, in order, in place of the event itself", () => {
    const r = rig()
    r.core.onPointer(ev({ timeStamp: 30 }), [ev({ timeStamp: 10, screenX: 1 }), ev({ timeStamp: 20, screenX: 2 }), ev({ timeStamp: 30, screenX: 3 })])
    r.core.flush()
    expect(r.pen[0]!.map((x) => x.sx)).toEqual([1, 2, 3])
  })

  it("leaving is one report that is not in range", () => {
    const r = rig()
    for (const type of ["pointerleave", "pointercancel", "pointerout"]) {
      r.core.onPointer(ev({ type }))
      r.core.flush()
      expect(r.pen.at(-1)).toEqual([expect.objectContaining({ inRange: false, p: 0, buttons: 0 })])
    }
  })

  it("tilt rides along when present", () => {
    const r = rig()
    r.core.onPointer(ev({ tiltX: 5, tiltY: -7 }))
    r.core.flush()
    expect(r.pen[0]![0]).toMatchObject({ tiltX: 5, tiltY: -7 })
  })

  it("never lets the queue grow without bound", () => {
    const r = rig()
    for (let i = 0; i < 5000; i++) r.core.onPointer(ev({ timeStamp: i }))
    r.core.flush()
    expect(r.pen[0]!.length).toBeLessThanOrEqual(512)
    expect(r.pen[0]!.at(-1)!.t).toBe(1_700_000_000_000 + 4999)
  })
})

describe("the page paints itself solid only while it is told 'on'", () => {
  it("starts transparent, solid on 'on', transparent on 'off'", () => {
    const r = rig()
    expect(r.core.isSolid).toBe(false)
    r.core.onState(true)
    expect(r.core.isSolid).toBe(true)
    r.core.onState(false)
    expect(r.core.isSolid).toBe(false)
    expect(r.paints).toEqual([true, false])
  })

  it("a real mouse event paints it transparent AT ONCE, before main has been told, and reports once per gap", () => {
    const r = rig()
    r.core.onState(true)
    r.advance(1000)
    expect(r.core.onPointer(ev({ pointerType: "mouse" }))).toBe(false) // not swallowed by the logic
    expect(r.core.isSolid).toBe(false)
    expect(r.mouse.length).toBe(1)
    r.advance(MOUSE_REPORT_GAP_MS - 10)
    r.core.onPointer(ev({ pointerType: "mouse" }))
    expect(r.mouse.length).toBe(1) // rate limited
    r.advance(20)
    r.core.onPointer(ev({ pointerType: "mouse" }))
    expect(r.mouse.length).toBe(2)
  })

  it("stays transparent after the mouse until main turns it off and on again", () => {
    const r = rig()
    r.core.onState(true)
    r.advance(1000)
    r.core.onPointer(ev({ pointerType: "mouse" }))
    r.core.onState(true) // main keeps saying "on" (a keep-alive that crossed the mouse event)
    expect(r.core.isSolid).toBe(false)
    r.core.onState(false)
    r.core.onState(true)
    expect(r.core.isSolid).toBe(true)
  })

  it("a mouse event right after a pen event is the pen's echo and is ignored", () => {
    const r = rig()
    r.core.onState(true)
    r.core.onPointer(ev())
    r.advance(ECHO_MS - 50)
    r.core.onPointer(ev({ pointerType: "mouse" }))
    expect(r.core.isSolid).toBe(true)
    expect(r.mouse.length).toBe(0)
    expect(r.core.counts.echo).toBe(1)
  })

  it("DEAD MAN: not told for SINK_DEAD_MAN_MS (main is hung) and it paints itself transparent", () => {
    const r = rig()
    r.core.onState(true)
    r.advance(SINK_DEAD_MAN_MS - 100)
    r.core.tick()
    expect(r.core.isSolid).toBe(true)
    r.advance(200)
    r.core.tick()
    expect(r.core.isSolid).toBe(false)
    // a late word from main brings it back
    r.core.onState(true)
    expect(r.core.isSolid).toBe(true)
  })

  it("keep-alives hold it solid indefinitely", () => {
    const r = rig()
    r.core.onState(true)
    for (let i = 0; i < 40; i++) { r.advance(250); r.core.onState(true); r.core.tick() }
    expect(r.core.isSolid).toBe(true)
  })
})

describe("the beat", () => {
  it("goes to main once a second, not on every tick", () => {
    const r = rig()
    for (let i = 0; i < 20; i++) { r.advance(250); r.core.tick() }
    expect(r.beats.length).toBe(5)
    expect(BEAT_MS).toBe(1000)
  })
})
