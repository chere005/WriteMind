/**
 * The Wolfram export's and a copy's kernel run, with what it answered remembered (Sean, 2026-10-06: "the kernel will
 * provide the image data anyway from wolfram engine"). The ONLY caller of `Runner.wolframJob` (a test reads the
 * sources to keep it so): notebookFile.ts and clipboard.ts both come through here.
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * REMEMBERED IN MEMORY, by what was asked (`jobKey`: the job's kind and text, and a picture's file's `mtimeMs:size`),
 * the last 64 answers or 16 MB of them. wolframscript takes a second and a half to start, so a second copy of the
 * same drawing — or an export straight after a copy — finds its answer here and pastes as the image at once. Only
 * the jobs not remembered go to the kernel, plus the `png` flag when a copy wants a PNG that is not remembered yet.
 */

import { engineState, jobKey, type EngineState, type KernelJob } from "@writemind/core"
import type { Runner } from "../eval/runner"

const MAX_ENTRIES = 64
const MAX_BYTES = 16 * 1024 * 1024

interface Remembered { boxes: string; png: Uint8Array | null; bytes: number }

/** The answers, by cache key, oldest first (a Map keeps its order; a hit moves to the end). */
const remembered = new Map<string, Remembered>()
let rememberedBytes = 0

function remember(key: string, entry: Remembered): void {
  const old = remembered.get(key)
  if (old) { remembered.delete(key); rememberedBytes -= old.bytes }
  remembered.set(key, entry)
  rememberedBytes += entry.bytes
  while (remembered.size > MAX_ENTRIES || rememberedBytes > MAX_BYTES) {
    const oldest = remembered.keys().next().value as string
    rememberedBytes -= remembered.get(oldest)!.bytes
    remembered.delete(oldest)
  }
}

function recall(key: string): Remembered | null {
  const entry = remembered.get(key)
  if (!entry) return null
  remembered.delete(key)
  remembered.set(key, entry)
  return entry
}

/** Forget everything (the tests). */
export function forgetKernelAnswers(): void {
  remembered.clear()
  rememberedBytes = 0
}

export interface KernelOptions {
  /** The run's id: a copy's is fixed (a newer copy takes the older run back), each export's its own. */
  id: string
  /** Whether a PNG of each image is wanted too (a copy of one drawing: what other apps paste). */
  png: boolean
  /** Apply Wolfram's RemoveBackground to generated images before the clipboard writes them as notebook cells. */
  removeBackground?: boolean
  timeoutMs: number
  /** A job's stamp for its cache key, by job name (a picture's file's `mtimeMs:size`). */
  stamps?: ReadonlyMap<string, string>
}

export interface KernelDeps {
  runner: Pick<Runner, "wolframJob" | "tools">
}

export interface KernelAnswers {
  /** Each answered job's boxes, by job name. */
  answers: Map<string, string>
  /** Each answered image's PNG, by job name (when asked for). */
  pngs: Map<string, Uint8Array>
  state: EngineState
}

const isImage = (job: KernelJob): boolean => /\.(svg|txt)$/.test(job.name)
const ascii = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes).trim()

/** Every job answered from memory where it can be, and the rest in ONE kernel run. */
export async function runKernel(jobs: readonly KernelJob[], options: KernelOptions, deps: KernelDeps): Promise<KernelAnswers> {
  const answers = new Map<string, string>()
  const pngs = new Map<string, Uint8Array>()
  const keys = new Map<string, string>()
  const ask: KernelJob[] = []
  for (const job of jobs) {
    const key = jobKey(job, options.stamps?.get(job.name) ?? "", options.removeBackground === true)
    keys.set(job.name, key)
    const held = recall(key)
    const wantsPng = options.png && isImage(job)
    if (held && (!wantsPng || held.png)) {
      answers.set(job.name, held.boxes)
      if (wantsPng && held.png) pngs.set(job.name, held.png)
      continue
    }
    ask.push(job)
  }
  if (ask.length === 0) return { answers, pngs, state: { kind: "answered" } }

  const outcome = await deps.runner.wolframJob(options.id, [
    ...ask,
    ...(options.png ? [{ name: "png", text: "" }] : []),
    ...(options.removeBackground ? [{ name: "remove-background", text: "" }] : []),
  ], options.timeoutMs)
  if (outcome.kind === "ran") {
    for (const job of ask) {
      const boxes = outcome.answers.get(`${job.name}.boxes`)
      if (!boxes) continue
      const text = ascii(boxes)
      if (!text) continue
      const png = outcome.answers.get(`${job.name}.png`) ?? null
      answers.set(job.name, text)
      if (png) pngs.set(job.name, png)
      remember(keys.get(job.name)!, { boxes: text, png, bytes: text.length + (png?.length ?? 0) })
    }
  }
  return { answers, pngs, state: engineState(outcome, deps.runner.tools().wolfram.path, options.timeoutMs) }
}
