import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { TRACE_CAPS, bytesToHex, createTrace, hexToBytes, parseTrace, readTraceFiles, scrub } from "../../src/main/pen/trace"
import type { PenPaths } from "../../src/main/pen/types"
import type { PenSample } from "../../src/shared/pen"

let dir = ""
const pathsIn = (d: string): PenPaths => ({
  userData: d, state: path.join(d, "pen-state.json"), trace: path.join(d, "pen-trace.jsonl"),
  wintabJournal: path.join(d, "wintab.journal.json"), leases: path.join(d, "pen-leases.json"),
})
const sample = (t: number, over: Partial<PenSample> = {}): PenSample => ({
  t, x: 0.25, y: 0.75, p: 0.5, tip: true, lower: false, upper: true, eraser: false, inRange: true, backend: "webhid", ...over,
})
const lines = (file: string): Record<string, unknown>[] => parseTrace(fs.readFileSync(file, "utf8")) as unknown as Record<string, unknown>[]

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-trace-")) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe("pen-trace.jsonl writer", () => {
  it("writes ev records after flush, with the documented fields", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true, { now: () => 1234 })
    tr.event("webhid", "start", { devices: 2 })
    expect(fs.existsSync(p.trace)).toBe(false) // buffered, not yet written
    await tr.flush()
    expect(lines(p.trace)).toEqual([{ k: "ev", t: 1234, b: "webhid", e: "start", d: { devices: 2 } }])
    tr.close()
  })

  it("never writes window titles or user content keys", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    tr.event("manager", "focus", { fg: "Untitled - Notepad", title: "secret", nested: { windowTitle: "x", ok: 1 }, self: true })
    tr.session({ title: "t", app: "1.0" })
    await tr.flush()
    const text = fs.readFileSync(p.trace, "utf8")
    expect(text).not.toMatch(/Notepad|secret|windowTitle|"title"/)
    expect(text).toContain('"self":true')
    expect(text).toContain('"ok":1')
    expect(scrub({ a: { fg: 1, b: [{ title: 1, c: 2 }] } })).toEqual({ a: { b: [{ c: 2 }] } })
    tr.close()
  })

  it("caps raw records: the first 400, then every 25th, 2000 records at most", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    for (let i = 0; i < 100000; i++) tr.raw("wintab-data", i, "aabb")
    await tr.flush()
    const raws = lines(p.trace).filter((r) => r.k === "raw")
    expect(raws.length).toBe(2000)
    expect(raws.slice(0, TRACE_CAPS.rawFirst).map((r) => r.n)).toEqual(Array.from({ length: TRACE_CAPS.rawFirst }, (_, i) => i + 1))
    expect(raws[TRACE_CAPS.rawFirst]!.n).toBe(TRACE_CAPS.rawFirst + 25)
    expect(raws[raws.length - 1]!.n).toBe(TRACE_CAPS.rawFirst + 25 * (TRACE_CAPS.rawMax - TRACE_CAPS.rawFirst))
    tr.close()
  })

  it("keeps the first raw hex per backend in memory even with the trace off, and writes none to disk", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => false)
    for (let i = 0; i < 30; i++) tr.raw("webhid", i, `0${i % 10}`, "d0")
    tr.smp("webhid", sample(1))
    tr.dom({ t: 1, ty: "pointermove", pt: "pen", x: 1, y: 2, bu: 0, p: 0 })
    tr.cur(1, 2, 3)
    tr.event("manager", "settings", { trace: false })
    tr.st(5, { headline: "x" })
    await tr.flush()
    expect(tr.firstRaw(12).webhid).toHaveLength(12)
    const kinds = new Set(lines(p.trace).map((r) => r.k))
    expect(kinds).toEqual(new Set(["ev", "st"]))
    tr.close()
  })

  it("samples smp every 10th up to 3000, with flags and rounding", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    for (let i = 0; i < 50000; i++) tr.smp("rawinput", sample(i, { x: 0.123456789 }))
    await tr.flush()
    const smps = lines(p.trace).filter((r) => r.k === "smp")
    expect(smps.length).toBe(TRACE_CAPS.smpMax)
    expect(smps[0]).toMatchObject({ k: "smp", b: "rawinput", x: 0.12346, y: 0.75, p: 0.5, f: 1 | 4 | 16 })
    expect(smps[1]!.t).toBe(10)
    tr.close()
  })

  it("caps dom (first 100, then every 10th up to 1500) and cur (400)", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    for (let i = 0; i < 40000; i++) tr.dom({ t: i, ty: "pointermove", pt: "pen", x: 1, y: 2, bu: 1, p: 0.5 })
    for (let i = 0; i < 1000; i++) tr.cur(i, 1, 2)
    await tr.flush()
    const all = lines(p.trace)
    expect(all.filter((r) => r.k === "dom")).toHaveLength(TRACE_CAPS.domMax)
    expect(all.filter((r) => r.k === "cur")).toHaveLength(TRACE_CAPS.curMax)
    expect(all.filter((r) => r.k === "dom")[100]!.t).toBe(109) // 110th event: (110 - 100) % 10 === 0
    tr.close()
  })

  it("session() writes a session record and resets the per-session caps and first-raw memory", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    for (let i = 0; i < 3000; i++) tr.raw("webhid", i, "aa")
    tr.session({ app: "0.2.0", electron: "44" })
    for (let i = 0; i < 5; i++) tr.raw("webhid", i, "bb")
    await tr.flush()
    const all = lines(p.trace)
    expect(all.filter((r) => r.k === "session")).toHaveLength(1)
    expect(all.filter((r) => r.k === "session")[0]).toMatchObject({ v: 1, app: "0.2.0" })
    const raws = all.filter((r) => r.k === "raw")
    expect(raws[raws.length - 1]!.n).toBe(5)
    expect(tr.firstRaw(10).webhid).toEqual(["bb", "bb", "bb", "bb", "bb"])
    tr.close()
  })

  it("writes layout events as lay records and keeps a short ev in the ring", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    tr.event("webhid", "layout", { dev: "d0", layout: { reports: [1, 2, 3] } })
    await tr.flush()
    const lay = lines(p.trace).find((r) => r.k === "lay")
    expect(lay).toMatchObject({ b: "webhid", dev: "d0", layout: { reports: [1, 2, 3] } })
    expect(tr.tail(5)).toHaveLength(1)
    tr.close()
  })

  it("tail() is the last events only (not raw or samples) from a ring of 200", () => {
    const tr = createTrace(pathsIn(dir), () => true)
    for (let i = 0; i < 500; i++) { tr.event("manager", `e${i}`); tr.raw("webhid", i, "aa"); tr.smp("webhid", sample(i)) }
    const tail = tr.tail(80)
    expect(tail).toHaveLength(80)
    expect(JSON.parse(tail[79]!)).toMatchObject({ k: "ev", e: "e499" })
    expect(tr.tail(1000)).toHaveLength(200)
    tr.close()
  })

  it("rotates at the size cap and keeps three files", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true, { maxBytes: 4000 })
    for (let round = 0; round < 12; round++) {
      for (let i = 0; i < 20; i++) tr.event("manager", "fill", { round, i, pad: "x".repeat(20) })
      await tr.flush()
    }
    tr.close()
    expect(fs.existsSync(p.trace)).toBe(true)
    expect(fs.existsSync(`${p.trace}.1`)).toBe(true)
    expect(fs.existsSync(`${p.trace}.2`)).toBe(true)
    expect(fs.existsSync(`${p.trace}.3`)).toBe(false)
    for (const f of [p.trace, `${p.trace}.1`, `${p.trace}.2`]) expect(fs.statSync(f).size).toBeLessThanOrEqual(4000 + 3000)
    // oldest first when read back, and the newest record is last
    const recs = parseTrace(readTraceFiles(p.trace)) as unknown as { d: { round: number } }[]
    expect(recs[recs.length - 1]!.d.round).toBe(11)
  })

  it("close() writes what is buffered, synchronously, and later writes are ignored", () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    tr.event("manager", "last")
    tr.close()
    expect(fs.readFileSync(p.trace, "utf8")).toContain('"e":"last"')
    tr.event("manager", "after")
    tr.close()
    expect(fs.readFileSync(p.trace, "utf8")).not.toContain("after")
  })

  it("a write failure never throws (full disk, locked file, bad path)", async () => {
    const blocker = path.join(dir, "blocker")
    fs.writeFileSync(blocker, "x")
    const p = { ...pathsIn(dir), trace: path.join(blocker, "sub", "pen-trace.jsonl") } // a directory under a file: ENOTDIR
    const tr = createTrace(p, () => true)
    expect(() => tr.event("manager", "x")).not.toThrow()
    await expect(tr.flush()).resolves.toBeUndefined()
    expect(() => tr.close()).not.toThrow()
    expect(tr.tail(5)).toHaveLength(1) // still remembered in memory
  })

  it("survives circular data and oversized lines", async () => {
    const p = pathsIn(dir)
    const tr = createTrace(p, () => true)
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => tr.event("manager", "circular", a)).not.toThrow()
    tr.event("manager", "huge", { blob: "z".repeat(200_000) })
    await tr.flush()
    const rows = lines(p.trace)
    expect(rows.some((r) => r.e === "huge" && r.truncated !== undefined)).toBe(true)
    tr.close()
  })
})

describe("reading traces", () => {
  it("parseTrace skips blank lines, a torn last line and unknown kinds", () => {
    const text = [
      JSON.stringify({ k: "ev", t: 1, b: "m", e: "a" }), "", JSON.stringify({ k: "wat", t: 2 }), "not json",
      JSON.stringify({ k: "raw", t: 3, b: "webhid", n: 1, hex: "aa" }), '{"k":"ev","t":4,"b":"m","e":"to',
    ].join("\n")
    expect(parseTrace(text).map((r) => r.k)).toEqual(["ev", "raw"])
  })

  it("hex helpers round-trip", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 254, 255]))).toBe("0001feff")
    expect(Array.from(hexToBytes("0001feff"))).toEqual([0, 1, 254, 255])
  })
})
