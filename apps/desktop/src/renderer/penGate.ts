/**
 * penGate.ts - THE GATE.
 *
 * The very first capture listeners on `window` (imported first in main.tsx: `installPenGate()` before `watchPen()`). While the native tablet
 * feed is LIVE (Wintab samples are in range over the visible Tablet sheet and the window is in front) the pen's own DOM pointer events are
 * IGNORED: swallowed (`stopImmediatePropagation`, and `preventDefault` for everything but a move), because the feed draws the same pen
 * as synthetic events (renderer/penFeed.ts, which pass the gate by `emit`) and nothing may be drawn twice or tap what lies under the
 * pointer. When the feed is not live (no Wintab, another brand, the pen out of Wintab's range, capture off) the gate does nothing at all:
 * the window's own pen events reach the sheet exactly as they always did.
 *
 * Handover: a DOM pen contact that is already down is never cut (the feed waits for it to end: `domContact()`), and a feed that goes live
 * mid-hover simply starts swallowing.
 *
 * The echo rule: a pen tip down within ECHO_MS of a DOM MOUSE event means the mouse event is the pen's own echo (a tablet in Mouse mode sends
 * the tap as a mouse event too): swallowed while the feed is live. A real mouse is not affected.
 *
 * SELF-OPENING: if the synthesiser throws five times within a second the gate opens and stays open until capture is switched on again. A bug of ours
 * must not take the pen away from the whole window.
 *
 * Everything the gate needs from the world is injected (`GateEnv`), so the whole file is a vitest with a fake window.
 */

/** A pen tip down this recently makes a mouse event an echo. */
export const ECHO_MS = 300
/** Five throws within this long open the gate by itself. */
export const SELF_OPEN_WINDOW_MS = 1000
export const SELF_OPEN_ERRORS = 5

const SWALLOWED = [
  "pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave",
  "gotpointercapture", "lostpointercapture",
] as const

/** The part of a PointerEvent the gate reads (tests pass look-alikes). */
export interface GateEvent {
  type: string
  pointerType: string
  buttons: number
  cancelable: boolean
  stopImmediatePropagation(): void
  preventDefault(): void
}

export interface GateTarget {
  addEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
  removeEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
}

export interface GateEnv {
  target: GateTarget
  /** Epoch ms. */
  now(): number
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
  /** The native feed's pen is in range over the sheet right now (set by penFeed.ts from the samples). */
  nativeLive: boolean
  /** Why the gate opened itself, or null. */
  selfOpen: string | null
}

const initial = (): GateState => ({ available: false, enabled: true, released: false, sheetShowing: false, opened: false, nativeLive: false, selfOpen: null })

export interface Gate {
  state: Readonly<GateState>
  setState(patch: Partial<GateState>): void
  /** The pen's DOM events are being ignored right now. */
  captureOn(): boolean
  /** A real DOM pen contact (tip or a button) is down right now: the feed must not start a second stroke over it. */
  domContact(): boolean
  /** Run `fn` with the gate letting events through (the synthesiser's dispatch). */
  emit<T>(fn: () => T): T
  /** A throw in the synthesiser or the gate's own code (counts toward self-opening). */
  noteError(error: unknown): void
  /** A pen tip was seen (real or synthetic): the echo rule. */
  noteTip(): void
  /** Capture is switched on again: clears self-opening. */
  reset(): void
  onChange(listener: () => void): () => void
  onSelfOpen(listener: (reason: string) => void): () => void
  install(): () => void
}

export function createGate(env: GateEnv): Gate {
  const state: GateState = initial()
  const changeListeners = new Set<() => void>()
  const selfOpenListeners = new Set<(reason: string) => void>()
  let emitting = false
  let lastTipAt = -Infinity
  let contact = false
  const errors: number[] = []
  let lastCapture = false

  const captureOn = (): boolean =>
    state.available && state.enabled && state.sheetShowing && state.opened && !state.released && state.nativeLive && state.selfOpen === null

  const changed = (): void => {
    const on = captureOn()
    if (on !== lastCapture) {
      lastCapture = on
      try { env.root?.classList.toggle("pen-capture", on) } catch { /* no document */ }
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

  const swallow = (e: GateEvent): void => {
    e.stopImmediatePropagation()
    if (e.type !== "pointermove" && e.cancelable) e.preventDefault()
  }

  const handle = (e: GateEvent): void => {
    if (emitting) return
    try {
      if (e.pointerType === "pen") {
        if (captureOn()) { swallow(e); return }
        // Not swallowed: a real contact the feed must wait for.
        if (e.type === "pointerdown") contact = (e.buttons & 7) !== 0
        else if (e.type === "pointermove") { if ((e.buttons & 7) === 0) contact = false }
        else if (e.type === "pointerup" || e.type === "pointercancel" || e.type === "pointerleave" || e.type === "pointerout") contact = false
        if ((e.buttons & 1) !== 0) lastTipAt = env.now()
      } else if (e.pointerType === "mouse") {
        if (captureOn() && env.now() - lastTipAt < ECHO_MS) swallow(e)
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
    domContact: () => contact,
    emit(fn) {
      const was = emitting
      emitting = true
      try { return fn() } finally { emitting = was }
    },
    noteError,
    noteTip() { lastTipAt = env.now() },
    reset() {
      errors.length = 0
      if (state.selfOpen !== null) { state.selfOpen = null; changed() }
    },
    onChange(listener) { changeListeners.add(listener); return () => { changeListeners.delete(listener) } },
    onSelfOpen(listener) { selfOpenListeners.add(listener); return () => { selfOpenListeners.delete(listener) } },
    install() {
      const listener = (e: GateEvent): void => handle(e)
      // (pointerrawupdate, the device's own rate, is not listened to: the feed has its own samples.)
      for (const type of SWALLOWED) env.target.addEventListener(type, listener, true)
      return () => {
        for (const type of SWALLOWED) env.target.removeEventListener(type, listener, true)
        env.root?.classList.toggle("pen-capture", false)
      }
    },
  }
  return gate
}

// ---------------------------------------------------------------------------------------------
// The singleton the page uses
// ---------------------------------------------------------------------------------------------

let gate: Gate | null = null

function realEnv(): GateEnv {
  return {
    target: window,
    now: () => performance.timeOrigin + performance.now(),
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
