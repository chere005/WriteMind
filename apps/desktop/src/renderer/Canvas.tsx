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
  applyMatrix, angleAbout, baseBounds, baseCenter, basePoints, bounds, boundsOf, cropRect, cropped,
  emptyDrawing, headLength, hitTest, idsTouching, isNode, isRouted, pressureScale, placedCenter,
  reconnect, segmentMidpoints, TEXT_BOX, textBoxAspect, textBoxHeight, readableInk,
  indexAt, isHidden, itemId, itemTransform, newID, noTransform, placedItem, polylines, rectFrom,
  removing, route, scaleFactor, toggled, transformed, unitPolylines, whole, withTransform,
  type CanvasItem, type ConnectorItem, type Drawing, type ItemTransform, type Placement,
  type Measure, type Point, type Rect, type Size,
} from "@writemind/core"
import type { DrawingHistory } from "./drawingHistory"
import { penSettings, usePenSettings } from "./penSettings"
import { resolvePress, slotOf } from "./penButtons"
import { registerPenHandlers } from "./penActions"

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
  | { kind: "erasing"; before: Drawing }
  | { kind: "moving"; from: Point; snapshot: Map<string, ItemTransform>; base: Drawing }
  | { kind: "marquee"; from: Point; to: Point; additive: boolean }
  | { kind: "placing"; from: Point; to: Point }
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

/**
 * The topmost node (a flow-chart shape or a picture) under a point — the
 * Swift `attachable(at:)`. An arrow dropped with an end here is attached to
 * it, and follows it from then on.
 */
export function attachableAt(drawing: Drawing, point: Point, size: Size): string | null {
  for (let index = drawing.items.length - 1; index >= 0; index--) {
    const item = drawing.items[index]!
    if (isHidden(item)) continue
    const node = item.kind === "image" || (item.kind === "shape" && isNode(item.shape.kind))
    if (node && hitTest(item, point, size)) return itemId(item)
  }
  return null
}

// MARK: - Text boxes
//
// A text box is typed into exactly where it is drawn, so the painter and the
// editor wrap the words the same way: by the words, at the same width, in the
// same font. (The editor is a <textarea> set to `pre-wrap` and `break-word`.)

const TEXT_FONT = `${TEXT_BOX.fontSize}px -apple-system, "Segoe UI", system-ui, sans-serif`
let ruler: CanvasRenderingContext2D | null = null

/** The lines `text` wraps to in `room` points: a greedy wrap that breaks a word only when it cannot fit. */
export function wrapLines(text: string, room: number, context?: CanvasRenderingContext2D): string[] {
  const ctx = context ?? (ruler ??= document.createElement("canvas").getContext("2d")!)
  ctx.font = TEXT_FONT
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
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [gesture, setGesture] = useState<Gesture | null>(null)
  /** The gesture as it is NOW: moved on every pointer event without a render. */
  const live = useRef<Gesture | null>(null)
  const [command, setCommand] = useState(false)
  const tools = usePenSettings()
  const eraserOn = tools.eraser
  const selectOn = tools.selectTool
  const [crop, setCrop] = useState<Crop | null>(null)
  const [labelling, setLabelling] = useState<Labelling | null>(null)
  /** The text box being typed into: the painter leaves its words to the field over it. */
  const editingBox = useRef<string | null>(null)
  const lastPress = useRef<{ at: number; id: string } | null>(null)
  /** A text box's editing counts as ONE undo: whether this session has taken its snapshot. */
  const openBox = useRef(false)

  const box = useMemo(() => boundsOf(drawing, selection, size), [drawing, selection, size])

  const latest = useRef({
    drawing, selection, gesture, placing, mode, size, colorHex, penWidth, onChange, onPlaced, box,
    crop,
  })
  latest.current = {
    ...latest.current,
    drawing, selection, gesture, placing, mode, size, colorHex, penWidth, onChange, onPlaced, box,
    crop,
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
      const g = live.current
      if (g?.kind === "placing" && now.placing) {
        const ghost = placedItem(now.placing, g.from, g.to, now.size, now.colorHex, now.penWidth)
        if (ghost) {
          context.globalAlpha = 0.5
          paint(context, ghost, now.size)
          context.globalAlpha = 1
        }
      }
      if (g?.kind === "marquee") {
        const rect = rectFrom(g.from, g.to)
        context.strokeStyle = "rgba(109,169,240,0.9)"
        context.fillStyle = "rgba(109,169,240,0.12)"
        context.lineWidth = 1
        context.setLineDash([4, 3])
        context.fillRect(rect.x, rect.y, rect.width, rect.height)
        context.strokeRect(rect.x, rect.y, rect.width, rect.height)
        context.setLineDash([])
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
      // Only the segments that are new, from the last point already drawn.
      const from = Math.max(overlayDrawn.current - 1, 0)
      if (g.points.length > from) {
        paint(context, {
          kind: "stroke",
          stroke: {
            id: "live", colorHex: now.colorHex, width: now.penWidth,
            points: from === 0 ? g.points : g.points.slice(from),
            ...(g.pressures
              ? { pressures: from === 0 ? g.pressures : g.pressures.slice(from) }
              : {}),
            transform: noTransform(), group: null,
          },
        }, now.size)
        overlayDrawn.current = g.points.length
      }
    } else if (overlayDrawn.current > 0 || overlayReset.current) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, top.width, top.height)
      overlayDrawn.current = 0
      overlayReset.current = false
    }

    // The handles are DOM, and sit where the scroll puts them.
    if (now.selection.size > 0 && scrollShown.current !== scrolled) {
      scrollShown.current = scrolled
      setScroll(scrolled)
    }
  }

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])

  // Everything that changes what is COMMITTED repaints the base layer.
  useEffect(() => {
    baseDirty.current = true
    schedule()
  }, [drawing, size, selection, box, placing, gesture?.kind, schedule])

  // The pane's size and the scroll, watched rather than asked for: both
  // move without a re-render of ours.
  useEffect(() => {
    if (!host.current) return
    const measure = () => {
      const rect = host.current!.getBoundingClientRect()
      setSize((was) => was.width === rect.width && was.height === rect.height
        ? was : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host.current)
    return () => observer.disconnect()
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

  /** A gesture begins: it is state once, and a ref from then on. */
  const start = useCallback((next: Gesture) => {
    live.current = next
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
        && event.target.closest(".wm-handle, .wm-label-edit, .wm-textbox-edit, .wm-gutter"))) {
      event.preventDefault(); event.stopPropagation()
      const held = latest.current.drawing
      capture(event)
      start({ kind: "erasing", before: held })
      eraseAt(doc(event))
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
      && event.target.closest(".wm-handle, .wm-label-edit, .wm-textbox-edit, .wm-crop")) return
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

    // Something is armed: this gesture is where it goes.
    if (armed) {
      event.preventDefault(); event.stopPropagation()
      start({ kind: "placing", from: point, to: point })
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
      })
      return
    }
    if (kind === "marquee") {
      event.preventDefault(); event.stopPropagation()
      if (!extend) setSelection(new Set())
      start({ kind: "marquee", from: point, to: point, additive: extend })
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
    start({ kind: "moving", from: point, snapshot: snapshotOf(held, picked), base: held })
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
        case "erasing":
          eraseAt(point)
          break
        case "marquee":
          live.current = { ...g, to: point }
          baseDirty.current = true
          schedule()
          break
        case "placing":
          live.current = { ...g, to: point }
          baseDirty.current = true
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
          const turn = angleAbout(point, g.pivot) - g.from
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
      } else if (g.kind === "placing" && now.placing) {
        let item = placedItem(now.placing, g.from, point, now.size, now.colorHex, now.penWidth)
        if (item?.kind === "connector") {
          // An arrow dropped with an end on a node is ATTACHED to it.
          const startNode = attachableAt(held, g.from, now.size)
          const endNode = attachableAt(held, point, now.size)
          item = { kind: "connector", connector: { ...item.connector, startNode, endNode } }
        }
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
        }
        now.onPlaced()
      } else if (g.kind === "moving" || g.kind === "scaling" || g.kind === "rotating"
        || g.kind === "segment") {
        // The move already went through `onChange` as it happened; this is
        // the one that lands on the undo stack — and only when it moved.
        if (moved) history.record(g.base)
      }
      live.current = null
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
  }, [gesture, doc, change, eraseAt, schedule, publish, history])

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
      if ((event.key === "Backspace" || event.key === "Delete") && picked.size > 0) {
        event.preventDefault()
        change(removing(held, picked))
        setSelection(new Set())
        return
      }
      // ⌃G both ways, and it returns without swallowing the key when there
      // was nothing to do — a watcher that eats a key it did not use is
      // how typing dies.
      if (event.key.toLowerCase() === "g" && event.ctrlKey && !event.metaKey) {
        const next = toggled(picked, held.items)
        if (!next) return
        event.preventDefault()
        change({ items: next })
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

  // MARK: - The handles

  // The handles stand at the corners of the selection, but a thin selection (a
  // flat stroke, a short line) would stack three 22-point buttons on top of one
  // another; they are spread to a box at least this big, and the pivot stays put.
  const MIN_SPAN = 34
  const hb = box ? {
    x: box.x - Math.max(0, (MIN_SPAN - box.width) / 2),
    y: box.y - Math.max(0, (MIN_SPAN - box.height) / 2),
    width: Math.max(box.width, MIN_SPAN),
    height: Math.max(box.height, MIN_SPAN),
  } : null
  const handles = box && hb && !gesture && selection.size > 0 ? (
    <>
      <button className="wm-handle" style={at(hb.x - HANDLE, hb.y - HANDLE, scroll)}
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
                })
              }}>⟳</button>
      <button className="wm-handle" style={at(hb.x + hb.width, hb.y + hb.height, scroll)}
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
                })
              }}>⤡</button>
      <button className="wm-handle" style={at(hb.x + hb.width, hb.y - HANDLE, scroll)}
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
          <button className="wm-handle wm-handle-wide" style={at(hb.x - HANDLE, hb.y + hb.height / 2, scroll)}
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
                  style={at(hb.x + hb.width / 2 - HANDLE, hb.y + hb.height, scroll)}
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
                    })
                  }} />
        ))
      })}
      {selection.size > 1 && (
        <button className="wm-handle wm-handle-wide" style={at(hb.x - HANDLE, hb.y + hb.height, scroll)}
                title="Hold these together (⌃G)"
                onPointerDown={(event) => {
                  event.preventDefault(); event.stopPropagation()
                  const next = toggled(selection, drawing.items)
                  if (next) change({ items: next })
                }}>⌃G</button>
      )}
    </>
  ) : null

  // MARK: - A node's label

  const labelled = labelling
    ? drawing.items.find((item) => itemId(item) === labelling.id) : undefined
  const labelCancelled = useRef(false)
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
                   start({ kind: "cropping", corner: index })
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

/** One object, drawn where it is now. */
function paint(context: CanvasRenderingContext2D, item: CanvasItem, size: Size,
  onPictureLoad: () => void = () => {}, editing: string | null = null): void {
  const place = (point: Point) => applyMatrix(item, size, point)
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
        // A pen stroke: each segment at the mean of its ends' pressure.
        // Runs of segments whose width rounds to the same quarter pixel go
        // down as ONE path: a stroke is hundreds of segments and a draw call
        // for each was most of what a repaint cost.
        const base = context.lineWidth
        let runWidth = -1
        context.beginPath()
        for (let i = 1; i < points.length; i++) {
          const width = Math.max(0.25, Math.round(
            base * pressureScale((pressures[i - 1]! + pressures[i]!) / 2) * 4) / 4)
          if (width !== runWidth) {
            if (runWidth >= 0) context.stroke()
            runWidth = width
            context.lineWidth = width
            context.beginPath()
          }
          context.moveTo(points[i - 1]!.x, points[i - 1]!.y)
          context.lineTo(points[i]!.x, points[i]!.y)
        }
        context.stroke()
        return
      }
      context.beginPath()
      context.moveTo(points[0]!.x, points[0]!.y)
      for (const point of points.slice(1)) context.lineTo(point.x, point.y)
      if (points.length === 1) context.lineTo(points[0]!.x + 0.01, points[0]!.y)
      context.stroke()
      return
    }
    case "shape": {
      const shape = item.shape
      if (shape.kind === "text") { paintTextBox(context, item, size, editing === shape.id); return }
      const lines = polylines(shape.kind, bounds(item, size).width > 0
        ? baseBoxOf(item, size)
        : baseBoxOf(item, size))
      context.strokeStyle = shape.colorHex
      context.lineWidth = shape.lineWidth * shape.transform.scale
      for (const line of lines) {
        const points = line.map(place)
        context.beginPath()
        context.moveTo(points[0]!.x, points[0]!.y)
        for (const point of points.slice(1)) context.lineTo(point.x, point.y)
        if (unitPolylines(shape.kind).length === 1 && isClosedKind(shape.kind)) context.closePath()
        if (shape.fillHex) { context.fillStyle = shape.fillHex; context.fill() }
        context.stroke()
      }
      if (shape.label) {
        const where = place({ x: baseBoxOf(item, size).x + baseBoxOf(item, size).width / 2,
          y: baseBoxOf(item, size).y + baseBoxOf(item, size).height / 2 })
        context.fillStyle = shape.colorHex
        context.font = "13px -apple-system, Segoe UI, system-ui, sans-serif"
        context.textAlign = "center"
        context.textBaseline = "middle"
        context.fillText(shape.label, where.x, where.y)
      }
      return
    }
    case "connector": {
      const points = route(item.connector).map((point) =>
        place({ x: point.x * size.width, y: point.y * size.height }))
      context.strokeStyle = item.connector.colorHex
      context.lineWidth = item.connector.lineWidth * item.connector.transform.scale
      context.setLineDash(item.connector.line === "dashed"
        ? [item.connector.lineWidth * 4, item.connector.lineWidth * 3]
        : item.connector.line === "dotted" ? [0.1, item.connector.lineWidth * 2.2] : [])
      context.beginPath()
      context.moveTo(points[0]!.x, points[0]!.y)
      for (const point of points.slice(1)) context.lineTo(point.x, point.y)
      context.stroke()
      context.setLineDash([])
      const head = (tip: Point, from: Point) => {
        const length = headLength(item.connector.lineWidth)
        const dx = tip.x - from.x, dy = tip.y - from.y
        const reach = Math.max(Math.hypot(dx, dy), 0.001)
        const ux = dx / reach, uy = dy / reach
        const base = { x: tip.x - ux * length, y: tip.y - uy * length }
        const half = length * 0.45
        context.fillStyle = item.connector.colorHex
        context.beginPath()
        context.moveTo(tip.x, tip.y)
        context.lineTo(base.x - uy * half, base.y + ux * half)
        context.lineTo(base.x + uy * half, base.y - ux * half)
        context.closePath()
        context.fill()
      }
      if (item.connector.endHead === "arrow") head(points.at(-1)!, points.at(-2)!)
      if (item.connector.startHead === "arrow") head(points[0]!, points[1]!)
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

const isClosedKind = (kind: CanvasItem extends never ? never : Parameters<typeof polylines>[0]): boolean =>
  !(kind === "check" || kind === "cross" || kind === "question")

export const emptyCanvas = emptyDrawing
