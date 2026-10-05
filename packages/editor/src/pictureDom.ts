/**
 * A picture cell, drawn: the DOM both panes and the rendered page's `renderBlock` share (docs\PLAN-docking-ink-cells.md
 * (c)). A leaf module: no CodeMirror, no state, so `preview/render.ts` and `pictureCells.ts` can both build on it.
 *
 * - The picture is the column's width capped at its own (`max-width: 100%` on its natural size), on screen as on
 *   paper (core `BLOCK_CSS` `.pic img`), and `display: block` so no descender gap makes the two disagree.
 * - A file that is missing or will not load is a LINE-TALL placeholder with its alt words (or file name), so a seam
 *   and a bracket can still hold the cell (the Mac's rule: a cell with no height is a cell nothing can hold).
 * - Natural sizes are remembered by source, so a picture drawn again (scrolled back in, the other pane) reserves its
 *   height before it loads and nothing below it jumps.
 */

/** One line of the markdown side: 15px × 1.45. The missing-file placeholder is exactly this tall. */
export const PICTURE_LINE = 21.75

/** Where a picture's file is, as the page can ask for it: the app's own media scheme, or what was written. */
export function pictureSource(src: string): string {
  if (/^(data:|wm:|blob:|https?:)/i.test(src)) return src
  const name = src.split(/[\\/]/).pop() ?? src
  return `wm://media/${encodeURIComponent(name)}`
}

/** What a picture cell names: its alt words, the path written, and the media file in it (or null). */
export interface PictureSpec { alt: string; path: string; file: string | null }

/** Natural sizes of the pictures loaded so far, by source. */
const natural = new Map<string, { width: number; height: number }>()

/** The text column's width the last time a picture or ink cell was laid out (for estimates off screen). */
let column = 720

/** The column's width as last seen. */
export const lastColumnWidth = (): number => column

/** Remember the column's width (any cell that measured itself says so). */
export function noteColumnWidth(width: number): void {
  if (Number.isFinite(width) && width > 40) column = width
}

/** How tall a picture cell will be, as well as can be said before it is laid out. */
export function pictureHeightEstimate(path: string): number {
  const size = natural.get(pictureSource(path))
  if (!size || size.width <= 0) return PICTURE_LINE
  return Math.max(1, Math.min(size.width, column)) * (size.height / size.width)
}

/** The placeholder's words: the alt words, else the file's name, else the path. */
export const placeholderWords = (spec: PictureSpec): string =>
  spec.alt.trim() || spec.file || spec.path.split(/[\\/]/).pop() || spec.path

/** Turn a picture cell into its missing-file line. */
function missing(holder: HTMLElement, spec: PictureSpec): void {
  holder.textContent = ""
  holder.classList.add("wm-cellpic-missing")
  const words = document.createElement("span")
  words.className = "wm-cellpic-words"
  words.textContent = placeholderWords(spec)
  holder.appendChild(words)
  holder.title = spec.path
}

/**
 * The picture cell's own element: `div.wm-cellpic > img`, or the line-tall placeholder. `remeasure` is called when its
 * height changes after it was drawn (the picture arrived, or turned out to be missing).
 */
export function pictureCellDom(spec: PictureSpec, remeasure: () => void): HTMLElement {
  const holder = document.createElement("div")
  holder.className = "wm-cellpic"
  holder.dataset.picture = spec.file ?? spec.path
  const src = pictureSource(spec.path)
  if (!spec.path) { missing(holder, spec); return holder }
  const picture = document.createElement("img")
  picture.alt = spec.alt
  picture.draggable = false
  picture.decoding = "async"
  const known = natural.get(src)
  if (known) {
    // The height is reserved before the bytes arrive (width/height give `height: auto` its ratio).
    picture.width = known.width
    picture.height = known.height
  }
  picture.addEventListener("load", () => {
    if (picture.naturalWidth > 0) {
      const was = natural.get(src)
      natural.set(src, { width: picture.naturalWidth, height: picture.naturalHeight })
      if (!was || was.width !== picture.naturalWidth || was.height !== picture.naturalHeight) {
        picture.width = picture.naturalWidth
        picture.height = picture.naturalHeight
      }
    }
    remeasure()
  })
  picture.addEventListener("error", () => {
    natural.delete(src)
    missing(holder, spec)
    remeasure()
  })
  picture.src = src
  holder.appendChild(picture)
  return holder
}
