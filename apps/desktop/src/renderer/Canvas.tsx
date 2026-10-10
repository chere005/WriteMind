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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import {
  applyMatrix, matrixOf, angleAbout, attachableAt, baseBounds, baseCenter, basePoints, bounds, boundsOf, connectorPaths,
  copiedItems, cornerRadius, cropRect, cropped, dashPattern, distance, emptyDrawing, hitTest, idsTouching,
  isClosed, isNode, isRouted, nudged, pressureScale, placedCenter, reconnect, reordered, restyled,
  segmentMidpoints, shifted, strokeCurve, TEXT_BOX, textBoxAspect, textBoxHeight, readableInk,
  indexAt, isHidden, itemId, itemTransform, newID, noTransform, placedItem, polylines, rectFrom,
  removing, route, stillPicked, strokesSwept, toggle, toggled, transformed, whole, withTransform,
  cellFrame, dockable, inkCellOf, toPage, withInkCell, INK_PAD, undockedInk, undockedPicture, inkFileName,
  type CanvasItem, type Column, type ConnectorItem, type Drawing, type InkCell, type ItemTransform, type Order,
  type Placement, type Measure, type Point, type Rect, type ShapeKind, type Size, type StylePatch,
} from "@writemind/core"
import type { EditorView } from "@codemirror/view"
import { inkCellPlaces, pictureCellLine, repaintInkCells, type DropTarget } from "@writemind/editor"
import type { DrawingHistory } from "./drawingHistory"
import { dockedAsCell, dockInto, undockLine, type DockDeps, type Words } from "./dock"
import { returnFocusSoon } from "./focusReturn"
import { Inspector } from "./Inspector"
import { Icon } from "./icons"
import {
  edgesFor, handleAt, handleCursor, handleLayout, handleTitle, outward, resizeBy, stretchedDrawing, stretches,
  OUTLINE_PAD, PILL_REACH, PILL_SPACING, ROTATE_REACH,
  type Edge, type HandleId, type HandleLayout, type RingId,
} from "./handles"
import {
  BAR_HEIGHT, estimatedWidth, inspectorPlan, inspectorSpot, pointBox, sideAwayFrom, wantsRing, type Control,
} from "./inspectorRules"
import { penSettings, usePenSettings } from "./penSettings"
import { holdBegins, inContact, insideBox, penLifted, resolvePress, slotOf } from "./penButtons"
import { registerPenHandlers } from "./penActions"
import { endInkScope, inkScope, scopedPress, subscribeInkScope } from "./inkScope"
import { layerKey } from "./layerKeys"
import { hoverHandles, hoverWanted, sameHover, type Hover } from "./drawingHover"

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
  /** The note this layer is the drawing of: a picture made here (a crop) is an entry of THIS note, not of whichever is in front. */
  note?: string | null
  /** The app's undo for the drawing: shared, so a paste or a capture can be taken back too. */
  history: DrawingHistory
  /** The editor's side of docking (inkCells.ts `dockHostFor`): no dock handle without it. */
  dock?: DockHost
}

/**
 * What the drawing layer needs of the editor to dock picked objects into the note (docs\PLAN-docking-ink-cells.md
 * (d)): the words, what is under the pointer during a drag (shown as it is found: the drop bar on a seam, `.wm-drop`
 * on an ink cell), and the text column.
 */
export interface DockHost {
  words: Words
  /** The drop target under a client point, shown; null outside the note. */
  target(x: number, y: number): DropTarget | null
  /** Put the drop bar and a lit cell away. */
  clear(): void
  /** The text column in CLIENT px (the layer makes it page px). */
  column(): Column
  depth: number
  /** Told the drawing a dock is about to apply (DockDeps.ahead). */
  ahead?(next: Drawing | null): void
}

/**
 * WHERE A GESTURE WORKS (docs\PLAN-docking-ink-cells.md (b)): the page, or one live ink cell. A cell's items are
 * fractions of its shown width `W` on both axes, so every function of the layer works on them unchanged with
 * `size = cellFrame(W)` and points local to the cell's top-left. A gesture keeps the surface it began on: a stroke
 * started in a cell and run out of it is clipped there, an erase started on the page never touches a cell's ink.
 */
interface Surface {
  /** The ink cell's id; null for the page. */
  cell: string | null
  /** Its top-left, in page px (the layer's document coordinates). */
  origin: Point
  /** What its items are measured in: the pane, or `cellFrame(W)`. */
  size: Size
  /** The cell's box in page px (its live ink is clipped to it, a move stays inside it); null for the page. */
  clip: Rect | null
}

/** A move of the docking handle past this many px is a drag (to a seam or a cell); less is a click (at the cursor). */
const DRAG_THRESHOLD = 4

const NOTHING: Drawing = { items: [] }

/** The layer a surface works on: the page's drawing, or one cell's own items; null when the cell is gone. */
const layerIn = (drawing: Drawing, cell: string | null): Drawing | null => {
  if (cell === null) return drawing
  const found = inkCellOf(drawing, cell)
  return found ? cellLayers(found) : null
}
/** One `{ items }` per cell object, so a pick in a cell does not see a "new" layer on every render. */
const layerCache = new WeakMap<InkCell, Drawing>()
const cellLayers = (cell: InkCell): Drawing => {
  let held = layerCache.get(cell)
  if (!held) { held = { items: cell.items }; layerCache.set(cell, held) }
  return held
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
  /** A resize handle: `handle` says which, `box` is the selection's box on the surface as the press found it (the anchor is worked out from it). */
  | { kind: "scaling"; from: Point; handle: RingId | "pill-resize"; box: Rect; snapshot: Map<string, ItemTransform>; base: Drawing }
  /** An edge handle of a node or a text box: the edge moves, the opposite one stays (handles.ts `stretchedItem`). */
  | { kind: "stretching"; id: string; edge: Edge; from: Point; base: Drawing }
  | { kind: "rotating"; from: number; pivot: Point; snapshot: Map<string, ItemTransform>; base: Drawing }
  | { kind: "segment"; id: string; index: number; vertical: boolean; base: Drawing }
  | { kind: "cropping"; corner: number }
  /**
   * The dock handle held (docs\PLAN-docking-ink-cells.md (d)): `from` / `to` in CLIENT px, `scroll` the page's scroll
   * at the press (the ghost follows the pointer while the wheel scrolls the page under it).
   */
  | { kind: "docking"; ids: Set<string>; from: Point; to: Point; scroll: number; dragging: boolean; target: DropTarget | null }

/** A picture being cropped: the kept part, as fractions of the picture. */
interface Crop { id: string; rect: Rect }

/** A node's label (or a text box's words) being typed; `on` is its surface: the page (null) or an ink cell's id. */
interface Labelling { id: string; text: string; on: string | null }

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
// other paste is the notebook's. A picture is an entry of the archive of the note that holds it, and it
// comes across BY NAME: the note it is pasted into gets its own copy of the entry when it is saved
// (main/wmStore.ts `withNamedMedia`), from whichever note the app has read that holds it.

/** `from` is the surface the objects were copied on (an ink cell's id, or null for the page): they paste back onto it. */
interface ObjectClip { token: string; items: CanvasItem[]; pastes: number; from: string | null }
let objectClipboard: ObjectClip | null = null

/** The objects on the window's own clipboard, as a drawing (null for none): their pictures are held by name, so Clean
 * Up never offers one a paste would still put back (cleanUp.ts `heldBy`). */
export const clipboardDrawing = (): Drawing | null => (objectClipboard ? { items: objectClipboard.items } : null)

function copyObjects(items: CanvasItem[], ids: Set<string>, from: string | null): void {
  const copied = copiedItems(items, ids)
  if (copied.length === 0) return
  const token = newID().slice(0, 8)
  objectClipboard = { token, items: copied, pastes: 0, from }
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

// MARK: - Undocking, asked for by a cell's menu (CellMenu.tsx)

/** A docked cell to take back out of the note: its widget (either pane), and the ink cell's id or the picture's file. */
export interface UndockTarget { view: EditorView; element: HTMLElement; ink: string | null; file: string | null }
/** The drawing layer of the note in front, while there is one. */
let undocker: ((target: UndockTarget) => boolean) | null = null
/**
 * Take a docked picture or a drawing cell back out of the note onto the drawing layer, over the note where it was
 * shown, its objects picked; ONE Undo puts the cell back. False when there is no drawing layer or the cell is gone.
 */
export const undockCell = (target: UndockTarget): boolean => undocker?.(target) ?? false

/** The text box being typed into inside an ink cell: `paintInkCell` leaves its words to the field over it. */
let typingInCell: string | null = null

export function Canvas({
  drawing, onChange, mode, colorHex, penWidth, placing, onPlaced, scroller, onSelectionChanged,
  onReadPicture, history, dock, note,
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
  //
  // A PICK IS ON ONE SURFACE: the page (`on` null) or one ink cell (its id); its ids are that surface's items.
  const [pick, setPick] = useState<{ on: string | null; ids: Set<string> }>(() => ({ on: null, ids: new Set() }))
  const pickedIds = pick.ids
  /** The surface the gesture under way works on (`begin` picks it); a new pick lands on it unless told otherwise. */
  const surfaceRef = useRef<Surface>({ cell: null, origin: { x: 0, y: 0 }, size: { width: 0, height: 0 }, clip: null })
  const setSelection = useCallback((ids: Set<string>, on?: string | null) => {
    setPick({ ids, on: ids.size === 0 ? null : on !== undefined ? on : surfaceRef.current.cell })
  }, [])
  const pickLayer = useMemo(() => layerIn(drawing, pick.on) ?? NOTHING, [drawing, pick.on])
  const selection = useMemo(() => stillPicked(pickLayer, pickedIds), [pickLayer, pickedIds])
  useEffect(() => { if (selection !== pickedIds) setSelection(selection, pick.on) }, [selection, pickedIds, pick.on, setSelection])
  /** What a click would take (see `Hover`): set by the pointer moving, never by anything that edits. */
  const [hover, setHoverState] = useState<Hover | null>(null)
  const hoverRef = useRef<Hover | null>(null)
  const setHover = useCallback((next: Hover | null) => {
    if (sameHover(hoverRef.current, next)) return
    hoverRef.current = next
    setHoverState(next)
  }, [])
  // The cells move with the words (text typed above one, a window made wider): a pick in a cell is put back on it.
  const [placesMoved, setPlacesMoved] = useState(0)
  const pickOn = useRef<string | null>(null)
  pickOn.current = pick.on
  useEffect(() => inkCellPlaces.subscribe(() => {
    if (pickOn.current !== null) setPlacesMoved((n) => n + 1)
    // An object hovered in a cell that moved is no longer under the pointer.
    if (hoverRef.current !== null && hoverRef.current.on !== null) setHover(null)
  }), [setHover])
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
  const labellingRef = useRef(labelling)
  labellingRef.current = labelling
  /** The text box being typed into: the painter leaves its words to the field over it. */
  const editingBox = useRef<string | null>(null)
  const lastPress = useRef<{ at: number; id: string } | null>(null)
  /** A text box's editing counts as ONE undo: whether this session has taken its snapshot. */
  const openBox = useRef(false)
  /**
   * The arrow just drawn (its id): the inspector over it is the heads row alone, anchored at its end (Sean's wireframe:
   * the arrow tool no longer opens the whole inspector over the node it has just joined). Any other pick, a press on
   * the arrow itself or Escape makes it the whole bar.
   */
  const [compact, setCompact] = useState<string | null>(null)
  /** Which of the inspector's popovers is open (its control), if any. */
  const [pop, setPop] = useState<Control | null>(null)
  /** The inspector's measured size, so it can be stood where it fits. */
  const [barSize, setBarSize] = useState<Size | null>(null)
  /** Enter on an open crop box: set up below, where the crop is. */
  const confirmCrop = useRef<() => void>(() => {})

  // MARK: - Surfaces

  // (These helpers read only refs, so a callback made on an earlier render can call them.)
  const scrollerRef = useRef(scroller)
  scrollerRef.current = scroller
  /** A live ink cell as a surface, measured now; null when it is not on the screen (or not live). */
  const cellSurfaceOf = (id: string): Surface | null => {
    const element = host.current
    const within = scrollerRef.current
    const place = element && within ? inkCellPlaces.byId(id, within) : null
    if (!element || !place || !place.live) return null
    const cell = place.box()
    if (!(cell.width > 0)) return null
    const pane = element.getBoundingClientRect()
    const origin = { x: cell.left - pane.left, y: cell.top - pane.top + scrollRef.current }
    return { cell: id, origin, size: cellFrame(cell.width), clip: { ...origin, width: cell.width, height: cell.height } }
  }
  /** The page as a surface. */
  const pageSurface = (): Surface => ({ cell: null, origin: { x: 0, y: 0 }, size: latest.current.size, clip: null })
  /** The surface under a client point: a live ink cell, else the page. */
  const surfaceUnder = (x: number, y: number): Surface => {
    const within = scrollerRef.current
    const place = within ? inkCellPlaces.at(x, y, within) : null
    return (place && place.live ? cellSurfaceOf(place.id) : null) ?? pageSurface()
  }
  /** An ink cell's resize strip under a client point (the editor's `.wm-cell-resize`), or null. */
  const stripAt = (x: number, y: number): HTMLElement | null => {
    const within = scrollerRef.current
    if (!within) return null
    for (const strip of within.querySelectorAll<HTMLElement>(".wm-cell-resize")) {
      const r = strip.getBoundingClientRect()
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return strip
    }
    return null
  }
  /** The surface the pick is on, measured now; null when its cell is off the screen. */
  const pickedSurface = (): Surface | null => {
    const on = latest.current.pick.on
    return on === null ? pageSurface() : cellSurfaceOf(on)
  }
  /** The layer a surface works on, as it is now. */
  const layerOf = (s: Surface): Drawing | null => layerIn(latest.current.drawing, s.cell)
  /** A point of a pointer event in a surface's own coordinates. */
  const docOn = (s: Surface, event: { clientX: number; clientY: number }): Point => {
    const rect = host.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left - s.origin.x, y: event.clientY - rect.top + scrollRef.current - s.origin.y }
  }

  // The selection's box, in page px whatever surface it is on (the handles and the dashed box stand on it).
  const box = useMemo(() => {
    if (pick.on === null) return boundsOf(drawing, selection, size)
    const s = cellSurfaceOf(pick.on)
    const b = s ? boundsOf(pickLayer, selection, s.size) : null
    return b && s ? { x: b.x + s.origin.x, y: b.y + s.origin.y, width: b.width, height: b.height } : null
    // (`placesMoved`: the cell moved under the pick.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, selection, size, pick.on, pickLayer, placesMoved])

  const latest = useRef({
    drawing, selection, gesture, placing, mode, size, colorHex, penWidth, onChange, onPlaced, box,
    crop, compact, pop, pick, pickLayer, dock,
  })
  latest.current = {
    ...latest.current,
    drawing, selection, gesture, placing, mode, size, colorHex, penWidth, onChange, onPlaced, box,
    crop, compact, pop, pick, pickLayer, dock,
  }

  /**
   * EVERY change to the drawing goes through here, and a drawing that has
   * been changed has its lines put back on their nodes: a node moved,
   * scaled, turned, resized or deleted takes its arrows with it.
   */
  const publish = useCallback((next: Drawing) => {
    latest.current.onChange(reconnect(next, latest.current.size))
  }, [])

  /**
   * THE ONE FUNNEL FROM A SURFACE'S LAYER TO THE WHOLE DRAWING: the page's layer IS the drawing; a cell's layer goes
   * back into its item, its lines put back on its nodes in the cell's own frame (never the pane's). History records
   * the WHOLE drawing, so Undo needs nothing new.
   */
  const commit = (s: Surface, next: Drawing): Drawing => {
    if (s.cell === null) return reconnect(next, latest.current.size)
    const whole_ = latest.current.drawing
    const cell = inkCellOf(whole_, s.cell)
    return cell ? withInkCell(whole_, { ...cell, items: reconnect(next, s.size).items }) : whole_
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  /** A surface's layer, changed as it goes (a move, a scale, a turn: recorded once at the release). */
  const publishOn = useCallback((s: Surface, next: Drawing) => {
    latest.current.onChange(commitRef.current(s, next))
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

  // The pen / cursor mode changing, or a tool being armed, puts the layer's pick, crop box, inspector and label
  // away (the Mac does the same): the handles of a picked shape no longer stay up once the pen goes down.
  const toolArmed_ = placing !== null
  const modeSeen = useRef({ mode, armed: toolArmed_ })
  useEffect(() => {
    const was = modeSeen.current
    modeSeen.current = { mode, armed: toolArmed_ }
    if (was.mode === mode && (was.armed || !toolArmed_)) return
    setSelection(new Set()); setCrop(null); setCompact(null); setPop(null); setLabelling(null); setHover(null)
  }, [mode, toolArmed_])

  useEffect(() => { onSelectionChanged?.(selection.size) }, [selection, onSelectionChanged])
  // The compact bar belongs to the arrow it was drawn for, and a popover to the pick it was opened on.
  const pickKey = useMemo(() => [...selection].sort().join(","), [selection])
  useEffect(() => {
    if (selection.size === 0) setCompact(null)
    else if (compact !== null && !(selection.size === 1 && selection.has(compact))) setCompact(null)
    setPop(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey])

  // Objects the app has just put on the layer (a pasted or dropped picture, a
  // capture) arrive picked up, with the handles on them, as a shape does.
  useEffect(() => {
    const ids = history.takeSelection((id) => drawing.items.some((item) => itemId(item) === id))
    if (ids) setSelection(whole(new Set(ids), drawing.items), null)
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
  // A SCROLL REPAINTED BOTH LAYERS EVERY FRAME, blank or not (perf lane, 2026-10-05): clearing and re-uploading two
  // window-sized canvases on each scroll step cost a dropped frame on most wheel steps, in a note with no drawing at
  // all. A layer that holds nothing is left alone; and an object's bounds (for the culling below) are worked out
  // once per object and pane size, not for every object on every scroll frame.
  //
  // THE COMMITTED INK SCROLLS WITH THE WORDS. The base layer used to stay put over the page and be painted again,
  // shifted, on every scroll frame: with ink on the screen that was a dropped frame on nearly every wheel step
  // (195 of ~740 frames over 240 steps, against 51 with the layer hidden), and the ink trailed the words by a frame
  // while they moved. ANY change to it per frame cost the same (a CSS transform did too). So the base canvas lives
  // INSIDE the editor's scroller, three panes tall (the BAND: a pane above and one below the page), and the browser
  // scrolls it with the words; it is painted again only when the page leaves the band, about once a pane. It never
  // reaches past the words' own end, so it cannot lengthen the page. (The live stroke stays on the overlay, which
  // does not move.)
  const basePainted = useRef(true)
  const overlayInk = useRef(true)
  const boundsCache = useRef(new WeakMap<CanvasItem, { width: number; height: number; rect: Rect }>())
  /** Where the base canvas is in the scroller (document pixels), for which canvas, at what density and width. */
  const band = useRef<{ top: number; height: number; width: number; ratio: number; element: HTMLCanvasElement } | null>(null)
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
    // The base canvas's stretch of the note: the band, when it is in the scroller (see `band`), else the page.
    let paintTop = scrolled
    let paintHeight = now.size.height
    let paintWidth = now.size.width
    if (scroller && element.parentElement === scroller) {
      const pane = now.size.height
      const was = band.current
      if (baseDirty.current || !was || was.element !== element || was.ratio !== ratio
        || scrolled < was.top || scrolled + pane > was.top + was.height) {
        // (Layout is read only here: when something changed, or about once a pane of scrolling.)
        const content = scroller.querySelector<HTMLElement>(".cm-content")
        const end = Math.max(pane, content ? content.offsetTop + content.offsetHeight : pane)
        const width = Math.min(now.size.width, scroller.clientWidth || now.size.width)
        const fits = was !== null && was.element === element && was.ratio === ratio && was.width === width
          && scrolled >= was.top && scrolled + pane <= was.top + was.height && was.top + was.height <= end
        if (!fits) {
          const from = Math.max(0, Math.min(scrolled - pane, end - 3 * pane))
          const tall = Math.max(1, Math.min(3 * pane, end - from), scrolled + pane - from)
          band.current = { top: from, height: tall, width, ratio, element }
          element.style.top = `${from}px`
          element.style.height = `${tall}px`
          element.style.width = `${width}px`
          baseDirty.current = true
        }
      }
      paintTop = band.current!.top
      paintHeight = band.current!.height
      paintWidth = band.current!.width
    }
    // Setting a canvas's size clears it AND reallocates its backing store:
    // only when it really changed.
    const bw = Math.floor(paintWidth * ratio)
    const bh = Math.floor(paintHeight * ratio)
    if (element.width !== bw || element.height !== bh) {
      element.width = bw; element.height = bh; baseDirty.current = true; basePainted.current = false
    }
    if (top.width !== w || top.height !== h) {
      top.width = w; top.height = h; overlayReset.current = true; overlayInk.current = false
    }

    if (baseDirty.current) {
      baseDirty.current = false
      const view = { top: paintTop - 40, bottom: paintTop + paintHeight + 40 }
      const shown: CanvasItem[] = []
      for (const item of now.drawing.items) {
        if (isHidden(item)) continue
        // Objects wholly off the screen are not painted at all.
        let known = boundsCache.current.get(item)
        if (!known || known.width !== now.size.width || known.height !== now.size.height) {
          known = { width: now.size.width, height: now.size.height, rect: bounds(item, now.size) }
          boundsCache.current.set(item, known)
        }
        const where = known.rect
        if (where.y + where.height < view.top || where.y > view.bottom) continue
        shown.push(item)
      }
      const context = element.getContext("2d")!
      if (shown.length > 0 || now.box || basePainted.current) {
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, element.width, element.height)
        basePainted.current = shown.length > 0 || !!now.box
      }
      context.setTransform(ratio, 0, 0, ratio, 0, -paintTop * ratio)
      for (const item of shown) {
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
    // The gesture's surface: a stroke or a marquee in an ink cell is drawn at the cell, in its frame, clipped to it.
    const s = surfaceRef.current
    const frameSize = s.cell === null ? now.size : s.size
    if (g?.kind === "drawing" && g.points.length > 0) {
      if (overlayReset.current) {
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, top.width, top.height)
        overlayDrawn.current = 0
        overlayReset.current = false
      }
      context.setTransform(ratio, 0, 0, ratio, s.origin.x * ratio, (s.origin.y - scrolled) * ratio)
      if (s.clip) {
        context.save()
        context.beginPath()
        context.rect(0, 0, s.clip.width, s.clip.height)
        context.clip()
      }
      overlayInk.current = true
      if (g.pressures) {
        // A pen stroke is drawn as it is committed: a smooth line of varying width, piece by piece.
        // `overlayDrawn` counts the pieces already down.
        const pts = g.points, w = frameSize.width, h = frameSize.height
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
        }, frameSize)
        overlayDrawn.current = g.points.length
      }
      if (s.clip) context.restore()
    } else if (g && (g.kind === "marquee" || g.kind === "connecting" || g.kind === "docking"
      || (g.kind === "placing" && now.placing))) {
      // What is being dragged out is painted on the overlay, from scratch each frame: the
      // base layer (every object on the page) is not repainted for a rubber band.
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, top.width, top.height)
      context.setTransform(ratio, 0, 0, ratio, s.origin.x * ratio, (s.origin.y - scrolled) * ratio)
      // A tool used in a drawing cell is drawn in the cell, clipped to it.
      const clipped = s.clip !== null && (g.kind === "connecting" || g.kind === "placing")
      if (clipped) {
        context.save()
        context.beginPath()
        context.rect(0, 0, s.clip!.width, s.clip!.height)
        context.clip()
      }
      if (g.kind === "docking") {
        // The ghost of what is being docked follows the pointer (and the page, should the wheel scroll it).
        const b = now.box
        if (b && g.dragging) {
          const dx = g.to.x - g.from.x, dy = g.to.y - g.from.y + (scrolled - g.scroll)
          context.strokeStyle = "rgba(109,169,240,0.95)"
          context.fillStyle = "rgba(109,169,240,0.14)"
          context.lineWidth = 1.5
          context.setLineDash([5, 3])
          context.fillRect(b.x + dx, b.y + dy, b.width, b.height)
          context.strokeRect(b.x + dx, b.y + dy, b.width, b.height)
          context.setLineDash([])
        }
      } else if (g.kind === "marquee") {
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
        const ghost = placedItem(now.placing, g.from, g.to, frameSize, now.colorHex, now.penWidth)
        if (ghost) {
          context.globalAlpha = 0.5
          paint(context, ghost, frameSize)
          context.globalAlpha = 1
        }
      }
      if (clipped) context.restore()
      overlayDrawn.current = 0
      overlayReset.current = false
      overlayShapes.current = true
      overlayInk.current = true
    } else if (!overlayInk.current) {
      // Blank already: nothing to clear (a scroll used to clear it every frame).
      overlayReset.current = false
    } else if (overlayDrawn.current > 0 || overlayReset.current || overlayShapes.current) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, top.width, top.height)
      overlayInk.current = false
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
      // The ink cells' canvases too: their backing stores follow the density.
      const within = scrollerRef.current
      const views = new Set(within ? inkCellPlaces.all(within).map((place) => place.view) : [])
      for (const view of views) repaintInkCells(view)
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
      // Ink in the scroller moves with it; the render looks at whether the page left the band.
      if (canvas.current?.parentElement !== scroller) baseDirty.current = true
      overlayReset.current = true
      schedule()
    }
    onScroll()
    // A scroll moves the objects under a still pointer: what it was over is asked again at the next move.
    const scrolled = () => setHover(null)
    scroller.addEventListener("scroll", onScroll, { passive: true })
    scroller.addEventListener("scroll", scrolled, { passive: true })
    // The words shrinking (the band may not pass their end) or narrowing (a scroll bar came) put the band out: it
    // is worked out again. (Not on every change of height: the editor refines its heights while it scrolls.)
    const content = scroller.querySelector<HTMLElement>(".cm-content")
    const words = content ? new ResizeObserver(() => {
      const was = band.current
      if (!was) return
      const pane = latest.current.size.height
      const end = Math.max(pane, content!.offsetTop + content!.offsetHeight)
      const width = Math.min(latest.current.size.width, scroller.clientWidth || latest.current.size.width)
      if (was.top + was.height > end || was.width !== width) { baseDirty.current = true; schedule() }
    }) : null
    if (content) words!.observe(content)
    return () => { scroller.removeEventListener("scroll", onScroll); scroller.removeEventListener("scroll", scrolled); words?.disconnect() }
  }, [scroller, schedule, setHover])

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

  /** A pointer's point on the surface of the gesture (`surfaceRef`): the page's document px, or a cell's own px. */
  const doc = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = host.current!.getBoundingClientRect()
    const o = surfaceRef.current.origin
    return { x: event.clientX - rect.left - o.x, y: event.clientY - rect.top + scrollRef.current - o.y }
  }, [])

  /** `next` is the new LAYER of surface `s` (the page's drawing, or a cell's items); one undo step. */
  const change = useCallback((next: Drawing, s: Surface) => {
    // An edit that changed nothing (a delete of ids that are gone) is no edit: no phantom undo step, and Redo lives.
    const held = layerIn(latest.current.drawing, s.cell)
    if (!held) return
    if (next === held || (next.items.length === held.items.length && next.items.every((item, i) => item === held.items[i]))) return
    history.record(latest.current.drawing)
    latest.current.onChange(commitRef.current(s, next))
  }, [history])

  /** An edit that arrives in bursts (a colour dragged, an arrow key held): one undo for the burst (`DrawingHistory.recordBurst`). */
  const burst = useCallback((next: Drawing, s: Surface) => {
    const held = layerIn(latest.current.drawing, s.cell)
    if (!held || next === held) return
    history.recordBurst(latest.current.drawing, performance.now())
    latest.current.onChange(commitRef.current(s, next))
  }, [history])

  const pickedRef = useRef(pickedSurface)
  pickedRef.current = pickedSurface

  const applyStyle = useCallback((patch: StylePatch) => {
    const s = pickedRef.current()
    if (s) burst(restyled(latest.current.pickLayer, latest.current.selection, patch), s)
  }, [burst])

  const orderSelection = useCallback((how: Order) => {
    const s = pickedRef.current()
    const held = latest.current.pickLayer
    const items = reordered(held.items, latest.current.selection, how)
    if (s && items !== held.items) change({ items }, s)
  }, [change])

  /** A copy of what is picked, a little way down and to the right, picked in turn. */
  const duplicate = useCallback(() => {
    const s = pickedRef.current()
    if (!s) return
    const { pickLayer: held, selection: picked } = latest.current
    const copies = shifted(copiedItems(held.items, picked), 16, 16, s.size)
    if (copies.length === 0) return
    change({ items: [...held.items, ...copies] }, s)
    setSelection(new Set(copies.map(itemId)), s.cell)
  }, [change, setSelection])

  /** The whole drawing as a gesture began: what its Undo goes back to. */
  const gestureWhole = useRef<Drawing>(drawing)
  /** A gesture begins: it is state once, and a ref from then on. `pointerId` is the pointer that owns it. */
  const start = useCallback((next: Gesture, pointerId: number) => {
    live.current = next
    owner.current = pointerId
    overlayReset.current = true
    gestureWhole.current = latest.current.drawing
    setHover(null)
    setPop(null)
    // A press on the arrow itself asks for the whole bar.
    if (next.kind === "moving") setCompact(null)
    setGesture(next)
  }, [setHover])

  // MARK: - The gestures

  /** A surface's layer with strokes rubbed out, as the whole drawing (no lines to put back: strokes hold none). */
  const rubbedOut = (s: Surface, ids: Set<string>): Drawing | null => {
    const whole_ = latest.current.drawing
    if (s.cell === null) return removing(whole_, ids)
    const cell = inkCellOf(whole_, s.cell)
    return cell ? withInkCell(whole_, { ...cell, items: removing({ items: cell.items }, ids).items }) : null
  }
  const rubbedRef = useRef(rubbedOut)
  rubbedRef.current = rubbedOut

  /** Rub out the topmost stroke under `point` (on the gesture's surface); the move is one undo, at the lift. */
  const eraseAt = useCallback((point: Point, s: Surface = surfaceRef.current) => {
    const held = layerIn(latest.current.drawing, s.cell)
    if (!held) return
    const size = s.cell === null ? latest.current.size : s.size
    for (let index = held.items.length - 1; index >= 0; index--) {
      const item = held.items[index]!
      if (item.kind !== "stroke" || isHidden(item) || !hitTest(item, point, size)) continue
      const next = rubbedRef.current(s, new Set([itemId(item)]))
      if (!next) return
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
  const eraseAlong = useCallback((from: Point, to: Point, s: Surface = surfaceRef.current) => {
    const held = layerIn(latest.current.drawing, s.cell)
    if (!held) return
    const ids = strokesSwept(held, from, to, s.cell === null ? latest.current.size : s.size)
    if (ids.size === 0) return
    const next = rubbedRef.current(s, ids)
    if (!next) return
    latest.current = { ...latest.current, drawing: next }
    latest.current.onChange(next)
  }, [])

  /** Put a node's label in (an empty one is no label), on the page or in its ink cell (`on`); the edit is one undo. */
  const relabel = useCallback((id: string, text: string, on: string | null) => {
    const s = on === null ? pageSurface() : cellSurfaceOf(on)
    const held = layerIn(latest.current.drawing, on)
    if (!s || !held) return
    const next = {
      items: held.items.map((item) =>
        item.kind === "shape" && item.shape.id === id
          ? { kind: "shape" as const, shape: { ...item.shape, label: text } }
          : item),
    }
    if (JSON.stringify(next) !== JSON.stringify(held)) change(next, s)
    // (`pageSurface` and `cellSurfaceOf` read only refs.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // A pen panning with a side button: lifting the pen (or letting the button go) ends it.
      if (penLifted(e)) { up(e); return }
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
    // AN INK CELL'S RESIZE STRIP IS NOT THE PAGE: with the layer over the note (the pen down, a tool armed) a plain
    // press on a cell's bottom strip is handed to the strip, so the pen resizes a cell as the mouse does (the strip
    // captures the pointer, and the rest of the drag is its own).
    const strip = (event.buttons & ~1) === 0 ? stripAt(event.clientX, event.clientY) : null
    if (strip) {
      if (!(event.target instanceof Node && strip.contains(event.target))) {
        event.preventDefault(); event.stopPropagation()
        strip.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, composed: true, pointerId: event.pointerId, pointerType: event.pointerType,
          isPrimary: event.isPrimary, clientX: event.clientX, clientY: event.clientY, screenX: event.screenX,
          screenY: event.screenY, button: 0, buttons: event.buttons, pressure: event.pressure,
        }))
      }
      return
    }
    // THE SURFACE (docs\PLAN-docking-ink-cells.md (b)): a live ink cell under the pointer, else the page. The
    // gesture keeps it to the end, and `doc()` answers in its coordinates; so a pen-button hold (the press block
    // below) erases or selects in a cell exactly as on the page.
    if (live.current === null) surfaceRef.current = surfaceUnder(event.clientX, event.clientY)
    // Erasing: the pen's eraser end (button 5, buttons bit 32), the pen's side
    // button when it is set to erase (for a pen with no eraser end), or the
    // Erase tool on the toolbar. It rubs out whole strokes in either mode,
    // whatever the pen is set to (penButtons.ts decides, for both surfaces).
    const press = resolvePress(event, penSettings())
    // A pen side button pressed in the air is not a gesture (its double tap is
    // the runtime's, penActions.ts). Nothing here starts.
    if (press.kind === "ignore") {
      if (pen) { event.preventDefault(); event.stopPropagation() }
      return
    }
    // A PEN FOR ONE NEW INK CELL (inkScope.ts): with the pen up, a press in that cell draws there; a press anywhere
    // else ends it and is the click it would have been — never a stroke, even from a pen that always draws.
    const scopeSays = live.current !== null ? "none" : scopedPress(inkScope(), latest.current.mode === "pen",
      surfaceRef.current.cell, press.kind === "draw" && pen && penSettings().penDraws)
    if (scopeSays === "end" || scopeSays === "end-swallow-stroke") endInkScope()
    if (scopeSays === "end-swallow-stroke") return
    const scoped = scopeSays === "draw"
    if (press.kind === "erase" && (pen || event.button === 0)
      && !(event.target instanceof Element
        && event.target.closest(".wm-handle, .wm-insp, .wm-pill, .wm-crop-bar, .wm-label-edit, .wm-textbox-edit, .wm-gutter"))) {
      event.preventDefault(); event.stopPropagation()
      const held = latest.current.drawing
      capture(event)
      const where = doc(event)
      start({ kind: "erasing", before: held, last: where }, event.pointerId)
      eraseAt(where)
      // Floating strokes lying over an ink cell are on top of it: the eraser rubs them out too (the move below).
      if (surfaceRef.current.cell !== null) { const page = pageSurface(); eraseAt(docOn(page, event), page) }
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
      && event.target.closest(".wm-handle, .wm-insp, .wm-pill, .wm-crop-bar, .wm-label-edit, .wm-textbox-edit, .wm-crop")) return
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
    const { placing: armed, mode: now } = latest.current

    // The arrow tool, or ⌥ held down on a node: a line is drawn from here to
    // wherever it is let go, and each end that lands on a node is attached
    // to it. ⌥ has to start ON a node, so it never steals a stroke or a pick.
    // THE TOOLS WORK WHERE THEY ARE PRESSED (2026-10-06): lines, shapes and text boxes go on the page, or INTO the live
    // drawing cell under the press (its own items, its own frame, kept inside it), as its strokes do. A floating node
    // lying over a cell is still the page's: an arrow started on it is drawn on the page.
    const page = pageSurface()
    const onPage = docOn(page, event)
    const under = surfaceRef.current
    const toolArmed = armed?.kind === "line" && armed.tool === true
    // (Not when Alt is the pen's own "Tip + Alt" button: that has its own meaning.)
    let toolSurface = under
    let fromNode: string | null = null
    if (toolArmed || (!armed && event.altKey && !byButton)) {
      fromNode = attachableAt(latest.current.drawing, onPage, page.size)
      if (fromNode !== null) toolSurface = page
      else if (under.cell !== null) {
        const layer = layerOf(under)
        fromNode = layer ? attachableAt(layer, docOn(under, event), under.size) : null
      }
    }
    if (toolArmed || (!armed && fromNode !== null)) {
      event.preventDefault(); event.stopPropagation()
      capture(event)
      surfaceRef.current = toolSurface
      const from = docOn(toolSurface, event)
      start({ kind: "connecting", from, to: from, node: fromNode }, event.pointerId)
      return
    }
    // Something is armed: this gesture is where it goes (the page, or the cell it is pressed in).
    if (armed) {
      event.preventDefault(); event.stopPropagation()
      surfaceRef.current = under
      const from = docOn(under, event)
      start({ kind: "placing", from, to: from }, event.pointerId)
      return
    }

    // The Select tool and the pen's Select button: a press inside the selection's box moves it (penButtons.ts),
    // on whichever surface the selection is (the box is in the pick's own coordinates).
    // Not with Shift (that adds to the pick), and not on an object that is not picked: a press on a small stroke inside
    // a big picked one picks the small one (KEYS.md: "drag an object to move it").
    if (press.kind === "select" && press.move && !event.shiftKey && latest.current.selection.size > 0) {
      const picked = pickedSurface()
      const layer = picked ? layerOf(picked) : null
      const from = picked ? docOn(picked, event) : null
      if (picked && layer && from && insideBox(from, boundsOf(layer, latest.current.selection, picked.size))) {
        const hit = indexAt(layer, from, picked.size)
        if (hit === null || latest.current.selection.has(itemId(layer.items[hit]!))) {
          event.preventDefault(); event.stopPropagation()
          surfaceRef.current = picked
          start({ kind: "moving", from, snapshot: snapshotOf(layer, latest.current.selection), base: layer }, event.pointerId)
          return
        }
      }
    }

    // A FLOATING OBJECT OVER AN INK CELL IS THE PAGE'S: inserting or docking a cell does not move floating ink, so
    // ink that was below the caret can lie over a new cell. A press that does not draw (a pick, the Select tool, a
    // Select hold, Ctrl) takes the page object under the pointer before anything in the cell.
    if (live.current === null && surfaceRef.current.cell !== null
      && (press.kind === "select" || (scoped || (pen && penSettings().penDraws) ? "pen" : now) !== "pen")
      && indexAt(latest.current.drawing, onPage, page.size) !== null) surfaceRef.current = page

    // Everything else works on the gesture's surface: the page, or the ink cell it began in.
    const surface = surfaceRef.current
    const held = layerOf(surface) ?? latest.current.drawing
    const size = surface.cell === null ? latest.current.size : surface.size
    const point = doc(event)
    /** The pick so far, when it is on this surface (a pick is on one surface only). */
    const here = latest.current.pick.on === surface.cell ? latest.current.selection : new Set<string>()

    // A tablet pen writes whatever the mode is (the mouse keeps selecting)
    // unless the person turned that off.
    const mode = scoped || (pen && penSettings().penDraws) ? "pen" : now
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
      setSelection(new Set([id]), surface.cell)
      openBox.current = false
      setLabelling({ id, text: pressed.shape.label, on: surface.cell })
      return
    }
    const picked = event.shiftKey
      ? new Set([...here, ...whole(new Set([id]), held.items)])
      : (here.has(id)
        ? here
        : whole(new Set([id]), held.items))
    setSelection(picked, surface.cell)
    start({ kind: "moving", from: point, snapshot: snapshotOf(held, picked), base: held }, event.pointerId)
  }, [doc, eraseAt, start, scrollWithFinger, setSelection])

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
    // A side button pressed while the pen hovers does nothing; the pen then
    // TOUCHING with it held begins its hold gesture, and that touch is only a
    // pointermove that gains the contact (penButtons.holdBegins).
    let touching = false
    const noted = (event: PointerEvent) => { if (event.pointerType === "pen") touching = inContact(event) }
    const late = (event: PointerEvent) => {
      if (event.pointerType !== "pen") return
      const was = touching
      touching = inContact(event)
      if (live.current || !holdBegins(was, event)) return
      begin(event)
    }
    window.addEventListener("pointerdown", noted, true)
    window.addEventListener("pointerup", noted, true)
    window.addEventListener("pointercancel", noted, true)
    element.addEventListener("pointermove", late, true)
    return () => {
      element.removeEventListener("pointerdown", down, true)
      window.removeEventListener("pointerdown", noted, true)
      window.removeEventListener("pointerup", noted, true)
      window.removeEventListener("pointercancel", noted, true)
      element.removeEventListener("pointermove", late, true)
    }
  }, [begin])

  // MARK: - Hover: what a click would take

  /**
   * `indexAt` for a pointer that moves every frame: an object whose box (kept per object and size, as the painter
   * keeps it) is nowhere near the point is not hit-tested at all, so a note of a thousand strokes costs a few box
   * checks per move, not a thousand outlines.
   */
  const topmostAt = (layer: Drawing, point: Point, frame: Size): number | null => {
    for (let index = layer.items.length - 1; index >= 0; index--) {
      const item = layer.items[index]!
      if (isHidden(item)) continue
      let known = boundsCache.current.get(item)
      if (!known || known.width !== frame.width || known.height !== frame.height) {
        known = { width: frame.width, height: frame.height, rect: bounds(item, frame) }
        boundsCache.current.set(item, known)
      }
      const t = itemTransform(item).scale
      const line = item.kind === "stroke" ? item.stroke.width : item.kind === "shape" ? item.shape.lineWidth
        : item.kind === "connector" ? item.connector.lineWidth : 0
      const pad = 8 + line * t
      const r = known.rect
      if (point.x < r.x - pad || point.x > r.x + r.width + pad || point.y < r.y - pad || point.y > r.y + r.height + pad) continue
      if (hitTest(item, point, frame)) return index
    }
    return null
  }

  /**
   * The object a press here would pick, asked as the pointer moves: the page's topmost object under it, else one in
   * the live ink cell under it. "keep" while the pointer is on a handle (what it stands round stays), "none" over
   * nothing (put away after a moment, so a handle beside the object can still be reached), null when a press here
   * would not pick at all (`hoverWanted`).
   */
  /** The faint handles now on screen (set by the render): a pointer near one of them keeps what they stand round. */
  const keepLayout = useRef<HandleLayout | null>(null)
  const hoverAt = (event: PointerEvent): Hover | "keep" | "none" | null => {
    const now = latest.current
    const settings = penSettings()
    const busy = live.current !== null || now.selection.size > 0 || now.placing !== null || now.crop !== null
      || labellingRef.current !== null
    if (!hoverWanted({
      mode: now.mode, pen: event.pointerType === "pen", penDraws: settings.penDraws, selectTool: settings.selectTool,
      eraser: settings.eraser, command: event.ctrlKey || event.metaKey, buttons: event.buttons, busy,
    })) return null
    const target = event.target
    if (target instanceof Element) {
      if (target.closest(".wm-handle, .wm-insp, .wm-pill")) return "keep"
      // The brackets, the menus, a field being typed in: not the layer's.
      if (target.closest(".wm-gutter, .wm-label-edit, .wm-textbox-edit, .kind-menu, .context-menu, .float-menu")) return null
    }
    // The handles stand ON the outline, half of each outside the object: going from the object to one of them (or
    // along the outline between them) is staying on it, whatever the object under the pointer says for a moment.
    const near = keepLayout.current
    if (near && handleAt(near, docOn(pageSurface(), event), 12) !== null) return "keep"
    const within = scrollerRef.current
    const place = within ? inkCellPlaces.at(event.clientX, event.clientY, within) : null
    // A cell the pointer is a pen for (inkScope.ts) draws at a press: nothing there is what a click would take.
    if (place && place.live && inkScope() === place.id) return null
    const page = pageSurface()
    const top = topmostAt(now.drawing, docOn(page, event), page.size)
    if (top !== null) return { on: null, id: itemId(now.drawing.items[top]!) }
    if (!place || !place.live) return "none"
    const cell = cellSurfaceOf(place.id)
    const layer = cell ? layerOf(cell) : null
    if (!cell || !layer) return "none"
    const hit = topmostAt(layer, docOn(cell, event), cell.size)
    return hit === null ? "none" : { on: place.id, id: itemId(layer.items[hit]!) }
  }
  const hoverAtRef = useRef(hoverAt)
  hoverAtRef.current = hoverAt

  useEffect(() => {
    // On the parent, as the presses are: with the pen up the layer takes no pointer events at all.
    const element = host.current?.parentElement
    if (!element) return
    let frame_: number | null = null
    let last: PointerEvent | null = null
    let leaving: number | null = null
    const stay = () => { if (leaving !== null) { window.clearTimeout(leaving); leaving = null } }
    const look = () => {
      frame_ = null
      const event = last
      last = null
      if (!event) return
      const found = hoverAtRef.current(event)
      if (found === "keep") { stay(); return }
      if (found === null) { stay(); setHover(null); return }
      if (found !== "none") {
        stay()
        // The handles are DOM, placed with the scroll as it is now.
        if (scrollShown.current !== scrollRef.current) { scrollShown.current = scrollRef.current; setScroll(scrollRef.current) }
        setHover(found)
        return
      }
      // Leaving the object for a handle beside it must not take the handle away first (the Mac waits 250 ms).
      if (hoverRef.current !== null && leaving === null) leaving = window.setTimeout(() => { leaving = null; setHover(null) }, 250)
    }
    const move = (event: PointerEvent) => {
      last = event
      if (frame_ === null) frame_ = requestAnimationFrame(look)
    }
    const out = () => { stay(); last = null; setHover(null) }
    element.addEventListener("pointermove", move, { capture: true, passive: true })
    element.addEventListener("pointerleave", out)
    return () => {
      element.removeEventListener("pointermove", move, true)
      element.removeEventListener("pointerleave", out)
      if (frame_ !== null) cancelAnimationFrame(frame_)
      stay()
    }
  }, [setHover])

  // MARK: - Undocking (a cell's menu: CellMenu.tsx)

  useEffect(() => {
    const undock = (target: UndockTarget): boolean => {
      const host_ = latest.current.dock
      const element = host.current
      if (!host_ || !element || !target.element.isConnected) return false
      const line = pictureCellLine(target.view, target.element)
      if (!line) return false
      // The line must still be the cell asked about (the widget could be a stale one).
      const text = target.view.state.doc.sliceString(line.from, line.to)
      const name = target.ink !== null ? inkFileName(target.ink) : target.file
      if (!name || !text.includes(name)) return false
      const pane = latest.current.size
      const whole_ = latest.current.drawing
      let made: { drawing: Drawing; ids: string[] } | null = null
      if (target.ink !== null) {
        // The cell's items float where they were shown: from its top-left, at its shown width.
        const cell = cellSurfaceOf(target.ink)
        if (!cell) return false
        made = undockedInk(whole_, target.ink, pane, cell.origin, cell.size.width)
      } else if (target.file) {
        // The picture floats at the size and the place it had in the note.
        const shown = (target.element.querySelector("img") ?? target.element).getBoundingClientRect()
        const at_ = element.getBoundingClientRect()
        made = undockedPicture(whole_, target.file, pane,
          { x: shown.left - at_.left, y: shown.top - at_.top + scrollRef.current, width: shown.width, height: shown.height })
      }
      if (!made) return false
      if (target.ink !== null && inkScope() === target.ink) endInkScope()
      const deps: DockDeps = {
        history, drawing: () => latest.current.drawing, apply: (next) => latest.current.onChange(next),
        words: host_.words, depth: host_.depth,
      }
      return undockLine(deps, line, made.drawing, made.ids)
    }
    undocker = undock
    return () => { if (undocker === undock) undocker = null }
    // (`cellSurfaceOf` reads only refs.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history])

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
      // A pen gesture lasts while the pen touches: lifting it with a side button still held ends it.
      if (penLifted(event)) { up(event); return }
      const rect = host.current!.getBoundingClientRect()
      // The gesture's own surface: a cell's points are local to its top-left, in its own frame.
      const s = surfaceRef.current
      const at = (e: { clientX: number; clientY: number }): Point =>
        ({ x: e.clientX - rect.left - s.origin.x, y: e.clientY - rect.top + scrollRef.current - s.origin.y })
      const point = at(event)
      const now = latest.current
      const size = s.cell === null ? now.size : s.size
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
          // In a cell, the floating strokes over it are swept too (in page px: the cell's points plus its origin).
          const onPage = (p: Point): Point => ({ x: p.x + s.origin.x, y: p.y + s.origin.y })
          const page: Surface = { cell: null, origin: { x: 0, y: 0 }, size: now.size, clip: null }
          for (const sample of samples.length > 0 ? samples : [event]) {
            const to = at(sample)
            eraseAlong(from, to)
            if (s.cell !== null) eraseAlong(onPage(from), onPage(to), page)
            from = to
          }
          g.last = from
          break
        }
        case "marquee":
          live.current = { ...g, to: point }
          schedule()
          break
        case "placing":
        case "connecting":
          // In a drawing cell what is placed stays inside the cell.
          live.current = { ...g, to: s.clip ? inCell(point, s.clip) : point }
          schedule()
          break
        case "moving": {
          let translate = { dx: point.x - g.from.x, dy: point.y - g.from.y }
          // In an ink cell what is moved stays inside the cell: nothing in it can go over the words.
          if (s.clip) translate = keptInside(translate, boundsOf(g.base, new Set(g.snapshot.keys()), size), s.clip)
          later(() => publishOn(s, edited(g.base, g.snapshot,
            (item, original) => transformed(item, original,
              { translate, pivot: { x: 0, y: 0 }, size }))))
          break
        }
        case "scaling": {
          // The anchor stays put (the opposite corner, or the middle of the opposite edge): handles.ts `resizeBy`.
          const { pivot, factor } = resizeBy(g.handle, g.box, g.from, point)
          later(() => publishOn(s, edited(g.base, g.snapshot,
            (item, original) => transformed(item, original,
              { scale: factor, pivot, size }))))
          break
        }
        case "stretching": {
          // The edge goes where the pointer goes along its own axis; the opposite edge does not move.
          const grow = outward(g.edge, g.from, point)
          later(() => publishOn(s, { items: stretchedDrawing(g.base.items, g.id, g.edge, grow, size, measureTextBox) }))
          break
        }
        case "rotating": {
          let turn = angleAbout(point, g.pivot) - g.from
          // ⇧ turns in 15-degree steps.
          if (event.shiftKey) { const step = Math.PI / 12; turn = Math.round(turn / step) * step }
          later(() => publishOn(s, edited(g.base, g.snapshot,
            (item, original) => transformed(item, original,
              { rotate: turn, pivot: g.pivot, size }))))
          break
        }
        case "docking": {
          // A click stays a click until the pointer has gone a few px; from then on the drop bar (or the lit cell)
          // follows it, and the ghost of the selection with it.
          const dragging = g.dragging || Math.hypot(event.clientX - g.from.x, event.clientY - g.from.y) > DRAG_THRESHOLD
          const target = dragging ? latest.current.dock?.target(event.clientX, event.clientY) ?? null : null
          live.current = { ...g, to: { x: event.clientX, y: event.clientY }, dragging, target }
          schedule()
          break
        }
        case "segment": {
          // The circle on a segment is dragged: the segment goes where the
          // pointer is (a fraction of the pane, in the one coordinate it can
          // move in) and the line is routed again around it.
          const value = g.vertical ? point.x / Math.max(size.width, 1)
            : point.y / Math.max(size.height, 1)
          later(() => publishOn(s, {
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
      // The gesture's surface and its layer (the page's drawing, or the cell's items).
      const s = surfaceRef.current
      const held = layerIn(now.drawing, s.cell) ?? NOTHING
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
        }, s)
      } else if (g.kind === "erasing") {
        if (now.drawing !== g.before) history.record(g.before)
      } else if (g.kind === "marquee") {
        const touched = whole(idsTouching(held, rectFrom(g.from, point), s.cell === null ? now.size : s.size), held.items)
        const kept = g.additive && now.pick.on === s.cell ? now.selection : new Set<string>()
        setSelection(new Set([...kept, ...touched]), s.cell)
      } else if (g.kind === "docking") {
        finishDock(g, event)
      } else if (g.kind === "connecting") {
        // On the page, or in the cell the arrow was started in (its nodes, its frame; the release kept inside it).
        const frame = s.cell === null ? now.size : s.size
        const to = s.clip ? inCell(point, s.clip) : point
        const hit = attachableAt(held, to, frame)
        const endNode = hit === g.node ? null : hit
        // A click is not an arrow; a drag is, and so is a click that started on
        // one node and ended on another.
        if (distance(g.from, to) >= 8 || endNode !== null) {
          const connector: ConnectorItem = {
            id: newID(),
            start: normalise(g.from, frame), end: normalise(to, frame),
            startNode: g.node, endNode,
            startHead: "none", endHead: "arrow", line: "solid", colorHex: now.colorHex,
            lineWidth: Math.min(Math.max(now.penWidth, 1.5), 6),
            transform: noTransform(), bends: [],
          }
          change({ items: [...held.items, { kind: "connector", connector }] }, s)
          setSelection(new Set([connector.id]), s.cell)
          // The bar that comes up once an arrow is drawn: its heads and its line, at its end (not the whole inspector).
          setCompact(connector.id)
        }
      } else if (g.kind === "placing" && now.placing) {
        // A line from the palette runs from the press to the release and is attached to NOTHING (the Mac's
        // CanvasPlacementTests: "a line from the palette is attached to nothing"). The ARROW TOOL is the one
        // that attaches, and it is the `connecting` gesture above; this one used to attach and re-route
        // a palette line too, and one dragged inside a single node ran from that node to itself.
        // In a drawing cell it goes INTO the cell, in the cell's frame, and wholly inside it.
        const frame = s.cell === null ? now.size : s.size
        const to = s.clip ? inCell(point, s.clip) : point
        let item = placedItem(now.placing, g.from, to, frame, now.colorHex, now.penWidth)
        if (item?.kind === "shape" && item.shape.kind === "text") {
          // A text box is born ready for typing, and as tall as an empty line.
          const width = Math.max(TEXT_BOX.minimumWidth, item.shape.width * frame.width)
          item = { kind: "shape", shape: { ...item.shape, width: width / frame.width,
            aspect: textBoxAspect("", width, measureTextBox) } }
        }
        if (item && s.clip) item = keptInCell(item, frame, s.clip)
        if (item?.kind === "shape" && item.shape.kind === "text") {
          change({ items: [...held.items, item] }, s)
          setSelection(new Set([itemId(item)]), s.cell)
          openBox.current = true
          setLabelling({ id: item.shape.id, text: "", on: s.cell })
        } else if (item) {
          change({ items: [...held.items, item] }, s)
          setSelection(new Set([itemId(item)]), s.cell)
          if (item.kind === "connector") setCompact(item.connector.id)
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
      } else if (g.kind === "moving" || g.kind === "scaling" || g.kind === "stretching" || g.kind === "rotating"
        || g.kind === "segment") {
        // The move already went through `onChange` as it happened; this is
        // the one that lands on the undo stack — and only when it moved. (The WHOLE drawing as it began: in a
        // cell `g.base` is the cell's own items.)
        if (moved) history.record(gestureWhole.current)
      }
      live.current = null
      owner.current = null
      baseDirty.current = true
      schedule()
      setGesture(null)
    }

    /** The dock handle let go: a click docks at the cursor, a drag where it was let go (or nowhere, outside the note). */
    const finishDock = (g: Extract<Gesture, { kind: "docking" }>, at: PointerEvent) => {
      const host_ = latest.current.dock
      if (!host_) return
      const target: DropTarget | null = !g.dragging ? { kind: "seam", offset: host_.words.cursorOffset() }
        : at.type === "pointercancel" ? null : host_.target(at.clientX, at.clientY)
      host_.clear()
      const pane = latest.current.size
      const deps: DockDeps = {
        history, drawing: () => latest.current.drawing, apply: (next) => latest.current.onChange(next),
        words: host_.words, depth: host_.depth, ...(host_.ahead ? { ahead: host_.ahead } : {}),
      }
      if (!target) return
      if (target.kind === "seam") {
        const column = host_.column()
        const left = host.current ? host.current.getBoundingClientRect().left : 0
        if (dockedAsCell(deps, g.ids, pane, { left: column.left - left, width: column.width }, target.offset) !== null) {
          setSelection(new Set())
        }
        return
      }
      const place = scroller ? inkCellPlaces.byId(target.id, scroller) : null
      if (!place || !place.live) return
      const cell = place.box()
      if (dockInto(deps, g.ids, pane, target.id, cell.width, { x: at.clientX - cell.left, y: at.clientY - cell.top })) {
        setSelection(new Set())
      }
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
  }, [gesture, doc, change, eraseAlong, schedule, publish, publishOn, history, scroller, setSelection])

  // The pen's Delete and Clear buttons (and the same ExpressKeys): the drawing
  // layer owns the selection, so it answers for them.
  useEffect(() => registerPenHandlers({
    deleteSelection: () => {
      const picked = latest.current.selection
      const s = pickedRef.current()
      if (picked.size === 0 || !s) return
      change(removing(latest.current.pickLayer, picked), s)
      setSelection(new Set())
    },
    clearSelection: () => { setSelection(new Set()); if (latest.current.placing) onPlaced() },
  }), [change, onPlaced, setSelection])

  // MARK: - A pen for one new ink cell (inkScope.ts)

  const scope = useSyncExternalStore(subscribeInkScope, inkScope)
  // Any change of the page's mode (the pen put down, or picked up: Ctrl+P), or this note closed, ends it.
  const scopeMode = useRef(mode)
  useEffect(() => { if (scopeMode.current !== mode) { scopeMode.current = mode; endInkScope() } }, [mode])
  useEffect(() => () => endInkScope(), [])
  useEffect(() => {
    if (scope === null || !scroller) return
    // The cell takes the pen's cursor (editor.css `.wm-inkcell-pen`); the rest of the page keeps its own. The widget
    // can be drawn again (scrolled away and back, the text above edited), so it is marked again whenever cells move.
    let marked: HTMLElement | null = null
    const mark = () => {
      const place = inkCellPlaces.byId(scope, scroller)
      const element = place && place.live ? place.element : null
      if (marked && marked !== element) marked.classList.remove("wm-inkcell-pen")
      if (element && !element.classList.contains("wm-inkcell-pen")) element.classList.add("wm-inkcell-pen")
      marked = element
    }
    mark()
    const stop = inkCellPlaces.subscribe(mark)
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") endInkScope() }
    window.addEventListener("keydown", escape, true)
    return () => {
      stop()
      window.removeEventListener("keydown", escape, true)
      marked?.classList.remove("wm-inkcell-pen")
    }
  }, [scope, scroller])

  // MARK: - Keys the layer watches

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // A label being typed, or the notebook: those keys are theirs.
      if (event.target instanceof Element && event.target.closest("input, textarea")) return
      const held = latest.current.drawing
      const picked = latest.current.selection
      // Escape during a dock drag: nothing is docked, the drop bar goes away.
      const docking = live.current
      // (Each Escape the layer uses says so by preventing the default: the pen's "Esc to stop" (App.tsx) is for the press
      // nobody used, and one Escape is one thing.)
      if (event.key === "Escape" && docking?.kind === "docking") {
        event.preventDefault()
        latest.current.dock?.clear()
        live.current = null
        owner.current = null
        setGesture(null)
        return
      }
      // (The inspector's popover closes itself on Escape first and stops the key; this is the belt.)
      if (event.key === "Escape" && latest.current.pop) { event.preventDefault(); setPop(null); return }
      if (event.key === "Escape" && latest.current.crop) { event.preventDefault(); setCrop(null); return }
      if (event.key === "Escape" && latest.current.compact) {
        event.preventDefault()
        // The heads row is the arrow's moment (just drawn): Escape puts it, and the pick, away.
        setCompact(null)
        setSelection(new Set())
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
        const s = pickedRef.current()
        const next = s ? toggled(picked, latest.current.pickLayer.items) : null
        if (!next || !s) return
        event.preventDefault()
        change({ items: next }, s)
        setSelection(whole(picked, next), s.cell)
        return
      }
      if (event.key === "Escape" && (picked.size > 0 || latest.current.placing)) {
        // A placement armed with nothing picked is cancelled by this press, and the pen stays (the chip says "Esc to cancel").
        event.preventDefault()
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
  }, [change, history, onPlaced, publish, setSelection])

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
      // What is picked is on one surface: the page, or an ink cell (its own items, its own frame).
      const { pickLayer: held, selection: picked, box: shown, crop: cropping } = latest.current
      const surface = picked.size > 0 ? pickedRef.current() : null
      const now = surface?.size ?? latest.current.size
      const target = event.target
      const verdict = layerKey({
        key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey,
        altGraph: event.getModifierState?.("AltGraph") ?? false,
        composing: event.isComposing,
        inField: away(target),
        inSelect: target instanceof Element && target.closest("select") !== null,
        inNotebook: target instanceof HTMLElement && target.isContentEditable,
        picked: picked.size > 0 && shown !== null && surface !== null,
        cropOpen: cropping !== null,
        textSelected: target instanceof HTMLElement && target.isContentEditable
          && window.getSelection()?.isCollapsed === false,
      })
      if (!verdict) return
      if (verdict.take === "letGo") { setSelection(new Set()); return }
      event.preventDefault(); event.stopPropagation()
      switch (verdict.take) {
        case "nudge":
          if (surface) burst(nudged(held, picked, verdict.dx, verdict.dy, now), surface)
          break
        case "delete":
          taken = event.key
          if (surface) change(removing(held, picked), surface)
          setSelection(new Set())
          break
        case "copy":
        case "cut":
          copyObjects(held.items, whole(picked, held.items), surface?.cell ?? null)
          if (verdict.take === "cut" && surface) {
            change(removing(held, picked), surface)
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
      // Objects go back onto the surface they were copied on: the page, or their ink cell (in its own frame) while it
      // is on the screen. A cell that is not (another note, or its line deleted) gives them to the page, in page
      // fractions, on a 720 px column in the middle: never into a cell that cannot be seen.
      const cell = clip.from
      const live = cell === null ? null : cellSurfaceOf(cell)
      const onto: Surface = live ?? pageSurface()
      const held = layerOf(onto)
      if (!held) return
      event.preventDefault(); event.stopPropagation()
      const now = onto.size
      let source = clip.items
      if (cell !== null && live === null) {
        const width = Math.min(720, Math.max(1, now.width))
        source = toPage(source, now, { x: Math.max(0, (now.width - width) / 2), y: 0 }, width)
      }
      clip.pastes += 1
      const slide = 16 * clip.pastes
      let copies = shifted(copiedItems(source, new Set(source.map(itemId))), slide, slide, now)
      // From another note, scrolled somewhere else: bring it into view (on the page).
      const where = boundsOf({ items: copies }, new Set(copies.map(itemId)), now)
      const top = scrollRef.current
      if (onto.cell === null && where && (where.y + where.height < top || where.y > top + now.height)) {
        copies = shifted(copies, 0, top + 40 - where.y, now)
      }
      if (copies.length === 0) return
      change({ items: [...held.items, ...copies] }, onto)
      setSelection(new Set(copies.map(itemId)), onto.cell)
    }
    window.addEventListener("keydown", keys, true)
    window.addEventListener("keyup", lifted, true)
    window.addEventListener("paste", pasted, true)
    return () => {
      window.removeEventListener("keydown", keys, true)
      window.removeEventListener("keyup", lifted, true)
      window.removeEventListener("paste", pasted, true)
    }
  }, [burst, change, setSelection])

  // MARK: - The handles

  // WHAT THE OUTLINE AND THE HANDLES STAND ROUND (the Mac's `chromeIDs` / `handleIDs`): the pick, or, while nothing is
  // picked, what a click would take (`hover`), drawn FAINTLY: a dashed outline at half strength and the handles
  // dimmed until the pointer is on one. A press on a faint handle picks what it stands round first, then does what the
  // handle does. A hovered PICTURE gets the outline only: its buttons wait for a click (Sean, 2026-09-18, on the Mac:
  // "edit buttons on an image selection should only appear after the image is clicked").
  const hoverLayer = hover ? layerIn(drawing, hover.on) : null
  const hoverItem = hover && hoverLayer
    ? hoverLayer.items.find((item) => itemId(item) === hover.id && !isHidden(item)) : undefined
  const hovering = hover !== null && hoverLayer !== null && hoverItem !== undefined && selection.size === 0
    && gesture === null && placing === null && crop === null && labelling === null
  const hoverIds = hovering ? whole(new Set([hover!.id]), hoverLayer!.items) : selection
  const hoverFrame = hovering ? (hover!.on === null ? { origin: { x: 0, y: 0 }, size } : cellSurfaceOf(hover!.on)) : null
  const hoverBox = (() => {
    if (!hoverFrame || !hoverLayer) return null
    const b = boundsOf(hoverLayer, hoverIds, hoverFrame.size)
    return b ? { x: b.x + hoverFrame.origin.x, y: b.y + hoverFrame.origin.y, width: b.width, height: b.height } : null
  })()
  const faint = hovering && hoverBox !== null
  const chromeOn = faint ? hover!.on : pick.on
  const chromeIds = faint ? hoverIds : selection
  const chromeLayer = faint ? hoverLayer! : pickLayer
  const chromeBox = faint ? hoverBox : box
  /** Where the chrome's surface is and what its items are measured in (a cell's frame), now. */
  const chromeFrame = chromeOn === null ? { origin: { x: 0, y: 0 }, size } : cellSurfaceOf(chromeOn)
  /** The chrome's surface as it is now: what a handle's gesture works on (null when its cell is off the screen). */
  const chromeSurface = (): Surface | null => (chromeOn === null ? pageSurface() : cellSurfaceOf(chromeOn))
  // Over an object the pointer is an open hand, as on the Mac (the words' own cursor is put aside meanwhile).
  useEffect(() => {
    const element = host.current?.parentElement
    if (!element || !faint) return
    element.classList.add("wm-hover-grab")
    return () => element.classList.remove("wm-hover-grab")
  }, [faint])

  // The pick is on the page, or in one ink cell (its own items): crop and read are the page's only; docking is FROM
  // the page. Every other control (turn, resize, delete, group, order, a routed line's circles) works in a cell.
  const onPage = chromeOn === null
  const grouping = toggle(chromeIds, chromeLayer.items)
  /** A press on a faint handle: what it stands round becomes the pick (the Mac's handleDrag: `selection = [hovered]`). */
  const adopt = () => {
    if (!faint) return
    setSelection(new Set(chromeIds), chromeOn)
    setHover(null)
  }
  /** A gesture from a handle works on the chrome's surface (null when its cell is off the screen). */
  const fromHandle = (): Surface | null => {
    const s = chromeSurface()
    if (s) surfaceRef.current = s
    return s
  }
  const docks = onPage && dock !== undefined && dockable(drawing, chromeIds) !== null
  const chromeItems = chromeLayer.items.filter((item) => chromeIds.has(itemId(item)))

  // THE RING: eight handles on the dashed outline and a rotate dot on a stem above it, or one pill for a small object
  // (handles.ts). A pick of arrows alone has neither (an arrow has its ends and its circles). While a picture is being
  // cropped the crop box's own corners are the handles.
  const view: Rect = { x: 0, y: scroll, width: size.width, height: size.height }
  const layout: HandleLayout | null = chromeBox && wantsRing(chromeItems)
    ? handleLayout(chromeBox, { view, edges: edgesFor(chromeItems) }) : null
  // What the hover looks at as the pointer goes to a handle that stands half outside the object (see `hoverAt`).
  keepLayout.current = faint ? layout : null

  /** A press on one of the ring's (or the pill's) handles: it begins the gesture it stands for. */
  const grab = (id: HandleId) => (event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation()
    if (!chromeBox) return
    adopt()
    const s = fromHandle()
    if (!s) return
    // The selection's box and the press, in the surface's own px.
    const local: Rect = { x: chromeBox.x - s.origin.x, y: chromeBox.y - s.origin.y, width: chromeBox.width, height: chromeBox.height }
    const from = doc(event.nativeEvent)
    const snapshot = snapshotOf(chromeLayer, chromeIds)
    if (id === "rotate" || id === "pill-turn") {
      const pivot = { x: local.x + local.width / 2, y: local.y + local.height / 2 }
      start({ kind: "rotating", from: angleAbout(from, pivot), pivot, snapshot, base: chromeLayer }, event.pointerId)
      return
    }
    if (id.length === 1 && stretches(chromeItems, id as Edge)) {
      start({ kind: "stretching", id: itemId(chromeItems[0]!), edge: id as Edge, from, base: chromeLayer }, event.pointerId)
      return
    }
    start({ kind: "scaling", from, handle: id as RingId | "pill-resize", box: local, snapshot, base: chromeLayer }, event.pointerId)
  }
  // A handle stays on the pane: an object at the edge of the view (or half scrolled off it) keeps every button within
  // reach, as on the Mac, where they are clamped 14 points in (`handleLayout` does it, given `view`).
  const hoveredPicture = faint && hoverItem !== undefined && !hoverHandles(hoverItem)
  const handles = chromeBox && !gesture && chromeIds.size > 0 && !hoveredPicture ? (
    <>
      {layout && crop === null && (
        <>
          {layout.stem && (
            <div className="wm-stem" style={{ ...at(layout.stem.x, layout.stem.y1, scroll), height: Math.max(0, Math.round(layout.stem.y2 - layout.stem.y1)) }} />
          )}
          {layout.kind === "pill" && (() => {
            const [turn, resize] = layout.spots
            const wide = PILL_SPACING + 26 + 6
            return <div className="wm-pill" style={{ ...at((turn!.x + resize!.x) / 2 - wide / 2, turn!.y - 14, scroll), width: wide }} />
          })()}
          {layout.spots.map((spot) => (
            <button key={spot.id} type="button" data-handle={spot.id} title={handleTitle(spot.id)}
                    className={`wm-handle${spot.id === "rotate" ? " wm-turn" : spot.id.startsWith("pill-") ? " wm-pillbtn" : " wm-grab"}`}
                    style={{ ...at(spot.x, spot.y, scroll), cursor: handleCursor(spot.id) }}
                    onPointerDown={grab(spot.id)}>
              {spot.id === "pill-turn" && <Icon name="rotate" size={14} />}
              {spot.id === "pill-resize" && <Icon name="resize" size={14} />}
            </button>
          ))}
        </>
      )}
      {/* The circle on each segment of a routed line: drag it and the segment
          goes with the pointer, the line routed again around it (on the page, or in its cell). */}
      {chromeFrame && chromeLayer.items.flatMap((item) => {
        if (item.kind !== "connector" || !chromeIds.has(item.connector.id)
          || !isRouted(item.connector)) return []
        return segmentMidpoints(pixelRoute(item.connector, chromeFrame.size)).map((segment) => (
          <button key={`${item.connector.id}:${segment.index}`}
                  className="wm-handle wm-segment"
                  data-segment={segment.index}
                  data-vertical={segment.vertical ? "1" : "0"}
                  title="Drag to move this part of the line"
                  style={{ ...at(chromeFrame.origin.x + segment.point.x - 6, chromeFrame.origin.y + segment.point.y - 6, scroll),
                    cursor: segment.vertical ? "ew-resize" : "ns-resize" }}
                  onPointerDown={(event) => {
                    event.preventDefault(); event.stopPropagation()
                    adopt()
                    if (!fromHandle()) return
                    start({
                      kind: "segment", id: item.connector.id, index: segment.index,
                      vertical: segment.vertical, base: chromeLayer,
                    }, event.pointerId)
                  }} />
        ))
      })}
    </>
  ) : null

  // MARK: - The inspector

  /** What the bar does, on the pick (a press is cancelled before it reaches here: see Inspector.tsx). */
  const pickedItems = pickLayer.items.filter((item) => selection.has(itemId(item)))
  const compactOn = compact !== null && selection.size === 1 && selection.has(compact)
  const deletePicked = () => {
    const s = pickedRef.current()
    if (s) change(removing(latest.current.pickLayer, latest.current.selection), s)
    setSelection(new Set())
    setHover(null)
  }
  const groupPicked = () => {
    const s = pickedRef.current()
    const next = s ? toggled(latest.current.selection, latest.current.pickLayer.items) : null
    setHover(null)
    if (next && s) {
      change({ items: next }, s)
      // The handles go round the whole of what is held at once.
      setSelection(whole(latest.current.selection, next), s.cell)
    }
  }
  const plan = inspectorPlan(pickedItems, {
    docks, reads: onReadPicture !== undefined && onPage, grouping, editing: crop !== null || labelling !== null, compact: compactOn,
  })
  /** Where the bar stands: over the object, under it when there is no room above, kept on the pane (inspectorRules.ts). */
  const barSpot = (() => {
    if (!box || plan.groups.length === 0 || faint) return null
    const bar = barSize ?? { width: estimatedWidth(plan), height: BAR_HEIGHT }
    const only = pickedItems[0]
    if (compactOn && only?.kind === "connector" && chromeFrame) {
      // An arrow just drawn: its heads row at the arrow's end, on the side the arrow does not come from.
      const points = pixelRoute(only.connector, chromeFrame.size).map((p) => applyMatrix(only, chromeFrame.size, p))
      const toPane = (p: Point): Point => ({ x: chromeFrame.origin.x + p.x, y: chromeFrame.origin.y + p.y - scroll })
      const end = toPane(points[points.length - 1]!), start_ = toPane(points[0]!)
      // It must not lie on the arrow, nor on the nodes it joins: a bar on the node just joined was in the way of the
      // next press (the node moves by a drag of its body).
      const layerNow = chromeLayer
      const held_ = new Set([only.connector.startNode, only.connector.endNode].filter((id): id is string => id !== null))
      const around = layerNow.items.filter((item) => held_.has(itemId(item)) || item === only)
        .map((item) => bounds(item, chromeFrame.size))
        .map((r) => ({ x: chromeFrame.origin.x + r.x - 4, y: chromeFrame.origin.y + r.y - scroll - 4, width: r.width + 8, height: r.height + 8 }))
      return inspectorSpot({ target: pointBox(end), bar, pane: size, prefer: sideAwayFrom(start_, end), avoid: around, alternatives: true })
    }
    const ring = layout?.kind === "ring"
    return inspectorSpot({
      target: { x: box.x, y: box.y - scroll, width: box.width, height: box.height }, bar, pane: size,
      reserveAbove: ring ? OUTLINE_PAD + ROTATE_REACH + 8 : OUTLINE_PAD + 4,
      // (While a picture is cropped its own two buttons stand under it: the bar clears them.)
      reserveBelow: (layout?.kind === "pill" ? OUTLINE_PAD + PILL_REACH + 16 : OUTLINE_PAD + 6) + (crop !== null ? 42 : 0),
    })
  })()
  const inspector = barSpot && !gesture && chromeIds.size > 0 && !faint ? (
    <Inspector plan={plan} items={pickedItems} left={barSpot.left} top={barSpot.top}
               pop={pop} onPop={setPop} grouping={grouping}
               onPatch={applyStyle} onOrder={orderSelection} onDuplicate={duplicate} onDelete={deletePicked} onGroup={groupPicked}
               onLabel={() => {
                 const only = pickedItems[0]
                 if (only?.kind !== "shape") return
                 openBox.current = false
                 setLabelling({ id: only.shape.id, text: only.shape.label, on: pick.on })
               }}
               onCrop={() => {
                 const only = pickedItems[0]
                 if (only?.kind === "image") setCrop({ id: only.image.id, rect: { x: 0, y: 0, width: 1, height: 1 } })
               }}
               onRead={() => {
                 const only = pickedItems[0]
                 if (only?.kind === "image") onReadPicture?.(only.image.file, only.image.id)
               }}
               onDockPress={(event) => {
                 event.preventDefault(); event.stopPropagation()
                 surfaceRef.current = pageSurface()
                 const at_ = { x: event.clientX, y: event.clientY }
                 start({
                   kind: "docking", ids: new Set(chromeIds), from: at_, to: at_, scroll: scrollRef.current,
                   dragging: false, target: null,
                 }, event.pointerId)
               }}
               onMeasure={(measured) => setBarSize((was) => was && was.width === measured.width && was.height === measured.height ? was : measured)} />
  ) : null
  /** The outline round what a click would take: faint and dashed (the pick's own box is on the ink canvas). */
  const hoverOutline = faint && hoverBox ? (
    <div className="wm-hover-box" data-hover={hover!.id}
         style={{ ...at(hoverBox.x - 3, hoverBox.y - 3, scroll), width: Math.round(hoverBox.width + 6), height: Math.round(hoverBox.height + 6) }} />
  ) : null

  // MARK: - A node's label

  // A label (or a text box's words) is typed on its own surface: the page, or the ink cell it is in.
  const labelLayer = labelling ? layerIn(drawing, labelling.on) : null
  const labelled = labelling && labelLayer
    ? labelLayer.items.find((item) => itemId(item) === labelling.id) : undefined
  /** Where the label's surface is now (a cell's frame and top-left); null when its cell is off the screen. */
  const labelFrame = labelling ? (labelling.on === null ? { origin: { x: 0, y: 0 }, size } : cellSurfaceOf(labelling.on)) : null
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
  const typingBox = labelling && labelled?.kind === "shape" && labelled.shape.kind === "text" ? labelling : null
  const typingKey = typingBox ? `${typingBox.on ?? ""}:${typingBox.id}` : ""
  useEffect(() => {
    editingBox.current = typingBox && typingBox.on === null ? typingBox.id : null
    baseDirty.current = true
    schedule()
    // A text box in an ink cell: its cell's painter leaves the words to the field, and is painted again now and when
    // the field goes.
    const cell = typingBox?.on ?? null
    typingInCell = cell !== null ? typingBox!.id : null
    const repaint = () => {
      const within = scrollerRef.current
      const place = cell !== null && within ? inkCellPlaces.byId(cell, within) : null
      if (place) repaintInkCells(place.view, [cell!])
    }
    repaint()
    return () => {
      if (cell === null) return
      typingInCell = null
      repaint()
    }
    // (`typingKey` is what `typingBox` is: the box and its surface.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingKey, schedule])

  /**
   * A text box is as tall as its text — measured on every keystroke, so the
   * card grows under the caret instead of catching up afterwards. The words
   * are typed into the field and written to the drawing as they go; the
   * session is one undo. In a drawing cell the cell grows with it when the box
   * runs past its bottom (as ink docked into it does).
   */
  const typeIntoBox = (id: string, text: string, on: string | null) => {
    const whole_ = latest.current.drawing
    const s = on === null ? pageSurface() : cellSurfaceOf(on)
    const held = layerIn(whole_, on)
    if (!s || !held) return
    const frame = on === null ? latest.current.size : s.size
    if (!openBox.current) { history.record(whole_); openBox.current = true }
    const items = held.items.map((item) => {
      if (item.kind !== "shape" || item.shape.id !== id) return item
      const width = item.shape.width * frame.width
      const aspect = textBoxAspect(text, width, measureTextBox)
      return { kind: "shape" as const, shape: { ...item.shape, label: text, aspect } }
    })
    if (on === null) publish({ items })
    else {
      const cell = inkCellOf(whole_, on)
      if (!cell) return
      const typed = items.find((item) => itemId(item) === id)
      const bottom = typed ? bounds(typed, frame).y + bounds(typed, frame).height : 0
      const aspect = Math.max(cell.aspect, (bottom + INK_PAD) / Math.max(frame.width, 1))
      latest.current.onChange(withInkCell(whole_, { ...cell, aspect, items: reconnect({ items }, frame).items }))
    }
    setLabelling({ id, text, on })
  }

  const boxEditor = labelling && labelFrame && labelled?.kind === "shape" && labelled.shape.kind === "text" ? (() => {
    const shape = labelled.shape
    const base = baseBounds(labelled, labelFrame.size)
    const centre = placedCenter(labelled, labelFrame.size)
    const width = Math.max(TEXT_BOX.minimumWidth, base.width)
    const height = Math.max(base.height, textBoxHeight(labelling.text, width, measureTextBox))
    const fill = shape.fillHex
    const ink = readableInk(shape.colorHex, shape.fillHex)
    const t = shape.transform
    return (
      <textarea className="wm-textbox-edit" autoFocus value={labelling.text} spellCheck={false}
                data-node={labelling.id} data-cell={labelling.on ?? undefined}
                style={{
                  left: labelFrame.origin.x + centre.x - width / 2, top: labelFrame.origin.y + centre.y - scroll - height / 2,
                  width, height,
                  color: ink, caretColor: ink,
                  background: fill ?? "var(--wm-page)",
                  transform: `rotate(${t.rotation}rad) scale(${t.scale})`,
                }}
                onFocus={(event) => { const end = event.currentTarget.value.length; event.currentTarget.setSelectionRange(end, end) }}
                onChange={(event) => typeIntoBox(labelling.id, event.target.value, labelling.on)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  // (The field goes away under the keyboard: it is the note's again, as after any bar action — focusReturn.ts.)
                  if (event.key === "Escape") { event.preventDefault(); openBox.current = false; setLabelling(null); returnFocusSoon() }
                }}
                onBlur={() => { openBox.current = false; setLabelling(null) }} />
    )
  })() : null

  const labelEditor = labelling && labelFrame && labelled?.kind === "shape" && labelled.shape.kind !== "text" ? (() => {
    const centre = placedCenter(labelled, labelFrame.size)
    const width = Math.max(96, Math.min(240, bounds(labelled, labelFrame.size).width))
    const commit = () => {
      if (labelCancelled.current) { labelCancelled.current = false; return }
      relabel(labelling.id, labelling.text.trim(), labelling.on)
      setLabelling(null)
    }
    return (
      <input className="wm-label-edit" autoFocus value={labelling.text} spellCheck={false}
             data-node={labelling.id} data-cell={labelling.on ?? undefined}
             style={{ left: Math.round(labelFrame.origin.x + centre.x - width / 2),
               top: Math.round(labelFrame.origin.y + centre.y - scroll - 12), width }}
             onFocus={(event) => event.currentTarget.select()}
             onChange={(event) => setLabelling({ id: labelling.id, text: event.target.value, on: labelling.on })}
             onKeyDown={(event) => {
               event.stopPropagation()
               if (event.key === "Enter") { event.preventDefault(); commit(); returnFocusSoon() }
               else if (event.key === "Escape") { labelCancelled.current = true; setLabelling(null); returnFocusSoon() }
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
    const saved = await window.wm.saveMedia(new Uint8Array(await blob.arrayBuffer()), png ? ".png" : ".jpg", note ?? null)
    const held = latest.current.drawing
    const now = latest.current.size
    // The kept part's proportions on the page: the picture's own, cut down.
    const aspect = cropped_.image.aspect * rect.height / Math.max(rect.width, 0.0001)
    change({
      items: held.items.map((item) =>
        itemId(item) === crop.id ? cropped(item, rect, saved.file, aspect, now) : item),
    }, pageSurface())
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
          <button className="wm-crop-btn wm-crop-ok" title="Keep this part" aria-label="Keep this part"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void applyCrop() }}><Icon name="check" /></button>
          <button className="wm-crop-btn wm-crop-cancel" title="Leave the picture as it is" aria-label="Leave the picture as it is"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setCrop(null) }}><Icon name="close" /></button>
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
         style={{ pointerEvents: grabs ? "auto" : "none", cursor: eraserOn ? "cell" : faint ? "grab" : selectOn ? "crosshair" : cursorFor(scope !== null ? "pen" : mode, placing, command) }}>
      {/* The committed ink, in the scroller so it scrolls with the words (`band`); over the page when there is none. */}
      {scroller
        ? createPortal(<canvas ref={canvas} className="wm-ink" style={INK_IN_SCROLLER} />, scroller)
        : <canvas ref={canvas} className="wm-ink" style={{ width: size.width, height: size.height }} />}
      <canvas ref={overlay}
              style={{ width: size.width, height: size.height, pointerEvents: "none" }} />
      <div className={`wm-handles${faint ? " wm-handles-faint" : ""}`}>
        {hoverOutline}
        {handles}
        {inspector}
        {labelEditor}
        {boxEditor}
        {cropEditor}
      </div>
    </div>
  )
}

/**
 * The committed-ink canvas inside the editor's scroller: over the words and the editor's own layers (its caret is
 * 150), never taking a click, and never wider than the scroller's inside (a canvas wider than that would give the
 * page a sideways scroll bar). Its top, height and width are the band's, set by the render.
 */
const INK_IN_SCROLLER = { position: "absolute", left: 0, top: 0, maxWidth: "100%", pointerEvents: "none", zIndex: 200 } as const

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

/**
 * A move inside an ink cell, kept inside it: `box` is what moves, as it was (cell px), `cell` the cell's box. What is
 * bigger than the cell is centred in it on that axis.
 */
function keptInside(translate: { dx: number; dy: number }, box: Rect | null, cell: Rect): { dx: number; dy: number } {
  if (!box) return translate
  const keep = (value: number, low: number, high: number): number =>
    low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high)
  return {
    dx: keep(translate.dx, -box.x, cell.width - (box.x + box.width)),
    dy: keep(translate.dy, -box.y, cell.height - (box.y + box.height)),
  }
}

/** A point (cell px) kept inside a cell's box: a tool dragged out of a drawing cell stops at its edge. */
const inCell = (point: Point, cell: Rect): Point =>
  ({ x: Math.min(Math.max(point.x, 0), cell.width), y: Math.min(Math.max(point.y, 0), cell.height) })

/** An object put into a drawing cell, moved (never shrunk) so it lies wholly inside the cell (`keptInside`'s rule). */
function keptInCell(item: CanvasItem, frame: Size, cell: Rect): CanvasItem {
  const t = keptInside({ dx: 0, dy: 0 }, bounds(item, frame), cell)
  return Math.abs(t.dx) < 1e-9 && Math.abs(t.dy) < 1e-9 ? item : shifted([item], t.dx, t.dy, frame)[0] ?? item
}

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
 * An ink cell's committed ink, painted into its widget's own canvas (docs\PLAN-docking-ink-cells.md (b)): the same
 * `paint()` per item as the page, in the cell's frame (`cellFrame(W)`), clipped to the cell. The canvas is in the
 * editor's DOM, so the ink moves in the same frame as the words round it. `size` is the cell's drawing area in CSS
 * px; the backing store follows the screen's density. `onLoad` is called when a picture inside it arrives.
 */
export function paintInkCell(target: HTMLCanvasElement, cell: InkCell, size: Size, onLoad: () => void = () => {}): void {
  const ratio = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(size.width * ratio))
  const h = Math.max(1, Math.round(size.height * ratio))
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h }
  const context = target.getContext("2d")
  if (!context) return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, w, h)
  if (!(size.width > 0 && size.height > 0)) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.save()
  context.beginPath()
  context.rect(0, 0, size.width, size.height)
  context.clip()
  const frame = cellFrame(size.width)
  for (const item of cell.items) {
    if (isHidden(item)) continue
    paint(context, item, frame, onLoad, typingInCell)
  }
  context.restore()
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
