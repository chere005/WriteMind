// userData/sheets.json as main/sheets.ts writes it (the tablet's sheet tabs and their ink). Port-only: no Swift test.
// What matters is that ink is never lost: a reload reads what was held, an unreadable file is copied aside first.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sheetsFile } from "../src/main/sheets"

vi.mock("electron", () => ({ app: { getPath: () => "", on: () => undefined } }))

let dir = ""
let file = ""
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-sheets-"))
  file = path.join(dir, "sheets.json")
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe("sheets.json", () => {
  it("is nothing when there is no file", () => {
    expect(sheetsFile(file).read()).toBeNull()
  })

  it("writes after a quiet moment, whole, and reads it back", () => {
    vi.useFakeTimers()
    try {
      const store = sheetsFile(file, { debounceMs: 300 })
      store.hold('{"a":1}')
      store.hold('{"a":2}')
      expect(fs.existsSync(file)).toBe(false)
      vi.advanceTimersByTime(300)
      expect(fs.readFileSync(file, "utf8")).toBe('{"a":2}')
      expect(fs.existsSync(`${file}.tmp`)).toBe(false)
      expect(sheetsFile(file).read()).toBe('{"a":2}')
    } finally { vi.useRealTimers() }
  })

  it("a page reloaded before the write reads the held text, not the older file", () => {
    fs.writeFileSync(file, '{"old":true}')
    const store = sheetsFile(file, { debounceMs: 10_000 })
    store.hold('{"new":true}')
    expect(store.read()).toBe('{"new":true}')
    store.flushSync()
    expect(fs.readFileSync(file, "utf8")).toBe('{"new":true}')
  })

  it("copies a file that is not JSON aside before the first write replaces it", () => {
    fs.writeFileSync(file, "not json {")
    const store = sheetsFile(file)
    expect(store.read()).toBe("not json {")
    store.hold('{"sheets":[]}')
    store.flushSync()
    expect(fs.readFileSync(file, "utf8")).toBe('{"sheets":[]}')
    const aside = fs.readdirSync(dir).filter((name) => name.startsWith("sheets.unreadable-"))
    expect(aside).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, aside[0]!), "utf8")).toBe("not json {")
    // Only once: the next write does not copy the new file aside.
    store.hold('{"sheets":[1]}')
    store.flushSync()
    expect(fs.readdirSync(dir).filter((name) => name.startsWith("sheets.unreadable-"))).toHaveLength(1)
  })

  it("copies nothing aside for a good file", () => {
    fs.writeFileSync(file, '{"sheets":[]}')
    const store = sheetsFile(file)
    store.read()
    store.hold('{"sheets":[2]}')
    store.flushSync()
    expect(fs.readdirSync(dir).sort()).toEqual(["sheets.json"])
  })
})
