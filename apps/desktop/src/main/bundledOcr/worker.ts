/**
 * The bundled reader's worker thread (bundled by scripts/build.mjs to out/helpers/bundled-ocr/worker.mjs, beside
 * the models and onnxruntime's WebAssembly). One picture at a time; the networks are loaded on the first one and
 * kept. The main process takes a read back by TERMINATING the worker (main/bundledOcr.ts), which is the only way to
 * stop a WebAssembly run half-way, and starts a fresh one for the next picture.
 *
 *   in:  { id, file } (a PNG on disk, decoded here) or { id, pixels: { width, height, data } } (RGBA), and
 *        `japanese: false` to read English only
 *   out: { id, lines, timing, japanese } or { id, error }
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import * as ort from "onnxruntime-web"
import { loadEngine } from "./engine"
import { DEFAULT_TUNING, readPicture, type Engine } from "./pipeline"
import { decodePng, isPng, type Rgba } from "./png"

interface Job { id: number; file?: string; pixels?: Rgba; japanese?: boolean }

const { folder, threads } = workerData as { folder: string; threads: number }
let engine: Promise<Engine> | null = null

parentPort!.on("message", async (job: Job) => {
  try {
    engine ??= loadEngine(ort, path.join(folder, "models"), { threads, wasmFolder: path.join(folder, "ort") })
    // A load that failed is tried again with the next picture.
    const ready = await engine.catch((error: unknown) => { engine = null; throw error })
    let image = job.pixels
    if (!image) {
      const bytes = new Uint8Array(await fs.readFile(job.file!))
      if (!isPng(bytes)) throw new Error("the bundled reader decodes PNG itself; other pictures come as pixels")
      image = decodePng(bytes)
    }
    const reading = await readPicture(ready, image, DEFAULT_TUNING, { japanese: job.japanese !== false })
    parentPort!.postMessage({ id: job.id, lines: reading.lines, timing: reading.timing, japanese: ready.japanese !== undefined })
  } catch (error) {
    parentPort!.postMessage({ id: job.id, error: (error as Error).message ?? String(error) })
  }
})
