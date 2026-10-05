/**
 * The page's gate (renderer/penGate.ts): the pen's own DOM events are IGNORED while the native feed is live over the sheet and HONOURED when it
 * is not (no Wintab, the pen out of Wintab's range, capture off, a release); a DOM contact already down is never cut; the mouse echo rule;
 * self-opening. No DOM: the window is a fake target.
 */
import { describe, expect, it } from "vitest"
import { ECHO_MS, SELF_OPEN_ERRORS, createGate, type GateEvent } from "../src/renderer/penGate"

function rig() {
  const listeners = new Map<string, (e: GateEvent) => void>()
  let now = 10_000
  const classes: Record<string, boolean> = {}
  const gate = createGate({
    target: {
      addEventListener: (t, l) => { listeners.set(t, l) },
      removeEventListener: (t) => { listeners.delete(t) },
    },
    now: () => now,
    root: { classList: { toggle: (n: string, f?: boolean) => { classes[n] = !!f } } },
  })
  gate.install()
  gate.setState({ available: true, enabled: true, sheetShowing: true, opened: true, released: false })
  const ev = (type: string, pointerType: string, buttons = 0): GateEvent & { stopped: boolean; prevented: boolean } => {
    const e = {
      type, pointerType, buttons, cancelable: true, stopped: false, prevented: false,
      stopImmediatePropagation() { e.stopped = true }, preventDefault() { e.prevented = true },
    }
    return e
  }
  const fire = (type: string, pointerType: string, buttons = 0) => {
    const e = ev(type, pointerType, buttons)
    listeners.get(type)?.(e)
    return e
  }
  return { gate, fire, classes, advance: (ms: number) => { now += ms } }
}

describe("DOM pen events: ignored while the feed is live, honoured when it stops", () => {
  it("nothing is swallowed while the native feed is not live (no Wintab: the window pen works as it always did)", () => {
    const r = rig()
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointerover", "pointerout"]) expect(r.fire(t, "pen", t === "pointermove" ? 0 : 1).stopped).toBe(false)
    expect(r.gate.captureOn()).toBe(false)
    expect(r.classes["pen-capture"]).toBeFalsy()
  })

  it("while the feed is live every DOM pen event is swallowed (and a non-move is prevented too)", () => {
    const r = rig()
    r.gate.setState({ nativeLive: true })
    expect(r.gate.captureOn()).toBe(true)
    expect(r.classes["pen-capture"]).toBe(true)
    const down = r.fire("pointerdown", "pen", 1), move = r.fire("pointermove", "pen", 1)
    expect(down.stopped && down.prevented).toBe(true)
    expect(move.stopped).toBe(true)
    expect(move.prevented).toBe(false)
  })

  it("the synthetic events the feed dispatches pass (they run inside emit)", () => {
    const r = rig()
    r.gate.setState({ nativeLive: true })
    const passed = r.gate.emit(() => r.fire("pointerdown", "pen", 1))
    expect(passed.stopped).toBe(false)
  })

  it("honoured again the moment the feed stops: out of range, capture off, a release, the sheet closing", () => {
    for (const patch of [{ nativeLive: false }, { enabled: false }, { released: true }, { sheetShowing: false }, { opened: false }]) {
      const r = rig()
      r.gate.setState({ nativeLive: true })
      expect(r.fire("pointermove", "pen").stopped).toBe(true)
      r.gate.setState(patch)
      expect(r.gate.captureOn()).toBe(false)
      expect(r.fire("pointermove", "pen").stopped).toBe(false)
      expect(r.classes["pen-capture"]).toBe(false)
    }
  })

  it("mouse and touch are never swallowed by the pen rule", () => {
    const r = rig()
    r.gate.setState({ nativeLive: true })
    expect(r.fire("pointerdown", "mouse", 1).stopped).toBe(false)
    expect(r.fire("pointerdown", "touch", 1).stopped).toBe(false)
  })
})

describe("a real DOM contact is never cut", () => {
  it("is tracked from pointerdown to pointerup so the feed can wait", () => {
    const r = rig()
    expect(r.gate.domContact()).toBe(false)
    r.fire("pointerdown", "pen", 1)
    expect(r.gate.domContact()).toBe(true)
    r.fire("pointermove", "pen", 1)
    expect(r.gate.domContact()).toBe(true)
    r.fire("pointerup", "pen", 0)
    expect(r.gate.domContact()).toBe(false)
  })
  it("a side button held in the air counts as a contact too", () => {
    const r = rig()
    r.fire("pointerdown", "pen", 2)
    expect(r.gate.domContact()).toBe(true)
    r.fire("pointermove", "pen", 0)
    expect(r.gate.domContact()).toBe(false)
  })
})

describe("the echo rule", () => {
  it("a mouse event right after a pen tip is the pen's own echo: swallowed while the feed is live", () => {
    const r = rig()
    r.gate.setState({ nativeLive: true })
    r.gate.noteTip()
    expect(r.fire("pointerdown", "mouse", 1).stopped).toBe(true)
    r.advance(ECHO_MS + 1)
    expect(r.fire("pointerdown", "mouse", 1).stopped).toBe(false)
  })
  it("not when the feed is not live", () => {
    const r = rig()
    r.gate.noteTip()
    expect(r.fire("pointerdown", "mouse", 1).stopped).toBe(false)
  })
})

describe("self-opening", () => {
  it("five throws in a second give the pen back until capture is switched on again", () => {
    const r = rig()
    r.gate.setState({ nativeLive: true })
    let reason: string | null = null
    r.gate.onSelfOpen((why) => { reason = why })
    for (let i = 0; i < SELF_OPEN_ERRORS; i++) r.gate.noteError(new Error("boom"))
    expect(reason).toContain("threw")
    expect(r.gate.captureOn()).toBe(false)
    expect(r.fire("pointermove", "pen").stopped).toBe(false)
    r.gate.reset()
    expect(r.gate.captureOn()).toBe(true)
  })
})
