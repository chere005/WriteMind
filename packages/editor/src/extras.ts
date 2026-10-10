/**
 * The smaller things the Mac editor does, as CodeMirror extensions: `/link`,
 * font/size/colour on a selection, and Sublime's select-next-occurrence.
 * Each is a call into the core and nothing more.
 */

import { EditorSelection, type Extension } from "@codemirror/state"
import { EditorView, keymap, type Command } from "@codemirror/view"
import {
  allOccurrences, applySpan, codeBlock, justTypedTrigger, selectNextOccurrence, substring, viaMarkdownCells, wordRange,
  type Range, type SpanStyle,
} from "@writemind/core"
import { applyEdit, notebook } from "./notebook"
import { armedField, openArmed, setArmedType } from "./seams"
import { makesCellAfter } from "./dock"
import { followLink } from "./preview/follow"

const selection = (view: EditorView): Range => {
  const main = view.state.selection.main
  return { location: main.from, length: main.to - main.from }
}

/**
 * Font, size and colour on the selection, written as a `<span style>` — in a TEXT cell, the cell made a markdown cell
 * first, in the same edit (docs/PLAN-text-cells.md, "Automatic").
 */
export const applyTextStyle = (style: SpanStyle): Command => (view) => {
  const change = viaMarkdownCells(view.state.doc.toString(), selection(view), (text, where) => applySpan(text, where, style))
  if (change) applyEdit(view, change, true)
  return true
}

const ranges = (view: EditorView): Range[] =>
  view.state.selection.ranges.map((r) => ({ location: r.from, length: r.to - r.from }))

let wholeWord = false

/** One press of select-next-occurrence: the word under the caret, then one more each time. */
export const selectNext: Command = (view) => {
  const step = selectNextOccurrence(view.state.doc.toString(), ranges(view), wholeWord)
  if (!step) return false
  wholeWord = step.wholeWord
  view.dispatch({
    selection: EditorSelection.create(
      step.ranges.map((r) => EditorSelection.range(r.location, r.location + r.length)),
      Math.max(0, step.ranges.findIndex((r) => r.location === step.reveal.location))),
    effects: EditorView.scrollIntoView(step.reveal.location),
  })
  return true
}

/** Every occurrence at once. */
export const selectAllOccurrences: Command = (view) => {
  const text = view.state.doc.toString()
  const main = selection(view)
  const term = main.length > 0 ? substring(text, main) : (() => {
    const word = wordRange(text, main.location)
    return word ? substring(text, word) : ""
  })()
  if (term.length === 0) return false
  const found = allOccurrences(text, term, main.length === 0 || wholeWord)
  if (found.length === 0) return false
  view.dispatch({
    selection: EditorSelection.create(found.map((r) => EditorSelection.range(r.location, r.location + r.length))),
  })
  return true
}

/** Fired when `/link` has just been typed at a word boundary. */
export function linkTrigger(onTrigger: (view: EditorView, caret: number) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return
    if (!update.transactions.some((t) => t.isUserEvent("input.type"))) return
    const caret = update.state.selection.main
    if (!caret.empty) return
    // Cheap first: only the last five characters can complete the trigger.
    const tail = update.state.sliceDoc(Math.max(0, caret.head - 6), caret.head)
    if (!tail.endsWith("/link")) return
    if (justTypedTrigger(update.state.sliceDoc(Math.max(0, caret.head - 6), caret.head), tail.length)) {
      onTrigger(update.view, caret.head)
    }
  })
}

export const extraKeys: Extension = keymap.of([
  { key: "Alt-d", run: selectNext, preventDefault: true },
  { key: "Alt-Shift-d", run: selectAllOccurrences, preventDefault: true },
])

/**
 * The code-block button's chevron: tag the fence the caret is in with a
 * language (so the block is coloured as that language), or open a block
 * that is tagged already when the caret is not in one.
 */
export const tagFence = (language: string): Command => (view) => {
  const inCode = () => {
    const head = view.state.selection.main.head
    return notebook(view.state).cells.find((c) =>
      c.block.kind === "code" && head >= c.range.location && head <= c.range.location + c.range.length)
  }
  // At a bar (either page) the block is made there, now (Mac 0fdd031); with nothing selected in a cell of words it is
  // made after that cell (`makesCellAfter`); and then it is tagged like any block the caret is in.
  if ((view.state.field(armedField, false) ?? null) !== null) {
    view.dispatch({ effects: setArmedType.of({ kind: "code" }) })
    // (Not apart: the language is written into the fence in the next breath, and the two are ONE undo step.)
    openArmed(view, "", true, false)
  } else if (!inCode()) makesCellAfter({ kind: "code" }, () => false, false)(view)
  const cell = inCode()
  if (cell) {
    const line = view.state.doc.lineAt(cell.range.location)
    const indent = /^\s*/.exec(line.text)![0]
    view.dispatch({ changes: { from: line.from, to: line.to, insert: `${indent}\`\`\`${language}` } })
    view.focus()
    return true
  }
  applyEdit(view, codeBlock(view.state.doc.toString(), selection(view), language), true)
  return true
}

/**
 * A link is followed by a click on it where the rendered page DRAWS it (see
 * `preview/`), and by Alt-click on the words of a link that are being edited
 * — the markdown, or the block open on the rendered page — where a plain click
 * has to be able to put the caret in them. `followLink` hands the drawn
 * links the same way to go.
 */
export function linkClicks(onOpen: (href: string) => void): Extension {
  return [followLink.of(onOpen), EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement | null
      const link = target?.closest?.(".wm-link")
      if (!link) return false
      if (!event.altKey) return false
      const pos = view.posAtDOM(link)
      const line = view.state.doc.lineAt(pos)
      const at = pos - line.from
      const pattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(line.text))) {
        if (at >= match.index && at <= match.index + match[0].length) {
          event.preventDefault()
          onOpen(match[2]!)
          return true
        }
      }
      return false
    },
  })]
}
