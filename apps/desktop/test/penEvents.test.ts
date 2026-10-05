import { describe, expect, it } from "vitest"
import { createSynth, maskOf, type SynthEvent } from "../src/shared/penEvents"
import {
  DEFAULT_BUTTONS, holdBegins, inContact, noTap, resolvePress, tapStep,
  type PenAction, type PenButtonMap, type PressLike, type TapState,
} from "../src/renderer/penButtons"
import type { PenSample } from "../src/shared/pen"

const s = (over: Partial<PenSample> = {}): PenSample => ({
  t: 0, x: 0.5, y: 0.5, p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: true, backend: "inject", ...over,
})
const tip = (p = 0.5): Partial<PenSample> => ({ tip: true, p })
const run = (samples: PenSample[]): SynthEvent[] => {
  const synth = createSynth()
  return samples.flatMap((x) => synth.step(x))
}
const types = (events: SynthEvent[]): string[] => events.map((e) => e.type)

describe("the sample to event state machine (design 8.3)", () => {
  it("hover, tip down, move, tip up", () => {
    const events = run([s(), s(tip(0.3)), s(tip(0.6)), s()])
    expect(types(events)).toEqual(["pointerover", "pointerenter", "pointermove", "pointerdown", "pointermove", "pointerup"])
    const down = events.find((e) => e.type === "pointerdown")!
    expect(down).toMatchObject({ button: 0, buttons: 1, pressure: 0.3 })
    expect(events.at(-1)).toMatchObject({ type: "pointerup", button: 0, buttons: 0, pressure: 0 })
  })

  it("a contact with no pressure reads 0.5, as TabletSurface assumes; a hover reads 0", () => {
    const events = run([s(), s({ tip: true, p: 0 })])
    expect(events.find((e) => e.type === "pointerdown")!.pressure).toBe(0.5)
    expect(events[2]!.pressure).toBe(0)
  })

  it("lower pressed in the air then dragged with the tip: down(button 2), move(3), move(2), up(button 2)", () => {
    const events = run([s(), s({ lower: true }), s({ lower: true, ...tip() }), s({ lower: true }), s()])
    const rest = events.filter((e) => e.type !== "pointerover" && e.type !== "pointerenter")
    expect(rest.map((e) => [e.type, e.button, e.buttons])).toEqual([
      ["pointermove", -1, 0], ["pointerdown", 2, 2], ["pointermove", -1, 3], ["pointermove", -1, 2], ["pointerup", 2, 0],
    ])
  })

  it("the upper button is button 1 and bit 4; the eraser end is button 5 and bit 32", () => {
    const up = run([s(), s({ upper: true })]).find((e) => e.type === "pointerdown")!
    expect(up).toMatchObject({ button: 1, buttons: 4 })
    const er = run([s(), s({ eraser: true, ...tip() })]).find((e) => e.type === "pointerdown")!
    expect(er.buttons).toBe(33)
    expect(er.button).toBe(0)
    expect(run([s(), s({ eraser: true })]).find((e) => e.type === "pointerdown")).toMatchObject({ button: 5, buttons: 32 })
  })

  it("leaving range with the tip down closes the stroke first: up, out, leave", () => {
    const events = run([s(), s(tip()), s({ inRange: false })])
    expect(types(events).slice(-3)).toEqual(["pointerup", "pointerout", "pointerleave"])
  })

  it("a second leave sample adds nothing, and reset is a leave that never cancels", () => {
    const synth = createSynth()
    synth.step(s()); synth.step(s(tip()))
    expect(types(synth.reset())).toEqual(["pointerup", "pointerout", "pointerleave"])
    expect(synth.step(s({ inRange: false }))).toEqual([])
    expect(synth.reset()).toEqual([])
    expect(synth.inRange).toBe(false)
    expect(synth.mask).toBe(0)
  })

  it("tilt rides along only when the sample has it", () => {
    const events = run([s({ tiltX: 10, tiltY: -20 }), s()])
    expect(events[0]).toMatchObject({ type: "pointerover", tiltX: 10, tiltY: -20 })
    expect(events.at(-1)!.tiltX).toBeUndefined()
  })

  it("maskOf is the DOM mask", () => {
    expect(maskOf(s({ tip: true, lower: true, upper: true, eraser: true }))).toBe(1 | 2 | 4 | 32)
  })
})

// The real penButtons decide what the synthesised events mean (design appendix A.2). Samples are 8 ms apart.
const press = (e: SynthEvent): PressLike => ({ pointerType: "pen", button: e.button, buttons: e.buttons, pressure: e.pressure })
const phaseOf = (type: string): "down" | "move" | "up" | null =>
  type === "pointerdown" ? "down" : type === "pointermove" ? "move" : type === "pointerup" ? "up" : null

/** `first`: what the first event that STARTS something (a pointerdown, or the touch of a held button) resolves to, past any "ignore". */
function replay(samples: PenSample[], buttons: PenButtonMap): { first: string | null; fired: PenAction[] } {
  let tap: TapState = noTap
  const fired: PenAction[] = []
  let first: string | null = null
  let touching = false
  run(samples).forEach((e, i) => {
    const phase = phaseOf(e.type)
    if (!phase) return
    const was = touching
    touching = phase !== "up" && inContact(press(e))
    if ((first === null || first === "ignore") && (phase === "down" || holdBegins(was, press(e)))) {
      first = resolvePress(press(e), { eraser: false, buttons }).kind
    }
    const step = tapStep(tap, phase, press(e), buttons, i * 8)
    tap = step.state
    if (step.fire) fired.push(step.fire)
  })
  return { first, fired }
}

describe("what the button logic makes of the feed", () => {
  it("a plain stroke draws", () => {
    expect(replay([s(), s(tip()), s(tip()), s()], DEFAULT_BUTTONS)).toEqual({ first: "draw", fired: [] })
  })
  it("the lower button pressed in the air does nothing; held as the pen touches it selects (the default hold)", () => {
    expect(replay([s(), s({ lower: true }), s({ lower: true }), s()], DEFAULT_BUTTONS)).toEqual({ first: "ignore", fired: [] })
    expect(replay([s(), s({ ...tip(), lower: true }), s()], DEFAULT_BUTTONS).first).toBe("select")
  })
  it("the lower button double-tapped in the air is Redo, once; the upper is Undo (DEFAULT_BUTTONS, Sean's way round)", () => {
    const twice = (b: Partial<PenSample>) => [s(), s(b), s(b), s(), s(), s(b), s(b), s()]
    expect(replay(twice({ lower: true }), DEFAULT_BUTTONS).fired).toEqual(["redo"])
    expect(replay(twice({ upper: true }), DEFAULT_BUTTONS).fired).toEqual(["undo"])
    expect(replay([s(), s({ lower: true }), s()], DEFAULT_BUTTONS).fired).toEqual([])
  })
  it("...and not when the tip touches while it is held", () => {
    expect(replay([s(), s(tip()), s({ ...tip(), lower: true }), s(tip()), s(), s({ lower: true }), s()], DEFAULT_BUTTONS).fired).toEqual([])
  })
  it("the upper button held as the pen touches erases", () => {
    expect(replay([s(), s({ upper: true }), s({ upper: true, ...tip() }), s()], DEFAULT_BUTTONS).first).toBe("erase")
  })
  it("the eraser end erases", () => {
    expect(replay([s(), s({ eraser: true, ...tip() }), s()], DEFAULT_BUTTONS).first).toBe("erase")
  })
})
