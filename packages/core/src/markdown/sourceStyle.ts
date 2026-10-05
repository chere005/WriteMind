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

import { end, lineRange, range, type Range } from "../text/range"
import { todoItem } from "./parser"
import { codeTokens, languageFrom, type CodeTokenKind } from "./code"
import { colouring } from "../eval/evaluator"
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
        fenceLanguage = isMathFence(language) ? null : colouring(language)
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

// MARK: - Furniture: what the open block on the rendered page has to be read and not typed

/**
 * What, in the markdown of the block open on the RENDERED page, is FURNITURE:
 * there to be read, and not to be typed. Ported from
 * `WriteMind/Editor/CellFurniture.swift` (Mac 0fdd031).
 *
 * Sean, 2026-09-21: "when in wysiwyg mode, don't show the markdown characters
 * for header, only edit the text in a reminders list or bullet list". The
 * markdown side shows a line's markers back the moment the caret lands on it,
 * and is right to: there the markers ARE the text. On the rendered page they
 * are not, and a block opened there must look like the block that was clicked.
 *
 * - `reserved`: the head of a line the caret may not enter. Every marker is in
 *   here, drawn or not — hidden characters the caret can still be put among
 *   are worse than visible ones (the key that looks like it types in front of
 *   the words types between two hashes instead).
 * - `hidden`: drawn as nothing — a heading's hashes, and the `- ` and the
 *   brackets of a reminder, which the box stands in for.
 * - `glyphs`: drawn as something else — a reminder's `[` is the box.
 *
 * A bullet is in neither of the last two (it is drawn as a round bullet, and a
 * list with no marker is not a list), but it is reserved all the same. Read off
 * the runs `sourceStyleRuns` already found, so there is one answer to "what is
 * a heading"; only the reminder's box is scanned for, and that asks
 * `todoItem` what a reminder is.
 */
export interface FurnitureReading {
  reserved: Range[]
  hidden: Range[]
  /** By the offset of the character drawn as something else: what it is drawn as. */
  glyphs: Map<number, string>
}

/** U+25A1 WHITE SQUARE and U+2611 BALLOT BOX WITH CHECK (the Mac's pair: U+2610 is missing from its system font). */
export const EMPTY_BOX = "□"
export const TICKED_BOX = "☑"

export const furnitureIsEmpty = (reading: FurnitureReading): boolean =>
  reading.reserved.length === 0 && reading.hidden.length === 0 && reading.glyphs.size === 0

export function cellFurniture(source: string, runs: SourceRun[] = sourceStyleRuns(source)): FurnitureReading {
  const reading: FurnitureReading = { reserved: [], hidden: [], glyphs: new Map() }
  // A heading's hashes: gone, and no-go.
  for (const marker of headingMarkers(runs, source)) {
    reading.hidden.push(marker)
    reading.reserved.push(marker)
  }
  // A list's marker: drawn as it always was, and no-go.
  for (const run of runs) {
    if (run.kind !== "listMarker" || run.range.length <= 0 || end(run.range) > source.length) continue
    reading.reserved.push(run.range)
  }
  // A reminder's box — the marker, the brackets and what is between them — is one piece, drawn as one character.
  for (const line of furnitureLines(source)) {
    const box = reminderBox(line, source)
    if (!box) continue
    reading.hidden.push(box.marker, range(box.state, 1), range(box.close, 1))
    reading.glyphs.set(box.open, box.ticked ? TICKED_BOX : EMPTY_BOX)
    reading.reserved.push(range(line.location, box.end - line.location))
  }
  return reading
}

/**
 * The `### ` at the head of a line: a marker run that STARTS its line and is
 * hashes followed by one space. Nothing else looks like that — a fence is its
 * whole line, and every inline pair is inside one.
 */
export function headingMarkers(runs: SourceRun[], source: string): Range[] {
  const out: Range[] = []
  for (const run of runs) {
    if (run.kind !== "marker" || run.range.length < 2 || end(run.range) > source.length) continue
    if (lineRange(source, run.range.location).location !== run.range.location) continue
    const body = source.slice(run.range.location, end(run.range))
    if (!body.endsWith(" ") || !/^#+$/.test(body.slice(0, -1))) continue
    out.push(run.range)
  }
  return out
}

/** Where a reminder's box is on one line, in the note's own offsets. */
export interface ReminderBox {
  /** The `- ` in front of the brackets — hidden, because the box is the marker on a reminder. */
  marker: Range
  /** `[`, drawn as the box. */
  open: number
  /** What is between the brackets — the tick, or the space. */
  state: number
  /** `]`. */
  close: number
  /** Past the box and the space after it: where the words start, and where the caret lands. */
  end: number
  ticked: boolean
}

/** The reminder's box on the line `line` (a line range, newline and all), or null for a line that is not one. */
export function reminderBox(line: Range, source: string): ReminderBox | null {
  if (line.length <= 0 || end(line) > source.length) return null
  const body = source.slice(line.location, end(line)).replace(/^\n+|\n+$/g, "")
  const indent = /^[ \t]*/.exec(body)![0]
  const item = todoItem(body.slice(indent.length))
  if (!item) return null
  // `todoItem` has said the line is `<marker>[<state>]` with a two-character marker; these offsets follow from that
  // and are the ones `toggleTodo` counts.
  const start = line.location + indent.length
  const open = start + 2
  const close = open + 2
  if (close >= end(line)) return null
  // The space after the box belongs to the box; a reminder with no words yet has no space to take.
  const after = close + 1
  const stop = after < end(line) && source[after] === " " ? after + 1 : after
  return { marker: range(start, 2), open, state: open + 1, close, end: stop, ticked: item.done }
}

/** Every line of `source`, newline and all (an empty last line is not one). */
export function furnitureLines(source: string): Range[] {
  const out: Range[] = []
  let start = 0
  while (start < source.length) {
    const line = lineRange(source, start)
    if (line.length <= 0) break
    out.push(line)
    start = end(line)
  }
  return out
}

/**
 * Where the caret really goes when it is put at `selection`: out of any piece
 * of furniture, out of its FRONT (a prefix has only the start of the line to
 * its left), and past ALL of it — a reminder's `- ` is furniture as a list
 * marker and the whole `- [ ] ` as a box, and stopping after the first left
 * the caret between the dash and the bracket. A real selection is left as it
 * was made. (`MarkerHiding.outside` on the Mac.)
 */
export function outsideFurniture(selection: Range, furniture: readonly Range[]): Range {
  if (selection.length !== 0) return selection
  let location = selection.location
  // Each turn moves strictly forward and a piece can only be used once, so this cannot spin.
  for (let turn = 0; turn <= furniture.length; turn++) {
    let furthest = -1
    for (const piece of furniture) {
      if (piece.length > 0 && location >= piece.location && location < end(piece)) furthest = Math.max(furthest, end(piece))
    }
    if (furthest < 0) break
    location = furthest
  }
  return range(location, 0)
}

/**
 * A backspace with the caret just behind a piece of furniture takes the WHOLE
 * piece: `## ` off a heading, so it stops being one, rather than one space and
 * a heading that quietly became a paragraph beginning `##`.
 */
export function furnitureBehind(caret: number, furniture: readonly Range[]): Range | null {
  return furniture.find((piece) => piece.length > 0 && end(piece) === caret) ?? null
}
