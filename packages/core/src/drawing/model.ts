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

import { defaultAspect, type Point, type ShapeKind } from "./shapes"

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
}

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

/**
 * A sidecar read back, field by field, with a default for everything it has
 * not got — an older file must still open, and a decode that throws would
 * lose the whole drawing.
 */
export function readDrawing(json: string | null): Drawing {
  if (!json) return emptyDrawing()
  let parsed: { items?: unknown[]; strokes?: unknown[] }
  try {
    parsed = JSON.parse(json) as { items?: unknown[]; strokes?: unknown[] }
  } catch {
    return emptyDrawing()
  }
  const items: CanvasItem[] = []

  // The oldest sidecars are a bare list of strokes, and they still open.
  for (const raw of parsed.strokes ?? []) {
    const given = raw as Record<string, unknown>
    items.push({
      kind: "stroke",
      stroke: {
        id: text(given.id, newID()),
        colorHex: text(given.colorHex, "#1C1C1E"),
        width: number(given.width, 3),
        points: ((given.points as unknown[]) ?? []).map((p) => point(p, { x: 0, y: 0 })),
        transform: transformOf(given.transform),
        group: groupOf(given.group),
      },
    })
  }

  for (const raw of parsed.items ?? []) {
    const given = raw as Record<string, unknown>
    const kind = text(given.kind, "")
    if (kind === "stroke") {
      items.push({
        kind: "stroke",
        stroke: {
          id: text(given.id, newID()),
          colorHex: text(given.colorHex, "#1C1C1E"),
          width: number(given.width, 3),
          points: ((given.points as unknown[]) ?? []).map((p) => point(p, { x: 0, y: 0 })),
          transform: transformOf(given.transform),
          group: groupOf(given.group),
        },
      })
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
      const shapeKind = text(given.shapeKind ?? given.kindName, "rectangle") as ShapeKind
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
          startHead: (text(given.startHead, "none") as ConnectorHead),
          endHead: (text(given.endHead, "arrow") as ConnectorHead),
          line: (text(given.line, "solid") as ConnectorLine),
          colorHex: text(given.colorHex, "#1C1C1E"),
          lineWidth: number(given.lineWidth, 2),
          transform: transformOf(given.transform),
          bends: ((given.bends as unknown[]) ?? []).map((p) => point(p, { x: 0, y: 0 })),
        },
      })
    }
  }
  return { items }
}

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
