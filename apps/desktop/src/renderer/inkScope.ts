/**
 * A PEN FOR ONE INK CELL (Sean, 2026-10-05: "selecting a cell type ... should create a new cell with the cursor ready
 * to start typing (obviously with the exception of drawing cells, where it becomes a pen that can only draw in that
 * cell"). Making a drawing cell (Ctrl+9, Insert ▸ Drawing Cell, the + menu) scopes the pointer to it: with the pen up,
 * a press in that cell draws there and nowhere else; the page keeps its own pointer; a press anywhere outside the cell,
 * or Escape, ends it, and that press is the click it would have been (the caret), never a stroke. The pen mode itself
 * (Ctrl+P) is untouched and ends any scope.
 *
 * Here: which cell, if any, and who wants to hear. The drawing layer (Canvas.tsx) reads it at every press, marks the
 * cell for its cursor, and ends it.
 */

let scoped: string | null = null
const listeners = new Set<() => void>()

/** The ink cell the pen is scoped to, or null. */
export const inkScope = (): string | null => scoped

/** Scope the pen to the cell `id` (null: end it). Listeners hear a change, once. */
export function scopePenTo(id: string | null): void {
  if (scoped === id) return
  scoped = id
  for (const listener of [...listeners]) listener()
}

export const endInkScope = (): void => scopePenTo(null)

/** Hear the scope change. Returns the way to stop. */
export function subscribeInkScope(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** What a press does while the pen is scoped to `scope` (pure, for the layer and the tests). */
export function scopedPress(scope: string | null, penMode: boolean, under: string | null, wouldDraw: boolean):
  "draw" | "end" | "end-swallow-stroke" | "none" {
  if (scope === null || penMode) return "none"
  if (under === scope) return "draw"
  // Outside the cell: the scope ends, and a press that would have drawn (a tablet pen that always draws) is a click.
  return wouldDraw ? "end-swallow-stroke" : "end"
}
