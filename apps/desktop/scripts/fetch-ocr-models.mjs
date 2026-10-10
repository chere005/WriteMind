// THE BUNDLED READER'S MODEL FILES, fetched at BUILD time (docs/OCR-BUNDLED.md). Each file in ocr-models.json is
// downloaded from its pinned URL, checked against its SHA-256 and kept in a cache (apps/desktop/.cache/ocr-models,
// git-ignored; WM_OCR_MODELS_CACHE moves it), so a second build downloads nothing. A file whose hash does not match
// is thrown away, never used. Nothing here runs when the app does: the app only looks for the files beside it.
//
//   node scripts/fetch-ocr-models.mjs          fetch what is missing, say where the cache is
//
// build.mjs calls `fetchOcrModels()`. Offline with an empty cache, a dev build goes on without the models (the app
// then reads with the platform's own reader, as before); WM_REQUIRE_OCR_MODELS=1 (the release jobs) makes it fatal.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const manifest = JSON.parse(readFileSync(path.join(here, "ocr-models.json"), "utf8"))
export const cacheFolder = process.env.WM_OCR_MODELS_CACHE ?? path.join(here, "..", ".cache", "ocr-models")

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

/** True when the cached copy of `model` is there and is the pinned bytes. */
export function cached(model) {
  const file = path.join(cacheFolder, model.file)
  return existsSync(file) && sha256(readFileSync(file)) === model.sha256
}

async function download(model) {
  let last = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(model.url, { redirect: "follow" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      const got = sha256(bytes)
      if (got !== model.sha256) throw new Error(`sha256 ${got} is not the pinned ${model.sha256}`)
      const target = path.join(cacheFolder, model.file)
      writeFileSync(`${target}.part`, bytes)
      renameSync(`${target}.part`, target)
      return
    } catch (error) {
      last = error
      console.warn(`  ${model.file}: attempt ${attempt} failed: ${error.message}`)
    }
  }
  throw new Error(`${model.file}: could not fetch ${model.url}: ${last?.message}`)
}

/**
 * Make sure every model is in the cache. Returns the cache folder, or null when something is missing and
 * `required` is false (a dev build offline).
 */
export async function fetchOcrModels({ required = process.env.WM_REQUIRE_OCR_MODELS === "1" } = {}) {
  mkdirSync(cacheFolder, { recursive: true })
  for (const model of manifest.models) {
    if (cached(model)) continue
    rmSync(path.join(cacheFolder, model.file), { force: true })
    console.log(`fetching ${model.file} (${(model.bytes / 1e6).toFixed(1)} MB) for the bundled reader`)
    try {
      await download(model)
    } catch (error) {
      if (required) throw error
      console.warn(`WARNING: ${error.message}\n  The build goes on WITHOUT the bundled reader; the app will use the platform's own.`)
      return null
    }
  }
  return cacheFolder
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = await fetchOcrModels({ required: true })
  console.log(`bundled reader models ready in ${folder}`)
}
