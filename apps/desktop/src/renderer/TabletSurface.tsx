/**
 * The tablet as a source for the video pane: a sheet of paper in place of the
 * camera's picture. The pen (and the mouse) write on it live, with pressure;
 * what is written is `tabletPage.ts`'s strokes, taken into the note by the
 * same Writing / Page buttons the camera has (CameraPane.takeTablet).
 *
 * Built to feel like a pad. Pointer events arrive far faster than frames, so
 * every coalesced sample is kept (the stroke's real shape) and the canvas is
 * only touched once a frame, and then only for the segments that are NEW —
 * a long page is not repainted for each sample. The canvas is `desynchronized`
 * (the compositor skips a frame of latency) and sized in device pixels, so
 * hairlines are crisp on a high-DPI tablet screen.
 *
 * Palm rejection is the notes page's rule (`penNear`): a touch just after the
 * pen was near is a resting hand and is ignored.
 *
 * THE NATIVE PEN FEED (renderer/penFeed.ts) reaches this surface as ordinary pointer
 * events: it dispatches real `PointerEvent`s with `pointerType: "pen"` on the element
 * under the pen, so the handlers below are the only code path for the pen, the mouse
 * and the feed alike. (The overlay-era `remap` / `external` / `ring` props and the
 * `feed` handle are gone: the sheet is no longer drawn in a second window.)
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import type { Point, Rect, Size } from "@writemind/core"
import { pressAction } from "./penButtons"
import { penNear, penSettings, usePenSettings } from "./penSettings"
import { setTabletUndo } from "./tabletFocus"
import { useAreaFlash } from "./tabletArea"
import { fitRect, paintStrokes, SHEET_REF, strokeUnder, type InkStroke, type TabletPage } from "./tabletPage"

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
  /** The Box tool is on: a drag sets the dashed box instead of writing. */
  boxTool: boolean
  /** The dashed box, in FRACTIONS of the sheet. */
  box: Rect | null
  /** The box changed (fractions of the sheet); `done` is the lift, when the Box tool lets go. */
  onBox(rect: Rect | null, done?: boolean): void
  /** The page changed (a stroke, an erase, an undo): the buttons may need to update. */
  onEdited(): void
}

/** How near a stroke the eraser has to be, in points. */
const ERASE_RADIUS = 8

type Gesture =
  | { kind: "draw"; stroke: InkStroke; drawn: number; pen: boolean }
  | { kind: "erase"; marked: boolean }
  | { kind: "box"; from: Point }

export const TabletSurface = forwardRef<SurfaceHandle, Props>(function TabletSurface(
  { page, colour, width, boxTool, box, onBox, onEdited }, handle) {
  const host = useRef<HTMLDivElement | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const flash = useAreaFlash()
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const size = useRef<Size>({ width: 0, height: 0 })
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const everything = useRef(true)
  const settings = usePenSettings()
  const latest = useRef({ colour, width, boxTool, onBox, onEdited, page })
  latest.current = { colour, width, boxTool, onBox, onEdited, page }

  const toPixel = useCallback((point: Point): Point =>
    ({ x: point.x * size.current.width, y: point.y * size.current.height }), [])

  /** Pixels per reference unit: a stroke's width is kept in units of the sheet, not of the screen. */
  const unit = () => size.current.width / SHEET_REF

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
      paintStrokes(ctx, latest.current.page.strokes, toPixel, unit())
      // A stroke under the pen is repainted whole after a resize or an erase.
      if (g?.kind === "draw") {
        paintStrokes(ctx, [g.stroke], toPixel, unit())
        g.drawn = g.stroke.points.length
      }
      return
    }
    if (g?.kind === "draw" && g.stroke.points.length > g.drawn) {
      // Only the segments that are new since the last frame.
      paintStrokes(ctx, [g.stroke], toPixel, unit(), undefined, g.drawn)
      g.drawn = g.stroke.points.length
    }
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
      setFit(box)
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
    // zoom): the canvas is in device pixels, so it is measured again.
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

  const eraseAt = (g: Extract<Gesture, { kind: "erase" }>, unit: Point) => {
    const p = latest.current.page
    const index = strokeUnder(p.strokes, unit, size.current, ERASE_RADIUS, size.current.width / SHEET_REF)
    if (index < 0) return
    if (!g.marked) { p.mark(); g.marked = true }
    p.removeAt(index)
    schedule(true)
  }

  const boxFrom = (from: Point, to: Point): Rect => ({
    x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y),
  })

  const down = (event: PointerEvent) => {
    if (event.pointerType === "touch" && penNear()) { event.preventDefault(); return }
    const pen = event.pointerType === "pen"
    if (!pen && event.button !== 0) return
    event.preventDefault()
    wrap.current?.focus({ preventScroll: true })
    // Keep the stroke when the pen strays past the edge (a synthetic event has no pointer to capture: the feed keeps the target itself).
    try { wrap.current?.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
    let action = pressAction(event, penSettings())
    if (action === "draw" && latest.current.boxTool) action = "select"
    const { unit } = at(event)
    if (action === "erase") {
      const g: Gesture = { kind: "erase", marked: false }
      gesture.current = g
      eraseAt(g, unit)
    } else if (action === "select") {
      gesture.current = { kind: "box", from: unit }
      latest.current.onBox({ x: unit.x, y: unit.y, width: 0, height: 0 })
    } else {
      const pressure = event.pressure > 0 ? event.pressure : 0.5
      gesture.current = {
        kind: "draw", drawn: 0, pen,
        stroke: {
          colorHex: latest.current.colour,
          width: latest.current.width * SHEET_REF / Math.max(1, size.current.width),
          points: [unit],
          ...(pen && penSettings().pressure ? { pressures: [pressure] } : {}),
        },
      }
      schedule()
    }
  }

  const move = (event: PointerEvent) => {
    const g = gesture.current
    if (!g) return
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
      latest.current.onBox(boxFrom(g.from, at(event).unit))
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
    } else {
      const made = boxFrom(g.from, at(event).unit)
      // Under 8 px either way is a tap, not a box.
      latest.current.onBox(made.width * size.current.width > 8 && made.height * size.current.height > 8 ? made : null, true)
    }
  }

  const erasing = settings.eraser
  return (
    <div className="tablet-host" ref={host} data-tablet="host">
      <div className="tablet" ref={wrap} tabIndex={0} data-tablet="surface"
           style={{ cursor: erasing ? "cell" : "crosshair", left: fit.x, top: fit.y, width: fit.width, height: fit.height }}
           onPointerEnter={() => { hovered.current = true }}
           onPointerLeave={() => { hovered.current = false }}
           onPointerDown={(event: React.PointerEvent) => down(event.nativeEvent)}
           onPointerMove={(event: React.PointerEvent) => move(event.nativeEvent)}
           onPointerUp={(event: React.PointerEvent) => up(event.nativeEvent)}
           onPointerCancel={(event: React.PointerEvent) => up(event.nativeEvent)}
           onContextMenu={(event) => event.preventDefault()}>
        <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
        {box && (
          <div className="box" style={{
            left: `${box.x * 100}%`, top: `${box.y * 100}%`,
            width: `${box.width * 100}%`, height: `${box.height * 100}%`,
          }} />
        )}
        {flash && (
          <div className="area-frame" data-tablet="area-frame">
            <span className="corner tl">1 · click here</span>
            <span className="corner br">2 · then here</span>
          </div>
        )}
      </div>
    </div>
  )
})
