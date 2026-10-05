/**
 * The tablet as a source for the video pane: a sheet of paper in place of the camera's picture.
 *
 * THE INPUT SPLIT. The PEN writes (a pen's pointer events; the native feed (renderer/penFeed.ts) dispatches real
 * `PointerEvent`s with `pointerType: "pen"`, so the handlers below are the only code path for the pen and the feed
 * alike). The MOUSE (and touch) never writes: a drag pulls the dashed box that selects a section of the sheet to
 * bring into the notebook, as the Mac's box does over the camera's picture. The box is moved by dragging inside
 * it, resized by its corner handles, cleared by Esc or a click outside it; a double click takes the whole
 * sheet. (The pen's side button, set to Select, boxes too; the Erase button makes any pointer rub out.)
 *
 * Built to feel like a pad. Pointer events arrive far faster than frames, so every coalesced sample is kept (the
 * stroke's real shape) and the ink canvas is only touched once a frame, and then only for the segments that are
 * NEW. The canvas is `desynchronized` and sized in device pixels, so hairlines are crisp on a high-DPI screen.
 *
 * THE PAPER (tabletPaper.ts) is a second canvas UNDER the ink. It is never ink data: the strokes are fractions of
 * the sheet and know nothing of it. Palm rejection is the notes page's rule (`penNear`).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import { isBoxDrag, type Point, type Rect, type Size } from "@writemind/core"
import { pressAction } from "./penButtons"
import { penNear, penSettings, usePenSettings } from "./penSettings"
import { setTabletUndo } from "./tabletFocus"
import {
  boxFromPoints, fitRect, hitBox, moveBox, paintStrokes, resizeBox, SHEET_REF, strokeUnder,
  type BoxHandle, type BoxHit, type InkStroke, type TabletPage,
} from "./tabletPage"
import { colourOfPaper, inkOn, paintPaper, usePaper } from "./tabletPaper"
import "./tablet.css"

export interface SurfaceHandle {
  undo(): void
  redo(): void
  clear(): void
  /** Repaint everything (after the page was changed from outside). */
  repaint(): void
  /** The sheet's size on screen, in CSS pixels. */
  size(): Size
}

interface Props {
  page: TabletPage
  colour: string
  width: number
  /** The dashed box, in FRACTIONS of the sheet. */
  box: Rect | null
  /** The box changed (fractions of the sheet), or was taken away (null). */
  onBox(rect: Rect | null): void
  /** The page changed (a stroke, an erase, an undo): the buttons may need to update. */
  onEdited(): void
}

/** How near a stroke the eraser has to be, in points. */
const ERASE_RADIUS = 8
/** A box smaller than this, either way, is a click. */
const MIN_BOX_PX = 8
/** Two clicks this close in time and place are a double click. */
const DOUBLE_MS = 450
const HANDLES: BoxHandle[] = ["nw", "ne", "sw", "se"]

type Gesture =
  | { kind: "draw"; stroke: InkStroke; drawn: number; pen: boolean }
  | { kind: "erase"; marked: boolean }
  | {
    kind: "box"; mode: "new" | "move" | "resize"
    startPx: Point; start: Point; origin: Rect | null; handle: BoxHandle | null; dragged: boolean
  }

const CURSORS: Record<Exclude<BoxHit, null>, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", inside: "move",
}

export const TabletSurface = forwardRef<SurfaceHandle, Props>(function TabletSurface(
  { page, colour, width, box, onBox, onEdited }, handle) {
  const host = useRef<HTMLDivElement | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1))
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const backdrop = useRef<HTMLCanvasElement | null>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const size = useRef<Size>({ width: 0, height: 0 })
  const gesture = useRef<Gesture | null>(null)
  const lastClick = useRef<{ time: number; x: number; y: number } | null>(null)
  const frame = useRef<number | null>(null)
  const everything = useRef(true)
  const settings = usePenSettings()
  const paper = usePaper()
  const latest = useRef({ colour, width, onBox, onEdited, page, box, paper })
  latest.current = { colour, width, onBox, onEdited, page, box, paper }

  const toPixel = useCallback((point: Point): Point =>
    ({ x: point.x * size.current.width, y: point.y * size.current.height }), [])

  /** Pixels per reference unit: a stroke's width is kept in units of the sheet, not of the screen. */
  const unit = () => size.current.width / SHEET_REF
  /** How a stroke's colour looks on this paper. */
  const tint = (hex: string): string => inkOn(latest.current.paper, hex)

  const paint = useCallback(() => {
    frame.current = null
    const element = canvas.current
    if (!element || size.current.width === 0) return
    const ratio = window.devicePixelRatio || 1
    const w = Math.floor(size.current.width * ratio), h = Math.floor(size.current.height * ratio)
    if (element.width !== w || element.height !== h) {
      element.width = w
      element.height = h
      everything.current = true
    }
    context.current ??= element.getContext("2d", { desynchronized: true })
    const ctx = context.current
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const g = gesture.current
    if (everything.current) {
      everything.current = false
      ctx.clearRect(0, 0, element.width, element.height)
      paintStrokes(ctx, latest.current.page.strokes, toPixel, unit(), undefined, 0, tint)
      // A stroke under the pen is repainted whole after a resize or an erase.
      if (g?.kind === "draw") {
        paintStrokes(ctx, [g.stroke], toPixel, unit(), undefined, 0, tint)
        g.drawn = g.stroke.points.length
      }
      return
    }
    if (g?.kind === "draw" && g.stroke.points.length > g.drawn) {
      // Only the segments that are new since the last frame.
      paintStrokes(ctx, [g.stroke], toPixel, unit(), undefined, g.drawn, tint)
      g.drawn = g.stroke.points.length
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tint` reads the latest paper through the ref
  }, [toPixel])

  const schedule = useCallback((full = false) => {
    if (full) everything.current = true
    if (frame.current === null) frame.current = requestAnimationFrame(paint)
  }, [paint])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      // The sheet has the screen's shape; the pane it sits in need not, so it is
      // fitted inside it (letterboxed) and never stretched.
      const box = fitRect({ width: rect.width, height: rect.height }, latest.current.page.aspect)
      size.current = { width: box.width, height: box.height }
      setFit((was) => (was.x === box.x && was.y === box.y && was.width === box.width && was.height === box.height ? was : box))
      setDpr(window.devicePixelRatio || 1)
      schedule(true)
    }
    measure()
    // The sheet's shape follows the tablet's orientation.
    const unlisten = latest.current.page.onChange(() => {
      const r = element.getBoundingClientRect()
      const next = fitRect({ width: r.width, height: r.height }, latest.current.page.aspect)
      if (Math.abs(next.width - size.current.width) > 0.5 || Math.abs(next.height - size.current.height) > 0.5) measure()
      else schedule(true)
    })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The display's scale can change under the sheet (150% on one monitor, 100% on the next, a
    // zoom): the canvases are in device pixels, so they are measured again.
    window.addEventListener("resize", measure)
    let ratio: MediaQueryList | null = null
    const watchRatio = () => {
      ratio?.removeEventListener("change", onRatio)
      ratio = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      ratio.addEventListener("change", onRatio)
    }
    const onRatio = () => { measure(); watchRatio() }
    watchRatio()
    return () => {
      unlisten()
      observer.disconnect()
      window.removeEventListener("resize", measure)
      ratio?.removeEventListener("change", onRatio)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [schedule])

  // The paper, on its own canvas under the ink: painted when the paper, the sheet's size or the display's scale changes (never per stroke).
  useLayoutEffect(() => {
    const element = backdrop.current
    if (!element || fit.width <= 0 || fit.height <= 0) return
    const w = Math.max(1, Math.round(fit.width * dpr)), h = Math.max(1, Math.round(fit.height * dpr))
    if (element.width !== w || element.height !== h) { element.width = w; element.height = h }
    const ctx = element.getContext("2d")
    if (!ctx) return
    const units: Size = { width: SHEET_REF, height: SHEET_REF * fit.height / fit.width }
    paintPaper(ctx, paper, units, { x: 0, y: 0, ...units }, { width: w, height: h }, dpr)
  }, [paper, fit.width, fit.height, dpr])
  // The ink's look follows the paper (dark paper lifts the default ink).
  useEffect(() => { schedule(true) }, [paper.colour, schedule])

  // Undo and redo, for the keys and for the buttons.
  const hovered = useRef(false)
  const act = useCallback((which: "undo" | "redo"): boolean => {
    const p = latest.current.page
    const did = which === "undo" ? p.undo() : p.redo()
    if (did) { schedule(true); latest.current.onEdited() }
    return did
  }, [schedule])

  useEffect(() => {
    setTabletUndo((which) => {
      const focused = wrap.current !== null && wrap.current.contains(document.activeElement)
      return (hovered.current || focused) ? act(which) : false
    })
    return () => setTabletUndo(null)
  }, [act])

  // Esc takes the box away (not from a text field, which keeps its Esc). It goes first and stops there, so it
  // does not also let go of the pen feed.
  const hasBox = box !== null
  useEffect(() => {
    if (!hasBox) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const active = document.activeElement
      if (active instanceof HTMLElement && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return
      event.preventDefault()
      event.stopPropagation()
      latest.current.onBox(null)
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [hasBox])

  useImperativeHandle(handle, () => ({
    undo: () => { act("undo") },
    redo: () => { act("redo") },
    clear: () => { latest.current.page.clear(); schedule(true); latest.current.onEdited() },
    repaint: () => schedule(true),
    size: () => size.current,
  }), [act, schedule])

  const at = (event: { clientX: number; clientY: number }): { px: Point; unit: Point } => {
    const rect = wrap.current!.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    // A stroke that strays past the edge (the pen is captured) stops at the sheet's edge.
    const clamp = (value: number) => Math.min(1, Math.max(0, value))
    return {
      px: { x, y },
      unit: { x: clamp(x / Math.max(1, rect.width)), y: clamp(y / Math.max(1, rect.height)) },
    }
  }

  const eraseAt = (g: Extract<Gesture, { kind: "erase" }>, point: Point) => {
    const p = latest.current.page
    const index = strokeUnder(p.strokes, point, size.current, ERASE_RADIUS, size.current.width / SHEET_REF)
    if (index < 0) return
    if (!g.marked) { p.mark(); g.marked = true }
    p.removeAt(index)
    schedule(true)
  }

  const down = (event: PointerEvent) => {
    if (event.pointerType === "touch" && penNear()) { event.preventDefault(); return }
    const pen = event.pointerType === "pen"
    if (!pen && event.button !== 0) return
    event.preventDefault()
    let action = pressAction(event, penSettings())
    // A pen button with nothing to do here (a tap action the runtime fires, Pan) does nothing on the sheet.
    if (action === "ignore" || action === "pan") return
    wrap.current?.focus({ preventScroll: true })
    // Keep the gesture when the pointer strays past the edge (a synthetic event has no pointer to capture: the feed keeps the target itself).
    try { wrap.current?.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
    // THE SPLIT: only the pen writes. Anything else that would have drawn pulls the box.
    if (action === "draw" && !pen) action = "select"
    const { px, unit: point } = at(event)
    if (action === "erase") {
      const g: Gesture = { kind: "erase", marked: false }
      gesture.current = g
      eraseAt(g, point)
    } else if (action === "select") {
      const current = latest.current.box
      const hit = current ? hitBox(current, point, size.current) : null
      const base = { kind: "box" as const, startPx: px, start: point, dragged: false }
      if (current && hit === "inside") gesture.current = { ...base, mode: "move", origin: current, handle: null }
      else if (current && hit && hit !== "inside") gesture.current = { ...base, mode: "resize", origin: current, handle: hit }
      else gesture.current = { ...base, mode: "new", origin: null, handle: null }
    } else {
      const pressure = event.pressure > 0 ? event.pressure : 0.5
      gesture.current = {
        kind: "draw", drawn: 0, pen,
        stroke: {
          colorHex: latest.current.colour,
          width: latest.current.width * SHEET_REF / Math.max(1, size.current.width),
          points: [point],
          ...(pen && penSettings().pressure ? { pressures: [pressure] } : {}),
        },
      }
      schedule()
    }
  }

  const move = (event: PointerEvent) => {
    const g = gesture.current
    if (!g) {
      // The mouse over the box says what a drag would do.
      if (event.pointerType !== "pen" && wrap.current) {
        const current = latest.current.box
        const hit = current ? hitBox(current, at(event).unit, size.current) : null
        wrap.current.style.cursor = settings.eraser ? "cell" : hit ? CURSORS[hit] : "crosshair"
      }
      return
    }
    // A pen reports far more samples than frames: the coalesced ones are the real stroke.
    const samples = event.getCoalescedEvents?.() ?? []
    const all = samples.length > 0 ? samples : [event]
    if (g.kind === "draw") {
      for (const sample of all) {
        g.stroke.points.push(at(sample).unit)
        g.stroke.pressures?.push(sample.pressure > 0 ? sample.pressure : 0.5)
      }
      schedule()
    } else if (g.kind === "erase") {
      for (const sample of all) eraseAt(g, at(sample).unit)
    } else {
      const here = at(event)
      if (!g.dragged && !isBoxDrag(here.px.x - g.startPx.x, here.px.y - g.startPx.y)) return
      g.dragged = true
      if (g.mode === "move") latest.current.onBox(moveBox(g.origin!, here.unit.x - g.start.x, here.unit.y - g.start.y))
      else if (g.mode === "resize") latest.current.onBox(resizeBox(g.origin!, g.handle!, here.unit, size.current, MIN_BOX_PX))
      else latest.current.onBox(boxFromPoints(g.start, here.unit))
    }
  }

  const up = (event: PointerEvent) => {
    const g = gesture.current
    // The last samples are painted now, not left to a frame that will find no stroke.
    if (g?.kind === "draw") paint()
    gesture.current = null
    for (const owner of [wrap.current, host.current]) {
      try { if (owner?.hasPointerCapture(event.pointerId)) owner.releasePointerCapture(event.pointerId) } catch { /* gone */ }
    }
    if (!g) return
    if (g.kind === "draw") {
      latest.current.page.add(g.stroke)
      latest.current.onEdited()
    } else if (g.kind === "erase") {
      if (g.marked) latest.current.onEdited()
    } else if (g.dragged) {
      lastClick.current = null
      if (g.mode === "new") {
        const made = boxFromPoints(g.start, at(event).unit)
        // Under 8 px either way is a click, not a box.
        latest.current.onBox(made.width * size.current.width > MIN_BOX_PX && made.height * size.current.height > MIN_BOX_PX ? made : null)
      }
    } else if (g.mode === "new") {
      // The Mac's rule: one click outside the box takes it away, two take the whole sheet.
      const point = at(event).px
      const before = lastClick.current
      if (before && event.timeStamp - before.time < DOUBLE_MS && Math.hypot(point.x - before.x, point.y - before.y) < 8) {
        lastClick.current = null
        latest.current.onBox({ x: 0, y: 0, width: 1, height: 1 })
      } else {
        lastClick.current = { time: event.timeStamp, x: point.x, y: point.y }
        latest.current.onBox(null)
      }
    }
  }

  const erasing = settings.eraser
  return (
    <div className="tablet-host" ref={host} data-tablet="host"
         onPointerDown={(event) => { if (event.target === host.current) latest.current.onBox(null) }}>
      <div className="tablet" ref={wrap} tabIndex={0} data-tablet="surface" data-paper={paper.kind} data-paper-colour={paper.colour}
           style={{ cursor: erasing ? "cell" : "crosshair", left: fit.x, top: fit.y, width: fit.width, height: fit.height,
             backgroundColor: colourOfPaper(paper.colour).paper }}
           onPointerEnter={() => { hovered.current = true }}
           onPointerLeave={() => { hovered.current = false }}
           onPointerDown={(event: React.PointerEvent) => down(event.nativeEvent)}
           onPointerMove={(event: React.PointerEvent) => move(event.nativeEvent)}
           onPointerUp={(event: React.PointerEvent) => up(event.nativeEvent)}
           onPointerCancel={(event: React.PointerEvent) => up(event.nativeEvent)}
           onContextMenu={(event) => event.preventDefault()}>
        {/* The ink is first in the tree (what reads "the sheet's canvas" reads the ink); the paper sits under it by z-order. */}
        <canvas ref={canvas} className="ink" data-layer="ink" style={{ width: "100%", height: "100%" }} />
        <canvas ref={backdrop} className="paper" data-layer="paper" style={{ width: "100%", height: "100%" }} />
        {box && (
          <div className="box-clip">
            <div className="box" data-tablet="box" style={{
              left: `${box.x * 100}%`, top: `${box.y * 100}%`,
              width: `${box.width * 100}%`, height: `${box.height * 100}%`,
            }}>
              {HANDLES.map((name) => <span key={name} className="handle" data-handle={name} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
