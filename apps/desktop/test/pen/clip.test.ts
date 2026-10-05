// Ported from the containment spike (C:\CLAUDIO\spikes\contain-spike\clip.test.ts) and extended for the Wintab holds, the
// guard's event lines and the journal. Pure: no Win32, no processes.
import { describe, expect, it } from "vitest"
import {
  DATA_LEASE_MS, DEFAULT_BEAT_MS, DEFAULT_IDLE_MS, DEFAULT_LEASE_MS, encodeGuardCommand, intersect, isHandleString, MIN_CLIP_H, MIN_CLIP_W,
  parseGuardCommand, parseGuardEvent, parseJournal, rectsEqual, staleClipDecision, toBox, toRect, validateClipRect, wintabMarker,
  type Rect,
} from "../../src/main/pen/clip"

const SCREEN: Rect = { left: 0, top: 0, right: 1920, bottom: 1200 }
const SHEET: Rect = { left: 1100, top: 200, right: 1800, bottom: 900 }

describe("constants", () => {
  it("keep the measured safety margins", () => {
    expect(DEFAULT_LEASE_MS).toBe(800) // measured 807-851 ms to release after a hang
    expect(DEFAULT_BEAT_MS).toBeLessThan(DEFAULT_LEASE_MS / 3) // at least three beats inside one lease
    expect(DATA_LEASE_MS).toBeGreaterThan(DEFAULT_LEASE_MS) // a data context is harmless: a long hang loses it, a short stall does not
    expect(DEFAULT_IDLE_MS).toBe(20_000)
    expect([MIN_CLIP_W, MIN_CLIP_H]).toEqual([240, 160])
  })
})

describe("rect helpers", () => {
  it("rectsEqual handles nulls", () => {
    expect(rectsEqual(null, null)).toBe(true)
    expect(rectsEqual(SHEET, null)).toBe(false)
    expect(rectsEqual(null, SHEET)).toBe(false)
    expect(rectsEqual(SHEET, { ...SHEET })).toBe(true)
  })
  it("intersect clamps and returns an empty rect when disjoint", () => {
    expect(intersect({ left: -50, top: 0, right: 600, bottom: 1500 }, SCREEN)).toEqual({ left: 0, top: 0, right: 600, bottom: 1200 })
    expect(intersect({ left: 5000, top: 0, right: 6000, bottom: 800 }, SCREEN)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })
  it("converts to and from the contract's Box (x, y, width, height)", () => {
    expect(toRect({ x: 1100, y: 200, width: 700, height: 700 })).toEqual(SHEET)
    expect(toBox(SHEET)).toEqual({ x: 1100, y: 200, width: 700, height: 700 })
  })
})

describe("validateClipRect", () => {
  it("accepts a sane working area and rounds it", () => {
    expect(validateClipRect({ left: 1100.4, top: 200, right: 1800, bottom: 899.6 }, SCREEN)).toEqual({ ok: true, rect: SHEET })
  })
  it("clamps to the screen, never grows", () => {
    expect(validateClipRect({ left: -50, top: 0, right: 600, bottom: 1500 }, SCREEN)).toEqual({ ok: true, rect: { left: 0, top: 0, right: 600, bottom: 1200 } })
  })
  it("refuses empty, inverted, NaN, infinite, tiny, off-screen and whole-screen rects", () => {
    const bad = (r: Rect) => (validateClipRect(r, SCREEN) as { ok: false; reason: string }).reason
    expect(bad({ left: 5, top: 5, right: 5, bottom: 90 })).toBe("empty")
    expect(bad({ left: 500, top: 500, right: 100, bottom: 100 })).toBe("empty")
    expect(bad({ left: NaN, top: 0, right: 500, bottom: 500 })).toBe("not-finite")
    expect(bad({ left: 0, top: 0, right: Infinity, bottom: 500 })).toBe("not-finite")
    expect(bad({ left: 10, top: 10, right: 200, bottom: 100 })).toBe("too-small")
    expect(bad({ left: 5000, top: 0, right: 6000, bottom: 800 })).toBe("too-small")
    expect(bad({ left: -100, top: -100, right: 3000, bottom: 3000 })).toBe("whole-screen")
  })
  it("a rectangle one pixel under the minimum is refused, exactly the minimum is allowed", () => {
    expect(validateClipRect({ left: 100, top: 100, right: 100 + MIN_CLIP_W - 1, bottom: 100 + MIN_CLIP_H }, SCREEN).ok).toBe(false)
    expect(validateClipRect({ left: 100, top: 100, right: 100 + MIN_CLIP_W, bottom: 100 + MIN_CLIP_H - 1 }, SCREEN).ok).toBe(false)
    expect(validateClipRect({ left: 100, top: 100, right: 100 + MIN_CLIP_W, bottom: 100 + MIN_CLIP_H }, SCREEN).ok).toBe(true)
  })
  it("works on a virtual screen with a negative origin (a monitor left of the primary)", () => {
    const virt: Rect = { left: -1920, top: 0, right: 1920, bottom: 1200 }
    const r = validateClipRect({ left: -1500, top: 100, right: -800, bottom: 700 }, virt)
    expect(r).toEqual({ ok: true, rect: { left: -1500, top: 100, right: -800, bottom: 700 } })
  })
})

describe("staleClipDecision", () => {
  const mark = { rect: SHEET }
  it("nothing to do when no clip is active", () => expect(staleClipDecision(mark, SCREEN, SCREEN)).toBe("none"))
  it("releases the clip it left behind", () => expect(staleClipDecision(mark, SHEET, SCREEN)).toBe("release"))
  it("leaves another program's clip alone", () => {
    expect(staleClipDecision(mark, { left: 0, top: 0, right: 800, bottom: 600 }, SCREEN)).toBe("leave")
    expect(staleClipDecision(null, SHEET, SCREEN)).toBe("leave")
  })
})

describe("guard commands", () => {
  it("round-trips every command", () => {
    expect(parseGuardCommand(encodeGuardCommand({ cmd: "arm", rect: SHEET, leaseMs: 800 }))).toEqual({ cmd: "arm", rect: SHEET, leaseMs: 800 })
    for (const cmd of ["beat", "free", "status", "quit"] as const) expect(parseGuardCommand(encodeGuardCommand({ cmd }))).toEqual({ cmd })
    const hold = { cmd: "hold-wintab", handle: "140737488355328", appPid: 4242, mode: "system" } as const
    expect(parseGuardCommand(encodeGuardCommand(hold))).toEqual(hold)
    expect(parseGuardCommand(encodeGuardCommand({ cmd: "drop-wintab", handle: "77" }))).toEqual({ cmd: "drop-wintab", handle: "77" })
  })
  it("uses the documented wire format", () => {
    expect(encodeGuardCommand({ cmd: "arm", rect: SHEET, leaseMs: 800 })).toBe("arm 1100 200 1800 900 800\n")
    expect(encodeGuardCommand({ cmd: "hold-wintab", handle: "12", appPid: 9, mode: "data" })).toBe("hold-wintab 12 9 data\n")
  })
  it("rejects garbage, silly leases, and anything that is not a plain decimal handle", () => {
    for (const l of ["arm 1 2 3", "arm a b c d", "arm 1 2 300 400 5", "arm 1 2 300 400 99999", "arm 1.5 2 300 400", "explode", "", "   ", "arm", "ARM 1 2 300 400"]) {
      expect(parseGuardCommand(l), l).toBeNull()
    }
    for (const l of ["hold-wintab", "hold-wintab 0 9 data", "hold-wintab 12 9", "hold-wintab 12 0 data", "hold-wintab 12 9 other", "hold-wintab 0x10 9 data", "hold-wintab -5 9 data", "hold-wintab 12 9 data extra", "drop-wintab", "drop-wintab abc", "drop-wintab 1 2"]) {
      expect(parseGuardCommand(l), l).toBeNull()
    }
  })
  it("defaults the lease", () => expect(parseGuardCommand("arm 1 2 300 400")).toEqual({ cmd: "arm", rect: { left: 1, top: 2, right: 300, bottom: 400 }, leaseMs: 800 }))
  it("isHandleString accepts plain decimals only", () => {
    expect(isHandleString("1")).toBe(true)
    expect(isHandleString("18446744073709551615")).toBe(true)
    for (const s of ["", "0", "01a", "-1", "1.0", " 1", "123456789012345678901"]) expect(isHandleString(s), s).toBe(false)
  })
})

describe("guard events", () => {
  it("parses every line the guard says", () => {
    expect(parseGuardEvent("ready")).toEqual({ ev: "ready" })
    expect(parseGuardEvent("armed 1100 200 1800 900")).toEqual({ ev: "armed", rect: SHEET })
    expect(parseGuardEvent("freed lease")).toEqual({ ev: "freed", why: "lease" })
    expect(parseGuardEvent("foreign arm")).toEqual({ ev: "foreign", why: "arm" })
    expect(parseGuardEvent("expired")).toEqual({ ev: "expired" })
    expect(parseGuardEvent("held-wintab 12 system")).toEqual({ ev: "held-wintab", handle: "12", mode: "system" })
    expect(parseGuardEvent("closed-wintab 12 panic-key")).toEqual({ ev: "closed-wintab", handle: "12", why: "panic-key" })
    expect(parseGuardEvent("panic-key")).toEqual({ ev: "panic-key" })
    expect(parseGuardEvent("err bad-rect")).toEqual({ ev: "err", message: "bad-rect" })
  })
  it("ignores noise", () => {
    for (const l of ["", "   ", "armed 1 2 3", "armed a b c d", "held-wintab x data", "closed-wintab", "mystery"]) expect(parseGuardEvent(l), l).toBeNull()
  })
})

describe("journal", () => {
  it("round-trips and drops junk entries", () => {
    const j = { guardPid: 10, appPid: 20, clip: SHEET, wintab: [{ handle: "5", mode: "data" }, { handle: "x", mode: "data" }, { handle: "6", mode: "weird" }], at: 123 }
    expect(parseJournal(JSON.stringify(j))).toEqual({ guardPid: 10, appPid: 20, clip: SHEET, wintab: [{ handle: "5", mode: "data" }], at: 123 })
  })
  it("a torn, empty or foreign file is no journal", () => {
    for (const t of ["", "{", "null", "[]", "12", JSON.stringify({ appPid: 1 }), JSON.stringify({ guardPid: "a", appPid: 1 })]) expect(parseJournal(t), t).toBeNull()
  })
  it("a journal with no valid clip rectangle holds none", () => {
    expect(parseJournal(JSON.stringify({ guardPid: 1, appPid: 2, clip: { left: 1 }, wintab: [] }))?.clip).toBeNull()
  })
})

describe("wintabMarker", () => {
  it("is the exact name the Wintab backend gives its contexts", () => expect(wintabMarker(4242)).toBe("WriteMind pen 4242"))
})
