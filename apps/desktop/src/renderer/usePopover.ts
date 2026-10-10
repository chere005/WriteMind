/**
 * ONE POPOVER HOOK for every popover that is not already a `FloatingMenu` (docs/PLAN-bars-2026-10.md, P6): the font and
 * colour popover, the maths palette, the Paper and Bring-in menus where they stay popovers, the toolbar's Customize
 * checklist. Each of them had its own half of this — a click-away with no Escape, an Escape with no click-away, a
 * position that ran off the window — and the page's `closePopovers` clicked their buttons to close them.
 *
 * While it is open:
 *  - a press ANYWHERE ELSE closes it, heard in the capture phase (a press on its own button is the button's: it toggles);
 *  - ESCAPE closes it, on the window in the capture phase, and goes no further: the one press does not also let go of a
 *    tool or a box (the pen's popover said so in a comment and did it by hand);
 *  - the window losing the keyboard or being resized closes it;
 *  - it is kept INSIDE THE WINDOW (`clampIntoViewport`) by a translate, so it needs no left / top of its own to be moved;
 *  - the keyboard is MOVED IN (`focus: "first"`, the first control; `"self"`, the popover itself; `"none"`, the popover
 *    places it) and RETURNED when it closes: to the notes, the rule for every chrome action, unless the press that closed
 *    it was on a field.
 *
 * It does not draw anything and holds no state of its own: `open` and `onClose` are the caller's.
 */

import { useEffect, useLayoutEffect, type RefObject } from "react"
import { returnFocus } from "./focusReturn"
import { clampIntoViewport } from "./overlayRules"

interface Options {
  ref: RefObject<HTMLElement | null>
  open: boolean
  onClose(): void
  /** The button that opens it: a press on it is not a click-away. */
  anchor?: RefObject<HTMLElement | null>
  focus?: "first" | "self" | "none"
}

const FIRST = 'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function usePopover({ ref, open, onClose, anchor, focus = "first" }: Options): void {
  // Inside the window: measured with no shift, then shifted by exactly what it overhangs.
  useLayoutEffect(() => {
    const pop = ref.current
    if (!open || !pop) return
    pop.style.translate = ""
    const box = pop.getBoundingClientRect()
    const { dx, dy } = clampIntoViewport(
      { left: box.left, top: box.top, width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    if (dx !== 0 || dy !== 0) pop.style.translate = `${dx}px ${dy}px`
  })

  // The keyboard goes in when it opens, and back to the notes when it closes with it still inside.
  useEffect(() => {
    const pop = ref.current
    if (!open || !pop) return
    if (focus !== "none") {
      const target = focus === "first" ? pop.querySelector<HTMLElement>(FIRST) : null
      if (target) target.focus({ preventScroll: true })
      else { if (pop.tabIndex < 0 && !pop.hasAttribute("tabindex")) pop.tabIndex = -1; pop.focus({ preventScroll: true }) }
    }
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || pop.contains(active)) window.setTimeout(returnFocus, 0)
    }
  }, [open, focus, ref])

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return
      onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      // A menu opened from inside it (a FloatingMenu) answers its own Escape first.
      if (document.querySelector(".float-menu")) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", escape, true)
    window.addEventListener("blur", onClose)
    window.addEventListener("resize", onClose)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("blur", onClose)
      window.removeEventListener("resize", onClose)
    }
  }, [open, onClose, ref, anchor])
}
