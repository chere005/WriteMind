/**
 * The video pane's header: ONE 36px row, dark in both themes, never wrapping (docs/PLAN-bars-2026-10.md P4; the
 * wireframes docs/ui-2026-10/FinalMain.png and FinalTablet.png).
 *
 *   CAMERA   turn left · turn right · Zoom · Hold · Straighten  ......  Writing | Image | Raw  ✕
 *   TABLET   Paper · orientation · Undo  ......  Bring in ▾  ✕
 *
 * The camera's SOURCE is not chosen here: the video menu in the tab row (and Input Devices) does that. Every button is
 * one 28px line icon (icons.tsx); a menu is marked by the small triangle in the button's corner. How much of the
 * camera's row fits in a narrow pane is `headerFit` (cameraHeaderFit.ts); the tablet's is short enough to fit at the
 * pane's 280px minimum as it is. The test hooks of the old header (`.camera-bar`, `data-camera-turn`, `data-camera`,
 * `data-capture`, `data-tablet`) stay on the buttons that kept their job.
 */

import { Icon, type IconName } from "./icons"
import { MenuButton } from "./MenuButton"
import { PaperMenu } from "./PaperMenu"
import { BringInMenu } from "./BringInMenu"
import { OrientationMenu } from "./OrientationSelect"
import type { BringTo, CaptureMode } from "./cameraSettings"
import type { HeaderFit } from "./cameraHeaderFit"

/** The three ways to take a picture, in the order of the segmented control. */
export const TAKES: { mode: CaptureMode; label: string; icon: IconName; title: string }[] = [
  { mode: "ink", label: "Writing", icon: "pen", title: "Take the writing off the page" },
  { mode: "page", label: "Image", icon: "image", title: "Take the page as a photograph" },
  { mode: "raw", label: "Raw", icon: "camera", title: "Take the raw picture, exactly as the camera sees it: no page found, nothing squared" },
]

interface CameraProps {
  fit: HeaderFit
  /** There is a picture to work on (the camera's, or the open page's). */
  pictured: boolean
  busy: boolean
  turn(by: number): void
  /** The pane is zoomed into a box (and how much of the picture it shows, 1..0), or is waiting for the box to be dragged. */
  zoomed: boolean
  zoomPercent: number
  zooming: boolean
  onZoom(): void
  onOriginalSize(): void
  holding: boolean
  /** Hold is the camera's: off while a kept page is open or nothing is running. */
  holdOff: boolean
  holdTitle: string
  onHold(): void
  straighten: boolean
  onStraighten(): void
  onFindPage(): void
  /** The lifted one of Writing | Image | Raw. */
  mode: CaptureMode
  onTake(mode: CaptureMode): void
  onHide(): void
  /** The notes pane is hidden: the header carries the way back. */
  showEditor: boolean
  onToggleEditor?(): void
}

/** The header over the camera's picture. */
export function CameraHeader(p: CameraProps) {
  const percent = `${p.zoomPercent}%`
  return (
    <div className="bar-row camera-bar camera-head" role="toolbar" aria-label="Camera" data-camera-head="camera">
      <button type="button" className="bar-btn" data-camera-turn="left" aria-label="Turn left" title="Turn the picture a quarter turn anticlockwise"
              disabled={!p.pictured} onClick={() => p.turn(-90)}><Icon name="rotl" /></button>
      <button type="button" className="bar-btn" data-camera-turn="right" aria-label="Turn right" title="Turn the picture a quarter turn clockwise"
              disabled={!p.pictured} onClick={() => p.turn(90)}><Icon name="rotate" /></button>
      <MenuButton icon="zoom" label={p.fit.readout && p.zoomed ? percent : undefined} on={p.zoomed || p.zooming}
                  disabled={!p.pictured && !p.zoomed} data={{ "camera-zoom": "square" }}
                  title={p.zoomed ? `Zoom: the pane shows ${percent} of the picture. Click to drag a box and zoom further; the corner menu has Original size.`
                    : "Zoom: drag a box on the picture and the pane shows just that much"}
                  onMain={p.onZoom}
                  items={[
                    { header: p.zoomed ? `Showing ${percent} of the picture` : "Showing the whole picture" },
                    { label: "Zoom to a Box", icon: "zoom", onClick: p.onZoom, dataBar: "zoom-box" },
                    { label: "Original Size", disabled: !p.zoomed, onClick: p.onOriginalSize, dataBar: "zoom-original" },
                  ]} />
      <button type="button" className={`bar-btn${p.holding ? " on" : ""}`} data-camera="hold" aria-pressed={p.holding} aria-label="Hold image"
              title={p.holdTitle} disabled={p.holdOff} onClick={p.onHold}><Icon name="pause" /></button>
      <MenuButton icon="straighten" on={p.straighten} disabled={!p.pictured && !p.straighten} onMain={p.onStraighten}
                  title="Square the page up: drag the four corners onto the page's corners"
                  items={[{ label: "Find the Page Again", icon: "find", disabled: !p.straighten || !p.pictured, onClick: p.onFindPage,
                    dataBar: "find-page" }]} />
      {!p.showEditor && (
        <button type="button" className="bar-btn label" data-pane="notes" title="Back to Side by Side: the notes and the video together again"
                onClick={() => p.onToggleEditor?.()}><span className="bar-label-text">Back to Side by Side</span></button>
      )}
      <span className="grow" />
      <span className="bar-seg" role="group" aria-label="Take">
        {TAKES.map((one) => (
          <button key={one.mode} type="button" className={`bar-btn${p.mode === one.mode ? " on" : ""}`} data-capture={one.mode}
                  aria-label={one.label} title={one.title} disabled={!p.pictured || p.busy} onClick={() => p.onTake(one.mode)}>
            {p.fit.words ? one.label : <Icon name={one.icon} />}
          </button>
        ))}
      </span>
      <button type="button" className="bar-btn" aria-label="Put the camera away" title="Put the camera away" onClick={p.onHide}><Icon name="close" /></button>
    </div>
  )
}

interface TabletProps {
  /** The sheet can take back a stroke (or the cell's note has a step to take back). */
  canUndo: boolean
  undoTitle: string
  onUndo(): void
  /** The sheet has writing to wipe. */
  canClear: boolean
  onClear(): void
  to: BringTo
  onBringTo(next: BringTo): void
  /** What the main button does now, with its tooltip. */
  bringTitle: string
  /** Why Bring in is off (a drawing cell's own sheet, no note open), or null. */
  bringOff: string | null
  onBring(to: BringTo): void
  onBringPage(): void
  onHide(): void
  showEditor: boolean
  onToggleEditor?(): void
}

/** The header over the tablet's sheet. */
export function TabletHeader(p: TabletProps) {
  return (
    <div className="bar-row camera-bar camera-head" role="toolbar" aria-label="Tablet sheet" data-camera-head="tablet">
      <PaperMenu />
      <OrientationMenu />
      {/* No Select toggle on the sheet (Sean, 2026-10-06: left on, it held the pen in a mode he took for a stuck eraser:
          "i had the select button pressed.. remove that button"). The mouse boxes a part; so does the pen with its select
          button held, or the Pen ▸ Select Tool toggle (an ExpressKey / double tap). */}
      <MenuButton icon="undo" className={p.canUndo ? undefined : "dim"} data={{ tablet: "undo" }} title={p.undoTitle}
                  onMain={() => { if (p.canUndo) p.onUndo() }}
                  items={[{ label: "Clear the Sheet", disabled: !p.canClear, danger: true, onClick: p.onClear, dataBar: "clear" }]} />
      {!p.showEditor && (
        <button type="button" className="bar-btn label" data-pane="notes" title="Back to Side by Side: the notes and the video together again"
                onClick={() => p.onToggleEditor?.()}><span className="bar-label-text">Back to Side by Side</span></button>
      )}
      <span className="grow" />
      <BringInMenu to={p.to} onChange={p.onBringTo} title={p.bringTitle} off={p.bringOff} onBring={p.onBring} onPage={p.onBringPage} />
      <button type="button" className="bar-btn" aria-label="Put the sheet away" title="Put the sheet away" onClick={p.onHide}><Icon name="close" /></button>
    </div>
  )
}
