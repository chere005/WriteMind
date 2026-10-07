/**
 * The names inside a `.wm` and the references to them (docs/SPEC-WM.md 1.5, 2.6.1). Pure: no file system, no DOM.
 *
 * An entry name is safe when it cannot reach outside the container if somebody unpacks the archive with it
 * (`../x`, `/abs`, `C:/x`, a backslash), and when it survives a Windows or macOS file system (no segment that ends in
 * a space or a dot, no two names that differ only by case). A reader refuses the whole file at the first name that is
 * not; a writer refuses to write a pair that folds together.
 */

const encoder = new TextEncoder()

/** The longest a segment, and a whole name, may be (UTF-8 bytes). */
export const MAX_SEGMENT_BYTES = 255
export const MAX_NAME_BYTES = 1024

/** Why `name` is not a valid entry name, or null when it is (a trailing `/` marks a directory entry and is allowed). */
export function entryNameError(name: string): string | null {
  if (name.length === 0) return "an entry has no name"
  const body = name.endsWith("/") ? name.slice(0, -1) : name
  if (body.length === 0) return `“${name}” is not a relative name`
  if (name.startsWith("/")) return `“${name}” is not a relative name`
  if (/^[A-Za-z]:/.test(name)) return `“${name}” has a drive part`
  if (name.includes("\\")) return `“${name}” uses a backslash`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return "an entry name holds a control character"
  if (encoder.encode(name).length > MAX_NAME_BYTES) return `“${name.slice(0, 40)}…” is too long`
  for (const segment of body.split("/")) {
    if (segment === "") return `“${name}” has an empty part`
    if (segment === "." || segment === "..") return `“${name}” has a “${segment}” part`
    if (/[ .]$/.test(segment)) return `“${name}” has a part that ends in a space or a dot`
    if (encoder.encode(segment).length > MAX_SEGMENT_BYTES) return `“${name.slice(0, 40)}…” has a part that is too long`
  }
  return null
}

export const isDirectoryEntry = (name: string): boolean => name.endsWith("/")

/** The first problem with a list of entry names read from a file (an invalid name, or the same name twice), or null. */
export function readNamesError(names: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const name of names) {
    const problem = entryNameError(name)
    if (problem) return problem
    if (isDirectoryEntry(name)) continue
    if (seen.has(name)) return `“${name}” is in the file twice`
    seen.add(name)
  }
  return null
}

/** What two names must not differ by: Unicode normal form and case (a file that holds both would not unpack everywhere). */
export const foldedName = (name: string): string => name.normalize("NFC").toLowerCase()

/** The first problem with a list of names about to be WRITTEN: anything `readNamesError` finds, or two that fold together. */
export function writeNamesError(names: readonly string[]): string | null {
  const read = readNamesError(names)
  if (read) return read
  const seen = new Map<string, string>()
  for (const name of names) {
    if (isDirectoryEntry(name)) continue
    const key = foldedName(name)
    const other = seen.get(key)
    if (other !== undefined) return `“${other}” and “${name}” differ only by case, so the file would not unpack on every system`
    seen.set(key, name)
  }
  return null
}

// MARK: - The fixed names

export const WM_MIMETYPE = "mimetype"
export const WM_MANIFEST = "manifest.json"
export const WM_TEXT = "note.wmdm"
export const WM_DRAWING = "drawing.json"
export const WM_MEDIA = "media/"
export const WM_SNAPSHOTS = "snapshots/"

/** `application/vnd.writemind.note+zip`, the content of the first entry (34 bytes, no newline). */
export const WM_MIME = "application/vnd.writemind.note+zip"
export const WM_EXTENSION = ".wm"

/** Whether a file name is a note: `.wm`, any case (readers match it case-insensitively, writers write lower case). */
export const isWmName = (name: string): boolean => name.length > 3 && name.toLowerCase().endsWith(WM_EXTENSION)

// MARK: - References from the text

/** A file name inside `media/`, `snapshots/` or `attachments/`: written percent-encoded except `A-Z a-z 0-9 . _ ~ -`. */
export function encodeRefName(name: string): string {
  let out = ""
  for (const character of name) {
    if (/[A-Za-z0-9._~-]/.test(character)) out += character
    else out += [...encoder.encode(character)].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("")
  }
  return out
}

/** A reference's name decoded (`%20` is a space); an invalid escape is read literally. */
export function decodeRefName(name: string): string {
  if (!name.includes("%")) return name
  try { return decodeURIComponent(name) } catch { /* a stray % is part of the name */ }
  // Decode the escapes that are valid and leave the others as they were.
  return name.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try { return decodeURIComponent(run) } catch { return run }
  })
}

/** An ink cell's id: what `crypto.randomUUID()` makes (also in `markdown/images.ts`, which re-exports it for the text side). */
const INK_FILE = /^ink-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.svg$/i

/** Whether `name` is the snapshot of an ink cell (`ink-<uuid>.svg`, either case). */
export const isSnapshotName = (name: string): boolean => INK_FILE.test(name)

/** The entry a picture name lives in: a drawing cell's snapshot goes to `snapshots/`, everything else to `media/`. */
export const entryNameOf = (name: string): string => `${isSnapshotName(name) ? WM_SNAPSHOTS : WM_MEDIA}${name}`

/**
 * The name a picture destination from the text points at inside the container: `media/<name>` or `snapshots/<name>`
 * (2.6.1: one segment, no `./`, `../` or leading `/`, percent-encoded, snapshots only for `ink-<uuid>.svg`), else null.
 * The 2.15.0 spelling `[./][../]*.drawings/media/<name>` is read by `mediaFile` in markdown/images.ts, which asks this first.
 */
export function containerReference(destination: string): string | null {
  const found = /^(media|snapshots)\/([^\\/]+)$/.exec(destination.trim())
  if (!found) return null
  const name = decodeRefName(found[2]!)
  if (name === "." || name === ".." || name.length === 0 || /[\\/]/.test(name)) return null
  if (found[1] === "snapshots" && !isSnapshotName(name)) return null
  return name
}

/** What a drawing's picture file names must be to be an entry of `media/`: one safe segment. */
export const isMediaFileName = (name: string): boolean =>
  name.length > 0 && !name.includes("/") && entryNameError(`${WM_MEDIA}${name}`) === null
