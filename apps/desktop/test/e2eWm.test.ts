// The suites read and write .wm files with their own small reader and writer (e2e/lib/wm.mjs: node:zlib, no import of the app's
// codec, so that a check does not use the code under test to read its own output). This holds the two to each other: what one
// writes the other reads, byte for byte.
import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { openWm, textOfFile } from "@writemind/core"
// @ts-expect-error: a plain .mjs next to the suites
import { readWm, wmBytes } from "../../../e2e/lib/wm.mjs"
import { readZip } from "../src/main/zip"
import { wmBytes as appBytes } from "./wmFiles"

describe("e2e/lib/wm.mjs and the app's codec agree", () => {
  it("the app reads what the suites write", () => {
    const bytes = wmBytes("# From the suite\n", { drawing: '{"items":[]}', entries: { "media/a.png": Buffer.from([1, 2, 3]), "snapshots/ink-x.svg": "<svg/>" } })
    const file = openWm(readZip(bytes))
    expect(textOfFile(file)).toBe("# From the suite\n")
    expect(file.entries.map((entry) => entry.name)).toEqual(["note.wmdm", "drawing.json", "media/a.png", "snapshots/ink-x.svg"])
    expect(Array.from(file.entries[2]!.data)).toEqual([1, 2, 3])
  })

  it("the suites read what the app writes (deflated entries, a stored mimetype, a name outside ASCII)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wm-e2ewm-"))
    const target = path.join(dir, "A.wm")
    writeFileSync(target, appBytes("# From the app\n".repeat(200), { drawing: '{"items":[]}', entries: { "media/é.png": Buffer.from([9, 8, 7]) } }))
    const read = readWm(target)
    expect(read.text).toBe("# From the app\n".repeat(200))
    expect(read.names).toEqual(["mimetype", "manifest.json", "note.wmdm", "drawing.json", "media/é.png"])
    expect(Array.from(read.entries["media/é.png"] as Buffer)).toEqual([9, 8, 7])
    expect(read.manifest.format).toBe("writemind-note")
  })
})
