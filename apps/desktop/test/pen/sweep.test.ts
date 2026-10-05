// The startup sweep (main/pen/sweep.ts): what an earlier run left behind, undone, and nothing else. Fake guard process, fake clip, real temp files.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Rect, Win32Clip } from "../../src/main/pen/clip"
import { sweepAtStart, sweepPending } from "../../src/main/pen/sweep"
import type { PenPaths } from "../../src/main/pen/types"

const SCREEN: Rect = { left: 0, top: 0, right: 1920, bottom: 1200 }
const SHEET: Rect = { left: 1100, top: 200, right: 1800, bottom: 900 }
const dirs: string[] = []

function setup(journal: unknown | string | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-sweep-"))
  dirs.push(dir)
  const paths: PenPaths = { userData: dir, state: path.join(dir, "s"), trace: path.join(dir, "t"), wintabJournal: path.join(dir, "w"), leases: path.join(dir, "pen-leases.json") }
  if (journal !== null) fs.writeFileSync(paths.leases, typeof journal === "string" ? journal : JSON.stringify(journal))
  const state = { clip: SCREEN, setCalls: [] as (Rect | null)[] }
  const clip: Win32Clip = { getClip: () => state.clip, setClip: (r) => { state.setCalls.push(r); state.clip = r ?? SCREEN; return true }, screen: () => SCREEN }
  const logs: string[] = []
  return { paths, state, clip, logs, log: (l: string) => logs.push(l) }
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

const journal = (over: Record<string, unknown> = {}) => ({ guardPid: 111, appPid: 222, clip: SHEET, wintab: [], at: 1, ...over })

describe("sweepAtStart", () => {
  it("no journal: nothing to do, and the guard is never run", async () => {
    const t = setup(null)
    let ran = 0
    const r = await sweepAtStart(t.paths, t.log, { run: async () => { ran++; return null }, clip: t.clip })
    expect(r).toEqual({ journal: "none", clip: "none", wintabClosed: [], wintabSkipped: [] })
    expect(ran).toBe(0)
  })

  it("asks the guard script for a one-shot --sweep of the journal, as a node-mode child, and returns its answer", async () => {
    const t = setup(journal())
    let seen: { exec: string; args: string[]; ms: number } | null = null
    const answer = { sweep: { journal: "swept", clip: "released", wintabClosed: ["77"], wintabSkipped: [] } }
    const r = await sweepAtStart(t.paths, t.log, {
      execPath: "electron.exe", guardScript: "C:/app/pen-guard.mjs",
      run: async (exec, args, ms) => { seen = { exec, args, ms }; return `noise\n${JSON.stringify(answer)}\n` },
      clip: t.clip,
    })
    expect(seen).toEqual({ exec: "electron.exe", args: ["C:/app/pen-guard.mjs", "--sweep", t.paths.leases], ms: 6000 })
    expect(r).toEqual(answer.sweep)
    expect(t.state.setCalls).toEqual([]) // the guard did the work; this process touched nothing
  })

  it("a guard that gives no answer falls back to releasing a stale clip in-process, only if it is exactly the journalled rectangle", async () => {
    const t = setup(journal())
    t.state.clip = SHEET
    const r = await sweepAtStart(t.paths, t.log, { run: async () => null, clip: t.clip, pidAlive: () => false })
    expect(r).toMatchObject({ journal: "swept", clip: "released" })
    expect(t.state.clip).toEqual(SCREEN)
    expect(fs.existsSync(t.paths.leases)).toBe(false) // the journal is deleted once it has been dealt with
  })

  it("the fallback leaves another program's clip alone", async () => {
    const t = setup(journal())
    const foreign: Rect = { left: 10, top: 10, right: 600, bottom: 400 }
    t.state.clip = foreign
    const r = await sweepAtStart(t.paths, t.log, { run: async () => "garbage", clip: t.clip, pidAlive: () => false })
    expect(r).toMatchObject({ journal: "swept", clip: "left" })
    expect(t.state.clip).toEqual(foreign)
    expect(t.state.setCalls).toEqual([])
  })

  it("the fallback does nothing when the previous owner is still alive (the journal is live, not stale)", async () => {
    const t = setup(journal())
    t.state.clip = SHEET
    const r = await sweepAtStart(t.paths, t.log, { run: async () => null, clip: t.clip, pidAlive: (p) => p === 222 })
    expect(r).toMatchObject({ journal: "alive", clip: "none" })
    expect(t.state.clip).toEqual(SHEET)
    expect(fs.existsSync(t.paths.leases)).toBe(true)
  })

  it("a missing guard script falls back too (a broken install must not leave a clip)", async () => {
    const t = setup(journal())
    t.state.clip = SHEET
    const r = await sweepAtStart(t.paths, t.log, { guardScript: path.join(t.paths.userData, "not-there.mjs"), clip: t.clip, pidAlive: () => false })
    expect(r).toMatchObject({ clip: "released" })
    expect(t.logs.join(" ")).toContain("missing")
  })

  it("a torn or foreign journal is deleted and releases nothing", async () => {
    const t = setup("{ torn")
    t.state.clip = SHEET
    const r = await sweepAtStart(t.paths, t.log, { run: async () => null, clip: t.clip, pidAlive: () => false })
    expect(r).toMatchObject({ journal: "none", clip: "none" })
    expect(t.state.clip).toEqual(SHEET) // no record that WE set it: not ours to release
    expect(fs.existsSync(t.paths.leases)).toBe(false) // the torn file is litter and goes
  })

  it("no clip access at all is an error result, never a throw", async () => {
    const t = setup(journal())
    const r = await sweepAtStart(t.paths, t.log, { run: async () => null, clip: null })
    expect(r).toEqual({ error: "no clip access" })
  })

  it("while it runs, sweepPending() is that promise (lease.start() waits for it), and afterwards null", async () => {
    const t = setup(journal())
    let release: (v: string | null) => void = () => undefined
    const p = sweepAtStart(t.paths, t.log, { run: () => new Promise<string | null>((res) => { release = res }), clip: t.clip, pidAlive: () => false })
    expect(sweepPending()).not.toBeNull()
    release(null)
    await p
    await Promise.resolve()
    expect(sweepPending()).toBeNull()
  })
})
