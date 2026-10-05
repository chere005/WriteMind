/**
 * A NEW INSTALL'S QUICK REFERENCE OPENS ON THE RENDERED PAGE (Sean, 2026-10-05: "open on rendered page"), its first
 * open only. main/welcome.ts says once which note it wrote at this launch (`wm.welcomed()`); App.tsx keeps this state
 * and sets the page. Pure (test/welcomeView.test.ts).
 *
 * - That note comes to the front: the rendered page shows (the Ctrl+T view), once.
 * - Another note comes to the front while it still shows so: the markdown pane comes back, as every note opens.
 * - The rendered page turned off by hand meanwhile: that is the person's choice, and nothing more is done.
 * An existing install, a later launch, a reload and every other note are never touched (`note` null: nothing).
 */

export interface WelcomeView {
  /** The quick reference written at this launch, or null. */
  note: string | null
  /** "waiting": not in front yet; "shown": shown rendered by this; "done": nothing more to do. */
  phase: "waiting" | "shown" | "done"
}

export const NO_WELCOME: WelcomeView = { note: null, phase: "done" }
export const welcomeFor = (note: string | null | undefined): WelcomeView =>
  note ? { note, phase: "waiting" } : NO_WELCOME

/** One path written two ways (separators, the case of a Windows drive) is one note. */
const same = (a: string, b: string): boolean => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()

/** What to do now that `front` is in front and the page is `rendered`: the next state, and the page to show (if any). */
export function welcomeStep(state: WelcomeView, front: string | null, rendered: boolean): { state: WelcomeView; rendered?: boolean } {
  if (!state.note || state.phase === "done") return { state }
  const inFront = front !== null && same(front, state.note)
  if (state.phase === "waiting") return inFront ? { state: { ...state, phase: "shown" }, rendered: true } : { state }
  if (!rendered) return { state: NO_WELCOME }
  return inFront ? { state } : { state: NO_WELCOME, rendered: false }
}
