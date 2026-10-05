/**
 * penFeed.ts - the renderer's half of the native pen feed (docs/spikes/DESIGN-pen-capture.md 8.1 - 8.3).
 *
 *   pen:samples (a PenBatch, SHEET frame: main already applied the device frame)  ->  orientation turns  ->  a client point inside the sheet  ->  the SYNTHESISER
 *   (shared/penEvents.ts: sample -> events)  ->  real `PointerEvent`s{pointerType: "pen"} dispatched on the element under that point.
 *
 * WHY SYNTHETIC EVENTS and not a new draw path: the e2e harness has driven the sheet and the notes page with exactly such events since the pen
 * suites were written, so every handler (TabletSurface, penButtons.resolvePress / tapStep, penLive, penCursor, penActions) is proven to accept
 * them. Reusing them guarantees that every pen feature (pressure, the lower / upper / eraser buttons and their actions, tap actions, the in-app
 * ring, palm rejection, ExpressKeys) behaves identically on the native feed, and the pen and tablet suites keep testing the real thing.
 *
 * The events pass the gate because the dispatch runs inside `gate.emit(...)`. A stroke keeps its target: from pointerdown to pointerup every event
 * goes to the element that took the pointerdown (like implicit pointer capture, which a synthetic pointer id cannot have), so a stroke that crosses
 * the strip or a button still ends on the sheet. Synthetic pointer events never produce `click`, so a pointerup on the same button as its
 * pointerdown after < 6 px of movement clicks it.
 *
 * The dispatcher is plain TypeScript over a few injected functions (the DOM is behind `DispatchEnv`), so the whole mapping is a vitest.
 */

import { useSyncExternalStore } from "react"
import type { FeedStatus, PenApi, PenBatch, PenFeedSettings, PenSample, Turn } from "../shared/pen"
import { createSynth, type SynthEvent } from "../shared/penEvents"
import { tabletToSheet } from "../shared/orientation"
import { currentTurns, setTabletAspect } from "./orientation"
import { penGate, type Gate } from "./penGate"

/** The fixed pointer id of the synthetic pen (design 8.3). */
export const SYNTH_POINTER_ID = 4242
/** A pointerup this close to its pointerdown clicks the button it started on. */
export const CLICK_SLOP_PX = 6

export interface Rect { left: number; top: number; width: number; height: number }

/** What the dispatcher needs of the page; tests fake it. */
export interface DispatchEnv {
  /** The sheet ([data-tablet="surface"]) in CSS pixels of this page, or null when it is not showing. */
  sheetRect(): Rect | null
  turns(): Turn
  elementAt(x: number, y: number): Element | null
  fallbackTarget(): Element
  /** Build and dispatch one pointer event on `target`; returns nothing (the gate's `emit` wraps the whole batch). */
  dispatch(target: Element, init: SynthInit): void
  /** A clickable ancestor of `target` (button, [role=button], link, summary) that is enabled and not part of the sheet itself, or null. */
  clickable(target: Element): HTMLElement | null
  /** ctrl / alt / shift / meta as the page's keys have them now. */
  modifiers(): { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }
}

export interface SynthInit {
  type: SynthEvent["type"]
  clientX: number
  clientY: number
  button: number
  buttons: number
  pressure: number
  tiltX?: number
  tiltY?: number
  relatedTarget: Element | null
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export interface Dispatcher {
  /** One batch of screen-frame samples in; real pointer events out (on the page). Returns the events dispatched. */
  batch(samples: PenSample[]): number
  /** Blur, failover, close, backend change: end any contact and leave. Never a pointercancel. */
  reset(): void
  readonly inRange: boolean
}

const isEnterLeave = (type: SynthEvent["type"]): boolean => type === "pointerenter" || type === "pointerleave"

export function createDispatcher(env: DispatchEnv, hooks: { onTip?(): void; onThrow?(error: unknown): void } = {}): Dispatcher {
  const synth = createSynth()
  let hover: Element | null = null
  /** `tip`: the contact began with the tip (a side button pressed in the air never clicks: its taps are the pen's own). */
  let down: { target: Element; x: number; y: number; tip: boolean } | null = null
  let last = { x: 0, y: 0 }

  const emit = (ev: SynthEvent, x: number, y: number): void => {
    const fallback = env.fallbackTarget()
    let target: Element
    switch (ev.type) {
      case "pointerover": case "pointerenter":
        target = env.elementAt(x, y) ?? fallback
        hover = target
        break
      case "pointerdown":
        target = env.elementAt(x, y) ?? fallback
        down = { target, x, y, tip: ev.button === 0 }
        hover = target
        break
      case "pointermove": case "pointerup":
        target = down && down.target.isConnected ? down.target : (env.elementAt(x, y) ?? fallback)
        break
      default: // pointerout, pointerleave
        target = hover && hover.isConnected ? hover : fallback
        break
    }
    if (ev.type === "pointermove" && !down) hover = target
    env.dispatch(target, {
      type: ev.type, clientX: x, clientY: y, button: ev.button, buttons: ev.buttons, pressure: ev.pressure,
      ...(ev.tiltX !== undefined ? { tiltX: ev.tiltX } : {}), ...(ev.tiltY !== undefined ? { tiltY: ev.tiltY } : {}),
      relatedTarget: null, ...env.modifiers(),
    })
    if (ev.type === "pointerup" && down) {
      const started = down
      down = null
      if (started.tip && Math.hypot(x - started.x, y - started.y) < CLICK_SLOP_PX) {
        const button = env.clickable(started.target)
        if (button) button.click()
      }
    }
    if (ev.type === "pointerout" || ev.type === "pointerleave") hover = null
  }

  return {
    get inRange() { return synth.inRange },
    batch(samples) {
      const rect = env.sheetRect()
      // No sheet (the pane is hidden): the batch is dropped, but a visit that ends in it still ends.
      let count = 0
      for (const s of samples) {
        try {
          if (!rect) {
            if (!s.inRange) { for (const ev of synth.step(s)) { emit(ev, last.x, last.y); count++ } }
            continue
          }
          const u = tabletToSheet({ x: s.x, y: s.y }, env.turns())
          // Inside the sheet, always: the right and bottom edges are exclusive, so the last pixel is just short of them.
          const x = rect.left + Math.min(rect.width - 0.001, Math.max(0, u.x * rect.width))
          const y = rect.top + Math.min(rect.height - 0.001, Math.max(0, u.y * rect.height))
          last = { x, y }
          if (s.tip) hooks.onTip?.()
          for (const ev of synth.step(s)) { emit(ev, x, y); count++ }
        } catch (error) { hooks.onThrow?.(error) }
      }
      return count
    },
    reset() {
      try {
        for (const ev of synth.reset()) emit(ev, last.x, last.y)
      } catch (error) { hooks.onThrow?.(error) }
      down = null
      hover = null
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The real page behind DispatchEnv
// ---------------------------------------------------------------------------------------------

function realEnv(gate: Gate, fault: { n: number }): DispatchEnv {
  const keys = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }
  const track = (event: KeyboardEvent): void => {
    keys.ctrlKey = event.ctrlKey; keys.altKey = event.altKey; keys.shiftKey = event.shiftKey; keys.metaKey = event.metaKey
  }
  window.addEventListener("keydown", track, true)
  window.addEventListener("keyup", track, true)
  window.addEventListener("blur", () => { keys.ctrlKey = keys.altKey = keys.shiftKey = keys.metaKey = false })
  return {
    sheetRect() {
      const element = document.querySelector<HTMLElement>('[data-tablet="surface"]')
      if (!element) return null
      const r = element.getBoundingClientRect()
      return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
    },
    turns: currentTurns,
    elementAt: (x, y) => document.elementFromPoint(x, y),
    fallbackTarget: () => document.body,
    dispatch(target, init) {
      if (fault.n > 0) { fault.n--; throw new Error("pen feed test fault") }
      const flat = isEnterLeave(init.type)
      const event = new PointerEvent(init.type, {
        pointerId: SYNTH_POINTER_ID, pointerType: "pen", isPrimary: true, width: 1, height: 1,
        pressure: init.pressure, tiltX: init.tiltX ?? 0, tiltY: init.tiltY ?? 0,
        clientX: init.clientX, clientY: init.clientY, screenX: window.screenX + init.clientX, screenY: window.screenY + init.clientY,
        button: init.button, buttons: init.buttons, relatedTarget: init.relatedTarget,
        ctrlKey: init.ctrlKey, altKey: init.altKey, shiftKey: init.shiftKey, metaKey: init.metaKey,
        bubbles: !flat, cancelable: !flat, composed: true, view: window,
      })
      gate.emit(() => { target.dispatchEvent(event) })
    },
    clickable(target) {
      const hit = target.closest<HTMLElement>('button, [role="button"], summary, a[href]')
      if (!hit || hit.closest('[data-tablet="surface"]')) return null
      if (hit instanceof HTMLButtonElement && hit.disabled) return null
      if (hit.getAttribute("aria-disabled") === "true") return null
      return hit
    },
    modifiers: () => ({ ...keys }),
  }
}

// ---------------------------------------------------------------------------------------------
// The store the UI reads (status, capture), and the subscriptions
// ---------------------------------------------------------------------------------------------

export interface FeedSnapshot {
  status: FeedStatus | null
  /** Why the gate opened itself, or null. */
  selfOpen: string | null
  /** Capture is on right now (the gate is swallowing the OS pen). */
  capturing: boolean
}

let snapshot: FeedSnapshot = { status: null, selfOpen: null, capturing: false }
const listeners = new Set<() => void>()
const publish = (next: Partial<FeedSnapshot>): void => {
  snapshot = { ...snapshot, ...next }
  for (const l of [...listeners]) { try { l() } catch { /* ignore */ } }
}
export const feedSnapshot = (): FeedSnapshot => snapshot
export const subscribeFeed = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const usePenFeedStore = (): FeedSnapshot => useSyncExternalStore(subscribeFeed, feedSnapshot)

/** The feed is silent this long mid-visit: let go (main ends a visit itself after 0.6 s hovering / 2 s in contact). */
export const STALL_MS = 4000
let lastBatchAt = 0
let started = false
let dispatcher: Dispatcher | null = null
const fault = { n: 0 }

/** Subscribe to the preload's pen API once. Safe to call from several places; does nothing without `window.wm.pen`. */
export function installPenFeed(): void {
  if (started || typeof window === "undefined") return
  const api: PenApi | undefined = window.wm?.pen
  if (!api) return
  started = true
  const gate = penGate()
  dispatcher = createDispatcher(realEnv(gate, fault), { onTip: () => gate.noteTip(), onThrow: (error) => gate.noteError(error) })

  api.onSamples((batch: PenBatch) => {
    const d = dispatcher
    if (!d) return
    // A real DOM pen contact that is already down is never cut: the feed waits for it to end.
    if (!d.inRange && gate.domContact()) return
    d.batch(batch.samples)
    lastBatchAt = performance.now()
    gate.setState({ nativeLive: d.inRange })
  })
  // A feed that stalls mid-visit (a sample listener died, the backend hung) must not hold the pen forever: the window pen takes over again.
  setInterval(() => {
    if (dispatcher?.inRange && performance.now() - lastBatchAt > STALL_MS) { dispatcher.reset(); gate.setState({ nativeLive: false }) }
  }, 1000)
  api.onStatus(acceptStatus)
  api.onEvent((event) => {
    if (event.kind === "released" || event.kind === "failover") { dispatcher?.reset(); gate.setState({ nativeLive: false }) }
  })
  gate.onChange(() => publish({ capturing: gate.captureOn() }))
  gate.onSelfOpen((reason) => {
    dispatcher?.reset()
    gate.setState({ nativeLive: false })
    publish({ selfOpen: reason, capturing: false })
    // Tell main too: it lets go of everything and waits for the person to switch capture on again.
    try { api.panic(`gate: ${reason}`) } catch { /* ignore */ }
  })
  if (window.wm.e2eWindow) {
    ;(window as unknown as Record<string, unknown>).__wmPenFeed = {
      /** Make the next n synthesised events throw (the self-opening test of design 15.4 #2). */
      failSynth(n: number) { fault.n = n },
      snapshot: () => snapshot,
      gate: () => ({ ...gate.state, capturing: gate.captureOn() }),
    }
  }
}

/** Status and opening are driven by usePenFeed; these are its two entry points into the store. */
export function acceptStatus(status: FeedStatus): void {
  const gate = penGate()
  gate.setState({ available: status.available, enabled: status.settings.enabled, released: status.released !== null })
  // The pen left the sheet's feed (released, capture off): end any contact so no stroke hangs, and give the window pen back.
  if (status.released !== null || !status.settings.enabled) { dispatcher?.reset(); gate.setState({ nativeLive: false }) }
  // The sheet takes the tablet's own shape (landscape for a landscape tablet), whatever the screen's.
  setTabletAspect(status.tablet?.aspect ?? null)
  publish({ status, capturing: gate.captureOn() })
}
export function markOpened(opened: boolean): void {
  const gate = penGate()
  gate.setState({ opened })
  publish({ capturing: gate.captureOn() })
}
export function markSheet(showing: boolean): void {
  const gate = penGate()
  gate.setState({ sheetShowing: showing })
  if (!showing) { dispatcher?.reset(); gate.setState({ nativeLive: false }) }
  publish({ capturing: gate.captureOn() })
}
/** Change the feed's settings (capture on / off) and let every reader see the answer at once. */
export async function changeSettings(patch: Partial<PenFeedSettings>): Promise<PenFeedSettings | null> {
  const api = window.wm?.pen
  if (!api) return null
  const settings = await api.setSettings(patch)
  if (snapshot.status) acceptStatus({ ...snapshot.status, settings })
  return settings
}
/** Capture was switched on again by the person: forget self-opening. */
export function clearSelfOpen(): void {
  penGate().reset()
  publish({ selfOpen: null, capturing: penGate().captureOn() })
}

/** A Wintab tablet is known (the sheet then belongs to the pen and the mouse selects). */
export const tabletKnown = (): boolean => snapshot.status?.tablet != null
export const useTabletKnown = (): boolean => usePenFeedStore().status?.tablet != null
