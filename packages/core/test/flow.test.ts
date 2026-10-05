import { describe, expect, it } from "vitest"
import {
  DIAMOND_LEAN, RECTANGLE_LEAN, SHIPPED_KINDS, componentOf, flowChartItems, isNodeKind, mayHoldChart, namedShape,
  noTransform, placeFlowItems, readFlow, readShape, type CanvasItem, type ShapeInkKind, type Size,
} from "../src/index"
import { Canvas, type Pt } from "./raster"

/**
 * Transcribed from `WriteMindTests/FlowChartReadingTests.swift` and
 * `WriteMindTests/ShapeInkCorpusTests.swift`.
 *
 * The Swift tests draw with Core Graphics (bottom-up, anti-aliased); these
 * draw with `./raster.ts` (top-down, stamped discs) and threshold the same
 * way, so the y of the first test's figures is flipped (y' = 460 - y) and
 * every other figure is drawn exactly as the Swift test draws it.
 */

describe("FlowChartReading", () => {
  const width = 600, height = 460
  const pane: Size = { width: 600, height: 460 }
  const items = (mask: Uint8Array) =>
    flowChartItems(mask, width, height, [], pane, "#000000", 2)

  it("two boxes and an arrow come in as a chart", () => {
    const c = new Canvas(width, height)
    c.strokeRect(60, 70, 180, 90)                                  // top box
    c.strokeRect(60, 280, 180, 90)                                 // bottom box
    c.line({ x: 150, y: 160 }, { x: 150, y: 275 })                 // the arrow between
    c.fillRect(143, 266, 14, 14)                                   // its head
    const found = items(c.mask())
    const shapes = found.filter((i) => i.kind === "shape")
    expect(shapes.length, `two boxes: ${found.length} items`).toBe(2)
    for (const item of shapes) {
      if (item.kind !== "shape") continue
      expect(SHIPPED_KINDS.has(item.shape.kind)).toBe(true)
      expect(item.shape.width).toBeGreaterThan(0.1)
      expect(item.shape.width).toBeLessThan(0.9)
    }
  })

  it("two boxes and an arrow also yield a connector joining them, head at the end it points", () => {
    // Not in the Swift suite: the arrow is what makes it a chart, so say so.
    const c = new Canvas(width, height)
    c.strokeRect(60, 70, 180, 90)
    c.strokeRect(60, 280, 180, 90)
    c.line({ x: 150, y: 160 }, { x: 150, y: 275 })
    c.fillRect(143, 266, 14, 14)
    const found = items(c.mask())
    const shapes = found.flatMap((i) => (i.kind === "shape" ? [i.shape] : []))
    const connectors = found.flatMap((i) => (i.kind === "connector" ? [i.connector] : []))
    expect(connectors.length).toBe(1)
    const arrow = connectors[0]!
    expect(arrow.startNode).not.toBeNull()
    expect(arrow.endNode).not.toBeNull()
    expect(arrow.startNode).not.toBe(arrow.endNode)
    expect(shapes.map((s) => s.id)).toContain(arrow.startNode)
    expect(shapes.map((s) => s.id)).toContain(arrow.endNode)
    expect(arrow.endHead).toBe("arrow")
    // The head was drawn at the bottom: the connector runs down the page.
    expect(arrow.end.y).toBeGreaterThan(arrow.start.y)
  })

  it("a single ring is not a chart", () => {
    // One circle round a word is emphasis, which the mark reader already
    // turns into bold. It must not become a node.
    const c = new Canvas(width, height)
    c.strokeEllipse(200, 200, 160, 80)
    expect(items(c.mask())).toEqual([])
  })

  it("a page of writing is not a chart", () => {
    // The Swift test sets eight lines in a system font; there is no font
    // engine here, so the stand-in is eight lines of hand-sized glyphs —
    // rings (a, o, e), ascenders and strokes (l, t, h, n) in the 22pt
    // proportions — set with word gaps. Prose must come back as nothing.
    const c = new Canvas(width, height)
    const glyph = (x: number, y: number, n: number): void => {
      switch (n % 5) {
        case 0: c.strokeEllipse(x, y + 6, 11, 13); break               // o
        case 1: c.line({ x, y }, { x, y: y + 19 }); break              // l
        case 2: c.polyline([{ x, y: y + 19 }, { x, y: y + 6 }, { x: x + 9, y: y + 6 }, { x: x + 9, y: y + 19 }]); break // n
        case 3: c.polyline([{ x, y: y + 6 }, { x: x + 9, y: y + 19 }, { x: x + 12, y: y + 6 }]); break // v
        default: c.polyline([{ x: x + 11, y: y + 6 }, { x, y: y + 6 }, { x: x + 11, y: y + 19 }, { x, y: y + 19 }]); break // z
      }
    }
    for (let line = 0; line < 8; line++) {
      let x = 30
      for (let i = 0; i < 38; i++) {
        glyph(x, 30 + line * 45, i + line)
        x += i % 6 === 5 ? 26 : 15
      }
    }
    const found = items(c.mask())
    expect(found.length, `prose came back as ${found.length} objects`).toBe(0)
  })

  it("an underline on its own is never a connector", () => {
    const c = new Canvas(width, height)
    c.line({ x: 60, y: 260 }, { x: 400, y: 260 })
    expect(items(c.mask())).toEqual([])
  })

  it("the marks stay ink and the shapes do not", () => {
    // The six shapes a chart is drawn with, including the triangle and the
    // parallelogram that used to be held back.
    expect([...SHIPPED_KINDS].sort()).toEqual(
      ["diamond", "oval", "parallelogram", "rectangle", "roundedRectangle", "triangle"])
    // And the marks, which the classifier reads perfectly well and which
    // this must not put on the page anyway.
    expect(SHIPPED_KINDS.has("check")).toBe(false)
    expect(SHIPPED_KINDS.has("cross")).toBe(false)
    expect(SHIPPED_KINDS.has("star")).toBe(false)
  })

  it("the objects are moved into the box they belong in", () => {
    const shape: CanvasItem = {
      kind: "shape",
      shape: {
        id: "s", kind: "rectangle", center: { x: 0.5, y: 0.5 }, width: 0.4, aspect: 0.5,
        colorHex: "#000000", lineWidth: 2, fillHex: null, label: "",
        transform: noTransform(), group: null,
      },
    }
    const line: CanvasItem = {
      kind: "connector",
      connector: {
        id: "c", start: { x: 0.2, y: 0.2 }, end: { x: 0.8, y: 0.8 }, startNode: null, endNode: null,
        startHead: "none", endHead: "none", line: "solid", colorHex: "#000000", lineWidth: 2,
        transform: noTransform(), bends: [],
      },
    }
    const landing = { x: 150, y: 230, width: 300, height: 115 }   // a quarter of the pane
    const moved = placeFlowItems([shape, line], landing, pane)
    const placed = moved[0]!
    if (placed.kind !== "shape") throw new Error("not a shape")
    expect(placed.shape.center.x).toBeCloseTo(0.5, 3)               // centred in the landing box
    expect(placed.shape.center.y).toBeCloseTo(0.625, 3)
    expect(placed.shape.width).toBeCloseTo(0.2, 3)                  // half the width it was
    const placedLine = moved[1]!
    if (placedLine.kind !== "connector") throw new Error("not a connector")
    expect(placedLine.connector.start.x).toBeCloseTo(0.35, 3)
    expect(placedLine.connector.end.x).toBeCloseTo(0.65, 3)
  })

  it("the lean decides rectangle from diamond and refuses the band between", () => {
    // The classifier's own verdict is only taken when the lean agrees.
    const blob = { stride: 10, minX: 0, minY: 0, maxX: 1, maxY: 1, pixels: [0, 1] }
    // Too small to read either way — nothing crashes and nothing is named.
    expect(namedShape(blob, 400, 0)).toBeNull()
    expect(RECTANGLE_LEAN).toBe(8)
    expect(DIAMOND_LEAN).toBe(25)
    expect(RECTANGLE_LEAN, "there is a band where nothing is emitted").toBeLessThan(DIAMOND_LEAN)
  })
})

describe("ShapeInk corpus", () => {
  const side = 300

  const drawn = (draw: (c: Canvas) => void): Uint8Array => {
    const c = new Canvas(side, side)
    draw(c)
    return c.mask()
  }

  /** The classifier's verdict on everything in the mask. */
  const kind = (mask: Uint8Array): ShapeInkKind => {
    const blob = componentOf({ x: 0, y: 0, width: side, height: side }, mask, side, side)
    if (blob === null) return "none"
    return readShape(blob, side).kind
  }

  /** A closed polygon through `points`, in the middle of the page. */
  const polygon = (points: Pt[]): Uint8Array => drawn((c) => c.polyline(points, true))

  // The four that already ship, so the corpus can be trusted.

  it("a drawn rectangle is a rectangle", () => {
    expect(kind(drawn((c) => c.strokeRect(60, 90, 180, 110)))).toBe("rectangle")
  })

  it("a drawn oval is an oval", () => {
    expect(kind(drawn((c) => c.strokeEllipse(60, 90, 180, 110)))).toBe("oval")
  })

  it("a drawn diamond is a diamond", () => {
    expect(kind(polygon([{ x: 150, y: 60 }, { x: 240, y: 150 }, { x: 150, y: 240 }, { x: 60, y: 150 }])))
      .toBe("diamond")
  })

  // The two this change lets through.

  it("a drawn triangle is a triangle", () => {
    expect(kind(polygon([{ x: 150, y: 60 }, { x: 250, y: 230 }, { x: 50, y: 230 }]))).toBe("triangle")
  })

  it("a drawn parallelogram is a parallelogram", () => {
    expect(kind(polygon([{ x: 90, y: 90 }, { x: 250, y: 90 }, { x: 210, y: 210 }, { x: 50, y: 210 }])))
      .toBe("parallelogram")
  })

  // And the refusals, which are the point.

  it("a rectangle drawn by hand does not become a parallelogram", () => {
    // Every corner pushed a few points out of true — a rectangle drawn
    // freehand, which must stay the class it is.
    for (const wobble of [3, 6, 9]) {
      const shape = polygon([
        { x: 60 + wobble, y: 90 }, { x: 240, y: 90 - wobble },
        { x: 240 - wobble, y: 200 }, { x: 60, y: 200 + wobble },
      ])
      const named = kind(shape)
      expect(named, `a ${wobble}-point wobble is still a rectangle`).not.toBe("parallelogram")
      expect(named).not.toBe("triangle")
    }
  })

  it("a scribble is not a triangle", () => {
    // Where scribbles used to go, and the reason triangles were held back:
    // a mess with three longish strokes in it.
    const scribble = drawn((c) => {
      c.polyline([{ x: 70, y: 80 }, { x: 220, y: 130 }, { x: 90, y: 200 }, { x: 230, y: 210 },
        { x: 110, y: 100 }, { x: 200, y: 170 }])
    })
    expect(kind(scribble)).not.toBe("triangle")
    expect(kind(scribble)).not.toBe("parallelogram")
  })

  it("an arrow is not a shape", () => {
    const arrow = drawn((c) => {
      c.line({ x: 60, y: 150 }, { x: 240, y: 150 })
      c.polyline([{ x: 210, y: 130 }, { x: 240, y: 150 }, { x: 210, y: 170 }])
    })
    expect(isNodeKind(kind(arrow)), "an arrow is a line, not a node").toBe(false)
  })
})

describe("whether a page could hold a chart at all (beyond the Swift suite)", () => {
  it("needs a closed outline of a box's size", () => {
    const blank = new Canvas(600, 400)
    expect(mayHoldChart(blank.mask(), 600, 400)).toBe(false)
    // Writing: rows of small marks with counters no bigger than a letter's.
    const prose = new Canvas(600, 400)
    prose.lineWidth = 3
    for (let row = 0; row < 6; row++) for (let i = 0; i < 18; i++) prose.strokeEllipse(20 + i * 30, 30 + row * 55, 14, 16)
    expect(mayHoldChart(prose.mask(), 600, 400)).toBe(false)
    const boxes = new Canvas(600, 400)
    boxes.strokeRect(60, 70, 180, 90)
    expect(mayHoldChart(boxes.mask(), 600, 400)).toBe(true)
  })
})

describe("a labelled chart (beyond the Swift suite)", () => {
  // Three boxes with a word of ink written in each and an arrow between each pair,
  // and the reader's words for them.
  function labelled() {
    const c = new Canvas(800, 400)
    c.lineWidth = 4
    const boxes = [{ x: 40, label: "start" }, { x: 300, label: "check" }, { x: 560, label: "done" }]
    for (const b of boxes) {
      c.strokeRect(b.x, 150, 200, 100)
      // The word: a run of letter-sized blobs standing in for the glyphs.
      for (let i = 0; i < 5; i++) c.fillRect(b.x + 40 + i * 28, 185, 14, 30)
    }
    c.line({ x: 242, y: 200 }, { x: 298, y: 200 }); c.polyline([{ x: 282, y: 188 }, { x: 298, y: 200 }, { x: 282, y: 212 }])
    c.line({ x: 502, y: 200 }, { x: 558, y: 200 }); c.polyline([{ x: 542, y: 188 }, { x: 558, y: 200 }, { x: 542, y: 212 }])
    const words = boxes.map((b) => ({ text: b.label, box: { x: b.x + 36, y: 180, width: 140, height: 40 } }))
    return { mask: c.mask(), words }
  }
  const pane = { width: 1000, height: 700 }

  it("is read as nodes labelled with the words inside them", () => {
    const { mask, words } = labelled()
    const items = flowChartItems(mask, 800, 400, words, pane, "#000000", 2)
    const shapes = items.filter((i) => i.kind === "shape")
    expect(shapes.map((s) => (s.kind === "shape" ? s.shape.label : "")).sort()).toEqual(["check", "done", "start"])
    expect(items.filter((i) => i.kind === "connector").length).toBe(2)
  })
})

describe("readFlow (beyond the Swift suite)", () => {
  it("labels a box with the words inside it and joins two boxes by their arrow", () => {
    const c = new Canvas(600, 460)
    c.strokeRect(60, 70, 180, 90)
    c.strokeRect(60, 280, 180, 90)
    c.line({ x: 150, y: 160 }, { x: 150, y: 275 })
    c.fillRect(143, 266, 14, 14)
    const sheet = readFlow(c.mask(), 600, 460, [
      { text: "start", box: { x: 120, y: 100, width: 60, height: 20 } },
      { text: "end", box: { x: 125, y: 310, width: 50, height: 20 } },
    ])
    const nodes = sheet.nodes.filter((n) => !n.isTableCell && !n.isEmphasis && !n.isShapeless)
    expect(nodes.map((n) => n.label).sort()).toEqual(["end", "start"])
    expect(sheet.edges.length).toBe(1)
    expect(sheet.edges[0]!.from).not.toBeNull()
    expect(sheet.edges[0]!.to).not.toBeNull()
  })
})
