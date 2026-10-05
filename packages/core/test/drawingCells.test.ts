import { describe, expect, it } from "vitest"
import {
  basePoints, bounds, boundsOf, hitTest, idsTouching, indexAt, strokesSwept, transformed, type Size,
} from "../src/drawing/geometry"
import {
  decodeDrawing, isHidden, itemGroup, itemId, itemTransform, noTransform, readDrawing, removing, stillPicked,
  visibleItems, withGroup, withTransform, writeDrawing, type CanvasItem, type Drawing, type InkCell,
} from "../src/drawing/model"
import { copiedItems, nudged, reordered, restyled, restyledItem, shifted } from "../src/drawing/edit"
import { grouped, toggled, ungrouped, whole } from "../src/drawing/groups"
import { reconnect } from "../src/drawing/routing"
import { placeFlowItems } from "../src/capture/flowChart"
import { inkPieces } from "../src/export/drawing"

/**
 * The ink cell as an item of the drawing (docs\PLAN-docking-ink-cells.md (b)): `{ kind: "cell", cell: InkCell }`,
 * written into the sidecar and read back by the same per-item reader, HIDDEN on the page (so everything that skips a
 * put-away picture skips it), and kept by every edit that rebuilds a drawing as `{ items }`.
 */

const pane: Size = { width: 900, height: 600 }
const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"

const stroke = (id: string, x = 0.1, y = 0.1): CanvasItem => ({
  kind: "stroke",
  stroke: { id, colorHex: "#2D7DD2", width: 3, points: [{ x, y }, { x: x + 0.2, y: y + 0.05 }], transform: noTransform(), group: null },
})
const picture = (id: string, file = "aa.jpg"): CanvasItem => ({
  kind: "image",
  image: { id, file, center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.75, transform: noTransform(), hidden: false, group: null },
})
const cellOf = (items: CanvasItem[] = [stroke("c-s1", 0.05, 0.05), picture("c-p1", "bb.png")], aspect = 0.3): InkCell =>
  ({ id: ID, aspect, items })
const cellItem = (cell: InkCell = cellOf()): CanvasItem => ({ kind: "cell", cell })

describe("the cell in the sidecar", () => {
  it("is written as one item and read back as it was", () => {
    const drawing: Drawing = { items: [stroke("s1"), cellItem(), picture("p1")] }
    const json = writeDrawing(drawing)
    const raw = JSON.parse(json) as { items: Record<string, unknown>[] }
    expect(raw.items[1]).toMatchObject({ kind: "cell", id: ID, aspect: 0.3 })
    expect((raw.items[1]!.items as unknown[]).length).toBe(2)
    const back = decodeDrawing(json)
    expect(back.damaged).toBe(false)
    expect(back.dropped).toBe(0)
    expect(back.drawing).toEqual(drawing)
  })

  it("drops a damaged item inside a cell and counts it, keeping the rest of the cell", () => {
    const json = JSON.stringify({ items: [{
      kind: "cell", id: ID, aspect: 0.5,
      items: [null, 7, { kind: "zzz" }, { kind: "stroke", points: [] }, { kind: "cell", id: "inner", items: [] },
        JSON.parse(writeDrawing({ items: [stroke("ok")] })).items[0]],
    }] })
    const back = decodeDrawing(json)
    expect(back.damaged).toBe(true)
    expect(back.dropped).toBe(5)
    const item = back.drawing.items[0]!
    expect(item.kind).toBe("cell")
    if (item.kind !== "cell") return
    expect(item.cell.items.map(itemId)).toEqual(["ok"])
  })

  it("gives a cell written without an aspect (or a bad one) a sane one, and an id", () => {
    for (const aspect of [undefined, -1, 0, "tall", Number.NaN]) {
      const back = readDrawing(JSON.stringify({ items: [{ kind: "cell", aspect, items: "not a list" }] }))
      const item = back.items[0]!
      expect(item.kind).toBe("cell")
      if (item.kind !== "cell") continue
      expect(item.cell.aspect).toBeGreaterThan(0)
      expect(item.cell.id.length).toBeGreaterThan(0)
      expect(item.cell.items).toEqual([])
    }
  })

  it("never writes a cell inside a cell", () => {
    const nested = { ...cellOf(), items: [stroke("a"), cellItem({ id: "inner", aspect: 1, items: [] })] }
    const raw = JSON.parse(writeDrawing({ items: [cellItem(nested)] })) as { items: { items: { kind: string }[] }[] }
    expect(raw.items[0]!.items.map((one) => one.kind)).toEqual(["stroke"])
  })
})

describe("a cell is hidden on the page", () => {
  const drawing: Drawing = { items: [stroke("s1"), cellItem()] }
  const cell = drawing.items[1]!

  it("is hidden, and not among the visible items", () => {
    expect(isHidden(cell)).toBe(true)
    expect(visibleItems(drawing).map(itemId)).toEqual(["s1"])
  })

  it("is never hit, swept, touched, picked or measured", () => {
    expect(basePoints(cell, pane)).toEqual([])
    expect(hitTest(cell, { x: 10, y: 10 }, pane)).toBe(false)
    expect(indexAt(drawing, { x: 0, y: 0 }, pane)).toBeNull()
    expect(idsTouching(drawing, { x: -1e4, y: -1e4, width: 2e4, height: 2e4 }, pane)).toEqual(new Set(["s1"]))
    expect(strokesSwept(drawing, { x: 0, y: 0 }, { x: 900, y: 600 }, pane).has(ID)).toBe(false)
    expect(boundsOf(drawing, new Set([ID]), pane)).toBeNull()
    expect(stillPicked(drawing, new Set([ID, "s1"]))).toEqual(new Set(["s1"]))
    expect(inkPieces(drawing, pane, { mediaUrl: (f) => f }).length).toBe(1)
  })

  it("has every arm of an item: its id, no transform, no group, and nothing to restyle", () => {
    expect(itemId(cell)).toBe(ID)
    expect(itemTransform(cell)).toEqual(noTransform())
    expect(withTransform(cell, { dx: 1, dy: 1, scale: 2, rotation: 1 })).toBe(cell)
    expect(itemGroup(cell)).toBeNull()
    expect(withGroup(cell, "g")).toBe(cell)
    expect(restyledItem(cell, { colorHex: "#000000", lineWidth: 9 })).toBe(cell)
    expect(transformed(cell, noTransform(), { scale: 2, pivot: { x: 0, y: 0 }, size: pane })).toBeTruthy()
    expect(Number.isFinite(bounds(cell, pane).x)).toBe(true)
  })
})

describe("every core edit keeps the cell", () => {
  const cell = cellItem()
  const drawing: Drawing = {
    items: [stroke("s1"), cell, picture("p1"), {
      kind: "connector",
      connector: { id: "c1", start: { x: 0.1, y: 0.9 }, end: { x: 0.5, y: 0.5 }, startNode: null, endNode: "p1",
        startHead: "none", endHead: "arrow", line: "solid", colorHex: "#000000", lineWidth: 2, transform: noTransform(), bends: [] },
    }],
  }
  const all = new Set(drawing.items.map(itemId))
  const keeps = (items: CanvasItem[]) => expect(items.find((item) => item.kind === "cell")).toEqual(cell)

  it("delete, restyle, nudge, reorder, group, reconnect, shift, place a flow chart", () => {
    keeps(removing(drawing, new Set(["s1", "p1"])).items)
    keeps(restyled(drawing, all, { colorHex: "#FF0000", lineWidth: 5 }).items)
    keeps(nudged(drawing, all, 5, 5, pane).items)
    keeps(reordered(drawing.items, new Set(["s1"]), "front"))
    keeps(reordered(drawing.items, all, "back"))
    keeps(grouped(new Set(["s1", "p1"]), drawing.items, "g1"))
    keeps(ungrouped(new Set(["s1"]), grouped(new Set(["s1", "p1"]), drawing.items, "g1")))
    keeps(toggled(new Set(["s1", "p1"]), drawing.items, "g2")!)
    expect(whole(new Set([ID]), drawing.items)).toEqual(new Set([ID]))
    keeps(reconnect({ items: drawing.items.map((item) => itemId(item) === "p1"
      ? withTransform(item, { dx: 0.1, dy: 0, scale: 1, rotation: 0 }) : item) }, pane).items)
    keeps(shifted(drawing.items, 20, 20, pane))
    keeps(placeFlowItems(drawing.items, { x: 10, y: 10, width: 300, height: 200 }, pane))
  })

  it("deletes a cell only by its own id", () => {
    expect(removing(drawing, new Set([ID])).items.some((item) => item.kind === "cell")).toBe(false)
  })

  it("copies a cell as a cell of its own, with fresh ids all through", () => {
    const [copy] = copiedItems(drawing.items, new Set([ID]))
    expect(copy!.kind).toBe("cell")
    if (copy!.kind !== "cell") return
    expect(copy!.cell.id).not.toBe(ID)
    expect(copy!.cell.items.map(itemId)).not.toContain("c-s1")
    expect(copy!.cell.items).toHaveLength(2)
  })
})
