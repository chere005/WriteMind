import { describe, expect, it } from "vitest"
import {
  angleAbout, baseBounds, boundsOf, hitTest, idsTouching, intersects, noTransform, placedCenter,
  scaleFactor, transformed, type CanvasItem, type Size,
} from "../src/index"
import {
  grouped, toggle, toggled, ungrouped, whole,
} from "../src/drawing/groups"
import { emptyDrawing, itemGroup, itemId, readDrawing, writeDrawing } from "../src/drawing/model"
import { placedConnector, placedShape, placementBox } from "../src/drawing/placement"
import { inkHex, MARK_SIDE, unitPolylines } from "../src/drawing/shapes"

/**
 * The pane most of these work in: wide and short, so anything that confused
 * normalised space with view space shows up as a squashed or sheared
 * object. Transcribed from `WriteMindTests/DrawingObjectTests.swift`.
 */
const pane: Size = { width: 1000, height: 200 }

const line = (width = 4): CanvasItem => ({
  kind: "stroke",
  stroke: {
    id: "s1", colorHex: "#2D7DD2", width,
    points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
    transform: noTransform(), group: null,
  },
})

const picture = (aspect = 0.5, id = "i1"): CanvasItem => ({
  kind: "image",
  image: {
    id, file: "a.png", center: { x: 0.5, y: 0.5 }, width: 0.4, aspect,
    transform: noTransform(), hidden: false, group: null,
  },
})

describe("where an object is", () => {
  it("keeps a picture's own shape in a pane of any shape", () => {
    const box = baseBounds(picture(0.5), pane)
    expect(box.width).toBeCloseTo(400, 3)
    // 400 × 0.5, not 400 × (0.5 × 1000/200).
    expect(box.height).toBeCloseTo(200, 3)
  })

  it("lands a click on the ink and not on the box around it", () => {
    const stroke = line()
    expect(hitTest(stroke, { x: 500, y: 100 }, pane)).toBe(true)
    expect(hitTest(stroke, { x: 500, y: 130 }, pane)).toBe(false)
    expect(hitTest(stroke, { x: 50, y: 100 }, pane)).toBe(false)
  })

  it("takes whatever the marquee touches", () => {
    const stroke = line()
    expect(intersects(stroke, { x: 480, y: 90, width: 20, height: 20 }, pane)).toBe(true)
    expect(intersects(stroke, { x: 480, y: 10, width: 20, height: 20 }, pane)).toBe(false)
  })

  it("takes a picture from a marquee drawn inside it", () => {
    expect(intersects(picture(), { x: 490, y: 95, width: 10, height: 10 }, pane)).toBe(true)
    expect(intersects(picture(), { x: 0, y: 0, width: 20, height: 20 }, pane)).toBe(false)
  })

  it("catches a turned picture where it actually is", () => {
    // 400 × 100 upright, so 100 × 400 once it is stood on its end.
    const turned = picture(0.25)
    if (turned.kind === "image") turned.image.transform = { ...noTransform(), rotation: Math.PI / 2 }
    const below = { x: 495, y: 170, width: 10, height: 10 }
    expect(intersects(turned, below, pane)).toBe(true)
    expect(intersects(picture(0.25), below, pane)).toBe(false)
  })

  it("hands back the box round a set of items", () => {
    const drawing = { items: [line(), picture(0.5, "i2")] }
    const box = boundsOf(drawing, new Set(["s1", "i2"]), pane)!
    expect(box.x).toBeLessThanOrEqual(100)
    expect(box.width).toBeGreaterThan(700)
  })

  it("finds everything a marquee touches", () => {
    const drawing = { items: [line(), picture(0.5, "i2")] }
    expect(idsTouching(drawing, { x: 0, y: 0, width: 1000, height: 200 }, pane))
      .toEqual(new Set(["s1", "i2"]))
    expect(idsTouching(drawing, { x: 0, y: 0, width: 20, height: 20 }, pane).size).toBe(0)
  })
})

/** Transcribed from `CanvasEditTests`. */
describe("moving, scaling and turning", () => {
  const stroke = (): CanvasItem => ({
    kind: "stroke",
    stroke: {
      id: "s", colorHex: "#000000", width: 2,
      points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }],
      transform: noTransform(), group: null,
    },
  })

  it("moves by the fraction of the pane it was dragged across", () => {
    const moved = transformed(stroke(), noTransform(),
      { translate: { dx: 100, dy: 50 }, pivot: { x: 0, y: 0 }, size: pane })
    expect(moved.dx).toBeCloseTo(0.1, 4)
    expect(moved.dy).toBeCloseTo(0.25, 4)
    expect(moved.scale).toBeCloseTo(1, 4)
  })

  it("turns one object where it stands", () => {
    const pivot = placedCenter(stroke(), pane)
    const turned = transformed(stroke(), noTransform(), { rotate: Math.PI / 2, pivot, size: pane })
    expect(turned.rotation).toBeCloseTo(Math.PI / 2, 4)
    expect(turned.dx).toBeCloseTo(0, 4)
    expect(turned.dy).toBeCloseTo(0, 4)
  })

  it("pushes a group's members away from the group's centre when it scales", () => {
    const scaled = transformed(stroke(), noTransform(), { scale: 2, pivot: { x: 0, y: 0 }, size: pane })
    expect(scaled.scale).toBeCloseTo(2, 4)
    // The centre sat at (500, 100); twice as far from (0, 0) is (1000, 200).
    expect(scaled.dx).toBeCloseTo(0.5, 4)
    expect(scaled.dy).toBeCloseTo(0.5, 4)
  })

  it("changes nothing for a gesture that ends where it started", () => {
    expect(transformed(stroke(), noTransform(), { pivot: { x: 10, y: 10 }, size: pane }))
      .toEqual(noTransform())
  })

  it("scales by how much further the handle was dragged", () => {
    expect(scaleFactor({ x: 200, y: 100 }, { x: 300, y: 100 }, { x: 100, y: 100 })).toBeCloseTo(2, 4)
    expect(angleAbout({ x: 100, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0, 4)
  })
})

/** Transcribed from `WriteMindTests/CanvasGroupTests.swift`. */
describe("holding several things as one", () => {
  let next = 0
  const id = () => `id-${next++}`
  const stroke = (group: string | null = null): CanvasItem => ({
    kind: "stroke",
    stroke: {
      id: id(), colorHex: "#000000", width: 2,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      transform: noTransform(), group,
    },
  })
  const node = (group: string | null = null): CanvasItem => ({
    kind: "shape",
    shape: {
      id: id(), kind: "rectangle", center: { x: 0.5, y: 0.5 }, width: 0.18, aspect: 0.55,
      colorHex: "#000000", lineWidth: 2, fillHex: null, label: "",
      transform: noTransform(), group,
    },
  })
  const connector = (): CanvasItem => ({
    kind: "connector",
    connector: {
      id: id(), start: { x: 0.1, y: 0.1 }, end: { x: 0.4, y: 0.4 },
      startNode: null, endNode: null, startHead: "none", endHead: "arrow",
      line: "solid", colorHex: "#000000", lineWidth: 2, transform: noTransform(), bends: [],
    },
  })

  it("picks the whole group up from one member", () => {
    const group = "g1"
    const items = [stroke(group), node(group), stroke()]
    expect(whole(new Set([itemId(items[0]!)]), items))
      .toEqual(new Set([itemId(items[0]!), itemId(items[1]!)]))
  })

  it("leaves something in no group alone", () => {
    const items = [stroke(), node()]
    expect(whole(new Set([itemId(items[0]!)]), items)).toEqual(new Set([itemId(items[0]!)]))
    expect(whole(new Set(), items).size).toBe(0)
  })

  it("brings both groups whole when two are touched at once", () => {
    const items = [stroke("a"), node("a"), stroke("b"), node("b"), stroke()]
    const touched = new Set([itemId(items[0]!), itemId(items[2]!)])
    expect(whole(touched, items)).toEqual(new Set(items.slice(0, 4).map(itemId)))
  })

  it("knows which way the toggle goes", () => {
    const loose = [stroke(), node()]
    expect(toggle(new Set(loose.map(itemId)), loose)).toBe("group")
    const held = [stroke("g"), node("g")]
    expect(toggle(new Set(held.map(itemId)), held)).toBe("ungroup")
    const alone = [stroke()]
    expect(toggle(new Set([itemId(alone[0]!)]), alone)).toBe("nothing")
    expect(toggle(new Set(), alone)).toBe("nothing")
    // A group plus a loose thing GROUPS: the loose one joining is the point.
    const both = [stroke("g"), node("g"), stroke()]
    expect(toggle(new Set(both.map(itemId)), both)).toBe("group")
    // Half a group is not "the whole group".
    const half = [stroke("g"), node("g"), stroke("g")]
    expect(toggle(new Set([itemId(half[0]!), itemId(half[1]!)]), half)).toBe("group")
  })

  it("gives every one of them the same new id", () => {
    const items = [stroke(), node(), stroke()]
    const out = grouped(new Set(items.slice(0, 2).map(itemId)), items, "new")
    expect(itemGroup(out[0]!)).toBe("new")
    expect(itemGroup(out[1]!)).toBe("new")
    expect(itemGroup(out[2]!)).toBeNull()
  })

  it("swallows a smaller group whole", () => {
    const items = [stroke("old"), node("old"), stroke()]
    const out = grouped(new Set([itemId(items[0]!), itemId(items[2]!)]), items, "new")
    expect(out.map(itemGroup)).toEqual(["new", "new", "new"])
  })

  it("moves nothing, either way", () => {
    const items = [stroke(), node()]
    const out = grouped(new Set(items.map(itemId)), items, "g")
    expect(out.map((item) => JSON.stringify(item.kind === "stroke" ? item.stroke.transform : null)))
      .toEqual(items.map((item) => JSON.stringify(item.kind === "stroke" ? item.stroke.transform : null)))
  })

  it("makes no group of one, so nothing lands on the undo stack", () => {
    const items = [stroke(), node()]
    expect(toggled(new Set([itemId(items[0]!)]), items)).toBeNull()
  })

  it("leaves another group alone when one is taken apart", () => {
    const items = [stroke("a"), node("a"), stroke("b"), node("b")]
    const out = ungrouped(new Set([itemId(items[0]!), itemId(items[1]!)]), items)
    expect(out.map(itemGroup)).toEqual([null, null, "b", "b"])
  })

  it("comes back where it started after group then ungroup", () => {
    const items = [stroke(), node(), stroke()]
    const picked = new Set(items.map(itemId))
    const together = toggled(picked, items, "g")!
    expect(together.every((item) => itemGroup(item) !== null)).toBe(true)
    expect(toggled(picked, together)).toEqual(items)
  })

  it("gives a connector no group of its own", () => {
    const items = [node(), connector()]
    const out = grouped(new Set(items.map(itemId)), items, "g")
    expect(itemGroup(out[0]!)).toBe("g")
    expect(itemGroup(out[1]!)).toBeNull()
  })
})

/** Transcribed from `WriteMindTests/CanvasPlacementTests.swift`. */
describe("what a gesture puts down", () => {
  const size: Size = { width: 800, height: 600 }

  it("takes exactly the rectangle that was dragged for a node", () => {
    const shape = placedShape("rectangle", { x: 100, y: 100 }, { x: 300, y: 200 }, size, "#000000", 2)!
    if (shape.kind !== "shape") throw new Error("not a shape")
    expect(shape.shape.center.x).toBeCloseTo(200 / 800, 4)
    expect(shape.shape.width).toBeCloseTo(200 / 800, 4)
    expect(shape.shape.aspect).toBeCloseTo(0.5, 4)
  })

  it("keeps a mark square and grows it the way the drag went", () => {
    expect(placementBox({ x: 100, y: 100 }, { x: 160, y: 130 }, "check", size))
      .toEqual({ x: 100, y: 100, width: 60, height: 60 })
    expect(placementBox({ x: 100, y: 100 }, { x: 40, y: 60 }, "check", size))
      .toEqual({ x: 40, y: 40, width: 60, height: 60 })
  })

  it("puts a mark down at text size whatever the pane is wide", () => {
    const narrow = placementBox({ x: 100, y: 100 }, { x: 100, y: 100 }, "check",
      { width: 400, height: 600 })
    const wide = placementBox({ x: 100, y: 100 }, { x: 100, y: 100 }, "check",
      { width: 1600, height: 600 })
    expect(narrow.width).toBeCloseTo(wide.width, 3)
    expect(narrow.width).toBe(MARK_SIDE)
    expect(narrow.x + narrow.width / 2).toBeCloseTo(100, 3)
  })

  it("gives a mark that means something its own colour", () => {
    const hex = (kind: Parameters<typeof placedShape>[0]) => {
      const out = placedShape(kind, { x: 50, y: 50 }, { x: 50, y: 50 }, size, "#112233", 2)!
      return out.kind === "shape" ? out.shape.colorHex : ""
    }
    expect(hex("check")).toBe(inkHex("check"))
    expect(hex("cross")).toBe(inkHex("cross"))
    expect(hex("question")).toBe(inkHex("question"))
    expect(hex("rectangle")).toBe("#112233")
    expect(hex("star")).toBe("#112233")
  })

  it("does not draw a text-sized mark with an eight-point pen", () => {
    const tick = placedShape("check", { x: 50, y: 50 }, { x: 50, y: 50 }, size, "#000000", 8)!
    if (tick.kind !== "shape") throw new Error("not a shape")
    expect(tick.shape.lineWidth).toBeLessThanOrEqual(3.5)
    const big = placedShape("check", { x: 0, y: 0 }, { x: 120, y: 120 }, size, "#000000", 8)!
    if (big.kind !== "shape") throw new Error("not a shape")
    expect(big.shape.lineWidth).toBeCloseTo(8, 3)
  })

  it("runs a line from the press to the release and puts down nothing for a click", () => {
    const drawn = placedConnector({ x: 80, y: 60 }, { x: 400, y: 300 }, size, "none", "arrow", "#000", 3)!
    if (drawn.kind !== "connector") throw new Error("not a connector")
    expect(drawn.connector.start.x).toBeCloseTo(0.1, 4)
    expect(drawn.connector.end.y).toBeCloseTo(0.5, 4)
    expect(placedConnector({ x: 400, y: 300 }, { x: 401, y: 300 }, size, "none", "none", "#000", 3))
      .toBeNull()
  })
})

/** The marks' artwork, transcribed from `MarkArtworkTests`. */
describe("the marks", () => {
  const boxOfKind = (kind: Parameters<typeof unitPolylines>[0]) => {
    const points = unitPolylines(kind).flat()
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  }

  it("insets every mark so a round cap stays in its box", () => {
    for (const kind of ["check", "cross", "star", "question"] as const) {
      const box = boxOfKind(kind)
      expect(box.minX).toBeGreaterThanOrEqual(0.04)
      expect(box.minY).toBeGreaterThanOrEqual(0.04)
      expect(box.maxX).toBeLessThanOrEqual(0.96)
      expect(box.maxY).toBeLessThanOrEqual(0.96)
    }
  })

  it("draws the question mark as a hook over a dot", () => {
    const parts = unitPolylines("question")
    expect(parts).toHaveLength(2)
    const hook = parts[0]!, dot = parts[1]!
    const top = hook.reduce((best, point) => (point.y < best.y ? point : best))
    expect(top.y).toBeLessThan(0.25)
    expect(Math.abs(top.x - 0.5)).toBeLessThan(0.08)
    expect(hook.at(-1)!.x).toBeCloseTo(0.5, 1)
    const length = dot.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point.x - dot[index]!.x, point.y - dot[index]!.y), 0)
    expect(length).toBeGreaterThan(0)
    expect(length).toBeLessThan(0.03)
    expect(dot[0]!.y).toBeGreaterThan(hook.at(-1)!.y + 0.08)
  })
})

/** The sidecar: an older one still opens, and a round trip keeps everything. */
describe("the sidecar", () => {
  it("opens a file written before objects existed", () => {
    const legacy = JSON.stringify({
      strokes: [{ id: "s", colorHex: "#FF0000", width: 3, points: [{ x: 0.1, y: 0.1 }] }],
    })
    const drawing = readDrawing(legacy)
    expect(drawing.items).toHaveLength(1)
    expect(drawing.items[0]!.kind).toBe("stroke")
    // A default is not a decoding default: the transform it never had is
    // filled in rather than throwing the drawing away.
    expect(itemGroup(drawing.items[0]!)).toBeNull()
  })

  it("survives a round trip", () => {
    const drawing = {
      items: [
        line(),
        picture(0.5, "i9"),
        {
          kind: "shape" as const,
          shape: {
            id: "sh", kind: "check" as const, center: { x: 0.2, y: 0.3 }, width: 0.02,
            aspect: 1, colorHex: "#2FBF71", lineWidth: 2.4, fillHex: null, label: "",
            transform: noTransform(), group: "g",
          },
        },
      ],
    }
    expect(readDrawing(writeDrawing(drawing))).toEqual(drawing)
  })

  it("reads nothing at all as an empty drawing", () => {
    expect(readDrawing(null)).toEqual(emptyDrawing())
    expect(readDrawing("not json")).toEqual(emptyDrawing())
  })
})
