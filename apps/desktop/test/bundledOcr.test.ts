import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import * as ort from "onnxruntime-web"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { composeLines, parseOcrJson } from "@writemind/core"
import {
  BundledPool, bundledOcrFolder, bundledReader, bundledWords, readWithBundledOcr, wantsJapanese,
} from "../src/main/bundledOcr"
import { loadEngine, MODEL_FILES, modelsIn } from "../src/main/bundledOcr/engine"
import { ctcAlphabet, onnxMetadata } from "../src/main/bundledOcr/onnxMeta"
import {
  ctcDecode, detectorSize, lineFrom, linesInMap, minAreaRect, pickReading, readPicture, type BundledLine, type Engine,
} from "../src/main/bundledOcr/pipeline"
import { decodePng } from "../src/main/bundledOcr/png"
import { forgetOcrProbe, probeWindowsOcr, readerFor, readWords } from "../src/main/helpers"
import { OcrService } from "../src/main/ocr"

/**
 * The bundled reader (main/bundledOcr.ts, docs/OCR-BUNDLED.md): the arithmetic round the two networks with stand-ins,
 * the order `readerFor` / `readWords` ask the readers in, and - where the build's model cache is there
 * (apps/desktop/.cache/ocr-models, `node apps/desktop/scripts/fetch-ocr-models.mjs`) - real reads of a printed, a
 * handwritten (a public-domain scan, Wikimedia Commons "Handwriting.png") and a Japanese picture, in-process and
 * through the very worker the app runs, including taking a read back.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, "fixtures")
const desktop = path.join(here, "..")
const cache = process.env.WM_OCR_MODELS_CACHE ?? path.join(desktop, ".cache", "ocr-models")
const haveModels = modelsIn(cache).ok
const aborted = (): Error => Object.assign(new Error("cancelled"), { name: "AbortError" })

describe("the bundled reader's arithmetic", () => {
  it("keeps the model file names the build fetches", () => {
    const manifest = JSON.parse(readFileSync(path.join(desktop, "scripts", "ocr-models.json"), "utf8")) as
      { models: { role: keyof typeof MODEL_FILES; file: string; sha256: string; url: string }[] }
    for (const model of manifest.models) {
      expect(MODEL_FILES[model.role]).toBe(model.file)
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(model.url).toMatch(/^https:\/\/.*\/v\d+\.\d+\.\d+\//)   // pinned to a release, never "latest"
    }
    expect(manifest.models.map((model) => model.role).sort()).toEqual(Object.keys(MODEL_FILES).sort())
  })

  it("decodes CTC: repeats collapse, blanks drop, each character keeps the steps it was seen at", () => {
    const alphabet = ["", "a", "b", " "]
    // steps: a a _ a b _ " " b
    const best = [1, 1, 0, 1, 2, 0, 3, 2]
    const probabilities = new Float32Array(best.length * 4)
    best.forEach((c, t) => { probabilities[t * 4 + c] = 0.9; probabilities[t * 4 + ((c + 1) % 4)] = 0.1 })
    const out = ctcDecode(probabilities, best.length, 4, alphabet)
    expect(out.map((one) => one.char).join("")).toBe("aab b")
    expect(out[0]).toMatchObject({ char: "a", first: 0, last: 1 })
    expect(out[1]).toMatchObject({ char: "a", first: 3, last: 3 })
  })

  it("turns a decoded strip into a line with words boxed left to right, as fractions of the picture", () => {
    // A strip cut level from (100,50), 400 wide and 40 high, on a 1000 x 500 picture; 320 px of strip, 40 steps.
    const strip = { data: new Float32Array(0), width: 320, padded: 320, origin: { x: 100, y: 50 }, along: { x: 400, y: 0 }, across: { x: 0, y: 40 } }
    const emitted = [
      { char: "h", first: 2, last: 3, probability: 0.9 }, { char: "i", first: 5, last: 5, probability: 0.8 },
      { char: " ", first: 10, last: 10, probability: 0.9 },
      { char: "y", first: 20, last: 21, probability: 1 }, { char: "o", first: 24, last: 24, probability: 1 },
    ]
    const line = lineFrom(emitted, 40, strip, 1000, 500)!
    expect(line.text).toBe("hi yo")
    expect(line.confidence).toBeCloseTo((0.9 + 0.8 + 1 + 1) / 4)
    expect(line).toMatchObject({ x: 0.1, y: 0.1, width: 0.4, height: 0.08 })
    expect(line.words.map((word) => word.text)).toEqual(["hi", "yo"])
    const [hi, yo] = line.words as [BundledLine["words"][0], BundledLine["words"][0]]
    expect(hi.x).toBeGreaterThanOrEqual(line.x)
    expect(hi.x + hi.width).toBeLessThan(yo.x)
    expect(yo.x + yo.width).toBeLessThanOrEqual(line.x + line.width + 1e-9)
    expect(hi.height).toBeCloseTo(line.height)
    expect(lineFrom([{ char: " ", first: 0, last: 0, probability: 1 }], 40, strip, 1000, 500)).toBeNull()
  })

  it("finds the lines in a probability map, tilted ones too", () => {
    const w = 200, h = 100, map = new Float32Array(w * h)
    for (let y = 10; y < 20; y += 1) for (let x = 20; x < 120; x += 1) map[y * w + x] = 0.9
    // A second line, tilted down 10 degrees.
    const t = Math.tan((10 * Math.PI) / 180)
    for (let x = 30; x < 170; x += 1) for (let y = 0; y < 8; y += 1) map[Math.round(50 + (x - 30) * t + y) * w + x] = 0.8
    const lines = linesInMap(map, w, h).sort((a, b) => a.center.y - b.center.y)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.center.x).toBeCloseTo(70, 0)
    expect(lines[0]!.u.y).toBeCloseTo(0, 5)
    expect(lines[0]!.halfWidth).toBeGreaterThan(50)   // grown back out by the unclip
    const angle = (Math.atan2(lines[1]!.u.y, lines[1]!.u.x) * 180) / Math.PI
    expect(angle).toBeGreaterThan(7)
    expect(angle).toBeLessThan(13)
    expect(lines[1]!.v.y).toBeGreaterThan(0)          // across the line points down
  })

  it("orients a box along its long side", () => {
    const tall = minAreaRect([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }, { x: 0, y: 100 }])
    expect(Math.abs(tall.u.y)).toBeCloseTo(1)
    expect(tall.halfWidth).toBeCloseTo(50)
    const wide = minAreaRect([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 0, y: 10 }])
    expect(wide.u).toEqual({ x: 1, y: expect.closeTo(0) })
  })

  it("sizes the detector's input in multiples of 32, a small picture up and a big one down", () => {
    expect(detectorSize(800, 240)).toEqual({ width: 1600, height: 480 })
    expect(detectorSize(3200, 2400)).toEqual({ width: 1600, height: 1216 })
    const small = detectorSize(100, 50)
    expect(small.width % 32).toBe(0)
    expect(small.height).toBeGreaterThanOrEqual(640)
  })

  it("keeps the multilingual reading of a line only when it found Japanese and is about as sure", () => {
    const line = (text: string, confidence: number): BundledLine =>
      ({ text, confidence, x: 0, y: 0, width: 1, height: 1, words: [] })
    const kaigi = String.fromCharCode(0x4f1a, 0x8b70)
    // The English recogniser reads a Japanese line as the digits beside it, confidently.
    expect(pickReading(line("2026", 0.98), line(`${kaigi}2026`, 1))!.text).toBe(`${kaigi}2026`)
    expect(pickReading(line("Zhi5it hello", 0.73), line(`${kaigi} hello`, 0.98))!.text).toContain(kaigi)
    // English handwriting stays the English recogniser's, which reads it better.
    expect(pickReading(line("The quick brown fox", 0.95), line("The quich bronn fox", 0.9))!.text).toBe("The quick brown fox")
    // A stray kanji in a doubtful multilingual reading does not win.
    expect(pickReading(line("pay rent", 0.9), line(`pay r${kaigi}`, 0.6))!.text).toBe("pay rent")
    expect(pickReading(null, line(kaigi, 0.9))!.text).toBe(kaigi)
    expect(pickReading(line("x", 0.9), null)!.text).toBe("x")
  })

  it("asks for the Japanese pass unless the languages asked for leave Japanese out", () => {
    expect(wantsJapanese()).toBe(true)
    expect(wantsJapanese([])).toBe(true)
    expect(wantsJapanese(["ja", "en-US"])).toBe(true)
    expect(wantsJapanese(["ja-JP"])).toBe(true)
    expect(wantsJapanese(["en-US"])).toBe(false)
  })

  it("answers in the shape every reader does, which the app's own parser takes", () => {
    const words = bundledWords([
      { text: "call the plumber", confidence: 0.97, x: 0.1, y: 0.5, width: 0.4, height: 0.1,
        words: [{ text: "call", x: 0.1, y: 0.5, width: 0.08, height: 0.1 }, { text: "the", x: 0.2, y: 0.5, width: 0.06, height: 0.1 },
          { text: "plumber", x: 0.28, y: 0.5, width: 0.2, height: 0.1 }] },
      { text: "buy milk", confidence: 0.99, x: 0.1, y: 0.2, width: 0.3, height: 0.1, words: [] },
    ], true)
    expect(words).toMatchObject({ engine: "bundled", language: "en", installed: ["en", "ja"], japanese: true })
    const parsed = parseOcrJson(JSON.stringify(words))
    if (!("reading" in parsed)) throw new Error(parsed.error)
    expect(parsed.reading.engine).toBe("bundled")
    expect(parsed.reading.lines[0]!.words).toHaveLength(3)
    expect(composeLines(parsed.reading, null)).toEqual(["buy milk", "call the plumber"])
    expect(bundledWords([{ text: String.fromCharCode(0x6771, 0x4eac), confidence: 1, x: 0, y: 0, width: 1, height: 1, words: [] }], true).language).toBe("ja")
    expect(bundledWords([], false).installed).toEqual(["en"])
  })

  it("decodes PNG itself (the worker has no Electron)", () => {
    const picture = decodePng(readFileSync(path.join(fixtures, "ocr-english.png")))
    expect([picture.width, picture.height]).toEqual([800, 240])
    expect(picture.data.length).toBe(800 * 240 * 4)
    // Paper is white, and the first line's ink is dark.
    expect(picture.data[0]).toBeGreaterThan(240)
    let dark = 0
    for (let at = 0; at < picture.data.length; at += 4) if (picture.data[at]! < 80) dark += 1
    expect(dark).toBeGreaterThan(1000)
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/not a PNG/)
  })

  it("reads a recogniser's dictionary out of the model's own metadata", () => {
    // ModelProto { ir_version: 8 (field 1), metadata_props (field 14): { key: "character", value: "a\nb" } }
    const entry = [0x0a, 9, ...Buffer.from("character"), 0x12, 3, ...Buffer.from("a\nb")]
    const model = new Uint8Array([0x08, 8, 0x72, entry.length, ...entry])
    expect(onnxMetadata(model).get("character")).toBe("a\nb")
    expect(ctcAlphabet(model)).toEqual(["", "a", "b", " "])
    expect(ctcAlphabet(new Uint8Array([0x08, 8]))).toBeNull()
  })
})

/** A fake app: `<root>/main` is `here`, `<root>/helpers/bundled-ocr` the reader's folder. */
function fakeApp(): { main: string; folder: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "wm-bundled-"))
  const main = path.join(root, "main"), folder = path.join(root, "helpers", "bundled-ocr")
  mkdirSync(main, { recursive: true })
  mkdirSync(path.join(folder, "ort"), { recursive: true })
  mkdirSync(path.join(folder, "models"), { recursive: true })
  return { main, folder }
}

describe("the order the readers are asked in", () => {
  it("is the bundled reader first wherever its files are all there, and the others when one is missing", async () => {
    const { main, folder } = fakeApp()
    for (const file of ["worker.mjs", "ort/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.wasm", `models/${MODEL_FILES.det}`]) {
      writeFileSync(path.join(folder, file), "")
    }
    // No recogniser yet: not a reader.
    expect(bundledOcrFolder(main)).toBeNull()
    expect((await readerFor(main)).engine).not.toBe("bundled")
    writeFileSync(path.join(folder, "models", MODEL_FILES.rec), "")
    expect(bundledOcrFolder(main)).toBe(folder)
    expect(await readerFor(main)).toEqual({ ocr: true, engine: "bundled", japanese: false })
    // Japanese is the extra recogniser.
    writeFileSync(path.join(folder, "models", MODEL_FILES.recJapanese), "")
    expect(bundledReader(main)).toEqual({ ocr: true, engine: "bundled", japanese: true })
  }, 30000)

  it("falls back to the platform's own reader when the bundled one fails", async () => {
    const { main, folder } = fakeApp()
    for (const file of ["ort/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.wasm", `models/${MODEL_FILES.det}`, `models/${MODEL_FILES.rec}`]) {
      writeFileSync(path.join(folder, file), "")
    }
    // A worker that fails every read, as one with broken models would.
    writeFileSync(path.join(folder, "worker.mjs"), [
      "import { parentPort } from 'node:worker_threads'",
      "parentPort.on('message', (job) => parentPort.postMessage({ id: job.id, error: 'the models are broken' }))",
    ].join("\n"))
    await expect(readWithBundledOcr(main, path.join(fixtures, "ocr-english.png"))).rejects.toThrow("the models are broken")
    // Windows' engine stands behind it (the real script, beside the fake app as the build puts it).
    copyFileSync(path.join(here, "../src/helpers/wm-ocr.ps1"), path.join(folder, "..", "wm-ocr.ps1"))
    forgetOcrProbe()
    const out = await readWords(main, path.join(fixtures, "ocr-english.png"))
    expect(out.engine).not.toBe("bundled")
    if (process.platform === "win32" && (await probeWindowsOcr(main)).ok) {
      expect(out.engine).toBe("windows")
      expect(out.lines.map((line) => line.text).join(" ").toLowerCase()).toContain("plumber")
    }
  }, 60000)
})

// THE REAL THING, wherever the build's model cache is (CI fetches it before the tests).
describe.skipIf(!haveModels)("the bundled reader on real pictures", () => {
  let engine: Engine
  let app: { main: string; folder: string }

  beforeAll(async () => {
    engine = await loadEngine(ort, cache, { threads: 2 })
    // The app's own worker, bundled the way scripts/build.mjs bundles it, beside a copy of the runtime and models.
    app = fakeApp()
    await build({
      entryPoints: [path.join(desktop, "src/main/bundledOcr/worker.ts")], outfile: path.join(app.folder, "worker.mjs"),
      bundle: true, platform: "node", target: "node20", format: "esm", logLevel: "warning",
      banner: { js: "import { createRequire as __wmRequire } from 'node:module'; const require = __wmRequire(import.meta.url);" },
    })
    const dist = path.dirname(createRequire(import.meta.url).resolve("onnxruntime-web"))
    for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
      copyFileSync(path.join(dist, file), path.join(app.folder, "ort", file))
    }
    for (const file of Object.values(MODEL_FILES)) copyFileSync(path.join(cache, file), path.join(app.folder, "models", file))
  }, 120000)

  const read = async (name: string) => {
    const reading = await readPicture(engine, decodePng(readFileSync(path.join(fixtures, name))))
    return reading.lines.map((line) => line.text)
  }
  const together = (lines: string[]) => lines.join(" ").toLowerCase()

  it("reads printed English", async () => {
    const lines = await read("ocr-english.png")
    expect(together(lines)).toContain("buy milk and")
    expect(together(lines)).toContain("eggs")
    expect(together(lines)).toContain("call the plumber")
  }, 60000)

  it("reads handwriting, printed and joined-up", async () => {
    const text = together(await read("ocr-handwriting.png"))
    // The felt-tip printing, whole; the biro cursive, most of it (measured: "The quich broungox").
    expect(text).toContain("the quick brown fox")
    expect(text).toContain("jumps over the lazy")
    expect(text).toContain("0123456789")
    expect(text).toMatch(/the qui/)
  }, 60000)

  it("reads Japanese, and English beside it", async () => {
    const lines = await read("ocr-japanese.png")
    const kaigi = String.fromCharCode(0x4f1a, 0x8b70), konnichiwa = String.fromCharCode(0x3053, 0x3093, 0x306b, 0x3061, 0x306f)
    expect(lines.join("\n")).toContain(kaigi)
    expect(lines.join("\n")).toContain("2026")
    expect(lines.join("\n")).toContain(konnichiwa)
    expect(lines.join("\n")).toContain("hello")
  }, 60000)

  it("reads through the app's own worker, and answers in the app's shape", async () => {
    const out = await readWords(app.main, path.join(fixtures, "ocr-english.png"))
    expect(out.engine).toBe("bundled")
    const parsed = parseOcrJson(JSON.stringify(out))
    if (!("reading" in parsed)) throw new Error(parsed.error)
    const lines = composeLines(parsed.reading, null)
    expect(lines.map((line) => line.toLowerCase())).toEqual(["buy milk and eggs", "call the plumber"])
    const plumber = parsed.reading.lines.find((line) => line.text.includes("plumber"))!
    expect(plumber.words!.map((word) => word.text)).toEqual(["call", "the", "plumber"])
    expect(plumber.words![0]!.x).toBeLessThan(plumber.words![2]!.x)
  }, 60000)

  it("stops the worker when the read is taken back, and reads again after", async () => {
    const pool = new BundledPool(app.folder)
    const stop = new AbortController()
    const started = Date.now()
    const reading = pool.read({ file: path.join(fixtures, "ocr-handwriting.png"), japanese: true }, stop.signal)
    setTimeout(() => stop.abort(), 50)
    await expect(reading).rejects.toMatchObject({ name: "AbortError" })
    expect(Date.now() - started).toBeLessThan(1500)
    expect(pool.size).toBe(0)
    const again = await pool.read({ file: path.join(fixtures, "ocr-english.png"), japanese: false })
    expect(again.lines!.length).toBeGreaterThan(0)
    expect(pool.size).toBe(1)
    pool.close()
  }, 60000)

  it("is stopped by the OCR service's cancel, as the other readers are", async () => {
    let stopped = false
    const service = new OcrService(async (file, options) => {
      options.signal?.addEventListener("abort", () => { stopped = true })
      return readWithBundledOcr(app.main, file, options)
    })
    const asked = service.request({ id: "a", source: { file: path.join(fixtures, "ocr-handwriting.png") } })
      .catch((error: Error) => error.name)
    await new Promise((resolve) => setTimeout(resolve, 30))
    service.cancel("a")
    expect(await asked).toBe("AbortError")
    expect(stopped).toBe(true)
    // ...and the same picture asked again is read, not inherited from the dead request.
    const out = await service.request({ id: "b", source: { file: path.join(fixtures, "ocr-handwriting.png") } })
    expect(out.engine).toBe("bundled")
    expect(together(out.lines.map((line) => line.text))).toContain("lazy")
  }, 60000)

  afterAll(() => { /* the pool's idle workers are unref'd and do not hold the run open */ })
})

describe.skipIf(haveModels)("the bundled reader on real pictures (models absent)", () => {
  it("is skipped, and says so", () => {
    console.warn(`no bundled OCR models in ${cache} (node apps/desktop/scripts/fetch-ocr-models.mjs): the real reads are NOT verified here`)
    expect(existsSync(cache) ? modelsIn(cache).ok : false).toBe(false)
  })
})
