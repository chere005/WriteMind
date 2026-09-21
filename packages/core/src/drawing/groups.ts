/**
 * Holding several things on the drawing layer as one. Ported from
 * `WriteMind/Drawing/CanvasGroups.swift`.
 *
 * A group is nothing but a shared id on the objects in it. It changes what
 * a CLICK picks up and what a marquee brings with it; it does not move,
 * resize or reparent anything, which is why ungrouping leaves the page
 * looking exactly as it did.
 *
 * Every rule lives here and the canvas holds none of its own.
 */

import { itemGroup, itemId, newID, withGroup, type CanvasItem } from "./model"

/**
 * The selection grown to whole groups: pick one member and you have them
 * all. Objects in no group are themselves alone.
 */
export function whole(picked: Set<string>, items: CanvasItem[]): Set<string> {
  if (picked.size === 0) return picked
  const groups = new Set(items
    .filter((item) => picked.has(itemId(item)))
    .map(itemGroup)
    .filter((group): group is string => group !== null))
  if (groups.size === 0) return picked
  const out = new Set(picked)
  for (const item of items) {
    const group = itemGroup(item)
    if (group !== null && groups.has(group)) out.add(itemId(item))
  }
  return out
}

export type GroupToggle = "group" | "ungroup" | "nothing"

/**
 * One toggle: two or more objects that are not already one whole group
 * become a group; a selection that IS exactly one whole group comes apart.
 *
 * A selection spanning two groups therefore GROUPS — which is what lets a
 * bigger group be built out of smaller ones without unpicking them first.
 */
export function toggle(picked: Set<string>, items: CanvasItem[]): GroupToggle {
  const members = items.filter((item) => picked.has(itemId(item)))
  if (members.length <= 1) {
    // One object already in a group is the way OUT of a group of one —
    // which cannot be made, but can be left behind by a delete.
    if (members.length === 1 && itemGroup(members[0]!) !== null) return "ungroup"
    return "nothing"
  }
  const groups = new Set(members.map(itemGroup).filter((group): group is string => group !== null))
  if (groups.size === 1 && members.every((item) => itemGroup(item) !== null)) {
    const only = [...groups][0]!
    if (items.filter((item) => itemGroup(item) === only).length === members.length) return "ungroup"
  }
  return "group"
}

/**
 * `items` with everything picked put into one new group. Anything already
 * in another group is taken out of it and into this one — and the groups
 * being swallowed come WHOLE, so a member that was not itself picked is
 * not left behind in a group whose other half has gone.
 */
export function grouped(picked: Set<string>, items: CanvasItem[], id = newID()): CanvasItem[] {
  if (toggle(picked, items) !== "group") return items
  const swallowed = new Set(items
    .filter((item) => picked.has(itemId(item)))
    .map(itemGroup)
    .filter((group): group is string => group !== null))
  return items.map((item) => {
    const group = itemGroup(item)
    const mine = picked.has(itemId(item)) || (group !== null && swallowed.has(group))
    return mine ? withGroup(item, id) : item
  })
}

/** `items` with the picked group taken apart; anything else keeps its own. */
export function ungrouped(picked: Set<string>, items: CanvasItem[]): CanvasItem[] {
  const groups = new Set(items
    .filter((item) => picked.has(itemId(item)))
    .map(itemGroup)
    .filter((group): group is string => group !== null))
  if (groups.size === 0) return items
  return items.map((item) => {
    const group = itemGroup(item)
    return group !== null && groups.has(group) ? withGroup(item, null) : item
  })
}

/**
 * The one step the canvas calls: the items after ⌃G, and null when the
 * toggle had nothing to do — so a no-op never lands on the undo stack.
 */
export function toggled(picked: Set<string>, items: CanvasItem[], id = newID()): CanvasItem[] | null {
  switch (toggle(picked, items)) {
    case "group": return grouped(picked, items, id)
    case "ungroup": return ungrouped(picked, items)
    case "nothing": return null
  }
}
