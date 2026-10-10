/**
 * THE READER, from the main process's side: the ONE engine shipped INSIDE WriteMind (PP-OCRv5 on onnxruntime's
 * WebAssembly build, docs/OCR-BUNDLED.md), so macOS, Windows and Linux read a picture the same way with nothing to
 * install. It is the only reader there is: `helpers.ts` asks it and nothing else, and a read that fails is a
 * failed read, not a cue for another engine.
 *
 * A CAPABILITY IS A FILE BEING THERE: `out/helpers/bundled-ocr/` holds the worker, the WebAssembly runtime and the
 * models - the detector, the English recogniser AND the multilingual one that reads Japanese (scripts/build.mjs puts
 * them there, `asarUnpack` takes them out of the archive). A build made offline without them has no reader at all,
 * and the app then shows nothing for reading pictures.
 *
 * The networks run in worker threads (main/bundledOcr/worker.ts), never on the main process's own thread: one per
 * picture being read (ocr.ts runs at most two), each kept warm for a while after. A read that is taken back
 * TERMINATES its worker - a WebAssembly run cannot be stopped any other way - and the next picture gets a fresh one.
 */

import { existsSync, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { modelsIn } from "./bundledOcr/engine"
import type { BundledLine } from "./bundledOcr/pipeline"
import { isPng, type Rgba } from "./bundledOcr/png"
import { shipped, type ReadOptions, type Words } from "./helpers"

/**
 * The folder the reader lives in, when everything it needs is there. Japanese is part of "everything": the reader
 * reads English and Japanese everywhere, so a folder without the multilingual model is not a reader.
 */
export function bundledOcrFolder(here: string): string | null {
  const folder = shipped(here, "../helpers/bundled-ocr")
  const runtime = [path.join(folder, "worker.mjs"), path.join(folder, "ort", "ort-wasm-simd-threaded.wasm"),
    path.join(folder, "ort", "ort-wasm-simd-threaded.mjs")]
  const models = modelsIn(path.join(folder, "models"))
  return runtime.every((file) => existsSync(file)) && models.ok && models.japanese ? folder : null
}

/** Whether the languages asked for want the Japanese pass. Nothing asked for: yes, as the Mac reads Japanese first. */
export const wantsJapanese = (languages?: string[]): boolean =>
  !languages || languages.length === 0 || languages.some((tag) => /^ja(-|$)/i.test(tag))

/** The worker's lines as the app's `Words` (helpers.ts). */
export function bundledWords(lines: BundledLine[]): Words {
  return {
    lines: lines.map((line) => ({
      text: line.text, confidence: line.confidence,
      x: line.x, y: line.y, width: line.width, height: line.height,
      words: line.words.map((word) => ({ ...word })),
    })),
  }
}

const aborted = (): Error => Object.assign(new Error("cancelled"), { name: "AbortError" })

/** A picture that is not a PNG, as pixels (Electron decodes it); null for a PNG, which the worker decodes itself. */
async function pixelsOf(file: string): Promise<Rgba | null> {
  const handle = await fs.open(file, "r")
  const head = new Uint8Array(8)
  try { await handle.read(head, 0, 8, 0) } finally { await handle.close() }
  if (isPng(head)) return null
  const { nativeImage } = await import("electron")
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error("the bundled reader could not decode the picture")
  const bgra = image.toBitmap()
  const { width } = image.getSize()
  const height = Math.floor(bgra.length / 4 / width)
  const data = new Uint8Array(width * height * 4)
  for (let at = 0; at < data.length; at += 4) {
    data[at] = bgra[at + 2]!; data[at + 1] = bgra[at + 1]!; data[at + 2] = bgra[at]!; data[at + 3] = bgra[at + 3]!
  }
  return { width, height, data }
}

interface Reply { id: number; lines?: BundledLine[]; error?: string }
interface Slot { worker: Worker; busy: boolean; timer?: ReturnType<typeof setTimeout> }

/** How long a worker is kept warm after its last picture. */
const IDLE_MS = 2 * 60 * 1000

/** The workers: one per picture being read, kept warm, terminated to take a read back. */
export class BundledPool {
  private readonly slots: Slot[] = []
  private next = 0

  constructor(private readonly folder: string,
    private readonly threads = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))) {}

  /** How many workers are alive (for the tests). */
  get size(): number { return this.slots.length }

  private spawn(): Slot {
    const worker = new Worker(path.join(this.folder, "worker.mjs"), { workerData: { folder: this.folder, threads: this.threads } })
    const slot: Slot = { worker, busy: false }
    this.slots.push(slot)
    // A worker that dies while resting is forgotten (the next picture gets a fresh one), and its error is not an
    // unhandled 'error' event in the main process; a read in progress hears both through its own listeners.
    worker.on("error", () => undefined)
    worker.once("exit", () => {
      clearTimeout(slot.timer)
      const at = this.slots.indexOf(slot)
      if (at >= 0) this.slots.splice(at, 1)
    })
    return slot
  }

  private drop(slot: Slot): void {
    clearTimeout(slot.timer)
    const at = this.slots.indexOf(slot)
    if (at >= 0) this.slots.splice(at, 1)
    void slot.worker.terminate().catch(() => undefined)
  }

  private rest(slot: Slot): void {
    slot.busy = false
    slot.worker.unref()
    slot.timer = setTimeout(() => this.drop(slot), IDLE_MS)
    slot.timer.unref?.()
  }

  read(job: { file?: string; pixels?: Rgba; japanese: boolean }, signal?: AbortSignal): Promise<Reply> {
    if (signal?.aborted) return Promise.reject(aborted())
    const slot = this.slots.find((one) => !one.busy) ?? this.spawn()
    slot.busy = true
    clearTimeout(slot.timer)
    slot.worker.ref()
    const id = (this.next += 1)
    return new Promise<Reply>((resolve, reject) => {
      const { worker } = slot
      const settle = () => {
        worker.off("message", message); worker.off("error", failed); worker.off("exit", exited)
        signal?.removeEventListener("abort", stop)
      }
      const message = (reply: Reply) => {
        if (reply.id !== id) return
        settle(); this.rest(slot)
        if (reply.error) reject(new Error(reply.error)); else resolve(reply)
      }
      const failed = (error: Error) => { settle(); this.drop(slot); reject(error) }
      const exited = (code: number) => { settle(); this.drop(slot); reject(new Error(`the bundled reader stopped (exit ${code})`)) }
      const stop = () => { settle(); this.drop(slot); reject(aborted()) }
      worker.on("message", message); worker.on("error", failed); worker.on("exit", exited)
      signal?.addEventListener("abort", stop, { once: true })
      worker.postMessage({ id, ...job }, job.pixels ? [job.pixels.data.buffer as ArrayBuffer] : [])
    })
  }

  /** Stop every worker (a test, or the app quitting). */
  close(): void { for (const slot of [...this.slots]) this.drop(slot) }
}

const pools = new Map<string, BundledPool>()

/** One picture through the reader. Throws when it cannot. */
export async function readWithBundledOcr(here: string, file: string, options: ReadOptions = {}): Promise<Words> {
  const folder = bundledOcrFolder(here)
  if (!folder) throw new Error("the bundled reader's files are not beside the app")
  const pool = pools.get(folder) ?? new BundledPool(folder)
  pools.set(folder, pool)
  const pixels = await pixelsOf(file)
  const reply = await pool.read({ ...(pixels ? { pixels } : { file }), japanese: wantsJapanese(options.languages) }, options.signal)
  return bundledWords(reply.lines ?? [])
}
