import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OcrEngine } from "@writemind/core"
import { MODEL_FILES } from "../src/main/bundledOcr/engine"
import { OCR_ORDER, forgetOcrProbe, ocrOrder, readerFor, readWords, visionHelper } from "../src/main/helpers"

/**
 * WHICH READER FIRST, and the table that says so (main/helpers.ts `OCR_ORDER`; docs/OCR-BUNDLED.md "Against Vision").
 * The bundled reader was measured against Apple Vision on a Mac, on the same pictures, and kept first; the order is
 * a table, so this is the one place to see it, to change it, and to test it. A reader that is not on the machine is
 * not asked, and a reader that fails stands aside for the next - checked here with stand-ins that answer the way the
 * real ones do, so the rule is tested on every platform and not only where Vision is.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const desktop = path.join(here, "..")
const fixtures = path.join(here, "fixtures")
const was = process.env.PATH
/** A real PNG: the bundled reader looks at the file (is it a PNG?) before it wakes a worker. */
const picture = path.join(fixtures, "ocr-english.png")

afterEach(() => { process.env.PATH = was; forgetOcrProbe(); vi.restoreAllMocks() })

/** A fake app: `<root>/main` is `here`; with `bundled` its reader's folder holds a worker that answers `says` (or fails). */
function fakeApp(options: { bundled?: string | "fails"; vision?: string }): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "wm-order-"))
  const main = path.join(root, "main")
  mkdirSync(main, { recursive: true })
  if (options.bundled) {
    const folder = path.join(root, "helpers", "bundled-ocr")
    mkdirSync(path.join(folder, "ort"), { recursive: true })
    mkdirSync(path.join(folder, "models"), { recursive: true })
    for (const file of ["ort/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.wasm", `models/${MODEL_FILES.det}`, `models/${MODEL_FILES.rec}`]) {
      writeFileSync(path.join(folder, file), "")
    }
    const reply = options.bundled === "fails"
      ? "{ id: job.id, error: 'the models are broken' }"
      : `{ id: job.id, japanese: false, lines: [{ text: ${JSON.stringify(options.bundled)}, confidence: 1, x: 0, y: 0, width: 1, height: 1, words: [] }] }`
    writeFileSync(path.join(folder, "worker.mjs"), [
      "import { parentPort } from 'node:worker_threads'",
      `parentPort.on('message', (job) => parentPort.postMessage(${reply}))`,
    ].join("\n"))
  }
  if (options.vision !== undefined) {
    const file = path.join(root, "helpers", "wm-vision")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `#!/bin/sh\necho '{"lines":[{"text":${JSON.stringify(options.vision)},"confidence":1,"x":0,"y":0,"width":1,"height":1}]}'\n`)
    chmodSync(file, 0o755)
  }
  return main
}

/** A `tesseract` first on the PATH that answers `line`. */
function withFakeTesseract(line: string): void {
  const folder = mkdtempSync(path.join(os.tmpdir(), "wm-bin-"))
  const file = path.join(folder, "tesseract")
  writeFileSync(file, `#!/bin/sh\necho "${line}"\n`)
  chmodSync(file, 0o755)
  process.env.PATH = `${folder}${path.delimiter}${was ?? ""}`
}

const texts = (words: { lines: { text: string }[] }): string[] => words.lines.map((line) => line.text)

describe("the order table", () => {
  it("puts the bundled reader first and the platform's own readers behind it (the decision of docs/OCR-BUNDLED.md)", () => {
    // Changing this is a decision about what every Mac, Windows and Linux user reads with: it is made with the measured
    // table in docs/OCR-BUNDLED.md "Against Vision" in hand, and the doc is changed with it.
    expect([...OCR_ORDER]).toEqual(["bundled", "vision", "windows", "tesseract"])
    expect(ocrOrder({})).toEqual([...OCR_ORDER])
  })

  it("is changed from the environment by naming readers to put first; names left out follow in the table's order", () => {
    expect(ocrOrder({ WRITEMIND_OCR_ORDER: "vision" })).toEqual(["vision", "bundled", "windows", "tesseract"])
    expect(ocrOrder({ WRITEMIND_OCR_ORDER: " Vision , bundled " })).toEqual(["vision", "bundled", "windows", "tesseract"])
    expect(ocrOrder({ WRITEMIND_OCR_ORDER: "tesseract,vision,tesseract" })).toEqual(["tesseract", "vision", "bundled", "windows"])
  })

  it("ignores what is not a reader, so a typo cannot leave the app with none", () => {
    expect(ocrOrder({ WRITEMIND_OCR_ORDER: "apple,,vison" })).toEqual([...OCR_ORDER])
    expect(ocrOrder({ WRITEMIND_OCR_ORDER: "" })).toEqual([...OCR_ORDER])
  })
})

describe("asking the readers in order", () => {
  it.skipIf(process.platform === "win32")("falls from a bundled reader that fails to the next one there is, and says so", async () => {
    const main = fakeApp({ bundled: "fails" })
    withFakeTesseract("from tesseract")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const out = await readWords(main, picture)
    expect(out.engine).toBe("tesseract")
    expect(texts(out)).toEqual(["from tesseract"])
    expect(warn.mock.calls.join(" ")).toContain("bundled reader failed")
  })

  it.skipIf(process.platform === "win32")("asks the readers in the order it is given, and does not wake one that is behind", async () => {
    const main = fakeApp({ bundled: "from the worker" })
    withFakeTesseract("from tesseract")
    const first = await readWords(main, picture, {}, ["tesseract", "bundled"])
    expect(first.engine).toBe("tesseract")
    const second = await readWords(main, picture, {}, ["bundled", "tesseract"])
    expect(second.engine).toBe("bundled")
    expect(texts(second)).toEqual(["from the worker"])
  })

  it.skipIf(process.platform === "win32")("answers readerFor with the first reader of the order that is there", async () => {
    const main = fakeApp({ bundled: "x" })
    withFakeTesseract("t")
    expect(await readerFor(main)).toMatchObject({ ocr: true, engine: "bundled" })
    expect(await readerFor(main, ["tesseract", "bundled"])).toEqual({ ocr: true, engine: "tesseract", japanese: false })
    // a reader of the order that is not on this machine is skipped, not answered
    expect(await readerFor(main, ["windows", "vision", "bundled"])).toMatchObject({ engine: "bundled" })
  })

  it("throws the last reader's error when every reader there is has failed, and reads nothing when there is none", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const broken = fakeApp({ bundled: "fails" })
    process.env.PATH = mkdtempSync(path.join(os.tmpdir(), "wm-empty-"))
    await expect(readWords(broken, picture, {}, ["bundled"])).rejects.toThrow("the models are broken")
    const empty = fakeApp({})
    expect(await readWords(empty, picture, {}, ["bundled", "vision", "tesseract"])).toEqual({ lines: [] })
    expect(await readerFor(empty, ["bundled", "vision", "tesseract"])).toEqual({ ocr: false, engine: null, japanese: false })
  })

  it("does not call a taken-back read a failure", async () => {
    const main = fakeApp({ bundled: "x" })
    const stop = new AbortController()
    stop.abort()
    await expect(readWords(main, picture, { signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" })
  })

  // THE MAC: both readers beside the app, as in a build with the models.
  it.skipIf(process.platform !== "darwin")("on a Mac with both: bundled first, Vision when told to go first or when the bundled one fails", async () => {
    const both = fakeApp({ bundled: "from the worker", vision: "from vision" })
    expect(await readerFor(both)).toMatchObject({ engine: "bundled" })
    expect((await readWords(both, picture)).engine).toBe("bundled")
    const flipped = ocrOrder({ WRITEMIND_OCR_ORDER: "vision" })
    expect((await readWords(both, picture, {}, flipped)).engine).toBe("vision")
    expect(await readerFor(both, flipped)).toEqual({ ocr: true, engine: "vision", japanese: true })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const broken = fakeApp({ bundled: "fails", vision: "from vision" })
    expect(texts(await readWords(broken, picture))).toEqual(["from vision"])
  })
})

// THE REAL VISION HELPER, where this Mac has built it (`npm run build` puts it in out/helpers/wm-vision): it reads Japanese
// the way the Mac app does (ja-JP first, kept only when it found Japanese), which the bundled reader's comparison needs.
const built = path.join(desktop, "out", "main")
const haveVision = process.platform === "darwin" && visionHelper(built) !== null && existsSync(path.join(fixtures, "ocr-japanese.png"))
describe.skipIf(!haveVision)("the Vision helper beside the build", () => {
  const engines: OcrEngine[] = ["vision"]
  const KAIGI = String.fromCharCode(0x4f1a, 0x8b70), TOKYO = String.fromCharCode(0x6771, 0x4eac)

  it("reads English, and does not turn it into Japanese", async () => {
    const out = await readWords(built, path.join(fixtures, "ocr-english.png"), {}, engines)
    expect(out.engine).toBe("vision")
    expect(texts(out).join(" ").toLowerCase()).toBe("buy milk and eggs call the plumber")
    expect(out.language).toBe("en")
  }, 30000)

  it("reads Japanese when it is not told which language, as the Mac app does", async () => {
    const out = await readWords(built, path.join(fixtures, "ocr-japanese.png"), {}, engines)
    expect(texts(out).join("\n")).toContain(KAIGI)
    expect(texts(out).join("\n")).toContain(TOKYO)
    expect(out.language).toBe("ja")
    expect(out.japanese).toBe(true)
  }, 30000)

  it("reads only the languages it is asked for", async () => {
    const english = await readWords(built, path.join(fixtures, "ocr-japanese.png"), { languages: ["en"] }, engines)
    expect(texts(english).join("\n")).not.toContain(KAIGI)
    const japanese = await readWords(built, path.join(fixtures, "ocr-japanese.png"), { languages: ["ja-JP", "en-US"] }, engines)
    expect(texts(japanese).join("\n")).toContain(KAIGI)
  }, 30000)
})
