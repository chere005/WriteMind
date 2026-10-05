/**
 * Where a note is cut into sheets of paper. Ported from
 * `WriteMind/Export/PagePlan.swift`.
 *
 * A note is a column of cells with the drawing's objects in the gaps between
 * them; paper is a fixed height. This is the one function that decides which
 * of them share a sheet, and it is written over MEASURED HEIGHTS and nothing
 * else — no views, no window, no context — so the decision can be read,
 * argued with and tested on its own.
 *
 * Two rules, both Sean's (2026-09-19, "export as pdf"):
 *
 *  - A break goes BETWEEN cells, never through one, so no line of text is
 *    ever cut in half. A cell is atomic here; so is a drawing.
 *  - Anything taller than the paper gets a sheet to itself, shrunk until it
 *    fits, because the alternative is losing the bottom of it.
 *
 * Pieces that OVERLAP cannot be parted — a picture with a sketch drawn over
 * it is one thing — so they are welded into one unit first. A gap between two
 * pieces, however small, is a place a break may go.
 */

/** US Letter, portrait, in points. */
export const PAPER = { width: 612, height: 792 } as const
/** Three quarters of an inch of paper round the edge. */
export const MARGIN = 54

export interface PaperSize { width: number; height: number }

/** What is left of a sheet once the margin has had its say. */
export function paperContent(paper: PaperSize = PAPER, margin = MARGIN): PaperSize {
  return { width: Math.max(1, paper.width - margin * 2), height: Math.max(1, paper.height - margin * 2) }
}

/** One thing that must not be broken: a cell, or a drawing object. `top` and `bottom` are in document points. */
export interface PagePiece { id: number; top: number; bottom: number }

/**
 * One sheet: where in the document it starts, what it had to be shrunk by
 * (1 unless a single piece was too tall for a whole page), and which pieces
 * go on it, in the order they were handed over.
 */
export interface PlannedPage { top: number; scale: number; pieces: number[] }

const heightOf = (piece: PagePiece): number => Math.max(0, piece.bottom - piece.top)

/**
 * The sheets, in order. `pageHeight` is the room on one of them, in the
 * document's points — the caller has already worked out what the whole
 * document is shrunk by to fit the paper's width.
 *
 * Always at least one page: a note with nothing in it is a blank sheet, not a
 * file with no pages in it (which is not a PDF at all).
 */
export function pagesFor(pieces: PagePiece[], pageHeight: number): PlannedPage[] {
  const ordered = pieces.filter((piece) => heightOf(piece) > 0).sort((a, b) => a.top - b.top)
  if (ordered.length === 0 || !(pageHeight > 0)) return [{ top: 0, scale: 1, pieces: [] }]

  const units: { top: number; bottom: number; ids: number[] }[] = []
  for (const piece of ordered) {
    const last = units[units.length - 1]
    if (last && piece.top < last.bottom) {
      last.bottom = Math.max(last.bottom, piece.bottom)
      last.ids.push(piece.id)
    } else {
      units.push({ top: piece.top, bottom: piece.bottom, ids: [piece.id] })
    }
  }

  const pages: PlannedPage[] = []
  let open: PlannedPage | null = null
  for (const unit of units) {
    const height = unit.bottom - unit.top
    // Too tall for any sheet: its own, shrunk to fit. Nothing else goes on it
    // — a half-size diagram with a paragraph beside it reads as a mistake.
    if (height > pageHeight) {
      if (open) pages.push(open)
      open = null
      pages.push({ top: unit.top, scale: pageHeight / height, pieces: [...unit.ids] })
      continue
    }
    // A sheet starts at the top of the first piece on it, so the page break
    // itself never leaves a band of blank paper.
    if (open && unit.bottom - open.top <= pageHeight) {
      open.pieces.push(...unit.ids)
    } else {
      if (open) pages.push(open)
      open = { top: unit.top, scale: 1, pieces: [...unit.ids] }
    }
  }
  if (open) pages.push(open)
  return pages
}

/**
 * The whole document laid onto paper: how much it is shrunk (or blown up) to
 * fill the paper's width, the pages, and where each page's content begins on
 * the sheet. `NotePDF.data` in the Swift: the column is laid out at the
 * editor pane's width and then SCALED to the paper, rather than re-flowed, so
 * a picture keeps the paragraph it was put beside.
 */
export interface Sheet {
  /** Paper points per document point, before a page's own shrink. */
  fit: number
  pages: (PlannedPage & {
    /** Paper points per document point on THIS page. */
    scale: number
    /** Left offset of the document on the sheet, in paper points (margin + centring). */
    left: number
    /** Top offset of the document on the sheet (the margin). */
    topOffset: number
    /** The page's bottom in document points: the last piece's bottom, so the next page's first cell never peeks in. */
    bottom: number
  })[]
  paper: PaperSize
  margin: number
}

export function layoutSheets(pieces: PagePiece[], documentWidth: number,
  paper: PaperSize = PAPER, margin = MARGIN): Sheet | null {
  if (!(documentWidth > 0) || !(paper.width > margin * 2) || !(paper.height > margin * 2)) return null
  const room = paperContent(paper, margin)
  const fit = room.width / documentWidth
  const plan = pagesFor(pieces, room.height / fit)
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  return {
    fit, paper, margin,
    pages: plan.map((page) => {
      const scale = fit * page.scale
      // A page that had to be shrunk is centred on the sheet rather than left
      // hanging off the left margin.
      const indent = Math.max(0, (room.width - documentWidth * scale) / 2)
      const bottom = Math.max(page.top, ...page.pieces.map((id) => byId.get(id)?.bottom ?? page.top))
      return { ...page, scale, left: margin + indent, topOffset: margin, bottom }
    }),
  }
}
