/**
 * The port's own rules, found by the verifiers of the drawing lane (Drawinglane-fix1): the sidecar read as a
 * TOTAL function, a pick that must still be there, the eraser's sweep, and shapes of a kind this build does
 * not know. No Swift test behind these: the Mac's decoder throws on whatever it cannot read and drops the
 * whole drawing, which is exactly what the port may not do (a throw while a note is opening left the NEW
 * note with the PREVIOUS note's drawing on screen).
 */

import { describe, expect, it } from "vitest"
import {
  decodeDrawing, emptyDrawing, hitTest, idsTouching, isShapeKind, noTransform, polylines, readDrawing,
  removing, SHAPE_KINDS, shapeTitle, stillPicked, strokesSwept, unitPolylines, writeDrawing,
  baseBounds, boundsOf,
  type CanvasItem, type Drawing, type ShapeKind, type Size,
} from "../src/index"

const pane: Size = { width: 1000, height: 600 }

const stroke = (id: string, points: [number, number][], width = 3): CanvasItem => ({
  kind: "stroke",
  stroke: {
    id, colorHex: "#000000", width,
    points: points.map(([x, y]) => ({ x, y })), transform: noTransform(), group: null,
  },
})

const shape = (id: string, kind: ShapeKind = "rectangle"): CanvasItem => ({
  kind: "shape",
  shape: {
    id, kind, center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 0.5, colorHex: "#000000", lineWidth: 2,
    fillHex: null, label: "", transform: noTransform(), group: null,
  },
})

const picture = (id: string, hidden = false): CanvasItem => ({
  kind: "image",
  image: {
    id, file: "a.png", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.5,
    transform: noTransform(), hidden, group: null,
  },
})

describe("a sidecar that is not what we wrote", () => {
  // Every one of these threw in `readDrawing` before it was total.
  const odd: [string, string][] = [
    ["null", "null"],
    ["a number", "7"],
    ["a list", "[]"],
    ["items that are an object", '{"items":{}}'],
    ["a null item", '{"items":[null]}'],
    ["a string item", '{"items":["x"]}'],
    ["strokes that are an object", '{"strokes":{}}'],
    ["a null stroke", '{"strokes":[null]}'],
    ["a stroke whose points are a string", '{"items":[{"kind":"stroke","points":"x"}]}'],
    ["a stroke whose points are null", '{"items":[{"kind":"stroke","points":null}]}'],
    ["a connector whose bends are a number", '{"items":[{"kind":"connector","bends":5}]}'],
    ["a connector whose overrides hold null", '{"items":[{"kind":"connector","overrides":[null]}]}'],
    ["a truncated file", '{"items":[{"kind":"stroke","points":[{"x":0.1,'],
    ["nothing but a quote", '"'],
    ["a shape with no kind at all", '{"items":[{"kind":"shape"}]}'],
  ]

  for (const [name, text] of odd) {
    it(`reads ${name} without throwing`, () => {
      expect(() => readDrawing(text)).not.toThrow()
      const decoded = decodeDrawing(text)
      expect(Array.isArray(decoded.drawing.items)).toBe(true)
      // Whatever came out can be written and read back: nothing malformed got in.
      expect(() => writeDrawing(decoded.drawing)).not.toThrow()
      expect(readDrawing(writeDrawing(decoded.drawing))).toEqual(decoded.drawing)
    })
  }

  it("says so when something was thrown away, and not when all of it read", () => {
    expect(decodeDrawing("null").damaged).toBe(true)
    expect(decodeDrawing('{"items":{}}').damaged).toBe(true)
    expect(decodeDrawing('{"items":[null]}')).toMatchObject({ damaged: true, dropped: 1 })
    expect(decodeDrawing('{"items":[{"kind":"table"}]}')).toMatchObject({ damaged: true, dropped: 1 })
    expect(decodeDrawing('{"items":[{"kind":"stroke","points":"x"}]}')).toMatchObject({ damaged: true, dropped: 1 })
    expect(decodeDrawing('{"items":[{"kind":"stroke"').damaged).toBe(true)
    // A blank file, nothing at all, an empty drawing and a whole one are not damaged.
    expect(decodeDrawing(null).damaged).toBe(false)
    expect(decodeDrawing("").damaged).toBe(false)
    expect(decodeDrawing("  \n").damaged).toBe(false)
    expect(decodeDrawing("{}").damaged).toBe(false)
    expect(decodeDrawing('{"items":[]}').damaged).toBe(false)
    const whole = writeDrawing({ items: [stroke("a", [[0.1, 0.1], [0.2, 0.2]]), shape("b")] })
    expect(decodeDrawing(whole)).toMatchObject({ damaged: false, dropped: 0 })
  })

  it("reads what is readable of a file that is partly wrong", () => {
    const text = JSON.stringify({
      items: [
        null,
        { kind: "stroke", id: "ok", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
        { kind: "stroke", id: "empty", points: [] },
        { kind: "shape", id: "box", shapeKind: "rectangle" },
      ],
    })
    const decoded = decodeDrawing(text)
    expect(decoded.drawing.items.map((item) => (item.kind === "stroke" ? item.stroke.id : "box"))).toEqual(["ok", "box"])
    expect(decoded.dropped).toBe(2)
  })

  it("opens a file that starts with a byte-order mark (what PowerShell 5.1 writes with -Encoding UTF8)", () => {
    const text = "﻿" + writeDrawing({ items: [shape("b")] })
    const decoded = decodeDrawing(text)
    expect(decoded.damaged).toBe(false)
    expect(decoded.drawing.items).toHaveLength(1)
  })

  it("puts a head or a line it does not know back to the default", () => {
    const text = '{"items":[{"kind":"connector","id":"c","startHead":"diamond","endHead":7,"line":"wavy"}]}'
    const item = readDrawing(text).items[0]!
    if (item.kind !== "connector") throw new Error("not a connector")
    expect(item.connector.startHead).toBe("none")
    expect(item.connector.endHead).toBe("arrow")
    expect(item.connector.line).toBe("solid")
  })
})

describe("a shape of a kind this build does not know", () => {
  const hexagon = '{"items":[{"kind":"shape","id":"h","shapeKind":"hexagon","center":{"x":0.3,"y":0.3},"width":0.2,"aspect":0.5,"label":"six"},'
    + '{"kind":"shape","id":"r","shapeKind":"rectangle","center":{"x":0.7,"y":0.5},"width":0.2,"aspect":0.5}]}'

  it("comes in as a rectangle in the same box, with its words, and the shapes after it are untouched", () => {
    const drawing = readDrawing(hexagon)
    expect(drawing.items.map((item) => (item.kind === "shape" ? item.shape.kind : item.kind)))
      .toEqual(["rectangle", "rectangle"])
    const first = drawing.items[0]!
    if (first.kind !== "shape") throw new Error("not a shape")
    expect(first.shape.label).toBe("six")
    expect(first.shape.center).toEqual({ x: 0.3, y: 0.3 })
    // A newer app's kind is a change we make to the file on the next save, not a loss of the whole drawing:
    // it is not counted as damage (the box and the words are there).
    expect(decodeDrawing(hexagon).damaged).toBe(false)
  })

  it("never reaches the painter, the hit test or the marquee as a name that throws", () => {
    const loose = { ...(shape("h") as Extract<CanvasItem, { kind: "shape" }>) }
    loose.shape = { ...loose.shape, kind: "hexagon" as ShapeKind }
    const drawing: Drawing = { items: [loose, shape("r")] }
    expect(() => polylines("hexagon" as ShapeKind, { x: 0, y: 0, width: 10, height: 10 })).not.toThrow()
    expect(polylines("hexagon" as ShapeKind, { x: 0, y: 0, width: 10, height: 10 })).toEqual([])
    expect(unitPolylines("hexagon" as ShapeKind)).toEqual([])
    expect(() => hitTest(loose, { x: 500, y: 300 }, pane)).not.toThrow()
    expect(() => idsTouching(drawing, { x: 0, y: 0, width: 1000, height: 600 }, pane)).not.toThrow()
    expect(idsTouching(drawing, { x: 0, y: 0, width: 1000, height: 600 }, pane).has("r")).toBe(true)
    expect(() => baseBounds(loose, pane)).not.toThrow()
    expect(shapeTitle("hexagon" as ShapeKind)).toBe("hexagon")
  })

  it("knows exactly the kinds it can draw", () => {
    expect(SHAPE_KINDS).toHaveLength(11)
    for (const kind of SHAPE_KINDS) {
      expect(isShapeKind(kind)).toBe(true)
      expect(unitPolylines(kind).length).toBeGreaterThan(0)
    }
    for (const bad of ["hexagon", "", 7, null, undefined, {}, "Rectangle"]) expect(isShapeKind(bad)).toBe(false)
  })
})

describe("what is picked is only what is still there", () => {
  const drawing: Drawing = { items: [stroke("a", [[0.1, 0.1], [0.2, 0.2]]), shape("b"), picture("c"), picture("d", true)] }

  it("gives the same set back when every id is live (so a caller can tell by identity)", () => {
    const picked = new Set(["a", "b"])
    expect(stillPicked(drawing, picked)).toBe(picked)
    const none = new Set<string>()
    expect(stillPicked(drawing, none)).toBe(none)
  })

  it("drops the ids of objects that were undone away, deleted or erased", () => {
    const gone = removing(drawing, new Set(["b"]))
    expect([...stillPicked(gone, new Set(["a", "b"]))]).toEqual(["a"])
    expect(stillPicked(emptyDrawing(), new Set(["a"])).size).toBe(0)
  })

  it("drops a picture that was put away (read into words): nothing on screen says it is there", () => {
    expect([...stillPicked(drawing, new Set(["c", "d"]))]).toEqual(["c"])
    expect(boundsOf(drawing, new Set(["d"]), pane)).toBeNull()
    expect(stillPicked(drawing, new Set(["d"])).size).toBe(0)
  })
})

describe("the eraser's sweep", () => {
  // Twelve vertical strokes 30 points apart, as long as the pane is tall.
  const strokes = Array.from({ length: 12 }, (_, i) =>
    stroke(`s${i}`, [[(100 + i * 30) / pane.width, 0.2], [(100 + i * 30) / pane.width, 0.8]], 3))
  const drawing: Drawing = { items: strokes }

  const sweep = (step: number): number => {
    // One sweep across them at y = 300, sampled every `step` points (the way a pen reports it).
    let left = drawing
    let at = { x: 60, y: 300 }
    for (let x = 60 + step; x <= 520 + step; x += step) {
      const next = { x: Math.min(x, 520), y: 300 }
      const ids = strokesSwept(left, at, next, pane)
      if (ids.size > 0) left = removing(left, ids)
      at = next
    }
    return left.items.length
  }

  it("rubs out every stroke it crosses, however far apart the samples are", () => {
    for (const step of [6, 12, 20, 50, 80, 200]) expect(sweep(step)).toBe(0)
  })

  it("is what testing only the sampled points was not", () => {
    // Points only (the old rule): at 50 points a step some strokes lie between two samples.
    let left = drawing
    for (let x = 60; x <= 520; x += 50) {
      const hit = left.items.filter((item) => hitTest(item, { x, y: 300 }, pane)).map((item) => (item as any).stroke.id)
      left = removing(left, new Set(hit))
    }
    expect(left.items.length).toBeGreaterThan(0)
  })

  it("leaves a stroke the path passes clear of, and counts a click as a sweep of nothing", () => {
    const ids = strokesSwept(drawing, { x: 60, y: 300 }, { x: 105, y: 300 }, pane)
    expect([...ids]).toEqual(["s0"])
    expect(strokesSwept(drawing, { x: 100, y: 125 }, { x: 100, y: 125 }, pane).has("s0")).toBe(true)
    expect(strokesSwept(drawing, { x: 115, y: 300 }, { x: 115, y: 300 }, pane).size).toBe(0)
  })

  it("only strokes are rubbed out: not a shape, a picture or a hidden thing", () => {
    const mixed: Drawing = { items: [shape("b"), picture("c"), stroke("a", [[0.5, 0.4], [0.5, 0.6]])] }
    expect([...strokesSwept(mixed, { x: 0, y: 300 }, { x: 1000, y: 300 }, pane)]).toEqual(["a"])
  })

  it("takes a dot (a stroke of one point) and a stroke that has been moved and turned", () => {
    const dot = stroke("dot", [[0.5, 0.5]], 4)
    expect(strokesSwept({ items: [dot] }, { x: 400, y: 300 }, { x: 600, y: 300 }, pane).has("dot")).toBe(true)
    const moved = stroke("m", [[0.1, 0.5], [0.2, 0.5]])
    if (moved.kind !== "stroke") throw new Error("not a stroke")
    moved.stroke.transform = { dx: 0.5, dy: 0, scale: 1, rotation: 0 }
    // Its ink is at x = 600…700 now, not at 100…200.
    expect(strokesSwept({ items: [moved] }, { x: 650, y: 100 }, { x: 650, y: 500 }, pane).has("m")).toBe(true)
    expect(strokesSwept({ items: [moved] }, { x: 150, y: 100 }, { x: 150, y: 500 }, pane).has("m")).toBe(false)
  })
})
