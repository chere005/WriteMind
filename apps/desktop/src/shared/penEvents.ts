/**
 * shared/penEvents.ts - the sample-to-event state machine of the native pen feed (docs/spikes/DESIGN-pen-capture.md 8.3).
 * Pure: no DOM, no Electron. `renderer/penFeed.ts` turns each SynthEvent into a real `PointerEvent` on the sheet.
 *
 * The events are the ones Chromium itself delivers for a Windows Ink pen with two side buttons, so everything that already
 * reads the pen (penButtons.resolvePress / tapStep, penLive, penCursor, penActions, TabletSurface) works on the feed unchanged:
 *
 *   tip down, lower or upper pressed in the air  -> pointerdown with `button` set (tip 0, upper 1, lower 2, eraser 5)
 *   a side button pressed while the tip is down  -> pointermove with `buttons` changed and `button` -1
 *   everything released                          -> pointerup
 *   the pen leaving range (or a reset)           -> pointerup first when a button was down, then pointerout, pointerleave
 *
 * `buttons` is the DOM mask: tip 1, lower 2, upper 4, eraser 32.
 */

import type { PenSample } from "./pen"

export type SynthType = "pointerover" | "pointerenter" | "pointermove" | "pointerdown" | "pointerup" | "pointerout" | "pointerleave"

export interface SynthEvent {
  type: SynthType
  /** DOM `button`: tip 0, upper 1, lower 2, eraser 5; -1 for a move. */
  button: number
  /** DOM `buttons` mask: tip 1, lower 2, upper 4, eraser 32. */
  buttons: number
  pressure: number
  tiltX?: number
  tiltY?: number
}

export interface Synth {
  /** One sample in, the events it causes out (in order). */
  step(s: PenSample): SynthEvent[]
  /** Blur, failover, close, backend change: end any contact and leave. Never a pointercancel. */
  reset(): SynthEvent[]
  readonly inRange: boolean
  readonly mask: number
}

export const MASK = { tip: 1, lower: 2, upper: 4, eraser: 32 } as const

export const maskOf = (s: Pick<PenSample, "tip" | "lower" | "upper" | "eraser">): number =>
  (s.tip ? MASK.tip : 0) | (s.lower ? MASK.lower : 0) | (s.upper ? MASK.upper : 0) | (s.eraser ? MASK.eraser : 0)

/** The first pressed button, in the order tip 0, lower 2, upper 1, eraser 5. */
function firstPressed(next: number): number {
  if (next & MASK.tip) return 0
  if (next & MASK.lower) return 2
  if (next & MASK.upper) return 1
  if (next & MASK.eraser) return 5
  return 0
}

/** The button released last when the mask goes to zero (tip first). */
const lastReleased = firstPressed

/** What TabletSurface assumes for a pen that reports no pressure while in contact. */
export const NO_PRESSURE_CONTACT = 0.5

export function createSynth(): Synth {
  let inRange = false
  let mask = 0
  const leave = (out: SynthEvent[]): void => {
    if (mask !== 0) out.push({ type: "pointerup", button: lastReleased(mask), buttons: 0, pressure: 0 })
    if (inRange) {
      out.push({ type: "pointerout", button: -1, buttons: 0, pressure: 0 })
      out.push({ type: "pointerleave", button: -1, buttons: 0, pressure: 0 })
    }
    inRange = false
    mask = 0
  }
  return {
    get inRange() { return inRange },
    get mask() { return mask },
    reset() { const out: SynthEvent[] = []; leave(out); return out },
    step(s) {
      const out: SynthEvent[] = []
      if (!s.inRange) { leave(out); return out }
      const next = maskOf(s)
      const pressure = next & MASK.tip ? (s.p > 0 ? s.p : NO_PRESSURE_CONTACT) : 0
      const tilt = { ...(s.tiltX !== undefined ? { tiltX: s.tiltX } : {}), ...(s.tiltY !== undefined ? { tiltY: s.tiltY } : {}) }
      if (!inRange) {
        out.push({ type: "pointerover", button: -1, buttons: 0, pressure: 0, ...tilt })
        out.push({ type: "pointerenter", button: -1, buttons: 0, pressure: 0, ...tilt })
        inRange = true
      }
      if (mask === 0 && next !== 0) out.push({ type: "pointerdown", button: firstPressed(next), buttons: next, pressure, ...tilt })
      else if (mask !== 0 && next === 0) out.push({ type: "pointerup", button: lastReleased(mask), buttons: 0, pressure: 0, ...tilt })
      else out.push({ type: "pointermove", button: -1, buttons: next, pressure, ...tilt })
      mask = next
      return out
    },
  }
}
