/**
 * main/pen/mapping.ts - the system mapping: a second Wintab context (CXO_SYSTEM) whose lcSysOrg / lcSysExt are the SHEET in PHYSICAL screen
 * pixels. Per the Wintab spec the tablet then drives the system cursor only inside that screen area, so a stray tap cannot reach anything
 * outside the sheet. Pure logic over injected deps (no koffi, no Electron): the whole file is a vitest with a fake native layer and a fake cursor.
 *
 * SAFETY RULES (the point of this file):
 *  - The context lives ONLY while the pen is in range over a visible sheet, the window is in front and the sheet is not turned. The pen
 *    leaving range, a blur, the sheet closing, the feed stopping, any error, a violation: WTClose at once (`handle.stop()`), synchronously.
 *  - It is VERIFIED automatically: within MAP_VERIFY_MS of the pen moving, the polled system cursor must stay inside the sheet rectangle and
 *    track the pen's position mapped into it. Honoured -> remembered for this device ("honoured": still watched for violations). Not honoured,
 *    or anything looks wrong -> closed at once and remembered as "refused" for this device, so it is not retried every visit; only
 *    `retry()` (the Retry button in the Pen popover) forgets that.
 *  - With no Wintab, no koffi or no way to read the cursor the whole thing is a no-op (`available: false`).
 *  - The context is also closed by wintabNative's closeAllWintab (before-quit, will-quit, window closed, exit, uncaughtException).
 *  - STARVATION: a driver that gives packets only to the topmost context would silence the DATA context the moment this one opens. The system
 *    backend's packets are reported here (`systemPacket`), the data feed's too (`dataSeen`): packets arriving at the system context while
 *    the data context has been silent for STARVE_MS is a refusal, closed at once and remembered (so it is not tried every visit).
 */

import { LIVENESS, type Box, type MappingState, type SheetReport } from "../../shared/pen"

/** What `open` hands back: the live system context. `stop` closes it synchronously and is idempotent. */
export interface MapHandle {
  /** The sheet moved or was resized (physical px). The implementation debounces. */
  setRect(rect: Box): void
  stop(): void
}

export interface MappingDeps {
  /** True when a system context could be opened at all (Windows, koffi, wintab32.dll). Checked once per start. */
  available(): boolean
  /** Open the system context over `rect` (physical px). Null when it could not be opened. Never throws (a throw counts as null). */
  open(rect: Box): Promise<MapHandle | null> | MapHandle | null
  /** The system cursor in physical screen pixels, or null when it cannot be read. */
  cursor(): { x: number; y: number } | null
  /** The sheet in physical screen pixels (DPI-correct), or null when the window / display is unknown. */
  physical(sheet: SheetReport): Box | null
  now(): number
  /** What was learned about this device: "honoured" / "refused", or null (never tried). */
  recall(key: string): "honoured" | "refused" | null
  remember(key: string, verdict: "honoured" | "refused" | null): void
  trace(name: string, data?: Record<string, unknown>): void
}

export interface MappingController {
  state(): MappingState
  /** The device key (wintab name + extents) the verdict belongs to; null forgets the device. */
  setDevice(key: string | null): void
  setSheet(report: SheetReport | null): void
  /** The mapping is allowed at all right now: sheet open, window in front, the real tablet is the feed. */
  setWanted(on: boolean): void
  /** The pen came into / left range over the sheet. */
  pen(inRange: boolean): void
  /** The data feed delivered a batch (any, in range or not): the proof it is not starved. */
  dataSeen(): void
  /** The SYSTEM context's own backend decoded packets (the pen is moving): the watchdog against starving the data context. */
  systemPacket(): void
  /** The latest in-range sample in SHEET fractions (device frame, orientation 0), moving or not. */
  observe(u: number, v: number): void
  /** The window moved or was resized: the sheet is somewhere else on the screen. */
  refresh(): void
  /** The Retry button: forget "refused" for this device. */
  retry(): void
  /** Everything closed, now (and not wanted until `setWanted(true)` again). */
  stop(reason: string): void
  onChange(listener: () => void): () => void
}

interface Check { expected: Pt; seen: Pt; err: number; inside: boolean }
interface Pt { x: number; y: number }

/** Skip a check while the pen moves faster than this per sample (fractions of the sheet): the cursor lags the packet that produced it. */
const FAST = 0.02
/** Do not judge until the context has been open this long. */
const SETTLE_MS = 40
const CHECK_EVERY_MS = 40
/** Packets reach the system context but the data context has been silent this long: the driver starved it. */
const STARVE_MS = 150
/** A "honoured" mapping is watched: this many consecutive slow samples with the cursor outside the sheet (plus 3% slack) is a violation. */
const VIOLATIONS = 2
const SLACK = 0.03

export function createMappingController(deps: MappingDeps): MappingController {
  let key: string | null = null
  let sheet: SheetReport | null = null
  let wanted = false
  let inRange = false
  let handle: MapHandle | null = null
  let opening = 0 // generation of the open in flight
  let openedAt = 0
  let rect: Box | null = null
  let verified = false
  let checks: Check[] = []
  let firstMoveAt: number | null = null
  let lastCheckAt = -Infinity
  let prev: Pt | null = null
  let violations = 0
  let trying = false
  let inFlight = false
  let openLogged = false
  let lastDataAt = -Infinity
  const listeners = new Set<() => void>()
  const changed = (): void => { for (const l of [...listeners]) { try { l() } catch { /* a listener never breaks the pen */ } } }

  const verdict = (): "honoured" | "refused" | null => (key ? deps.recall(key) : null)

  const state = (): MappingState => {
    if (!deps.available()) return "unavailable"
    if (key && verdict() === "refused") return "refused"
    if (trying) return "trying"
    if (key && verdict() === "honoured") return "mapped"
    return "off"
  }

  const closeNow = (why: string): void => {
    opening++
    const h = handle
    handle = null
    const was = trying || h !== null || inFlight
    inFlight = false
    trying = false
    verified = false
    checks = []
    firstMoveAt = null
    violations = 0
    prev = null
    if (h) { try { h.stop() } catch { /* WTClose cannot be retried */ } }
    if (was) { if (openLogged) deps.trace("map-closed", { why }); openLogged = false; changed() }
  }

  const refuse = (why: string, data: Record<string, unknown> = {}): void => {
    closeNow(why)
    if (key) deps.remember(key, "refused")
    deps.trace("map-refused", { why, ...data })
    changed()
  }

  const wantOpen = (): boolean =>
    deps.available() && wanted && inRange && sheet !== null && sheet.turns === 0 && key !== null && verdict() !== "refused"

  const sync = (): void => {
    if (!wantOpen()) { if (handle || trying) closeNow(!inRange ? "pen out of range" : !wanted ? "not wanted" : sheet === null ? "no sheet" : sheet.turns !== 0 ? "sheet turned" : "refused"); return }
    const r = deps.physical(sheet!)
    if (!r || r.width < 8 || r.height < 8) { if (handle || trying) closeNow("no physical rectangle"); return }
    if (handle) {
      if (!rect || Math.abs(rect.x - r.x) > 1 || Math.abs(rect.y - r.y) > 1 || Math.abs(rect.width - r.width) > 1 || Math.abs(rect.height - r.height) > 1) {
        rect = r
        try { handle.setRect(r) } catch (e) { refuse("setRect failed", { message: (e as Error)?.message }) }
      }
      return
    }
    if (inFlight) return
    rect = r
    const gen = ++opening
    trying = verdict() !== "honoured"
    verified = verdict() === "honoured"
    checks = []; firstMoveAt = null; violations = 0; prev = null
    inFlight = true
    // One short line, and only while the mapping is still being judged: a remembered, honoured mapping reopens on every pen visit silently.
    openLogged = !verified
    if (openLogged) deps.trace("map-open", { w: r.width, h: r.height })
    let opened: Promise<MapHandle | null> | MapHandle | null
    try { opened = deps.open(r) } catch (e) { opened = null; deps.trace("map-open-error", { message: (e as Error)?.message }) }
    const land = (h: MapHandle | null): void => {
      if (gen !== opening) { try { h?.stop() } catch { /* ignore */ } return }
      inFlight = false
      if (!h) { trying = false; deps.trace("map-open-failed"); changed(); return }
      if (!wantOpen()) { try { h.stop() } catch { /* ignore */ } trying = false; changed(); return }
      handle = h
      openedAt = deps.now()
      changed()
    }
    if (opened && typeof (opened as Promise<MapHandle | null>).then === "function") {
      ;(opened as Promise<MapHandle | null>).then(land, (e: unknown) => { if (gen === opening) { inFlight = false; trying = false; deps.trace("map-open-error", { message: (e as Error)?.message }); changed() } })
    } else land(opened as MapHandle | null)
    changed()
  }

  const judge = (): void => {
    const need = LIVENESS.MAP_MIN_CHECKS
    const good = checks.filter((c) => c.inside && c.err <= LIVENESS.MAP_TOLERANCE)
    const spread = (f: (c: Check) => number): number => {
      const v = checks.map(f)
      return Math.max(...v) - Math.min(...v)
    }
    const expectedSpread = Math.max(spread((c) => c.expected.x), spread((c) => c.expected.y))
    const seenSpread = Math.max(spread((c) => c.seen.x), spread((c) => c.seen.y))
    if (checks.some((c) => !c.inside)) return refuse("the cursor left the sheet rectangle", { checks: checks.length })
    if (checks.length >= need && good.length / checks.length >= 0.75 && expectedSpread >= 0.1 && seenSpread >= 0.5 * expectedSpread) {
      verified = true
      trying = false
      if (key) deps.remember(key, "honoured")
      deps.trace("map-honoured", { checks: checks.length, good: good.length })
      changed()
      return
    }
    if (checks.length >= need && good.length / checks.length < 0.75) return refuse("the cursor does not track the pen", { checks: checks.length, good: good.length })
  }

  /** The verification window is over without a verdict (too few slow samples to say): close, remember nothing, try again next visit. */
  const finish = (): void => {
    if (!trying) return
    deps.trace("map-undecided", { checks: checks.length })
    closeNow("undecided after the verification window")
  }

  const api: MappingController = {
    state,
    setDevice(next) {
      if (next === key) return
      closeNow("device changed")
      key = next
      changed()
    },
    setSheet(report) { sheet = report; sync(); changed() },
    setWanted(on) { if (on === wanted) return; wanted = on; sync(); changed() },
    pen(now) {
      if (now === inRange) return
      inRange = now
      prev = null
      sync()
    },
    dataSeen() { lastDataAt = deps.now() },
    systemPacket() {
      if (!handle) return
      const t = deps.now()
      if (t - Math.max(lastDataAt, openedAt) > STARVE_MS) refuse("the system context starved the data context (packets reach it, none reach the data feed)")
    },
    observe(u, v) {
      if (!handle || !rect) return
      const t = deps.now()
      const moved = prev ? Math.hypot(u - prev.x, v - prev.y) : 0
      const fast = moved > FAST
      const was = prev
      prev = { x: u, y: v }
      if (was && moved > 0.004 && firstMoveAt === null) firstMoveAt = t
      if (t - openedAt < SETTLE_MS || fast || t - lastCheckAt < CHECK_EVERY_MS) {
        if (trying && firstMoveAt !== null && t - firstMoveAt >= LIVENESS.MAP_VERIFY_MS && !verified) finish()
        return
      }
      lastCheckAt = t
      const cur = deps.cursor()
      if (!cur) { if (trying) refuse("the system cursor cannot be read"); return }
      const seen = { x: (cur.x - rect.x) / rect.width, y: (cur.y - rect.y) / rect.height }
      const err = Math.max(Math.abs(seen.x - u), Math.abs(seen.y - v))
      const inside = seen.x >= -SLACK && seen.x <= 1 + SLACK && seen.y >= -SLACK && seen.y <= 1 + SLACK
      if (verified) {
        // watched: two slow samples in a row with the cursor outside the sheet
        violations = inside ? 0 : violations + 1
        if (violations >= VIOLATIONS) refuse("the cursor left the sheet rectangle (watching)")
        return
      }
      checks.push({ expected: { x: u, y: v }, seen, err, inside })
      if (checks.length > 64) checks.shift()
      judge()
      if (trying && !verified && firstMoveAt !== null && t - firstMoveAt >= LIVENESS.MAP_VERIFY_MS) finish()
    },
    refresh() { if (handle) sync() },
    retry() {
      if (key) deps.remember(key, null)
      deps.trace("map-retry")
      sync()
      changed()
    },
    stop(reason) {
      // Terminal until the owner says wanted again: a later pen visit does not reopen anything by itself.
      inRange = false
      wanted = false
      closeNow(reason)
    },
    onChange(l) { listeners.add(l); return () => { listeners.delete(l) } },
  }
  return api
}
