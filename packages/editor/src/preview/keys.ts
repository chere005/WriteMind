/**
 * The keys of the rendered page: what Return, Backspace and the arrows mean
 * when a block is open and when a bar is the cursor. Every rule is the core's
 * (`returnInBlock`, `backspaceInEmptyBlock`); this file hands it the
 * selection and applies what comes back as ONE change to the block's own
 * range, so undo takes a Return back in a single step and the rest of the
 * file is never touched.
 *
 * Only live while the page is rendered: on the markdown side every one of
 * these declines and the ordinary editor keys answer.
 */

import { EditorSelection, Prec, type Extension } from "@codemirror/state"
import { EditorView, keymap, type Command } from "@codemirror/view"
import { backspaceInEmptyBlock, end, minimalChange, returnInBlock, touchingRuns, type Edit } from "@writemind/core"
import { insideHidden } from "../fold"
import { firstCellReaching } from "../seams"
import { openBlock, press } from "./field"
import { holdingField } from "./hold"
import { notebook } from "../notebook"
import { renderedField } from "../rendered"
import { armedField, armSeam } from "../seams"

const on = (view: EditorView): boolean => view.state.field(renderedField, false) === true
const barUp = (view: EditorView): boolean => (view.state.field(armedField, false) ?? null) !== null

/** An edit from the core, applied as one change that undo sees as one step. */
function apply(view: EditorView, change: Edit, userEvent: string): void {
  view.dispatch({
    changes: { from: change.range.location, to: end(change.range), insert: change.replacement },
    selection: EditorSelection.cursor(change.selection.location),
    scrollIntoView: true,
    userEvent,
  })
}

/** Return starts the next block; in a list it carries the list on. */
export const previewReturn: Command = (view) => {
  if (!on(view) || barUp(view)) return false
  // Cells held by their brackets: Return is nobody's business, and the editor's
  // own would replace them with a newline.
  if (view.state.field(holdingField, false)) return true
  const { ranges, main } = view.state.selection
  if (ranges.length !== 1) return false
  const change = returnInBlock(view.state.doc.toString(), { location: main.from, length: main.to - main.from })
  if (!change) return false
  apply(view, change, "input.preview.return")
  return true
}

/** Backspace in a block with nothing in it takes the block away. */
export const previewBackspace: Command = (view) => {
  if (!on(view) || barUp(view)) return false
  const { ranges, main } = view.state.selection
  if (ranges.length !== 1 || !main.empty) return false
  const text = view.state.doc.toString()
  const out = backspaceInEmptyBlock(text, main.head)
  if (!out) return false
  const change = minimalChange(text, out.markdown)
  view.dispatch({
    changes: change,
    selection: EditorSelection.cursor(out.caret),
    effects: armSeam.of(null),
    scrollIntoView: true,
    userEvent: "input.preview.remove",
  })
  return true
}

/**
 * An arrow off the bar: into the cell beside it, which is the other half of
 * walking cell, bar, cell. At the two ends of the note there is no cell that
 * way and the bar simply stays.
 */
const stepFromBar = (up: boolean): Command => (view) => {
  if (!on(view)) return false
  const armed = view.state.field(armedField, false) ?? null
  if (armed === null) return false
  const main = view.state.selection.main
  if (!main.empty) return false
  const cells = notebook(view.state).cells
    .filter((cell) => cell.block.kind !== "blank" && !insideHidden(view.state, cell.range))
  let target: number | null = null
  if (up) {
    const above = [...cells].reverse().find((cell) => cell.range.location < armed)
    if (above) target = end(above.range)
  } else {
    const below = cells.find((cell) => cell.range.location >= armed)
    if (below) target = below.range.location
  }
  if (target !== null) {
    view.dispatch({
      selection: EditorSelection.cursor(target),
      effects: armSeam.of(null),
      scrollIntoView: true,
    })
  }
  return true
}

/**
 * Escape, Backspace and Delete at a bar take the bar back and write nothing:
 * the markdown is byte for byte as it was. (The editor's own Backspace would
 * join the two blocks the bar stands between.) The caret goes back into the
 * block above — there is always a caret on this page — or into the one below
 * when there is nothing above.
 */
const leaveBar: Command = (view) => {
  if (!on(view)) return false
  const armed = view.state.field(armedField, false) ?? null
  if (armed === null) return false
  const cells = notebook(view.state).cells.filter((cell) => cell.block.kind !== "blank" && cell.range.length > 0
    && !insideHidden(view.state, cell.range))
  const above = [...cells].reverse().find((cell) => cell.range.location < armed)
  const below = cells.find((cell) => cell.range.location >= armed)
  const target = above ? end(above.range) : below ? below.range.location : null
  view.dispatch({
    ...(target === null ? {} : { selection: EditorSelection.cursor(target) }),
    effects: armSeam.of(null),
    scrollIntoView: true,
  })
  return true
}

/** Whether two positions are on the same line of the screen. */
function sameScreenLine(view: EditorView, a: number, b: number, side: -1 | 1): boolean {
  const one = view.coordsAtPos(a, side)
  const other = view.coordsAtPos(b, side)
  if (!one || !other) return true
  return Math.abs(one.top - other.top) < 2
}

/**
 * An arrow out of a block. Inside one, the editor's own arrows walk its lines;
 * off the edge of it they walk onto the blank line that is the bar — the
 * editor's own arrow would measure its way down the page, and the blocks drawn
 * under the bar are not lines it can step onto. At the two ends of the note
 * there is no blank line to walk onto, so the bar above or under the end block
 * is armed by hand.
 */
const vertical = (down: boolean): Command => (view) => {
  if (!on(view) || barUp(view)) return false
  const main = view.state.selection.main
  if (!main.empty || view.state.selection.ranges.length !== 1) return false
  const state = view.state
  const doc = state.doc
  const all = notebook(state).cells
  const cells = all.map((cell) => cell.range)
  const runs = touchingRuns(cells)
  const index = all.findIndex((cell) => cell.range.length > 0 && main.head >= cell.range.location
    && main.head <= end(cell.range))
  let target: number | null = null
  if (index >= 0) {
    const run = runs[index]!
    const first = cells[run.first]!.location
    const last = end(cells[run.last]!)
    // Still inside the block: the editor's own arrows.
    if (!sameScreenLine(view, main.head, down ? last : first, down ? -1 : 1)) return false
    if (down) {
      if (last >= doc.length) {
        view.dispatch({ selection: EditorSelection.cursor(doc.length), effects: armSeam.of(doc.length), scrollIntoView: true })
        return true
      }
      target = Math.min(last + 1, doc.length)
    } else {
      if (first <= 0) {
        view.dispatch({ selection: EditorSelection.cursor(0), effects: armSeam.of(0), scrollIntoView: true })
        return true
      }
      target = doc.lineAt(first - 1).from
    }
  } else {
    // On a blank line that belongs to no block: the next line the page has.
    const line = doc.lineAt(main.head)
    if (down) { if (line.to < doc.length) target = line.to + 1 }
    else if (line.from > 0) target = doc.lineAt(line.from - 1).from
  }
  if (target === null) return false
  view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true })
  return true
}

/**
 * Shift+arrow off the edge of a block extends the selection a whole block at a
 * time. (The editor's own would measure its way down the page and, with the
 * blocks drawn, find nothing to stop at until the end of the note.)
 */
const extendVertical = (down: boolean): Command => (view) => {
  if (!on(view) || barUp(view)) return false
  const state = view.state
  if (state.selection.ranges.length !== 1) return false
  const main = state.selection.main
  const cells = notebook(state).cells.filter((cell) => cell.range.length > 0 && cell.block.kind !== "blank")
  const index = cells.findIndex((cell) => main.head >= cell.range.location && main.head <= end(cell.range))
  let neighbour: (typeof cells)[number] | undefined
  if (index >= 0) {
    const cell = cells[index]!
    // Still inside the block: the editor's own.
    if (!sameScreenLine(view, main.head, down ? end(cell.range) : cell.range.location, down ? -1 : 1)) return false
    neighbour = cells[index + (down ? 1 : -1)]
  } else {
    neighbour = down ? cells.find((cell) => cell.range.location > main.head)
      : [...cells].reverse().find((cell) => end(cell.range) < main.head)
  }
  const target = down ? (neighbour ? end(neighbour.range) : state.doc.length) : (neighbour ? neighbour.range.location : 0)
  view.dispatch({ selection: EditorSelection.range(main.anchor, target), scrollIntoView: true })
  return true
}

/**
 * Page Up and Page Down: the window moves a page and the caret goes to the
 * block at the same height in it. (The editor's own looks for a line of text
 * to land on, and a page of drawn blocks has none.)
 */
const page = (down: boolean, extend: boolean): Command => (view) => {
  if (!on(view)) return false
  const state = view.state
  if (state.selection.ranges.length !== 1) return false
  const main = state.selection.main
  const scroller = view.scrollDOM
  const step = Math.max(80, scroller.clientHeight - 48)
  const most = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const before = scroller.scrollTop
  const next = Math.min(Math.max(before + (down ? step : -step), 0), most)
  const here = view.coordsAtPos(main.head)
  const rel = here ? here.top - scroller.getBoundingClientRect().top : 24
  if (notebook(state).cells.length === 0) return false
  let target: number
  if (next === before) target = down ? state.doc.length : 0
  else {
    // (Searched for, not found by measuring every cell of the note and looking down the list.)
    target = firstCellReaching(view, next + rel) ?? state.doc.length
  }
  scroller.scrollTop = next
  view.dispatch({
    selection: extend ? EditorSelection.range(main.anchor, target) : EditorSelection.cursor(target),
  })
  return true
}

/** Escape over held cells lets go of them and writes nothing; the caret goes to the end of what was held. */
const releaseHeld: Command = (view) => {
  if (!on(view) || !view.state.field(holdingField, false)) return false
  const last = view.state.selection.ranges[view.state.selection.ranges.length - 1]!
  view.dispatch({ selection: EditorSelection.cursor(last.to), scrollIntoView: true })
  return true
}

/**
 * A press in the margin beside a drawn block is a press on the block: the
 * editor's own would measure to the nearest line of text and drop the caret
 * on the bar under it.
 */
const marginPresses = EditorView.domEventHandlers({
  // A right-click on a drawn block opens it first, as it does on text, so the menu is about something.
  contextmenu(event, view) {
    if (!on(view)) return false
    const target = event.target instanceof Element ? event.target : null
    const dom = target?.closest<HTMLElement>(".wm-pv")
    if (!dom || !view.contentDOM.contains(dom) || target?.closest("[data-todo], a[data-href]")) return false
    openBlock(view, dom, event)
    return false
  },
  mousedown(event, view) {
    if (!on(view) || event.button !== 0) return false
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest(".wm-pv, .cm-line, .wm-gutter, .wm-seams")) return false
    if (!view.contentDOM.contains(target) && target !== view.scrollDOM) return false
    const blocks = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".wm-pv"))
    const dom = blocks.find((block) => {
      const box = block.getBoundingClientRect()
      return event.clientY >= box.top && event.clientY < box.bottom
    })
    if (!dom) return false
    press(view, dom, event)
    return true
  },
})

/**
 * A character typed over ONE held cell replaces it. The cell is drawn, not text,
 * so the browser's own caret is beside it rather than over it, and the character
 * would land there; the selection the editor holds is what is meant. (Several
 * held cells are the markdown side's `typingOverCells`.)
 */
const typingOverHeld = EditorView.inputHandler.of((view, _from, _to, typed) => {
  if (!on(view) || typed.length === 0 || !view.state.field(holdingField, false)) return false
  const { ranges, main } = view.state.selection
  if (ranges.length !== 1 || main.empty) return false
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: typed },
    selection: EditorSelection.cursor(main.from + typed.length),
    scrollIntoView: true,
    userEvent: "input.type",
  })
  return true
})

export const previewKeys: Extension = [Prec.highest(typingOverHeld), marginPresses, Prec.highest(keymap.of([
  { key: "Enter", run: previewReturn },
  { key: "Escape", run: (view) => leaveBar(view) || releaseHeld(view) },
  { key: "Delete", run: leaveBar },
  { key: "Backspace", run: (view) => leaveBar(view) || previewBackspace(view) },
  { key: "ArrowUp", run: (view) => stepFromBar(true)(view) || vertical(false)(view) },
  { key: "ArrowDown", run: (view) => stepFromBar(false)(view) || vertical(true)(view) },
  { key: "Shift-ArrowUp", run: extendVertical(false) },
  { key: "Shift-ArrowDown", run: extendVertical(true) },
  { key: "PageUp", run: page(false, false) },
  { key: "PageDown", run: page(true, false) },
  { key: "Shift-PageUp", run: page(false, true) },
  { key: "Shift-PageDown", run: page(true, true) },
]))]
