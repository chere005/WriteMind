/**
 * Pictures written into the note itself: the Mac's planned `MarkdownImages.swift` (C:\GIT\WriteMindSwift\docs\
 * PLAN-docking.md, "The model"), plus the port's ink cells (docs\PLAN-docking-ink-cells.md (a)).
 *
 * A DOCKED picture is the line `![](.drawings/media/<file>)` on a line of its own, and the parser makes that line a
 * picture CELL: text cannot overlap it, the caret goes above and below it. An INK cell is the same kind of line,
 * `![ink](.drawings/media/ink-<uuid>.svg)`: any markdown viewer shows the SVG snapshot, and WriteMind knows the
 * `ink-<uuid>` name and draws the editable cell from the note's sidecar.
 *
 * `<prefix>` is `../` once per section folder between the note and its project folder (the media live in
 * `<projectFolder>/.drawings/media`), so other viewers find the file. WriteMind itself reads only the BASENAME
 * (`mediaFile`), so a note moved to another depth still works here.
 *
 * Pure: no file system, no DOM.
 */

/** What a picture line says: its alt words and the path in its parentheses (angle brackets and a title taken off). */
export interface PictureLine { alt: string; path: string }

/** An image anywhere in a line: `![alt](inside)`. The same pattern the rendered page's inline pictures use. */
const IMAGE = /!\[([^\]\n]*)\]\(([^)\n]*)\)/g
/** A line that is one image and nothing else (it has been trimmed). */
const WHOLE = /^!\[([^\]\n]*)\]\(([^)\n]*)\)$/

/** What is inside the parentheses, as a path: `<…>` unwrapped, a trailing `"title"` / `'title'` dropped. */
function destination(inside: string): string {
  const text = inside.trim()
  if (text.startsWith("<")) {
    const close = text.indexOf(">")
    return close > 0 ? text.slice(1, close).trim() : text.slice(1).trim()
  }
  // `path "title"`: the path is what comes before the first space when a quoted title follows it.
  const titled = /^(\S+)\s+(?:"[^"]*"|'[^']*')$/.exec(text)
  return titled ? titled[1]! : text
}

/**
 * The picture a line IS — only when the line is nothing but one image (spaces either side allowed). Words round an
 * image are a paragraph carrying an inline picture, which is the inline renderer's business; "text above and below"
 * is a statement about the cell. An image with no path is no picture.
 */
export function pictureLine(line: string): PictureLine | null {
  const text = line.trim()
  // Cheap first: this runs on every line the parser reads.
  if (text.length < 5 || text.charCodeAt(0) !== 33 /* ! */ || text.charCodeAt(text.length - 1) !== 41 /* ) */) return null
  const found = WHOLE.exec(text)
  if (!found) return null
  const path = destination(found[2]!)
  if (path.length === 0) return null
  return { alt: found[1]!, path }
}

/**
 * The file inside the note's OWN media folder that a path names: `.drawings/media/<name>`, after any number of `../`
 * (and an optional `./`), either slash. Null for a picture that lives anywhere else (a URL, an absolute path, a
 * folder of its own): only the app's own media are drawn off the project's media folder and kept by a sweep.
 */
export function mediaFile(path: string): string | null {
  const found = /^(?:\.[\\/])?(?:\.\.[\\/])*\.drawings[\\/]media[\\/]([^\\/]+)$/.exec(path.trim())
  if (!found) return null
  let name = found[1]!
  if (name.includes("%")) {
    try { name = decodeURIComponent(name) } catch { /* a stray % is part of the name */ }
  }
  if (name === "." || name === ".." || name.length === 0 || /[\\/]/.test(name)) return null
  return name
}

/** An ink cell's id: what `crypto.randomUUID()` makes. Main checks a snapshot's id against this before writing. */
export const INK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether `id` can name an ink cell (and so an `ink-<id>.svg` file). */
export const isInkId = (id: string): boolean => INK_ID.test(id)

/** The ink cell a media file is the snapshot of: `ink-<uuid>.svg` → the uuid (lower case); anything else → null. */
export function inkCellId(file: string | null): string | null {
  if (!file) return null
  const found = /^ink-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.svg$/i.exec(file)
  return found ? found[1]!.toLowerCase() : null
}

/** The snapshot file of an ink cell. */
export const inkFileName = (id: string): string => `ink-${id}.svg`

/** `../` once per folder between the note and its project folder. */
const prefix = (depth = 0): string => "../".repeat(Math.max(0, Math.floor(Number.isFinite(depth) ? depth : 0)))

/** Alt words that cannot end the brackets early or break the line. */
const safeAlt = (alt: string): string => alt.replace(/[\r\n]+/g, " ").replace(/[[\]]/g, "").trim()

/** The line that docks a picture: `![alt](<prefix>.drawings/media/<file>)`. */
export function pictureMarkdown(file: string, depth = 0, alt = ""): string {
  return `![${safeAlt(alt)}](${prefix(depth)}.drawings/media/${file})`
}

/** The line of an ink cell: `![ink](<prefix>.drawings/media/ink-<id>.svg)`. */
export function inkCellMarkdown(id: string, depth = 0): string {
  return `![ink](${prefix(depth)}.drawings/media/${inkFileName(id)})`
}

/**
 * Every file of the note's own media its markdown points at — picture cells, ink cells' snapshots and inline
 * pictures alike, each once, in the order first met. Read over the WHOLE text (a picture written inside a code
 * block counts too): this is what stops a media sweep deleting a docked picture, and keeping one file too many costs
 * nothing where deleting one too many loses a picture.
 */
export function mediaFiles(markdown: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const found of markdown.matchAll(IMAGE)) {
    const file = mediaFile(destination(found[2]!))
    if (file !== null && !seen.has(file)) { seen.add(file); out.push(file) }
  }
  return out
}
