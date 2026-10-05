/**
 * The bar between two cells: the seam layer, the arming, and what typing at
 * an armed bar does.
 *
 * The rules are the core's (`seams`, `arm`, `openCell`) and are the same
 * ones the Mac draws from. What is different is how the cells are measured —
 * `view.lineBlockAt` instead of an NSLayoutManager — and that the caret
 * lands on the blank line by itself here, so arming mostly needs no click at
 * all: it is a reading of where the caret is, which is what it always was.
 *
 * An armed bar IS the cursor, so the caret is turned off while it is up.
 */

import {
  EditorSelection, Prec, StateEffect, StateField, type Extension, type Transaction,
} from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view"
import {
  armIn, between, end, firstCellFromBy, GAP_HEIGHT, onPlus, openCell, plus, seamAt, seams, type CellBox, type CellKind,
  type PositionedBlock, type Range, type Seam,
} from "@writemind/core"
import { hiddenNow, insideHidden } from "./fold"
import { setHolding } from "./preview/hold"
import { notebook } from "./notebook"

/** Arm a seam by hand — the two ends of the page, which no caret can name. */
export const armSeam = StateEffect.define<number | null>()
/** What kind of cell the next character at the bar opens. */
export const setArmedType = StateEffect.define<CellKind>()

/**
 * The bar a dragged selection would be docked at (docs\PLAN-docking-ink-cells.md (d)): a seam's offset, or null.
 * Drawn by the seam layer, heavier than the armed bar and apart from it; the armed bar (the cursor) stays as it was.
 */
export const showDropBar = StateEffect.define<number | null>()

export const dropBarField = StateField.define<number | null>({
  create() { return null },
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(showDropBar)) return effect.value
    return value === null || !transaction.docChanged ? value : transaction.changes.mapPos(value, 1)
  },
})

export const armedField = StateField.define<number | null>({
  create() { return null },
  update(value, transaction: Transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(armSeam)) return effect.value
    }
    if (!transaction.docChanged && !transaction.selection) return value
    // A transaction that names the selection it already had (a focus, the page switching dress) moves nothing, so a
    // bar armed by hand where no blank line is (two cells that touch: `armAt`) stays up. A click is never this: the
    // pointer's own selection always asks again.
    if (value !== null && !transaction.docChanged && transaction.selection
      && transaction.selection.eq(transaction.startState.selection) && !transaction.isUserEvent("select.pointer")) return value
    const head = transaction.state.selection.main
    // The Mac's rule lets an armed offset stand while the caret sits ON it,
    // because there a click in a bar leaves the caret at the first character
    // of the cell below. Here the caret lands on the blank line itself, so
    // the rule only has to cover the two ends of the page, which no caret
    // can name; anywhere else a caret that has walked into the next cell
    // has left the bar.
    const length = transaction.state.doc.length
    const standing = value !== null && (value === 0 || value === length) ? value : null
    // (The note is not turned into a string for this: it runs on every caret move and every keystroke.)
    return armIn({ location: head.from, length: head.to - head.from }, transaction.state.doc,
      () => notebook(transaction.state).cells, standing)
  },
})

export const armedTypeField = StateField.define<CellKind>({
  create() { return { kind: "text" } },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setArmedType)) return effect.value
    }
    // The choice rides with the bar and goes back to plain text the moment
    // it moves, so no path can leave a stale kind behind.
    const before = transaction.startState.field(armedField, false) ?? null
    const after = transaction.state.field(armedField, false) ?? null
    return before === after ? value : { kind: "text" }
  },
})

/** Where the note's left margin is, so the + sits outside the words. */
export const PLUS_LEADING = 6
/** How far (px) a press in a seam must travel before it picks cells (the Mac's CellInsertions.dragThreshold, in points). */
const SEAM_DRAG = 10

/** The boxes the seams are built from, measured off the laid-out lines. */
export function cellBoxes(view: EditorView): CellBox[] {
  const cells = notebook(view.state).cells.filter((cell) => !insideHidden(view.state, cell.range))
  const length = view.state.doc.length
  return cells.map((cell) => {
    const from = Math.min(cell.range.location, length)
    const to = Math.min(Math.max(cell.range.location, cell.range.location + cell.range.length - 1), length)
    const pad = view.documentPadding.top
    const top = view.lineBlockAt(from).top + pad
    const bottom = view.lineBlockAt(to).bottom + pad
    return { top, bottom, offset: cell.range.location }
  })
}

export function pageSeams(view: EditorView): Seam[] {
  return seams({
    cells: cellBoxes(view),
    pageTop: 0,
    pageBottom: Math.max(view.contentHeight, view.scrollDOM.clientHeight),
    noteLength: view.state.doc.length,
    firstCellTop: GAP_HEIGHT,
  })
}

// MARK: - Seams one place at a time
//
// `pageSeams` measures EVERY cell (a `lineBlockAt` pair each: 4 ms in a 2 MB note) and the layer asked for it on the
// first pointer move or press after every edit — a double-click on a bracket cost a seam measurement of the whole
// note. A seam is the space between two cells, and its box is a function of those two cells' boxes alone, so the
// ones near a point are made from the cells near it.

/** The next cell (`dir` 1) or the one before (`dir` -1) that is on show, or -1 / `cells.length` past the ends. */
function shownBeyond(view: EditorView, cells: readonly PositionedBlock[], from: number, dir: 1 | -1): number {
  let i = from + dir
  while (i >= 0 && i < cells.length && insideHidden(view.state, cells[i]!.range)) {
    // A closed section hides a run of cells: jump past all of it.
    const at = cells[i]!.range.location
    const hidden = hiddenNow(view.state).find((r) => at > r.location && at < end(r))
    if (!hidden) { i += dir; continue }
    i = dir > 0 ? firstCellFromBy(cells, end(hidden) + 1, (c) => c.range) : firstCellFromBy(cells, hidden.location, (c) => c.range) - 1
  }
  return i
}

const boxOf = (view: EditorView, cell: PositionedBlock): CellBox => {
  const length = view.state.doc.length
  const from = Math.min(cell.range.location, length)
  const to = Math.min(Math.max(cell.range.location, cell.range.location + cell.range.length - 1), length)
  const pad = view.documentPadding.top
  return { top: view.lineBlockAt(from).top + pad, bottom: view.lineBlockAt(to).bottom + pad, offset: cell.range.location }
}

/**
 * The seams round the cell at `index` (two cells on show either side of it): what `pageSeams` answers there, and
 * no others. The seams at the ends of the page are only included when the window reaches the first or last cell.
 */
export function seamsAround(view: EditorView, index: number): Seam[] {
  const cells = notebook(view.state).cells
  const length = view.state.doc.length
  const pageBottom = Math.max(view.contentHeight, view.scrollDOM.clientHeight)
  const none = () => seams({ cells: [], pageTop: 0, pageBottom, noteLength: length, firstCellTop: GAP_HEIGHT })
  if (cells.length === 0) return none()
  // The centre is a cell on show: this one, or the nearest before it, or the first after.
  let centre = Math.min(Math.max(index, 0), cells.length - 1)
  if (insideHidden(view.state, cells[centre]!.range)) {
    const before = shownBeyond(view, cells, centre, -1)
    centre = before >= 0 ? before : shownBeyond(view, cells, centre, 1)
  }
  if (centre < 0 || centre >= cells.length) return none()
  const window: number[] = [centre]
  let low = centre
  let high = centre
  for (let k = 0; k < 2; k++) {
    const b = shownBeyond(view, cells, low, -1)
    if (b >= 0) { window.unshift(b); low = b }
    const a = shownBeyond(view, cells, high, 1)
    if (a < cells.length) { window.push(a); high = a }
  }
  const startsPage = shownBeyond(view, cells, low, -1) < 0
  const endsPage = shownBeyond(view, cells, high, 1) >= cells.length
  const made = seams({
    cells: window.map((i) => boxOf(view, cells[i]!)),
    pageTop: 0,
    pageBottom,
    noteLength: length,
    firstCellTop: GAP_HEIGHT,
  })
  // (The first of `made` is "the page above the first cell" and the last is "the page below the last": true of the
  // window's ends only when the window's ends are the page's.)
  return made.slice(startsPage ? 0 : 1, endsPage ? made.length : made.length - 1)
}

/**
 * The index of the last cell whose top is at or above `y` (the page's own coordinates), by search over the cells'
 * own boxes. (Not `lineBlockAtHeight`: where the page has not been laid out CodeMirror estimates, and the estimate
 * for "which line is at this height" is not the inverse of the one for "where is this line" — it was several cells out.)
 */
function cellIndexAtY(view: EditorView, y: number): number {
  const cells = notebook(view.state).cells
  const length = view.state.doc.length
  const pad = view.documentPadding.top
  let low = 0
  let high = cells.length
  while (low < high) {
    const middle = (low + high) >> 1
    const top = view.lineBlockAt(Math.min(cells[middle]!.range.location, length)).top + pad
    if (top <= y) low = middle + 1
    else high = middle
  }
  return Math.max(0, low - 1)
}

/**
 * The cell on show at height `y` of the page — the last one whose top is at or above it, else the first on show —
 * as its offset. What the two modes agree on when you switch (`topCell`), without measuring every cell.
 */
export function cellOffsetAt(view: EditorView, y: number): number | null {
  const cells = notebook(view.state).cells
  if (cells.length === 0) return null
  let index = cellIndexAtY(view, y)
  if (insideHidden(view.state, cells[index]!.range)) {
    const before = shownBeyond(view, cells, index, -1)
    index = before >= 0 ? before : shownBeyond(view, cells, index, 1)
  }
  return index >= 0 && index < cells.length ? cells[index]!.range.location : null
}

/** The offset of the first cell on show that reaches down to `y` (its bottom at or below it), or null if none does. */
export function firstCellReaching(view: EditorView, y: number): number | null {
  const cells = notebook(view.state).cells
  const length = view.state.doc.length
  const pad = view.documentPadding.top
  let low = 0
  let high = cells.length
  while (low < high) {
    const middle = (low + high) >> 1
    const cell = cells[middle]!
    const to = Math.min(Math.max(cell.range.location, cell.range.location + cell.range.length - 1), length)
    if (view.lineBlockAt(to).bottom + pad >= y) high = middle
    else low = middle + 1
  }
  if (low >= cells.length) return null
  if (insideHidden(view.state, cells[low]!.range)) low = shownBeyond(view, cells, low, 1)
  return low < cells.length ? cells[low]!.range.location : null
}

/** The seam at height `y` of the page, or null for a point that is on a cell. */
export function seamAtY(view: EditorView, y: number): Seam | null {
  return seamAt(y, seamsAround(view, cellIndexAtY(view, y)))
}

// MARK: - Where the pointer is: ONE answer for the cursor and the click (Mac 17f0f82)

/**
 * The things inside the page that answer for the pointer themselves — the bracket column, an ink cell's resize strip,
 * an evaluation cell's controls — and so are never a seam's, for the cursor or for the click.
 */
export const OWN_POINTER = [".wm-gutter", ".wm-cell-resize", ".wm-eval-badge", ".wm-eval-lang", ".wm-eval-spin", ".wm-eval-notice"]
const OWN_POINTER_SELECTOR = OWN_POINTER.join(", ")

/** What a press at a point of the page does, as far as the seams are concerned: open the + menu, arm a bar, or neither. */
export type PointerPlace = { kind: "plus"; seam: Seam } | { kind: "seam"; seam: Seam } | null

/**
 * THE hit-test of the seam layer, asked by the cursor and by the press alike, so the pointer can never promise what a
 * click does not do (Sean, 2026-10-05: "a horizontal text selector cursor between cells when clicking would put a
 * horizontal input cursor between cells"). A seam is the whole width of the page between two cells, except where
 * something answers for itself (`OWN_POINTER`) and the scroll bar; the + is pressable only where it is DRAWN — on the
 * armed bar when one is up, else on the seam under the pointer (the Mac's `pressesPlus(drawnOn: armed ?? seam)`).
 */
export function pointerPlace(view: EditorView, target: EventTarget | null, clientX: number, clientY: number): PointerPlace {
  if (target instanceof Element && target.closest(OWN_POINTER_SELECTOR)) return null
  const scroller = view.scrollDOM.getBoundingClientRect()
  if (clientX < scroller.left || clientX >= scroller.left + view.scrollDOM.clientWidth) return null
  if (clientY < scroller.top || clientY >= scroller.top + view.scrollDOM.clientHeight) return null
  const box = view.contentDOM.getBoundingClientRect()
  const x = clientX - box.left
  const y = clientY - box.top
  const seam = seamAtY(view, y)
  if (!seam) return null
  const armed = view.state.field(armedField, false) ?? null
  if ((armed ?? seam.offset) === seam.offset && onPlus(x, y, seam, PLUS_LEADING)) return { kind: "plus", seam }
  return { kind: "seam", seam }
}

/**
 * Arm the bar at `offset` (a cell's start, or the note's end) as a click there does: the caret goes on the blank line
 * the bar stands on, where there is one, so the bar is a reading of the caret as it always is; where there is none (the
 * two ends of the note, two cells that touch) the caret waits at the offset and the bar is armed by hand.
 */
export function armAt(view: EditorView, offset: number): void {
  const doc = view.state.doc
  const at = Math.min(Math.max(offset, 0), doc.length)
  let caret = at
  if (at > 0 && at < doc.length) {
    const line = doc.lineAt(at - 1)
    if (line.text.trim().length === 0
      && armIn({ location: line.from, length: 0 }, doc, () => notebook(view.state).cells, null) === at) caret = line.from
  }
  view.dispatch({ selection: { anchor: caret }, effects: armSeam.of(at), userEvent: "select" })
}

/** The seam that opens a cell at `offset` (a cell's start, or the note's end), or null. */
export function seamAtOffset(view: EditorView, offset: number): Seam | null {
  const cells = notebook(view.state).cells
  let index = firstCellFromBy(cells, offset, (c) => c.range)
  if (index < cells.length && cells[index]!.range.location !== offset) return null
  if (index >= cells.length) {
    if (offset !== view.state.doc.length) return null
    index = cells.length - 1
  }
  return seamsAround(view, index).find((seam) => seam.offset === offset) ?? null
}

/**
 * The seam AFTER the cell on show at height `y` of the page (the Mac's rule for a drop over a cell: it goes under
 * it), as its offset: the next cell's start, or the note's length.
 */
export function seamAfterCellAt(view: EditorView, y: number): number {
  const cells = notebook(view.state).cells
  const length = view.state.doc.length
  if (cells.length === 0) return length
  let index = cellIndexAtY(view, y)
  if (insideHidden(view.state, cells[index]!.range)) {
    const before = shownBeyond(view, cells, index, -1)
    index = before >= 0 ? before : shownBeyond(view, cells, index, 1)
  }
  if (index < 0 || index >= cells.length) return length
  // Past any run of extra blank lines (a cell of its own to the parser, not a place a picture goes after).
  let next = shownBeyond(view, cells, index, 1)
  while (next < cells.length && cells[next]!.block.kind === "blank") next = shownBeyond(view, cells, next, 1)
  return next < cells.length ? cells[next]!.range.location : length
}

/** The cursor is the bar, so no caret blinks anywhere else while it is up. */
const hideCaret = EditorView.theme({
  // visibility, not display: the base theme sets display on a focused editor's
  // cursor at a higher specificity, and a different property cannot lose to it.
  "&.wm-armed .cm-cursor, &.wm-armed .cm-cursor-primary": { display: "none", visibility: "hidden" },
})

class SeamLayer {
  readonly dom: HTMLElement
  private hovered: number | null = null
  private drawn = ""

  /**
   * Nothing is drawn for the seams unless one is armed or hovered, and then only the seams at that place are
   * measured (`seamsAround`) — never all of them.
   */
  invalidate(): void { /* (nothing is kept: see `seamsAround`) */ }

  /** Where the pointer was last seen over the page (client px), so a scroll or an edit under a still pointer asks again. */
  private last: { x: number; y: number } | null = null

  constructor(private readonly view: EditorView, private readonly onPlusPressed: (seam: Seam) => void) {
    this.dom = document.createElement("div")
    this.dom.className = "wm-seams"
    view.scrollDOM.appendChild(this.dom)
    view.scrollDOM.addEventListener("mousemove", this.move)
    view.scrollDOM.addEventListener("mouseleave", this.leave)
    view.scrollDOM.addEventListener("mousedown", this.press, true)
    view.scrollDOM.addEventListener("scroll", this.scrolled, { passive: true })
    this.draw()
  }

  /**
   * ONE OWNER FOR THE POINTER over the page (Mac 17f0f82): the cursor is said by `pointerPlace`, the very call the press
   * makes, as an attribute on the scroller that the theme turns into the cursor for everything in it (`pointerCursors`)
   * — the vertical I-beam over a seam, the hand over the +. Nothing else on the page sets it, so the pointer has one
   * answer at every point and cannot flip between two on the way across (row-resize on the scroller lost to a drawn
   * block's own I-beam, which is how a seam over the edge of a block said two things).
   */
  private show(place: PointerPlace): void {
    const want = place ? place.kind : ""
    const scroller = this.view.scrollDOM
    if ((scroller.dataset.wmPointer ?? "") === want) return
    if (want) scroller.dataset.wmPointer = want
    else delete scroller.dataset.wmPointer
  }

  /** The pointer is at a client point over `target`: the faint bar it lights, and its cursor. */
  private point(target: EventTarget | null, x: number, y: number): void {
    const place = pointerPlace(this.view, target, x, y)
    const offset = place ? place.seam.offset : null
    if (offset !== this.hovered) { this.hovered = offset; this.draw() }
    this.show(place)
  }

  private move = (event: MouseEvent) => {
    this.last = { x: event.clientX, y: event.clientY }
    this.point(event.target, event.clientX, event.clientY)
  }

  /** The page moved under a pointer that did not (the wheel, a keyboard scroll): what is under it now. */
  private scrolled = () => this.again()

  /** Ask again for the pointer where it was last seen: the page under it scrolled or was laid out again. */
  again(): void {
    if (!this.last) return
    const { x, y } = this.last
    this.point(document.elementFromPoint(x, y), x, y)
  }

  private leave = () => {
    this.last = null
    this.show(null)
    if (this.hovered === null) return
    this.hovered = null
    this.draw()
  }

  /**
   * A press is answered by `pointerPlace`, as the cursor was: on the + it opens the kinds; anywhere else in a seam it
   * ARMS THAT BAR, always (`armAt`) — not left to the editor's own click, which on two cells that touch put the caret in
   * one of them, and on the rendered page opened the block whose edge the seam runs over. Shift still reaches.
   */
  private press = (event: MouseEvent) => {
    if (event.button !== 0) return
    const place = pointerPlace(this.view, event.target, event.clientX, event.clientY)
    if (!place) return
    if (place.kind === "plus") {
      event.preventDefault()
      event.stopPropagation()
      this.onPlusPressed(place.seam)
      return
    }
    if (event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    armAt(this.view, place.seam.offset)
    this.view.focus()
    this.follow(place.seam.offset, event.clientY)
  }

  /**
   * A drag from a seam picks WHOLE CELLS (the Mac's CellInsertions.mouseDragged): past `SEAM_DRAG`, from the cell next
   * to the seam on the side the drag goes (settled by the first real move, then kept) to the cell under the pointer,
   * held as a bracket drag holds them. A press that does not travel stays the armed bar.
   */
  private follow(offset: number, startY: number): void {
    let anchor: Range | null = null
    const ranges = (): Range[] => notebook(this.view.state).cells
      .filter((cell) => cell.block.kind !== "blank" && !insideHidden(this.view.state, cell.range))
      .map((cell) => cell.range)
    const onMove = (move: MouseEvent) => {
      if ((move.buttons & 1) === 0) { done(); return }
      const travelled = move.clientY - startY
      if (anchor === null && Math.abs(travelled) < SEAM_DRAG) return
      const cells = ranges()
      if (cells.length === 0) return
      if (anchor === null) {
        anchor = travelled > 0
          ? cells.find((r) => r.location >= offset) ?? cells[cells.length - 1]!
          : [...cells].reverse().find((r) => end(r) <= offset) ?? cells[0]!
      }
      const y = move.clientY - this.view.contentDOM.getBoundingClientRect().top
      const at = notebook(this.view.state).cells[cellIndexAtY(this.view, y)]?.range
      const over = at ? [...cells].reverse().find((r) => r.location <= at.location) ?? cells[0]! : null
      if (!over) return
      const wanted = between(anchor, over, cells)
      if (wanted.length === 0) return
      const now = this.view.state.selection.ranges
      if (now.length === wanted.length && wanted.every((r, i) => now[i]!.from === r.location && now[i]!.to === end(r))) return
      this.view.dispatch({
        selection: EditorSelection.create(wanted.map((r) => EditorSelection.range(r.location, end(r))), wanted.length - 1),
        effects: setHolding.of(true),
        userEvent: "select.pointer",
      })
      const box = this.view.scrollDOM.getBoundingClientRect()
      if (move.clientY > box.bottom - 24) this.view.scrollDOM.scrollTop += 24
      else if (move.clientY < box.top + 24) this.view.scrollDOM.scrollTop -= 24
    }
    const done = () => {
      document.removeEventListener("mousemove", onMove, true)
      document.removeEventListener("mouseup", done, true)
    }
    document.addEventListener("mousemove", onMove, true)
    document.addEventListener("mouseup", done, true)
  }

  draw(): void {
    const armed = this.view.state.field(armedField, false) ?? null
    const dropping = this.view.state.field(dropBarField, false) ?? null
    const marked = armed ?? this.hovered
    if (marked === null && this.hovered === null && dropping === null) {
      // Nothing to show: no measuring, and no DOM unless there was some. The layer is
      // as tall as the page only while it is drawing — left at the height of a longer
      // note it would keep the scroll area open under a shorter one.
      if (this.drawn !== "") { this.dom.textContent = ""; this.drawn = "" }
      if (this.dom.style.height !== "0px") this.dom.style.height = "0px"
      return
    }
    const height = `${this.view.contentHeight}px`
    if (this.dom.style.height !== height) this.dom.style.height = height
    this.dom.textContent = ""
    this.drawn = "x"

    const bar = (seam: Seam, faint: boolean) => {
      const line = document.createElement("div")
      line.className = faint ? "wm-bar wm-bar-faint" : "wm-bar"
      line.style.top = `${Math.round(seam.line) - 1}px`
      this.dom.appendChild(line)
    }

    const armedSeam = armed === null ? null : seamAtOffset(this.view, armed)
    const hoveredSeam = this.hovered === null ? null : seamAtOffset(this.view, this.hovered)
    if (armedSeam) bar(armedSeam, false)
    // The faint bar shows even when a solid one is drawn elsewhere (Sean,
    // 2026-09-21), so the pointer always says where a click would go.
    if (hoveredSeam && hoveredSeam.offset !== armedSeam?.offset) bar(hoveredSeam, true)
    // Where a dragged selection would be docked: its own heavier bar (the + is the cursor's, not the drop's).
    const dropSeam = dropping === null ? null : seamAtOffset(this.view, dropping)
    if (dropSeam) {
      const line = document.createElement("div")
      line.className = "wm-bar wm-bar-drop"
      line.style.top = `${Math.round(dropSeam.line) - 2}px`
      this.dom.appendChild(line)
    }

    const markedSeam = marked === armed ? armedSeam : marked === this.hovered ? hoveredSeam : null
    if (markedSeam) {
      const rect = plus(markedSeam.line, PLUS_LEADING)
      const dot = document.createElement("div")
      dot.className = "wm-plus"
      dot.style.left = `${rect.x}px`
      dot.style.top = `${rect.y}px`
      dot.style.width = `${rect.width}px`
      dot.style.height = `${rect.height}px`
      dot.textContent = "+"
      this.dom.appendChild(dot)
    }
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener("mousemove", this.move)
    this.view.scrollDOM.removeEventListener("mouseleave", this.leave)
    this.view.scrollDOM.removeEventListener("mousedown", this.press, true)
    this.view.scrollDOM.removeEventListener("scroll", this.scrolled)
    delete this.view.scrollDOM.dataset.wmPointer
    this.dom.remove()
  }
}

/**
 * The cursors the seam layer says (`SeamLayer.show`), for everything on the page — a drawn block's own I-beam, a gap
 * line, the margin — but the things that answer for themselves (`OWN_POINTER`, and what is inside them). Over the words
 * the page's own cursor is the I-beam, said once on the content.
 */
// (Chained, not one `:not(a, b)`: the theme's selectors are split at every comma, inside parentheses too.)
const notOwn = OWN_POINTER.map((one) => `:not(${one}):not(${one} *)`).join("")
const pointerCursors = EditorView.theme({
  ".cm-content": { cursor: "text" },
  [`.cm-scroller[data-wm-pointer=seam], .cm-scroller[data-wm-pointer=seam] ${notOwn}`]: { cursor: "vertical-text !important" },
  [`.cm-scroller[data-wm-pointer=plus], .cm-scroller[data-wm-pointer=plus] ${notOwn}`]: { cursor: "pointer !important" },
})

/** Make a cell of `kind` at the seam `offset` now, empty, with the caret in it where its words go (the + menu's choice). */
export function openCellAt(view: EditorView, offset: number, kind: CellKind): void {
  const at = Math.min(Math.max(offset, 0), view.state.doc.length)
  const opened = openCell(kind, view.state.doc.toString(), at, "")
  rewrite(view, opened.markdown, opened.caret)
}

/**
 * A command that WRITES something (maths from the palette) at an armed bar writes it in a new cell there, the Mac's
 * `perform(opensACell: true)`: the bar opens a body-text cell and the caller then runs where the caret is, in it.
 * Returns whether a cell was opened.
 */
export function openBarForWriting(view: EditorView): boolean {
  if ((view.state.field(armedField, false) ?? null) === null) return false
  view.dispatch({ effects: setArmedType.of({ kind: "text" }) })
  return openArmed(view, "")
}

/**
 * Typing at an armed bar opens a cell of the chosen kind and puts the
 * character in it — the funnel, and the only one: a caller that NAMES a
 * range means that range.
 */
/** Apply a whole-document rewrite as the one change it really is. */
function rewrite(view: EditorView, markdown: string, caret: number): void {
  const old = view.state.doc.toString()
  let from = 0
  const most = Math.min(old.length, markdown.length)
  while (from < most && old.charCodeAt(from) === markdown.charCodeAt(from)) from++
  let tail = 0
  while (tail < most - from
    && old.charCodeAt(old.length - 1 - tail) === markdown.charCodeAt(markdown.length - 1 - tail)) tail++
  view.dispatch({
    changes: { from, to: old.length - tail, insert: markdown.slice(from, markdown.length - tail) },
    selection: { anchor: caret },
    effects: armSeam.of(null),
    scrollIntoView: true,
    userEvent: "input.type",
  })
}

/** Open the cell an armed bar stands for, with `written` already in it. */
export function openArmed(view: EditorView, written: string): boolean {
  const armed = view.state.field(armedField, false) ?? null
  if (armed === null) return false
  const kind = view.state.field(armedTypeField, false) ?? { kind: "text" as const }
  const opened = openCell(kind, view.state.doc.toString(), armed, written)
  rewrite(view, opened.markdown, opened.caret)
  return true
}

const typingAtTheBar = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (text.length === 0) return false
  return openArmed(view, text)
})

/**
 * Return opens an empty cell at the bar, and Escape puts the bar out with
 * the note untouched. Every other key just goes about its business — the
 * caret leaving the blank line is what takes the bar back.
 */
const barKeys = keymap.of([
  { key: "Enter", run: (view) => openArmed(view, "") },
  {
    key: "Escape",
    run: (view) => {
      if ((view.state.field(armedField, false) ?? null) === null) return false
      view.dispatch({ effects: armSeam.of(null) })
      return true
    },
  },
])

/** Text pasted at a bar is a new cell, the same as a character typed there. */
const pasteAtTheBar = EditorView.domEventHandlers({
  paste(event, view) {
    const armed = view.state.field(armedField, false) ?? null
    const text = event.clipboardData?.getData("text/plain")
    if (armed === null || !text) return false
    event.preventDefault()
    openArmed(view, text)
    return true
  },
})

export function seamLayer(onPlusPressed: (view: EditorView, seam: Seam) => void): Extension {
  return ViewPlugin.fromClass(
    class {
      layer: SeamLayer
      // (And the pointer is asked again: what is under a still pointer changed with the page.)
      measure = { key: "wm-seams", read: () => null, write: () => { this.layer.draw(); this.layer.again() } }
      constructor(view: EditorView) {
        this.layer = new SeamLayer(view, (seam) => onPlusPressed(view, seam))
        // End-to-end scripts (their preload adds e2ePerf) hold the local seams to the whole-page ones: C:/CLAUDIO/agents/e2e/e3/seams-local.mjs.
        if ((globalThis as { wm?: { e2ePerf?: unknown } }).wm?.e2ePerf) {
          (view as unknown as { __wmSeams: unknown }).__wmSeams = { pageSeams: () => pageSeams(view), seamAtY: (y: number) => seamAtY(view, y), seamAtOffset: (o: number) => seamAtOffset(view, o), around: (i: number) => seamsAround(view, i), indexAtY: (y: number) => cellIndexAtY(view, y),
          place: (x: number, y: number) => { const p = pointerPlace(view, document.elementFromPoint(x, y), x, y); return p && { kind: p.kind, offset: p.seam.offset } },
          armed: () => view.state.field(armedField, false) ?? null }
        }
      }
      update(update: ViewUpdate) {
        // Positions are document-relative, so a scroll moves nothing here;
        // and the drawing waits for the measure phase, once, however many
        // updates asked for it.
        if (update.docChanged || update.geometryChanged) this.layer.invalidate()
        const armed = update.state.field(armedField, false) ?? null
        const was = update.startState.field(armedField, false) ?? null
        const dropMoved = update.state.field(dropBarField, false) !== update.startState.field(dropBarField, false)
        if (update.docChanged || update.geometryChanged || armed !== was || dropMoved) {
          update.view.requestMeasure(this.measure)
        }
      }
      destroy() { this.layer.destroy() }
    },
  )
}

export const seamExtensions = (onPlusPressed: (view: EditorView, seam: Seam) => void): Extension => [
  armedField,
  armedTypeField,
  dropBarField,
  typingAtTheBar,
  // An attribute the editor owns, not a class toggled by hand: CodeMirror
  // rewrites the root's class list whenever focus changes, which wiped a
  // hand-set class and put the caret back on screen beside the bar.
  EditorView.editorAttributes.compute([armedField], (state) =>
    (state.field(armedField, false) ?? null) !== null ? { class: "wm-armed" } : ({} as Record<string, string>)),
  Prec.high(barKeys),
  Prec.high(pasteAtTheBar),
  hideCaret,
  pointerCursors,
  seamLayer(onPlusPressed),
  // A bar that is the cursor LIGHTS NOTHING: the cell the caret is parked
  // against must not be drawn as the cell being typed in.
  EditorView.decorations.compute([armedField, "selection", "doc"], (state) => {
    if ((state.field(armedField, false) ?? null) !== null) return Decoration.none
    return Decoration.none
  }),
]
