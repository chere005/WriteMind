/**
 * DRAGGING A TAB, the pointer half (the rules are `tabOrder.ts`, tested without a window). One function, used by the
 * notebook's tab row (TabBar.tsx) and the video pane's two (SheetStrip.tsx), which are the same gesture on three rows.
 *
 * A press on a tab waits: moved less than a few pixels and let go it is a CLICK, and the tab's own click handler opens
 * it as ever (a middle click and a right click never start a drag at all). Past that, the tab follows the pointer
 * sideways, the tabs it passes step aside, and letting go lands it in the slot it is over. THE ORDER IS ONLY ASKED OF THE
 * CALLER AT THE DROP (`onDrop`), once, so a drag is not a stream of changes and Escape (or letting go outside the row)
 * leaves nothing to undo: the tab glides home and nothing was told. The tab in front stays in front: a drag moves tabs,
 * it never opens one, and the click that ends it is swallowed.
 *
 * Everything while it is held is done on the tabs' own style (`transform`) and a `data-drag` mark, not in React state, so a
 * row of tabs is not drawn again for each pixel and a re-render in the middle (a title that changes) cannot lose its place.
 * A drag held near the row's end scrolls the row under it, on a timer (not a frame: a window that is not being painted
 * still has to scroll). The pointer is captured by the tab, so a drag that leaves the window still ends where it is let go.
 *
 * The tab row is `-webkit-app-region: drag` where it is empty, and the tabs are `no-drag` (tabs.css, tablet.css): the
 * press is on a tab, so the window never starts to move. Window-wide listeners are CAPTURING ones: the video pane's strip
 * stops pointer events at its own root (SheetStrip.tsx), and a bubbling listener would never hear the release.
 */

import { flushSync } from "react-dom"
import { clampShift, dropIndex, edgeScroll, outOfRow, pastThreshold, shiftRange, slideBy, type Slot } from "./tabOrder"

export interface TabDragSpec {
  /** The part of the row that scrolls, and holds the tabs. */
  strip: HTMLElement
  /** Which of its descendants are the tabs that can move, in order (only those are dragged or stepped round). */
  selector: string
  /** The row as a whole: the pointer leaving it (up or down) makes the drop a cancel. */
  row: HTMLElement
  /** The index, among those tabs, of the one pressed. */
  from: number
  /** Let go over slot `to` of the same tabs (never called with `to === from`, nor for a cancelled drag). */
  onDrop(from: number, to: number): void
}

/** How long a tab takes to step aside and to settle (ms). */
const GLIDE_MS = 130

/** A press on one of these is theirs: a field being typed in, the × of a tab. */
const THEIRS = "input, textarea, select, [data-tab-no-drag], .close, .sheet-close"

type Press = Pick<PointerEvent, "button" | "clientX" | "clientY" | "pointerId" | "isPrimary"> & { target: EventTarget | null }

/** How far a tab is from its own place now (px), mid-glide or not. */
const offsetOf = (tab: HTMLElement): number => new DOMMatrixReadOnly(getComputedStyle(tab).transform).m41

/** A tab put back where its layout has it, gliding from `from` px away (0 = already there). */
function glide(tab: HTMLElement, from: number): void {
  if (Math.abs(from) < 0.5) { tab.style.transition = ""; tab.style.transform = ""; return }
  tab.style.transition = "none"
  tab.style.transform = `translateX(${from}px)`
  void tab.offsetWidth
  tab.style.transition = `transform ${GLIDE_MS}ms ease-out`
  tab.style.transform = "translateX(0px)"
  window.setTimeout(() => { tab.style.transition = ""; tab.style.transform = "" }, GLIDE_MS + 60)
}

/** Call from a tab's `pointerdown`. Does nothing for anything but the primary button on the tab itself. */
export function beginTabDrag(press: Press, spec: TabDragSpec): void {
  if (press.button !== 0 || !press.isPrimary) return
  const pressed = press.target instanceof Element ? press.target : null
  if (!pressed || pressed.closest(THEIRS)) return
  const tabsNow = (): HTMLElement[] => [...spec.strip.querySelectorAll<HTMLElement>(spec.selector)]
  const tabs = tabsNow()
  const tab = tabs[spec.from]
  // (One tab has nowhere to go.)
  if (!tab || tabs.length < 2) return

  const origin = { x: press.clientX, y: press.clientY, scroll: spec.strip.scrollLeft }
  const pointer = { x: press.clientX, y: press.clientY }
  /** pressed: not a drag yet; dragging: held; cancelled: called off, the release still to come; done. */
  let phase: "pressed" | "dragging" | "cancelled" | "done" = "pressed"
  let slots: Slot[] = []
  let range = { min: 0, max: 0 }
  let at = spec.from
  let outside = false
  let ticker: number | null = null

  /** Where the tabs are, in the strip's own coordinates (they do not change while it scrolls). */
  const measure = () => {
    const base = spec.strip.getBoundingClientRect().left - spec.strip.scrollLeft
    slots = tabs.map((one) => { const box = one.getBoundingClientRect(); return { left: box.left - base, width: box.width } })
    range = shiftRange(slots, spec.from)
  }

  /** The tabs as the pointer has them now: the dragged one under it, the others where they step to. */
  const place = () => {
    const shift = clampShift((pointer.x - origin.x) + (spec.strip.scrollLeft - origin.scroll), range)
    const box = spec.row.getBoundingClientRect()
    outside = outOfRow(pointer.y, box.top, box.bottom)
    at = outside ? spec.from : dropIndex(slots, spec.from, shift)
    const slide = slideBy(slots, spec.from, at)
    tabs.forEach((one, index) => {
      if (index === spec.from) one.style.transform = `translateX(${shift}px)`
      else one.style.transform = slide[index] ? `translateX(${slide[index]}px)` : ""
    })
    tab.dataset.drag = outside ? "out" : "lifted"
  }

  const tick = () => {
    const box = spec.strip.getBoundingClientRect()
    const by = edgeScroll(pointer.x, box.left, box.right)
    if (by === 0) return
    const was = spec.strip.scrollLeft
    spec.strip.scrollLeft = was + by
    if (spec.strip.scrollLeft !== was) place()
  }

  const begin = () => {
    phase = "dragging"
    // (A drag begun while the last one is still gliding in must measure the tabs where their layout has them.)
    for (const one of tabs) { one.style.transition = ""; one.style.transform = "" }
    measure()
    try { tab.setPointerCapture(press.pointerId) } catch { /* the pointer is gone: the window listeners still hear it */ }
    spec.strip.dataset.dragging = ""
    document.documentElement.dataset.tabDragging = ""
    for (const one of tabs) { if (one !== tab) one.style.transition = `transform ${GLIDE_MS}ms ease-out` }
    ticker = window.setInterval(tick, 16)
    place()
  }

  /** The marks of a drag held: the timer and the look. */
  const unmark = () => {
    if (ticker !== null) window.clearInterval(ticker)
    ticker = null
    delete spec.strip.dataset.dragging
    delete document.documentElement.dataset.tabDragging
    delete tab.dataset.drag
  }

  /** Nothing is held any more: the listeners, the timer and every mark on the page. */
  const cleanup = () => {
    phase = "done"
    window.removeEventListener("pointermove", move, true)
    window.removeEventListener("pointerup", up, true)
    window.removeEventListener("pointercancel", lost, true)
    window.removeEventListener("keydown", key, true)
    window.removeEventListener("blur", abandon)
    unmark()
    try { tab.releasePointerCapture(press.pointerId) } catch { /* not held */ }
  }

  /** The click that follows a drag's release is not a click on the tab: it would open it, and the tab in front stays in front. */
  const swallowClick = () => {
    const stop = () => { window.removeEventListener("click", eat, true); window.clearTimeout(timer) }
    const eat = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); stop() }
    const timer = window.setTimeout(stop, 120)
    window.addEventListener("click", eat, true)
  }

  /** Every tab back at its own place, gliding from wherever the drag has it. */
  const home = () => { for (const one of tabs) if (one.isConnected) glide(one, offsetOf(one)) }

  function move(event: PointerEvent) {
    if (event.pointerId !== press.pointerId) return
    // A release that was never heard (the window lost it): the press is over.
    if (event.buttons === 0) { lost(); return }
    pointer.x = event.clientX
    pointer.y = event.clientY
    if (phase === "pressed") {
      if (!pastThreshold(pointer.x - origin.x, pointer.y - origin.y)) return
      if (tabsNow().length !== tabs.length) { cleanup(); return }
      begin()
      return
    }
    if (phase !== "dragging") return
    if (!spec.strip.isConnected || tabsNow().length !== tabs.length) { lost(); return }
    place()
  }

  function up(event: PointerEvent) {
    if (event.pointerId !== press.pointerId) return
    const was = phase
    if (was === "pressed") { cleanup(); return }
    if (was === "cancelled") { cleanup(); swallowClick(); return }
    if (was !== "dragging") return
    swallowClick()
    pointer.x = event.clientX
    pointer.y = event.clientY
    place()
    const target = at
    if (outside || target === spec.from || !spec.strip.isConnected) {
      home()
      cleanup()
      return
    }
    // The order is changed and drawn at once, then every tab is put back at its own (new) place: the others are already
    // standing where they stepped to, and the dragged one glides the rest of the way.
    const where = tab.getBoundingClientRect().left
    for (const one of tabs) { one.style.transition = "none"; one.style.transform = "" }
    cleanup()
    flushSync(() => spec.onDrop(spec.from, target))
    if (tab.isConnected) glide(tab, where - tab.getBoundingClientRect().left)
    for (const one of tabs) if (one !== tab) one.style.transition = ""
  }

  /** The pointer is gone without a release (the browser cancelled it): everything glides home, nothing is asked of the caller. */
  function lost() {
    if (phase === "dragging") home()
    cleanup()
  }

  /** The drag is called off (Escape, the window lost focus): every tab glides home and nothing is asked of the caller. */
  function abandon() {
    if (phase !== "dragging") return
    phase = "cancelled"
    home()
    // (The release that ends the press is still to come and must not open the tab: `up` swallows it.)
    unmark()
  }

  function key(event: KeyboardEvent) {
    if (event.key !== "Escape" || phase !== "dragging") return
    event.preventDefault()
    event.stopPropagation()
    abandon()
  }

  window.addEventListener("pointermove", move, true)
  window.addEventListener("pointerup", up, true)
  window.addEventListener("pointercancel", lost, true)
  window.addEventListener("keydown", key, true)
  window.addEventListener("blur", abandon)
}
