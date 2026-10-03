/**
 * Maths in the notebook: `` `wl:Integrate[x^2, x]` `` in a line of prose and a
 * ```` ```wl ```` fence on its own are Wolfram Language in the file and
 * TYPESET on the page — until the caret comes into them, when the source is
 * there to be edited.
 *
 * The typesetting itself is `@writemind/core`'s `typesetInline` (the Swift
 * `MathTypesetter`): a list of runs with a size, an italic flag and a baseline
 * shift, which this file turns into spans. It is the LINEAR form — exponents
 * raised, bounds lowered, `∫`, `∑`, `√`; the two-dimensional layout
 * (stacked fractions, big operators with limits above and below) is not ported.
 *
 * This is an extension for the notebook's CodeMirror, kept in the app rather
 * than in `@writemind/editor`; `Notebook.tsx` lists it with the others.
 */

import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { isMathFence, mathExpressionInCode, typesetInline, type MathRuns } from "@writemind/core"

/** The base size the runs are set at; they are drawn in `em`, so the editor's own size rules. */
const BASE = 15

/** Typeset runs as a span of spans. */
export function runsElement(runs: MathRuns): HTMLElement {
  const outer = document.createElement("span")
  outer.className = "wm-math"
  for (const run of runs) {
    const piece = document.createElement("span")
    piece.textContent = run.text
    piece.style.fontSize = `${run.size / BASE}em`
    if (run.italic) piece.style.fontStyle = "italic"
    if (run.baseline !== 0) {
      piece.style.verticalAlign = `${run.baseline / BASE}em`
      piece.style.lineHeight = "0"
    }
    outer.append(piece)
  }
  return outer
}

class MathWidget extends WidgetType {
  constructor(readonly source: string, readonly block: boolean, readonly from: number) { super() }

  override eq(other: MathWidget): boolean {
    return other.source === this.source && other.block === this.block && other.from === this.from
  }

  toDOM(view: EditorView): HTMLElement {
    const runs = typesetInline(this.source, this.block ? BASE * 1.25 : BASE)
    const element = runsElement(runs ?? [{ text: this.source, size: BASE, italic: false, baseline: 0 }])
    element.dataset.wl = this.source
    if (this.block) {
      const holder = document.createElement("div")
      holder.className = "wm-math-block"
      holder.append(element)
      holder.addEventListener("mousedown", (event) => {
        // A click on the typeset maths puts the caret in its source.
        event.preventDefault()
        view.dispatch({ selection: { anchor: Math.min(this.from + 1, view.state.doc.length) } })
        view.focus()
      })
      return holder
    }
    element.addEventListener("mousedown", (event) => {
      event.preventDefault()
      const at = view.posAtDOM(element)
      view.dispatch({ selection: { anchor: Math.min(at + 4, view.state.doc.length) } })
      view.focus()
    })
    return element
  }

  override ignoreEvent(): boolean { return true }
}

const touches = (state: EditorState, from: number, to: number): boolean =>
  state.selection.ranges.some((r) => r.from <= to && r.to >= from)

// MARK: - Inline: a `wl:…` code span

const INLINE = /`(wl:[^`\n]+)`/g

function inlineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { state } = view
  let inFence = false
  // Visible lines only (plus the fence state above them, which a fence
  // opening off-screen would otherwise get wrong — so start at the top of
  // the first visible line's fence by scanning back).
  for (const { from, to } of view.visibleRanges) {
    const first = state.doc.lineAt(from).number, last = state.doc.lineAt(to).number
    inFence = false
    for (let n = 1; n < first; n++) if (/^\s*(```|~~~)/.test(state.doc.line(n).text)) inFence = !inFence
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      if (/^\s*(```|~~~)/.test(line.text)) { inFence = !inFence; continue }
      if (inFence || !line.text.includes("`wl:")) continue
      INLINE.lastIndex = 0
      for (let m = INLINE.exec(line.text); m; m = INLINE.exec(line.text)) {
        const source = mathExpressionInCode(m[1]!)
        if (source === null || typesetInline(source) === null) continue
        const start = line.from + m.index, end = start + m[0].length
        if (touches(state, start, end)) continue
        builder.add(start, end, Decoration.replace({ widget: new MathWidget(source, false, start) }))
      }
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

function blockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = state.doc
  let n = 1
  while (n <= doc.lines) {
    const open = /^```\s*(\S*)\s*$/.exec(doc.line(n).text)
    if (!open) { n++; continue }
    // Find the closing fence.
    let close = n + 1
    while (close <= doc.lines && !/^```\s*$/.test(doc.line(close).text)) close++
    if (close > doc.lines) break
    if (isMathFence(open[1])) {
      const from = doc.line(n).from, to = doc.line(close).to
      const lines: string[] = []
      for (let k = n + 1; k < close; k++) lines.push(doc.line(k).text)
      const source = lines.join(" ").trim()
      if (source !== "" && typesetInline(source) !== null && !touches(state, from, to)) {
        builder.add(from, to, Decoration.replace({ widget: new MathWidget(source, true, from), block: true }))
      }
    }
    n = close + 1
  }
  return builder.finish()
}

const blockField = StateField.define<DecorationSet>({
  create: blockDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection ? blockDecorations(transaction.state) : value
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
})

/** Typeset maths in the notebook. */
export const mathRendering: Extension = [inlinePlugin, blockField]
