/**
 * A popover under a bar button opens flush with the button's left edge; when
 * that would run it off the right edge of the window (a button near the end of
 * a long bar, a narrow window) it is pulled back to end at the edge instead.
 * Nothing moves when it already fits, so a popover still sits under its button.
 */

import { useLayoutEffect, useRef } from "react"

export function useOnScreen<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null)
  useLayoutEffect(() => {
    const pop = ref.current
    if (!open || !pop) return
    pop.style.left = ""
    pop.style.right = ""
    const box = pop.getBoundingClientRect()
    const over = box.right - (window.innerWidth - 8)
    if (over > 0) {
      const anchor = pop.offsetParent instanceof HTMLElement ? pop.offsetParent.getBoundingClientRect().left : 0
      pop.style.left = `${Math.max(8 - anchor, box.left - anchor - over)}px`
    }
  }, [open])
  return ref
}
