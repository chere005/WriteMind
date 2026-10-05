/**
 * Edits to what is picked on the drawing layer that are not a move, a scale
 * or a turn: a new colour, width or fill; the heads and the line of an arrow;
 * a nudge; the order things are stacked in; a copy of some of them.
 *
 * The Mac has the first two of these (the arrow's style bar, and the pen's
 * colour for what is drawn next) and none of the rest. They are the port's
 * own additions, pure and tested like everything else, and none of them
 * changes a sidecar's format: a copy is made of the same items.
 */

import {
  itemId, itemTransform, newID, withTransform,
  type CanvasItem, type ConnectorHead, type ConnectorLine, type Drawing,
} from "./model"
import type { Size } from "./geometry"

/** What can be changed on a selection. Anything a kind cannot take is left out of it. */
export interface StylePatch {
  colorHex?: string
  /** The pen width of a stroke, the outline of a shape, the line of a connector. */
  lineWidth?: number
  /** Null takes the fill away. A shape takes it; nothing else does. */
  fillHex?: string | null
  startHead?: ConnectorHead
  endHead?: ConnectorHead
  line?: ConnectorLine
}

export const MIN_LINE_WIDTH = 0.5
export const MAX_LINE_WIDTH = 24

const clampWidth = (width: number): number =>
  Math.min(Math.max(width, MIN_LINE_WIDTH), MAX_LINE_WIDTH)

/** One item with the patch applied; the same object back when nothing in it applies. */
export function restyledItem(item: CanvasItem, patch: StylePatch): CanvasItem {
  switch (item.kind) {
    case "stroke": {
      const stroke = {
        ...item.stroke,
        ...(patch.colorHex !== undefined ? { colorHex: patch.colorHex } : {}),
        ...(patch.lineWidth !== undefined ? { width: clampWidth(patch.lineWidth) } : {}),
      }
      return stroke.colorHex === item.stroke.colorHex && stroke.width === item.stroke.width
        ? item : { kind: "stroke", stroke }
    }
    case "shape": {
      // A text box's width is the card's, and its fill is its card: both
      // apply. The words' colour comes from `colorHex`, checked against the
      // fill when it is painted.
      const shape = {
        ...item.shape,
        ...(patch.colorHex !== undefined ? { colorHex: patch.colorHex } : {}),
        ...(patch.lineWidth !== undefined ? { lineWidth: clampWidth(patch.lineWidth) } : {}),
        ...(patch.fillHex !== undefined ? { fillHex: patch.fillHex } : {}),
      }
      return shape.colorHex === item.shape.colorHex && shape.lineWidth === item.shape.lineWidth
        && shape.fillHex === item.shape.fillHex ? item : { kind: "shape", shape }
    }
    case "connector": {
      const connector = {
        ...item.connector,
        ...(patch.colorHex !== undefined ? { colorHex: patch.colorHex } : {}),
        ...(patch.lineWidth !== undefined ? { lineWidth: clampWidth(patch.lineWidth) } : {}),
        ...(patch.startHead !== undefined ? { startHead: patch.startHead } : {}),
        ...(patch.endHead !== undefined ? { endHead: patch.endHead } : {}),
        ...(patch.line !== undefined ? { line: patch.line } : {}),
      }
      const same = connector.colorHex === item.connector.colorHex
        && connector.lineWidth === item.connector.lineWidth
        && connector.startHead === item.connector.startHead
        && connector.endHead === item.connector.endHead
        && connector.line === item.connector.line
      return same ? item : { kind: "connector", connector }
    }
    case "image":
      return item
  }
}

/** The drawing with the patch applied to everything picked; the same drawing when nothing changed. */
export function restyled(drawing: Drawing, ids: Set<string>, patch: StylePatch): Drawing {
  let changed = false
  const items = drawing.items.map((item) => {
    if (!ids.has(itemId(item))) return item
    const next = restyledItem(item, patch)
    if (next !== item) changed = true
    return next
  })
  return changed ? { items } : drawing
}

/** Moved by view points (the arrow keys): the transform is in fractions of the pane. */
export function nudged(drawing: Drawing, ids: Set<string>, dx: number, dy: number, size: Size): Drawing {
  if (size.width <= 0 || size.height <= 0 || (dx === 0 && dy === 0)) return drawing
  return {
    items: drawing.items.map((item) => {
      if (!ids.has(itemId(item))) return item
      const t = itemTransform(item)
      return withTransform(item, { ...t, dx: t.dx + dx / size.width, dy: t.dy + dy / size.height })
    }),
  }
}

export type Order = "front" | "back" | "forward" | "backward"

/**
 * The stacking order after the picked items are brought to the front, sent to
 * the back, or stepped one place. The picked keep the order they had among
 * themselves; the same array back when nothing would move.
 */
export function reordered(items: CanvasItem[], ids: Set<string>, how: Order): CanvasItem[] {
  const picked = items.map((item) => ids.has(itemId(item)))
  if (!picked.some(Boolean) || picked.every(Boolean)) return items
  let out: CanvasItem[]
  if (how === "front") {
    out = [...items.filter((_, i) => !picked[i]), ...items.filter((_, i) => picked[i])]
  } else if (how === "back") {
    out = [...items.filter((_, i) => picked[i]), ...items.filter((_, i) => !picked[i])]
  } else {
    out = items.slice()
    const step = how === "forward" ? 1 : -1
    const order = how === "forward" ? [...out.keys()].reverse() : [...out.keys()]
    const flags = picked.slice()
    for (const index of order) {
      const target = index + step
      if (!flags[index] || target < 0 || target >= out.length || flags[target]) continue
      ;[out[index], out[target]] = [out[target]!, out[index]!]
      ;[flags[index], flags[target]] = [flags[target]!, flags[index]!]
    }
  }
  return out.every((item, i) => item === items[i]) ? items : out
}

/**
 * A copy of the picked items, ready to go on a clipboard or straight back on
 * the layer: new ids all through, groups kept (a group copied is a new
 * group), and an arrow that was attached to something that is NOT being
 * copied is let go of it, so a copy never reaches back to hold on to the
 * original.
 */
export function copiedItems(items: CanvasItem[], ids: Set<string>): CanvasItem[] {
  const picked = items.filter((item) => ids.has(itemId(item)))
  const fresh = new Map(picked.map((item) => [itemId(item), newID()]))
  const groups = new Map<string, string>()
  const regroup = (group: string | null): string | null => {
    if (group === null) return null
    if (!groups.has(group)) groups.set(group, newID())
    return groups.get(group)!
  }
  return picked.map((item): CanvasItem => {
    const id = fresh.get(itemId(item))!
    switch (item.kind) {
      case "stroke":
        return { kind: "stroke", stroke: { ...item.stroke, id, group: regroup(item.stroke.group),
          points: item.stroke.points.map((p) => ({ ...p })), transform: { ...item.stroke.transform } } }
      case "image":
        return { kind: "image", image: { ...item.image, id, group: regroup(item.image.group),
          center: { ...item.image.center }, transform: { ...item.image.transform } } }
      case "shape":
        return { kind: "shape", shape: { ...item.shape, id, group: regroup(item.shape.group),
          center: { ...item.shape.center }, transform: { ...item.shape.transform } } }
      case "connector": {
        const c = item.connector
        const startNode = c.startNode !== null ? (fresh.get(c.startNode) ?? null) : null
        const endNode = c.endNode !== null ? (fresh.get(c.endNode) ?? null) : null
        return { kind: "connector", connector: {
          ...c, id, startNode, endNode,
          start: { ...c.start }, end: { ...c.end }, bends: c.bends.map((p) => ({ ...p })),
          transform: { ...c.transform },
          ...(c.overrides ? { overrides: c.overrides.map((o) => ({ ...o })) } : {}),
        } }
      }
    }
  })
}

/** Items shifted by view points before they go down (a paste lands a little off the original). */
export function shifted(items: CanvasItem[], dx: number, dy: number, size: Size): CanvasItem[] {
  if (size.width <= 0 || size.height <= 0) return items
  return items.map((item) => {
    const t = itemTransform(item)
    return withTransform(item, { ...t, dx: t.dx + dx / size.width, dy: t.dy + dy / size.height })
  })
}
