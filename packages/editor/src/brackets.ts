/**
 * The notebook brackets down the right-hand side: one per cell, one further
 * out per section, the way Wolfram and Jupyter draw them.
 *
 * A LIT BRACKET IS NOT A HELD ONE. The caret's own cell is drawn heavy —
 * that is what says which cell you are typing in — so there is always one
 * bracket calling itself selected with nothing selected at all. `selected`
 * means "draw this heavy"; `held` means a real selection covers it, and
 * every GESTURE reads `held`. Both come from the core, which also answers
 * the one that cost a round: an outer bracket is held by its CELLS, not by
 * its own characters.
 *
 * ONE READER FOR WHERE THE POINTER IS (Mac 17f0f82): the bracket under the
 * pointer is `bracketAt`, and the hover light, the pointing hand and the press
 * all ask it — a bracket lit by CSS `:hover` on its 5-pixel box answered a
 * different question from the press, which reaches the nearest line. The
 * column is the gutter's alone: the hand over a bracket, the arrow beside one,
 * and the seam layer stays out of it.
 *
 * A HOVER PROMISES WHAT A CLICK WOULD TAKE (Mac f6d2714): the cells `takes`
 * answers for the bracket under the pointer are washed faintly over the words,
 * the width of the page — the same call the press makes, so the promise and the
 * press cannot disagree. And the cells a click took are drawn as the same boxes
 * (`heldLines`), so what is held lines up with the brackets that hold it.
 */

import { EditorSelection, RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import {
  anchor as liveAnchor, between, cellAt, cellDepth, cellsOf, covers, end, firstCellFromBy, holdsSortedBy, sameRange,
  toggling, type PositionedBlock, type Range, type Section,
} from "@writemind/core"
import { notebook, selectedRanges } from "./notebook"
import { foldField, insideHidden, toggleFold } from "./fold"
import { moveHeldCells } from "./keys"
import { armedField } from "./seams"
import { holdingField, setHolding } from "./preview/hold"
import { renderedField } from "./rendered"
import { groupsIn } from "./eval/index"
import { groupRange, isGroupedCell } from "@writemind/core"

export const GUTTER_WIDTH = 22
/** How far an In/Out pair's bracket stands proud of the two cells inside it (the Mac's `overhang`, 799b13b). */
export const PAIR_OVERHANG = 3
const STEP = 5
const TICK = 5
/** How many levels fit in the column, ticks and all; deeper ones share the last line (the Mac's `deepest`). */
export const DEEPEST = Math.floor((GUTTER_WIDTH - 6 - TICK) / STEP)
/** How near a bracket's line the pointer has to be to be on it, either side (the Mac's 4). */
const REACH = 4
/** How far a press on a bracket travels before it stops being a click. */
const DRAG_THRESHOLD = 10

/**
 * Where a bracket's line is, from the gutter's left edge. CLAMPED TO THE COLUMN: five pixels a level in a column
 * 22 wide, so a cell under three headings was drawn past the gutter's left edge, over the words.
 */
export const bracketLine = (depth: number): number => GUTTER_WIDTH - 6 - Math.min(Math.max(depth, 0), DEEPEST) * STEP

/** What a gutter hit-tests: where a bracket runs and how deep it is. */
export interface BracketSpot {
  depth: number
  top: number
  bottom: number
}

/**
 * The bracket at a point of the gutter (its own coordinates): the NEAREST line within reach (the first listed, on
 * a tie between two lines), and between two drawn on the SAME line (levels past `DEEPEST` share one) the shorter,
 * which is the one drawn inside the other. The hover, the cursor, the click and the double-click all ask this, so
 * they cannot disagree about which bracket it is.
 */
export function bracketAt<T extends BracketSpot>(x: number, y: number, all: readonly T[]): T | null {
  let best: T | null = null
  let bestReach = Infinity
  for (const bracket of all) {
    if (y < bracket.top - REACH || y > bracket.bottom + REACH) continue
    const reach = Math.abs(x - bracketLine(bracket.depth))
    if (reach > REACH) continue
    if (reach < bestReach || (best && bracketLine(bracket.depth) === bracketLine(best.depth)
      && bracket.bottom - bracket.top < best.bottom - best.top)) {
      best = bracket
      bestReach = reach
    }
  }
  return best
}

/**
 * What a click on a bracket takes — and so what a hover over it promises: the cells inside its range (a section's
 * bracket stands for every cell under its heading, the heading's own cell among them), and a bracket that holds no
 * cell stands for itself. ONE function for the press and the hover (the Mac's `CellSelection.cells(of:in:)`).
 */
export function takes(bracket: Range, cells: Range[]): Range[] {
  return cellsOf(bracket, cells)
}

interface Bracket {
  key: string
  depth: number
  top: number
  bottom: number
  selected: boolean
  held: boolean
  foldable: boolean
  /** The section key, for a bracket that folds. */
  section?: string
  folded?: boolean
  /**
   * An evaluation cell and its answer, embraced by one bracket — NOT A CELL AND NOT A SECTION (Mac 799b13b):
   * `!foldable` read as "is a cell" let the pair's own bracket join the list a drag walks down. Ask `isCell`.
   */
  group?: boolean
  range: Range
}

/** A cell of the note, rather than furniture round some (the Mac's `Bracket.isCell`). */
export const isCell = (bracket: Pick<Bracket, "foldable" | "group">): boolean => !bracket.foldable && !bracket.group

function brackets(view: EditorView): Bracket[] {
  const { cells, sections } = notebook(view.state)
  const selection = selectedRanges(view.state)
  const doc = view.state.doc
  const caret = view.state.selection.main
  const cellRange = (cell: PositionedBlock): Range => cell.range
  // The cell the caret is in — at the very end of its words too, which is
  // where a caret sits after typing (the Mac's `block(containing:)`). Found by search: the cells are in order.
  let caretCell: Range | null = null
  // (Not while a bar is the cursor: the caret is parked against the cell below a bar between two cells that touch,
  // and that cell is not the one being typed in — the bar lights nothing.)
  if (caret.empty && (view.state.field(armedField, false) ?? null) === null) {
    const last = firstCellFromBy(cells, caret.from + 1, cellRange) - 1
    const r = last >= 0 ? cells[last]!.range : null
    if (r && r.length > 0 && caret.from <= r.location + r.length) caretCell = r
  }
  const anySelection = selection.some((r) => r.length > 0)

  const box = (r: Range): { top: number; bottom: number } | null => {
    const from = Math.min(r.location, doc.length)
    const to = Math.min(Math.max(r.location, r.location + r.length - 1), doc.length)
    const pad = view.documentPadding.top
    const first = view.lineBlockAt(from)
    const last = view.lineBlockAt(to)
    if (last.bottom - first.top < 1) return null
    return { top: first.top + pad, bottom: last.bottom + pad }
  }

  // Only the brackets the viewport (and its margin) reaches are measured,
  // drawn and tested for being held: the rest are off the page. The cells and the sections are in order of
  // position, so the ones to look at are found by search and a walk — never by a pass over the whole note.
  const { from: viewFrom, to: viewTo } = view.viewport
  const reaches = (r: Range) => r.location <= viewTo && r.location + r.length >= viewFrom
  const hidden = view.state.field(foldField)

  const out: Bracket[] = []
  for (const section of sections as Section[]) {
    if (section.range.location > viewTo) break
    const stop = Math.min(Math.max(section.contentEnd, section.headingRange.location + section.headingRange.length),
      doc.length)
    if (stop < viewFrom || stop <= section.range.location) continue
    const r: Range = { location: section.range.location, length: stop - section.range.location }
    if (insideHidden(view.state, r)) continue
    const where = box(r)
    if (!where) continue
    const held = holdsSortedBy(r, cells, selection, cellRange)
    out.push({ key: `s:${section.key}`, depth: section.depth, ...where, selected: held, held, foldable: true,
      section: section.key, folded: hidden.collapsed.has(section.key), range: r })
  }
  // AN EVALUATION CELL AND ITS ANSWER ARE ONE GROUP (Mac 4fad93e): one bracket round the pair at the pair's depth,
  // and each member's own bracket one step in. Read off the note every time, so nothing about it can go stale.
  const pairs = groupsIn(view.state).filter((pair) => reaches(groupRange(pair)))
  for (let i = Math.max(0, firstCellFromBy(cells, viewFrom, cellRange) - 1); i < cells.length; i++) {
    const cell = cells[i]!
    if (cell.range.location > viewTo) break
    if (!reaches(cell.range) || insideHidden(view.state, cell.range)) continue
    const where = box(cell.range)
    if (!where) continue
    const held = holdsSortedBy(cell.range, cells, selection, cellRange)
    const lit = held || (!anySelection && caretCell !== null && sameRange(caretCell, cell.range))
    out.push({
      key: `cell:${cell.range.location}`,
      depth: cellDepth(cell.range.location, sections) + (isGroupedCell(cell.range, pairs) ? 1 : 0),
      ...where, selected: lit, held, foldable: false, range: cell.range,
    })
  }
  for (const pair of pairs) {
    const r = groupRange(pair)
    if (insideHidden(view.state, r)) continue
    const where = box(r)
    if (!where) continue
    const held = holdsSortedBy(r, cells, selection, cellRange)
    out.push({ key: `pair:${pair.key}`, depth: cellDepth(r.location, sections), ...where, selected: held, held,
      foldable: false, group: true, range: r })
  }
  return out
}

class Gutter {
  readonly dom: HTMLElement
  /** The faint promise over the words: what the bracket under the pointer would take. */
  private readonly wash: HTMLElement
  private all: Bracket[] = []
  private anchor: Range | null = null
  /** The key of the bracket under the pointer, or null. */
  private hovered: string | null = null
  /** What the wash was last drawn as, so an unchanged one is not rebuilt. */
  private washed = ""

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement("div")
    this.dom.className = "wm-gutter"
    // Under the words' other furniture (the bars are cursors and must keep reading as such): straight after the
    // content, so every layer added later — the seams, this gutter — is painted over it.
    this.wash = document.createElement("div")
    this.wash.className = "wm-wash"
    view.scrollDOM.insertBefore(this.wash, view.contentDOM.nextSibling)
    view.scrollDOM.appendChild(this.dom)
    this.dom.addEventListener("mousedown", this.press)
    this.dom.addEventListener("dblclick", this.double)
    this.dom.addEventListener("mousemove", this.move)
    this.dom.addEventListener("mouseleave", this.leave)
    this.draw()
  }

  /** The bracket under a pointer event, by the one reader. */
  private at(event: MouseEvent, among: readonly Bracket[] = this.all): Bracket | null {
    const box = this.dom.getBoundingClientRect()
    return bracketAt(event.clientX - box.left, event.clientY - box.top, among)
  }

  /** The hand over a bracket, the arrow beside one; and the bracket lit, with what it would take washed. */
  private move = (event: MouseEvent) => {
    const over = this.at(event)
    const cursor = over ? "pointer" : "default"
    if (this.dom.style.cursor !== cursor) this.dom.style.cursor = cursor
    this.hover(over?.key ?? null)
  }

  private leave = () => {
    this.dom.style.cursor = ""
    this.hover(null)
  }

  private hover(key: string | null): void {
    if (key === this.hovered) return
    if (this.hovered) this.elements.get(this.hovered)?.classList.remove("wm-bracket-hover")
    this.hovered = key
    if (key) this.elements.get(key)?.classList.add("wm-bracket-hover")
    this.drawWash()
  }

  /**
   * The cells a click on the hovered bracket would take, as boxes the height of their brackets and the width of
   * the page. Only the ones on show are drawn (the rest are off the page).
   */
  private drawWash(): void {
    const bracket = this.hovered === null ? undefined : this.all.find((b) => b.key === this.hovered)
    let boxes = ""
    if (bracket) {
      const cells = new Map<number, Bracket>()
      for (const b of this.all) if (isCell(b)) cells.set(b.range.location, b)
      for (const cell of takes(bracket.range, this.cellRanges())) {
        const shown = cells.get(cell.location)
        if (shown) boxes += `${shown.top},${shown.bottom};`
      }
    }
    if (boxes === this.washed) return
    this.washed = boxes
    this.wash.textContent = ""
    for (const box of boxes.split(";")) {
      if (!box) continue
      const [top, bottom] = box.split(",").map(Number) as [number, number]
      const element = document.createElement("div")
      element.className = "wm-wash-cell"
      element.style.top = `${top}px`
      element.style.height = `${Math.max(2, bottom - top)}px`
      this.wash.appendChild(element)
    }
  }

  /** A double-click on a section's bracket closes the section, or opens it again. */
  private double = (event: MouseEvent) => {
    const bracket = this.at(event, this.all.filter((b) => b.foldable))
    if (!bracket?.section) return
    event.preventDefault()
    toggleFold(this.view, bracket.section)
  }

  /**
   * A press on a bracket is settled by what the pointer does next, the way
   * the Mac's gutter settles it: a drag (10 points or more) off a bracket
   * that is NOT held takes every cell the pointer passes, live; off one
   * that IS held it moves the held cells by one place; a press that never
   * moved is a click (shift reaches, ctrl toggles, plain picks).
   */
  private press = (event: MouseEvent) => {
    if (event.button !== 0) return
    const bracket = this.at(event)
    if (!bracket) return
    event.preventDefault()
    this.view.focus()
    const ranges = this.cellRanges()
    const modified = event.shiftKey || event.metaKey || event.ctrlKey
    const startY = event.clientY
    // A bracket that is already held is the start of a MOVE, so a plain
    // press on it must not collapse the run to one cell until the button
    // is released without a drag.
    const moving = bracket.held && !modified
    let mode: "pending" | "picking" | "moving" = "pending"
    let reported: Range[] = []
    const onMove = (move: MouseEvent) => {
      if (mode === "pending") {
        if (Math.abs(move.clientY - startY) < DRAG_THRESHOLD) return
        if (moving) mode = "moving"
        else {
          mode = "picking"
          const held = takes(bracket.range, ranges)
          this.anchor = held[0] ?? null
          reported = held
          this.select(held)
        }
      }
      if (mode !== "picking") return
      const spans = this.all.filter(isCell)
        .sort((a, b) => a.top - b.top)
        .map((b) => ({ top: b.top, bottom: b.bottom, range: b.range }))
      const over = cellAt(move.clientY - this.dom.getBoundingClientRect().top, spans)
      const from = this.anchor ?? takes(bracket.range, ranges)[0]
      if (!over || !from) return
      const wanted = between(from, over, ranges)
      if (wanted.length === reported.length && wanted.every((r, i) => sameRange(r, reported[i]!))) return
      reported = wanted
      this.select(wanted)
      this.scrollToward(move.clientY)
    }
    const onUp = (up: MouseEvent) => {
      document.removeEventListener("mousemove", onMove, true)
      document.removeEventListener("mouseup", onUp, true)
      if (mode === "moving") {
        moveHeldCells(this.view, up.clientY < startY)
        return
      }
      if (mode === "picking") return
      this.click(bracket, event)
    }
    document.addEventListener("mousemove", onMove, true)
    document.addEventListener("mouseup", onUp, true)
  }

  private cellRanges(): Range[] {
    return notebook(this.view.state).cells.map((cell) => cell.range)
  }

  private select(wanted: Range[]): void {
    if (wanted.length === 0) return
    this.view.dispatch({
      selection: EditorSelection.create(
        wanted.map((r) => EditorSelection.range(r.location, r.location + r.length)),
        wanted.length - 1),
      // The cells are picked up (the rendered page keeps them drawn, and lit).
      effects: setHolding.of(true),
    })
  }

  /** A drag that reaches the top or bottom of the page takes the page along. */
  private scrollToward(clientY: number): void {
    const box = this.view.scrollDOM.getBoundingClientRect()
    if (clientY > box.bottom - 24) this.view.scrollDOM.scrollTop += 24
    else if (clientY < box.top + 24) this.view.scrollDOM.scrollTop -= 24
  }

  /** A press that never moved. */
  private click(bracket: Bracket, event: MouseEvent): void {
    const ranges = this.cellRanges()
    // A section's bracket stands for the cells under it, never for itself.
    const held = takes(bracket.range, ranges)
    const selection = selectedRanges(this.view.state).filter((r) => r.length > 0)
    let wanted: Range[]
    if (event.shiftKey) {
      const from = liveAnchor(this.anchor, ranges) ?? selection[0] ?? held[0]!
      wanted = between(from, held[held.length - 1]!, ranges)
    } else if (event.metaKey || event.ctrlKey) {
      wanted = held.reduce<Range[]>((out, cell) => toggling(cell, out), selection)
    } else {
      this.anchor = held[0] ?? null
      wanted = held
    }
    this.select(wanted)
  }

  /** The bracket elements by key, for the hover (rebuilt with every draw). */
  private elements = new Map<string, HTMLElement>()
  /**
   * The gutter's elements in the brackets' own order, REUSED BY POSITION (perf lane): a cell's key is where it
   * starts, so a keystroke re-keyed every bracket below the caret and the gutter threw away and rebuilt each of
   * them (8 removed, 8 inserted and 32 attributes written per keystroke on a long note). Now an edit that moves no
   * bracket on the screen writes nothing.
   */
  private pool: HTMLElement[] = []

  draw(): void {
    this.all = brackets(this.view)
    const height = `${this.view.contentHeight}px`
    if (this.dom.style.height !== height) this.dom.style.height = height
    this.elements.clear()
    for (let position = 0; position < this.all.length; position++) {
      const bracket = this.all[position]!
      const line = bracketLine(bracket.depth)
      const key = bracket.key
      let element = this.pool[position]
      if (!element) {
        element = document.createElement("div")
        element.style.width = `${TICK}px`
        this.dom.appendChild(element)
        this.pool.push(element)
      }
      this.elements.set(key, element)
      const classes = "wm-bracket" + (bracket.foldable ? " wm-bracket-group" : "") + (bracket.folded ? " wm-bracket-folded" : "")
        + (bracket.selected ? " wm-bracket-lit" : "") + (key === this.hovered ? " wm-bracket-hover" : "")
        + (bracket.group ? " wm-bracket-pair" : "")
      if (element.className !== classes) element.className = classes
      // A pair's bracket stands proud of the two cells inside it, or it reads as a second hairline (799b13b).
      const over = bracket.group ? PAIR_OVERHANG : 0
      const top = `${bracket.top - over}px`
      const tall = `${Math.max(2, bracket.bottom - bracket.top + 2 * over)}px`
      const right = `${GUTTER_WIDTH - line}px`
      if (element.style.top !== top) element.style.top = top
      if (element.style.height !== tall) element.style.height = tall
      if (element.style.right !== right) element.style.right = right
    }
    while (this.pool.length > this.all.length) this.pool.pop()!.remove()
    // The promise moves with the cells it is about (an edit, a fold, a scroll that laid out more of the page).
    if (this.hovered !== null && !this.elements.has(this.hovered)) this.hovered = null
    this.drawWash()
  }

  destroy(): void {
    this.dom.removeEventListener("mousedown", this.press)
    this.dom.removeEventListener("dblclick", this.double)
    this.dom.removeEventListener("mousemove", this.move)
    this.dom.removeEventListener("mouseleave", this.leave)
    this.dom.remove()
    this.wash.remove()
  }
}

const gutterPlugin = ViewPlugin.fromClass(
  class {
    gutter: Gutter
    constructor(view: EditorView) { this.gutter = new Gutter(view) }
    measure = { key: "wm-brackets", read: () => null, write: () => this.gutter.draw() }
    update(update: ViewUpdate) {
      // Coalesced into the measure phase: however many updates land in a
      // frame, the gutter is worked out once.
      if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged) {
        update.view.requestMeasure(this.measure)
      }
    }
    destroy() { this.gutter.destroy() }
  },
)

// MARK: - The cells a click took, drawn as cells

/** Whether held cells are drawn as cells here: they are held, and the page is the markdown (the rendered page lights its own blocks). */
const drawsHeld = (state: EditorState): boolean =>
  (state.field(holdingField, false) ?? false) && state.field(renderedField, false) !== true

const heldLine = [0, 1, 2, 3].map((edge) => Decoration.line({
  class: "wm-held" + (edge & 1 ? " wm-held-first" : "") + (edge & 2 ? " wm-held-last" : ""),
}))

/**
 * Every line of every held cell on the page, as one box per cell from its first line to its last: the box a hover
 * on its bracket promised, and exactly as tall as that bracket. CodeMirror's own selection drew a ragged run of
 * rectangles instead — the first lines out to the window's left edge and under the brackets, the last one only as
 * wide as its words (the "held-cell selection colour covers the text width only" of docs/PARITY.md).
 */
function heldDecorations(view: EditorView): DecorationSet {
  const state = view.state
  if (!drawsHeld(state)) return Decoration.none
  const selection = selectedRanges(state)
  const { cells } = notebook(state)
  const doc = state.doc
  const { from, to } = view.viewport
  const builder = new RangeSetBuilder<Decoration>()
  for (let i = Math.max(0, firstCellFromBy(cells, from, (c) => c.range) - 1); i < cells.length; i++) {
    const cell = cells[i]!.range
    if (cell.location > to) break
    if (cell.length <= 0 || end(cell) < from || !covers(cell, selection)) continue
    const first = doc.lineAt(Math.min(cell.location, doc.length)).number
    const last = doc.lineAt(Math.min(Math.max(cell.location, end(cell) - 1), doc.length)).number
    const shownFrom = Math.max(first, doc.lineAt(from).number)
    const shownTo = Math.min(last, doc.lineAt(to).number)
    for (let n = shownFrom; n <= shownTo; n++) {
      builder.add(doc.line(n).from, doc.line(n).from, heldLine[(n === first ? 1 : 0) | (n === last ? 2 : 0)]!)
    }
  }
  return builder.finish()
}

const heldLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = heldDecorations(view) }
    update(update: ViewUpdate) {
      const was = drawsHeld(update.startState)
      const is = drawsHeld(update.state)
      // Nothing to work out while nothing is held, which is nearly always.
      if (!was && !is) { if (this.decorations !== Decoration.none) this.decorations = Decoration.none; return }
      if (was !== is || update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = heldDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/**
 * While cells are held the selection's own rectangles and carets stay out of it, on either page: the boxes are the
 * selection here, the lit blocks are there, and a caret at the end of every held cell (CodeMirror draws one per
 * range) said "type here" about cells that were picked up.
 */
const holdingClass = EditorView.editorAttributes.compute([holdingField], (state) =>
  (state.field(holdingField, false) ?? false) ? { class: "wm-holding" } : ({} as Record<string, string>))

// (The two fields are named here as well as by their own extensions, so the compute above can never ask for one that is not there.)
export const cellBrackets: Extension = [holdingField, renderedField, gutterPlugin, heldLines, holdingClass]

/** Which cells a command over "the selection" takes. */
export function heldCells(view: EditorView): Range[] {
  const ranges = notebook(view.state).cells.map((cell) => cell.range)
  const selection = selectedRanges(view.state)
  return ranges.filter((cell) => covers(cell, selection))
}
