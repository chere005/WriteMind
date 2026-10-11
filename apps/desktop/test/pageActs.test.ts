// What switches the page to the RENDERED one (renderer/pageActs.ts; Sean, 2026-10-10: "switch to rendered mode if bringing in
// text or switching to pen mode on the notebook"): the pen put down on the notebook, "Pen always draws" turned on, and text
// brought in are ACTS; a state never is. Port-only: the Mac has no rendered/markdown mode switch to follow.
import { describe, expect, it } from "vitest"
import { needsRenderedPage, putsPenDown, turnsOnPenDraws } from "../src/renderer/pageActs"
import { nextPenButton, type PenButtonState, type PenPress } from "../src/renderer/penSettings"

const at = (tool: "pen" | "eraser", eraser: boolean, down: boolean): PenButtonState => ({ tool, eraser, down })
const PRESSES: PenPress[] = ["button", "choosePen", "chooseEraser", "keyPen", "keyEraser"]
const press = (now: PenButtonState, how: PenPress) => putsPenDown(how, now, nextPenButton(now, how))

describe("the pen put down on the notebook", () => {
  it("the bar's pen button, with the pen up, puts it down", () => {
    expect(press(at("pen", false, false), "button")).toBe(true)
  })

  it("the menu's Pen puts it down, from the eraser too, and chosen again with the pen already down it is still the act", () => {
    expect(press(at("pen", false, false), "choosePen")).toBe(true)
    expect(press(at("eraser", true, false), "choosePen")).toBe(true)
    expect(press(at("pen", false, true), "choosePen")).toBe(true)
  })

  it("the pen's key (Ctrl/Cmd+Alt+1, the Pen menu's Pen Down, a pen button's double tap) puts it down when it was up", () => {
    expect(press(at("pen", false, false), "keyPen")).toBe(true)
    expect(press(at("eraser", true, false), "keyPen")).toBe(true)
    // with the eraser the tool but off and the pen already down, the key sets the tool to the pen (the pen is what was asked for)
    expect(press(at("eraser", false, true), "keyPen")).toBe(true)
  })

  it("picking the pen UP is not the act, and neither is anything done to the eraser", () => {
    expect(press(at("pen", false, true), "button")).toBe(false)
    expect(press(at("pen", false, true), "keyPen")).toBe(false)
    for (const down of [false, true]) {
      expect(press(at("eraser", false, down), "button")).toBe(false)
      expect(press(at("eraser", true, down), "button")).toBe(false)
      expect(press(at("pen", false, down), "chooseEraser")).toBe(false)
      expect(press(at("eraser", false, down), "keyEraser")).toBe(false)
    }
  })

  it("never for a press that leaves the pen up", () => {
    for (const tool of ["pen", "eraser"] as const) for (const eraser of [false, true]) for (const down of [false, true]) {
      for (const how of PRESSES) {
        const now = at(tool, eraser, down)
        if (!nextPenButton(now, how).down) expect(putsPenDown(how, now, nextPenButton(now, how)), `${tool} ${eraser} ${down} ${how}`).toBe(false)
      }
    }
  })
})

describe("Pen always draws", () => {
  it("turned on is the act; already on, or turned off, is not", () => {
    expect(turnsOnPenDraws(false, true)).toBe(true)
    expect(turnsOnPenDraws(true, true)).toBe(false)
    expect(turnsOnPenDraws(true, false)).toBe(false)
    expect(turnsOnPenDraws(false, false)).toBe(false)
  })
})

describe("whether the page has to be switched", () => {
  it("a note on the markdown page: yes; on the rendered page already, or with no note: no", () => {
    expect(needsRenderedPage(true, false)).toBe(true)
    expect(needsRenderedPage(true, true)).toBe(false)
    expect(needsRenderedPage(false, false)).toBe(false)
    expect(needsRenderedPage(false, true)).toBe(false)
  })
})
