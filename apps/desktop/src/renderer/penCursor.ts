/**
 * Taking the pen over from the OS pointer.
 *
 * While a pen is near the window the Windows arrow is hidden everywhere
 * (`html.pen-active`, which hides the cursor) and an in-app cursor follows the
 * pen instead: a ring the size of the pen's line in the pen's colour over the
 * page, a dot with a cross while erasing, a small arrow-dot over the chrome
 * (bars, sidebar, buttons). It is ONE fixed element moved with a transform
 * once a frame — no React render per move, hovering included. A real mouse
 * event gives the OS cursor back.
 *
 * The cursor SAYS WHAT THE PEN WILL DO when it touches: a dashed square
 * while a button whose hold is Select is down (the upper, by default) or the
 * Select tool is on, with a + when it extends, the red cross while erasing
 * (the lower button, by default), a hand while a button pans. (data-kind:
 * ring, arrow, erase, select, add, pan.)
 *
 * While a pen is active the page also stops behaving as if a mouse were
 * hovering: the mouse-only compatibility events a pen hover generates
 * (mousemove, mouseover) are not delivered (the seams' hover bars and the
 * brackets listen for them), and the press-and-hold context menu is
 * suppressed except in text fields.
 */

import { penNear, penSettings, sheetTools } from "./penSettings"
import { penOnSheet } from "./tabletFocus"
import { heldAction, subscribeLive, watchLive } from "./penLive"
import { installPenActions, penButtonInUse, penMenuAllowed } from "./penActions"

let colour = "#2D7DD2"
let width = 3
export function setPenLook(nextColour: string, nextWidth: number): void {
  colour = nextColour
  width = nextWidth
  if (element) paintLook()
}

let element: HTMLDivElement | null = null
let kind = ""
let frame: number | null = null
let at = { x: 0, y: 0 }
let over: Element | null = null

/** The note's page (words, ink, cells) and the tablet sheet: where a pen's right click never opens a menu. */
const PAGE = ".editor, .cm-editor, .wm-canvas, .tablet-host, .tablet"
const CHROME = ".top-bar, .sidebar, .sidebar-bar, .tab-bar, .camera-bar, .footer, button, select, input, .style-pop, .float-menu, .bar-context"

function paintLook(): void {
  if (!element) return
  const size = Math.max(6, Math.round(width) + 6)
  element.style.setProperty("--pen-size", `${size}px`)
  element.style.setProperty("--pen-colour", colour)
}

function draw(): void {
  frame = null
  if (!element) return
  const chrome = over instanceof Element && over.closest(CHROME) !== null
  const held = heldAction()
  // Over the tablet sheet's side, the sheet's own Erase / Select; elsewhere the notebook's.
  const tool = penOnSheet() ? sheetTools() : penSettings()
  const next = held === "erase" ? "erase" : held === "select" ? "select" : held === "add" ? "add"
    : held === "pan" ? "pan" : tool.eraser ? "erase" : tool.selectTool ? "select"
      : chrome ? "arrow" : "ring"
  if (next !== kind) { kind = next; element.dataset.kind = next }
  element.style.transform = `translate(${at.x}px, ${at.y}px)`
}

function setActive(on: boolean): void {
  document.documentElement.classList.toggle("pen-active", on)
  if (element) element.style.display = on ? "block" : "none"
}

let installed = false
export function installPenCursor(): void {
  if (installed || typeof document === "undefined") return
  installed = true
  watchLive()
  installPenActions()
  element = document.createElement("div")
  element.className = "pen-cursor"
  element.style.display = "none"
  document.body.appendChild(element)
  paintLook()
  subscribeLive(() => { if (frame === null) frame = requestAnimationFrame(draw) })

  const moved = (event: PointerEvent) => {
    if (event.pointerType === "pen") {
      at = { x: event.clientX, y: event.clientY }
      over = event.target as Element | null
      if (!document.documentElement.classList.contains("pen-active")) setActive(true)
      if (frame === null) frame = requestAnimationFrame(draw)
    } else if (event.pointerType === "mouse" && !penNear(250)) {
      if (document.documentElement.classList.contains("pen-active")) setActive(false)
    }
  }
  window.addEventListener("pointermove", moved, true)
  window.addEventListener("pointerdown", moved, true)
  // The pen leaving the window or the tablet's range puts the cursor away.
  document.addEventListener("pointerleave", (event) => { if (event.pointerType === "pen") setActive(false) }, true)
  document.documentElement.addEventListener("pointerleave", () => {
    if (document.documentElement.classList.contains("pen-active")) setActive(false)
  })

  // No mouse-style hover from a pen.
  const quiet = (event: Event) => {
    if (document.documentElement.classList.contains("pen-active") && penNear(400)) event.stopPropagation()
  }
  for (const type of ["mousemove", "mouseover", "mouseenter"]) window.addEventListener(type, quiet, true)

  // Press-and-hold is a right click to Windows Ink, and so is the lower side button (with the pen touching, or
  // the driver's hover click): the pen has no use for the menu. Over the note's page and the tablet sheet it is
  // stopped here, first, so that no menu of the page's own (the notes' Cut / Copy / Paste) hears it either; while a
  // side button is in use that holds even in a text field there. Over the chrome (sidebar, bars) only the browser's
  // own menu is refused, as before: the app's menus there stay reachable by press-and-hold.
  window.addEventListener("contextmenu", (event) => {
    if (penMenuAllowed()) return
    const target = event.target instanceof Element ? event.target : null
    const page = target?.closest(PAGE) != null
    const button = penButtonInUse()
    const near = document.documentElement.classList.contains("pen-active") && penNear(1500)
    if (!button && !near) return
    if (!button && target?.closest("input, textarea, select")) return
    event.preventDefault()
    if (page) event.stopImmediatePropagation()
  }, true)
}
