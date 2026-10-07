// Port-only: no XCTest. The Wolfram export checked by the REAL engine (apps/desktop/scripts/check-wolfram.ts). It starts
// wolframscript (a dozen seconds), so it is OPT-IN — `WRITEMIND_WOLFRAM_CHECK=1 npm test -- wolframCheck` — and it
// skips by itself where there is no wolframscript. `npm test` never runs the engine.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createProcessRunner } from "../src/main/eval/runner"

const ROOT = path.resolve(__dirname, "../../..")
const tool = process.env.WRITEMIND_WOLFRAM_CHECK === "1"
  ? (() => { const folder = process.env.VITEST; process.env.VITEST = ""; try { return createProcessRunner().tools().wolfram.path } finally { if (folder !== undefined) process.env.VITEST = folder } })()
  : null

describe.skipIf(!tool)("the Wolfram export, checked by the real engine", () => {
  it("the kernel gets every notebook, image and clipboard payload back as what it was", () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "wm-wolfram-check-"))
    try {
      // A child with the test host's mark removed: the runner starts nothing under vitest.
      const env = { ...process.env }
      delete env.VITEST
      const ran = spawnSync(process.execPath, [path.join(ROOT, "node_modules/vite-node/vite-node.mjs"), "apps/desktop/scripts/check-wolfram.ts", out],
        { cwd: ROOT, env, encoding: "utf8", timeout: 280_000 })
      expect(ran.stdout).toContain("ALL OK")
      expect(ran.status).toBe(0)
      expect(existsSync(path.join(out, "engine.nb"))).toBe(true)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 300_000)
})
