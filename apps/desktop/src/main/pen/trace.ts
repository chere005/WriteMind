/**
 * main/pen/trace.ts - pen-trace.jsonl (docs/spikes/DESIGN-pen-capture.md section 10). Owner: IMPL-B (wimpl-b-webhid).
 *
 * The always-on flight recorder of the pen feed: with no check run at all there is already evidence of what each backend saw the
 * first time a pen came near. One JSON object per line, `k` says which kind:
 *
 *   session  v, at, ...env                 every open(); also resets the per-session caps below
 *   ev       t, b, e, d?                   every transition (b = backend name | manager | renderer | containment | check)
 *   lay      t, b, dev, layout, ...        device / HID layout dump at backend start (TraceSink.event(.., "layout", {dev, layout}) lands here)
 *   raw      t, b, n, hex, note?           one raw packet / report. first 400 per backend, then every 25th, 2000 records at most
 *   smp      t, b, x, y, p, f              a normalised sample (before the frame transform). every 10th up to 3000 per backend
 *   dom      t, ty, pt, x, y, bu, p        DOM pen events seen by the gate. first 100, then every 10th up to 1500
 *   cur      t, x, y                       OS cursor polls used as calibration pairs. 400
 *   st       t, s                          compact FeedStatus, every 5 s while open (the caller decides the cadence)
 *
 * `enabled()` false (settings.trace) drops raw / smp / dom / cur from the FILE but keeps session / ev / lay / st (tiny, and they are the
 * diagnostics). The writer buffers and appends at most every 500 ms, rotates at 2 MiB keeping pen-trace.jsonl, .1 and .2, never throws
 * to the caller (a full disk must not reach the pen), and tolerates a torn last line on read.
 *
 * Privacy: keys named title / windowTitle / fg are removed from any record (no window titles, no note content anywhere).
 *
 * `createTrace` returns a `PenTrace`, which is a `TraceFile` plus the typed record writers for the manager (session, smp, dom, cur, st).
 * A caller that only knows `TraceFile` simply cannot call them.
 */
import fs from "node:fs"
import path from "node:path"
import { sampleFlags } from "../../shared/pen"
import type { BackendName, PenSample } from "../../shared/pen"
import type { PenPaths, TraceFile } from "./types"

export const TRACE_MAX_BYTES = 2 * 1024 * 1024
export const TRACE_FLUSH_MS = 500
export const TRACE_KEEP_FILES = 3
export const TRACE_RING = 200
/** Hex records kept in memory per backend for Copy diagnostics, whatever the settings say. */
export const TRACE_FIRST_RAW_KEPT = 24
const MAX_LINE = 64 * 1024
const MAX_LAY_LINE = 160 * 1024

export const TRACE_CAPS = {
  rawFirst: 400, rawEvery: 25, rawMax: 2000,
  smpEvery: 10, smpMax: 3000,
  domFirst: 100, domEvery: 10, domMax: 1500,
  curMax: 400,
} as const

export interface DomTraceRecord { t: number; ty: string; pt: string; x: number; y: number; bu: number; p: number }

export interface PenTrace extends TraceFile {
  /** A new open(): writes the `session` record and resets the per-session caps. */
  session(data: Record<string, unknown>): void
  /** A normalised sample, BEFORE the frame transform. Called for every sample; the caps are applied here. */
  smp(backend: BackendName, sample: PenSample): void
  dom(record: DomTraceRecord): void
  cur(t: number, x: number, y: number): void
  st(t: number, status: unknown): void
}

export interface TraceOptions {
  /** Epoch ms; tests inject. */
  now?: () => number
  /** Buffered write interval. */
  flushMs?: number
  maxBytes?: number
}

const SCRUB_KEYS = new Set(["title", "windowTitle", "fg"])

/** Remove window-title-like keys (two levels deep) and make the value JSON-safe. */
export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return typeof value === "function" || typeof value === "symbol" ? undefined : value
  if (Array.isArray(value)) return depth > 6 ? [] : value.map((v) => scrub(v, depth + 1))
  if (depth > 6) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SCRUB_KEYS.has(k)) continue
    out[k] = scrub(v, depth + 1)
  }
  return out
}

const r5 = (v: number): number => Math.round(v * 1e5) / 1e5
const r3 = (v: number): number => Math.round(v * 1e3) / 1e3

/** Assignable to `CreateTrace`; the optional third argument is for tests (clock, flush interval, size cap). */
export function createTrace(paths: PenPaths, enabled: () => boolean, options: TraceOptions = {}): PenTrace {
  const now = options.now ?? (() => Date.now())
  const flushMs = options.flushMs ?? TRACE_FLUSH_MS
  const maxBytes = options.maxBytes ?? TRACE_MAX_BYTES
  const file = paths.trace

  let closed = false
  let pending: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()
  let size: number | null = null
  let dirReady = false

  const ring: string[] = []
  const firstRaws: Record<string, string[]> = {}
  // per-session counters
  const rawN: Record<string, number> = {}
  const rawWritten: Record<string, number> = {}
  const smpN: Record<string, number> = {}
  const smpWritten: Record<string, number> = {}
  let domN = 0
  let domWritten = 0
  let curWritten = 0

  const push = (line: string): void => {
    if (closed) return
    pending.push(line)
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null
        void flush()
      }, flushMs)
      timer.unref?.()
    }
  }

  const encode = (rec: Record<string, unknown>, limit = MAX_LINE): string | null => {
    try {
      const line = JSON.stringify(rec)
      if (line.length <= limit) return line
      return JSON.stringify({ k: rec.k, t: rec.t, b: rec.b, e: rec.e, truncated: line.length })
    } catch {
      return null
    }
  }

  const write = (rec: Record<string, unknown>, limit?: number): string | null => {
    const line = encode(rec, limit)
    if (line !== null) push(line)
    return line
  }

  const remember = (line: string | null): void => {
    if (line === null) return
    ring.push(line)
    if (ring.length > TRACE_RING) ring.shift()
  }

  const ensureDir = (): void => {
    if (dirReady) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    dirReady = true
  }

  const currentSize = (): number => {
    if (size !== null) return size
    try {
      size = fs.statSync(file).size
    } catch {
      size = 0
    }
    return size
  }

  const rotate = (): void => {
    // pen-trace.jsonl -> .1 -> .2, the old .2 is dropped (TRACE_KEEP_FILES = 3 files in all)
    for (let i = TRACE_KEEP_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`
      const to = `${file}.${i}`
      try {
        fs.rmSync(to, { force: true })
        if (fs.existsSync(from)) fs.renameSync(from, to)
      } catch {
        /* a locked file must not reach the pen */
      }
    }
    size = 0
  }

  const takePending = (): string => {
    if (!pending.length) return ""
    const text = pending.join("\n") + "\n"
    pending = []
    return text
  }

  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    chain = chain.then(async () => {
      const text = takePending()
      if (!text) return
      try {
        ensureDir()
        if (currentSize() + Buffer.byteLength(text) > maxBytes && currentSize() > 0) rotate()
        await fs.promises.appendFile(file, text, "utf8")
        size = (size ?? 0) + Buffer.byteLength(text)
      } catch {
        /* swallowed on purpose */
      }
    })
    return chain
  }

  const flushSync = (): void => {
    const text = takePending()
    if (!text) return
    try {
      ensureDir()
      if (currentSize() + Buffer.byteLength(text) > maxBytes && currentSize() > 0) rotate()
      fs.appendFileSync(file, text, "utf8")
      size = (size ?? 0) + Buffer.byteLength(text)
    } catch {
      /* swallowed on purpose */
    }
  }

  const trace: PenTrace = {
    path: file,

    event(source, name, data) {
      const t = now()
      if (name === "layout" || name === "lay") {
        const d = (scrub(data ?? {}) ?? {}) as Record<string, unknown>
        write({ k: "lay", t, b: source, ...d }, MAX_LAY_LINE)
        remember(encode({ k: "ev", t, b: source, e: name }))
        return
      }
      const rec: Record<string, unknown> = { k: "ev", t, b: source, e: name }
      if (data !== undefined) rec.d = scrub(data)
      const line = write(rec)
      remember(line)
    },

    raw(backend, t, hex, note) {
      const kept = (firstRaws[backend] ??= [])
      if (kept.length < TRACE_FIRST_RAW_KEPT) kept.push(hex)
      const n = (rawN[backend] = (rawN[backend] ?? 0) + 1)
      if (!enabled()) return
      const c = TRACE_CAPS
      if (n > c.rawFirst && (n - c.rawFirst) % c.rawEvery !== 0) return
      const written = rawWritten[backend] ?? 0
      if (written >= c.rawMax) return
      rawWritten[backend] = written + 1
      const rec: Record<string, unknown> = { k: "raw", t: r3(t), b: backend, n, hex }
      if (note) rec.note = note
      write(rec)
    },

    session(data) {
      for (const k of Object.keys(rawN)) delete rawN[k]
      for (const k of Object.keys(rawWritten)) delete rawWritten[k]
      for (const k of Object.keys(smpN)) delete smpN[k]
      for (const k of Object.keys(smpWritten)) delete smpWritten[k]
      for (const k of Object.keys(firstRaws)) delete firstRaws[k]
      domN = 0
      domWritten = 0
      curWritten = 0
      const rec = { k: "session", v: 1, at: new Date(now()).toISOString(), ...((scrub(data) ?? {}) as Record<string, unknown>) }
      remember(write(rec, MAX_LAY_LINE))
    },

    smp(backend, s) {
      if (!enabled()) return
      const n = (smpN[backend] = (smpN[backend] ?? 0) + 1)
      if ((n - 1) % TRACE_CAPS.smpEvery !== 0) return
      const w = smpWritten[backend] ?? 0
      if (w >= TRACE_CAPS.smpMax) return
      smpWritten[backend] = w + 1
      write({ k: "smp", t: r3(s.t), b: backend, x: r5(s.x), y: r5(s.y), p: r5(s.p), f: sampleFlags(s) })
    },

    dom(rec) {
      if (!enabled()) return
      domN++
      const c = TRACE_CAPS
      if (domN > c.domFirst && (domN - c.domFirst) % c.domEvery !== 0) return
      if (domWritten >= c.domMax) return
      domWritten++
      write({ k: "dom", t: r3(rec.t), ty: rec.ty, pt: rec.pt, x: r3(rec.x), y: r3(rec.y), bu: rec.bu, p: r3(rec.p) })
    },

    cur(t, x, y) {
      if (!enabled()) return
      if (curWritten >= TRACE_CAPS.curMax) return
      curWritten++
      write({ k: "cur", t: r3(t), x: r3(x), y: r3(y) })
    },

    st(t, status) {
      write({ k: "st", t: r3(t), s: scrub(status) })
    },

    tail: (n) => ring.slice(-Math.max(0, n)),
    firstRaw: (n) => Object.fromEntries(Object.entries(firstRaws).map(([k, v]) => [k, v.slice(0, n)])),
    flush,
    close() {
      if (closed) return
      flushSync()
      closed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
  return trace
}

// ---------------------------------------------------------------------------------------------
// Reading (the analyser, the replay, the tests)
// ---------------------------------------------------------------------------------------------

export type TraceRecord =
  | { k: "session"; v: number; at: string; [key: string]: unknown }
  | { k: "ev"; t: number; b: string; e: string; d?: unknown }
  | { k: "lay"; t: number; b: string; dev?: unknown; layout?: unknown; [key: string]: unknown }
  | { k: "raw"; t: number; b: string; n: number; hex: string; note?: string }
  | { k: "smp"; t: number; b: string; x: number; y: number; p: number; f: number }
  | { k: "dom"; t: number; ty: string; pt: string; x: number; y: number; bu: number; p: number }
  | { k: "cur"; t: number; x: number; y: number }
  | { k: "st"; t: number; s: unknown }

const KINDS = new Set(["session", "ev", "lay", "raw", "smp", "dom", "cur", "st"])

/** Parse a trace tolerantly: blank lines, a torn last line from a kill, and unknown kinds are skipped. */
export function parseTrace(text: string): TraceRecord[] {
  const out: TraceRecord[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (rec && typeof rec === "object" && typeof (rec as { k?: unknown }).k === "string" && KINDS.has((rec as { k: string }).k)) out.push(rec as TraceRecord)
  }
  return out
}

/** The hex string of a raw record as bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "")
  const out = new Uint8Array(clean.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  let hex = ""
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i]! & 0xff).toString(16).padStart(2, "0")
  return hex
}

/** Read pen-trace.jsonl and its rotations, oldest first. Missing files are skipped. */
export function readTraceFiles(file: string): string {
  let text = ""
  for (const f of [`${file}.2`, `${file}.1`, file]) {
    try {
      text += fs.readFileSync(f, "utf8")
      if (!text.endsWith("\n")) text += "\n"
    } catch {
      /* not there */
    }
  }
  return text
}
