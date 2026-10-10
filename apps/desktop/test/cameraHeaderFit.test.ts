/**
 * How much of the camera's 36px header fits (renderer/cameraHeaderFit.ts): a pure function of the pane's width. The
 * pane is 280px at its narrowest (chrome.css `.camera { min-width: 280px }`), and the header never wraps or clips.
 * Port-only: the plan's ladder (docs/PLAN-bars-2026-10.md P4) has no Swift twin.
 */

import { describe, expect, it } from "vitest"
import { headerFit, headerWidth } from "../src/renderer/cameraHeaderFit"

const MIN = 280

describe("the camera header's fit ladder", () => {
  it("the 280px minimum always fits, with icons for the three takes", () => {
    for (const zoomed of [false, true]) for (const backToNotes of [false, true]) {
      const fit = headerFit({ width: MIN, zoomed, backToNotes: false })
      expect(headerWidth(fit.words, fit.readout, false), `zoomed ${zoomed}`).toBeLessThanOrEqual(MIN)
      expect(backToNotes || fit.words === false).toBe(true)
    }
  })
  it("at the wireframe's 438px everything fits, with words, and the zoom reads out", () => {
    expect(headerFit({ width: 438, zoomed: false, backToNotes: false })).toEqual({ words: true, readout: false })
    expect(headerFit({ width: 438, zoomed: true, backToNotes: false })).toEqual({ words: true, readout: true })
  })
  it("the readout folds first, the words second", () => {
    const wide = headerWidth(true, true, false)
    expect(headerFit({ width: wide, zoomed: true, backToNotes: false })).toEqual({ words: true, readout: true })
    expect(headerFit({ width: wide - 1, zoomed: true, backToNotes: false })).toEqual({ words: true, readout: false })
    const words = headerWidth(true, false, false)
    expect(headerFit({ width: words - 1, zoomed: false, backToNotes: false }).words).toBe(false)
  })
  it("never asks for more than there is, at any width from 280 up", () => {
    for (let width = MIN; width <= 900; width += 7) for (const zoomed of [false, true]) {
      const fit = headerFit({ width, zoomed, backToNotes: false })
      expect(headerWidth(fit.words, fit.readout, false), `${width}`).toBeLessThanOrEqual(width)
      // a wider pane never shows less overall (words are worth more than the readout, so one may trade for the other)
      const wider = headerFit({ width: width + 7, zoomed, backToNotes: false })
      expect(headerWidth(wider.words, wider.readout, false)).toBeGreaterThanOrEqual(headerWidth(fit.words, fit.readout, false))
    }
  })
  it("the readout only appears while zoomed", () => {
    expect(headerFit({ width: 900, zoomed: false, backToNotes: false }).readout).toBe(false)
  })
  it("the labelled way back costs room (it only shows in a video-only window, which is wide)", () => {
    expect(headerWidth(true, false, true)).toBeGreaterThan(headerWidth(true, false, false))
    expect(headerFit({ width: 1000, zoomed: true, backToNotes: true })).toEqual({ words: true, readout: true })
  })
})
