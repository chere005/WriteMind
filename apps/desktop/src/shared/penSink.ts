/**
 * shared/penSink.ts - the two things the pen-sink window's main side (main/pen/overlay.ts) and its page (renderer/PenSink.tsx,
 * renderer/penSinkCore.ts, preload/penSink.ts) have to agree on that the pen contract (shared/pen.ts PEN_SINK_CHANNELS) does not carry.
 * Pure: no Electron, no DOM.
 *
 * The sink is a transparent window that, while it is hit-testable, swallows the pen AND the mouse. Windows decides whether a
 * transparent window is hit-testable by what the page paints (a pixel of alpha 0 falls through; measured, docs/PARITY.md
 * "Tablet orientation and Grab"). That gives the page, which lives in its own renderer process, two protections that do
 * not need the main process at all:
 *   - a real mouse event paints the page transparent AT ONCE (the mouse works again before main has even heard of it);
 *   - a DEAD MAN: main tells the page "on" / "off" every poll while the sink is shown; a page that has not heard for
 *     SINK_DEAD_MAN_MS paints itself transparent. A frozen main process therefore cannot leave a window swallowing input.
 */

/** main -> page: `{ on: boolean }`, sent on every change and every poll (250 ms) while the sink window is shown. */
export const SINK_STATE_CHANNEL = "pen:sink-state"

/** A page that has not been told its state for this long paints itself transparent (the main process is hung or gone). */
export const SINK_DEAD_MAN_MS = 3000
