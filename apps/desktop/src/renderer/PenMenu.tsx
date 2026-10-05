/**
 * The Wacom chip: says whether a tablet pen has been seen, whether it reports pressure, and holds the pen's choices (penSettings.ts):
 * the pen always draws, pressure, what each button does, the tablet's orientation and (only when the driver refused it)
 * Retry for the system mapping. Nothing else.
 */

import { Fragment, useEffect, useRef, useState } from "react"
import { useOnScreen } from "./useOnScreen"
import { setButton, setPenDraws, setPressure, usePenSettings } from "./penSettings"
import {
  ACTION_WORDS, DOUBLE_CHOICES, HOLD_CHOICES, buttonRows, buttonSummary, type HoldAction, type TapAction,
} from "./penButtons"
import { heldAction, heldSlot, usePenLive } from "./penLive"
import { OrientationSelect } from "./OrientationSelect"
import { acceptStatus, changeSettings, usePenFeedStore } from "./penFeed"

const WORDS = {
  none: "No pen seen yet. Touch the tablet with the pen over this window.",
  pen: "Pen detected, but it reports no pressure. In Wacom Tablet Properties turn on \"Use Windows Ink\" (then restart WriteMind) for pressure and the eraser end.",
  pressure: "Pen detected with pressure.",
} as const

/** Try the system mapping again on this tablet (the driver's earlier "no" is forgotten). */
export async function retryMapping(): Promise<void> {
  try {
    const status = await window.wm.pen?.retryMapping()
    if (status) acceptStatus(status)
  } catch { /* the feed is not there */ }
}

export function PenMenu() {
  const settings = usePenSettings()
  const status = usePenFeedStore().status
  const live = usePenLive()
  const [open, setOpen] = useState(false)
  const pop = useOnScreen<HTMLDivElement>(open)
  const root = useRef<HTMLSpanElement | null>(null)
  // Like the app's other popovers (PaperMenu, the video menu): a click anywhere else or Esc puts it away. Esc goes
  // first and stops there, so the same press does not also let go of a box or a tool.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", key, true)
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", key, true) }
  }, [open])
  const held = heldAction(live)
  const heldName = heldSlot(live) && held && held !== "none" ? ACTION_WORDS[held] : null
  const summary = buttonSummary(settings.buttons)
  return (
    <span className="pen-menu" ref={root}>
      <button className={`icon-button pen-chip pen-${settings.seen}${open ? " on" : ""}`} data-pen="chip"
              title={`${WORDS[settings.seen]} ${summary}.${settings.eraser ? " Erase tool is on." : ""}${settings.selectTool ? " Select tool is on." : ""}${heldName ? ` Button held now: ${heldName}.` : ""}`}
              onClick={() => setOpen((was) => !was)}>
        <span className="pen-dot" />Pen{heldName ? ` · ${heldName}` : settings.eraser ? " · Erase" : settings.selectTool ? " · Select" : ""}
      </button>
      {open && (
        <div ref={pop} className="style-pop pen-pop" style={{ width: 400 }} onMouseDown={(event) => event.stopPropagation()}>
          <p>{WORDS[settings.seen]}</p>
          <label>
            <input type="checkbox" checked={settings.penDraws}
                   onChange={(event) => setPenDraws(event.target.checked)} />
            {" "}Pen always draws (the mouse keeps selecting)
          </label>
          <label>
            <input type="checkbox" checked={settings.pressure}
                   onChange={(event) => setPressure(event.target.checked)} />
            {" "}Pressure changes the line width
          </label>

          <h4>Buttons</h4>
          <div className="pen-buttons" data-pen="buttons"
               style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "4px 6px", alignItems: "center" }}>
            <span />
            <span className="hint" style={{ margin: 0 }}>Hold</span>
            <span className="hint" style={{ margin: 0 }}>Double-tap</span>
            {buttonRows(settings.buttons).map((row) => (
              <Fragment key={row.slot}>
                <span>{row.name}</span>
                <select value={row.hold} data-pen={`btn-${row.slot}`} aria-label={`${row.name}: hold`} style={{ minWidth: 0 }}
                        onChange={(event) => setButton(row.slot, "hold", event.target.value as HoldAction)}>
                  {HOLD_CHOICES.map((choice) => <option key={choice.action} value={choice.action}>{choice.label}</option>)}
                </select>
                {row.double === null ? <span className="hint" style={{ margin: 0 }}>—</span> : (
                  <select value={row.double} data-pen={`dbl-${row.slot}`} aria-label={`${row.name}: double-tap`} style={{ minWidth: 0 }}
                          onChange={(event) => setButton(row.slot, "double", event.target.value as TapAction)}>
                    {DOUBLE_CHOICES.map((choice) => <option key={choice.action} value={choice.action}>{choice.label}</option>)}
                  </select>
                )}
              </Fragment>
            ))}
          </div>
          <p className="hint">
            Hold = the button held while the pen touches (Select: a drag inside the selection moves it). Double-tap =
            the button pressed twice quickly without the tip touching; a single press does nothing. Leave the side
            buttons at Wacom's Right Click (lower) and Middle Click (upper): WriteMind reads them itself.
          </p>

          <h4>Tablet orientation</h4>
          <label className="pen-slot">
            How the tablet is turned
            <OrientationSelect />
          </label>
          <label>
            <input type="checkbox" data-pen="map-sheet" checked={status?.settings.mapSheet === true}
                   onChange={(event) => { void changeSettings({ mapSheet: event.target.checked }) }} />
            {" "}Map the whole tablet to the sheet (experimental)
          </label>
          <p className="hint">
            Asks the Wacom driver to move the cursor only inside the sheet. Off by default; if the cursor ever misbehaves,
            switch it off or restart WriteMind.
          </p>
          {status?.mapping === "refused" && (
            <p className="hint">
              The Wacom driver would not confine the pen to the sheet.{" "}
              <button className="icon-button" data-pen="retry-mapping" onClick={() => { void retryMapping() }}
                      style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Retry</button>
            </p>
          )}
        </div>
      )}
    </span>
  )
}
