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
  anchor as liveAnchor, between, cellDepth, cellsOf, covers, holds, sameRange, toggling,
  type Range, type Section,
} from "@writemind/core"
import { notebook, selectedRanges } from "./notebook"

export const GUTTER_WIDTH = 22
const STEP = 5
const TICK = 5

interface Bracket {
  key: string
  depth: number
  top: number
  bottom: number
  selected: boolean
  held: boolean
  foldable: boolean
  range: Range
}

function brackets(view: EditorView): Bracket[] {
  const { cells, sections } = notebook(view.state)
  const selection = selectedRanges(view.state)
  const ranges = cells.map((cell) => cell.range)
  const doc = view.state.doc
  const caret = view.state.selection.main
  const caretCell = caret.empty
    ? ranges.find((r) => caret.from >= r.location && caret.from < r.location + r.length) ?? null
    : null
  const anySelection = selection.some((r) => r.length > 0)

  const box = (r: Range): { top: number; bottom: number } | null => {
    const from = Math.min(r.location, doc.length)
    const to = Math.min(Math.max(r.location, r.location + r.length - 1), doc.length)
    const first = view.lineBlockAt(from)
    const last = view.lineBlockAt(to)
    if (last.bottom - first.top < 1) return null
    return { top: first.top, bottom: last.bottom }
  }

  const out: Bracket[] = []
  for (const section of sections as Section[]) {
    const stop = Math.min(Math.max(section.contentEnd, section.headingRange.location + section.headingRange.length),
      doc.length)
    const r: Range = { location: section.range.location, length: Math.max(0, stop - section.range.location) }
    if (r.length <= 0) continue
    const where = box(r)
    if (!where) continue
    const held = holds(r, ranges, selection)
    out.push({ key: section.key, depth: section.depth, ...where, selected: held, held, foldable: true, range: r })
  }
  for (const cell of cells) {
    const where = box(cell.range)
    if (!where) continue
    const held = holds(cell.range, ranges, selection)
    const lit = held || (!anySelection && caretCell !== null && sameRange(caretCell, cell.range))
    out.push({
      key: `cell:${cell.range.location}`,
      depth: cellDepth(cell.range.location, sections) ,
      ...where, selected: lit, held, foldable: false, range: cell.range,
    })
  }
  return out
}

function nearest(y: number, x: number, all: Bracket[]): Bracket | null {
  const candidates = all.filter((bracket) =>
    y >= bracket.top - 4 && y <= bracket.bottom + 4
    && Math.abs(x - (GUTTER_WIDTH - 6 - bracket.depth * STEP)) <= 4)
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
    this.draw()
  }

  private press = (event: MouseEvent) => {
    const box = this.dom.getBoundingClientRect()
    const bracket = nearest(event.clientY - box.top + this.view.scrollDOM.scrollTop,
      event.clientX - box.left, this.all)
    if (!bracket) return
    event.preventDefault()
    const ranges = this.view.state.doc ? notebook(this.view.state).cells.map((cell) => cell.range) : []
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
    if (wanted.length === 0) return
    this.view.dispatch({
      selection: EditorSelection.create(
        wanted.map((r) => EditorSelection.range(r.location, r.location + r.length)),
        wanted.length - 1),
    })
    this.view.focus()
  }

  draw(): void {
    this.all = brackets(this.view)
    this.dom.style.height = `${this.view.contentHeight}px`
    this.dom.textContent = ""
    for (const bracket of this.all) {
      const line = GUTTER_WIDTH - 6 - bracket.depth * STEP
      const element = document.createElement("div")
      element.className = "wm-bracket"
      if (bracket.selected) element.classList.add("wm-bracket-lit")
      if (bracket.foldable) element.classList.add("wm-bracket-group")
      element.style.top = `${bracket.top}px`
      element.style.height = `${Math.max(2, bracket.bottom - bracket.top)}px`
      element.style.right = `${GUTTER_WIDTH - line}px`
      element.style.width = `${TICK}px`
      this.dom.appendChild(element)
    }
  }

  destroy(): void {
    this.dom.removeEventListener("mousedown", this.press)
    this.dom.remove()
  }
}

export const cellBrackets: Extension = ViewPlugin.fromClass(
  class {
    gutter: Gutter
    constructor(view: EditorView) { this.gutter = new Gutter(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged) {
        this.gutter.draw()
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
