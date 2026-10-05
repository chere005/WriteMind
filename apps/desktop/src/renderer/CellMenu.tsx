/**
 * The right-click menu on a DRAWING CELL (an ink cell of the note in front), in either pane (the markdown and the
 * rendered page), whether the drawing layer covers the note (the pen down, a tool armed) or not:
 *
 *   Open in Tablet Sheet   the Tablet shows, on the sheet bound to this cell (cellSheets.ts)
 *   Delete Drawing Cell    the cell's line goes, as Delete on the held cell does (one Undo brings it back, ink and all)
 *
 * Heard in the capture phase, before the notebook's own Cut / Copy / Paste menu, which a press anywhere else still
 * gets. A read-only ink line (no cell in this note's drawing) is a picture: it keeps the notebook's menu.
 */

import { useEffect, useState } from "react"
import { runScopeHandlers, type EditorView } from "@codemirror/view"
import { holdPictureCell, inkCellPlaces, type InkCellPlace } from "@writemind/editor"
import { cellInFront, openInTabletSheet } from "./cellSheets"
import { FloatingMenu } from "./FloatingMenu"

interface Open { x: number; y: number; cell: string; view: EditorView; element: HTMLElement }

/** The live ink cell under a right-click: the widget it landed on, else the cell whose area holds the point. */
function cellUnder(event: MouseEvent): InkCellPlace | null {
  const widget = event.target instanceof Element ? event.target.closest<HTMLElement>(".wm-inkcell[data-ink-cell]") : null
  if (widget) {
    const id = widget.dataset.inkCell ?? ""
    const place = inkCellPlaces.byId(id, document.body)
    if (place && place.element === widget) return place
  }
  return inkCellPlaces.at(event.clientX, event.clientY, document.body)
}

/** The cell's line goes, by the editor's own Delete on a held cell (so its seam goes with it, as a key would). */
export function deleteDrawingCell(view: EditorView, element: HTMLElement): void {
  if (!element.isConnected) return
  holdPictureCell(view, element)
  runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }), "editor")
}

export function CellMenu() {
  const [open, setOpen] = useState<Open | null>(null)

  useEffect(() => {
    const menu = (event: MouseEvent) => {
      const place = cellUnder(event)
      if (!place || !place.live || !cellInFront(place.id)) return
      event.preventDefault()
      event.stopPropagation()
      setOpen({ x: event.clientX, y: event.clientY, cell: place.id, view: place.view, element: place.element })
    }
    window.addEventListener("contextmenu", menu, true)
    return () => window.removeEventListener("contextmenu", menu, true)
  }, [])

  if (!open) return null
  return (
    <FloatingMenu x={open.x} y={open.y} id="cell-menu" onClose={() => setOpen(null)} items={[
      { label: "Open in Tablet Sheet", onClick: () => { openInTabletSheet(open.cell) } },
      "-",
      { label: "Delete Drawing Cell", onClick: () => deleteDrawingCell(open.view, open.element) },
    ]} />
  )
}
