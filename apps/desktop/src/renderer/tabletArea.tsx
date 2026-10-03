/**
 * "Tablet area": for a person who keeps the notes in view and the sheet as a
 * pane. THE DRIVER controls the mapping — a pen tablet in Pen mode maps the
 * whole tablet to the whole screen, or to whatever portion of it is set in
 * the driver — and an app cannot change that. So this says exactly which
 * rectangle of the screen the sheet is on, in the physical pixels the driver
 * asks for, and can flash a frame round it so its corners are easy to click.
 */

import { useEffect, useState, useSyncExternalStore } from "react"
import { describeArea, fallbackInfo, physicalRect, type DisplayInfo, type PhysicalRect } from "./padGeometry"

// MARK: - The frame that flashes round the sheet

let flashing = false
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

/** Show the bordered frame on the sheet for a few seconds. */
export function flashAreaFrame(ms = 6000): void {
  flashing = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { flashing = false; timer = null; changed() }, ms)
  changed()
}
export const useAreaFlash = (): boolean =>
  useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => flashing)

// MARK: - The rectangle

/** The sheet on screen right now, in physical pixels of its display; null when it is not showing. */
export async function currentSheetArea(): Promise<PhysicalRect | null> {
  const element = document.querySelector<HTMLElement>('[data-tablet="surface"]')
  if (!element) return null
  const box = element.getBoundingClientRect()
  if (box.width === 0) return null
  let info: DisplayInfo
  try { info = (await window.wm.windowInfo?.()) ?? fallbackInfo(window) } catch { info = fallbackInfo(window) }
  return physicalRect({ x: box.left, y: box.top, width: box.width, height: box.height }, info)
}

/** What the person is told. In Pad mode there is nothing to define. */
export function TabletAreaHelp({ inPad = false }: { inPad?: boolean }) {
  const [area, setArea] = useState<PhysicalRect | null>(null)
  const [looked, setLooked] = useState(false)
  const look = async () => { setArea(await currentSheetArea()); setLooked(true) }
  useEffect(() => { void look() }, [])
  return (
    <div className="area-help" data-pen="area">
      <p><b>Tablet area.</b> The tablet driver (not WriteMind) decides which part of the
        screen the tablet covers, and WriteMind cannot change that.</p>
      {inPad ? (
        <p>Pad mode is for the default mapping: the <b>whole tablet</b> maps to the <b>whole
          screen</b>, and this window now shows only the sheet, so the whole tablet is the sheet.</p>
      ) : (
        <>
          <p>To use only the sheet, keep the Tablet showing and, in Wacom Tablet Properties ▸
            Mapping ▸ Screen Area ▸ <b>Portion of screen</b> ▸ <b>Click to define</b>, click the two
            corners of this rectangle (use <b>Show area</b> to outline it):</p>
          {area ? (
            <p className="area-numbers">
              Top-left <b>{area.x}, {area.y}</b> · bottom-right <b>{area.right}, {area.bottom}</b><br />
              <span>{describeArea(area)}</span>
            </p>
          ) : (
            <p className="hint">{looked
              ? "The sheet is not showing. Pick Input Devices ▸ Tablet to see its rectangle here."
              : "…"}</p>
          )}
          <p className="area-buttons">
            <button className="icon-button" data-pen="area-show" style={{ width: "auto", padding: "0 8px" }}
                    onClick={() => { void look(); flashAreaFrame() }}>Show area</button>
            <button className="icon-button" data-pen="area-refresh" style={{ width: "auto", padding: "0 8px" }}
                    onClick={() => { void look() }}>Measure again</button>
          </p>
          <p className="hint">Measure again after moving or resizing the window. Or use <b>Pad</b>
            (Ctrl+Alt+T) to make the whole tablet the sheet with no setup.</p>
        </>
      )}
    </div>
  )
}
