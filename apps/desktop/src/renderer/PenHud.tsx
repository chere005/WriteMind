/**
 * PenHud.tsx - the pen chip and the Capture switch in the Tablet source's camera bar (docs/spikes/DESIGN-pen-capture.md 8.7), owned by IMPL-D.
 *
 * The chip says in one line what feeds the sheet ("Pen: Wintab - 133 Hz - contained: overlay", "Pen: window pointer - reaches 62% of the tablet",
 * "Pen: no tablet (Windows: problem 10)"), coloured by severity; its text comes from main (`FeedStatus.headline`, decided in manager.ts), the
 * tooltip and the popover add the detail. Nothing is rendered where there is no native feed (`available: false`: macOS, Linux, the kill switch).
 * Next to it the Capture switch (`data-tablet="pen-capture"`) gives the pen back to the whole window and takes it again.
 */

import { useState } from "react"
import type { PenFeedHandle } from "./usePenFeed"
import { hudLines } from "./penHudText"
import "./penHud.css"

interface Props {
  feed: PenFeedHandle
  /** Open the Tablet setup check (CameraPane mounts PenCheck). */
  onCheck(): void
}

export function PenHud({ feed, onCheck }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const status = feed.status
  if (!feed.available || !status) return null
  const lines = hudLines(status)
  const tone = feed.selfOpen ? "error" : status.severity
  const text = feed.selfOpen ? "Pen: capture stopped (a fault) - switch it on again" : status.headline
  const copy = async (): Promise<void> => {
    try {
      const diagnostics = await window.wm.pen.check.copy()
      await navigator.clipboard.writeText(diagnostics)
      setCopied("Copied.")
    } catch { setCopied("Could not copy.") }
    window.setTimeout(() => setCopied(null), 2500)
  }
  return (
    <span className="pen-hud-wrap" data-tablet="pen-hud-wrap">
      <button className={`pen-hud ${tone}`} data-tablet="pen-hud" data-severity={tone} title={feed.selfOpen ?? lines.join("\n")}
              onClick={() => setOpen((was) => !was)}>{text}</button>
      <button className={`icon-button${feed.capturing ? " on" : ""}`} data-tablet="pen-capture" data-capturing={feed.capturing ? "1" : "0"}
              title={feed.capturing
                ? "Pen capture is ON: the whole tablet is this sheet while this window is in front (the mouse still works everywhere). Click to give the pen back to the whole window. Esc or Ctrl+Alt+G lets go too."
                : "Pen capture is OFF: the pen works as a plain pointer over the whole window. Click to make the whole tablet this sheet."}
              onClick={feed.toggle}
              style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>{feed.capturing ? "Capture: on" : "Capture: off"}</button>
      {open && (
        <div className="pen-hud-pop" data-tablet="pen-hud-pop" onPointerDown={(event) => event.stopPropagation()}>
          {lines.map((line, index) => <p key={index}>{line}</p>)}
          <div className="pen-hud-buttons">
            <button className="icon-button" data-tablet="pen-check" onClick={() => { setOpen(false); onCheck() }}>Tablet setup check (20 s)</button>
            {feed.capturing && <button className="icon-button" data-tablet="pen-release" onClick={() => { feed.release(); setOpen(false) }}>Release the pen</button>}
            <button className="icon-button" data-tablet="pen-copy" onClick={() => { void copy() }}>Copy diagnostics</button>
            <button className="icon-button" data-tablet="pen-trace" onClick={() => { void window.wm.pen.revealTrace() }}>Reveal trace</button>
          </div>
          {copied && <p className="hint">{copied}</p>}
        </div>
      )}
    </span>
  )
}
