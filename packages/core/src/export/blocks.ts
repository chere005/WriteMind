/**
 * The cells of a note as HTML, drawn the way the Mac's preview draws them
 * (`MarkdownPreview.BlockView` in `WriteMind/Editor/MarkdownPreview.swift`):
 * the title ladder 28/22/18/16/15 with the author line (level 6) italic and
 * a little bigger than body, 15 pt body, lists indented 8, a quote with its
 * bar, code on a tint with the Mac's LIGHT code colours, maths set on its own
 * line, and a rule.
 *
 * It is always the LIGHT look, on white: the colours of this app answer the
 * appearance they are drawn in, and the dark ones would be white on white
 * paper.
 *
 * EVERY CELL IS AS TALL AS THE PAGE MAKES IT. The ink was drawn on the rendered
 * page of THIS app (a CodeMirror page, `previewTheme` in @writemind/editor),
 * and the paper is that page photographed onto a sheet: a cell that is 6 px
 * taller on paper than on the page pushes every cell below it — and every
 * word the ink was drawn beside — down the sheet, and a stroke under paragraph
 * 6 prints under paragraph 4 (14 one-line paragraphs: 29.8 px between cells on
 * the page, 36 on paper). So the metrics below are the page's, not the Mac's
 * (`PAGE`): line height 1.45 of the size, no padding round a cell, the page's
 * own padding in code, rules and maths, the page's own indents. The type keeps
 * the Mac's ladder; each heading is laid out in the box the page gives it.
 * `agents/e2e/Projectsandchromelane-fix1/e0-geometry.mjs` lays the same note out
 * on screen and on paper and prints both, cell by cell.
 */

import type { Block } from "../markdown/parser"
import { codeTokens, languageFrom, type CodeTokenKind } from "../markdown/code"
import { INLINE_MATH_CSS, isMathFence } from "../math/typesetter"
import { escapeHtml, inlineHtml, mathHtml, PAPER_HEX } from "./inline"

/**
 * The rendered page's own box, in the document's pixels (@writemind/editor's `notebookTheme` and `previewTheme`):
 * the text starts `left` from the pane's edge (the editor's 30 px of padding and the cell's 2) and stops `right`
 * short of the other, the first cell is `top` down, two cells are `gap` apart, and a line is 1.45 of its size.
 */
export const PAGE = {
  left: 32,
  right: 36,
  top: 16,
  gap: 8,
  /** The body's size and the page's line-height ratio. */
  body: 15,
  lineRatio: 1.45,
  /** A line of body text: 21.75. */
  line: 15 * 1.45,
  /** What the page sets a heading in (the Mac's ladder is `headingSize`, below): size, and line height as a ratio of it. */
  heading: {
    1: { size: 27, ratio: 1.2 }, 2: { size: 22, ratio: 1.25 }, 3: { size: 19, ratio: 1.45 },
    4: { size: 17, ratio: 1.45 }, 5: { size: 16, ratio: 1.45 }, 6: { size: 17, ratio: 1.45 },
  } as Record<number, { size: number; ratio: number }>,
  /** Code: the card's padding and the type inside it. */
  code: { padY: 12, padX: 14, size: 14.2, ratio: 1.45 },
  /** A rule's air above and below it. */
  rule: 8,
} as const

/** The height of one line of a heading on the page. */
export const headingLine = (level: number): number => {
  const box = PAGE.heading[Math.min(Math.max(level, 1), 6)]!
  return Math.round(box.size * box.ratio * 100) / 100
}

/** `MarkdownPreview.headingSize`. */
export const headingSize = (level: number): number =>
  ({ 1: 28, 2: 22, 3: 18, 4: 16, 5: 15 } as Record<number, number>)[level] ?? 17

/** The Mac's code colours, light half (`CodeColours`), as the paper wants them. */
const CODE_COLOUR: Record<CodeTokenKind, string> = {
  keyword: "#AD3DA4", type: "#2D6E74", string: "#C41A16", comment: "#5D6C79",
  number: "#1C00CF", function: "#4B21B0", symbol: "#1C1C1E",
}

/** Code with its tokens in colour. The tokens' ranges are UTF-16 offsets into `body`. */
export function codeHtml(body: string, fence: string | null): string {
  const language = languageFrom(fence) ?? "plain"
  const tokens = language === "plain" ? [] : codeTokens(body, language).sort((a, b) => a.range.location - b.range.location)
  let out = ""
  let at = 0
  for (const token of tokens) {
    const from = Math.max(at, token.range.location)
    const to = Math.min(body.length, token.range.location + token.range.length)
    if (to <= from) continue
    out += escapeHtml(body.slice(at, from))
    out += `<span style="color:${CODE_COLOUR[token.kind]}">${escapeHtml(body.slice(from, to))}</span>`
    at = to
  }
  return out + escapeHtml(body.slice(at))
}

const SECONDARY = "#6C6C70"

const row = (mark: string, content: string, markStyle = ""): string =>
  `<div class="row"><span class="mark"${markStyle ? ` style="${markStyle}"` : ""}>${mark}</span><span class="text">${content}</span></div>`

/** One cell as HTML (its width is the column's; its height is whatever it comes to). */
export function blockHtml(block: Block, paper: string = PAPER_HEX): string {
  const inline = (text: string) => inlineHtml(text, paper)
  switch (block.kind) {
    case "heading": {
      const size = headingSize(block.level)
      const weight = block.level === 1 ? 700 : block.level >= 2 && block.level <= 5 ? 600 : 400
      const colour = block.level >= 5 ? SECONDARY : "#1C1C1E"
      return `<div class="heading" style="font-size:${size}px;font-weight:${weight};line-height:${headingLine(block.level)}px;`
        + `${block.level === 6 ? "font-style:italic;" : ""}color:${colour}">${inline(block.text)}</div>`
    }
    case "paragraph":
      return `<div class="para">${inline(block.text)}</div>`
    case "bullets":
      return `<div class="list">${block.items.map((item) => row("•", inline(item), `color:${SECONDARY}`)).join("")}</div>`
    case "dashes":
      return `<div class="list">${block.items.map((item) => row("–", inline(item), `color:${SECONDARY}`)).join("")}</div>`
    case "numbered":
      return `<div class="list">${block.items.map((item, index) =>
        row(`${index + 1}.`, inline(item), `color:${SECONDARY};font-variant-numeric:tabular-nums`)).join("")}</div>`
    case "todos":
      return `<div class="list">${block.items.map((item) => {
        const box = item.done
          ? `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="#2D7DD2" stroke="#2D7DD2"/><path d="M3.4 7.2l2.4 2.4 4.8-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="3" fill="none" stroke="${SECONDARY}" stroke-width="1.3"/></svg>`
        const words = inline(item.text)
        return `<div class="row"><span class="box">${box}</span><span class="text"${item.done
          ? ` style="text-decoration:line-through;text-decoration-color:${SECONDARY};color:${SECONDARY}"` : ""}>${words}</span></div>`
      }).join("")}</div>`
    case "quote":
      return `<div class="quote"><span class="bar"></span><span class="text">${inline(block.text)}</span></div>`
    case "code": {
      if (isMathFence(block.language)) {
        // Maths on its own line, set properly rather than shown as code.
        const maths = mathHtml(block.body.trim(), "block")
        return `<div class="wm-math-block">${maths ?? `<code>${escapeHtml(block.body)}</code>`}</div>`
      }
      return `<pre class="code">${codeHtml(block.body, block.language)}</pre>`
    }
    case "blank":
      return `<div class="blank" style="height:${Math.round(block.lines * PAGE.line * 100) / 100}px"></div>`
    case "rule":
      return `<div class="rule"><hr/></div>`
  }
}

/** The stylesheet for all of the above, in the document's own pixels (1 px = 1 pt of the Mac's layout) and the PAGE's own metrics. */
export const BLOCK_CSS = `
/* (no padding round a cell: the page has none) */
.heading { overflow-wrap: break-word; }
.para { font-size: ${PAGE.body}px; line-height: ${PAGE.line}px; white-space: pre-wrap; overflow-wrap: break-word; }
.list { padding-left: 8px; font-size: ${PAGE.body}px; line-height: ${PAGE.line}px; }
.list .row { display: flex; align-items: baseline; gap: 8px; }
.list .mark { flex: none; min-width: 14px; text-align: center; }
.list .box { flex: none; align-self: center; display: inline-block; width: 13px; height: 13px; }
.list .box svg { display: block; width: 13px; height: 13px; }
.list .text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: break-word; }
.quote { display: flex; gap: 12px; font-size: ${PAGE.body}px; line-height: ${PAGE.line}px; font-style: italic; color: ${SECONDARY}; }
.quote .bar { flex: none; width: 3px; border-radius: 2px; background: rgba(45, 125, 210, 0.6); }
.quote .text { min-width: 0; white-space: pre-wrap; overflow-wrap: break-word; }
.code { margin: 0 -2px; padding: ${PAGE.code.padY}px ${PAGE.code.padX}px; border-radius: 6px; background: rgba(0, 0, 0, 0.05); color: #1C1C1E;
  font-family: Consolas, "Cascadia Mono", "SFMono-Regular", Menlo, "DejaVu Sans Mono", monospace;
  font-size: ${PAGE.code.size}px; line-height: ${PAGE.code.ratio}; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
/* The notebook's maths (MATH_CSS in @writemind/editor), on paper: colour is the text's, and an equation wider
   than the column is scaled to fit it by the measuring step rather than scrolled. */
.wm-math { font-family: "Cambria Math", "STIX Two Math", "Latin Modern Math", "Noto Sans Math", math, serif; color: inherit; }
.wm-math math { font-family: inherit; color: inherit; }
${INLINE_MATH_CSS}
.wm-math-block { display: block; text-align: center; padding: 6px 0 8px; font-size: 1.25em; }
.wm-math-block .wm-math { display: inline-block; }
.wm-math-block math { line-height: 1.25; }
.rule { padding: ${PAGE.rule}px 0; }
.rule hr { margin: 0; border: 0; border-top: 1px solid #C8C8CC; }
code { font-family: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace; font-size: ${PAGE.code.size}px; background: rgba(0, 0, 0, 0.05); border-radius: 3px; padding: 0 2px; }
a.link { color: #2D7DD2; text-decoration: underline; }
`
