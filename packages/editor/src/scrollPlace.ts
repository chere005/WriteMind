/**
 * WHERE A NOTE IS SCROLLED TO, read off the page and put back (Sean, 2026-10-16: "remember scroll position when switching
 * tabs or reopening writemind"). The place is the core's `ScrollPlace` — `notes/session.ts` says why it is the text at the
 * top of the page and not a pixel `scrollTop` — and this file is the half of it that needs a page:
 *
 * - `scrollPlaceOf(view)` reads the place: the first character on the top line of the page and how far that line's top is
 *   above the page's edge. On the markdown side that is the start of the top VISUAL line (a long paragraph wrapped over
 *   ten lines is placed by the line of it at the top, so a narrower window still opens on the same words). On a drawn
 *   block of the rendered page it is the first word of the block shown at the top, found through the `data-s` / `data-at`
 *   marks every drawn run carries (preview/render.ts), so a long list opens on the same item on either side. A picture,
 *   an ink cell, typeset maths and anything else with no words in it is placed by its own top.
 * - `restoreScrollPlace(view, place)` puts it back, and HOLDS it: the page has not measured itself yet when a note is
 *   shown (a line off the screen is only an estimate until it is drawn, a picture has no height until it has loaded), so
 *   the place is put back again every time the page's heights or size change — until the person scrolls, clicks or
 *   types, something else moves the view on purpose (a link followed, Find, the other pane's own place), the note is
 *   edited, or `HOLD_MS` have passed. While it is held, the place IS the one held: a quit in the middle of it writes
 *   where the note was, not where the page had got to. A scroll or a click that comes before the place has been put
 *   back at all (the frame the note is shown in) lets go only once it has been: the scrolling goes on from the place.
 *
 * Both are the scroller's own geometry (CodeMirror's `coordsAtPos`, the drawn runs' rectangles) and the scroller's
 * `scrollTop`: the page above and around the editor is never scrolled.
 */

import { type Extension, type StateEffectType, type Transaction, type EditorState } from "@codemirror/state"
import { BlockType, EditorView, ViewPlugin, type BlockInfo, type ViewUpdate } from "@codemirror/view"
import { PLACE_WORDS, placeIn, placeWords, type ScrollPlace } from "@writemind/core"

/** How long a place is held at most after a note is shown (the pictures of a note on a slow disk have loaded by then). */
export const HOLD_MS = 10_000

/** What the person does that ends a hold: their own scrolling, a click, a key. */
const INPUT = ["wheel", "pointerdown", "mousedown", "touchstart", "keydown"] as const

// (CodeMirror does not export the effect type `EditorView.scrollIntoView` makes; an effect of it says what it is.)
const scrollEffect = (EditorView.scrollIntoView(0) as unknown as { type: StateEffectType<unknown> }).type

/** A transaction that moves the view on purpose, or changes what is on the page: the held place is let go. */
const movesOn = (tr: Transaction): boolean => tr.docChanged || tr.scrollIntoView
  || tr.effects.some((effect) => effect.is(scrollEffect)) || tr.isUserEvent("select")

/** The words a place keeps, from the editor's text (a line's worth at most: no whole-note string). */
const wordsAt = (state: EditorState, at: number): string =>
  placeWords(state.sliceDoc(at, Math.min(state.doc.length, at + PLACE_WORDS)), 0)

/** The page's top edge, in client pixels: the top of the scroller's inside. */
const pageTop = (view: EditorView): number => view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.clientTop

/** The first of the content's children (lines and block widgets, stacked down the page) whose bottom is below `y`. */
function childBelow(view: EditorView, y: number): number {
  const children = view.contentDOM.children
  let low = 0
  let high = children.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (children[middle]!.getBoundingClientRect().bottom > y + 0.5) { found = middle; high = middle - 1 } else low = middle + 1
  }
  return found
}

/** A drawn block of the rendered page (preview/render.ts), the element itself or the one it holds. */
const drawnIn = (element: HTMLElement): HTMLElement | null =>
  element.classList.contains("wm-pv") ? element : element.querySelector<HTMLElement>(".wm-pv")

/** The runs of a drawn block that say which characters of its source they show. */
const runsOf = (drawn: HTMLElement): HTMLElement[] => Array.from(drawn.querySelectorAll<HTMLElement>("[data-s], [data-at]"))

/** The text nodes of a run, and where each starts in the run's own text. */
function textNodes(run: HTMLElement): { node: Text; start: number }[] {
  const out: { node: Text; start: number }[] = []
  const walker = run.ownerDocument.createTreeWalker(run, NodeFilter.SHOW_TEXT)
  let start = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    out.push({ node: node as Text, start })
    start += (node as Text).length
  }
  return out
}

/** The rectangle of the `index`th character of a run's text (null for a run with no text there). */
function charRect(run: HTMLElement, nodes: { node: Text; start: number }[], index: number): DOMRect | null {
  const holder = [...nodes].reverse().find((one) => one.start <= index)
  if (!holder || index - holder.start >= holder.node.length) return null
  const range = run.ownerDocument.createRange()
  range.setStart(holder.node, index - holder.start)
  range.setEnd(holder.node, index - holder.start + 1)
  const rect = range.getBoundingClientRect()
  return rect.width === 0 && rect.height === 0 ? null : rect
}

/** In a drawn block, the first character shown on the line at or below `y`: its offset in the block's source, and its top. */
function drawnPlace(drawn: HTMLElement, y: number): { offset: number; top: number } | null {
  for (const run of runsOf(drawn)) {
    const rects = run.getClientRects()
    if (rects.length === 0 || rects[rects.length - 1]!.bottom <= y + 0.5) continue
    const start = Number(run.dataset.s ?? run.dataset.at)
    if (!Number.isFinite(start)) continue
    if (run.dataset.s !== undefined) {
      // The first character whose line reaches below the edge (they run down the page in order: a search).
      const nodes = textNodes(run)
      const length = nodes.reduce((sum, one) => sum + one.node.length, 0)
      let low = 0
      let high = length - 1
      let hit: { index: number; top: number } | null = null
      while (low <= high) {
        const middle = (low + high) >> 1
        const rect = charRect(run, nodes, middle)
        if (rect && rect.bottom > y + 0.5) { hit = { index: middle, top: rect.top }; high = middle - 1 } else low = middle + 1
      }
      if (hit) return { offset: start + hit.index, top: hit.top }
    }
    return { offset: start, top: rects[0]!.top }
  }
  return null
}

/** In a drawn block, the top of the line that shows the character `offset` of its source (null: no run shows it). */
function drawnTop(drawn: HTMLElement, offset: number): number | null {
  let best: { run: HTMLElement; start: number } | null = null
  for (const run of runsOf(drawn)) {
    const start = Number(run.dataset.s ?? run.dataset.at)
    if (!Number.isFinite(start) || start > offset || run.getClientRects().length === 0) continue
    if (!best || start >= best.start) best = { run, start }
  }
  if (!best) return null
  if (best.run.dataset.s !== undefined) {
    const nodes = textNodes(best.run)
    const length = nodes.reduce((sum, one) => sum + one.node.length, 0)
    const rect = charRect(best.run, nodes, Math.min(offset - best.start, length - 1))
    if (rect) return rect.top
  }
  return best.run.getClientRects()[0]!.top
}

/** The place at the top of the page, measured (not the one held). */
function measuredPlace(view: EditorView): ScrollPlace | null {
  if (!view.dom.isConnected || view.scrollDOM.clientHeight === 0) return null
  const top = pageTop(view)
  const children = view.contentDOM.children
  let index = childBelow(view, top)
  if (index < 0) return null
  // A widget that stands for no characters (the gap of a cell that stands apart: apart.ts) is not a place: what follows it is.
  while (index + 1 < children.length && !children[index]!.classList.contains("cm-line")
    && view.posAtDOM(children[index + 1]!) === view.posAtDOM(children[index]!)) index++
  const child = children[index] as HTMLElement
  const from = view.posAtDOM(child)
  const box = child.getBoundingClientRect()
  let at = from
  let lineTop = box.top
  if (child.classList.contains("cm-line")) {
    // The visual line at the edge (or the line's first, when it starts below it): its first character.
    const y = Math.min(Math.max(top, box.top), box.bottom - 1) + 0.5
    const line = view.state.doc.lineAt(from)
    at = Math.min(Math.max(view.posAtCoords({ x: box.left + 1, y }, false), line.from), line.to)
    lineTop = view.coordsAtPos(at, 1)?.top ?? box.top
  } else {
    const drawn = drawnIn(child)
    const hit = drawn ? drawnPlace(drawn, top) : null
    if (hit) {
      const block = view.lineBlockAt(from)
      at = Math.min(from + hit.offset, block.to)
      lineTop = hit.top
    }
  }
  return { at, offset: Math.round((top - lineTop) * 100) / 100, text: wordsAt(view.state, at) }
}

/** The block of the page that holds `at`: its line, or the widget in it (a drawn block, a picture) when it is one. */
function blockAt(view: EditorView, at: number): BlockInfo {
  const line = view.lineBlockAt(at)
  if (!Array.isArray(line.type)) return line
  const parts = line.type as readonly BlockInfo[]
  return parts.find((part) => part.from <= at && at <= part.to && (part.to > part.from || part.type === BlockType.Text)) ?? line
}

/** Where the line holding `at` starts on the page now, in client pixels: exact once it is drawn, CodeMirror's estimate before. */
function topOf(view: EditorView, at: number): number {
  const block = blockAt(view, at)
  const estimate = view.documentTop + block.top
  if (at < view.viewport.from || at > view.viewport.to) return estimate
  if (block.type === BlockType.Text) return view.coordsAtPos(at, 1)?.top ?? estimate
  const index = childBelow(view, estimate)
  const child = index >= 0 ? view.contentDOM.children[index] as HTMLElement : null
  if (!child || view.posAtDOM(child) !== block.from) return estimate
  // (A drawn block's own top is not its first line's: the block's padding is above it. Its words say where their line is.)
  const drawn = drawnIn(child)
  return (drawn ? drawnTop(drawn, at - block.from) : null) ?? child.getBoundingClientRect().top
}

/**
 * How long a place is still held once the person has moved before it was put back (`Held.ending`): long enough for the
 * page to draw the place's line and put it there exactly, short enough that a wheel still turning is never fought for long.
 */
const ENDING_MS = 400

interface Held {
  place: ScrollPlace
  /** The `scrollTop` the page was last left at by this place or by CodeMirror's own measuring: anything else is someone else. */
  expected: number
  until: number
  /** The place has been put back with its line drawn on the page (not where CodeMirror only estimated it to be). */
  shown: boolean
  /**
   * The person scrolled or clicked before that: the place is put back once, exactly, and then let go, so their scrolling
   * goes on FROM it. (Letting go at once left the page at its top — nothing had been put back yet — and that top was then
   * read and kept as the note's place for good: reviewer, 2026-10-16, a wheel turned in the frame the tab was shown.)
   */
  ending: boolean
}

class PlaceKeeper {
  held: Held | null = null

  constructor(readonly view: EditorView) {
    // In the capture phase, so it is asked before CodeMirror's own listener on the scroller measures the new position.
    view.dom.addEventListener("scroll", this.scrolled, true)
    for (const type of INPUT) window.addEventListener(type, this.letGo, true)
  }

  /** The person scrolled, clicked or typed: the place is theirs to move (once it has been put back). */
  readonly letGo = (): void => {
    const held = this.held
    if (held && !held.shown) this.ending(held)
    else this.held = null
  }

  private ending(held: Held): void {
    held.ending = true
    held.until = Math.min(held.until, Date.now() + ENDING_MS)
  }

  /** The place held now: none once its time is up, even if nothing has happened since to say so. */
  current(): Held | null {
    if (this.held && Date.now() > this.held.until) this.held = null
    return this.held
  }

  /** The scroller moved, and not to where this place or CodeMirror's measuring left it: a script or the person did it. */
  readonly scrolled = (event: Event): void => {
    const held = this.held
    if (!held || event.target !== this.view.scrollDOM || Math.abs(this.view.scrollDOM.scrollTop - held.expected) <= 1) return
    if (held.shown) this.held = null
    else this.ending(held)
  }

  hold(place: ScrollPlace): void {
    this.held = { place, expected: this.view.scrollDOM.scrollTop, until: Date.now() + HOLD_MS, shown: false, ending: false }
    this.apply()
  }

  /** Put the held place back: read where its line is now, then scroll by the difference. */
  apply(): void {
    this.view.requestMeasure<{ wanted: number; drawn: boolean } | null>({
      key: this,
      read: (view) => {
        const held = this.held
        if (!held || view.scrollDOM.clientHeight === 0) return null
        const wanted = view.scrollDOM.scrollTop + topOf(view, held.place.at) - (pageTop(view) - held.place.offset)
        // (Read off the drawn page when the line is in the part CodeMirror has drawn; an estimate from its height map before.)
        return { wanted: Math.max(0, wanted), drawn: held.place.at >= view.viewport.from && held.place.at <= view.viewport.to }
      },
      write: (measured, view) => {
        const held = this.held
        if (!held || measured === null) return
        if (Math.abs(measured.wanted - view.scrollDOM.scrollTop) >= 1) view.scrollDOM.scrollTop = measured.wanted
        held.expected = view.scrollDOM.scrollTop
        if (measured.drawn) held.shown = true
        if (held.ending && held.shown) this.held = null
      },
    })
  }

  /** After every update (and so after CodeMirror has measured and corrected the scroll for heights that changed). */
  updated(update: ViewUpdate): void {
    const held = this.current()
    if (!held) return
    if (update.transactions.some(movesOn)) { this.held = null; return }
    if (update.geometryChanged || update.heightChanged || update.viewportChanged) {
      held.expected = this.view.scrollDOM.scrollTop
      this.apply()
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener("scroll", this.scrolled, true)
    for (const type of INPUT) window.removeEventListener(type, this.letGo, true)
  }
}

const keeper = ViewPlugin.fromClass(PlaceKeeper)

/** The editor's half of the remembered place: the keeper, told after every update. */
export const scrollPlaces: Extension = [
  keeper,
  EditorView.updateListener.of((update) => update.view.plugin(keeper)?.updated(update)),
]

/** Where the page is scrolled to now: the place held while one is, else the place measured (null: nothing laid out). */
export function scrollPlaceOf(view: EditorView): ScrollPlace | null {
  const held = view.plugin(keeper)?.current()
  return held ? held.place : measuredPlace(view)
}

/**
 * Put a remembered place back and hold it while the page finds its heights. Its words find it again in a note that
 * was changed while it was not open (core `placeIn`); the whole note is read as a string only then.
 */
export function restoreScrollPlace(view: EditorView, place: ScrollPlace): void {
  const plugin = view.plugin(keeper)
  if (!plugin) return
  const length = view.state.doc.length
  let at = Math.min(Math.max(0, Math.floor(place.at)), length)
  if (place.text.trim().length > 0 && view.state.sliceDoc(at, at + place.text.length) !== place.text) {
    at = placeIn(view.state.doc.toString(), place)
  }
  plugin.hold({ at, offset: place.offset, text: wordsAt(view.state, at) })
}

/** Two places that put the same line at the same height. */
export const samePlace = (a: ScrollPlace | null | undefined, b: ScrollPlace | null | undefined): boolean =>
  a === b || (!!a && !!b && a.at === b.at && Math.abs(a.offset - b.offset) < 0.5)
