/**
 * A row in the sidebar: the file, when it changed, its title and a two-line
 * snippet. Ported from `WriteMind/Notes/Note.swift`.
 *
 * The title is the note's first `# heading`, falling back to the file name —
 * nothing is stored beside the file, because the file is the note.
 */

import { isMarkdownMarker, plainLine, unescapeLine } from "../markdown/plainText"
import { positioned } from "../markdown/parser"

export interface Note {
  /** The file's path. It is the id: two notes cannot share one. */
  path: string
  /** Seconds since the epoch, as the filesystem gives it. */
  modified: number
  title: string
  snippet: string
}

/** The file name without its extension. */
export function stem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}

/** Plain text from a markdown line: drop the markers it carries. */
export function stripInlineMarkup(line: string): string {
  let out = line
  // A note's SECOND heading and below land in the snippet, so the hashes
  // have to come off here as well as in the title.
  if (out.startsWith("#")) {
    const hashes = /^#+/.exec(out)![0]
    if (hashes.length <= 6) out = out.slice(hashes.length).trim()
  }
  for (const marker of ["**", "__", "<u>", "</u>", "`", "~~"]) out = out.split(marker).join("")
  // Port-only: the tags `/link` and the T menu write (`<a id="wm-…"></a>`, `<mark …>`, `<span style=…>`) are
  // not words either; the Mac showed them raw in the row's second line.
  out = out.replace(/<a id="[^"]*"><\/a>/g, "").replace(/<\/?(?:mark|span)\b[^>]*>/g, "")
  if (out.startsWith("- ") || out.startsWith("* ") || out.startsWith("> ")) out = out.slice(2)
  return out
}

/**
 * Which of `lines` (by index) are a TEXT cell's (docs/PLAN-text-cells.md): their words are shown as typed, so the
 * snippet takes nothing off them as markup — a `` `wl:x^2` `` in one is its backticks and all, never maths (Sean,
 * 2026-10-05: "math shouldn't be typeset in non-markdown mode").
 */
function textCellLines(lines: readonly string[]): Set<number> {
  const out = new Set<number>()
  const starts: number[] = []
  let at = 0
  for (const line of lines) { starts.push(at); at += line.length + 1 }
  let i = 0
  for (const cell of positioned(lines.join("\n"))) {
    if (cell.block.kind !== "paragraph" || cell.block.markdown) continue
    const stop = cell.range.location + cell.range.length
    while (i < lines.length && starts[i]! < cell.range.location) i++
    for (; i < lines.length && starts[i]! < stop; i++) out.add(i)
  }
  return out
}

export function makeNote(path: string, modified: number, contents: string): Note {
  let title: string | null = null
  const snippetLines: string[] = []
  const lines = contents.split("\n").slice(0, 40)
  const plain = textCellLines(lines)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    // A markdown cell's marker is not words (docs/PLAN-text-cells.md); a text cell's escapes are not drawn.
    if (line.length === 0 || isMarkdownMarker(line)) continue
    if (title === null && line.startsWith("#")) {
      title = line.replace(/^#+/, "").trim()
      continue
    }
    if (snippetLines.length >= 2) continue
    // A text cell's line as typed (its escapes and Link Here's anchors hidden); anything else with its markup off.
    snippetLines.push(plain.has(index) ? plainLine(line) : stripInlineMarkup(unescapeLine(line)))
  }

  return {
    path,
    modified,
    title: title && title.length > 0 ? title : stem(path),
    snippet: snippetLines.join(" · "),
  }
}
