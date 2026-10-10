/**
 * ONE MODAL for every dialog the page draws: the key list, Rename, Move to Trash, Clean Up, About, Update and Language
 * setup (docs/PLAN-bars-2026-10.md, P6). Seven dialogs had each their own Escape, their own idea of Tab and their own way
 * of giving the keyboard back; this is the one.
 *
 *  - A BACKDROP THAT MAKES THE PAGE BEHIND IT INERT (`inert` on #root while any dialog is up): nothing behind it takes a
 *    click, a key or a Tab, and a screen reader does not read it. The dialog is drawn in a portal on <body>, outside #root.
 *  - TAB IS TRAPPED inside it (`tabTarget`): from the last stop it goes to the first, Shift+Tab the other way.
 *  - ESCAPE is heard ON THE WINDOW, IN THE CAPTURE PHASE, by a listener installed when this file is first loaded, so it
 *    comes before every listener a page component adds later (the drawing layer's, the notebook's): the one press closes
 *    the dialog and does nothing else. Only the dialog on top answers (an update dialog over the key list).
 *  - FOCUS GOES BACK when it closes: to a text field that had it, else to the notes (`returnFocus`, the rule for every
 *    chrome action).
 *
 * Each dialog says where the keyboard starts (its own effect, which runs after this one's) and what Escape and a click
 * on the backdrop mean; the rest is here.
 */

import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react"
import { createPortal } from "react-dom"
import { returnFocus } from "./focusReturn"
import { ModalStack, tabTarget } from "./overlayRules"

/** The tab stops of a dialog, in document order, the ones that are on screen. */
const STOPS = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"]):not(:disabled)'

function stopsOf(sheet: HTMLElement): HTMLElement[] {
  return [...sheet.querySelectorAll<HTMLElement>(STOPS)].filter((one) => one.getClientRects().length > 0)
}

interface Open { sheet: HTMLElement | null; escape(): void }

const stack = new ModalStack()
const open = new Map<symbol, Open>()

/** Keys while a dialog is up: Escape closes the top one, Tab stays inside it. Installed once, ahead of every later listener. */
function heard(event: KeyboardEvent): void {
  if (open.size === 0 || event.isComposing) return
  let top: Open | null = null
  for (const [id, one] of open) if (stack.isTop(id)) top = one
  if (!top) return
  if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    top.escape()
    return
  }
  if (event.key === "Tab" && top.sheet && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const stops = stopsOf(top.sheet)
    const target = tabTarget(stops.length, stops.indexOf(document.activeElement as HTMLElement), event.shiftKey)
    if (target !== null) { event.preventDefault(); stops[target]?.focus() }
  }
}
if (typeof window !== "undefined") window.addEventListener("keydown", heard, true)

function setInert(on: boolean): void {
  const root = document.getElementById("root")
  if (!root) return
  if (on) root.setAttribute("inert", "")
  else root.removeAttribute("inert")
}

/** What had the keyboard goes on having it when it is a field being typed in; otherwise the notes get it back. */
function giveBack(prior: Element | null): void {
  if (prior instanceof HTMLElement && prior.isConnected && prior !== document.body
      && (prior.closest("input, textarea, select") || prior.isContentEditable) && !prior.closest(".cm-content")) {
    prior.focus({ preventScroll: true })
    return
  }
  returnFocus()
}

interface Props {
  /** The dialog's name for a screen reader. */
  label: string
  /** The `data-modal` hook the e2e suites find the dialog by. */
  hook: string
  /** Extra classes on the dialog itself (`about`, `key-list`). */
  className?: string
  /** More attributes on the backdrop (`data-platform`) and on the dialog (`data-update`). */
  backdropData?: Record<string, string>
  dialogData?: Record<string, string>
  style?: CSSProperties
  /** Closes the dialog; Escape and a click on the backdrop mean this unless they are given their own. */
  onClose(): void
  onEscape?(): void
  /** A click on the backdrop; `null`: it does nothing (a download is under way). */
  onBackdrop?: (() => void) | null
  onKeyDown?(event: ReactKeyboardEvent<HTMLDivElement>): void
  sheetRef?: Ref<HTMLDivElement>
  children: ReactNode
}

export function Modal({ label, hook, className, backdropData, dialogData, style, onClose, onEscape, onBackdrop, onKeyDown, sheetRef, children }: Props) {
  const sheet = useRef<HTMLDivElement | null>(null)
  const latest = useRef({ onClose, onEscape })
  latest.current = { onClose, onEscape }

  // A LAYOUT effect: the dialog is known to the key listener, and the page behind it inert, in the commit that shows it.
  useLayoutEffect(() => {
    const id = Symbol(hook)
    const prior = document.activeElement
    stack.push(id)
    open.set(id, { get sheet() { return sheet.current }, escape: () => (latest.current.onEscape ?? latest.current.onClose)() })
    setInert(true)
    // The keyboard is in the dialog from the first moment; a dialog that wants it somewhere in particular says so after this.
    if (!sheet.current?.contains(document.activeElement)) sheet.current?.focus({ preventScroll: true })
    return () => {
      open.delete(id)
      stack.remove(id)
      if (stack.size === 0) {
        setInert(false)
        // (Only if no dialog came up in the meantime: React's development double-mount closes and reopens one at once.)
        window.setTimeout(() => { if (stack.size === 0) giveBack(prior) }, 0)
      }
    }
  }, [hook])

  const setSheet = (element: HTMLDivElement | null) => {
    sheet.current = element
    if (typeof sheetRef === "function") sheetRef(element)
    else if (sheetRef) (sheetRef as { current: HTMLDivElement | null }).current = element
  }

  return createPortal(
    <div className="modal-backdrop" data-modal={hook} {...backdropData}
         onMouseDown={(event) => {
           if (event.target !== event.currentTarget || onBackdrop === null) return
           ;(onBackdrop ?? onClose)()
         }}>
      <div ref={setSheet} className={className ? `modal ${className}` : "modal"} role="dialog" aria-modal="true" aria-label={label}
           tabIndex={-1} style={style} {...dialogData} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
