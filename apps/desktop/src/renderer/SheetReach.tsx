/**
 * SheetReach.tsx - the reach hint of docs/spikes/DESIGN-pen-capture.md 7.7: hatched strips over the part of the sheet whose position on
 * the display is outside the allowed rectangle (the window; or the work area while the pen sink holds the pen), so a person can SEE where
 * the pen stops being WriteMind's. Presentational; IMPL-D mounts it inside the sheet host (position: relative). All the arithmetic is
 * in reachGeometry.ts. It never takes a pointer event.
 */

import type { Turns } from "../shared/orientation"
import { reachRects, type Rect01 } from "./reachGeometry"
import "./sheetReach.css"

export interface SheetReachProps {
  cover: Rect01 | null
  work: Rect01 | null
  turns: Turns
  containedBySink: boolean
}

const pct = (v: number): string => `${Math.round(v * 10000) / 100}%`

export default function SheetReach({ cover, work, turns, containedBySink }: SheetReachProps) {
  const rects = reachRects({ cover, work, turns, containedBySink })
  if (rects.length === 0) return null
  return (
    <div className="sheet-reach" data-tablet="reach" aria-hidden="true"
         title={containedBySink ? "The taskbar is outside what WriteMind can hold: a tap there still clicks it." : "Outside WriteMind's window: a tap there clicks the desktop or another program. Maximise WriteMind to cover more of the tablet."}>
      {rects.map((r, i) => (
        <div key={i} className="sheet-reach-strip" style={{ left: pct(r.x0), top: pct(r.y0), width: pct(r.x1 - r.x0), height: pct(r.y1 - r.y0) }} />
      ))}
    </div>
  )
}
