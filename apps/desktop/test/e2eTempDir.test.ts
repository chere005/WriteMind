// The end-to-end runner's temp folders (e2e/lib/instance.mjs `makeTempDir`) hold every instance's notes folder, profile and log,
// and the notes root an instance reports is a path under one. They are named by their LONG path: a Windows runner's
// `os.tmpdir()` is an 8.3 short path (`C:\Users\RUNNER~1\…`), a Mac's is `/var/…` for `/private/var/…`.
import { realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
// @ts-expect-error: a plain .mjs next to the suites
import { makeTempDir } from "../../../e2e/lib/instance.mjs"

const made: string[] = []
afterEach(() => { for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true }) })
const fresh = (prefix?: string): string => { const dir: string = makeTempDir(prefix); made.push(dir); return dir }

describe("e2e/lib/instance.mjs makeTempDir", () => {
  it("is a new folder in the system's temp folder, with the prefix", () => {
    const dir = fresh("wm-e2e-tempdir-")
    expect(path.basename(dir).startsWith("wm-e2e-tempdir-")).toBe(true)
    expect(path.dirname(dir)).toBe(realpathSync.native(os.tmpdir()))
  })

  it("is spelled the way the system spells it (no 8.3 short name, no symlink in the way)", () => {
    const dir = fresh()
    expect(dir).toBe(realpathSync.native(dir))
    if (process.platform === "win32") expect(dir).not.toMatch(/~\d/)
  })
})
