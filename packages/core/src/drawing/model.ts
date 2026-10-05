/**
 * The objects on the drawing layer, and the sidecar they live in. Ported
 * from `WriteMind/Drawing/Drawing.swift`.
 *
 * NOTHING HERE MOVES THE TEXT. Objects float: no exclusion band, no
 * per-cell push, no anchor, no bracket. Everything is stored normalised to
 * the pane (0…1 both ways) and drawn in view points, and the transform is
 * applied about the item's own centre IN POINTS, so a rotated stroke keeps
 * its shape whatever the pane's aspect ratio is.
 *
 * A DEFAULT IS NOT A DECODING DEFAULT: the Swift side had to write
 * `init(from:)` by hand with `decodeIfPresent` because a sidecar written
 * before a property existed would otherwise fail to decode and the whole
 * drawing would vanish. `readDrawing` below is that same discipline —
 * every field is filled in from a default when the file has not got it, and
 * an unreadable sidecar is an empty drawing rather than a thrown error.
 */

import { readPressures } from "./pen"
import { defaultAspect, isShapeKind, type Point, type ShapeKind } from "./shapes"

export interface ItemTransform {
  /** Fractions of the pane. */
  dx: number
  dy: number
  scale: number
  /** Radians. */
  rotation: number
}

export const noTransform = (): ItemTransform => ({ dx: 0, dy: 0, scale: 1, rotation: 0 })

export interface Stroke {
  id: string
  colorHex: string
  width: number
  /** Normalised 0…1 points. */
  points: Point[]
  /** A pen's pressure, 0…1, one per point; absent for a mouse stroke. */
  pressures?: number[]
  transform: ItemTransform
  group: string | null
}

export interface ImageItem {
  id: string
  /** A file in `.drawings/media`. */
  file: string
  center: Point
  /** Width as a fraction of the pane's width; the height follows `aspect`. */
  width: number
  /** Height over width. */
  aspect: number
  transform: ItemTransform
  /** A picture read into words is put away, not thrown away. */
  hidden: boolean
  group: string | null
}

export interface ShapeItem {
  id: string
  kind: ShapeKind
  center: Point
  width: number
  aspect: number
  colorHex: string
  lineWidth: number
  fillHex: string | null
  /** What a node says. Marks have none. */
  label: string
  transform: ItemTransform
  group: string | null
}

export type ConnectorHead = "none" | "arrow"
export type ConnectorLine = "solid" | "dashed" | "dotted"

export interface ConnectorItem {
  id: string
  start: Point
  end: Point
  startNode: string | null
  endNode: string | null
  startHead: ConnectorHead
  endHead: ConnectorHead
  line: ConnectorLine
  colorHex: string
  lineWidth: number
  transform: ItemTransform
  /** The corners between the ends, for a line attached to a node. */
  bends: Point[]
  /**
   * The segments that were dragged by hand, and where they were put. They
   * win over the routing ("its final drag is where it goes"). Absent in an
   * older sidecar; read as none.
   */
  overrides?: SegmentOverride[]
}

/**
 * One segment moved by hand: which one, which way it ran, and the coordinate
 * it was left at, as a fraction of the pane. `vertical` is true when the
 * segment ran up and down, so `value` is an x.
 */
export interface SegmentOverride {
  index: number
  vertical: boolean
  value: number
}

/** A line with an end on a node is routed; one floating free is not. */
export const isRouted = (c: { startNode: string | null; endNode: string | null }): boolean =>
  c.startNode !== null || c.endNode !== null

export type CanvasItem =
  | { kind: "stroke"; stroke: Stroke }
  | { kind: "image"; image: ImageItem }
  | { kind: "shape"; shape: ShapeItem }
  | { kind: "connector"; connector: ConnectorItem }

export interface Drawing { items: CanvasItem[] }

export const emptyDrawing = (): Drawing => ({ items: [] })

export function itemId(item: CanvasItem): string {
  switch (item.kind) {
    case "stroke": return item.stroke.id
    case "image": return item.image.id
    case "shape": return item.shape.id
    case "connector": return item.connector.id
  }
}

export function itemTransform(item: CanvasItem): ItemTransform {
  switch (item.kind) {
    case "stroke": return item.stroke.transform
    case "image": return item.image.transform
    case "shape": return item.shape.transform
    case "connector": return item.connector.transform
  }
}

export function withTransform(item: CanvasItem, transform: ItemTransform): CanvasItem {
  switch (item.kind) {
    case "stroke": return { kind: "stroke", stroke: { ...item.stroke, transform } }
    case "image": return { kind: "image", image: { ...item.image, transform } }
    case "shape": return { kind: "shape", shape: { ...item.shape, transform } }
    case "connector": return { kind: "connector", connector: { ...item.connector, transform } }
  }
}

/** A connector is held by the nodes at its ends, so it is in no group. */
export function itemGroup(item: CanvasItem): string | null {
  switch (item.kind) {
    case "stroke": return item.stroke.group
    case "image": return item.image.group
    case "shape": return item.shape.group
    case "connector": return null
  }
}

export function withGroup(item: CanvasItem, group: string | null): CanvasItem {
  switch (item.kind) {
    case "stroke": return { kind: "stroke", stroke: { ...item.stroke, group } }
    case "image": return { kind: "image", image: { ...item.image, group } }
    case "shape": return { kind: "shape", shape: { ...item.shape, group } }
    case "connector": return item
  }
}

export const isHidden = (item: CanvasItem): boolean =>
  item.kind === "image" && item.image.hidden

export const visibleItems = (drawing: Drawing): CanvasItem[] =>
  drawing.items.filter((item) => !isHidden(item))

/**
 * The part of a pick that is still there to be picked: an id whose object was undone away, deleted, erased or
 * put away (a picture read into words) is no pick at all, and keys must not be answered for it. The same Set
 * comes back when every id is live, so a caller can tell by identity that nothing changed.
 */
export function stillPicked(drawing: Drawing, picked: Set<string>): Set<string> {
  if (picked.size === 0) return picked
  const live = new Set<string>()
  for (const item of drawing.items) {
    if (isHidden(item)) continue
    const id = itemId(item)
    if (picked.has(id)) live.add(id)
  }
  return live.size === picked.size ? picked : live
}

export function itemWithID(drawing: Drawing, id: string): CanvasItem | null {
  return drawing.items.find((item) => itemId(item) === id) ?? null
}

/** Deleting takes the arrows attached to what goes with it. */
export function removing(drawing: Drawing, ids: Set<string>): Drawing {
  const gone = new Set(ids)
  const items = drawing.items.filter((item) => {
    if (gone.has(itemId(item))) return false
    if (item.kind === "connector") {
      const { startNode, endNode } = item.connector
      if ((startNode && gone.has(startNode)) || (endNode && gone.has(endNode))) return false
    }
    return true
  })
  return { items }
}

/** A new id. `crypto.randomUUID` is in both the renderer and Node. */
export const newID = (): string => crypto.randomUUID()

// MARK: - The sidecar

const point = (value: unknown, fallback: Point): Point => {
  const given = value as Partial<Point> | undefined
  return {
    x: typeof given?.x === "number" ? given.x : fallback.x,
    y: typeof given?.y === "number" ? given.y : fallback.y,
  }
}

const number = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback

const transformOf = (value: unknown): ItemTransform => {
  const given = (value ?? {}) as Partial<ItemTransform>
  return {
    dx: number(given.dx, 0),
    dy: number(given.dy, 0),
    scale: number(given.scale, 1),
    rotation: number(given.rotation, 0),
  }
}

const groupOf = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A list that is a list: anything else (a file with "points": "x") is no list at all. */
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** One of the words a field may hold, or the default when it holds any other. */
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

const HEADS: readonly ConnectorHead[] = ["none", "arrow"]
const LINES: readonly ConnectorLine[] = ["solid", "dashed", "dotted"]

const strokeOf = (given: Record<string, unknown>): Stroke => {
  const points = list(given.points)
  return {
    id: text(given.id, newID()),
    colorHex: text(given.colorHex, "#1C1C1E"),
    width: number(given.width, 3),
    points: points.map((p) => point(p, { x: 0, y: 0 })),
    pressures: readPressures(given.pressures, points.length),
    transform: transformOf(given.transform),
    group: groupOf(given.group),
  }
}

/** What reading a sidecar found, beyond the drawing: whether anything had to be thrown away to make it. */
export interface DecodedDrawing {
  drawing: Drawing
  /**
   * The file had something in it and it was not all usable: it is not JSON (a truncated write), it is JSON of
   * another shape, or some of its items were thrown away (null, not an object, a kind this build does not
   * know). The next save would write the smaller drawing over it, so the caller keeps a copy first
   * (Recovered, the same as a save that failed). A blank file, or one that read in full, is not damaged.
   */
  damaged: boolean
  /** How many items were thrown away. */
  dropped: number
}

/**
 * A sidecar read back, field by field, with a default for everything it has
 * not got — an older file must still open, and a decode that throws would
 * lose the whole drawing. TOTAL: whatever the text holds (a BOM in front of
 * it, null, a list where an object belongs, an item that is null, a stroke
 * whose points are a string) this returns a drawing and never throws, because
 * a throw here, in the middle of opening a note, used to leave the NEW note on
 * screen with the PREVIOUS note's drawing (which the next stroke then saved
 * into the new note's file).
 */
export function decodeDrawing(json: string | null): DecodedDrawing {
  if (json === null || json.trim() === "") return { drawing: emptyDrawing(), damaged: false, dropped: 0 }
  // Windows PowerShell 5.1 writes a byte-order mark with -Encoding UTF8.
  const body = json.charCodeAt(0) === 0xfeff ? json.slice(1) : json
  const lost = (): DecodedDrawing => ({ drawing: emptyDrawing(), damaged: true, dropped: 0 })
  try {
    const parsed: unknown = JSON.parse(body)
    // null, a number, a list: JSON, but not a sidecar.
    if (!isRecord(parsed)) return lost()
    const items: CanvasItem[] = []
    let dropped = 0
    let damaged = false
    if (parsed.items !== undefined && !Array.isArray(parsed.items)) damaged = true
    if (parsed.strokes !== undefined && !Array.isArray(parsed.strokes)) damaged = true

    // The oldest sidecars are a bare list of strokes, and they still open.
    for (const raw of list(parsed.strokes)) {
      if (!isRecord(raw) || list(raw.points).length === 0) { dropped++; continue }
      items.push({ kind: "stroke", stroke: strokeOf(raw) })
    }

    for (const raw of list(parsed.items)) {
      if (!isRecord(raw)) { dropped++; continue }
      const given = raw
      const kind = text(given.kind, "")
      if (kind === "stroke") {
        // (A stroke with no points has no ink to draw, hit or save.)
        if (list(given.points).length === 0) { dropped++; continue }
        items.push({ kind: "stroke", stroke: strokeOf(given) })
      } else if (kind === "image") {
        items.push({
          kind: "image",
          image: {
            id: text(given.id, newID()),
            file: text(given.file, ""),
            center: point(given.center, { x: 0.5, y: 0.5 }),
            width: number(given.width, 0.35),
            aspect: number(given.aspect, 1),
            transform: transformOf(given.transform),
            hidden: given.hidden === true,
            group: groupOf(given.group),
          },
        })
      } else if (kind === "shape") {
        // A kind from a newer build (a hexagon, say) is not one we can draw: it comes in as a rectangle in
        // the same box, with its words, rather than as a name the painter would throw on (which left every
        // object after it unpainted, and still pickable).
        const named = given.shapeKind ?? given.kindName
        const shapeKind: ShapeKind = isShapeKind(named) ? named : "rectangle"
        items.push({
          kind: "shape",
          shape: {
            id: text(given.id, newID()),
            kind: shapeKind,
            center: point(given.center, { x: 0.5, y: 0.5 }),
            width: number(given.width, 0.18),
            aspect: number(given.aspect, defaultAspect(shapeKind)),
            colorHex: text(given.colorHex, "#1C1C1E"),
            lineWidth: number(given.lineWidth, 2),
            fillHex: typeof given.fillHex === "string" ? given.fillHex : null,
            label: text(given.label, ""),
            transform: transformOf(given.transform),
            group: groupOf(given.group),
          },
        })
      } else if (kind === "connector") {
        items.push({
          kind: "connector",
          connector: {
            id: text(given.id, newID()),
            start: point(given.start, { x: 0.3, y: 0.5 }),
            end: point(given.end, { x: 0.7, y: 0.5 }),
            startNode: groupOf(given.startNode),
            endNode: groupOf(given.endNode),
            startHead: oneOf(given.startHead, HEADS, "none"),
            endHead: oneOf(given.endHead, HEADS, "arrow"),
            line: oneOf(given.line, LINES, "solid"),
            colorHex: text(given.colorHex, "#1C1C1E"),
            lineWidth: number(given.lineWidth, 2),
            transform: transformOf(given.transform),
            bends: list(given.bends).map((p) => point(p, { x: 0, y: 0 })),
            // Present only when a hand dragged a segment, so a plain line
            // reads back exactly as it was written.
            ...(Array.isArray(given.overrides) && given.overrides.length > 0
              ? {
                overrides: (given.overrides as unknown[]).map((o) => {
                  const given2 = isRecord(o) ? o : {}
                  return {
                    index: number(given2.index, 0),
                    vertical: given2.vertical === true,
                    value: number(given2.value, 0),
                  }
                }),
              }
              : {}),
          },
        })
      } else {
        dropped++
      }
    }
    return { drawing: { items }, damaged: damaged || dropped > 0, dropped }
  } catch {
    // Not reachable by any text the checks above let through, and kept anyway: this function's one promise
    // is that it returns.
    return lost()
  }
}

/** The drawing alone (see decodeDrawing, which also says whether anything was thrown away). */
export const readDrawing = (json: string | null): Drawing => decodeDrawing(json).drawing

/** And written back, flat, with the kind named so the reader can tell them apart. */
export function writeDrawing(drawing: Drawing): string {
  const items = drawing.items.map((item) => {
    switch (item.kind) {
      case "stroke": return { kind: "stroke", ...item.stroke }
      case "image": return { kind: "image", ...item.image }
      // The shape's own kind is written beside the item's, because both
      // are called "kind" and only one of them says "this is a shape".
      case "shape": return { ...item.shape, kind: "shape", shapeKind: item.shape.kind }
      case "connector": return { kind: "connector", ...item.connector }
    }
  })
  return JSON.stringify({ items }, null, 1)
}
