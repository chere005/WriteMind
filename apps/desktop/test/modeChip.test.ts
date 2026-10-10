// renderer/modeChip.ts: what the footer's chip and the page's chip say about the pen, and when Escape puts it down
// (docs/PLAN-bars-2026-10.md, P6: "Pen · 3 px / Eraser / Select tool / Placing: Rectangle"; "Pen · 3 px · Esc to stop").
import { describe, expect, it } from "vitest"
import { chipLine, escapeStops, modeChip, widthText, type ModeFacts } from "../src/renderer/modeChip"

const off: ModeFacts = { pen: false, penWidth: 3, eraser: false, selectTool: false, placing: null }

describe("the mode chip", () => {
  it("says nothing while the pane is the notebook's", () => {
    expect(modeChip(off)).toBeNull()
  })

  it("the pen names its width, and says how to stop", () => {
    const chip = modeChip({ ...off, pen: true })!
    expect(chip).toEqual({ kind: "pen", text: "Pen · 3 px", hint: "Esc to stop" })
    expect(chipLine(chip)).toBe("Pen · 3 px · Esc to stop")
  })

  it("a width is said as a person says it", () => {
    expect(widthText(3)).toBe("3 px")
    expect(widthText(2.5)).toBe("2.5 px")
    expect(widthText(2.50001)).toBe("2.5 px")
    expect(widthText(12)).toBe("12 px")
    expect(modeChip({ ...off, pen: true, penWidth: 1.25 })!.text).toBe("Pen · 1.3 px")
  })

  it("the Eraser and the Select tool outrank the pen they are used with", () => {
    expect(modeChip({ ...off, pen: true, eraser: true })).toMatchObject({ kind: "eraser", text: "Eraser" })
    expect(modeChip({ ...off, pen: true, selectTool: true })).toMatchObject({ kind: "select", text: "Select tool" })
    // A tool on with the pen up (Alt+Ctrl+2 on the notes) is still said.
    expect(modeChip({ ...off, eraser: true })).toMatchObject({ kind: "eraser" })
  })

  it("an armed shape says what the next click puts down, and is cancelled rather than stopped", () => {
    expect(modeChip({ ...off, placing: { kind: "shape", shape: "rectangle" } })).toEqual({ kind: "placing", text: "Placing: Rectangle", hint: "Esc to cancel" })
    expect(modeChip({ ...off, placing: { kind: "shape", shape: "roundedRectangle" } })!.text).toBe("Placing: Rounded Rectangle")
    expect(modeChip({ ...off, placing: { kind: "shape", shape: "text" } })!.text).toBe("Placing: Text Box")
    expect(modeChip({ ...off, placing: { kind: "line", start: "none", end: "arrow" } })!.text).toBe("Placing: Arrow")
    expect(modeChip({ ...off, placing: { kind: "line", start: "none", end: "none" } })!.text).toBe("Placing: Line")
    // A placement outranks everything: the page says what the NEXT click does.
    expect(modeChip({ ...off, pen: true, eraser: true, placing: { kind: "shape", shape: "oval" } })!.kind).toBe("placing")
  })
})

describe("Escape puts the pen down", () => {
  const press = { handled: false, elsewhere: false, on: true }
  it("when it is on and nobody else wanted the press", () => {
    expect(escapeStops(press)).toBe(true)
  })
  it("never when nothing is on (Escape in a plain note is the note's)", () => {
    expect(escapeStops({ ...press, on: false })).toBe(false)
  })
  it("never when a menu, a dialog or the layer's own pick already used it: one Escape is one thing", () => {
    expect(escapeStops({ ...press, handled: true })).toBe(false)
  })
  it("never from a field or another pane (the camera's own Escape lets go of its box)", () => {
    expect(escapeStops({ ...press, elsewhere: true })).toBe(false)
  })
})
