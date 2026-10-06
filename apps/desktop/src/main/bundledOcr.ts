/**
 * THE BUNDLED READER, from the main process's side: one engine shipped INSIDE WriteMind (PP-OCRv5 on onnxruntime's
 * WebAssembly build, docs/OCR-BUNDLED.md), so macOS, Windows and Linux read a picture the same way with nothing to
 * install. `helpers.ts` asks it first and falls back to Vision / Windows' engine / tesseract when its files are not
 * there or it fails.
 *
 * A CAPABILITY IS A FILE BEING THERE, as for every other reader: `out/helpers/bundled-ocr/` holds the worker, the
 * WebAssembly runtime and the models (scripts/build.mjs puts them there, `asarUnpack` takes them out of the archive);
 * a build made offline without the models simply has no bundled reader.
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
import { hasJapanese, type BundledLine } from "./bundledOcr/pipeline"
import { isPng, type Rgba } from "./bundledOcr/png"
import { shipped, type ReadOptions, type Words } from "./helpers"

/** The folder the bundled reader lives in, when everything it needs is there. */
export function bundledOcrFolder(here: string): string | null {
  const folder = shipped(here, "../helpers/bundled-ocr")
  const runtime = [path.join(folder, "worker.mjs"), path.join(folder, "ort", "ort-wasm-simd-threaded.wasm"),
    path.join(folder, "ort", "ort-wasm-simd-threaded.mjs")]
  return runtime.every((file) => existsSync(file)) && modelsIn(path.join(folder, "models")).ok ? folder : null
}

/** What `readerFor` says when the bundled reader is there. */
export function bundledReader(here: string): { ocr: true; engine: "bundled"; japanese: boolean } | null {
  const folder = bundledOcrFolder(here)
  return folder ? { ocr: true, engine: "bundled", japanese: modelsIn(path.join(folder, "models")).japanese } : null
}

/** Whether the languages asked for want the Japanese pass. Nothing asked for: yes, as the Mac reads Japanese first. */
export const wantsJapanese = (languages?: string[]): boolean =>
  !languages || languages.length === 0 || languages.some((tag) => /^ja(-|$)/i.test(tag))

/** The worker's lines in the shape every reader returns (helpers.ts `Words`). */
export function bundledWords(lines: BundledLine[], japaneseShipped: boolean): Words {
  return {
    engine: "bundled",
    lines: lines.map((line) => ({
      text: line.text, confidence: line.confidence,
      x: line.x, y: line.y, width: line.width, height: line.height,
      words: line.words.map((word) => ({ ...word })),
    })),
    language: lines.some((line) => hasJapanese(line.text)) ? "ja" : "en",
    installed: japaneseShipped ? ["en", "ja"] : ["en"],
    japanese: japaneseShipped,
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

interface Reply { id: number; lines?: BundledLine[]; japanese?: boolean; error?: string }
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

/** One picture through the bundled reader. Throws when it cannot (the caller falls back to another reader). */
export async function readWithBundledOcr(here: string, file: string, options: ReadOptions = {}): Promise<Words> {
  const folder = bundledOcrFolder(here)
  if (!folder) throw new Error("the bundled reader's files are not beside the app")
  const pool = pools.get(folder) ?? new BundledPool(folder)
  pools.set(folder, pool)
  const pixels = await pixelsOf(file)
  const reply = await pool.read({ ...(pixels ? { pixels } : { file }), japanese: wantsJapanese(options.languages) }, options.signal)
  return bundledWords(reply.lines ?? [], reply.japanese === true)
}
