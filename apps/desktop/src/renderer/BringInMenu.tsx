/**
 * The tablet header's "Bring in" (the wireframe's one primary, filled): the button brings the sheet's writing into the
 * note the way it was last asked to, and its menu — the corner triangle, a right-click or a half-second hold — says
 * which way. The choice IS the action (Sean, 2026-10-06: "give the Bring in a drop down arrow that chooses To writing or
 * To docked cell"; 2026-10-10: its menu is "Writing / As drawing cell"): picking one brings it in and makes it what the
 * button does next. The third item brings the sheet as a picture, paper and all (it used to be the header's own Page
 * button); it is never the button's default.
 *
 *   Writing           the strokes float on the note's page (the box row's "Bring in writing"): STILL THE GRAPHICS (Sean, 2026-10-10)
 *   As drawing cell   a new drawing cell docked at the input cursor (the box row's "As drawing cell")
 *   As Text           the writing READ as words, a text cell at the caret (the box row's "Text"): a choice of its own, and only
 *                     where the machine has a reader
 *   Sheet as picture  the boxed part, or the whole sheet, as an image
 */

import { MenuButton } from "./MenuButton"
import type { MenuItem } from "./FloatingMenu"
import type { BringTo } from "./cameraSettings"

export const BRING_TO: { value: BringTo; label: string }[] = [
  { value: "writing", label: "Writing" },
  { value: "cell", label: "As Drawing Cell" },
  { value: "text", label: "As Text" },
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
  /** This machine has a reader: "As Text" is offered. Without one there is no such item (nothing to say it is missing). */
  reader: boolean
  /** Why As Text is off (no note open to read the words into), or null. A sheet that is a drawing cell can still be read. */
  textOff: string | null
}

export function BringInMenu({ to, onChange, title, off, onBring, onPage, reader, textOff }: Props) {
  const items: MenuItem[] = [
    { header: "Bring in" },
    ...BRING_TO.filter((one) => one.value !== "text" || reader).map((one): MenuItem => ({
      label: one.label, checked: to === one.value, disabled: (one.value === "text" ? textOff : off) !== null, dataBar: `bring-${one.value}`,
      onClick: () => { onChange(one.value); onBring(one.value) },
    })),
    "-",
    { label: "Sheet as Picture", icon: "image", disabled: off !== null, dataBar: "bring-page", onClick: onPage },
  ]
  return (
    // (As Text reads the writing into the note's text: it needs a note, but not a sheet that is free of a drawing cell, so it has its
    // own reason to be off.)
    <MenuButton label="Bring in" className="primary" disabled={(to === "text" ? textOff : off) !== null} data={{ capture: "ink" }}
                title={(to === "text" ? textOff : off) ?? title}
                onMain={() => { if ((to === "text" ? textOff : off) === null) onBring(to) }}
                items={items} />
  )
}
