// REAL processes, REAL ClipCursor: scripts/pen-guard-proof.mjs run under vitest. Gated: it clips the real mouse for a few hundred
// milliseconds per scenario, so it only runs on request:   set WM_PEN_REAL=1 && npm test -- guardProof
// (It is also runnable on its own:  node apps/desktop/scripts/pen-guard-proof.mjs [--quick] [--only K10]  - prints PASS / FAIL lines.)
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(here, "..", "..", "scripts", "pen-guard-proof.mjs")
const real = process.env.WM_PEN_REAL === "1" && process.platform === "win32"

describe("the guard proof, with real processes and the real cursor clip (WM_PEN_REAL=1)", () => {
  it.skipIf(!real)("every way the app can die, hang or let go frees the cursor", () => {
    const r = spawnSync(process.execPath, [script, "--quick"], { encoding: "utf8", timeout: 240_000, windowsHide: true })
    const out = `${r.stdout}\n${r.stderr}`
    expect(out).not.toMatch(/^FAIL /m)
    expect(out).toMatch(/FINAL cursor free \(koffi\): true; \(independent PowerShell process\): true/)
    expect(r.status).toBe(0)
  }, 250_000)
})
