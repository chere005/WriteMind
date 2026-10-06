/**
 * TEXT CELLS AND MARKDOWN CELLS (docs/PLAN-text-cells.md; Sean, 2026-10-05: "a standard text cell which is ctrl+7 and
 * the default cell type is not itself markdown... we need a markdown cell type"). Port-first: the Mac has no such
 * rule yet and reads these files as standard markdown.
 *
 * - A paragraph with no marker is a TEXT cell: its lines are shown as typed, every line break kept, nothing drawn as
 *   formatting. What would make the file mean something else is written with a backslash (the ESCAPE RULE, below), and
 *   only that; WriteMind hides those backslashes.
 * - A MARKDOWN cell is the line `<!-- markdown -->` directly above the paragraph (the marker belongs to the cell: it is
 *   inside the cell's range, so deleting, moving and copying the cell take it along).
 * - OLDER NOTES: a paragraph with no marker that holds UNESCAPED markup WriteMind itself writes (`looksMarkdown`) is
 *   read as a markdown cell, so notes written before this rule keep their formatting.
 *
 * Every function here is pure; the parser, the two panes, the paper and the commands all ask these same ones.
 */

import { edit, end, range, substring, type Edit, type Range } from "../text/range"
import { bulletItem, dashItem, heading, isRule, numberedItem, todoItem } from "./parser"
import { delimiterAligns } from "./table"
import { pictureLine } from "./images"

/** The line that makes the paragraph under it a markdown cell. An HTML comment: other markdown readers show nothing. */
export const MARKDOWN_MARKER = "<!-- markdown -->"

export const isMarkdownMarker = (line: string): boolean => line.trim() === MARKDOWN_MARKER

/** What a backslash can escape: markdown's ASCII punctuation (the set `inlineSegments` honours). */
export const ESCAPABLE = "\\`*_{}[]()#+-.!~<>|"

const escapable = (c: string | undefined): boolean => c !== undefined && c.length === 1 && ESCAPABLE.includes(c)

// MARK: - Reading the escapes

/**
 * Where a line's escapes are: the offset of each backslash that escapes the character after it, read left to right
 * (`\\` is one escape, of a backslash). The escape and its character are one character on screen.
 */
export function escapeOffsets(line: string): number[] {
  const out: number[] = []
  if (!line.includes("\\")) return out
  for (let i = 0; i < line.length - 1; i++) {
    if (line.charCodeAt(i) === 92 && escapable(line[i + 1])) { out.push(i); i++ }
  }
  return out
}

/** A line as it is read: every escape's backslash gone. */
export function unescapeLine(line: string): string {
  if (!line.includes("\\")) return line
  let out = ""
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) === 92 && escapable(line[i + 1])) { out += line[i + 1]; i++ } else out += line[i]
  }
  return out
}

/** A text cell's source as the words it shows: line for line, escapes gone. */
export const unescapePlain = (source: string): string => source.split("\n").map(unescapeLine).join("\n")

const MASK = ""

/**
 * The line with every escape (backslash and character) turned into a character no markup pattern can use, the same
 * length, so a pattern run over it finds only UNESCAPED markup and its offsets are the line's own.
 */
export function maskEscapes(line: string): string {
  if (!line.includes("\\")) return line
  let out = ""
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) === 92 && escapable(line[i + 1])) { out += MASK + MASK; i++ } else out += line[i]
  }
  return out
}

// MARK: - Link anchors (what Link Here writes) are not formatting

/**
 * The id-only anchors Link Here writes (`notes/linking.ts` `anchorIn`): `<a id="…"></a>` in front of a line, and
 * `<mark id="…">` … `</mark>` round a run. They are where links from other notes land, not formatting: a text cell
 * keeps them (hidden, like its escapes), they do not make a paragraph a markdown cell, and the escape rule leaves them
 * alone. (An escaped `\<` is not one: the line is read with its escapes masked.)
 */
const ID_ANCHOR = /<a id="[^"\n]*"><\/a>|<mark id="[^"\n]*">|<\/mark>/g

/** Where a line's id anchors are, as [from, to) offsets in the line. */
export function anchorSpans(line: string): Array<[number, number]> {
  if (!line.includes("<")) return []
  const masked = maskEscapes(line)
  const out: Array<[number, number]> = []
  ID_ANCHOR.lastIndex = 0
  let found: RegExpExecArray | null
  while ((found = ID_ANCHOR.exec(masked))) out.push([found.index, found.index + found[0].length])
  return out
}

/** The line with its id anchors masked (the same length), so no markup pattern finds them. */
function maskAnchors(line: string): string {
  const spans = anchorSpans(line)
  if (spans.length === 0) return line
  let out = ""
  let at = 0
  for (const [from, to] of spans) {
    out += line.slice(at, from) + MASK.repeat(to - from)
    at = to
  }
  return out + line.slice(at)
}

/**
 * What a text cell's line HIDES on screen, as [from, to) offsets: each escape's backslash, and each id anchor whole.
 * In order, never overlapping.
 */
export function hiddenInText(line: string): Array<[number, number]> {
  const escapes = escapeOffsets(line).map((at): [number, number] => [at, at + 1])
  const anchors = anchorSpans(line)
  if (anchors.length === 0) return escapes
  if (escapes.length === 0) return anchors
  return [...escapes, ...anchors].sort((a, b) => a[0] - b[0])
}

/**
 * A text cell's line as a MARKDOWN cell's from now on (Ctrl+Shift+7 and the automatic switch; Sean, 2026-10-05: "when
 * converting a cell to markdown, it just processes markdown"): its escapes' backslashes gone, so what looked like
 * markup is markup now, Link Here's anchors kept as they are (an escape inside one stays). `removed`: the offsets in
 * `line` of the backslashes taken out, ascending.
 */
export function unescapeLineMapped(line: string): { text: string; removed: number[] } {
  const escapes = escapeOffsets(line)
  if (escapes.length === 0) return { text: line, removed: [] }
  const anchors = anchorSpans(line)
  const removed = anchors.length === 0 ? escapes : escapes.filter((at) => !anchors.some(([from, to]) => at >= from && at < to))
  let text = ""
  let from = 0
  for (const at of removed) {
    text += line.slice(from, at)
    from = at + 1
  }
  return { text: text + line.slice(from), removed }
}

/** A text cell's line as it is read: its escapes' backslashes and its id anchors gone. */
export function plainLine(line: string): string {
  const hidden = hiddenInText(line)
  if (hidden.length === 0) return line
  let out = ""
  let at = 0
  for (const [from, to] of hidden) {
    out += line.slice(at, from)
    at = to
  }
  return out + line.slice(at)
}

// MARK: - The markup WriteMind writes, unescaped (the older-notes rule)

// The editor's own patterns (decorations.ts, export/inline.ts): an opening mark is followed by a non-space and the
// closing one preceded by one, and an underscore inside a word (snake_case_name) is not emphasis.
const CODE_PAIR = /``[^\n]*?``/g
const CODE = /`[^`\n]*`/g
const LINK = /\[[^\]\n]*\]\([^)\n]*\)/g
const BOLD = /\*\*(?=\S)(?:.*?\S)\*\*|(?<![A-Za-z0-9])__(?=\S)(?:.*?\S)__(?![A-Za-z0-9])/g
const ITALIC = /\*(?=\S)(?:[^*_\n]*?[^\s*_])\*|(?<![A-Za-z0-9])_(?=\S)(?:[^*_\n]*?[^\s*_])_(?![A-Za-z0-9])/g
const STRIKE = /~~(?=\S)(?:[^~\n]*?\S)~~/g
/** The toolbar's and `/link`'s own HTML: `<u>`, `<span style>`, `<mark>`, `<a id>`. */
const OWN_TAG = /<\/?(?:u|span|mark|a)(?=[\s>])[^>\n]*>/g
/** Any HTML a markdown reader would take as a tag or a comment (the escape rule guards these too). */
const ANY_TAG = /<\/?[A-Za-z][^>\n]*>|<!/g

/** A cheap first look: none of these characters, no markup. */
const MARKUP_CHARS = /[*_~<[`]/

interface Found { at: number; open: number }

/**
 * The first unescaped piece of markup in a masked line, at or after `from`: where it starts and how long its opening
 * mark is.
 */
function firstMarkup(masked: string, tags: RegExp, from = 0): Found | null {
  let best: Found | null = null
  const consider = (pattern: RegExp, open: (match: string) => number, valid: (match: string) => boolean = () => true) => {
    pattern.lastIndex = from
    let found: RegExpExecArray | null
    while ((found = pattern.exec(masked))) {
      if (found[0].length === 0) { pattern.lastIndex++; continue }
      if (!valid(found[0])) continue
      if (!best || found.index < best.at) best = { at: found.index, open: open(found[0]) }
      break
    }
  }
  consider(CODE_PAIR, () => 2)
  consider(CODE, () => 1)
  consider(LINK, () => 1)
  consider(tags, () => 1)
  consider(BOLD, () => 2, (m) => m.length > 4)
  consider(ITALIC, () => 1, (m) => m.length > 2)
  consider(STRIKE, () => 1, (m) => m.length > 4)
  return best
}

/**
 * THE OLDER-NOTES RULE: whether a paragraph's lines hold unescaped markup WriteMind writes — `**…**`, `*…*`, `_…_`,
 * `~~…~~`, `<u>`, `<span style>`, `<mark>`, `[…](…)`, `` `…` `` (and `wl:` maths, which is a code span). Such a
 * paragraph with no marker is read as a markdown cell, so a note written before text cells keeps its formatting.
 */
export function looksMarkdown(lines: string | readonly string[]): boolean {
  for (const line of typeof lines === "string" ? lines.split("\n") : lines) {
    if (!MARKUP_CHARS.test(line)) continue
    // (Link Here's id anchors are not formatting: a text cell linked to stays a text cell.)
    if (firstMarkup(maskAnchors(maskEscapes(line)), OWN_TAG)) return true
  }
  return false
}

// MARK: - Writing the escapes (the escape rule)

/** The head of a line the parser would read as a block of its own, as the visible offset to escape (-1: none). */
function lineStartEscape(out: string, back: number[]): number {
  const lead = /^[ \t]*/.exec(out)![0].length
  if (lead >= out.length) return -1
  const line = out.trim()
  // (A character already escaped is not a head of anything.)
  if (out.charCodeAt(lead) === 92) return -1
  const first = back[lead]!
  if (line.startsWith("```") || line.startsWith(">") || (line.startsWith("#") && heading(line) !== null)) return first
  if (isRule(line) || todoItem(line) !== null || bulletItem(line) !== null || dashItem(line) !== null) return first
  if (numberedItem(line) !== null) {
    // `1.` keeps its number: the dot (or bracket) is what is escaped.
    const digits = /^[0-9]+/.exec(line)![0].length
    return back[lead + digits]!
  }
  if (pictureLine(line) !== null) return first
  // A table: a line that starts with a pipe, or a delimiter row under a header. The first unescaped pipe goes.
  if (line.startsWith("|") || delimiterAligns(line) !== null) {
    for (let i = lead; i < out.length; i++) {
      if (out.charCodeAt(i) === 92) { i++; continue }
      if (out[i] === "|") return back[i]!
    }
  }
  return -1
}

/**
 * One line of a text cell as the file holds it: the visible words with a backslash before each character that would
 * make the line mean something else — a line-start `#`, `-`, `*`, `+`, `>`, `1.`, ` ``` `, `|` (or a rule, a picture
 * line, a table's delimiter row), an inline `*`, `_`, `` ` ``, `[`, `<`, `~` that would form markup, and a `\` that
 * would read as an escape — and only those. `at[i]` is where visible character `i` begins in the result (its escape
 * included); `at[visible.length]` is the result's length.
 */
export function escapeLineMapped(visible: string): { text: string; at: number[] } {
  const length = visible.length
  const esc = new Uint8Array(length)
  const render = (): { out: string; at: number[]; back: number[] } => {
    let out = ""
    const at: number[] = []
    // back[k]: the visible character the k-th character of `out` is (or escapes).
    const back: number[] = []
    for (let i = 0; i < length; i++) {
      at.push(out.length)
      const c = visible[i]!
      // A backslash before anything a backslash escapes would itself be read as an escape.
      if (esc[i] || (c === "\\" && escapable(visible[i + 1]))) { out += "\\"; back.push(i) }
      out += c
      back.push(i)
    }
    at.push(out.length)
    return { out, at, back }
  }
  if (length === 0) return { text: "", at: [0] }
  let made = render()
  // Inline markup: escape the opening mark of the first piece found, and look again, until there is none. (Link Here's
  // id anchors are left as they are.)
  if (MARKUP_CHARS.test(visible)) escapeInline(made.out, made.back, esc)
  made = render()
  const head = lineStartEscape(made.out, made.back)
  if (head >= 0 && head < length) { esc[head] = 1; made = render() }
  return { text: made.out, at: made.at }
}

/**
 * Past this much work (characters scanned and copied, all turns together; about 20 ms) a line has every markup
 * character left escaped at once.
 */
const LOOKING_BUDGET = 20_000_000

/**
 * The inline half of the escape rule, on `out` (the line as `render` wrote it, `back` its map to visible characters):
 * marks `esc` for the opening mark of the first piece of markup, then the next, until there is none.
 *
 * Linear in practice (a long pasted line must not freeze the window): the masked line is kept up to date as each
 * escape goes in, not written again, and the next look starts where a new piece can begin. An escape only masks
 * characters, which can make a new match only for italics (its words may hold no `*` or `_`: from the last one before
 * the escape) and strike-through (no `~`: from the last `~~`); every other pattern only loses matches. Past
 * `LOOKING_BUDGET`, every markup character left is escaped at once: still literal, only more backslashes (hidden).
 */
function escapeInline(out: string, back: readonly number[], esc: Uint8Array): void {
  let masked = maskAnchors(maskEscapes(out))
  // The offsets in `masked` of the backslashes put in so far, ascending: an offset less those before it is the
  // visible character's index.
  const added: number[] = []
  for (let k = 0; k + 1 < back.length; k++) if (back[k] === back[k + 1]) added.push(k)
  const below = (k: number): number => {
    let low = 0
    let high = added.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (added[mid]! < k) low = mid + 1
      else high = mid
    }
    return low
  }
  const escapeAt = (k: number): void => {
    const i = below(k)
    esc[k - i] = 1
    for (let j = i; j < added.length; j++) added[j] = added[j]! + 1
    added.splice(i, 0, k)
    masked = masked.slice(0, k) + MASK + MASK + masked.slice(k + 1)
  }
  let from = 0
  let looked = 0
  for (let turn = 0; turn <= back.length; turn++) {
    const found = firstMarkup(masked, ANY_TAG, from)
    if (!found) return
    looked += masked.length - from + found.open * masked.length
    if (looked > LOOKING_BUDGET) {
      // One pass: each markup character left, by its visible index (`added` is in order).
      let i = 0
      for (let k = 0; k < masked.length; k++) {
        while (i < added.length && added[i]! < k) i++
        if ("*_`[<~".includes(masked[k]!)) esc[k - i] = 1
      }
      return
    }
    // Right to left, so the offsets still to escape stay where they are.
    for (let k = found.at + found.open - 1; k >= found.at; k--) escapeAt(k)
    from = found.at
    if (found.at > 0) {
      const mark = Math.max(masked.lastIndexOf("*", found.at - 1), masked.lastIndexOf("_", found.at - 1))
      if (mark >= 0) from = Math.min(from, mark)
      const tilde = masked.lastIndexOf("~", found.at - 1)
      if (tilde >= 0) from = Math.min(from, Math.max(0, tilde - 1))
    }
  }
}

export const escapeLine = (visible: string): string => escapeLineMapped(visible).text

/** A text cell's words as the file holds them, line for line. */
export const escapePlain = (visible: string): string => visible.split("\n").map(escapeLine).join("\n")

// MARK: - The cells

/** What a paragraph is: a text cell, or a markdown cell (by its marker, or by the older-notes rule). */
export type ParagraphStyle = "text" | "markdown"

/** A cell's range with its marker line (if any) left out: where the words begin. */
export function cellWordsStart(block: { kind: string; head?: number }, cell: Range): number {
  return cell.location + (block.kind === "paragraph" && block.head ? block.head : 0)
}

/**
 * The visible words of a markdown cell's source, line for line (its marker left out): what Ctrl+7 keeps when it makes
 * the cell a text cell — with Link Here's anchors, an inline picture's markdown and inline maths' `` `wl:…` `` source
 * kept as they are written. `segments` is the inline reader (`inlineSegments`), handed in so this file stays below it.
 */
export function visibleWords(source: string,
  segments: (line: string) => { from: number; to: number; text: string; image?: unknown; math?: string }[]): string {
  const lines = source.split("\n")
  if (lines.length > 0 && isMarkdownMarker(lines[0]!)) lines.shift()
  return lines.map((line) => {
    const lead = /^[ \t]*/.exec(line)![0]
    const body = line.slice(lead.length)
    const read = segments(body)
    // The words — and what is not formatting and must not be lost: Link Here's anchors (links from other notes land
    // on them; the text cell hides them), an inline picture (its markdown, as literal words: a text cell draws no
    // picture, and the reference to it stays in the note) and inline maths (its whole `` `wl:…` `` source, as typed:
    // a text cell typesets nothing, and Ctrl+Shift+7 makes it maths again; Sean, 2026-10-06). A maths segment is the
    // expression alone; its code span is the backtick before the `wl:` and the one right after it (an expression
    // holds no backtick).
    const whole = (one: { from: number; to: number; text: string; image?: unknown; math?: string }): string => {
      if (one.image) return body.slice(one.from, one.to)
      if (one.math === undefined) return one.text
      const open = body.lastIndexOf("`", one.from - 1)
      return open >= 0 && body[one.to] === "`" ? body.slice(open, one.to + 1) : one.text
    }
    const pieces: Array<[number, string]> = read.map((one) => [one.from, whole(one)])
    for (const [from, to] of anchorSpans(body)) {
      if (!read.some((one) => from < one.to && to > one.from)) pieces.push([from, body.slice(from, to)])
    }
    pieces.sort((a, b) => a[0] - b[0])
    return lead + pieces.map((piece) => piece[1]).join("")
  }).join("\n")
}

/**
 * The marker put on top of a paragraph whose words are markdown already (an older note's, a heading's made a paragraph).
 * A TEXT cell made a markdown cell has its escapes taken out first (`cells/textCells.ts`, `asMarkdownCell`).
 */
export function markdownCellEdit(markdown: string, cell: Range): Edit {
  const at = Math.min(Math.max(cell.location, 0), markdown.length)
  const head = MARKDOWN_MARKER + "\n"
  return edit(range(at, 0), head, range(at + head.length, 0))
}

/**
 * Edits on a note whose positions an earlier edit has moved: `markdown` after `first`, and a position of the note
 * before it mapped through (a position inside the replaced stretch goes to its end).
 */
export function mapThrough(first: Edit, pos: number, after = true): number {
  if (pos < first.range.location) return pos
  if (pos > end(first.range) || (pos === end(first.range) && after)) return pos + first.replacement.length - first.range.length
  return after ? first.range.location + first.replacement.length : first.range.location
}

/** Two edits, the second made on the note the first left, as ONE edit on the original note (one Undo takes both). */
export function composeEdits(markdown: string, first: Edit, second: Edit): Edit {
  const middle = substring(markdown, range(0, first.range.location)) + first.replacement + markdown.slice(end(first.range))
  const final = middle.slice(0, second.range.location) + second.replacement + middle.slice(end(second.range))
  return wholeChange(markdown, final, second.selection)
}

/** The one change that turns `before` into `after`, as an edit, with `selection` (in `after`'s offsets). */
export function wholeChange(before: string, after: string, selection: Range): Edit {
  let from = 0
  const most = Math.min(before.length, after.length)
  while (from < most && before.charCodeAt(from) === after.charCodeAt(from)) from++
  let tail = 0
  while (tail < most - from && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++
  return edit(range(from, before.length - tail - from), after.slice(from, after.length - tail), selection)
}
