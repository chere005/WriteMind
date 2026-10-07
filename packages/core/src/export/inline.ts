/**
 * Inline markdown as HTML, for paper. The Mac's `MarkdownInline`
 * (`WriteMind/Editor/MarkdownBlocks.swift`): `**bold**`, `_italic_`,
 * `~~strike~~`, `` `code` ``, `[links](x)` and the two HTML tags the toolbar
 * writes — `<u>` and `<span style="…">`. Anything else that looks like HTML
 * stays as literal text, as it does there; the two anchors `/link` writes
 * (`<a id="…"></a>` and `<mark id="…">…</mark>`) are not part of what a
 * reader sees, so they are dropped and highlighted.
 *
 * A span's colour is checked against the paper it is printed on and swapped
 * for black or white if it could not be read there (Sean, 2026-09-19: "be
 * mindful of text color… it should always be visible against the
 * background"). Maths in a code span (`` `wl:…` ``) is typeset.
 *
 * This produces a string and touches no DOM, so it runs in the main process
 * and in a test alike.
 */

import { mathmlString } from "../math/mathml"
import { inlineSpans, inlineSpansHtml, mathExpressionInCode } from "../math/typesetter"
import { readableInk } from "../drawing/textBox"
import { ESCAPABLE } from "../markdown/plainText"

/** The page's white. */
export const PAPER_HEX = "#FFFFFF"

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/**
 * Maths as the notebook draws it, in the page's own colour: on its own line MathML, set by Chromium (the maths
 * lane's `mathml.ts`); in a line of prose a linear run of text, as the Mac sets it (`inlineSpans`), which cannot
 * be taller than its line and so cannot run into the lines above and below it. Null while the source is not an
 * expression — half-typed maths stays the text it is.
 */
export function mathHtml(source: string, display: "inline" | "block"): string | null {
  if (display === "inline") {
    const spans = inlineSpans(source)
    return spans === null ? null : `<span class="wm-math wm-math-inline">${inlineSpansHtml(spans)}</span>`
  }
  const tree = mathmlString(source, display)
  return tree === null ? null : `<span class="wm-math">${tree}</span>`
}

interface Style { underline: boolean; family?: string; size?: number; color?: string; mark?: boolean }

const SAFE_FAMILY = /^[\w\s,'"-]+$/

/** `font-family: Georgia; font-size: 18px; color: #2D7DD2` read back from a tag; only what was recognised. */
function styleFromTag(tag: string): Style {
  const found = /style="([^"]*)"/.exec(tag)
  return { underline: false, ...(found ? spanDeclarations(found[1]!) : {}) }
}

/**
 * The declarations of a `<span style="…">` read back — the font, the size and the colour the toolbar writes, and
 * only what was recognised (the PDF here, the Wolfram export's runs in export/wolfram/plan.ts).
 */
export function spanDeclarations(css: string): { family?: string; size?: number; color?: string } {
  const style: { family?: string; size?: number; color?: string } = {}
  for (const part of css.split(";")) {
    const colon = part.indexOf(":")
    if (colon < 0) continue
    const name = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (name === "font-family") {
      const family = value.replace(/^['"]|['"]$/g, "")
      if (SAFE_FAMILY.test(family)) style.family = family
    } else if (name === "font-size") {
      const size = parseFloat(value)
      if (Number.isFinite(size) && size > 0 && size < 400) style.size = size
    } else if (name === "color" && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\))$/.test(value)) {
      style.color = value
    }
  }
  return style
}

type Token = { open: Style } | { close: true } | { text: string }

/** `<u>`, `</u>`, `<span …>`, `</span>` and the anchors; everything else is text. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let buffer = ""
  let index = 0
  const flush = () => { if (buffer) { tokens.push({ text: buffer }); buffer = "" } }
  while (index < source.length) {
    const rest = source.slice(index, index + 400)
    let match: RegExpExecArray | null
    // An escape (`\<`) is the character it escapes, never the start of a tag (plainText.ts).
    if (source.charCodeAt(index) === 92 && index + 1 < source.length && ESCAPABLE.includes(source[index + 1]!)) {
      buffer += source.slice(index, index + 2); index += 2; continue
    }
    if (rest.startsWith("<u>")) { flush(); tokens.push({ open: { underline: true } }); index += 3 }
    else if (rest.startsWith("</u>")) { flush(); tokens.push({ close: true }); index += 4 }
    else if (rest.startsWith("</span>")) { flush(); tokens.push({ close: true }); index += 7 }
    else if ((match = /^<span\b[^>]*>/.exec(rest))) {
      flush(); tokens.push({ open: styleFromTag(match[0]) }); index += match[0].length
    } else if ((match = /^<a id="[^"]*"><\/a>/.exec(rest))) {
      flush(); index += match[0].length
    } else if ((match = /^<mark\b[^>]*>/.exec(rest))) {
      flush(); tokens.push({ open: { underline: false, mark: true } }); index += match[0].length
    } else if (rest.startsWith("</mark>")) { flush(); tokens.push({ close: true }); index += 7 }
    else { buffer += source[index]; index += 1 }
  }
  flush()
  return tokens
}

// The inline patterns, the editor's own (`MarkdownSourceStyle.Patterns`): an opening mark is followed by
// a non-space and the closing one preceded by one, so `2 * 3 * 4` is not a style; an underscore inside a
// word (snake_case_name) is not emphasis.
const BOLD = /\*\*(?=\S)(.*?\S)\*\*|(?<![A-Za-z0-9])__(?=\S)(.*?\S)__(?![A-Za-z0-9])/g
const ITALIC = /\*(?=\S)([^*_\n]*?[^\s*_])\*|(?<![A-Za-z0-9])_(?=\S)([^*_\n]*?[^\s*_])_(?![A-Za-z0-9])/g
const STRIKE = /~~(?=\S)([^~\n]*?\S)~~/g

/**
 * A link on paper keeps its address only when it is one a PDF reader should follow: the web, mail, a place in the
 * note, or a note beside this one. Anything with another scheme (`javascript:`, `file:`) prints as its label alone.
 */
function linkTarget(href: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim())
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1]!)) return ""
  return ` href="${escapeHtml(href.trim())}"`
}

/** One run of markdown (no HTML tags in it) to HTML. */
function markdownRun(text: string): string {
  const held: string[] = []
  const hold = (html: string): string => { held.push(html); return `\u0001${held.length - 1}\u0001` }

  // Code spans first: their insides are nobody else's.
  let work = text.replace(/``([^\n]*?)``|`([^`\n]*)`/g, (whole, pair: string | undefined, single: string | undefined) => {
    const code = pair ?? single ?? ""
    if (code === "") return whole
    const source = mathExpressionInCode(code)
    const maths = source === null ? null : mathHtml(source, "inline")
    return hold(maths ?? `<code>${escapeHtml(code)}</code>`)
  })
  // Escapes next: `\*` is a star, and no pattern after this sees it.
  work = work.replace(/\\([\\`*_{}[\]()#+\-.!~<>|])/g, (_whole, character: string) => hold(escapeHtml(character)))
  // Links: the label is itself inline markdown; the destination is not.
  work = work.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_whole, label: string, href: string) =>
    hold(`<a class="link"${linkTarget(href)}>${emphasis(escapeHtml(label))}</a>`))
  return restore(emphasis(escapeHtml(work)), held)
}

function emphasis(escaped: string): string {
  return escaped
    .replace(BOLD, (_whole, star: string | undefined, under: string | undefined) => `<b>${star ?? under ?? ""}</b>`)
    .replace(ITALIC, (_whole, star: string | undefined, under: string | undefined) => `<i>${star ?? under ?? ""}</i>`)
    .replace(STRIKE, (_whole, inside: string) => `<s>${inside}</s>`)
}

function restore(html: string, held: string[]): string {
  // A held piece can hold a placeholder of its own (a link whose label has code in it).
  let out = html
  for (let pass = 0; pass < 3 && out.includes("\u0001"); pass++) {
    out = out.replace(/\u0001(\d+)\u0001/g, (_whole, n: string) => held[Number(n)] ?? "")
  }
  return out
}

/**
 * Inline markdown as HTML. `paper` is what it will be printed on (`#RRGGBB`);
 * `size` is the body size the maths is set at.
 */
export function inlineHtml(source: string, paper: string = PAPER_HEX): string {
  const stack: Style[] = []
  let out = ""
  for (const token of tokenize(source)) {
    if ("open" in token) { stack.push(token.open); continue }
    if ("close" in token) { stack.pop(); continue }
    let html = markdownRun(token.text)
    const merged = stack.reduce<Style>((into, next) => ({
      underline: into.underline || next.underline,
      family: next.family ?? into.family,
      size: next.size ?? into.size,
      color: next.color ?? into.color,
      mark: into.mark || next.mark,
    }), { underline: false })
    const css: string[] = []
    if (merged.family) css.push(`font-family:${merged.family}`)
    if (merged.size !== undefined) css.push(`font-size:${merged.size}px`)
    // One rule for "can this be read on that", shared with the text boxes on the drawing layer.
    if (merged.color) css.push(`color:${readableInk(merged.color, paper)}`)
    if (merged.underline) css.push("text-decoration:underline")
    if (merged.mark) css.push("background:#fff3a0")
    if (css.length > 0) html = `<span style="${css.join(";")}">${html}</span>`
    out += html
  }
  return out
}
