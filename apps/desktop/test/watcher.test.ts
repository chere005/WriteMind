import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { followFolders, isDeadName, nodePorts, type WatchHandle, type WatchHooks, type WatchPorts } from "../src/main/watcher"

/**
 * The project's folders, watched — and what happens when one is deleted under the app, pulled out, or not there yet
 * (verifier t1/t1b/t19/t25: a deleted folder made the watcher say "rename \\?\C:\…" ninety thousand times a second
 * for ever — a pinned core, the sidebar's tree read five times a second — and a folder that appeared after launch
 * was never watched).
 */

/** Ports the test drives by hand: which folders exist, and the callbacks of the watchers that are open. */
function fake() {
  const there = new Set<string>()
  const unsure = new Set<string>()
  const open: { root: string; hear(name: string | null): void; fail(): void; closed: boolean }[] = []
  const ports: WatchPorts = {
    watch(root, onEvent, onError) {
      if (!there.has(root)) throw new Error("ENOENT")
      const one = { root, hear: onEvent, fail: onError, closed: false }
      open.push(one)
      return { close: () => { one.closed = true } } satisfies WatchHandle
    },
    async look(root) {
      return unsure.has(root) ? "unknown" : there.has(root) ? "folder" : "gone"
    },
  }
  const live = (root: string) => open.filter((one) => one.root === root && !one.closed)
  return { there, unsure, open, ports, live }
}

function hooks() {
  const calls = {
    events: [] as [string, string | null][],
    covered: [] as string[][],
    presence: [] as [string, boolean][],
  }
  const value: WatchHooks = {
    event: (root, name) => { calls.events.push([root, name]) },
    covered: (folders) => { calls.covered.push([...folders]) },
    presence: (root, here) => { calls.presence.push([root, here]) },
  }
  return { calls, value }
}

const A = path.resolve("/watched/Alpha")
const B = path.resolve("/watched/Beta")
const tick = (ms = 100) => vi.advanceTimersByTimeAsync(ms)

describe("a watched folder is deleted (the flood)", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("an event that is the folder's own absolute path closes the watcher on the first one", () => {
    const world = fake()
    world.there.add(A)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A])
    expect(watch.covered()).toEqual([A])
    const [one] = world.live(A)
    one!.hear("note.md")
    one!.hear("\\\\?\\C:\\watched\\Alpha")
    // ...and the thousands that come after it are not heard at all
    for (let i = 0; i < 5000; i++) one!.hear("\\\\?\\C:\\watched\\Alpha")
    expect(h.calls.events).toEqual([[A, "note.md"]])
    expect(one!.closed).toBe(true)
    expect(watch.covered()).toEqual([])
    expect(h.calls.presence).toEqual([[A, false]])
    watch.stop()
  })

  it("an absolute name is a dead folder in any spelling; a name inside the folder is not", () => {
    expect(isDeadName("\\\\?\\C:\\x\\Alpha")).toBe(true)
    expect(isDeadName(path.resolve("/x/Alpha"))).toBe(true)
    expect(isDeadName("sub\\a.md")).toBe(false)
    expect(isDeadName("a.md")).toBe(false)
    expect(isDeadName("")).toBe(false)
  })

  it("a burst of events looks at the folder, whatever the names are, and lets go of one that is gone", async () => {
    const world = fake()
    world.there.add(A)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 60_000, burst: 50 })
    watch.set([A])
    const [one] = world.live(A)
    world.there.delete(A)
    for (let i = 0; i < 60; i++) one!.hear(`n${i}.md`)
    await tick(1)
    expect(one!.closed).toBe(true)
    expect(h.calls.presence).toEqual([[A, false]])
    watch.stop()
  })

  it("a burst in a folder that IS there (a git checkout) is just a burst: the watcher stays", async () => {
    const world = fake()
    world.there.add(A)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 60_000, burst: 50 })
    watch.set([A])
    const [one] = world.live(A)
    for (let i = 0; i < 500; i++) one!.hear(`n${i}.md`)
    await tick(1)
    expect(one!.closed).toBe(false)
    expect(h.calls.events).toHaveLength(500)
    expect(h.calls.presence).toEqual([])
    watch.stop()
  })

  it("a folder renamed away (no events at all) is let go at the next look, and watched again when it is back", async () => {
    const world = fake()
    world.there.add(A)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A])
    world.there.delete(A)
    await tick(150)
    expect(h.calls.presence).toEqual([[A, false]])
    expect(watch.covered()).toEqual([])
    // still gone: nothing more is said, nothing is retried into the void
    await tick(500)
    expect(h.calls.presence).toEqual([[A, false]])
    world.there.add(A)
    await tick(150)
    expect(h.calls.presence).toEqual([[A, false], [A, true]])
    expect(watch.covered()).toEqual([A])
    expect(world.live(A)).toHaveLength(1)
    watch.stop()
  })

  it("a look that gets no answer (a share that is not reachable) changes nothing", async () => {
    const world = fake()
    world.there.add(A)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A])
    world.unsure.add(A)
    world.there.delete(A)
    await tick(500)
    expect(h.calls.presence).toEqual([])
    expect(watch.covered()).toEqual([A])
    world.unsure.delete(A)
    await tick(150)
    expect(h.calls.presence).toEqual([[A, false]])
    watch.stop()
  })

  it("the watcher's own error lets it go, and a folder that is still there is watched again at the next look", async () => {
    const world = fake()
    world.there.add(A)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A])
    world.live(A)[0]!.fail()
    expect(watch.covered()).toEqual([])
    await tick(150)
    expect(watch.covered()).toEqual([A])
    expect(h.calls.presence).toEqual([[A, false], [A, true]])
    watch.stop()
  })

  it("only the folder that went is let go", async () => {
    const world = fake()
    world.there.add(A)
    world.there.add(B)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A, B])
    world.live(A)[0]!.hear("\\\\?\\C:\\watched\\Alpha")
    expect(watch.covered()).toEqual([B])
    world.live(B)[0]!.hear("b.md")
    expect(h.calls.events).toEqual([[B, "b.md"]])
    watch.stop()
  })
})

describe("a folder that is not there at launch (a stick not plugged in yet)", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("is tried again, watched when it appears, and the page is told once", async () => {
    const world = fake()
    world.there.add(B)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A, B])
    expect(watch.covered()).toEqual([B])
    expect(h.calls.presence).toEqual([])   // it was never there: the page's first look already said so
    await tick(450)
    expect(h.calls.presence).toEqual([])
    world.there.add(A)
    await tick(150)
    expect(watch.covered()).toEqual([A, B])
    expect(h.calls.presence).toEqual([[A, true]])
    await tick(500)
    expect(h.calls.presence).toEqual([[A, true]])
    world.live(A)[0]!.hear("plugged.md")
    expect(h.calls.events).toEqual([[A, "plugged.md"]])
    watch.stop()
  })

  it("a window coming forward looks at once", async () => {
    const world = fake()
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 60_000 })
    watch.set([A])
    world.there.add(A)
    await watch.look()
    expect(watch.covered()).toEqual([A])
    expect(h.calls.presence).toEqual([[A, true]])
    watch.stop()
  })

  it("choosing other folders lets the old watchers go, and an answer that was in flight is dropped", async () => {
    const world = fake()
    world.there.add(A)
    world.there.add(B)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A])
    const [first] = world.live(A)
    watch.set([B])
    expect(first!.closed).toBe(true)
    expect(watch.covered()).toEqual([B])
    world.there.delete(A)
    await tick(500)
    expect(h.calls.presence).toEqual([])
    watch.stop()
    expect(watch.covered()).toEqual([])
    expect(world.live(B)).toHaveLength(0)
  })

  it("stop() leaves no timer behind", async () => {
    const world = fake()
    world.there.add(A)
    const h = hooks()
    const watch = followFolders(world.ports, h.value, { every: 100 })
    watch.set([A])
    watch.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// The real thing: a real recursive watcher on a real folder that is really deleted. On Windows that is the flood.
describe("with the real file system", () => {
  const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-watch-"))
  const until = async (test: () => boolean, ms = 6000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (test()) return true; await new Promise((r) => setTimeout(r, 40)) }
    return test()
  }

  it("a deleted folder is heard of once, not for ever; the folder coming back is watched again", async () => {
    const base = scratch()
    const folder = path.join(base, "Alpha")
    mkdirSync(path.join(folder, "sub"), { recursive: true })
    writeFileSync(path.join(folder, "sub", "a.md"), "x")
    const h = hooks()
    const watch = followFolders(nodePorts, h.value, { every: 120 })
    watch.set([folder])
    try {
      expect(watch.covered()).toEqual([folder])
      rmSync(folder, { recursive: true, force: true })
      expect(await until(() => h.calls.presence.some(([, here]) => !here))).toBe(true)
      // (unwatched, the same deletion made ~300,000 callbacks in two seconds on Windows)
      const after = h.calls.events.length
      await new Promise((r) => setTimeout(r, 400))
      expect(h.calls.events.length).toBe(after)
      expect(after).toBeLessThan(60)
      expect(watch.covered()).toEqual([])

      mkdirSync(folder, { recursive: true })
      expect(await until(() => h.calls.presence.some(([, here]) => here))).toBe(true)
      expect(watch.covered()).toEqual([folder])
      const before = h.calls.events.length
      writeFileSync(path.join(folder, "back.md"), "hello")
      expect(await until(() => h.calls.events.length > before)).toBe(true)
    } finally {
      watch.stop()
      rmSync(base, { recursive: true, force: true })
    }
  }, 30_000)

  it("a folder that is not there is watched when it is made", async () => {
    const base = scratch()
    const folder = path.join(base, "Later")
    const h = hooks()
    const watch = followFolders(nodePorts, h.value, { every: 120 })
    watch.set([folder])
    try {
      expect(watch.covered()).toEqual([])
      mkdirSync(folder)
      expect(await until(() => watch.covered().length === 1)).toBe(true)
      expect(h.calls.presence).toEqual([[folder, true]])
    } finally {
      watch.stop()
      rmSync(base, { recursive: true, force: true })
    }
  }, 30_000)
})
