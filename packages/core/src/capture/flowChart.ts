/**
 * A flow chart sketched on paper, read off the page as real nodes and
 * arrows.
 *
 * Ported from `WriteMind/Camera/FlowChartReading.swift`. Two readings are put
 * together here, because each is better at half the job. `readFlow` finds
 * the nodes as HOLES — the paper a drawn box encloses — which is the only
 * way that survives an arrow touching the box it points at, and it works out
 * which words are whose label and which arrow joins which pair. `readShape`
 * then names each one and, more importantly, REFUSES the ones that are not
 * shapes. A sketch that comes in as the wrong shapes is worse than one that
 * comes in as ink.
 */

import type { Size } from "../drawing/geometry"
import { newID, noTransform, type CanvasItem, type ConnectorItem, type ShapeItem } from "../drawing/model"
import type { Rect, ShapeKind } from "../drawing/shapes"
import {
  FlowPlacement, isFlowNode, readFlow, type FlowWord,
} from "./flowGrouping"
import type { Component } from "./ink"
import { rectMidX, rectMidY } from "./rects"
import { readShape } from "./shapeInk"

/**
 * The kinds allowed onto the page: the four node shapes a flow chart is
 * drawn with, plus the triangle and the parallelogram. A TICK, A CROSS AND A
 * STAR STAY OUT: they are marks in a note rather than objects in a chart, and
 * the app already reads them as marks (a tick in a drawn box is a task item).
 */
export const SHIPPED_KINDS: ReadonlySet<ShapeKind> = new Set<ShapeKind>(
  ["rectangle", "roundedRectangle", "oval", "diamond", "triangle", "parallelogram"])

/** Above this it is a printed diagram or a screenshot, not a sketch. */
export const MAXIMUM_NODES = 12

/**
 * A drawn rectangle stood on its point IS a diamond, so the lean is the only
 * thing between them. Under 8° it is a rectangle, over 25° a diamond, and in
 * between nothing is emitted at all.
 */
export const RECTANGLE_LEAN = 8
export const DIAMOND_LEAN = 25

/** The classifier's verdict, or null when it will not name it. */
export function namedShape(blob: Component, shortSide: number, lean: number): ShapeKind | null {
  const reading = readShape(blob, shortSide)
  const kind = reading.kind as string as ShapeKind
  if (!SHIPPED_KINDS.has(kind)) return null
  const tilt = Math.abs(lean)
  switch (kind) {
    case "diamond": return tilt >= DIAMOND_LEAN ? "diamond" : null
    case "rectangle": case "roundedRectangle": return tilt <= RECTANGLE_LEAN ? kind : null
    default: return kind
  }
}

/** The ink inside a box, as one component for the classifier to read. */
export function componentOf(box: Rect, ink: Uint8Array, width: number, height: number): Component | null {
  const x0 = Math.max(0, Math.trunc(box.x)), x1 = Math.min(width, Math.ceil(box.x + box.width))
  const y0 = Math.max(0, Math.trunc(box.y)), y1 = Math.min(height, Math.ceil(box.y + box.height))
  if (!(x1 > x0 && y1 > y0)) return null
  const pixels: number[] = []
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!ink[y * width + x]) continue
      pixels.push(y * width + x)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0 || pixels.length === 0) return null
  return { stride: width, minX, minY, maxX, maxY, pixels }
}

/**
 * The chart on a page, or nothing at all. `ink` is the writing mask (0/1),
 * `words` what the recogniser read (boxes in mask pixels), and `pane` the
 * page the objects land on.
 */
export function flowChartItems(ink: Uint8Array, width: number, height: number, words: FlowWord[],
  pane: Size, colorHex: string, lineWidth: number): CanvasItem[] {
  if (!(width > 8 && height > 8 && ink.length === width * height && pane.width > 1 && pane.height > 1)) {
    return []
  }

  const sheet = readFlow(ink, width, height, words)
  const shortSide = Math.min(width, height)

  // Every candidate is named again by the classifier, over the ink inside
  // its outline. Anything it will not name is dropped.
  const kinds = new Map<number, ShapeKind>()
  sheet.nodes.forEach((node, index) => {
    if (!isFlowNode(node)) return
    const blob = componentOf(node.box, ink, width, height)
    if (blob === null) return
    const kind = namedShape(blob, shortSide, node.skew)
    if (kind === null) return
    kinds.set(index, kind)
  })
  if (kinds.size === 0 || kinds.size > MAXIMUM_NODES) return []

  const placement = new FlowPlacement(pane, { width, height })
  const ids = new Map<number, string>()
  const nodes: CanvasItem[] = []
  for (const index of [...kinds.keys()].sort((p, q) => p - q)) {
    const node = sheet.nodes[index]!
    const id = newID()
    ids.set(index, id)
    const shape: ShapeItem = {
      id, kind: kinds.get(index)!,
      center: placement.fraction({ x: rectMidX(node.box), y: rectMidY(node.box) }),
      width: placement.widthFraction(node.box.width),
      aspect: node.box.height / Math.max(node.box.width, 1),
      colorHex, lineWidth, fillHex: null, label: node.label,
      transform: noTransform(), group: null,
    }
    nodes.push({ kind: "shape", shape })
  }

  // A line with nothing at either end is an underline or a rule, not a
  // connector.
  const edges: CanvasItem[] = []
  for (const edge of sheet.edges) {
    if (edge.from === null || edge.to === null) continue
    const startID = ids.get(edge.from), endID = ids.get(edge.to)
    if (startID === undefined || endID === undefined || startID === endID) continue
    // A head is only drawn where the barb was actually seen. A guessed
    // direction silently inverts what the chart means.
    const connector: ConnectorItem = {
      id: newID(),
      start: placement.fraction(edge.tail), end: placement.fraction(edge.head),
      startNode: startID, endNode: endID,
      startHead: edge.headAtStart ? "arrow" : "none",
      endHead: edge.headAtEnd ? "arrow" : "none",
      line: "solid",
      colorHex, lineWidth: Math.min(Math.max(lineWidth, 1.5), 6),
      transform: noTransform(), bends: [],
    }
    edges.push({ kind: "connector", connector })
  }

  // A single ring on a page of prose is a doodle or a word circled for
  // emphasis. A chart is two boxes, or one box with an arrow on it.
  if (!(nodes.length >= 2 || (nodes.length === 1 && edges.length > 0))) return []
  return [...nodes, ...edges]
}

/**
 * The same objects, moved and scaled into one box of the pane — a chart read
 * off a picture lands under that picture, not across the whole page.
 */
export function placeFlowItems(items: CanvasItem[], box: Rect, pane: Size): CanvasItem[] {
  if (!(pane.width > 1 && pane.height > 1 && box.width > 1 && box.height > 1)) return items
  const scaleX = box.width / pane.width, scaleY = box.height / pane.height
  const originX = box.x / pane.width, originY = box.y / pane.height
  const moved = (p: { x: number; y: number }) => ({ x: originX + p.x * scaleX, y: originY + p.y * scaleY })
  return items.map((item): CanvasItem => {
    switch (item.kind) {
      case "shape": {
        const shape = item.shape
        return {
          kind: "shape",
          shape: {
            ...shape,
            center: moved(shape.center),
            width: shape.width * scaleX,
            // The box changes shape as well as size, so the aspect has to be
            // corrected or every node comes out stretched.
            aspect: shape.aspect * (scaleY / Math.max(scaleX, 0.0001)),
          },
        }
      }
      case "connector": {
        const c = item.connector
        return {
          kind: "connector",
          connector: { ...c, start: moved(c.start), end: moved(c.end), bends: c.bends.map(moved) },
        }
      }
      default: return item
    }
  })
}
