/**
 * The handles round a picked object (renderer/handles.ts; Sean's wireframe, 2026-10-10): the ring of eight and the
 * rotate dot, the pill a small object gets instead, which handle a point is on, what each drag asks for, and the
 * stretch of a node's edge. PORT-ONLY: the Mac's layer has uniform scale and turn handles only.
 */

import { describe, expect, it } from "vitest"
import { applyMatrix, bounds, noTransform, textBoxHeight, TEXT_BOX, type CanvasItem, type Rect, type ShapeKind } from "@writemind/core"
import {
  anchorOf, edgesFor, handleAt, handleCursor, handleLayout, layoutKind, OUTLINE_PAD, outward, PILL_REACH, RING_MIN,
  resizeBy, ROTATE_REACH, stretchable, stretchedItem, stretches, MIN_NODE, PANE_INSET,
} from "../src/renderer/handles"

const FRAME = { width: 1000, height: 800 }
const box: Rect = { x: 100, y: 200, width: 240, height: 120 }
/** A character-width ruler for the text box: 8 px a letter, lines the width of the room, 18 px a line. */
const measure = (text: string, room: number) => Math.max(1, Math.ceil((text.length * 8) / Math.max(room, 1))) * TEXT_BOX.lineHeight

const node = (kind: ShapeKind = "rectangle", over: Partial<{ width: number; aspect: number; label: string; transform: ReturnType<typeof noTransform> }> = {}): CanvasItem => ({
  kind: "shape",
  shape: {
    id: "n", kind, center: { x: 0.5, y: 0.5 }, width: over.width ?? 0.24, aspect: over.aspect ?? 0.5, colorHex: "#000000",
    lineWidth: 2, fillHex: null, label: over.label ?? "", transform: over.transform ?? noTransform(), group: null,
  },
})

describe("ring or pill", () => {
  it("a box big enough on both sides gets the ring; a small or a flat one gets the pill", () => {
    expect(layoutKind(box)).toBe("ring")
    expect(layoutKind({ x: 0, y: 0, width: 40, height: 40 })).toBe("pill")
    expect(layoutKind({ x: 0, y: 0, width: 300, height: 2 })).toBe("pill")
    expect(layoutKind({ x: 0, y: 0, width: RING_MIN.long, height: RING_MIN.short })).toBe("ring")
    expect(layoutKind({ x: 0, y: 0, width: RING_MIN.long - 1, height: 300 })).toBe("ring")
    expect(layoutKind({ x: 0, y: 0, width: RING_MIN.long - 1, height: RING_MIN.long - 1 })).toBe("pill")
  })
})

describe("where the handles stand", () => {
  const layout = handleLayout(box)
  const at = (id: string) => layout.spots.find((spot) => spot.id === id)!

  it("eight handles ON the dashed outline (three px outside the box) and a rotate dot above the top edge", () => {
    expect(layout.kind).toBe("ring")
    expect(layout.spots.map((spot) => spot.id).sort()).toEqual(["e", "n", "ne", "nw", "rotate", "s", "se", "sw", "w"])
    expect(at("nw")).toMatchObject({ x: 100 - OUTLINE_PAD, y: 200 - OUTLINE_PAD })
    expect(at("se")).toMatchObject({ x: 340 + OUTLINE_PAD, y: 320 + OUTLINE_PAD })
    expect(at("n")).toMatchObject({ x: 220, y: 200 - OUTLINE_PAD })
    expect(at("e")).toMatchObject({ x: 340 + OUTLINE_PAD, y: 260 })
    expect(at("rotate")).toMatchObject({ x: 220, y: 200 - OUTLINE_PAD - ROTATE_REACH })
    expect(layout.stem).toEqual({ x: 220, y1: 200 - OUTLINE_PAD - ROTATE_REACH, y2: 200 - OUTLINE_PAD })
  })

  it("never on the words: every handle stands on the outline, none inside the box by more than the outline's own pad", () => {
    for (const spot of layout.spots.filter((s) => s.id !== "rotate")) {
      const onEdge = Math.abs(spot.x - 97) < 1e-9 || Math.abs(spot.x - 343) < 1e-9 || Math.abs(spot.y - 197) < 1e-9 || Math.abs(spot.y - 323) < 1e-9
      expect(onEdge, spot.id).toBe(true)
    }
  })

  it("only the edge handles asked for (a text box: the sides)", () => {
    const sides = handleLayout(box, { edges: ["e", "w"] }).spots.map((spot) => spot.id).sort()
    expect(sides).toEqual(["e", "ne", "nw", "rotate", "se", "sw", "w"])
  })

  it("a small object has one pill under it: turn and resize side by side, centred", () => {
    const small = handleLayout({ x: 200, y: 300, width: 30, height: 30 })
    expect(small.kind).toBe("pill")
    expect(small.stem).toBeNull()
    const [turn, resize] = small.spots
    expect(turn!.id).toBe("pill-turn")
    expect(resize!.id).toBe("pill-resize")
    expect((turn!.x + resize!.x) / 2).toBe(215)
    expect(turn!.y).toBe(330 + OUTLINE_PAD + PILL_REACH)
    expect(resize!.y).toBe(turn!.y)
    expect(resize!.x).toBeGreaterThan(turn!.x)
  })

  it("an object half scrolled off keeps every handle on the pane, PANE_INSET in", () => {
    const view: Rect = { x: 0, y: 500, width: 600, height: 400 }
    const high = handleLayout({ x: 100, y: 460, width: 240, height: 200 }, { view })
    for (const spot of high.spots) {
      expect(spot.y).toBeGreaterThanOrEqual(500 + PANE_INSET)
      expect(spot.x).toBeGreaterThanOrEqual(PANE_INSET)
    }
    // the rotate dot, which would be above the view, is kept in it, and the stem still reaches the top edge
    expect(high.spots.find((spot) => spot.id === "rotate")!.y).toBe(500 + PANE_INSET)
    const out = handleLayout({ x: 500, y: 600, width: 400, height: 100 }, { view })
    for (const spot of out.spots) expect(spot.x).toBeLessThanOrEqual(600 - PANE_INSET)
  })
})

describe("which handle a point is on", () => {
  const layout = handleLayout(box)
  it("the nearest within the slop, else none", () => {
    expect(handleAt(layout, { x: 97, y: 197 })).toBe("nw")
    expect(handleAt(layout, { x: 100, y: 200 })).toBe("nw")   // the object's own corner is inside the slop
    expect(handleAt(layout, { x: 343, y: 260 })).toBe("e")
    expect(handleAt(layout, { x: 220, y: 171 })).toBe("rotate")
    expect(handleAt(layout, { x: 220, y: 260 })).toBeNull()   // the middle of the object: a press there moves it
    expect(handleAt(layout, { x: 97 - 30, y: 197 })).toBeNull()
  })
  it("picks the nearer of two within reach (a small ring's handles overlap)", () => {
    const tight = handleLayout({ x: 0, y: 0, width: RING_MIN.long, height: RING_MIN.short })
    const id = handleAt(tight, { x: 24, y: -3 + 1 }, 20)
    expect(id).toBe("n")
  })
  it("the pill's two buttons", () => {
    const pill = handleLayout({ x: 200, y: 300, width: 30, height: 30 })
    const [turn, resize] = pill.spots
    expect(handleAt(pill, { x: turn!.x, y: turn!.y })).toBe("pill-turn")
    expect(handleAt(pill, { x: resize!.x + 2, y: resize!.y })).toBe("pill-resize")
  })
  it("a pointer for each", () => {
    expect(handleCursor("nw")).toBe("nwse-resize")
    expect(handleCursor("se")).toBe("nwse-resize")
    expect(handleCursor("ne")).toBe("nesw-resize")
    expect(handleCursor("n")).toBe("ns-resize")
    expect(handleCursor("w")).toBe("ew-resize")
    expect(handleCursor("rotate")).toBe("grab")
  })
})

describe("what a drag of a resize handle asks for", () => {
  it("a corner scales about the OPPOSITE corner", () => {
    expect(anchorOf("se", box)).toEqual({ x: 100, y: 200 })
    expect(anchorOf("nw", box)).toEqual({ x: 340, y: 320 })
    expect(anchorOf("ne", box)).toEqual({ x: 100, y: 320 })
    const { pivot, factor } = resizeBy("se", box, { x: 340, y: 320 }, { x: 580, y: 440 })
    expect(pivot).toEqual({ x: 100, y: 200 })
    expect(factor).toBeCloseTo(2, 6)
  })
  it("an edge scales about the middle of the opposite edge, along its own axis only", () => {
    expect(anchorOf("e", box)).toEqual({ x: 100, y: 260 })
    expect(anchorOf("s", box)).toEqual({ x: 220, y: 200 })
    // dragging the east edge 120 px out of 240: 1.5x; the pointer's height does not matter
    expect(resizeBy("e", box, { x: 340, y: 260 }, { x: 460, y: 900 }).factor).toBeCloseTo(1.5, 6)
    expect(resizeBy("n", box, { x: 220, y: 200 }, { x: 5, y: 80 }).factor).toBeCloseTo(2, 6)   // 120 up of 120
  })
  it("a drag back through the anchor cannot turn the object inside out or make it vanish", () => {
    expect(resizeBy("e", box, { x: 340, y: 260 }, { x: 0, y: 260 }).factor).toBe(0.05)
    expect(resizeBy("se", box, { x: 340, y: 320 }, { x: 100, y: 200 }).factor).toBe(0.05)
    expect(resizeBy("e", box, { x: 340, y: 260 }, { x: 99999, y: 260 }).factor).toBe(20)
  })
  it("a drag that starts on the anchor's own line changes nothing", () => {
    expect(resizeBy("e", box, { x: 100, y: 260 }, { x: 400, y: 260 }).factor).toBe(1)
  })
  it("the pill's resize is about the centre", () => {
    expect(anchorOf("pill-resize", box)).toEqual({ x: 220, y: 260 })
  })
  it("outward is the way the edge faces", () => {
    expect(outward("e", { x: 10, y: 10 }, { x: 40, y: 0 })).toBe(30)
    expect(outward("w", { x: 10, y: 10 }, { x: 40, y: 0 })).toBe(-30)
    expect(outward("s", { x: 10, y: 10 }, { x: 0, y: 25 })).toBe(15)
    expect(outward("n", { x: 10, y: 10 }, { x: 0, y: 25 })).toBe(-15)
  })
})

describe("stretching a node by an edge", () => {
  const rect = node("rectangle")   // 240 x 120 centred at (500, 400): left 380, right 620, top 340, bottom 460
  const edges = (item: CanvasItem) => { const b = bounds(item, FRAME); return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height } }

  it("only an unturned node or text box stretches; a text box only sideways", () => {
    expect(stretchable(rect)).toEqual({ horizontal: true, vertical: true })
    expect(stretchable(node("text"))).toEqual({ horizontal: true, vertical: false })
    expect(stretchable(node("check"))).toEqual({ horizontal: false, vertical: false })
    expect(stretchable(node("rectangle", { transform: { ...noTransform(), rotation: 0.4 } }))).toEqual({ horizontal: false, vertical: false })
    expect(stretchable({ kind: "stroke", stroke: { id: "s", colorHex: "#000", width: 1, points: [], transform: noTransform(), group: null } }))
      .toEqual({ horizontal: false, vertical: false })
    expect(stretches([rect], "e")).toBe(true)
    expect(stretches([rect, rect], "e")).toBe(false)
    expect(stretches([node("text")], "s")).toBe(false)
  })

  it("the east edge moves out and the west edge does not", () => {
    const wider = stretchedItem(rect, "e", 100, FRAME, measure)
    const before = edges(rect), after = edges(wider)
    expect(after.right).toBeCloseTo(before.right + 100, 6)
    expect(after.left).toBeCloseTo(before.left, 6)
    expect(after.top).toBeCloseTo(before.top, 6)
    expect(after.bottom).toBeCloseTo(before.bottom, 6)
  })

  it("each edge holds the opposite one", () => {
    for (const [edge, held, moved, grow] of [["w", "right", "left", 60], ["s", "top", "bottom", 40], ["n", "bottom", "top", 50], ["e", "left", "right", -70]] as const) {
      const out = stretchedItem(rect, edge, grow, FRAME, measure)
      const before = edges(rect), after = edges(out)
      expect(after[held], edge).toBeCloseTo(before[held], 6)
      expect(Math.abs(after[moved] - before[moved]), edge).toBeCloseTo(Math.abs(grow), 6)
    }
  })

  it("a shape that is scaled is stretched by what the eye sees, not by its own units", () => {
    const big = node("rectangle", { transform: { dx: 0.05, dy: -0.02, scale: 2, rotation: 0 } })
    const out = stretchedItem(big, "e", 80, FRAME, measure)
    const before = edges(big), after = edges(out)
    expect(after.right - before.right).toBeCloseTo(80, 6)
    expect(after.left).toBeCloseTo(before.left, 6)
    expect(after.bottom).toBeCloseTo(before.bottom, 6)
  })

  it("a node is not squeezed away: the floor is MIN_NODE as drawn", () => {
    const thin = edges(stretchedItem(rect, "e", -10000, FRAME, measure))
    expect(thin.right - thin.left).toBeCloseTo(MIN_NODE.width, 6)
    const flat = edges(stretchedItem(rect, "s", -10000, FRAME, measure))
    expect(flat.bottom - flat.top).toBeCloseTo(MIN_NODE.height, 6)
  })

  it("a text box widens, its height follows its words, and its top edge stays", () => {
    const words = "one two three four five six seven eight nine ten eleven twelve"
    const frame = FRAME
    const widthPx = 240
    const box0 = node("text", { width: widthPx / frame.width, aspect: textBoxHeight(words, widthPx, measure) / widthPx, label: words })
    const wide = stretchedItem(box0, "e", 160, frame, measure)
    const before = edges(box0), after = edges(wide)
    expect(after.right - after.left).toBeCloseTo(400, 6)
    expect(after.left).toBeCloseTo(before.left, 6)
    expect(after.top).toBeCloseTo(before.top, 6)
    expect(after.bottom - after.top).toBeCloseTo(textBoxHeight(words, 400, measure), 6)
    expect(after.bottom - after.top).toBeLessThan(before.bottom - before.top)   // wider: fewer lines
  })

  it("a text box keeps its minimum width", () => {
    const small = stretchedItem(node("text", { label: "x" }), "w", -100000, FRAME, measure)
    const b = bounds(small, FRAME)
    expect(b.width).toBeCloseTo(TEXT_BOX.minimumWidth, 6)
  })

  it("an item that cannot stretch comes back as it was", () => {
    const turned = node("rectangle", { transform: { ...noTransform(), rotation: 0.3 } })
    expect(stretchedItem(turned, "e", 50, FRAME, measure)).toBe(turned)
    expect(stretchedItem(node("text"), "s", 50, FRAME, measure)).toEqual(node("text"))
  })

  it("a stretched node's centre moves by half the growth (where its arrows land follows the box)", () => {
    const out = stretchedItem(rect, "e", 100, FRAME, measure)
    const centre = applyMatrix(out, FRAME, { x: 500, y: 400 })
    expect(centre.x).toBeCloseTo(550, 6)
  })
})

describe("which edge handles a selection has", () => {
  it("a lone text box: the sides; anything else: all four", () => {
    expect(edgesFor([node("text")])).toEqual(["e", "w"])
    expect(edgesFor([node("rectangle")])).toEqual(["n", "e", "s", "w"])
    expect(edgesFor([node("text"), node("rectangle")])).toEqual(["n", "e", "s", "w"])
  })
})
