// The guard's release rules, against a fake OS and a fake clock. Every way out of "something is held" is one test.
import { describe, expect, it } from "vitest"
import { DATA_LEASE_MS, DEFAULT_LEASE_MS, wintabMarker, type LeaseJournal, type Rect, type Win32Clip } from "../../src/main/pen/clip"
import { GuardCore, MAX_HELD_HANDLES, sweepJournal, type GuardPorts } from "../../src/main/pen/guardCore"

const SCREEN: Rect = { left: 0, top: 0, right: 1920, bottom: 1200 }
const SHEET: Rect = { left: 1100, top: 200, right: 1800, bottom: 900 }
const APP = 4242
const GUARD = 4343

function rig(opts: { clip?: Rect } = {}) {
  let t = 10_000
  const state = { clip: opts.clip ?? SCREEN, chord: false, alive: new Set([APP]), exited: null as number | null, setCalls: [] as (Rect | null)[] }
  const names = new Map<string, string>()
  const closed: string[] = []
  const out: string[] = []
  const journals: (LeaseJournal | null)[] = []
  const clip: Win32Clip = {
    getClip: () => state.clip,
    setClip: (r) => { state.setCalls.push(r); state.clip = r ?? SCREEN; return true },
    screen: () => SCREEN,
  }
  const ports: GuardPorts = {
    clip,
    wintab: { name: (h) => names.get(h) ?? null, close: (h) => { closed.push(h); names.delete(h); return true } },
    now: () => t,
    out: (l) => { out.push(l) },
    journal: (j) => { journals.push(j) },
    panicChordDown: () => state.chord,
    pidAlive: (p) => state.alive.has(p),
    exit: (c) => { state.exited = c },
  }
  const core = new GuardCore(ports, GUARD, APP)
  const send = (...lines: string[]) => lines.forEach((l) => core.handleLine(l))
  const advance = (ms: number, step = 50) => { const end = t + ms; while (t < end) { t = Math.min(end, t + step); core.tick() } }
  return { core, state, names, closed, out, journals, send, advance, setNow: (v: number) => { t = v }, get now() { return t } }
}

const ARM = `arm ${SHEET.left} ${SHEET.top} ${SHEET.right} ${SHEET.bottom} 800`

describe("clip: arming", () => {
  it("sets the clip, journals it BEFORE the OS call, and says so", () => {
    const r = rig()
    r.send(ARM)
    expect(r.state.clip).toEqual(SHEET)
    expect(r.out).toContain("armed 1100 200 1800 900")
    expect(r.journals[0]).toMatchObject({ guardPid: GUARD, appPid: APP, clip: SHEET, wintab: [] })
    expect(r.core.holding()).toBe(true)
  })
  it("refuses a rectangle that is not plainly sane (the guard is the last line)", () => {
    for (const line of ["arm 0 0 1920 1200 800", "arm 10 10 100 100 800", "arm 500 500 100 100 800", "arm -100 0 600 600 800", "arm 1100 200 2500 900 800"]) {
      const r = rig()
      r.send(line)
      expect(r.out, line).toContain("err bad-rect")
      expect(r.state.clip, line).toEqual(SCREEN)
      expect(r.core.holding(), line).toBe(false)
    }
  })
  it("never fights somebody else's clip", () => {
    const foreign: Rect = { left: 10, top: 10, right: 900, bottom: 700 }
    const r = rig({ clip: foreign })
    r.send(ARM)
    expect(r.out).toContain("foreign arm")
    expect(r.state.clip).toEqual(foreign)
    expect(r.core.holding()).toBe(false)
    r.send("quit")
    expect(r.state.clip).toEqual(foreign) // quitting never touches a clip it does not own
  })
  it("re-arming over its own rectangle replaces it", () => {
    const r = rig()
    r.send(ARM)
    r.send("arm 1000 150 1700 850 800")
    expect(r.state.clip).toEqual({ left: 1000, top: 150, right: 1700, bottom: 850 })
  })
  it("if somebody changed the clip under it, the next arm is refused and the stale belief is dropped", () => {
    const r = rig()
    r.send(ARM)
    r.state.clip = { left: 1, top: 1, right: 400, bottom: 300 } // a game took over
    r.send(ARM)
    expect(r.out).toContain("foreign arm")
    expect(r.core.holding()).toBe(false)
    expect(r.state.clip).toEqual({ left: 1, top: 1, right: 400, bottom: 300 })
  })
})

describe("clip: the ways out", () => {
  it("`free` releases and the journal is deleted", () => {
    const r = rig()
    r.send(ARM, "free")
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.out).toContain("freed free")
    expect(r.journals.at(-1)).toBeNull()
    expect(r.core.holding()).toBe(false)
  })
  it("`free` with nothing armed says so and touches nothing", () => {
    const r = rig()
    r.send("free")
    expect(r.out).toEqual(["freed none"])
    expect(r.state.setCalls).toEqual([])
  })
  it("beats keep it armed across many leases", () => {
    const r = rig()
    r.send(ARM)
    for (let i = 0; i < 20; i++) { r.advance(250); r.send("beat") }
    expect(r.state.clip).toEqual(SHEET)
    expect(r.out.filter((l) => l === "expired")).toEqual([])
  })
  it("a HUNG app (no beats) loses the clip at the lease, and the guard stays alive and re-armable", () => {
    const r = rig()
    r.send(ARM)
    r.advance(DEFAULT_LEASE_MS - 100)
    expect(r.state.clip).toEqual(SHEET)
    r.advance(200)
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.out).toContain("freed lease")
    expect(r.out).toContain("expired")
    expect(r.core.finished()).toBe(false)
    r.send(ARM)
    expect(r.state.clip).toEqual(SHEET)
  })
  it("the lease is the one the app asked for", () => {
    const r = rig()
    r.send("arm 1100 200 1800 900 3000")
    r.advance(2500)
    expect(r.state.clip).toEqual(SHEET)
    r.advance(700)
    expect(r.state.clip).toEqual(SCREEN)
  })
  it("a DEAD app (stdin closed) releases at once and the process ends", () => {
    const r = rig()
    r.send(ARM)
    r.core.eof()
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.out).toContain("freed eof")
    expect(r.state.exited).toBe(0)
    expect(r.journals.at(-1)).toBeNull()
  })
  it("an app whose pid is gone ends it even if the pipe never closes", () => {
    const r = rig()
    r.send(ARM)
    r.state.alive.delete(APP)
    r.advance(100)
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.out).toContain("freed app-dead")
    expect(r.state.exited).toBe(0)
  })
  it("`quit` releases and ends", () => {
    const r = rig()
    r.send(ARM, "quit")
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.state.exited).toBe(0)
  })
  it("a clip that is no longer the armed rectangle is left alone and reported foreign", () => {
    const r = rig()
    r.send(ARM)
    const theirs: Rect = { left: 0, top: 0, right: 800, bottom: 600 }
    r.state.clip = theirs
    r.advance(1000)
    expect(r.state.clip).toEqual(theirs)
    expect(r.out).toContain("foreign lease")
  })
  it("the last gasp (an exit we did not expect) releases a still-ours clip, and only that", () => {
    const a = rig()
    a.send(ARM)
    a.core.lastGasp()
    expect(a.state.clip).toEqual(SCREEN)
    const b = rig()
    b.send(ARM)
    const theirs: Rect = { left: 5, top: 5, right: 500, bottom: 400 }
    b.state.clip = theirs
    b.core.lastGasp()
    expect(b.state.clip).toEqual(theirs)
  })
  it("after the end, further input is ignored", () => {
    const r = rig()
    r.send("quit")
    r.send(ARM)
    expect(r.state.clip).toEqual(SCREEN)
    r.core.tick()
  })
  it("bad commands are answered, never thrown", () => {
    const r = rig()
    r.send("explode", "arm x", "hold-wintab 1 2")
    expect(r.out.filter((l) => l === "err bad-command")).toHaveLength(3)
  })
})

describe("the panic chord (Ctrl+Alt+G), read by the guard itself", () => {
  it("releases the clip and every Wintab context while held, once per press", () => {
    const r = rig()
    r.names.set("55", wintabMarker(APP))
    r.send(ARM, "hold-wintab 55 4242 system")
    r.state.chord = true
    r.advance(50)
    expect(r.state.clip).toEqual(SCREEN)
    expect(r.closed).toEqual(["55"])
    expect(r.out).toContain("panic-key")
    expect(r.core.holding()).toBe(false)
    // still pressed: no second release, no repeat line
    const lines = r.out.length
    r.advance(500)
    expect(r.out.length).toBe(lines)
    // let go and press again while armed again: works again
    r.state.chord = false
    r.advance(100)
    r.send(ARM)
    r.state.chord = true
    r.advance(50)
    expect(r.state.clip).toEqual(SCREEN)
  })
  it("works with no beat at all (an app that is frozen)", () => {
    const r = rig()
    r.send("arm 1100 200 1800 900 10000")
    r.advance(200)
    r.state.chord = true
    r.advance(50)
    expect(r.state.clip).toEqual(SCREEN)
  })
  it("pressing it with nothing held does nothing and does not stay latched into the next hold", () => {
    const r = rig()
    r.state.chord = true
    r.advance(100)
    expect(r.out).toEqual([])
    r.state.chord = false
    r.advance(100)
    r.send(ARM)
    expect(r.state.clip).toEqual(SHEET)
  })
  it("a throwing key reader is treated as 'not pressed'", () => {
    const r = rig()
    const orig = (r.core as unknown as { p: GuardPorts }).p
    orig.panicChordDown = () => { throw new Error("no user32") }
    r.send(ARM)
    expect(() => r.advance(100)).not.toThrow()
    expect(r.state.clip).toEqual(SHEET)
  })
})

describe("Wintab holds: closed only when positively identified", () => {
  it("a held context of ours is closed when the app dies", () => {
    const r = rig()
    r.names.set("77", wintabMarker(APP))
    r.send("hold-wintab 77 4242 system")
    expect(r.out).toContain("held-wintab 77 system")
    r.core.eof()
    expect(r.closed).toEqual(["77"])
    expect(r.out).toContain("closed-wintab 77 eof")
  })
  it("a handle whose name is not ours is NEVER closed (the spike once closed a driver context by guessing)", () => {
    const r = rig()
    r.names.set("77", "Wacom Tablet Context")
    r.send("hold-wintab 77 4242 data")
    r.core.eof()
    expect(r.closed).toEqual([])
    expect(r.out).toContain("closed-wintab 77 not-ours")
  })
  it("a pid in the name that is not the app's is not ours either", () => {
    const r = rig()
    r.names.set("77", wintabMarker(999))
    r.send("hold-wintab 77 4242 data")
    r.core.eof()
    expect(r.closed).toEqual([])
  })
  it("a handle that no longer exists is reported gone and not closed", () => {
    const r = rig()
    r.send("hold-wintab 77 4242 data")
    r.core.eof()
    expect(r.closed).toEqual([])
    expect(r.out).toContain("closed-wintab 77 gone")
  })
  it("a SYSTEM context is closed at the short lease, a DATA context at the long one", () => {
    const r = rig()
    r.names.set("1", wintabMarker(APP))
    r.names.set("2", wintabMarker(APP))
    r.send("hold-wintab 1 4242 system", "hold-wintab 2 4242 data")
    r.advance(DEFAULT_LEASE_MS + 100)
    expect(r.closed).toEqual(["1"])
    r.advance(DATA_LEASE_MS)
    expect(r.closed).toEqual(["1", "2"])
    expect(r.core.holding()).toBe(false)
  })
  it("beats keep both alive", () => {
    const r = rig()
    r.names.set("1", wintabMarker(APP))
    r.send("hold-wintab 1 4242 system")
    for (let i = 0; i < 40; i++) { r.advance(250); r.send("beat") }
    expect(r.closed).toEqual([])
  })
  it("drop-wintab (the app closed it itself) forgets it without closing", () => {
    const r = rig()
    r.names.set("1", wintabMarker(APP))
    r.send("hold-wintab 1 4242 data", "drop-wintab 1")
    r.core.eof()
    expect(r.closed).toEqual([])
    expect(r.core.heldHandles()).toEqual([])
  })
  it("the number of held handles is bounded", () => {
    const r = rig()
    for (let i = 1; i <= MAX_HELD_HANDLES + 5; i++) r.send(`hold-wintab ${i} 4242 data`)
    expect(r.core.heldHandles()).toHaveLength(MAX_HELD_HANDLES)
    expect(r.out).toContain("err too-many-handles")
  })
  it("the journal lists what is held, and is deleted when nothing is", () => {
    const r = rig()
    r.names.set("9", wintabMarker(APP))
    r.send(ARM, "hold-wintab 9 4242 system")
    expect(r.journals.at(-1)).toMatchObject({ guardPid: GUARD, appPid: APP, clip: SHEET, wintab: [{ handle: "9", mode: "system" }] })
    r.send("free", "drop-wintab 9")
    expect(r.journals.at(-1)).toBeNull()
  })
  it("a close that fails is reported, not hidden", () => {
    const r = rig()
    r.names.set("3", wintabMarker(APP))
    ;(r.core as unknown as { p: GuardPorts }).p.wintab.close = () => false
    r.send("hold-wintab 3 4242 data")
    r.core.eof()
    expect(r.out).toContain("closed-wintab 3 close-failed")
  })
})

describe("the sweep at the next launch", () => {
  function sweepRig(clip: Rect, alive: number[] = []) {
    const names = new Map<string, string>()
    const closed: string[] = []
    const set: (Rect | null)[] = []
    const state = { clip }
    const ports = {
      clip: { getClip: () => state.clip, setClip: (r: Rect | null) => { set.push(r); state.clip = r ?? SCREEN; return true }, screen: () => SCREEN } satisfies Win32Clip,
      wintab: { name: (h: string) => names.get(h) ?? null, close: (h: string) => { closed.push(h); return true } },
      pidAlive: (p: number) => alive.includes(p),
    }
    return { ports, names, closed, set, state }
  }
  const journal = (over: Partial<LeaseJournal> = {}): LeaseJournal => ({ guardPid: 1, appPid: 2, clip: SHEET, wintab: [], at: 0, ...over })

  it("no journal: nothing happens", () => {
    const s = sweepRig(SHEET)
    expect(sweepJournal(null, s.ports, 99)).toEqual({ journal: "none", clip: "none", wintabClosed: [], wintabSkipped: [] })
    expect(s.set).toEqual([])
  })
  it("both owners dead and the clip is still our rectangle: released", () => {
    const s = sweepRig(SHEET)
    const r = sweepJournal(journal(), s.ports, 99)
    expect(r).toMatchObject({ journal: "swept", clip: "released" })
    expect(s.state.clip).toEqual(SCREEN)
  })
  it("a clip that is not ours is left alone", () => {
    const theirs: Rect = { left: 0, top: 0, right: 640, bottom: 480 }
    const s = sweepRig(theirs)
    expect(sweepJournal(journal(), s.ports, 99)).toMatchObject({ journal: "swept", clip: "left" })
    expect(s.state.clip).toEqual(theirs)
  })
  it("no clip active: the record was litter", () => {
    const s = sweepRig(SCREEN)
    expect(sweepJournal(journal(), s.ports, 99).clip).toBe("none")
    expect(s.set).toEqual([])
  })
  it("a journal whose app or guard still runs is live and untouched", () => {
    for (const alive of [[2], [1]]) {
      const s = sweepRig(SHEET, alive)
      expect(sweepJournal(journal(), s.ports, 99).journal).toBe("alive")
      expect(s.state.clip).toEqual(SHEET)
    }
  })
  it("Wintab: closes only handles named for the dead app, skips the rest", () => {
    const s = sweepRig(SCREEN)
    s.names.set("10", wintabMarker(2))
    s.names.set("11", "Somebody else")
    s.names.set("12", wintabMarker(77))
    const r = sweepJournal(journal({ clip: null, wintab: ["10", "11", "12", "13"].map((handle) => ({ handle, mode: "data" as const })) }), s.ports, 99)
    expect(r.wintabClosed).toEqual(["10"])
    expect(r.wintabSkipped).toEqual([{ handle: "11", why: "not-ours" }, { handle: "12", why: "not-ours" }, { handle: "13", why: "gone" }])
    expect(s.closed).toEqual(["10"])
  })
})
