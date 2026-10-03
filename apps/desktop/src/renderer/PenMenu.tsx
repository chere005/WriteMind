/**
 * The Wacom chip: says whether a tablet pen has been seen, whether it
 * reports pressure, and holds the pen's choices (penSettings.ts): what each
 * button does, a live TEST of what the system reports, and the keystrokes
 * the tablet's ExpressKeys should type.
 */

import { useState } from "react"
import { useOnScreen } from "./useOnScreen"
import { setButton, setPenDraws, setPressure, usePenSettings } from "./penSettings"
import { ACTION_CHOICES, ACTION_WORDS, SLOTS, SLOT_NAMES } from "./penButtons"
import { heldAction, heldSlot, usePenLive } from "./penLive"
import { shown } from "../shared/commands"
import { TabletAreaHelp } from "./tabletArea"

const WORDS = {
  none: "No pen seen yet. Touch the tablet with the pen over this window.",
  pen: "Pen detected, but it reports no pressure. In Wacom Tablet Properties turn on \"Use Windows Ink\" (then restart WriteMind) for pressure and the eraser end.",
  pressure: "Pen detected with pressure.",
} as const

const platform = (): string => (/Mac/.test(navigator.platform) ? "darwin" : "win32")

/** What to type into Wacom Tablet Properties ▸ ExpressKeys, per command. */
const KEYSTROKES: { id: string; label: string }[] = [
  { id: "undo", label: "Undo" },
  { id: "redo", label: "Redo" },
  { id: "penToggle", label: "Pen down / up" },
  { id: "penErase", label: "Erase tool" },
  { id: "penSelect", label: "Select tool" },
  { id: "penNextColour", label: "Next colour" },
  { id: "penPrevColour", label: "Previous colour" },
  { id: "penWider", label: "Wider line" },
  { id: "penThinner", label: "Thinner line" },
  { id: "penAlwaysDraws", label: "Pen always draws" },
  { id: "penDelete", label: "Delete selection" },
  { id: "penClearSelection", label: "Clear selection" },
  { id: "tabletPad", label: "Tablet pad (full screen)" },
  { id: "penSendWriting", label: "Send writing" },
  { id: "penSendPage", label: "Send page" },
  { id: "penClearSheet", label: "Clear sheet" },
]

/** A suggested layout for a tablet with 4, 6 or 8 keys. */
const LAYOUTS: { keys: number; slots: string[] }[] = [
  { keys: 4, slots: ["undo", "penErase", "penNextColour", "tabletPad"] },
  { keys: 6, slots: ["undo", "redo", "penErase", "penNextColour", "penSelect", "tabletPad"] },
  { keys: 8, slots: ["undo", "redo", "penErase", "penSelect", "penNextColour", "penWider", "penDelete", "tabletPad"] },
]

const label = (id: string): string => KEYSTROKES.find((one) => one.id === id)?.label ?? id

function copy(text: string): void {
  try { void navigator.clipboard.writeText(text) } catch { /* no clipboard: the key is on screen */ }
}

function Key({ id }: { id: string }) {
  const chord = shown(id, platform())
  return (
    <span className="pen-key">
      <code>{chord}</code>
      <button className="icon-button pen-copy" data-pen-copy={id} title="Copy this keystroke"
              onClick={() => copy(chord)}>copy</button>
    </span>
  )
}

function Test() {
  const live = usePenLive({ pressure: true })
  const lamp = (on: boolean, ever: boolean, name: string, key: string) => (
    <span className={`pen-lamp${on ? " on" : ever ? " ever" : ""}`} data-lamp={key} title={ever ? `${name} has been reported` : `${name} not reported yet`}>
      {name}
    </span>
  )
  return (
    <div className="pen-test" data-pen="test">
      <div className="pen-lamps">
        {lamp(live.tip, live.seen.tip, "Tip", "tip")}
        {lamp(live.lower, live.seen.lower, "Lower", "lower")}
        {lamp(live.upper, live.seen.upper, "Upper", "upper")}
        {lamp(live.eraser, live.seen.eraser, "Eraser", "eraser")}
      </div>
      <div className="pen-bar" title="Pressure"><span style={{ width: `${Math.round(live.pressure * 100)}%` }} /></div>
      <p className="hint">
        Hold the pen over this window and press each button. A lamp lights while the system reports it,
        and stays marked once it has been seen. Leave the side buttons at Wacom's default (Right Click /
        Middle Click, or Pen Tip Double Click): WriteMind reads them as pointer buttons.
      </p>
    </div>
  )
}

export function PenMenu({ inPad = false }: { inPad?: boolean } = {}) {
  const settings = usePenSettings()
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

          <h4>What the pen's buttons do</h4>
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
            pressed and let go without the tip touching. Select is ⌘-drag; Add is ⇧; Pan turns the page
            like a finger. The ⌫ and ⬚ buttons on the toolbar need no button at all.
          </p>

          <h4>Test buttons</h4>
          <Test />

          <h4>ExpressKeys</h4>
          <p className="hint">
            The app cannot read the tablet's keys: the Wacom driver turns each into a keystroke. In Wacom
            Tablet Properties ▸ ExpressKeys, set a key to <b>Keystroke…</b> and type one of these.
          </p>
          <table className="pen-keys" data-pen="express">
            <tbody>
              {KEYSTROKES.map((one) => (
                <tr key={one.id}><td>{one.label}</td><td><Key id={one.id} /></td></tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Suggested layouts:</p>
          {LAYOUTS.map((layout) => (
            <p key={layout.keys} className="hint pen-layout">
              <b>{layout.keys} keys:</b>{" "}
              {layout.slots.map((id, index) => `${index + 1} ${label(id)}`).join(" · ")}
            </p>
          ))}
          <details className="area-details" data-pen="area-details">
            <summary>Tablet area (which part of the screen the tablet covers)</summary>
            {open && <TabletAreaHelp inPad={inPad} />}
          </details>
          <p className="hint">If the Windows arrow still follows the pen, the tablet is in mouse mode: in Wacom Tablet Properties ▸ Mapping turn off "Mouse mode" (use Pen mode), and keep Windows Ink on.</p>
        </div>
      )}
    </span>
  )
}
