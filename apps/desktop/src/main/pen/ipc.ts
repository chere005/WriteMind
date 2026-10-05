/**
 * main/pen/ipc.ts - the IPC of the pen feed (docs/spikes/DESIGN-pen-capture.md 3.3), owned by IMPL-D.
 *
 * `installPenIpc` registers one handler per channel in `PEN_CHANNELS` and pushes the manager's samples, status, events and check snapshots
 * to the notes window. EVERY handler verifies its sender (`event.sender === win.webContents`), as grab.ts did with `fromNotes`: the sink
 * and the helper windows have channels of their own and never reach these. Every handler is wrapped in `guarded` (design 14.1 #20): an
 * exception is traced and swallowed, because Electron would otherwise answer it with its "JavaScript error in the main process" dialog.
 *
 * It imports no Electron (only types), so the whole file is a vitest: `ipc` and `window` are the narrow shapes below, and main.ts passes
 * `ipcMain` and the real BrowserWindow.
 */

import {
  BACKEND_ORDER, CHECK_STEPS, PEN_CHANNELS, clamp01,
  type BackendName, type CheckStepId, type DomPenReport, type FeedEvent, type FeedStatus, type FrameTransform, type PenBatch, type PenFeedSettings,
  type PenSample, type SheetGeometry, type TraceSink, type Turn, type WindowState, type Witness,
} from "../../shared/pen"
import type { FeedManagerEx } from "./manager"
import type { CheckSnapshot } from "../../shared/pen"
import type { DomIngest } from "./types"

// ---------------------------------------------------------------------------------------------
// The narrow shapes (Electron's ipcMain / BrowserWindow satisfy them)
// ---------------------------------------------------------------------------------------------

export interface IpcSender { send(channel: string, ...args: unknown[]): void; isDestroyed(): boolean }
export interface IpcEventLike { sender: unknown }
export interface IpcLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: any[]) => unknown): void
  on(channel: string, listener: (event: IpcEventLike, ...args: any[]) => void): void
  removeHandler(channel: string): void
  removeListener(channel: string, listener: (event: IpcEventLike, ...args: any[]) => void): void
}
export interface WindowLike {
  webContents: IpcSender
  isDestroyed(): boolean
  on(event: string, listener: () => void): void
  removeListener(event: string, listener: () => void): void
  isFocused(): boolean
  isVisible(): boolean
  isMinimized(): boolean
}

export interface PenIpcDeps {
  ipc: IpcLike
  /** The notes window (null while there is none). */
  window(): WindowLike | null
  manager: FeedManagerEx
  trace: Pick<TraceSink, "event">
  /** Routes `pen:dom` (the `dom` backend's `ingest`); null when the pen subsystem is off. */
  dom(): DomIngest | null
  /** The text of Copy diagnostics (design 9.7). */
  diagnostics(): string
  /** Show the trace file in Explorer. */
  revealTrace(): void
  /** WRITEMIND_E2E: also register pen:inject / pen:e2e-state / pen:e2e-config. */
  e2e: boolean
  now?: () => number
}

export interface PenIpc { dispose(): void }

// ---------------------------------------------------------------------------------------------
// Sanitising what the renderer sends (it is our own page, but a bug there must not reach the manager)
// ---------------------------------------------------------------------------------------------

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const TURNS: readonly number[] = [0, 1, 2, 3]

export function readSheet(raw: unknown): SheetGeometry | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  const r = o.rect as Record<string, unknown> | undefined
  if (!r || !finite(r.x) || !finite(r.y) || !finite(r.width) || !finite(r.height)) return null
  if (!(r.width > 0) || !(r.height > 0) || r.width > 20000 || r.height > 20000) return null
  const turns = TURNS.includes(o.turns as number) ? (o.turns as Turn) : 0
  return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, turns, aspect: finite(o.aspect) && o.aspect > 0 ? o.aspect : r.width / r.height }
}

export function readSettingsPatch(raw: unknown): Partial<PenFeedSettings> {
  const out: Partial<PenFeedSettings> = {}
  if (typeof raw !== "object" || raw === null) return out
  const o = raw as Record<string, unknown>
  if (typeof o.enabled === "boolean") out.enabled = o.enabled
  if (typeof o.swapButtons === "boolean") out.swapButtons = o.swapButtons
  if (typeof o.trace === "boolean") out.trace = o.trace
  if (o.prefer === null || (typeof o.prefer === "string" && (BACKEND_ORDER as readonly string[]).includes(o.prefer) && o.prefer !== "inject")) out.prefer = o.prefer as BackendName | null
  if (typeof o.contain === "string" && ["auto", "driver", "sink", "clip", "none"].includes(o.contain)) out.contain = o.contain as PenFeedSettings["contain"]
  if (typeof o.backends === "object" && o.backends !== null) {
    const backends: Record<string, boolean> = {}
    for (const [name, value] of Object.entries(o.backends)) {
      if (typeof value === "boolean" && name !== "inject" && (BACKEND_ORDER as readonly string[]).includes(name)) backends[name] = value
    }
    if (Object.keys(backends).length > 0) out.backends = backends as PenFeedSettings["backends"]
  }
  return out
}

export function readFrame(raw: unknown): FrameTransform | null | undefined {
  if (raw === null) return null
  if (typeof raw !== "object") return undefined
  const o = raw as Record<string, unknown>
  if (!TURNS.includes(o.turn as number) || typeof o.flipY !== "boolean") return undefined
  return { turn: o.turn as Turn, flipY: o.flipY }
}

export function readWitness(raw: unknown, now: number): Witness | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  const source = o.source
  if (source !== "dom" && source !== "pointer-range" && source !== "wizard" && source !== "cursor") return null
  const w: Witness = { source, inRange: o.inRange === true, at: now }
  if (typeof o.screenDip === "object" && o.screenDip !== null) {
    const d = o.screenDip as Record<string, unknown>
    if (finite(d.x) && finite(d.y)) w.screenDip = { x: d.x, y: d.y }
  }
  if (finite(o.buttons)) w.buttons = o.buttons | 0
  if (typeof o.pointerType === "string") w.pointerType = o.pointerType.slice(0, 12)
  return w
}

/** A report list for the `dom` backend: only objects, at most 512 (the backend checks every number). */
export function readDomReports(raw: unknown): DomPenReport[] {
  return Array.isArray(raw) ? (raw.slice(0, 512) as DomPenReport[]) : []
}

export function readInjected(raw: unknown): PenSample[] {
  if (typeof raw !== "object" || raw === null) return []
  const list = (raw as { samples?: unknown }).samples
  if (!Array.isArray(list)) return []
  const out: PenSample[] = []
  for (const s of list.slice(0, 4096)) {
    if (typeof s !== "object" || s === null) continue
    const o = s as Record<string, unknown>
    if (!finite(o.t) || !finite(o.x) || !finite(o.y)) continue
    const sample: PenSample = {
      t: o.t, x: clamp01(o.x), y: clamp01(o.y), p: finite(o.p) ? clamp01(o.p) : 0,
      tip: o.tip === true, lower: o.lower === true, upper: o.upper === true, eraser: o.eraser === true,
      inRange: o.inRange !== false, backend: typeof o.backend === "string" ? o.backend : "inject",
    }
    if (finite(o.tiltX)) sample.tiltX = o.tiltX
    if (finite(o.tiltY)) sample.tiltY = o.tiltY
    out.push(sample)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The installer
// ---------------------------------------------------------------------------------------------

const STEP_IDS: readonly string[] = CHECK_STEPS.map((s) => s.id)
const WITNESS_MIN_GAP_MS = 8

/** Wrap a callback so that nothing it throws escapes (design 14.1 #20). */
export function guarded<A extends unknown[], R>(trace: Pick<TraceSink, "event">, name: string, fn: (...args: A) => R, fallback: R): (...args: A) => R {
  return (...args: A): R => {
    try { return fn(...args) } catch (error) {
      try { trace.event("manager", "ipc-error", { handler: name, message: (error as Error).message }) } catch { /* ignore */ }
      return fallback
    }
  }
}

export function installPenIpc(deps: PenIpcDeps): PenIpc {
  const { ipc, manager, trace } = deps
  const now = deps.now ?? (() => performance.timeOrigin + performance.now())
  const removers: (() => void)[] = []
  const fromNotes = (event: IpcEventLike): boolean => {
    const win = deps.window()
    return win !== null && !win.isDestroyed() && event.sender === win.webContents
  }
  /** Register an invoke handler that answers only the notes window. */
  const handle = (channel: string, fn: (event: IpcEventLike, ...args: any[]) => unknown): void => {
    const safe = guarded(trace, channel, fn, undefined as unknown)
    ipc.handle(channel, (event, ...args) => (fromNotes(event) ? safe(event, ...args) : undefined))
    removers.push(() => ipc.removeHandler(channel))
  }
  const listen = (channel: string, fn: (event: IpcEventLike, ...args: any[]) => void): void => {
    const safe = guarded(trace, channel, fn, undefined as void)
    const wrapped = (event: IpcEventLike, ...args: any[]): void => { if (fromNotes(event)) safe(event, ...args) }
    ipc.on(channel, wrapped)
    removers.push(() => ipc.removeListener(channel, wrapped))
  }

  // ---- renderer -> main, invoke
  handle(PEN_CHANNELS.open, async (_e, sheet: unknown): Promise<FeedStatus> => manager.open(readSheet(sheet)))
  handle(PEN_CHANNELS.close, (_e, reason: unknown) => { manager.close(typeof reason === "string" ? reason.slice(0, 80) : "renderer"); return undefined })
  handle(PEN_CHANNELS.status, () => manager.status())
  handle(PEN_CHANNELS.settings, () => manager.settings())
  handle(PEN_CHANNELS.setSettings, (_e, patch: unknown) => manager.update(readSettingsPatch(patch)))
  handle(PEN_CHANNELS.checkStart, () => manager.checkStart())
  handle(PEN_CHANNELS.checkStep, (_e, id: unknown) => (typeof id === "string" && STEP_IDS.includes(id) ? manager.checkStep(id as CheckStepId) : manager.checkSnapshot()))
  handle(PEN_CHANNELS.checkCancel, () => manager.checkCancel())
  handle(PEN_CHANNELS.checkCopy, () => deps.diagnostics())
  handle(PEN_CHANNELS.containTest, async (_e, mechanism: unknown) => manager.containTest(mechanism === "sink" ? "sink" : "driver"))
  handle(PEN_CHANNELS.frameSet, (_e, frame: unknown) => {
    const f = readFrame(frame)
    return f === undefined ? manager.status() : manager.setFrame(f)
  })
  handle(PEN_CHANNELS.revealTrace, () => { deps.revealTrace(); return undefined })

  // ---- renderer -> main, send
  listen(PEN_CHANNELS.sheet, (_e, sheet: unknown) => manager.setSheet(readSheet(sheet)))
  let lastWitnessAt = -Infinity
  listen(PEN_CHANNELS.witness, (_e, raw: unknown) => {
    const at = now()
    if (at - lastWitnessAt < WITNESS_MIN_GAP_MS) return
    lastWitnessAt = at
    const w = readWitness(raw, at)
    if (w) manager.witness(w)
  })
  listen(PEN_CHANNELS.dom, (_e, raw: unknown) => {
    const reports = readDomReports(raw)
    if (reports.length > 0) deps.dom()?.ingest(reports)
  })
  listen(PEN_CHANNELS.panic, (_e, reason: unknown) => manager.panic(typeof reason === "string" ? reason.slice(0, 80) : "renderer"))

  // ---- E2E only
  if (deps.e2e) {
    ipc.handle(PEN_CHANNELS.e2eInject, guarded(trace, PEN_CHANNELS.e2eInject, (event: IpcEventLike, raw: unknown) => {
      if (!fromNotes(event)) return undefined
      manager.inject(readInjected(raw), "inject")
      return undefined
    }, undefined))
    removers.push(() => ipc.removeHandler(PEN_CHANNELS.e2eInject))
    handle(PEN_CHANNELS.e2eState, () => manager.status())
    handle(PEN_CHANNELS.e2eConfig, (_e, raw: unknown) => {
      const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>
      const backends = Array.isArray(o.backends) ? (o.backends.filter((b) => typeof b === "string" && (BACKEND_ORDER as readonly string[]).includes(b)) as BackendName[]) : undefined
      return manager.e2eConfig({
        ...(typeof o.native === "boolean" ? { native: o.native } : {}),
        ...(backends ? { backends } : {}),
        ...(typeof o.focused === "boolean" ? { focused: o.focused } : {}),
        ...(typeof o.capture === "boolean" ? { capture: o.capture } : {}),
      })
    })
  }

  // ---- main -> renderer
  const push = (channel: string, payload: unknown): void => {
    const win = deps.window()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(channel, payload)
  }
  const offs = [
    manager.onSamples((batch: PenBatch) => push(PEN_CHANNELS.samples, batch)),
    manager.onStatus((status: FeedStatus) => push(PEN_CHANNELS.statusPush, status)),
    manager.onEvent((event: FeedEvent) => push(PEN_CHANNELS.event, event)),
    manager.onCheck((snapshot: CheckSnapshot) => push(PEN_CHANNELS.check, snapshot)),
  ]

  return {
    dispose() {
      for (const off of offs) { try { off() } catch { /* ignore */ } }
      for (const remove of removers) { try { remove() } catch { /* ignore */ } }
      removers.length = 0
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The window: its own state goes straight to the manager (design 8.8), so a blur is known even when the page is busy
// ---------------------------------------------------------------------------------------------

const STATE_EVENTS = ["focus", "blur", "minimize", "restore", "show", "hide"]
const GEOMETRY_EVENTS = ["move", "resize", "maximize", "unmaximize", "moved", "resized"]

/** Forward the window's focus / visibility to the manager, and re-derive the physical sheet rectangle when it moves. Returns the unwatch. */
export function watchWindow(win: WindowLike, manager: Pick<FeedManagerEx, "setWindowState" | "setSheet" | "sheet">): () => void {
  const state = (): WindowState => ({ focused: win.isFocused(), visible: win.isVisible(), minimized: win.isMinimized() })
  const onState = (): void => { if (!win.isDestroyed()) { try { manager.setWindowState(state()) } catch { /* ignore */ } } }
  let timer: ReturnType<typeof setTimeout> | null = null
  const onGeometry = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (win.isDestroyed()) return
      // The physical rectangle follows the window (design 7.4): re-set the same sheet, main converts it again.
      try { manager.setSheet(manager.sheet()) } catch { /* ignore */ }
    }, 100)
    timer.unref?.()
  }
  for (const name of STATE_EVENTS) win.on(name, onState)
  for (const name of GEOMETRY_EVENTS) win.on(name, onGeometry)
  onState()
  return () => {
    if (timer) clearTimeout(timer)
    if (win.isDestroyed()) return
    for (const name of STATE_EVENTS) win.removeListener(name, onState)
    for (const name of GEOMETRY_EVENTS) win.removeListener(name, onGeometry)
  }
}
