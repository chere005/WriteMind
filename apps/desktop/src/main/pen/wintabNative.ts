/**
 * main/pen/wintabNative.ts - Wintab through koffi (Windows only; docs/spikes/DESIGN-pen-capture.md 4.2, owner IMPL-A).
 *
 * What it does: loads wintab32.dll, reads what the driver says about itself (interface, device, default contexts), opens ONE
 * context per session (a DATA context reads the tablet and moves nothing; a SYSTEM context additionally asks the driver to map the
 * pen to a screen rectangle and is only ever opened with a ready guard), polls packets, and guarantees every context is closed.
 *
 * CLEANUP. A leaked Wintab context outlives its process (measured: a hard-killed process leaves its contexts in the driver until
 * the driver restarts, and the driver counts them against a limit of 32):
 *  - every opened session is in `live`; `closeAllWintab()` closes them all and is wired (through win32.ts `registerRelease`) to
 *    the process exit paths: exit, SIGINT / SIGTERM / SIGBREAK, uncaughtExceptionMonitor. main.ts also calls it on before-quit /
 *    will-quit / window-all-closed. This is the only place (besides the guard) that calls WTClose;
 *  - each context is named "WriteMind pen <pid>" in lcName and its handle is written to a journal file (every live handle of this
 *    process); `recoverStaleContexts` at the next start closes a journalled handle whose lcName still carries a DEAD pid's marker
 *    and nothing else. It NEVER closes a handle it cannot positively identify: handle numbers are small integers handed out in no
 *    order and the driver lets any process close any handle, so guessing closes OTHER programs' contexts (the spike did once).
 *
 * FFI SAFETY (design 4.2). Every buffer a call writes into is a canaryBuffer (win32.ts): twice the computed size with a canary; the
 * WTInfo sizes come from the driver's own answer to a NULL call; LOGCONTEXTW must be the 212 bytes the driver reports; the packet size
 * computed from the mask is proven by a ONE-PACKET probe into a canary buffer before the poll buffer is used (a mismatch is a
 * PacketSizeMismatch: the backend moves down the mask ladder or fails with both sizes); no native call happens inside a koffi callback.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import {
  CXO, LOGCONTEXT_SIZE, MASK_LADDER, WT_DEFBASE, WTI, decodeWintabPackets, isEraserCursor, maskIsUsable, packetSize, parseAxis, parseLogContext,
  writeLogContext, type LogContext, type RawPacket, type WintabAxis, type WintabCursor, type WintabDevice,
} from "./wintab"
import { createMessageWindow } from "./winmsg"
import {
  bind, canaryBuffer, FfiOverrun, isWin32, loadWin32, nativeBlockedReason, registerRelease, systemFileExists, type CanaryBuffer,
} from "./win32"

// ---------------------------------------------------------------------------------------------
// The low-level API (one koffi binding per driver entry point)
// ---------------------------------------------------------------------------------------------

export interface WintabApi {
  /** WTInfoW: the size comes from the driver (a NULL call first), the data lands in a canary buffer. `len` 0 = the category is not there. */
  info(category: number, index: number): { len: number; buf: Buffer }
  infoUint(category: number, index: number): number
  /** WTOpenW. 0n = failed (see lastError). */
  open(hwnd: bigint, context: Uint8Array, enable: boolean): bigint
  close(handle: bigint): boolean
  get(handle: bigint): LogContext | null
  setQueueSize(handle: bigint, n: number): boolean
  /** WTPacketsGet into `out` (a canary buffer): at most `max` packets; the caller bounds `max` by the buffer. */
  packets(handle: bigint, max: number, out: CanaryBuffer): number
  lastError(): number
}

let cached: WintabApi | { error: string } | null = null

/** Why Wintab cannot run here at all, or null. Cheap: a platform check and a file-exists. */
export function wintabBlockedReason(): string | null {
  const blocked = nativeBlockedReason()
  if (blocked) return blocked
  if (!systemFileExists("wintab32.dll")) return "wintab32.dll not found: the Wacom driver is not installed"
  return null
}

export function loadWintab(): WintabApi | { error: string } {
  if (cached) return cached
  const blocked = wintabBlockedReason()
  if (blocked) return { error: blocked } // not cached: the file may appear (a driver install) and the E2E flag is read live
  const w = loadWin32()
  if (!isWin32(w)) return (cached = { error: w.error })
  try {
    const wt = w.koffi.load("wintab32.dll")
    const WTInfoW = bind<(category: number, index: number, out: Buffer | null) => number>(wt, "uint32 WTInfoW(uint32 category, uint32 index, void *out)")
    const WTOpenW = bind<(hwnd: bigint, ctx: Buffer, enable: number) => number | bigint>(wt, "uintptr_t WTOpenW(uintptr_t hwnd, void *ctx, int enable)")
    const WTClose = bind<(h: bigint) => number>(wt, "int WTClose(uintptr_t hctx)")
    const WTGetW = bind<(h: bigint, ctx: Buffer) => number>(wt, "int WTGetW(uintptr_t hctx, void *ctx)")
    const WTQueueSizeSet = bind<(h: bigint, n: number) => number>(wt, "int WTQueueSizeSet(uintptr_t hctx, int n)")
    const WTPacketsGet = bind<(h: bigint, max: number, out: Buffer) => number>(wt, "int WTPacketsGet(uintptr_t hctx, int max, void *out)")
    const api: WintabApi = {
      info(category, index) {
        const len = WTInfoW(category, index, null)
        if (!len || len > 1 << 16) return { len: 0, buf: Buffer.alloc(0) }
        const c = canaryBuffer(len)
        const got = WTInfoW(category, index, c.buf)
        c.check(`WTInfoW(${category},${index})`)
        return { len: got, buf: c.buf.subarray(0, c.size) }
      },
      infoUint(category, index) {
        const r = api.info(category, index)
        return r.len >= 4 ? r.buf.readUInt32LE(0) : r.len >= 2 ? r.buf.readUInt16LE(0) : r.len >= 1 ? r.buf.readUInt8(0) : 0
      },
      open(hwnd, context, enable) {
        const c = canaryBuffer(LOGCONTEXT_SIZE)
        c.buf.set(context.subarray(0, LOGCONTEXT_SIZE))
        const h = WTOpenW(hwnd, c.buf, enable ? 1 : 0)
        c.check("WTOpenW")
        return BigInt(h)
      },
      close: (h) => WTClose(h) !== 0,
      get(h) {
        const c = canaryBuffer(LOGCONTEXT_SIZE)
        const ok = WTGetW(h, c.buf)
        c.check("WTGetW")
        return ok ? parseLogContext(c.view()) : null
      },
      setQueueSize: (h, n) => WTQueueSizeSet(h, n) !== 0,
      packets: (h, max, out) => WTPacketsGet(h, max, out.buf),
      lastError: w.lastError,
    }
    return (cached = api)
  } catch (e) {
    return (cached = { error: `wintab32.dll did not load: ${e instanceof Error ? e.message : String(e)}` })
  }
}

// ---------------------------------------------------------------------------------------------
// Reading what the driver says about itself
// ---------------------------------------------------------------------------------------------

const utf16 = (b: Buffer, len: number): string => b.subarray(0, Math.max(0, len)).toString("utf16le").replace(/\0[\s\S]*$/, "")

export interface WintabInterface {
  vendor: string
  specVersion: string
  implVersion: string
  devices: number
  cursors: number
  maxContexts: number
}

export function readInterface(api: WintabApi): WintabInterface {
  const ver = (i: number): string => { const v = api.infoUint(WTI.INTERFACE, i) & 0xffff; return `${v >> 8}.${v & 255}` }
  const id = api.info(WTI.INTERFACE, 1)
  return {
    vendor: utf16(id.buf, id.len).trim(), specVersion: ver(2), implVersion: ver(3),
    devices: api.infoUint(WTI.INTERFACE, 4), cursors: api.infoUint(WTI.INTERFACE, 5), maxContexts: api.infoUint(WTI.INTERFACE, 6),
  }
}

/** Open contexts in the whole driver (WTI_STATUS STA_CONTEXTS / STA_SYSCTXS): used to prove a clean close. */
export function contextCounts(api: WintabApi): { contexts: number; system: number } {
  return { contexts: api.infoUint(WTI.STATUS, 1), system: api.infoUint(WTI.STATUS, 2) }
}

function readAxes(api: WintabApi, device: number, index: number, count: number): WintabAxis[] {
  const r = api.info(WTI.DEVICES + device, index)
  const out: WintabAxis[] = []
  for (let i = 0; i < count; i++) out.push(r.len >= 16 * (i + 1) ? parseAxis(r.buf, i) : { min: 0, max: 0, units: 0, resolution: 0 })
  return out
}

export function readCursors(api: WintabApi, firstCursor: number, count: number): WintabCursor[] {
  const out: WintabCursor[] = []
  for (let i = 0; i < Math.min(count, 32); i++) {
    const c = WTI.CURSORS + firstCursor + i
    const nm = api.info(c, 1)
    const cur: WintabCursor = {
      index: firstCursor + i,
      name: utf16(nm.buf, nm.len).trim(),
      buttons: api.infoUint(c, 4) & 0xff,
      capabilities: api.infoUint(c, 19),
      type: api.infoUint(c, 20),
      isEraser: false,
    }
    cur.isEraser = isEraserCursor(cur)
    out.push(cur)
  }
  return out
}

export function readDevice(api: WintabApi, device = 0): WintabDevice {
  const nm = api.info(WTI.DEVICES + device, 1)
  const [x] = readAxes(api, device, 12, 1)
  const [y] = readAxes(api, device, 13, 1)
  const [pressure] = readAxes(api, device, 15, 1)
  const orientation = readAxes(api, device, 17, 3) as [WintabAxis, WintabAxis, WintabAxis]
  return {
    name: utf16(nm.buf, nm.len).trim(), x: x!, y: y!, pressure: pressure!, orientation,
    pktRate: api.infoUint(WTI.DEVICES + device, 5),
    pktData: api.infoUint(WTI.DEVICES + device, 6),
    cursors: readCursors(api, api.infoUint(WTI.DEVICES + device, 4), api.infoUint(WTI.DEVICES + device, 3)),
  }
}

/** The driver's default data (or system) context. Asserts the driver's own LOGCONTEXTW size (212 on every driver seen). */
export function readDefaultContext(api: WintabApi, system: boolean, device = 0): LogContext {
  const r = api.info(system ? WTI.DSCTXS + device : WTI.DDCTXS + device, 0)
  if (r.len !== LOGCONTEXT_SIZE) throw new Error(`WTInfo default context returned ${r.len} bytes, this build expects LOGCONTEXTW to be ${LOGCONTEXT_SIZE}`)
  return parseLogContext(r.buf)
}

// ---------------------------------------------------------------------------------------------
// A context session
// ---------------------------------------------------------------------------------------------

export const CONTEXT_MARKER = "WriteMind pen"

/** The first packet read was bigger than the mask says: the layout we computed is not the driver's. Not fatal by itself (next mask). */
export class PacketSizeMismatch extends Error {
  constructor(readonly mask: number, readonly expected: number, readonly wroteAtLeast: number) {
    super(`expected ${expected} bytes a packet (mask 0x${mask.toString(16)}), the driver wrote at least ${wroteAtLeast}`)
    this.name = "PacketSizeMismatch"
  }
}

export interface OpenOptions {
  hwnd: bigint
  /** "data" reads the tablet and moves no cursor. "system" sets CXO_SYSTEM and maps the pen to `sysRect`. */
  mode?: "data" | "system"
  /** SYSTEM mode only: the screen rectangle (physical pixels) the tablet is mapped to. */
  sysRect?: { x: number; y: number; width: number; height: number }
  device?: number
  queueSize?: number
  /** Where every live handle of this process is journalled for recovery after a hard kill. */
  journalPath?: string
  packetMask?: number
}

export interface WintabSessionLike {
  readonly handle: bigint
  /** The packet layout the driver STORED (it may differ from what was asked). */
  readonly mask: number
  /** The context as the driver stored it after WTOpen. */
  readonly context: LogContext
  readonly isOpen: boolean
  /** Throws FfiOverrun (the canary broke: fatal) or PacketSizeMismatch (the first packet: next mask). */
  poll(): RawPacket[]
  close(): void
}

export interface OpenResult {
  session: WintabSessionLike | null
  error: string | null
  /** The mask the driver stored when it differs from the one asked for (traced by the caller). */
  maskChanged?: { asked: number; stored: number }
  context: LogContext | null
}

const live = new Set<WintabSession>()
const journals = new Map<string, Set<string>>()

function writeJournal(path: string): void {
  const handles = journals.get(path)
  try {
    if (!handles || handles.size === 0) { journals.delete(path); if (existsSync(path)) unlinkSync(path); return }
    writeFileSync(path, JSON.stringify({ pid: process.pid, handles: [...handles], at: Date.now() }))
  } catch { /* the journal is a convenience: the guard and the exit hooks are the primary releases */ }
}
function journalAdd(path: string | undefined, handle: bigint): void {
  if (!path) return
  const set = journals.get(path) ?? new Set<string>()
  set.add(handle.toString())
  journals.set(path, set)
  writeJournal(path)
}
function journalRemove(path: string | undefined, handle: bigint): void {
  if (!path) return
  journals.get(path)?.delete(handle.toString())
  writeJournal(path)
}

export class WintabSession implements WintabSessionLike {
  readonly size: number
  private readonly pk: CanaryBuffer
  private closed = false
  private probed = false

  private constructor(
    private readonly api: WintabApi,
    readonly handle: bigint,
    readonly mask: number,
    readonly context: LogContext,
    private readonly journalPath: string | undefined,
    readonly maxPackets: number,
  ) {
    this.size = packetSize(mask)
    this.pk = canaryBuffer(this.size * maxPackets)
    live.add(this)
  }

  static open(api: WintabApi, o: OpenOptions): OpenResult {
    const asked = o.packetMask ?? MASK_LADDER[0]!
    const system = o.mode === "system"
    const base = readDefaultContext(api, system, o.device ?? 0)
    // The input rectangle is the whole tablet as the driver reports it; the output is the same units, so a packet's x / y are raw tablet units.
    const ctx: LogContext = {
      ...base,
      name: `${CONTEXT_MARKER} ${process.pid}`,
      options: (base.options | CXO.MESSAGES | (system ? CXO.SYSTEM : 0)) >>> 0,
      status: 0,
      msgBase: WT_DEFBASE,
      pktData: asked, pktMode: 0, moveMask: asked, btnDnMask: 0xffffffff, btnUpMask: 0xffffffff,
      outOrg: [base.inOrg[0], base.inOrg[1], 0], outExt: [base.inExt[0], base.inExt[1], 0],
    }
    if (system) {
      if (!o.sysRect) return { session: null, error: "a system context needs the sheet rectangle", context: null }
      ctx.sysMode = 0
      ctx.sysOrg = [Math.round(o.sysRect.x), Math.round(o.sysRect.y)]
      ctx.sysExt = [Math.max(1, Math.round(o.sysRect.width)), Math.max(1, Math.round(o.sysRect.height))]
    }
    const raw = writeLogContext(ctx)
    const h = api.open(o.hwnd, raw, true)
    if (!h) return { session: null, error: `WTOpenW failed (GetLastError ${api.lastError()})`, context: null }
    let stored = api.get(h)
    if (!stored) stored = parseLogContext(raw)
    // From here a handle exists: any failure below must close it.
    try {
      let mask = asked
      let maskChanged: OpenResult["maskChanged"]
      if (stored.pktData !== asked) {
        maskChanged = { asked, stored: stored.pktData }
        if (!maskIsUsable(stored.pktData)) {
          try { api.close(h) } catch { /* nothing more to do */ }
          return { session: null, error: `context opened but the driver stored a different packet mask (0x${stored.pktData.toString(16)})`, context: stored, maskChanged }
        }
        mask = stored.pktData
      }
      const queue = o.queueSize ?? 256
      api.setQueueSize(h, queue)
      const session = new WintabSession(api, h, mask, stored, o.journalPath, 256)
      journalAdd(o.journalPath, h)
      return { session, error: null, context: stored, ...(maskChanged ? { maskChanged } : {}) }
    } catch (e) {
      try { api.close(h) } catch { /* nothing more to do */ }
      return { session: null, error: `context setup failed: ${e instanceof Error ? e.message : String(e)}`, context: stored }
    }
  }

  /** Everything queued since the last poll (at most maxPackets per call; call again if it returns that many). */
  poll(): RawPacket[] {
    if (this.closed) return []
    if (!this.probed) return this.probe()
    // never ask for more packets than the buffer holds twice over (design 4.2 FFI safety #1)
    const ask = Math.max(1, Math.min(this.maxPackets, Math.floor(this.pk.buf.length / (2 * this.size))))
    const n = this.api.packets(this.handle, ask, this.pk)
    this.pk.check("WTPacketsGet")
    return n > 0 ? decodeWintabPackets(this.pk.view(), this.mask, Math.min(n, ask)) : []
  }

  /** The first packet: read ONE into a buffer whose canary sits at the computed packet size, before the big buffer is trusted. */
  private probe(): RawPacket[] {
    const one = canaryBuffer(this.size)
    const n = this.api.packets(this.handle, 1, one)
    if (n <= 0) return []
    const extra = one.overrun()
    if (extra > 0) throw new PacketSizeMismatch(this.mask, this.size, this.size + extra)
    this.probed = true
    return decodeWintabPackets(one.view(), this.mask, 1)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    live.delete(this)
    try { this.api.close(this.handle) } catch { /* nothing more to do */ }
    journalRemove(this.journalPath, this.handle)
  }

  get isOpen(): boolean { return !this.closed }
}

/** Close every context this process opened. Safe to call any number of times. */
export function closeAllWintab(): void {
  for (const s of [...live]) s.close()
}

export const openSessionCount = (): number => live.size

let exitHooked = false
/** Close on every way a process ends that runs JavaScript (win32.ts hooks exit, SIGINT / SIGTERM / SIGBREAK, uncaughtExceptionMonitor). */
export function installWintabExitCleanup(): void {
  if (exitHooked) return
  exitHooked = true
  registerRelease(closeAllWintab)
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" }
}

/**
 * After a hard kill: close the journalled handles if (and only if) the driver still shows OUR marker with a DEAD pid in the context's
 * name. Returns how many were closed.
 */
export function recoverStaleContexts(api: Pick<WintabApi, "get" | "close">, journalPath: string): number {
  if (!existsSync(journalPath)) return 0
  let closed = 0
  try {
    const j = JSON.parse(readFileSync(journalPath, "utf8")) as { pid?: number; handles?: string[] }
    const dead = typeof j.pid === "number" && j.pid !== process.pid && !pidAlive(j.pid)
    if (dead) {
      for (const hs of j.handles ?? []) {
        if (!/^\d{1,19}$/.test(hs)) continue
        const h = BigInt(hs)
        const c = api.get(h)
        const m = c ? /^WriteMind pen (\d+)$/.exec(c.name) : null
        if (m && Number(m[1]) === j.pid && api.close(h)) closed++
      }
      unlinkSync(journalPath)
    }
  } catch { /* an unreadable journal is simply stale */ }
  return closed
}

// ---------------------------------------------------------------------------------------------
// What the backend needs, as one injectable object (tests fake it; the real one is below)
// ---------------------------------------------------------------------------------------------

export interface WintabNative {
  available(): { ok: true } | { ok: false; reason: string }
  readInterface(): WintabInterface
  readDevice(index: number): WintabDevice
  open(o: OpenOptions): OpenResult
  recoverStale(journalPath: string): number
  contextCounts(): { contexts: number; system: number }
  highResTimer(on: boolean): void
  createWindow(onMessage: (msg: number, wParam: bigint, lParam: bigint) => void): { hwnd: bigint; destroy(): void }
}

export function realWintabNative(): WintabNative {
  const api = (): WintabApi => {
    const a = loadWintab()
    if ("error" in a) throw new Error(a.error)
    return a
  }
  return {
    available() {
      const a = loadWintab()
      return "error" in a ? { ok: false, reason: a.error } : { ok: true }
    },
    readInterface: () => readInterface(api()),
    readDevice: (i) => readDevice(api(), i),
    open: (o) => WintabSession.open(api(), o),
    recoverStale: (p) => recoverStaleContexts(api(), p),
    contextCounts: () => contextCounts(api()),
    highResTimer(on) {
      const w = loadWin32()
      if (isWin32(w)) w.highResTimer(on)
    },
    createWindow(onMessage) {
      const win = createMessageWindow(onMessage, "wintab")
      return { hwnd: win.hwnd, destroy: () => win.destroy() }
    },
  }
}

/**
 * Facts for `EnvDeps.wintabFacts`: the interface the driver reports, the device's extents, the open-context counts. Read-only (no
 * context is opened). null when Wintab cannot run here, when the call fails, and under E2E.
 */
export function wintabFacts(): Record<string, string | number | boolean | null> | null {
  try {
    const a = loadWintab()
    if ("error" in a) return null
    const i = readInterface(a)
    const facts: Record<string, string | number | boolean | null> = {
      vendor: i.vendor || null, spec: i.specVersion, impl: i.implVersion, devices: i.devices, cursors: i.cursors, maxContexts: i.maxContexts,
    }
    if (i.devices > 0) {
      const d = readDevice(a, 0)
      const c = contextCounts(a)
      facts.device = d.name || null
      facts.x = `${d.x.min}..${d.x.max}`
      facts.y = `${d.y.min}..${d.y.max}`
      facts.pressureMax = d.pressure.max
      facts.tilt = d.orientation[0].max !== 0 || d.orientation[1].max !== 0
      facts.pktRate = d.pktRate
      facts.eraserCursor = d.cursors.some((k) => k.isEraser)
      facts.openContexts = c.contexts
      facts.openSystemContexts = c.system
    }
    return facts
  } catch {
    return null
  }
}

// FfiOverrun is re-exported so the backend and the tests have one import for both fatal and ladder errors.
export { FfiOverrun }
