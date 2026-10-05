/**
 * Reading pictures without ever making the app wait: a queue of two, a cache
 * of what was already read, and a way to take a request back.
 *
 * WHY IT IS HERE AND NOT IN `helpers.ts`: the helper is one picture through
 * one program. What the app does with it is three kinds of caller — the Aa
 * handle on a picture, the chart reader labelling a capture's nodes, the
 * tablet's sheet — and they share an engine that costs a few hundred
 * milliseconds a picture, so the same pixels asked twice (a capture read for
 * its labels and then again by Aa) are read once, a request nobody wants any
 * more (the picture was deleted, the pane closed, a newer capture replaced
 * it) kills its PowerShell instead of finishing it, and no more than two
 * engines run at once.
 *
 * A request is `{ id, file | bytes, languages? }`. The cache key is what is
 * IN the picture (a hash of its bytes) and the languages asked for, never
 * the path, so a re-saved file reads again and a copy does not.
 */

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { readWords, type ReadOptions, type Words } from "./helpers"

export type OcrSource = { file: string } | { bytes: Uint8Array }

export interface OcrRequest {
  /** Who is asking, so the same asker can take the request back. */
  id: string
  source: OcrSource
  languages?: string[]
}

type Reader = (file: string, options: ReadOptions) => Promise<Words>

interface Entry {
  promise: Promise<Words>
  waiters: Set<string>
  controller: AbortController
  settled: boolean
}

const MAX_CACHED = 32
const MAX_RUNNING = 2

const extensionOf = (bytes: Uint8Array): string => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg"
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return ".gif"
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return ".bmp"
  return ".img"
}

export class OcrService {
  private readonly cache = new Map<string, Entry>()
  private readonly rejectors = new Map<string, (reason: Error) => void>()
  private running = 0
  private readonly queue: (() => void)[] = []
  /** Reads started (not cache hits) — for the diagnostics and the tests. */
  started = 0

  constructor(
    private readonly read: Reader,
    private readonly folder: string = path.join(os.tmpdir(), "writemind-ocr"),
  ) {
    // What a crash left behind (a picture is deleted as soon as it has been read).
    void fs.readdir(folder).then((names) => Promise.all(names.map(async (name) => {
      const file = path.join(folder, name)
      const stat = await fs.stat(file)
      if (Date.now() - stat.mtimeMs > 60 * 60 * 1000) await fs.rm(file, { force: true })
    }))).catch(() => undefined)
  }

  /** The words in a picture. Rejects with an AbortError-named error when `cancel(id)` took it back. */
  request(request: OcrRequest): Promise<Words> {
    // Registered FIRST, so a cancel that arrives while the picture is still
    // being read off the disk is not lost.
    return new Promise<Words>((resolve, reject) => {
      this.rejectors.set(request.id, reject)
      this.begin(request).then(resolve, reject).finally(() => {
        if (this.rejectors.get(request.id) === reject) this.rejectors.delete(request.id)
      })
    })
  }

  private async begin(request: OcrRequest): Promise<Words> {
    const bytes = "bytes" in request.source
      ? request.source.bytes
      : new Uint8Array(await fs.readFile(request.source.file))
    if (!this.rejectors.has(request.id)) throw Object.assign(new Error("cancelled"), { name: "AbortError" })
    const key = createHash("sha1").update(bytes).update("|").update((request.languages ?? []).join(",")).digest("hex")

    let entry = this.cache.get(key)
    if (entry) {
      // Most recently used goes to the back.
      this.cache.delete(key)
      this.cache.set(key, entry)
    } else {
      entry = this.start(key, request, bytes)
      this.cache.set(key, entry)
      while (this.cache.size > MAX_CACHED) {
        const oldest = [...this.cache.entries()].find(([, value]) => value.settled)
        if (!oldest) break
        this.cache.delete(oldest[0])
      }
    }
    entry.waiters.add(request.id)
    const joined = entry
    try {
      return await joined.promise
    } finally {
      joined.waiters.delete(request.id)
    }
  }

  /** Take a request back. The engine is stopped when nobody else is waiting for the same picture. */
  cancel(id: string): void {
    const reject = this.rejectors.get(id)
    this.rejectors.delete(id)
    for (const [key, entry] of this.cache) {
      if (!entry.waiters.delete(id)) continue
      if (entry.waiters.size === 0 && !entry.settled) {
        entry.controller.abort()
        this.cache.delete(key)
      }
    }
    reject?.(Object.assign(new Error("cancelled"), { name: "AbortError" }))
  }

  /** How many pictures are being read or waiting to be. */
  get busy(): number { return this.running + this.queue.length }

  private start(key: string, request: OcrRequest, bytes: Uint8Array): Entry {
    const controller = new AbortController()
    const entry: Entry = {
      waiters: new Set(), controller, settled: false,
      promise: Promise.resolve({ lines: [] }),
    }
    entry.promise = (async () => {
      await this.slot(controller.signal)
      let temporary: string | null = null
      try {
        // Taken back while it waited for its turn: the engine never starts.
        if (controller.signal.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" })
        let file: string
        if ("file" in request.source) {
          file = request.source.file
        } else {
          await fs.mkdir(this.folder, { recursive: true })
          temporary = path.join(this.folder, `${key}${extensionOf(bytes)}`)
          await fs.writeFile(temporary, bytes)
          file = temporary
        }
        this.started += 1
        return await this.read(file, {
          signal: controller.signal,
          ...(request.languages ? { languages: request.languages } : {}),
        })
      } finally {
        if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined)
        this.release()
      }
    })()
    entry.promise.then(() => { entry.settled = true }, () => {
      entry.settled = true
      // A failure is not remembered: the next ask tries again.
      if (this.cache.get(key) === entry) this.cache.delete(key)
    })
    return entry
  }

  /** Wait for one of the engine slots, or give up when taken back. */
  private slot(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }))
    if (this.running < MAX_RUNNING) { this.running += 1; return Promise.resolve() }
    return new Promise<void>((resolve, reject) => {
      const go = () => { signal.removeEventListener("abort", quit); this.running += 1; resolve() }
      const quit = () => {
        const at = this.queue.indexOf(go)
        if (at >= 0) this.queue.splice(at, 1)
        reject(Object.assign(new Error("cancelled"), { name: "AbortError" }))
      }
      signal.addEventListener("abort", quit, { once: true })
      this.queue.push(go)
    })
  }

  private release(): void {
    this.running -= 1
    this.queue.shift()?.()
  }
}

/** The one service the app runs. */
export const ocrFor = (here: string): OcrService =>
  new OcrService((file, options) => readWords(here, file, options))
