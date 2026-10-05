import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parseOcrJson, composeLines } from "@writemind/core"
import {
  ADD_JAPANESE_OCR, probeWindowsOcr, readerFor, readWithWindowsOcr, windowsOcrScript, type Runner, type Words,
} from "../src/main/helpers"
import { OcrService } from "../src/main/ocr"

/**
 * Windows' own OCR engine behind the app: the helper's contract (against a
 * stand-in for PowerShell, so the error paths run anywhere), the queue /
 * cache / cancel that keep it from ever making the app wait, and — where the
 * machine has the engine — the real thing reading a picture.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const mainFolder = path.join(here, "../src/main")
const fixture = path.join(here, "fixtures/ocr-english.png")

const windows = process.platform === "win32"
const aborted = (): Error => Object.assign(new Error("cancelled"), { name: "AbortError" })

/** A fake `here` with the script beside it, so `windowsOcrScript` finds one. */
function appWithScript(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "wm-app-"))
  mkdirSync(path.join(root, "main"))
  mkdirSync(path.join(root, "helpers"))
  writeFileSync(path.join(root, "helpers", "wm-ocr.ps1"), "# stand-in\n")
  return path.join(root, "main")
}

describe.skipIf(!windows)("the Windows helper's contract", () => {
  it("is found beside the app, and invoked unprofiled and with the policy bypassed", async () => {
    const app = appWithScript()
    expect(windowsOcrScript(app)).toMatch(/wm-ocr\.ps1$/)
    const seen: string[][] = []
    const runner: Runner = async (_file, args) => {
      seen.push(args)
      return { stdout: JSON.stringify({ lines: [{ text: "hi", confidence: 1 }], language: "en-US" }) }
    }
    const out = await readWithWindowsOcr(app, "C:\\pics\\a.png", { languages: ["ja", "en-US"] }, runner)
    expect(out.engine).toBe("windows")
    expect(out.language).toBe("en-US")
    expect(seen[0]).toEqual(expect.arrayContaining(["-NoProfile", "-ExecutionPolicy", "Bypass", "read", "C:\\pics\\a.png", "-Languages", "ja,en-US"]))
  })

  it("reports what the script said when it failed, not a stack", async () => {
    const app = appWithScript()
    const failing: Runner = async () => {
      throw Object.assign(new Error("Command failed"), { stdout: JSON.stringify({ error: "no OCR language is installed" }) })
    }
    await expect(readWithWindowsOcr(app, "x.png", {}, failing)).rejects.toThrow("no OCR language is installed")
    const stopped: Runner = async () => { throw aborted() }
    await expect(readWithWindowsOcr(app, "x.png", {}, stopped)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("probes the engine: the languages it has, whether Japanese is one, and how to add it", async () => {
    const app = appWithScript()
    const english: Runner = async () => ({ stdout: JSON.stringify({ installed: ["en-US"], profile: "en-US", japanese: false }) })
    const probe = await probeWindowsOcr(app, english)
    expect(probe).toMatchObject({ ok: true, installed: ["en-US"], profile: "en-US", japanese: false })
    expect(probe.addJapanese).toBe(ADD_JAPANESE_OCR)
    expect(ADD_JAPANESE_OCR).toContain("Language.OCR~~~ja-JP~0.0.1.0")

    const both: Runner = async () => ({ stdout: JSON.stringify({ installed: ["en-US", "ja"], profile: "en-US", japanese: true }) })
    expect((await probeWindowsOcr(app, both)).japanese).toBe(true)
  })

  it("is not a capability when the engine has no language or the script cannot run", async () => {
    const app = appWithScript()
    const none: Runner = async () => ({ stdout: JSON.stringify({ installed: [], profile: null, japanese: false }) })
    const probe = await probeWindowsOcr(app, none)
    expect(probe.ok).toBe(false)
    expect(probe.reason).toMatch(/no OCR language/)
    const broken: Runner = async () => { throw new Error("powershell.exe not found") }
    expect((await probeWindowsOcr(app, broken)).ok).toBe(false)
    expect((await probeWindowsOcr("/nowhere/main", none)).ok).toBe(false)
  })
})

describe("the service in front of the engine", () => {
  const picture = (n: number): Uint8Array => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, n])
  const words = (text: string): Words => ({ lines: [{ text, confidence: 1 }] })

  /** A reader that answers when told to, and notices being stopped. */
  function slowReader() {
    const calls: { file: string; stopped: boolean; finish(): void }[] = []
    const read = (file: string, options: { signal?: AbortSignal }) => new Promise<Words>((resolve, reject) => {
      const call = { file, stopped: false, finish: () => resolve(words("read")) }
      calls.push(call)
      options.signal?.addEventListener("abort", () => { call.stopped = true; reject(aborted()) }, { once: true })
    })
    return { calls, read }
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
  /**
   * Wait until `ready()` holds (or give up after 3 s and let the expect say what is wrong). A request writes its
   * picture to a temporary file before the engine is asked, and on CI's runner that write can take longer than a
   * fixed tick: waiting for the thing itself keeps the test about order, not about the disk's speed.
   */
  const until = async (ready: () => boolean) => {
    for (let waited = 0; waited < 3000 && !ready(); waited += 10) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  it("reads a picture once however many times it is asked (the key is what is IN it)", async () => {
    let reads = 0
    const service = new OcrService(async () => { reads += 1; return words("hello") })
    const [a, b] = await Promise.all([
      service.request({ id: "1", source: { bytes: picture(1) } }),
      service.request({ id: "2", source: { bytes: picture(1) } }),
    ])
    expect(a.lines[0]!.text).toBe("hello")
    expect(b).toEqual(a)
    await service.request({ id: "3", source: { bytes: picture(1) } })
    expect(reads).toBe(1)
    await service.request({ id: "4", source: { bytes: picture(2) } })
    expect(reads).toBe(2)
    // The language asked for is part of the question.
    await service.request({ id: "5", source: { bytes: picture(1) }, languages: ["ja"] })
    expect(reads).toBe(3)
  })

  it("gives the reader a real file for bytes, and takes it away again", async () => {
    let seen = ""
    const folder = mkdtempSync(path.join(os.tmpdir(), "wm-ocr-test-"))
    const service = new OcrService(async (file) => { seen = file; return words("x") }, folder)
    await service.request({ id: "1", source: { bytes: picture(7) } })
    expect(seen.startsWith(folder)).toBe(true)
    expect(seen.endsWith(".png")).toBe(true)
    const { existsSync } = await import("node:fs")
    expect(existsSync(seen)).toBe(false)
  })

  it("stops the engine when the only asker takes the request back", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const asked = service.request({ id: "a", source: { bytes: picture(1) } })
    const caught = asked.catch((error: Error) => error.name)
    await until(() => calls.length >= 1)
    expect(calls).toHaveLength(1)
    service.cancel("a")
    expect(await caught).toBe("AbortError")
    await until(() => calls[0]!.stopped)
    expect(calls[0]!.stopped).toBe(true)
    // …and asking again starts a fresh read rather than inheriting the dead one.
    const again = service.request({ id: "b", source: { bytes: picture(1) } })
    await until(() => calls.length >= 2)
    expect(calls).toHaveLength(2)
    calls[1]!.finish()
    expect((await again).lines[0]!.text).toBe("read")
  })

  it("keeps the engine running while someone else still wants the same picture", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const first = service.request({ id: "a", source: { bytes: picture(1) } }).catch((error: Error) => error.name)
    const second = service.request({ id: "b", source: { bytes: picture(1) } })
    await until(() => calls.length >= 1)
    service.cancel("a")
    expect(await first).toBe("AbortError")
    expect(calls[0]!.stopped).toBe(false)
    calls[0]!.finish()
    expect((await second).lines[0]!.text).toBe("read")
  })

  it("a cancel that comes before the engine starts is not lost", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const asked = service.request({ id: "a", source: { bytes: picture(3) } }).catch((error: Error) => error.name)
    service.cancel("a")
    expect(await asked).toBe("AbortError")
    await tick()
    expect(calls).toHaveLength(0)
  })

  it("runs two engines at once and no more; a queued request can be taken back without ever running", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const results = [1, 2, 3].map((n) => service.request({ id: String(n), source: { bytes: picture(n) } }).catch((error: Error) => error.name))
    await until(() => calls.length >= 2)
    await tick()
    expect(calls).toHaveLength(2)
    expect(service.busy).toBe(3)
    service.cancel("3")
    expect(await results[2]).toBe("AbortError")
    calls[0]!.finish()
    calls[1]!.finish()
    await Promise.all(results.slice(0, 2))
    await tick()
    expect(calls).toHaveLength(2)
    expect(service.busy).toBe(0)
  })

  it("does not remember a failure", async () => {
    let n = 0
    const service = new OcrService(async () => { n += 1; if (n === 1) throw new Error("engine fell over"); return words("ok") })
    await expect(service.request({ id: "a", source: { bytes: picture(9) } })).rejects.toThrow("engine fell over")
    expect((await service.request({ id: "b", source: { bytes: picture(9) } })).lines[0]!.text).toBe("ok")
  })
})

// The real engine, where the machine has one. English is always there with a
// Windows install; Japanese only when the optional capability is added, so
// the Japanese reading is checked only then.
describe.skipIf(!windows)("the real Windows engine", () => {
  it("reads a printed picture, with the words boxed, in reading order", async () => {
    const probe = await probeWindowsOcr(mainFolder)
    if (!probe.ok) { console.warn("no Windows OCR engine on this machine: skipped"); return }
    const out = await readWithWindowsOcr(mainFolder, fixture, { languages: ["en-US"] })
    expect(out.engine).toBe("windows")
    const parsed = parseOcrJson(JSON.stringify(out))
    if (!("reading" in parsed)) throw new Error(parsed.error)
    const lines = composeLines(parsed.reading, null)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.toLowerCase()).toContain("buy milk")
    expect(lines[1]!.toLowerCase()).toContain("plumber")
    // The first line is above the second, and its words are left to right inside it.
    const first = parsed.reading.lines[0]!
    expect(first.y).toBeLessThan(parsed.reading.lines[1]!.y)
    expect(first.words!.length).toBe(4)
    expect(first.words![0]!.x).toBeLessThan(first.words![3]!.x)
  }, 30000)

  it("stops the engine when the request is taken back, without waiting for it", async () => {
    const probe = await probeWindowsOcr(mainFolder)
    if (!probe.ok) return
    const stop = new AbortController()
    const started = Date.now()
    const reading = readWithWindowsOcr(mainFolder, fixture, { signal: stop.signal })
    setTimeout(() => stop.abort(), 60)
    await expect(reading).rejects.toMatchObject({ name: "AbortError" })
    expect(Date.now() - started).toBeLessThan(1500)
  }, 30000)

  it("decides what the capability is from a probe that works", async () => {
    const reader = await readerFor(mainFolder)
    const probe = await probeWindowsOcr(mainFolder)
    expect(reader.ocr).toBe(probe.ok)
    if (probe.ok) expect(reader.engine).toBe("windows")
  }, 30000)

  it("says so, rather than reading nonsense, for a file that is not a picture", async () => {
    const probe = await probeWindowsOcr(mainFolder)
    if (!probe.ok) return
    const bad = path.join(mkdtempSync(path.join(os.tmpdir(), "wm-bad-")), "nothing.png")
    writeFileSync(bad, "this is not a png")
    await expect(readWithWindowsOcr(mainFolder, bad)).rejects.toThrow(/could not decode/)
  }, 30000)

  it("reads Japanese when the engine has it (skipped, and said so, when this Windows has no Japanese OCR)", async () => {
    const probe = await probeWindowsOcr(mainFolder)
    if (!probe.ok || !probe.japanese) {
      console.warn("no Japanese OCR installed on this machine: the Japanese path is NOT verified here")
      return
    }
    // A picture with Japanese in it, drawn by Windows itself (a Japanese font ships with Windows).
    const folder = mkdtempSync(path.join(os.tmpdir(), "wm-ja-"))
    const picture = path.join(folder, "ja.png")
    const script = path.join(folder, "draw.ps1")
    const kanji = String.fromCharCode(0x4f1a, 0x8b70), kana = String.fromCharCode(0x3053, 0x3093, 0x306b, 0x3061, 0x306f)
    writeFileSync(script, [
      "Add-Type -AssemblyName System.Drawing",
      "$b = New-Object System.Drawing.Bitmap 900,240; $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::White)",
      "$f = New-Object System.Drawing.Font 'Yu Gothic',44",
      "$g.DrawString([string]::Concat([char]0x4F1A,[char]0x8B70,' 2026'), $f, [System.Drawing.Brushes]::Black, 20, 20)",
      "$g.DrawString([string]::Concat([char]0x3053,[char]0x3093,[char]0x306B,[char]0x3061,[char]0x306F,' hello'), $f, [System.Drawing.Brushes]::Black, 20, 120)",
      `$b.Save('${picture}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    ].join(os.EOL))
    const { execFileSync } = await import("node:child_process")
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script])
    const out = await readWithWindowsOcr(mainFolder, picture)
    const parsed = parseOcrJson(JSON.stringify(out))
    if (!("reading" in parsed)) throw new Error(parsed.error)
    const lines = composeLines(parsed.reading, null)
    expect(out.language).toMatch(/^ja/)
    expect(lines[0]).toContain(kanji + " 2026")      // no spaces between the characters
    expect(lines[1]).toContain(kana + " hello")
  }, 60000)
})
