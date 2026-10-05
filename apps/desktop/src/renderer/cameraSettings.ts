/**
 * What the camera pane remembers between launches, the way the Mac keeps it in
 * its defaults: how the picture is turned (`cameraRotation`), the shape of
 * the notebook's pages (`notebookPageShape`, learned from the first page that
 * was actually found), and the box the pane is zoomed into. Per-viewer
 * conveniences: every read and write is guarded, and the pane works without them.
 */

/** What a capture brings in: the writing, the whole page, the raw picture. */
export type CaptureMode = "ink" | "page" | "raw"

const key = (name: string): string => `writemind.${name}`

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name))
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch { return fallback }
}

function write(name: string, value: unknown): void {
  try { localStorage.setItem(key(name), JSON.stringify(value)) } catch { /* a private window: this launch only */ }
}

/** Degrees clockwise, a multiple of 90 — "a video pane seven degrees off is a mistake, not a choice". */
export type Rotation = 0 | 90 | 180 | 270

export function normalRotation(degrees: number): Rotation {
  const turned = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  return turned as Rotation
}

export const rememberedRotation = (): Rotation => {
  const value = read<unknown>("cameraRotation", 0)
  return typeof value === "number" && Number.isFinite(value) ? normalRotation(value) : 0
}
export const rememberRotation = (rotation: Rotation): void => write("cameraRotation", rotation)

/** The notebook's page shape, long side over short, or null before any page was found. */
export const rememberedShape = (): number | null => {
  const value = read<unknown>("notebookPageShape", null)
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : null
}
export const rememberShape = (ratio: number): void => write("notebookPageShape", ratio)

/** The box the pane is zoomed into, in fractions of the pane (unzoomed picture), or null. */
export interface ZoomBox { x: number; y: number; width: number; height: number }
export const rememberedZoom = (): ZoomBox | null => {
  const value = read<Partial<ZoomBox> | null>("cameraZoom", null)
  if (!value || ![value.x, value.y, value.width, value.height].every((n) => typeof n === "number" && Number.isFinite(n))) return null
  return value as ZoomBox
}
export const rememberZoom = (box: ZoomBox | null): void => write("cameraZoom", box)
