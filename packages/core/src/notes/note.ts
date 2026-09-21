/**
 * A row in the sidebar: the file, when it changed, its title and a two-line
 * snippet. Ported from `WriteMind/Notes/Note.swift`.
 *
 * The title is the note's first `# heading`, falling back to the file name —
 * nothing is stored beside the file, because the file is the note.
 */

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
  const name = path.split("/").pop() ?? path
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
  if (out.startsWith("- ") || out.startsWith("* ") || out.startsWith("> ")) out = out.slice(2)
  return out
}

export function makeNote(path: string, modified: number, contents: string): Note {
  let title: string | null = null
  const snippetLines: string[] = []

  for (const raw of contents.split("\n").slice(0, 40)) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (title === null && line.startsWith("#")) {
      title = line.replace(/^#+/, "").trim()
      continue
    }
    if (snippetLines.length < 2) snippetLines.push(stripInlineMarkup(line))
  }

  return {
    path,
    modified,
    title: title && title.length > 0 ? title : stem(path),
    snippet: snippetLines.join(" · "),
  }
}
