/**
 * THE INSPECTOR: the one bar that stands over a picked object (Sean's wireframe, 2026-10-10,
 * docs/ui-2026-10/FinalTablet.png: "Rectangle | colour | width | fill | Aa | order | dock | copy | delete"). It
 * replaces the six glyph discs and the separate style bar. This file is the part of it that is a rule: WHERE it stands
 * (above the object, below it when there is no room above, kept on the pane, never over the object) and WHICH
 * controls a given pick has. Pure — no React, no DOM — so the tests ask it directly and Inspector.tsx only draws it.
 */

import {
  isNode, itemId, shapeTitle, type CanvasItem, type Point, type Rect, type Size,
} from "@writemind/core"

// MARK: - Where it stands

/** The bar keeps this far from the pane's edges. */
export const BAR_MARGIN = 8
/** The air between the bar and what it stands over. */
export const BAR_GAP = 8

export interface BarSpot {
  /** In the pane's own px (the bar's top-left). */
  left: number
  top: number
  /** Where it ended up: over the object, under it, or (nothing else fits) pinned to the top of the pane over it. */
  side: "above" | "below" | "over"
}

const meets = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * The bar's place for an object whose box is `target` (pane px: scroll already taken out), the bar being `bar` big.
 *
 * ABOVE, centred on the object, when it fits — `reserveAbove` is what stands over the object's top edge already (the
 * rotate handle and its stem), so the bar clears it. Else BELOW, `reserveBelow` clearing the pill. Else, on a pane
 * the object fills (a tall picture, an object half scrolled off), the bar is pinned to the pane's top, which is the
 * one case it can cover the object. `prefer` flips the order (an arrow that arrives from above has its bar below).
 * Horizontally it is centred on the object and clamped to the pane, left first when the pane is narrower than the bar.
 *
 * `avoid` are boxes the bar must not cover either (the arrow just drawn and the nodes it joins): a side that would lie
 * on one is passed over, and with `alternatives` the bar may also stand flush with the target's left or right edge, or
 * wholly beside it, instead of centred, on either side, before it gives up on avoiding.
 */
export function inspectorSpot(args: {
  target: Rect
  bar: Size
  pane: Size
  reserveAbove?: number
  reserveBelow?: number
  prefer?: "above" | "below"
  avoid?: Rect[]
  alternatives?: boolean
}): BarSpot {
  const { target, bar, pane } = args
  const above = args.reserveAbove ?? 0
  const below = args.reserveBelow ?? 0
  const topAbove = Math.round(target.y - above - BAR_GAP - bar.height)
  const topBelow = Math.round(target.y + target.height + below + BAR_GAP)
  const fitsAbove = topAbove >= BAR_MARGIN
  const fitsBelow = topBelow + bar.height <= pane.height - BAR_MARGIN
  const onPane = (left: number): number => Math.round(Math.max(BAR_MARGIN, Math.min(left, pane.width - bar.width - BAR_MARGIN)))
  const lefts = [onPane(target.x + target.width / 2 - bar.width / 2)]
  if (args.alternatives) {
    // Flush with the target's edges, then wholly beside it (to its right, to its left): a point has nothing to be flush with.
    lefts.push(onPane(target.x), onPane(target.x + target.width - bar.width),
      onPane(target.x + target.width + 4), onPane(target.x - bar.width - 4))
  }
  const sides: ("above" | "below")[] = args.prefer === "below" ? ["below", "above"] : ["above", "below"]
  const clear = (left: number, top: number): boolean =>
    !(args.avoid ?? []).some((box) => meets({ x: left, y: top, width: bar.width, height: bar.height }, box))
  // First a place that fits the pane and lies on nothing to avoid; then, ignoring what to avoid, the first that fits.
  for (const careful of [true, false]) {
    for (const left of lefts) {
      for (const side of sides) {
        const top = side === "above" ? topAbove : topBelow
        if (!(side === "above" ? fitsAbove : fitsBelow)) continue
        if (careful && !clear(left, top)) continue
        return { left, top, side }
      }
    }
  }
  return { left: lefts[0]!, top: BAR_MARGIN, side: "over" }
}

/** The box an arrow's end stands in for (a small square round it), so the bar clears the head: see `inspectorSpot`. */
export const pointBox = (point: Point, half = 10): Rect =>
  ({ x: point.x - half, y: point.y - half, width: half * 2, height: half * 2 })

/** The side of an arrow's end the compact bar goes: opposite to where the arrow comes from, so it never lies on the line. */
export const sideAwayFrom = (start: Point, end: Point): "above" | "below" => (end.y >= start.y ? "below" : "above")

// MARK: - What it holds

export type Control =
  | "colour" | "width" | "fill" | "label" | "heads" | "order" | "crop" | "read" | "dock" | "group" | "duplicate" | "delete"

export interface InspectorPlan {
  /** What the bar calls the pick ("Rectangle", "Picture", "3 objects"). */
  name: string
  /** The controls in order, in groups (a hairline between groups). */
  groups: Control[][]
}

/** The name the bar shows for a pick. */
export function inspectorName(items: CanvasItem[]): string {
  if (items.length !== 1) return `${items.length} objects`
  const only = items[0]!
  switch (only.kind) {
    case "stroke": return "Stroke"
    case "image": return "Picture"
    case "shape": return shapeTitle(only.shape.kind)
    case "connector": return only.connector.endHead === "none" && only.connector.startHead === "none" ? "Line" : "Arrow"
    case "cell": return "Drawing cell"
  }
}

export interface PlanContext {
  /** The pick can go into the note (the page's, and the editor can take it): the dock control. */
  docks: boolean
  /** The platform can read words out of a picture (capabilities): a picture's Aa. */
  reads: boolean
  /** What `toggle` says Group would do for the pick. */
  grouping: "group" | "ungroup" | "nothing"
  /** A crop or a label is being edited: the destructive control stays out of the way. */
  editing: boolean
  /** The arrow tool has just drawn this arrow: its heads row alone. */
  compact: boolean
}

const hasColour = (item: CanvasItem): boolean => item.kind !== "image" && item.kind !== "cell"
const hasWidth = (item: CanvasItem): boolean =>
  item.kind === "stroke" || item.kind === "connector" || (item.kind === "shape" && item.shape.kind !== "text")
const hasFill = (item: CanvasItem): boolean => item.kind === "shape" && (isNode(item.shape.kind) || item.shape.kind === "text")

/**
 * The controls a pick has. One object: its name, then colour / width / fill where they mean something, its words (Aa:
 * a node's or a text box's label, or reading a picture), the heads of an arrow, the order, the dock, a copy and the
 * delete. Several: Group or Ungroup, the order, a copy, the delete. The compact bar (an arrow just drawn) is the heads
 * row only. The delete is left out while a crop or a label is being edited.
 */
export function inspectorPlan(items: CanvasItem[], context: PlanContext): InspectorPlan {
  const name = inspectorName(items)
  if (items.length === 0) return { name, groups: [] }
  if (context.compact && items.length === 1 && items[0]!.kind === "connector") return { name, groups: [["heads"]] }
  const tail: Control[] = context.editing ? ["duplicate"] : ["duplicate", "delete"]
  if (items.length > 1) {
    const groups: Control[][] = []
    if (context.grouping !== "nothing") groups.push(["group"])
    groups.push(["order"], tail)
    return { name, groups }
  }
  const only = items[0]!
  const look: Control[] = []
  if (hasColour(only)) look.push("colour")
  if (hasWidth(only)) look.push("width")
  if (hasFill(only)) look.push("fill")
  const words: Control[] = []
  if (only.kind === "shape") words.push("label")
  if (only.kind === "image") { words.push("crop"); if (context.reads) words.push("read") }
  const groups: Control[][] = []
  if (look.length > 0) groups.push(look)
  if (only.kind === "connector") groups.push(["heads"])
  if (words.length > 0) groups.push(words)
  const place: Control[] = ["order"]
  if (context.docks) place.push("dock")
  groups.push(place, tail)
  return { name, groups }
}

/** Whether the pick gets the eight handles and the rotate handle: not a pick of arrows alone (they have their ends). */
export const wantsRing = (items: CanvasItem[]): boolean => items.some((item) => item.kind !== "connector")

/** The ids of a pick's items, the way the bar keys its state. */
export const pickKey = (items: CanvasItem[]): string => items.map(itemId).sort().join(",")

// MARK: - Its size, before it is measured

/** What a control is wide, for the first paint (the bar is measured once it is up and placed again). */
export const CONTROL_WIDTH = 30
export const NAME_WIDTH_PER_CHAR = 7.2

/** The bar's width as the plan says it will be: the name, each control, a hairline between groups. */
export function estimatedWidth(plan: InspectorPlan): number {
  const buttons = plan.groups.reduce((sum, group) => sum + group.length * CONTROL_WIDTH + (group.includes("heads") ? 130 : 0), 0)
  const rules = Math.max(0, plan.groups.length - 1) * 13
  const name = plan.name === "" || plan.groups[0]?.[0] === "heads" ? 0 : plan.name.length * NAME_WIDTH_PER_CHAR + 22
  return Math.round(buttons + rules + name + 12)
}

export const BAR_HEIGHT = 40
