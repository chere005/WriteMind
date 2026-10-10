/**
 * THE RULES OF AN OVERLAY, apart from the DOM they act on, so they can be tested (docs/PLAN-bars-2026-10.md, P6).
 *
 * A dialog traps Tab (`tabTarget`), answers Escape only when it is the one on top (`ModalStack`), and a popover stays
 * inside the window (`clampIntoViewport`). `Modal.tsx` and `usePopover.ts` are these rules and the listeners that
 * feed them.
 */

/**
 * Where Tab (or Shift+Tab) goes inside a dialog that has `count` stops, the keyboard being on stop `active` (-1: not on
 * any, the page behind it or nowhere). The ends wrap round and a press from outside comes in at the near end; a press
 * from the middle is left to the browser (null), whose own order is the document's.
 */
export function tabTarget(count: number, active: number, shift: boolean): number | null {
  if (count <= 0) return null
  if (active < 0 || active >= count) return shift ? count - 1 : 0
  if (shift && active === 0) return count - 1
  if (!shift && active === count - 1) return 0
  return null
}

export interface Box { left: number; top: number; width: number; height: number }

/**
 * How far to move a popover so that it sits inside the window with `margin` to spare: the shift to add to its
 * position. A box bigger than the window is pinned to the top-left margin (its start is the part read first).
 */
export function clampIntoViewport(box: Box, view: { width: number; height: number }, margin = 8): { dx: number; dy: number } {
  const axis = (start: number, size: number, room: number): number => {
    if (size + 2 * margin >= room) return margin - start
    if (start < margin) return margin - start
    if (start + size > room - margin) return room - margin - size - start
    return 0
  }
  return { dx: axis(box.left, box.width, view.width), dy: axis(box.top, box.height, view.height) }
}

/**
 * The dialogs that are up, oldest first. Only the last answers Escape and Tab; the page behind is inert while any is.
 * (An update dialog can arrive over the key list: it is on top until it goes, and then the key list is again.)
 */
export class ModalStack {
  private ids: symbol[] = []
  push(id: symbol): void { if (!this.ids.includes(id)) this.ids.push(id) }
  remove(id: symbol): void { this.ids = this.ids.filter((one) => one !== id) }
  isTop(id: symbol): boolean { return this.ids.length > 0 && this.ids[this.ids.length - 1] === id }
  get size(): number { return this.ids.length }
}
