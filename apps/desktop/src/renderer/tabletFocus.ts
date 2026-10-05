/**
 * Ctrl+Z while the pen is over (or has focus in) the tablet surface takes back
 * a STROKE ON THE SHEET, not something in the note. `useUndo` asks here first;
 * the surface registers itself while it is mounted. Nothing to take back on
 * the sheet means the key falls through to the note's own undo.
 *
 * `byPen`: asked by the pen's double tap (penActions.ts). That means the sheet
 * only while the pen is OVER it: the sheet keeps the focus from the last
 * stroke written on it, and a double tap over the note's page is the page's.
 *
 * WHERE THE PEN IS, for the pen's own tool toggles (Erase / Select, by a
 * double tap or an ExpressKey, penActions.ts): the SHEET's tools while the pen
 * is over the sheet's side of the video pane (the sheet, its header, its tabs)
 * or was last there (an ExpressKey pressed with the pen lifted out of range),
 * the NOTEBOOK's otherwise. Only the pen's own pointer events move it (the
 * native feed's too: they are real pointer events); a mouse click elsewhere
 * does not. The surface watches while it is mounted (`watchSheetPen`): with no
 * sheet showing the answer is always the notebook.
 */

import { useSyncExternalStore } from "react"

type Handler = (which: "undo" | "redo", byPen: boolean) => boolean

let handler: Handler | null = null

export const setTabletUndo = (next: Handler | null): void => { handler = next }
export const tabletUndo = (which: "undo" | "redo", byPen = false): boolean => handler?.(which, byPen) ?? false

// MARK: - Where the pen is

let side: Element | null = null
let onSheet = false
const listeners = new Set<() => void>()

function setOnSheet(next: boolean): void {
  if (next === onSheet) return
  onSheet = next
  listeners.forEach((listener) => listener())
}

/** Every pen pointer event says which side the pen is on. */
export function noticePenSide(event: { pointerType: string; target: EventTarget | null }): void {
  if (event.pointerType !== "pen" || side === null) return
  setOnSheet(event.target instanceof Node && side.contains(event.target))
}

/** The sheet's side of the pane is `element` while the returned function has not been called. */
export function watchSheetPen(element: Element): () => void {
  side = element
  window.addEventListener("pointermove", noticePenSide, true)
  window.addEventListener("pointerdown", noticePenSide, true)
  return () => {
    // A newer sheet watches already (one mounted before this one let go): it keeps the listeners.
    if (side !== element) return
    side = null
    window.removeEventListener("pointermove", noticePenSide, true)
    window.removeEventListener("pointerdown", noticePenSide, true)
    setOnSheet(false)
  }
}

/** The pen's tool toggles are the sheet's now. */
export const penOnSheet = (): boolean => side !== null && onSheet

export function usePenOnSheet(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    penOnSheet,
  )
}
