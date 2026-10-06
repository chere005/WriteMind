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
 *
 * PERFORMANCE. Only the lines in (and a margin around) the viewport are
 * decorated, the Decoration objects are shared rather than made per span, and
 * a selection that moves does not rebuild anything unless it changed whether
 * a bullet's marker is being edited. A 40 KB note used to cost eight
 * milliseconds a keystroke here.
 */

import { RangeSetBuilder, type ChangeDesc, type EditorState, type Extension, type Range as CMRange } from "@codemirror/state"
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate,
} from "@codemirror/view"
import {
  anchorSpans, codeTokens, escapeOffsets, firstCellFromBy, headingLevel, colouring, maskEscapes, toggleTodo, todoItem,
  type Block, type CodeToken, type CodeTokenKind, type MarkerStructure, type Range,
} from "@writemind/core"
import { applyEdit, hullOf, notebook } from "./notebook"
import { marksAway, renderedField } from "./rendered"
import { armedField } from "./seams"

/** A round bullet where the file has `- ` (or `+ `), a dash where it has `* ` — the Mac's `BulletGlyphs`. */
class BulletWidget extends WidgetType {
  constructor(readonly glyph: string) { super() }
  override toDOM(): HTMLElement {
    const dot = document.createElement("span")
    dot.className = "wm-bullet"
    dot.textContent = this.glyph
    return dot
  }
  override eq(other: BulletWidget): boolean { return other.glyph === this.glyph }
  override ignoreEvent(): boolean { return false }
}

/** The box of a task list, which is a button. Its line is found when it is pressed. */
class TodoWidget extends WidgetType {
  constructor(readonly done: boolean) { super() }

  override eq(other: TodoWidget): boolean { return other.done === this.done }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("span")
    box.className = this.done ? "wm-todo wm-todo-done" : "wm-todo"
    box.textContent = this.done ? "✓" : ""
    box.setAttribute("role", "checkbox")
    box.setAttribute("aria-checked", this.done ? "true" : "false")
    box.onmousedown = (event) => {
      event.preventDefault()
      const line = view.state.doc.lineAt(view.posAtDOM(box))
      const change = toggleTodo(view.state.doc.toString(),
        { location: line.from, length: line.length }, 0)
      if (!change) return
      // On the rendered page a tick is one character for one and the caret stays where it was typing (Mac 0fdd031:
      // a box and a caret share a row there); on the markdown side the caret goes to the box, as it always has.
      if (view.state.field(renderedField, false)) {
        view.dispatch({
          changes: { from: change.range.location, to: change.range.location + change.range.length, insert: change.replacement },
          userEvent: "input.preview.tick",
        })
      } else applyEdit(view, change)
    }
    return box
  }

  override ignoreEvent(): boolean { return false }
}

const HEADING_MARKS = [1, 2, 3, 4, 5, 6].map((n) => Decoration.line({ class: `wm-h${n}` }))
const faded = Decoration.mark({ class: "wm-marker" })
const quoted = Decoration.line({ class: "wm-quote" })
const codeLine = Decoration.line({ class: "wm-code-line", attributes: { spellcheck: "false" } })
const bulletMark = Decoration.replace({ widget: new BulletWidget("•") })
const dashMark = Decoration.replace({ widget: new BulletWidget("–") })
const todoMarks = {
  open: Decoration.replace({ widget: new TodoWidget(false) }),
  done: Decoration.replace({ widget: new TodoWidget(true) }),
}
const tokenMarks: Record<CodeTokenKind, Decoration> = {
  keyword: Decoration.mark({ class: "wm-tok-keyword" }),
  type: Decoration.mark({ class: "wm-tok-type" }),
  string: Decoration.mark({ class: "wm-tok-string" }),
  comment: Decoration.mark({ class: "wm-tok-comment" }),
  number: Decoration.mark({ class: "wm-tok-number" }),
  function: Decoration.mark({ class: "wm-tok-function" }),
  symbol: Decoration.mark({ class: "wm-tok-symbol" }),
}

const BOLD_MARK = Decoration.mark({ class: "wm-bold" })
const ITALIC_MARK = Decoration.mark({ class: "wm-italic" })
const STRIKE_MARK = Decoration.mark({ class: "wm-strike" })
const CODE_MARK = Decoration.mark({ class: "wm-code", attributes: { spellcheck: "false" } })
const UNDERLINE_MARK = Decoration.mark({ class: "wm-underline" })
const HIGHLIGHT_MARK = Decoration.mark({ class: "wm-highlight" })

/**
 * The inline patterns, exactly the Mac's (`MarkdownSourceStyle.Patterns`):
 * `*` or `_` for italic, `**` or `__` for bold. An opening mark must be
 * followed by a non-space and the closing one preceded by one, so `2 * 3 * 4`
 * and a stray `_` are not styles.
 */
const CODE_PAIR = /``[^\n]*?``/g
const CODE_SPAN = /`([^`\n]*)`/g
// (A deliberate step past the Mac: an underscore INSIDE a word — snake_case_name —
// is not an emphasis mark, as in CommonMark.)
const BOLD = /\*\*(?=\S)(?:.*?\S)\*\*|(?<![A-Za-z0-9])__(?=\S)(?:.*?\S)__(?![A-Za-z0-9])/g
const ITALIC = /\*(?=\S)(?:[^*_\n]*?[^\s*_])\*|(?<![A-Za-z0-9])_(?=\S)(?:[^*_\n]*?[^\s*_])_(?![A-Za-z0-9])/g
const STRIKE = /~~(?=\S)(?:[^~\n]*?\S)~~/g
const UNDERLINE = /<u>(.*?)<\/u>/g
// What `/link` writes round a highlighted run, and any other tag of the toolbar's own HTML.
const MARK_TAG = /<mark\b[^>]*>(.*?)<\/mark>/g
const ANY_TAG = /<\/?[A-Za-z][^>\n]*>/g

/**
 * `<span style="font-family: …; font-size: …; color: …">words</span>` — the
 * three declarations the T menu writes, and nothing else gets through: the
 * style is rebuilt from what was recognised rather than copied.
 */
const spanDecos = new Map<string, Decoration>()
export function safeSpanStyle(style: string): string {
  const out: string[] = []
  for (const part of style.split(";")) {
    const colon = part.indexOf(":")
    if (colon < 0) continue
    const name = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (name === "font-family" && /^[\w\s,'"-]+$/.test(value)) out.push(`font-family: ${value}`)
    else if (name === "font-size" && /^[\d.]+(px|pt|em|rem|%)$/.test(value)) out.push(`font-size: ${value}`)
    else if (name === "color" && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\))$/.test(value)) {
      out.push(`color: ${value}`)
    }
  }
  return out.join("; ")
}
const spanMark = (style: string): Decoration => {
  let found = spanDecos.get(style)
  if (!found) {
    found = Decoration.mark({ attributes: { style } })
    spanDecos.set(style, found)
  }
  return found
}
const SPAN = /<span style="([^"]*)">/g
const LINK = /\[([^\]\n]+)\]\(([^)\n]+)\)/g
const linkMark = Decoration.mark({ class: "wm-link" })
const hidden = Decoration.replace({})
/** A text cell's escape (docs/PLAN-text-cells.md): its backslash is not drawn, and the caret takes it with what it escapes. */
const escapeHidden = Decoration.replace({})

/** The colours of a code block, kept while the block is: an edit makes a new block, and the old one is let go. */
const tokenCache = new WeakMap<Block, CodeToken[]>()

interface Entry { from: number; to: number; deco: Decoration; kind: 0 | 1 | 2; atomic: boolean | "only" }
// kind: 0 = line decoration (sorts first at a position), 1 = mark/replace

function inlineSpans(source: string, offset: number, out: Entry[]): void {
  // Read with its escapes masked (core plainText.ts): an escaped star is a star, never a mark; offsets are the same.
  const text = maskEscapes(source)
  // What has been claimed already: a later pattern never styles inside it, which
  // is how a `**` in a code span stays a `**`, and a URL's underscores stay put.
  const covered = new Uint8Array(text.length)
  const free = (from: number, to: number): boolean => {
    for (let i = from; i < to; i++) if (covered[i]) return false
    return true
  }
  const cover = (from: number, to: number): void => { covered.fill(1, from, to) }
  const wrapped = (from: number, to: number, marker: number, close: number, deco: Decoration, claim = true) => {
    out.push({ from: offset + from, to: offset + from + marker, deco: faded, kind: 1, atomic: true })
    out.push({ from: offset + from + marker, to: offset + to - close, deco, kind: 1, atomic: false })
    out.push({ from: offset + to - close, to: offset + to, deco: faded, kind: 1, atomic: true })
    if (claim) cover(from, to)
  }

  if (text.includes("`")) {
    for (const [pattern, width] of [[CODE_PAIR, 2], [CODE_SPAN, 1]] as const) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text))) {
        const end = match.index + match[0].length
        if (end - match.index <= width * 2 || !free(match.index, end)) continue
        wrapped(match.index, end, width, width, CODE_MARK)
      }
    }
  }

  if (text.includes("](")) {
    LINK.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LINK.exec(text))) {
      const open = match.index
      if (!free(open, open + match[0].length)) continue
      const labelEnd = open + 1 + match[1]!.length
      out.push({ from: offset + open, to: offset + open + 1, deco: faded, kind: 1, atomic: true })
      out.push({ from: offset + open + 1, to: offset + labelEnd, deco: linkMark, kind: 1, atomic: false })
      out.push({
        from: offset + labelEnd, to: offset + open + match[0].length, deco: faded, kind: 1, atomic: true,
      })
      cover(open, open + match[0].length)
    }
  }

  if (text.includes("<span style=")) {
    SPAN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SPAN.exec(text))) {
      const bodyStart = match.index + match[0].length
      const stop = text.indexOf("</span>", bodyStart)
      if (stop < 0) break
      if (!free(match.index, bodyStart)) continue
      const style = safeSpanStyle(match[1]!)
      out.push({ from: offset + match.index, to: offset + bodyStart, deco: faded, kind: 1, atomic: true })
      if (style && stop > bodyStart) {
        out.push({ from: offset + bodyStart, to: offset + stop, deco: spanMark(style), kind: 1, atomic: false })
      }
      out.push({ from: offset + stop, to: offset + stop + 7, deco: faded, kind: 1, atomic: true })
      cover(match.index, bodyStart)
      cover(stop, stop + 7)
      SPAN.lastIndex = stop + 7
    }
  }

  if (text.includes("<u>")) {
    UNDERLINE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = UNDERLINE.exec(text))) {
      const end = match.index + match[0].length
      if (match[1]!.length === 0 || !free(match.index, match.index + 3) || !free(end - 4, end)) continue
      wrapped(match.index, end, 3, 4, UNDERLINE_MARK, false)
      cover(match.index, match.index + 3)
      cover(end - 4, end)
    }
  }

  if (text.includes("<mark")) {
    MARK_TAG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MARK_TAG.exec(text))) {
      const end = match.index + match[0].length
      const openEnd = match.index + match[0].indexOf(">") + 1
      const closeStart = end - 7
      if (!free(match.index, openEnd) || !free(closeStart, end)) continue
      out.push({ from: offset + match.index, to: offset + openEnd, deco: faded, kind: 1, atomic: true })
      if (closeStart > openEnd) {
        out.push({ from: offset + openEnd, to: offset + closeStart, deco: HIGHLIGHT_MARK, kind: 1, atomic: false })
      }
      out.push({ from: offset + closeStart, to: offset + end, deco: faded, kind: 1, atomic: true })
      cover(match.index, openEnd)
      cover(closeStart, end)
    }
  }

  if (text.includes("<")) {
    ANY_TAG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ANY_TAG.exec(text))) {
      const end = match.index + match[0].length
      if (!free(match.index, end)) continue
      out.push({ from: offset + match.index, to: offset + end, deco: faded, kind: 1, atomic: true })
      cover(match.index, end)
    }
  }

  if (text.includes("*") || text.includes("_")) {
    for (const [pattern, deco] of [[BOLD, BOLD_MARK], [ITALIC, ITALIC_MARK]] as const) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text))) {
        const marker = pattern === BOLD ? 2 : 1
        const end = match.index + match[0].length
        // `**` on its own is two markers round nothing — not a style.
        if (match[0].length <= marker * 2 || !free(match.index, end)) continue
        wrapped(match.index, end, marker, marker, deco)
      }
    }
  }

  if (text.includes("~~")) {
    STRIKE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = STRIKE.exec(text))) {
      const end = match.index + match[0].length
      if (match[0].length <= 4 || !free(match.index, end)) continue
      wrapped(match.index, end, 2, 2, STRIKE_MARK)
    }
  }
}

/**
 * A bar that is the cursor is in no line (Sean, 2026-10-05: "it shouldn't unrender ... until i'm actually in that
 * cell"): the caret parked against the cell below the bar opens none of its marks.
 */
const atTheBar = (state: EditorState): boolean => (state.field(armedField, false) ?? null) !== null

const touches = (state: EditorState, from: number, to: number): boolean =>
  !atTheBar(state) && state.selection.ranges.some((r) => r.from <= to && r.to >= from)

/** Whether a line is a bullet (not a task) and where its `- ` begins, or -1. */
const BULLET = /^([ \t]*)[-*+] /

/**
 * Which bullet markers the selection is inside, as a key: when it changes the
 * `- ` must be drawn as the file has it, and until it does the decorations
 * are exactly what they were.
 */
function touchedLines(state: EditorState): Set<number> {
  const out = new Set<number>()
  if (atTheBar(state)) return out
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = Math.min(state.doc.lineAt(r.to).number, first + 400)
    for (let n = first; n <= last; n++) out.add(n)
  }
  return out
}

function editingKey(state: EditorState): string {
  const doc = state.doc
  // On the rendered page a line's marks show while the selection is on it.
  let key = marksAway(state) ? `r:${[...touchedLines(state)].join(",")}|` : ""
  if (atTheBar(state)) return key + "bar"
  for (const r of state.selection.ranges) {
    const first = doc.lineAt(r.from)
    const last = doc.lineAt(r.to)
    let line = first
    for (let n = 0; n < 400; n++) {
      const found = BULLET.exec(line.text)
      if (found && !todoItem(line.text.slice(found[1]!.length))) {
        const from = line.from + found[1]!.length
        if (r.from <= from + 2 && r.to >= from) key += `${from},`
      }
      if (line.number >= last.number) break
      line = doc.line(line.number + 1)
    }
  }
  return key
}

/** The lines between `from` and `to`, decorated. */
function build(state: EditorState, from: number, to: number): { all: DecorationSet; atomic: DecorationSet } {
  const entries: Entry[] = []
  const doc = state.doc
  const cells = notebook(state).cells

  const startLine = doc.lineAt(Math.min(from, doc.length)).number
  const endLine = doc.lineAt(Math.min(to, doc.length)).number

  // Code cells that reach into the window, and which of ITS lines are fence (the lines of a long cell that are
  // far off the page are nobody's business). The cells are in order: search for the first, walk to the last.
  const fenceLines = new Set<number>()
  // Text cells' lines (plain words: no marks, the escapes' backslashes hidden) and markdown cells' marker lines (hidden
  // whole by textCells.ts), docs/PLAN-text-cells.md.
  const textLines = new Set<number>()
  const markerLines = new Set<number>()
  for (let i = Math.max(0, firstCellFromBy(cells, from, (cell) => cell.range) - 1); i < cells.length; i++) {
    const cell = cells[i]!
    if (cell.range.location > to) break
    if (cell.block.kind === "paragraph") {
      if (cell.range.location + cell.range.length < from) continue
      const first = doc.lineAt(cell.range.location).number
      if (cell.block.head) markerLines.add(first)
      if (!cell.block.markdown) {
        const last = doc.lineAt(cell.range.location + cell.range.length).number
        for (let n = Math.max(first, startLine); n <= Math.min(last, endLine); n++) textLines.add(n)
      }
      continue
    }
    if (cell.block.kind !== "code" || cell.range.location + cell.range.length < from) continue
    const first = doc.lineAt(cell.range.location)
    const last = doc.lineAt(Math.max(cell.range.location, cell.range.location + cell.range.length - 1))
    for (let n = Math.max(first.number, startLine); n <= Math.min(last.number, endLine); n++) fenceLines.add(n)
    // The colours: the body is everything after the opening fence's line. The tokens of a block are worked out
    // once (the block is the same object until it is edited) and only those on the page are decorated.
    if (last.number > first.number) {
      // An evaluation cell (`eval python`) is coloured for its language too (core/eval colouring).
      const language = colouring(cell.block.language)
      if (language && language !== "plain") {
        const bodyStart = first.to + 1
        let tokens = tokenCache.get(cell.block)
        if (!tokens) { tokens = codeTokens(cell.block.body, language); tokenCache.set(cell.block, tokens) }
        for (const token of tokens) {
          const tokenFrom = bodyStart + token.range.location
          const tokenTo = tokenFrom + token.range.length
          if (tokenTo < from) continue
          if (tokenFrom > to) break
          entries.push({ from: tokenFrom, to: tokenTo, deco: tokenMarks[token.kind], kind: 1, atomic: false })
        }
      }
    }
  }

  for (let number = startLine; number <= endLine; number++) {
    const line = doc.line(number)
    const text = line.text
    if (fenceLines.has(number)) {
      entries.push({ from: line.from, to: line.from, deco: codeLine, kind: 0, atomic: false })
      continue
    }
    if (markerLines.has(number)) continue
    if (textLines.has(number)) {
      for (const at of escapeOffsets(text)) {
        entries.push({ from: line.from + at, to: line.from + at + 1, deco: escapeHidden, kind: 1, atomic: false })
        entries.push({ from: line.from + at, to: line.from + at + 2, deco: escapeHidden, kind: 1, atomic: "only" })
      }
      // Link Here's id anchors (where links from other notes land) are not drawn either, and the caret steps over them.
      for (const [start, stop] of anchorSpans(text)) {
        entries.push({ from: line.from + start, to: line.from + stop, deco: escapeHidden, kind: 1, atomic: true })
      }
      continue
    }

    const level = headingLevel(text)
    if (level > 0) {
      entries.push({ from: line.from, to: line.from, deco: HEADING_MARKS[level - 1]!, kind: 0, atomic: false })
      const hashes = /^[ \t]*#+ ?/.exec(text)![0]
      // On the rendered page the hashes are FURNITURE (Mac 0fdd031): put away even on the caret's line.
      const furniture = state.field(renderedField, false)
      entries.push({ from: line.from, to: line.from + hashes.length, deco: furniture ? hidden : faded, kind: 1, atomic: true })
      inlineSpans(text.slice(hashes.length), line.from + hashes.length, entries)
      continue
    }

    if (text.length === 0) continue
    const indent = /^[ \t]*/.exec(text)![0].length
    const rest = text.slice(indent)

    if (rest.startsWith(">")) {
      entries.push({ from: line.from, to: line.from, deco: quoted, kind: 0, atomic: false })
      const marker = /^>\s?/.exec(rest)![0]
      entries.push({ from: line.from + indent, to: line.from + indent + marker.length, deco: faded, kind: 1, atomic: true })
      inlineSpans(rest.slice(marker.length), line.from + indent + marker.length, entries)
      continue
    }

    const task = todoItem(rest)
    if (task) {
      // The whole of `- [x] ` is one widget: the box, which is a button.
      const marker = /^[-*+] \[.\] ?/.exec(rest)![0]
      entries.push({
        from: line.from + indent, to: line.from + indent + marker.length,
        deco: task.done ? todoMarks.done : todoMarks.open, kind: 1, atomic: true,
      })
      inlineSpans(rest.slice(marker.length), line.from + indent + marker.length, entries)
      continue
    }

    if (/^[-*+] /.test(rest)) {
      // The marker is drawn as a bullet — unless the caret is in it, where
      // the file has to be showing so it can be edited.
      const at = line.from + indent
      entries.push({
        // (On the rendered page it is furniture, and drawn even there: preview/furniture.ts keeps the caret out.)
        from: at, to: at + 2, kind: 1, atomic: true,
        deco: touches(state, at, at + 2) && !state.field(renderedField, false) ? faded : rest[0] === "*" ? dashMark : bulletMark,
      })
      inlineSpans(rest.slice(2), at + 2, entries)
      continue
    }

    inlineSpans(text, line.from, entries)
  }

  // The rendered page: the marks are put away, except on the lines the
  // selection is in, where the source shows so it can be edited.
  if (marksAway(state)) {
    const touched = touchedLines(state)
    for (const entry of entries) {
      if (entry.deco === faded && !touched.has(doc.lineAt(entry.from).number)) entry.deco = hidden
    }
  }

  entries.sort((a, b) => (a.from - b.from) || (a.kind - b.kind) || (a.to - b.to))
  const all = new RangeSetBuilder<Decoration>()
  const atomic = new RangeSetBuilder<Decoration>()
  for (const e of entries) {
    if (e.atomic !== "only") all.add(e.from, e.to, e.deco)
    if (e.atomic) atomic.add(e.from, e.to, e.deco)
  }
  return { all: all.finish(), atomic: atomic.finish() }
}

/** How much beyond the viewport is decorated, so a scroll rarely rebuilds. */
const MARGIN_LINES = 30

/**
 * Whether the page (the view's visible ranges) and the lines of an edit are still inside the window that was decorated.
 * Only the window is in the OLD document's positions and goes through the change; the visible ranges and the lines
 * of the edit are already in the new document's. (A plugin is updated after the view has been, so mapping the visible
 * ranges as well threw `Position N is out of range for changeset of length M` whenever the page reached the end of a
 * document that had just grown: the first character of a new note, a keystroke at the end of a short one, a
 * `setDoc`. CodeMirror took the plugin down for that view, and headings, bullets and bold stayed raw markdown until
 * the note was reopened.)
 */
export function windowHoldsPage(
  changes: ChangeDesc, decorated: { from: number; to: number },
  visible: readonly { from: number; to: number }[], region: { from: number; to: number },
): { holds: boolean; from: number; to: number } {
  const from = changes.mapPos(decorated.from, -1)
  const to = changes.mapPos(decorated.to, 1)
  const visibleFrom = visible.length ? visible[0]!.from : 0
  const visibleTo = visible.length ? visible[visible.length - 1]!.to : 0
  const holds = !(visibleFrom < from || visibleTo > to || region.from < from || region.to > to)
  return { holds, from, to }
}

class Decorator {
  decorations: DecorationSet = Decoration.none
  atomic: DecorationSet = Decoration.none
  private from = 0
  private to = -1
  private editing = ""

  constructor(view: EditorView) { this.rebuild(view) }

  private window(view: EditorView): { from: number; to: number; visibleFrom: number; visibleTo: number } {
    const doc = view.state.doc
    const ranges = view.visibleRanges
    const visibleFrom = ranges.length ? ranges[0]!.from : 0
    const visibleTo = ranges.length ? ranges[ranges.length - 1]!.to : 0
    const a = Math.max(1, doc.lineAt(Math.min(visibleFrom, doc.length)).number - MARGIN_LINES)
    const b = Math.min(doc.lines, doc.lineAt(Math.min(visibleTo, doc.length)).number + MARGIN_LINES)
    return { from: doc.line(a).from, to: doc.line(b).to, visibleFrom, visibleTo }
  }

  rebuild(view: EditorView): void {
    const w = this.window(view)
    const built = build(view.state, w.from, w.to)
    this.decorations = built.all
    this.atomic = built.atomic
    this.from = w.from
    this.to = w.to
    this.editing = editingKey(view.state)
  }

  /**
   * A keystroke re-decorates the lines it changed and nothing else: the decorations are mapped through the change
   * and the lines of the change are built again (every decoration but a code block's is a function of its own line,
   * the selection's key and the rendered/markers switch). Returns false when that is not safe — the edit touches a
   * code block or a line with a fence in it (what is code depends on fences far below the edit), or the window
   * would no longer hold the page — and the whole window is built again.
   */
  private patch(update: ViewUpdate): boolean {
    const { state, startState, changes } = update
    if (marksAway(state) !== marksAway(startState)
      || state.field(renderedField, false) !== startState.field(renderedField, false)) return false
    const hull = hullOf(changes)
    const doc = state.doc
    let regionFrom = doc.lineAt(Math.min(hull.from, doc.length)).from
    let regionTo = doc.lineAt(Math.min(hull.toNew, doc.length)).to
    // A paragraph is decorated as a whole: whether it is a text cell or a markdown cell is the cell's, not the line's
    // (a marker put on top of it changes every line of it).
    {
      const cells = notebook(state).cells
      for (let i = Math.max(0, firstCellFromBy(cells, regionFrom, (cell) => cell.range) - 1); i < cells.length; i++) {
        const cell = cells[i]!
        if (cell.range.location > regionTo + 1) break
        if (cell.block.kind !== "paragraph" || cell.range.location + cell.range.length < regionFrom - 1) continue
        regionFrom = Math.min(regionFrom, doc.lineAt(cell.range.location).from)
        regionTo = Math.max(regionTo, doc.lineAt(cell.range.location + cell.range.length).to)
      }
    }
    // The page must still be inside what is decorated (positions as they are now, after the change).
    const page = windowHoldsPage(changes, { from: this.from, to: this.to }, update.view.visibleRanges, { from: regionFrom, to: regionTo })
    if (!page.holds) return false
    // A fence in the lines before or after the change: what is code depends on it, far below the edit.
    const was = startState.doc
    const wasTo = was.lineAt(Math.min(hull.toOld, was.length)).to
    if (state.sliceDoc(regionFrom, regionTo).includes("```") || startState.sliceDoc(regionFrom, wasTo).includes("```")) return false
    // Lines of a code block are decorated as code, from the whole block.
    const cells = notebook(state).cells
    for (let i = Math.max(0, firstCellFromBy(cells, regionFrom, (cell) => cell.range) - 1); i < cells.length; i++) {
      const cell = cells[i]!
      if (cell.range.location > regionTo + 1) break
      if (cell.block.kind === "code" && cell.range.location + cell.range.length >= regionFrom - 1) return false
    }
    // The bullets whose markers are being edited: when that changes, more than these lines changes.
    const key = editingKey(state)
    if (key !== this.editing) return false

    const built = build(state, regionFrom, regionTo)
    const patched = (set: DecorationSet, fresh: DecorationSet): DecorationSet => {
      const add: CMRange<Decoration>[] = []
      for (const cursor = fresh.iter(); cursor.value; cursor.next()) add.push(cursor.value.range(cursor.from, cursor.to))
      return set.map(changes).update({ filter: () => false, filterFrom: regionFrom, filterTo: regionTo, add })
    }
    this.decorations = patched(this.decorations, built.all)
    this.atomic = patched(this.atomic, built.atomic)
    this.from = page.from
    this.to = page.to
    return true
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      if (!this.patch(update)) this.rebuild(update.view)
      return
    }
    // (The rendered page draws a line's furniture differently, so switching it is a rebuild even when the marks were away.)
    if (marksAway(update.state) !== marksAway(update.startState)
      || update.state.field(renderedField, false) !== update.startState.field(renderedField, false)) {
      this.rebuild(update.view)
      return
    }
    if (update.viewportChanged) {
      const { visibleFrom, visibleTo } = this.window(update.view)
      if (visibleFrom < this.from || visibleTo > this.to) { this.rebuild(update.view); return }
    }
    if (update.selectionSet || atTheBar(update.state) !== atTheBar(update.startState)) {
      const key = editingKey(update.state)
      if (key !== this.editing) this.rebuild(update.view)
    }
  }
}

export const notebookDecorations: Extension = ViewPlugin.fromClass(Decorator, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
})

/**
 * The markers on the lines from `from` to `to`, and which of them are the two halves of
 * a bold / italic / strike / code run — what deleting over hidden markers needs
 * (`MarkerDeletion`). It is read off the very decorations the lines are drawn with, so a
 * marker the page hides is a marker a delete takes whole, and the editor's own
 * reading of `snake_case_name` (not an emphasis) is the one that counts.
 */
export function markerStructureAround(state: EditorState, from: number, to: number): MarkerStructure {
  const start = state.doc.lineAt(from).from
  const stop = state.doc.lineAt(Math.min(to, state.doc.length)).to
  const { all } = build(state, start, stop)
  const markers: Range[] = []
  const styled: Range[] = []
  for (const cursor = all.iter(); cursor.value; cursor.next()) {
    const length = cursor.to - cursor.from
    if (length <= 0) continue
    const value = cursor.value
    if (value === faded || value === hidden) markers.push({ location: cursor.from, length })
    else if (value === BOLD_MARK || value === ITALIC_MARK || value === STRIKE_MARK || value === CODE_MARK) {
      styled.push({ location: cursor.from, length })
    }
  }
  const pairs: MarkerStructure["pairs"] = []
  for (const run of styled) {
    const open = markers.find((marker) => marker.location + marker.length === run.location)
    const close = markers.find((marker) => marker.location === run.location + run.length)
    if (open && close) pairs.push({ open, close })
  }
  return { markers, pairs }
}
