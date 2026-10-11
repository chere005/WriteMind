/**
 * REARRANGING TABS, as plain data (no React, no DOM): where a tab goes when it is moved, which slot a dragged tab belongs
 * in, how far each tab steps aside to make room, and how fast a drag held at the row's edge scrolls it. Three rows of
 * tabs use it — the notebook's open notes (TabBar.tsx, App.tsx `open`), the tablet's sheets (tabletSheets.ts) and the
 * camera's kept pages (scanTabs.ts) — and `tabDrag.ts` is the pointer half that feeds it (test/tabOrder.test.ts).
 *
 * THE ORDER IS THE ARRANGEMENT OF THE WINDOW, not an edit: moving a tab writes nothing to a note and is no undo step.
 * What is in front is named by an id (the note's path, the sheet's id), never by a place, so a tab that moves takes its
 * "in front" with it and a tab that is passed keeps its own.
 */

/**
 * `list` with the item at `from` taken out and put back so that it ends at slot `to` (the place it will have in the new
 * list, clamped to the list). The SAME array when nothing moves (a place that is not there, or the place it has), so a
 * caller that stores the result does not store a change.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return list
  if (from < 0 || from >= list.length) return list
  const target = Math.min(Math.max(Math.trunc(to), 0), list.length - 1)
  if (target === from) return list
  const out = list.slice()
  out.splice(target, 0, out.splice(from, 1)[0]!)
  return out
}

/** The item `key` names, moved to slot `to` (see `moveItem`); the same list when no item has that key. */
export function moveKeyed<T>(list: T[], keyOf: (item: T) => string, key: string, to: number): T[] {
  return moveItem(list, list.findIndex((item) => keyOf(item) === key), to)
}

/** The item `key` names, moved `by` places (-1 left, +1 right); the same list at the ends. */
export function stepKeyed<T>(list: T[], keyOf: (item: T) => string, key: string, by: number): T[] {
  const at = list.findIndex((item) => keyOf(item) === key)
  return at < 0 ? list : moveItem(list, at, at + by)
}

/** Whether the tab at `index` of `count` has a place `by` steps over (Move Tab Left / Right are greyed at the ends). */
export const canStep = (count: number, index: number, by: number): boolean =>
  index >= 0 && index < count && index + by >= 0 && index + by < count

// MARK: - A drag

/** A tab's place in the row, in the row's own (scrolling) coordinates: it does not change while the row scrolls. */
export interface Slot { left: number; width: number }

/**
 * The slot the dragged tab belongs in once it has been moved `shift` pixels from where it was picked up: the one whose
 * place has its centre nearest the dragged tab's centre (so it changes at the middle of the tab being passed, as every
 * tabbed app does). `slots` are the movable tabs, in order and edge to edge; the answer is clamped to them.
 */
export function dropIndex(slots: readonly Slot[], from: number, shift: number): number {
  const one = slots[from]
  if (!one) return Math.max(0, from)
  const centre = one.left + one.width / 2 + shift
  const rest = slots.filter((_, index) => index !== from)
  let at = slots[0]!.left, best = 0, nearest = Infinity
  for (let slot = 0; slot <= rest.length; slot++) {
    const distance = Math.abs(at + one.width / 2 - centre)
    if (distance < nearest) { nearest = distance; best = slot }
    if (slot < rest.length) at += rest[slot]!.width
  }
  return best
}

/**
 * How far each tab sits from where it was, once the dragged tab (index `from`) is in slot `to`: the tabs it passed step
 * aside by its width, the rest stay. The dragged tab's own entry is where it will REST (its slot), which a drop glides
 * it to.
 */
export function slideBy(slots: readonly Slot[], from: number, to: number): number[] {
  const order = moveItem(slots.map((_, index) => index), from, to)
  const out = slots.map(() => 0)
  let at = slots[0]?.left ?? 0
  for (const index of order) {
    out[index] = at - slots[index]!.left
    at += slots[index]!.width
  }
  return out
}

/** How far the dragged tab may be moved either way and stay inside the row of tabs: the first slot's left to the last slot's right. */
export function shiftRange(slots: readonly Slot[], from: number): { min: number; max: number } {
  const one = slots[from]
  if (!one || slots.length === 0) return { min: 0, max: 0 }
  const last = slots[slots.length - 1]!
  return { min: slots[0]!.left - one.left, max: last.left + last.width - one.width - one.left }
}

export const clampShift = (shift: number, range: { min: number; max: number }): number =>
  Math.min(Math.max(shift, range.min), range.max)

/** A press has become a drag once it has moved this far (pixels): a click that wobbles is still a click. */
export const DRAG_THRESHOLD = 4
export const pastThreshold = (dx: number, dy: number, threshold = DRAG_THRESHOLD): boolean => Math.hypot(dx, dy) >= threshold

/**
 * Pixels to scroll the row per tick while the pointer is held near its edge: negative towards the start, positive
 * towards the end, faster the nearer the edge (the full `max` at it and beyond it), 0 away from both edges.
 */
export function edgeScroll(x: number, left: number, right: number, edge = 40, max = 18): number {
  if (right - left <= 0) return 0
  if (x < left + edge) return -Math.max(1, Math.round(max * Math.min(1, (left + edge - x) / edge)))
  if (x > right - edge) return Math.max(1, Math.round(max * Math.min(1, (x - (right - edge)) / edge)))
  return 0
}

/** The pointer is out of the row (above it or below it, past `slack`): letting go there puts the tab back where it was. */
export const outOfRow = (y: number, top: number, bottom: number, slack = 24): boolean => y < top - slack || y > bottom + slack
