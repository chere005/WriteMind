/**
 * What the next gesture on the pane puts down. Ported from
 * `WriteMind/Drawing/CanvasPlacement.swift`.
 *
 * A MARK IS PUT WHERE IT IS CLICKED, and not before. It arrives at one line
 * of text's worth of size, because what a tick is for is standing beside a
 * word; a drag still sizes it by hand.
 */

import {
  defaultAspect, inkHex, isNode, MARK_SIDE, type Point, type Rect, type ShapeKind,
} from "./shapes"
import { newID, type CanvasItem, type ConnectorHead, type ItemTransform } from "./model"
import type { Size } from "./geometry"

export type Placement =
  | { kind: "shape"; shape: ShapeKind }
  /**
   * `tool` is the Mac's "Draw arrows between nodes" switch: it stays armed
   * for any number of lines, and a line starts and ends ON nodes (attached),
   * where a palette line is just a line.
   */
  | { kind: "line"; start: ConnectorHead; end: ConnectorHead; tool?: boolean }

/** Under this, the drag was a click. */
export const DRAG_THRESHOLD = 4
/** Nothing smaller than this goes down: two points across is a slip of the hand. */
export const MINIMUM_SIDE = 12

export const isDrag = (from: Point, to: Point): boolean =>
  Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) >= DRAG_THRESHOLD

const transform = (): ItemTransform => ({ dx: 0, dy: 0, scale: 1, rotation: 0 })

/**
 * The box a drag puts the shape in. A node takes the rectangle that was
 * dragged; a mark keeps its square, anchored where the drag began and
 * growing the way it went, so a check mark is never stretched.
 */
export function placementBox(from: Point, to: Point, kind: ShapeKind, size: Size): Rect {
  if (!isDrag(from, to)) {
    // A node is a chart's box and takes a share of the pane; a mark is an
    // annotation and takes a line of the writing.
    const width = isNode(kind) ? 0.18 * size.width : MARK_SIDE
    const height = width * defaultAspect(kind)
    return { x: from.x - width / 2, y: from.y - height / 2, width, height }
  }
  if (isNode(kind)) {
    const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y)
    return {
      x, y,
      width: Math.max(Math.abs(to.x - from.x), MINIMUM_SIDE),
      height: Math.max(Math.abs(to.y - from.y), MINIMUM_SIDE),
    }
  }
  const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), MINIMUM_SIDE)
  return {
    x: to.x >= from.x ? from.x : from.x - side,
    y: to.y >= from.y ? from.y : from.y - side,
    width: side, height: side,
  }
}

/** The shape a drag makes, in the pane's fractions. */
export function placedShape(kind: ShapeKind, from: Point, to: Point, size: Size,
  colorHex: string, lineWidth: number): CanvasItem | null {
  if (size.width <= 1 || size.height <= 1) return null
  const box = placementBox(from, to, kind, size)
  // A mark the size of a line of text cannot carry the pen it was drawn
  // with: at eight points a tick in an eighteen-point box is a blob. The
  // BOX is what limits it, so one dragged out big takes the whole pen.
  const stroke = isNode(kind)
    ? Math.min(Math.max(lineWidth, 1.5), 4)
    : Math.min(Math.max(lineWidth, 1.5), Math.max(2, box.width * 0.16))
  return {
    kind: "shape",
    shape: {
      id: newID(),
      kind,
      center: { x: (box.x + box.width / 2) / size.width, y: (box.y + box.height / 2) / size.height },
      width: box.width / size.width,
      aspect: box.height / Math.max(box.width, 1),
      colorHex: inkHex(kind) ?? colorHex,
      lineWidth: stroke,
      fillHex: null,
      label: "",
      transform: transform(),
      group: null,
    },
  }
}

/**
 * The line a drag makes: it starts where the press went down and ends where
 * it came up. A press that never moved puts down NOTHING and leaves the
 * tool armed — it used to put down a short horizontal line centred on the
 * click, which is a different line from the one asked for, in a different
 * place.
 */
export function placedConnector(from: Point, to: Point, size: Size,
  startHead: ConnectorHead, endHead: ConnectorHead,
  colorHex: string, lineWidth: number): CanvasItem | null {
  if (size.width <= 1 || size.height <= 1) return null
  if (!isDrag(from, to)) return null
  return {
    kind: "connector",
    connector: {
      id: newID(),
      start: { x: from.x / size.width, y: from.y / size.height },
      end: { x: to.x / size.width, y: to.y / size.height },
      startNode: null, endNode: null,
      startHead, endHead,
      line: "solid",
      colorHex,
      lineWidth: Math.min(Math.max(lineWidth, 1.5), 6),
      transform: transform(),
      bends: [],
    },
  }
}

/** The object itself, ready to go on the layer. */
export function placedItem(placing: Placement, from: Point, to: Point, size: Size,
  colorHex: string, lineWidth: number): CanvasItem | null {
  return placing.kind === "shape"
    ? placedShape(placing.shape, from, to, size, colorHex, lineWidth)
    : placedConnector(from, to, size, placing.start, placing.end, colorHex, lineWidth)
}

export function placementTitle(placing: Placement): string {
  if (placing.kind === "shape") return placing.shape
  if (placing.start === "none" && placing.end === "none") return "Line"
  if (placing.start === "arrow" && placing.end === "arrow") return "Double-headed Arrow"
  return "Arrow"
}
