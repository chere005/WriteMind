/**
 * Tables in the editor (the first part of "Tables, from scratch", `docs/TODO.md`): a table is ONE cell
 * (`markdown/table.ts` in the core), typed as its markdown.
 *
 * - In the markdown pane, and in a table opened on the rendered page, its lines are set as a grid: monospaced, so
 *   columns lined up in the file line up on screen (they are never re-padded: the file is exactly what was typed), a
 *   thin frame round the whole, the header in bold, and the pipes and the `|---|` rule stepped back.
 * - Tab / Shift+Tab go cell to cell (selecting the words of the cell they land in); Tab past the last cell adds a
 *   row. Return adds an empty row under the caret's row, and on an empty last row ends the table. The rules are the
 *   core's (`tableTab`, `tableReturn`); this file finds the table under the caret and applies the answer.
 */

import { EditorSelection, Prec, RangeSetBuilder, type Extension } from "@codemirror/state"
import {
  Decoration, EditorView, keymap, ViewPlugin, type Command, type DecorationSet, type ViewUpdate,
} from "@codemirror/view"
import {
  end, firstCellFromBy, hasPipe, tableReturn, tableTab, type PositionedBlock, type TableStep,
} from "@writemind/core"
import { atBar, notebook } from "./notebook"
import { armedField } from "./seams"
import { renderedField } from "./rendered"
import { holdingField } from "./preview/hold"
import { awayField } from "./preview/away"
import { previewField } from "./preview/field"

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace"

/** The table cell holding `pos` (its ends included), or null. */
export function tableAt(cells: readonly PositionedBlock[], pos: number): PositionedBlock | null {
  const index = firstCellFromBy(cells, pos + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index]! : null
  if (!cell || cell.block.kind !== "table") return null
  return pos >= cell.range.location && pos <= end(cell.range) ? cell : null
}

/** A step worked out inside the table's own source, applied to the note as one change. */
function apply(view: EditorView, table: PositionedBlock, step: TableStep, userEvent: string): void {
  const base = table.range.location
  view.dispatch({
    changes: step.change ? { from: base + step.change.from, to: base + step.change.to, insert: step.change.insert } : undefined,
    selection: EditorSelection.single(base + step.anchor, base + step.head),
    scrollIntoView: true,
    userEvent,
  })
}

/** Whether the keys of a table are anyone's business here: one selection, nothing held, no bar, the caret not put away. */
function free(view: EditorView): boolean {
  const state = view.state
  return state.selection.ranges.length === 1 && !state.field(holdingField, false) && !state.field(awayField, false)
    && !atBar(view) && (state.field(armedField, false) ?? null) === null
}

/** Tab (Shift+Tab: `back`) in a table: the next (previous) cell. */
export const tableTabCommand = (back: boolean): Command => (view) => {
  if (!free(view)) return false
  const { from, to } = view.state.selection.main
  const table = tableAt(notebook(view.state).cells, from)
  if (!table || to > end(table.range)) return false
  const source = view.state.sliceDoc(table.range.location, end(table.range))
  const step = tableTab(source, from - table.range.location, to - table.range.location, back)
  if (!step) return false
  apply(view, table, step, step.change ? "input.table.row" : "select.table")
  return true
}

/**
 * Return in a table: a new row (or, on an empty last row, the end of the table). Words selected in a row (what Tab
 * leaves) stay: the row is added after it all the same, as a spreadsheet's Return moves on rather than typing over.
 */
export const tableReturnCommand: Command = (view) => {
  if (!free(view)) return false
  const main = view.state.selection.main
  const doc = view.state.doc
  if (!main.empty && doc.lineAt(main.from).number !== doc.lineAt(main.to).number) return false
  const table = tableAt(notebook(view.state).cells, main.from)
  if (!table || main.to > end(table.range)) return false
  const source = view.state.sliceDoc(table.range.location, end(table.range))
  const step = tableReturn(source, main.to - table.range.location)
  if (!step) return false
  apply(view, table, step, "input.table.row")
  return true
}

/** Ahead of the rendered page's own Return and of Tab's indenting (they are both highest / default precedence). */
export const tableKeys: Extension = Prec.highest(keymap.of([
  { key: "Tab", run: tableTabCommand(false), shift: tableTabCommand(true) },
  { key: "Enter", run: tableReturnCommand },
]))

// MARK: - The grid in the markdown

const tableLine = Decoration.line({ class: "wm-tbl" })
const headLine = Decoration.line({ class: "wm-tbl wm-tbl-head" })
const ruleLine = Decoration.line({ class: "wm-tbl wm-tbl-rule" })
const lastLine = Decoration.line({ class: "wm-tbl wm-tbl-last" })
const headLast = Decoration.line({ class: "wm-tbl wm-tbl-head wm-tbl-last" })
const ruleLast = Decoration.line({ class: "wm-tbl wm-tbl-rule wm-tbl-last" })
const pipe = Decoration.mark({ class: "wm-tbl-pipe" })

/**
 * The table lines on the page, decorated: one line class each, and a mark on every pipe between cells. On the
 * rendered page only a table that is OPEN is markdown to decorate (a closed one is drawn by the page).
 */
function gridOf(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { cells } = notebook(view.state)
  const doc = view.state.doc
  const page = view.state.field(renderedField, false) ? view.state.field(previewField, false) ?? null : null
  let done = 0
  for (const visible of view.visibleRanges) {
    for (let i = Math.max(0, firstCellFromBy(cells, visible.from, (cell) => cell.range) - 1); i < cells.length; i++) {
      const cell = cells[i]!
      if (cell.range.location > visible.to) break
      if (cell.block.kind !== "table" || end(cell.range) < visible.from) continue
      if (page && page.open.get(i) !== "open") continue
      const first = doc.lineAt(cell.range.location).number
      const last = doc.lineAt(end(cell.range)).number
      const from = Math.max(first, doc.lineAt(visible.from).number, done + 1)
      for (let n = from; n <= Math.min(last, doc.lineAt(visible.to).number); n++) {
        done = n
        const line = doc.line(n)
        const isLast = n === last
        const deco = n === first ? (isLast ? headLast : headLine)
          : n === first + 1 ? (isLast ? ruleLast : ruleLine)
          : isLast ? lastLine : tableLine
        builder.add(line.from, line.from, deco)
        if (n === first + 1 || !hasPipe(line.text)) continue
        const text = line.text
        for (let at = text.indexOf("|"); at >= 0; at = text.indexOf("|", at + 1)) {
          let slashes = 0
          for (let b = at - 1; b >= 0 && text.charCodeAt(b) === 92; b--) slashes++
          if (slashes % 2 === 0) builder.add(line.from + at, line.from + at + 1, pipe)
        }
      }
    }
  }
  return builder.finish()
}

class Grid {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = gridOf(view) }
  update(update: ViewUpdate): void {
    // (The page's own field is a new value whenever a cell opens or closes there.)
    if (update.docChanged || update.viewportChanged
      || update.state.field(previewField, false) !== update.startState.field(previewField, false)) {
      this.decorations = gridOf(update.view)
    }
  }
}

const tableGrid = ViewPlugin.fromClass(Grid, { decorations: (grid) => grid.decorations })

/** A frame drawn with inset shadows, so no table line is a pixel taller than the line it would be without one. */
const FRAME = "inset 1px 0 0 var(--wm-rule), inset -1px 0 0 var(--wm-rule)"

const tableTheme = EditorView.theme({
  ".cm-line.wm-tbl": {
    fontFamily: MONO,
    fontSize: "14.2px",
    boxShadow: FRAME,
    paddingLeft: "8px",
    paddingRight: "8px",
  },
  ".cm-line.wm-tbl-head": {
    fontWeight: "600",
    boxShadow: `${FRAME}, inset 0 1px 0 var(--wm-rule)`,
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
    // See-through, as a code line is, so a selection (drawn under the lines) still shows.
    backgroundColor: "color-mix(in srgb, var(--wm-text) 5.5%, transparent)",
  },
  ".cm-line.wm-tbl-rule": { color: "var(--wm-faint)" },
  ".cm-line.wm-tbl-last": { boxShadow: `${FRAME}, inset 0 -1px 0 var(--wm-rule)` },
  ".cm-line.wm-tbl-head.wm-tbl-last": {
    boxShadow: `${FRAME}, inset 0 1px 0 var(--wm-rule), inset 0 -1px 0 var(--wm-rule)`,
  },
  ".wm-tbl-pipe": { color: "var(--wm-faint)" },
})

/** Everything tables add to the editor: the keys, and the grid in the markdown. */
export const tables: Extension = [tableKeys, tableGrid, tableTheme]
