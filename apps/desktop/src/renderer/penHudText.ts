/**
 * penHudText.ts - the words of the pen chip's tooltip and popover (docs/spikes/DESIGN-pen-capture.md 8.7), pure so the table is a test.
 * The chip's own line (`FeedStatus.headline`) and colour (`severity`) are decided in main (manager.ts `headlineFor`); this adds what the tooltip
 * carries: the active backend and its rate, where the direction came from, the containment, how much of the tablet the window pen reaches,
 * the last reason a backend gave, and the hint to run the check.
 */

import type { BackendName, BackendStatus, FeedStatus } from "../shared/pen"

export const BACKEND_NAME: Record<BackendName, string> = {
  "wintab-system": "Wintab (mapped)", "wintab-data": "Wintab", rawinput: "Raw HID", webhid: "WebHID", dom: "Window pen", overlay: "Overlay", inject: "Test",
}

/** "contained: overlay (on trial)", "contained: driver", "not contained (the overlay did not take the pen here)", or "not contained". */
export function containmentLine(status: FeedStatus): string {
  const c = status.containment
  if (c.armed && c.mode !== "none") {
    const name = c.mode === "sink" ? "overlay" : c.mode
    const trial = c.mode === "sink" && c.capabilities.sink.state === "untested"
    return `contained: ${name}${trial ? " (on trial)" : ""}`
  }
  if (status.settings.contain === "none") return "not contained (containment is off)"
  if (c.capabilities.sink.state === "ineffective") return "not contained (the overlay did not take the pen here)"
  if (c.capabilities.sink.state === "unsafe") return "not contained (the overlay was switched off for safety)"
  return "not contained"
}

const reachOf = (backends: BackendStatus[]): number | null => {
  const facts = backends.find((b) => b.name === "dom")?.facts
  const x = facts?.["coverage.x"], y = facts?.["coverage.y"]
  return typeof x === "number" && typeof y === "number" ? Math.min(x, y) : null
}

/** The lines of the tooltip, most useful first. */
export function hudLines(status: FeedStatus): string[] {
  const lines: string[] = []
  const active = status.backends.find((b) => b.name === status.active)
  if (active) {
    const rate = active.rateHz !== null ? `, ${Math.round(active.rateHz)} Hz` : ""
    lines.push(`Feeding the sheet: ${BACKEND_NAME[active.name]}${rate}.`)
    if (status.frame && status.frame.source !== "screen") {
      lines.push(status.frame.source === "default" ? "Pen direction: guessed (the check measures it)." : `Pen direction: measured (${status.frame.source}).`)
    }
  } else {
    lines.push("Nothing is feeding the sheet yet.")
  }
  if (status.active === "dom" || status.active === "overlay") {
    const reach = reachOf(status.backends)
    lines.push("No tablet feed: the pen is read from where Windows puts it on the screen.")
    if (reach !== null && reach < 0.9) lines.push(`The window reaches ${Math.round(reach * 100)}% of the tablet: maximise WriteMind (not full screen).`)
  }
  lines.push(containmentLine(status) + ".")
  for (const b of status.backends) {
    if (b.reason && (b.state === "failed" || b.state === "stale" || b.state === "unavailable" || (b.state === "armed" && b.name !== "dom"))) {
      lines.push(`${BACKEND_NAME[b.name]}: ${b.reason}`)
    }
  }
  if (status.winner === null && status.env?.tablet?.present !== false) lines.push("Never checked: run the 20 s check.")
  return lines
}

export const hudTitle = (status: FeedStatus): string => hudLines(status).join("\n")
