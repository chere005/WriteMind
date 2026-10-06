/**
 * The bundled reader's networks, loaded: onnxruntime-web (its WebAssembly build, which runs the same on every
 * platform Node runs on) and the PP-OCRv5 files `scripts/fetch-ocr-models.mjs` put beside the app. Used by the
 * worker (main/bundledOcr/worker.ts) and by the tests, which load the same files from the build's cache.
 */

import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type * as Ort from "onnxruntime-web"
import { ctcAlphabet } from "./onnxMeta"
import type { Engine, Recogniser, SessionLike } from "./pipeline"

/** The model files by role: the same names as `scripts/ocr-models.json` (a test holds the two together). */
export const MODEL_FILES = {
  det: "ch_PP-OCRv5_det_mobile.onnx",
  rec: "en_PP-OCRv5_rec_mobile.onnx",
  recJapanese: "ch_PP-OCRv5_rec_mobile.onnx",
} as const

/** What a models folder holds: the reader needs the detector and the English recogniser; Japanese is extra. */
export function modelsIn(folder: string): { ok: boolean; japanese: boolean } {
  const has = (name: string) => existsSync(path.join(folder, name))
  return { ok: has(MODEL_FILES.det) && has(MODEL_FILES.rec), japanese: has(MODEL_FILES.recJapanese) }
}

export interface LoadOptions {
  /** WebAssembly threads per engine (onnxruntime's own worker threads). */
  threads?: number
  /** Where `ort-wasm-simd-threaded.{mjs,wasm}` are, when they are not beside onnxruntime-web's own script. */
  wasmFolder?: string
}

export async function loadEngine(ort: typeof Ort, models: string, options: LoadOptions = {}): Promise<Engine> {
  ort.env.wasm.numThreads = Math.max(1, options.threads ?? 1)
  if (options.wasmFolder) {
    const base = pathToFileURL(path.resolve(options.wasmFolder) + path.sep)
    ort.env.wasm.wasmPaths = {
      mjs: new URL("ort-wasm-simd-threaded.mjs", base).href,
      wasm: new URL("ort-wasm-simd-threaded.wasm", base).href,
    }
  }
  const session = async (bytes: Uint8Array): Promise<SessionLike> =>
    await ort.InferenceSession.create(bytes, { graphOptimizationLevel: "all" }) as unknown as SessionLike
  const recogniser = async (name: string): Promise<Recogniser> => {
    const bytes = new Uint8Array(await fs.readFile(path.join(models, name)))
    const alphabet = ctcAlphabet(bytes)
    if (!alphabet) throw new Error(`${name} carries no character list`)
    return { session: await session(bytes), alphabet }
  }
  const det = await session(new Uint8Array(await fs.readFile(path.join(models, MODEL_FILES.det))))
  const rec = await recogniser(MODEL_FILES.rec)
  const japanese = modelsIn(models).japanese ? await recogniser(MODEL_FILES.recJapanese) : undefined
  return {
    det, rec, ...(japanese ? { japanese } : {}),
    tensor: (data, dims) => new ort.Tensor("float32", data, dims),
  }
}
