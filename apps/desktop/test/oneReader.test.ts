import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { MODEL_FILES } from "../src/main/bundledOcr/engine"
import { canRead, readWords } from "../src/main/helpers"
import * as helpers from "../src/main/helpers"

/**
 * ONE READER (main/helpers.ts `canRead` / `readWords`; docs/OCR-BUNDLED.md). Sean, 2026-10-10: "OCR should use the
 * exact same technology cross platform". The bundled reader is the only one: no table of readers, no fallback to the
 * platform's own (Apple Vision, Windows.Media.Ocr and tesseract were removed), and a build without the reader's files
 * simply cannot read. This file replaced ocrOrder.test.ts, which tested the order of those readers and the stand-ins
 * for them; the tests here put the OTHER readers' files where they used to be found and show they are not used.
 *
 * Stand-ins answer the way the real worker does, so the rules run on every platform with no models.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const was = process.env.PATH
/** A real PNG: the reader looks at the file (is it a PNG?) before it wakes a worker. */
const picture = path.join(here, "fixtures", "ocr-english.png")

afterEach(() => { process.env.PATH = was; delete process.env.WRITEMIND_OCR_ORDER })

/**
 * A fake app: `<root>/main` is `here`; with `reader` its folder holds a worker that answers `says` (or fails), and
 * `models` says which of the three models are there.
 */
function fakeApp(options: { reader?: string | "fails"; models?: (keyof typeof MODEL_FILES)[] } = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "wm-one-"))
  const main = path.join(root, "main")
  mkdirSync(main, { recursive: true })
  if (options.reader) {
    const folder = path.join(root, "helpers", "bundled-ocr")
    mkdirSync(path.join(folder, "ort"), { recursive: true })
    mkdirSync(path.join(folder, "models"), { recursive: true })
    for (const file of ["ort/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.wasm"]) writeFileSync(path.join(folder, file), "")
    for (const role of options.models ?? ["det", "rec", "recJapanese"]) writeFileSync(path.join(folder, "models", MODEL_FILES[role]), "")
    const reply = options.reader === "fails"
      ? "{ id: job.id, error: 'the models are broken' }"
      : `{ id: job.id, lines: [{ text: ${JSON.stringify(options.reader)}, confidence: 1, x: 0, y: 0, width: 1, height: 1, words: [] }] }`
    writeFileSync(path.join(folder, "worker.mjs"), [
      "import { parentPort } from 'node:worker_threads'",
      `parentPort.on('message', (job) => parentPort.postMessage(${reply}))`,
    ].join("\n"))
  }
  return main
}

/** The other readers' files, where the old order would have found them: a `tesseract` first on the PATH, a `wm-vision` beside the app. */
function otherReadersBeside(main: string): void {
  const folder = mkdtempSync(path.join(os.tmpdir(), "wm-bin-"))
  const tesseract = path.join(folder, "tesseract")
  writeFileSync(tesseract, "#!/bin/sh\necho 'from tesseract'\n")
  chmodSync(tesseract, 0o755)
  process.env.PATH = `${folder}${path.delimiter}${was ?? ""}`
  const helpersFolder = path.join(main, "..", "helpers")
  mkdirSync(helpersFolder, { recursive: true })
  const vision = path.join(helpersFolder, "wm-vision")
  writeFileSync(vision, "#!/bin/sh\necho '{\"lines\":[{\"text\":\"from vision\",\"confidence\":1}]}'\n")
  chmodSync(vision, 0o755)
  writeFileSync(path.join(helpersFolder, "wm-ocr.ps1"), "# a stand-in for the Windows script\n")
}

const texts = (words: { lines: { text: string }[] }): string[] => words.lines.map((line) => line.text)

describe("the one reader", () => {
  it("is there when the worker, the runtime and all three models are beside the app", () => {
    expect(canRead(fakeApp({ reader: "x" }))).toBe(true)
  })

  it("is not there without them: no folder, or a model missing - Japanese included, since it reads Japanese everywhere", () => {
    expect(canRead(fakeApp())).toBe(false)
    expect(canRead(fakeApp({ reader: "x", models: ["det"] }))).toBe(false)
    expect(canRead(fakeApp({ reader: "x", models: ["det", "rec"] }))).toBe(false)
    expect(canRead(fakeApp({ reader: "x", models: ["det", "rec", "recJapanese"] }))).toBe(true)
  })

  it("reads with the bundled worker and answers in the app's shape (lines and boxed words, nothing about an engine)", async () => {
    const out = await readWords(fakeApp({ reader: "from the worker" }), picture)
    expect(texts(out)).toEqual(["from the worker"])
    expect(Object.keys(out)).toEqual(["lines"])
  })

  it("has no other reader to fall back on: a worker that fails is a failed read, with every other reader's file in place", async () => {
    const main = fakeApp({ reader: "fails" })
    otherReadersBeside(main)
    await expect(readWords(main, picture)).rejects.toThrow("the models are broken")
  })

  it("does not use the other readers when the bundled one is missing: no reader, no words, and canRead says so", async () => {
    const main = fakeApp()
    otherReadersBeside(main)
    expect(canRead(main)).toBe(false)
    expect(await readWords(main, picture)).toEqual({ lines: [] })
  })

  it("has no order to change: WRITEMIND_OCR_ORDER is not read, and the table is gone", async () => {
    process.env.WRITEMIND_OCR_ORDER = "vision,tesseract,windows"
    const main = fakeApp({ reader: "from the worker" })
    otherReadersBeside(main)
    expect(texts(await readWords(main, picture))).toEqual(["from the worker"])
    for (const name of ["OCR_ORDER", "ocrOrder", "readerFor", "visionHelper", "tesseract", "windowsOcr", "probeWindowsOcr", "ADD_JAPANESE_OCR", "findPage"]) {
      expect(Object.keys(helpers), name).not.toContain(name)
    }
  })

  it("does not call a taken-back read a failure", async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(readWords(fakeApp({ reader: "x" }), picture, { signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" })
  })
})
