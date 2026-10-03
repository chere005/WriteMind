import { describe, expect, it } from "vitest"
import {
  applyingOverrides, channelsFor, clampedToBox, clear, connectorPath, isRouted, movedSegment,
  noTransform, readDrawing, reconnect, route, segmentMidpoints, writeDrawing,
  type CanvasItem, type Drawing, type Point, type Rect, type SegmentOverride,
} from "../src/index"

/**
 * Transcribed from `WriteMindTests/ConnectorRoutingTests.swift`: flow-chart
 * lines — right angles, as few as possible, round what is in the way, and
 * out of each other's corridor.
 */

const left: Rect = { x: 100, y: 100, width: 80, height: 40 }

const isOrthogonal = (path: Point[]): boolean => {
  if (path.length < 2) return false
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!
    if (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001) return false
  }
  return true
}

describe("ConnectorRouting", () => {
  it("two nodes in line are joined by one straight segment", () => {
    const right: Rect = { x: 300, y: 100, width: 80, height: 40 }
    const path = connectorPath(left, right)
    expect(path.length, `no corners needed: ${JSON.stringify(path)}`).toBe(2)
    expect(path[0], "out of the right-hand side").toEqual({ x: 180, y: 120 })
    expect(path[1], "into the left-hand side").toEqual({ x: 300, y: 120 })
    expect(isOrthogonal(path)).toBe(true)
  })

  it("nodes stacked up are joined top to bottom", () => {
    const below: Rect = { x: 100, y: 300, width: 80, height: 40 }
    const path = connectorPath(left, below)
    expect(path.length).toBe(2)
    expect(path[0], "out of the bottom").toEqual({ x: 140, y: 140 })
    expect(path[1], "into the top").toEqual({ x: 140, y: 300 })
  })

  it("a node off to one side takes a single corner", () => {
    const away: Rect = { x: 320, y: 260, width: 80, height: 40 }
    const path = connectorPath(left, away)
    expect(path.length, `one bend is the fewest that joins them: ${JSON.stringify(path)}`).toBe(3)
    expect(isOrthogonal(path)).toBe(true)
    expect(path[0], "out of the side that faces it").toEqual({ x: 180, y: 120 })
    expect(path[path.length - 1], "and down into the top of the other").toEqual({ x: 360, y: 260 })
  })

  it("two nodes on top of each other still get an orthogonal line", () => {
    const path = connectorPath(left, { x: 120, y: 110, width: 80, height: 40 })
    expect(isOrthogonal(path), `a diagonal is never drawn: ${JSON.stringify(path)}`).toBe(true)
    expect(path.length).toBeGreaterThanOrEqual(2)
  })

  it("nodes side by side at different heights take the corridor between them", () => {
    // Ten points out of line: too far to draw straight, and too little for a
    // single corner to reach a side face on — so it goes out, across the
    // gap, and in.
    const right: Rect = { x: 300, y: 110, width: 80, height: 40 }
    const path = connectorPath(left, right)
    expect(isOrthogonal(path)).toBe(true)
    expect(path.length, `two bends: ${JSON.stringify(path)}`).toBe(4)
    expect(path[1]!.x, "halfway between the facing sides").toBeCloseTo(240, 3)
    expect(path[2]!.x).toBeCloseTo(240, 3)
  })

  it("the line goes round a node in the way", () => {
    const right: Rect = { x: 400, y: 130, width: 80, height: 40 }
    const between: Rect = { x: 230, y: 90, width: 60, height: 120 }
    const blocked = connectorPath(left, right, [between])
    expect(isOrthogonal(blocked)).toBe(true)
    expect(clear(blocked, [between]), `it still crosses it: ${JSON.stringify(blocked)}`).toBe(true)
  })

  it("two lines in one corridor are moved apart", () => {
    const rightA: Rect = { x: 300, y: 110, width: 80, height: 40 }
    const leftB: Rect = { x: 100, y: 200, width: 80, height: 40 }
    const rightB: Rect = { x: 300, y: 210, width: 80, height: 40 }
    const a = connectorPath(left, rightA)
    const b = connectorPath(leftB, rightB)
    expect(a.length).toBe(4)
    expect(a[1]!.x, "they would share a corridor").toBeCloseTo(b[1]!.x, 3)

    const lanes = channelsFor([a, b], new Set())
    expect(lanes[0], "so they are given different lanes").not.toBe(lanes[1])
    const moved = connectorPath(leftB, rightB, [], lanes[1])
    expect(Math.abs(moved[1]!.x - a[1]!.x), "and one of them steps aside").toBeGreaterThan(0.001)
  })

  it("a line dragged by hand keeps its lane", () => {
    const a = connectorPath(left, { x: 300, y: 110, width: 80, height: 40 })
    const lanes = channelsFor([a, a], new Set([0]))
    expect(lanes[0], "the one that was dragged does not move").toBe(0)
  })

  it("dragging a segment moves it and stretches its neighbours", () => {
    const path = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 100 }]
    const moved = movedSegment(path, 1, 80)
    expect(moved[0], "the ends stay put").toEqual({ x: 0, y: 0 })
    expect(moved[3]).toEqual({ x: 100, y: 100 })
    expect(moved[1], "the corners follow").toEqual({ x: 80, y: 0 })
    expect(moved[2]).toEqual({ x: 80, y: 100 })
    expect(isOrthogonal(moved)).toBe(true)
  })

  it("every segment has a circle in the middle of it", () => {
    const path = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }]
    const middles = segmentMidpoints(path)
    expect(middles.length).toBe(2)
    expect(middles[0]!.point).toEqual({ x: 25, y: 0 })
    expect(middles[0]!.vertical).toBe(false)
    expect(middles[1]!.point).toEqual({ x: 50, y: 50 })
    expect(middles[1]!.vertical).toBe(true)
  })

  it("an override is put back and an end stays on its node", () => {
    const size = { width: 1000, height: 1000 }
    const path = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 100 }]
    const override: SegmentOverride = { index: 1, vertical: true, value: 0.3 }
    const applied = applyingOverrides([override], path, null, null, size)
    expect(applied[1]!.x).toBeCloseTo(300, 3)
    expect(applied[2]!.x).toBeCloseTo(300, 3)

    // An override for a segment that now runs the other way is dropped.
    const stale: SegmentOverride = { index: 0, vertical: true, value: 0.9 }
    expect(applyingOverrides([stale], path, null, null, size)).toEqual(path)
  })

  it("an end dragged off its node is pulled back to its edge", () => {
    const box: Rect = { x: 100, y: 100, width: 80, height: 40 }
    expect(clampedToBox({ x: 500, y: 118 }, box)).toEqual({ x: 180, y: 118 })
    expect(clampedToBox({ x: 140, y: 0 }, box)).toEqual({ x: 140, y: 100 })
  })

  it("a connector remembers its corners through a save", () => {
    // The Swift test round-trips Codable; here it is write/readDrawing.
    const connector: CanvasItem = {
      kind: "connector",
      connector: {
        id: "c1", start: { x: 0.1, y: 0.1 }, end: { x: 0.5, y: 0.5 }, startNode: "n1", endNode: null,
        startHead: "none", endHead: "arrow", line: "solid", colorHex: "#000000", lineWidth: 2,
        transform: noTransform(), bends: [{ x: 0.3, y: 0.1 }],
        overrides: [{ index: 0, vertical: false, value: 0.25 }],
      },
    }
    const back = readDrawing(writeDrawing({ items: [connector] })).items[0]!
    if (back.kind !== "connector") throw new Error("not a connector")
    expect(back.connector.bends).toEqual([{ x: 0.3, y: 0.1 }])
    expect(back.connector.overrides).toEqual([{ index: 0, vertical: false, value: 0.25 }])
    expect(route(back.connector).length).toBe(3)
    expect(isRouted(back.connector)).toBe(true)

    const old = '{"items":[{"kind":"connector","start":[0.1,0.1],"end":[0.5,0.5],"colorHex":"#000000","lineWidth":2}]}'
    const plain = readDrawing(old).items[0]!
    if (plain.kind !== "connector") throw new Error("not a connector")
    expect(plain.connector.bends).toEqual([])
    expect(isRouted(plain.connector), "a line from the palette is not routed").toBe(false)
  })
})

describe("reconnect (Drawing.reconnect, beyond the Swift suite)", () => {
  const size = { width: 1000, height: 500 }
  const node = (id: string, cx: number, cy: number): CanvasItem => ({
    kind: "shape",
    shape: {
      id, kind: "rectangle", center: { x: cx, y: cy }, width: 0.1, aspect: 0.4,
      colorHex: "#000", lineWidth: 2, fillHex: null, label: "", transform: noTransform(), group: null,
    },
  })
  const line = (startNode: string | null, endNode: string | null): CanvasItem => ({
    kind: "connector",
    connector: {
      id: "c", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, startNode, endNode, startHead: "none",
      endHead: "arrow", line: "solid", colorHex: "#000", lineWidth: 2, transform: noTransform(), bends: [],
    },
  })

  it("routes a line between two nodes at right angles, ends on their edges", () => {
    const drawing: Drawing = { items: [node("a", 0.2, 0.2), node("b", 0.7, 0.6), line("a", "b")] }
    const out = reconnect(drawing, size)
    const c = out.items[2]!
    if (c.kind !== "connector") throw new Error("not a connector")
    const points = route(c.connector).map((p) => ({ x: p.x * size.width, y: p.y * size.height }))
    expect(isOrthogonal(points)).toBe(true)
    // out of the right of a (x = 0.2*1000 + 50 = 250), into b from the left or top.
    expect(points[0]!.x).toBeCloseTo(250, 3)
    // Nothing moved the second time round.
    expect(reconnect(out, size)).toBe(out)
  })

  it("a line from the palette stays straight and loses stale corners", () => {
    const free = line(null, null)
    if (free.kind !== "connector") throw new Error("not a connector")
    free.connector.bends = [{ x: 0.5, y: 0 }]
    const out = reconnect({ items: [node("a", 0.2, 0.5), free] }, size)
    const c = out.items[1]!
    if (c.kind !== "connector") throw new Error("not a connector")
    expect(c.connector.bends).toEqual([])
    expect(c.connector.start).toEqual({ x: 0, y: 0 })
  })

  it("a line with one end on a node turns a right angle to its free end", () => {
    const out = reconnect({ items: [node("a", 0.2, 0.5), line("a", null)] }, size)
    const c = out.items[1]!
    if (c.kind !== "connector") throw new Error("not a connector")
    const points = route(c.connector).map((p) => ({ x: p.x * size.width, y: p.y * size.height }))
    expect(isOrthogonal(points)).toBe(true)
  })
})
