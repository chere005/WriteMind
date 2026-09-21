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
console.log("main and preload built")
