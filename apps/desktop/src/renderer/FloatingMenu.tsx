/**
 * A small menu that opens where it is asked to: the sidebar's right-click
 * menus and its Folder button's. It is the page's own, not the shell's,
 * because a native menu cannot be driven by an end-to-end script and the page
 * already draws the Cut / Copy / Paste one the same way (`.context-menu`).
 *
 * It takes the keyboard while it is up (Up, Down, Enter, Escape, Right/Left
 * for a submenu) and gives it back to where it was when it goes: a menu is a
 * chrome action, and the caret must be where it was afterwards.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { returnFocus } from "./focusReturn"

export type MenuItem =
  | "-"
  | {
    label: string
    onClick?: () => void
    disabled?: boolean
    /** Items that open beside this one. */
    submenu?: MenuItem[]
    /** A word shown on the right (a key, a count). */
    hint?: string
  }

interface Props {
  /** Where the pointer was (or the button's edge). */
  x: number
  y: number
  items: MenuItem[]
  /** Open upward from y (a button at the bottom of the window). */
  above?: boolean
  onClose(): void
  /** The test hook: an id on the element. */
  id?: string
}

export function FloatingMenu({ x, y, items, above, onClose, id }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ x, y })
  const was = useRef<Element | null>(document.activeElement)

  // Kept inside the window: a menu near the right or bottom edge opens the other way.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    const left = Math.max(4, Math.min(x, window.innerWidth - width - 4))
    const top = above ? Math.max(4, y - height) : Math.max(4, Math.min(y, window.innerHeight - height - 4))
    setAt({ x: left, y: top })
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true })
  }, [x, y, above, items])

  useEffect(() => {
    const away = (event: Event) => {
      if (box.current && event.target instanceof Node && box.current.contains(event.target)) return
      onClose()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("blur", onClose)
    window.addEventListener("resize", onClose)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("blur", onClose)
      window.removeEventListener("resize", onClose)
    }
  }, [onClose])

  // On the way out the keyboard goes back to what had it (the notes, usually).
  useEffect(() => () => {
    const back = was.current
    // What had the keyboard gets it back — and when nothing did (a right-click on a bare part of the page
    // leaves the body focused), the notes do.
    if (back instanceof HTMLElement && back !== document.body && document.contains(back)) back.focus({ preventScroll: true })
    else returnFocus()
  }, [])

  return (
    <div ref={box} className="float-menu" role="menu" id={id}
         style={{ left: at.x, top: at.y }}
         onContextMenu={(event) => event.preventDefault()}
         onKeyDown={(event) => {
           const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>(":scope > .float-row > button:not(:disabled)") ?? [])]
           const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
           if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose() }
           else if (event.key === "ArrowDown") { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus() }
           else if (event.key === "ArrowUp") { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus() }
         }}>
      <Items items={items} onClose={onClose} />
    </div>
  )
}

function Items({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      {items.map((item, index) => {
        if (item === "-") return <hr key={`-${index}`} />
        const nested = item.submenu
        return (
          <div className="float-row" key={`${index}:${item.label}`}>
            <button role="menuitem" disabled={item.disabled}
                    className={nested ? "has-sub" : undefined}
                    onMouseEnter={() => setOpen(nested ? index : null)}
                    onKeyDown={(event) => {
                      if (nested && event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); setOpen(index) }
                      else if (event.key === "ArrowLeft" && open !== null) { event.preventDefault(); event.stopPropagation(); setOpen(null) }
                    }}
                    onClick={() => {
                      if (nested) { setOpen(open === index ? null : index); return }
                      onClose()
                      item.onClick?.()
                    }}>
              <span>{item.label}</span>
              {nested ? <span className="hint">▸</span> : item.hint ? <span className="hint">{item.hint}</span> : null}
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
