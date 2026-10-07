/**
 * The page's drawings as the Wolfram export and a copy into Mathematica take them (Sean, 2026-10-06: a drawing cell is
 * an Image the Wolfram Engine imports from its SVG). Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * The page is where the sizes ARE: how wide each drawing cell is shown, how the canvas breaks a text box's words into
 * lines (`wrapLines`, measured with the canvas's own font), where each cell's top is in the drawing layer. So the
 * renderer writes the SVG text (the core's `wolframInkSvg` and `floatingBands`, from the SIDECAR, never from the
 * snapshot file) and the main process, which has the files and the engine, does the rest.
 *
 * Synchronous (`wolframMedia`): a Copy must read the cells before a Cut deletes them. `withSnapshots` is the one async
 * step, for a drawing cell the sidecar has no item for.
 */

import type { EditorView } from "@codemirror/view"
import {
  columnWidth, floatingBands, inkCellId, inkCellOf, inkFileName, inkIdsIn, readInkSnapshot, wolframInkSvg,
  type Drawing, type WolframMedia, type WordBreaker,
} from "@writemind/core"
import { cellBoxes } from "@writemind/editor"
import { wrapLines } from "./Canvas"
import { shownWidth } from "./inkCells"

/** The canvas's own lines, at the size the SVG writes them at (its text-box font and its label font are this one). */
const words: WordBreaker = (text, room, font) =>
  wrapLines(text, room, undefined, `${font.size}px -apple-system, "Segoe UI", system-ui, sans-serif`)

/**
 * Every live drawing cell as its SVG at the width it is shown, and the floating layer in bands between the cells.
 * `only`: just those cells (a copy of held cells), and no bands.
 */
export function wolframMedia(view: EditorView | null, drawing: Drawing, pane: { width: number; height: number },
  only?: ReadonlySet<string>): WolframMedia {
  const column = columnWidth(pane)
  const inks: WolframMedia["inks"] = {}
  const ids = new Set<string>()
  for (const item of drawing.items) if (item.kind === "cell") ids.add(item.cell.id)
  for (const id of ids) {
    if (only && !only.has(id)) continue
    const cell = inkCellOf(drawing, id)
    if (cell) inks[id] = wolframInkSvg(cell, (view ? shownWidth(view, id) : null) ?? column, words)
  }
  if (only || !view) return { inks, bands: [], column }
  // The cells' tops are measured in the text's own coordinates; the drawing layer's page starts where the scroller's
  // content does, so they move by the content's offset in it.
  const shift = view.contentDOM.getBoundingClientRect().top - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop
  const cells = cellBoxes(view).map((box) => ({ top: box.top + shift, offset: box.offset }))
  return { inks, bands: floatingBands(drawing, pane, cells, words), column }
}

/**
 * A drawing cell the note names that the sidecar has no item for (the sidecar was lost, or the note came from another
 * machine): its snapshot carries the cell in its metadata, so the cell is read from there and written the same way.
 * Without the metadata it is left out, and the export takes that line as a picture of its own file.
 */
export async function withSnapshots(media: WolframMedia, markdown: string): Promise<WolframMedia> {
  const missing = inkIdsIn(markdown).filter((id) => !media.inks[id])
  if (missing.length === 0) return media
  const inks = { ...media.inks }
  for (const id of missing) {
    try {
      const answer = await fetch(`wm://media/${encodeURIComponent(inkFileName(id))}`)
      if (!answer.ok) continue
      const cell = readInkSnapshot(await answer.text())
      if (cell && inkCellId(inkFileName(cell.id)) === id) inks[id] = wolframInkSvg(cell, media.column, words)
    } catch { /* not there: the line is a picture of its file, or "not found" */ }
  }
  return { ...media, inks }
}
