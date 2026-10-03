/**
 * PAD MODE: the whole tablet is the sheet.
 *
 * A pen tablet in Pen mode is mapped by its DRIVER to the whole screen, and an
 * app cannot change that. So the window goes full screen on its display
 * (main/pad.ts) and this fills it with nothing but the sheet — the same sheet
 * the video pane shows (tabletCapture.ts), at the screen's own shape — and
 * the whole tablet then maps 1:1, proportionally, onto the sheet.
 *
 * A slim strip comes down from the top edge (and goes away by itself while a
 * stroke is being written) with the things a pen needs, as large targets:
 * Send Writing, Send Page, Box, Erase, Undo, Clear, the pen's colour and
 * width, and Exit. What is sent goes into the note exactly as from the pane
 * (the same function), and the note is where it was when the pad is left.
 *
 * Esc leaves. Losing full screen by any other road leaves too (App listens to
 * the shell).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Rect, Size } from "@writemind/core"
import { PenMenu } from "./PenMenu"
import { STRIP_EDGE, stripWanted } from "./padGeometry"
import { setEraser, usePenSettings } from "./penSettings"
import { TabletSurface, type SurfaceHandle } from "./TabletSurface"
import { keepClearAfter, keptClearAfter, sheet, takeFromSheet, type Capture } from "./tabletCapture"

interface Props {
  penColour: string
  onPenColour(hex: string): void
  penWidth: number
  onPenWidth(width: number): void
  /** The notes pane as it was when the pad was entered: what a capture is measured against. */
  pane: Size
  onCapture(capture: Capture): void
  onExit(): void
}

export const PAD_COLOURS = ["#2D7DD2", "#1C1C1E", "#D93025", "#188038", "#F29900", "#8E44AD"]
const MIN_WIDTH = 1, MAX_WIDTH = 16
/** How long a pen must hover at the top edge before the strip comes down (so writing up to the edge is not covered). */
export const EDGE_DWELL = 400

export function PadMode({ penColour, onPenColour, penWidth, onPenWidth, pane, onCapture, onExit }: Props) {
  const surface = useRef<SurfaceHandle | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const pen = usePenSettings()
  const [boxTool, setBoxTool] = useState(false)
  const [box, setBox] = useState<Rect | null>(null)
  const [clearAfter, setClearAfter] = useState(keptClearAfter)
  const [, edited] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [strip, setStrip] = useState(true)

  // The strip: down at the start (so it is found), then up on its own.
  const pointer = useRef({
    y: null as number | null, overStrip: false, writing: false, pinned: false, left: performance.now(),
    edgeSince: null as number | null,
  })
  useEffect(() => {
    const first = window.setTimeout(() => { pointer.current.left = performance.now() - 5000 }, 2500)
    const tick = window.setInterval(() => {
      const p = pointer.current
      const dwelled = p.edgeSince !== null && performance.now() - p.edgeSince >= EDGE_DWELL
      setStrip(stripWanted({
        y: dwelled ? p.y : null, overStrip: p.overStrip, writing: p.writing, pinned: p.pinned,
        sinceLeft: performance.now() - p.left,
      }))
    }, 150)
    return () => { window.clearTimeout(first); window.clearInterval(tick) }
  }, [])

  // The pad takes the keyboard: whatever the note had, typing goes nowhere.
  useEffect(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    root.current?.querySelector<HTMLElement>('[data-tablet="surface"]')?.focus({ preventScroll: true })
  }, [])

  // Esc leaves.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      pointer.current.left = performance.now()
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onExit() }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [onExit])

  const say = useCallback((text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage((was) => (was === text ? null : was)), 3200)
  }, [])

  const send = async (mode: "ink" | "page") => {
    const out = await takeFromSheet(mode, {
      box, shown: surface.current?.size() ?? { width: 0, height: 0 }, pane,
      penColour, penWidth, clearAfter,
    })
    if ("trouble" in out) { say(out.trouble); return }
    if (out.cleared) { surface.current?.repaint(); setBox(null); edited((was) => was + 1) }
    onCapture(out.capture)
    const what = mode === "ink"
      ? `${out.capture.strokes?.length ?? 0} ${out.capture.strokes?.length === 1 ? "stroke" : "strokes"}`
      : "the page"
    say(`Sent ${what} to the note.${out.read ? ` ${out.read}` : ""}`)
  }

  const swatch = (hex: string) => (
    <button key={hex} className={`pad-swatch${hex.toLowerCase() === penColour.toLowerCase() ? " on" : ""}`}
            data-pad="colour" data-colour={hex} title={hex} style={{ background: hex }}
            onClick={() => { setEraser(false); onPenColour(hex) }} />
  )

  const mark = (event: React.PointerEvent) => {
    const p = pointer.current
    p.y = event.clientY
    if (event.clientY <= STRIP_EDGE && event.buttons === 0) {
      p.edgeSince ??= performance.now()
      if (performance.now() - p.edgeSince >= EDGE_DWELL) p.left = performance.now()
    } else p.edgeSince = null
  }

  return (
    <div className="pad" ref={root} data-pad="root"
         onPointerMove={mark}
         onPointerDown={(event) => {
           pointer.current.writing = !(event.target instanceof Element && event.target.closest(".pad-strip"))
         }}
         onPointerUp={() => { pointer.current.writing = false; pointer.current.left = performance.now() - 1500 }}
         onPointerCancel={() => { pointer.current.writing = false }}>
      <TabletSurface ref={surface} page={sheet} colour={penColour} width={penWidth}
                     boxTool={boxTool} box={box} ownsUndo
                     onBox={(rect, done) => { setBox(rect); if (done) setBoxTool(false) }}
                     onEdited={() => edited((was) => was + 1)} />
      <div className={`pad-strip${strip ? " shown" : ""}`} data-pad="strip"
           onPointerEnter={() => { pointer.current.overStrip = true }}
           onPointerLeave={() => { pointer.current.overStrip = false; pointer.current.left = performance.now() }}>
        <button className="pad-button primary" data-pad="send-writing"
                title="Bring the writing into the note as strokes"
                onClick={() => { void send("ink") }}>Send Writing</button>
        <button className="pad-button primary" data-pad="send-page"
                title="Bring the sheet into the note as a picture"
                onClick={() => { void send("page") }}>Send Page</button>
        <button className={`pad-button${boxTool ? " on" : ""}`} data-pad="box"
                title="Drag a dashed box over the part to send"
                onClick={() => setBoxTool((was) => !was)}>Box</button>
        <button className={`pad-button${pen.eraser ? " on" : ""}`} data-pad="erase"
                title="Touch a stroke to rub it out"
                onClick={() => setEraser(!pen.eraser)}>Erase</button>
        <button className="pad-button" data-pad="undo" disabled={!sheet.canUndo}
                title="Take back the last stroke (Ctrl+Z)"
                onClick={() => surface.current?.undo()}>Undo</button>
        <button className="pad-button" data-pad="clear" disabled={sheet.strokes.length === 0}
                title="Wipe the sheet"
                onClick={() => { surface.current?.clear(); setBox(null) }}>Clear</button>
        <button className={`pad-button${clearAfter ? " on" : ""}`} data-pad="clear-after"
                title="Wipe what was sent from the sheet once it is in the note"
                onClick={() => { const next = !clearAfter; setClearAfter(next); keepClearAfter(next) }}>Clear after</button>
        <span className="pad-sep" />
        {PAD_COLOURS.map(swatch)}
        <button className="pad-button small" data-pad="thinner" title="Thinner line"
                onClick={() => onPenWidth(Math.max(MIN_WIDTH, penWidth - 1))}>−</button>
        <span className="pad-width" data-pad="width" title="Line width">{penWidth}</span>
        <button className="pad-button small" data-pad="thicker" title="Thicker line"
                onClick={() => onPenWidth(Math.min(MAX_WIDTH, penWidth + 1))}>+</button>
        <span className="pad-sep" />
        <PenMenu inPad />
        <span className="pad-grow" />
        <button className="pad-button exit" data-pad="exit" title="Back to the note (Esc)"
                onClick={onExit}>Exit Pad</button>
      </div>
      {message && <div className="pad-toast" data-pad="toast">{message}</div>}
    </div>
  )
}
