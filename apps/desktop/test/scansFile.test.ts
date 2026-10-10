// The scanned pages' pictures as main/scans.ts keeps them (userData/scans/<id>.jpg) and the list beside them
// (userData/scans.json, the writer sheets.json has). Port-only. What matters: a picture is whole or absent, an id
// can never leave the folder, and a sweep takes only what no page names AND has lain a minute.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { scanPictures } from "../src/main/scans"
import { sheetsFile } from "../src/main/sheets"

vi.mock("electron", () => ({ app: { getPath: () => "", on: () => undefined } }))

let dir = ""
let folder = ""
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-scans-"))
  folder = path.join(dir, "scans")
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

describe("scanned pages' pictures", () => {
  it("keeps a picture whole and reads it back; the folder is made when it is first needed", async () => {
    const pictures = scanPictures(folder)
    expect(pictures.get("p1")).toBeNull()
    expect(await pictures.put("p1", bytes(1, 2, 3, 4))).toBe(true)
    expect([...pictures.get("p1")!]).toEqual([1, 2, 3, 4])
    expect(fs.readdirSync(folder)).toEqual(["p1.jpg"])
    // Put again: replaced, no .tmp left behind.
    expect(await pictures.put("p1", bytes(9))).toBe(true)
    expect([...pictures.get("p1")!]).toEqual([9])
    expect(fs.readdirSync(folder)).toEqual(["p1.jpg"])
  })

  it("refuses an id that could name a file elsewhere, and bytes that are not bytes", async () => {
    const pictures = scanPictures(folder)
    for (const id of ["../x", "a/b", "a\\b", "", "x".repeat(65), 5, null, "a.b"]) {
      expect(await pictures.put(id, bytes(1)), String(id)).toBe(false)
      expect(pictures.get(id), String(id)).toBeNull()
    }
    expect(await pictures.put("ok", "text")).toBe(false)
    expect(await pictures.put("ok", bytes())).toBe(false)
    expect(fs.existsSync(path.join(dir, "x.jpg"))).toBe(false)
  })

  it("drops one picture, and a picture that is not there is not an error", async () => {
    const pictures = scanPictures(folder)
    await pictures.put("a", bytes(1))
    await pictures.put("b", bytes(2))
    pictures.drop("a")
    pictures.drop("never")
    pictures.drop("../b")
    expect(fs.readdirSync(folder)).toEqual(["b.jpg"])
  })

  it("sweeps only what no page names and has lain a minute", async () => {
    let now = Date.now()
    const pictures = scanPictures(folder, { now: () => now })
    for (const id of ["keep", "stray", "fresh"]) await pictures.put(id, bytes(1))
    const old = new Date(now - 5 * 60_000)
    fs.utimesSync(path.join(folder, "keep.jpg"), old, old)
    fs.utimesSync(path.join(folder, "stray.jpg"), old, old)
    fs.writeFileSync(path.join(folder, "notes.txt"), "not a picture")
    expect(pictures.sweep(["keep"])).toBe(1)
    expect(fs.readdirSync(folder).sort()).toEqual(["fresh.jpg", "keep.jpg", "notes.txt"])
    // The fresh one goes once it has lain a minute and still no page names it.
    now += 2 * 60_000
    expect(pictures.sweep(["keep"])).toBe(1)
    expect(fs.readdirSync(folder).sort()).toEqual(["keep.jpg", "notes.txt"])
    expect(pictures.sweep("not a list")).toBe(0)
  })
})

describe("scans.json", () => {
  it("is held, written whole after a quiet moment, and copied aside under its own name when it was not JSON", () => {
    const file = path.join(dir, "scans.json")
    fs.writeFileSync(file, "garbage {")
    const store = sheetsFile(file, { debounceMs: 10_000 })
    expect(store.read()).toBe("garbage {")
    store.hold('{"pages":[]}')
    expect(store.read()).toBe('{"pages":[]}')
    store.flushSync()
    expect(fs.readFileSync(file, "utf8")).toBe('{"pages":[]}')
    expect(fs.readdirSync(dir).filter((name) => name.startsWith("scans.unreadable-"))).toHaveLength(1)
    expect(fs.readdirSync(dir).filter((name) => name.startsWith("sheets."))).toEqual([])
  })
})
