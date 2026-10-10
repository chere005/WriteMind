/**
 * THE HANDLES ROUND A PICKED OBJECT: where they are, which one a point is on, and what dragging each does. Pure — no
 * React, no DOM — so the tests ask it directly and Canvas.tsx only draws what it says.
 *
 * Sean's wireframe (2026-10-10, docs/ui-2026-10/FinalTablet.png): EIGHT resize handles (the four corners and the four
 * edge middles) standing ON the dashed outline, and ONE rotate handle on a stem above the top edge. They replace the
 * six glyph discs (turn, move, delete, dock, style, resize) that used to be spread round the box and landed on the
 * words of a text box; moving is a drag of the object itself, and the rest are the inspector's (inspectorRules.ts).
 *
 * A SMALL OBJECT GETS ONE PILL, NOT A RING: nine handles on a 30 px box are a cluster nobody can pick one out of
 * (and on a flat stroke they sit on one another), so under `RING_MIN` the handles are two buttons side by side
 * below the box — turn and resize — inside one pill.
 *
 * WHAT AN EDGE DOES. A corner scales the selection about the OPPOSITE corner (it stays put, as in Freeform and
 * Pages) and an edge scales it about the middle of the opposite edge, in proportion — except on a node or a text
 * box, which STRETCH: the dragged edge moves and the opposite one stays, in that one direction only (`stretchedItem`).
 * A text box only stretches sideways (its height is its words'), and a turned one scales (an edge of the box on the
 * screen is no longer an edge of the shape).
 */

import {
  distance, isNode, itemId, scaleFactor, textBoxAspect, TEXT_BOX,
  type CanvasItem, type Measure, type Point, type Rect, type Size,
} from "@writemind/core"

export type Edge = "n" | "e" | "s" | "w"
export type RingId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
export type HandleId = RingId | "rotate" | "pill-turn" | "pill-resize"

export interface HandleSpot { id: HandleId; x: number; y: number }

export interface HandleLayout {
  kind: "ring" | "pill"
  spots: HandleSpot[]
  /** The line from the top edge's middle to the rotate handle (ring only). */
  stem: { x: number; y1: number; y2: number } | null
}

/** The dashed outline stands this far outside the objects' own box (Canvas.tsx draws it so). */
export const OUTLINE_PAD = 3
/** How far above the top edge the rotate handle's centre is. */
export const ROTATE_REACH = 26
/** The pill's centre line is this far below the outline's bottom edge. */
export const PILL_REACH = 17
/** The two buttons of the pill are this far apart (centre to centre). */
export const PILL_SPACING = 26
/** Handles keep this far in from the edge of the visible pane. */
export const PANE_INSET = 12
/** A box smaller than this on its long side, or on its short side, gets the pill (Sean: "< ~48px"). */
export const RING_MIN = { long: 48, short: 24 }

/** Ring or pill for a box. */
export const layoutKind = (box: Rect): "ring" | "pill" =>
  Math.max(box.width, box.height) < RING_MIN.long || Math.min(box.width, box.height) < RING_MIN.short ? "pill" : "ring"

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high))

/**
 * The handles for a box (the selection's own bounds, page px). `view` is the part of the page on screen (page px: x 0,
 * y = the scroll, the pane's size): a handle that would be off it is kept `PANE_INSET` in, so an object half scrolled
 * out of sight keeps every button within reach (the Mac clamps them 14 points in). `edges` are the edge handles
 * wanted (a text box has only the sideways pair).
 */
export function handleLayout(box: Rect, options: { view?: Rect; edges?: Edge[] } = {}): HandleLayout {
  const kind = layoutKind(box)
  const view = options.view
  const keep = (id: HandleId, x: number, y: number): HandleSpot => view
    ? { id, x: clamp(x, view.x + PANE_INSET, view.x + view.width - PANE_INSET), y: clamp(y, view.y + PANE_INSET, view.y + view.height - PANE_INSET) }
    : { id, x, y }
  const left = box.x - OUTLINE_PAD, right = box.x + box.width + OUTLINE_PAD
  const top = box.y - OUTLINE_PAD, bottom = box.y + box.height + OUTLINE_PAD
  const midX = box.x + box.width / 2, midY = box.y + box.height / 2

  if (kind === "pill") {
    return {
      kind,
      spots: [
        keep("pill-turn", midX - PILL_SPACING / 2, bottom + PILL_REACH),
        keep("pill-resize", midX + PILL_SPACING / 2, bottom + PILL_REACH),
      ],
      stem: null,
    }
  }
  const wanted = options.edges ?? ["n", "e", "s", "w"]
  const all: [RingId, number, number][] = [
    ["nw", left, top], ["n", midX, top], ["ne", right, top], ["e", right, midY],
    ["se", right, bottom], ["s", midX, bottom], ["sw", left, bottom], ["w", left, midY],
  ]
  const spots = all
    .filter(([id]) => id.length === 2 || wanted.includes(id as Edge))
    .map(([id, x, y]) => keep(id, x, y))
  const rotate = keep("rotate", midX, top - ROTATE_REACH)
  spots.push(rotate)
  // The stem joins the rotate handle to the top edge, wherever the pane kept the handle.
  return { kind, spots, stem: { x: rotate.x, y1: Math.min(rotate.y, top), y2: top } }
}

/**
 * Which handle a point is on: the NEAREST one within `slop` px (a handle is a small mark with a bigger target, so the
 * eight of a small ring do not fight over a press between them), else null. The layer asks it as the pointer moves,
 * so leaving an object for a handle that stands half outside it does not put the handles away first.
 */
export function handleAt(layout: HandleLayout, point: Point, slop = 9): HandleId | null {
  let best: HandleId | null = null
  let reach = slop
  for (const spot of layout.spots) {
    const gap = distance(point, spot)
    if (gap <= reach) { best = spot.id; reach = gap }
  }
  return best
}

/** The pointer a handle shows. */
export function handleCursor(id: HandleId): string {
  switch (id) {
    case "nw": case "se": case "pill-resize": return "nwse-resize"
    case "ne": case "sw": return "nesw-resize"
    case "n": case "s": return "ns-resize"
    case "e": case "w": return "ew-resize"
    case "rotate": case "pill-turn": return "grab"
  }
}

/** What the tooltip says of a handle (the e2e hooks read `Resize` and `Turn`). */
export const handleTitle = (id: HandleId): string =>
  id === "rotate" || id === "pill-turn" ? "Turn" : "Resize"

// MARK: - Scaling

/** The point that stays where it is while `id` is dragged: the opposite corner, or the middle of the opposite edge. */
export function anchorOf(id: RingId | "pill-resize", box: Rect): Point {
  const left = box.x, right = box.x + box.width, top = box.y, bottom = box.y + box.height
  const midX = box.x + box.width / 2, midY = box.y + box.height / 2
  switch (id) {
    case "nw": return { x: right, y: bottom }
    case "ne": return { x: left, y: bottom }
    case "se": return { x: left, y: top }
    case "sw": return { x: right, y: top }
    case "n": return { x: midX, y: bottom }
    case "s": return { x: midX, y: top }
    case "e": return { x: left, y: midY }
    case "w": return { x: right, y: midY }
    case "pill-resize": return { x: midX, y: midY }
  }
}

/**
 * The scale a drag of a resize handle asks for, and the point it is about. A corner measures how much nearer to
 * or farther from the anchor the pointer is than it was at the press; an edge measures along its own axis only, so a
 * sideways drag of the east edge is not changed by where the pointer is vertically. Clamped as `scaleFactor` is.
 */
export function resizeBy(id: RingId | "pill-resize", box: Rect, from: Point, to: Point): { pivot: Point; factor: number } {
  const pivot = anchorOf(id, box)
  if (id !== "n" && id !== "s" && id !== "e" && id !== "w") return { pivot, factor: scaleFactor(from, to, pivot) }
  const along = (p: Point) => (id === "e" || id === "w" ? p.x : p.y)
  const before = along(from) - along(pivot)
  if (Math.abs(before) <= 1) return { pivot, factor: 1 }
  return { pivot, factor: Math.min(Math.max((along(to) - along(pivot)) / before, 0.05), 20) }
}

// MARK: - Stretching

/** The smallest a stretched node is left, in px as drawn (the same floor a hand can still pick it up by). */
export const MIN_NODE = { width: 24, height: 16 }

/** Which directions an object STRETCHES in (rather than scaling): only an unturned node or text box. */
export function stretchable(item: CanvasItem): { horizontal: boolean; vertical: boolean } {
  if (item.kind !== "shape") return { horizontal: false, vertical: false }
  const { kind, transform } = item.shape
  if (Math.abs(Math.sin(transform.rotation)) > 1e-6 || Math.cos(transform.rotation) < 0) return { horizontal: false, vertical: false }
  if (kind === "text") return { horizontal: true, vertical: false }
  return isNode(kind) ? { horizontal: true, vertical: true } : { horizontal: false, vertical: false }
}

/** The edge handles the selection should have: a lone stretchable object's own directions, else all four (they scale). */
export function edgesFor(items: CanvasItem[]): Edge[] {
  if (items.length === 1) {
    const only = items[0]!
    if (only.kind === "shape" && only.shape.kind === "text" && stretchable(only).horizontal) return ["e", "w"]
  }
  return ["n", "e", "s", "w"]
}

/** Whether dragging this edge of this selection stretches (one object, in a direction it stretches in). */
export function stretches(items: CanvasItem[], edge: Edge): boolean {
  if (items.length !== 1) return false
  const can = stretchable(items[0]!)
  return edge === "e" || edge === "w" ? can.horizontal : can.vertical
}

/**
 * One shape with `edge` moved `grow` px OUTWARD (screen px, from where the shape was when the drag began) and the
 * opposite edge held. Done in the shape's own box: `width` and `aspect` change, and the centre's transform takes half
 * of the move, so the box stays against the edge that did not move whatever scale the shape has. A text box's height
 * is the words' at the new width.
 */
export function stretchedItem(item: CanvasItem, edge: Edge, grow: number, frame: Size, measure: Measure): CanvasItem {
  if (item.kind !== "shape" || !stretches([item], edge) || frame.width <= 0 || frame.height <= 0) return item
  const shape = item.shape
  const scale = shape.transform.scale
  const width = shape.width * frame.width
  const height = width * shape.aspect
  const text = shape.kind === "text"
  const sideways = edge === "e" || edge === "w"
  // The edge that moves goes to `side` (+1 east / south, -1 west / north).
  const side = edge === "e" || edge === "s" ? 1 : -1
  let moved: number
  let next: { width: number; aspect: number }
  if (sideways) {
    const room = Math.max((text ? TEXT_BOX.minimumWidth : MIN_NODE.width) / scale, width + grow / scale)
    moved = (room - width) * scale
    next = { width: room / frame.width, aspect: text ? textBoxAspect(shape.label, room, measure) : height / room }
    if (text) {
      // The words' own height changed with the width: the top edge stays, so the box's centre moves with it.
      const asked = room * next.aspect
      const t = { ...shape.transform, dx: shape.transform.dx + side * moved / 2 / frame.width, dy: shape.transform.dy + (asked - height) * scale / 2 / frame.height }
      return { kind: "shape", shape: { ...shape, ...next, transform: t } }
    }
  } else {
    const room = Math.max(MIN_NODE.height / scale, height + grow / scale)
    moved = (room - height) * scale
    next = { width: shape.width, aspect: room / width }
  }
  const t = sideways
    ? { ...shape.transform, dx: shape.transform.dx + side * moved / 2 / frame.width }
    : { ...shape.transform, dy: shape.transform.dy + side * moved / 2 / frame.height }
  return { kind: "shape", shape: { ...shape, ...next, transform: t } }
}

/** `stretchedItem` for the one picked item of a drawing (the others, and a drawing without it, come back as they were). */
export function stretchedDrawing(items: CanvasItem[], id: string, edge: Edge, grow: number, frame: Size, measure: Measure): CanvasItem[] {
  return items.map((item) => itemId(item) === id ? stretchedItem(item, edge, grow, frame, measure) : item)
}

/** How far `to` is from `from` along an edge's outward direction (screen px): what `stretchedItem` is given as `grow`. */
export function outward(edge: Edge, from: Point, to: Point): number {
  switch (edge) {
    case "e": return to.x - from.x
    case "w": return from.x - to.x
    case "s": return to.y - from.y
    case "n": return from.y - to.y
  }
}
