/**
 * Picture cells and ink cells, drawn in BOTH panes (docs\PLAN-docking-ink-cells.md (c)).
 *
 * A line that is nothing but one image is a picture CELL (core's `picture` block): a docked picture
 * `![](.drawings/media/<file>)`, or an ink cell `![ink](.drawings/media/ink-<id>.svg)`. Sean (2026-09-22): "text can
 * not overlap with an image, the input cursor and text can only go above and below a docked image". So:
 *
 * - The line is replaced by ONE block widget, on the markdown side and on the rendered page alike (the page's own
 *   `previewField` leaves picture cells to this field), and the range is atomic: the caret is before it or after it,
 *   never in it, and it is drawn there as a line-tall caret at the picture's top left or bottom right.
 * - Typing at either edge goes on a line of its own: text inserted at the picture line's start becomes
 *   `text + "\n\n"` before it, at its end `"\n\n" + text` after it (the transaction filter below). The markdown is
 *   never left with words on a picture's line.
 * - A Backspace or Delete with a caret that would join the line to its neighbour (or take it whole, the way an
 *   atomic range is deleted) HOLDS the cell instead: its bracket and the cell light, and the next Backspace takes it
 *   through the held-cell delete every cell has. A plain mouse click on a picture cell holds it too.
 * - An INK cell whose id has an item in this note's drawing (`inkAspectsField`, else `painter.aspect`) is LIVE: a box
 *   `aspect` × the text column's width with a `<canvas>` the app's painter draws the cell's ink into, and an 8px
 *   strip on its bottom edge that resizes it (one `painter.resized` at the release, never under `minAspect`). Any
 *   other ink line, and any later copy of a live id in the same note, is drawn read-only from its SVG snapshot.
 * - Every ink widget in the DOM is a place in `inkCellPlaces` (inkCellRegistry.ts), which the drawing layer reads to
 *   find the cell under the pen and to keep a selection box on the cell when the text above it changes.
 */

import {
  EditorSelection, EditorState, Facet, Prec, RangeSetBuilder, StateEffect, StateField, type Extension, type TransactionSpec,
} from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type Rect, type ViewUpdate } from "@codemirror/view"
import {
  apartAbove, end, firstCellFromBy, INK_MIN_HEIGHT, PREVIEW_BLOCK_GAP, type Block, type PositionedBlock,
} from "@writemind/core"
import { foldField, insideHidden } from "./fold"
import { notebook } from "./notebook"
import { renderedField } from "./rendered"
import { holdingField, setHolding } from "./preview/hold"
import {
  lastColumnWidth, noteColumnWidth, PICTURE_LINE, pictureCellDom, pictureHeightEstimate, type PictureSpec,
} from "./pictureDom"
import { anyInkCells, inkCellPlaces, inkCellsMoved, registerInkCell } from "./inkCellRegistry"
import { columnBox, cursorSeam, dropTargetAt, insertCellLine, showDropTarget, type DropTarget } from "./dock"
import { armedField } from "./seams"

// MARK: - The app's side

/** What the app gives the notebook to draw and resize ink cells with (one stable object; DOCK lane `inkPainter`). */
export interface InkCellPainter {
  /** The cell's aspect (height ÷ width) in this note's drawing; null when the drawing has no such cell (read-only). */
  aspect(id: string): number | null
  /** The least aspect the cell can be resized to (its ink's bottom and a pad, never under `INK_MIN_HEIGHT`). */
  minAspect(id: string): number
  /**
   * Draw the cell's committed ink into its canvas. `size` is the drawing area in CSS px (the text column × the
   * cell's height); the painter sizes the canvas's backing store for the device pixel ratio itself.
   */
  paint(id: string, canvas: HTMLCanvasElement, size: { width: number; height: number }): void
  /** The cell was resized by its bottom edge: called once, at the release (one undo step). */
  resized(id: string, aspect: number): void
}

/** The painter, from the app (`inkCellPainter.of(painter)`); the first non-null one given. */
export const inkCellPainter = Facet.define<InkCellPainter | null, InkCellPainter | null>({
  combine: (values) => values.find((value) => value !== null) ?? null,
})

/**
 * The aspects of every ink cell in the note's drawing, by id: the WHOLE map each time (it replaces the last one).
 * The app sends it when the note opens and whenever an aspect changes or a cell comes or goes (`syncInkCells`).
 */
export const setInkAspects = StateEffect.define<ReadonlyMap<string, number>>()

const NO_ASPECTS: ReadonlyMap<string, number> = new Map()

export const inkAspectsField = StateField.define<ReadonlyMap<string, number>>({
  create: () => NO_ASPECTS,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setInkAspects)) value = effect.value
    return value
  },
})

// MARK: - The cells

type PictureBlock = Extract<Block, { kind: "picture" }>
type PictureCell = PositionedBlock & { block: PictureBlock }

const isPicture = (cell: PositionedBlock): cell is PictureCell => cell.block.kind === "picture"

/** The picture cells of a parse, found once per parse (the cells array is new on every edit that changes them). */
const picturesByCells = new WeakMap<readonly PositionedBlock[], number[]>()
function pictureIndices(cells: readonly PositionedBlock[]): number[] {
  let found = picturesByCells.get(cells)
  if (!found) {
    found = []
    for (let i = 0; i < cells.length; i++) if (isPicture(cells[i]!) && cells[i]!.range.length > 0) found.push(i)
    picturesByCells.set(cells, found)
  }
  return found
}

/** The picture cells of the note, in order. */
export function pictureCellsOf(state: EditorState): PictureCell[] {
  const cells = notebook(state).cells
  return pictureIndices(cells).map((i) => cells[i] as PictureCell)
}

/** What one widget shows. */
interface CellSpec extends PictureSpec {
  ink: string | null
  /** A live ink cell: drawn from the drawing, editable, resizable. */
  live: boolean
  /** Height ÷ width, for a live ink cell. */
  aspect: number
  held: boolean
  /** On the rendered page, touching the cell above (no blank line): the page's gap is made here. */
  touching: boolean
}

const sameSpec = (a: CellSpec, b: CellSpec): boolean => a.path === b.path && a.alt === b.alt && a.ink === b.ink
  && a.live === b.live && a.aspect === b.aspect && a.held === b.held && a.touching === b.touching

// MARK: - The widget

interface InkState {
  view: EditorView
  id: string
  box: HTMLElement
  canvas: HTMLCanvasElement
  observer: ResizeObserver | null
  unregister: () => void
  dragging: boolean
  paint(): void
}

/** The live ink widgets now in the DOM, by their root element. */
const inkStates = new Map<HTMLElement, InkState>()
/** The read-only widgets' registry entries, by their root element. */
const stillPlaces = new Map<HTMLElement, () => void>()

const setAspectStyle = (box: HTMLElement, aspect: number): void => {
  const value = `1 / ${Math.max(0.0001, aspect)}`
  if (box.style.aspectRatio !== value) box.style.aspectRatio = value
}

function applyFlags(dom: HTMLElement, spec: CellSpec): void {
  dom.classList.toggle("wm-cellpic-held", spec.held)
  dom.classList.toggle("wm-pv-touching", spec.touching)
}

/** Where a widget's cell is now: its line in the document. */
function cellAt(view: EditorView, dom: HTMLElement): { from: number; to: number } | null {
  let from: number
  try { from = view.posAtDOM(dom) } catch { return null }
  const doc = view.state.doc
  if (from < 0 || from > doc.length) return null
  const line = doc.lineAt(from)
  return { from: line.from, to: line.to }
}

/**
 * The line a picture or ink widget draws (its root element, either pane), or null when it is no longer in the note:
 * what a cell's menu takes out when it undocks the cell.
 */
export const pictureCellLine = (view: EditorView, dom: HTMLElement): { from: number; to: number } | null =>
  dom.isConnected ? cellAt(view, dom) : null

/** Hold the cell a widget draws: select its line, lit by its bracket (a click on it, Backspace beside it). */
export function holdPictureCell(view: EditorView, dom: HTMLElement): void {
  const at = cellAt(view, dom)
  if (!at) return
  view.dispatch({
    selection: EditorSelection.range(at.from, at.to),
    effects: setHolding.of(true),
    userEvent: "select.pointer",
  })
  view.focus()
}

function press(view: EditorView, dom: HTMLElement, event: MouseEvent): void {
  // The middle button is the browser's; Ctrl / Cmd belongs to the drawing layer (its marquee), as it does on words.
  if (event.button === 1 || event.ctrlKey || event.metaKey) return
  if (event.target instanceof Element && event.target.closest(".wm-cell-resize")) return
  if (event.button === 2) {
    // A right-click holds the cell unless a selection already covers it, so the menu's Cut and Copy are about it.
    const at = cellAt(view, dom)
    const covered = at !== null && view.state.selection.ranges.some((r) => !r.empty && r.from <= at.from && r.to >= at.to)
    if (!covered) holdPictureCell(view, dom)
    return
  }
  if (event.button !== 0) return
  event.preventDefault()
  holdPictureCell(view, dom)
}

class PictureCellWidget extends WidgetType {
  constructor(readonly spec: CellSpec) { super() }

  override eq(other: PictureCellWidget): boolean { return sameSpec(this.spec, other.spec) }

  override get estimatedHeight(): number {
    const gap = this.spec.touching ? PREVIEW_BLOCK_GAP : 0
    return gap + (this.spec.live ? lastColumnWidth() * this.spec.aspect : pictureHeightEstimate(this.spec.path))
  }

  override toDOM(view: EditorView): HTMLElement {
    const spec = this.spec
    const dom = spec.live ? this.inkDom(view) : this.pictureDom(view)
    applyFlags(dom, spec)
    dom.addEventListener("mousedown", (event) => press(view, dom, event))
    return dom
  }

  private pictureDom(view: EditorView): HTMLElement {
    const spec = this.spec
    const dom = pictureCellDom(spec, () => { view.requestMeasure(); inkCellsMoved() })
    if (spec.ink) {
      // An ink line drawn read-only from its snapshot: still a place, so the pen can be told it cannot draw here.
      dom.classList.add("wm-inkcell-still")
      dom.dataset.inkCell = spec.ink
      const element = dom
      stillPlaces.set(dom, registerInkCell({
        id: spec.ink, view, element, live: false,
        box: () => (element.querySelector("img") ?? element).getBoundingClientRect(),
      }))
    }
    return dom
  }

  private inkDom(view: EditorView): HTMLElement {
    const spec = this.spec
    const id = spec.ink!
    const dom = document.createElement("div")
    dom.className = "wm-cellpic wm-inkcell"
    dom.dataset.inkCell = id
    const box = document.createElement("div")
    box.className = "wm-inkcell-box"
    setAspectStyle(box, spec.aspect)
    const canvas = document.createElement("canvas")
    canvas.className = "wm-inkcell-ink"
    box.appendChild(canvas)
    const strip = document.createElement("div")
    strip.className = "wm-cell-resize"
    strip.title = "Drag to make the drawing cell taller or shorter"
    box.appendChild(strip)
    dom.appendChild(box)

    const state: InkState = {
      view, id, box, canvas, observer: null, dragging: false,
      unregister: () => {},
      paint() {
        // (The rect, not clientWidth: the drawing layer measures the cell with it, to the fraction of a pixel.)
        const { width, height } = box.getBoundingClientRect()
        if (width <= 0 || height <= 0) return
        noteColumnWidth(width)
        view.state.facet(inkCellPainter)?.paint(id, canvas, { width, height })
      },
    }
    state.unregister = registerInkCell({ id, view, element: dom, live: true, box: () => box.getBoundingClientRect() })
    if (typeof ResizeObserver !== "undefined") {
      state.observer = new ResizeObserver(() => { state.paint(); inkCellsMoved() })
      state.observer.observe(box)
    }
    inkStates.set(dom, state)
    strip.addEventListener("pointerdown", (event) => resize(state, event))
    return dom
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, from: PictureCellWidget): boolean {
    const a = this.spec
    const b = from.spec
    // Another picture, or a cell that turned live or read-only: drawn again. Anything else is changed in place (the
    // canvas is kept: a held or moved cell is not painted again for it).
    if (a.path !== b.path || a.alt !== b.alt || a.ink !== b.ink || a.live !== b.live) return false
    applyFlags(dom, a)
    const ink = inkStates.get(dom)
    if (ink && !ink.dragging && a.aspect !== b.aspect) setAspectStyle(ink.box, a.aspect)
    return true
  }

  override destroy(dom: HTMLElement): void {
    const ink = inkStates.get(dom)
    if (ink) {
      ink.observer?.disconnect()
      ink.unregister()
      inkStates.delete(dom)
    }
    const still = stillPlaces.get(dom)
    if (still) { still(); stillPlaces.delete(dom) }
  }

  // The widget answers its own presses (a hold, a resize); CodeMirror's selection handling stays out of it.
  override ignoreEvent(): boolean { return true }

  /**
   * The caret beside a picture cell is a LINE tall, at the cell's top left (before it) or its bottom right (after
   * it) — not a bar the height of the picture: the caret is above or below the picture, never in it.
   */
  override coordsAt(dom: HTMLElement, pos: number, _side: number): Rect | null {
    const outer = dom.getBoundingClientRect()
    const content = (dom.querySelector(".wm-inkcell-box, img, .wm-cellpic-words") ?? dom).getBoundingClientRect()
    const line = Math.min(PICTURE_LINE, Math.max(1, content.height || outer.height))
    if (pos <= 0) {
      const top = content.top || outer.top
      return { left: content.left, right: content.left, top, bottom: top + line }
    }
    const bottom = content.bottom || outer.bottom
    return { left: content.right, right: content.right, top: bottom - line, bottom }
  }
}

/** A drag on the bottom strip of a live ink cell. */
function resize(state: InkState, event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const strip = event.currentTarget as HTMLElement
  const { view, id, box } = state
  const start = box.getBoundingClientRect()
  const width = Math.max(1, start.width)
  const startHeight = start.height
  const startY = event.clientY
  const painter = view.state.facet(inkCellPainter)
  const least = Math.max(INK_MIN_HEIGHT, (painter?.minAspect(id) ?? 0) * width)
  let height = startHeight
  state.dragging = true
  try { strip.setPointerCapture(event.pointerId) } catch { /* a synthetic pointer has nothing to capture */ }
  box.classList.add("wm-resizing")
  const move = (moved: PointerEvent) => {
    if (moved.pointerId !== event.pointerId) return
    height = Math.max(least, Math.min(startHeight + (moved.clientY - startY), 20000))
    setAspectStyle(box, height / width)
    // The page under the cell moves now; the ink is painted again by the box's own observer.
    view.requestMeasure()
    inkCellsMoved()
  }
  const stop = (ended: PointerEvent) => {
    if (ended.pointerId !== event.pointerId) return
    strip.removeEventListener("pointermove", move)
    strip.removeEventListener("pointerup", stop)
    strip.removeEventListener("pointercancel", stop)
    box.classList.remove("wm-resizing")
    state.dragging = false
    const aspect = height / width
    if (ended.type === "pointercancel" || Math.abs(height - startHeight) < 0.5) {
      setAspectStyle(box, startHeight / width)
      view.requestMeasure()
      return
    }
    // The field first (so nothing snaps back while the app records it), then the one call that is the undo step.
    const aspects = new Map(view.state.field(inkAspectsField, false) ?? NO_ASPECTS)
    aspects.set(id, aspect)
    view.dispatch({ effects: setInkAspects.of(aspects) })
    view.state.facet(inkCellPainter)?.resized(id, aspect)
  }
  strip.addEventListener("pointermove", move)
  strip.addEventListener("pointerup", stop)
  strip.addEventListener("pointercancel", stop)
}

/** Paint the live ink cells of this view again (all of them, or those named): the drawing changed under them. */
export function repaintInkCells(view: EditorView, ids?: Iterable<string>): void {
  const wanted = ids ? new Set(ids) : null
  for (const state of inkStates.values()) {
    if (state.view !== view || (wanted && !wanted.has(state.id))) continue
    state.paint()
  }
}

// MARK: - The decorations

function specs(state: EditorState): Array<{ from: number; to: number; spec: CellSpec }> {
  const cells = notebook(state).cells
  const indices = pictureIndices(cells)
  if (indices.length === 0) return []
  const rendered = state.field(renderedField, false) === true
  const aspects = state.field(inkAspectsField, false) ?? NO_ASPECTS
  const painter = state.facet(inkCellPainter)
  const holding = state.field(holdingField, false) ?? false
  const ranges = state.selection.ranges
  const folded = (state.field(foldField, false)?.hidden.length ?? 0) > 0
  const seen = new Set<string>()
  const out: Array<{ from: number; to: number; spec: CellSpec }> = []
  for (const i of indices) {
    const cell = cells[i] as PictureCell
    const { alt, path, file, ink } = cell.block
    // The FIRST line of an id is the live one, folded away or not; any later copy is read-only.
    const first = ink !== null && !seen.has(ink)
    if (ink !== null) seen.add(ink)
    if (folded && insideHidden(state, cell.range)) continue
    const from = cell.range.location
    const to = end(cell.range)
    const aspect = first ? (aspects.get(ink!) ?? painter?.aspect(ink!) ?? null) : null
    const live = aspect !== null && Number.isFinite(aspect) && aspect > 0
    const before = cells[i - 1]?.range
    out.push({
      from, to,
      spec: {
        alt, path, file, ink, live, aspect: live ? aspect! : 0,
        held: ranges.some((r) => !r.empty && r.from <= from && r.to >= to && (holding || r.from < from || r.to > to)),
        // (A picture stands apart from a cell it touches, core `standsAlone`: the gap in front of it is apart.ts's own
        // block, on both pages, so this is only ever true for a kind of cell that does not.)
        touching: rendered && before !== undefined && before.length > 0 && from === end(before) + 1 && !apartAbove(cells, i),
      },
    })
  }
  return out
}

function build(state: EditorState): DecorationSet {
  const all = specs(state)
  if (all.length === 0) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to, spec } of all) {
    builder.add(from, to, Decoration.replace({ widget: new PictureCellWidget(spec), block: true }))
  }
  return builder.finish()
}

/** The block widgets over every picture line, in both panes. Also the atomic ranges. */
export const pictureCellsField = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update(value, transaction) {
    const painterMoved = transaction.startState.facet(inkCellPainter) !== transaction.state.facet(inkCellPainter)
    if (!transaction.docChanged && !transaction.selection && transaction.effects.length === 0 && !painterMoved) return value
    // No picture before and none now: nothing to do (the common case, on every keystroke of every note).
    if (value === Decoration.none && pictureIndices(notebook(transaction.state).cells).length === 0) return value
    return build(transaction.state)
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
})

// MARK: - Typing and deleting beside a picture

/** The picture cells (start-state ranges) a change from `from` to `to` touches, its line breaks either side included. */
function picturesTouching(state: EditorState, from: number, to: number): PictureCell[] {
  const cells = notebook(state).cells
  if (pictureIndices(cells).length === 0) return []
  const out: PictureCell[] = []
  for (let i = firstCellFromBy(cells, to + 2, (cell) => cell.range) - 1; i >= 0; i--) {
    const cell = cells[i]!
    if (end(cell.range) + 1 < from) break
    if (isPicture(cell) && cell.range.length > 0) out.unshift(cell)
  }
  return out
}

/**
 * Words never share a picture's line. A transaction that types at a picture line's edge gets a blank line put
 * between; a Backspace or Delete with a caret that would join the line to its neighbour, or take it, holds it.
 */
const guardPictureLines = EditorState.transactionFilter.of((tr): TransactionSpec | readonly TransactionSpec[] => {
  if (!tr.docChanged) return tr
  const typing = tr.isUserEvent("input") && !tr.isUserEvent("input.dock")
  const deleting = tr.isUserEvent("delete")
  if (!typing && !deleting) return tr
  const start = tr.startState
  const touched = new Map<number, PictureCell>()
  tr.changes.iterChangedRanges((fromA, toA) => {
    for (const cell of picturesTouching(start, fromA, toA)) touched.set(cell.range.location, cell)
  })
  if (touched.size === 0) return tr
  const caret = start.selection.ranges.length === 1 && start.selection.main.empty
  const doc = tr.newDoc
  const fixes: Array<{ from: number; insert: string }> = []
  for (const cell of touched.values()) {
    const f = cell.range.location
    const t = end(cell.range)
    let taken = false
    let cut = false
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (toA <= fromA) {
        if (fromA > f && fromA < t) cut = true
      } else if (fromA <= f && toA >= t) taken = true
      else if (fromA < t && toA > f) cut = true
    })
    if (taken || cut) {
      // Taken (or cut into) with a caret: Backspace at its end, Delete at its start. Held instead.
      if (deleting && caret) return hold(f, t)
      continue
    }
    const newFrom = tr.changes.mapPos(f, 1)
    const newTo = tr.changes.mapPos(t, -1)
    const joinedBefore = doc.lineAt(newFrom).from < newFrom
    const joinedAfter = doc.lineAt(newTo).to > newTo
    if (!joinedBefore && !joinedAfter) continue
    if (deleting && caret) return hold(f, t)
    if (joinedBefore) fixes.push({ from: newFrom, insert: "\n\n" })
    if (joinedAfter) fixes.push({ from: newTo, insert: "\n\n" })
  }
  if (fixes.length === 0) return tr
  return [tr, { changes: fixes, sequential: true }]
})

const hold = (from: number, to: number): TransactionSpec => ({
  selection: EditorSelection.range(from, to),
  effects: setHolding.of(true),
  scrollIntoView: true,
  userEvent: "select.hold",
})

/**
 * Whether `pos` is a picture cell's start or end (the only places a caret can be beside one).
 */
export const besidePicture = (state: EditorState, pos: number): boolean =>
  picturesTouching(state, pos, pos).some((cell) => cell.range.location === pos || end(cell.range) === pos)

/**
 * Typing with the caret beside a picture goes in at THAT caret. The browser's own caret cannot stand at a block
 * widget's edge, so CodeMirror parks it in the line next to the widget and the browser types there: a character typed
 * "before the photo" landed on the blank line under it. The words go in at the editor's caret instead, and the filter
 * above puts them on a line of their own. (An armed bar is the cursor: its own handler opens the cell there.)
 */
const typingBeside = EditorView.inputHandler.of((view, from, to, text) => {
  const state = view.state
  const { ranges, main } = state.selection
  if (text.length === 0 || ranges.length !== 1 || !main.empty || view.composing) return false
  if ((state.field(armedField, false) ?? null) !== null) return false
  if (from === main.head && to === main.head) return false
  if (!besidePicture(state, main.head)) return false
  view.dispatch({
    changes: { from: main.head, insert: text },
    selection: EditorSelection.cursor(main.head + text.length),
    scrollIntoView: true,
    userEvent: "input.type",
  })
  return true
})

// MARK: - Geometry, for the drawing layer

/** Tells the registry's listeners after any change that can move a cell (in the measure cycle's write phase). */
const geometry = ViewPlugin.fromClass(class {
  private readonly measure = { key: "wm-ink-places", read: () => null, write: () => inkCellsMoved() }
  constructor(readonly view: EditorView) {
    // End-to-end scripts (their preload adds e2ePerf) reach the cells' API through the view.
    if ((globalThis as { wm?: { e2ePerf?: unknown } }).wm?.e2ePerf) {
      (view as unknown as { __wmPictures: unknown }).__wmPictures = {
        setInkAspects: (entries: Array<[string, number]>) => view.dispatch({ effects: setInkAspects.of(new Map(entries)) }),
        places: () => inkCellPlaces.all(view.dom).map((p) => ({ id: p.id, live: p.live, box: p.box().toJSON() })),
        repaint: (ids?: string[]) => repaintInkCells(view, ids),
        aspects: () => [...(view.state.field(inkAspectsField, false) ?? NO_ASPECTS)],
        armed: () => view.state.field(armedField, false) ?? null,
        holding: () => view.state.field(holdingField, false) ?? false,
        cursorSeam: () => cursorSeam(view.state),
        dropTargetAt: (x: number, y: number) => dropTargetAt(view, x, y),
        showDrop: (target: DropTarget | null) => showDropTarget(view, target),
        column: () => columnBox(view),
        insert: (line: string, offset: number) => insertCellLine(view, line, offset),
      }
    }
  }
  update(update: ViewUpdate) {
    if (update.startState.facet(inkCellPainter) !== update.state.facet(inkCellPainter)) {
      update.view.requestMeasure({ key: "wm-ink-repaint", read: () => null, write: () => repaintInkCells(update.view) })
    }
    if (!anyInkCells()) return
    if (update.geometryChanged || update.docChanged || update.viewportChanged) update.view.requestMeasure(this.measure)
  }
})

// MARK: - Look

const theme = EditorView.baseTheme({
  // The cell is the content box less the line's own 2px each side: the TEXT column, the column the paper draws.
  ".wm-cellpic": { padding: "0 2px", userSelect: "none", cursor: "default", position: "relative" },
  ".wm-cellpic img": { display: "block", maxWidth: "100%", height: "auto", borderRadius: "3px" },
  ".wm-cellpic-missing": {
    height: `${PICTURE_LINE}px`, lineHeight: `${PICTURE_LINE}px`, overflow: "hidden", whiteSpace: "nowrap",
    textOverflow: "ellipsis", fontSize: "13px", fontStyle: "italic", color: "var(--wm-faint, #999)",
  },
  ".wm-cellpic-missing .wm-cellpic-words::before": { content: '"▨ "', fontStyle: "normal", opacity: "0.7" },
  ".wm-cellpic-held": {
    backgroundColor: "color-mix(in srgb, var(--wm-accent, #2d7dd2) 16%, transparent)",
    borderRadius: "4px",
  },
  ".wm-cellpic-held img, .wm-cellpic-held .wm-inkcell-box": {
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--wm-accent, #2d7dd2) 70%, transparent)",
  },
  ".wm-inkcell-box": {
    position: "relative",
    width: "100%",
    borderRadius: "6px",
    backgroundColor: "color-mix(in srgb, var(--wm-text, #000) 3.5%, transparent)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--wm-text, #000) 9%, transparent)",
  },
  ".wm-inkcell-ink": { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", display: "block" },
  ".wm-cell-resize": {
    position: "absolute", left: "0", right: "0", bottom: "0", height: "8px", cursor: "ns-resize", touchAction: "none",
  },
  ".wm-cell-resize::after": {
    content: '""', position: "absolute", left: "50%", bottom: "2px", width: "36px", height: "3px", marginLeft: "-18px",
    borderRadius: "2px", backgroundColor: "color-mix(in srgb, var(--wm-text, #000) 22%, transparent)", opacity: "0",
    transition: "opacity 120ms",
  },
  ".wm-inkcell:hover .wm-cell-resize::after, .wm-inkcell-box.wm-resizing .wm-cell-resize::after": { opacity: "1" },
  // The cell a dragged selection would be docked INTO.
  ".wm-drop .wm-inkcell-box": {
    backgroundColor: "color-mix(in srgb, var(--wm-accent, #2d7dd2) 9%, transparent)",
    boxShadow: "inset 0 0 0 2px var(--wm-accent, #2d7dd2)",
  },
})

/** Picture and ink cells, both panes: the widgets, atomic, the edge filter, the registry's geometry, the look. */
export const pictureCells: Extension = [
  inkAspectsField, holdingField, renderedField, pictureCellsField, guardPictureLines, Prec.high(typingBeside), geometry, theme,
]

/** (For tests and the dock: whether a transaction's result keeps every picture on a line of its own.) */
export const picturesWhole = (state: EditorState): boolean =>
  pictureCellsOf(state).every((cell) => {
    const line = state.doc.lineAt(cell.range.location)
    return line.from === cell.range.location && line.to === end(cell.range)
  })

