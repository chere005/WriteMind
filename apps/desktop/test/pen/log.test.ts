// main/pen/log.ts: the line cap keeps a reserve for errors, so a long session of ordinary lines can never swallow a later failure.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { LINE_LIMIT, LINE_RESERVE, createPenLog } from "../../src/main/pen/log"

describe("pen.log line cap", () => {
  it("ordinary lines stop LINE_RESERVE short of the cap; errors and refusals still get in", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penlog-"))
    const file = path.join(dir, "pen.log")
    const log = createPenLog(file)
    for (let i = 0; i < LINE_LIMIT + 50; i++) log.event("manager", "map-open", { i })
    log.event("wintab-data", "error", { message: "late" })
    log.event("manager", "map-refused", {})
    log.close()
    const lines = fs.readFileSync(file, "utf8").trim().split("\n")
    expect(lines.length).toBe(LINE_LIMIT - LINE_RESERVE + 2)
    expect(lines[lines.length - 1]).toContain("map-refused")
    expect(lines[lines.length - 2]).toContain("error")
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
