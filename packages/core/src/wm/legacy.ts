/**
 * The pure half of the conversion of 2.15.0's notes (docs/SPEC-WM.md section 5): which new name each legacy note gets, and
 * the edits its text takes. The file work — reading the sidecar, copying the pictures, writing the `.wm`, moving the
 * originals to the backup — is `apps/desktop/src/main/convert.ts`.
 *
 * A legacy note is a `.md` or `.markdown` file. (A `.txt` was a note in 2.15.0 and is NOT converted: it is left exactly
 * where it is, and the sidebar does not list it. Decided 2026-10-07; see the decision list in SPEC-WM.)
 */

import { positioned } from "../markdown/parser"
import { inkCellId } from "../markdown/images"
import { resolveLinkTarget } from "../notes/linking"
import { encodeRefName, isSnapshotName, WM_MEDIA, WM_SNAPSHOTS } from "./names"

/** The extensions the conversion takes, in the order two notes of one name are taken. */
export const CONVERTED_EXTENSIONS = [".md", ".markdown"] as const

/** The position of the extension in the order (0 `.md`, 1 `.markdown`), or -1: not a legacy note. */
export function legacyOrder(name: string): number {
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return -1
  return CONVERTED_EXTENSIONS.indexOf(name.slice(dot).toLowerCase() as typeof CONVERTED_EXTENSIONS[number])
}

const fold = (name: string): string => name.normalize("NFC").toUpperCase().toLowerCase()

export interface LegacyNote {
  /** Its path relative to the project folder, `/`-separated, with the extension (`Ideas/Plan.md`). */
  relative: string
}

/** The notes in the order they are named: by file name (case-insensitive), then by extension (`.md`, `.markdown`). */
export function takingOrder<T extends LegacyNote>(notes: readonly T[]): T[] {
  const stem = (relative: string): string => relative.slice(0, relative.lastIndexOf("."))
  return [...notes].sort((a, b) => {
    const sa = fold(stem(a.relative))
    const sb = fold(stem(b.relative))
    return sa < sb ? -1 : sa > sb ? 1 : legacyOrder(a.relative) - legacyOrder(b.relative)
  })
}

/**
 * The new name of each note (`Stem.wm`, or `Stem 2.wm`, `Stem 3.wm` ... when that name is taken), by the note's
 * relative path. `taken(directory)` says which file names (any file) are already in each directory, and `own` the new
 * name a note already has from an earlier, interrupted run (kept: not "taken" by itself). Names that differ only by case
 * are the same name (a folder on macOS or Windows holds one of them).
 */
export function newNames(notes: readonly LegacyNote[], taken: (directory: string) => ReadonlySet<string>,
  own: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Map<string, Set<string>>()
  const names = (directory: string): Set<string> => {
    let set = used.get(directory)
    if (!set) { set = new Set([...taken(directory)].map(fold)); used.set(directory, set) }
    return set
  }
  const directoryOf = (relative: string): string => (relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "")
  // The names earlier runs gave are reserved first, whatever the order: they are on disk already.
  for (const [relative, name] of own) names(directoryOf(relative)).add(fold(name))
  for (const note of takingOrder(notes)) {
    const existing = own.get(note.relative)
    if (existing !== undefined) { out.set(note.relative, existing); continue }
    const directory = directoryOf(note.relative)
    const base = note.relative.slice(directory === "" ? 0 : directory.length + 1, note.relative.lastIndexOf("."))
    const set = names(directory)
    let name = `${base}.wm`
    for (let count = 2; set.has(fold(name)); count++) name = `${base} ${count}.wm`
    set.add(fold(name))
    out.set(note.relative, name)
  }
  return out
}

// MARK: - File names inside the container

/**
 * The names of a note's pictures, made safe for ONE container: a name that equals another's after case folding gets
 * `-2`, `-3` before its extension, in the order met (5.3 step 4). Returns what each original name becomes (the same name
 * for those that are not renamed).
 */
export function containerNames(names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  const seen = new Set<string>()
  for (const name of names) {
    if (out.has(name)) continue
    let next = name
    for (let count = 2; seen.has(fold(next)); count++) {
      const dot = name.lastIndexOf(".")
      next = dot > 0 ? `${name.slice(0, dot)}-${count}${name.slice(dot)}` : `${name}-${count}`
    }
    seen.add(fold(next))
    out.set(name, next)
  }
  return out
}

// MARK: - The text (5.3 step 5)

/** A picture destination in the 2.15.0 spelling: the prefix, and the name (which has spaces in it when the destination was `<in angle brackets>`). */
const PICTURE = /^((?:\.[\\/])?(?:\.\.[\\/])*\.drawings[\\/]media[\\/])([^\\/]+)$/

/**
 * Where the destination is inside what is in a link's or picture's parentheses: `<in angle brackets>` (it may hold spaces)
 * or the first run without whitespace. `start` and `end` bound it in `inside`; what is left of it (a title) is not touched.
 */
function destinationIn(inside: string): { start: number; end: number } | null {
  let start = 0
  while (start < inside.length && /\s/.test(inside[start]!)) start++
  if (start >= inside.length) return null
  if (inside[start] === "<") {
    const close = inside.indexOf(">", start + 1)
    if (close > 0) return { start: start + 1, end: close }
    start++
  }
  let end = start
  while (end < inside.length && !/\s/.test(inside[end]!) && inside[end] !== ">") end++
  return end > start ? { start, end } : null
}

export interface Rewrite {
  /** Where each picture name went (only the renamed ones): the text follows. */
  renamed?: ReadonlyMap<string, string>
  /** The names whose pictures are nowhere: their references stay as they were written. */
  missing?: ReadonlySet<string>
  /**
   * What a link to another note becomes: given the written link destination's file part (decoded) answers the NEW
   * file name of the note it resolves to, or null when it resolves to none of the notes being converted.
   */
  link?(file: string): string | null
}

const decodePart = (value: string): string => { try { return decodeURIComponent(value) } catch { return value } }

/** The characters a link's path keeps as they are (`urlPathAllowed`, linkMarkdown in notes/linking.ts). */
const encodePath = (name: string): string =>
  name.split("").map((c) => (/[A-Za-z0-9\-._~!$&'()*+,;=:@/]/.test(c) ? c : encodeURIComponent(c))).join("")

/** One `![alt](inside)`'s inside: the 2.15.0 picture spelling made the container's, or null when it is not that. */
function pictureInside(inside: string, rewrite: Rewrite): string | null {
  const where = destinationIn(inside)
  const found = where ? PICTURE.exec(inside.slice(where.start, where.end)) : null
  if (!where || !found) return null
  const written = found[2]!
  const name = decodePart(written)
  if (rewrite.missing?.has(name)) return null
  const renamed = rewrite.renamed?.get(name)
  const part = renamed !== undefined ? encodeRefName(renamed) : written
  const final = renamed ?? name
  const next = `${isSnapshotName(final) || inkCellId(final) !== null ? WM_SNAPSHOTS : WM_MEDIA}${part}`
  return inside.slice(0, where.start) + next + inside.slice(where.end)
}

/** One `[text](inside)`'s inside: a link to a note being converted, its extension (and name) made the `.wm`'s. */
function linkInside(inside: string, rewrite: Rewrite): string | null {
  if (!rewrite.link) return null
  // `dest "title"` and `<dest with spaces>` are dealt with by working on the destination only.
  const where = destinationIn(inside)
  if (!where) return null
  const token = inside.slice(where.start, where.end)
  if (token === "" || token.startsWith("#")) return null
  const hash = token.indexOf("#")
  const written = hash < 0 ? token : token.slice(0, hash)
  const anchor = hash < 0 ? "" : token.slice(hash)
  // A web address, or any scheme, is not a note (a Windows drive letter is not a scheme).
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(written) && !/^[A-Za-z]:[\\/]/.test(written)) return null
  const file = decodePart(written)
  if (legacyOrder(file) < 0) return null
  const target = rewrite.link(file)
  if (target === null) return null
  const slash = Math.max(written.lastIndexOf("/"), written.lastIndexOf("\\"))
  const directory = slash < 0 ? "" : written.slice(0, slash + 1)
  const own = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1)
  const stem = own.slice(0, own.lastIndexOf("."))
  // The extension alone changes unless the note was given another name (`A 2.wm`): then the file part is that name.
  const name = target === `${stem}.wm` ? written.slice(slash + 1, written.lastIndexOf(".")) + ".wm" : encodePath(target)
  const next = `${directory}${name}${anchor}`
  // (Put in by position: `String.replace` reads `$&`, `$'` and the like in the new text, and finds the FIRST copy of the old.)
  return inside.slice(0, where.start) + next + inside.slice(where.end)
}

/**
 * The text of a note with the edits of 5.3 step 5 and nothing else: inside the cells that are not fenced code and not a
 * text cell, and outside inline code spans, a picture destination in the 2.15.0 spelling becomes the container's and a
 * link to a note being converted takes the `.wm` name. Everything else — anchors, markers, escapes, blank lines, line
 * endings, the lines of a text cell, the body of a fence — is the same characters.
 */
export function rewriteLegacyText(text: string, rewrite: Rewrite): string {
  const cells = positioned(text)
  let out = ""
  let at = 0
  for (const { block, range } of cells) {
    const start = range.location
    const stop = range.location + range.length
    if (start < at) continue
    out += text.slice(at, start)
    const source = text.slice(start, stop)
    const skip = block.kind === "code" || block.kind === "blank" || (block.kind === "paragraph" && !block.markdown)
    out += skip ? source : rewriteCell(source, rewrite)
    at = stop
  }
  return out + text.slice(at)
}

/** A cell's source with its pictures and links rewritten, outside inline code spans. */
function rewriteCell(source: string, rewrite: Rewrite): string {
  let out = ""
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    if (c === "\\") { out += source.slice(i, i + 2); i += 2; continue }
    if (c === "`") {
      // A code span: the same number of backticks closes it; no closing run, and it is only backticks.
      let n = 0
      while (source[i + n] === "`") n++
      const close = findRun(source, i + n, n)
      if (close < 0) { out += source.slice(i, i + n); i += n; continue }
      out += source.slice(i, close + n)
      i = close + n
      continue
    }
    if (c === "[" || (c === "!" && source[i + 1] === "[")) {
      const picture = c === "!"
      const open = picture ? i + 1 : i
      // A picture's words end at the first `]` (as the page reads them); a link's text may hold brackets, such as a picture
      // (`[![alt](.drawings/media/x.png)](https://…)`), whose own destination is rewritten as any picture's.
      const close = picture ? source.indexOf("]", open + 1) : closingBracket(source, open)
      if (close > 0 && source[close + 1] === "(" && !source.slice(open + 1, close).includes("\n")) {
        const end = source.indexOf(")", close + 2)
        const inside = end < 0 ? null : source.slice(close + 2, end)
        if (inside !== null && !inside.includes("\n")) {
          const next = picture ? pictureInside(inside, rewrite) : linkInside(inside, rewrite)
          const words = source.slice(open + 1, close)
          out += source.slice(i, open + 1) + (picture ? words : rewriteCell(words, rewrite)) + "](" + (next ?? inside) + ")"
          i = end + 1
          continue
        }
      }
    }
    out += c
    i++
  }
  return out
}

/** The `]` that closes the `[` at `open`, brackets inside matched (escapes skipped), or -1 (not on this line). */
function closingBracket(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const c = source[i]!
    if (c === "\n") return -1
    if (c === "\\") { i++; continue }
    if (c === "[") depth++
    else if (c === "]" && --depth === 0) return i
  }
  return -1
}

/** The index of the next run of exactly `n` backticks at or after `from`, or -1. */
function findRun(source: string, from: number, n: number): number {
  let i = from
  while (i < source.length) {
    if (source[i] !== "`") { i++; continue }
    let run = 0
    while (source[i + run] === "`") run++
    if (run === n) return i
    i += run
  }
  return -1
}

/**
 * Which note a legacy link's destination names, among the notes being converted, as `resolveLinkTarget` finds it from the
 * note `from` (all paths as the caller keeps them).
 */
export function linkedNote(notePaths: readonly string[], from: string, file: string): string | null {
  return resolveLinkTarget([...notePaths], from, file)
}
