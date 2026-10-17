// The Quick Look extension's script (apps/desktop/src/quicklook/preview.ts): the core's page renderer as ONE classic
// script, for a bare JavaScriptCore context - no modules, no require, no DOM. tools/build-quicklook.sh puts it in the
// extension's Resources; apps/desktop/test/quickLook.test.ts builds it with this same function and runs it in
// a Node `vm` context that has nothing but the language, which is what JavaScriptCore gives it - and, on a Mac, in the
// system's JavaScriptCore itself with its JIT off, as the sandboxed extension runs it.
//
//   node apps/desktop/scripts/build-quicklook.mjs <out-file>
import { build } from "esbuild"
import { fileURLToPath } from "node:url"

export const ENTRY = fileURLToPath(new URL("../src/quicklook/preview.ts", import.meta.url))

/**
 * The bundle's options. Safari 16 is what macOS 13 (the app's minimum) shipped first; the newer syntax esbuild can
 * lower, it does. (Two things it cannot: a regular expression's look-behind, which JavaScriptCore has from Safari
 * 16.4, macOS 13.3 - an older one fails to load the script and the extension says so in a plain page.)
 */
export const options = {
  entryPoints: [ENTRY],
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: ["safari16"],
  minify: true,
  legalComments: "none",
  logLevel: "warning",
}

/** The bundle as text (nothing written). */
export async function bundleQuickLook() {
  const result = await build({ ...options, write: false })
  return result.outputFiles[0].text
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2]
  if (!out) { console.error("usage: build-quicklook.mjs <out-file>"); process.exit(2) }
  await build({ ...options, outfile: out })
  console.log(`==> built ${out}`)
}
