/**
 * `manifest.json` of a `.wm` (docs/SPEC-WM.md 1.7, 1.8). Pure.
 *
 * The manifest is an object whose KEYS are all kept: what this build knows (`format`, `version`, `id`, `created`,
 * `modified`, `app`, `legacy`) is read and repaired, and anything else (`"x-future": {...}`) goes back out as it came.
 */

export const WM_FORMAT = "writemind-note"
/** The format version this build reads and writes. A file with a higher one is opened read-only (1.8). */
export const WM_VERSION = 1

export type Manifest = Record<string, unknown> & { format: string; version: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A UUID in lower case. `crypto.randomUUID` is in the main process and in Node alike. */
export const newManifestId = (): string => crypto.randomUUID().toLowerCase()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** RFC 3339 UTC with whole seconds, `Z`: `2026-10-08T09:14:03Z`. */
export const rfc3339 = (when: Date | number): string => new Date(when).toISOString().replace(/\.\d{3}Z$/, "Z")

export interface AppStamp { name: string; version: string }

/** A manifest for a note being made now. `id` is given for a conversion (a UUID v5), else made. */
export function newManifest(now: Date | number, app: AppStamp, id: string = newManifestId()): Manifest {
  const at = rfc3339(now)
  return { format: WM_FORMAT, version: WM_VERSION, id, created: at, modified: at, app: { ...app } }
}

export type ManifestRead =
  | { ok: true; manifest: Manifest; version: number }
  | { ok: false; error: string }

/** The manifest `text` is, or why it is not one (not JSON, not an object, another format, a version that is no integer >= 1). */
export function parseManifest(text: string): ManifestRead {
  let parsed: unknown
  try { parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) } catch {
    return { ok: false, error: "manifest.json is not JSON" }
  }
  if (!isRecord(parsed)) return { ok: false, error: "manifest.json is not an object" }
  if (parsed.format !== WM_FORMAT) return { ok: false, error: `this is not a WriteMind note (its format is ${JSON.stringify(parsed.format)})` }
  const version = parsed.version
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "manifest.json has no usable version" }
  }
  return { ok: true, manifest: parsed as Manifest, version }
}

/**
 * The manifest as it is written after a change: `id` and `created` repaired if missing (the id new, `created` from the
 * file's own time), `modified` and `app` set to now. Every other key is kept.
 */
export function stamped(manifest: Manifest, now: Date | number, app: AppStamp, fileTime?: Date | number): Manifest {
  const out: Manifest = { ...manifest }
  if (typeof out.id !== "string" || !UUID.test(out.id)) out.id = newManifestId()
  if (typeof out.created !== "string") out.created = rfc3339(fileTime ?? now)
  out.modified = rfc3339(now)
  out.app = { ...(isRecord(out.app) ? out.app : {}), ...app }
  return out
}

/** `manifest.json` as bytes' text. Key order and spacing are not normative: two-space indent, the keys as held. */
export const manifestText = (manifest: Manifest): string => `${JSON.stringify(manifest, null, 2)}\n`
