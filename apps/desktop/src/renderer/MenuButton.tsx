/**
 * A bar button that opens a menu — the one every bar uses for its drop-downs.
 *
 * Three shapes. A MENU BUTTON (no `onMain`): the whole button opens the menu. A SPLIT BUTTON (`onMain`): a click
 * does the button's own job and the menu is one of: a click on the small triangle in its lower-right corner,
 * a right-click, a press held for half a second (the pen's, the Wacom's way), or ArrowDown / Alt+ArrowDown on
 * the focused button. And a CARET SPLIT (`onMain` and `caret`, the pen): the main button and a small caret button
 * side by side as one rounded shape, the menu opening from the caret. The menu is the page's FloatingMenu, so
 * Escape, the arrows, clamping to the window and handing the keyboard back to the notes are all its own.
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
  /**
   * A SPLIT button with a caret of its own (the pen): the main button and a small caret button side by side, one
   * rounded shape (`.bar-split`), the menu opening from the caret and right-aligned under the whole. Needs `onMain`.
   */
  caret?: boolean
  /** The caret button's name and test hook. */
  caretTitle?: string
  caretDataBar?: string
  /**
   * The menu FOLLOWS the state while it is up: its rows are asked for again on every render, not once when it opens. For a
   * menu whose rows change under the person's hand and which stays up for it (the pen's colour, width and switch, Sean,
   * 2026-10-10: "[colour and width] should be under this dropdown"). The rows keep their keys, so the row the person is on
   * keeps the keyboard; a menu that does not change while open leaves this off and is built once.
   */
  live?: boolean
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

export function MenuButton({ icon, label, title, name, items, onMain, on, tint, disabled, chevron, noMark, caret, caretTitle, caretDataBar, live, className, dataBar, menuBar, data, style, children }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const split = useRef<HTMLSpanElement>(null)
  // The menu is built when it is opened and kept: a render of the page behind it (a clock, a save) must not rebuild its
  // rows, which would take the keyboard from the row the person had moved to.
  const [at, setAt] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const hold = useRef<number | null>(null)
  const held = useRef(false)
  // The press that puts the menu away (the menu hears it first, on the window) must not also open it again as the click:
  // by the time the button hears its own pointerdown the menu is already gone (React has rendered between the two
  // listeners), so the press is matched to the closing by TIME — both inside one pointerdown.
  const closedAt = useRef(-1e9)
  const downAt = useRef(1e9)
  const closedByThisPress = () => {
    const same = Math.abs(closedAt.current - downAt.current) < 80
    downAt.current = 1e9   // (a press is matched once: a click with no press of its own, a script's, never is)
    return same
  }

  const list = typeof items === "function" ? items : () => items
  const open = () => {
    const box = (caret ? split.current : button.current)?.getBoundingClientRect()
    if (!box) return
    setAt({ x: caret ? box.right : box.left, y: box.bottom + 2, items: list() })
  }
  // A bar's menu is a chrome action: when it goes (Escape, a click elsewhere, a pick) the keyboard is the notes' again
  // (a field a menu item opened keeps it).
  const close = () => { closedAt.current = performance.now(); setAt(null); returnFocusSoon() }
  useEffect(() => () => { if (hold.current !== null) window.clearTimeout(hold.current) }, [])

  const classes = ["bar-btn", !noMark && onMain && !caret ? "menu" : "", label !== undefined ? "label" : "", on ? "on" : "", tint ? "tint" : "", className ?? ""]
    .filter(Boolean).join(" ")
  const main = (
    <button ref={button} type="button" className={classes} style={style} disabled={disabled} data-bar={dataBar}
            {...Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]))}
            aria-label={name ?? (label === undefined ? title : undefined)} title={title}
            aria-haspopup="menu" aria-expanded={at !== null} aria-pressed={onMain ? !!(on || tint) : undefined}
            onPointerDown={(event) => {
              downAt.current = performance.now()
              if (!onMain || event.button !== 0) return
              held.current = false
              hold.current = window.setTimeout(() => { held.current = true; open() }, HOLD_MS)
            }}
            onPointerUp={() => { if (hold.current !== null) { window.clearTimeout(hold.current); hold.current = null } }}
            onPointerLeave={() => { if (hold.current !== null) { window.clearTimeout(hold.current); hold.current = null } }}
            // (A button that only opens a menu leaves the right-click to the bar, whose own menu is Customize toolbar…)
            onContextMenu={(event) => { if (!onMain) return; event.preventDefault(); event.stopPropagation(); if (!disabled) open() }}
            onKeyDown={(event) => {
              if (disabled) return
              if (event.key === "ArrowDown" || (event.altKey && event.key === "ArrowDown")) { event.preventDefault(); open() }
            }}
            onClick={(event) => {
              if (disabled) return
              if (held.current) { held.current = false; return }
              const box = event.currentTarget.getBoundingClientRect()
              const inCorner = !caret && event.clientX > box.right - CORNER && event.clientY > box.bottom - CORNER
              if (!onMain || inCorner) {
                // The second press on a menu button is the way to put its menu away.
                if (closedByThisPress()) return
                open()
              } else onMain()
            }}>
      {icon && <Icon name={icon} />}
      {label !== undefined && <span className="bar-label-text">{label}</span>}
      {chevron && <Icon name="chev" size={10} className="chev" />}
      {children}
    </button>
  )
  return (
    <>
      {caret ? (
        <span ref={split} className={`bar-split${on ? " on" : ""}${disabled ? " disabled" : ""}`}>
          {main}
          <button type="button" className="bar-btn caret" disabled={disabled} data-bar={caretDataBar}
                  aria-label={caretTitle ?? `${title} options`} title={caretTitle ?? `${title} options`}
                  aria-haspopup="menu" aria-expanded={at !== null}
                  onPointerDown={() => { downAt.current = performance.now() }}
                  onClick={() => {
                    if (disabled || closedByThisPress()) return
                    open()
                  }}>
            <Icon name="chev" size={10} className="chev" />
          </button>
        </span>
      ) : main}
      {at && <FloatingMenu x={at.x} y={at.y} items={live ? list() : at.items} right={caret} dataBar={menuBar} onClose={close} />}
    </>
  )
}
