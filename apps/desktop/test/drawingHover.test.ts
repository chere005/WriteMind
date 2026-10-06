/**
 * What a click would take, shown before the click (renderer/drawingHover.ts, 2026-10-06; docs/TODO.md "Drawing
 * polish"). Transcribed from the Mac's DrawingCanvas.swift rules (it has no XCTest for them): only the cursor mode
 * hovers (`guard mode == .cursor else { hovered = nil }`), the selection wins over the hover (`chromeIDs`), and a hovered
 * picture gets its outline but not its buttons (`handleIDs`: `item.image == nil`). The port adds what its own presses
 * do: the Select tool picks too, a tablet pen that always draws does not, nor does the eraser or Ctrl (the marquee).
 */

import { describe, expect, it } from "vitest"
import { noTransform, type CanvasItem } from "@writemind/core"
import { hoverHandles, hoverWanted, sameHover } from "../src/renderer/drawingHover"

const base = {
  mode: "cursor" as const, pen: false, penDraws: true, selectTool: false, eraser: false, command: false, buttons: 0, busy: false,
}

describe("where hovering shows what a click would take", () => {
  it("the mouse with the pen up: yes", () => {
    expect(hoverWanted(base)).toBe(true)
  })

  it("under the pen, nothing hovers (a press draws there)", () => {
    expect(hoverWanted({ ...base, mode: "pen" })).toBe(false)
  })

  it("a tablet pen that always draws: no; one set not to: yes, as the mouse", () => {
    expect(hoverWanted({ ...base, pen: true })).toBe(false)
    expect(hoverWanted({ ...base, pen: true, penDraws: false })).toBe(true)
  })

  it("the Select tool picks with any pointer, under the pen too", () => {
    expect(hoverWanted({ ...base, mode: "pen", pen: true, selectTool: true })).toBe(true)
  })

  it("never with the eraser, Ctrl (the marquee), a button held, or anything under way (a pick, a gesture, a tool)", () => {
    expect(hoverWanted({ ...base, eraser: true })).toBe(false)
    expect(hoverWanted({ ...base, selectTool: true, eraser: true })).toBe(false)
    expect(hoverWanted({ ...base, command: true })).toBe(false)
    expect(hoverWanted({ ...base, buttons: 1 })).toBe(false)
    expect(hoverWanted({ ...base, busy: true })).toBe(false)
  })
})

describe("what a hovered object shows", () => {
  const picture: CanvasItem = {
    kind: "image",
    image: { id: "p", file: "a.png", center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 1, transform: noTransform(), hidden: false, group: null },
  }
  const stroke: CanvasItem = {
    kind: "stroke",
    stroke: { id: "s", colorHex: "#000000", width: 2, points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }], transform: noTransform(), group: null },
  }
  it("a picture its outline only; anything else its handles too", () => {
    expect(hoverHandles(picture)).toBe(false)
    expect(hoverHandles(stroke)).toBe(true)
  })

  it("the same object on the same surface is the same hover (no render per pointer move)", () => {
    expect(sameHover({ on: null, id: "s" }, { on: null, id: "s" })).toBe(true)
    expect(sameHover({ on: null, id: "s" }, { on: "cell", id: "s" })).toBe(false)
    expect(sameHover(null, null)).toBe(true)
    expect(sameHover({ on: null, id: "s" }, null)).toBe(false)
  })
})
