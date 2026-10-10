/**
 * The inspector over a picked object (renderer/inspectorRules.ts; Sean's wireframe, 2026-10-10): where it stands
 * (above the object, below it when there is no room above, clamped to the pane, never over the object) and which
 * controls a pick has. PORT-ONLY: the Mac has per-kind handle discs and a connector style bar.
 */

import { describe, expect, it } from "vitest"
import { noTransform, type CanvasItem, type Rect, type ShapeKind } from "@writemind/core"
import {
  BAR_GAP, BAR_MARGIN, estimatedWidth, inspectorName, inspectorPlan, inspectorSpot, pointBox, sideAwayFrom, wantsRing,
  type PlanContext,
} from "../src/renderer/inspectorRules"

const PANE = { width: 900, height: 600 }
const BAR = { width: 360, height: 40 }
const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const barBox = (spot: { left: number; top: number }): Rect => ({ x: spot.left, y: spot.top, width: BAR.width, height: BAR.height })

describe("where the bar stands", () => {
  it("above the object, centred on it, with the gap", () => {
    const target: Rect = { x: 300, y: 300, width: 200, height: 100 }
    const spot = inspectorSpot({ target, bar: BAR, pane: PANE })
    expect(spot.side).toBe("above")
    expect(spot.left).toBe(300 + 100 - 180)
    expect(spot.top).toBe(300 - BAR_GAP - BAR.height)
  })

  it("clears what already stands over the object (the rotate handle)", () => {
    const target: Rect = { x: 300, y: 300, width: 200, height: 100 }
    const spot = inspectorSpot({ target, bar: BAR, pane: PANE, reserveAbove: 37 })
    expect(spot.top).toBe(300 - 37 - BAR_GAP - BAR.height)
  })

  it("flips below when there is no room above", () => {
    const target: Rect = { x: 300, y: 30, width: 200, height: 100 }
    const spot = inspectorSpot({ target, bar: BAR, pane: PANE })
    expect(spot.side).toBe("below")
    expect(spot.top).toBe(30 + 100 + BAR_GAP)
    expect(meets(barBox(spot), target)).toBe(false)
  })

  it("flips below only as far as the pane allows; with no room either way it is pinned to the top over a big object", () => {
    const tall: Rect = { x: 300, y: 20, width: 200, height: 580 }
    const spot = inspectorSpot({ target: tall, bar: BAR, pane: PANE })
    expect(spot.side).toBe("over")
    expect(spot.top).toBe(BAR_MARGIN)
  })

  it("an object half scrolled off the top gets its bar under it", () => {
    const spot = inspectorSpot({ target: { x: 300, y: -80, width: 200, height: 200 }, bar: BAR, pane: PANE })
    expect(spot.side).toBe("below")
    expect(spot.top).toBe(-80 + 200 + BAR_GAP)
  })

  it("clamped to the pane on both sides, and left first when the pane is narrower than the bar", () => {
    const left = inspectorSpot({ target: { x: 0, y: 300, width: 40, height: 40 }, bar: BAR, pane: PANE })
    expect(left.left).toBe(BAR_MARGIN)
    const right = inspectorSpot({ target: { x: 880, y: 300, width: 20, height: 40 }, bar: BAR, pane: PANE })
    expect(right.left).toBe(PANE.width - BAR.width - BAR_MARGIN)
    const narrow = inspectorSpot({ target: { x: 100, y: 300, width: 40, height: 40 }, bar: BAR, pane: { width: 300, height: 600 } })
    expect(narrow.left).toBe(BAR_MARGIN)
  })

  it("never covers the object, wherever it is, unless it fills the pane", () => {
    for (let y = -50; y < 560; y += 37) {
      for (let x = -20; x < 860; x += 91) {
        const target: Rect = { x, y, width: 120, height: 80 }
        const spot = inspectorSpot({ target, bar: BAR, pane: PANE, reserveAbove: 37, reserveBelow: 24 })
        if (spot.side === "over") continue
        expect(meets(barBox(spot), target), `${x},${y} ${spot.side}`).toBe(false)
        expect(spot.top).toBeGreaterThanOrEqual(BAR_MARGIN)
        expect(spot.top + BAR.height).toBeLessThanOrEqual(PANE.height - BAR_MARGIN)
        expect(spot.left).toBeGreaterThanOrEqual(BAR_MARGIN)
        expect(spot.left + BAR.width).toBeLessThanOrEqual(PANE.width - BAR_MARGIN)
      }
    }
  })

  it("prefer flips the order (an arrow that arrives from above has its bar below)", () => {
    const target: Rect = { x: 300, y: 300, width: 40, height: 40 }
    expect(inspectorSpot({ target, bar: BAR, pane: PANE, prefer: "below" }).side).toBe("below")
    expect(inspectorSpot({ target, bar: BAR, pane: PANE, prefer: "above" }).side).toBe("above")
    // ...but the preference gives way to the room there is
    expect(inspectorSpot({ target: { x: 300, y: 560, width: 40, height: 20 }, bar: BAR, pane: PANE, prefer: "below" }).side).toBe("above")
  })

  it("the bar is kept off what it is told to avoid (the arrow just drawn and the node it joins), standing beside if it must", () => {
    // an arrow arriving at the top edge of a node from the upper left: above would lie on the arrow, below on the node
    const end = { x: 500, y: 300 }
    const arrow: Rect = { x: 300, y: 200, width: 204, height: 104 }
    const node: Rect = { x: 440, y: 300, width: 200, height: 100 }
    const spot = inspectorSpot({ target: pointBox(end), bar: BAR, pane: PANE, prefer: "below", avoid: [arrow, node], alternatives: true })
    expect(meets(barBox(spot), arrow)).toBe(false)
    expect(meets(barBox(spot), node)).toBe(false)
    // told nothing to avoid, it takes the side it prefers
    expect(inspectorSpot({ target: pointBox(end), bar: BAR, pane: PANE, prefer: "below" }).side).toBe("below")
  })

  it("which side an arrow's bar goes", () => {
    expect(sideAwayFrom({ x: 0, y: 0 }, { x: 50, y: 90 })).toBe("below")
    expect(sideAwayFrom({ x: 0, y: 90 }, { x: 50, y: 0 })).toBe("above")
  })
})

// MARK: - What it holds

const stroke: CanvasItem = { kind: "stroke", stroke: { id: "s", colorHex: "#000", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], transform: noTransform(), group: null } }
const picture: CanvasItem = { kind: "image", image: { id: "p", file: "a.png", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.75, transform: noTransform(), hidden: false, group: null } }
const shape = (kind: ShapeKind): CanvasItem => ({
  kind: "shape", shape: { id: `sh-${kind}`, kind, center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 0.5, colorHex: "#000", lineWidth: 2, fillHex: null, label: "", transform: noTransform(), group: null },
})
const arrow = (over: Partial<{ startHead: "none" | "arrow"; endHead: "none" | "arrow" }> = {}): CanvasItem => ({
  kind: "connector", connector: {
    id: "c", start: { x: 0.1, y: 0.1 }, end: { x: 0.4, y: 0.4 }, startNode: null, endNode: null,
    startHead: over.startHead ?? "none", endHead: over.endHead ?? "arrow", line: "solid", colorHex: "#000", lineWidth: 2,
    transform: noTransform(), bends: [],
  },
})
const context: PlanContext = { docks: true, reads: true, grouping: "group", editing: false, compact: false }
const flat = (items: CanvasItem[], over: Partial<PlanContext> = {}) => inspectorPlan(items, { ...context, ...over }).groups.flat()

describe("which controls a pick has", () => {
  it("a node: colour, width, fill, its label, order, dock, copy and delete (the wireframe's bar, in its order)", () => {
    const plan = inspectorPlan([shape("rectangle")], context)
    expect(plan.name).toBe("Rectangle")
    expect(plan.groups).toEqual([["colour", "width", "fill"], ["label"], ["order", "dock"], ["duplicate", "delete"]])
  })

  it("a stroke: colour, width, order, dock, copy, delete; no fill, no words", () => {
    expect(flat([stroke])).toEqual(["colour", "width", "order", "dock", "duplicate", "delete"])
    expect(inspectorName([stroke])).toBe("Stroke")
  })

  it("a picture: crop and Aa (read it) where the platform can read, order, dock, copy, delete; no colour", () => {
    expect(flat([picture])).toEqual(["crop", "read", "order", "dock", "duplicate", "delete"])
    expect(flat([picture], { reads: false })).toEqual(["crop", "order", "dock", "duplicate", "delete"])
    expect(inspectorName([picture])).toBe("Picture")
  })

  it("a text box: colour, fill and its words, but no line width; a mark has no fill", () => {
    expect(flat([shape("text")])).toEqual(["colour", "fill", "label", "order", "dock", "duplicate", "delete"])
    expect(flat([shape("check")])).toEqual(["colour", "width", "label", "order", "dock", "duplicate", "delete"])
    expect(inspectorName([shape("text")])).toBe("Text Box")
  })

  it("an arrow: colour, width, its heads and line, order, copy, delete; it is named for what it is", () => {
    expect(flat([arrow()])).toEqual(["colour", "width", "heads", "order", "dock", "duplicate", "delete"])
    expect(inspectorName([arrow()])).toBe("Arrow")
    expect(inspectorName([arrow({ endHead: "none" })])).toBe("Line")
  })

  it("an arrow just drawn: the heads row and nothing else", () => {
    expect(inspectorPlan([arrow()], { ...context, compact: true }).groups).toEqual([["heads"]])
    // the compact bar belongs to one arrow: for anything else it is the whole bar
    expect(flat([shape("rectangle")], { compact: true })).toContain("colour")
  })

  it("several objects: Group or Ungroup, order, copy, delete; named by count", () => {
    const plan = inspectorPlan([stroke, shape("rectangle"), picture], context)
    expect(plan.name).toBe("3 objects")
    expect(plan.groups).toEqual([["group"], ["order"], ["duplicate", "delete"]])
    expect(flat([stroke, picture], { grouping: "nothing" })).toEqual(["order", "duplicate", "delete"])
  })

  it("the delete is out of the way while a crop or a label is being edited", () => {
    expect(flat([picture], { editing: true })).not.toContain("delete")
    expect(flat([picture], { editing: true })).toContain("duplicate")
    expect(flat([shape("rectangle")], { editing: true })).not.toContain("delete")
    expect(flat([stroke, picture], { editing: true })).not.toContain("delete")
  })

  it("the dock only when the layer can dock", () => {
    expect(flat([stroke], { docks: false })).not.toContain("dock")
  })

  it("nothing picked, nothing to show", () => {
    expect(inspectorPlan([], context).groups).toEqual([])
  })

  it("arrows alone have no ring (they have their ends and their circles); everything else has", () => {
    expect(wantsRing([arrow()])).toBe(false)
    expect(wantsRing([arrow(), arrow()])).toBe(false)
    expect(wantsRing([arrow(), shape("rectangle")])).toBe(true)
    expect(wantsRing([stroke])).toBe(true)
  })

  it("a first-paint width that grows with what the bar holds", () => {
    const small = estimatedWidth(inspectorPlan([stroke], context))
    const big = estimatedWidth(inspectorPlan([shape("rectangle")], context))
    expect(big).toBeGreaterThan(small)
    expect(estimatedWidth(inspectorPlan([arrow()], { ...context, compact: true }))).toBeGreaterThan(150)
  })
})
