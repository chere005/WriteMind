/**
 * The tablet header's "Bring in" (the wireframe's one primary, filled): the button brings the sheet's writing into the
 * note the way it was last asked to, and its menu — the corner triangle, a right-click or a half-second hold — says
 * which way. The choice IS the action (Sean, 2026-10-06: "give the Bring in a drop down arrow that chooses To writing or
 * To docked cell"; 2026-10-10: its menu is "Writing / As drawing cell"): picking one brings it in and makes it what the
 * button does next. The third item brings the sheet as a picture, paper and all (it used to be the header's own Page
 * button); it is never the button's default.
 *
 *   Writing           the strokes float on the note's page (the box row's "Bring in writing")
 *   As drawing cell   a new drawing cell docked at the input cursor (the box row's "As drawing cell")
 *   Sheet as picture  the boxed part, or the whole sheet, as an image
 */

import { MenuButton } from "./MenuButton"
import type { MenuItem } from "./FloatingMenu"
import type { BringTo } from "./cameraSettings"

export const BRING_TO: { value: BringTo; label: string }[] = [
  { value: "writing", label: "Writing" },
  { value: "cell", label: "As Drawing Cell" },
]

interface Props {
  to: BringTo
  /** The default changed (a pick in the menu). */
  onChange(next: BringTo): void
  /** The tooltip of the button, which says what a click does now. */
  title: string
  /** Why Bring in is off (a sheet that is a drawing cell already, no note open), or null. */
  off: string | null
  onBring(to: BringTo): void
  onPage(): void
}

export function BringInMenu({ to, onChange, title, off, onBring, onPage }: Props) {
  const items: MenuItem[] = [
    { header: "Bring in" },
    ...BRING_TO.map((one): MenuItem => ({
      label: one.label, checked: to === one.value, disabled: off !== null, dataBar: `bring-${one.value}`,
      onClick: () => { onChange(one.value); onBring(one.value) },
    })),
    "-",
    { label: "Sheet as Picture", icon: "image", disabled: off !== null, dataBar: "bring-page", onClick: onPage },
  ]
  return (
    <MenuButton label="Bring in" className="primary" disabled={off !== null} data={{ capture: "ink" }}
                title={off ?? title}
                onMain={() => { if (!off) onBring(to) }}
                items={items} />
  )
}
