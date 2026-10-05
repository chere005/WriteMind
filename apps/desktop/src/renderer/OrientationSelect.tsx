/**
 * "Tablet orientation": how the tablet is physically turned, in Wacom's words.
 * One dropdown, in the sheet pane's header and the Pen popover.
 */

import { ORIENTATIONS, parseOrientation } from "../shared/orientation"
import { setOrientation, useOrientation } from "./orientation"

export function OrientationSelect({ className = "icon-button", compact = false }: { className?: string; compact?: boolean }) {
  const value = useOrientation()
  return (
    <select className={className} data-tablet="orientation" value={String(value)}
            title="Tablet orientation: how the tablet is turned on your desk, as in Wacom Tablet Properties. The sheet takes this shape, and with Pen capture the pen is turned to match."
            aria-label="Tablet orientation"
            style={compact ? { width: "auto", padding: "0 4px", fontSize: 11 } : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setOrientation(parseOrientation(event.target.value))}>
      {ORIENTATIONS.map((one) => <option key={String(one.value)} value={String(one.value)}>{one.label}</option>)}
    </select>
  )
}
