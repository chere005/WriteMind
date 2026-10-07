/**
 * The app's side of ink cells (docs\PLAN-docking-ink-cells.md (b), (f)): the painter the editor's ink widgets draw
 * with, keeping the widgets in step with the drawing, the `ink-<id>.svg` snapshots, and the dock host the drawing
 * layer docks through.
 *
 * An ink cell is ONE item of the sidecar (`{ kind: "cell", cell }`) and one picture line of the markdown
 * (`![ink](.drawings/media/ink-<id>.svg)`). The editor draws the line as a block widget; its canvas is painted here,
 * from the drawing, by the drawing layer's own painter (`paintInkCell`), so the ink moves in the same frame as the
 * words round it. The snapshot is what every OTHER markdown viewer shows: it is written again after each sidecar save
 * that changed the cell (a stroke, an Undo, a resize), and on opening a note when it is missing.
 */

import type { EditorView } from "@codemirror/view"
import {
  changedInkCells, encodeRefName, inkCellOf, inkCells, inkCellSvg, minAspect, type Drawing, type InkCell,
} from "@writemind/core"
import {
  columnBox, cursorSeam, dropTargetAt, inkAspectsField, inkCellPlaces, insertCellLine, removeCellLine, repaintInkCells,
  setInkAspects, showDropTarget, type DropTarget, type InkCellPainter,
} from "@writemind/editor"
import { paintInkCell, type DockHost } from "./Canvas"

/** The width a cell is measured at when it is not on the screen (the snapshot of a cell scrolled away). */
const DEFAULT_WIDTH = 720

/**
 * The painter the ink widgets draw with (one stable object per app: Notebook hands it to the editor). `drawing` is
 * the drawing as it is NOW (a dock's drawing before React has rendered it, too); `onResized` is the release of the
 * resize strip: one undo step.
 */
export function inkPainter(drawing: () => Drawing, onResized: (id: string, aspect: number) => void): InkCellPainter {
  /** The width each cell was last painted at, for `minAspect` (the strip asks before it lets go). */
  const widths = new Map<string, number>()
  return {
    aspect: (id) => inkCellOf(drawing(), id)?.aspect ?? null,
    minAspect: (id) => {
      const cell = inkCellOf(drawing(), id)
      return cell ? minAspect(cell, widths.get(id) ?? DEFAULT_WIDTH) : 0
    },
    paint: (id, canvas, size) => {
      const cell = inkCellOf(drawing(), id)
      if (size.width > 0) widths.set(id, size.width)
      if (!cell) {
        const context = canvas.getContext("2d")
        context?.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      // A picture inside the cell that arrives later paints the cell again.
      paintInkCell(canvas, cell, size, () => {
        const now = inkCellOf(drawing(), id)
        if (now && canvas.isConnected) paintInkCell(canvas, now, size)
      })
    },
    resized: (id, aspect) => {
      if (Number.isFinite(aspect) && aspect > 0) onResized(id, aspect)
    },
  }
}

/** Every cell's aspect by id (the first item of an id: the live one). */
export function aspectsOf(drawing: Drawing): Map<string, number> {
  const out = new Map<string, number>()
  for (const cell of inkCells(drawing)) if (!out.has(cell.id)) out.set(cell.id, cell.aspect)
  return out
}

const sameAspects = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean =>
  a.size === b.size && [...a].every(([id, aspect]) => b.get(id) === aspect)

/**
 * After every change of the drawing: the editor is told the cells' aspects when any changed (a new cell, a resize,
 * an Undo), and the widgets of the cells whose item changed paint again.
 */
export function syncInkCells(view: EditorView, before: Drawing | null, after: Drawing): void {
  const aspects = aspectsOf(after)
  const shown = view.state.field(inkAspectsField, false)
  if (!shown || !sameAspects(shown, aspects)) view.dispatch({ effects: setInkAspects.of(aspects) })
  const changed = changedInkCells(before, after).map((cell) => cell.id)
  if (changed.length > 0) repaintInkCells(view, changed)
}

// MARK: - The snapshots

/** The cells as last written to their snapshots, per note (the same object = nothing to write). */
const written = new Map<string, Map<string, InkCell>>()

/**
 * The cell's snapshot: the export's own vector writer, transparent, the cell's JSON in its metadata. A picture inside the cell is
 * named relative to the snapshot, which sits in `snapshots/` while the picture is in `media/` (docs/SPEC-WM.md 3.5), so that
 * any viewer that unpacks the note finds it.
 */
export const snapshotOf = (cell: InkCell, width: number): string =>
  inkCellSvg(cell, width > 0 ? width : DEFAULT_WIDTH, { mediaUrl: (file) => `../media/${encodeRefName(file)}`, metadata: true })

function write(note: string, cell: InkCell, width: number | null, onlyIfMissing: boolean): void {
  const svg = snapshotOf(cell, width ?? DEFAULT_WIDTH)
  void window.wm.writeInkSnapshot(note, cell.id, svg, onlyIfMissing).catch((error: unknown) => {
    console.warn(`WriteMind: could not write the snapshot of ink cell ${cell.id}:`, error)
  })
}

/** On opening a note: each cell's snapshot written where it is missing (a sidecar from before, a lost file). */
export function snapshotsOnOpen(note: string, drawing: Drawing, widthOf: (id: string) => number | null): void {
  const now = new Map<string, InkCell>()
  for (const cell of inkCells(drawing)) {
    if (now.has(cell.id)) continue
    now.set(cell.id, cell)
    write(note, cell, widthOf(cell.id), true)
  }
  written.set(note, now)
}

/** After a sidecar save: the snapshot of every cell whose item changed since the last write, written over. */
export function snapshotsAfterSave(note: string, drawing: Drawing, widthOf: (id: string) => number | null): void {
  const before = written.get(note)
  const now = new Map<string, InkCell>()
  for (const cell of inkCells(drawing)) {
    if (now.has(cell.id)) continue
    now.set(cell.id, cell)
    if (before?.get(cell.id) !== cell) write(note, cell, widthOf(cell.id), false)
  }
  written.set(note, now)
}

/** A cell's snapshot now (a new cell: its line points at the file at once). */
export function snapshotNow(note: string, cell: InkCell, width: number | null): void {
  write(note, cell, width, false)
  const held = written.get(note) ?? new Map<string, InkCell>()
  held.set(cell.id, cell)
  written.set(note, held)
}

/** The shown width of a cell in this editor, or null when it is not drawn. */
export const shownWidth = (view: EditorView | null, id: string): number | null => {
  const place = view ? inkCellPlaces.byId(id, view.dom) : null
  const width = place?.box().width ?? 0
  return width > 0 ? width : null
}

// MARK: - Docking

/**
 * The editor's side of a dock, for the drawing layer: where the cursor is, writing a cell's line, what is under the
 * pointer (the drop bar on the seam, `.wm-drop` on an ink cell), the text column. `before` is told the drawing a
 * dock is about to apply, so a widget drawn by the line's own transaction already finds its cell.
 */
export function dockHostFor(view: EditorView, depth: number, ahead: (next: Drawing | null) => void,
  drawing: () => Drawing): DockHost & { ahead(next: Drawing | null): void } {
  let shown: string | null = null
  const show = (target: DropTarget | null) => {
    const key = target === null ? null : target.kind === "seam" ? `seam:${target.offset}` : `ink:${target.id}`
    if (key === shown) return
    shown = key
    showDropTarget(view, target)
  }
  return {
    depth,
    ahead,
    words: {
      cursorOffset: () => cursorSeam(view.state),
      write: (line, offset) => {
        if (view.state.readOnly) return false
        // The cells' aspects go in with the line (the drawing to come, `ahead`), so the widget it makes is drawn as
        // the live cell from its first frame.
        insertCellLine(view, line, offset, [setInkAspects.of(aspectsOf(drawing()))])
        view.focus()
        return true
      },
      // Undocking: the cell's line out of the note, as one history event (the drawing follows in the same Undo step).
      remove: (from, to) => !view.state.readOnly && removeCellLine(view, from, to),
    },
    target: (x, y) => {
      const found = dropTargetAt(view, x, y)
      show(found)
      return found
    },
    clear: () => show(null),
    column: () => columnBox(view),
  }
}
