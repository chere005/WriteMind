/**
 * The divider between the notes and the video — the Mac's `HSplitView` in
 * `ContentView`. It has no width of its own (the pane's border is the line);
 * its hit area straddles it. Dragging sets `--video-w` on the app, which the
 * camera pane's width reads (`chrome.css`).
 *
 * The position is kept as a FRACTION of what the two panes share, so a resize
 * or a change of display scale keeps the proportion, and it is remembered
 * between launches. Double-click puts it back to the Mac's 720 : 420; the
 * arrow keys move it when it has the keyboard. The mouse never gives it the
 * keyboard: a drag leaves the caret where it was.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { fractionFor, readFraction, videoWidth } from "../shared/layout"

const KEY = "writemind.videoFraction"

function load(): number | null {
  try { return readFraction(localStorage.getItem(KEY)) } catch { return null }
}
function store(fraction: number | null): void {
  try {
    if (fraction === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(fraction))
  } catch { /* private window */ }
}

interface Props {
  /** The sidebar being out changes what the two panes share. */
  sidebar: boolean
}

export function PaneDivider({ sidebar }: Props) {
  const self = useRef<HTMLDivElement>(null)
  const fraction = useRef<number | null>(load())
  const [dragging, setDragging] = useState(false)

  const app = (): HTMLElement | null => self.current?.closest<HTMLElement>(".app") ?? null

  /** The width the notes and the video share: the window less the sidebar. */
  const available = useCallback((): number => {
    const root = app()
    if (!root) return 0
    const side = root.querySelector<HTMLElement>(".sidebar")
    return root.clientWidth - (side ? side.getBoundingClientRect().width : 0)
  }, [])

  const apply = useCallback(() => {
    const root = app()
    const room = available()
    if (!root || room <= 0) return
    root.style.setProperty("--video-w", `${videoWidth(room, fraction.current)}px`)
  }, [available])

  // Re-measured whenever the window, the sidebar or the display scale changes.
  useEffect(() => {
    apply()
    const root = app()
    if (!root) return
    const watcher = new ResizeObserver(apply)
    watcher.observe(root)
    return () => watcher.disconnect()
  }, [apply, sidebar])

  const move = (clientX: number) => {
    const root = app()
    const room = available()
    if (!root || room <= 0) return
    const video = root.getBoundingClientRect().right - clientX
    fraction.current = fractionFor(room, videoWidth(room, fractionFor(room, video)))
    apply()
  }

  const nudge = (delta: number) => {
    const room = available()
    if (room <= 0) return
    const now = videoWidth(room, fraction.current)
    fraction.current = fractionFor(room, videoWidth(room, fractionFor(room, now + delta)))
    apply()
    store(fraction.current)
  }

  return (
    <div ref={self} className={`pane-divider${dragging ? " dragging" : ""}`}
         role="separator" aria-orientation="vertical" aria-label="Resize the notes and the video"
         tabIndex={0}
         title="Drag to resize — double-click to reset"
         onPointerDown={(event) => {
           if (event.button !== 0) return
           // The mouse must not take the keyboard from the notes.
           event.preventDefault()
           event.currentTarget.setPointerCapture(event.pointerId)
           setDragging(true)
         }}
         onPointerMove={(event) => { if (dragging) move(event.clientX) }}
         onPointerUp={(event) => {
           if (!dragging) return
           setDragging(false)
           try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* gone */ }
           store(fraction.current)
         }}
         onPointerCancel={() => { setDragging(false); store(fraction.current) }}
         onDoubleClick={() => { fraction.current = null; store(null); apply() }}
         onKeyDown={(event) => {
           if (event.key === "ArrowLeft") { event.preventDefault(); nudge(24) }
           else if (event.key === "ArrowRight") { event.preventDefault(); nudge(-24) }
           else if (event.key === "Home") { event.preventDefault(); fraction.current = null; store(null); apply() }
         }} />
  )
}
