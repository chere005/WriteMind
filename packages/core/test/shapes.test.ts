import { describe, expect, it } from "vitest"
import {
  attachableAt, connectorPaths, copiedItems, cornerRadius, dashPattern, FLOW_MENU_KINDS,
  headLength, headTriangle, hitTest, intersects, isClosed, isNode, MARK_KINDS, MARK_MENU_KINDS,
  nudged, outline, polylines, reordered, restyled, roundedRectanglePoints, segmentIntersection,
  shortened, strokeCurve, unitPolylines, withTransform,
  type CanvasItem, type Drawing, type Point, type Rect, type ShapeKind, type Size,
} from "../src/index"
import { noTransform } from "../src/drawing/model"

/**
 * Transcribed from `WriteMindTests/ShapeTests.swift` (the hit tests, the head,
 * the text box as a node, the marks' artwork) plus the port's own rules for
 * the things the Swift draws with true curves (a rounded rectangle) and the
 * edits the Swift does not have (restyle, nudge, order, copy).
 */
const pane: Size = { width: 1000, height: 500 }

const shape = (kind: ShapeKind, over: Record<string, unknown> = {}, id: string = kind): CanvasItem => ({
  kind: "shape",
  shape: {
    id, kind, center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 0.5, colorHex: "#000000",
    lineWidth: 2, fillHex: null, label: "", transform: noTransform(), group: null, ...over,
  },
})

const connector = (id = "c", over: Record<string, unknown> = {}): CanvasItem => ({
  kind: "connector",
  connector: {
    id, start: { x: 0.2, y: 0.5 }, end: { x: 0.4, y: 0.5 }, startNode: null, endNode: null,
    startHead: "none", endHead: "arrow", line: "solid", colorHex: "#000000", lineWidth: 2,
    transform: noTransform(), bends: [], ...over,
  },
})

describe("shapes and marks", () => {
  it("hits an oval inside and a check mark only on its line", () => {
    const oval = shape("oval", { aspect: 1 })
    expect(hitTest(oval, { x: 500, y: 250 }, pane)).toBe(true)
    expect(hitTest(oval, { x: 410, y: 160 }, pane), "the corner of the box is outside the oval").toBe(false)
    const check = shape("check", { width: 0.1, aspect: 1, lineWidth: 4 })
    expect(hitTest(check, { x: 473, y: 270 }, pane)).toBe(true)
    expect(hitTest(check, { x: 460, y: 215 }, pane), "the empty top-left corner").toBe(false)
    expect(attachableAt({ items: [oval] }, { x: 500, y: 250 }, pane)).not.toBeNull()
    expect(attachableAt({ items: [oval] }, { x: 100, y: 100 }, pane)).toBeNull()
  })

  it("hits an arrow along its line", () => {
    const line = connector()
    expect(hitTest(line, { x: 300, y: 252 }, pane)).toBe(true)
    expect(hitTest(line, { x: 300, y: 280 }, pane)).toBe(false)
  })

  it("makes a text box a node that is closed", () => {
    expect(isNode("text")).toBe(true)
    expect(isClosed("text")).toBe(true)
  })

  it("gives the head its tip at the end, and the head its length", () => {
    const head = headTriangle({ x: 100, y: 50 }, { x: 0, y: 50 }, 2)
    const xs = head.map((p) => p.x)
    expect(Math.max(...xs)).toBeCloseTo(100, 3)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(headLength(2), 3)
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }))
      .toEqual({ x: 5, y: 5 })
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull()
  })

  it("pulls the line back from a head so the tip is the point", () => {
    const { line, heads } = connectorPaths({ startHead: "none", endHead: "arrow", lineWidth: 2 },
      [{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(line[0]).toEqual({ x: 0, y: 0 })
    expect(line[1]!.x).toBeCloseTo(100 - headLength(2) * 0.8, 6)
    expect(heads).toHaveLength(1)
    expect(heads[0]![0]).toEqual({ x: 100, y: 0 })
    const both = connectorPaths({ startHead: "arrow", endHead: "arrow", lineWidth: 2 },
      [{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(both.heads).toHaveLength(2)
    expect(both.line[0]!.x).toBeGreaterThan(0)
    expect(connectorPaths({ startHead: "none", endHead: "none", lineWidth: 2 }, [{ x: 0, y: 0 }, { x: 9, y: 9 }])
      .heads).toHaveLength(0)
    // Too short to shorten: the line stays where it started instead of reversing.
    expect(shortened({ x: 5, y: 0 }, { x: 0, y: 0 }, 50)).toEqual({ x: 0, y: 0 })
  })

  it("dashes by the line's width", () => {
    expect(dashPattern({ line: "solid", lineWidth: 3 })).toEqual([])
    expect(dashPattern({ line: "dashed", lineWidth: 3 })).toEqual([12, 9])
    expect(dashPattern({ line: "dotted", lineWidth: 3 })).toEqual([0.1, 6.6000000000000005])
  })

  it("smooths a stroke through the midpoints of its samples", () => {
    expect(strokeCurve({ width: 3 }, [])).toBeNull()
    const dot = strokeCurve({ width: 3 }, [{ x: 5, y: 5 }])
    expect(dot).toEqual({ dot: { centre: { x: 5, y: 5 }, diameter: 3 } })
    const two = strokeCurve({ width: 3 }, [{ x: 0, y: 0 }, { x: 4, y: 0 }]) as { steps: { op: string }[] }
    expect(two.steps.map((s) => s.op)).toEqual(["M", "L"])
    const many = strokeCurve({ width: 3 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }]) as
      { steps: { op: string; control?: Point; to: Point }[] }
    expect(many.steps.map((s) => s.op)).toEqual(["M", "Q", "Q", "L"])
    expect(many.steps[1]!.control).toEqual({ x: 10, y: 0 })
    expect(many.steps[1]!.to).toEqual({ x: 10, y: 5 })
    expect(many.steps.at(-1)!.to).toEqual({ x: 20, y: 10 })
  })
})

describe("mark artwork", () => {
  const box = (kind: ShapeKind): { minX: number; minY: number; maxX: number; maxY: number } => {
    const points = unitPolylines(kind).flat()
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  }

  it("makes the cross square and centred", () => {
    const b = box("cross")
    expect(b.maxX - b.minX).toBeCloseTo(b.maxY - b.minY, 3)
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0.5, 3)
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0.5, 3)
  })

  it("makes the tick's short arm about two fifths of its long", () => {
    const tick = unitPolylines("check")[0]!
    expect(tick).toHaveLength(3)
    const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
    const short = length(tick[0]!, tick[1]!), long = length(tick[1]!, tick[2]!)
    expect(Math.abs(short / long - 0.4)).toBeLessThan(0.12)
    expect(tick[1]!.x, "the knee is left of centre").toBeLessThan(0.5)
    expect(tick[1]!.y, "and below where it starts").toBeGreaterThan(tick[0]!.y)
  })

  it("puts the question mark's dot under the stem", () => {
    const [hook, dot] = unitPolylines("question") as [Point[], Point[]]
    const length = (line: Point[]) => line.slice(1).reduce((sum, p, i) =>
      sum + Math.hypot(p.x - line[i]!.x, p.y - line[i]!.y), 0)
    expect(length(dot), "a dot, not a dash").toBeLessThan(0.03)
    expect(length(dot), "but not nothing, which some renderers drop").toBeGreaterThan(0)
    expect(Math.abs(dot[0]!.x - 0.5)).toBeLessThan(0.03)
    expect(dot[0]!.y).toBeGreaterThan(hook.at(-1)!.y + 0.08)
    const stem = hook.at(-1)!
    expect(stem.y).toBeGreaterThan(0.55)
    expect(stem.y).toBeLessThan(0.78)
    expect(Math.min(...hook.map((p) => p.x))).toBeLessThan(0.35)
    expect(Math.max(...hook.map((p) => p.x))).toBeGreaterThan(0.65)
  })

  it("draws the star as a five-pointed star and not a spider", () => {
    const star = unitPolylines("star")[0]!
    expect(star).toHaveLength(10)
    const radius = (p: Point) => Math.hypot(p.x - 0.5, p.y - 0.5)
    expect(Math.abs(radius(star[1]!) / radius(star[0]!) - 0.382)).toBeLessThan(0.02)
  })
})

describe("the palettes", () => {
  it("offers what the Mac's two popovers offer", () => {
    expect(FLOW_MENU_KINDS).toEqual(["rectangle", "roundedRectangle", "oval", "diamond", "triangle", "parallelogram"])
    expect(MARK_MENU_KINDS).toEqual(["check", "cross", "question", "star", "rectangle", "oval", "triangle"])
    for (const kind of MARK_KINDS) expect(MARK_MENU_KINDS).toContain(kind)
    for (const kind of FLOW_MENU_KINDS) expect(isNode(kind)).toBe(true)
  })
})

describe("a rounded rectangle", () => {
  const box: Rect = { x: 100, y: 100, width: 200, height: 100 }

  it("rounds by a fifth of the short side, in points", () => {
    expect(cornerRadius(box)).toBe(20)
    expect(cornerRadius({ x: 0, y: 0, width: 50, height: 400 })).toBe(10)
  })

  it("keeps every outline point inside its box and off the sharp corner", () => {
    const points = roundedRectanglePoints(box)
    expect(points).toHaveLength(28)
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(box.x - 1e-9)
      expect(p.x).toBeLessThanOrEqual(box.x + box.width + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(box.y - 1e-9)
      expect(p.y).toBeLessThanOrEqual(box.y + box.height + 1e-9)
    }
    expect(points.some((p) => Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y - 100) < 1e-6),
      "the corner itself is not on the line").toBe(false)
    // The flat edges still touch the box.
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(100, 6)
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(300, 6)
  })

  it("is the polyline of its kind, a plain rectangle's is not", () => {
    expect(polylines("roundedRectangle", box)[0]).toHaveLength(28)
    expect(polylines("rectangle", box)[0]).toHaveLength(4)
  })

  it("is not hit in the square corner it no longer has, but is hit inside and on the edge", () => {
    const item = shape("roundedRectangle", { width: 0.2, aspect: 0.5 })    // 200 x 100 at (400…600, 200…300)
    expect(hitTest(item, { x: 500, y: 250 }, pane)).toBe(true)
    expect(hitTest(item, { x: 500, y: 200 }, pane), "on the flat edge").toBe(true)
    // The arc passes 5.86 points in from the sharp corner on the diagonal, so the
    // corner itself is 8.3 from the line — further than the 6-point reach.
    expect(hitTest(item, { x: 392, y: 192 }, pane)).toBe(false)
    const plain = shape("rectangle", { width: 0.2, aspect: 0.5 })
    expect(hitTest(plain, { x: 400.5, y: 200.5 }, pane), "a square corner is there on a rectangle").toBe(true)
    expect(hitTest(item, { x: 400.5, y: 200.5 }, pane), "and rounded away on the other").toBe(false)
  })

  it("lands an arrow on the curve", () => {
    const item = shape("roundedRectangle", { width: 0.2, aspect: 0.5 })
    const ring = outline(item, pane)
    const corner = ring.reduce((best, p) => Math.hypot(p.x - 400, p.y - 200) < Math.hypot(best.x - 400, best.y - 200) ? p : best)
    // The nearest outline point to the sharp corner is 20 * (sqrt2 - 1) = 8.3 away.
    expect(Math.hypot(corner.x - 400, corner.y - 200)).toBeGreaterThan(5)
    expect(intersects(item, { x: 380, y: 180, width: 18, height: 18 }, pane),
      "a marquee that touches only the missing corner does not take it").toBe(false)
  })
})

describe("editing what is picked", () => {
  const drawing: Drawing = {
    items: [
      { kind: "stroke", stroke: { id: "s", colorHex: "#111111", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
        transform: noTransform(), group: null } },
      shape("rectangle", {}, "r"),
      connector("c"),
      { kind: "image", image: { id: "i", file: "a.png", center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 1,
        transform: noTransform(), hidden: false, group: null } },
    ],
  }

  it("recolours, rewidths and fills what is picked and nothing else", () => {
    const next = restyled(drawing, new Set(["s", "r", "c", "i"]), { colorHex: "#FF0000", lineWidth: 6, fillHex: "#FFFF00" })
    const [s, r, c, i] = next.items as [any, any, any, any]
    expect(s.stroke.colorHex).toBe("#FF0000")
    expect(s.stroke.width).toBe(6)
    expect(r.shape.colorHex).toBe("#FF0000")
    expect(r.shape.fillHex).toBe("#FFFF00")
    expect(c.connector.lineWidth).toBe(6)
    expect(c.connector.colorHex).toBe("#FF0000")
    expect(i).toBe(drawing.items[3])
    expect(restyled(drawing, new Set(["r"]), { colorHex: "#00FF00" }).items[0]).toBe(drawing.items[0])
  })

  it("takes a fill away with null, and gives the same drawing back when nothing changes", () => {
    const filled = restyled(drawing, new Set(["r"]), { fillHex: "#00FF00" })
    expect((restyled(filled, new Set(["r"]), { fillHex: null }).items[1] as any).shape.fillHex).toBeNull()
    expect(restyled(drawing, new Set(["r"]), { fillHex: null })).toBe(drawing)
    expect(restyled(drawing, new Set(), { colorHex: "#fff" })).toBe(drawing)
  })

  it("sets an arrow's heads and line", () => {
    const next = restyled(drawing, new Set(["c"]), { startHead: "arrow", endHead: "none", line: "dashed" })
    const c = (next.items[2] as any).connector
    expect([c.startHead, c.endHead, c.line]).toEqual(["arrow", "none", "dashed"])
  })

  it("clamps the width", () => {
    expect(((restyled(drawing, new Set(["s"]), { lineWidth: 500 }).items[0]) as any).stroke.width).toBe(24)
    expect(((restyled(drawing, new Set(["s"]), { lineWidth: 0 }).items[0]) as any).stroke.width).toBe(0.5)
  })

  it("nudges by view points as a fraction of the pane", () => {
    const next = nudged(drawing, new Set(["r"]), 10, -5, pane)
    const t = (next.items[1] as any).shape.transform
    expect(t.dx).toBeCloseTo(0.01, 9)
    expect(t.dy).toBeCloseTo(-0.01, 9)
    expect(nudged(drawing, new Set(["r"]), 0, 0, pane)).toBe(drawing)
  })

  it("orders what is picked without disturbing the rest", () => {
    const ids = (items: CanvasItem[]) => items.map((item) => (item as any)[item.kind].id).join("")
    const items = drawing.items
    expect(ids(reordered(items, new Set(["s"]), "front"))).toBe("rcis")
    expect(ids(reordered(items, new Set(["i"]), "back"))).toBe("isrc")
    expect(ids(reordered(items, new Set(["s"]), "forward"))).toBe("rsci")
    expect(ids(reordered(items, new Set(["c"]), "backward"))).toBe("scri")
    expect(ids(reordered(items, new Set(["s", "r"]), "forward"))).toBe("csri")
    expect(reordered(items, new Set(["i"]), "front")).toBe(items)
    expect(reordered(items, new Set(["s"]), "back")).toBe(items)
    expect(reordered(items, new Set(["s", "r", "c", "i"]), "front")).toBe(items)
  })

  it("copies with new ids, keeps a group a group, and lets go of what it did not take", () => {
    const grouped: Drawing = {
      items: [
        shape("rectangle", { group: "g1" }, "a"), shape("oval", { group: "g1" }, "b"), shape("diamond", {}, "d"),
        connector("ab", { startNode: "a", endNode: "b" }), connector("ad", { startNode: "a", endNode: "d" }),
      ],
    }
    const copy = copiedItems(grouped.items, new Set(["a", "b", "ab", "ad"]))
    expect(copy).toHaveLength(4)
    const all = new Set(grouped.items.map((i) => (i as any)[i.kind].id))
    for (const item of copy) expect(all.has((item as any)[item.kind].id)).toBe(false)
    const [a, b, ab, ad] = copy as [any, any, any, any]
    expect(a.shape.group).not.toBeNull()
    expect(a.shape.group).toBe(b.shape.group)
    expect(a.shape.group).not.toBe("g1")
    expect(ab.connector.startNode).toBe(a.shape.id)
    expect(ab.connector.endNode).toBe(b.shape.id)
    expect(ad.connector.startNode).toBe(a.shape.id)
    expect(ad.connector.endNode, "d was not copied, so the copy does not hold on to it").toBeNull()
    // And a copy can be moved without touching the original.
    expect(withTransform(copy[0]!, { ...noTransform(), dx: 0.5 })).not.toBe(grouped.items[0])
  })
})
