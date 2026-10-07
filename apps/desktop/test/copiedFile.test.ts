// Port-only: no XCTest. The SVG file a Copy Cell leaves on the clipboard (main/wolfram/copiedFile.ts): it must outlive the
// copy (an app reads it when it is pasted), the next copy sweeps the earlier ones, and the app's start sweeps the old.
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { COPIED_SVG_NAME as COPIED_SVG } from "@writemind/core"
import { saveCopiedSvg, sweepCopiedSvgs } from "../src/main/wolfram/copiedFile"

let root = ""
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "wm-copied-test-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe("saveCopiedSvg", () => {
  it("writes Drawing.svg in a folder of its own, and keeps it", async () => {
    const file = await saveCopiedSvg(path.join(root, "WriteMind-copied"), "<svg/>")
    expect(path.basename(file)).toBe(COPIED_SVG)
    expect(await fs.readFile(file, "utf8")).toBe("<svg/>")
  })

  it("the next copy sweeps the earlier ones away and keeps only its own", async () => {
    const under = path.join(root, "WriteMind-copied")
    const first = await saveCopiedSvg(under, "<svg id='1'/>")
    const second = await saveCopiedSvg(under, "<svg id='2'/>")
    expect(first).not.toBe(second)
    await expect(fs.stat(first)).rejects.toThrow()
    expect(await fs.readFile(second, "utf8")).toBe("<svg id='2'/>")
    expect(await fs.readdir(under)).toHaveLength(1)
  })
})

describe("sweepCopiedSvgs", () => {
  it("removes copies older than the keep time and leaves the newer, and is quiet when there is no folder", async () => {
    const under = path.join(root, "WriteMind-copied")
    const file = await saveCopiedSvg(under, "<svg/>")
    expect(await sweepCopiedSvgs(under, Date.now())).toBe(0)
    await fs.stat(file)
    expect(await sweepCopiedSvgs(under, Date.now() + 25 * 60 * 60 * 1000)).toBe(1)
    await expect(fs.stat(file)).rejects.toThrow()
    expect(await sweepCopiedSvgs(path.join(root, "nothing"), Date.now())).toBe(0)
  })
})
