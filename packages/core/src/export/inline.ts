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

/** What the tags round a run of words give it. */
export interface InlineStyle { underline: boolean; family?: string; size?: number; color?: string; mark?: boolean }

const SAFE_FAMILY = /^[\w\s,'"-]+$/

/** `font-family: Georgia; font-size: 18px; color: #2D7DD2` read back from a tag; only what was recognised. */
function styleFromTag(tag: string): InlineStyle {
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

export type InlineToken = { open: InlineStyle } | { close: true } | { text: string }

/** `[A-Za-z0-9_]`, by code: what `\b` reads as a word's character. */
const isWord = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95

/**
 * `<u>`, `</u>`, `<span …>`, `</span>` and the anchors; everything else is text. (Exported for its test,
 * test/inlineLinear.test.ts, which holds it to the patterns it was first written with.)
 *
 * IN ONE PASS. A tag starts with `<` and an escape with `\`, so a run of anything else is words, taken whole; and a tag
 * that is read up to its `>` (or an anchor up to its `"`) asks a reader that never goes back (`seeker`) where that is.
 * Written first as a slice of the next 400 characters and four patterns at EVERY character, a long cell took seconds in
 * the Quick Look extension, whose JavaScriptCore has no JIT, and a run of `<` took 4.5 s (review of the preview,
 * 2026-10-17). A tag is still read only within 400 characters of its `<`, as it was.
 */
export function inlineTokens(source: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const n = source.length
  let buffer = ""
  let index = 0
  const flush = () => { if (buffer) { tokens.push({ text: buffer }); buffer = "" } }
  const gt = seeker(n, (i) => source.charCodeAt(i) === 62)
  const quote = seeker(n, (i) => source.charCodeAt(i) === 34)
  /** Where `<span\b[^>]*>` or `<mark\b[^>]*>` (`name` is its first five characters) at `index` ends, or -1. */
  const tagEnd = (name: string): number => {
    if (!source.startsWith(name, index)) return -1
    const after = index + name.length
    if (after < n && isWord(source.charCodeAt(after))) return -1
    const close = gt(after)
    return close < n && close < index + 400 ? close + 1 : -1
  }
  /** Where `<a id="[^"]*"></a>` at `index` ends, or -1. */
  const anchorEnd = (): number => {
    if (!source.startsWith('<a id="', index)) return -1
    const close = quote(index + 7)
    return close < n && source.startsWith('"></a>', close) && close + 6 <= index + 400 ? close + 6 : -1
  }
  while (index < n) {
    const code = source.charCodeAt(index)
    if (code !== 60 && code !== 92) {
      let next = index + 1
      while (next < n && source.charCodeAt(next) !== 60 && source.charCodeAt(next) !== 92) next++
      buffer += source.slice(index, next); index = next; continue
    }
    // An escape (`\<`) is the character it escapes, never the start of a tag (plainText.ts).
    if (code === 92) {
      const escapes = index + 1 < n && ESCAPABLE.includes(source[index + 1]!)
      buffer += source.slice(index, index + (escapes ? 2 : 1)); index += escapes ? 2 : 1; continue
    }
    let end: number
    if (source.startsWith("<u>", index)) { flush(); tokens.push({ open: { underline: true } }); index += 3 }
    else if (source.startsWith("</u>", index)) { flush(); tokens.push({ close: true }); index += 4 }
    else if (source.startsWith("</span>", index)) { flush(); tokens.push({ close: true }); index += 7 }
    else if ((end = tagEnd("<span")) >= 0) { flush(); tokens.push({ open: styleFromTag(source.slice(index, end)) }); index = end }
    else if ((end = anchorEnd()) >= 0) { flush(); index = end }
    else if ((end = tagEnd("<mark")) >= 0) { flush(); tokens.push({ open: { underline: false, mark: true } }); index = end }
    else if (source.startsWith("</mark>", index)) { flush(); tokens.push({ close: true }); index += 7 }
    else { buffer += "<"; index += 1 }
  }
  flush()
  return tokens
}

// The inline patterns, the editor's own (`MarkdownSourceStyle.Patterns`): an opening mark is followed by
// a non-space and the closing one preceded by one, so `2 * 3 * 4` is not a style; an underscore inside a
// word (snake_case_name) is not emphasis. Bold and links are read by hand (`replaceBold`, `replaceLinks`), each to
// exactly the answers of its pattern (test/inlineLinear.test.ts holds them to it).
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

/**
 * The first place at or after `at` where `hit` holds (`length` when none), for a reader whose places never go back:
 * what was read past is not read again, so a whole run costs one pass.
 */
function seeker(length: number, hit: (index: number) => boolean): (at: number) => number {
  let found = -1
  return (at) => {
    if (at > found) { found = at; while (found < length && !hit(found)) found++ }
    return found
  }
}

/** `\s` in a regular expression, by code. */
function isSpace(code: number): boolean {
  return (code >= 9 && code <= 13) || code === 32 || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
}

/** `[A-Za-z0-9]`, by code (NaN, past either end, is not). */
const isAlnum = (code: number): boolean => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)

/** What `.` does not match: the line terminators. */
const isLineEnd = (code: number): boolean => code === 10 || code === 13 || code === 0x2028 || code === 0x2029

/**
 * `text.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, href) => link(label, href))`, read in one pass. The pattern
 * gives the same answers and is quadratic: on a run of `[` with no `]` every `[` reads to the end of the run and back,
 * and a markdown cell's lines are one run (they are joined), so a crafted note of a few thousand brackets held the
 * Quick Look preview for seconds and two hundred thousand for minutes (review of the preview, 2026-10-17). Neither
 * part can hold its own closing character, so there is never more than one way to read a link from a `[`.
 */
export function replaceLinks(text: string, link: (label: string, href: string) => string): string {
  const n = text.length
  const bracket = seeker(n, (i) => text.charCodeAt(i) === 93 || text.charCodeAt(i) === 10)
  const paren = seeker(n, (i) => text.charCodeAt(i) === 41 || text.charCodeAt(i) === 10)
  let out = ""
  let copied = 0
  let at = text.indexOf("[")
  while (at >= 0) {
    const close = bracket(at + 1)
    if (close > at + 1 && text.charCodeAt(close) === 93 && text.charCodeAt(close + 1) === 40) {
      const end = paren(close + 2)
      if (end > close + 2 && text.charCodeAt(end) === 41) {
        out += text.slice(copied, at) + link(text.slice(at + 1, close), text.slice(close + 2, end))
        copied = end + 1
        at = text.indexOf("[", copied)
        continue
      }
    }
    at = text.indexOf("[", at + 1)
  }
  return copied === 0 ? text : out + text.slice(copied)
}

/**
 * `text.replace(/\*\*(?=\S)(.*?\S)\*\*|(?<![A-Za-z0-9])__(?=\S)(.*?\S)__(?![A-Za-z0-9])/g, (_, a, b) => bold(a ?? b))`,
 * the editor's bold, read in one pass: each opening finds the first closing after it on its line, which the pattern
 * finds by reading to the end of the line from EVERY opening that has none — a line of `**a ` was a minute's work in
 * the Quick Look extension (`replaceLinks`).
 */
export function replaceBold(text: string, bold: (inner: string) => string): string {
  const n = text.length
  const code = (i: number) => text.charCodeAt(i)
  const solid = (i: number) => i < n && !isSpace(code(i))
  const lineEnd = seeker(n, (i) => isLineEnd(code(i)))
  const stars = seeker(n, (i) => solid(i) && code(i + 1) === 42 && code(i + 2) === 42)
  const unders = seeker(n, (i) => solid(i) && code(i + 1) === 95 && code(i + 2) === 95 && !isAlnum(code(i + 3)))
  let out = ""
  let copied = 0
  let at = 0
  while (at < n) {
    const c = code(at)
    let close = -1
    if (c === 42 && code(at + 1) === 42 && solid(at + 2)) {
      const found = stars(at + 2)
      if (found < lineEnd(at + 2)) close = found
    } else if (c === 95 && code(at + 1) === 95 && solid(at + 2) && !isAlnum(code(at - 1))) {
      const found = unders(at + 2)
      if (found < lineEnd(at + 2)) close = found
    }
    if (close < 0) { at++; continue }
    out += text.slice(copied, at) + bold(text.slice(at + 2, close + 1))
    copied = close + 3
    at = copied
  }
  return copied === 0 ? text : out + text.slice(copied)
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
  work = replaceLinks(work, (label, href) => hold(`<a class="link"${linkTarget(href)}>${emphasis(escapeHtml(label))}</a>`))
  return restore(emphasis(escapeHtml(work)), held)
}

function emphasis(escaped: string): string {
  return replaceBold(escaped, (inner) => `<b>${inner}</b>`)
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
  const stack: InlineStyle[] = []
  let out = ""
  for (const token of inlineTokens(source)) {
    if ("open" in token) { stack.push(token.open); continue }
    if ("close" in token) { stack.pop(); continue }
    let html = markdownRun(token.text)
    const merged = stack.reduce<InlineStyle>((into, next) => ({
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
