/**
 * The video pane's tabs: one slim row between the header and what it shows.
 *
 * TABLET: each tab is a sheet (tabletSheets.ts): its own ink, paper, dashed box and stroke undo. Click opens one,
 * "+" adds "Sheet N", double-click renames (Enter keeps, Esc leaves it), the small x closes one. A sheet with ink
 * asks first (the x turns into "Close?" and a second click closes; anything else, or three seconds, takes that
 * back): ink is never lost silently. The last sheet has no x (Clear wipes it). Many tabs shrink, then the row
 * scrolls (the wheel scrolls it too); it never wraps, so the sheet below it never moves. The pen cannot reach this
 * row (the whole tablet is the sheet): the mouse clicks it, and Pen ▸ Next / Previous Sheet (Ctrl+Alt+PageDown /
 * PageUp) are for the other hand.
 *
 * A tab BOUND to a drawing cell (cellSheets.ts: right-click the cell ▸ Open in Tablet Sheet) is marked, says which
 * note in its tooltip, and closes without asking: its ink is the cell's, and stays in the note. Except while it holds
 * writing that has not reached the cell yet (`pending`: its note was not in front): then it asks, as a plain sheet does.
 *
 * DOCUMENT CAMERA: a stub for what is coming (scanned pages as tabs, docs/TODO.md): one "Camera" tab and a "+" that
 * says so, and nothing else.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useCellSheet } from "./cellSheets"
import { addSheet, closeSheet, renameSheet, selectSheet, sheetHasInk, sheetPending, useSheetTabs } from "./tabletSheets"
import "./tablet.css"

const stop = (event: React.SyntheticEvent) => event.stopPropagation()
/** How long a "Close?" waits for its second click. */
const ARMED_MS = 3000

export function SheetStrip({ mode }: { mode: "tablet" | "camera" }) {
  return mode === "tablet" ? <TabletTabs /> : <CameraTabs />
}

function CameraTabs() {
  return (
    <div className="sheet-tabs" data-sheets="camera" onPointerDown={stop} onPointerUp={stop}>
      <div className="sheet-scroll" role="tablist" aria-label="Pages">
        <div className="sheet-tab on" role="tab" aria-selected="true" data-sheet="camera"><span className="name">Camera</span></div>
      </div>
      <button className="sheet-add" data-sheet-add disabled aria-label="Add a page"
              title="Coming: each page you scan gets its own tab">+</button>
    </div>
  )
}

function TabletTabs() {
  const tabs = useSheetTabs()
  // (Only to be drawn again when writing starts or stops waiting for its note: the x's words say so.)
  useCellSheet()
  const row = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const only = tabs.tabs.length <= 1

  // A "Close?" goes by itself, and at any click that is not its second.
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(null), ARMED_MS)
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target?.closest?.(`[data-sheet-close="${armed}"]`)) setArmed(null)
    }
    window.addEventListener("pointerdown", away, true)
    return () => { window.clearTimeout(timer); window.removeEventListener("pointerdown", away, true) }
  }, [armed])

  // The open tab is kept in view (the row only: nothing else may scroll).
  useLayoutEffect(() => {
    const strip = row.current
    const tab = strip?.querySelector<HTMLElement>(`[data-sheet-id="${tabs.current}"]`)
    if (!strip || !tab) return
    const left = tab.offsetLeft, right = left + tab.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
  }, [tabs.current, tabs.tabs.length])

  const close = (id: string) => {
    if (only) return
    const tab = tabs.tabs.find((one) => one.id === id)
    const bound = tab?.cell != null
    const loses = bound ? sheetPending(id) : sheetHasInk(id)
    if (loses && armed !== id) { setArmed(id); return }
    setArmed(null)
    closeSheet(id)
  }

  return (
    <div className="sheet-tabs" data-sheets="tablet" onPointerDown={stop} onPointerUp={stop}>
      <div className="sheet-scroll" ref={row} role="tablist" aria-label="Sheets"
           onWheel={(event) => { if (row.current && event.deltaX === 0) row.current.scrollLeft += event.deltaY }}>
      {tabs.tabs.map((tab) => {
        const on = tab.id === tabs.current
        const asking = armed === tab.id
        const bound = tab.cell !== null
        const where = bound ? leafName(tab.cell!.note) : ""
        return (
          <div key={tab.id} role="tab" aria-selected={on} data-sheet-id={tab.id} data-inked={tab.inked ? "1" : "0"}
               data-bound={bound ? "1" : undefined}
               className={`sheet-tab${on ? " on" : ""}${asking ? " asking" : ""}${bound ? " bound" : ""}`}
               title={bound ? `${tab.name}: writes into a drawing cell of ${where} (double-click to rename)` : `${tab.name} (double-click to rename)`}
               onClick={() => selectSheet(tab.id)}
               onDoubleClick={() => setEditing(tab.id)}>
            {editing === tab.id
              ? <NameField name={tab.name} onDone={(name) => { setEditing(null); if (name !== null) renameSheet(tab.id, name) }} />
              : <span className="name">{tab.name}</span>}
            {!only && (
              <button className="sheet-close" data-sheet-close={tab.id}
                      aria-label={asking ? `Close ${tab.name} and its writing` : `Close ${tab.name}`}
                      title={asking ? "Click again to close it, writing and all" : bound && sheetPending(tab.id) ? "Close this sheet (it asks first: its writing has not reached the drawing cell yet)" : bound ? "Close this sheet (the drawing cell keeps its ink)" : tab.inked ? "Close this sheet (it asks first: it has writing)" : "Close this sheet"}
                      onClick={(event) => { event.stopPropagation(); close(tab.id) }}
                      onDoubleClick={stop}>{asking ? "Close?" : "×"}</button>
            )}
          </div>
        )
      })}
      </div>
      {/* Outside the scrolling part: "+" is always there. */}
      <button className="sheet-add" data-sheet-add disabled={!tabs.canAdd} aria-label="New sheet"
              title="New sheet" onClick={() => { addSheet() }}>+</button>
    </div>
  )
}

/** A note's file name without its folder or extension. */
const leafName = (file: string): string => (file.split(/[\\/]/).pop() ?? file).replace(/\.[^.]+$/, "")

/** The rename field: Enter or a click away keeps the name, Esc leaves it as it was. */
function NameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const field = useRef<HTMLInputElement | null>(null)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  useEffect(() => { field.current?.focus(); field.current?.select() }, [])
  return (
    <input ref={field} className="name-field" data-sheet-name defaultValue={name} maxLength={40} spellCheck={false}
           aria-label="Sheet name"
           onClick={stop} onDoubleClick={stop}
           onKeyDown={(event) => {
             event.stopPropagation()
             if (event.key === "Enter") { event.preventDefault(); finish(event.currentTarget.value) }
             else if (event.key === "Escape") { event.preventDefault(); finish(null) }
           }}
           onBlur={(event) => finish(event.currentTarget.value)} />
  )
}
