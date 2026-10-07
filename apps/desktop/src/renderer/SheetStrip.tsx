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
 * DOCUMENT CAMERA: the live "Camera" tab first (always there, never closed), then one tab per page scanned (scanTabs.ts:
 * the picture, its box, corners, shape and reading, kept across restarts). "+" takes the camera's current picture (the
 * held one when Hold image is on) into a new page and opens it; a click opens a tab, double-click renames; the x closes a
 * page, and always asks first ("Close?", then a second click) because the picture goes with it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useCellSheet } from "./cellSheets"
import { closeScan, openScan, renameScan, useScans } from "./scanTabs"
import { addSheet, closeSheet, renameSheet, selectSheet, sheetHasInk, sheetPending, useSheetTabs } from "./tabletSheets"
import "./tablet.css"

const stop = (event: React.SyntheticEvent) => event.stopPropagation()
/** How long a "Close?" waits for its second click. */
const ARMED_MS = 3000

/** What the camera pane gives its strip: "+" takes the current picture, and says why it cannot (a reason) when it cannot. */
export interface ScanStrip { onAdd(): void; addOff: string | null }

export function SheetStrip({ mode, scan }: { mode: "tablet" | "camera"; scan?: ScanStrip }) {
  return mode === "tablet" ? <TabletTabs /> : <CameraTabs scan={scan} />
}

/** A "Close?" waits for its second click, and goes by itself, and at any click that is not its second. */
function useArmed(attribute: string): [string | null, (id: string | null) => void] {
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(null), ARMED_MS)
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target?.closest?.(`[${attribute}="${armed}"]`)) setArmed(null)
    }
    window.addEventListener("pointerdown", away, true)
    return () => { window.clearTimeout(timer); window.removeEventListener("pointerdown", away, true) }
  }, [armed, attribute])
  return [armed, setArmed]
}

/** The open tab is kept in view (the row only: nothing else may scroll). */
function useKeepInView(row: React.RefObject<HTMLDivElement | null>, selector: string, deps: unknown[]): void {
  useLayoutEffect(() => {
    const strip = row.current
    const tab = strip?.querySelector<HTMLElement>(selector)
    if (!strip || !tab) return
    const left = tab.offsetLeft, right = left + tab.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says what moves the open tab
  }, deps)
}

function CameraTabs({ scan }: { scan?: ScanStrip }) {
  const kept = useScans()
  const row = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [armed, setArmed] = useArmed("data-scan-close")
  useKeepInView(row, `[data-scan-tab="${kept.current ?? "camera"}"]`, [kept.current, kept.pages.length])
  const close = (id: string) => {
    if (armed !== id) { setArmed(id); return }
    setArmed(null)
    closeScan(id)
  }
  const off = scan?.addOff ?? "There is no camera picture to keep"
  return (
    <div className="sheet-tabs" data-sheets="camera" onPointerDown={stop} onPointerUp={stop}>
      <div className="sheet-scroll" ref={row} role="tablist" aria-label="Pages"
           onWheel={(event) => { if (row.current && event.deltaX === 0) row.current.scrollLeft += event.deltaY }}>
        <div className={`sheet-tab${kept.current === null ? " on" : ""}`} role="tab" aria-selected={kept.current === null}
             data-sheet="camera" data-scan-tab="camera" title="The live camera" onClick={() => openScan(null)}>
          <span className="name">Camera</span>
        </div>
        {kept.pages.map((page) => {
          const on = page.id === kept.current
          const asking = armed === page.id
          return (
            <div key={page.id} role="tab" aria-selected={on} data-scan-tab={page.id} data-scan-id={page.id}
                 className={`sheet-tab scan${on ? " on" : ""}${asking ? " asking" : ""}`}
                 title={`${page.name}: a page kept from the camera (double-click to rename)`}
                 onClick={() => openScan(page.id)} onDoubleClick={() => setEditing(page.id)}>
              {editing === page.id
                ? <NameField name={page.name} label="Page name" onDone={(name) => { setEditing(null); if (name !== null) renameScan(page.id, name) }} />
                : <span className="name">{page.name}</span>}
              <button className="sheet-close" data-scan-close={page.id}
                      aria-label={asking ? `Close ${page.name} and its picture` : `Close ${page.name}`}
                      title={asking ? "Click again to close it, picture and all" : "Close this page (it asks first: its picture goes with it)"}
                      onClick={(event) => { event.stopPropagation(); close(page.id) }}
                      onDoubleClick={stop}>{asking ? "Close?" : "×"}</button>
            </div>
          )
        })}
      </div>
      {/* Outside the scrolling part: "+" is always there. */}
      <button className="sheet-add" data-sheet-add data-scan-add disabled={!scan || scan.addOff !== null} aria-label="Keep this picture as a page"
              title={scan && scan.addOff === null ? "Keep what the camera shows (the held picture, with Hold image) as a page of its own" : off}
              onClick={() => scan?.onAdd()}>+</button>
    </div>
  )
}

function TabletTabs() {
  const tabs = useSheetTabs()
  // (Only to be drawn again when writing starts or stops waiting for its note: the x's words say so.)
  useCellSheet()
  const row = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [armed, setArmed] = useArmed("data-sheet-close")
  const only = tabs.tabs.length <= 1

  useKeepInView(row, `[data-sheet-id="${tabs.current}"]`, [tabs.current, tabs.tabs.length])

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
function NameField({ name, onDone, label = "Sheet name" }: { name: string; onDone: (name: string | null) => void; label?: string }) {
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
           aria-label={label}
           onClick={stop} onDoubleClick={stop}
           onKeyDown={(event) => {
             event.stopPropagation()
             if (event.key === "Enter") { event.preventDefault(); finish(event.currentTarget.value) }
             else if (event.key === "Escape") { event.preventDefault(); finish(null) }
           }}
           onBlur={(event) => finish(event.currentTarget.value)} />
  )
}
