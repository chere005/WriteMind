/**
 * The drawing layer: one canvas over the notebook, and the handles round
 * what is picked up.
 *
 * NOTHING HERE MOVES THE TEXT. Objects float over the words and scroll with
 * them: they are in the DOCUMENT, so everything is drawn `scrollOffset`
 * higher and every incoming point goes back through `doc()` before the
 * model sees it.
 *
 * THE PANE HAS ONE MODE AND THERE ARE TWO OF THEM — cursor and pen — and ⌘
 * is the selector in both (`CanvasMode.press` on the Mac; `pressKind` here).
 * With the pen up the layer takes only the clicks that land ON an object and
 * every other one reaches the notebook, which is what `pointer-events` and
 * the hit test below arrange between them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  applyMatrix, matrixOf, angleAbout, attachableAt, baseBounds, baseCenter, basePoints, bounds, boundsOf, connectorPaths,
  copiedItems, cornerRadius, cropRect, cropped, dashPattern, distance, emptyDrawing, hitTest, idsTouching,
  isClosed, isNode, isRouted, nudged, pressureScale, placedCenter, reconnect, reordered, restyled,
  segmentMidpoints, shifted, strokeCurve, TEXT_BOX, textBoxAspect, textBoxHeight, readableInk,
  indexAt, isHidden, itemId, itemTransform, newID, noTransform, placedItem, polylines, rectFrom,
  removing, route, scaleFactor, stillPicked, strokesSwept, toggle, toggled, transformed, whole, withTransform,
  type CanvasItem, type ConnectorItem, type Drawing, type ItemTransform, type Order, type Placement,
  type Measure, type Point, type Rect, type ShapeKind, type Size, type StylePatch,
} from "@writemind/core"
import type { DrawingHistory } from "./drawingHistory"
import { StyleBar } from "./StyleBar"
import { penSettings, usePenSettings } from "./penSettings"
import { resolvePress, slotOf } from "./penButtons"
import { registerPenHandlers } from "./penActions"
import { layerKey } from "./layerKeys"

export type CanvasMode = "cursor" | "pen"

/** What a press does, once the one-gesture tools have had their say. */
export function pressKind(mode: CanvasMode, command: boolean): "marquee" | "draw" | "objects" {
  // ⌘ IS THE SELECTOR, IN BOTH MODES, and it is asked BEFORE the mode: a
  // modifier held down is asked for by hand, and that is what overrides a
  // mode. Under the pen a ⌘-drag used to draw a stroke over the thing it
  // was meant to be picking up.
  if (command) return "marquee"
  return mode === "pen" ? "draw" : "objects"
}

interface Props {
  drawing: Drawing
  onChange(drawing: Drawing): void
  mode: CanvasMode
  colorHex: string
  penWidth: number
  placing: Placement | null
  onPlaced(): void
  /** The scroller the objects follow, so they stay beside the words. */
  scroller: HTMLElement | null
  onSelectionChanged?(count: number): void
  /**
   * Reading the words out of a picture — macOS only, so the handle is
   * there only when the platform says it can, and nothing anywhere says
   * what the other one cannot do.
   */
  onReadPicture?(file: string, id: string): void
  /** The app's undo for the drawing: shared, so a paste or a capture can be taken back too. */
  history: DrawingHistory
}

// `base` is the drawing as it was when the gesture began. A move is worked
// out FROM IT on every frame (never from the last frame's result), because
// `reconnect` bakes a connector's transform into its points: re-applying the
// gesture to an already-baked drawing would move it twice.
type Gesture =
  | { kind: "drawing"; points: Point[]; pressures: number[] | null }
  | { kind: "erasing"; before: Drawing; last: Point }
  | { kind: "moving"; from: Point; snapshot: Map<string, ItemTransform>; base: Drawing }
  | { kind: "marquee"; from: Point; to: Point; additive: boolean }
  | { kind: "placing"; from: Point; to: Point }
  /** An arrow being drawn from one thing to another (the arrow tool, or ⌥ from a node). */
  | { kind: "connecting"; from: Point; to: Point; node: string | null }
  | { kind: "scaling"; from: Point; pivot: Point; snapshot: Map<string, ItemTransform>; base: Drawing }
  | { kind: "rotating"; from: number; pivot: Point; snapshot: Map<string, ItemTransform>; base: Drawing }
  | { kind: "segment"; id: string; index: number; vertical: boolean; base: Drawing }
  | { kind: "cropping"; corner: number }

/** A picture being cropped: the kept part, as fractions of the picture. */
interface Crop { id: string; rect: Rect }

/** A node's label being typed. */
interface Labelling { id: string; text: string }

const HANDLE = 11

/** The loaded picture for a file, if it has loaded (the crop reads its pixels). */
export const loadedPicture = (file: string): HTMLImageElement | null => {
  const held = pictures.get(file)
  return held && held.complete && held.naturalWidth > 0 ? held : null
}

// MARK: - Text boxes
//
// A text box is typed into exactly where it is drawn, so the painter and the
// editor wrap the words the same way: by the words, at the same width, in the
// same font. (The editor is a <textarea> set to `pre-wrap` and `break-word`.)

const TEXT_FONT = `${TEXT_BOX.fontSize}px -apple-system, "Segoe UI", system-ui, sans-serif`
let ruler: CanvasRenderingContext2D | null = null

/** The lines `text` wraps to in `room` points: a greedy wrap that breaks a word only when it cannot fit. */
export function wrapLines(text: string, room: number, context?: CanvasRenderingContext2D,
  font: string = TEXT_FONT): string[] {
  const ctx = context ?? (ruler ??= document.createElement("canvas").getContext("2d")!)
  ctx.font = font
  const width = (word: string) => ctx.measureText(word).width
  const out: string[] = []
  for (const paragraph of text.split(String.fromCharCode(10))) {
    let line = ""
    for (const word of paragraph.split(/(?<= )/)) {
      if (line === "" || width((line + word).trimEnd()) <= room) { line += word; continue }
      out.push(line.trimEnd())
      line = word
    }
    // A single word wider than the box is cut where it overflows.
    while (width(line.trimEnd()) > room && line.length > 1) {
      let cut = line.length - 1
      while (cut > 1 && width(line.slice(0, cut)) > room) cut--
      out.push(line.slice(0, cut))
      line = line.slice(cut)
    }
    out.push(line.trimEnd())
  }
  return out
}

/** How tall the words are at a width: the line count times the line height. */
export const measureTextBox: Measure = (text, room) => wrapLines(text, room).length * TEXT_BOX.lineHeight

/**
 * The pictures, loaded once each and kept — a note with six captures in it
 * would otherwise decode all six on every repaint. They are served over the
 * app's own `wm://media/` scheme by the main process rather than read into
 * the page as base64.
 */
const pictures = new Map<string, HTMLImageElement>()

function picture(file: string, onLoad: () => void): HTMLImageElement | null {
  const held = pictures.get(file)
  if (held) return held.complete && held.naturalWidth > 0 ? held : null
  const image = new Image()
  // Anonymous CORS, so the pixels can be read back (cropping a picture).
  image.crossOrigin = "anonymous"
  image.onload = onLoad
  image.onerror = () => {
    // A picture that will not load is a picture the note has lost track
    // of, and saying nothing is how that goes unnoticed for weeks.
    console.error(`WriteMind: could not load ${image.src}`)
    window.dispatchEvent(new ErrorEvent("error", {
      message: `could not load the picture ${file}`,
    }))
  }
  image.src = `wm://media/${encodeURIComponent(file)}`
  pictures.set(file, image)
  return null
}

// MARK: - Copying objects between notes
//
// What is copied is held here (the copies are whole items, with their own ids
// already) and a line of text with a token in it goes on the system clipboard.
// A paste that finds ITS token on the clipboard puts the objects back; any
// other paste is the notebook's. Pictures are files in one media folder shared
// by every note, so they come across by name.

interface ObjectClip { token: string; items: CanvasItem[]; pastes: number }
let objectClipboard: ObjectClip | null = null

function copyObjects(items: CanvasItem[], ids: Set<string>): void {
  const copied = copiedItems(items, ids)
  if (copied.length === 0) return
  const token = newID().slice(0, 8)
  objectClipboard = { token, items: copied, pastes: 0 }
  const text = `WriteMind objects [${token}]`
  // The page's own copy command, with the text put on it: the app's permission
  // handler does not grant the async clipboard API, and this needs no grant.
  let wrote = false
  const put = (event: ClipboardEvent) => { event.clipboardData?.setData("text/plain", text); event.preventDefault(); wrote = true }
  document.addEventListener("copy", put, true)
  try { document.execCommand("copy") } catch { /* fall through to the API */ }
  document.removeEventListener("copy", put, true)
  if (!wrote) void navigator.clipboard?.writeText(text).catch(() => {})
}

export function Canvas({
  drawing, onChange, mode, colorHex, penWidth, placing, onPlaced, scroller, onSelectionChanged,
  onReadPicture, history,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const overlay = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  // The scroll, for the handles' DOM positions only. The canvas itself is
  // painted from `scrollRef`, which moves without rendering this component.
  const [scroll, setScroll] = useState(0)
  const scrollRef = useRef(0)
  const scrollShown = useRef(0)
  // WHAT IS PICKED is whatever of the pick is still on the layer and drawn. The raw ids are kept in state
  // (they are set by a click, a marquee, a paste); an id whose object was undone away, deleted, erased or put
  // away (a picture read into words) is dropped from them at once, so a pick nobody can see is no pick: it
  // used to keep the arrows, Ctrl+C / Ctrl+X and Backspace swallowed with no handles on screen.
  const [pickedIds, setSelection] = useState<Set<string>>(new Set())
  const selection = useMemo(() => stillPicked(drawing, pickedIds), [drawing, pickedIds])
  useEffect(() => { if (selection !== pickedIds) setSelection(selection) }, [selection, pickedIds])
  const [gesture, setGesture] = useState<Gesture | null>(null)
  /** The pointer that began the gesture: moves and lifts from any other (a palm, a stray mouse) are not its. */
  const owner = useRef<number | null>(null)
  /** The gesture as it is NOW: moved on every pointer event without a render. */
  const live = useRef<Gesture | null>(null)
  const [command, setCommand] = useState(false)
  const tools = usePenSettings()
  const eraserOn = tools.eraser
  const selectOn = tools.selectTool
  const [cropState, setCrop] = useState<Crop | null>(null)
  // A crop box is open only on a picture that is still there and shown (an Undo, a read-into-words or
  // another note takes the picture away; the box must go with it, not keep the arrows and Esc).
  const crop = cropState && drawing.items.some((item) =>
    item.kind === "image" && !item.image.hidden && item.image.id === cropState.id) ? cropState : null
  useEffect(() => { if (cropState && !crop) setCrop(null) }, [cropState, crop])
  const [labelling, setLabelling] = useState<Labelling | null>(null)
  /** The text box being typed into: the painter leaves its words to the field over it. */
  const editingBox = useRef<string | null>(null)
  const lastPress = useRef<{ at: number; id: string } | null>(null)
  /** A text box's editing counts as ONE undo: whether this session has taken its snapshot. */
  const openBox = useRef(false)
  /** The style bar (colour, width, fill, heads, order) is up under the selection. */
  const [styling, setStyling] = useState(false)
  /** Enter on an open crop box: set up below, where the crop is. */
  const confirmCrop = useRef<() => void>(() => {})

  const box = useMemo(() => boundsOf(drawing, selection, size), [drawing, selection, size])

  const latest = useRef({
    drawing, selection, gesture, placing, mode, size, colorHex, penWidth, onChange, onPlaced, box,
    crop, styling,
  })
  latest.current = {
    ...latest.current,
    drawing, selection, gesture, placing, mode, size, colorHex, penWidth, onChange, onPlaced, box,
    crop, styling,
  }

  /**
   * EVERY change to the drawing goes through here, and a drawing that has
   * been changed has its lines put back on their nodes: a node moved,
   * scaled, turned, resized or deleted takes its arrows with it.
   */
  const publish = useCallback((next: Drawing) => {
    latest.current.onChange(reconnect(next, latest.current.size))
  }, [])

  // The same for a drawing that changed UNDER us — a capture added chart
  // nodes, a note was opened, the pane was resized: the lines are put back
  // on their nodes. `reconnect` hands back the same object when nothing
  // moved, so this settles; the counter is a belt for the day it does not.
  const settling = useRef(0)
  useEffect(() => {
    const next = reconnect(drawing, size)
    if (next === drawing) { settling.current = 0; return }
    if (++settling.current > 4) return
    onChange(next)
  }, [drawing, size, onChange])

  useEffect(() => { onSelectionChanged?.(selection.size) }, [selection, onSelectionChanged])
  useEffect(() => { if (selection.size === 0) setStyling(false) }, [selection])

  // Objects the app has just put on the layer (a pasted or dropped picture, a
  // capture) arrive picked up, with the handles on them, as a shape does.
  useEffect(() => {
    const ids = history.takeSelection((id) => drawing.items.some((item) => itemId(item) === id))
    if (ids) setSelection(whole(new Set(ids), drawing.items))
  }, [drawing, history])

  // MARK: - Painting
  //
  // TWO CANVASES. The base one holds everything that is committed (and the
  // marquee, the ghost and the selection box); the overlay holds only the
  // stroke under the pen, drawn a few segments at a time. A pen move used to
  // clear and repaint every object on the page and reset the canvas's size.
  // Now it is a few lines on an otherwise idle surface, once a frame.

  const baseDirty = useRef(true)
  const overlayDrawn = useRef(0)
  const overlayReset = useRef(true)
  /** The overlay holds a rubber band (marquee, ghost, arrow preview) that must be cleared. */
  const overlayShapes = useRef(false)
  const frame = useRef<number | null>(null)
  const renderRef = useRef<() => void>(() => {})

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(() => renderRef.current())
  }, [])

  renderRef.current = () => {
    frame.current = null
    const now = latest.current
    const element = canvas.current
    const top = overlay.current
    if (!element || !top || now.size.width === 0) return
    const ratio = window.devicePixelRatio || 1
    const w = Math.floor(now.size.width * ratio)
    const h = Math.floor(now.size.height * ratio)
    const scrolled = scrollRef.current
    // Setting a canvas's size clears it AND reallocates its backing store:
    // only when it really changed.
    if (element.width !== w || element.height !== h) {
      element.width = w; element.height = h; baseDirty.current = true
    }
    if (top.width !== w || top.height !== h) {
      top.width = w; top.height = h; overlayReset.current = true
    }

    if (baseDirty.current) {
      baseDirty.current = false
      const context = element.getContext("2d")!
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, element.width, element.height)
      context.setTransform(ratio, 0, 0, ratio, 0, -scrolled * ratio)
      const view = { top: scrolled - 40, bottom: scrolled + now.size.height + 40 }
      for (const item of now.drawing.items) {
        if (isHidden(item)) continue
        // Objects wholly off the screen are not painted at all.
        const where = bounds(item, now.size)
        if (where.y + where.height < view.top || where.y > view.bottom) continue
        paint(context, item, now.size, () => { baseDirty.current = true; schedule() },
          editingBox.current)
      }
      if (now.box) {
        context.strokeStyle = "rgba(109,169,240,0.9)"
        context.lineWidth = 1
        context.setLineDash([5, 3])
        context.strokeRect(now.box.x - 3, now.box.y - 3, now.box.width + 6, now.box.height + 6)
        context.setLineDash([])
      }
    }

    const g = live.current
    const context = top.getContext("2d", { desynchronized: true })!
    if (g?.kind === "drawing" && g.points.length > 0) {
      if (overlayReset.current) {
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, top.width, top.height)
        overlayDrawn.current = 0
        overlayReset.current = false
      }
      context.setTransform(ratio, 0, 0, ratio, 0, -scrolled * ratio)
      if (g.pressures) {
        // A pen stroke is drawn as it is committed: a smooth line of varying width, piece by piece.
        // `overlayDrawn` counts the pieces already down.
        const pts = g.points, w = now.size.width, h = now.size.height
        overlayDrawn.current = strokePressure(context, pts.length, (i) => ({ x: pts[i]!.x * w, y: pts[i]!.y * h }),
          g.pressures, now.penWidth, overlayDrawn.current, false)
      }
      // Only the segments that are new, from the last point already drawn.
      const from = Math.max(overlayDrawn.current - 1, 0)
      if (!g.pressures && g.points.length > from) {
        paint(context, {
          kind: "stroke",
          stroke: {
            id: "live", colorHex: now.colorHex, width: now.penWidth,
            points: from === 0 ? g.points : g.points.slice(from),
            transform: noTransform(), group: null,
          },
        }, now.size)
        overlayDrawn.current = g.points.length
      }
    } else if (g && (g.kind === "marquee" || g.kind === "connecting" || (g.kind === "placing" && now.placing))) {
      // What is being dragged out is painted on the overlay, from scratch each frame: the
      // base layer (every object on the page) is not repainted for a rubber band.
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, top.width, top.height)
      context.setTransform(ratio, 0, 0, ratio, 0, -scrolled * ratio)
      if (g.kind === "marquee") {
        const rect = rectFrom(g.from, g.to)
        context.strokeStyle = "rgba(109,169,240,0.9)"
        context.fillStyle = "rgba(109,169,240,0.12)"
        context.lineWidth = 1
        context.setLineDash([4, 3])
        context.fillRect(rect.x, rect.y, rect.width, rect.height)
        context.strokeRect(rect.x, rect.y, rect.width, rect.height)
        context.setLineDash([])
      } else if (g.kind === "connecting") {
        // The line being drawn from here to wherever it is let go (the Mac's dashed preview).
        context.strokeStyle = now.colorHex
        context.lineWidth = Math.min(Math.max(now.penWidth, 1.5), 6)
        context.lineCap = "butt"
        context.setLineDash([6, 4])
        context.beginPath()
        context.moveTo(g.from.x, g.from.y)
        context.lineTo(g.to.x, g.to.y)
        context.stroke()
        context.setLineDash([])
      } else if (g.kind === "placing" && now.placing) {
        const ghost = placedItem(now.placing, g.from, g.to, now.size, now.colorHex, now.penWidth)
        if (ghost) {
          context.globalAlpha = 0.5
          paint(context, ghost, now.size)
          context.globalAlpha = 1
        }
      }
      overlayDrawn.current = 0
      overlayReset.current = false
      overlayShapes.current = true
    } else if (overlayDrawn.current > 0 || overlayReset.current || overlayShapes.current) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, top.width, top.height)
      overlayDrawn.current = 0
      overlayReset.current = false
      overlayShapes.current = false
    }

    // The handles are DOM, and sit where the scroll puts them.
    if (now.selection.size > 0 && scrollShown.current !== scrolled) {
      scrollShown.current = scrolled
      setScroll(scrolled)
    }
  }

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])

  // The pane's pixel density changes without its size changing — the window
  // dragged to another display, or the display's scale set to 150% — and the
  // canvas has to be given the new backing store and repainted. A media-query
  // listener is the textbook way and is unreliable across such changes in
  // Chromium (it stops firing once re-armed), so the density is simply looked
  // at a few times a second: it costs one property read.
  useEffect(() => {
    let seen = window.devicePixelRatio
    const timer = window.setInterval(() => {
      if (window.devicePixelRatio === seen) return
      seen = window.devicePixelRatio
      baseDirty.current = true
      overlayReset.current = true
      schedule()
    }, 300)
    return () => window.clearInterval(timer)
  }, [schedule])

  // Everything that changes what is COMMITTED repaints the base layer.
  useEffect(() => {
    baseDirty.current = true
    schedule()
  }, [drawing, size, selection, box, placing, gesture?.kind, schedule])

  // The pane's size and the scroll, watched rather than asked for: both
  // move without a re-render of ours.
  useEffect(() => {
    if (!host.current) return
    let alive = true
    const measure = () => {
      // React lets go of the ref when the canvas is taken out (closing the last tab), a moment BEFORE this
      // effect's cleanup runs, and the observer can answer in between: "Cannot read properties of null
      // (reading 'getBoundingClientRect')" on the first close after a launch, once in two.
      const element = host.current
      if (!alive || !element) return
      const rect = element.getBoundingClientRect()
      setSize((was) => was.width === rect.width && was.height === rect.height
        ? was : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host.current)
    return () => { alive = false; observer.disconnect() }
  }, [])

  useEffect(() => {
    if (!scroller) return
    const onScroll = () => {
      scrollRef.current = scroller.scrollTop
      baseDirty.current = true
      overlayReset.current = true
      schedule()
    }
    onScroll()
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [scroller, schedule])

  // The wheel (and a touchpad's two-finger scroll) over the layer: while the pen is down the
  // layer takes every pointer event, and the page is not inside it, so a wheel turned over it
  // scrolled nothing. It is handed to the page's scroller here.
  useEffect(() => {
    const element = host.current
    if (!element || !scroller) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? scroller.clientHeight : 1
      event.preventDefault()
      scroller.scrollBy({ top: event.deltaY * unit, left: event.deltaX * unit })
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [scroller])

  // ⌘ has to be WATCHED, not asked for: the marquee can start anywhere, so
  // the layer has to be ready to take a click over plain text the moment
  // the key goes down, and to stop when it comes up.
  useEffect(() => {
    const flags = (event: KeyboardEvent) => setCommand(event.metaKey || event.ctrlKey)
    window.addEventListener("keydown", flags)
    window.addEventListener("keyup", flags)
    // Alt-Tab with Ctrl down never sends the keyup: without this the layer
    // stays armed as a marquee and covers the page until Ctrl is pressed again.
    const release = () => setCommand(false)
    window.addEventListener("blur", release)
    return () => {
      window.removeEventListener("keydown", flags)
      window.removeEventListener("keyup", flags)
      window.removeEventListener("blur", release)
    }
  }, [])

  const doc = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = host.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top + scrollRef.current }
  }, [])

  const change = useCallback((next: Drawing) => {
    history.record(latest.current.drawing)
    publish(next)
  }, [history, publish])

  /** An edit that arrives in bursts (a colour dragged, an arrow key held): one undo for the burst (`DrawingHistory.recordBurst`). */
  const burst = useCallback((next: Drawing) => {
    const held = latest.current.drawing
    if (next === held) return
    history.recordBurst(held, performance.now())
    publish(next)
  }, [history, publish])

  const applyStyle = useCallback((patch: StylePatch) => {
    burst(restyled(latest.current.drawing, latest.current.selection, patch))
  }, [burst])

  const orderSelection = useCallback((how: Order) => {
    const held = latest.current.drawing
    const items = reordered(held.items, latest.current.selection, how)
    if (items !== held.items) change({ items })
  }, [change])

  /** A copy of what is picked, a little way down and to the right, picked in turn. */
  const duplicate = useCallback(() => {
    const { drawing: held, selection: picked, size: now } = latest.current
    const copies = shifted(copiedItems(held.items, picked), 16, 16, now)
    if (copies.length === 0) return
    change({ items: [...held.items, ...copies] })
    setSelection(new Set(copies.map(itemId)))
  }, [change])

  /** A gesture begins: it is state once, and a ref from then on. `pointerId` is the pointer that owns it. */
  const start = useCallback((next: Gesture, pointerId: number) => {
    live.current = next
    owner.current = pointerId
    overlayReset.current = true
    setGesture(next)
  }, [])

  // MARK: - The gestures

  /** Rub out the topmost stroke under `point`; the move is one undo, at the lift. */
  const eraseAt = useCallback((point: Point) => {
    const held = latest.current.drawing
    const size = latest.current.size
    for (let index = held.items.length - 1; index >= 0; index--) {
      const item = held.items[index]!
      if (item.kind !== "stroke" || isHidden(item) || !hitTest(item, point, size)) continue
      const next = removing(held, new Set([itemId(item)]))
      latest.current = { ...latest.current, drawing: next }
      latest.current.onChange(next)
      return
    }
  }, [])

  /**
   * Rub out every stroke the eraser passes over in going from `from` to `to`. The strokes between two
   * samples count: a quick sweep reports a point every 20 to 30 points, and testing the points alone let the
   * eraser step over the strokes between them.
   */
  const eraseAlong = useCallback((from: Point, to: Point) => {
    const held = latest.current.drawing
    const ids = strokesSwept(held, from, to, latest.current.size)
    if (ids.size === 0) return
    const next = removing(held, ids)
    latest.current = { ...latest.current, drawing: next }
    latest.current.onChange(next)
  }, [])

  /** Put a node's label in (an empty one is no label); the edit is one undo. */
  const relabel = useCallback((id: string, text: string) => {
    const held = latest.current.drawing
    const next = {
      items: held.items.map((item) =>
        item.kind === "shape" && item.shape.id === id
          ? { kind: "shape" as const, shape: { ...item.shape, label: text } }
          : item),
    }
    if (JSON.stringify(next) !== JSON.stringify(held)) change(next)
  }, [change])

  // The pen, and the hand holding it. A tablet laptop sends both: the pen draws,
  // and a finger or a resting palm must NOT (it used to leave dots and
  // streaks across the page). While the pen has been near in the last moment a
  // touch is a palm and is ignored; otherwise, with the pen down, a finger
  // scrolls the page, which is what a finger on a page is for.
  const penSeenAt = useRef(0)
  useEffect(() => {
    const element = host.current?.parentElement
    if (!element) return
    let away: number | null = null
    const seen = (event: PointerEvent) => {
      if (event.pointerType === "pen") {
        penSeenAt.current = performance.now()
        // And once the pen has been out of range for a moment, a finger scrolls again.
        if (away !== null) window.clearTimeout(away)
        away = window.setTimeout(() => { element.style.touchAction = "" }, 1500)
        // The pen must not pan the page when it drags over the words; a
        // finger must still be able to. touch-action is read at the press,
        // and a pen hovers before it touches, so this is in place in time.
        if (element.style.touchAction !== "none") element.style.touchAction = "none"
      } else if (event.pointerType === "touch" && element.style.touchAction !== ""
        && performance.now() - penSeenAt.current > 1500) {
        element.style.touchAction = ""
      }
    }
    window.addEventListener("pointermove", seen, true)
    window.addEventListener("pointerdown", seen, true)
    return () => {
      window.removeEventListener("pointermove", seen, true)
      window.removeEventListener("pointerdown", seen, true)
      if (away !== null) window.clearTimeout(away)
      element.style.touchAction = ""
    }
  }, [])

  const scrollWithFinger = useCallback((event: PointerEvent) => {
    if (!scroller) return
    let last = event.clientY
    let lastX: number | null = event.pointerType === "pen" ? event.clientX : null
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      // A pen panning with a side button: letting the button go ends it.
      if (e.pointerType === "pen" && e.buttons === 0) { up(e); return }
      scroller.scrollTop -= e.clientY - last
      lastX !== null && (scroller.scrollLeft -= e.clientX - lastX)
      last = e.clientY
      lastX = e.clientX
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }, [scroller])

  const begin = useCallback((event: PointerEvent) => {
    const pen = event.pointerType === "pen"
    const size = latest.current.size
    if (event.pointerType === "touch") {
      if (performance.now() - penSeenAt.current < 1200) {
        // A palm beside the pen.
        event.preventDefault(); event.stopPropagation()
        return
      }
      if (latest.current.mode === "pen" && !latest.current.placing) {
        // The pen is down: a finger turns the page rather than drawing on it.
        event.preventDefault(); event.stopPropagation()
        scrollWithFinger(event)
        return
      }
    }
    // Erasing: the pen's eraser end (button 5, buttons bit 32), the pen's side
    // button when it is set to erase (for a pen with no eraser end), or the
    // Erase tool on the toolbar. It rubs out whole strokes in either mode,
    // whatever the pen is set to (penButtons.ts decides, for both surfaces).
    const press = resolvePress(event, penSettings())
    // A pen button with a TAP action (or none) is not a gesture: the runtime
    // in penActions.ts fires it on the release. Nothing here starts.
    if (press.kind === "tap" || press.kind === "ignore") {
      if (pen) { event.preventDefault(); event.stopPropagation() }
      return
    }
    if (press.kind === "erase" && (pen || event.button === 0)
      && !(event.target instanceof Element
        && event.target.closest(".wm-handle, .wm-style-bar, .wm-label-edit, .wm-textbox-edit, .wm-gutter"))) {
      event.preventDefault(); event.stopPropagation()
      const held = latest.current.drawing
      capture(event)
      const where = doc(event)
      start({ kind: "erasing", before: held, last: where }, event.pointerId)
      eraseAt(where)
      return
    }
    // A pen button is a way of asking for a gesture by hand, as ⌘ is: it is
    // asked BEFORE the mode (the lower one selects, the upper one pans, ...).
    const byButton = pen && slotOf(event) !== null
    if (event.button !== 0 && !byButton) return
    // THE HANDLES ARE NOT THE PAGE. This listener is on the PARENT and in
    // the capture phase, so it hears a press on a handle BEFORE the
    // handle does — and a press beside the picture hits nothing, clears
    // the selection, and unmounts the very button that was being pressed.
    // Every handle's own press then never ran at all.
    if (event.target instanceof Element
      && event.target.closest(".wm-handle, .wm-style-bar, .wm-label-edit, .wm-textbox-edit, .wm-crop")) return
    // PAN: the pen's hand button turns the page, as a finger does.
    if (press.kind === "pan") {
      event.preventDefault(); event.stopPropagation()
      scrollWithFinger(event)
      return
    }
    // A label or a text box being typed into ends the moment the page is pressed
    // elsewhere. Cancelling this pointerdown (below) would also cancel the focus
    // change that normally does it, so it is done by hand.
    const typing = document.activeElement
    if (typing instanceof HTMLElement && typing.closest(".wm-label-edit, .wm-textbox-edit")) typing.blur()
    // THE BRACKETS ARE NOT THE PAGE EITHER. ⌘/Ctrl is the marquee here, and
    // cancelling its pointerdown cancels the mousedown behind it, so a
    // Ctrl-click on a bracket (to add a cell to the selection) never arrived.
    if (event.target instanceof Element && event.target.closest(".wm-gutter")) return
    const point = doc(event)
    const { drawing: held, placing: armed, mode: now } = latest.current

    // The arrow tool, or ⌥ held down on a node: a line is drawn from here to
    // wherever it is let go, and each end that lands on a node is attached
    // to it. ⌥ has to start ON a node, so it never steals a stroke or a pick.
    const toolArmed = armed?.kind === "line" && armed.tool === true
    // (Not when Alt is the pen's own "Tip + Alt" button: that has its own meaning.)
    const fromNode = toolArmed || (!armed && event.altKey && !byButton) ? attachableAt(held, point, size) : null
    if (toolArmed || (!armed && fromNode !== null)) {
      event.preventDefault(); event.stopPropagation()
      capture(event)
      start({ kind: "connecting", from: point, to: point, node: fromNode }, event.pointerId)
      return
    }
    // Something is armed: this gesture is where it goes.
    if (armed) {
      event.preventDefault(); event.stopPropagation()
      start({ kind: "placing", from: point, to: point }, event.pointerId)
      return
    }

    // A tablet pen writes whatever the mode is (the mouse keeps selecting)
    // unless the person turned that off.
    const mode = pen && penSettings().penDraws ? "pen" : now
    // The Select tool: a press on an object picks it up and moves it, a press
    // on nothing pulls a rectangle — the cursor mode, plus a marquee, with no key.
    const byHand = press.kind === "select" && !press.tool
    const extend = (press.kind === "select" && press.additive) || event.shiftKey
    const kind = press.kind === "select" && press.tool
      ? (indexAt(held, point, size) === null ? "marquee" : "objects")
      : pressKind(mode, byHand)
    if (kind === "draw") {
      event.preventDefault(); event.stopPropagation()
      capture(event)
      start({
        kind: "drawing", points: [normalise(point, size)],
        pressures: pen && penSettings().pressure ? [pressureOf(event)] : null,
      }, event.pointerId)
      return
    }
    if (kind === "marquee") {
      event.preventDefault(); event.stopPropagation()
      if (!extend) setSelection(new Set())
      start({ kind: "marquee", from: point, to: point, additive: extend }, event.pointerId)
      return
    }

    // The pen is up: the layer takes ONLY the clicks that land on an
    // object, and every other one goes through to the notebook.
    const index = indexAt(held, point, size)
    if (index === null) {
      if (latest.current.selection.size > 0) setSelection(new Set())
      return
    }
    event.preventDefault(); event.stopPropagation()
    const id = itemId(held.items[index]!)
    // A second press on the same node within the double-click time opens its
    // label for typing. It is read here rather than from `dblclick`, which a
    // cancelled pointerdown does not reliably deliver.
    const pressed = held.items[index]!
    const earlier = lastPress.current
    lastPress.current = { at: performance.now(), id }
    if (earlier && earlier.id === id && performance.now() - earlier.at < 450
      && pressed.kind === "shape" && isNode(pressed.shape.kind)) {
      lastPress.current = null
      setSelection(new Set([id]))
      openBox.current = false
      setLabelling({ id, text: pressed.shape.label })
      return
    }
    const picked = event.shiftKey
      ? new Set([...latest.current.selection, ...whole(new Set([id]), held.items)])
      : (latest.current.selection.has(id)
        ? latest.current.selection
        : whole(new Set([id]), held.items))
    setSelection(picked)
    start({ kind: "moving", from: point, snapshot: snapshotOf(held, picked), base: held }, event.pointerId)
  }, [doc, eraseAt, start, scrollWithFinger])

  useEffect(() => {
    // THE LISTENER GOES ON THE PARENT, not on the layer. With the pen up
    // the layer is `pointer-events: none` so that every click reaches the
    // notebook — and an element that is not a hit target is not in the
    // event's path at all, capture phase included, so a listener on it
    // would never hear the press that lands on an object. The parent
    // hears them all and this takes back only the ones that are ours.
    const element = host.current?.parentElement ?? host.current
    if (!element) return
    const down = (event: PointerEvent) => begin(event)
    element.addEventListener("pointerdown", down, true)
    // A side button pressed while the pen hovers is a pointerdown on most
    // builds; where it is only a pointermove that gains a button bit, it
    // starts the gesture all the same (once: `pressed` is the guard).
    let pressed = false
    const noted = (event: PointerEvent) => { if (event.pointerType === "pen") pressed = true }
    const lifted = (event: PointerEvent) => { if (event.pointerType === "pen") pressed = false }
    const late = (event: PointerEvent) => {
      if (event.pointerType !== "pen" || pressed || live.current) return
      const slot = slotOf(event)
      if (slot === null || slot === "tipAlt") return
      pressed = true
      begin(event)
    }
    window.addEventListener("pointerdown", noted, true)
    window.addEventListener("pointerup", lifted, true)
    window.addEventListener("pointercancel", lifted, true)
    element.addEventListener("pointermove", late, true)
    return () => {
      element.removeEventListener("pointerdown", down, true)
      window.removeEventListener("pointerdown", noted, true)
      window.removeEventListener("pointerup", lifted, true)
      window.removeEventListener("pointercancel", lifted, true)
      element.removeEventListener("pointermove", late, true)
    }
  }, [begin])

  useEffect(() => {
    if (!gesture) return
    /** A move of the objects waits for the frame: one per frame, not one per sample. */
    let pending: (() => void) | null = null
    let moveFrame: number | null = null
    const flush = () => {
      if (moveFrame !== null) { cancelAnimationFrame(moveFrame); moveFrame = null }
      const work = pending
      pending = null
      work?.()
    }
    let moved = false
    const later = (work: () => void) => {
      pending = () => { moved = true; work() }
      if (moveFrame === null) moveFrame = requestAnimationFrame(() => { moveFrame = null; flush() })
    }

    const move = (event: PointerEvent) => {
      // Only the pointer that began the gesture moves it: a palm that lands beside the pen, or a stray mouse,
      // used to add its own far-away point to the stroke being written.
      if (event.pointerId !== owner.current) return
      const rect = host.current!.getBoundingClientRect()
      const at = (e: { clientX: number; clientY: number }): Point =>
        ({ x: e.clientX - rect.left, y: e.clientY - rect.top + scrollRef.current })
      const point = at(event)
      const now = latest.current
      const size = now.size
      const g = live.current ?? gesture
      switch (g.kind) {
        case "drawing": {
          // A pen reports far more samples than frames; the coalesced ones
          // are the stroke's real shape and pressure. They are appended in
          // place: no copy of the stroke per sample.
          const samples = event.getCoalescedEvents?.() ?? []
          const all = samples.length > 0 ? samples : [event]
          for (const sample of all) {
            g.points.push(normalise(at(sample), size))
            g.pressures?.push(pressureOf(sample))
          }
          schedule()
          break
        }
        case "erasing": {
          // Every sample the pen reported since the last event, and the path between them.
          const samples = event.getCoalescedEvents?.() ?? []
          let from = g.last
          for (const sample of samples.length > 0 ? samples : [event]) {
            const to = at(sample)
            eraseAlong(from, to)
            from = to
          }
          g.last = from
          break
        }
        case "marquee":
        case "placing":
        case "connecting":
          live.current = { ...g, to: point }
          schedule()
          break
        case "moving": {
          const translate = { dx: point.x - g.from.x, dy: point.y - g.from.y }
          later(() => publish(edited(g.base, g.snapshot,
            (item, original) => transformed(item, original,
              { translate, pivot: { x: 0, y: 0 }, size }))))
          break
        }
        case "scaling": {
          const factor = scaleFactor(g.from, point, g.pivot)
          later(() => publish(edited(g.base, g.snapshot,
            (item, original) => transformed(item, original,
              { scale: factor, pivot: g.pivot, size }))))
          break
        }
        case "rotating": {
          let turn = angleAbout(point, g.pivot) - g.from
          // ⇧ turns in 15-degree steps.
          if (event.shiftKey) { const step = Math.PI / 12; turn = Math.round(turn / step) * step }
          later(() => publish(edited(g.base, g.snapshot,
            (item, original) => transformed(item, original,
              { rotate: turn, pivot: g.pivot, size }))))
          break
        }
        case "segment": {
          // The circle on a segment is dragged: the segment goes where the
          // pointer is (a fraction of the pane, in the one coordinate it can
          // move in) and the line is routed again around it.
          const value = g.vertical ? point.x / Math.max(size.width, 1)
            : point.y / Math.max(size.height, 1)
          later(() => publish({
            items: g.base.items.map((item) => {
              if (item.kind !== "connector" || item.connector.id !== g.id) return item
              const overrides = (item.connector.overrides ?? [])
                .filter((one) => one.index !== g.index)
                .concat({ index: g.index, vertical: g.vertical, value })
              return { kind: "connector", connector: { ...item.connector, overrides } }
            }),
          }))
          break
        }
        case "cropping": {
          const shown = latest.current.crop
          if (!shown) break
          const item = latest.current.drawing.items.find((one) => itemId(one) === shown.id)
          if (!item || item.kind !== "image") break
          const local = pictureFraction(item, size, point)
          setCrop({ id: shown.id, rect: cropRect(shown.rect, g.corner, local) })
          break
        }
      }
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId !== owner.current) return
      flush()
      const point = doc(event)
      const now = latest.current
      const held = now.drawing
      const g = live.current ?? gesture
      if (g.kind === "drawing" && g.points.length > 1) {
        change({
          items: [...held.items, {
            kind: "stroke",
            stroke: {
              id: newID(), colorHex: now.colorHex, width: now.penWidth, points: g.points,
              ...(g.pressures ? { pressures: g.pressures } : {}),
              transform: noTransform(), group: null,
            },
          }],
        })
      } else if (g.kind === "erasing") {
        if (held !== g.before) history.record(g.before)
      } else if (g.kind === "marquee") {
        const touched = whole(idsTouching(held, rectFrom(g.from, point), now.size), held.items)
        setSelection(g.additive ? new Set([...now.selection, ...touched]) : touched)
      } else if (g.kind === "connecting") {
        const hit = attachableAt(held, point, now.size)
        const endNode = hit === g.node ? null : hit
        // A click is not an arrow; a drag is, and so is a click that started on
        // one node and ended on another.
        if (distance(g.from, point) >= 8 || endNode !== null) {
          const connector: ConnectorItem = {
            id: newID(),
            start: normalise(g.from, now.size), end: normalise(point, now.size),
            startNode: g.node, endNode,
            startHead: "none", endHead: "arrow", line: "solid", colorHex: now.colorHex,
            lineWidth: Math.min(Math.max(now.penWidth, 1.5), 6),
            transform: noTransform(), bends: [],
          }
          change({ items: [...held.items, { kind: "connector", connector }] })
          setSelection(new Set([connector.id]))
          // The bar that comes up once an arrow is drawn: its heads and its line.
          setStyling(true)
        }
      } else if (g.kind === "placing" && now.placing) {
        // A line from the palette runs from the press to the release and is attached to NOTHING (the Mac's
        // CanvasPlacementTests: "a line from the palette is attached to nothing"). The ARROW TOOL is the one
        // that attaches, and it is the `connecting` gesture above; this one used to attach and re-route
        // a palette line too, and one dragged inside a single node ran from that node to itself.
        let item = placedItem(now.placing, g.from, point, now.size, now.colorHex, now.penWidth)
        if (item?.kind === "shape" && item.shape.kind === "text") {
          // A text box is born ready for typing, and as tall as an empty line.
          const width = Math.max(TEXT_BOX.minimumWidth, item.shape.width * now.size.width)
          item = { kind: "shape", shape: { ...item.shape, width: width / now.size.width,
            aspect: textBoxAspect("", width, measureTextBox) } }
          change({ items: [...held.items, item] })
          setSelection(new Set([itemId(item)]))
          openBox.current = true
          setLabelling({ id: item.shape.id, text: "" })
        } else if (item) {
          change({ items: [...held.items, item] })
          setSelection(new Set([itemId(item)]))
          if (item.kind === "connector") setStyling(true)
        }
        now.onPlaced()
        // The palette has done its job: the keys go back to the notebook, as on the Mac where the popover closes
        // and the text view stays the first responder. (A <select> that chose the shape kept the focus, and a
        // <select> takes the arrow keys for its own choices.)
        const focused = document.activeElement
        if (focused instanceof HTMLSelectElement) {
          focused.blur()
          scroller?.querySelector<HTMLElement>(".cm-content")?.focus({ preventScroll: true })
        }
      } else if (g.kind === "moving" || g.kind === "scaling" || g.kind === "rotating"
        || g.kind === "segment") {
        // The move already went through `onChange` as it happened; this is
        // the one that lands on the undo stack — and only when it moved.
        if (moved) history.record(g.base)
      }
      live.current = null
      owner.current = null
      baseDirty.current = true
      schedule()
      setGesture(null)
    }
    // A pen that leaves the tablet's range mid-stroke, or a palm that the
    // system takes back, cancels rather than lifts; the stroke so far is kept.
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      if (moveFrame !== null) cancelAnimationFrame(moveFrame)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  }, [gesture, doc, change, eraseAlong, schedule, publish, history, scroller])

  // The pen's Delete and Clear buttons (and the same ExpressKeys): the drawing
  // layer owns the selection, so it answers for them.
  useEffect(() => registerPenHandlers({
    deleteSelection: () => {
      const picked = latest.current.selection
      if (picked.size === 0) return
      change(removing(latest.current.drawing, picked))
      setSelection(new Set())
    },
    clearSelection: () => { setSelection(new Set()); if (latest.current.placing) onPlaced() },
  }), [change, onPlaced])

  // MARK: - Keys the layer watches

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // A label being typed, or the notebook: those keys are theirs.
      if (event.target instanceof Element && event.target.closest("input, textarea")) return
      const held = latest.current.drawing
      const picked = latest.current.selection
      if (event.key === "Escape" && latest.current.crop) { setCrop(null); return }
      if (event.key === "Escape" && latest.current.styling) {
        setStyling(false)
        // A tool armed at the same time is put away too: one Escape, not two.
        if (latest.current.placing) onPlaced()
        return
      }
      // (Backspace and Delete are in the capture handler below: heard here, after the notebook, the same press
      // had already taken a letter out of the note.)
      // ⌃G both ways, and it returns without swallowing the key when there
      // was nothing to do — a watcher that eats a key it did not use is
      // how typing dies.
      if (event.key.toLowerCase() === "g" && event.ctrlKey && !event.metaKey) {
        const next = toggled(picked, held.items)
        if (!next) return
        event.preventDefault()
        change({ items: next })
        setSelection(whole(picked, next))
        return
      }
      if (event.key === "Escape" && (picked.size > 0 || latest.current.placing)) {
        setSelection(new Set())
        if (latest.current.placing) onPlaced()
      }
      // ⌥⌘Z on the layer is the old private undo; the app's own Ctrl+Z
      // (App.tsx) reaches the same history.
      if (event.key.toLowerCase() === "z" && event.metaKey && event.altKey) {
        event.preventDefault()
        const next = event.shiftKey ? history.redo(held) : history.undo(held)
        if (next) publish(next)
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [change, history, onPlaced, publish])

  // What is picked answers the arrow keys, Backspace / Delete and the copy keys BEFORE the notebook does
  // (capture phase, and the key goes no further): the caret is not moving, and no letter is taken out of
  // the note, while a thing on the layer is picked up. WHOSE a key is, is `layerKey` (layerKeys.ts): a key
  // that works on the words -- a letter typed, Enter, Ctrl+A -- is the notebook's AND lets go of the pick,
  // which gives the arrows and Backspace back to the text; a press on the words does the same. The Mac's
  // layer has the delete (its key monitor swallows it too); the arrows and the copy keys are the port's own.
  useEffect(() => {
    const away = (target: EventTarget | null) =>
      target instanceof Element && target.closest("input, textarea") !== null
    /** A key the layer took and the person is still holding: its repeats are the layer's too, not the note's. */
    let taken: string | null = null
    const keys = (event: KeyboardEvent) => {
      if (event.repeat && taken === event.key) { event.preventDefault(); event.stopPropagation(); return }
      const { drawing: held, selection: picked, size: now, box: shown, crop: cropping } = latest.current
      const target = event.target
      const verdict = layerKey({
        key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey,
        altGraph: event.getModifierState?.("AltGraph") ?? false,
        composing: event.isComposing,
        inField: away(target),
        inSelect: target instanceof Element && target.closest("select") !== null,
        inNotebook: target instanceof HTMLElement && target.isContentEditable,
        picked: picked.size > 0 && shown !== null,
        cropOpen: cropping !== null,
      })
      if (!verdict) return
      if (verdict.take === "letGo") { setSelection(new Set()); return }
      event.preventDefault(); event.stopPropagation()
      switch (verdict.take) {
        case "nudge":
          burst(nudged(held, picked, verdict.dx, verdict.dy, now))
          break
        case "delete":
          taken = event.key
          change(removing(held, picked))
          setSelection(new Set())
          break
        case "copy":
        case "cut":
          copyObjects(held.items, whole(picked, held.items))
          if (verdict.take === "cut") {
            change(removing(held, picked))
            setSelection(new Set())
          }
          break
        case "confirmCrop":
          taken = event.key
          if (!event.repeat) confirmCrop.current()
          break
      }
    }
    const lifted = () => { taken = null }
    const pasted = (event: ClipboardEvent) => {
      if (away(event.target)) return
      const text = event.clipboardData?.getData("text/plain") ?? ""
      const clip = objectClipboard
      if (!clip || !text.includes(`[${clip.token}]`)) {
        // Words pasted into the notebook: the person is in the text again, not with the objects.
        if (event.target instanceof HTMLElement && event.target.isContentEditable) setSelection(new Set())
        return
      }
      event.preventDefault(); event.stopPropagation()
      const { drawing: held, size: now } = latest.current
      clip.pastes += 1
      const slide = 16 * clip.pastes
      let copies = shifted(copiedItems(clip.items, new Set(clip.items.map(itemId))), slide, slide, now)
      // From another note, scrolled somewhere else: bring it into view.
      const where = boundsOf({ items: copies }, new Set(copies.map(itemId)), now)
      const top = scrollRef.current
      if (where && (where.y + where.height < top || where.y > top + now.height)) {
        copies = shifted(copies, 0, top + 40 - where.y, now)
      }
      if (copies.length === 0) return
      change({ items: [...held.items, ...copies] })
      setSelection(new Set(copies.map(itemId)))
    }
    window.addEventListener("keydown", keys, true)
    window.addEventListener("keyup", lifted, true)
    window.addEventListener("paste", pasted, true)
    return () => {
      window.removeEventListener("keydown", keys, true)
      window.removeEventListener("keyup", lifted, true)
      window.removeEventListener("paste", pasted, true)
    }
  }, [burst, change])

  // MARK: - The handles

  // The handles stand at the corners of the selection, but a thin selection (a
  // flat stroke, a short line) would stack three 22-point buttons on top of one
  // another; they are spread to a box at least this big, and the pivot stays put.
  // Across the top there are three (turn, move, delete) and across the bottom up
  // to four (group, crop, style, resize), each 22 wide: a tick one line of text
  // across needs a box well wider than it is tall to keep them apart.
  const MIN_SPAN_X = 96, MIN_SPAN_Y = 34
  const hb = box ? {
    x: box.x - Math.max(0, (MIN_SPAN_X - box.width) / 2),
    y: box.y - Math.max(0, (MIN_SPAN_Y - box.height) / 2),
    width: Math.max(box.width, MIN_SPAN_X),
    height: Math.max(box.height, MIN_SPAN_Y),
  } : null
  const grouping = toggle(selection, drawing.items)
  // The style bar sits under the selection, or over it when there is no room.
  const barSpot = hb ? (() => {
    const wide = 340, tall = 176
    const left = Math.round(Math.min(Math.max(hb.x, 8), Math.max(size.width - wide - 8, 8)))
    const below = hb.y + hb.height - scroll + 40
    const top = below + tall <= size.height ? below : Math.max(hb.y - scroll - tall - 34, 8)
    return { left, top: Math.round(Math.min(Math.max(top, 8), Math.max(size.height - tall, 8))) }
  })() : null
  // A handle stays on the pane: an object at the edge of the view (or half
  // scrolled off it) keeps every button within reach, as on the Mac, where
  // they are clamped 14 points in.
  const spot = (x: number, y: number, scrolled: number) => at(
    Math.min(Math.max(x, 2), Math.max(size.width - 24, 2)),
    Math.min(Math.max(y - scrolled, 2), Math.max(size.height - 24, 2)) + scrolled, scrolled)
  const handles = box && hb && !gesture && selection.size > 0 ? (
    <>
      <button className="wm-handle" style={spot(hb.x - HANDLE, hb.y - HANDLE, scroll)}
              title="Turn"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                const pivot = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
                start({
                  kind: "rotating",
                  from: angleAbout(doc(event.nativeEvent), pivot),
                  pivot,
                  snapshot: snapshotOf(drawing, selection),
                  base: drawing,
                }, event.pointerId)
              }}>⟳</button>
      <button className="wm-handle" style={spot(hb.x + hb.width, hb.y + hb.height, scroll)}
              title="Resize"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                const pivot = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
                start({
                  kind: "scaling",
                  from: doc(event.nativeEvent),
                  pivot,
                  snapshot: snapshotOf(drawing, selection),
                  base: drawing,
                }, event.pointerId)
              }}>⤡</button>
      <button className="wm-handle" style={spot(hb.x + hb.width, hb.y - HANDLE, scroll)}
              title="Delete"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                change(removing(drawing, selection))
                setSelection(new Set())
              }}>✕</button>
      {onReadPicture && selection.size === 1 && (() => {
        const only = drawing.items.find((item) => itemId(item) === [...selection][0])
        if (!only || only.kind !== "image") return null
        return (
          <button className="wm-handle wm-handle-wide" style={spot(hb.x - HANDLE, hb.y + hb.height / 2, scroll)}
                  title="Read the words out of this picture"
                  onPointerDown={(event) => {
                    event.preventDefault(); event.stopPropagation()
                    onReadPicture(only.image.file, only.image.id)
                  }}>Aa</button>
        )
      })()}
      {selection.size === 1 && (() => {
        const only = drawing.items.find((item) => itemId(item) === [...selection][0])
        if (!only || only.kind !== "image") return null
        return (
          <button className="wm-handle" title="Crop this picture"
                  style={spot(hb.x + hb.width / 2 - HANDLE, hb.y + hb.height, scroll)}
                  onPointerDown={(event) => {
                    event.preventDefault(); event.stopPropagation()
                    setCrop({ id: only.image.id, rect: { x: 0, y: 0, width: 1, height: 1 } })
                  }}>✂</button>
        )
      })()}
      {/* The circle on each segment of a routed line: drag it and the segment
          goes with the pointer, the line routed again around it. */}
      {drawing.items.flatMap((item) => {
        if (item.kind !== "connector" || !selection.has(item.connector.id)
          || !isRouted(item.connector)) return []
        return segmentMidpoints(pixelRoute(item.connector, size)).map((segment) => (
          <button key={`${item.connector.id}:${segment.index}`}
                  className="wm-handle wm-segment"
                  data-segment={segment.index}
                  data-vertical={segment.vertical ? "1" : "0"}
                  title="Drag to move this part of the line"
                  style={{ ...at(segment.point.x - 6, segment.point.y - 6, scroll),
                    cursor: segment.vertical ? "ew-resize" : "ns-resize" }}
                  onPointerDown={(event) => {
                    event.preventDefault(); event.stopPropagation()
                    start({
                      kind: "segment", id: item.connector.id, index: segment.index,
                      vertical: segment.vertical, base: drawing,
                    }, event.pointerId)
                  }} />
        ))
      })}
      {/* Hold what is picked together, or take it apart: the button says which
          it will do, and ⌃G does the same. */}
      {grouping !== "nothing" && (
        <button className="wm-handle wm-handle-group" data-group={grouping}
                style={spot(hb.x - HANDLE, hb.y + hb.height, scroll)}
                title={grouping === "ungroup" ? "Ungroup these (⌃G does too)" : "Group these (⌃G does too)"}
                onPointerDown={(event) => {
                  event.preventDefault(); event.stopPropagation()
                  const next = toggled(selection, drawing.items)
                  if (next) {
                    change({ items: next })
                    // The handles go round the whole of what is held at once.
                    setSelection(whole(selection, next))
                  }
                }}>{grouping === "ungroup" ? "Ungroup" : "Group"}</button>
      )}
      {/* Dragging the ink moves it too, but a thin stroke is a small target and a
          picture under the pointer is not obviously draggable: a button says so. */}
      <button className="wm-handle" data-handle="move"
              style={spot(hb.x + hb.width / 2 - HANDLE, hb.y - HANDLE, scroll)}
              title="Drag to move"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                start({ kind: "moving", from: doc(event.nativeEvent), snapshot: snapshotOf(drawing, selection), base: drawing }, event.pointerId)
              }}>✥</button>
      {/* Colour, width, fill, an arrow's heads and line, the order, a copy. */}
      <button className={`wm-handle${styling ? " wm-handle-on" : ""}`} data-handle="style"
              style={spot(hb.x + hb.width / 2 - HANDLE / 2 + 18, hb.y + hb.height, scroll)}
              title="Colour, width, heads and line"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                setStyling((was) => !was)
              }}>◐</button>
      {styling && barSpot && (
        <StyleBar items={drawing.items.filter((item) => selection.has(itemId(item)))}
                  left={barSpot.left} top={barSpot.top}
                  onPatch={applyStyle} onOrder={orderSelection} onDuplicate={duplicate}
                  onClose={() => setStyling(false)} />
      )}
    </>
  ) : null

  // MARK: - A node's label

  const labelled = labelling
    ? drawing.items.find((item) => itemId(item) === labelling.id) : undefined
  /**
   * Escape set this to keep the blur that follows from committing what was typed -- but the input is
   * unmounted, and an unmounted input sends no blur: the flag stayed set and swallowed the NEXT label's
   * commit (a click away did nothing; only Enter finally did, and Enter needed two presses). It is the
   * business of ONE editor, so it is put back the moment there is none.
   */
  const labelCancelled = useRef(false)
  const labelling_ = labelling !== null
  useEffect(() => { if (!labelling_) labelCancelled.current = false }, [labelling_])
  // A label whose object has gone (undone away, deleted) is no label being typed.
  useEffect(() => { if (labelling && !labelled) setLabelling(null) }, [labelling, labelled])
  useEffect(() => {
    editingBox.current = labelling && labelled?.kind === "shape" && labelled.shape.kind === "text"
      ? labelling.id : null
    baseDirty.current = true
    schedule()
  }, [labelling, labelled, schedule])

  /**
   * A text box is as tall as its text — measured on every keystroke, so the
   * card grows under the caret instead of catching up afterwards. The words
   * are typed into the field and written to the drawing as they go; the
   * session is one undo.
   */
  const typeIntoBox = (id: string, text: string) => {
    const held = latest.current.drawing
    const now = latest.current.size
    if (!openBox.current) { history.record(held); openBox.current = true }
    publish({
      items: held.items.map((item) => {
        if (item.kind !== "shape" || item.shape.id !== id) return item
        const width = item.shape.width * now.width
        const aspect = textBoxAspect(text, width, measureTextBox)
        return { kind: "shape" as const, shape: { ...item.shape, label: text, aspect } }
      }),
    })
    setLabelling({ id, text })
  }

  const boxEditor = labelling && labelled?.kind === "shape" && labelled.shape.kind === "text" ? (() => {
    const shape = labelled.shape
    const base = baseBounds(labelled, size)
    const centre = placedCenter(labelled, size)
    const width = Math.max(TEXT_BOX.minimumWidth, base.width)
    const height = Math.max(base.height, textBoxHeight(labelling.text, width, measureTextBox))
    const fill = shape.fillHex
    const ink = readableInk(shape.colorHex, shape.fillHex)
    const t = shape.transform
    return (
      <textarea className="wm-textbox-edit" autoFocus value={labelling.text} spellCheck={false}
                data-node={labelling.id}
                style={{
                  left: centre.x - width / 2, top: centre.y - scroll - height / 2, width, height,
                  color: ink, caretColor: ink,
                  background: fill ?? "var(--wm-page)",
                  transform: `rotate(${t.rotation}rad) scale(${t.scale})`,
                }}
                onFocus={(event) => { const end = event.currentTarget.value.length; event.currentTarget.setSelectionRange(end, end) }}
                onChange={(event) => typeIntoBox(labelling.id, event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Escape") { event.preventDefault(); openBox.current = false; setLabelling(null) }
                }}
                onBlur={() => { openBox.current = false; setLabelling(null) }} />
    )
  })() : null

  const labelEditor = labelling && labelled?.kind === "shape" && labelled.shape.kind !== "text" ? (() => {
    const centre = placedCenter(labelled, size)
    const width = Math.max(96, Math.min(240, bounds(labelled, size).width))
    const commit = () => {
      if (labelCancelled.current) { labelCancelled.current = false; return }
      relabel(labelling.id, labelling.text.trim())
      setLabelling(null)
    }
    return (
      <input className="wm-label-edit" autoFocus value={labelling.text} spellCheck={false}
             data-node={labelling.id}
             style={{ left: Math.round(centre.x - width / 2), top: Math.round(centre.y - scroll - 12), width }}
             onFocus={(event) => event.currentTarget.select()}
             onChange={(event) => setLabelling({ id: labelling.id, text: event.target.value })}
             onKeyDown={(event) => {
               event.stopPropagation()
               if (event.key === "Enter") { event.preventDefault(); commit() }
               else if (event.key === "Escape") { labelCancelled.current = true; setLabelling(null) }
             }}
             onBlur={commit} />
    )
  })() : null

  // MARK: - The crop box

  const cropped_ = crop ? drawing.items.find((item) => itemId(item) === crop.id) : undefined
  const applyCrop = async () => {
    if (!crop || cropped_?.kind !== "image") return
    const source = loadedPicture(cropped_.image.file)
    if (!source) return
    const { rect } = crop
    const sx = Math.round(rect.x * source.naturalWidth), sy = Math.round(rect.y * source.naturalHeight)
    const sw = Math.max(1, Math.round(rect.width * source.naturalWidth))
    const sh = Math.max(1, Math.round(rect.height * source.naturalHeight))
    const cut = document.createElement("canvas")
    cut.width = sw; cut.height = sh
    cut.getContext("2d")!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
    const png = !/\.jpe?g$/i.test(cropped_.image.file)
    const blob = await new Promise<Blob | null>((resolve) =>
      cut.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.92))
    if (!blob) return
    const saved = await window.wm.saveMedia(new Uint8Array(await blob.arrayBuffer()), png ? ".png" : ".jpg")
    const held = latest.current.drawing
    const now = latest.current.size
    // The kept part's proportions on the page: the picture's own, cut down.
    const aspect = cropped_.image.aspect * rect.height / Math.max(rect.width, 0.0001)
    change({
      items: held.items.map((item) =>
        itemId(item) === crop.id ? cropped(item, rect, saved.file, aspect, now) : item),
    })
    setCrop(null)
  }
  confirmCrop.current = () => { void applyCrop() }
  const cropEditor = crop && cropped_?.kind === "image" ? (() => {
    const base = baseBounds(cropped_, size)
    const centre = placedCenter(cropped_, size)
    const t = cropped_.image.transform
    const { rect } = crop
    const percent = (value: number) => `${value * 100}%`
    const corners = [
      { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
    ]
    const outer = bounds(cropped_, size)
    return (
      <>
        <div className="wm-crop" data-crop={crop.id}
             style={{
               left: centre.x - base.width / 2, top: centre.y - scroll - base.height / 2,
               width: base.width, height: base.height,
               transform: `rotate(${t.rotation}rad) scale(${t.scale})`,
             }}>
          <div className="wm-crop-box"
               style={{ left: percent(rect.x), top: percent(rect.y),
                 width: percent(rect.width), height: percent(rect.height) }} />
          {corners.map((corner, index) => (
            <div key={index} className="wm-crop-corner" data-corner={index}
                 style={{ left: percent(corner.x), top: percent(corner.y) }}
                 onPointerDown={(event) => {
                   event.preventDefault(); event.stopPropagation()
                   start({ kind: "cropping", corner: index }, event.pointerId)
                 }} />
          ))}
        </div>
        <div className="wm-crop-bar"
             style={{ left: Math.round(outer.x + outer.width / 2 - 36), top: Math.round(outer.y + outer.height - scroll + 6) }}>
          <button className="wm-handle wm-crop-ok" title="Keep this part"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void applyCrop() }}>✓</button>
          <button className="wm-handle wm-crop-cancel" title="Leave the picture as it is"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setCrop(null) }}>✕</button>
        </div>
      </>
    )
  })() : null

  // With the pen up and nothing armed the layer is see-through to clicks:
  // the notebook gets them all, and the capture listener above takes back
  // only the ones that land on an object.
  const grabs = mode === "pen" || placing !== null || command || gesture !== null || eraserOn || selectOn

  return (
    <div className="wm-canvas" ref={host}
         style={{ pointerEvents: grabs ? "auto" : "none", cursor: eraserOn ? "cell" : selectOn ? "crosshair" : cursorFor(mode, placing, command) }}>
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      <canvas ref={overlay}
              style={{ width: size.width, height: size.height, pointerEvents: "none" }} />
      <div className="wm-handles">
        {handles}
        {labelEditor}
        {boxEditor}
        {cropEditor}
      </div>
    </div>
  )
}

/** A connector's route in view points. */
const pixelRoute = (connector: ConnectorItem, size: Size): Point[] =>
  route(connector).map((point) => ({ x: point.x * size.width, y: point.y * size.height }))

/**
 * A point on the page as a fraction of a picture (top-left origin, 0…1 across
 * it): the picture's transform undone, so the crop box can be dragged on a
 * picture that has been turned and scaled.
 */
function pictureFraction(item: CanvasItem, size: Size, point: Point): Point {
  const base = baseBounds(item, size)
  const centre = placedCenter(item, size)
  const t = itemTransform(item)
  const dx = point.x - centre.x, dy = point.y - centre.y
  const cos = Math.cos(-t.rotation), sin = Math.sin(-t.rotation)
  const lx = (dx * cos - dy * sin) / t.scale, ly = (dx * sin + dy * cos) / t.scale
  return { x: 0.5 + lx / Math.max(base.width, 1), y: 0.5 + ly / Math.max(base.height, 1) }
}

const at = (x: number, y: number, scroll: number) => ({
  left: `${Math.round(x)}px`, top: `${Math.round(y - scroll)}px`,
})

const cursorFor = (mode: CanvasMode, placing: Placement | null, command: boolean): string => {
  if (placing) return "crosshair"
  if (command) return "crosshair"
  // The pointer stays a pencil under the pen even while ⌘ is held on the
  // Mac, for a reason that does not apply here (two setters, one pointer);
  // a DOM cursor has one owner, so it can be honest.
  return mode === "pen" ? "crosshair" : "default"
}

/**
 * A pen's pressure. A digitiser that reports none (or a pen that is only
 * hovering) says 0 or 0.5 for everything; a touching pen at 0 is taken as
 * light rather than invisible.
 */
/** Keep a stroke going when the pen strays over the chrome or past the window edge. */
const capture = (event: PointerEvent): void => {
  try { (event.target as Element).setPointerCapture(event.pointerId) } catch { /* synthetic or gone */ }
}

const pressureOf = (event: PointerEvent): number =>
  event.pressure > 0 ? event.pressure : 0.5

const normalise = (point: Point, size: Size): Point =>
  ({ x: point.x / Math.max(size.width, 1), y: point.y / Math.max(size.height, 1) })

const snapshotOf = (drawing: Drawing, ids: Set<string>): Map<string, ItemTransform> => {
  const out = new Map<string, ItemTransform>()
  for (const item of drawing.items) {
    if (ids.has(itemId(item))) out.set(itemId(item), itemTransform(item))
  }
  return out
}

const edited = (drawing: Drawing, snapshot: Map<string, ItemTransform>,
  make: (item: CanvasItem, original: ItemTransform) => ItemTransform): Drawing => ({
  items: drawing.items.map((item) => {
    const original = snapshot.get(itemId(item))
    return original ? withTransform(item, make(item, original)) : item
  }),
})

/**
 * A pen stroke: a smooth line whose width follows the pressure. The line goes
 * through the middles of the samples with each sample as the control point
 * (the same curve a mouse stroke is given, `strokeCurve`), cut into one piece
 * per sample, and each piece is as wide as the pressure at its sample. Runs of
 * pieces whose width rounds to the same quarter pixel go down as ONE path: a
 * stroke is hundreds of pieces and a draw call for each was most of what a
 * repaint cost. The pieces meet end to end, so a run needs no new start.
 *
 * `from` is the first piece not yet drawn (a stroke still being written is
 * painted a few pieces at a time); `tail` draws the last half piece, to the
 * final sample, which a stroke being written does not have yet. Returns the
 * number of pieces drawn so far.
 */
function strokePressure(context: CanvasRenderingContext2D, count: number, at: (index: number) => Point,
  pressures: number[], base: number, from: number, tail: boolean): number {
  const last = tail ? count - 1 : count - 2
  if (count < 2 || from > last) return Math.max(from, 0)
  const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  context.lineCap = "round"
  context.lineJoin = "round"
  let run = -1
  for (let piece = from; piece <= last; piece++) {
    const width = Math.max(0.25, Math.round(base * pressureScale(pressures[piece] ?? 0.5) * 4) / 4)
    if (width !== run) {
      if (run >= 0) context.stroke()
      run = width
      context.lineWidth = width
      context.beginPath()
      const start = piece === 0 ? at(0) : middle(at(piece - 1), at(piece))
      context.moveTo(start.x, start.y)
    }
    if (piece === 0) {
      const to = middle(at(0), at(1))
      context.lineTo(to.x, to.y)
    } else if (piece === count - 1) {
      const to = at(count - 1)
      context.lineTo(to.x, to.y)
    } else {
      const control = at(piece), to = middle(control, at(piece + 1))
      context.quadraticCurveTo(control.x, control.y, to.x, to.y)
    }
  }
  if (run >= 0) context.stroke()
  return last + 1
}

/** One object, drawn where it is now. */
function paint(context: CanvasRenderingContext2D, item: CanvasItem, size: Size,
  onPictureLoad: () => void = () => {}, editing: string | null = null): void {
  const place = matrixOf(item, size)
  context.lineCap = "round"
  context.lineJoin = "round"

  switch (item.kind) {
    case "stroke": {
      const points = basePoints(item, size).map(place)
      if (points.length === 0) return
      context.strokeStyle = item.stroke.colorHex
      context.lineWidth = item.stroke.width * item.stroke.transform.scale
      const pressures = item.stroke.pressures
      if (pressures && pressures.length === points.length && points.length > 1) {
        strokePressure(context, points.length, (i) => points[i]!, pressures, context.lineWidth, 0, true)
        return
      }
      context.beginPath()
      // The line through the middles of the samples, as on the Mac; the stroke
      // still being drawn is a polyline until it is let go.
      const curve = item.stroke.id === "live" ? null : strokeCurve(item.stroke, points)
      if (curve && "steps" in curve) {
        for (const step of curve.steps) {
          if (step.op === "M") context.moveTo(step.to.x, step.to.y)
          else if (step.op === "L") context.lineTo(step.to.x, step.to.y)
          else context.quadraticCurveTo(step.control.x, step.control.y, step.to.x, step.to.y)
        }
      } else {
        context.moveTo(points[0]!.x, points[0]!.y)
        for (const point of points.slice(1)) context.lineTo(point.x, point.y)
        if (points.length === 1) context.lineTo(points[0]!.x + 0.01, points[0]!.y)
      }
      context.stroke()
      return
    }
    case "shape": {
      const shape = item.shape
      if (shape.kind === "text") { paintTextBox(context, item, size, editing === shape.id); return }
      // Drawn in the shape's own frame — turned and scaled about its centre, as
      // the Mac's layer is — so the outline's width scales with it, and the
      // true curves (an oval, a rounded rectangle's corners) are drawn as curves.
      const box = baseBoxOf(item, size)
      const centre = baseCenter(item, size)
      const t = shape.transform
      context.save()
      context.translate(centre.x + t.dx * size.width, centre.y + t.dy * size.height)
      context.rotate(t.rotation)
      context.scale(t.scale, t.scale)
      context.translate(-centre.x, -centre.y)
      const outlinePath = shapePath(shape.kind, box)
      if (shape.fillHex) { context.fillStyle = shape.fillHex; context.fill(outlinePath) }
      context.strokeStyle = shape.colorHex
      context.lineWidth = shape.lineWidth
      context.stroke(outlinePath)
      if (shape.label && editing !== shape.id) {
        const font = "13px -apple-system, Segoe UI, system-ui, sans-serif"
        const room = Math.max(10, box.width - 12)
        const lines = wrapLines(shape.label, room, context, font).slice(0, 6)
        context.fillStyle = shape.fillHex ? readableInk(shape.colorHex, shape.fillHex) : shape.colorHex
        context.font = font
        context.textAlign = "center"
        context.textBaseline = "middle"
        const leading = 16
        lines.forEach((text, index) => {
          context.fillText(text, box.x + box.width / 2,
            box.y + box.height / 2 + (index - (lines.length - 1) / 2) * leading)
        })
      }
      context.restore()
      return
    }
    case "connector": {
      const points = route(item.connector).map((point) =>
        place({ x: point.x * size.width, y: point.y * size.height }))
      const scale = item.connector.transform.scale
      // The line is pulled back from a head so the tip is the point; the heads
      // are filled triangles (the Mac's InkPaths, which the PDF is drawn from too).
      const { line, heads } = connectorPaths(item.connector, points)
      if (line.length === 0) return
      context.strokeStyle = item.connector.colorHex
      context.fillStyle = item.connector.colorHex
      context.lineWidth = item.connector.lineWidth * scale
      context.lineCap = item.connector.line === "dotted" ? "round" : "butt"
      context.setLineDash(dashPattern(item.connector).map((part) => part * scale))
      context.beginPath()
      context.moveTo(line[0]!.x, line[0]!.y)
      for (const point of line.slice(1)) context.lineTo(point.x, point.y)
      context.stroke()
      context.setLineDash([])
      for (const head of heads) {
        context.beginPath()
        context.moveTo(head[0]!.x, head[0]!.y)
        context.lineTo(head[1]!.x, head[1]!.y)
        context.lineTo(head[2]!.x, head[2]!.y)
        context.closePath()
        context.fill()
      }
      return
    }
    case "image": {
      const image = picture(item.image.file, onPictureLoad)
      const box = baseBounds(item, size)
      const centre = baseCenter(item, size)
      const t = item.image.transform
      context.save()
      context.translate(centre.x + t.dx * size.width, centre.y + t.dy * size.height)
      context.rotate(t.rotation)
      context.scale(t.scale, t.scale)
      context.translate(-centre.x, -centre.y)
      if (image) {
        context.drawImage(image, box.x, box.y, box.width, box.height)
      } else {
        // Still loading: its box, so the handles have something to sit
        // against and the page does not jump when it arrives.
        context.strokeStyle = "rgba(128,128,136,0.5)"
        context.setLineDash([4, 3])
        context.strokeRect(box.x, box.y, box.width, box.height)
        context.setLineDash([])
      }
      context.restore()
      return
    }
  }
}

/**
 * A card, not a dashed rectangle with words near it: the fill and the corner
 * are one shape, the words sit inside the same padding the editor uses, and
 * the ink is checked against the fill before it is drawn. While it is being
 * typed into, the field over the top IS the box and nothing is drawn under it.
 */
function paintTextBox(context: CanvasRenderingContext2D, item: CanvasItem, size: Size, editing: boolean): void {
  if (item.kind !== "shape") return
  const shape = item.shape
  const box = baseBoxOf(item, size)
  const centre = baseCenter(item, size)
  const t = shape.transform
  context.save()
  context.translate(centre.x + t.dx * size.width, centre.y + t.dy * size.height)
  context.rotate(t.rotation)
  context.scale(t.scale, t.scale)
  context.translate(-centre.x, -centre.y)
  const card = new Path2D()
  card.roundRect(box.x, box.y, box.width, box.height, TEXT_BOX.cornerRadius)
  if (shape.fillHex) { context.fillStyle = shape.fillHex; context.fill(card) }
  if (!editing) {
    const left = box.x + TEXT_BOX.padding.width, top = box.y + TEXT_BOX.padding.height
    context.font = TEXT_FONT
    context.textAlign = "left"
    context.textBaseline = "top"
    if (shape.label === "") {
      // An empty box has to be findable and grabbable, so it keeps a quiet card
      // of its own until there are words.
      if (!shape.fillHex) { context.fillStyle = "rgba(128,128,136,0.09)"; context.fill(card) }
      context.strokeStyle = "rgba(128,128,136,0.45)"
      context.lineWidth = 1
      context.stroke(card)
      context.fillStyle = "rgba(128,128,136,0.8)"
      context.fillText("Text", left, top + (TEXT_BOX.lineHeight - TEXT_BOX.fontSize) / 2)
    } else {
      context.fillStyle = readableInk(shape.colorHex, shape.fillHex)
      const room = Math.max(1, box.width - TEXT_BOX.padding.width * 2)
      wrapLines(shape.label, room, context).forEach((text, index) => {
        context.fillText(text, left, top + index * TEXT_BOX.lineHeight + (TEXT_BOX.lineHeight - TEXT_BOX.fontSize) / 2)
      })
    }
  }
  context.restore()
}

const baseBoxOf = (item: CanvasItem, size: Size): Rect => {
  if (item.kind !== "shape") return { x: 0, y: 0, width: 0, height: 0 }
  const w = item.shape.width * size.width
  const h = w * item.shape.aspect
  return {
    x: item.shape.center.x * size.width - w / 2,
    y: item.shape.center.y * size.height - h / 2,
    width: w, height: h,
  }
}

/**
 * What is drawn for a shape in its box: the true curves where the outline the
 * hit test uses is an approximation (an oval is a 32-gon there, a rounded
 * rectangle's corners are short arcs).
 */
function shapePath(kind: ShapeKind, box: Rect): Path2D {
  const path = new Path2D()
  if (kind === "oval") {
    path.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2)
  } else if (kind === "roundedRectangle") {
    path.roundRect(box.x, box.y, box.width, box.height, cornerRadius(box))
  } else {
    for (const line of polylines(kind, box)) {
      if (line.length === 0) continue
      path.moveTo(line[0]!.x, line[0]!.y)
      for (const point of line.slice(1)) path.lineTo(point.x, point.y)
      if (isClosed(kind)) path.closePath()
    }
  }
  return path
}

export const emptyCanvas = emptyDrawing
