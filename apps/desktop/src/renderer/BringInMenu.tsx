/**
 * The tablet sheet header's "Bring in ▾" (Sean, 2026-10-06: "give the Bring in a drop down arrow that chooses To
 * writing or To docked cell"): one small menu that says where the header's Writing button puts the writing —
 * floating strokes on the note's page (To writing), or a new drawing cell docked at the input cursor (To docked
 * cell, what the box row's Bring in as Drawing Cell does). Page always brings a picture. The choice is remembered
 * (cameraSettings.ts `bringInTo`); Esc or a click away closes the menu, as the Paper menu's.
 */

import { useEffect, useRef, useState } from "react"
import type { BringTo } from "./cameraSettings"

export const BRING_TO: { value: BringTo; label: string; hint: string }[] = [
  { value: "writing", label: "To writing", hint: "Writing brings the strokes onto the note's page, where they float" },
  { value: "cell", label: "To docked cell", hint: "Writing brings the strokes in as a new drawing cell at the input cursor" },
]

export function BringInMenu({ to, onChange }: { to: BringTo; onChange(next: BringTo): void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement | null>(null)

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

  const now = BRING_TO.find((one) => one.value === to) ?? BRING_TO[0]!
  return (
    <span className="paper-menu bring-menu" ref={root} onPointerDown={(event) => event.stopPropagation()}>
      <button className={`icon-button${open ? " on" : ""}`} data-tablet="bring-to" aria-haspopup="menu" aria-expanded={open}
              title={`Bring in ${now.label.toLowerCase()}: ${now.hint}. Click to choose.`}
              onClick={() => setOpen((was) => !was)}
              style={{ width: "auto", padding: "0 6px", fontSize: 11 }}>{"Bring in ▾"}</button>
      {open && (
        <div className="paper-pop bring-pop" role="menu" data-tablet="bring-menu">
          <div className="group" role="radiogroup" aria-label="Bring in">
            {BRING_TO.map((one) => (
              <button key={one.value} role="menuitemradio" aria-checked={to === one.value} data-bring-to={one.value}
                      title={one.hint} onClick={() => { onChange(one.value); setOpen(false) }}>{one.label}</button>
            ))}
          </div>
        </div>
      )}
    </span>
  )
}
