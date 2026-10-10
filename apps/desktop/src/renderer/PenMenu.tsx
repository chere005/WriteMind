/**
 * The tablet pen's sheet: says whether a tablet pen has been seen, whether it reports pressure, and holds the pen's choices
 * (penSettings.ts): the pen always draws, pressure, what each button does, the tablet's orientation and (only when the driver
 * refused it) Retry for the system mapping. Nothing else.
 *
 * It was the Wacom CHIP on the bar until 2026-10-10 (Sean: "i only need a pen enabled and disabled button.. and a dropdown"):
 * now it is the pen menu's last row, "Tablet buttons and orientation…" (`PenSheetRow`, the old chip's `data-pen="chip"` and
 * its `pen-none` / `pen-pen` / `pen-pressure` classes with it), and this popover opens under the pen button.
 */

import { Fragment, useEffect, useRef, type CSSProperties } from "react"
import { returnFocusSoon } from "./focusReturn"
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

/** The pen menu's row that opens the sheet: the old chip's words as its title, and a dot that says what the pen has been seen to do. */
export function PenSheetRow({ onOpen, close }: { onOpen(): void; close(): void }) {
  const settings = usePenSettings()
  const live = usePenLive()
  const held = heldAction(live)
  const heldName = heldSlot(live) && held && held !== "none" ? ACTION_WORDS[held] : null
  const summary = buttonSummary(settings.buttons)
  return (
    <button type="button" role="menuitem" className={`pen-chip pen-${settings.seen}`} data-pen="chip"
            title={`${WORDS[settings.seen]} ${summary}.${settings.eraser ? " Erase tool is on." : ""}${settings.selectTool ? " Select tool is on." : ""}${heldName ? ` Button held now: ${heldName}.` : ""}`}
            onClick={() => { close(); onOpen() }}>
      <span className="float-label">Tablet buttons and orientation…</span>
      <span className="pen-dot" aria-hidden="true" />
    </button>
  )
}

/** Where the sheet goes: under the pen button, its right edge on the button's. */
export interface SheetPlace { top: number; right: number }

export function PenSheet({ at, onClose }: { at: SheetPlace; onClose(): void }) {
  const settings = usePenSettings()
  const status = usePenFeedStore().status
  const pop = useRef<HTMLDivElement | null>(null)
  // Like the app's other popovers: a click anywhere else or Esc puts it away. Esc goes first and stops there, so the same
  // press does not also let go of a box or a tool; the keyboard goes back to the notes.
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!pop.current?.contains(event.target as Node)) onClose() }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      onClose()
      returnFocusSoon()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", key, true)
    window.addEventListener("resize", onClose)
    return () => {
      window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", key, true)
      window.removeEventListener("resize", onClose)
    }
  }, [onClose])
  const where: CSSProperties = { position: "fixed", top: at.top, right: at.right, left: "auto", maxHeight: `calc(100vh - ${at.top + 8}px)` }
  return (
    <div ref={pop} className="style-pop pen-pop" data-pen="sheet" style={{ width: 400, ...where }} onMouseDown={(event) => event.stopPropagation()}>
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
        {" "}Map the whole tablet to the sheet
      </label>
      <p className="hint">
        While the sheet is in front the whole tablet writes on it (on a Mac WriteMind takes the tablet from the
        Wacom driver, which asks once for Input Monitoring). If the cursor ever misbehaves, switch it off or restart
        WriteMind.
      </p>
      {status?.mapping === "refused" && (
        <p className="hint">
          The Wacom driver would not confine the pen to the sheet.{" "}
          <button className="icon-button" data-pen="retry-mapping" onClick={() => { void retryMapping() }}
                  style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Retry</button>
        </p>
      )}
    </div>
  )
}
