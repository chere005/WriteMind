/**
 * main/pen/state.ts - pen-state.json: the capture switch and what the driver said about the system mapping. Small, written atomically (temp file + rename),
 * debounced, read tolerantly (garbage or a missing key means defaults; a wrong-typed key is ignored).
 */

import fs from "node:fs"
import path from "node:path"
import { DEFAULT_SETTINGS, type PenFeedSettings } from "../../shared/pen"

export interface PenState {
  version: 3
  settings: PenFeedSettings
  /** Whether the driver honoured the system mapping on this device (see mapping.ts); absent = never tried. */
  mapping: Record<string, "honoured" | "refused">
}

export function defaultState(): PenState {
  return { version: 3, settings: { ...DEFAULT_SETTINGS }, mapping: {} }
}

export function parseState(text: string | null): PenState {
  const out = defaultState()
  if (!text) return out
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return out }
  if (typeof raw !== "object" || raw === null) return out
  const o = raw as Record<string, unknown>
  const s = o.settings as Record<string, unknown> | undefined
  if (s && typeof s === "object") {
    if (typeof s.enabled === "boolean") out.settings.enabled = s.enabled
    // A version 2 file's mapSheet is the old default (off), not a choice: version 3 made it on.
    if (typeof s.mapSheet === "boolean" && typeof o.version === "number" && o.version >= 3) out.settings.mapSheet = s.mapSheet
  }
  // (An old file's "frames", the stored two-touch calibrations, is ignored: the frame comes from the device and the Orientation menu.)
  const m = o.mapping as Record<string, unknown> | undefined
  if (m && typeof m === "object") {
    for (const [key, v] of Object.entries(m).slice(0, 16)) if (v === "honoured" || v === "refused") out.mapping[key] = v
  }
  return out
}

export interface StateStore {
  get(): PenState
  update(change: (state: PenState) => void): void
  flushSync(): void
  dispose(): void
}

export function createStateStore(file: string, options: { debounceMs?: number; log?: (line: string) => void } = {}): StateStore {
  let text: string | null = null
  try { text = fs.readFileSync(file, "utf8") } catch { /* first run */ }
  const state = parseState(text)
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  const write = (): void => {
    if (!dirty) return
    dirty = false
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(state, null, 1))
      fs.renameSync(tmp, file)
    } catch (error) { options.log?.(`could not write pen-state.json: ${(error as Error)?.message}`) }
  }
  return {
    get: () => state,
    update(change) {
      change(state)
      dirty = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; write() }, options.debounceMs ?? 400)
      timer.unref?.()
    },
    flushSync() { if (timer) { clearTimeout(timer); timer = null } write() },
    dispose() { if (timer) { clearTimeout(timer); timer = null } write() },
  }
}
