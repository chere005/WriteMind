// The main process and the preload, bundled: the main as ESM (the package
// is a module, and Electron takes an ESM entry point), the preload as CJS
// (a preload is require()d, whatever the package says).
import { build } from "esbuild"

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  logLevel: "warning",
}

await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "out/main/main.mjs", format: "esm" })
await build({ ...common, entryPoints: ["src/preload/preload.ts"], outfile: "out/preload/preload.cjs", format: "cjs" })
// NATIVE PEN CAPTURE (docs/spikes/DESIGN-pen-capture.md 12.3; this block belongs to the containment lane).
//  - pen-guard.mjs: the DETACHED guard process that owns the cursor clip and Wintab contexts so a crash cannot leave
//    them behind. It runs as `electron.exe` with ELECTRON_RUN_AS_NODE=1, so it is a plain ESM script that must be a
//    real file on disk (asarUnpack, electron-builder.yml) and loads koffi at run time, never bundled.
//  - pen-sink.cjs: the preload of the transparent pen-sink window.
//  - pen-hid.cjs / pen-hid.js: the WebHID helper window's preload and page script (written by another lane; built
//    only once their sources exist, so this file never breaks a build for someone else's unfinished work).
import { existsSync } from "node:fs"
const optional = async (entry, options) => {
  if (!existsSync(entry)) { console.log(`skipped ${entry} (not written yet)`); return }
  await build({ ...common, entryPoints: [entry], ...options })
}
await optional("src/main/pen/guard.ts", { external: ["electron", "koffi"], outfile: "out/main/pen-guard.mjs", format: "esm" })
await optional("src/preload/penSink.ts", { outfile: "out/preload/pen-sink.cjs", format: "cjs" })
await optional("src/preload/penHid.ts", { outfile: "out/preload/pen-hid.cjs", format: "cjs" })
await optional("src/main/pen/webhid/hostPage.ts", { platform: "browser", target: "chrome120", external: [], outfile: "out/helpers/pen-hid.js", format: "iife" })
// The helpers that are scripts rather than programs (Windows' OCR) ship as they are, beside
// the main bundle where `shipped(here, "../helpers/...")` looks - and `asarUnpack`
// (electron-builder.yml) takes them out of the archive, where nothing can run.
import { cpSync, mkdirSync } from "node:fs"
mkdirSync("out/helpers", { recursive: true })
cpSync("src/helpers", "out/helpers", { recursive: true })
console.log("main and preload built; helpers copied")
