/**
 * A burst of nudges or colour changes is ONE undo -- and an Undo ends the burst (Drawinglane-fix1).
 *
 * Reported on the real app: place a shape, nudge it (Shift+Right), Ctrl+Z, then nudge twice quickly and Ctrl+Z:
 * the SHAPE disappeared instead of the nudges being taken back. The burst's bookkeeping lived in the canvas and
 * asked only "was the last edit mine, and was it under a second ago?" -- an Undo moves neither answer, so the
 * nudge after it joined a burst whose undo entry the Undo had just taken: it applied with NO entry and left a
 * stale Redo. The bookkeeping is in `DrawingHistory.recordBurst` now, next to the stacks it has to agree with.
 */

import { describe, expect, it } from "vitest"
import { noTransform, type CanvasItem, type Drawing } from "@writemind/core"
import { DrawingHistory } from "../src/renderer/drawingHistory"
import { EditClock } from "../src/renderer/editTimeline"

const shapeAt = (dx: number): CanvasItem => ({
  kind: "shape",
  shape: {
    id: "s", kind: "rectangle", center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 0.5, colorHex: "#000000",
    lineWidth: 2, fillHex: null, label: "", transform: { ...noTransform(), dx }, group: null,
  },
})
const at = (dx: number): Drawing => ({ items: [shapeAt(dx)] })
const empty: Drawing = { items: [] }

/** The canvas's side of it: apply an edit through the history the way `Canvas.burst` does. */
class Layer {
  history = new DrawingHistory(new EditClock())
  drawing: Drawing = empty
  time = 10_000
  place(drawing: Drawing) { this.history.record(this.drawing); this.drawing = drawing }
  nudge(drawing: Drawing, after = 100) {
    this.time += after
    this.history.recordBurst(this.drawing, this.time)
    this.drawing = drawing
  }
  undo() { const back = this.history.undo(this.drawing); if (back) this.drawing = back }
  redo() { const next = this.history.redo(this.drawing); if (next) this.drawing = next }
}

describe("a burst of nudges", () => {
  it("is one undo, however many nudges it holds", () => {
    const layer = new Layer()
    layer.place(at(0))
    layer.nudge(at(0.01)); layer.nudge(at(0.02)); layer.nudge(at(0.03))
    layer.undo()
    expect(layer.drawing).toEqual(at(0))
    layer.undo()
    expect(layer.drawing).toEqual(empty)
  })

  it("is two bursts when there is a pause between them", () => {
    const layer = new Layer()
    layer.place(at(0))
    layer.nudge(at(0.01)); layer.nudge(at(0.02))
    layer.nudge(at(0.03), 2_000); layer.nudge(at(0.04))
    layer.undo()
    expect(layer.drawing).toEqual(at(0.02))
    layer.undo()
    expect(layer.drawing).toEqual(at(0))
  })

  it("ends at an Undo: the nudges after it are a burst of their own, and undo to where they began", () => {
    const layer = new Layer()
    layer.place(at(0))
    layer.nudge(at(0.01))                          // burst A
    layer.undo()                                   // back to at(0): A is taken
    expect(layer.drawing).toEqual(at(0))
    layer.nudge(at(0.02), 300); layer.nudge(at(0.03), 300)   // quick: used to join the burst that was gone
    layer.undo()
    expect(layer.drawing).toEqual(at(0))           // the nudges, not the shape, are what came back
    layer.undo()
    expect(layer.drawing).toEqual(empty)           // and only then the shape
  })

  it("kills the Redo that was waiting, as any new edit does", () => {
    const layer = new Layer()
    layer.place(at(0))
    layer.nudge(at(0.01))
    layer.undo()
    expect(layer.history.canRedo).toBe(true)
    layer.nudge(at(0.05), 200)
    expect(layer.history.canRedo).toBe(false)
  })

  it("ends at a Redo too", () => {
    const layer = new Layer()
    layer.place(at(0))
    layer.nudge(at(0.01))
    layer.undo(); layer.redo()
    expect(layer.drawing).toEqual(at(0.01))
    layer.nudge(at(0.02), 100)
    layer.undo()
    expect(layer.drawing).toEqual(at(0.01))
  })

  it("ends at another edit, on the words' side or the drawing's", () => {
    const layer = new Layer()
    layer.place(at(0))
    layer.nudge(at(0.01))
    layer.history.clock.edit()                     // a word typed
    layer.nudge(at(0.02), 100)
    layer.undo()
    expect(layer.drawing).toEqual(at(0.01))
    const other = new Layer()
    other.place(at(0))
    other.nudge(at(0.01))
    other.place(at(0.5))                           // a paste, a capture: its own entry
    other.nudge(at(0.51), 100)
    other.undo()
    expect(other.drawing).toEqual(at(0.5))
  })

  it("is not carried over by clear()", () => {
    const layer = new Layer()
    layer.place(at(0))
    layer.nudge(at(0.01))
    layer.history.clear()
    layer.nudge(at(0.02), 100)
    expect(layer.history.canUndo).toBe(true)
  })
})
