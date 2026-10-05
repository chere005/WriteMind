/**
 * Maths in the notebook: `` `wl:Integrate[x^2, {x, 0, 1}]` `` in a line of
 * prose and a ```` ```wl ```` fence on its own are Wolfram Language in the
 * file and TYPESET on the page — in two dimensions, as MathML — until the
 * caret comes into them, when the source is there to be edited.
 *
 * The drawing is the browser's: `@writemind/core`'s `mathmlFor` (the Swift
 * `MathView`) builds a tree of MathML elements — stacked fractions,
 * radicals with a roof, big operators with their limits above and below,
 * matrices between brackets that grow — and Chromium lays it out natively.
 * The same element is used by the notebook (inline and as a centred block)
 * and by the maths palette's preview, which is why this lives in the editor
 * package: `mathElement` is the one place a WL string becomes something on a
 * page.
 *
 * CARET. A click on typeset maths puts the caret in its source (the nearer
 * end, so a click on the right half is a click toward the end), and the
 * typeset form returns when the caret leaves. A selection that covers the
 * maths keeps it typeset (and copying it copies the source, because
 * CodeMirror copies the document, not the DOM); a selection that stops
 * inside it shows the source, so what is selected is what is on the page.
 *
 * INLINE IS LINEAR, BLOCK IS TWO-DIMENSIONAL. Maths on its own line is MathML (above); maths in a line of prose
 * is set the way the Mac sets it, as a linear run (`inlineSpans`, the Swift `MathTypesetter`): ∫₀¹ x² dx,
 * (a + b)/2, ∂f/∂x, with exponents and limits raised and lowered. A first port set inline maths in two
 * dimensions too, as an inline-block with negative vertical margins so that it did not push the lines apart; it
 * overlapped them instead (the denominator of ∂f/∂x ran through the next bullet, up to 12px, and the lower half
 * of the box took the clicks meant for the line below). A stacked fraction cannot fit a line of text, and a
 * linear run cannot be taller than one: no collision, no stolen clicks, line height unchanged, and a long
 * equation wraps like any other words (no scroll box of its own).
 */

import {
  EditorSelection, RangeSetBuilder, StateField, type EditorState, type Extension, type Text,
} from "@codemirror/state"
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate,
} from "@codemirror/view"
import {
  INLINE_MATH_CSS, firstCellFromBy, inlineSpans, isMathFence, mathExpressionInCode, mathmlFor, positioned,
  type InlineSpan, type MathDisplay, type MathNode, type PositionedBlock,
} from "@writemind/core"
import { notebook, notebookField } from "./notebook"

export const MATHML_NS = "http://www.w3.org/1998/Math/MathML"

/** A tree of MathML nodes as live DOM. */
export function mathDOM(tree: MathNode, doc: Document = document): Element {
  const element = doc.createElementNS(MATHML_NS, tree.tag)
  if (tree.attrs) for (const [key, value] of Object.entries(tree.attrs)) element.setAttribute(key, value)
  if (tree.text !== undefined) element.textContent = tree.text
  else for (const child of tree.children ?? []) element.append(mathDOM(child, doc))
  return element
}

/**
 * The look of it. Colour is `currentColor` (so the page's dark and light
 * both work and a fraction bar is the colour of the text); the size is the
 * surrounding text's, a touch up for the Cambria-class faces that set small.
 */
export const MATH_CSS = `
.wm-math {
  font-family: "Cambria Math", "STIX Two Math", "Latin Modern Math", "Noto Sans Math", math, serif;
  color: inherit;
}
.wm-math math { font-family: inherit; color: inherit; }
${INLINE_MATH_CSS}
.wm-math-block {
  display: block;
  text-align: center;
  padding: 6px 0 8px;
  cursor: text;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: 1.25em;
}
.wm-math-block .wm-math { display: inline-block; max-width: 100%; }
.wm-math-block math { line-height: 1.25; }
.wm-math-bare { white-space: nowrap; }
`

/** Put the maths CSS into the page, once (the palette's preview needs it outside any editor). */
export function installMathStyles(doc: Document = document): void {
  if (doc.getElementById("wm-math-style")) return
  const style = doc.createElement("style")
  style.id = "wm-math-style"
  style.textContent = MATH_CSS
  doc.head.append(style)
}

export interface MathElementOptions {
  display?: MathDisplay
}

/**
 * WL source as a typeset element, or null while it is not an expression
 * (half-typed maths is left as the user's text).
 */
export function mathElement(source: string, options: MathElementOptions = {}): HTMLElement | null {
  const display = options.display ?? "inline"
  if (display === "inline") return linearElement(source)
  const tree = mathmlFor(source, display)
  if (tree === null) return null
  installMathStyles()
  const outer = document.createElement("span")
  outer.className = "wm-math"
  outer.dataset.wl = source
  outer.append(mathDOM(tree))
  return outer
}

/**
 * The linear run of an equation, kept: the decorations ask about every equation in view on every caret move and
 * keystroke, and the widget then asks again to build it. The same source always sets the same way.
 */
const spansOf = new Map<string, InlineSpan[] | null>()
function inlineSpansCached(source: string): InlineSpan[] | null {
  let known = spansOf.get(source)
  if (known === undefined) {
    if (spansOf.size > 2000) spansOf.clear()
    known = inlineSpans(source)
    spansOf.set(source, known)
  }
  return known
}

/** Maths in a line of prose: a linear run of spans (see INLINE IS LINEAR), or null while it is not an expression. */
function linearElement(source: string): HTMLElement | null {
  const spans = inlineSpansCached(source)
  if (spans === null) return null
  installMathStyles()
  const outer = document.createElement("span")
  outer.className = "wm-math wm-math-inline"
  outer.dataset.wl = source
  for (const span of spans) {
    const piece = document.createElement("span")
    piece.textContent = span.text
    if (span.size !== 1) {
      piece.classList.add("wm-math-sz")
      piece.style.fontSize = `${span.size}em`
    }
    if (span.italic) piece.style.fontStyle = "italic"
    if (span.raise !== 0) {
      piece.classList.add("wm-math-up")
      piece.style.top = `${-span.raise}em`
    }
    outer.append(piece)
  }
  return outer
}

/**
 * Whether a press fell in the second half of an inline equation. The browser reports one rectangle per piece of
 * it (every span of a different size or style is its own), and a long equation wraps over several lines, so
 * "half" is half of the width of all the pieces laid end to end: the lines before the press count whole, the
 * line of the press up to the press.
 */
function pressIsLate(event: MouseEvent, element: HTMLElement): boolean {
  const rects = Array.from(element.getClientRects()).filter((r) => r.width > 0)
  if (rects.length === 0) return false
  const y = event.clientY
  let hit = rects.filter((r) => y >= r.top && y <= r.bottom)
  if (hit.length === 0) {
    let nearest = rects[0]!, distance = Infinity
    for (const r of rects) {
      const d = Math.min(Math.abs(y - r.top), Math.abs(y - r.bottom))
      if (d < distance) { distance = d; nearest = r }
    }
    hit = [nearest]
  }
  const top = Math.min(...hit.map((r) => r.top)), bottom = Math.max(...hit.map((r) => r.bottom))
  let total = 0, before = 0
  for (const r of rects) {
    total += r.width
    const middle = (r.top + r.bottom) / 2
    if (middle < top) before += r.width
    else if (middle <= bottom) before += Math.min(Math.max(event.clientX - r.left, 0), r.width)
  }
  return before > total / 2
}

/**
 * A press on the scrollbar of a BLOCK equation that scrolls (one wider than the pane) is for the scrollbar: it
 * must not turn the equation into its source, or a scroll box could never be dragged.
 */
function onScrollbar(event: MouseEvent, element: HTMLElement): boolean {
  const box = element.getBoundingClientRect()
  return event.clientX - box.left > element.clientWidth || event.clientY - box.top > element.clientHeight
}

/** Where typeset maths is in the document, and what a press on it means. */
interface Press {
  /** The first and last positions of the equation in the note (the backtick to the backtick, the fence to the fence). */
  start: number
  end: number
  /** The press fell in the second half of it (the right half of an inline equation, the lower half of a block). */
  late: boolean
  /** Where a plain click puts the caret: in the equation's source. */
  inside: number
}

/**
 * What a press on typeset maths does, the way a press on words does it:
 *  - the left button puts the caret in the source (the nearer end: see `Press.inside`), and a drag that starts
 *    there goes on to select, from the near EDGE of the equation (so a drag across it selects it, typeset);
 *  - Shift extends the selection from where it was to the near edge of the equation, leaving it typeset (a
 *    selection that covers all of it keeps it so), and a drag from there goes on extending it;
 *  - Ctrl (Cmd on a Mac) is left alone: a command-click belongs to the drawing layer (its marquee), as it does on
 *    words, and the press is neither stopped nor moved;
 *  - the right button selects the equation as a whole, unless a selection already covers it (as a right-click on an
 *    image selects it): it stays typeset, the page's menu opens with Cut and Copy live, and it never turns into
 *    its source under the menu, which it did (the press put the caret in it) and which a caret at either edge
 *    would do all the same -- the menu's own "move the caret to the click" finds the click inside the selection and
 *    leaves it. The press is stopped from moving the browser's own selection, which CodeMirror would read as
 *    that caret;
 *  - the middle button is the browser's.
 * The widget ignores events (`ignoreEvent`), so CodeMirror's own mouse handling never sees these presses; this is
 * all there is of it.
 */
function pressOnMaths(view: EditorView, event: MouseEvent, press: Press): void {
  if (event.ctrlKey || event.metaKey) return
  if (event.button !== 0) {
    if (event.button === 2) {
      event.preventDefault()
      const covered = view.state.selection.ranges.some((r) => !r.empty && r.from <= press.start && r.to >= press.end)
      if (!covered) view.dispatch({ selection: EditorSelection.range(press.start, press.end) })
      view.focus()
    }
    return
  }
  event.preventDefault()
  const { state } = view
  const main = state.selection.main
  const edge = press.late ? press.end : press.start
  if (event.shiftKey) {
    view.dispatch({ selection: state.selection.replaceRange(EditorSelection.range(main.anchor, edge), state.selection.mainIndex) })
    followDrag(view, event, main.anchor)
  } else {
    view.dispatch({ selection: { anchor: press.inside } })
    followDrag(view, event, edge)
  }
  view.focus()
}

/** How far the pointer must move, in pixels, before a press on maths is a drag and not a click. */
const DRAG_SLOP = 4

/**
 * The drag that begins with a press on maths: while the button is held the selection runs from `anchor` to the
 * position under the pointer. (A press on words is CodeMirror's and does this itself; a press on a widget it
 * leaves to the widget.) Ends on release, on the button coming up outside the window, and on the window losing
 * focus -- it never outlives the press.
 */
function followDrag(view: EditorView, press: MouseEvent, anchor: number): void {
  const doc = view.dom.ownerDocument
  const win = doc.defaultView
  let dragging = false
  const stop = (): void => {
    doc.removeEventListener("mousemove", move, true)
    doc.removeEventListener("mouseup", stop, true)
    win?.removeEventListener("blur", stop)
  }
  const move = (event: MouseEvent): void => {
    if ((event.buttons & 1) === 0) { stop(); return }
    if (!dragging && Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) < DRAG_SLOP) return
    dragging = true
    const head = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    const state = view.state
    view.dispatch({
      selection: state.selection.replaceRange(EditorSelection.range(Math.min(anchor, state.doc.length), head), state.selection.mainIndex),
      effects: EditorView.scrollIntoView(head, { y: "nearest" }),
    })
  }
  doc.addEventListener("mousemove", move, true)
  doc.addEventListener("mouseup", stop, true)
  win?.addEventListener("blur", stop)
}

class MathWidget extends WidgetType {
  constructor(readonly source: string, readonly block: boolean, readonly from: number, readonly to: number) {
    super()
  }

  override eq(other: MathWidget): boolean {
    // Where it is does not matter (it asks the view when it is clicked), so
    // typing above a sum does not rebuild it.
    return other.source === this.source && other.block === this.block
      && other.to - other.from === this.to - this.from
  }

  override get estimatedHeight(): number { return this.block ? 44 : -1 }

  toDOM(view: EditorView): HTMLElement {
    const element = mathElement(this.source, { display: this.block ? "block" : "inline" })
      ?? Object.assign(document.createElement("span"), { textContent: this.source })
    if (this.block) {
      const holder = document.createElement("div")
      holder.className = "wm-math-block"
      holder.append(element)
      holder.addEventListener("mousedown", (event) => {
        if (onScrollbar(event, holder)) return
        const doc = view.state.doc
        const start = Math.min(view.posAtDOM(holder), doc.length)
        // A click on the typeset maths puts the caret in its source: the
        // end of the first line of it, just inside the opening fence.
        const fence = doc.lineAt(start)
        const body = doc.line(Math.min(fence.number + 1, doc.lines))
        const box = holder.getBoundingClientRect()
        pressOnMaths(view, event, {
          start, end: Math.min(start + (this.to - this.from), doc.length),
          // the lower half of a block is its "late" half
          late: event.clientY > box.top + box.height / 2, inside: body.to,
        })
      })
      return holder
    }
    element.classList.add("wm-math-inline")
    element.addEventListener("mousedown", (event) => {
      // (No scrollbar test here: an inline equation is text and never scrolls, and a span's clientWidth is 0.)
      const doc = view.state.doc
      const start = Math.min(view.posAtDOM(element), doc.length)
      const length = this.to - this.from
      const late = pressIsLate(event, element)
      // `wl:` follows the opening backtick; the closing one is the last character.
      pressOnMaths(view, event, {
        start, end: Math.min(start + length, doc.length), late,
        inside: Math.min(late ? start + length - 1 : start + 4, doc.length),
      })
    })
    return element
  }

  override ignoreEvent(): boolean { return true }
}

/**
 * Whether the source must show: the caret is in it (or at either edge), or a
 * selection ends inside it. A selection that covers all of it leaves it
 * typeset — it is selected AS maths.
 */
export function showsSource(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => {
    if (r.empty) return r.from >= from && r.from <= to
    const overlaps = r.from < to && r.to > from
    const covers = r.from <= from && r.to >= to
    return overlaps && !covers
  })
}

// MARK: - Inline: a `wl:…` code span

/** A line that opens or closes a fence: ``` after any indentation (the Mac's rule). */
const isFenceLine = (text: string): boolean => text.trimStart().startsWith("```")

/** The language of an opening fence line, or null when the line is not a fence. */
const openingFence = (text: string): string | null =>
  isFenceLine(text) ? text.trimStart().slice(3).trim() : null

const INLINE =/`(wl:[^`\n]+)`/g

/**
 * The numbers of the lines the ranges touch, each ONCE and in order. Ranges are sorted and do not overlap, but two of
 * them can be on the same line: the rendered page replaces whole paragraphs, so the visible ranges of a view split
 * round them (`[[0, 8], [39, 40]]`), and a one-line paragraph that is not the first block is the end of one range and
 * the start of the next. A line walked twice had its equations added to the (sorted) builder twice, which CodeMirror
 * refuses -- it throws, and takes the plugin down for that view until the note is reopened: every inline equation of
 * the note was source after a visit to the rendered page.
 */
export function linesOfRanges(doc: Text, ranges: readonly { from: number; to: number }[]): number[] {
  const out: number[] = []
  let done = 0
  for (const { from, to } of ranges) {
    const last = doc.lineAt(Math.min(to, doc.length)).number
    for (let n = Math.max(doc.lineAt(Math.min(from, doc.length)).number, done + 1); n <= last; n++) out.push(n)
    done = Math.max(done, last)
  }
  return out
}

/** The decorations of the equations in the lines in view (a function of the state and the visible ranges, so it is tested without a DOM). */
export function inlineDecorations(view: Pick<EditorView, "state" | "visibleRanges">): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { state } = view
  // The lines of a code block are code: a `wl: in one is not maths. Which lines those are comes from the note's
  // parsed cells (a search per line that has a `wl: in it at all), not from walking every line above the page to
  // count fences, which cost a pass over the note on every caret move.
  const cells = notebook(state).cells
  const inCode = (pos: number): boolean => {
    const i = firstCellFromBy(cells, pos + 1, (cell) => cell.range) - 1
    if (i < 0) return false
    const cell = cells[i]!
    return cell.block.kind === "code" && pos <= cell.range.location + cell.range.length
  }
  for (const n of linesOfRanges(state.doc, view.visibleRanges)) {
    const line = state.doc.line(n)
    if (!line.text.includes("`wl:") || inCode(line.from)) continue
    INLINE.lastIndex = 0
    for (let m = INLINE.exec(line.text); m; m = INLINE.exec(line.text)) {
      const source = mathExpressionInCode(m[1]!)
      if (source === null || inlineSpansCached(source) === null) continue
      const start = line.from + m.index, end = start + m[0].length
      if (showsSource(state, start, end)) continue
      builder.add(start, end, Decoration.replace({ widget: new MathWidget(source, false, start, end) }))
    }
  }
  return builder.finish()
}

const inlinePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = inlineDecorations(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = inlineDecorations(update.view)
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
})

// MARK: - Block: a ```wl fence

/** A ```wl block that is drawn as maths: the lines it takes (opening fence to the end of the closing one) and its source. */
export interface TypesetBlock { from: number; to: number; source: string }

/** Whether the maths in a fence parses (kept: the parse is the expensive part and the same fence is asked about on every caret move). */
const parses = new Map<string, boolean>()
function mathParses(source: string): boolean {
  let known = parses.get(source)
  if (known === undefined) {
    if (parses.size > 4000) parses.clear()
    known = mathmlFor(source) !== null
    parses.set(source, known)
  }
  return known
}

/** The ways a note can be asked for its fences: by its parsed cells, which a state in the editor has already. */
const cellsOfState = (state: EditorState): readonly PositionedBlock[] =>
  state.field(notebookField, false)?.cells ?? positioned(state.doc.toString())

/** The fences of a note that CAN be drawn, whatever the caret is doing: worked out once per version of the note's cells. */
const fenceCandidates = new WeakMap<readonly PositionedBlock[], TypesetBlock[]>()
function candidatesOf(state: EditorState): TypesetBlock[] {
  const cells = cellsOfState(state)
  const held = fenceCandidates.get(cells)
  if (held) return held
  const found: TypesetBlock[] = []
  const doc = state.doc
  for (const cell of cells) {
    // The Mac's rule (`MarkdownBlocks`): a fence is a line that STARTS with ``` once its indentation is trimmed (so a
    // fence inside a list item counts); the rest of the line is the language, and any later line that starts with
    // ``` closes it. That is exactly a code cell of the parser.
    if (cell.block.kind !== "code" || !isMathFence(cell.block.language ?? "")) continue
    const first = doc.lineAt(cell.range.location)
    const last = doc.lineAt(cell.range.location + cell.range.length)
    // A fence that is never closed is not drawn (the page is the source).
    if (last.number === first.number || !isFenceLine(last.text)) continue
    const source = cell.block.body.split("\n").map((line) => line.trim()).join(" ").trim()
    // Anything on the closing fence's line after the backticks is part of that line, which the typeset block
    // replaces whole: the words would vanish from the page, though they are in the file. So such a block stays
    // source (the Mac's source pane shows them; here the page is the source). It happens when text is typed
    // or joined onto the closing fence (Backspace at the start of the line under a block).
    const closed = last.text.trimStart().slice(3).trim() === ""
    if (source !== "" && closed && mathParses(source)) found.push({ from: first.from, to: last.to, source })
  }
  fenceCandidates.set(cells, found)
  return found
}

/**
 * The blocks to draw as maths now: those that parse, that the caret is not in, and that hide nothing.
 * (A function of the state alone, so it is tested without a view.)
 */
export function typesetBlocks(state: EditorState): TypesetBlock[] {
  return candidatesOf(state).filter((block) => !showsSource(state, block.from, block.to))
}

function blockDecorations(blocks: TypesetBlock[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to, source } of blocks) {
    builder.add(from, to, Decoration.replace({ widget: new MathWidget(source, true, from, to), block: true }))
  }
  return builder.finish()
}

interface Typeset { blocks: TypesetBlock[]; decorations: DecorationSet }
const sameBlocks = (a: TypesetBlock[], b: TypesetBlock[]): boolean =>
  a.length === b.length && a.every((one, i) => one.from === b[i]!.from && one.to === b[i]!.to && one.source === b[i]!.source)

const blockField = StateField.define<Typeset>({
  create: (state) => { const blocks = typesetBlocks(state); return { blocks, decorations: blockDecorations(blocks) } },
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value
    // A caret that moves between lines of prose changes nothing here: the decorations are rebuilt only when the
    // set of blocks being drawn is not the one before.
    const blocks = typesetBlocks(transaction.state)
    return sameBlocks(blocks, value.blocks) && !transaction.docChanged ? value : { blocks, decorations: blockDecorations(blocks) }
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})

// MARK: - Wider than the pane

/**
 * A BLOCK equation can be wider than the pane (twenty terms in half a window). `.cm-content` is a flex item of the
 * scroller, and a flex item may not shrink below its min-content width (`min-width: auto`). Typeset maths cannot
 * break, so its min-content width is all of it: the whole note would be laid out at the equation's width, every
 * other paragraph with it, with a sideways scrollbar on the editor. `min-width: 0` lets the content be the pane's
 * width; the block then scrolls in its own `overflow-x: auto` box (MATH_CSS) as it was always meant to. (An INLINE
 * equation is text and wraps, so it needs no box of its own.)
 */
const contentMayShrink = EditorView.theme({ ".cm-content": { minWidth: "0" } })

/** Typeset maths in the notebook. */
export const mathRendering: Extension = [inlinePlugin, blockField, contentMayShrink]
