/**
 * A note as the Mac's Quick Look shows it (Spotlight's preview, Finder's space bar and column view): the RENDERED page,
 * as one HTML document a preview extension hands to Quick Look. Port-only — the Swift app has no preview extension.
 * Sean, 2026-10-17: "add a preview of rendered mode to macos spotlight".
 *
 * IT IS THE PDF'S RENDERER, not a second one: every cell is `blockHtml` (blocks.ts) with `BLOCK_CSS`, maths is MathML
 * (`mathml.ts`, which WebKit draws), a drawing cell is inlined from `drawing.json` at the column's width
 * (`inkCellSvg`) and the free ink is `inkPieces` (drawing.ts), each object where it sits. What is different is only
 * what a preview cannot do:
 *
 * - NOTHING IS MEASURED. The PDF lays the cells out in a hidden window, reads their heights and places them; a preview
 *   page carries no script of its own. So the cells are laid out IN FLOW, in exactly the column the PDF measures
 *   (`measureHtml`: the page's margins, one gap after each cell, `runGaps` before it), and the free ink is a layer
 *   over that column in the same coordinates. A cell is where the PDF would have measured it.
 * - THE PANE IS THE CORE'S FALLBACK. The drawing is stored as fractions of the editor pane it was drawn in (SPEC-WM
 *   3.2), and the file does not say how big that pane was: the preview takes `FALLBACK_PANE` (900 × 600), the pane
 *   the PDF itself uses before a window has said its size. Ink drawn in a pane of another size lands proportionally
 *   off; the words never move.
 * - A NOTE WITH FREE INK IS A FIXED PAGE, 900 px wide and scaled down to fit a narrower preview (a ladder of `zoom`
 *   steps, since there is no script to work the factor out), because ink over words only stays over the right words
 *   if the words do not re-wrap. A note without any is a fluid column that wraps at the preview's own width, like the
 *   rendered page in a narrow window.
 * - LIGHT AND DARK, as the app's rendered page: it follows the system (renderer/app.css `--wm-page`), so the page is
 *   written twice, on white and on the dark page `#1E1F22`, and `prefers-color-scheme` shows one. Each is
 *   `readableInk`-checked against its own paper (a span's colour, every pen); the cells' fixed light colours are
 *   mapped to the app's dark ones by `DARK_CSS`.
 * - BIG NOTES ARE CUT, and the page says so at its foot: the first `PREVIEW_LIMITS.chars` characters (at a line end) and
 *   the first `PREVIEW_LIMITS.cells` cells; the free ink is drawn only down to the last cell shown, and not at all
 *   past `PREVIEW_LIMITS.inkItems` objects; and the ink of the drawing cells and the free ink together stops at
 *   `PREVIEW_LIMITS.inkPoints`. The extension's JavaScriptCore has no JIT, so what bounds a preview's time is that
 *   every step of the writing is ONE PASS over what it reads (inline.ts reads links, bold and tags by hand for that:
 *   their patterns were quadratic, and a crafted line held the preview for minutes).
 * - PICTURES ARE ATTACHMENTS. A picture is an entry of the archive, so its URL is `cid:wmN` and `attachments` says which
 *   entry each one is; the extension unpacks only those. A picture that is not in the file is the line-tall placeholder
 *   the page shows, and a picture on the web is that placeholder too: a preview loads nothing from the network.
 * - NOTHING IN A NOTE CAN RUN, AND THE WRITING IS WHAT SEES TO IT. Quick Look's web view runs script, and it does NOT
 *   enforce a Content-Security-Policy the page carries: the review of 2026-10-17 had a crafted drawing.json run
 *   script and fetch from the network with `PREVIEW_CSP` in the page. So every word of the note goes through the
 *   same escaping the PDF's does, every colour from the drawing is a colour or nothing (drawing.ts `paintHex`),
 *   every other attribute is escaped, and the one event handler the PDF writes (a picture that fails to load turns
 *   into its placeholder) is taken out. test/hostileDrawing.test.ts and test/quickLook.test.ts read the page as a
 *   browser's tokenizer does and fail on any element, handler or address that is not the renderer's own. The policy
 *   is still written into the page, for anything else that shows it, and nothing relies on it.
 *
 * A note that cannot be shown (a hostile name, a manifest that is not WriteMind's, a newer format) is a plain sentence
 * (`previewMessageHtml`), never an exception: `renderQuickLook` answers every input with a page.
 */

import { positioned, type Block, type PositionedBlock } from "../markdown/parser"
import { readDrawing, visibleItems, type CanvasItem, type Drawing } from "../drawing/model"
import { inkCellOf } from "../drawing/inkCell"
import { bounds } from "../drawing/geometry"
import { entryNameOf, isMediaFileName, readNamesError, WM_MANIFEST, WM_MEDIA, WM_MIMETYPE } from "../wm/names"
import { parseManifest, WM_VERSION } from "../wm/manifest"
import { BLOCK_CSS, blockHtml, PAGE, type BlockMedia } from "./blocks"
import { FALLBACK_PANE, columnWidth, GAP, runGaps } from "./document"
import { inkPieces } from "./drawing"
import { escapeHtml, PAPER_HEX } from "./inline"

/** How much of a note a preview draws (a Quick Look reply has a few seconds, and a preview is a glance). */
export const PREVIEW_LIMITS = {
  /** Characters of `note.mdwm` parsed (cut back to the last line end before it). */
  chars: 200_000,
  /** Cells drawn. */
  cells: 400,
  /** Objects of the free drawing layer drawn; a drawing with more is left off the page (and the page says so). */
  inkItems: 4_000,
  /**
   * Ink drawn, the drawing cells and the free ink together, in points (`inkWeight`: a stroke's points, twice for a
   * pen's, a flat `INK_OBJECT` for any other object). A drawing cell past it is shown as if drawing.json had not got
   * it (its snapshot picture, or its line), and free ink past it is left off. The object count alone did not bound
   * the page: 3 999 strokes of 200 points were 39 MB of page and three seconds in the extension (review, 2026-10-17).
   */
  inkPoints: 100_000,
  /** Pictures attached (the rest are their placeholder line). */
  pictures: 60,
} as const

/** What any object but a stroke costs `PREVIEW_LIMITS.inkPoints`: about the points of its outline. */
export const INK_OBJECT = 16

/**
 * What an object costs the page, in points of ink (`PREVIEW_LIMITS.inkPoints`). A pen's stroke (one with pressures)
 * counts each point twice: where its width changes every segment is a path of its own (drawing.ts `strokeBody`).
 */
export function inkWeight(item: CanvasItem): number {
  switch (item.kind) {
    case "stroke": return Math.max(1, item.stroke.points.length) * (item.stroke.pressures ? 2 : 1)
    case "connector": return INK_OBJECT + item.connector.bends.length
    case "cell": return item.cell.items.reduce((sum, one) => sum + inkWeight(one), 0)
    default: return INK_OBJECT
  }
}

/** The pane the drawing is placed against (see the top): the core's own fallback. */
export const PREVIEW_PANE = FALLBACK_PANE

/** The app's dark page (renderer/app.css `--wm-page` in dark), which the dark half is `readableInk`-checked against. */
export const DARK_PAPER_HEX = "#1E1F22"

/**
 * Inline style and the archive's own pictures; no script, no network, no fonts from anywhere, no frames, no forms. NOT
 * ENFORCED BY QUICK LOOK (see the top): written for anything else that shows the page, and relied on by nothing.
 */
export const PREVIEW_CSP = "default-src 'none'; img-src cid: data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"

export interface QuickLookInput {
  /** `note.mdwm`, decoded (the extension may hand over only its first part: `textBytes` says how long it was). */
  text: string
  /** The whole of `note.mdwm` in bytes, when `text` is only its start. */
  textBytes?: number
  /** `drawing.json`, or null when the note has none (or it was too big to read: `drawingSkipped`). */
  drawing?: string | null
  /** The drawing was there but too big for a preview to read. */
  drawingSkipped?: boolean
  /** `manifest.json`, decoded. */
  manifest: string
  /** Every entry name in the archive, in the central directory's order. */
  names: readonly string[]
}

export interface QuickLookPage {
  /** One complete HTML document. */
  html: string
  /** The pictures it shows: `cid:<cid>` in the page is the archive's entry `entry`. */
  attachments: { cid: string; entry: string }[]
  /** Whether anything was left out (the text, cells, or the drawing). */
  cut: boolean
  /** Whether the page is a message instead of the note. */
  message: boolean
}

/**
 * Why the archive's entry names say this note cannot be shown, or null (SPEC-WM 1.5: a hostile or duplicated name; 1.1
 * and 1.2: no `mimetype`, no `manifest.json`). Asked BEFORE anything is unpacked.
 */
export function previewNamesRefusal(names: readonly string[]): string | null {
  const problem = readNamesError(names)
  if (problem) return `This note cannot be shown: ${problem}.`
  if (!names.includes(WM_MIMETYPE)) return "This is not a WriteMind note (it has no mimetype entry)."
  if (!names.includes(WM_MANIFEST)) return "This note cannot be shown: it has no manifest.json."
  return null
}

/** Why `manifest.json` says this note cannot be shown, or null (1.7: not WriteMind's; 1.8: a newer format). */
export function previewManifestRefusal(manifest: string): string | null {
  const read = parseManifest(manifest)
  if (!read.ok) return `This note cannot be shown: ${read.error}.`
  if (read.version > WM_VERSION) return "A newer WriteMind wrote this note. Open it in WriteMind to see it."
  return null
}

const FONT = `-apple-system, "Helvetica Neue", "Segoe UI", Cantarell, "Noto Sans", Arial, sans-serif`

/** A page that says one thing: a note that could not be read, in words. */
export function previewMessageHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="color-scheme" content="light dark">`
    + `<style>html,body{margin:0;background:#fff;color:#1C1C1E;font:15px/1.45 ${FONT}}`
    + `.msg{padding:32px;max-width:640px}.msg b{display:block;font-size:17px;margin-bottom:6px}`
    + `@media (prefers-color-scheme: dark){html,body{background:${DARK_PAPER_HEX};color:#E8E8EA}}</style></head>`
    + `<body><div class="msg"><b>WriteMind note</b>${escapeHtml(message)}</div></body></html>`
}

/** The text a preview parses: at most `chars` characters, cut at the last line end before the limit. */
export function previewText(text: string, chars: number = PREVIEW_LIMITS.chars): { text: string; cut: boolean } {
  if (text.length <= chars) return { text, cut: false }
  const head = text.slice(0, chars)
  const line = head.lastIndexOf("\n")
  return { text: line > 0 ? head.slice(0, line) : head, cut: true }
}

/** The drawing with every picture that is not in the archive taken out (a missing file leaves nothing, as on paper). */
function withPicturesThere(drawing: Drawing, there: (file: string) => boolean): Drawing {
  const keep = (item: CanvasItem): boolean => item.kind !== "image" || (isMediaFileName(item.image.file) && there(item.image.file))
  return {
    items: drawing.items.filter(keep).map((item) => item.kind === "cell"
      ? { kind: "cell", cell: { ...item.cell, items: item.cell.items.filter(keep) } } : item),
  }
}

/**
 * The one event handler the PDF's picture cell carries (`pictureHtml` in blocks.ts: a picture that does not load turns
 * into its placeholder). Taken out word for word: test/quickLook.test.ts checks blocks.ts still writes exactly this, and
 * that no element of a preview carries any handler at all.
 */
const PICTURE_ONERROR = ` onerror="var p=this.parentNode;p.className='pic missing';p.textContent=p.getAttribute('data-alt')"`

/** One cell's HTML for the preview: the PDF's, a picture on the web as its placeholder line, and no handler. */
function cellHtml(block: Block, paper: string, media: BlockMedia): string {
  if (block.kind === "picture" && block.file === null && !block.ink && !/^data:image\//i.test(block.path)) {
    // (`blockHtml` would point an <img> at the address; a preview fetches nothing.)
    return `<div class="pic missing">${escapeHtml(block.alt || block.path)}</div>`
  }
  return blockHtml(block, paper, media).split(PICTURE_ONERROR).join("")
}

/**
 * The cells' fixed light colours (blocks.ts writes them inline) as the app draws them on its dark page (renderer/app.css,
 * editor.css). Each rule names the element blocks.ts writes the colour on, so a colour that is the PERSON'S - a span, a
 * pen, a text box's words on its own fill - is never touched: those are `readableInk`-checked against the dark paper
 * already.
 */
const DARK_CSS = `
.dark { background: ${DARK_PAPER_HEX}; color: #E8E8EA; }
.dark .heading[style*="color:#1C1C1E"] { color: #E8E8EA !important; }
.dark .heading[style*="color:#6C6C70"], .dark .list .mark[style*="color:#6C6C70"], .dark .list .text[style*="color:#6C6C70"],
  .dark .quote, .dark .pic.missing { color: #A8A8B0 !important; }
.dark .list .text[style*="text-decoration-color:#6C6C70"] { text-decoration-color: #A8A8B0 !important; }
.dark .list .box [stroke="#6C6C70"] { stroke: #A8A8B0; }
.dark .code { background: #2A2B30; color: #E8E8EA; }
.dark code { background: rgba(255, 255, 255, 0.08); }
.dark .code span[style="color:#AD3DA4"] { color: #FF7AB2 !important; }
.dark .code span[style="color:#2D6E74"] { color: #4EC9D6 !important; }
.dark .code span[style="color:#C41A16"] { color: #8BD48D !important; }
.dark .code span[style="color:#5D6C79"] { color: #7D7D88 !important; }
.dark .code span[style="color:#1C00CF"] { color: #FFB067 !important; }
.dark .code span[style="color:#4B21B0"] { color: #7AB7FF !important; }
.dark .code span[style="color:#1C1C1E"] { color: #E8E8EA !important; }
.dark .table th, .dark .table td { border-color: #3A3B41; }
.dark .table th { background: rgba(255, 255, 255, 0.05); }
.dark .rule hr { border-top-color: #3A3B41; }
.dark a.link { color: #6AA9F0; }
.dark .col [style*="background:#fff3a0"] { color: #1C1C1E; }
.dark .quote .bar { background: rgba(106, 169, 240, 0.6); }
`

/**
 * The ladder that fits a fixed 900 px page into a narrower preview (no script to work the factor out): below each
 * 25 px step the page is zoomed to that step's width. Above 900 px it stands at its own size, centred.
 */
function fitLadder(width: number): string {
  const rules: string[] = []
  for (let step = Math.floor((width - 1) / 25) * 25; step >= 150; step -= 25) {
    rules.push(`@media (max-width: ${step + 24.98}px) { .fixed { zoom: ${Math.round((step / width) * 10000) / 10000}; } }`)
  }
  return rules.join("\n")
}

/** Everything a preview of a note needs; see the top of this file. Never throws: a note that cannot be shown is a message. */
export function renderQuickLook(input: QuickLookInput): QuickLookPage {
  const asMessage = (text: string): QuickLookPage => ({ html: previewMessageHtml(text), attachments: [], cut: false, message: true })
  try {
    const refusal = previewNamesRefusal(input.names) ?? previewManifestRefusal(input.manifest)
    if (refusal) return asMessage(refusal)
    return renderNote(input)
  } catch (error) {
    // (A bug here must not cost the person a preview of every note: say it instead.)
    return asMessage(`This note could not be shown (${error instanceof Error ? error.message : String(error)}).`)
  }
}

function renderNote(input: QuickLookInput): QuickLookPage {
  const present = new Set(input.names)
  const pane = PREVIEW_PANE
  const column = columnWidth(pane)

  // The pictures: each archive entry the page shows, once, as cid:wmN.
  const attachments: { cid: string; entry: string }[] = []
  const cids = new Map<string, string>()
  let picturesLeftOut = false
  const urlOf = (file: string): string | null => {
    const entry = entryNameOf(file)
    if (!present.has(entry)) return null
    const known = cids.get(entry)
    if (known) return `cid:${known}`
    if (attachments.length >= PREVIEW_LIMITS.pictures) { picturesLeftOut = true; return null }
    const cid = `wm${attachments.length}`
    cids.set(entry, cid)
    attachments.push({ cid, entry })
    return `cid:${cid}`
  }
  const there = (file: string): boolean => present.has(`${WM_MEDIA}${file}`)

  // The text, cut to what a preview parses, and its cells, cut to what it draws.
  const { text, cut: textCut } = previewText(input.text)
  const all = positioned(text)
  const cells: PositionedBlock[] = all.slice(0, PREVIEW_LIMITS.cells)
  const cellsCut = all.length > cells.length
  const extra = runGaps(text, cells)

  // The drawing: the drawing cells the shown cells point at, in order, while the ink lasts (`PREVIEW_LIMITS.inkPoints`;
  // one past it is shown as if drawing.json had not got it), then the free ink, when there is not too much of it.
  const drawing = withPicturesThere(readDrawing(input.drawing ?? null), there)
  let inkLeft: number = PREVIEW_LIMITS.inkPoints
  let cellsTooBig = 0
  const inkDrawn = cells.map((cell) => {
    const block = cell.block
    const one = block.kind === "picture" && block.ink ? inkCellOf(drawing, block.ink) : null
    if (!one) return false
    const weight = inkWeight({ kind: "cell", cell: one })
    if (weight > inkLeft) { cellsTooBig++; return false }
    inkLeft -= weight
    return true
  })
  const free = visibleItems(drawing)
  const lastCellShown = textCut || cellsCut
  const media: BlockMedia = { url: urlOf, ink: (id) => inkCellOf(drawing, id), column }
  const noInk: BlockMedia = { ...media, ink: () => null }

  // Cut short, the drawing stops where the words do (anything lower would float over nothing). Where the shown cells
  // end is not known (nothing is measured), so it is estimated generously: a picture as tall as the column is wide, a
  // line of words every sixty characters.
  const reach = lastCellShown ? generousHeight(text, cells, extra, column) + pane.height : Infinity
  const freeHere = free.length > PREVIEW_LIMITS.inkItems ? free : free.filter((item) => bounds(item, pane).y < reach)
  const inkTooBig = free.length > PREVIEW_LIMITS.inkItems || freeHere.reduce((sum, item) => sum + inkWeight(item), 0) > inkLeft
  const freeShown = inkTooBig ? [] : freeHere
  const fixed = freeShown.length > 0

  const sheet = (paper: string, theme: "light" | "dark"): string => {
    const blocks = cells.map((cell, index) => {
      const gap = extra[index] ?? 0
      const style = gap > 0 ? ` style="padding-top:${gap}px"` : gap < 0 ? ` style="margin-top:${gap}px"` : ""
      return `<div class="blk"${style}>${cellHtml(cell.block, paper, inkDrawn[index] ? media : noInk)}</div>`
    }).join("")
    const ink = fixed ? inkPieces({ items: freeShown }, pane, { paper, mediaUrl: (file) => urlOf(file) ?? "" }) : []
    const bottom = ink.reduce((low, piece) => Math.max(low, piece.frame.y + piece.frame.height), 0)
    const layer = ink.length > 0 ? `<div class="free-ink">${ink.map((piece) => piece.html).join("")}</div>` : ""
    return `<div class="sheet ${theme}"><div class="page ${fixed ? "fixed" : "fluid"}"`
      + `${bottom > 0 ? ` style="min-height:${Math.ceil(bottom + PAGE.top)}px"` : ""}>`
      + `<div class="col">${blocks}</div>${layer}</div></div>`
  }
  const sheets = sheet(PAPER_HEX, "light") + sheet(DARK_PAPER_HEX, "dark")

  // What was left out, said at the foot of the page.
  const notes: string[] = []
  if (textCut || cellsCut) {
    const total = input.textBytes ?? input.text.length
    notes.push(`This preview shows the first ${cells.length} cell${cells.length === 1 ? "" : "s"} of a long note `
      + `(${Math.max(1, Math.round(total / 1024)).toLocaleString("en-US")} KB). Open it in WriteMind to see all of it.`)
  }
  if (inkTooBig) notes.push(`The drawing over the page (${free.length.toLocaleString("en-US")} objects) is too large for a preview.`)
  if (cellsTooBig > 0) {
    // (Each is shown as if drawing.json had not got it: its snapshot picture when the note has one, else its line.)
    notes.push(cellsTooBig === 1 ? "A drawing cell is too large to draw in a preview."
      : `${cellsTooBig} drawing cells are too large to draw in a preview.`)
  }
  if (input.drawingSkipped) notes.push("The drawing is too large for a preview and is not shown.")
  if (picturesLeftOut) notes.push(`This preview shows the first ${PREVIEW_LIMITS.pictures} pictures.`)
  const foot = notes.length === 0 ? "" : `<div class="foot">${notes.map(escapeHtml).join("<br>")}</div>`

  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="color-scheme" content="light dark">`
    + `<style>${PREVIEW_BASE_CSS}${BLOCK_CSS}${PREVIEW_PAGE_CSS}${fixed ? fitLadder(pane.width) : ""}${DARK_CSS}</style></head>`
    + `<body>${sheets}${foot}</body></html>`
  return { html, attachments, cut: notes.length > 0, message: false }
}

/** More than how far down the page the shown cells reach (see `renderNote`). */
function generousHeight(text: string, cells: readonly PositionedBlock[], extra: readonly number[], column: number): number {
  let y = PAGE.top
  cells.forEach((cell, index) => {
    const source = text.slice(cell.range.location, cell.range.location + cell.range.length)
    const lines = cell.block.kind === "blank" ? cell.block.lines : source.split("\n").length + Math.ceil(source.length / 60)
    y += Math.max(0, extra[index] ?? 0) + lines * 28 + GAP + (cell.block.kind === "picture" ? column : 0)
  })
  return y
}

const PREVIEW_BASE_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #1C1C1E; font-family: ${FONT}; -webkit-text-size-adjust: none; }
.sheet.dark { display: none; }
.foot { margin: 0 auto; max-width: ${PREVIEW_PANE.width}px; padding: 10px ${PAGE.right}px 24px ${PAGE.left}px;
  font-size: 12px; line-height: 1.45; color: #6C6C70; border-top: 1px solid #C8C8CC; }
@media (prefers-color-scheme: dark) {
  html, body { background: ${DARK_PAPER_HEX}; color: #E8E8EA; }
  .sheet.light { display: none; }
  .sheet.dark { display: block; }
  .foot { color: #A8A8B0; border-top-color: #3A3B41; }
}
`

/** The page (see the top): the PDF's measuring column, in flow, with the free ink over it in the same coordinates. */
const PREVIEW_PAGE_CSS = `
.sheet { background: #fff; color: #1C1C1E; }
.page { position: relative; margin: 0 auto; }
.page.fixed { width: ${PREVIEW_PANE.width}px; }
.page.fluid { max-width: ${PREVIEW_PANE.width}px; }
.col { display: flow-root; padding: ${PAGE.top}px ${PAGE.right}px ${PAGE.top}px ${PAGE.left}px; }
.page.fixed .col { width: ${PREVIEW_PANE.width}px; }
.col > .blk { display: flow-root; padding-bottom: ${GAP}px; }
.page.fluid .pic.ink svg { max-width: 100%; height: auto; }
/* (Not \`.ink\`: a drawing cell's own wrapper is \`.pic.ink\`, and it would be lifted out of the column.) */
.free-ink { position: absolute; left: 0; top: 0; width: ${PREVIEW_PANE.width}px; height: 0; pointer-events: none; }
@media (max-width: 520px) { .page.fluid .col, .foot { padding-left: 14px; padding-right: 14px; } }
`
