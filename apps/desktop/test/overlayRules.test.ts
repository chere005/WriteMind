// renderer/overlayRules.ts: what a dialog does with Tab and Escape, and where a popover may sit (docs/PLAN-bars-2026-10.md P6).
import { describe, expect, it } from "vitest"
import { ModalStack, clampIntoViewport, tabTarget } from "../src/renderer/overlayRules"

describe("Tab inside a dialog", () => {
  it("wraps from the last stop to the first, and from the first back to the last with Shift", () => {
    expect(tabTarget(3, 2, false)).toBe(0)
    expect(tabTarget(3, 0, true)).toBe(2)
  })
  it("leaves a press from the middle to the browser", () => {
    expect(tabTarget(3, 1, false)).toBeNull()
    expect(tabTarget(3, 1, true)).toBeNull()
    expect(tabTarget(3, 0, false)).toBeNull()
    expect(tabTarget(3, 2, true)).toBeNull()
  })
  it("a press from outside the dialog comes in at the near end", () => {
    expect(tabTarget(3, -1, false)).toBe(0)
    expect(tabTarget(3, -1, true)).toBe(2)
    expect(tabTarget(3, 9, false)).toBe(0)
  })
  it("one stop: Tab stays on it both ways; none: nothing to do", () => {
    expect(tabTarget(1, 0, false)).toBe(0)
    expect(tabTarget(1, 0, true)).toBe(0)
    expect(tabTarget(0, -1, false)).toBeNull()
  })
})

describe("a popover stays inside the window", () => {
  const view = { width: 1000, height: 700 }
  it("moves nothing that already fits", () => {
    expect(clampIntoViewport({ left: 100, top: 100, width: 200, height: 300 }, view)).toEqual({ dx: 0, dy: 0 })
  })
  it("pulls one that runs off the right or the bottom back to the margin", () => {
    expect(clampIntoViewport({ left: 900, top: 100, width: 200, height: 300 }, view)).toEqual({ dx: -108, dy: 0 })
    expect(clampIntoViewport({ left: 100, top: 600, width: 200, height: 300 }, view)).toEqual({ dx: 0, dy: -208 })
  })
  it("pushes one that starts off the left or the top in", () => {
    expect(clampIntoViewport({ left: -40, top: -5, width: 200, height: 300 }, view)).toEqual({ dx: 48, dy: 13 })
  })
  it("a box bigger than the window is pinned to the top-left margin", () => {
    expect(clampIntoViewport({ left: 300, top: 50, width: 1200, height: 900 }, view)).toEqual({ dx: -292, dy: -42 })
  })
})

describe("the dialogs that are up", () => {
  it("only the newest is on top, and the one under it is again when it goes", () => {
    const stack = new ModalStack()
    const keys = Symbol("keys"), update = Symbol("update")
    stack.push(keys)
    expect(stack.isTop(keys)).toBe(true)
    stack.push(update)
    expect(stack.isTop(keys)).toBe(false)
    expect(stack.isTop(update)).toBe(true)
    stack.remove(update)
    expect(stack.isTop(keys)).toBe(true)
    stack.remove(keys)
    expect(stack.size).toBe(0)
    expect(stack.isTop(keys)).toBe(false)
  })
  it("pushing the same dialog twice does not stack it twice", () => {
    const stack = new ModalStack()
    const one = Symbol("one")
    stack.push(one); stack.push(one)
    expect(stack.size).toBe(1)
  })
})
