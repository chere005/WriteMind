import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { limiter, partialOf, within, writeFileAtomic } from "../src/main/atomic"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-atomic-"))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// An 80 MB save polled from another process showed the note at sizes 0, 524288, 1048576 … (verifier t12):
// fs.writeFile truncates and then fills. The Mac writes atomically; so does this.
describe("a save that leaves no half a file", () => {
  it("shows a reader the old note whole, then the new one whole — never an empty or cut-off one", async () => {
    const dir = scratch()
    const file = path.join(dir, "big.md")
    const old = "old\n".repeat(1000)
    writeFileSync(file, old)
    const next = "n".repeat(40 * 1024 * 1024)
    let polling = true
    const seen = new Set<number>()
    const poll = (async () => {
      while (polling) {
        try { seen.add(statSync(file).size) } catch { seen.add(-1) }
        await sleep(0)
      }
    })()
    await writeFileAtomic(file, next)
    polling = false
    await poll
    expect(seen.has(-1)).toBe(false)
    expect(seen.has(0)).toBe(false)
    for (const size of seen) expect([old.length, next.length]).toContain(size)
    expect(readFileSync(file, "utf8").length).toBe(next.length)
  })

  it("leaves nothing beside the note afterwards", async () => {
    const dir = scratch()
    const file = path.join(dir, "one.md")
    await writeFileAtomic(file, "hello")
    await writeFileAtomic(file, "hello again")
    expect(readdirSync(dir)).toEqual(["one.md"])
    expect(readFileSync(file, "utf8")).toBe("hello again")
  })

  it("writes two saves of one file one after the other, and the second wins", async () => {
    const dir = scratch()
    const file = path.join(dir, "race.md")
    await Promise.all([writeFileAtomic(file, "first"), writeFileAtomic(file, "second"), writeFileAtomic(file, "third")])
    expect(readFileSync(file, "utf8")).toBe("third")
    expect(readdirSync(dir)).toEqual(["race.md"])
  })

  it("says so at once for a read-only file, changes nothing, and leaves no .tmp behind", async () => {
    const dir = scratch()
    const file = path.join(dir, "locked.md")
    writeFileSync(file, "keep me")
    chmodSync(file, 0o444)
    const started = Date.now()
    try {
      await expect(writeFileAtomic(file, "overwrite")).rejects.toMatchObject({ code: expect.stringMatching(/EPERM|EACCES/) })
      expect(Date.now() - started).toBeLessThan(400)
      expect(readFileSync(file, "utf8")).toBe("keep me")
      expect(existsSync(partialOf(file))).toBe(false)
    } finally { chmodSync(file, 0o644) }
  })

  it("takes its .tmp away when the rename cannot happen (a folder where the file should be)", async () => {
    const dir = scratch()
    const file = path.join(dir, "taken")
    writeFileSync(path.join(dir, "keep.txt"), "x")
    // A directory at the target: the write to the .tmp works, the rename over a directory does not.
    const { mkdirSync } = await import("node:fs")
    mkdirSync(file)
    await expect(writeFileAtomic(file, "data")).rejects.toBeTruthy()
    expect(existsSync(partialOf(file))).toBe(false)
  })
})

describe("the limiter", () => {
  it("never runs more than its number at once, and runs everything", async () => {
    const run = limiter(5)
    let active = 0
    let peak = 0
    let done = 0
    await Promise.all(Array.from({ length: 60 }, () => run(async () => {
      active += 1
      peak = Math.max(peak, active)
      await sleep(2)
      active -= 1
      done += 1
    })))
    expect(peak).toBe(5)
    expect(done).toBe(60)
  })

  it("passes a task's answer and its failure through, and frees the place either way", async () => {
    const run = limiter(1)
    await expect(run(async () => { throw new Error("no") })).rejects.toThrow("no")
    await expect(run(async () => 7)).resolves.toBe(7)
  })
})

describe("within", () => {
  it("answers null for work that has not finished in time (a share that is not reachable)", async () => {
    expect(await within(30, new Promise(() => undefined))).toBeNull()
    expect(await within(500, Promise.resolve("fast"))).toBe("fast")
    expect(await within(500, Promise.reject(new Error("failed")))).toBeNull()
  })
})
