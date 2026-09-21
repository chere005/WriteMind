import { mkdtempSync, writeFileSync, chmodSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { canRead, readWords, shipped, tesseract } from "../src/main/helpers"

/**
 * The reader that Linux and Windows use. A capability is a FILE BEING
 * THERE, so the test puts one there — a stand-in that answers the way
 * tesseract does — and takes it away again.
 */
const was = process.env.PATH

afterEach(() => { process.env.PATH = was })

function withFakeTesseract(lines: string[]): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), "wm-bin-"))
  const file = path.join(folder, "tesseract")
  // `echo` is the shell's own, so the stub works with nothing else on the
  // PATH — which is the point of putting the folder FIRST rather than
  // instead of what was there.
  writeFileSync(file, `#!/bin/sh\n${lines.map((line) => `echo "${line}"`).join("\n")}\n`)
  chmodSync(file, 0o755)
  process.env.PATH = `${folder}${path.delimiter}${was ?? ""}`
  return folder
}

describe("the reader this machine has", () => {
  it("finds tesseract on the PATH and reads a picture with it", async () => {
    withFakeTesseract(["first line", "", "second line"])
    expect(tesseract()).not.toBeNull()
    expect(canRead("/nowhere")).toBe(true)
    const out = await readWords("/nowhere", "/tmp/whatever.png")
    expect(out.lines.map((line) => line.text)).toEqual(["first line", "second line"])
    // Tesseract gives no confidence, so every line it found counts as read.
    expect(out.lines.every((line) => line.confidence === 1)).toBe(true)
  })

  it("says it cannot read when there is no reader at all", async () => {
    process.env.PATH = mkdtempSync(path.join(os.tmpdir(), "wm-empty-"))
    expect(tesseract()).toBeNull()
    expect(canRead("/nowhere")).toBe(false)
    expect(await readWords("/nowhere", "/tmp/whatever.png")).toEqual({ lines: [] })
  })

  it("looks for a shipped helper OUTSIDE the asar, where it can be run", () => {
    // Nothing inside an archive can be executed, so electron-builder
    // unpacks the helpers beside it and the path has to follow.
    const inside = path.join("/Applications/WriteMind.app/Contents/Resources/app.asar",
      "out", "main")
    expect(shipped(inside, "../helpers/wm-vision"))
      .toContain(`app.asar.unpacked${path.sep}out${path.sep}helpers`)
    expect(shipped("/src/out/main", "../helpers/wm-vision"))
      .toBe(path.join("/src/out/helpers/wm-vision"))
  })
})
