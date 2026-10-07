/**
 * COPY CELL (BoxActions.tsx): the boxed writing as a drawing cell on the clipboard, and back. What WriteMind's own paste
 * reads is the capture Bring in as Drawing Cell docks (the strokes landed in pane FRACTIONS, the box landed beside them,
 * `tabletCapture.ts Capture`) with the pane they were landed in, so the pasted cell is the one the button would have docked.
 * Pure: App.tsx `copySheetCell` / `pasteSheetCell` do the clipboard and the note. test/copiedCell.test.ts holds the rules.
 *
 * What comes from a clipboard is untrusted: `readCopiedCell` takes only strokes of finite numbers, a few of them, and a pane
 * and box that are numbers; anything else is null (nothing is pasted).
 */

import { COPIED_SVG_NAME, inkCellMarkdown, type CanvasItem, type InkCell, type Rect, type Size, type WolframMedia } from "@writemind/core"
import { DRAWING_MIME } from "@writemind/editor"
import { inkCellForNewInk } from "./dock"
import { copiedCellMedia } from "./wolframMedia"

/** What the clipboard's custom type holds. */
export interface CopiedCell { strokes: CanvasItem[]; frame: Rect | null; pane: Size }

/** The most points a pasted cell may hold (a page of handwriting is a few thousand). */
const MAX_POINTS = 200_000

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

export const encodeCopiedCell = (copied: CopiedCell): string => JSON.stringify(copied)

/** The copied cell `json` holds, or null when it is not one (malformed, foreign, too big). */
export function readCopiedCell(json: string): CopiedCell | null {
  let value: unknown
  try { value = JSON.parse(json) } catch { return null }
  if (!value || typeof value !== "object") return null
  const given = value as Record<string, unknown>
  const pane = given.pane as Record<string, unknown> | null
  if (!pane || typeof pane !== "object" || !finite(pane.width) || !finite(pane.height) || !(pane.width > 0) || !(pane.height > 0)) return null
  let frame: Rect | null = null
  if (given.frame !== null && given.frame !== undefined) {
    const one = given.frame as Record<string, unknown>
    if (typeof one !== "object" || ![one.x, one.y, one.width, one.height].every(finite)) return null
    frame = { x: one.x as number, y: one.y as number, width: one.width as number, height: one.height as number }
  }
  if (!Array.isArray(given.strokes) || given.strokes.length === 0) return null
  let points = 0
  const strokes: CanvasItem[] = []
  for (const item of given.strokes as unknown[]) {
    const one = item as { kind?: unknown; stroke?: Record<string, unknown> } | null
    const stroke = one?.stroke
    if (!one || one.kind !== "stroke" || !stroke || typeof stroke !== "object") return null
    if (typeof stroke.id !== "string" || typeof stroke.colorHex !== "string" || !finite(stroke.width) || !stroke.transform || typeof stroke.transform !== "object") return null
    if (!Array.isArray(stroke.points) || stroke.points.length === 0) return null
    points += stroke.points.length
    if (points > MAX_POINTS) return null
    for (const point of stroke.points as { x?: unknown; y?: unknown }[]) if (!point || !finite(point.x) || !finite(point.y)) return null
    strokes.push(one as unknown as CanvasItem)
  }
  return { strokes, frame, pane: { width: pane.width, height: pane.height } }
}

/** What Copy Cell hands the shell (`wolframCopy`) for a copied cell `cell` shown `shown` px wide: its words, line and svg. */
export function copiedCellForShell(cell: InkCell, shown: number, depth: number, noteFile: string | null): {
  plain: string; markdown: string; media: WolframMedia; noteFile: string | null; cell: true
} {
  const media = copiedCellMedia(cell, shown)
  // The plain text other apps get when they take words: the SVG markup itself (the file and the markup are beside it).
  return { plain: media.inks[cell.id]!.svg, markdown: inkCellMarkdown(cell.id, depth), media, noteFile, cell: true }
}

/** The cell a copied cell is, as the button would have docked it (`dockNewInk`), in a column `width` px wide. */
export const cellOfCopied = (copied: CopiedCell, width: number): InkCell | null =>
  inkCellForNewInk(copied.strokes, copied.pane, { left: 0, width }, copied.frame)

// ---- which paste is ours -------------------------------------------------------------------------------------------------
// Chromium on a Mac shows a paste that carries a FILE as only that file (`types: ["Files"]`: the words and the custom type
// beside it are not there to read), and Copy Cell puts the SVG file on the clipboard for the other apps. So the page also
// remembers its last copy, and knows its own file by its name and size.

let last: { json: string; name: string; bytes: number } | null = null

/** The page's last Copy Cell: `json` is the custom type's text, `svg` what the shell wrote to the file. */
export function rememberCopiedCell(json: string, svg: string): void {
  last = { json, name: COPIED_SVG_NAME, bytes: new TextEncoder().encode(svg).length }
}

/**
 * The copied cell's JSON when this paste is WriteMind's own copied drawing cell: the custom type, or the one file the shell
 * wrote for the last copy (its name and size). Otherwise null: an ordinary paste.
 */
export function copiedCellOf(data: { getData(type: string): string; files?: ArrayLike<{ name: string; size: number }> | null }): string | null {
  const given = data.getData(DRAWING_MIME)
  if (given) return given
  const files = data.files
  if (!last || !files || files.length !== 1) return null
  const file = files[0]!
  return file.name === last.name && file.size === last.bytes ? last.json : null
}
