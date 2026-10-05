/**
 * The notes that are open, in the order they were opened (`TabBar.swift`).
 * Sublime Text's bar: the one in front is lit, the rest are a click away, and
 * Ctrl+W closes one rather than the window. The wheel moves along the row,
 * the + at the end of it is a new note, a middle click closes a tab, a
 * right-click offers Close Tab / Close Other Tabs / Reveal, and the button at
 * the right-hand end lists everything that is open — which is the way back to
 * a tab that has been scrolled off the end.
 *
 * It is always there, even with nothing open: the + is the way to a new note.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Note } from "@writemind/core"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { fileManagerName } from "./SidebarProject"
import { shown } from "../shared/commands"

interface Props {
  platform: string
  open: Note[]
  current: string | null
  onSelect(note: Note): void
  onClose(path: string): void
  onCloseOthers(path: string): void
  onNew(): void
  onReveal(path: string): void
}

export function TabBar({ platform, open, current, onSelect, onClose, onCloseOthers, onNew, onReveal }: Props) {
  const strip = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; above?: boolean } | null>(null)
  const wheel = useRef(0)

  // The tab in front is always in view, however far the row has been walked.
  useEffect(() => {
    const tab = strip.current?.querySelector<HTMLElement>(".tab.open")
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [current, open.length])

  /** A wheel over the bar walks along it. A mouse only sends vertical deltas, and a row of tabs is the one place that has to mean sideways. */
  const walk = useCallback((event: React.WheelEvent) => {
    const element = strip.current
    if (!element) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    wheel.current += delta
    // One tab per notch of the wheel, not one per pixel of the swipe.
    const notch = 12
    const steps = Math.trunc(wheel.current / notch)
    if (steps === 0) return
    wheel.current -= steps * notch
    const tabs = [...element.querySelectorAll<HTMLElement>(".tab")]
    const left = element.getBoundingClientRect().left
    const first = tabs.findIndex((tab) => tab.getBoundingClientRect().right > left + 1)
    const next = Math.min(Math.max(first + (steps > 0 ? 1 : -1) * Math.min(Math.abs(steps), 3), 0), tabs.length - 1)
    tabs[next]?.scrollIntoView({ block: "nearest", inline: "start" })
  }, [])

  const listMenu = (button: HTMLElement) => {
    const box = button.getBoundingClientRect()
    const items: MenuItem[] = open.map((note) => ({
      label: `${note.path === current ? "✓ " : "   "}${note.title}`,
      onClick: () => onSelect(note),
    }))
    if (open.length > 0) {
      items.push("-", { label: "Close Other Tabs", disabled: current === null || open.length < 2, onClick: () => current && onCloseOthers(current) })
    }
    if (open.length === 0) items.push({ label: "No open notes", disabled: true })
    setMenu({ x: box.right - 4, y: box.bottom + 2, items })
  }

  return (
    <div className="tab-bar" data-bar="tabs">
      <div className="tab-strip" ref={strip} onWheel={walk}>
        {open.map((note) => (
          <button key={note.path}
                  className={`tab${note.path === current ? " open" : ""}`}
                  title={note.path}
                  onClick={() => onSelect(note)}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(note.path) } }}
                  onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({
                      x: event.clientX, y: event.clientY, items: [
                        { label: "Close Tab", onClick: () => onClose(note.path) },
                        { label: "Close Other Tabs", disabled: open.length < 2, onClick: () => onCloseOthers(note.path) },
                        "-",
                        { label: `Reveal in ${fileManagerName(platform)}`, onClick: () => onReveal(note.path) },
                      ],
                    })
                  }}>
            <span className="name">{note.title}</span>
            <span className="close" role="button" aria-label="Close this tab" title={`Close this tab (${shown("closeTab", platform)})`}
                  onClick={(event) => { event.stopPropagation(); onClose(note.path) }}>×</span>
          </button>
        ))}
        {/* The + tab: a new note, the same as the sidebar's New Note — it opens selected, so its tab appears in front. */}
        <button className="tab-new" aria-label="New Tab" data-bar="new-tab"
                title={`New note (${shown("newNote", platform)})`} onClick={onNew}>+</button>
      </div>
      <div className="bar-divider" />
      <button className="icon-button tab-list" data-bar="tab-list" aria-label="Open Notes" aria-haspopup="menu"
              title={open.length === 1 ? "1 open note" : `${open.length} open notes`}
              onClick={(event) => listMenu(event.currentTarget)}>⌄</button>
      {menu && <FloatingMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} id="tab-menu" />}
    </div>
  )
}
