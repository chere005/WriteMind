/**
 * usePenFeed.ts - the Tablet sheet's side of the pen feed.
 *
 * While the Tablet source shows, main is told the feed is wanted (`pen:open`) and where the sheet is (`pen:sheet`, for the system mapping).
 * Main decides everything else: whether Wintab feeds the sheet (else the window's own pen does, untouched), and whether the window is in
 * front. `pen:close` goes when the sheet goes.
 *
 * Esc NEVER lets go of capture here: on the Tablet sheet it only clears a box or closes a menu (a second Esc used to drop the whole-tablet
 * mapping silently). A self-opened gate (a bug of ours must not take the pen away from the whole window) still releases until the window is
 * focused again.
 */

import { useCallback, useEffect, useRef } from "react"
import type { FeedStatus, SheetReport } from "../shared/pen"
import { currentTurns, subscribeOrientation } from "./orientation"
import { acceptStatus, installPenFeed, markOpened, markSheet, usePenFeedStore } from "./penFeed"

export interface PenFeedHandle {
  /** The platform has a native feed at all (false off Windows: the UI shows nothing). */
  available: boolean
  /** Capture is on right now: the gate is swallowing the OS pen and the feed is drawing the sheet. */
  capturing: boolean
  status: FeedStatus | null
  /** Why the gate opened itself, or null. */
  selfOpen: string | null
}

export function usePenFeed(sheetShowing: boolean): PenFeedHandle {
  const store = usePenFeedStore()
  const statusRef = useRef<FeedStatus | null>(null)
  statusRef.current = store.status

  useEffect(() => { installPenFeed() }, [])

  /** Tell main the feed is wanted (or wanted again, after a release). */
  const open = useCallback(async (): Promise<void> => {
    const api = window.wm?.pen
    if (!api) return
    try {
      const status = await api.open()
      acceptStatus(status)
      markOpened(true)
    } catch { /* the main side is gone: the gate stays open */ }
  }, [])

  // The sheet is showing: the feed is wanted. Leaving the tablet (or putting the pane away) lets go.
  useEffect(() => {
    const api = window.wm?.pen
    markSheet(sheetShowing)
    if (!api || !sheetShowing) return
    void open()
    return () => {
      markOpened(false)
      markSheet(false)
      void api.close("sheet gone").catch(() => undefined)
    }
  }, [sheetShowing, open])

  // Where the sheet is, for the system mapping (main turns it into physical pixels). Reported when it changes, nothing else.
  useEffect(() => {
    const api = window.wm?.pen
    if (!api || !sheetShowing) return
    let last = ""
    const report = (): void => {
      const element = document.querySelector<HTMLElement>('[data-tablet="surface"]')
      let payload: SheetReport | null = null
      if (element) {
        const r = element.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) payload = { rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, turns: currentTurns() }
      }
      const key = JSON.stringify(payload)
      if (key === last) return
      last = key
      try { api.sheet(payload) } catch { /* main is gone */ }
    }
    report()
    const timer = window.setInterval(report, 400)
    window.addEventListener("resize", report)
    const unsubscribe = subscribeOrientation(report)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("resize", report)
      unsubscribe()
      try { api.sheet(null) } catch { /* main is gone */ }
    }
  }, [sheetShowing])

  // Coming back to the window ends a release.
  useEffect(() => {
    if (!sheetShowing) return
    const focus = (): void => {
      const status = statusRef.current
      if (status && status.released !== null && status.settings.enabled) void open()
    }
    window.addEventListener("focus", focus)
    return () => { window.removeEventListener("focus", focus) }
  }, [sheetShowing, open])

  return { available: store.status?.available ?? false, capturing: store.capturing, status: store.status, selfOpen: store.selfOpen }
}
