/**
 * "Tablet orientation": how the tablet is physically turned, in Wacom's words.
 *
 * `OrientationMenu` is the sheet header's: an icon button with the menu's triangle whose menu lists the four, the
 * current one ticked (the wireframes: the select that used to sit in the header is an icon menu now). `OrientationSelect`
 * is the same choice as a plain dropdown, which the Pen menu's "Tablet buttons and orientation" keeps.
 */

import { ORIENTATIONS, parseOrientation } from "../shared/orientation"
import { Icon } from "./icons"
import { MenuButton } from "./MenuButton"
import { setOrientation, useOrientation } from "./orientation"

const TITLE = "Tablet orientation: how the tablet is turned on your desk, as in Wacom Tablet Properties. The sheet takes this shape, and with Pen capture the pen is turned to match."

export function OrientationMenu() {
  const value = useOrientation()
  const now = ORIENTATIONS.find((one) => one.value === value)?.label ?? ""
  return (
    <MenuButton className="menu" data={{ tablet: "orientation-menu" }} title={`${TITLE} Now: ${now}.`}
                items={ORIENTATIONS.map((one) => ({
                  label: one.label, checked: one.value === value, dataBar: `orientation-${one.value}`,
                  onClick: () => setOrientation(one.value),
                }))}>
      <Icon name="rotate" />
    </MenuButton>
  )
}

export function OrientationSelect({ className = "icon-button", compact = false }: { className?: string; compact?: boolean }) {
  const value = useOrientation()
  return (
    <select className={className} data-tablet="orientation" value={String(value)}
            title={TITLE}
            aria-label="Tablet orientation"
            style={compact ? { width: "auto", padding: "0 4px", fontSize: 11 } : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setOrientation(parseOrientation(event.target.value))}>
      {ORIENTATIONS.map((one) => <option key={String(one.value)} value={String(one.value)}>{one.label}</option>)}
    </select>
  )
}
