/**
 * The project file (docs/SPEC-WM.md section 4): a small JSON file that lists folders and `.wm` files. Pure — the path
 * rules of the machine are handed in (`PathOps`, which is `node:path` in the app).
 *
 * `{ version, folders, excluded, files }` and whatever else a newer program wrote there. The Mac's own spelling is kept
 * byte for byte: keys sorted, two-space indent, `"key" : value`, an empty list as `[`, a blank line, `]`, slashes
 * unescaped, no trailing newline — so a project shared through git does not change shape each time the other machine
 * saves it. Paths are written relative to the project file's folder when they lie at or under it (`/`-separated), and
 * absolute otherwise; a reader takes both.
 */

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

/** What the project's path arithmetic needs of the machine (`node:path`'s `posix`, `win32` or the host's own). */
export interface PathOps {
  resolve(...parts: string[]): string
  isAbsolute(path: string): boolean
  relative(from: string, to: string): string
  dirname(path: string): string
  readonly sep: string
}

export interface ProjectData {
  version: number
  /** The paths as the file has them (relative ones relative to the project file's folder). */
  folders: string[]
  excluded: string[]
  files: string[]
  /** Every other top-level key, as it was (4.3). */
  extra: Json
}

export const emptyProjectData = (): ProjectData => ({ version: 1, folders: [], excluded: [], files: [], extra: {} })

const KNOWN = new Set(["version", "folders", "excluded", "files"])

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : []

/** The project `text` is, or null when it is not JSON or not an object. Entries that are not strings are left out. */
export function parseProjectData(text: string): ProjectData | null {
  let given: unknown
  try { given = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) } catch { return null }
  if (!isRecord(given)) return null
  const extra: Json = {}
  // (Defined, not assigned: `extra["__proto__"] = x` would set the prototype and lose the key.)
  for (const [key, value] of Object.entries(given)) {
    if (!KNOWN.has(key)) Object.defineProperty(extra, key, { value, enumerable: true, writable: true, configurable: true })
  }
  const version = typeof given.version === "number" && Number.isFinite(given.version) ? given.version : 1
  return { version, folders: strings(given.folders), excluded: strings(given.excluded), files: strings(given.files), extra }
}

/** Foundation's `.prettyPrinted + .sortedKeys + .withoutEscapingSlashes` of any JSON value, at `depth` levels in. */
function print(value: unknown, depth: number): string {
  const inner = "  ".repeat(depth + 1)
  const outer = "  ".repeat(depth)
  if (Array.isArray(value)) {
    return value.length === 0 ? `[\n\n${outer}]` : `[\n${value.map((one) => inner + print(one, depth + 1)).join(",\n")}\n${outer}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    return keys.length === 0 ? `{\n\n${outer}}` :
      `{\n${keys.map((key) => `${inner}${JSON.stringify(key)} : ${print(value[key], depth + 1)}`).join(",\n")}\n${outer}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** The file's text. Keys sorted (unknown ones in their sorted place), `version` as it was read (never raised or lowered). */
export function stringifyProjectData(data: ProjectData): string {
  return print({ ...data.extra, version: data.version, folders: data.folders, excluded: data.excluded, files: data.files }, 0)
}

/** A path from the other kind of machine: kept exactly as written, never resolved (4.2). */
export type Foreign = (path: string) => boolean

const folded = (value: string, windows: boolean): string => (windows ? value.toLowerCase() : value)

/**
 * The paths as the app uses them: absolute and tidy. A relative path is resolved against `projectFile`'s folder
 * (`..` allowed), a foreign path stays as written, and a path that names the same place as an earlier one is dropped
 * (4.2; case-insensitively on Windows).
 */
export function resolvePaths(paths: readonly string[], projectFile: string | null, ops: PathOps, foreign: Foreign,
  windows: boolean): string[] {
  const base = projectFile === null ? null : ops.dirname(ops.resolve(projectFile))
  const out: string[] = []
  const seen = new Set<string>()
  for (const written of paths) {
    let path: string
    if (foreign(written)) path = written
    else if (ops.isAbsolute(written) || base === null) path = ops.resolve(written)
    else path = ops.resolve(base, written)
    const key = folded(path, windows)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}

/**
 * One path as the file writes it: relative to the project file's folder, `/`-separated, when it lies at or under that
 * folder; else as it is (absolute). A foreign path, and every path of an untitled project, is left as it is.
 */
export function writtenPath(path: string, projectFile: string | null, ops: PathOps, foreign: Foreign, windows: boolean): string {
  if (projectFile === null || foreign(path) || !ops.isAbsolute(path)) return path
  const base = ops.dirname(ops.resolve(projectFile))
  const relative = ops.relative(base, path)
  if (relative === "" ) return "."
  if (relative.startsWith("..") || ops.isAbsolute(relative)) return path
  // (On Windows `relative` is the target itself when it is on another drive: it is absolute, caught above.)
  const same = folded(ops.resolve(base, relative), windows) === folded(ops.resolve(path), windows)
  return same ? relative.split(ops.sep).join("/") : path
}
