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
  applyMatrix, angleAbout, baseBounds, baseCenter, basePoints, bounds, boundsOf, emptyDrawing,
  headLength, idsTouching,
  indexAt, isHidden, itemId, itemTransform, newID, noTransform, placedItem, polylines, rectFrom,
  removing, route, scaleFactor, toggled, transformed, unitPolylines, whole, withTransform,
  type CanvasItem, type Drawing, type ItemTransform, type Placement, type Point, type Rect,
  type Size,
} from "@writemind/core"

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
}

type Gesture =
  | { kind: "drawing"; points: Point[] }
  | { kind: "moving"; from: Point; snapshot: Map<string, ItemTransform> }
  | { kind: "marquee"; from: Point; to: Point; additive: boolean }
  | { kind: "placing"; from: Point; to: Point }
  | { kind: "scaling"; from: Point; pivot: Point; snapshot: Map<string, ItemTransform> }
  | { kind: "rotating"; from: number; pivot: Point; snapshot: Map<string, ItemTransform> }

const HANDLE = 11

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
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [scroll, setScroll] = useState(0)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [command, setCommand] = useState(false)
  const undoStack = useRef<Drawing[]>([])
  const redoStack = useRef<Drawing[]>([])
  /** Bumped when a picture finishes loading, which is a reason to repaint. */
  const [loaded, setLoaded] = useState(0)

  const latest = useRef({ drawing, selection, gesture, placing, mode })
  latest.current = { drawing, selection, gesture, placing, mode }

  useEffect(() => { onSelectionChanged?.(selection.size) }, [selection, onSelectionChanged])

  // The pane's size and the scroll, watched rather than asked for: both
  // move without a re-render of ours.
  useEffect(() => {
    if (!host.current) return
    const measure = () => {
      const box = host.current!.getBoundingClientRect()
      setSize({ width: box.width, height: box.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!scroller) return
    const onScroll = () => setScroll(scroller.scrollTop)
    onScroll()
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [scroller])

  // ⌘ has to be WATCHED, not asked for: the marquee can start anywhere, so
  // the layer has to be ready to take a click over plain text the moment
  // the key goes down, and to stop when it comes up.
  useEffect(() => {
    const flags = (event: KeyboardEvent) => setCommand(event.metaKey || event.ctrlKey)
    window.addEventListener("keydown", flags)
    window.addEventListener("keyup", flags)
    return () => {
      window.removeEventListener("keydown", flags)
      window.removeEventListener("keyup", flags)
    }
  }, [])

  const doc = useCallback((event: { clientX: number; clientY: number }): Point => {
    const box = host.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top + scroll }
  }, [scroll])

  const change = useCallback((next: Drawing) => {
    undoStack.current.push(latest.current.drawing)
    redoStack.current = []
    onChange(next)
  }, [onChange])

  const box = useMemo(() => boundsOf(drawing, selection, size), [drawing, selection, size])

  // MARK: - Drawing

  useEffect(() => {
    const element = canvas.current
    if (!element || size.width === 0) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.floor(size.width * ratio)
    element.height = Math.floor(size.height * ratio)
    const context = element.getContext("2d")!
    context.setTransform(ratio, 0, 0, ratio, 0, -scroll * ratio)
    context.clearRect(0, scroll, size.width, size.height)

    for (const item of drawing.items) {
      if (isHidden(item)) continue
      paint(context, item, size, () => setLoaded((tick) => tick + 1))
    }
    if (gesture?.kind === "drawing" && gesture.points.length > 0) {
      paint(context, {
        kind: "stroke",
        stroke: {
          id: "live", colorHex, width: penWidth, points: gesture.points,
          transform: noTransform(), group: null,
        },
      }, size)
    }
    if (gesture?.kind === "placing" && placing) {
      const ghost = placedItem(placing, gesture.from, gesture.to, size, colorHex, penWidth)
      if (ghost) {
        context.globalAlpha = 0.5
        paint(context, ghost, size)
        context.globalAlpha = 1
      }
    }
    if (gesture?.kind === "marquee") {
      const rect = rectFrom(gesture.from, gesture.to)
      context.strokeStyle = "rgba(109,169,240,0.9)"
      context.fillStyle = "rgba(109,169,240,0.12)"
      context.lineWidth = 1
      context.setLineDash([4, 3])
      context.fillRect(rect.x, rect.y, rect.width, rect.height)
      context.strokeRect(rect.x, rect.y, rect.width, rect.height)
      context.setLineDash([])
    }
    if (box) {
      context.strokeStyle = "rgba(109,169,240,0.9)"
      context.lineWidth = 1
      context.setLineDash([5, 3])
      context.strokeRect(box.x - 3, box.y - 3, box.width + 6, box.height + 6)
      context.setLineDash([])
    }
  }, [drawing, size, scroll, gesture, box, colorHex, penWidth, placing, loaded])

  // MARK: - The gestures

  const begin = useCallback((event: PointerEvent) => {
    if (event.button !== 0) return
    const point = doc(event)
    const { drawing: held, placing: armed, mode: now } = latest.current

    // Something is armed: this gesture is where it goes.
    if (armed) {
      event.preventDefault(); event.stopPropagation()
      setGesture({ kind: "placing", from: point, to: point })
      return
    }

    const press = pressKind(now, event.metaKey || event.ctrlKey)
    if (press === "draw") {
      event.preventDefault(); event.stopPropagation()
      setGesture({ kind: "drawing", points: [normalise(point, size)] })
      return
    }
    if (press === "marquee") {
      event.preventDefault(); event.stopPropagation()
      if (!event.shiftKey) setSelection(new Set())
      setGesture({ kind: "marquee", from: point, to: point, additive: event.shiftKey })
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
    const picked = event.shiftKey
      ? new Set([...latest.current.selection, ...whole(new Set([id]), held.items)])
      : (latest.current.selection.has(id)
        ? latest.current.selection
        : whole(new Set([id]), held.items))
    setSelection(picked)
    setGesture({ kind: "moving", from: point, snapshot: snapshotOf(held, picked) })
  }, [doc, size])

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
    return () => element.removeEventListener("pointerdown", down, true)
  }, [begin])

  useEffect(() => {
    if (!gesture) return
    const move = (event: PointerEvent) => {
      const point = doc(event)
      const held = latest.current.drawing
      switch (gesture.kind) {
        case "drawing":
          setGesture({ kind: "drawing", points: [...gesture.points, normalise(point, size)] })
          break
        case "marquee":
          setGesture({ ...gesture, to: point })
          break
        case "placing":
          setGesture({ ...gesture, to: point })
          break
        case "moving": {
          const translate = { dx: point.x - gesture.from.x, dy: point.y - gesture.from.y }
          onChange(edited(held, gesture.snapshot, (item, original) =>
            transformed(item, original, { translate, pivot: { x: 0, y: 0 }, size })))
          break
        }
        case "scaling": {
          const factor = scaleFactor(gesture.from, point, gesture.pivot)
          onChange(edited(held, gesture.snapshot, (item, original) =>
            transformed(item, original, { scale: factor, pivot: gesture.pivot, size })))
          break
        }
        case "rotating": {
          const turn = angleAbout(point, gesture.pivot) - gesture.from
          onChange(edited(held, gesture.snapshot, (item, original) =>
            transformed(item, original, { rotate: turn, pivot: gesture.pivot, size })))
          break
        }
      }
    }
    const up = (event: PointerEvent) => {
      const point = doc(event)
      const held = latest.current.drawing
      if (gesture.kind === "drawing" && gesture.points.length > 1) {
        change({
          items: [...held.items, {
            kind: "stroke",
            stroke: {
              id: newID(), colorHex, width: penWidth, points: gesture.points,
              transform: noTransform(), group: null,
            },
          }],
        })
      } else if (gesture.kind === "marquee") {
        const touched = whole(idsTouching(held, rectFrom(gesture.from, point), size), held.items)
        setSelection(gesture.additive ? new Set([...latest.current.selection, ...touched]) : touched)
      } else if (gesture.kind === "placing" && latest.current.placing) {
        const item = placedItem(latest.current.placing, gesture.from, point, size, colorHex, penWidth)
        if (item) {
          change({ items: [...held.items, item] })
          setSelection(new Set([itemId(item)]))
        }
        onPlaced()
      } else if (gesture.kind === "moving" || gesture.kind === "scaling" || gesture.kind === "rotating") {
        // The move already went through `onChange` as it happened; this is
        // the one that lands on the undo stack.
        undoStack.current.push(drawingWith(held, gesture.snapshot))
        redoStack.current = []
      }
      setGesture(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [gesture, doc, size, colorHex, penWidth, change, onChange, onPlaced])

  // MARK: - Keys the layer watches

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const held = latest.current.drawing
      const picked = latest.current.selection
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
      if (event.key.toLowerCase() === "z" && event.metaKey && event.altKey) {
        event.preventDefault()
        if (event.shiftKey) {
          const next = redoStack.current.pop()
          if (next) { undoStack.current.push(latest.current.drawing); onChange(next) }
        } else {
          const next = undoStack.current.pop()
          if (next) { redoStack.current.push(latest.current.drawing); onChange(next) }
        }
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [change, onChange, onPlaced])

  // MARK: - The handles

  const handles = box && !gesture && selection.size > 0 ? (
    <>
      <button className="wm-handle" style={at(box.x - HANDLE, box.y - HANDLE, scroll)}
              title="Turn"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                const pivot = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
                setGesture({
                  kind: "rotating",
                  from: angleAbout(doc(event.nativeEvent), pivot),
                  pivot,
                  snapshot: snapshotOf(drawing, selection),
                })
              }}>⟳</button>
      <button className="wm-handle" style={at(box.x + box.width, box.y + box.height, scroll)}
              title="Resize"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                const pivot = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
                setGesture({
                  kind: "scaling",
                  from: doc(event.nativeEvent),
                  pivot,
                  snapshot: snapshotOf(drawing, selection),
                })
              }}>⤡</button>
      <button className="wm-handle" style={at(box.x + box.width, box.y - HANDLE, scroll)}
              title="Delete"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation()
                change(removing(drawing, selection))
                setSelection(new Set())
              }}>✕</button>
      {selection.size > 1 && (
        <button className="wm-handle wm-handle-wide" style={at(box.x - HANDLE, box.y + box.height, scroll)}
                title="Hold these together (⌃G)"
                onPointerDown={(event) => {
                  event.preventDefault(); event.stopPropagation()
                  const next = toggled(selection, drawing.items)
                  if (next) change({ items: next })
                }}>⌃G</button>
      )}
    </>
  ) : null

  // With the pen up and nothing armed the layer is see-through to clicks:
  // the notebook gets them all, and the capture listener above takes back
  // only the ones that land on an object.
  const grabs = mode === "pen" || placing !== null || command || gesture !== null

  return (
    <div className="wm-canvas" ref={host}
         style={{ pointerEvents: grabs ? "auto" : "none", cursor: cursorFor(mode, placing, command) }}>
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      <div className="wm-handles" style={{ pointerEvents: "auto" }}>{handles}</div>
    </div>
  )
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

const normalise = (point: Point, size: Size): Point =>
  ({ x: point.x / Math.max(size.width, 1), y: point.y / Math.max(size.height, 1) })

const snapshotOf = (drawing: Drawing, ids: Set<string>): Map<string, ItemTransform> => {
  const out = new Map<string, ItemTransform>()
  for (const item of drawing.items) {
    if (ids.has(itemId(item))) out.set(itemId(item), itemTransform(item))
  }
  return out
}

const drawingWith = (drawing: Drawing, snapshot: Map<string, ItemTransform>): Drawing => ({
  items: drawing.items.map((item) => {
    const was = snapshot.get(itemId(item))
    return was ? withTransform(item, was) : item
  }),
})

const edited = (drawing: Drawing, snapshot: Map<string, ItemTransform>,
  make: (item: CanvasItem, original: ItemTransform) => ItemTransform): Drawing => ({
  items: drawing.items.map((item) => {
    const original = snapshot.get(itemId(item))
    return original ? withTransform(item, make(item, original)) : item
  }),
})

/** One object, drawn where it is now. */
function paint(context: CanvasRenderingContext2D, item: CanvasItem, size: Size,
  onPictureLoad: () => void = () => {}): void {
  const place = (point: Point) => applyMatrix(item, size, point)
  context.lineCap = "round"
  context.lineJoin = "round"

  switch (item.kind) {
    case "stroke": {
      const points = basePoints(item, size).map(place)
      if (points.length === 0) return
      context.strokeStyle = item.stroke.colorHex
      context.lineWidth = item.stroke.width * item.stroke.transform.scale
      context.beginPath()
      context.moveTo(points[0]!.x, points[0]!.y)
      for (const point of points.slice(1)) context.lineTo(point.x, point.y)
      if (points.length === 1) context.lineTo(points[0]!.x + 0.01, points[0]!.y)
      context.stroke()
      return
    }
    case "shape": {
      const shape = item.shape
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
