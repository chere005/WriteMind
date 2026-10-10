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

import { EditorSelection, Prec, type Extension, type StateEffect } from "@codemirror/state"
import { EditorView, keymap, type Command } from "@codemirror/view"
import {
  apartAbove, backspaceInEmptyBlock, end, furnitureBehind, minimalChange, outdentForBackspace, returnInBlock, staysClosed,
  standsAlone, touchingRuns, type Edit, type PositionedBlock,
} from "@writemind/core"
import { awayField, putAway } from "./away"
import { furnitureAt, reminderAt } from "./furniture"
import { contentEnd, fenceLines, fencePointer, landingOffFence, onFence } from "./fences"
import { insideHidden } from "../fold"
import { firstCellReaching } from "../seams"
import { cellBeside } from "../barWalk"
import { openBlock, press } from "./field"
import { holdingField } from "./hold"
import { notebook } from "../notebook"
import { renderedField } from "../rendered"
import { armedField, armSeam } from "../seams"
import { holdPictureCell } from "../pictureCells"

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
  // (Only a caret on an empty line can be in an empty block: the whole note is not made a string for every key.)
  const line = view.state.doc.lineAt(main.head)
  if (line.text.trim().length !== 0) return reminderBackspace(view) || furnitureBackspace(view)
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
 * Backspace at the start of a reminder's words (Mac 0fdd031, `ListEditing`): a checklist is edited one item at a
 * time with its boxes intact, so the key never takes a box. In an EMPTY item the item goes and the caret ends the
 * one above (the only item of a list takes the block with it); in one with words they join the end of the item
 * above, the caret at the seam — and at the top of a list, with nothing to join to, nothing happens (a box is unmade
 * with the list buttons, as on the Mac).
 */
const reminderBackspace: Command = (view) => {
  const state = view.state
  const main = state.selection.main
  const item = reminderAt(state, main.head)
  if (!item || main.head !== item.text.location) return false
  const doc = state.doc
  const line = doc.lineAt(main.head)
  const above = line.number > 1 ? reminderAt(state, doc.line(line.number - 1).from) : null
  const apply = (changes: { from: number; to: number; insert?: string }, caret: number, userEvent: string) =>
    view.dispatch({
      changes, selection: EditorSelection.cursor(caret), effects: armSeam.of(null), scrollIntoView: true, userEvent,
    })
  if (item.text.length > 0) {
    if (above) apply({ from: end(above.text), to: main.head }, end(above.text), "delete.preview.join")
    return true
  }
  if (above) {
    // The line goes with the newline in front of it, so the last item of a note leaves no empty line behind.
    apply({ from: doc.line(line.number - 1).to, to: line.to }, end(above.text), "delete.preview.item")
    return true
  }
  const below = line.number < doc.lines ? reminderAt(state, doc.line(line.number + 1).from) : null
  if (below) {
    // The first item of a list: it goes, and the caret starts the one that takes its place.
    apply({ from: line.from, to: line.to + 1 }, below.text.location - (line.length + 1), "delete.preview.item")
    return true
  }
  // The only item: the block goes, the way Backspace in an empty block takes it.
  const text = doc.toString()
  const emptied = text.slice(0, line.from) + text.slice(line.to)
  const out = backspaceInEmptyBlock(emptied, line.from)
  view.dispatch({
    changes: minimalChange(text, out ? out.markdown : emptied),
    selection: EditorSelection.cursor(out ? out.caret : line.from),
    effects: armSeam.of(null),
    scrollIntoView: true,
    userEvent: "input.preview.remove",
  })
  return true
}

/**
 * Backspace just behind a piece of furniture takes the WHOLE piece (`MarkerHiding.furnitureBehind`): `1. ` off a
 * numbered item, `## ` off a heading — rather than one space, and a heading that quietly became a paragraph
 * beginning `##`. A nested item loses a level first, the ordinary behaviour of the key on a list.
 */
const furnitureBackspace: Command = (view) => {
  const state = view.state
  const main = state.selection.main
  const piece = furnitureBehind(main.head, furnitureAt(state, main.head))
  if (!piece) return false
  const line = state.doc.lineAt(main.head)
  if (outdentForBackspace(line.text, { location: main.head - line.from, length: 0 })) return false
  view.dispatch({
    changes: { from: piece.location, to: end(piece) },
    selection: EditorSelection.cursor(piece.location),
    scrollIntoView: true,
    userEvent: "delete.preview.furniture",
  })
  return true
}

/**
 * Delete at the end of a reminder's words joins the next item's words on: the port's mirror of the join above (the
 * editor's own Delete would pull the next box up into these words as text).
 */
const reminderDelete: Command = (view) => {
  if (!on(view) || barUp(view)) return false
  const state = view.state
  const { ranges, main } = state.selection
  if (ranges.length !== 1 || !main.empty) return false
  const item = reminderAt(state, main.head)
  if (!item || main.head !== end(item.text)) return false
  const line = state.doc.lineAt(main.head)
  if (line.number >= state.doc.lines) return false
  const next = reminderAt(state, state.doc.line(line.number + 1).from)
  if (!next) return false
  view.dispatch({
    changes: { from: main.head, to: next.text.location },
    selection: EditorSelection.cursor(main.head),
    scrollIntoView: true,
    userEvent: "delete.preview.join",
  })
  return true
}

/**
 * Left from the start of the words steps over the furniture in front of them: the caret may not stand in it, and the
 * editor's own arrow would stop there and be put straight back.
 */
const leftOverFurniture: Command = (view) => {
  if (!on(view) || barUp(view)) return false
  const { ranges, main } = view.state.selection
  if (ranges.length !== 1 || !main.empty) return false
  const pieces = furnitureAt(view.state, main.head)
  if (!furnitureBehind(main.head, pieces)) return false
  let front = main.head
  for (const piece of pieces) if (piece.location < front && end(piece) >= front) front = piece.location
  if (front <= 0) return true
  view.dispatch({ selection: EditorSelection.cursor(front - 1), scrollIntoView: true, userEvent: "select" })
  return true
}

/**
 * Escape in an open block puts the caret away, and the block is drawn again (the Mac's `move(.out)`); the next key
 * or click brings it back where it was. A popover of the app's has the key first.
 */
const putCaretAway: Command = (view) => {
  if (!on(view) || barUp(view) || view.state.field(awayField, false)) return false
  if (view.dom.ownerDocument.querySelector(".style-pop, .float-menu")) return false
  view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head), effects: putAway.of(true) })
  return true
}

/**
 * The first arrow (or Home, End) after Escape only brings the caret back where it was, and opens its block again:
 * measured while the block was drawn, the editor's own step would have jumped the whole block.
 */
const comeBack: Command = (view) => {
  if (!on(view) || !view.state.field(awayField, false)) return false
  view.dispatch({ effects: putAway.of(false), scrollIntoView: true })
  return true
}

/**
 * The bar above (or `below`) a picture or ink cell, as the cursor: the caret goes on the blank line there when there
 * is one (and the bar is read off it, as anywhere), else beside the cell with the bar armed by hand. A picture cell is
 * never typed in, so walking the page with the arrows goes bar → bar over it (docs\PLAN-docking-ink-cells.md (c)).
 */
function armBeside(view: EditorView, cell: PositionedBlock, below: boolean): true {
  const state = view.state
  const doc = state.doc
  const blankAt = (pos: number) => pos >= 0 && pos <= doc.length && doc.lineAt(pos).text.trim().length === 0
  if (below) {
    const after = end(cell.range)
    if (after < doc.length && blankAt(after + 1)) {
      view.dispatch({ selection: EditorSelection.cursor(after + 1), scrollIntoView: true })
      return true
    }
    const cells = notebook(state).cells
    const next = cells.find((c) => c.range.location > after && c.block.kind !== "blank")
    view.dispatch({
      selection: EditorSelection.cursor(after),
      effects: armSeam.of(next ? next.range.location : doc.length),
      scrollIntoView: true,
    })
    return true
  }
  const start = cell.range.location
  if (start > 0 && blankAt(start - 1)) {
    view.dispatch({ selection: EditorSelection.cursor(doc.lineAt(start - 1).from), scrollIntoView: true })
    return true
  }
  view.dispatch({ selection: EditorSelection.cursor(start), effects: armSeam.of(start), scrollIntoView: true })
  return true
}

/** The picture or ink cell that starts at `pos`, if one does. */
const pictureCellAt = (view: EditorView, pos: number): PositionedBlock | undefined =>
  notebook(view.state).cells.find((cell) => cell.range.location === pos && staysClosed(cell.block) && cell.range.length > 0)

/**
 * An arrow off the bar: into the cell beside it, which is the other half of
 * walking cell, bar, cell. At the two ends of the note there is no cell that
 * way and the bar simply stays. A picture or ink cell is stepped OVER, to the
 * bar on its far side.
 */
const stepFromBar = (up: boolean): Command => (view) => {
  if (!on(view)) return false
  const armed = view.state.field(armedField, false) ?? null
  if (armed === null) return false
  const main = view.state.selection.main
  if (!main.empty) return false
  // The cell beside the bar is the markdown side's rule too (barWalk.ts); the page draws no cells of empty lines.
  const beside = cellBeside(view.state, armed, up, false)
  if (beside && staysClosed(beside.block)) return armBeside(view, beside, !up)
  const target = beside === null ? null : up ? end(beside.range) : beside.range.location
  // (Into a fenced cell: its first / last content line, never a fence — fences.ts.)
  if (target !== null) caretInto(view, target, [armSeam.of(null)])
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
  // Into a fenced cell: onto its content, not its fence (fences.ts). An EMPTY fenced cell has no content line, and none
  // is written here (the note stays byte for byte): the caret goes on to the next cell out instead.
  const landOn = (at: number): number | null => {
    const landing = landingOffFence(view.state, at)
    return landing === null ? at : "at" in landing ? landing.at : null
  }
  const outward = [
    ...[...cells].reverse().filter((cell) => cell.range.location < armed).map((cell) => end(cell.range)),
    ...cells.filter((cell) => cell.range.location >= armed).map((cell) => cell.range.location),
  ]
  let target: number | null = null
  for (const at of outward) {
    target = landOn(at)
    if (target !== null) break
  }
  if (target === null && outward.length > 0) target = outward[0]!
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
  const runs = touchingRuns(cells, (i) => staysClosed(all[i]!.block) || standsAlone(all[i]!.block))
  const index = all.findIndex((cell) => cell.range.length > 0 && main.head >= cell.range.location
    && main.head <= end(cell.range))
  // Beside a picture or ink cell (the caret before or after it): the bar on the side the arrow points to.
  if (index >= 0 && staysClosed(all[index]!.block)) return armBeside(view, all[index]!, down)
  let target: number | null = null
  // A fenced cell's ``` lines are never stood on (fences.ts): from a fence (Left and Right reach the opening one) the
  // arrow goes into the code, or out of the cell; on the code, its first / last line is the edge the arrow leaves from.
  const fence = index >= 0 ? fenceLines(doc, cells[index]!) : null
  let edge: number | null = null
  if (fence) {
    const line = doc.lineAt(main.head).number
    if (onFence(fence, line) && (line === fence.open) === down) return caretInto(view, main.head)
    if (!onFence(fence, line)) edge = contentEnd(doc, fence, !down)
  }
  if (index >= 0) {
    const run = fence ? { first: index, last: index } : runs[index]!
    const first = cells[run.first]!.location
    const last = end(cells[run.last]!)
    // Still inside the block: the editor's own arrows.
    if (!sameScreenLine(view, main.head, edge ?? (down ? last : first), down ? -1 : 1)) return ownStep(view, down)
    // Off the edge onto a cell this one touches but stands apart from (apart.ts): the bar between them, armed by hand
    // (no blank line to land on), as the markdown side's arrows do — cell, bar, cell.
    const beyond = down ? run.last + 1 : run.first
    if (beyond < all.length && apartAbove(all, beyond)) {
      const at = all[beyond]!.range.location
      view.dispatch({ selection: EditorSelection.cursor(at), effects: armSeam.of(at), scrollIntoView: true })
      return true
    }
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
  // Onto a picture or ink cell that touches this block: the bar between them (down: above it; up: under it).
  const picture = pictureCellAt(view, target)
  if (picture) return armBeside(view, picture, !down)
  return caretInto(view, target)
}

/**
 * The caret to `at` — or, when `at` is on a fence line of a fenced cell, onto the content line beside it (fences.ts),
 * an empty one made in a cell that has none. `effects` go with it.
 */
function caretInto(view: EditorView, at: number, effects: readonly StateEffect<unknown>[] = []): true {
  const landing = landingOffFence(view.state, at)
  if (landing && "make" in landing) {
    const { from, insert, caret } = landing.make
    view.dispatch({
      changes: { from, insert }, selection: EditorSelection.cursor(caret), effects, scrollIntoView: true,
      userEvent: "input.preview.fence",
    })
    return true
  }
  view.dispatch({ selection: EditorSelection.cursor(landing ? landing.at : at), effects, scrollIntoView: true })
  return true
}

/**
 * The editor's own step up or down inside a block — unless it would stand on a fence line (measured onto a fence's
 * thin strip), where the caret goes onto the content line beside the fence instead.
 */
function ownStep(view: EditorView, down: boolean): boolean {
  const moved = view.moveVertically(view.state.selection.main, down)
  return landingOffFence(view.state, moved.head) === null ? false : caretInto(view, moved.head)
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
  // A code cell is landed in on its content, not on its opening fence (fences.ts). (An empty one is left as it is: a
  // page move writes nothing.)
  if (!extend) {
    const landing = landingOffFence(state, target)
    if (landing && "at" in landing) target = landing.at
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
    const blocks = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".wm-pv, .wm-cellpic"))
    const dom = blocks.find((block) => {
      const box = block.getBoundingClientRect()
      return event.clientY >= box.top && event.clientY < box.bottom
    })
    if (!dom) return false
    // Beside a picture or ink cell: the cell is held, as a click on it does.
    if (dom.classList.contains("wm-cellpic")) { event.preventDefault(); holdPictureCell(view, dom); return true }
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

export const previewKeys: Extension = [Prec.highest(typingOverHeld), marginPresses, fencePointer, Prec.highest(keymap.of([
  { key: "Enter", run: previewReturn },
  { key: "Escape", run: (view) => leaveBar(view) || releaseHeld(view) || putCaretAway(view) },
  { key: "Delete", run: (view) => leaveBar(view) || reminderDelete(view) },
  { key: "ArrowLeft", run: (view) => comeBack(view) || leftOverFurniture(view) },
  { key: "ArrowRight", run: comeBack },
  { key: "Home", run: comeBack },
  { key: "End", run: comeBack },
  { key: "Backspace", run: (view) => leaveBar(view) || previewBackspace(view) },
  { key: "ArrowUp", run: (view) => comeBack(view) || stepFromBar(true)(view) || vertical(false)(view) },
  { key: "ArrowDown", run: (view) => comeBack(view) || stepFromBar(false)(view) || vertical(true)(view) },
  { key: "Shift-ArrowUp", run: extendVertical(false) },
  { key: "Shift-ArrowDown", run: extendVertical(true) },
  { key: "PageUp", run: page(false, false) },
  { key: "PageDown", run: page(true, false) },
  { key: "Shift-PageUp", run: page(false, true) },
  { key: "Shift-PageDown", run: page(true, true) },
]))]
