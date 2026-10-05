/**
 * A note on paper: the rendered page, the drawing over it, cut into sheets of
 * US Letter. Ported from `WriteMind/Export/NoteExport.swift` and `NotePDF.swift`.
 *
 * The note's cells are laid out at the width of the editor pane the drawing's
 * objects were placed against (the page's own margins, `PAGE`), and the whole column is then SHRUNK onto the
 * paper (`PagePlan`'s `fit`), rather than re-flowed at the paper's width: the
 * objects are placed as fractions of that pane, so re-flowing the text would
 * slide every line out from under the picture it was put beside. What comes
 * out is the pane, photographed onto paper. Folded sections are NOT folded
 * here — a note printed short of the words it holds would be a note lost.
 *
 * Two steps, because the cells' heights are a thing only a browser knows:
 * `measureHtml` is the column to measure (a cell's height is its box's), and
 * `printHtml` takes those heights, plans the sheets (`pagesFor`: a break goes
 * BETWEEN cells, a drawing object is never cut, overlapping things share a
 * sheet) and writes one `<section>` per sheet for the print engine. Both
 * return strings; the main process loads them in a window nobody sees.
 *
 * No header, no footer, no page numbers — the Mac's file has none.
 */

import { positioned, type PositionedBlock } from "../markdown/parser"
import { end } from "../text/range"
import type { Drawing } from "../drawing/model"
import { BLOCK_CSS, blockHtml, PAGE } from "./blocks"
import { inkPieces, type InkOptions } from "./drawing"
import { PAPER_HEX } from "./inline"
import { layoutSheets, type PagePiece } from "./pagePlan"

/** The pane a note is measured against before the window has said how wide it is. */
export const FALLBACK_PANE = { width: 900, height: 600 } as const
/**
 * The one gap between two cells. The cells' other coordinates — where the first one is, how far in the text
 * starts — are the PAGE's own (`PAGE` in blocks.ts): the ink was drawn on the page of this app, not on the
 * Mac's, so the paper's column starts where the page's does (32 px in, 16 down) and is as wide as its text is.
 */
export const GAP = PAGE.gap

/** The width of the text column for a pane: the pane less the page's margins. */
export const columnWidth = (pane: { width: number; height: number }): number =>
  Math.max(1, exportPane(pane).width - PAGE.left - PAGE.right)

/** A pane that is not a real size is the fallback. */
export function exportPane(pane: { width: number; height: number }): { width: number; height: number } {
  return pane.width > 40 && pane.height > 40 ? { width: pane.width, height: pane.height } : { ...FALLBACK_PANE }
}

/** What the save panel should offer: the note's own name, as a PDF. */
export function suggestedName(noteFile: string): string {
  const name = noteFile.split(/[\\/]/).pop() ?? noteFile
  const dot = name.lastIndexOf(".")
  return (dot > 0 ? name.slice(0, dot) : name) + ".pdf"
}

const FONT = `"Segoe UI", -apple-system, "Helvetica Neue", Cantarell, "Noto Sans", Arial, sans-serif`

const BASE_CSS = `
@page { size: 8.5in 11in; margin: 0 }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #1C1C1E; font-family: ${FONT}; }
`

/**
 * The extra air before each cell. A run of exactly two blank lines leaves no cell behind (the parser keeps a cell
 * for the middle of three or more), but the page draws each blank line as a gap of its own — 16 px between the two
 * cells where one blank line is 8 — and the paper has to stand where the page stands or everything below drifts up.
 * (One blank line, or none at all, is the one gap; three or more is a gap, the cell of blank lines, a gap.)
 * Blank lines before the first cell count the same way. A rule or a code block with NO blank line above it takes
 * no gap at all (see the last rule below).
 */
export function runGaps(markdown: string, cells: readonly PositionedBlock[]): number[] {
  const out = cells.map(() => 0)
  // Blank lines before the first cell are gap lines too (one: 8, two: 16, and the first line of a longer run before
  // the cell of blank lines it leaves).
  if (cells.length > 0) {
    let lead = 0
    for (let at = 0; at < cells[0]!.range.location; at++) if (markdown.charCodeAt(at) === 10) lead++
    out[0] = lead * GAP
  }
  for (let index = 1; index < cells.length; index++) {
    const before = cells[index - 1]!
    const here = cells[index]!
    if (before.block.kind === "blank" || here.block.kind === "blank") continue
    // The first newline ends the cell above; each one after it is a blank line.
    let newlines = 0
    for (let at = end(before.range); at < here.range.location; at++) if (markdown.charCodeAt(at) === 10) newlines++
    if (newlines === 3) out[index] = GAP
    // A cell with no blank line above it gets its 8 px as padding inside its own box — except where the cell has
    // padding of its own that replaces it: a rule's 8 px of air above the line, a code card's (and a typeset
    // equation's) own padding. Those start straight under the cell above.
    if (newlines === 1 && (here.block.kind === "rule" || here.block.kind === "code")) out[index] = -GAP
  }
  return out
}

/** Every cell of the note as HTML, in order, with the offset it was parsed from. */
export function noteBlocks(markdown: string, paper: string = PAPER_HEX): { id: number; html: string }[] {
  return positioned(markdown).map((one) => ({ id: one.range.location, html: blockHtml(one.block, paper) }))
}

/**
 * What the measuring page answers when asked (`window.__measure()`): each cell's full height, and — for an
 * equation set on its own line that is wider than the column — the zoom that brings it inside, applied
 * BEFORE the height is read (on screen such an equation scrolls; on paper it would be cut off).
 */
const MEASURE_SCRIPT = `window.__measure = () => [...document.querySelectorAll('.col > .blk')].map((blk) => {
  let zoom = 1
  const block = blk.querySelector('.wm-math-block')
  const maths = block && block.querySelector('.wm-math')
  const column = blk.getBoundingClientRect().width
  if (maths && maths.getBoundingClientRect().width > column) {
    zoom = column / maths.getBoundingClientRect().width
    block.style.zoom = String(zoom)
  }
  return { height: blk.getBoundingClientRect().height, zoom }
})`

/** One cell as measured: its height, and the zoom a too-wide equation needs. */
export type Measured = number | { height: number; zoom?: number }

/** The column to measure: one `.blk` per cell, each a cell's full height. */
export function measureHtml(blocks: { html: string }[], pane: { width: number; height: number }): string {
  const column = columnWidth(pane)
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${BLOCK_CSS}
.col { display: flow-root; width: ${column}px; margin: ${PAGE.top}px 0 0 ${PAGE.left}px; }
.col > .blk { margin-bottom: ${GAP}px; }
</style></head><body><div class="col">${blocks.map((one) => `<div class="blk">${one.html}</div>`).join("")}</div><script>${MEASURE_SCRIPT}</script></body></html>`
}

export interface PrintInput extends InkOptions {
  markdown: string
  drawing: Drawing
  pane: { width: number; height: number }
}

export interface Printed { html: string; pages: number; sheets: NonNullable<ReturnType<typeof layoutSheets>> | null }

/** CSS pixels per paper point. */
const PX = 96 / 72

/** The sheets, written out. `measured` are the cells of `noteBlocks(markdown)` as measured, in order. */
export function printHtml(input: PrintInput, measured: Measured[]): Printed {
  const size = exportPane(input.pane)
  const column = columnWidth(size)
  const paper = input.paper ?? PAPER_HEX
  const cells = positioned(input.markdown)
  const blocks = cells.map((one) => ({ id: one.range.location, html: blockHtml(one.block, paper) }))
  const extra = runGaps(input.markdown, cells)

  // The same column the preview builds: the cells in order, one gap apart.
  const pieces: { frame: { x: number; y: number; width: number; height: number }; html: string }[] = []
  let y = PAGE.top
  blocks.forEach((block, index) => {
    const given = measured[index]
    const height = typeof given === "number" ? given : given?.height ?? 0
    const zoom = typeof given === "object" && given.zoom !== undefined && given.zoom < 1 ? given.zoom : 1
    y += extra[index] ?? 0
    const top = y
    // A cell that measured nothing still stands between two gaps, as it does in the Mac's `PreviewLayout.positions`;
    // it just has nothing to print.
    y += (height > 0 ? height : 0) + GAP
    if (!(height > 0)) return
    const html = zoom < 1 ? block.html.replace('class="wm-math-block"', `class="wm-math-block" style="zoom:${zoom}"`) : block.html
    pieces.push({
      frame: { x: PAGE.left, y: top, width: column, height },
      html: `<div class="blk" style="position:absolute;left:${PAGE.left}px;top:${top}px;width:${column}px;height:${height}px">${html}</div>`,
    })
  })
  // Then the drawing, one object at a time, each in its own box: ink goes OVER the text rather than
  // beside it, and `pagesFor` welds whatever overlaps onto one sheet.
  pieces.push(...inkPieces(input.drawing, size, { paper, mediaUrl: input.mediaUrl }))

  const plan: PagePiece[] = pieces.map((piece, id) => ({ id, top: piece.frame.y, bottom: piece.frame.y + piece.frame.height }))
  const sheets = layoutSheets(plan, size.width)
  const pages = sheets ? sheets.pages : [{ top: 0, scale: 1, pieces: [] as number[], left: 54, topOffset: 54, bottom: 0 }]
  const fit = sheets ? sheets.fit : 1

  const sections = pages.map((page) => {
    const k = (sheets ? page.scale : fit) * PX
    // THE PRINT ENGINE CUTS A PAGE WHERE THE LAYOUT IS, not where a transform puts it: content
    // that is laid out below the first sheet's height is split across sheets however it is moved
    // afterwards. So each sheet's own content is laid out at the TOP (`top: -page.top` brings its
    // first piece to 0) and only then scaled onto the paper. A single piece taller than the sheet
    // would still be cut, so one that is laid out taller than 940 px is zoomed down first and
    // scaled back up by the transform (its words may then wrap a hair differently).
    const extent = Math.max(1, page.bottom - page.top)
    const zoom = extent > 940 ? 940 / extent : 1
    // Back into the order they were given in, so the drawing layer is still over the text.
    const inside = [...page.pieces].sort((a, b) => a - b).map((id) => pieces[id]!.html).join("")
    return `<section class="sheet"><div class="shift" style="left:${page.left * PX}px;top:${page.topOffset * PX}px;`
      + `width:${size.width}px;transform:scale(${k / zoom})">`
      + `<div class="doc" style="top:${-page.top}px;width:${size.width}px${zoom < 1 ? `;zoom:${zoom}` : ""}">${inside}</div></div></section>`
  })

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${BLOCK_CSS}
.sheet { position: relative; width: 816px; height: 1055px; overflow: hidden; break-after: page; page-break-after: always; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
.shift { position: absolute; transform-origin: 0 0; }
.doc { position: absolute; left: 0; }
.doc .blk { position: absolute; }
</style></head><body>${sections.join("")}</body></html>`
  return { html, pages: pages.length, sheets }
}
