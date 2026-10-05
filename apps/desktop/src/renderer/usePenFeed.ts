/**
 * usePenFeed.ts - the Tablet sheet's side of the native pen feed (docs/spikes/DESIGN-pen-capture.md 8.8), owned by IMPL-D. It replaces useGrabHost.
 *
 * While the Tablet source shows, the sheet's geometry goes to main (`pen:open`, then `pen:sheet` every 250 ms and on resize when it changed) and
 * the page's gate is armed (penGate.ts). Main decides everything else: which backend feeds the sheet, whether capture is on (`settings.enabled`),
 * whether the window is in front. `pen:close` goes when the sheet goes.
 *
 * Esc releases capture only when the keyboard focus is NOT in a text field (the editor keeps its Esc). Ctrl+Alt+G (the `tabletGrab` command, which
 * reaches the pane as the `wm:grab-toggle` event) switches capture. A panic (Esc, the chip's Release, a self-opened gate) stays released until the
 * window is focused again or the person switches capture on.
 *
 * The one-time migration of the old Grab settings: `writemind.grabAuto === "false"` meant Grab was off, which is now `settings.enabled = false`;
 * `writemind.grabPenOnly` is dropped (the pen is exclusive by construction now). Both keys are then removed.
 */

import { useCallback, useEffect, useRef } from "react"
import type { FeedStatus } from "../shared/pen"
import { acceptStatus, changeSettings, clearSelfOpen, installPenFeed, markOpened, markSheet, sheetGeometry, usePenFeedStore } from "./penFeed"
import { escapeReleases, penGate } from "./penGate"
import { useOrientation } from "./orientation"

const OLD_AUTO = "writemind.grabAuto"
const OLD_PEN_ONLY = "writemind.grabPenOnly"

/** Move the old Grab switch to the new setting, once; returns true when it had said "off". */
export function migrateGrabKeys(storage: Pick<Storage, "getItem" | "removeItem">): boolean {
  let off = false
  try {
    off = storage.getItem(OLD_AUTO) === "false"
    storage.removeItem(OLD_AUTO)
    storage.removeItem(OLD_PEN_ONLY)
  } catch { /* storage unavailable: nothing to migrate */ }
  return off
}

export interface PenFeedHandle {
  /** The platform has a native feed at all (false off Windows: the UI shows nothing). */
  available: boolean
  /** Capture is on right now: the gate is swallowing the OS pen and the feed is drawing the sheet. */
  capturing: boolean
  status: FeedStatus | null
  /** Why the gate opened itself, or null. */
  selfOpen: string | null
  /** The Capture switch: on <-> off. */
  toggle(): void
  /** Release now (Esc, the chip's Release): stays released until the window is focused again or capture is switched on. */
  release(): void
}

export function usePenFeed(sheetShowing: boolean): PenFeedHandle {
  const store = usePenFeedStore()
  const orient = useOrientation()
  const statusRef = useRef<FeedStatus | null>(null)
  statusRef.current = store.status
  const showing = useRef(sheetShowing)
  showing.current = sheetShowing

  useEffect(() => { installPenFeed() }, [])

  /** Tell main the feed is wanted (or wanted again, after a panic). */
  const open = useCallback(async (): Promise<void> => {
    const api = window.wm?.pen
    const geometry = sheetGeometry()
    if (!api || !geometry) return
    try {
      const status = await api.open(geometry)
      acceptStatus(status)
      markOpened(true)
    } catch { /* the main side is gone: the gate stays open */ }
  }, [])

  // The sheet is showing: the feed is wanted. Leaving the tablet (or putting the pane away) lets go.
  useEffect(() => {
    const api = window.wm?.pen
    markSheet(sheetShowing)
    if (!api || !sheetShowing) return
    let cancelled = false
    // The old Grab switch, once: "off" there is capture off here.
    if (migrateGrabKeys(window.localStorage)) void changeSettings({ enabled: false }).catch(() => undefined)
    void (async () => {
      // The sheet's element may mount a frame after this effect; wait for a geometry.
      for (let i = 0; i < 20 && !cancelled && !sheetGeometry(); i++) await new Promise((r) => setTimeout(r, 50))
      if (!cancelled) await open()
    })()
    let last = ""
    const push = (): void => {
      const geometry = sheetGeometry()
      const key = JSON.stringify(geometry)
      if (key === last) return
      last = key
      api.sheet(geometry)
    }
    const timer = window.setInterval(push, 250)
    window.addEventListener("resize", push)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener("resize", push)
      markOpened(false)
      markSheet(false)
      void api.close("sheet gone").catch(() => undefined)
    }
  }, [sheetShowing, open])

  // The turned tablet changes the geometry main knows about (the sheet is portrait for 1 and 3).
  useEffect(() => { if (showing.current) window.wm?.pen?.sheet(sheetGeometry()) }, [orient])

  const release = useCallback(() => { window.wm?.pen?.panic("release") }, [])
  const toggle = useCallback(() => {
    const api = window.wm?.pen
    if (!api) return
    const status = statusRef.current
    const on = status !== null && status.settings.enabled && status.released === null && penCaptureOn()
    if (on) { void changeSettings({ enabled: false }).catch(() => undefined); return }
    clearSelfOpen()
    void changeSettings({ enabled: true }).then(async () => { await open() }).catch(() => undefined)
  }, [open])

  // Esc lets go (not from a text field); coming back to the window ends a let-go.
  useEffect(() => {
    if (!sheetShowing) return
    const key = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !penCaptureOn()) return
      if (!escapeReleases(document.activeElement)) return
      event.preventDefault()
      window.wm?.pen?.panic("esc")
    }
    const focus = (): void => {
      const status = statusRef.current
      if (status && status.released !== null && status.settings.enabled) void open()
    }
    window.addEventListener("keydown", key)
    window.addEventListener("focus", focus)
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("focus", focus) }
  }, [sheetShowing, open])

  return {
    available: store.status?.available ?? false,
    capturing: store.capturing,
    status: store.status,
    selfOpen: store.selfOpen,
    toggle,
    release,
  }
}

const penCaptureOn = (): boolean => penGate().captureOn()
