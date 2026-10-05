/**
 * PenSink.tsx - the page of the pen-sink window (route `?pen-sink=1`, mounted by main.tsx; docs/spikes/DESIGN-pen-capture.md 7.6).
 *
 * It renders nothing visible. While main says it is `on`, it paints rgba(0,0,0,0.01) (Windows hit-tests a transparent window only if
 * it paints alpha >= 1/255), hides the arrow (`cursor: none`; the ring on the sheet shows where the pen is), swallows the pen's
 * pointer events and reports them. All decisions are in penSinkCore.ts; this is the glue to the DOM and to `window.wm.penSink`.
 */

import { useEffect } from "react"
import type { PenSinkApi } from "../shared/pen"
import { SinkPageCore, type PtrEvt } from "./penSinkCore"
import "./penSink.css"

type SinkBridge = PenSinkApi & { onState?: (listener: (on: boolean) => void) => () => void }
const bridge = (): SinkBridge | null => (window as unknown as { wm?: { penSink?: SinkBridge } }).wm?.penSink ?? null

const toEvt = (e: PointerEvent): PtrEvt => ({
  type: e.type, pointerType: e.pointerType, screenX: e.screenX, screenY: e.screenY, pressure: e.pressure, buttons: e.buttons,
  timeStamp: e.timeStamp, tiltX: e.tiltX, tiltY: e.tiltY,
})

export default function PenSink() {
  useEffect(() => {
    const api = bridge()
    if (!api) return
    const root = document.documentElement
    const core = new SinkPageCore({
      timeOrigin: performance.timeOrigin,
      now: () => performance.now(),
      send: { pen: (r) => api.pen(r), mouse: () => api.mouse(), beat: () => api.beat() },
      paint: (solid) => { root.dataset.solid = solid ? "1" : "0" },
    })
    ;(window as unknown as { __penSink?: SinkPageCore }).__penSink = core // E2E / diagnostics
    const handler = (e: PointerEvent): void => {
      const co = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents().map(toEvt) : []
      if (core.onPointer(toEvt(e), co)) { e.preventDefault(); e.stopPropagation() }
    }
    const types = ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave", "pointerover", "pointerenter"] as const
    for (const t of types) window.addEventListener(t, handler, { capture: true, passive: false })
    const noMenu = (e: Event): void => e.preventDefault()
    window.addEventListener("contextmenu", noMenu, true)
    let raf = 0
    const frame = (): void => { core.flush(); raf = requestAnimationFrame(frame) }
    raf = requestAnimationFrame(frame)
    // rAF is throttled for a window that is not visible; the timer keeps the batches flowing and is the page's dead-man clock.
    const timer = window.setInterval(() => { core.flush(); core.tick() }, 100)
    const off = api.onState?.((on) => core.onState(on)) ?? null
    api.beat()
    return () => {
      for (const t of types) window.removeEventListener(t, handler, { capture: true })
      window.removeEventListener("contextmenu", noMenu, true)
      cancelAnimationFrame(raf)
      window.clearInterval(timer)
      off?.()
    }
  }, [])
  return null
}
