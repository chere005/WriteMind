/**
 * A bar button that opens a menu — the one every bar uses for its drop-downs.
 *
 * Two shapes. A MENU BUTTON (no `onMain`): the whole button opens the menu. A SPLIT BUTTON (`onMain`): a click
 * does the button's own job and the menu is one of: a click on the small triangle in its lower-right corner,
 * a right-click, a press held for half a second (the pen's, the Wacom's way), or ArrowDown / Alt+ArrowDown on
 * the focused button. The menu is the page's FloatingMenu, so Escape, the arrows, clamping to the window and
 * handing the keyboard back to the notes are all its own.
 */

import { useEffect, useRef, useState, type ReactNode } from "react"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { returnFocusSoon } from "./focusReturn"
import { Icon, type IconName } from "./icons"

interface Props {
  icon?: IconName
  /** Words on the button (the block style's current level); an icon-only button has none. */
  label?: ReactNode
  /** Tooltip, and the accessible name when there is no label. */
  title: string
  /** The accessible name when the label is not a name (a count). */
  name?: string
  items: MenuItem[] | (() => MenuItem[])
  /** The button's own click (a split button). Without it a click opens the menu. */
  onMain?: () => void
  /** Lit: on (accent fill) or softly (tint). */
  on?: boolean
  tint?: boolean
  disabled?: boolean
  /** A small chevron after the label (a control that shows a value). */
  chevron?: boolean
  /** No corner triangle (a control whose chevron says it already). */
  noMark?: boolean
  className?: string
  /** Test hook. */
  dataBar?: string
  /** Test hook on the menu this button opens (`data-bar` of the floating menu). */
  menuBar?: string
  /** More test hooks, `data-<name>`: `{ tablet: "undo" }` is `data-tablet="undo"` (the video pane's buttons keep theirs). */
  data?: Record<string, string>
  style?: React.CSSProperties
  children?: ReactNode
}

const HOLD_MS = 500
const CORNER = 12

export function MenuButton({ icon, label, title, name, items, onMain, on, tint, disabled, chevron, noMark, className, dataBar, menuBar, data, style, children }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  // The menu is built when it is opened and kept: a render of the page behind it (a clock, a save) must not rebuild its
  // rows, which would take the keyboard from the row the person had moved to.
  const [at, setAt] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const hold = useRef<number | null>(null)
  const held = useRef(false)
  /**
   * When this button was pressed and when its menu last closed. A press that lands on the button while its menu is
   * up closes the menu on the way in (the menu's own click-away runs first), so the click that follows must not
   * open it again: the second press on a menu button is the way to put its menu away. (A render may come between
   * the click-away and the press, so this cannot be read from the state.)
   */
  const pressedAt = useRef(-1)
  const closedAt = useRef(-1)

  const list = typeof items === "function" ? items : () => items
  const open = () => {
    const box = button.current?.getBoundingClientRect()
    if (!box) return
    setAt({ x: box.left, y: box.bottom + 2, items: list() })
  }
  useEffect(() => () => { if (hold.current !== null) window.clearTimeout(hold.current) }, [])

  const classes = ["bar-btn", !noMark && onMain ? "menu" : "", label !== undefined ? "label" : "", on ? "on" : "", tint ? "tint" : "", className ?? ""]
    .filter(Boolean).join(" ")
  return (
    <>
      <button ref={button} type="button" className={classes} style={style} disabled={disabled} data-bar={dataBar}
              {...Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]))}
              aria-label={name ?? (label === undefined ? title : undefined)} title={title}
              aria-haspopup="menu" aria-expanded={at !== null} aria-pressed={onMain ? !!(on || tint) : undefined}
              onPointerDown={(event) => {
                pressedAt.current = performance.now()
                if (!onMain || event.button !== 0) return
                held.current = false
                hold.current = window.setTimeout(() => { held.current = true; open() }, HOLD_MS)
              }}
              onPointerUp={() => { if (hold.current !== null) { window.clearTimeout(hold.current); hold.current = null } }}
              onPointerLeave={() => { if (hold.current !== null) { window.clearTimeout(hold.current); hold.current = null } }}
              onContextMenu={(event) => { event.preventDefault(); if (!disabled) open() }}
              onKeyDown={(event) => {
                if (disabled) return
                if (event.key === "ArrowDown" || (event.altKey && event.key === "ArrowDown")) { event.preventDefault(); open() }
              }}
              onClick={(event) => {
                if (disabled) return
                if (held.current) { held.current = false; return }
                const box = event.currentTarget.getBoundingClientRect()
                const inCorner = event.clientX > box.right - CORNER && event.clientY > box.bottom - CORNER
                if (!onMain || inCorner) {
                  if (pressedAt.current - closedAt.current >= 0 && pressedAt.current - closedAt.current < 100) return
                  open()
                } else onMain()
              }}>
        {icon && <Icon name={icon} />}
        {label !== undefined && <span className="bar-label-text">{label}</span>}
        {chevron && <Icon name="chev" size={10} className="chev" />}
        {children}
      </button>
      {at && <FloatingMenu x={at.x} y={at.y} items={at.items} dataBar={menuBar} onClose={() => {
                    closedAt.current = performance.now()
                    setAt(null)
                    // The menu gave the keyboard back to this button (it had it when the menu opened); a bar's menu is a chrome
                    // action, and the caret belongs in the notes afterwards (a field a menu item opened keeps it).
                    returnFocusSoon()
                  }} />}
    </>
  )
}
