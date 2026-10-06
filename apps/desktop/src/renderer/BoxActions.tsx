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
 */

import { useLayoutEffect, useRef, useState } from "react"
import type { Rect, Size } from "@writemind/core"
import { placeRow, ROW_GAP, type RowPlace } from "./boxRow"

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
  return (
    <div className="box-actions" ref={row} data-tablet="box-actions" data-side={place?.side ?? ""} data-compact={compact ? "1" : "0"}
         role="group"
         aria-label="The box"
         style={{
           left: sheet.x + (place?.left ?? 0), top: sheet.y + (place?.top ?? 0),
           visibility: place && full !== null ? "visible" : "hidden",
         }}
         // The row is not the sheet: a press here never reaches the box's own gestures.
         onPointerDown={(event) => event.stopPropagation()}
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
