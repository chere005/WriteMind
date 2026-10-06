import { describe, expect, it } from "vitest"
import { bounds, outline, type Size } from "../src/drawing/geometry"
import { itemId, noTransform, type CanvasItem, type Drawing, type InkCell } from "../src/drawing/model"
import {
  cellFrame, changedInkCells, dockable, drawingMediaFiles, inkCellFrom, inkCellOf, inkCells, INK_DEFAULT_HEIGHT,
  INK_MIN_HEIGHT, INK_PAD, mediaInUse, mergedInto, minAspect, newInkCell, takenOut, toCell, toPage, undockedInk,
  undockedPicture, withInkCell,
} from "../src/drawing/inkCell"
import { inkCellSvg, readInkSnapshot } from "../src/export/inkSnapshot"
import { reconnect, segmentMidpoints } from "../src/drawing/routing"

/**
 * The ink cell model (docs\PLAN-docking-ink-cells.md (b), (d)): a cell's items are fractions of its WIDTH on both axes,
 * page → cell is a pure translation in points, a new cell keeps the ink's place in the column (fitted and scaled down
 * when it must be), docking into a cell centres the ink on the release and grows the cell, and the dock handle's
 * rules (`dockable`). No Swift original: the Mac has no ink cells.
 */

// Wide and short, so a confusion of the pane's two axes with the cell's one shows.
const pane: Size = { width: 1000, height: 400 }
const column = { left: 32, width: 932 }
const W = column.width

const stroke = (id: string, points: { x: number; y: number }[], transform = noTransform(), width = 3): CanvasItem => ({
  kind: "stroke", stroke: { id, colorHex: "#1C1C1E", width, points, transform, group: null },
})
const picture = (id: string, file = "aa.jpg", transform = noTransform()): CanvasItem => ({
  kind: "image", image: { id, file, center: { x: 0.4, y: 0.5 }, width: 0.2, aspect: 0.6, transform, hidden: false, group: null },
})
const shape = (id: string): CanvasItem => ({
  kind: "shape", shape: { id, kind: "diamond", center: { x: 0.7, y: 0.3 }, width: 0.1, aspect: 0.8, colorHex: "#000000",
    lineWidth: 2, fillHex: null, label: "a node", transform: { dx: 0.02, dy: -0.05, scale: 1.3, rotation: 0.4 }, group: null },
})
const arrow = (id: string): CanvasItem => ({
  kind: "connector", connector: { id, start: { x: 0.1, y: 0.8 }, end: { x: 0.5, y: 0.9 }, startNode: null, endNode: null,
    startHead: "none", endHead: "arrow", line: "dashed", colorHex: "#000000", lineWidth: 2,
    transform: { dx: 0.01, dy: 0.02, scale: 1, rotation: 0 }, bends: [{ x: 0.3, y: 0.85 }] },
})
const turned = { dx: 0.05, dy: -0.1, scale: 1.4, rotation: 0.7 }
const scribble = stroke("s1", [{ x: 0.2, y: 0.3 }, { x: 0.3, y: 0.45 }, { x: 0.35, y: 0.32 }], turned)

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01)

describe("page → cell is a pure translation in points", () => {
  it("keeps every item's bounds and outline, less the origin, to 0.01 px", () => {
    const origin = { x: 37, y: 251 }
    const items = [scribble, picture("p1", "aa.jpg", turned), shape("n1"), arrow("a1")]
    const inCell = toCell(items, pane, origin, W)
    expect(inCell.map(itemId)).toEqual(items.map(itemId))
    items.forEach((item, i) => {
      const was = bounds(item, pane)
      const now = bounds(inCell[i]!, cellFrame(W))
      near(now.x, was.x - origin.x)
      near(now.y, was.y - origin.y)
      near(now.width, was.width)
      near(now.height, was.height)
      const wasLine = outline(item, pane)
      const nowLine = outline(inCell[i]!, cellFrame(W))
      wasLine.forEach((p, k) => { near(nowLine[k]!.x, p.x - origin.x); near(nowLine[k]!.y, p.y - origin.y) })
    })
  })

  it("comes back to the page with toPage (a paste from a cell that is gone), every point where it was", () => {
    const origin = { x: 37, y: 251 }
    const items = [scribble, picture("p1", "aa.jpg", turned), shape("n1")]
    const back = toPage(toCell(items, pane, origin, W), pane, origin, W)
    items.forEach((item, i) => {
      const was = bounds(item, pane)
      const now = bounds(back[i]!, pane)
      near(now.x, was.x); near(now.y, was.y); near(now.width, was.width); near(now.height, was.height)
    })
  })

  it("keeps a stroke's width in px and its pressures, and leaves cells out", () => {
    const pressed: CanvasItem = { kind: "stroke", stroke: { ...(scribble as Extract<CanvasItem, { kind: "stroke" }>).stroke, pressures: [0.2, 0.5, 0.9] } }
    const [moved] = toCell([pressed, { kind: "cell", cell: newInkCell(W) }], pane, { x: 0, y: 0 }, W)
    expect(moved!.kind === "stroke" && moved!.stroke.width).toBe(3)
    expect(moved!.kind === "stroke" && moved!.stroke.pressures).toEqual([0.2, 0.5, 0.9])
    expect(toCell([{ kind: "cell", cell: newInkCell(W) }], pane, { x: 0, y: 0 }, W)).toEqual([])
  })
})

describe("the cells of a drawing", () => {
  it("are found, replaced in place, or added at the end", () => {
    const a = newInkCell(W, "a")
    const b = newInkCell(W, "b")
    const drawing: Drawing = { items: [scribble, { kind: "cell", cell: a }, picture("p1")] }
    expect(inkCells(drawing)).toEqual([a])
    expect(inkCellOf(drawing, "a")).toBe(a)
    expect(inkCellOf(drawing, "b")).toBeNull()
    const grown = withInkCell(drawing, { ...a, aspect: 1 })
    expect(grown.items.map(itemId)).toEqual(["s1", "a", "p1"])
    expect(inkCellOf(grown, "a")!.aspect).toBe(1)
    const more = withInkCell(grown, b)
    expect(more.items.map(itemId)).toEqual(["s1", "a", "p1", "b"])
    expect(drawing.items).toHaveLength(3)
  })

  it("start empty and INK_DEFAULT_HEIGHT tall", () => {
    const cell = newInkCell(800)
    expect(cell.items).toEqual([])
    expect(cell.aspect * 800).toBe(INK_DEFAULT_HEIGHT)
    expect(cell.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(cellFrame(640)).toEqual({ width: 640, height: 640 })
  })

  it("cannot be resized above their ink, or under INK_MIN_HEIGHT", () => {
    expect(minAspect(newInkCell(W), W) * W).toBeCloseTo(INK_MIN_HEIGHT, 6)
    const deep: InkCell = { id: "d", aspect: 1, items: [stroke("x", [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 300 / W }], noTransform(), 4)] }
    // The ink's bottom (300 px and half a 4 px nib) and the pad.
    expect(minAspect(deep, W) * W).toBeCloseTo(300 + 2 + INK_PAD, 6)
  })

  it("say which ones changed, by identity", () => {
    const a = newInkCell(W, "a"), b = newInkCell(W, "b")
    const before: Drawing = { items: [{ kind: "cell", cell: a }, { kind: "cell", cell: b }] }
    const after = withInkCell(before, { ...b, aspect: 2 })
    expect(changedInkCells(before, after).map((c) => c.id)).toEqual(["b"])
    expect(changedInkCells(null, after).map((c) => c.id)).toEqual(["a", "b"])
    expect(changedInkCells(after, after)).toEqual([])
  })
})

describe("what can be docked, and how it comes off the page", () => {
  const drawing: Drawing = {
    items: [scribble, picture("p1"), picture("p2", "bb.png"), shape("n1"), arrow("a1"), picture("nofile", ""),
      { kind: "cell", cell: newInkCell(W, "c1") }],
  }
  it("is a picture cell for exactly one picture, an ink cell for anything else on the page (nodes and arrows too)", () => {
    expect(dockable(drawing, new Set(["p1"]))).toBe("picture")
    expect(dockable(drawing, new Set(["s1"]))).toBe("ink")
    expect(dockable(drawing, new Set(["s1", "p1"]))).toBe("ink")
    expect(dockable(drawing, new Set(["p1", "p2"]))).toBe("ink")
    // BEHAVIOUR CHANGE (2026-10-06, "Drawing polish"): a drawing cell holds shapes, arrows and text boxes now, so a
    // selection with one of them docks as an ink cell; until then it was not dockable at all (null).
    expect(dockable(drawing, new Set(["s1", "n1"]))).toBe("ink")
    expect(dockable(drawing, new Set(["s1", "a1"]))).toBe("ink")
    expect(dockable(drawing, new Set(["n1"]))).toBe("ink")
    expect(dockable(drawing, new Set(["nofile"]))).toBeNull()
    expect(dockable(drawing, new Set(["c1"]))).toBeNull()
    expect(dockable(drawing, new Set())).toBeNull()
    expect(dockable(drawing, new Set(["gone"]))).toBeNull()
  })

  it("is taken out with its items in the drawing's order, never a cell", () => {
    const out = takenOut(drawing, new Set(["p2", "s1", "c1"]))
    expect(out.items.map(itemId)).toEqual(["s1", "p2"])
    expect(out.drawing.items.map(itemId)).toEqual(["p1", "n1", "a1", "nofile", "c1"])
    expect(takenOut(drawing, new Set(["gone"])).drawing).toBe(drawing)
  })

  it("keeps an arrow attached to a docked picture: the end lets go and stays put", () => {
    const tied = arrow("t1")
    if (tied.kind !== "connector") throw new Error("arrow")
    const attached: CanvasItem = { kind: "connector", connector: { ...tied.connector, startNode: "n1", endNode: "p1" } }
    const out = takenOut({ items: [picture("p1"), shape("n1"), attached] }, new Set(["p1"]))
    expect(out.items.map(itemId)).toEqual(["p1"])
    expect(out.drawing.items.map(itemId)).toEqual(["n1", "t1"])
    const kept = out.drawing.items[1]!
    expect(kept.kind === "connector" && kept.connector.startNode).toBe("n1")
    expect(kept.kind === "connector" && kept.connector.endNode).toBeNull()
    expect(kept.kind === "connector" && kept.connector.end).toEqual(tied.connector.end)
    expect(kept.kind === "connector" && kept.connector.bends).toEqual(tied.connector.bends)
  })

  it("takes an arrow with its nodes, attached; an arrow whose node stays behind lets go of that end", () => {
    const tied = arrow("t1")
    if (tied.kind !== "connector") throw new Error("arrow")
    const attached: CanvasItem = { kind: "connector", connector: { ...tied.connector, startNode: "n1", endNode: "p1" } }
    const both = takenOut({ items: [picture("p1"), shape("n1"), attached] }, new Set(["p1", "n1", "t1"]))
    const kept = both.items[2]!
    expect(kept.kind === "connector" && [kept.connector.startNode, kept.connector.endNode]).toEqual(["n1", "p1"])
    const half = takenOut({ items: [picture("p1"), shape("n1"), attached] }, new Set(["n1", "t1"]))
    const loose = half.items[1]!
    expect(loose.kind === "connector" && [loose.connector.startNode, loose.connector.endNode]).toEqual(["n1", null])
    expect(half.drawing.items.map(itemId)).toEqual(["p1"])
  })
})

describe("undocking a cell (the reverse of the dock handle)", () => {
  const origin = { x: 32, y: 640 }
  const items = [scribble, picture("p1", "aa.jpg", turned), shape("n1"), arrow("a1")]
  const cell: InkCell = { id: "c1", aspect: 0.4, items: toCell(items, pane, origin, W) }

  it("puts a cell's objects back on the page where the cell showed them, and takes the cell's item out", () => {
    const drawing: Drawing = { items: [stroke("before", [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]), { kind: "cell", cell }] }
    const out = undockedInk(drawing, "c1", pane, origin, W)!
    expect(out.ids).toEqual(["s1", "p1", "n1", "a1"])
    expect(out.drawing.items.map(itemId)).toEqual(["before", "s1", "p1", "n1", "a1"])
    expect(inkCells(out.drawing)).toEqual([])
    // Every object exactly where it was on the screen, to 0.01 px: shapes, arrows and text boxes as strokes are.
    items.forEach((item, i) => {
      const was = bounds(item, pane)
      const now = bounds(out.drawing.items[i + 1]!, pane)
      near(now.x, was.x); near(now.y, was.y); near(now.width, was.width); near(now.height, was.height)
    })
    expect(drawing.items).toHaveLength(2)
  })

  it("follows the cell to where it is shown now (text typed above it moved it down)", () => {
    const lower = { x: origin.x, y: origin.y + 87 }
    const out = undockedInk({ items: [{ kind: "cell", cell }] }, "c1", pane, lower, W)!
    near(bounds(out.drawing.items[0]!, pane).y, bounds(scribble, pane).y + 87)
  })

  it("is nothing for a cell that is not in the drawing, or no width", () => {
    expect(undockedInk({ items: [] }, "c1", pane, origin, W)).toBeNull()
    expect(undockedInk({ items: [{ kind: "cell", cell }] }, "c1", pane, origin, 0)).toBeNull()
  })

  it("puts a docked picture back as a floating picture of the same file, at the box it was shown in", () => {
    const rect = { x: 34, y: 512, width: 400, height: 250 }
    const out = undockedPicture({ items: [scribble] }, "photo.jpg", pane, rect, "new")!
    expect(out.ids).toEqual(["new"])
    const image = out.drawing.items[1]!
    expect(image.kind === "image" && image.image.file).toBe("photo.jpg")
    expect(image.kind === "image" && image.image.hidden).toBe(false)
    const box = bounds(image, pane)
    near(box.x, rect.x); near(box.y, rect.y); near(box.width, rect.width); near(box.height, rect.height)
    expect(undockedPicture({ items: [] }, "", pane, rect)).toBeNull()
    expect(undockedPicture({ items: [] }, "a.png", pane, { ...rect, width: 0 })).toBeNull()
  })

  it("keeps a routed arrow's hand-moved segments where they were shown, through undock and dock", () => {
    // Two boxes in a cell joined by a routed arrow; each of its middle segments dragged by hand.
    const box = (id: string, x: number, y: number): CanvasItem => ({
      kind: "shape", shape: { id, kind: "rectangle", center: { x, y }, width: 0.12, aspect: 0.5, colorHex: "#000000",
        lineWidth: 2, fillHex: null, label: "", transform: noTransform(), group: null },
    })
    const link: CanvasItem = {
      kind: "connector", connector: { id: "r1", start: { x: 0.2, y: 0.1 }, end: { x: 0.7, y: 0.125 }, startNode: "b1",
        endNode: "b2", startHead: "none", endHead: "arrow", line: "solid", colorHex: "#000000", lineWidth: 2,
        transform: noTransform(), bends: [] },
    }
    const frame = cellFrame(W)
    const routed = reconnect({ items: [box("b1", 0.15, 0.1), box("b2", 0.75, 0.125), link] }, frame)
    const arrowOf = (d: Drawing) => d.items.find((item) => item.kind === "connector")!
    const path = (item: CanvasItem) => item.kind === "connector"
      ? [item.connector.start, ...item.connector.bends, item.connector.end] : []
    const middles = segmentMidpoints(path(arrowOf(routed)).map((p) => ({ x: p.x * W, y: p.y * W })))
      .filter((m) => m.index > 0 && m.index < path(arrowOf(routed)).length - 2)
    expect(middles.length, JSON.stringify(path(arrowOf(routed)).map((p) => [p.x * W, p.y * W]))).toBeGreaterThan(0)
    const overrides = middles.map((m) => ({ index: m.index, vertical: m.vertical,
      value: (m.vertical ? m.point.x + 40 : m.point.y + 25) / W }))
    const dragged = reconnect({ items: routed.items.map((item) => item.kind === "connector"
      ? { kind: "connector" as const, connector: { ...item.connector, overrides } } : item) }, frame)
    const inCell = path(arrowOf(dragged)).map((p) => ({ x: p.x * W + origin.x, y: p.y * W + origin.y }))
    expect(inCell).not.toEqual(path(arrowOf(routed)).map((p) => ({ x: p.x * W + origin.x, y: p.y * W + origin.y })))
    const held: InkCell = { id: "c9", aspect: 0.6, items: dragged.items }
    // Undock, then the page's own routing (Canvas settles every drawing with `reconnect`): the arrow has not moved.
    const out = reconnect(undockedInk({ items: [{ kind: "cell", cell: held }] }, "c9", pane, origin, W)!.drawing, pane)
    const onPage = path(arrowOf(out)).map((p) => ({ x: p.x * pane.width, y: p.y * pane.height }))
    expect(onPage).toHaveLength(inCell.length)
    onPage.forEach((p, i) => { near(p.x, inCell[i]!.x); near(p.y, inCell[i]!.y) })
    // And docked again: the cell's own routing puts it back where the page showed it, less the new cell's origin.
    const again = inkCellFrom(out.items, pane, column, "c10")
    const back = reconnect({ items: again.items }, frame)
    const bounds0 = path(arrowOf({ items: again.items })), routedBack = path(arrowOf(back))
    routedBack.forEach((p, i) => { near(p.x * W, bounds0[i]!.x * W); near(p.y * W, bounds0[i]!.y * W) })
  })

  it("docks back to the same cell contents: undock then dock is the same objects, shapes and all", () => {
    const out = undockedInk({ items: [{ kind: "cell", cell }] }, "c1", pane, origin, W)!
    const again = inkCellFrom(out.drawing.items, pane, column, "c2")
    expect(again.items.map((item) => item.kind)).toEqual(["stroke", "image", "shape", "connector"])
    expect(dockable(out.drawing, new Set(out.ids))).toBe("ink")
  })
})

describe("shapes, arrows and text boxes in a drawing cell", () => {
  const text: CanvasItem = {
    kind: "shape", shape: { id: "t1", kind: "text", center: { x: 0.5, y: 0.1 }, width: 0.3, aspect: 0.2, colorHex: "#000000",
      lineWidth: 1, fillHex: null, label: "in a cell", transform: noTransform(), group: null },
  }
  const node: CanvasItem = {
    kind: "shape", shape: { id: "n1", kind: "diamond", center: { x: 0.2, y: 0.12 }, width: 0.1, aspect: 0.8, colorHex: "#2D7DD2",
      lineWidth: 2, fillHex: null, label: "", transform: noTransform(), group: null },
  }
  const line: CanvasItem = {
    kind: "connector", connector: { id: "a1", start: { x: 0.3, y: 0.1 }, end: { x: 0.45, y: 0.1 }, startNode: null, endNode: null,
      startHead: "none", endHead: "arrow", line: "solid", colorHex: "#000000", lineWidth: 2, transform: noTransform(), bends: [] },
  }
  const held: InkCell = { id: "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f", aspect: 0.25, items: [node, line, text] }

  it("live in the cell's snapshot (its ink file) and its metadata, as its strokes do", () => {
    const svg = inkCellSvg(held, 800, { mediaUrl: (file) => file, metadata: true })
    expect(svg).toContain(`stroke="#2D7DD2"`)
    expect(svg).toContain("in a cell")
    expect(svg).toContain("<foreignObject")
    expect(readInkSnapshot(svg)).toEqual(held)
  })

  it("scale with the cell's width, as everything in a cell does (fractions of W on both axes)", () => {
    const a = bounds(node, cellFrame(800)), b = bounds(node, cellFrame(400))
    near(b.x * 2, a.x); near(b.y * 2, a.y); near(b.width * 2, a.width)
  })
})

describe("a new ink cell from page ink", () => {
  it("keeps the ink's place across the column, puts it INK_PAD down, and is as tall as it and both pads", () => {
    const ink = [stroke("a", [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.6 }], noTransform(), 4)]
    const page = bounds(ink[0]!, pane)
    const cell = inkCellFrom(ink, pane, column, "new")
    expect(cell.id).toBe("new")
    const box = bounds(cell.items[0]!, cellFrame(W))
    near(box.x, page.x - column.left)
    near(box.y, INK_PAD)
    near(box.width, page.width)
    near(cell.aspect * W, page.height + 2 * INK_PAD)
  })

  it("is never shorter than INK_MIN_HEIGHT", () => {
    const flat = inkCellFrom([stroke("a", [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }], noTransform(), 2)], pane, column)
    near(flat.aspect * W, INK_MIN_HEIGHT)
  })

  it("is shifted left when the ink would run out of the cell, and left alone when it would start before it", () => {
    const right = inkCellFrom([stroke("a", [{ x: 0.8, y: 0.5 }, { x: 0.99, y: 0.6 }])], pane, column)
    const box = bounds(right.items[0]!, cellFrame(W))
    near(box.x + box.width, W - INK_PAD)
    const left = inkCellFrom([stroke("a", [{ x: 0.0, y: 0.5 }, { x: 0.1, y: 0.6 }])], pane, column)
    near(bounds(left.items[0]!, cellFrame(W)).x, 0)
  })

  it("is scaled down uniformly when the ink is wider than the cell less its pads", () => {
    const wide = [stroke("a", [{ x: 0.0, y: 0.2 }, { x: 1.0, y: 0.4 }]), picture("p", "aa.jpg")]
    const page = { a: bounds(wide[0]!, pane), p: bounds(wide[1]!, pane) }
    const pageWidth = Math.max(page.a.x + page.a.width, page.p.x + page.p.width) - Math.min(page.a.x, page.p.x)
    const pageHeight = Math.max(page.a.y + page.a.height, page.p.y + page.p.height) - Math.min(page.a.y, page.p.y)
    const cell = inkCellFrom(wide, pane, column)
    const k = (W - 2 * INK_PAD) / pageWidth
    const a = bounds(cell.items[0]!, cellFrame(W)), p = bounds(cell.items[1]!, cellFrame(W))
    near(Math.min(a.x, p.x), INK_PAD)
    near(Math.max(a.x + a.width, p.x + p.width), W - INK_PAD)
    near(a.width, page.a.width * k)
    near(p.width / p.height, page.p.width / page.p.height)
    near(cell.aspect * W, Math.max(INK_MIN_HEIGHT, pageHeight * k + 2 * INK_PAD))
  })

  it("is an empty cell when there is no ink", () => {
    const cell = inkCellFrom([], pane, column, "e")
    expect(cell.items).toEqual([])
    near(cell.aspect * W, INK_DEFAULT_HEIGHT)
  })
})

describe("ink docked INTO a cell", () => {
  const ink = [stroke("in", [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], noTransform(), 2)]
  const page = bounds(ink[0]!, pane)
  const cell: InkCell = { id: "c", aspect: 300 / W, items: [stroke("old", [{ x: 0.1, y: 0.05 }, { x: 0.2, y: 0.06 }])] }

  it("puts the ink's middle at the release point and keeps the cell's own ink", () => {
    const merged = mergedInto(cell, ink, pane, W, { x: 400, y: 150 })
    expect(merged.items.map(itemId)).toEqual(["old", "in"])
    const box = bounds(merged.items[1]!, cellFrame(W))
    near(box.x + box.width / 2, 400)
    near(box.y + box.height / 2, 150)
    near(box.width, page.width)
    expect(merged.aspect).toBe(cell.aspect)
  })

  it("is clamped inside across and below INK_PAD, and grows the cell when it runs past its bottom", () => {
    const corner = mergedInto(cell, ink, pane, W, { x: -50, y: -50 })
    const box = bounds(corner.items[1]!, cellFrame(W))
    near(box.x, 0)
    near(box.y, INK_PAD)
    const low = mergedInto(cell, ink, pane, W, { x: W + 50, y: 290 })
    const lowBox = bounds(low.items[1]!, cellFrame(W))
    near(lowBox.x + lowBox.width, W)
    near(low.aspect * W, lowBox.y + lowBox.height + INK_PAD)
    expect(low.aspect).toBeGreaterThan(cell.aspect)
  })
})

describe("the media a drawing needs kept", () => {
  it("is every picture (put-away ones too), each cell's snapshot and the pictures inside cells, each once", () => {
    const hidden: CanvasItem = { kind: "image", image: { ...(picture("h") as Extract<CanvasItem, { kind: "image" }>).image, file: "hh.png", hidden: true } }
    const drawing: Drawing = {
      items: [picture("p1", "aa.jpg"), hidden, picture("nofile", ""),
        { kind: "cell", cell: { id: "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f", aspect: 0.3, items: [picture("q", "bb.png"), picture("r", "aa.jpg")] } }],
    }
    expect(drawingMediaFiles(drawing)).toEqual(["aa.jpg", "hh.png", "ink-3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f.svg", "bb.png"])
  })

  it("is, for a sweep, what any note names in its markdown OR its sidecar (a docked picture is in no sidecar)", () => {
    const used = mediaInUse([
      { markdown: "![](.drawings/media/docked.jpg)\n\nwords ![](../.drawings/media/inline.png)", drawing: { items: [picture("f", "floating.png")] } },
      { markdown: "![ink](.drawings/media/ink-0a0b0c0d-1111-4222-8333-444455556666.svg)", drawing: { items: [] } },
    ])
    expect([...used].sort()).toEqual(["docked.jpg", "floating.png", "ink-0a0b0c0d-1111-4222-8333-444455556666.svg", "inline.png"])
  })
})
