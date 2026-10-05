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
  bulletItem, codeTokens, dashItem, drawnRows, fenceLanguage, fenced, inlineSegments, isMathFence, colouring,
  numberedItem, todoItem,
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

function paragraphBlock(source: string, context: RenderContext): HTMLElement {
  const holder = make("div", "wm-pv wm-pv-p")
  const lines = linesOf(source).filter((line) => line.text.trim().length > 0)
  lines.forEach((line, index) => {
    if (index > 0) holder.appendChild(document.createTextNode(" "))
    // The first line keeps the spaces it was written with, so an indented
    // paragraph is drawn indented.
    const lead = leading(line.text)
    if (index === 0 && lead > 0) holder.appendChild(document.createTextNode(line.text.slice(0, lead)))
    inline(holder, line.text.trim(), line.start + lead, context)
  })
  return holder
}

function quoteBlock(source: string, context: RenderContext): HTMLElement {
  const holder = make("div", "wm-pv wm-pv-quote")
  const body = make("div", "wm-pv-quote-text", holder)
  const lines = linesOf(source).filter((line) => line.text.trim().length > 0)
  lines.forEach((line, index) => {
    if (index > 0) body.appendChild(document.createTextNode(" "))
    const lead = leading(line.text)
    let at = lead
    if (line.text[at] === ">") at++
    while (line.text[at] === " " || line.text[at] === "\t") at++
    inline(body, line.text.slice(at).replace(/\s+$/, ""), line.start + at, context)
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
  let counted = 0
  let boxes = 0
  for (const line of linesOf(source)) {
    const trimmed = line.text.trim()
    if (trimmed.length === 0) continue
    const lead = leading(line.text)
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
      const bullet = bulletItem(trimmed)
      const dash = bullet === null ? dashItem(trimmed) : null
      const numbered = bullet === null && dash === null ? numberedItem(trimmed) : null
      if (bullet !== null) { marker = "•"; words = bullet; textAt = lead + 2 }
      else if (dash !== null) { marker = "–"; words = dash; textAt = lead + 2 }
      else if (numbered !== null) {
        counted += 1
        marker = `${counted}.`
        words = numbered
        const digits = /^[0-9]+/.exec(trimmed)![0].length
        textAt = lead + digits + 2
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
    inline(text, words.replace(/\s+$/, ""), line.start + textAt, context)
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
    case "paragraph": return paragraphBlock(source, context)
    case "quote": return quoteBlock(source, context)
    case "bullets": case "dashes": case "todos": case "numbered": return listBlock(source, context)
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
    case "paragraph": return Math.max(1, Math.ceil(source.length / 85)) * 22
    case "quote": return Math.max(1, Math.ceil(source.length / 80)) * 22
    case "bullets": case "dashes": case "todos": case "numbered": return lines * 22
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
