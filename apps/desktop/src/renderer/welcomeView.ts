/**
 * THE QUICK REFERENCE ALWAYS SHOWS ON THE RENDERED PAGE (Sean, 2026-10-05: "open on rendered page"; 2026-10-07: "make
 * sure the features md file that ships is rendered by default"). It is app-owned reference material (main/welcome.ts),
 * so every time it comes to the front, however it got there (the first launch, Help ▸ Quick Reference, a click in the
 * sidebar, a restored session, a tab), the page is the rendered one.
 *
 * The page's mode is ONE switch for every note (App.tsx `rendered`), so "without changing any other note's mode" means
 * this: when the Quick Reference comes to the front the mode the other notes are in is remembered (`away`), the rendered
 * page is put up, and when another note (or none) comes to the front the remembered mode is put back. A person who
 * turns the page off by hand while reading the Quick Reference gets what they asked for until it leaves the front;
 * Help ▸ Quick Reference chosen again (`asked` goes up) puts the rendered page back even then. Nothing here is ever
 * stored: a launch, a reload and every other note behave as they always did.
 *
 * Pure (test/welcomeView.test.ts); App.tsx keeps the state, asks `quickStep` before each paint and applies its answer.
 */

export interface QuickView {
  /** The mode (rendered or not) the OTHER notes are in while the Quick Reference is in front; null when it is not in front. */
  away: boolean | null
  /** How many times Help ▸ Quick Reference had been chosen when this last looked. */
  asked: number
}

export const QUICK_AWAY: QuickView = { away: null, asked: 0 }

/** One path written two ways (separators, the case of a Windows drive) is one note. */
export const samePath = (a: string, b: string): boolean => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()

/**
 * What to do now that `front` is in front (null: no note), the page is `rendered`, and Help ▸ Quick Reference has been
 * chosen `asked` times: the next state, and the page to show (if it is to change). `quick` is the Quick Reference's path,
 * null while that is not known (nothing is touched then). The state returned is the same object when nothing changed.
 */
export function quickStep(
  state: QuickView, front: string | null, quick: string | null, rendered: boolean, asked: number,
): { state: QuickView; rendered?: boolean } {
  const inFront = quick !== null && front !== null && samePath(front, quick)
  if (!inFront) {
    if (state.away === null) return state.asked === asked ? { state } : { state: { away: null, asked } }
    // It left the front: the mode the other notes are in comes back, whatever it was turned to meanwhile.
    return { state: { away: null, asked }, ...(rendered !== state.away ? { rendered: state.away } : {}) }
  }
  // It came to the front: remember what the other notes are in, and show the rendered page.
  if (state.away === null) return { state: { away: rendered, asked }, ...(rendered ? {} : { rendered: true }) }
  // It is in front and was chosen again: the rendered page, even if the person had turned it off by hand.
  if (state.asked !== asked) return { state: { ...state, asked }, ...(rendered ? {} : { rendered: true }) }
  return { state }
}
