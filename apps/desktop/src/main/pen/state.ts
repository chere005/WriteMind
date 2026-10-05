/**
 * main/pen/state.ts - pen-state.json (docs/spikes/DESIGN-pen-capture.md section 11), owned by IMPL-D.
 *
 * Small, written atomically (temp file + rename, the previous good copy kept as `.bak`), debounced, read tolerantly: garbage or a
 * missing key means defaults, a wrong-typed key is ignored, unknown keys are kept and written back. A file that does not parse is
 * copied to `.corrupt` before anything overwrites it, so nothing the person had is silently lost.
 */

import fs from "node:fs"
import { promises as fsp } from "node:fs"
import path from "node:path"
import {
  BACKEND_ORDER, DEFAULT_SETTINGS, type BackendName, type Box, type CapabilityRecord, type CapabilityState, type ContainSetting,
  type FrameRecord, type FrameTransform, type NativeBackendName, type PenFeedSettings, type Turn,
} from "../../shared/pen"

export interface PenState {
  version: 1
  settings: PenFeedSettings
  device: { key: string; name: string; seenAt: string } | null
  winner: { backend: BackendName; at: string } | null
  frames: Record<string, FrameRecord>
  capabilities: { driver: CapabilityRecord; sink: CapabilityRecord; clip: CapabilityRecord }
  pointerMode: "pen" | "mouse" | null
  demoted: Partial<Record<BackendName, string>>
  lastCheck: { at: string; overall: "ok" | "partial" | "none"; winner: BackendName | null; summary: string } | null
  display: { bounds: Box; scale: number } | null
  /**
   * The crash breadcrumb (design 5.8): backend -> ISO time of a start that has not been marked safe yet. Written synchronously before a
   * native backend starts and cleared when the start failed, the backend was stopped normally, or it has run NATIVE_SAFE_MS. One that
   * is still here at the next launch means the app stopped while it was starting (see applyCrashBreadcrumbs).
   */
  inFlight: Record<string, string>
  /** Backends switched off by a leftover breadcrumb, with the plain words for the chip and the check. Turning the switch back on clears the fault. */
  faults: Record<string, { at: string; note: string }>
  /** Keys this version does not know, written back untouched. */
  extra: Record<string, unknown>
}

const untested = (): CapabilityRecord => ({ state: "untested", at: null, note: null })

export function defaultState(): PenState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, backends: { ...DEFAULT_SETTINGS.backends } },
    device: null,
    winner: null,
    frames: {},
    capabilities: { driver: untested(), sink: untested(), clip: untested() },
    pointerMode: null,
    demoted: {},
    lastCheck: null,
    display: null,
    inFlight: {},
    faults: {},
    extra: {},
  }
}

// ---- tolerant readers

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === "string"
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isBackend = (v: unknown): v is BackendName => isString(v) && (BACKEND_ORDER as readonly string[]).includes(v)
const CONTAIN: readonly ContainSetting[] = ["auto", "driver", "sink", "clip", "none"]
const CAPABILITY_STATES: readonly CapabilityState[] = ["untested", "honored", "ignored", "effective", "ineffective", "unsafe"]

function readSettings(raw: unknown): PenFeedSettings {
  const out: PenFeedSettings = { ...DEFAULT_SETTINGS, backends: { ...DEFAULT_SETTINGS.backends } }
  if (!isObject(raw)) return out
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled
  if (typeof raw.swapButtons === "boolean") out.swapButtons = raw.swapButtons
  if (typeof raw.trace === "boolean") out.trace = raw.trace
  if (raw.prefer === null || isBackend(raw.prefer)) out.prefer = raw.prefer as BackendName | null
  if (CONTAIN.includes(raw.contain as ContainSetting)) out.contain = raw.contain as ContainSetting
  if (isObject(raw.backends)) {
    for (const name of Object.keys(out.backends) as NativeBackendName[]) {
      const v = raw.backends[name]
      if (typeof v === "boolean") out.backends[name] = v
    }
  }
  return out
}

function readFrame(raw: unknown): FrameRecord | null {
  if (!isObject(raw) || !isObject(raw.frame)) return null
  const turn = raw.frame.turn
  if (turn !== 0 && turn !== 1 && turn !== 2 && turn !== 3) return null
  if (typeof raw.frame.flipY !== "boolean") return null
  const sources = ["default", "cursor", "dom", "strokes", "manual", "screen"]
  const source = sources.includes(raw.source as string) ? (raw.source as FrameRecord["source"]) : "default"
  const frame: FrameTransform = { turn: turn as Turn, flipY: raw.frame.flipY }
  return {
    frame, source, rms: isNumber(raw.rms) ? raw.rms : null, margin: isNumber(raw.margin) ? raw.margin : null,
    at: isString(raw.at) ? raw.at : new Date(0).toISOString(),
  }
}

function readCapability(raw: unknown): CapabilityRecord {
  if (!isObject(raw)) return untested()
  const state = CAPABILITY_STATES.includes(raw.state as CapabilityState) ? (raw.state as CapabilityState) : "untested"
  return { state, at: isString(raw.at) ? raw.at : null, note: isString(raw.note) ? raw.note : null }
}

const readBox = (raw: unknown): Box | null =>
  isObject(raw) && isNumber(raw.x) && isNumber(raw.y) && isNumber(raw.width) && isNumber(raw.height)
    ? { x: raw.x, y: raw.y, width: raw.width, height: raw.height } : null

const KNOWN = ["version", "settings", "device", "winner", "frames", "capabilities", "pointerMode", "demoted", "lastCheck", "display", "inFlight", "faults"]

/** Text to a state; anything wrong becomes a default, never a throw. */
export function parseState(text: string | null): PenState {
  const state = defaultState()
  if (text === null) return state
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return state }
  if (!isObject(raw)) return state
  state.settings = readSettings(raw.settings)
  if (isObject(raw.device) && isString(raw.device.key) && isString(raw.device.name)) {
    state.device = { key: raw.device.key, name: raw.device.name, seenAt: isString(raw.device.seenAt) ? raw.device.seenAt : "" }
  }
  if (isObject(raw.winner) && isBackend(raw.winner.backend)) {
    state.winner = { backend: raw.winner.backend, at: isString(raw.winner.at) ? raw.winner.at : "" }
  }
  if (isObject(raw.frames)) {
    for (const [key, value] of Object.entries(raw.frames)) {
      const frame = readFrame(value)
      if (frame) state.frames[key] = frame
    }
  }
  if (isObject(raw.capabilities)) {
    state.capabilities = {
      driver: readCapability(raw.capabilities.driver), sink: readCapability(raw.capabilities.sink), clip: readCapability(raw.capabilities.clip),
    }
  }
  if (raw.pointerMode === "pen" || raw.pointerMode === "mouse") state.pointerMode = raw.pointerMode
  if (isObject(raw.demoted)) {
    for (const [name, value] of Object.entries(raw.demoted)) if (isBackend(name) && isString(value)) state.demoted[name] = value
  }
  if (isObject(raw.lastCheck) && isString(raw.lastCheck.at)) {
    const overall = raw.lastCheck.overall === "ok" || raw.lastCheck.overall === "partial" ? raw.lastCheck.overall : "none"
    state.lastCheck = {
      at: raw.lastCheck.at, overall, winner: isBackend(raw.lastCheck.winner) ? raw.lastCheck.winner : null,
      summary: isString(raw.lastCheck.summary) ? raw.lastCheck.summary : "",
    }
  }
  if (isObject(raw.display)) {
    const bounds = readBox(raw.display.bounds)
    if (bounds && isNumber(raw.display.scale)) state.display = { bounds, scale: raw.display.scale }
  }
  if (isObject(raw.inFlight)) {
    for (const [name, value] of Object.entries(raw.inFlight)) if (isString(value)) state.inFlight[name] = value
  }
  if (isObject(raw.faults)) {
    for (const [name, value] of Object.entries(raw.faults)) {
      if (isObject(value) && isString(value.note)) state.faults[name] = { at: isString(value.at) ? value.at : "", note: value.note }
    }
  }
  for (const [key, value] of Object.entries(raw)) if (!KNOWN.includes(key)) state.extra[key] = value
  return state
}

/** The words a fault carries (design 5.8). */
export const CRASH_NOTE = "the app stopped within 30 s of starting this backend last time"

/**
 * Launch-time half of the crash breadcrumb (design 5.8): every backend still marked in flight is switched off with a fault, the marks
 * are cleared, and the names are returned (the registry traces `crash-suspect` for each). Several in flight are ALL switched off, because
 * nobody can tell which one did it, and `dom` (which never has a breadcrumb) still carries the pen. Pure: the caller writes the state.
 */
export function applyCrashBreadcrumbs(state: PenState, now: string): string[] {
  const names = Object.keys(state.inFlight).filter((n) => isBackend(n) && n !== "inject" && n !== "dom" && n !== "overlay")
  for (const name of names) {
    state.settings.backends[name as NativeBackendName] = false
    state.faults[name] = { at: now, note: CRASH_NOTE }
  }
  state.inFlight = {}
  return names
}

/** The person turned a backend's switch back on: its fault is forgotten (design 5.8). */
export function clearFault(state: PenState, name: string): boolean {
  if (!(name in state.faults)) return false
  delete state.faults[name]
  return true
}

export function serializeState(state: PenState): string {
  const { extra, ...known } = state
  return JSON.stringify({ ...extra, ...known }, null, 2)
}

// ---- the file

/** Read the state file: the main copy, else the `.bak`, else defaults. A main file that does not parse is copied to `.corrupt` first. */
export function loadStateFile(file: string): PenState {
  const read = (path: string): string | null => { try { return fs.readFileSync(path, "utf8") } catch { return null } }
  const parses = (text: string | null): boolean => { if (text === null) return false; try { return isObject(JSON.parse(text)) } catch { return false } }
  const main = read(file)
  if (parses(main)) return parseState(main)
  if (main !== null && main.trim() !== "") { try { fs.writeFileSync(file + ".corrupt", main) } catch { /* not worth a crash */ } }
  const bak = read(file + ".bak")
  return parses(bak) ? parseState(bak) : defaultState()
}

export interface StateStore {
  get(): PenState
  /** Change the state in place; the write follows after the debounce. */
  update(change: (state: PenState) => void): void
  /** Write now (asynchronously). */
  flush(): Promise<void>
  /** Write now, synchronously: the exit path. */
  flushSync(): void
  dispose(): void
}

export interface StateStoreOptions { debounceMs?: number; log?: (line: string) => void }

export function createStateStore(file: string, options: StateStoreOptions = {}): StateStore {
  const debounceMs = options.debounceMs ?? 400
  const state = loadStateFile(file)
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> = Promise.resolve()

  const keepBackup = (): void => {
    try {
      const text = fs.readFileSync(file, "utf8")
      JSON.parse(text)
      fs.writeFileSync(file + ".bak", text)
    } catch { /* no good previous copy to keep */ }
  }

  const writeNow = async (): Promise<void> => {
    dirty = false
    const text = serializeState(state)
    try {
      keepBackup()
      await fsp.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined)
      const temp = file + ".tmp"
      await fsp.writeFile(temp, text)
      await fsp.rename(temp, file)
    } catch (error) {
      options.log?.(`pen-state write failed: ${(error as Error).message}`)
    }
  }

  const schedule = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      writing = writing.then(writeNow)
    }, debounceMs)
    timer.unref?.()
  }

  return {
    get: () => state,
    update(change) { change(state); dirty = true; schedule() },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null }
      if (dirty) writing = writing.then(writeNow)
      await writing
    },
    flushSync() {
      if (timer) { clearTimeout(timer); timer = null }
      if (!dirty) return
      dirty = false
      try {
        keepBackup()
        const temp = file + ".tmp"
        fs.writeFileSync(temp, serializeState(state))
        fs.renameSync(temp, file)
      } catch (error) { options.log?.(`pen-state write failed: ${(error as Error).message}`) }
    },
    dispose() { if (timer) { clearTimeout(timer); timer = null } },
  }
}
