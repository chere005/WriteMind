/**
 * What a block's markdown looks like while it is being edited, and what the
 * same markdown means once it is drawn. Ported from
 * `WriteMind/Editor/MarkdownSourceStyle.swift` (`runs(in:)`), plus the inline
 * model the rendered page draws from (`MarkdownInline` on the Mac).
 *
 * The text stays exactly what is in the file — nothing is hidden, so nothing
 * can be lost on the way back — but the markers step back and what they mean
 * shows through: bold is bold, a heading is heading-sized, a link is
 * coloured, maths is set apart.
 */

import { range, type Range } from "../text/range"
import { codeTokens, languageFrom, type CodeTokenKind } from "./code"
import { MATH_INLINE_PREFIX, isMathFence } from "../math/typesetter"

export type SourceKind =
  | "marker" | "heading" | "codeToken" | "bold" | "italic" | "strikethrough" | "code" | "math"
  | "linkText" | "linkURL" | "listMarker" | "quoteMarker"
  /** The text of a fenced `wl` block: maths, set apart from code. */
  | "mathFence"
  /** The body of a fenced block with no language the highlighter knows. */
  | "codeFence"

export interface SourceRun {
  range: Range
  kind: SourceKind
  /** For `heading`: 1…6. */
  level?: number
  /** For `codeToken`: what the word is. */
  token?: CodeTokenKind
}

const CODE = /`([^`\n]*)`/g
/** Two backticks either side, holding anything but a newline — a span that can contain a single backtick. */
const CODE_PAIR = /``[^\n]*?``/g
const LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g
const TAG = /<\/?[A-Za-z][^>\n]*>/g
const BOLD = /(\*\*|__)(?=\S)(?:.*?\S)\1/g
const ITALIC = /(\*|_)(?=\S)(?:[^*_\n]*?[^\s*_])\1/g
const STRIKE = /~~(?=\S)(?:[^~\n]*?\S)~~/g

function* matches(pattern: RegExp, source: string): Generator<RegExpExecArray> {
  pattern.lastIndex = 0
  let found: RegExpExecArray | null
  while ((found = pattern.exec(source))) {
    yield found
    if (found[0].length === 0) pattern.lastIndex++
  }
}

/** The structure of a block's markdown: markers, and the runs between them. */
export function sourceStyleRuns(source: string): SourceRun[] {
  const runs: SourceRun[] = []
  const covered = new Uint8Array(source.length)
  const cover = (r: Range) => covered.fill(1, r.location, Math.min(r.location + r.length, source.length))
  const isFree = (r: Range): boolean => {
    for (let i = r.location; i < Math.min(r.location + r.length, source.length); i++) if (covered[i]) return false
    return true
  }
  const push = (r: Range, kind: SourceKind, extra: Partial<SourceRun> = {}) =>
    runs.push({ range: r, kind, ...extra })

  // What a line is, before what is inside it. A fence line is a marker and
  // the lines inside the fence are code (or maths, for a `wl` fence) —
  // decided ahead of the inline patterns, because the inline-code pattern
  // would read the first two backticks of a ``` as an empty code span and
  // leave the third looking like text.
  let offset = 0
  let fence: "mathFence" | "codeFence" | null = null
  let fenceLanguage: ReturnType<typeof languageFrom> = null
  let fenceBodyStart = 0

  /**
   * The code between the fences, coloured for whichever language the opening
   * fence named. Done at the CLOSING fence, over the whole body at once, so a
   * string or a comment that runs over several lines is read as one thing.
   */
  const closeFence = (bodyEnd: number) => {
    const language = fenceLanguage
    fence = null
    fenceLanguage = null
    if (!language || language === "plain" || bodyEnd <= fenceBodyStart) return
    const body = source.slice(fenceBodyStart, bodyEnd)
    for (const token of codeTokens(body, language)) {
      push(range(fenceBodyStart + token.range.location, token.range.length), "codeToken", { token: token.kind })
    }
  }

  for (const line of source.split("\n")) {
    const length = line.length
    const start = offset
    offset += length + 1
    if (length === 0) continue

    const trimmedLine = line.replace(/^[ \t]+|[ \t]+$/g, "")
    if (trimmedLine.startsWith("```")) {
      push(range(start, length), "marker")
      cover(range(start, length))
      if (fence === null) {
        const language = trimmedLine.slice(3).replace(/^[ \t]+|[ \t]+$/g, "")
        fence = isMathFence(language) ? "mathFence" : "codeFence"
        fenceLanguage = isMathFence(language) ? null : languageFrom(language)
        fenceBodyStart = offset
      } else {
        closeFence(Math.max(fenceBodyStart, start - 1))
      }
      continue
    }
    if (fence !== null) {
      push(range(start, length), fence)
      cover(range(start, length))
      continue
    }

    let hashes = 0
    while (hashes < length && line[hashes] === "#") hashes++
    if (hashes >= 1 && hashes <= 6 && line[hashes] === " ") {
      const marker = hashes + 1
      push(range(start, marker), "marker")
      if (length > marker) push(range(start + marker, length - marker), "heading", { level: hashes })
      cover(range(start, marker))
      continue
    }

    const indent = /^[ \t]*/.exec(line)![0].length
    const rest = line.slice(indent)
    const listMarker = ["- ", "* ", "+ "].find((m) => rest.startsWith(m))
    if (listMarker) {
      const r = range(start + indent, listMarker.length)
      push(r, "listMarker")
      cover(r)
    } else if (rest.startsWith(">")) {
      let quotes = 0
      while (quotes < rest.length && (rest[quotes] === ">" || rest[quotes] === " ")) quotes++
      const r = range(start + indent, quotes)
      push(r, "quoteMarker")
      cover(r)
    } else {
      let digits = 0
      while (digits < rest.length && rest[digits]! >= "0" && rest[digits]! <= "9") digits++
      const after = rest.slice(digits)
      if (digits > 0 && digits <= 4 && (after.startsWith(". ") || after.startsWith(") "))) {
        const r = range(start + indent, digits + 2)
        push(r, "listMarker")
        cover(r)
      }
    }
  }

  // A fence left open by a half-typed block still colours its body.
  if (fence !== null) closeFence(source.length)

  // ``a ` b`` — two backticks either side, which is how a code span holds a
  // backtick of its own. Before the single-backtick pattern, which would
  // otherwise read the first two as an empty span.
  for (const found of matches(CODE_PAIR, source)) {
    const r = range(found.index, found[0].length)
    if (!isFree(r) || r.length <= 4) continue
    push(range(r.location, 2), "marker")
    push(range(r.location + 2, r.length - 4), "code")
    push(range(r.location + r.length - 2, 2), "marker")
    cover(r)
  }

  // Code first, because what is inside it is not markdown at all.
  for (const found of matches(CODE, source)) {
    const r = range(found.index, found[0].length)
    if (!isFree(r)) continue
    const inner = range(found.index + 1, found[1]!.length)
    const text = found[1]!
    push(range(r.location, 1), "marker")
    push(range(r.location + r.length - 1, 1), "marker")
    if (text.startsWith(MATH_INLINE_PREFIX)) {
      const prefix = MATH_INLINE_PREFIX.length
      push(range(inner.location, prefix), "marker")
      push(range(inner.location + prefix, inner.length - prefix), "math")
    } else if (inner.length > 0) {
      push(inner, "code")
    }
    cover(r)
  }

  for (const found of matches(LINK, source)) {
    const r = range(found.index, found[0].length)
    if (!isFree(r)) continue
    const text = range(found.index + 1, found[1]!.length)
    const url = range(text.location + text.length + 2, found[2]!.length)
    push(range(r.location, 1), "marker")
    if (text.length > 0) push(text, "linkText")
    push(range(text.location + text.length, 2), "marker")
    if (url.length > 0) push(url, "linkURL")
    push(range(r.location + r.length - 1, 1), "marker")
    cover(r)
  }

  // <u>, <span style=…>, <mark id=…> — the toolbar's own HTML.
  for (const found of matches(TAG, source)) {
    const r = range(found.index, found[0].length)
    if (!isFree(r)) continue
    push(r, "marker")
    cover(r)
  }

  for (const [pattern, kind] of [[BOLD, "bold"], [ITALIC, "italic"]] as const) {
    for (const found of matches(pattern, source)) {
      const r = range(found.index, found[0].length)
      if (!isFree(r)) continue
      const marker = found[1]!.length
      // `**` on its own is two markers round nothing — not a style.
      if (r.length <= marker * 2) continue
      push(range(r.location, marker), "marker")
      push(range(r.location + marker, r.length - marker * 2), kind)
      push(range(r.location + r.length - marker, marker), "marker")
      cover(r)
    }
  }

  // ~~struck~~
  for (const found of matches(STRIKE, source)) {
    const r = range(found.index, found[0].length)
    if (!isFree(r) || r.length <= 4) continue
    push(range(r.location, 2), "marker")
    push(range(r.location + 2, r.length - 4), "strikethrough")
    push(range(r.location + r.length - 2, 2), "marker")
    cover(r)
  }

  // Longest first where two runs start together, so a code token lands ON
  // TOP of the line-wide code run rather than under it.
  return runs.sort((a, b) =>
    a.range.location !== b.range.location ? a.range.location - b.range.location : b.range.length - a.range.length)
}

// MARK: - The inline model: what the words mean once the marks are put away

/** A stretch of a line's words with one look. Its text is the source slice, character for character. */
export interface InlineSegment {
  /** Source offsets, inside the string that was read. */
  from: number
  to: number
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  underline?: boolean
  /** Inside a `<mark>` (what `/link` writes round a highlighted run): drawn highlighted. Port-only. */
  highlight?: boolean
  code?: boolean
  /** `<span style="…">` — the declarations as written, for the caller to vet. */
  spanStyle?: string
  /** A link's destination, when the words are a link's. */
  href?: string
  /** Wolfram Language inside a `wl:` code span. */
  math?: string
  /** A picture: `text` is its alt words, `src` where it is. */
  image?: { alt: string; src: string }
}

const IMAGE = /!\[([^\]\n]*)\]\(([^)\n]*)\)/g
const ESCAPABLE = "\\`*_{}[]()#+-.!~<>|"

/**
 * One line's words as segments: the markers hidden, bold/italic/strike/code
 * applied, links carrying where they go, `wl:` spans as maths, pictures as
 * pictures. Each segment's text is the source slice it stands for, so a
 * click on drawn text can be turned back into an offset in the file.
 */
export function inlineSegments(source: string): InlineSegment[] {
  const length = source.length
  if (length === 0) return []
  const hidden = new Uint8Array(length)
  const bold = new Uint8Array(length)
  const italic = new Uint8Array(length)
  const strike = new Uint8Array(length)
  const underline = new Uint8Array(length)
  const highlight = new Uint8Array(length)
  const code = new Uint8Array(length)
  const link = new Int32Array(length).fill(-1)
  const hrefs: string[] = []
  const styleIndex = new Int32Array(length).fill(-1)
  const styles: string[] = []
  const maths = new Map<number, { to: number; expression: string }>()
  const images = new Map<number, { to: number; alt: string; src: string }>()
  const imageCovered = new Uint8Array(length)

  // Pictures first: `![alt](src)` would otherwise be a bang and a link.
  for (const found of matches(IMAGE, source)) {
    const from = found.index
    const to = from + found[0].length
    images.set(from, { to, alt: found[1]!, src: found[2]! })
    imageCovered.fill(1, from, to)
  }

  const runs = sourceStyleRuns(source).filter((run) => !imageCovered[run.range.location])
  const fill = (target: Uint8Array, r: Range) => target.fill(1, r.location, r.location + r.length)

  for (const run of runs) {
    const r = run.range
    switch (run.kind) {
      case "marker": fill(hidden, r); break
      case "bold": fill(bold, r); break
      case "italic": fill(italic, r); break
      case "strikethrough": fill(strike, r); break
      case "code": fill(code, r); break
      case "math": {
        maths.set(r.location, { to: r.location + r.length, expression: source.slice(r.location, r.location + r.length) })
        break
      }
      case "linkURL": {
        fill(hidden, r)
        // The link text is the nearest linkText before this URL.
        for (let index = runs.length - 1; index >= 0; index--) {
          const other = runs[index]!
          if (other.kind === "linkText" && other.range.location + other.range.length < r.location
            && link[other.range.location] === -1) {
            const id = hrefs.push(source.slice(r.location, r.location + r.length)) - 1
            link.fill(id, other.range.location, other.range.location + other.range.length)
            break
          }
        }
        break
      }
      default: break
    }
  }

  // The toolbar's own tags, in order: <u> … </u>, <span style="…"> … </span>.
  // Only the tags the marker pass claimed (not ones inside a code span).
  const claimed = new Set(runs.filter((run) => run.kind === "marker").map((run) => `${run.range.location}:${run.range.length}`))
  const open: { kind: "u" | "span" | "mark"; style: number }[] = []
  let last = 0
  const paint = (upTo: number) => {
    if (upTo <= last) return
    for (const entry of open) {
      if (entry.kind === "u") underline.fill(1, last, upTo)
      else if (entry.kind === "mark") highlight.fill(1, last, upTo)
      else if (entry.style >= 0) styleIndex.fill(entry.style, last, upTo)
    }
  }
  for (const found of matches(TAG, source)) {
    const at = found.index
    const tag = found[0]
    if (!claimed.has(`${at}:${tag.length}`)) continue
    paint(at)
    last = at + tag.length
    if (tag === "<u>") open.push({ kind: "u", style: -1 })
    else if (tag === "</u>") { const i = open.map((e) => e.kind).lastIndexOf("u"); if (i >= 0) open.splice(i, 1) }
    else if (tag.startsWith("<span")) {
      const css = /style="([^"]*)"/.exec(tag)?.[1]
      open.push({ kind: "span", style: css ? styles.push(css) - 1 : -1 })
    } else if (/^<mark[\s>]/.test(tag)) open.push({ kind: "mark", style: -1 })
    else if (tag === "</mark>") { const i = open.map((e) => e.kind).lastIndexOf("mark"); if (i >= 0) open.splice(i, 1) }
    else if (tag === "</span>") { const i = open.map((e) => e.kind).lastIndexOf("span"); if (i >= 0) open.splice(i, 1) }
  }
  paint(length)

  // A backslash before punctuation is an escape: the backslash goes.
  for (let i = 0; i < length - 1; i++) {
    if (source[i] === "\\" && !hidden[i] && !code[i] && !imageCovered[i] && ESCAPABLE.includes(source[i + 1]!)) {
      hidden[i] = 1
      i++
    }
  }

  const out: InlineSegment[] = []
  let index = 0
  const key = (i: number): string =>
    `${bold[i]}${italic[i]}${strike[i]}${underline[i]}${highlight[i]}${code[i]}${link[i]}${styleIndex[i]}`
  const flags = (i: number): Partial<InlineSegment> => {
    const f: Partial<InlineSegment> = {}
    if (bold[i]) f.bold = true
    if (italic[i]) f.italic = true
    if (strike[i]) f.strike = true
    if (underline[i]) f.underline = true
    if (highlight[i]) f.highlight = true
    if (code[i]) f.code = true
    if (link[i] >= 0) f.href = hrefs[link[i]!]
    if (styleIndex[i] >= 0) f.spanStyle = styles[styleIndex[i]!]
    return f
  }
  while (index < length) {
    const picture = images.get(index)
    if (picture) {
      out.push({ from: index, to: picture.to, text: picture.alt, image: { alt: picture.alt, src: picture.src } })
      index = picture.to
      continue
    }
    if (imageCovered[index]) { index++; continue }
    const math = maths.get(index)
    if (math) {
      out.push({ from: index, to: math.to, text: math.expression, math: math.expression, ...flags(index) })
      index = math.to
      continue
    }
    if (hidden[index]) { index++; continue }
    const start = index
    const k = key(index)
    index++
    while (index < length && !hidden[index] && !imageCovered[index] && !maths.has(index) && key(index) === k) index++
    out.push({ from: start, to: index, text: source.slice(start, index), ...flags(start) })
  }
  return out
}
