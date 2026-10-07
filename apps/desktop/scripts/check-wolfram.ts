/**
 * The Wolfram export and a copy into Mathematica, CHECKED WITH THE REAL ENGINE (port-only: docs/PARITY.md). Not part of
 * `npm test` — it starts wolframscript, which takes seconds — and re-runnable by hand:
 *
 *   node node_modules/vite-node/vite-node.mjs apps/desktop/scripts/check-wolfram.ts [outdir] [--render]
 *
 * It builds the plan from the fixture (`test/fixtures/wolfram/note.md` and its sidecar) and runs it through the very
 * code the app uses — `writeWolframNotebook`, the kernel cache, the real `createProcessRunner().wolframJob` and its
 * shared wolframscript lookup (Language Setup's choice included) — three times:
 *
 *   engine.nb        with the engine: every drawing and picture an Image, embedded
 *   fallback.nb      with the engine made unavailable (a choice that is not there): closed initialization cells
 *   clip-*.txt       what a copy of a drawing cell puts on the clipboard (one cell, two cells, no engine), the linear
 *                    syntax of its image, and its PNG
 *
 * and then hands the folder to `check-wolfram.wls`, which Gets every file (it must be a Notebook), turns every image
 * back into an Image, evaluates the fallback cells, checks sizes, and exports a PNG of each to look at.
 * `--render` also has the hidden front end of Wolfram Player (when this Mac has one) open both notebooks, run
 * Evaluate Initialization Cells on the fallback, and save what they look like — under a watchdog that kills only a
 * front end it started.
 *
 * The folder is refused unless it is inside the system's temp folder: nothing here writes in anybody's documents.
 */

import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  clipboardCells, columnWidth, decodeDrawing, drawingText, floatingBands, inkCells, positioned, wolframInkSvg, wolframPlan,
  type KernelJob, type WolframMedia, type WolframPlan, type WordBreaker,
} from "@writemind/core"
import { createProcessRunner, type Runner } from "../src/main/eval/runner"
import { forgetKernelAnswers, runKernel } from "../src/main/wolfram/kernel"
import { writeWolframNotebook } from "../src/main/wolfram/notebookFile"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, "../test/fixtures/wolfram")
const PANE = { width: 760, height: 900 }
/** The widths the fixture's drawing cells are shown at (what the page measures on screen). */
const SHOWN: Record<string, number> = { "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f": 620, "0a0b0c0d-1111-4222-8333-444455556666": 480 }

/** The words of a box broken into lines, with a fixed width per character (the page's own breaker needs a canvas). */
const words: WordBreaker = (text, room, font) => {
  const perLine = Math.max(1, Math.floor(room / (font.size * 0.55)))
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (const word of paragraph.split(/(?<= )/)) {
      if (line !== "" && (line + word).trimEnd().length > perLine) { lines.push(line.trimEnd()); line = word } else line += word
    }
    lines.push(line.trimEnd())
  }
  return lines
}

function inside(folder: string): boolean {
  const roots = [os.tmpdir(), "/tmp"].filter((root) => existsSync(root)).map((root) => realpathSync(root))
  const real = existsSync(folder) ? realpathSync(folder) : path.resolve(folder)
  return roots.some((root) => real === root || real.startsWith(root + path.sep))
}

function mediaOf(markdown: string, only?: Set<string>): { media: WolframMedia; drawing: ReturnType<typeof decodeDrawing>["drawing"] } {
  const { drawing } = decodeDrawing(readFileSync(path.join(FIXTURE, "sidecar.json"), "utf8"))
  const column = columnWidth(PANE)
  const inks: WolframMedia["inks"] = {}
  for (const cell of inkCells(drawing)) {
    if (only && !only.has(cell.id)) continue
    inks[cell.id] = wolframInkSvg(cell, SHOWN[cell.id] ?? column, words)
  }
  // The cells' tops, as the page would measure them (forty points a cell), with the paragraph the floating line was
  // drawn under at 240: the red line and its note, at about 270 and 320, go under it.
  const blocks = positioned(markdown)
  const under = Math.max(0, blocks.findIndex((block) => block.block.kind === "paragraph" && /floating/.test(block.block.text)))
  const cells = blocks.map((block, index) => ({ top: 240 + (index - under) * 40, offset: block.range.location }))
  return { media: { inks, bands: only ? [] : floatingBands(drawing, PANE, cells, words), column }, drawing }
}

const stat = (file: string) => {
  try { const s = statSync(file); return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null } catch { return null }
}
const fileDeps = {
  findMedia: async (name: string) => (existsSync(path.join(FIXTURE, name)) ? path.join(FIXTURE, name) : null),
  stat: async (file: string) => stat(file),
  readFile: async (file: string) => new Uint8Array(readFileSync(file)),
  pdfPicture: async () => null,
  bitmap: async () => null,
  tempPng: async () => { throw new Error("no temp pictures in the check") },
}

function sizeOf(svg: string): [number, number] {
  const found = /<svg[^>]*\bwidth="([\d.]+)" height="([\d.]+)"/.exec(svg)
  return [Number(found?.[1]), Number(found?.[2])]
}

/** What the .wls expects of each image cell in the notebook, in order, and each maths source. */
function expectations(plan: WolframPlan): { images: { tag: string; size: [number, number]; scale: number }[]; maths: string[] } {
  const jobs = new Map<string, KernelJob>(plan.jobs.map((job) => [job.name, job]))
  const images: { tag: string; size: [number, number]; scale: number }[] = []
  const maths: string[] = []
  for (const cell of plan.cells) {
    for (const piece of cell.pieces) {
      if (typeof piece === "string") continue
      const job = jobs.get(piece.job)!
      if (piece.as === "image") {
        // A drawing is drawn at 144 dpi (two pixels a point); a picture is as big as its file or smaller.
        if (job.name.startsWith("pic-")) images.push({ tag: piece.tag ?? "picture", size: [48, 32], scale: 1 })
        else images.push({ tag: piece.tag ?? "ink", size: sizeOf(job.text), scale: 2 })
      } else maths.push(job.text)
    }
  }
  return { images, maths }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const render = args.includes("--render")
  const given = args.find((arg) => !arg.startsWith("--"))
  const out = given ? path.resolve(given) : mkdtempSync(path.join(os.tmpdir(), "wm-wolfram-check-"))
  if (!inside(out)) throw new Error(`“${out}” is not inside the temp folder: this check writes nowhere else`)
  mkdirSync(out, { recursive: true })
  const markdown = readFileSync(path.join(FIXTURE, "note.md"), "utf8")
  const noteFile = path.join(FIXTURE, "note.md")
  const { media } = mediaOf(markdown)

  const real = createProcessRunner()
  const tool = real.tools().wolfram
  console.log(`wolframscript: ${tool.path ?? "NOT FOUND"}`)
  // An engine that is not there: a program chosen in Language Setup that has gone, by the same lookup.
  const gone = createProcessRunner({ get: () => ({ wolfram: path.join(out, "no-such", "wolframscript") }) })

  const exportWith = async (runner: Runner, file: string) => {
    forgetKernelAnswers()
    const notice = await writeWolframNotebook(path.join(out, file), {
      noteFile, title: "Wolfram export", markdown, drawing: null, pane: PANE, wolfram: media,
    }, {
      ...fileDeps,
      runKernel: (jobs, options) => runKernel(jobs, options, { runner }),
      progress: () => undefined,
      version: "check",
      write: async (target, text) => { writeFileSync(target, text) },
      removeTemp: async () => undefined,
    })
    console.log(`${file}: ${notice ? `${notice.message}\n   ${notice.detail}` : "no notice (every image made)"}`)
  }
  const started = Date.now()
  await exportWith(real, "engine.nb")
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`)
  await exportWith(gone, "fallback.nb")

  // THE CLIPBOARD: one drawing cell, a heading with a drawing cell, and one with no engine.
  const ink1 = Object.keys(media.inks)[0]!
  const inkLine = (id: string) => `![ink](.drawings/media/ink-${id}.svg)`
  const copyOf = (text: string) => {
    const only = mediaOf(text, new Set(Object.keys(media.inks))).media
    return wolframPlan(text, only, new Map(), "clipboard")
  }
  const one = copyOf(inkLine(ink1))
  const two = copyOf(`Hello\n\n${inkLine(ink1)}`)
  forgetKernelAnswers()
  const ran = await runKernel([...one.jobs, ...two.jobs.filter((job) => job.name !== "ink-1.svg")], { id: "wolfram:copy", png: true, timeoutMs: 60_000 }, { runner: real })
  console.log(`clipboard run: ${ran.state.kind}, answers ${[...ran.answers.keys()].join(" ")}`)
  writeFileSync(path.join(out, "clip-one.txt"), clipboardCells(one, ran.answers))
  writeFileSync(path.join(out, "clip-two.txt"), clipboardCells(two, ran.answers))
  writeFileSync(path.join(out, "clip-fallback.txt"), clipboardCells(one, new Map()))
  const linear = drawingText(one, ran.answers)
  if (linear !== null) writeFileSync(path.join(out, "linear.txt"), linear)
  const png = ran.pngs.get("ink-1.svg")
  if (png) writeFileSync(path.join(out, "clip-one.png"), png)

  // What the .wls expects.
  const plan = wolframPlan(markdown, media, new Map([["pic.png", { kind: "file", path: path.join(FIXTURE, "pic.png"), format: "PNG" }], ["lost.png", null]]), "file")
  const expected = expectations(plan)
  const styles = JSON.parse(readFileSync(path.join(FIXTURE, "styles.json"), "utf8")) as Record<string, string[]>
  writeFileSync(path.join(out, "expected.json"), JSON.stringify({ ...expected, styles, clipSize: sizeOf(one.jobs[0]!.text) }))
  copyFileSync(path.join(HERE, "check-wolfram.wls"), path.join(out, "check-wolfram.wls"))

  const found = real.tools().wolfram.path
  if (!found) {
    console.log("No Wolfram Engine here: the notebooks above are the fallback ones; the kernel check is skipped.")
    return
  }
  const checked = spawnSync(found, ["-file", path.join(out, "check-wolfram.wls"), out], { encoding: "utf8", timeout: 300_000 })
  process.stdout.write(checked.stdout ?? "")
  if (checked.stderr) process.stderr.write(checked.stderr)
  if (render) await renderWithFrontEnd(found, out)
  console.log(`\nPNGs to look at: ${path.join(out, "png")}`)
  if (checked.status !== 0) process.exitCode = 1
}

/** The hidden front end of Wolfram Player renders both notebooks; a watchdog ends only one this started. */
async function renderWithFrontEnd(wolframscript: string, out: string): Promise<void> {
  const script = path.join(HERE, "render-wolfram.wls")
  if (!existsSync(script)) return
  const child = spawn(wolframscript, ["-file", script, out], { stdio: ["ignore", "inherit", "inherit"] })
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); console.log("render: gave up after 120 s"); resolve() }, 120_000)
    child.on("close", () => { clearTimeout(timer); resolve() })
    child.on("error", () => { clearTimeout(timer); resolve() })
  })
  console.log(`renders: ${readdirSync(out).filter((name) => /render\.png$/.test(name)).join(" ") || "none"}`)
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
