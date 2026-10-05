// win32.ts's FFI safety helpers (design 4.2 "FFI safety", 14.1 #15): canary buffers, step timing, the release registry. Pure: no koffi call.
import { describe, expect, it } from "vitest"
import {
  CANARY_BYTE, CANARY_LEN, FfiOverrun, canaryBuffer, nativeBlockedReason, registerRelease, releaseAllNative, releaserCount, timedStep,
} from "../../src/main/pen/win32"

describe("canaryBuffer", () => {
  it("is allocated at twice the computed size (at least 256 bytes), zero-filled, with the canary right after the computed end", () => {
    const c = canaryBuffer(100)
    expect(c.size).toBe(100)
    expect(c.buf.length).toBe(256)
    expect([...c.buf.subarray(0, 100)].every((b) => b === 0)).toBe(true)
    expect([...c.buf.subarray(100, 100 + CANARY_LEN)]).toEqual(Array(CANARY_LEN).fill(CANARY_BYTE))
    expect([...c.buf.subarray(100 + CANARY_LEN)].every((b) => b === 0)).toBe(true)
    const big = canaryBuffer(1000)
    expect(big.buf.length).toBe(2 * 1000 + CANARY_LEN)
  })
  it("a call that writes exactly the computed size leaves it intact", () => {
    const c = canaryBuffer(48)
    c.buf.fill(0x11, 0, 48)
    expect(c.intact()).toBe(true)
    expect(c.overrun()).toBe(0)
    expect(() => c.check("WTPacketsGet")).not.toThrow()
    expect(c.view().length).toBe(48)
  })
  it("a call that writes one byte more breaks the canary; check throws a FfiOverrun that names both sizes", () => {
    const c = canaryBuffer(48)
    c.buf[48] = 0x01
    expect(c.intact()).toBe(false)
    expect(c.overrun()).toBe(1)
    try {
      c.check("WTPacketsGet")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FfiOverrun)
      const o = e as FfiOverrun
      expect(o.message).toBe("buffer overrun in WTPacketsGet: expected 48 bytes, the driver wrote at least 49")
      expect([o.what, o.expected, o.wroteAtLeast]).toEqual(["WTPacketsGet", 48, 49])
    }
  })
  it("measures how far a bigger write went (into the slack, not into the heap)", () => {
    const c = canaryBuffer(48)
    c.buf.fill(0xee, 0, 48 + 20)
    expect(c.overrun()).toBe(20)
    c.buf.fill(0xee, 0, 48 + 200)
    expect(c.overrun()).toBe(200)
  })
  it("a write of the canary's own value beyond the canary is still seen (the slack must stay zero)", () => {
    const c = canaryBuffer(48)
    c.buf[48 + CANARY_LEN + 3] = CANARY_BYTE
    expect(c.intact()).toBe(false)
  })
  it("reset restores the canary and zeroes the buffer for reuse", () => {
    const c = canaryBuffer(32)
    c.buf.fill(0xff)
    c.reset()
    expect(c.intact()).toBe(true)
    expect([...c.buf.subarray(0, 32)].every((b) => b === 0)).toBe(true)
  })
  it("a zero or fractional size is handled", () => {
    expect(canaryBuffer(0).size).toBe(0)
    expect(canaryBuffer(0).intact()).toBe(true)
    expect(canaryBuffer(10.9).size).toBe(10)
  })
})

describe("timedStep", () => {
  it("returns the result and reports nothing for a quick step", () => {
    const slow: [string, number][] = []
    expect(timedStep("quick", () => 42, (n, ms) => slow.push([n, ms]))).toBe(42)
    expect(slow).toEqual([])
  })
  it("reports a step over the limit by name (and a throwing reporter does not hide the result)", () => {
    const slow: [string, number][] = []
    timedStep("sleepy", () => { const t = performance.now(); while (performance.now() - t < 8) { /* spin */ } }, (n, ms) => slow.push([n, ms]), 5)
    expect(slow).toHaveLength(1)
    expect(slow[0]![0]).toBe("sleepy")
    expect(slow[0]![1]).toBeGreaterThanOrEqual(5)
    expect(timedStep("x", () => 7, () => { throw new Error("reporter") }, -1)).toBe(7)
  })
  it("lets the step's own exception through and still reports it", () => {
    const slow: string[] = []
    expect(() => timedStep("boom", () => { throw new Error("native") }, (n) => slow.push(n), -1)).toThrow("native")
    expect(slow).toEqual(["boom"])
  })
})

describe("the release registry (what runs on every exit path)", () => {
  it("runs every releaser, whatever one of them does, and is repeatable", () => {
    const calls: string[] = []
    const off1 = registerRelease(() => calls.push("a"))
    const off2 = registerRelease(() => { calls.push("b"); throw new Error("a releaser that throws must not stop the others") })
    const off3 = registerRelease(() => calls.push("c"))
    releaseAllNative()
    expect(calls).toEqual(["a", "b", "c"])
    releaseAllNative()
    expect(calls).toHaveLength(6)
    off1(); off2(); off3()
    const before = releaserCount()
    releaseAllNative()
    expect(releaserCount()).toBe(before)
  })
  it("an unregistered releaser does not run again", () => {
    let n = 0
    const off = registerRelease(() => { n++ })
    releaseAllNative()
    off()
    releaseAllNative()
    expect(n).toBe(1)
  })
})

describe("nativeBlockedReason", () => {
  it("says why the native stack is off under E2E unless WRITEMIND_PEN_NATIVE=1", () => {
    const saved = { e2e: process.env.WRITEMIND_E2E, native: process.env.WRITEMIND_PEN_NATIVE }
    try {
      process.env.WRITEMIND_E2E = "1"
      delete process.env.WRITEMIND_PEN_NATIVE
      if (process.platform === "win32" && process.arch === "x64") expect(nativeBlockedReason()).toBe("native pen backends are off under E2E")
      process.env.WRITEMIND_PEN_NATIVE = "1"
      if (process.platform === "win32" && process.arch === "x64") expect(nativeBlockedReason()).toBeNull()
      process.env.WRITEMIND_E2E = "0"
      delete process.env.WRITEMIND_PEN_NATIVE
      if (process.platform === "win32" && process.arch === "x64") expect(nativeBlockedReason()).toBeNull()
    } finally {
      if (saved.e2e === undefined) delete process.env.WRITEMIND_E2E; else process.env.WRITEMIND_E2E = saved.e2e
      if (saved.native === undefined) delete process.env.WRITEMIND_PEN_NATIVE; else process.env.WRITEMIND_PEN_NATIVE = saved.native
    }
  })
})
