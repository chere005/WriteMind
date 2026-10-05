/**
 * Where the ink cells are on the screen, for the drawing layer (docs\PLAN-docking-ink-cells.md (c), "Registry").
 *
 * Every ink cell widget that is in the DOM is a PLACE: it registers when CodeMirror draws it and unregisters when
 * CodeMirror takes it away (scrolled out of the viewport, the line deleted, the note closed), so the list is exactly
 * the cells a pen can reach. `box()` measures the cell's drawing area (the text column, its full height) NOW.
 *
 * Listeners hear every mount and unmount (after the DOM update, in a microtask) and every change of geometry (from
 * `pictureCells`' view plugin: the doc, the viewport or the layout changed, in CodeMirror's measure WRITE phase), so
 * a selection box drawn round strokes in a cell can be put back where the cell now is.
 */

import type { EditorView } from "@codemirror/view"

export interface InkCellPlace {
  /** The cell's id (the `ink-<id>.svg` of its line). */
  id: string
  view: EditorView
  /** The widget's root, `.wm-cellpic.wm-inkcell[data-ink-cell=<id>]`. */
  element: HTMLElement
  /** An editable cell: its id has an item in this note's sidecar and it is the first line naming it. */
  live: boolean
  /** The drawing area (the text column × the cell's height), in client px, measured now. */
  box(): DOMRect
}

const places = new Set<InkCellPlace>()
const listeners = new Set<() => void>()
let queued = false

/** Tell every listener, once, after whatever is being done now. */
export function inkCellsMoved(): void {
  if (queued || listeners.size === 0) return
  queued = true
  queueMicrotask(() => {
    queued = false
    for (const listener of [...listeners]) {
      try { listener() } catch (error) { console.error(error) }
    }
  })
}

/** A widget came into the DOM. */
export function registerInkCell(place: InkCellPlace): () => void {
  places.add(place)
  inkCellsMoved()
  return () => {
    if (places.delete(place)) inkCellsMoved()
  }
}

/** Whether there is any place to tell anyone about (the view plugin asks before it measures). */
export const anyInkCells = (): boolean => places.size > 0

const inside = (place: InkCellPlace, within: Element): boolean => place.element.isConnected && within.contains(place.element)

export const inkCellPlaces = {
  /** The cell whose drawing area holds the point (client px), live cells first; null when none does. */
  at(clientX: number, clientY: number, within: Element): InkCellPlace | null {
    let found: InkCellPlace | null = null
    for (const place of places) {
      if (!inside(place, within)) continue
      const box = place.box()
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      if (place.live) return place
      found ??= place
    }
    return found
  },
  /** The place of a cell by its id (the live one if there are two), or null when it is not drawn. */
  byId(id: string, within: Element): InkCellPlace | null {
    let found: InkCellPlace | null = null
    for (const place of places) {
      if (place.id !== id || !inside(place, within)) continue
      if (place.live) return place
      found ??= place
    }
    return found
  },
  /** Every cell drawn inside `within`, top to bottom. */
  all(within: Element): InkCellPlace[] {
    return [...places].filter((place) => inside(place, within))
      .sort((a, b) => a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top)
  },
  /** Hear mounts, unmounts and moves. Returns the way to stop. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
