/**
 * A block of the note, drawn: the Mac's `MarkdownPreview.BlockView` as DOM.
 *
 * Headings are headings, lists have real bullets and a box that is a control,
 * a quote has its bar, code is coloured for its language, maths is typeset, a
 * picture is a picture and a link goes where it says. None of it is ever read
 * back: the file is the markdown, and this is only what that markdown looks
 * like. Every run of drawn text carries `data-s`, the offset in the block's
 * source of the first character it shows, so a click on a word becomes a caret
 * in that word when the block opens (`caretAt`).
 */

import {
  bulletItem, codeTokens, dashItem, drawnRows, emptyLineSpan, lineBreakSpan, fenceLanguage, hiddenInText, fenced, inlineSegments, isMathFence,
  colouring, emptyItem, isMarkdownMarker, itemNumbers, listStyleOfLine, numberedItem, todoItem,
  type Block, type InlineSegment,
} from "@writemind/core"
import { safeSpanStyle } from "../decorations"
import { mathElement } from "../math"
import { pictureCellDom, pictureHeightEstimate, pictureSource } from "../pictureDom"

export { pictureSource }

export interface RenderContext {
  /** Something drawn changed size after it was drawn — a picture arrived. */
  remeasure(): void
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: Node): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  parent?.appendChild(node)
  return node
}

/** A run of the note's own words, drawn in whatever the markdown made it. */
function inline(parent: HTMLElement, fragment: string, base: number, context: RenderContext): void {
  for (const segment of inlineSegments(fragment)) parent.appendChild(segmentNode(segment, base, context))
}

function segmentNode(segment: InlineSegment, base: number, context: RenderContext): Node {
  const at = String(base + segment.from)
  if (segment.image) {
    const holder = make("span", "wm-pv-pic")
    holder.dataset.at = at
    const picture = make("img", undefined, holder)
    picture.alt = segment.image.alt
    picture.src = pictureSource(segment.image.src)
    picture.draggable = false
    picture.addEventListener("load", () => context.remeasure())
    picture.addEventListener("error", () => {
      // A picture that will not load is its alt words, not a broken icon.
      holder.textContent = segment.image!.alt || segment.image!.src
      holder.classList.add("wm-pv-pic-missing")
      context.remeasure()
    })
    return holder
  }
  if (segment.math !== undefined) {
    const maths = mathElement(segment.math, { display: "inline" })
    if (maths) {
      maths.classList.add("wm-math-inline")
      maths.dataset.at = at
      return maths
    }
    const failed = make("code", "wm-pv-code-inline")
    failed.dataset.at = at
    failed.textContent = "wl:" + segment.math
    return failed
  }
  const text = make("span", "wm-pv-t")
  text.dataset.s = at
  text.textContent = segment.text
  let node: HTMLElement = text
  const wrap = (tag: keyof HTMLElementTagNameMap, className?: string): HTMLElement => {
    const outer = make(tag, className)
    outer.appendChild(node)
    node = outer
    return outer
  }
  if (segment.code) wrap("code", "wm-pv-code-inline")
  if (segment.bold) wrap("strong")
  if (segment.italic) wrap("em")
  if (segment.strike) wrap("s")
  if (segment.underline) wrap("u")
  if (segment.highlight) wrap("mark", "wm-pv-mark-hl")
  if (segment.spanStyle) {
    const style = safeSpanStyle(segment.spanStyle)
    if (style) wrap("span").style.cssText = style
  }
  if (segment.href !== undefined) {
    const link = wrap("a", "wm-pv-link")
    link.dataset.href = segment.href
    link.title = segment.href
  }
  return node
}

interface Line { text: string; start: number }

/** The block's lines with where each begins in its source. */
function linesOf(source: string): Line[] {
  const out: Line[] = []
  let start = 0
  for (const text of source.split("\n")) {
    out.push({ text, start })
    start += text.length + 1
  }
  return out
}

const leading = (text: string): number => text.length - text.trimStart().length

/**
 * AN EMPTY LINE A CELL KEEPS (`<br>`, core emptyLine.ts; Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the
 * current cell.."), drawn: a line with nothing on it that still holds its height (a zero-width space: a line break alone at
 * the end of a block draws no line), and a click on it is a caret at the end of its line — after the `<br>`, where the
 * caret stands on such a line (editor emptyLines.ts).
 */
function emptyLine(parent: HTMLElement, at: number): void {
  const line = make("span", "wm-pv-t wm-pv-empty", parent)
  line.dataset.at = String(at)
  line.textContent = "\u200b"
}

// MARK: - Kinds

function headingBlock(source: string, context: RenderContext): HTMLElement {
  const lead = leading(source)
  let hashes = 0
  while (source[lead + hashes] === "#") hashes++
  let textStart = lead + hashes
  while (source[textStart] === " " || source[textStart] === "\t") textStart++
  const level = Math.min(Math.max(hashes, 1), 6)
  const holder = make("div", `wm-pv wm-pv-heading wm-pv-h${level}`)
  inline(holder, source.slice(textStart).replace(/\s+$/, ""), textStart, context)
  return holder
}

/**
 * A TEXT cell (docs/PLAN-text-cells.md): its lines as typed, every line break kept, nothing drawn as formatting, the
 * escape rule's backslashes not drawn. Each run starts after an escape, so a click still finds its offset.
 */
function textBlock(source: string): HTMLElement {
  const holder = make("div", "wm-pv wm-pv-p wm-pv-text")
  linesOf(source).forEach((line, index) => {
    if (index > 0) holder.appendChild(document.createElement("br"))
    // (An empty line the cell keeps: nothing of it is drawn but the line.)
    if (emptyLineSpan(line.text)) { emptyLine(holder, line.start + line.text.length); return }
    let from = 0
    const run = (to: number) => {
      if (to <= from) return
      const piece = make("span", "wm-pv-t", holder)
      piece.dataset.s = String(line.start + from)
      piece.textContent = line.text.slice(from, to)
    }
    // (Each escape's backslash, and Link Here's id anchors, are not drawn.)
    for (const [start, stop] of hiddenInText(line.text)) {
      run(start)
      from = stop
    }
    run(line.text.length)
    // An empty line still holds its place (a caret put there lands on it).
    if (line.text.length === 0) {
      const empty = make("span", "wm-pv-t", holder)
      empty.dataset.s = String(line.start)
    }
  })
  return holder
}

function paragraphBlock(block: Extract<Block, { kind: "paragraph" }>, source: string, context: RenderContext): HTMLElement {
  if (!block.markdown) return textBlock(source)
  const holder = make("div", "wm-pv wm-pv-p")
  // (A markdown cell's marker line is not drawn: it is what makes the cell one.)
  const lines = linesOf(source).filter((line) => line.text.trim().length > 0 && !isMarkdownMarker(line.text))
  // Its lines join as markdown joins them, with a space; an empty line it keeps is an empty line.
  let words = false
  lines.forEach((line, index) => {
    const kept = emptyLineSpan(line.text)
    if (kept) {
      if (index > 0) holder.appendChild(document.createElement("br"))
      emptyLine(holder, line.start + line.text.length)
      words = false
      return
    }
    // A line that starts afresh (`<br>` at its head: Ctrl+Enter in a markdown cell, the review of agent/ctrlenter P1): a
    // line break, never the space a soft one is, and its words without the tag.
    const broken = lineBreakSpan(line.text)
    if (broken) {
      if (index > 0) holder.appendChild(document.createElement("br"))
      const rest = line.text.slice(broken[1])
      inline(holder, rest.trim(), line.start + broken[1] + leading(rest), context)
      words = true
      return
    }
    if (index > 0) holder.appendChild(words ? document.createTextNode(" ") : document.createElement("br"))
    // The first line keeps the spaces it was written with, so an indented
    // paragraph is drawn indented.
    const lead = leading(line.text)
    if (index === 0 && lead > 0) holder.appendChild(document.createTextNode(line.text.slice(0, lead)))
    inline(holder, line.text.trim(), line.start + lead, context)
    words = true
  })
  return holder
}

function quoteBlock(source: string, context: RenderContext): HTMLElement {
  const holder = make("div", "wm-pv wm-pv-quote")
  const body = make("div", "wm-pv-quote-text", holder)
  const lines = linesOf(source).filter((line) => line.text.trim().length > 0)
  // Its lines join as markdown joins them, with a space; a quote line with nothing on it is an empty line, and one that starts
  // with `<br>` starts afresh (Ctrl+Enter writes both: Sean, 2026-10-11, "ctrl + enter adds a newline without leaving the
  // current cell..").
  let words = false
  lines.forEach((line, index) => {
    const lead = leading(line.text)
    let at = lead
    if (line.text[at] === ">") at++
    while (line.text[at] === " " || line.text[at] === "\t") at++
    const text = line.text.slice(at).replace(/\s+$/, "")
    if (text.length === 0 || emptyLineSpan(text)) {
      if (index > 0) body.appendChild(document.createElement("br"))
      emptyLine(body, line.start + line.text.length)
      words = false
      return
    }
    // A quote line that starts afresh (`<br>` at its head, Ctrl+Enter): a line break, and its words without the tag.
    const broken = lineBreakSpan(text)
    if (broken) {
      if (index > 0) body.appendChild(document.createElement("br"))
      const rest = text.slice(broken[1])
      inline(body, rest.trim(), line.start + at + broken[1] + leading(rest), context)
      words = true
      return
    }
    if (index > 0) body.appendChild(words ? document.createTextNode(" ") : document.createElement("br"))
    inline(body, text, line.start + at, context)
    words = true
  })
  return holder
}

/** How far in a list line is: a nested item steps in one level for each four columns. */
const depthOf = (indent: string): number => {
  const columns = [...indent].reduce((sum, ch) => sum + (ch === "\t" ? 4 : 1), 0)
  return Math.ceil(columns / 4)
}

function listBlock(source: string, context: RenderContext): HTMLElement {
  const holder = make("div", "wm-pv wm-pv-list")
  const lines = linesOf(source).filter((line) => line.text.trim().length > 0)
  // Which lines are an item's NEXT lines (core parser: an indented line, or an empty line kept, under an item is that item's —
  // Sean, 2026-10-11, "ctrl + enter adds a newline without leaving the current cell.."): they go on in the words of the item
  // drawn last.
  const nextLine = lines.map((line, index) => index > 0 && listStyleOfLine(line.text) === null
    && (leading(line.text) > 0 || !!emptyLineSpan(line.text)))
  // Each run of numbered items counts from one (core `itemNumbers`): an item of another kind between two numbered ones
  // starts the count again, so the number drawn is the one the open cell shows (Sean, 2026-10-11, a list is one cell).
  const numbers = itemNumbers(lines.filter((_, index) => !nextLine[index]).map((line) => listStyleOfLine(line.text)))
  let items = 0
  let boxes = 0
  let lastWords: HTMLElement | null = null
  for (const [index, line] of lines.entries()) {
    const trimmed = line.text.trim()
    const lead = leading(line.text)
    if (nextLine[index] && lastWords) {
      lastWords.appendChild(document.createElement("br"))
      if (emptyLineSpan(line.text)) emptyLine(lastWords, line.start + line.text.length)
      else inline(lastWords, trimmed, line.start + lead, context)
      continue
    }
    const number = numbers[items++]
    const item = make("div", "wm-pv-li", holder)
    const depth = depthOf(line.text.slice(0, lead))
    if (depth > 0) item.style.paddingLeft = `${8 + depth * 18}px`

    const todo = todoItem(trimmed)
    let marker = ""
    let words = ""
    let textAt = lead
    let done = false
    let box = false
    if (todo) {
      box = true
      done = todo.done
      words = todo.text
      textAt = lead + 5 + (trimmed.slice(5).startsWith(" ") ? 1 : 0)
    } else {
      // (A marker alone is an item with no words yet, core `emptyItem` (Sean, 2026-10-11): its bullet is drawn, not a `-`.)
      const empty = emptyItem(trimmed)
      const bullet = bulletItem(trimmed) ?? (empty === "bullets" ? "" : null)
      const dash = bullet === null ? dashItem(trimmed) ?? (empty === "dashes" ? "" : null) : null
      const numbered = bullet === null && dash === null ? numberedItem(trimmed) ?? (empty === "numbered" ? "" : null) : null
      if (bullet !== null) { marker = "•"; words = bullet; textAt = Math.min(lead + 2, line.text.length) }
      else if (dash !== null) { marker = "–"; words = dash; textAt = Math.min(lead + 2, line.text.length) }
      else if (numbered !== null) {
        marker = `${number}.`
        words = numbered
        const digits = /^[0-9]+/.exec(trimmed)![0].length
        textAt = Math.min(lead + digits + 2, line.text.length)
      } else {
        words = trimmed
      }
    }
    const mark = make("span", box ? "wm-pv-box" : "wm-pv-mark", item)
    mark.dataset.at = String(line.start + textAt)
    if (box) {
      mark.dataset.todo = String(boxes++)
      mark.classList.toggle("wm-pv-box-done", done)
      mark.setAttribute("role", "checkbox")
      mark.setAttribute("aria-checked", done ? "true" : "false")
      mark.title = done ? "Done — click to undo it" : "Click when it is done"
      mark.textContent = done ? "✓" : ""
    } else {
      mark.textContent = marker
    }
    const text = make("span", done ? "wm-pv-li-text wm-pv-done" : "wm-pv-li-text", item)
    // (An item whose first line is kept empty: the line, and nothing on it.)
    if (emptyLineSpan(line.text)) emptyLine(text, line.start + line.text.length)
    else inline(text, words.replace(/\s+$/, ""), line.start + textAt, context)
    lastWords = text
  }
  return holder
}

function codeBlock(source: string, context: RenderContext): HTMLElement {
  const parts = fenced(source)
  const language = parts ? fenceLanguage(parts.open) : ""
  const body = parts ? parts.body : source
  const bodyStart = parts ? parts.open.length + 1 : 0

  if (parts && isMathFence(language)) {
    const expression = body.split("\n").join(" ").trim()
    const maths = expression === "" ? null : mathElement(expression, { display: "block" })
    if (maths) {
      const holder = make("div", "wm-pv wm-pv-mathblock wm-math-block")
      maths.dataset.at = String(bodyStart)
      holder.appendChild(maths)
      return holder
    }
  }

  const holder = make("div", "wm-pv wm-pv-code")
  const pre = make("pre", undefined, holder)
  const known = colouring(language)
  const tokens = known && known !== "plain" ? codeTokens(body, known) : []
  let at = 0
  const plain = (to: number) => {
    if (to <= at) return
    const piece = make("span", "wm-pv-t", pre)
    piece.dataset.s = String(bodyStart + at)
    piece.textContent = body.slice(at, to)
    at = to
  }
  for (const token of tokens) {
    plain(token.range.location)
    const piece = make("span", `wm-pv-t wm-tok-${token.kind}`, pre)
    piece.dataset.s = String(bodyStart + token.range.location)
    piece.textContent = body.slice(token.range.location, token.range.location + token.range.length)
    at = token.range.location + token.range.length
  }
  plain(body.length)
  if (body.length === 0) pre.dataset.at = String(bodyStart)
  void context
  return holder
}

/**
 * A table, as a real one: the header in bold over a rule, the body rows under it, each column aligned the way its
 * delimiter cell says, every cell's words inline markdown. Each cell's words carry their place in the table's source,
 * so a click in a cell opens the table with the caret on that word (an empty cell: where its words would go).
 */
function tableBlock(block: Extract<Block, { kind: "table" }>, source: string, context: RenderContext): HTMLElement {
  const holder = make("div", "wm-pv wm-pv-table")
  const table = make("table", undefined, holder)
  const width = block.header.length
  drawnRows(source, width).forEach((cells, index) => {
    const section = index === 0 ? make("thead", undefined, table) : (table.tBodies[0] ?? make("tbody", undefined, table))
    const row = make("tr", undefined, section)
    cells.forEach((cell, column) => {
      const box = make(index === 0 ? "th" : "td", undefined, row)
      const align = block.align[column]
      if (align) box.style.textAlign = align
      if (cell.source.length === 0) box.dataset.at = String(cell.at)
      else inline(box, cell.source, cell.at, context)
    })
  })
  return holder
}

function ruleBlock(): HTMLElement {
  const holder = make("div", "wm-pv wm-pv-rule")
  make("hr", undefined, holder)
  return holder
}

/** The block drawn. `blank` cells are not drawn: they are the empty lines they are. */
export function renderBlock(block: Block, source: string, context: RenderContext): HTMLElement {
  switch (block.kind) {
    case "heading": return headingBlock(source, context)
    case "paragraph": return paragraphBlock(block, source, context)
    case "quote": return quoteBlock(source, context)
    // (A list that mixes kinds is one cell, each line drawn as its own kind: Sean, 2026-10-11.)
    case "bullets": case "dashes": case "todos": case "numbered": case "mixed": return listBlock(source, context)
    case "code": return codeBlock(source, context)
    case "rule": return ruleBlock()
    case "blank": return make("div", "wm-pv wm-pv-blank")
    // A picture or ink cell: on the page it is `pictureCells`' widget (the page skips it); this is the same picture,
    // for anyone else drawing a block (an ink cell here is its snapshot).
    case "picture": return pictureCellDom(block, () => context.remeasure())
    case "table": return tableBlock(block, source, context)
  }
}

/** A rough height for a block that is not on the screen yet, so the scroll bar is about right. */
export function estimatedHeight(block: Block, source: string): number {
  const lines = source.split("\n").length
  switch (block.kind) {
    // (The rendered ladder, 28/22/18/16/15/17, at its line heights.)
    case "heading": return ({ 1: 34, 2: 28, 3: 26, 4: 23, 5: 22, 6: 25 } as Record<number, number>)[block.level] ?? 24
    case "paragraph": return block.markdown ? Math.max(1, Math.ceil(source.length / 85)) * 22
      : source.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 85)) * 22, 0)
    case "quote": return Math.max(1, Math.ceil(source.length / 80)) * 22
    case "bullets": case "dashes": case "todos": case "numbered": case "mixed": return lines * 22
    // Its lines at the code size, and half that size of padding top and bottom (Mac e66379c).
    case "code": return Math.max(1, lines - 2) * 20.6 + 14
    case "rule": return 9
    case "blank": return lines * 22
    case "picture": return pictureHeightEstimate(block.path)
    // A row is a line of body text, its padding and its rule (`.wm-pv-table td`); the delimiter row is not drawn.
    case "table": return (block.rows.length + 1) * 31 + 2
  }
}

// MARK: - A click on drawn words, as a place in the block's markdown

/**
 * Where a click landed, as an offset in the block's source. The drawn text
 * knows where it came from: each run says the offset of its first character,
 * and the browser says how far into the run the point is.
 */
export function caretAt(dom: HTMLElement, x: number, y: number, sourceLength: number): number {
  const doc = dom.ownerDocument
  const hit = (doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  })
  let node: Node | null = null
  let offset = 0
  const position = hit.caretPositionFromPoint?.(x, y)
  if (position) { node = position.offsetNode; offset = position.offset }
  else {
    const found = hit.caretRangeFromPoint?.(x, y)
    if (found) { node = found.startContainer; offset = found.startOffset }
  }
  if (node && dom.contains(node)) {
    // Text: the run it is in, and how far in.
    const run = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))
      ?.closest<HTMLElement>("[data-s], [data-at]")
    if (run && dom.contains(run)) {
      if (run.dataset.s !== undefined && node.nodeType === Node.TEXT_NODE) {
        return Math.min(Number(run.dataset.s) + offset, sourceLength)
      }
      if (run.dataset.at !== undefined) return Math.min(Number(run.dataset.at), sourceLength)
      if (run.dataset.s !== undefined) return Math.min(Number(run.dataset.s), sourceLength)
    }
  }
  // Not on a word: the run nearest the point on its line, before it or after it.
  const runs = Array.from(dom.querySelectorAll<HTMLElement>("[data-s], [data-at]"))
  let best: { run: HTMLElement; distance: number; after: boolean } | null = null
  for (const run of runs) {
    for (const rect of Array.from(run.getClientRects())) {
      const vertical = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      const horizontal = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
      const distance = vertical * 4 + horizontal
      if (!best || distance < best.distance) best = { run, distance, after: x > (rect.left + rect.right) / 2 }
    }
  }
  if (best) {
    const run = best.run
    const length = run.dataset.s !== undefined ? (run.textContent ?? "").length : 0
    const start = Number(run.dataset.s ?? run.dataset.at)
    return Math.min(best.after ? start + length : start, sourceLength)
  }
  return sourceLength
}
