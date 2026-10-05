/**
 * The rendered page: every block that is not open is DRAWN, and the one the
 * caret is in is its own markdown, styled as it is typed.
 *
 * It is the same document, the same selection and the same undo as the
 * markdown side — a block is "drawn" by a widget standing over the characters
 * it came from, and the characters are still there. That is what the Mac's
 * rule ("only the block you are in is ever rewritten; the document is never
 * converted from rich text back to markdown") comes to in an editor whose
 * text is the file: there is nothing to convert, so nothing can be lost.
 *
 * Which blocks are open is `cellStates` in the core; this file only turns the
 * answer into widgets.
 *
 * PERFORMANCE. A keystroke used to make a widget for every block of the note and sort them all (and turn the
 * whole note into a string twice to find the blank lines): 40 ms in a 500 KB note. Now the decorations are MAPPED
 * through the change and only the stretch of the note that could have changed — the cells the parser read again,
 * the cells whose open / held state moved, the cells a fold uncovered, and a cell either side of each, so the
 * `touching` flag and the gaps are right — is built again. `previewPatch.test.ts` holds the patched page to the
 * page built from nothing on thousands of random edits and selections.
 */

import { RangeSet, StateField, type EditorState, type Extension, type Range as CMRange, type Transaction } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"
import {
  cellStatesSparse, end, firstCellFromBy, isMathFence, PREVIEW_BLOCK_GAP, isStructuralLine, structuralLineStarts, toggleTodo, fenced,
  fenceLanguage, staysClosed, todoItem, type Block, type CellState, type PositionedBlock, type Range,
} from "@writemind/core"
import { awayField } from "./away"
import { armedField } from "../seams"
import { foldField, insideHidden } from "../fold"
import { hullOf, notebook } from "../notebook"
import { renderedField } from "../rendered"
import { followLink } from "./follow"
import { holdingField } from "./hold"
import { caretAt, estimatedHeight, renderBlock } from "./render"

export class BlockWidget extends WidgetType {
  constructor(
    readonly block: Block,
    readonly source: string,
    readonly held: boolean,
    /** Touching the cell above: no blank line between them, so the gap is made here. */
    readonly touching: boolean,
  ) { super() }

  override eq(other: BlockWidget): boolean {
    return other.source === this.source && other.held === this.held && other.touching === this.touching
  }

  // (A block touching the one above carries the page's gap as its own padding: the estimate has to, too.)
  override get estimatedHeight(): number {
    return estimatedHeight(this.block, this.source) + (this.touching ? PREVIEW_BLOCK_GAP : 0)
  }

  override toDOM(view: EditorView): HTMLElement {
    const dom = renderBlock(this.block, this.source, { remeasure: () => view.requestMeasure() })
    dom.classList.toggle("wm-pv-held", this.held)
    dom.classList.toggle("wm-pv-touching", this.touching)
    dom.addEventListener("mousedown", (event) => press(view, dom, event))
    return dom
  }

  override ignoreEvent(): boolean { return true }
}

/** The grey line in an empty block that is waiting to be written in. */
class PlaceholderWidget extends WidgetType {
  override eq(): boolean { return true }
  override toDOM(): HTMLElement {
    const hint = document.createElement("span")
    hint.className = "wm-pv-placeholder"
    hint.textContent = "Write something — Ctrl+1 a title, Ctrl+Shift+L a list"
    hint.setAttribute("aria-hidden", "true")
    return hint
  }
  override ignoreEvent(): boolean { return true }
}
const placeholder = Decoration.widget({ widget: new PlaceholderWidget(), side: 1 })

/** A press on a drawn block: a box ticks, a link goes, anything else opens the block at that word. */
export function press(view: EditorView, dom: HTMLElement, event: MouseEvent): void {
  if (event.button !== 0) return
  const target = event.target instanceof Element ? event.target : null
  const from = view.posAtDOM(dom)
  const cell = notebook(view.state).cells.find((c) => c.range.location === from)
  if (!cell) return

  const box = target?.closest<HTMLElement>("[data-todo]")
  if (box) {
    event.preventDefault()
    event.stopPropagation()
    // A tick rewrites ONE character — the box — and nothing opens: the note is the
    // only place the answer lives.
    const change = toggleTodo(view.state.doc.toString(), cell.range, Number(box.dataset.todo))
    if (change) {
      view.dispatch({
        changes: { from: change.range.location, to: end(change.range), insert: change.replacement },
        userEvent: "input.preview.tick",
      })
    }
    return
  }

  const link = target?.closest<HTMLElement>("a[data-href]")
  const follow = view.state.facet(followLink)
  if (link && follow && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    event.stopPropagation()
    follow(link.dataset.href ?? "")
    return
  }

  event.preventDefault()
  openBlock(view, dom, event)
}

/** Open the drawn block at the word the event is over (shift reaches from where the selection began). */
export function openBlock(view: EditorView, dom: HTMLElement, event: MouseEvent): void {
  const from = view.posAtDOM(dom)
  const cell = notebook(view.state).cells.find((c) => c.range.location === from)
  if (!cell) return
  const at = from + caretAt(dom, event.clientX, event.clientY, cell.range.length)
  const anchor = event.shiftKey ? view.state.selection.main.anchor : at
  view.dispatch({
    selection: { anchor, head: at },
    userEvent: "select.pointer",
  })
  view.focus()
}

interface Preview {
  /** Everything the page adds: the drawn blocks and the thin lines between them. */
  decorations: DecorationSet
  /** The drawn blocks alone — the characters under them are not to be walked into. */
  blocks: DecorationSet
  /** The cells that were open or held when this was built, by their place in `cells` (the rest are closed). */
  open: ReadonlyMap<number, CellState>
  /** The cells it was built against, so the next change knows which of them are new. */
  cells: readonly PositionedBlock[]
  /** Where the "write something" line stands, or -1. */
  waiting: number
  /** The ranges the closed sections hide, as they were when this was built. */
  hidden: readonly Range[]
  /** Cells are held and none is open: the editor's own selection rectangles would only smear across the blocks. */
  heldOnly: boolean
}

const none: Preview = {
  decorations: Decoration.none, blocks: Decoration.none, open: new Map(), cells: [], waiting: -1, hidden: [], heldOnly: false,
}

/** The blank lines between two cells are structure, not writing: the page draws them as a gap. */
const gap = Decoration.line({ class: "wm-gap" })
/** The ``` lines of a code block being typed in: there, but stepped back. */
const fence = Decoration.line({ class: "wm-fence wm-fence-open" })
const fenceClose = Decoration.line({ class: "wm-fence wm-fence-close" })
/**
 * A line of a list that is open for typing: set out like the drawn list's rows (the marker in the same column, the
 * words where they were), so a list that opens moves nothing — the Mac draws its item editor OVER the rendered words
 * for the same reason (0fdd031: "the row keeps its height and its baseline and nothing below it moves").
 */
const openItem = Decoration.line({ class: "wm-pv-open-li" })
/** …and a reminder that is done stays struck through while its list is open. */
const openDone = Decoration.line({ class: "wm-pv-open-li wm-pv-open-done" })
/** The number of a numbered item, in the drawn list's marker column. */
const openNumber = Decoration.mark({ class: "wm-pv-open-num" })
const LISTS = new Set<Block["kind"]>(["bullets", "dashes", "numbered", "todos"])

const selectionOf = (state: EditorState): Range[] =>
  state.selection.ranges.map((r) => ({ location: r.from, length: r.to - r.from }))

const isArmed = (state: EditorState): boolean => (state.field(armedField, false) ?? null) !== null

/** The cells that are not closed, for this state of the note (none while the caret is put away). */
function openCells(state: EditorState, cells: readonly PositionedBlock[]): Map<number, CellState> {
  if (state.field(awayField, false)) return new Map()
  const holding = state.field(holdingField, false) ?? false
  // A picture or ink cell never opens and never joins a run (core `staysClosed`): it is drawn by `pictureCells`.
  return cellStatesSparse(cells, (cell) => cell.range, selectionOf(state), holding, isArmed(state),
    (cell) => staysClosed(cell.block))
}

/** An empty block with the caret in it says what it is for: where, or -1. */
function waitingAt(state: EditorState, cells: readonly PositionedBlock[]): number {
  if (isArmed(state) || state.field(awayField, false) || state.selection.ranges.length !== 1
    || !state.selection.main.empty) return -1
  const at = state.selection.main.head
  const row = state.doc.lineAt(at)
  if (row.length !== 0 || isStructuralLine(state.doc, row.number)) return -1
  // In a cell with words in it? Cells are in order and do not touch but by a newline: the last that starts at or
  // before the caret (or one before it, if that one is empty) is the only one that can hold it.
  for (let i = firstCellFromBy(cells, at + 1, (cell) => cell.range) - 1, tried = 0; i >= 0 && tried < 3; i--, tried++) {
    const c = cells[i]!
    if (c.block.kind !== "blank" && c.range.length > 0 && at >= c.range.location && at <= end(c.range)) return -1
  }
  return at
}

/** What a stretch of the page is made of: the cells `a` to `b` (and the gaps in `from`..`to`), as decorations. */
function entriesIn(state: EditorState, cells: readonly PositionedBlock[], states: ReadonlyMap<number, CellState>,
  a: number, b: number, from: number, to: number, waiting: number):
  { widgets: CMRange<Decoration>[]; lines: CMRange<Decoration>[] } {
  const doc = state.doc
  const widgets: CMRange<Decoration>[] = []
  const lines: CMRange<Decoration>[] = []
  for (let index = a; index <= b; index++) {
    const cell = cells[index]!
    const open = states.get(index) === "open"
    if (open) {
      // The fences of an open code block step back (the Mac's editor shows only the code).
      if (cell.block.kind === "code") {
        const first = doc.lineAt(cell.range.location)
        lines.push(fence.range(first.from))
        const last = doc.lineAt(Math.max(cell.range.location, end(cell.range)))
        if (last.number > first.number && /^\s*```\s*$/.test(last.text)) lines.push(fenceClose.range(last.from))
      } else if (LISTS.has(cell.block.kind) && cell.range.length > 0) {
        const last = doc.lineAt(end(cell.range)).number
        for (let n = doc.lineAt(cell.range.location).number; n <= last; n++) {
          const line = doc.line(n)
          const indent = /^[ \t]*/.exec(line.text)![0].length
          lines.push((todoItem(line.text.slice(indent))?.done ? openDone : openItem).range(line.from))
          const number = /^\d{1,4}[.)](?= )/.exec(line.text.slice(indent))
          if (number) lines.push(openNumber.range(line.from + indent, line.from + indent + number[0].length))
        }
      }
      continue
    }
    if (cell.block.kind === "blank" || cell.range.length <= 0) continue
    // A picture or ink cell is the same block widget on both sides of the toggle (`pictureCells`), not a block here.
    if (cell.block.kind === "picture") continue
    if (insideHidden(state, cell.range)) continue
    const source = state.sliceDoc(cell.range.location, end(cell.range))
    // Maths on its own line is typeset by the notebook's own maths layer, which
    // shows its source when the caret comes in; it stands where the page would.
    if (cell.block.kind === "code" && isMathFence(cell.block.language ?? "")) {
      const parts = fenced(source)
      if (parts && isMathFence(fenceLanguage(parts.open))) continue
    }
    const before = cells[index - 1]?.range
    const touching = before !== undefined && before.length > 0 && cell.range.location === end(before) + 1
    widgets.push(Decoration.replace({
      widget: new BlockWidget(cell.block, source, states.get(index) === "held", touching),
      block: true,
    }).range(cell.range.location, end(cell.range)))
  }

  if (waiting >= from && waiting <= to && waiting >= 0) lines.push(placeholder.range(waiting))

  for (const start of structuralLineStarts(doc, from, to)) {
    // A blank line inside a cell (a fence can hold one) is part of that cell: the cell that starts last before the
    // line is the only one that can hold it (cells are in order and do not overlap).
    const at = firstCellFromBy(cells, start, (cell) => cell.range) - 1
    const inside = at >= 0 && cells[at]!.range.length > 0 && start > cells[at]!.range.location
      && start < end(cells[at]!.range)
    if (inside) continue
    lines.push(gap.range(start))
  }
  return { widgets, lines }
}

const heldOnlyOf = (states: ReadonlyMap<number, CellState>): boolean => {
  let held = false
  for (const state of states.values()) {
    if (state === "open") return false
    held = true
  }
  return held
}

/** The page built from nothing. */
function buildAll(state: EditorState): Preview {
  const { cells } = notebook(state)
  const states = openCells(state, cells)
  const waiting = waitingAt(state, cells)
  const built = entriesIn(state, cells, states, 0, cells.length - 1, 0, state.doc.length, waiting)
  return {
    decorations: Decoration.set([...built.widgets, ...built.lines], true),
    blocks: Decoration.set(built.widgets, true),
    open: states,
    cells,
    waiting,
    hidden: state.field(foldField, false)?.hidden ?? [],
    heldOnly: heldOnlyOf(states),
  }
}

/** Whether two lists of hidden ranges are the same list (the old one moved through `changes`): the ranges that are not. */
function hiddenDifference(was: readonly Range[], now: readonly Range[], tr: Transaction): Range[] {
  const moved = tr.docChanged
    ? was.map((r) => ({ location: tr.changes.mapPos(r.location, 1), length: tr.changes.mapPos(end(r), -1) - tr.changes.mapPos(r.location, 1) }))
    : was
  if (moved.length === now.length && moved.every((r, i) => r.location === now[i]!.location && r.length === now[i]!.length)) return []
  const key = (r: Range) => `${r.location}:${r.length}`
  const before = new Set(moved.map(key))
  const after = new Set(now.map(key))
  return [...moved.filter((r) => !after.has(key(r))), ...now.filter((r) => !before.has(key(r)))]
}

/**
 * The page after a transaction: the old decorations moved along with the text, and the stretches of the note that
 * could have changed built again.
 */
function patch(value: Preview, tr: Transaction): Preview {
  const state = tr.state
  const doc = state.doc
  const { cells } = notebook(state)
  const states = openCells(state, cells)
  const waiting = waitingAt(state, cells)
  const hidden = state.field(foldField, false)?.hidden ?? []
  const n = cells.length
  const changes = tr.docChanged ? tr.changes : null
  const before = value.cells

  // The stretches to build again, as the first and last cell of each (inclusive; widened by one cell each side).
  const dirty: Array<[number, number]> = []
  const widen = (a: number, b: number) => dirty.push([Math.max(0, a - 1), Math.min(n - 1, b + 1)])
  /** The cell that starts last at or before `pos`. */
  const cellAtOrBefore = (pos: number) => Math.max(0, Math.min(n - 1, firstCellFromBy(cells, pos + 1, (cell) => cell.range) - 1))
  const markPos = (pos: number) => { const i = cellAtOrBefore(pos); widen(i, i) }
  const markSpan = (from: number, to: number) => widen(cellAtOrBefore(from), cellAtOrBefore(to))

  if (changes) {
    // The cells the parser read again are new objects, the ones after the edit are old blocks at new places.
    const m = before.length
    let p = 0
    while (p < n && p < m && cells[p] === before[p]) p++
    let s = 0
    while (s < n - p && s < m - p && cells[n - 1 - s]!.block === before[m - 1 - s]!.block) s++
    if (p < n || p < m) widen(p, Math.max(p, n - 1 - s))
    // Blank lines the edit made or took away are in no cell: the stretch the edit itself covers, too.
    const hull = hullOf(changes)
    markSpan(hull.from, hull.toNew)
  }

  // Cells whose state moved. An old cell is found again by where it is now: the same place, the same state, the
  // same block is a cell nothing happened to.
  const was = new Map<number, CellState>()
  for (const [i, st] of value.open) {
    const old = before[i]
    if (!old) continue
    const at = changes ? changes.mapPos(old.range.location, 1) : old.range.location
    was.set(at, st)
    const i2 = cellAtOrBefore(at)
    if (n === 0 || cells[i2]!.range.location !== at || states.get(i2) !== st) markPos(at)
  }
  for (const [i, st] of states) {
    if (was.get(cells[i]!.range.location) !== st) widen(i, i)
  }
  if (value.waiting >= 0) markPos(changes ? changes.mapPos(value.waiting, 1) : value.waiting)
  if (waiting >= 0) markPos(waiting)
  for (const r of hiddenDifference(value.hidden, hidden, tr)) markSpan(r.location, end(r))

  let decorations = changes ? value.decorations.map(changes) : value.decorations
  let blocks = changes ? value.blocks.map(changes) : value.blocks
  if (n === 0 && (changes || value.waiting !== waiting)) {
    // No cells at all: the note is the page, built whole.
    const built = entriesIn(state, cells, states, 0, -1, 0, doc.length, waiting)
    decorations = decorations.update({ filter: () => false, add: [...built.widgets, ...built.lines], sort: true })
    blocks = blocks.update({ filter: () => false, add: built.widgets, sort: true })
  } else if (dirty.length > 0) {
    dirty.sort((x, y) => x[0] - y[0])
    const merged: Array<[number, number]> = []
    for (const one of dirty) {
      const last = merged[merged.length - 1]
      if (last && one[0] <= last[1] + 1) last[1] = Math.max(last[1], one[1])
      else merged.push([one[0], one[1]])
    }
    for (const [a, b] of merged) {
      // From the line after the cell before to the character before the cell after: every decoration of cells `a` to
      // `b` and of the gaps between them starts in here, and none of any other cell does.
      const from = a > 0 ? end(cells[a - 1]!.range) + 1 : 0
      const to = b < n - 1 ? cells[b + 1]!.range.location - 1 : doc.length
      if (from > to) continue
      const built = entriesIn(state, cells, states, a, b, from, to, waiting)
      decorations = decorations.update({ filter: () => false, filterFrom: from, filterTo: to, add: [...built.widgets, ...built.lines], sort: true })
      blocks = blocks.update({ filter: () => false, filterFrom: from, filterTo: to, add: built.widgets, sort: true })
    }
  }
  return { decorations, blocks, open: states, cells, waiting, hidden, heldOnly: heldOnlyOf(states) }
}

export const previewField = StateField.define<Preview>({
  create: (state) => (state.field(renderedField, false) ? buildAll(state) : none),
  update(value, transaction) {
    const state = transaction.state
    if (!state.field(renderedField, false)) return value === none ? value : none
    // Switched on just now (or never built): from nothing.
    if (!transaction.startState.field(renderedField, false) || value === none) return buildAll(state)
    if (!transaction.docChanged && !transaction.selection && transaction.effects.length === 0) return value
    return patch(value, transaction)
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).blocks),
    EditorView.editorAttributes.from(field, (value) => (value.heldOnly ? HELD_ONLY : NO_ATTRIBUTES)),
  ],
})

const HELD_ONLY = { class: "wm-pv-heldonly" }
const NO_ATTRIBUTES = {} as Record<string, string>

/** Used by the keys and the toggle: the drawn blocks as a set, for anyone who needs to ask. */
export const drawnBlocks = (state: EditorState): RangeSet<Decoration> => state.field(previewField).blocks

export const previewBlocks: Extension = previewField
