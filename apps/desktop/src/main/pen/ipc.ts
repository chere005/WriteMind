/**
 * main/pen/ipc.ts - the IPC of the pen feed.
 *
 * `installPenIpc` registers one handler per channel in `PEN_CHANNELS` and pushes the manager's samples, status and events to the notes
 * window. EVERY handler verifies its sender (`event.sender === win.webContents`) and is wrapped in `guarded`: an exception is logged and
 * swallowed, because Electron would otherwise answer it with its "JavaScript error in the main process" dialog.
 *
 * It imports no Electron (only types), so the whole file is a vitest: `ipc` and `window` are the narrow shapes below.
 */

import {
  PEN_CHANNELS, clamp01,
  type FeedEvent, type FeedStatus, type PenBatch, type PenFeedSettings, type PenSample, type SheetReport, type TraceSink,
  type WindowState,
} from "../../shared/pen"
import type { FeedManagerEx } from "./manager"

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
  /** WRITEMIND_E2E: also register pen:inject / pen:e2e-state / pen:e2e-config. */
  e2e: boolean
}

export interface PenIpc { dispose(): void }

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const TURNS: readonly number[] = [0, 1, 2, 3]

export function readSettingsPatch(raw: unknown): Partial<PenFeedSettings> {
  const out: Partial<PenFeedSettings> = {}
  if (typeof raw !== "object" || raw === null) return out
  const o = raw as Record<string, unknown>
  if (typeof o.enabled === "boolean") out.enabled = o.enabled
  if (typeof o.mapSheet === "boolean") out.mapSheet = o.mapSheet
  return out
}

/** The renderer's sheet report: a finite rectangle inside a sane range and the turns, or null (no sheet). */
export function readSheet(raw: unknown): SheetReport | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as { rect?: Record<string, unknown>; turns?: unknown }
  const r = o.rect
  if (!r || typeof r !== "object") return null
  const { x, y, width, height } = r as Record<string, unknown>
  if (![x, y, width, height].every((v) => finite(v) && Math.abs(v) < 100000)) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  const turns = TURNS.includes(o.turns as number) ? (o.turns as 0 | 1 | 2 | 3) : 0
  return { rect: { x: x as number, y: y as number, width: width as number, height: height as number }, turns }
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
    if (finite(o.tiltX)) sample.tiltX = Math.max(-90, Math.min(90, o.tiltX))
    if (finite(o.tiltY)) sample.tiltY = Math.max(-90, Math.min(90, o.tiltY))
    out.push(sample)
  }
  return out
}

/** Wrap a handler so that nothing it throws reaches Electron's dialog: it is logged and `fallback` is the answer. */
export function guarded<A extends unknown[], R>(trace: Pick<TraceSink, "event">, name: string, fn: (...args: A) => R, fallback: R): (...args: A) => R {
  return (...args: A): R => {
    try { return fn(...args) } catch (error) {
      try { trace.event("manager", "ipc-error", { channel: name, message: (error as Error)?.message }) } catch { /* ignore */ }
      return fallback
    }
  }
}

export function installPenIpc(deps: PenIpcDeps): PenIpc {
  const { ipc, manager, trace } = deps
  const removers: (() => void)[] = []
  const fromNotes = (event: IpcEventLike): boolean => {
    const win = deps.window()
    return win !== null && !win.isDestroyed() && event.sender === win.webContents
  }
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
  handle(PEN_CHANNELS.open, async (): Promise<FeedStatus> => manager.open())
  handle(PEN_CHANNELS.close, (_e, reason: unknown) => { manager.close(typeof reason === "string" ? reason.slice(0, 80) : "renderer"); return undefined })
  handle(PEN_CHANNELS.status, () => manager.status())
  handle(PEN_CHANNELS.settings, () => manager.settings())
  handle(PEN_CHANNELS.setSettings, (_e, patch: unknown) => manager.update(readSettingsPatch(patch)))
  handle(PEN_CHANNELS.mappingRetry, () => manager.retryMapping())

  // ---- renderer -> main, send
  listen(PEN_CHANNELS.sheet, (_e, raw: unknown) => manager.setSheet(readSheet(raw)))
  listen(PEN_CHANNELS.panic, (_e, reason: unknown) => manager.panic(typeof reason === "string" ? reason.slice(0, 80) : "renderer"))

  // ---- E2E only
  if (deps.e2e) {
    ipc.handle(PEN_CHANNELS.e2eInject, guarded(trace, PEN_CHANNELS.e2eInject, (event: IpcEventLike, raw: unknown) => {
      if (!fromNotes(event)) return undefined
      const which = typeof raw === "object" && raw !== null && (raw as { backend?: unknown }).backend === "inject-tablet" ? "inject-tablet" : "inject"
      manager.inject(readInjected(raw), which)
      return undefined
    }, undefined))
    removers.push(() => ipc.removeHandler(PEN_CHANNELS.e2eInject))
    handle(PEN_CHANNELS.e2eState, () => manager.status())
    handle(PEN_CHANNELS.e2eConfig, (_e, raw: unknown) => {
      const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>
      return manager.e2eConfig({
        ...(typeof o.native === "boolean" ? { native: o.native } : {}),
        ...(typeof o.focused === "boolean" ? { focused: o.focused } : {}),
        ...(typeof o.capture === "boolean" ? { capture: o.capture } : {}),
        ...(typeof o.tablet === "boolean" ? { tablet: o.tablet } : {}),
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
// The window: its own focus / visibility goes straight to the manager, so a blur is known even when the page is busy
// ---------------------------------------------------------------------------------------------

const STATE_EVENTS = ["focus", "blur", "minimize", "restore", "show", "hide"]

/** Forward the window's focus / visibility to the manager. Returns the unwatch. */
export function watchWindow(win: WindowLike, manager: Pick<FeedManagerEx, "setWindowState">): () => void {
  const state = (): WindowState => ({ focused: win.isFocused(), visible: win.isVisible(), minimized: win.isMinimized() })
  const onState = (): void => { if (!win.isDestroyed()) { try { manager.setWindowState(state()) } catch { /* ignore */ } } }
  for (const name of STATE_EVENTS) win.on(name, onState)
  onState()
  return () => {
    if (win.isDestroyed()) return
    for (const name of STATE_EVENTS) win.removeListener(name, onState)
  }
}
