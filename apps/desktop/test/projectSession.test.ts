import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { projectSessionFile, readProjectSession, writeProjectSession } from "../src/main/project"

/**
 * The project's session is written from a debounce, from the hot-exit throttle and from a flush on a switch, so
 * two writes of one project's session are often in flight together (verifier t3-sessionrace / t16-switch /
 * t2-projectfile). It used to be written through a `.tmp` it shared by hand, and overlapping writes trampled
 * each other: "ENOENT … rename default.json.tmp" and "EPERM" in the red bar, and in a direct test four overlapping
 * writes lost 42 of 120 and left a session file that was not JSON — the hot-exit buffer with it.
 */

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-session-"))
const session = (n: number, size: number) => JSON.stringify({ n, text: "x".repeat(size) })

describe("writing a project's session", () => {
  it("overlapping writes of a large and a small session all succeed and leave a whole file", async () => {
    const userData = scratch()
    const writes: Promise<void>[] = []
    for (let round = 0; round < 30; round++) {
      for (let writer = 0; writer < 4; writer++) {
        // two big, two small, fired together
        writes.push(writeProjectSession(userData, null, session(round * 4 + writer, writer % 2 === 0 ? 340_000 : 40)))
      }
      if (round % 3 === 0) await new Promise((r) => setTimeout(r, 1))
    }
    const settled = await Promise.allSettled(writes)
    expect(settled.filter((one) => one.status === "rejected")).toEqual([])
    const file = projectSessionFile(userData, null)
    const text = readFileSync(file, "utf8")
    expect(() => JSON.parse(text)).not.toThrow()
    // the last one fired is the one that stands
    expect(JSON.parse(text).n).toBe(30 * 4 - 1)
    expect(readdirSync(path.dirname(file))).toEqual(["default.json"])
  }, 60_000)

  it("two projects' sessions are separate files, each whole", async () => {
    const userData = scratch()
    const fileA = path.join(userData, "A.writemind-project")
    const fileB = path.join(userData, "B.writemind-project")
    await Promise.all([
      writeProjectSession(userData, fileA, session(1, 1000)),
      writeProjectSession(userData, fileB, session(2, 1000)),
      writeProjectSession(userData, fileA, session(3, 10)),
    ])
    expect(JSON.parse((await readProjectSession(userData, fileA, userData))!).n).toBe(3)
    expect(JSON.parse((await readProjectSession(userData, fileB, userData))!).n).toBe(2)
    expect(existsSync(projectSessionFile(userData, fileA) + ".tmp")).toBe(false)
  })
})
