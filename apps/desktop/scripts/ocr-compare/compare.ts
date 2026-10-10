/**
 * THE BUNDLED READER AGAINST APPLE VISION, on the same pictures (docs/OCR-BUNDLED.md "Against Vision"; docs/TODO.md
 * "Bundled OCR" item 4). Not part of `npm test` - it needs a Mac, a build (`WM_REQUIRE_OCR_MODELS=1 npm run build`:
 * out/helpers/wm-vision and out/helpers/bundled-ocr) and takes a minute - and re-runnable by hand:
 *
 *   node node_modules/vite-node/vite-node.mjs apps/desktop/scripts/ocr-compare/compare.ts [--runs 3] [--only text] [--json file] [--prepared]
 *
 * Every picture is read by BOTH readers through the app's own path, `readWords` in main/helpers.ts (the Vision helper
 * is `wm-vision text <file>` as the app runs it; the bundled reader is main/bundledOcr.ts and its worker), each one
 * FORCED by giving `readWords` an app folder that has only that reader beside it. Then: the lines each read, the time
 * (the first read of a picture and the median of the rest; the very first read of the bundled reader is its cold start,
 * worker and models loaded, printed apart), and an edit-distance score against the ground truth written beside the
 * picture (`<name>.txt`, one line of writing per line).
 *
 * THE SCORE. CER = Levenshtein distance between what the reader wrote and the truth, over the truth's length, after
 * both are folded: NFKC, lower case, "^" dropped (a raised 2 cannot be told from "2" by a reader that gives text),
 * runs of white space made one. The reading is the app's own tidy of the reader's lines (`composeLines` with no ink
 * page: reading order, and what `looksLikeText` throws away), joined with a space between lines; the raw lines are
 * printed too. 0% is exact; a reader that finds nothing scores 100%.
 *
 * Pictures: test/fixtures (real: a printed Arial, a public-domain felt-tip and biro scan, printed Japanese) and
 * apps/desktop/.cache/ocr-compare (made on this Mac by make-pictures.swift with the system's handwriting-style fonts, and
 * the tablet sheet by sheet-capture.e2e.mjs). THE MADE PICTURES ARE FONTS, NOT HANDS: they stand for the situations, they
 * do not measure how either reader copes with a person's real handwriting - the fixture scan is the only real hand here.
 *
 * `--prepared` reads the pictures as the app hands them to a reader (the real `prepareForReading` ran in the real app:
 * `prepare-pictures.e2e.mjs`); without it they are read as they are, dot grid and all.
 */

import { execFileSync } from "node:child_process"
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { composeLines, parseOcrJson } from "@writemind/core"
import { readWords, type Words } from "../../src/main/helpers"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = path.resolve(HERE, "../..")
const OUT = path.join(DESKTOP, "out")
const FIXTURES = path.join(DESKTOP, "test", "fixtures")
const MADE = path.join(DESKTOP, ".cache", "ocr-compare")

// MARK: - arguments

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 ? (argv[at + 1] ?? "") : null
}
const RUNS = Math.max(1, Number(flag("runs") ?? 3))
const ONLY = flag("only")
const JSON_OUT = flag("json")
/** Read the pictures as the app hands them to a reader (prepare-pictures.e2e.mjs: on white, at most 3200 a side, dot grid painted out). */
const PREPARED = argv.includes("--prepared")

// MARK: - the score

export const fold = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/\^/g, "").replace(/\s+/g, " ").trim()

/** Levenshtein distance over code points. */
export function distance(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b)
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const row = [i]
    for (let j = 1; j <= y.length; j++) {
      row.push(Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1)))
    }
    previous = row
  }
  return previous[y.length]!
}

/** Characters wrong per character of truth, as a fraction. */
export const cer = (read: string, truth: string): number => {
  const t = fold(truth)
  return t.length === 0 ? (fold(read).length === 0 ? 0 : 1) : Math.min(1, distance(fold(read), t) / Array.from(t).length)
}

// MARK: - the readers, each forced by what is beside the app

interface Reader { name: string; engine: "vision" | "bundled"; here: string }

function readers(scratch: string): Reader[] {
  const make = (name: string, engine: "vision" | "bundled", helper: string): Reader => {
    const main = path.join(scratch, name, "main"), helpers = path.join(scratch, name, "helpers")
    mkdirSync(main, { recursive: true }); mkdirSync(helpers, { recursive: true })
    symlinkSync(helper, path.join(helpers, engine === "vision" ? "wm-vision" : "bundled-ocr"))
    return { name, engine, here: main }
  }
  const vision = path.join(OUT, "helpers", "wm-vision"), bundled = path.join(OUT, "helpers", "bundled-ocr")
  for (const need of [vision, bundled]) {
    if (!existsSync(need)) throw new Error(`${need} is missing: run  WM_REQUIRE_OCR_MODELS=1 npm run build  first`)
  }
  const list = [make("vision", "vision", vision), make("bundled", "bundled", bundled)]
  return list
}

// MARK: - the pictures

interface Picture { name: string; file: string; truth: string[]; real: boolean; width: number; height: number }

const pngSize = (file: string): { width: number; height: number } => {
  const head = readFileSync(file).subarray(0, 32)
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

/** The fixtures, and the cuts of the real scan (as real as the scan). */
const REAL = ["ocr-english", "ocr-handwriting", "ocr-japanese", "handwriting-biro", "handwriting-felt"]

function picturesIn(folder: string): Picture[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).filter((name) => name.endsWith(".png") && existsSync(path.join(folder, name.replace(/\.png$/, ".txt"))))
    .sort().map((name) => {
      const file = path.join(folder, name)
      const truth = readFileSync(file.replace(/\.png$/, ".txt"), "utf8").split("\n").filter((line) => line.trim() !== "")
      const stem = name.replace(/\.png$/, "")
      return { name: stem, file, truth, real: REAL.includes(stem), ...pngSize(file) }
    })
}

/** The made pictures, drawn when they are not there yet (swiftc is the Mac's own). */
function makeThem(): void {
  if (existsSync(path.join(MADE, "page-bradley-3000x4000.png"))) return
  const tool = path.join(os.tmpdir(), "wm-make-ocr-pictures")
  execFileSync("swiftc", ["-O", path.join(HERE, "make-pictures.swift"), "-o", tool], { stdio: "inherit" })
  execFileSync(tool, [MADE, path.join(FIXTURES, "ocr-handwriting.png")], { stdio: "inherit" })
}

// MARK: - one read

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

interface Result {
  reader: string
  seconds: { first: number; median: number }
  lines: string[]
  composed: string[]
  engine: string | undefined
  error?: string
  cer: number
  exact: number
}

async function readWith(reader: Reader, picture: Picture): Promise<Result> {
  const times: number[] = []
  let words: Words | null = null
  let error: string | undefined
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now()
    try {
      words = await readWords(reader.here, picture.file)
    } catch (caught) {
      error = (caught as Error).message
      break
    }
    times.push((performance.now() - started) / 1000)
  }
  // `readWords` falls back to another reader when the first fails, and with nothing else beside the app that is an empty
  // reading from the wrong engine: say so rather than score it as a reader that found nothing.
  if (words && words.engine !== reader.engine) error = `read by ${words.engine ?? "nothing"}, not ${reader.engine}`
  const parsed = words ? parseOcrJson(JSON.stringify(words)) : null
  const composed = parsed && "reading" in parsed ? composeLines(parsed.reading, null) : []
  const truth = picture.truth.join(" ")
  const lines = (words?.lines ?? []).map((line) => line.text)
  const exact = picture.truth.filter((line) => composed.some((got) => fold(got) === fold(line))).length
  return {
    reader: reader.name,
    seconds: { first: times[0] ?? NaN, median: times.length > 0 ? median(times) : NaN },
    lines, composed, engine: words?.engine, ...(error ? { error } : {}),
    cer: cer(composed.join(" "), truth), exact,
  }
}

// MARK: - run

const scratch = mkdtempSync(path.join(os.tmpdir(), "wm-ocr-compare-"))
try {
  makeThem()
  const list = readers(scratch)
  const pictures = (PREPARED ? picturesIn(path.join(MADE, "prepared")) : [...picturesIn(FIXTURES), ...picturesIn(MADE)]).filter((p) => !ONLY || p.name.includes(ONLY))
  const report: { picture: Picture; results: Result[] }[] = []

  // The cold start of each reader: the first picture of the run, read once with nothing warm.
  const cold: Record<string, number> = {}
  const first = pictures.find((p) => p.width * p.height < 2_000_000) ?? pictures[0]!
  for (const reader of list) {
    const started = performance.now()
    await readWords(reader.here, first.file).catch(() => undefined)
    cold[reader.name] = (performance.now() - started) / 1000
  }
  console.log(`cold start (first read of ${first.name}): ` + list.map((r) => `${r.name} ${cold[r.name]!.toFixed(2)} s`).join(", "))
  console.log(`${os.cpus()[0]?.model}, ${os.cpus().length} cores, ${os.platform()} ${os.release()}; ${RUNS} reads per picture and reader\n`)

  for (const picture of pictures) {
    const results: Result[] = []
    for (const reader of list) results.push(await readWith(reader, picture))
    report.push({ picture, results })
    console.log(`== ${picture.name}  ${picture.width}x${picture.height}  (${picture.real ? "real" : "made with a font"})`)
    console.log("   truth: " + picture.truth.join(" / "))
    for (const r of results) {
      console.log(`   ${r.reader.padEnd(9)} ${r.error ? "ERROR " + r.error : ""}first ${r.seconds.first.toFixed(2)} s, median ${r.seconds.median.toFixed(2)} s, ` +
        `CER ${(r.cer * 100).toFixed(1)}%, ${r.exact}/${picture.truth.length} lines exact, ${r.composed.length} lines kept of ${r.lines.length}`)
      for (const line of r.lines) console.log(`      | ${line}`)
    }
  }

  console.log("\n| Picture | " + list.map((r) => `${r.name} CER (lines exact) | ${r.name} s`).join(" | ") + " |")
  console.log("|---|" + list.map(() => "---|---").join("|") + "|")
  for (const { picture, results } of report) {
    console.log(`| ${picture.name} (${picture.width}x${picture.height}${picture.real ? "" : ", font"}) | `
      + results.map((r) => `${(r.cer * 100).toFixed(0)}% (${r.exact}/${picture.truth.length}) | ${r.seconds.median.toFixed(2)}`).join(" | ") + " |")
  }
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), machine: `${os.cpus()[0]?.model}, ${os.cpus().length} cores`, runs: RUNS, cold, report }, null, 2))
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
  // The bundled reader's workers are kept warm for two minutes; end the process rather than wait for them.
  process.exit(process.exitCode ?? 0)
}
