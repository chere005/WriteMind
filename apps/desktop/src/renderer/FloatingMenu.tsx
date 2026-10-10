/**
 * A small menu that opens where it is asked to: the sidebar's right-click
 * menus and its Folder button's, the bars' menus, the seam's +, the notes'
 * Cut / Copy / Paste. It is the page's own, not the shell's, because a native
 * menu cannot be driven by an end-to-end script.
 *
 * ITS COLUMNS are the wireframes' (docs/ui-2026-10/FinalToolbar.png, FinalStates.png): a menu that ticks anything keeps ONE
 * column for the tick on every row, then a row's own icon (only the rows that have one), then the label; a key hint is drawn
 * the Mac's way (⇧⌘L) on a Mac and in words elsewhere.
 *
 * It takes the keyboard while it is up (Up, Down, Enter, Escape, Right/Left
 * for a submenu) and gives it back to where it was when it goes: a menu is a
 * chrome action, and the caret must be where it was afterwards.
 *
 * ON OPENING NO ROW IS CHOSEN (docs/PLAN-bars-2026-10.md, P6): the menu itself has the keyboard, so the first row is not
 * painted as the answer before anything was pressed — it was, and Enter on a menu opened by a mouse click did
 * the first row's thing. The first arrow key moves onto a row (Down the first, Up the last); Home and End go to the ends;
 * Enter acts on the row that has the keyboard and on nothing when none does. A mouse over a row lights it as ever.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { chordGlyphs } from "../shared/chord"
import { returnFocus } from "./focusReturn"
import { hostPlatform } from "./hostPlatform"
import { Icon, type IconName } from "./icons"

export type MenuItem =
  | "-"
  /** A small caption over the rows that follow ("Cells", "Colour"). */
  | { header: string }
  /** A row the menu does not make itself (the pen's swatches and widths). Its buttons join the arrow keys. A function is given the way to close the menu. */
  | { custom: ReactNode | ((close: () => void) => ReactNode) }
  | {
    label: string
    onClick?: () => void
    disabled?: boolean
    /** Items that open beside this one. */
    submenu?: MenuItem[]
    /** A word shown on the right (a key, a count). */
    hint?: string
    /** A line icon before the label (icons.tsx). */
    icon?: IconName
    /** A check mark before the label: true is the current choice, false keeps the column (the menu lines up). */
    checked?: boolean
    /** The label set in its own style (the Style menu shows each level in its own weight and size). */
    labelStyle?: CSSProperties
    /** A switch on the right instead of a hint; its state. The menu stays up when it is clicked. */
    toggle?: boolean
    /** The menu stays up after the click (Turn Left, a switch). */
    keepOpen?: boolean
    /** Test hook: `data-bar` on the row's button. */
    dataBar?: string
    /** Drawn as a warning (Move to Trash…). */
    danger?: boolean
  }

interface Props {
  /** Where the pointer was (or the button's edge). */
  x: number
  y: number
  items: MenuItem[]
  /** Open upward from y (a button at the bottom of the window). */
  above?: boolean
  /** `x` is the menu's RIGHT edge, not its left (the pen's button at the end of the bar). */
  right?: boolean
  onClose(): void
  /** The test hook: an id on the element. */
  id?: string
  /** The test hook: `data-bar` on the menu itself (the video menu is `video-options`). */
  dataBar?: string
}

/** Something that is typed into: a field, or the notes (a contenteditable). */
const takesKeys = (element: HTMLElement): boolean => element.isContentEditable || element.matches("input, textarea, select")

export function FloatingMenu({ x, y, items, above, right, onClose, id, dataBar }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ x, y })
  const was = useRef<Element | null>(document.activeElement)

  // Kept inside the window: a menu near the right or bottom edge opens the other way.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    const left = Math.max(4, Math.min(right ? x - width : x, window.innerWidth - width - 4))
    const top = above ? Math.max(4, y - height) : Math.max(4, Math.min(y, window.innerHeight - height - 4))
    setAt({ x: left, y: top })
    // The MENU has the keyboard, not its first row (a row is chosen with the first arrow key); and only when it OPENS —
    // a menu that stays up while a choice in it changes the rows (the pen's colour and width) must not take the keyboard
    // back from the row the person is on.
    if (!element.contains(document.activeElement)) element.focus({ preventScroll: true })
  }, [x, y, above, right, items])

  useLayoutEffect(() => {
    const away = (event: Event) => {
      if (box.current && event.target instanceof Node && box.current.contains(event.target)) return
      onClose()
    }
    // Escape closes it wherever the keyboard is (a click on a disabled row, the page's own focus-return): heard on the
    // window in the capture phase, and it goes no further, so the one press does not also let go of a tool or a box.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", escape, true)
    window.addEventListener("blur", onClose)
    window.addEventListener("resize", onClose)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("blur", onClose)
      window.removeEventListener("resize", onClose)
    }
  }, [onClose])

  // On the way out the keyboard goes back to the notes, or to a field that had it. NOT to the button the menu was opened
  // from: a click gives a web page's button the focus, which the Mac's buttons never take, and Escape then left the caret
  // nowhere (typing after it went nowhere, Space opened the menu again).
  useEffect(() => () => {
    const back = was.current
    if (back instanceof HTMLElement && back !== document.body && document.contains(back) && takesKeys(back)) back.focus({ preventScroll: true })
    else returnFocus()
  }, [])

  return (
    <div ref={box} className="float-menu" role="menu" id={id} data-bar={dataBar} tabIndex={-1}
         style={{ left: at.x, top: at.y }}
         // (Not the bar's own right-click either: a menu hangs under the bar it was opened from, inside its React tree.)
         onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
         onKeyDown={(event) => {
           const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>(":scope > .float-row > button:not(:disabled), :scope > .float-custom button:not(:disabled)") ?? [])]
           const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
           if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose() }
           else if (event.key === "ArrowDown") { event.preventDefault(); buttons[index < 0 ? 0 : (index + 1) % buttons.length]?.focus() }
           else if (event.key === "ArrowUp") { event.preventDefault(); buttons[index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length]?.focus() }
           else if (event.key === "Home") { event.preventDefault(); buttons[0]?.focus() }
           else if (event.key === "End") { event.preventDefault(); buttons[buttons.length - 1]?.focus() }
         }}>
      <Items items={items} onClose={onClose} />
    </div>
  )
}

function Items({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const [open, setOpen] = useState<number | null>(null)
  // A menu that ticks anything keeps the tick's column on every row, so the labels line up; an icon is the row's own.
  const ticks = items.some((item) => typeof item === "object" && "label" in item && item.checked !== undefined)
  return (
    <>
      {items.map((item, index) => {
        if (item === "-") return <hr key={`-${index}`} />
        if ("header" in item) return <div className="float-header" key={`h${index}:${item.header}`}>{item.header}</div>
        if ("custom" in item) return <div className="float-custom" key={`c${index}`}>{typeof item.custom === "function" ? item.custom(onClose) : item.custom}</div>
        const nested = item.submenu
        return (
          <div className="float-row" key={`${index}:${item.label}`}>
            <button role={item.checked !== undefined ? "menuitemcheckbox" : item.toggle !== undefined ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={item.checked ?? item.toggle}
                    disabled={item.disabled} data-bar={item.dataBar}
                    className={[nested ? "has-sub" : "", item.danger ? "danger" : ""].filter(Boolean).join(" ") || undefined}
                    onMouseEnter={() => setOpen(nested ? index : null)}
                    onKeyDown={(event) => {
                      if (nested && event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); setOpen(index) }
                      else if (event.key === "ArrowLeft" && open !== null) { event.preventDefault(); event.stopPropagation(); setOpen(null) }
                    }}
                    onClick={() => {
                      // (A click on a row with a submenu opens it and leaves it open: the pointer arriving already did, and a click
                      // that then shut it again made the row feel dead.)
                      if (nested) { setOpen(index); return }
                      if (!item.keepOpen && item.toggle === undefined) onClose()
                      item.onClick?.()
                    }}>
              {ticks && <span className="float-mark" aria-hidden="true">{item.checked ? "✓" : null}</span>}
              {item.icon && <span className="float-icon" aria-hidden="true"><Icon name={item.icon} size={14} /></span>}
              <span className="float-label" style={item.labelStyle}>{item.label}</span>
              {item.toggle !== undefined ? <span className={`float-switch${item.toggle ? " on" : ""}`} aria-hidden="true" />
                : nested ? <span className="hint">▸</span> : item.hint ? <span className="hint">{chordGlyphs(item.hint, hostPlatform())}</span> : null}
            </button>
            {nested && open === index && (
              <div className="float-menu sub" role="menu">
                <Items items={nested} onClose={onClose} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
