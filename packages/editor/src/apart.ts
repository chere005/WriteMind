/**
 * A CELL THAT TOUCHES ANOTHER BUT STANDS APART FROM IT (core `cells/apart.ts`; Sean, 2026-10-05: "this math cell should
 * be placed as its own cell, not connected to the cell before it"): a fence, a table, a picture, a heading or a rule
 * with no blank line between it and the block above. Both pages draw the gap a blank line would have made ABOVE it — a
 * block of air standing in front of the cell, whatever draws the cell (its lines, typeset maths, a picture, a drawn
 * block on the rendered page) — and everything that measures a cell (the brackets, the seams, `gapAt`) starts the
 * cell below that air. So the two have a bracket each, a seam of the page's own height between them (the bar can be
 * put there, and a cell opened there), and a box each.
 *
 * The gap is the rendered page's block gap, which is the markdown side's blank line (PREVIEW_BLOCK_GAP), so a cell
 * that touches looks the same as one a blank line holds off, on either page. It is a block of its own and not a
 * border or padding on the cell: a border is rounded to whole device pixels (21 for 21.75 at 100%) and the measures
 * would be a fraction out, and padding would take a code line's shade and a table's frame up into the gap.
 */

import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"
import { apartAbove, firstCellFromBy, PREVIEW_BLOCK_GAP, type PositionedBlock } from "@writemind/core"
import { notebookField } from "./notebook"

/** How far a cell that stands apart is drawn below the cell it touches: a blank line's height. */
export const APART_GAP = PREVIEW_BLOCK_GAP

const cellsOf = (state: EditorState): readonly PositionedBlock[] => state.field(notebookField, false)?.cells ?? []

/** The gap above the cell at `index` of the note's cells. */
export const gapAbove = (cells: readonly PositionedBlock[], index: number): number =>
  apartAbove(cells, index) ? APART_GAP : 0

/** The gap above the cell that starts at `location` (0 for none, and for a place where no cell starts). */
export function gapAt(state: EditorState, location: number): number {
  const cells = cellsOf(state)
  const index = firstCellFromBy(cells, location, (cell) => cell.range)
  if (index >= cells.length || cells[index]!.range.location !== location) return 0
  return gapAbove(cells, index)
}

/** The air itself: nothing to click (the seam layer answers for it) and nothing to read. */
class GapWidget extends WidgetType {
  override eq(): boolean { return true }
  override get estimatedHeight(): number { return APART_GAP }
  override toDOM(): HTMLElement {
    const air = document.createElement("div")
    air.className = "wm-apart-gap"
    air.style.height = `${APART_GAP}px`
    air.setAttribute("aria-hidden", "true")
    return air
  }
  override ignoreEvent(): boolean { return true }
}

// Before the cell, and before a block drawn over it (a replacing block's start side is later than this one's).
const gap = Decoration.widget({ widget: new GapWidget(), block: true, side: -1 })

function gaps(cells: readonly PositionedBlock[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (let i = 1; i < cells.length; i++) {
    if (apartAbove(cells, i)) builder.add(cells[i]!.range.location, cells[i]!.range.location, gap)
  }
  return builder.finish()
}

/**
 * The gaps of the whole note: a block widget changes the page's height, so it is the state's (a view plugin may not
 * add one). Worked out again only when the cells are (a walk of cheap comparisons; no DOM).
 */
const apartField = StateField.define<{ cells: readonly PositionedBlock[]; set: DecorationSet }>({
  create(state) {
    const cells = cellsOf(state)
    return { cells, set: gaps(cells) }
  },
  update(value, transaction) {
    const cells = cellsOf(transaction.state)
    return cells === value.cells ? value : { cells, set: gaps(cells) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.set),
})

export const apartCells: Extension = [apartField]
