/**
 * The keyboard goes back to the notes after a chrome action. On the Mac a
 * button in a toolbar never takes the keyboard (an `NSButton` is not a first
 * responder for typing), so clicking Bold, the sidebar's switches, a tab or a
 * menu item leaves the caret where it was. A web page's buttons DO take focus,
 * so this puts it back: after a menu command, after a click on a bar, the tab
 * row, the sidebar or a menu, and after a select on the bar changes.
 *
 * It leaves alone every case where something else was MEANT to take the
 * keyboard: a text field (the math palette, a rename, the link banner), a
 * select that is open, a menu that is up. And it never fights the pen: a
 * click on the video pane is the video pane's.
 */

/** The notebook's editable surface. */
const EDITOR = ".cm-content"

/**
 * Where a click is chrome: the bars, the tab row, the sidebar and the page's own menus. The video pane's header is a
 * `.bar-row` too but is the VIDEO PANE'S ("a click on the video pane is the video pane's", below): Esc right after
 * pressing Hold image lets the held picture go, which needs the keyboard to stay in that pane (2026-10-05).
 */
const CHROME = ".sidebar, .tab-bar, .top-bar, .bar-row:not(.camera-head), .footer, .float-menu, .link-card"

/** A popup that is up has the keyboard until it goes: the maths palette picks a shape with the arrows, a menu moves with them. */
const POPUPS = ".float-menu, .math-pop, .style-pop, .bar-context, .modal"

/** Something that is typed into, other than the notebook. */
function takesTyping(element: Element | null): boolean {
  if (!element) return false
  if (element.closest(EDITOR)) return false
  if (element.closest("input, textarea, select")) return true
  return element instanceof HTMLElement && element.isContentEditable
}

/** Put the caret back in the notebook, unless something else is meant to have the keyboard. */
export function returnFocus(): void {
  const active = document.activeElement
  if (takesTyping(active)) return
  if (active?.closest(POPUPS)) return
  const editor = document.querySelector<HTMLElement>(EDITOR)
  // A hidden pane cannot take focus (Hide Notes Pane); nothing to return to.
  if (!editor || editor.offsetParent === null) return
  if (editor.contains(active) && active === editor) return
  editor.focus({ preventScroll: true })
}

/** After the page has acted on what was just done (state, re-render), not before. */
export function returnFocusSoon(): void {
  window.setTimeout(returnFocus, 0)
  window.setTimeout(returnFocus, 90)
}

/**
 * The popovers the bars open that had no way out but their own button (font and colour, the pen; the
 * maths palette has its own). Each opens under a button that is the first control of its anchor and
 * closes when that button is pressed again; a popover on the Mac also closes on Escape and on a click
 * anywhere else.
 */
const POPOVERS = ".style-pop"

function toggleOf(popover: Element): HTMLElement | null {
  const anchor = popover.closest(".pop-anchor, .pen-menu") ?? popover.parentElement
  return anchor?.querySelector<HTMLElement>("button") ?? null
}

/** Close every open popover by pressing its own button; true if any was open. */
export function closePopovers(except?: Element | null): boolean {
  let closed = false
  for (const popover of document.querySelectorAll(POPOVERS)) {
    if (except && popover.closest(".pop-anchor, .pen-menu") === except) continue
    toggleOf(popover)?.click()
    closed = true
  }
  return closed
}

/** The page-wide half: clicks on chrome, changes of a select, and the popovers' ways out. Returns the way to stop. */
export function watchChromeFocus(): () => void {
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    if (document.querySelector(".float-menu")) return
    if (closePopovers()) { event.preventDefault(); returnFocusSoon() }
  }
  // Only the font-and-colour popover has no click-away of its own (the pen's sits in .pen-menu and has).
  const away = (event: PointerEvent) => {
    const open = document.querySelector(".style-pop:not(.pen-pop)")
    if (!open || !(event.target instanceof Node)) return
    const anchor = open.closest(".pop-anchor")
    if (anchor && !anchor.contains(event.target)) toggleOf(open)?.click()
  }
  window.addEventListener("keydown", escape)
  window.addEventListener("pointerdown", away, true)
  const clicked = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest(CHROME)) return
    // A field in the chrome is typed into; the camera and the canvas are not chrome.
    if (takesTyping(target)) return
    returnFocusSoon()
  }
  const changed = (event: Event) => {
    const target = event.target
    if (target instanceof HTMLSelectElement && target.closest(CHROME)) returnFocusSoon()
  }
  window.addEventListener("click", clicked, true)
  window.addEventListener("change", changed, true)
  return () => {
    window.removeEventListener("keydown", escape)
    window.removeEventListener("pointerdown", away, true)
    window.removeEventListener("click", clicked, true)
    window.removeEventListener("change", changed, true)
  }
}
