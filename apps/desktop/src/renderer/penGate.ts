/**
 * penGate.ts - THE GATE (docs/spikes/DESIGN-pen-capture.md 8.4), owned by IMPL-D.
 *
 * The very first capture listeners on `window` (imported first in main.tsx: `installPenGate()` before `watchPen()`). For every REAL pen pointer
 * event the OS delivers to this page it
 *   1. REPORTS it: one `DomPenReport` per event and per coalesced event, batched into one `pen:dom` message per animation frame (the `dom`
 *      backend's input), and a `Witness` on `pen:witness` (<= 30 a second: where the pen is, for stale detection and the frame calibration);
 *   2. SWALLOWS it while capture is on (`stopImmediatePropagation`, and `preventDefault` for everything but a move), so nothing is drawn twice
 *      and the notes page never receives the pen. The synthetic events the feed dispatches (renderer/penFeed.ts) are marked by `emitting` and pass.
 *
 * `captureOn()` does not depend on whether any backend is live (revision 2): with the `dom` backend there is always a consumer for what the gate
 * swallows, so the gate has no timers and no "healthy" state. What gives the pen back: the capture switch (chip, Ctrl+Alt+G), the window not in
 * front (`released`), the Tablet source not showing, capture disabled in the settings, a platform other than Windows, and SELF-OPENING: if the
 * gate's own code or the synthesiser throws five times within a second, or `pen:samples` stops arriving for 3 s while reports are being sent
 * (a broken IPC), the gate opens and stays open until capture is switched on again. A bug of ours must not take the pen away from the whole window.
 *
 * The echo rule: a pen tip down within ECHO_MS of a DOM MOUSE event means the mouse event is the pen's own echo (a tablet in Mouse mode sends the
 * tap as a mouse event too): it is swallowed while capture is on. A real mouse is not affected.
 *
 * Everything the gate needs from the world is injected (`GateEnv`), so the whole file is a vitest with a fake window.
 */

import type { DomPenReport, PenApi, Witness } from "../shared/pen"

/** A pen tip down this recently makes a mouse event an echo. */
export const ECHO_MS = 300
/** At most this many witnesses a second (design 3.3). */
export const WITNESS_MIN_GAP_MS = 33
/** The mouse witness (main uses it only to drop calibration pairs while the mouse is in use): at most 10 a second. */
export const MOUSE_WITNESS_GAP_MS = 100
/** Five throws within this long open the gate by itself. */
export const SELF_OPEN_WINDOW_MS = 1000
export const SELF_OPEN_ERRORS = 5
/** Reports sent and no `pen:samples` back for this long: the IPC is broken, open the gate. */
export const NO_SAMPLES_MS = 3000
/** A report list is capped (the main side takes at most 512). */
export const MAX_REPORTS = 512

const SWALLOWED = [
  "pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave",
  "gotpointercapture", "lostpointercapture",
] as const

/** The part of a PointerEvent the gate reads (tests pass look-alikes). */
export interface GateEvent {
  type: string
  pointerType: string
  screenX: number
  screenY: number
  pressure: number
  buttons: number
  button?: number
  tiltX?: number
  tiltY?: number
  timeStamp: number
  relatedTarget?: unknown
  cancelable: boolean
  stopImmediatePropagation(): void
  preventDefault(): void
  getCoalescedEvents?(): GateEvent[]
}

export interface GateTarget {
  addEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
  removeEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
}

export interface GateEnv {
  target: GateTarget
  api: Pick<PenApi, "dom" | "witness"> | null
  /** Epoch ms. */
  now(): number
  /** Epoch ms of a DOM timeStamp (performance.timeOrigin + timeStamp). */
  stamp(timeStamp: number): number
  raf(callback: () => void): unknown
  cancelRaf(handle: unknown): void
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  /** The <html> element's class list, for the `pen-capture` page hook. */
  root: { classList: { toggle(name: string, force?: boolean): unknown } } | null
}

export interface GateState {
  /** The platform has a native feed at all (FeedStatus.available). */
  available: boolean
  /** settings.enabled: the capture switch. */
  enabled: boolean
  /** FeedStatus.released: the window is not in front, or a panic. */
  released: boolean
  /** The Tablet sheet is showing. */
  sheetShowing: boolean
  /** pen:open has been acknowledged (main knows the feed is wanted). */
  opened: boolean
  /** Why the gate opened itself, or null. */
  selfOpen: string | null
}

const initial = (): GateState => ({ available: false, enabled: true, released: false, sheetShowing: false, opened: false, selfOpen: null })

export interface Gate {
  state: Readonly<GateState>
  setState(patch: Partial<GateState>): void
  captureOn(): boolean
  /** Run `fn` with the gate letting events through (the synthesiser's dispatch). */
  emit<T>(fn: () => T): T
  /** A throw in the synthesiser or the gate's own code (counts toward self-opening). */
  noteError(error: unknown): void
  /** `pen:samples` arrived (the IPC is alive). */
  noteSamples(): void
  /** A pen tip was seen (real or synthetic): the echo rule. */
  noteTip(): void
  /** Capture is switched on again: clears self-opening. */
  reset(): void
  onChange(listener: () => void): () => void
  onSelfOpen(listener: (reason: string) => void): () => void
  install(): () => void
  /** Reports waiting for the next frame (tests). */
  pending(): number
}

export function createGate(env: GateEnv): Gate {
  const state: GateState = initial()
  const changeListeners = new Set<() => void>()
  const selfOpenListeners = new Set<(reason: string) => void>()
  let emitting = false
  let reports: DomPenReport[] = []
  let frame: unknown = null
  let lastWitnessAt = -Infinity
  let lastMouseWitnessAt = -Infinity
  let lastTipAt = -Infinity
  let lastReportAt = -Infinity
  let waitingSince: number | null = null
  let lastPos: { sx: number; sy: number } | null = null
  const errors: number[] = []
  let watchdog: unknown = null
  let lastCapture = false

  const captureOn = (): boolean =>
    state.available && state.enabled && state.sheetShowing && state.opened && !state.released && state.selfOpen === null

  const changed = (): void => {
    const on = captureOn()
    if (on !== lastCapture) {
      lastCapture = on
      try { env.root?.classList.toggle("pen-capture", on) } catch { /* no document */ }
      if (!on) { reports = []; if (frame !== null) { env.cancelRaf(frame); frame = null } waitingSince = null }
    }
    for (const l of [...changeListeners]) { try { l() } catch { /* a listener never breaks the gate */ } }
  }

  const selfOpen = (reason: string): void => {
    if (state.selfOpen !== null) return
    state.selfOpen = reason
    changed()
    for (const l of [...selfOpenListeners]) { try { l(reason) } catch { /* ignore */ } }
  }

  const noteError = (error: unknown): void => {
    const at = env.now()
    errors.push(at)
    while (errors.length > 0 && at - errors[0]! > SELF_OPEN_WINDOW_MS) errors.shift()
    if (errors.length >= SELF_OPEN_ERRORS) selfOpen(`Pen capture stopped: the pen code threw ${errors.length} times in a second (${(error as Error)?.message ?? String(error)})`)
  }

  const flush = (): void => {
    frame = null
    if (reports.length === 0 || !env.api) return
    const out = reports
    reports = []
    try { env.api.dom(out) } catch (error) { noteError(error) }
    lastReportAt = env.now()
    waitingSince ??= lastReportAt
  }

  const push = (report: DomPenReport): void => {
    reports.push(report)
    if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS)
    if (frame === null) frame = env.raf(flush)
  }

  const reportOf = (ev: GateEvent, inRange: boolean): DomPenReport => {
    const r: DomPenReport = { t: env.stamp(ev.timeStamp), sx: ev.screenX, sy: ev.screenY, p: inRange ? ev.pressure : 0, buttons: inRange ? ev.buttons : 0, inRange }
    // Chromium reports tilt 0 for a pen without tilt; absent means "no tilt" (design 3.1), so only a real tilt is sent.
    if (inRange && (ev.tiltX || ev.tiltY)) { r.tiltX = ev.tiltX ?? 0; r.tiltY = ev.tiltY ?? 0 }
    return r
  }

  const report = (e: GateEvent): void => {
    if (!state.available || !state.enabled || !state.sheetShowing) return
    const type = e.type
    if (type === "pointerout" || type === "pointercancel") {
      // The pen leaves the document (relatedTarget is null) or is cancelled: the one report that ends a visit.
      if (type === "pointercancel" || e.relatedTarget === null) {
        const pos = lastPos ?? { sx: e.screenX, sy: e.screenY }
        push({ t: env.stamp(e.timeStamp), sx: pos.sx, sy: pos.sy, p: 0, buttons: 0, inRange: false })
        sendWitness(false, e, true)
      }
      return
    }
    if (type !== "pointerdown" && type !== "pointermove" && type !== "pointerup") return
    const list = type === "pointermove" ? (e.getCoalescedEvents?.() ?? []) : []
    const events = list.length > 0 ? list : [e]
    for (const ev of events) push(reportOf(ev, true))
    lastPos = { sx: e.screenX, sy: e.screenY }
    if (e.buttons & 1) lastTipAt = env.now()
    sendWitness(true, e, type !== "pointermove")
  }

  const sendWitness = (inRange: boolean, e: GateEvent, force: boolean): void => {
    if (!env.api) return
    const at = env.now()
    if (!force && at - lastWitnessAt < WITNESS_MIN_GAP_MS) return
    lastWitnessAt = at
    const w: Witness = { source: "dom", inRange, at, screenDip: { x: e.screenX, y: e.screenY }, buttons: e.buttons, pointerType: "pen" }
    try { env.api.witness(w) } catch (error) { noteError(error) }
  }

  const swallow = (e: GateEvent): void => {
    e.stopImmediatePropagation()
    if (e.type !== "pointermove" && e.cancelable) e.preventDefault()
  }

  const handle = (e: GateEvent): void => {
    if (emitting) return
    try {
      if (e.pointerType === "pen") {
        report(e)
        if (captureOn()) swallow(e)
      } else if (e.pointerType === "mouse") {
        const at = env.now()
        if (captureOn() && at - lastTipAt < ECHO_MS) { swallow(e); return }
        if (env.api && e.type === "pointermove" && at - lastMouseWitnessAt >= MOUSE_WITNESS_GAP_MS) {
          lastMouseWitnessAt = at
          env.api.witness({ source: "dom", inRange: false, at, pointerType: "mouse" })
        }
      }
    } catch (error) { noteError(error) }
  }

  const gate: Gate = {
    state,
    setState(patch) {
      const before = JSON.stringify(state)
      Object.assign(state, patch)
      if (JSON.stringify(state) !== before) changed()
    },
    captureOn,
    emit(fn) {
      const was = emitting
      emitting = true
      try { return fn() } finally { emitting = was }
    },
    noteError,
    noteSamples() { waitingSince = null },
    noteTip() { lastTipAt = env.now() },
    reset() {
      errors.length = 0
      waitingSince = null
      if (state.selfOpen !== null) { state.selfOpen = null; changed() }
    },
    onChange(listener) { changeListeners.add(listener); return () => { changeListeners.delete(listener) } },
    onSelfOpen(listener) { selfOpenListeners.add(listener); return () => { selfOpenListeners.delete(listener) } },
    pending: () => reports.length,
    install() {
      const listener = (e: GateEvent): void => handle(e)
      // (pointerrawupdate, the device's own rate, is NOT listened to: with coalesced events on pointermove it would report each sample twice.)
      for (const type of SWALLOWED) env.target.addEventListener(type, listener, true)
      watchdog = env.setInterval(() => {
        if (captureOn() && waitingSince !== null && env.now() - waitingSince > NO_SAMPLES_MS && env.now() - lastReportAt < NO_SAMPLES_MS) {
          selfOpen("Pen capture stopped: reports were sent but no pen samples came back for 3 s")
        }
      }, 1000)
      return () => {
        for (const type of SWALLOWED) env.target.removeEventListener(type, listener, true)
        if (watchdog !== null) env.clearInterval(watchdog)
        if (frame !== null) env.cancelRaf(frame)
        env.root?.classList.toggle("pen-capture", false)
      }
    },
  }
  return gate
}

// ---------------------------------------------------------------------------------------------
// Esc (design 8.8, test 15.2 #33): the editor keeps its Esc
// ---------------------------------------------------------------------------------------------

/** The selector of every place a keyboard focus means "typing": the editor, inputs, selects, contenteditable. */
export const TEXT_FIELD = ".cm-editor, input, textarea, select, [contenteditable='true'], [contenteditable='']"

/** Does Esc release capture with the keyboard focus on `focused`? Not when it is in a text field (the editor keeps its Esc). */
export function escapeReleases(focused: { closest?(selector: string): unknown } | null | undefined): boolean {
  if (!focused || typeof focused.closest !== "function") return true
  return focused.closest(TEXT_FIELD) === null
}

// ---------------------------------------------------------------------------------------------
// The singleton the page uses
// ---------------------------------------------------------------------------------------------

let gate: Gate | null = null

function realEnv(): GateEnv {
  return {
    target: window,
    api: typeof window !== "undefined" ? (window.wm?.pen ?? null) : null,
    now: () => performance.timeOrigin + performance.now(),
    stamp: (timeStamp) => performance.timeOrigin + timeStamp,
    raf: (callback) => requestAnimationFrame(callback),
    cancelRaf: (handle) => cancelAnimationFrame(handle as number),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    root: document.documentElement,
  }
}

/** The page's gate (created on first use). */
export function penGate(): Gate {
  gate ??= createGate(realEnv())
  return gate
}

let installed = false
/** Imported first in main.tsx: the gate's listeners must be the first capture listeners on `window`. */
export function installPenGate(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  penGate().install()
}
