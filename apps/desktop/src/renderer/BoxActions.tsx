/**
 * ONE slim row of three small buttons UNDER the tablet sheet's dashed box (Sean, 2026-10-05: "under the selection
 * box, have buttons for erase selection, bring in writing, bring in writing (straight to a docked drawing cell at or
 * after the input cursor"):
 *
 *   Erase                     the writing inside the box rubbed off the sheet (one Undo on the sheet; the box stays)
 *   Bring in Writing          what the header's Bring in ▸ Writing does with this box (floating ink in the note)
 *   Bring in as Drawing Cell  the boxed writing as a NEW drawing cell at the armed bar, else after the caret's cell
 *
 * The row sits under the box, flips above it when the sheet has no room below, and stays inside the sheet
 * (boxRow.ts `placeRow`). It lies OUTSIDE the sheet's own element, so the mouse's clicks are the buttons' and
 * never pull a box, and the pen feed's tap clicks them too (penFeed.ts clicks a button under the pen that is not
 * part of the sheet itself).
 *
 * A press that BEGINS on the row and moves is the sheet's (TODO "a pen stroke that starts on the button row is lost"):
 * once it is CLICK_SLOP_PX from where it began it is handed to the sheet from its first point, a stroke for the pen, a box
 * for the mouse; lifted before that it is the button's click. The native pen feed does this itself (`data-pen-handover`,
 * penFeed.ts); the mouse and the window's own pen are handed over here: the sheet gets its pointerdown at the first point
 * (and takes the pointer, as its own presses do), then the moves so far, and the rest of the drag goes to it directly.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Rect, Size } from "@writemind/core"
import { placeRow, ROW_GAP, rowPressToSheet, type RowPlace } from "./boxRow"
import { CLICK_SLOP_PX, SYNTH_POINTER_ID } from "./penFeed"

export interface BoxButtons {
  erase(): void | Promise<void>
  bring(): void | Promise<void>
  cell(): void | Promise<void>
  /** Why the two Bring in buttons are off (a sheet bound to a drawing cell, no note open), or null when they are on. */
  bringOff: string | null
}

interface Props extends BoxButtons {
  /** The box, in FRACTIONS of the sheet. */
  box: Rect
  /** The sheet on screen: where it is in its host, and its size (px). */
  sheet: { x: number; y: number; width: number; height: number }
}

export function BoxActions({ box, sheet, erase, bring, cell, bringOff }: Props) {
  const row = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [pending, setPending] = useState(false)
  /** The row's width with the full labels, measured the first time it is drawn (the row starts with them, unseen). */
  const [full, setFull] = useState<number | null>(null)
  // The short labels only when the full row would not fit across the sheet.
  const compact = full !== null && full > sheet.width - 2 * ROW_GAP
  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    if (full === null) { setFull(element.offsetWidth); return }
    const next = { width: element.offsetWidth, height: element.offsetHeight }
    setSize((was) => (was && was.width === next.width && was.height === next.height ? was : next))
  }, [compact, full, bringOff, pending])

  // (The sheet is letterboxed in the middle of its pane, tabletPage.ts fitRect: the margin under it is the one over it.)
  const place: RowPlace | null = size ? placeRow(box, sheet, size, ROW_GAP, { above: sheet.y, below: sheet.y }) : null
  /** One action at a time (Bring in Writing waits for the flow-chart reader). */
  const run = (action: () => void | Promise<void>) => async () => {
    if (pending) return
    setPending(true)
    try { await action() } finally { setPending(false) }
  }
  const off = bringOff !== null

  /** The press on the row being watched (mouse or the window's pen), until it is a click or the sheet's: its "stop". */
  const watching = useRef<(() => void) | null>(null)
  useEffect(() => () => watching.current?.(), [])
  const watch = (down: PointerEvent): void => {
    watching.current?.()
    // The native feed's pen decides this itself (penFeed.ts holds its contact back); touch and other mouse buttons stay clicks.
    if (down.pointerId === SYNTH_POINTER_ID || down.pointerType === "touch" || (down.pointerType === "mouse" && down.button !== 0)) return
    const sheet = row.current?.parentElement?.querySelector<HTMLElement>('[data-tablet="surface"]')
    if (!sheet) return
    const start = { x: down.clientX, y: down.clientY }
    const moves: PointerEvent[] = []
    const again = (type: "pointerdown" | "pointermove", from: PointerEvent): PointerEvent => new PointerEvent(type, {
      pointerId: down.pointerId, pointerType: down.pointerType, isPrimary: down.isPrimary, width: from.width, height: from.height,
      pressure: from.pressure, tiltX: from.tiltX, tiltY: from.tiltY, clientX: from.clientX, clientY: from.clientY,
      screenX: from.screenX, screenY: from.screenY, button: type === "pointerdown" ? down.button : -1, buttons: from.buttons,
      ctrlKey: from.ctrlKey, altKey: from.altKey, shiftKey: from.shiftKey, metaKey: from.metaKey,
      bubbles: true, cancelable: true, composed: true, view: window,
    })
    const move = (event: PointerEvent): void => {
      if (event.pointerId !== down.pointerId) return
      moves.push(event)
      if (!rowPressToSheet(sheet.getBoundingClientRect(), start, { x: event.clientX, y: event.clientY }, CLICK_SLOP_PX)) return
      stop()
      // The sheet's from its first point: its own pointerdown there (it takes the pointer), then the moves so far. This move
      // reaches the sheet by itself when it is already over it.
      sheet.dispatchEvent(again("pointerdown", down))
      for (const one of moves) {
        if (one === event && event.target instanceof Node && sheet.contains(event.target)) continue
        sheet.dispatchEvent(again("pointermove", one))
      }
    }
    const end = (event: PointerEvent): void => { if (event.pointerId === down.pointerId) stop() }
    const stop = (): void => {
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("pointerup", end, true)
      window.removeEventListener("pointercancel", end, true)
      if (watching.current === stop) watching.current = null
    }
    window.addEventListener("pointermove", move, true)
    window.addEventListener("pointerup", end, true)
    window.addEventListener("pointercancel", end, true)
    watching.current = stop
  }

  return (
    <div className="box-actions" ref={row} data-tablet="box-actions" data-pen-handover="" data-side={place?.side ?? ""} data-compact={compact ? "1" : "0"}
         role="group"
         aria-label="The box"
         style={{
           left: sheet.x + (place?.left ?? 0), top: sheet.y + (place?.top ?? 0),
           visibility: place && full !== null ? "visible" : "hidden",
         }}
         // The row is not the sheet: a press here never reaches the box's own gestures (one that moves is handed over: `watch`).
         onPointerDown={(event) => { event.stopPropagation(); watch(event.nativeEvent) }}
         onPointerUp={(event) => event.stopPropagation()}
         onContextMenu={(event) => event.preventDefault()}>
      <button type="button" data-box-action="erase" disabled={pending}
              title="Rub out the writing inside the box (one Undo on the sheet brings it back)"
              onClick={run(erase)}>Erase</button>
      <span className="sep" aria-hidden />
      <button type="button" data-box-action="ink" disabled={off || pending}
              title={bringOff ?? "Bring the writing inside the box into the note as strokes. It leaves the sheet (Undo on the sheet brings it back)."}
              onClick={run(bring)}>{compact ? "Writing" : "Bring in Writing"}</button>
      <button type="button" data-box-action="cell" disabled={off || pending}
              title={bringOff ?? "Bring the writing inside the box into the note as a new drawing cell: at the bar if one is up, else after the caret's cell (one Undo in the note takes it out)"}
              onClick={run(cell)}>{compact ? "Drawing Cell" : "Bring in as Drawing Cell"}</button>
    </div>
  )
}
