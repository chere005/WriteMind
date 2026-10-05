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
 */

import { EditorSelection, type Extension } from "@codemirror/state"
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import {
  anchor as liveAnchor, between, cellAt, cellDepth, cellsOf, covers, firstCellFromBy, holdsSortedBy, sameRange, toggling,
  type PositionedBlock, type Range, type Section,
} from "@writemind/core"
import { notebook, selectedRanges } from "./notebook"
import { foldField, insideHidden, toggleFold } from "./fold"
import { moveHeldCells } from "./keys"
import { setHolding } from "./preview/hold"

export const GUTTER_WIDTH = 22
const STEP = 5
const TICK = 5
/** How far a press on a bracket travels before it stops being a click. */
const DRAG_THRESHOLD = 10

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
  range: Range
}

function brackets(view: EditorView): Bracket[] {
  const { cells, sections } = notebook(view.state)
  const selection = selectedRanges(view.state)
  const doc = view.state.doc
  const caret = view.state.selection.main
  const cellRange = (cell: PositionedBlock): Range => cell.range
  // The cell the caret is in — at the very end of its words too, which is
  // where a caret sits after typing (the Mac's `block(containing:)`). Found by search: the cells are in order.
  let caretCell: Range | null = null
  if (caret.empty) {
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
      depth: cellDepth(cell.range.location, sections),
      ...where, selected: lit, held, foldable: false, range: cell.range,
    })
  }
  return out
}

function nearest(y: number, x: number, all: Bracket[]): Bracket | null {
  const candidates = all.filter((bracket) =>
    y >= bracket.top - 4 && y <= bracket.bottom + 4
    && Math.abs(x - (GUTTER_WIDTH - 6 - bracket.depth * STEP)) <= 7)
  let best: Bracket | null = null
  for (const bracket of candidates) {
    const reach = Math.abs(x - (GUTTER_WIDTH - 6 - bracket.depth * STEP))
    const bestReach = best ? Math.abs(x - (GUTTER_WIDTH - 6 - best.depth * STEP)) : Infinity
    if (reach < bestReach) best = bracket
  }
  return best
}

class Gutter {
  readonly dom: HTMLElement
  private all: Bracket[] = []
  private anchor: Range | null = null

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement("div")
    this.dom.className = "wm-gutter"
    view.scrollDOM.appendChild(this.dom)
    this.dom.addEventListener("mousedown", this.press)
    this.dom.addEventListener("dblclick", this.double)
    this.draw()
  }

  /** A double-click on a section's bracket closes the section, or opens it again. */
  private double = (event: MouseEvent) => {
    const box = this.dom.getBoundingClientRect()
    const bracket = nearest(event.clientY - box.top, event.clientX - box.left,
      this.all.filter((b) => b.foldable))
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
    const box = this.dom.getBoundingClientRect()
    const bracket = nearest(event.clientY - box.top,
      event.clientX - box.left, this.all)
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
          const held = cellsOf(bracket.range, ranges)
          this.anchor = held[0] ?? null
          reported = held
          this.select(held)
        }
      }
      if (mode !== "picking") return
      const spans = this.all.filter((b) => !b.foldable)
        .sort((a, b) => a.top - b.top)
        .map((b) => ({ top: b.top, bottom: b.bottom, range: b.range }))
      const over = cellAt(move.clientY - this.dom.getBoundingClientRect().top, spans)
      const from = this.anchor ?? cellsOf(bracket.range, ranges)[0]
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
    const held = cellsOf(bracket.range, ranges)
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

  /** The elements already in the gutter, by bracket key: reused, never rebuilt. */
  private elements = new Map<string, HTMLElement>()

  draw(): void {
    this.all = brackets(this.view)
    const height = `${this.view.contentHeight}px`
    if (this.dom.style.height !== height) this.dom.style.height = height
    const seen = new Set<string>()
    // Stale elements go first, so the survivors can be put in order.
    for (const bracket of this.all) seen.add(bracket.key)
    for (const [key, element] of this.elements) {
      if (!seen.has(key)) { element.remove(); this.elements.delete(key) }
    }
    let position = 0
    for (const bracket of this.all) {
      const line = GUTTER_WIDTH - 6 - bracket.depth * STEP
      const key = bracket.key
      let element = this.elements.get(key)
      if (!element) {
        element = document.createElement("div")
        element.style.width = `${TICK}px`
        this.elements.set(key, element)
      }
      // The gutter's children stay in the brackets' own order.
      if (this.dom.children[position] !== element) this.dom.insertBefore(element, this.dom.children[position] ?? null)
      position++
      const classes = "wm-bracket" + (bracket.foldable ? " wm-bracket-group" : "") + (bracket.folded ? " wm-bracket-folded" : "")
        + (bracket.selected ? " wm-bracket-lit" : "")
      if (element.className !== classes) element.className = classes
      const top = `${bracket.top}px`
      const tall = `${Math.max(2, bracket.bottom - bracket.top)}px`
      const right = `${GUTTER_WIDTH - line}px`
      if (element.style.top !== top) element.style.top = top
      if (element.style.height !== tall) element.style.height = tall
      if (element.style.right !== right) element.style.right = right
    }
  }

  destroy(): void {
    this.dom.removeEventListener("mousedown", this.press)
    this.dom.removeEventListener("dblclick", this.double)
    this.dom.remove()
  }
}

export const cellBrackets: Extension = ViewPlugin.fromClass(
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

/** Which cells a command over "the selection" takes. */
export function heldCells(view: EditorView): Range[] {
  const ranges = notebook(view.state).cells.map((cell) => cell.range)
  const selection = selectedRanges(view.state)
  return ranges.filter((cell) => covers(cell, selection))
}
