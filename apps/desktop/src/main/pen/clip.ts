/**
 * clip.ts - the pure half of cursor containment and of the guard protocol (docs/spikes/DESIGN-pen-capture.md 7.5).
 * Ported from the containment spike (C:\CLAUDIO\spikes\contain-spike\clip.ts, 38 tests) and extended with the
 * Wintab holds and the guard's event lines.
 *
 * READ docs/spikes/wacom-containment.md: ClipCursor does NOT constrain a Windows-Ink pen (measured with synthetic
 * pen input), only MOUSE-class input (a real mouse, a synthetic cursor move, a Wacom driver in Mouse mode). So a clip is the
 * opt-in, safe way to confine a mouse-class cursor, and the trap-proofing around it is the reusable part:
 * a clip PERSISTS when the process that set it exits or is killed (measured), so a crash would leave the person's
 * mouse inside a rectangle. Three independent releases, none of which needs the app to be well:
 *   1. a LEASE: every arm lasts `leaseMs` and has to be renewed (heartbeat) or the guard lets go;
 *   2. a separate GUARD process owns the clip (guard.ts): app death = stdin EOF = released in ~14 ms;
 *   3. a startup SWEEP: a journal says "we clipped", so a clip that outlived everything is undone at the next launch.
 *
 * Nothing in this file touches the OS at import time. `win32Clip()` (koffi) is the one place in the app process
 * that may call ClipCursor, and only the guard and lease.ts ever call it with a rectangle (lease.ts: to release a
 * clip the guard could not, with NULL). Only erasable TypeScript syntax, so Node can run it unbuilt.
 */

import { createRequire } from "node:module"
import type * as KoffiNS from "koffi"
import type { Box } from "../../shared/pen"

/** Win32 RECT: right and bottom are EXCLUSIVE (a clip of 500..900 allows x = 899 at most; measured). */
export interface Rect { left: number; top: number; right: number; bottom: number }

export const MIN_CLIP_W = 240
export const MIN_CLIP_H = 160
/** A clip lease: without a beat inside this, the guard lets go (measured 807-851 ms). */
export const DEFAULT_LEASE_MS = 800
/** How often the holder beats while anything is held. */
export const DEFAULT_BEAT_MS = 250
/** No pen activity for this long: containment lets go. */
export const DEFAULT_IDLE_MS = 20_000
/** A Wintab DATA context is harmless (it reads and moves nothing): a hung app loses it only after this. */
export const DATA_LEASE_MS = 5_000
/** The independent panic chord the guard watches by itself: Ctrl+Alt+G, the same as the app's global shortcut. */
export const PANIC_KEY_LABEL = "Ctrl+Alt+G"

export const toRect = (b: Box): Rect => ({ left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height })
export const toBox = (r: Rect): Box => ({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top })

export function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
}

export function intersect(a: Rect, b: Rect): Rect {
  const r = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
  return r.right > r.left && r.bottom > r.top ? r : { left: 0, top: 0, right: 0, bottom: 0 }
}

export type RectCheck = { ok: true; rect: Rect } | { ok: false; reason: string }

/**
 * A rect is only clipped to when it is plainly a sane working area: whole numbers, inside the virtual screen
 * (clamped, never grown), at least MIN_CLIP_W x MIN_CLIP_H, and not the whole screen (that is no clip at all).
 * An un-sane rect is REFUSED, never "repaired" into something the person did not see.
 */
export function validateClipRect(input: Rect, screen: Rect, minW = MIN_CLIP_W, minH = MIN_CLIP_H): RectCheck {
  const vals = [input.left, input.top, input.right, input.bottom]
  if (vals.some((v) => typeof v !== "number" || !Number.isFinite(v))) return { ok: false, reason: "not-finite" }
  const r = { left: Math.round(input.left), top: Math.round(input.top), right: Math.round(input.right), bottom: Math.round(input.bottom) }
  if (r.right <= r.left || r.bottom <= r.top) return { ok: false, reason: "empty" }
  const c = intersect(r, screen)
  if (c.right - c.left < minW || c.bottom - c.top < minH) return { ok: false, reason: "too-small" }
  if (rectsEqual(c, screen)) return { ok: false, reason: "whole-screen" }
  return { ok: true, rect: c }
}

/**
 * At launch: is the clip that is active right now one WE left behind? Only if a record says we set exactly this
 * rect. A clip with no record (a game, a remote-desktop client) is never touched.
 */
export function staleClipDecision(marker: { rect: Rect } | null, current: Rect, screen: Rect): "release" | "leave" | "none" {
  if (rectsEqual(current, screen)) return "none"
  if (marker && rectsEqual(marker.rect, current)) return "release"
  return "leave"
}

// ---------------------------------------------------------------------------------------------------------------
// Guard wire protocol (one text line per message over the child's stdin / stdout)
// ---------------------------------------------------------------------------------------------------------------

export type WintabMode = "data" | "system"

export type GuardCommand =
  | { cmd: "arm"; rect: Rect; leaseMs: number }
  | { cmd: "beat" }
  | { cmd: "free" }
  | { cmd: "hold-wintab"; handle: string; appPid: number; mode: WintabMode }
  | { cmd: "drop-wintab"; handle: string }
  | { cmd: "status" }
  | { cmd: "quit" }

/** A Wintab handle is a pointer-sized integer, carried as a decimal string. Nothing else is ever accepted. */
export const isHandleString = (s: string): boolean => /^[0-9]{1,20}$/.test(s) && s !== "0"

export function encodeGuardCommand(c: GuardCommand): string {
  switch (c.cmd) {
    case "arm": return `arm ${c.rect.left} ${c.rect.top} ${c.rect.right} ${c.rect.bottom} ${Math.round(c.leaseMs)}\n`
    case "hold-wintab": return `hold-wintab ${c.handle} ${c.appPid} ${c.mode}\n`
    case "drop-wintab": return `drop-wintab ${c.handle}\n`
    default: return `${c.cmd}\n`
  }
}

export function parseGuardCommand(line: string): GuardCommand | null {
  const p = line.trim().split(/\s+/)
  switch (p[0]) {
    case "arm": {
      const n = p.slice(1, 6).map(Number)
      if (p.length < 5 || n.slice(0, 4).some((v) => !Number.isInteger(v))) return null
      const lease = p.length >= 6 && Number.isFinite(n[4]) ? n[4] : DEFAULT_LEASE_MS
      if (lease < 100 || lease > 10_000) return null
      return { cmd: "arm", rect: { left: n[0], top: n[1], right: n[2], bottom: n[3] }, leaseMs: lease }
    }
    case "hold-wintab": {
      const pid = Number(p[2])
      if (p.length !== 4 || !isHandleString(p[1]) || !Number.isInteger(pid) || pid <= 0) return null
      if (p[3] !== "data" && p[3] !== "system") return null
      return { cmd: "hold-wintab", handle: p[1], appPid: pid, mode: p[3] }
    }
    case "drop-wintab":
      if (p.length !== 2 || !isHandleString(p[1])) return null
      return { cmd: "drop-wintab", handle: p[1] }
    case "beat": case "free": case "status": case "quit": return { cmd: p[0] }
    default: return null
  }
}

/** What the guard says back, one line each. */
export type GuardEvent =
  | { ev: "ready" }
  | { ev: "armed"; rect: Rect }
  | { ev: "freed"; why: string }
  | { ev: "foreign"; why: string }
  | { ev: "expired" }
  | { ev: "held-wintab"; handle: string; mode: WintabMode }
  | { ev: "closed-wintab"; handle: string; why: string }
  | { ev: "panic-key" }
  | { ev: "status"; text: string }
  | { ev: "err"; message: string }

export function parseGuardEvent(line: string): GuardEvent | null {
  const t = line.trim()
  if (!t) return null
  const p = t.split(/\s+/)
  switch (p[0]) {
    case "ready": return { ev: "ready" }
    case "armed": {
      const n = p.slice(1, 5).map(Number)
      if (n.length !== 4 || n.some((v) => !Number.isInteger(v))) return null
      return { ev: "armed", rect: { left: n[0], top: n[1], right: n[2], bottom: n[3] } }
    }
    case "freed": return { ev: "freed", why: p.slice(1).join(" ") }
    case "foreign": return { ev: "foreign", why: p.slice(1).join(" ") }
    case "expired": return { ev: "expired" }
    case "held-wintab": return p.length === 3 && isHandleString(p[1]) && (p[2] === "data" || p[2] === "system") ? { ev: "held-wintab", handle: p[1], mode: p[2] } : null
    case "closed-wintab": return p.length >= 2 && isHandleString(p[1]) ? { ev: "closed-wintab", handle: p[1], why: p.slice(2).join(" ") } : null
    case "panic-key": return { ev: "panic-key" }
    case "status": return { ev: "status", text: p.slice(1).join(" ") }
    case "err": return { ev: "err", message: p.slice(1).join(" ") }
    default: return null
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The journal: what the guard holds right now, for the next launch's sweep (pen-leases.json)
// ---------------------------------------------------------------------------------------------------------------

export interface LeaseJournal {
  guardPid: number
  appPid: number
  clip: Rect | null
  wintab: { handle: string; mode: WintabMode }[]
  at: number
}

/** Tolerant: a torn or foreign file is "no journal", never a throw. */
export function parseJournal(text: string): LeaseJournal | null {
  try {
    const j = JSON.parse(text) as Partial<LeaseJournal> | null
    if (!j || typeof j !== "object") return null
    const rect = (r: unknown): Rect | null => {
      const o = r as Partial<Rect> | null
      return o && [o.left, o.top, o.right, o.bottom].every((v) => Number.isInteger(v)) ? (o as Rect) : null
    }
    const wintab = Array.isArray(j.wintab)
      ? j.wintab.filter((w) => w && isHandleString(String((w as { handle: unknown }).handle)) && ((w as { mode: unknown }).mode === "data" || (w as { mode: unknown }).mode === "system"))
          .map((w) => ({ handle: String(w.handle), mode: w.mode }))
      : []
    if (!Number.isInteger(j.guardPid) || !Number.isInteger(j.appPid)) return null
    return { guardPid: j.guardPid as number, appPid: j.appPid as number, clip: rect(j.clip), wintab, at: typeof j.at === "number" ? j.at : 0 }
  } catch { return null }
}

/** The exact name every Wintab context of ours carries; the guard closes a handle only if WTGetW reports this. */
export const wintabMarker = (pid: number): string => `WriteMind pen ${pid}`

// ---------------------------------------------------------------------------------------------------------------
// Win32 (Windows only; koffi is loaded lazily, never at import)
// ---------------------------------------------------------------------------------------------------------------

export interface Win32Clip {
  getClip(): Rect
  /** null releases. true = the OS accepted it. */
  setClip(r: Rect | null): boolean
  /** The virtual screen (what "no clip" reports). */
  screen(): Rect
}

let w32: Win32Clip | null = null
/** koffi-backed ClipCursor / GetClipCursor / GetSystemMetrics. Throws if koffi or Windows is missing. */
export function win32Clip(koffiPath = "koffi"): Win32Clip {
  if (w32) return w32
  if (process.platform !== "win32") throw new Error("not Windows")
  const koffi = createRequire(import.meta.url)(koffiPath) as typeof KoffiNS
  const user32 = koffi.load("user32.dll")
  koffi.struct("WMP_CLIP_RECT", { left: "int32", top: "int32", right: "int32", bottom: "int32" })
  const clipCursor = user32.func("bool __stdcall ClipCursor(WMP_CLIP_RECT *r)") as (r: Rect | null) => boolean
  const getClipCursor = user32.func("bool __stdcall GetClipCursor(_Out_ WMP_CLIP_RECT *r)") as (r: Rect) => boolean
  const metric = user32.func("int __stdcall GetSystemMetrics(int i)") as (i: number) => number
  w32 = {
    getClip() { const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 }; getClipCursor(r); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } },
    setClip(r) { return r ? clipCursor({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }) : clipCursor(null) },
    screen() { const x = metric(76), y = metric(77); return { left: x, top: y, right: x + metric(78), bottom: y + metric(79) } },
  }
  return w32
}
