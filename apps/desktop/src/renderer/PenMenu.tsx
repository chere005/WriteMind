/**
 * The Wacom chip: says whether a tablet pen has been seen, whether it
 * reports pressure, and holds the pen's choices (penSettings.ts): what each
 * button does, a live TEST of what the system reports, and the keystrokes
 * the tablet's ExpressKeys should type.
 */

import { useEffect, useState } from "react"
import { useOnScreen } from "./useOnScreen"
import { setButton, setPenDraws, setPressure, usePenSettings } from "./penSettings"
import { ACTION_CHOICES, ACTION_WORDS, SLOTS, SLOT_NAMES } from "./penButtons"
import { heldAction, heldSlot, usePenLive } from "./penLive"
import { shown } from "../shared/commands"
import { TabletAreaHelp } from "./tabletArea"
import { OrientationSelect } from "./OrientationSelect"
import { acceptStatus, changeSettings, usePenFeedStore } from "./penFeed"
import type { BackendName, ContainSetting, NativeBackendName } from "../shared/pen"

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
  { id: "penSendWriting", label: "Send writing" },
  { id: "penSendPage", label: "Send page" },
  { id: "penClearSheet", label: "Clear sheet" },
]

/** A suggested layout for a tablet with 4, 6 or 8 keys. */
const LAYOUTS: { keys: number; slots: string[] }[] = [
  { keys: 4, slots: ["undo", "penErase", "penNextColour", "penSendWriting"] },
  { keys: 6, slots: ["undo", "redo", "penErase", "penNextColour", "penSelect", "penSendWriting"] },
  { keys: 8, slots: ["undo", "redo", "penErase", "penSelect", "penNextColour", "penWider", "penDelete", "penSendWriting"] },
]

const label = (id: string): string => KEYSTROKES.find((one) => one.id === id)?.label ?? id

/** The doors the feed may try, in the words of the Pen menu (the switches are persisted by main). */
const BACKEND_SWITCHES: [NativeBackendName, string][] = [
  ["wintab-data", "Wintab (the tablet driver's own interface)"],
  ["wintab-system", "Wintab mapped to the sheet (only after the check proved it)"],
  ["rawinput", "Raw HID (Windows' raw input)"],
  ["webhid", "WebHID (a hidden helper window)"],
  ["dom", "Window pen (the pen events this window receives)"],
  ["overlay", "Overlay (a transparent layer that holds the pen to the sheet)"],
]

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

export function PenMenu() {
  const settings = usePenSettings()
  const live = usePenLive()
  const [open, setOpen] = useState(false)
  const feed = usePenFeedStore()
  const pen = feed.status && feed.status.available ? feed.status.settings : null
  // The menu can be opened before the Tablet source ever showed: ask main for the feed's status then.
  useEffect(() => {
    if (open && !feed.status) void window.wm.pen?.status().then(acceptStatus).catch(() => undefined)
  }, [open, feed.status])
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

          <h4>Tablet orientation</h4>
          <label className="pen-slot">
            How the tablet is turned
            <OrientationSelect />
          </label>
          <p className="hint">
            As in Wacom Tablet Properties ▸ Orientation. The sheet takes this shape (Match screen = the
            screen's own, landscape on a landscape display). With pen capture on the pen is turned to match, so
            a tablet turned on its side still writes upright. Ink already on the sheet is not turned.
          </p>

          {pen && (
            <>
              <h4>Pen capture (the tablet is the sheet)</h4>
              <p className="hint">
                With the Tablet source showing, the whole tablet is the sheet while this window is in front. The mouse
                keeps working; the pen writes only on the sheet. Esc or Ctrl+Alt+G lets go. For no app at all:
                Wacom Tablet Properties ▸ Mapping ▸ Portion of screen (see Tablet area below).
              </p>
              <label>
                <input type="checkbox" checked={pen.enabled} data-pen="capture"
                       onChange={(event) => { void changeSettings({ enabled: event.target.checked }) }} />
                {" "}Pen capture on
              </label>
              <label className="pen-slot">
                Hold the pen to the sheet with
                <select value={pen.contain} data-pen="contain"
                        onChange={(event) => { void changeSettings({ contain: event.target.value as ContainSetting }) }}>
                  <option value="auto">Auto (the overlay, tried by itself)</option>
                  <option value="sink">Overlay</option>
                  <option value="driver">Tablet driver mapping (needs the check)</option>
                  <option value="clip">Mouse clip (Mouse mode only)</option>
                  <option value="none">Nothing</option>
                </select>
              </label>
              <label>
                <input type="checkbox" checked={pen.swapButtons} data-pen="swap"
                       onChange={(event) => { void changeSettings({ swapButtons: event.target.checked }) }} />
                {" "}Swap the side buttons (lower and upper the other way round)
              </label>
              <label>
                <input type="checkbox" checked={pen.trace} data-pen="trace"
                       onChange={(event) => { void changeSettings({ trace: event.target.checked }) }} />
                {" "}Keep a trace of what the tablet reports{" "}
                <button className="icon-button" data-pen="reveal-trace" onClick={() => { void window.wm.pen.revealTrace() }}
                        style={{ width: "auto", padding: "0 6px", fontSize: 11 }}>Reveal</button>
              </label>
              <details className="area-details" data-pen="backends">
                <summary>Advanced: which doors to try</summary>
                {BACKEND_SWITCHES.map(([name, words]) => (
                  <label key={name}>
                    <input type="checkbox" checked={pen.backends[name]} data-pen={`backend-${name}`}
                           onChange={(event) => { void changeSettings({ backends: { [name]: event.target.checked } as Record<NativeBackendName, boolean> }) }} />
                    {" "}{words}
                  </label>
                ))}
                <label className="pen-slot">
                  Use only
                  <select value={pen.prefer ?? ""} data-pen="prefer"
                          onChange={(event) => { void changeSettings({ prefer: (event.target.value || null) as BackendName | null }) }}>
                    <option value="">Automatic</option>
                    {BACKEND_SWITCHES.map(([name, words]) => <option key={name} value={name}>{words}</option>)}
                  </select>
                </label>
              </details>
              <p className="hint">
                <button className="icon-button" data-pen="open-check"
                        onClick={() => { window.dispatchEvent(new Event("wm:pen-check")); setOpen(false) }}
                        style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Tablet setup check...</button>
                {" "}20 seconds: which way the tablet is read, the side buttons, how much of it is reached.
              </p>
            </>
          )}

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
            {open && <TabletAreaHelp />}
          </details>
          <p className="hint">If the Windows arrow still follows the pen, the tablet is in mouse mode: in Wacom Tablet Properties ▸ Mapping turn off "Mouse mode" (use Pen mode), and keep Windows Ink on.</p>
        </div>
      )}
    </span>
  )
}
