/**
 * Links between notes, and the anchors they point at. Ported from
 * `WriteMind/Notes/MarkdownLinking.swift`.
 *
 * A whole-note link is `[Title](Other%20Note.md)`. A link to a PART of a note
 * needs something to point at, so one is written INTO that note: a heading
 * already has one (its slug), a highlighted run gets `<mark id="wm-…">…</mark>`
 * — which is also the annotation Sean asked for, "that it's highlighted and
 * linked to" — and any other block gets an empty `<a id="wm-…"></a>` in front
 * of it. All three are portable HTML, not a private marker.
 */

import { clamped, lineRange, range, replacing, substring, type Range } from "../text/range"
import { headingLevel, setHeading } from "../markdown/formatting"
import { stripInlineMarkup } from "./note"

export const LINK_TRIGGER = "/link"

export interface Anchor {
  id: string
  /**
   * The target note's text after the anchor was written into it, or null when
   * the note already had one (a heading) and needs no edit.
   */
  rewrittenText: string | null
  /** What the link should read as. */
  title: string
}

/** `wm-` and eight hex digits. */
export function newAnchorID(random: () => number = Math.random): string {
  let hex = ""
  for (let i = 0; i < 8; i++) hex += Math.floor(random() * 16).toString(16)
  return `wm-${hex}`
}

/** `## The bar` → `the-bar`, the slug every markdown renderer would make. */
export function slug(heading: string): string {
  let out = ""
  for (const character of heading.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(character)) out += character
    else if (character === " " || character === "-" || character === "_") {
      if (!out.endsWith("-")) out += "-"
    }
  }
  while (out.endsWith("-")) out = out.slice(0, -1)
  return out.length === 0 ? "section" : out
}

/** The link text for a block: its heading, or its first few words. */
export function titleForBlock(line: string): string {
  const stripped = setHeading(line, range(0, 0), 0)
  const body = replacing(line, stripped.range, stripped.replacement).trim()
  const plain = stripInlineMarkup(body)
  const words = plain.split(" ").filter((w) => w.length > 0).slice(0, 8).join(" ")
  return words.length === 0 ? "section" : words
}

/**
 * The selection without the whitespace at its edges — a stray trailing space
 * inside a `<mark>` is a link that highlights one character too far. Null
 * when there is nothing but whitespace, which is not a target.
 */
export function trimmingWhitespace(r: Range, text: string): Range | null {
  if (r.length <= 0) return null
  let start = r.location
  let stop = r.location + r.length
  while (start < stop && /\s/.test(text[start]!)) start++
  while (stop > start && /\s/.test(text[stop - 1]!)) stop--
  return stop > start ? range(start, stop - start) : null
}

/**
 * What a link into `text` at `selection` should point at, and what `text`
 * has to become for the anchor to exist.
 *
 * - A non-empty selection is highlighted with `<mark id="…">`.
 * - A caret on a heading uses the heading's own slug; nothing is written.
 * - A caret anywhere else gets an `<a id="…">` before its block.
 */
export function anchorIn(text: string, selection: Range, newID: () => string = newAnchorID): Anchor {
  const clean = clamped(selection, text.length)

  const trimmed = trimmingWhitespace(clean, text)
  if (trimmed) {
    const id = newID()
    const selected = substring(text, trimmed)
    return {
      id,
      rewrittenText: replacing(text, trimmed, `<mark id="${id}">${selected}</mark>`),
      title: stripInlineMarkup(selected).trim(),
    }
  }

  const caret = range(clean.location, 0)
  const lineAt = lineRange(text, caret.location)
  let line = substring(text, lineAt)
  if (line.endsWith("\n")) line = line.slice(0, -1)

  if (headingLevel(line) !== 0) {
    const heading = titleForBlock(line)
    return { id: slug(heading), rewrittenText: null, title: heading }
  }

  const id = newID()
  const replaced = replacing(text, range(lineAt.location, line.length), `<a id="${id}"></a>` + line)
  return { id, rewrittenText: replaced, title: titleForBlock(line) }
}

/** `[Title](Some%20Note.md#wm-1234)` — the anchor is dropped for a whole-note link. */
export function linkMarkdown(title: string, fileName: string, anchor: string | null): string {
  // `urlPathAllowed`: everything but the characters a path cannot carry.
  const encoded = fileName.split("").map((c) => /[A-Za-z0-9\-._~!$&'()*+,;=:@/]/.test(c) ? c : encodeURIComponent(c)).join("")
  const destination = anchor ? `${encoded}#${anchor}` : encoded
  const clean = title.split("]").join("").split("\n").join(" ")
  return `[${clean.length === 0 ? fileName : clean}](${destination})`
}

/**
 * Where the `/link` the user just typed sits — at `caret` if it is still
 * there, otherwise the nearest one, because they may have typed since.
 */
export function triggerRange(text: string, near: number): Range | null {
  const length = LINK_TRIGGER.length
  const at = near - length
  if (at >= 0 && at + length <= text.length && text.slice(at, at + length) === LINK_TRIGGER) {
    return range(at, length)
  }
  let best: Range | null = null
  let from = 0
  while (from < text.length) {
    const found = text.indexOf(LINK_TRIGGER, from)
    if (found < 0) break
    if (best === null || Math.abs(found - near) < Math.abs(best.location - near)) best = range(found, length)
    from = found + length
  }
  return best
}

/** True the moment `/link` has been completed at the caret. */
export function justTypedTrigger(text: string, caret: number): boolean {
  const length = LINK_TRIGGER.length
  const at = caret - length
  if (at < 0 || at + length > text.length) return false
  if (text.slice(at, at + length) !== LINK_TRIGGER) return false
  // Only at a word boundary, so a path like "docs/linked" does not fire it.
  if (at > 0) {
    const before = text[at - 1]!
    if (!(before === " " || before === "\n" || before === "\t")) return false
  }
  return true
}

/** `[label](path#anchor)` parsed: where it points, and at which part. */
export function parseLink(href: string): { file: string; anchor: string | null } {
  const hash = href.indexOf("#")
  const rawFile = hash < 0 ? href : href.slice(0, hash)
  const anchor = hash < 0 ? null : href.slice(hash + 1)
  let file = rawFile
  try { file = decodeURIComponent(rawFile) } catch { /* leave it as written */ }
  return { file, anchor: anchor && anchor.length > 0 ? anchor : null }
}

/**
 * Where an anchor is in a note: the `id="…"` of a `<mark>` or `<a>` written
 * by `/link`, or the heading whose slug it is. Null when the note has no such
 * place (it was edited since) — the link then simply opens the note.
 */
export function anchorOffset(text: string, anchor: string): number | null {
  const id = text.indexOf(`id="${anchor}"`)
  if (id >= 0) return text.lastIndexOf("<", id) >= 0 ? text.lastIndexOf("<", id) : id
  let offset = 0
  for (const line of text.split("\n")) {
    if (headingLevel(line.trim()) !== 0) {
      const words = line.replace(/^\s*#+\s*/, "")
      if (slug(titleForBlock(`# ${words}`)) === anchor || slug(words) === anchor) return offset
    }
    offset += line.length + 1
  }
  return null
}
