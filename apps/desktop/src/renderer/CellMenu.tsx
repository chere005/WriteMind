/**
 * The right-click menu on a DRAWING CELL (an ink cell of the note in front), in either pane (the markdown and the
 * rendered page), whether the drawing layer covers the note (the pen down, a tool armed) or not:
 *
 *   Open in Tablet Sheet   the Tablet shows, on the sheet bound to this cell (cellSheets.ts)
 *   Text Box / Shape ▸ / Arrow ▸   the drawing tools, armed: the next click or drag IN THE CELL puts one there
 *                                  (2026-10-06: shapes, arrows and text boxes live in a cell as its strokes do)
 *   Undock                 the cell comes out of the note onto the drawing layer, its objects floating where they
 *                          were shown (Canvas.tsx `undockCell`); one Undo puts the cell back
 *   Delete Drawing Cell    the cell's line goes, as Delete on the held cell does (one Undo brings it back, ink and all)
 *
 * And on a DOCKED PICTURE (a picture cell of the note's own media folder): Undock, Cut, Copy, Paste, Select All,
 * Delete Picture Cell. Cut and Copy are about the picture, or about a wider selection that already covers its line (as
 * the notebook's own menu was before this one took over the picture's right-click). A picture's menu also opens while
 * the drawing layer covers the note (found by the point, as a drawing cell's is).
 *
 * Heard in the capture phase, before the notebook's own Cut / Copy / Paste menu, which a press anywhere else still
 * gets. A read-only ink line (no cell in this note's drawing), a picture from anywhere else and a picture whose file is
 * missing keep the notebook's menu.
 */

import { useEffect, useState } from "react"
import { EditorView, runScopeHandlers } from "@codemirror/view"
import { FLOW_MENU_KINDS, MARK_KINDS, mediaFile, pictureLine, shapeTitle, type Placement } from "@writemind/core"
import { holdPictureCell, inkCellPlaces, pictureCellLine, type InkCellPlace } from "@writemind/editor"
import { undockCell } from "./Canvas"
import { cellInFront, openInTabletSheet } from "./cellSheets"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"

/** `cell`: a live drawing cell's id; `file`: a docked picture's media file (one of the two is set). */
interface Open {
  x: number; y: number; cell: string | null; file: string | null; view: EditorView; element: HTMLElement
  /** A docked picture whose line has words in its brackets (`![caption](…)`): a floating picture has nowhere to keep
   * them, so it is not undocked (the words would be lost on the way back). */
  caption?: boolean
}

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

const DOCKED_PICTURE = ".wm-cellpic:not(.wm-inkcell):not(.wm-inkcell-still):not(.wm-cellpic-missing)"

/**
 * The docked picture under a right-click: its widget (the one it landed on, else the one whose box holds the point,
 * for when the drawing layer covers the note), its view and its file in the note's own media folder.
 */
function pictureUnder(event: MouseEvent): { element: HTMLElement; view: EditorView; file: string; caption: boolean } | null {
  const hit = event.target instanceof Element ? event.target.closest<HTMLElement>(DOCKED_PICTURE) : null
  const element = hit ?? [...document.querySelectorAll<HTMLElement>(DOCKED_PICTURE)].find((candidate) => {
    const r = candidate.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && event.clientX >= r.left && event.clientX <= r.right
      && event.clientY >= r.top && event.clientY <= r.bottom
  }) ?? null
  if (!element) return null
  const view = EditorView.findFromDOM(element)
  const line = view ? pictureCellLine(view, element) : null
  if (!view || !line) return null
  const picture = pictureLine(view.state.doc.sliceString(line.from, line.to))
  const file = picture ? mediaFile(picture.path) : null
  return file ? { element, view, file, caption: (picture?.alt ?? "").trim().length > 0 } : null
}

/** Hold the picture for Cut / Copy, unless a selection already covers its line (then that selection is what goes). */
function holdUnlessCovered(view: EditorView, element: HTMLElement): void {
  const line = pictureCellLine(view, element)
  const covered = line !== null && view.state.selection.ranges.some((r) => !r.empty && r.from <= line.from && r.to >= line.to)
  if (covered) view.focus()
  else holdPictureCell(view, element)
}

/** The cell's line goes, by the editor's own Delete on a held cell (so its seam goes with it, as a key would). */
export function deleteDrawingCell(view: EditorView, element: HTMLElement): void {
  if (!element.isConnected) return
  holdPictureCell(view, element)
  runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }), "editor")
}

/** The drawing tools a cell's menu arms (the top bar's own Placements). */
function toolItems(place: (placing: Placement) => void): MenuItem[] {
  return [
    { label: "Text Box", onClick: () => place({ kind: "shape", shape: "text" }) },
    {
      label: "Shape",
      submenu: [
        ...FLOW_MENU_KINDS.map((shape): MenuItem => ({ label: shapeTitle(shape), onClick: () => place({ kind: "shape", shape }) })),
        "-",
        ...MARK_KINDS.map((shape): MenuItem => ({ label: shapeTitle(shape), onClick: () => place({ kind: "shape", shape }) })),
      ],
    },
    {
      label: "Arrow",
      submenu: [
        { label: "Arrow", onClick: () => place({ kind: "line", start: "none", end: "arrow" }) },
        { label: "Both Ways", onClick: () => place({ kind: "line", start: "arrow", end: "arrow" }) },
        { label: "Line", onClick: () => place({ kind: "line", start: "none", end: "none" }) },
        "-",
        { label: "Arrow Tool (drag between nodes)", onClick: () => place({ kind: "line", start: "none", end: "arrow", tool: true }) },
      ],
    },
  ]
}

interface Props {
  /** Arm a drawing tool (App's `arm`, as the top bar does); without it the cell's menu offers no tools. */
  onPlace?(placing: Placement): void
}

export function CellMenu({ onPlace }: Props = {}) {
  const [open, setOpen] = useState<Open | null>(null)

  useEffect(() => {
    const menu = (event: MouseEvent) => {
      const place = cellUnder(event)
      if (place && place.live && cellInFront(place.id)) {
        event.preventDefault()
        event.stopPropagation()
        setOpen({ x: event.clientX, y: event.clientY, cell: place.id, file: null, view: place.view, element: place.element })
        return
      }
      const picture = pictureUnder(event)
      if (!picture) return
      event.preventDefault()
      event.stopPropagation()
      setOpen({ x: event.clientX, y: event.clientY, cell: null, file: picture.file, view: picture.view, element: picture.element,
        caption: picture.caption })
    }
    window.addEventListener("contextmenu", menu, true)
    return () => window.removeEventListener("contextmenu", menu, true)
  }, [])

  if (!open) return null
  const undock: MenuItem = {
    label: "Undock",
    onClick: () => { undockCell({ view: open.view, element: open.element, ink: open.cell, file: open.file }) },
  }
  const items: MenuItem[] = open.cell !== null
    ? [
      { label: "Open in Tablet Sheet", onClick: () => { openInTabletSheet(open.cell!) } },
      "-",
      ...(onPlace ? [...toolItems(onPlace), "-" as const] : []),
      undock,
      { label: "Delete Drawing Cell", onClick: () => deleteDrawingCell(open.view, open.element) },
    ]
    : [
      open.caption ? { label: "Undock", hint: "has a caption", disabled: true, onClick: () => {} } : undock,
      "-",
      { label: "Cut", hint: "Ctrl+X", onClick: () => { holdUnlessCovered(open.view, open.element); void window.wm.editNative("cut") } },
      { label: "Copy", hint: "Ctrl+C", onClick: () => { holdUnlessCovered(open.view, open.element); void window.wm.editNative("copy") } },
      { label: "Paste", hint: "Ctrl+V", onClick: () => { open.view.focus(); void window.wm.editNative("paste") } },
      "-",
      { label: "Select All", hint: "Ctrl+A", onClick: () => {
        open.view.focus()
        open.view.dispatch({ selection: { anchor: 0, head: open.view.state.doc.length } })
      } },
      "-",
      { label: "Delete Picture Cell", onClick: () => deleteDrawingCell(open.view, open.element) },
    ]
  return <FloatingMenu x={open.x} y={open.y} id="cell-menu" onClose={() => setOpen(null)} items={items} />
}
