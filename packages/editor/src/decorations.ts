/**
 * The markdown drawn as what it means while it stays what it is.
 *
 * On the Mac this was TextKit 1 glyph substitution — `MarkerHiding` faded
 * the `#`, `BulletGlyphs` swapped the dash's glyph for a bullet — and it is
 * the reason that side could not move to TextKit 2. CodeMirror does it with
 * decorations, which is the same idea and less of a fight: a REPLACE
 * decoration puts a widget over a range of the document without touching
 * the document, and a MARK decoration styles it.
 *
 * The file is never rewritten. A tick writes one character (the box) through
 * the core's `toggleTodo`, exactly as it did before.
 */

import { RangeSetBuilder, type Extension } from "@codemirror/state"
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate,
} from "@codemirror/view"
import { headingLevel, toggleTodo, todoItem } from "@writemind/core"
import { applyEdit, notebook } from "./notebook"

/** A round bullet where the file has `- `. */
class BulletWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const dot = document.createElement("span")
    dot.className = "wm-bullet"
    dot.textContent = "•"
    return dot
  }
  override eq(): boolean { return true }
  override ignoreEvent(): boolean { return false }
}

/** The box of a task list, which is a button. */
class TodoWidget extends WidgetType {
  constructor(readonly done: boolean, readonly line: number) { super() }

  override eq(other: TodoWidget): boolean {
    return other.done === this.done && other.line === this.line
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("span")
    box.className = this.done ? "wm-todo wm-todo-done" : "wm-todo"
    box.textContent = this.done ? "✓" : ""
    box.setAttribute("role", "checkbox")
    box.setAttribute("aria-checked", this.done ? "true" : "false")
    box.onmousedown = (event) => {
      event.preventDefault()
      const text = view.state.doc.toString()
      const line = view.state.doc.line(this.line)
      const change = toggleTodo(text, { location: line.from, length: line.length }, 0)
      if (change) applyEdit(view, change)
    }
    return box
  }

  override ignoreEvent(): boolean { return false }
}

const HEADING_MARKS = [
  Decoration.line({ class: "wm-h1" }),
  Decoration.line({ class: "wm-h2" }),
  Decoration.line({ class: "wm-h3" }),
  Decoration.line({ class: "wm-h4" }),
  Decoration.line({ class: "wm-h5" }),
  Decoration.line({ class: "wm-h6" }),
]

const faded = Decoration.mark({ class: "wm-marker" })
const quoted = Decoration.line({ class: "wm-quote" })
const codeLine = Decoration.line({ class: "wm-code-line" })
const bulletMark = Decoration.replace({ widget: new BulletWidget() })

/** `**bold**`, `_italic_`, `` `code` ``, `~~struck~~`, `<u>under</u>`. */
const INLINE: { open: string; close: string; cls: string }[] = [
  { open: "**", close: "**", cls: "wm-bold" },
  { open: "~~", close: "~~", cls: "wm-strike" },
  { open: "`", close: "`", cls: "wm-code" },
  { open: "<u>", close: "</u>", cls: "wm-underline" },
  { open: "_", close: "_", cls: "wm-italic" },
]

interface Span { from: number; to: number; deco: ReturnType<typeof Decoration.mark> }

/** The inline runs on one line, marked and with their markers faded. */
function inlineSpans(text: string, offset: number, out: Span[]): void {
  for (const { open, close, cls } of INLINE) {
    let at = 0
    while (at < text.length) {
      const start = text.indexOf(open, at)
      if (start < 0) break
      const bodyStart = start + open.length
      const stop = text.indexOf(close, bodyStart)
      if (stop < 0) break
      if (stop === bodyStart) { at = bodyStart; continue }
      out.push({ from: offset + start, to: offset + bodyStart, deco: faded })
      out.push({
        from: offset + bodyStart, to: offset + stop,
        deco: Decoration.mark({ class: cls }),
      })
      out.push({ from: offset + stop, to: offset + stop + close.length, deco: faded })
      at = stop + close.length
    }
  }
}

function build(view: EditorView): DecorationSet {
  const spans: Span[] = []
  const lineDecos: { at: number; deco: ReturnType<typeof Decoration.line> }[] = []
  const { cells } = notebook(view.state)
  const doc = view.state.doc
  const caret = view.state.selection.main

  const insideFence = new Set<number>()
  for (const cell of cells) {
    if (cell.block.kind !== "code") continue
    const from = doc.lineAt(cell.range.location).number
    const to = doc.lineAt(Math.max(cell.range.location, cell.range.location + cell.range.length - 1)).number
    for (let line = from; line <= to; line++) insideFence.add(line)
  }

  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number)
    const text = line.text
    if (insideFence.has(number)) {
      lineDecos.push({ at: line.from, deco: codeLine })
      continue
    }

    const level = headingLevel(text)
    if (level > 0) {
      lineDecos.push({ at: line.from, deco: HEADING_MARKS[level - 1]! })
      const hashes = /^[ \t]*#+ ?/.exec(text)![0]
      spans.push({ from: line.from, to: line.from + hashes.length, deco: faded })
      inlineSpans(text.slice(hashes.length), line.from + hashes.length, spans)
      continue
    }

    const indent = /^[ \t]*/.exec(text)![0].length
    const rest = text.slice(indent)

    if (rest.startsWith(">")) {
      lineDecos.push({ at: line.from, deco: quoted })
      const marker = /^>\s?/.exec(rest)![0]
      spans.push({ from: line.from + indent, to: line.from + indent + marker.length, deco: faded })
      inlineSpans(rest.slice(marker.length), line.from + indent + marker.length, spans)
      continue
    }

    const task = todoItem(rest)
    if (task) {
      // The whole of `- [x] ` is one widget: the box, which is a button.
      const marker = /^[-*+] \[.\] ?/.exec(rest)![0]
      spans.push({
        from: line.from + indent,
        to: line.from + indent + marker.length,
        deco: Decoration.replace({ widget: new TodoWidget(task.done, number) }),
      })
      inlineSpans(rest.slice(marker.length), line.from + indent + marker.length, spans)
      continue
    }

    if (/^[-*+] /.test(rest)) {
      // The marker is drawn as a bullet — unless the caret is in it, where
      // the file has to be showing so it can be edited.
      const from = line.from + indent
      const to = from + 2
      const editing = caret.from <= to && caret.to >= from
      spans.push({ from, to, deco: editing ? faded : bulletMark })
      inlineSpans(rest.slice(2), to, spans)
      continue
    }

    inlineSpans(text, line.from, spans)
  }

  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.mark>>()
  const all = [
    ...lineDecos.map((line) => ({ from: line.at, to: line.at, deco: line.deco, line: true })),
    ...spans.map((span) => ({ ...span, line: false })),
  ].sort((a, b) => (a.from - b.from) || (Number(b.line) - Number(a.line)) || (a.to - b.to))
  for (const one of all) builder.add(one.from, one.to, one.deco)
  return builder.finish()
}

export const notebookDecorations: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = build(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: () => EditorView.atomicRanges.of((view) => {
      // A bullet drawn as one glyph is one glyph to the arrow keys too.
      const plugin = view.plugin(notebookDecorations as never) as { decorations: DecorationSet } | null
      return plugin?.decorations ?? Decoration.none
    }),
  },
)
