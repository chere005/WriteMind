// The app's side of the guard, against a fake child process, a fake clip and a fake timer. No OS, no processes.
import { describe, expect, it } from "vitest"
import { DEFAULT_BEAT_MS, type Rect, type Win32Clip } from "../../src/main/pen/clip"
import { createLease, type GuardChild, type PenLease } from "../../src/main/pen/lease"
import type { PenPaths } from "../../src/main/pen/types"

const SCREEN: Rect = { left: 0, top: 0, right: 1920, bottom: 1200 }
const SHEET: Rect = { left: 1100, top: 200, right: 1800, bottom: 900 }
const BOX = { x: 1100, y: 200, width: 700, height: 700 }
const PATHS: PenPaths = { userData: "u", state: "s", trace: "t", wintabJournal: "w", leases: "C:/u/pen-leases.json" }

function rig(opts: { spawnThrows?: boolean; clip?: Rect; noClipApi?: boolean; autoReady?: boolean } = {}) {
  const sent: string[] = []
  let onLine: (l: string) => void = () => undefined
  let onExit: (c: number | null) => void = () => undefined
  let killed = 0
  let spawned: { exec: string; args: string[]; env: NodeJS.ProcessEnv } | null = null
  const state = { clip: opts.clip ?? SCREEN, setCalls: [] as (Rect | null)[], failWrites: false }
  const clip: Win32Clip = {
    getClip: () => state.clip,
    setClip: (r) => { state.setCalls.push(r); state.clip = r ?? SCREEN; return true },
    screen: () => SCREEN,
  }
  const timers: { ms: number; fn: () => void; live: boolean }[] = []
  const lost: string[] = []
  const logs: string[] = []
  const child: GuardChild = {
    pid: 7777,
    write: (l) => { if (state.failWrites) throw new Error("EPIPE"); sent.push(l) },
    onLine: (f) => { onLine = f },
    onExit: (f) => { onExit = f },
    kill: () => { killed++ },
  }
  const lease: PenLease = createLease({
    paths: PATHS, execPath: "electron.exe", guardScript: "C:/app/out/main/pen-guard.mjs", log: (l) => logs.push(l),
    spawn: (exec, args, env) => { if (opts.spawnThrows) throw new Error("spawn EPERM"); spawned = { exec, args, env }; return child },
    clip: opts.noClipApi ? null : clip,
    every: (ms, fn) => { const h = { ms, fn, live: true }; timers.push(h); return () => { h.live = false } },
    readyTimeoutMs: 40, appPid: 4242, exitBelt: false,
  })
  lease.onLost((w) => lost.push(w))
  const say = (l: string) => onLine(l)
  const ready = async () => { const p = lease.start(); say("ready"); return p }
  const tickTimers = () => { for (const h of timers) if (h.live) h.fn() }
  return { lease, sent, say, ready, exit: (c: number | null = 1) => onExit(c), state, timers, tickTimers, lost, logs, get killed() { return killed }, get spawned() { return spawned }, liveTimers: () => timers.filter((h) => h.live).length }
}

describe("starting the guard", () => {
  it("spawns the guard script with the journal and the app pid, as a node-mode Electron", async () => {
    const r = rig()
    expect(r.lease.state()).toBe("none")
    const p = r.lease.start()
    expect(r.lease.state()).toBe("starting")
    expect(r.spawned?.exec).toBe("electron.exe")
    expect(r.spawned?.args).toEqual(["C:/app/out/main/pen-guard.mjs", "--journal", PATHS.leases, "--app-pid", "4242"])
    expect(r.spawned?.env.ELECTRON_RUN_AS_NODE).toBe("1")
    r.say("ready")
    expect(await p).toBe(true)
    expect(r.lease.ready()).toBe(true)
    expect(r.lease.state()).toBe("ready")
    expect(r.lease.pid()).toBe(7777)
  })
  it("start() is idempotent and shares one spawn", async () => {
    const r = rig()
    const a = r.lease.start()
    const b = r.lease.start()
    r.say("ready")
    expect(await a).toBe(true)
    expect(await b).toBe(true)
    expect(await r.lease.start()).toBe(true)
  })
  it("a guard that never says ready is killed and the lease is lost (fail closed)", async () => {
    const r = rig()
    expect(await r.lease.start()).toBe(false)
    expect(r.killed).toBe(1)
    expect(r.lease.state()).toBe("lost")
    expect(r.lease.ready()).toBe(false)
  })
  it("a guard that exits before ready is lost", async () => {
    const r = rig()
    const p = r.lease.start()
    r.exit(1)
    expect(await p).toBe(false)
    expect(r.lease.state()).toBe("lost")
  })
  it("a spawn that throws is lost, and nothing escapes", async () => {
    const r = rig({ spawnThrows: true })
    expect(await r.lease.start()).toBe(false)
    expect(r.lease.state()).toBe("lost")
    expect(r.logs.join("\n")).toMatch(/could not start the guard: spawn EPERM/)
  })
  it("with no guard nothing can be held: no clip, no system context", async () => {
    const r = rig({ spawnThrows: true })
    await r.lease.start()
    expect(r.lease.armClip(BOX, 800)).toBe(false)
    expect(r.lease.holdWintab("12", "system")).toBe(false)
    expect(r.lease.holdWintab("12", "data")).toBe(false)
    expect(r.sent).toEqual([])
  })
})

describe("the clip", () => {
  it("sends arm in the wire format and keeps a heartbeat while armed", async () => {
    const r = rig()
    await r.ready()
    expect(r.liveTimers()).toBe(0)
    expect(r.lease.armClip(BOX, 800)).toBe(true)
    expect(r.sent).toEqual(["arm 1100 200 1800 900 800\n"])
    expect(r.liveTimers()).toBe(1)
    expect(r.timers[0].ms).toBe(DEFAULT_BEAT_MS)
    r.tickTimers()
    r.tickTimers()
    expect(r.sent.filter((l) => l === "beat\n")).toHaveLength(2)
    expect(r.lease.held().clip).toEqual(SHEET)
  })
  it("refuses a rectangle that is not sane, or while another program holds a clip", async () => {
    const r = rig()
    await r.ready()
    expect(r.lease.armClip({ x: 0, y: 0, width: 100, height: 100 }, 800)).toBe(false) // too small
    expect(r.lease.armClip({ x: 0, y: 0, width: 1920, height: 1200 }, 800)).toBe(false) // whole screen
    expect(r.lease.armClip({ x: Number.NaN, y: 0, width: 800, height: 600 }, 800)).toBe(false)
    expect(r.sent).toEqual([])
    const f = rig({ clip: { left: 5, top: 5, right: 500, bottom: 400 } })
    await f.ready()
    expect(f.lease.armClip(BOX, 800)).toBe(false)
    expect(f.sent).toEqual([])
  })
  it("refuses when ClipCursor cannot be reached at all", async () => {
    const r = rig({ noClipApi: true })
    await r.ready()
    expect(r.lease.armClip(BOX, 800)).toBe(false)
  })
  it("freeClip tells the guard, releases from this side only if still ours, and stops the heartbeat", async () => {
    const r = rig()
    await r.ready()
    r.lease.armClip(BOX, 800)
    r.state.clip = SHEET // the guard set it
    r.lease.freeClip()
    expect(r.sent.at(-1)).toBe("free\n")
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.liveTimers()).toBe(0)
    expect(r.lease.held().clip).toBeNull()
  })
  it("freeClip leaves somebody else's clip alone", async () => {
    const r = rig()
    await r.ready()
    r.lease.armClip(BOX, 800)
    const theirs: Rect = { left: 1, top: 1, right: 400, bottom: 300 }
    r.state.clip = theirs
    r.lease.freeClip()
    expect(r.state.clip).toEqual(theirs)
  })
  it("freeClip with nothing armed sends nothing", async () => {
    const r = rig()
    await r.ready()
    r.lease.freeClip()
    expect(r.sent).toEqual([])
  })
  it("re-arming over our own rectangle is allowed", async () => {
    const r = rig()
    await r.ready()
    r.lease.armClip(BOX, 800)
    r.state.clip = SHEET
    expect(r.lease.armClip({ x: 1000, y: 150, width: 700, height: 700 }, 800)).toBe(true)
    expect(r.liveTimers()).toBe(1) // still exactly one heartbeat
  })
  it("currentClip reports the OS clip as a Box", async () => {
    const r = rig()
    await r.ready()
    r.state.clip = SHEET
    expect(r.lease.currentClip()).toEqual(BOX)
  })
})

describe("what the guard says back", () => {
  it("`expired` is a lease loss: nothing is armed any more and the listener hears it", async () => {
    const r = rig()
    await r.ready()
    r.lease.armClip(BOX, 800)
    r.say("freed lease")
    r.say("expired")
    expect(r.lost).toEqual(["lease"])
    expect(r.lease.held().clip).toBeNull()
    expect(r.liveTimers()).toBe(0)
  })
  it("a refused arm (a foreign clip) clears the belief and tells the listeners", async () => {
    const r = rig()
    await r.ready()
    const why: string[] = []
    r.lease.onRefused((w) => why.push(w))
    r.lease.armClip(BOX, 800)
    r.say("foreign arm")
    expect(why).toEqual(["foreign-clip"])
    expect(r.lease.held().clip).toBeNull()
  })
  it("a bad-rect or clip-failed error from the guard is a refusal too", async () => {
    const r = rig()
    await r.ready()
    const why: string[] = []
    r.lease.onRefused((w) => why.push(w))
    r.lease.armClip(BOX, 800)
    r.say("err clip-failed")
    expect(why).toEqual(["clip-failed"])
  })
  it("the guard's panic-key line clears the clip and tells the panic listeners", async () => {
    const r = rig()
    await r.ready()
    let n = 0
    r.lease.onPanicKey(() => n++)
    r.lease.armClip(BOX, 800)
    r.say("panic-key")
    r.say("freed panic-key")
    expect(n).toBe(1)
    expect(r.lease.held().clip).toBeNull()
  })
  it("a throwing listener never breaks the channel", async () => {
    const r = rig()
    await r.ready()
    r.lease.onLost(() => { throw new Error("bad listener") })
    r.lease.armClip(BOX, 800)
    expect(() => r.say("expired")).not.toThrow()
  })
  it("unknown and garbled lines are ignored", async () => {
    const r = rig()
    await r.ready()
    for (const l of ["", "mystery 1 2", "armed x y", "\u0000"]) expect(() => r.say(l)).not.toThrow()
  })
})

describe("the guard dying", () => {
  it("while a clip is armed: the app releases it at once if it is still ours, and says guard-lost", async () => {
    const r = rig()
    await r.ready()
    r.lease.armClip(BOX, 800)
    r.state.clip = SHEET
    r.exit(1)
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.lost).toEqual(["guard-lost"])
    expect(r.lease.state()).toBe("lost")
    expect(r.lease.ready()).toBe(false)
    expect(r.liveTimers()).toBe(0)
  })
  it("but never a clip that is no longer ours", async () => {
    const r = rig()
    await r.ready()
    r.lease.armClip(BOX, 800)
    const theirs: Rect = { left: 1, top: 1, right: 400, bottom: 300 }
    r.state.clip = theirs
    r.exit(1)
    expect(r.state.clip).toEqual(theirs)
    expect(r.lost).toEqual(["guard-lost"])
  })
  it("after it, nothing new can be armed or held", async () => {
    const r = rig()
    await r.ready()
    r.exit(1)
    expect(r.lease.armClip(BOX, 800)).toBe(false)
    expect(r.lease.holdWintab("9", "system")).toBe(false)
  })
  it("a write that fails is a refusal, not a success (and arming leaves nothing believed)", async () => {
    const r = rig()
    await r.ready()
    r.state.failWrites = true
    expect(r.lease.armClip(BOX, 800)).toBe(false)
    expect(r.lease.holdWintab("9", "system")).toBe(false)
    expect(r.lease.held()).toEqual({ clip: null, wintab: [] })
  })
})

describe("Wintab holds", () => {
  it("registers a handle with the app pid and beats while held", async () => {
    const r = rig()
    await r.ready()
    expect(r.lease.holdWintab("140737488355328", "system")).toBe(true)
    expect(r.sent).toEqual(["hold-wintab 140737488355328 4242 system\n"])
    expect(r.liveTimers()).toBe(1)
    r.tickTimers()
    expect(r.sent.at(-1)).toBe("beat\n")
    expect(r.lease.held().wintab).toEqual(["140737488355328"])
  })
  it("dropWintab forgets it and stops beating when nothing else is held", async () => {
    const r = rig()
    await r.ready()
    r.lease.holdWintab("12", "data")
    r.lease.dropWintab("12")
    expect(r.sent.at(-1)).toBe("drop-wintab 12\n")
    expect(r.liveTimers()).toBe(0)
    r.lease.dropWintab("12") // idempotent: nothing more is sent
    expect(r.sent).toHaveLength(2)
  })
  it("a handle the guard closed (lease, panic key) is forgotten and announced", async () => {
    const r = rig()
    await r.ready()
    const heard: string[] = []
    r.lease.onWintabClosed((h, why) => heard.push(`${h}:${why}`))
    r.lease.holdWintab("12", "system")
    r.say("closed-wintab 12 panic-key")
    expect(heard).toEqual(["12:panic-key"])
    expect(r.lease.held().wintab).toEqual([])
    expect(r.liveTimers()).toBe(0)
    r.say("closed-wintab 99 lease") // not one of ours: no announcement
    expect(heard).toHaveLength(1)
  })
  it("the heartbeat survives a clip release while a Wintab handle is still held", async () => {
    const r = rig()
    await r.ready()
    r.lease.holdWintab("12", "system")
    r.lease.armClip(BOX, 800)
    r.lease.freeClip()
    expect(r.liveTimers()).toBe(1)
  })
})

describe("dispose", () => {
  it("frees the clip, quits the guard and stops everything", async () => {
    const r = rig()
    await r.ready()
    r.lease.armClip(BOX, 800)
    r.state.clip = SHEET
    r.lease.holdWintab("5", "data")
    r.lease.dispose()
    expect(r.sent).toContain("free\n")
    expect(r.sent.at(-1)).toBe("quit\n")
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.liveTimers()).toBe(0)
    expect(r.lease.state()).toBe("none")
    expect(r.lease.held()).toEqual({ clip: null, wintab: [] })
  })
  it("is idempotent, and nothing can start afterwards", async () => {
    const r = rig()
    await r.ready()
    r.lease.dispose()
    r.lease.dispose()
    expect(await r.lease.start()).toBe(false)
    expect(r.lease.armClip(BOX, 800)).toBe(false)
  })
  it("the guard's exit after dispose is not reported as a loss", async () => {
    const r = rig()
    await r.ready()
    r.lease.dispose()
    r.exit(0)
    expect(r.lost).toEqual([])
  })
  it("dispose before start is harmless", () => {
    const r = rig()
    expect(() => r.lease.dispose()).not.toThrow()
  })
})
