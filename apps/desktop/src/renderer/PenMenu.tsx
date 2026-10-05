/**
 * The Wacom chip: says whether a tablet pen has been seen, whether it reports pressure, and holds the pen's choices (penSettings.ts):
 * the pen always draws, pressure, what each button does, the tablet's orientation and (only when the driver refused it)
 * Retry for the system mapping. Nothing else.
 */

import { useState } from "react"
import { useOnScreen } from "./useOnScreen"
import { setButton, setPenDraws, setPressure, usePenSettings } from "./penSettings"
import { ACTION_CHOICES, ACTION_WORDS, SLOTS, SLOT_NAMES } from "./penButtons"
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
  const held = heldAction(live)
  const heldName = heldSlot(live) && held && held !== "none" ? ACTION_WORDS[held] : null
  const summary = SLOTS.filter((slot) => slot !== "tipAlt")
    .map((slot) => `${SLOT_NAMES[slot]}: ${ACTION_WORDS[settings.buttons[slot]]}`).join(". ")
  return (
    <span className="pen-menu">
      <button className={`icon-button pen-chip pen-${settings.seen}${open ? " on" : ""}`} data-pen="chip"
              title={`${WORDS[settings.seen]} ${summary}.${settings.eraser ? " Erase tool is on." : ""}${settings.selectTool ? " Select tool is on." : ""}${heldName ? ` Button held now: ${heldName}.` : ""}`}
              onClick={() => setOpen((was) => !was)}>
        <span className="pen-dot" />Pen{heldName ? ` · ${heldName}` : settings.eraser ? " · Erase" : settings.selectTool ? " · Select" : settings.sideButton === "erases" ? " · ⌫" : ""}
      </button>
      {open && (
        <div ref={pop} className="style-pop pen-pop" onMouseDown={(event) => event.stopPropagation()}>
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
          {SLOTS.map((slot) => (
            <label key={slot} className="pen-slot">
              {SLOT_NAMES[slot]}
              <select value={settings.buttons[slot]} data-pen={`btn-${slot}`}
                      onChange={(event) => setButton(slot, event.target.value as typeof settings.buttons[typeof slot])}>
                {ACTION_CHOICES.map((choice) => (
                  <option key={choice.action} value={choice.action}>{choice.label}</option>
                ))}
              </select>
            </label>
          ))}
          <p className="hint">
            Hold = works while the button is down during a drag. Tap = fires once when the button is
            pressed and let go without the tip touching. Leave the side buttons at Wacom's default
            (Right Click / Middle Click): WriteMind reads them as pointer buttons.
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
